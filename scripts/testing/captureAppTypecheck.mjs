import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

// One existing CI command; this is not a general command runner.
const command = ["npx", "tsc", "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false"];
const FILE_LIMIT = 2 * 1024 * 1024;
const PAYLOAD_LIMIT = 2 * 1024 * 1024;
const META_LIMIT = 64 * 1024;
const startedAt = new Date().toISOString();
const started = performance.now();
const deadline = started + 10 * 60 * 1000;
const declarations = ["api.d.ts", "server.d.ts", "dataModel.d.ts"];
const inputs = [
  ...declarations.map((name) => `backend/convex/_generated/${name}`),
  "tsconfig.app.json", "backend/convex/tsconfig.json", ".github/workflows/ci.yml",
  "scripts/testing/captureAppTypecheck.mjs", "package.json",
  "node_modules/typescript/package.json", "node_modules/convex/package.json",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sameStat = (a, b) => ["dev", "ino", "size", "mtimeNs", "ctimeNs"]
  .every((key) => a[key] === b[key]);
const checkBudget = () => {
  if (performance.now() >= deadline) throw new Error("capture_budget_exhausted");
};

function readStable(file, cap = FILE_LIMIT) {
  checkBudget();
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(cap)) throw new Error(`invalid_public_input:${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) throw new Error(`input_changed_on_open:${file}`);
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      checkBudget();
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new Error(`incomplete_public_input:${file}`);
      offset += count;
    }
    if (!sameStat(opened, fs.fstatSync(fd, { bigint: true })) ||
        !sameStat(opened, fs.lstatSync(file, { bigint: true }))) {
      throw new Error(`input_changed_during_read:${file}`);
    }
    return { bytes, sha256: sha256(bytes), identity: opened };
  } finally {
    fs.closeSync(fd);
  }
}

function writeAll(fd, bytes, onWrite = () => {}) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (count === 0) throw new Error("incomplete_artifact_write");
    offset += count;
    onWrite(count);
  }
}

let logFd;
let metadataBytes = 0;
let retainedBytes = 0;
const observedBytes = { stdout: 0, stderr: 0 };
let captureError = null;
const errorLabel = (error) => String(error.code || error.message || "capture_failure").slice(0, 512);
function metadata(kind, value) {
  const bytes = Buffer.from(`\n--- ${kind} ---\n${JSON.stringify(value)}\n`);
  if (metadataBytes + bytes.length > META_LIMIT) throw new Error("metadata_limit_exceeded");
  writeAll(logFd, bytes, (count) => { metadataBytes += count; });
}

function runCompiler() {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const child = spawn(command[0], command.slice(1), {
      signal: controller.signal, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stopped = null;
    let spawnError = null;
    let killError = null;
    let forceTimer;
    let abandonTimer;
    let finished = false;
    const killGroup = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== "ESRCH") killError = error.code || "kill_failed"; }
    };
    const finish = (code, signal, closeObserved) => {
      if (finished) return;
      finished = true;
      // A recorded stop owns cleanup; normal completion needs no group signal.
      if (stopped) killGroup("SIGKILL");
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(abandonTimer);
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInt);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ code, signal, closeObserved, stopped, spawnError, killError });
    };
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      killGroup("SIGTERM");
      controller.abort();
      forceTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
      abandonTimer = setTimeout(() => {
        killGroup("SIGKILL");
        finish(null, null, false);
      }, 10000);
    };
    const onTerm = () => stop("SIGTERM");
    const onInt = () => stop("SIGINT");
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
    const timer = setTimeout(() => stop("timeout"), Math.max(0, deadline - performance.now()));
    for (const channel of ["stdout", "stderr"]) {
      child[channel].on("data", (chunk) => {
        observedBytes[channel] += chunk.length;
        // Keep draining after the cap: truncation must not send SIGPIPE to tsc.
        const keep = Math.min(chunk.length, PAYLOAD_LIMIT - retainedBytes);
        if (keep === 0 || captureError) return;
        try {
          writeAll(logFd, chunk.subarray(0, keep), (count) => { retainedBytes += count; });
        } catch (error) {
          captureError = errorLabel(error);
          stop("capture_failure");
        }
      });
      child[channel].on("error", (error) => {
        captureError = errorLabel(error);
        stop("capture_failure");
      });
    }
    child.on("error", (error) => {
      if (!(controller.signal.aborted && error.name === "AbortError")) {
        spawnError = error.code || "spawn_failed";
      }
    });
    child.on("close", (code, signal) => finish(code, signal, true));
  });
}

let result = null;
let postInputsVerified = false;
let outputDirectory;
let directoryCreated = false;
let exitCode = 1;
try {
  if (process.platform !== "linux" ||
      JSON.stringify(process.argv.slice(2)) !== JSON.stringify(command)) {
    throw new Error("expected_exact_linux_app_typecheck_command");
  }
  const temp = process.env.RUNNER_TEMP;
  const workflowSha = process.env.GITHUB_SHA;
  if (!temp || !path.isAbsolute(temp) || !/^[0-9a-f]{40}$/.test(workflowSha || "")) {
    throw new Error("missing_public_ci_identity");
  }
  if (!fs.lstatSync(temp).isDirectory() || fs.realpathSync(temp) !== path.resolve(temp)) {
    throw new Error("runner_temp_not_plain_canonical_directory");
  }
  outputDirectory = path.join(temp, "nodebench-app-typecheck");
  fs.mkdirSync(outputDirectory, { mode: 0o700 }); // Exact fresh directory; EEXIST fails.
  directoryCreated = true;
  logFd = fs.openSync(path.join(outputDirectory, "app-typecheck-diagnostics.log"), "wx", 0o600);
  const gitIdentity = (ref) => {
    checkBudget();
    const value = execFileSync("git", ["--no-optional-locks", "rev-parse", ref], {
      encoding: "utf8", timeout: 5000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("invalid_git_identity");
    return value;
  };
  const before = new Map();
  const sourceHashes = {};
  const versions = {};
  let declarationBytes = 0;
  for (const file of inputs) {
    const packageMetadata = file.startsWith("node_modules/");
    const read = readStable(file, packageMetadata ? 128 * 1024 : FILE_LIMIT);
    before.set(file, { sha256: read.sha256, identity: read.identity });
    sourceHashes[file] = { bytes: read.bytes.length, sha256: read.sha256 };
    if (packageMetadata) {
      const version = JSON.parse(read.bytes.toString("utf8")).version;
      if (typeof version !== "string" || version.length > 128 ||
          !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error("invalid_selected_package_version");
      }
      versions[file] = version;
    }
    if (file.startsWith("backend/convex/_generated/")) {
      declarationBytes += read.bytes.length;
      if (declarationBytes > 3 * FILE_LIMIT) throw new Error("declaration_total_limit");
      const output = path.join(outputDirectory, path.basename(file));
      const fd = fs.openSync(output, "wx", 0o600);
      try { writeAll(fd, read.bytes); } finally { fs.closeSync(fd); }
      if (readStable(output).sha256 !== read.sha256) throw new Error("snapshot_readback_mismatch");
    }
  }
  metadata("provenance", {
    schema: 1, startedAt, command, workflowSha, checkoutCommit: gitIdentity("HEAD"),
    checkoutTree: gitIdentity("HEAD^{tree}"), sourceHashes, versions,
    nodeVersion: process.version, generatedSnapshot: "after_existing_codegen_before_app_typecheck",
    payloadLimit: PAYLOAD_LIMIT, metadataLimit: META_LIMIT, collectorBudgetMs: 600000,
    streamOrder: "stdout_and_stderr_chunks_in_observed_arrival_order",
  });
  result = await runCompiler();
  for (const file of inputs) {
    const read = readStable(file, file.startsWith("node_modules/") ? 128 * 1024 : FILE_LIMIT);
    const original = before.get(file);
    if (read.sha256 !== original.sha256 || !sameStat(read.identity, original.identity)) {
      throw new Error(`input_changed_after_compiler:${file}`);
    }
  }
  postInputsVerified = true;
  exitCode = Number.isInteger(result.code) ? result.code : 1;
} catch (error) {
  captureError = captureError || errorLabel(error);
} finally {
  if (result?.stopped === "timeout") exitCode = 124;
  else if (result?.stopped === "SIGTERM") exitCode = 143;
  else if (result?.stopped === "SIGINT") exitCode = 130;
  else if (captureError || result?.spawnError || result?.killError || !result?.closeObserved) exitCode = 1;
  const footer = {
    compiler: result, observedBytes, retainedBytes,
    truncated: observedBytes.stdout + observedBytes.stderr > retainedBytes,
    postInputsVerified, captureError, plannedCollectorExitCode: exitCode,
    elapsedMs: Math.round(performance.now() - started),
  };
  if (logFd !== undefined) {
    try { metadata("result", footer); }
    catch { captureError = "artifact_footer_write_failed"; exitCode = 1; }
    finally {
      try { fs.closeSync(logFd); }
      catch { captureError = "artifact_close_failed"; exitCode = 1; }
    }
  }
  console.log(JSON.stringify({ ...footer, captureError, exitCode, artifactDirectoryCreated: directoryCreated }));
  process.exitCode = exitCode;
}
