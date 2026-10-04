import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// One diagnostic at one PR parent. This never replaces the failed App gate.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "d157b62e15b3a8f87e1aa10067a30f933c03985a";
const BRANCH = "fix/test-tooling-vitest4-storybook";
const REPOSITORY = "HomenShum/NodeBenchAI";
const MIB = 1024 * 1024;
const NATIVE_CAP = 64 * MIB;
const LOG_CAP = 2 * MIB;
const RECEIPT_CAP = 64 * 1024;
const RAW_CAP = 136445952;
const startedAt = new Date().toISOString();
const started = performance.now();
const deadline = started + 600000;
const unchangedSource = {
  ".storybook/main.ts": "15a7f70a818365a0dfcf7351c2d57526ebf2c63da39c9eb759b50e98e6d84e60",
  "mcp-services/core_agent_server/package.json": "a80e6ba86b53db41b0f220d9dbfc3e15d2a8fae530ec2a6a12e4d42cdd6c3f67",
  "package.json": "4e9e99593665c5d5d388ea21152a3cdadd0f2bee5f1cb7a1c41d8517370a32ea",
  "packages/convex-mcp-nodebench/package.json": "c08ef26c7cbb381a69d6f5a8615618718ed776d7e5ea14a65989362cd59183cd",
  "packages/mcp-local/package.json": "4e57df6418fc92d900aae994e6b6df816bb3050fa69d9c4c51d9c60705dc1f5a",
  "packages/openclaw-mcp-nodebench/package.json": "1ef774df27ddb0b0816153d2a4c92ef346bca239a287b808f9637e04af989b5e",
  "scripts/testing/captureAppTypecheck.mjs": "98ffdd8268a005ceeb221e014e45f0da1074f2dbdd8c4edad147106a55f0050e",
  "scripts/testing/probeGeneratedApiTypes.mjs": "b7bde583e80748aa73bc319319cffac7d3def836aee83b6eaa2e532a481a6743",
  "scripts/testing/verifyStorybookIndex.mjs": "b06ef26789c5b5c2124846c56d2194be5185910cb0c4a9ddcaa65d8cb42349ea",
  "vitest.config.ts": "c14fcc86577f5222532bdc42eee308ab268c449baac36407ae81b4daaf657d82"
};
const semanticPins = {
  "backend/convex/_generated/api.d.ts": "28807c921bfe1d71ce2b0ce742a59355b3425948540ea4ecd6038ec8380f67f5",
  "backend/convex/_generated/server.d.ts": "2b536ee08d434dd044efe0302aeaf4ccb00cd08af10c9f8c7bc7a6734e4aa49b",
  "backend/convex/_generated/dataModel.d.ts": "db177073d16a4393c7a96bcdc3a2a904e88c2432d54d138ca7715cc431982c17",
  "tsconfig.app.json": "f543fff20d4fb4c6e658329453798e71bdc13138780151586624086d5df167c9",
  "backend/convex/tsconfig.json": "bb9208267220aff113f2177f3f043293c6f192754697f5f89699236a73d44db7",
  "node_modules/typescript/package.json": "822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6",
  "node_modules/convex/package.json": "bafaba6990e5e8107400da04a66dfde18dd7fa81471c123695779d234717f290",
  "node_modules/typescript/bin/tsc": "8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0",
  "node_modules/typescript/lib/tsc.js": "2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983",
  "node_modules/typescript/lib/_tsc.js": "e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419",
  "node_modules/typescript/lib/typescript.js": "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
  "node_modules/convex/dist/esm-types/server/api.d.ts": "642f76dd6a1faac0efaabebedfb07e77c38ecaa0360846f55295eda4d537b46c",
  "node_modules/convex/dist/esm-types/server/registration.d.ts": "28e694a7831bb0d9ed97f4b78e953877b59ad3773b94d054abbc8af712657315",
  "node_modules/convex/dist/esm-types/server/index.d.ts": "3dde8f95d66278d89a3f896f7f9f7b05b3897ff040cfea68079b6e6e028a67b7",
  "node_modules/convex/dist/esm-types/server/schema.d.ts": "ed2a07ef99205ee94494156a48d191bbc25d03c74667ad488a66c241f662a8e7",
  "node_modules/convex/dist/esm-types/values/index.d.ts": "62f048e2a1ab85c8f06cb2eb2a539d5a245f8e42829299f7ced48bfffea87e66",
  "node_modules/convex/dist/esm-types/values/validator.d.ts": "c66933f5c7824921c3a0e09f41b8c857d3f0e9570c264ef241d62befcbd3c775",
  "node_modules/convex/dist/esm-types/type_utils.d.ts": "c9b10f272dcd513115c421ddea5460a365a4810106821ffa2dec9a26446610fe"
};
const changedSource = [".github/workflows/ci.yml", "scripts/testing/captureAppTypecheckTrace.mjs"];
const sourceFiles = [...Object.keys(unchangedSource), ...changedSource];
const inputFiles = [...sourceFiles, ...Object.keys(semanticPins)];
const generated = ["api.d.ts", "server.d.ts", "dataModel.d.ts"];
const originalCommand = ["npx", "tsc", "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false"];
const nativeLimits = { "trace.json": NATIVE_CAP, "types.json": NATIVE_CAP, "legend.json": 64 * 1024 };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sameStat = (a, b) => ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
const budget = () => { if (performance.now() >= deadline) throw new Error("budget_exhausted"); };
const label = (error) => String(error.code || error.message || "capture_failed").slice(0, 256);
const childEnv = { CI: "true", NO_COLOR: "1", NODE_DISABLE_COMPILE_CACHE: "1" };

function stable(file, cap, retain = false) {
  budget();
  if (fs.realpathSync(file) !== file) throw new Error("noncanonical_public_file");
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(cap)) throw new Error("unbounded_or_nonregular_file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!sameStat(before, opened)) throw new Error("file_changed_on_open");
    const digest = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
    const bytes = retain ? Buffer.alloc(Number(opened.size)) : null;
    let offset = 0;
    while (offset < Number(opened.size)) {
      budget();
      const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, Number(opened.size) - offset), null);
      if (!count) throw new Error("incomplete_public_read");
      digest.update(chunk.subarray(0, count));
      if (bytes) chunk.copy(bytes, offset, 0, count);
      offset += count;
    }
    if (!sameStat(opened, fs.fstatSync(fd, { bigint: true })) || !sameStat(opened, fs.lstatSync(file, { bigint: true }))) throw new Error("file_changed_during_read");
    return { bytes, size: offset, sha256: digest.digest("hex"), identity: opened };
  } finally { fs.closeSync(fd); }
}
function capFor(name) { return name.endsWith("lib/typescript.js") ? 16 * MIB : name.endsWith("lib/_tsc.js") ? 8 * MIB : 2 * MIB; }
function record(read) { return { bytes: read.size, sha256: read.sha256 }; }
function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("incomplete_output_write");
    offset += count;
  }
}
function git(args, cap = 256 * 1024) {
  budget();
  return execFileSync("/usr/bin/git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd: ROOT, timeout: Math.min(5000, Math.max(1, Math.floor(deadline - performance.now()))), maxBuffer: cap,
    stdio: ["ignore", "pipe", "pipe"], env: {
      ...childEnv, PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1",
    },
  });
}
function commitIdentity(ref) {
  const commit = git(["rev-parse", "--verify", ref], 128).toString("utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("commit_identity_missing");
  // Read the stored header, not a shallow-history projection of parent hashes.
  const raw = git(["cat-file", "commit", commit], 64 * 1024).toString("utf8");
  const end = raw.indexOf("\n\n");
  if (end < 0) throw new Error("commit_header_missing");
  const header = raw.slice(0, end).split("\n");
  const trees = header.filter((line) => line.startsWith("tree ")).map((line) => line.slice(5));
  const parents = header.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7));
  if (trees.length !== 1 || parents.length < 1 || parents.length > 2 || ![...trees, ...parents].every((id) => /^[a-f0-9]{40}$/.test(id))) throw new Error("commit_identity_missing");
  return { commit, tree: trees[0], parents };
}
function nativeMetadata(directory) {
  budget();
  const current = fs.lstatSync(directory, { bigint: true });
  if (!current.isDirectory() || fs.realpathSync(directory) !== directory || current.dev !== nativeIdentity.dev || current.ino !== nativeIdentity.ino) throw new Error("native_directory_changed");
  const entries = [], handle = fs.opendirSync(directory);
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      if (entries.length === 3 || !Object.hasOwn(nativeLimits, entry.name)) throw new Error("native_name_or_cardinality_limit");
      const file = path.join(directory, entry.name), info = fs.lstatSync(file, { bigint: true });
      if (!info.isFile() || info.nlink !== 1n || fs.realpathSync(file) !== file || info.size > BigInt(nativeLimits[entry.name])) throw new Error("native_file_limit");
      entries.push({ name: entry.name, bytes: Number(info.size) });
    }
  } finally { handle.closeSync(); }
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function publishBoundedBit(file, initial) {
  budget();
  if (!sameStat(initial, fs.lstatSync(file, { bigint: true }))) throw new Error("github_output_changed");
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!sameStat(initial, fs.fstatSync(fd, { bigint: true }))) throw new Error("github_output_changed_on_open");
    writeAll(fd, Buffer.from("native_files_bounded=true\n"));
  } finally { fs.closeSync(fd); }
}

let logFd, traceDirectory, outputDirectory, githubOutput, outputIdentity, nativeIdentity, directoryIdentity;
let directoryCreated = false;
let retainedBytes = 0, captureError = null, nativeBounded = false;
const observedBytes = { stdout: 0, stderr: 0 };
const report = {
  proof: "NODEBENCH-GENERATED-API-RELATION-LIMIT-01", startedAt, status: "INCOMPLETE",
  causeStatus: "OPEN", appTypecheckPassed: false, traceJsonValidated: false,
  caps: { nativeFile: NATIVE_CAP, legend: 65536, combinedStream: LOG_CAP, receipt: RECEIPT_CAP, totalRaw: RAW_CAP },
  timing: { totalBudgetMs: 600000, shutdownReserveMs: 10000 },
  childEnvironmentKeys: Object.keys(childEnv),
};
function runCompiler(argv) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const child = spawn("/usr/bin/prlimit", argv, {
      cwd: ROOT, env: childEnv, signal: controller.signal, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stopped = null, spawnError = null, killError = null, finished = false, forceTimer, abandonTimer;
    const killGroup = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") killError = error.code || "kill_failed"; }
    };
    const finish = (code, signal, closeObserved) => {
      if (finished) return;
      finished = true;
      if (stopped) killGroup("SIGKILL");
      clearTimeout(timer); clearInterval(monitor); clearTimeout(forceTimer); clearTimeout(abandonTimer);
      process.removeListener("SIGTERM", onTerm); process.removeListener("SIGINT", onInt);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      resolve({ code, signal, closeObserved, stopped, spawnError, killError });
    };
    const stop = (reason) => {
      if (stopped || finished) return;
      stopped = reason; killGroup("SIGTERM"); controller.abort();
      forceTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
      abandonTimer = setTimeout(() => finish(null, null, false), 9000);
    };
    const onTerm = () => stop("SIGTERM"), onInt = () => stop("SIGINT");
    process.once("SIGTERM", onTerm); process.once("SIGINT", onInt);
    // Reserve time inside the600s total budget for owned-group shutdown/receipt.
    const timer = setTimeout(() => stop("timeout"), Math.max(0, deadline - performance.now() - 10000));
    const monitor = setInterval(() => {
      try { nativeMetadata(traceDirectory); } catch (error) { captureError ||= label(error); stop("native_file_failure"); }
    }, 250);
    for (const channel of ["stdout", "stderr"]) {
      child[channel].on("data", (chunk) => {
        observedBytes[channel] += chunk.length;
        const keep = Math.min(chunk.length, LOG_CAP - retainedBytes);
        try {
          if (keep && !captureError) { writeAll(logFd, chunk.subarray(0, keep)); retainedBytes += keep; }
          if (observedBytes.stdout + observedBytes.stderr > LOG_CAP) stop("stream_limit");
        } catch (error) { captureError ||= label(error); stop("output_write_failure"); }
        // Drain even after stop/cap; partial output never counts as parity.
      });
      child[channel].on("error", (error) => { captureError ||= label(error); stop("stream_failure"); });
    }
    child.on("error", (error) => { if (!(controller.signal.aborted && error.name === "AbortError")) spawnError = error.code || "spawn_failed"; });
    child.on("close", (code, signal) => finish(code, signal, true));
  });
}

let exitCode = 1;
try {
  if (process.platform !== "linux" || process.argv.length !== 2 || process.cwd() !== ROOT || fs.realpathSync(ROOT) !== ROOT) throw new Error("fixed_linux_checkout_required");
  const env = process.env, candidate = env.NODEBENCH_CANDIDATE_SHA, workflowSha = env.GITHUB_SHA;
  if (env.GITHUB_EVENT_NAME !== "pull_request" || env.NODEBENCH_EVENT_ACTION !== "synchronize" || env.NODEBENCH_PR_NUMBER !== "632" ||
      env.GITHUB_REPOSITORY !== REPOSITORY || env.NODEBENCH_HEAD_REPOSITORY !== REPOSITORY || env.NODEBENCH_HEAD_REF !== BRANCH || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^[a-f0-9]{40}$/.test(candidate || "") || !/^[a-f0-9]{40}$/.test(workflowSha || "")) throw new Error("one_attempt_scope_required");
  const temp = env.RUNNER_TEMP;
  if (!temp || !path.isAbsolute(temp) || fs.realpathSync(temp) !== temp || !fs.lstatSync(temp).isDirectory()) throw new Error("plain_runner_temp_required");
  outputDirectory = path.join(temp, "nodebench-app-typecheck-trace");
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  directoryCreated = true;
  directoryIdentity = fs.lstatSync(outputDirectory, { bigint: true });
  traceDirectory = path.join(outputDirectory, "native");
  fs.mkdirSync(traceDirectory, { mode: 0o700 });
  nativeIdentity = fs.lstatSync(traceDirectory, { bigint: true });
  logFd = fs.openSync(path.join(outputDirectory, "trace-compiler.log"), "wx", 0o600);
  githubOutput = env.GITHUB_OUTPUT;
  if (!githubOutput || path.dirname(githubOutput) !== path.join(temp, "_runner_file_commands") || !/^set_output_[a-f0-9-]+$/.test(path.basename(githubOutput)) || fs.realpathSync(githubOutput) !== githubOutput) throw new Error("fixed_github_output_required");
  outputIdentity = fs.lstatSync(githubOutput, { bigint: true });
  if (!outputIdentity.isFile() || outputIdentity.nlink !== 1n || outputIdentity.size > 65536n) throw new Error("github_output_not_bounded_regular");

  const candidateIdentity = commitIdentity(candidate), checkout = commitIdentity("HEAD");
  if (candidateIdentity.commit !== candidate || candidateIdentity.parents.length !== 1 || candidateIdentity.parents[0] !== BASE || checkout.commit !== workflowSha || checkout.tree !== candidateIdentity.tree) throw new Error("candidate_parent_or_checkout_tree_mismatch");
  report.identity = { candidate: candidateIdentity, checkout, workflowSha, nodeVersion: process.version };
  if (!process.version.startsWith("v22.")) throw new Error("supported_node22_required");
  const captureDirectory = path.join(temp, "nodebench-app-typecheck");
  if (fs.realpathSync(captureDirectory) !== captureDirectory || !fs.lstatSync(captureDirectory).isDirectory()) throw new Error("original_capture_not_plain");
  const captureFile = path.join(captureDirectory, "app-typecheck-diagnostics.log");
  const capture = stable(captureFile, LOG_CAP + RECEIPT_CAP, true);
  const prefix = Buffer.from("\n--- provenance ---\n"), suffix = Buffer.from("\n--- result ---\n");
  const firstEnd = capture.bytes.indexOf(10, prefix.length), lastStart = capture.bytes.lastIndexOf(suffix);
  if (!capture.bytes.subarray(0, prefix.length).equals(prefix) || firstEnd < 0 || lastStart <= firstEnd || firstEnd + 1 + capture.size - lastStart > RECEIPT_CAP) throw new Error("original_capture_metadata_missing");
  const provenance = JSON.parse(capture.bytes.subarray(prefix.length, firstEnd));
  const prior = JSON.parse(capture.bytes.subarray(lastStart + suffix.length));
  if (provenance.workflowSha !== workflowSha || provenance.checkoutCommit !== checkout.commit || provenance.checkoutTree !== checkout.tree || provenance.nodeVersion !== process.version ||
      JSON.stringify(provenance.command) !== JSON.stringify(originalCommand) || prior.compiler?.code !== 2 || prior.plannedCollectorExitCode !== 2 ||
      !prior.compiler.closeObserved || prior.compiler.stopped || prior.compiler.signal || prior.compiler.spawnError || prior.compiler.killError || prior.captureError || prior.truncated || !prior.postInputsVerified ||
      prior.retainedBytes !== lastStart - firstEnd - 1 || prior.observedBytes.stdout + prior.observedBytes.stderr !== prior.retainedBytes) throw new Error("complete_failed_app_capture_required");
  const capturedNames = [...generated.map((name) => `backend/convex/_generated/${name}`), "tsconfig.app.json", "backend/convex/tsconfig.json", ".github/workflows/ci.yml", "scripts/testing/captureAppTypecheck.mjs", "package.json", "node_modules/typescript/package.json", "node_modules/convex/package.json"];
  if (Object.keys(provenance.sourceHashes).length !== capturedNames.length || !capturedNames.every((name) => Object.hasOwn(provenance.sourceHashes, name))) throw new Error("original_capture_input_set_mismatch");
  const before = new Map(); report.inputs = {}; report.committedSources = {};
  for (const name of inputFiles) {
    const read = stable(path.join(ROOT, name), capFor(name), name.endsWith("package.json"));
    const pin = unchangedSource[name] || semanticPins[name];
    if (pin && read.sha256 !== pin) throw new Error("fixed_source_or_semantic_pin_mismatch");
    const captured = provenance.sourceHashes[name];
    if (captured && (captured.sha256 !== read.sha256 || captured.bytes !== read.size)) throw new Error("same_run_capture_input_changed");
    if (sourceFiles.includes(name)) {
      const committed = git(["show", `${candidate}:${name}`]);
      if (committed.length !== read.size || hash(committed) !== read.sha256) throw new Error("committed_source_mismatch");
      report.committedSources[name] = { ...record(read), gitBlob: createHash("sha1").update(`blob ${committed.length}\0`).update(committed).digest("hex") };
    }
    before.set(name, read); report.inputs[name] = record(read);
  }
  for (const name of generated) {
    const read = stable(path.join(captureDirectory, name), 2 * MIB);
    if (read.sha256 !== before.get(`backend/convex/_generated/${name}`).sha256) throw new Error("generated_snapshot_mismatch");
    before.set(`capture/${name}`, read);
  }
  report.versions = {};
  for (const [name, expected] of [["typescript", "5.9.3"], ["convex", "1.46.0"]]) {
    const key = `node_modules/${name}/package.json`, metadata = JSON.parse(before.get(key).bytes);
    if (metadata.name !== name || metadata.version !== expected || provenance.versions[key] !== expected) throw new Error("selected_package_version_mismatch");
    report.versions[name] = metadata.version;
  }
  const prlimit = stable("/usr/bin/prlimit", MIB);
  report.prlimit = { ...record(prlimit), requestedSoftBytes: NATIVE_CAP, requestedHardBytes: NATIVE_CAP, requestedCoreSoftBytes: 0, requestedCoreHardBytes: 0, enforcement: "prlimit sets both limits before exec; setup failure prevents the compiler invocation" };
  const node = fs.realpathSync(process.execPath);
  const argv = [`--fsize=${NATIVE_CAP}:${NATIVE_CAP}`, "--core=0:0", "--", node, "--max-old-space-size=4096", path.join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false", "--generateTrace", traceDirectory];
  report.command = ["/usr/bin/prlimit", ...argv];
  report.originalCapture = { ...record(capture), compilerExit: 2, collectorExit: 2, payloadBytes: prior.retainedBytes, postInputsVerified: true, truncated: false };
  report.timing.preflightElapsedMs = Math.round(performance.now() - started);
  const childStarted = performance.now();
  report.compiler = await runCompiler(argv);
  report.timing.childElapsedMs = Math.round(performance.now() - childStarted);
  const afterPrlimit = stable("/usr/bin/prlimit", MIB);
  if (afterPrlimit.sha256 !== prlimit.sha256 || !sameStat(afterPrlimit.identity, prlimit.identity)) throw new Error("prlimit_changed");
  for (const [name, previous] of before) {
    const file = name.startsWith("capture/") ? path.join(captureDirectory, name.slice(8)) : path.join(ROOT, name);
    const after = stable(file, capFor(name));
    if (after.sha256 !== previous.sha256 || !sameStat(after.identity, previous.identity)) throw new Error("post_trace_input_changed");
  }
  const afterCapture = stable(captureFile, LOG_CAP + RECEIPT_CAP);
  if (afterCapture.sha256 !== capture.sha256 || !sameStat(afterCapture.identity, capture.identity) || JSON.stringify(commitIdentity("HEAD")) !== JSON.stringify(checkout)) throw new Error("post_trace_capture_or_checkout_changed");
  report.postInputsVerified = true;
  if (!captureError && !report.compiler.stopped && !report.compiler.spawnError && !report.compiler.killError && !report.compiler.signal && report.compiler.closeObserved && [0, 2].includes(report.compiler.code)) {
    report.status = "RAW_CAPTURE_COMPLETE_JSON_UNREVIEWED";
    exitCode = report.compiler.code;
  }
} catch (error) { captureError ||= label(error); }
finally {
  const finalizationStarted = performance.now();
  report.timing.finalizationStartedMs = Math.round(finalizationStarted - started);
  if (logFd !== undefined) {
    try { fs.closeSync(logFd); } catch (error) { captureError ||= label(error); }
  }
  report.stream = { observedBytes, retainedBytes, truncated: observedBytes.stdout + observedBytes.stderr > retainedBytes };
  try {
    if (traceDirectory) {
      const entries = nativeMetadata(traceDirectory); report.nativeFiles = {};
      for (const entry of entries) report.nativeFiles[entry.name] = record(stable(path.join(traceDirectory, entry.name), nativeLimits[entry.name]));
      const nativeBytes = Object.values(report.nativeFiles).reduce((sum, file) => sum + file.bytes, 0);
      const log = stable(path.join(outputDirectory, "trace-compiler.log"), LOG_CAP);
      report.log = record(log); report.nativeBytes = nativeBytes;
      if (nativeBytes + log.size + RECEIPT_CAP > RAW_CAP) throw new Error("raw_total_limit");
      nativeBounded = entries.length > 0 && report.compiler?.closeObserved === true && !report.compiler.killError;
      if (!report.nativeFiles["trace.json"]?.bytes || !report.nativeFiles["types.json"]?.bytes) captureError ||= "native_trace_or_types_missing";
    }
  } catch (error) { captureError ||= label(error); nativeBounded = false; }
  try { budget(); } catch (error) { captureError ||= label(error); }
  if (captureError || report.stream.truncated || !report.postInputsVerified) { report.status = "INCOMPLETE"; exitCode = 1; }
  if (report.compiler?.stopped === "timeout" || captureError === "budget_exhausted") exitCode = 124;
  else if (report.compiler?.stopped === "SIGTERM") exitCode = 143;
  else if (report.compiler?.stopped === "SIGINT") exitCode = 130;
  // The output bit attests only to bounded native files, including bounded partials.
  // Publish it before the receipt so protocol failure can be recorded honestly.
  if (nativeBounded) {
    try { publishBoundedBit(githubOutput, outputIdentity); }
    catch (error) { captureError ||= label(error); report.status = "INCOMPLETE"; exitCode = 1; }
  }
  report.captureError = captureError; report.plannedCollectorExitCode = exitCode;
  report.nativeFilesBounded = nativeBounded; report.elapsedMs = Math.round(performance.now() - started);
  report.meaning = "Original App failure remains. Raw collection does not validate JSON, diagnostic parity, first cause, repair, or App success. Partial/cancelled/missing evidence is INCONCLUSIVE_STOP; no retry. Final console/process status also accounts for receipt-write failure.";
  let receiptWritten = false;
  report.timing.finalizationBeforeReceiptMs = Math.round(performance.now() - finalizationStarted);
  if (directoryCreated) {
    try {
      const bytes = Buffer.from(JSON.stringify(report) + "\n");
      if (bytes.length > RECEIPT_CAP) throw new Error("receipt_limit");
      const current = fs.lstatSync(outputDirectory, { bigint: true });
      if (!current.isDirectory() || fs.realpathSync(outputDirectory) !== outputDirectory || current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino) throw new Error("output_directory_changed");
      const fd = fs.openSync(path.join(outputDirectory, "trace-receipt.json"), "wx", 0o600);
      try { writeAll(fd, bytes); } finally { fs.closeSync(fd); }
      receiptWritten = true;
    } catch (error) { captureError = label(error); exitCode = 1; }
  }
  if (performance.now() >= deadline) { captureError ||= "budget_exhausted"; exitCode = 124; }
  console.log(JSON.stringify({ status: captureError ? "INCOMPLETE" : report.status, compilerExit: report.compiler?.code ?? null, collectorExitCode: exitCode, captureError, nativeFilesBounded: nativeBounded, receiptWritten, elapsedMs: Math.round(performance.now() - started), finalizationMs: Math.round(performance.now() - finalizationStarted), causeStatus: "OPEN", appTypecheckPassed: false }));
  process.exitCode = exitCode;
}
