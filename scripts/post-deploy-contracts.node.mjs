import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const workflow = read(".github/workflows/post-deploy-verify.yml").replaceAll("\r\n", "\n");

test("the verifier installs only its locked toolchain with lifecycle scripts enabled", () => {
  const manifest = JSON.parse(read("scripts/post-deploy-deps/package.json"));
  const lock = JSON.parse(read("scripts/post-deploy-deps/package-lock.json"));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["@playwright/test", "tsx"]);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.ok(path === "" || path.startsWith("node_modules/"), `unexpected package path: ${path}`);
    assert.ok(!entry.link, `local package link: ${path}`);
    assert.ok(!String(entry.resolved).startsWith("file:"), `local package source: ${path}`);
  }
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
  // Generating a lock beside an existing install can drop other OS binaries.
  // CI runs on Linux even when this lock is refreshed on Windows or macOS.
  for (const name of Object.keys(lock.packages["node_modules/esbuild"].optionalDependencies)) {
    assert.ok(lock.packages[`node_modules/${name}`], `missing platform package: ${name}`);
  }
  assert.equal(Object.keys(lock.packages).some((name) => name.includes("ffmpeg-static")), false);
  assert.ok(!workflow.includes("--ignore-scripts"));
  assert.ok(!workflow.includes("continue-on-error"));
  assert.ok(workflow.includes("npx playwright install chromium --with-deps"));
});

// Execute the actual install block under the same fail-fast Bash options as
// Actions. npm/ln are intercepted here, so no package install or link is made.
const install = workflow.match(/- name: Install verification dependencies\n\s+run: \|\n((?:          .*\n)+)/)?.[1];
assert.ok(install, "the verification install block must exist");
const bash = process.platform === "win32"
  ? process.env.GIT_BASH || "C:/Program Files/Git/bin/bash.exe"
  : "bash";

test("an install failure fails the workflow step before exposing dependencies", () => {
  const result = spawnSync(bash, ["--noprofile", "--norc", "-eo", "pipefail", "-c", `
    npm() { return 23; }
    ln() { echo UNEXPECTED_LINK; }
    ${install}
  `], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stdout, "");
});

test("a successful install exposes exactly the isolated modules to existing commands", () => {
  const result = spawnSync(bash, ["--noprofile", "--norc", "-eo", "pipefail", "-c", `
    npm() { printf '%s\\n' "$*"; }
    ln() { [ "$1" = "-s" ] && [ "$2" = "$PWD/scripts/post-deploy-deps/node_modules" ] && [ "$3" = "node_modules" ]; }
    ${install}
  `], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ci --prefix scripts/post-deploy-deps --no-audit --no-fund");
});

// Run the real orchestration in fresh processes. Intercept only HTTP and child
// commands: these fixtures establish exit/skip semantics, not live app health.
const fixtureDir = mkdtempSync(join(tmpdir(), "nodebench-post-deploy-contracts-"));
const preload = join(fixtureDir, "preload.mjs");
after(() => {
  unlinkSync(preload);
  rmdirSync(fixtureDir);
});
writeFileSync(preload, `
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  globalThis.fetch = async () => new Response(
    process.env.SCENARIO === "html-shell" ? "not an app" : '<html><div id="root"></div><script src="/assets/index-fixture.js"></script></html>'
  );
  childProcess.spawnSync = (command, args) => {
    const raw = args.some(arg => String(arg).includes("verify-live.ts"));
    const smoke = args.some(arg => String(arg).includes("live-smoke"));
    if (!raw && !smoke) throw new Error("Unexpected verifier child");
    const stage = raw ? "verify-live" : "live-smoke";
    return { status: process.env.SCENARIO === stage ? 7 : 0, stdout: stage, stderr: "" };
  };
  syncBuiltinESMExports();
`);

function runVerifier(scenario, args = []) {
  const result = spawnSync(process.execPath, [
    "--import", pathToFileURL(preload).href,
    fileURLToPath(new URL("scripts/post-deploy-verify.mjs", root)),
    "--json", ...args,
  ], {
    encoding: "utf8",
    env: { ...process.env, SCENARIO: scenario, VERCEL_AUTOMATION_BYPASS_SECRET: "", ALLOW_PROTECTED_PREVIEW_SKIP: "false" },
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return { ...result, report: JSON.parse(result.stdout) };
}

const stages = ["html-shell", "verify-live", "live-smoke"];
test("success requires all three production verification stages", () => {
  const result = runVerifier("success");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.failed, 0);
  assert.deepEqual(result.report.results.map(({ id }) => id), stages);
  assert.ok(result.report.results.every((entry) => entry.ok && !entry.skipped));
});

for (const [index, stage] of stages.entries()) {
  test(`${stage} failure exits nonzero and stops subsequent stages`, () => {
    const result = runVerifier(stage);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.report.failed, 1);
    assert.equal(result.report.firstFailure.id, stage);
    assert.deepEqual(result.report.results.map(({ id }) => id), stages.slice(0, index + 1));
    assert.ok(result.report.results.every((entry) => !entry.skipped));
  });
}

test("a protected preview only skips with explicit preview authorization", () => {
  const args = ["--url=https://fixture.vercel.app"];
  const denied = runVerifier("html-shell", args);
  assert.equal(denied.status, 1);
  const allowed = runVerifier("html-shell", [...args, "--allow-protected-preview-skip"]);
  assert.equal(allowed.status, 0);
  assert.equal(allowed.report.results.length, 3);
  assert.ok(allowed.report.results.every((entry) => entry.skipped));
  const production = runVerifier("html-shell", ["--url=https://www.nodebenchai.com", "--allow-protected-preview-skip"]);
  assert.equal(production.status, 1);
});

test("workflow retains production checks, result upload and deployment-only rollback", () => {
  assert.ok(workflow.includes('URL="https://www.nodebenchai.com"'));
  assert.ok(workflow.includes("node scripts/post-deploy-verify.mjs --url=${{ steps.url.outputs.url }} --json > post-deploy-result.json"));
  const rollback = workflow.split("- name: Roll back Vercel production deploy")[1].split("- name: Upload result")[0];
  assert.ok(rollback.includes("failure() &&"));
  assert.ok(rollback.includes("github.event_name == 'deployment_status' &&"));
  assert.ok(rollback.includes("github.event.deployment.environment == 'Production'"));
  assert.ok(rollback.includes("github.event.deployment.environment == 'production'"));
  assert.match(workflow, /- name: Upload result\n\s+if: always\(\)/);
});
