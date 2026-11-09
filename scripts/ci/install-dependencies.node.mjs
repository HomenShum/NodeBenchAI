import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const action = read(".github/actions/install-dependencies/action.yml");
const script = action.split("      run: |\n")[1]?.replace(/^        /gm, "");
assert.ok(script, "execute the composite action's actual install program");
const bash = process.platform === "win32" ? process.env.GIT_BASH || "C:/Program Files/Git/bin/bash.exe" : "bash";
const shellPath = (path) => path.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function scenario(mode) {
  const directory = mkdtempSync(join(tmpdir(), "nodebench-ci-install-"));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")));
  const logPath = join(directory, "calls");
  const envPath = join(directory, "github-env");
  const binary = join(directory, "ffmpeg");
  writeFileSync(logPath, "");
  writeFileSync(envPath, "");
  writeFileSync(binary, `#!/usr/bin/env bash
set -eu
if [ "$1" = "-version" ]; then
  echo version >> "$TEST_LOG"
  [ "$MODE" != broken ] || exit 17
  exit 0
fi
for output in "$@"; do :; done
if [[ "$output" == *.mp4 ]]; then
  echo encode >> "$TEST_LOG"
  [ "$MODE" != encoder-failure ] || exit 18
else
  echo extract >> "$TEST_LOG"
  [ "$MODE" != extraction-failure ] || exit 20
fi
[ "$MODE" != empty-output ] || exit 0
printf 'fixture media' > "$output"
`);
  chmodSync(binary, 0o755);
  // npm, apt and module binding are intercepted; filesystem/probe control flow
  // is real. Hosted CI separately exercises the genuine package and codecs.
  const harness = `
command() {
  if [ "$*" = "-v ffmpeg" ]; then
    if [[ "$MODE" == missing || "$MODE" == apt-failure ]]; then
      [ -f "$RUNNER_TEMP/apt-installed" ] || return 1
    fi
    if [ "$MODE" = invalid-path ]; then printf '/missing/ffmpeg'; else printf '%s' "$TEST_BINARY"; fi
    return 0
  fi
  builtin command "$@"
}
sudo() {
  printf 'apt %s\\n' "$*" >> "$TEST_LOG"
  [ "$MODE" != apt-failure ] || return 19
  touch "$RUNNER_TEMP/apt-installed"
}
npm() {
  printf 'npm %s\\n' "$*" >> "$TEST_LOG"
  [ "$FFMPEG_BIN" = "$TEST_BINARY" ] || return 24
  [ "$MODE" != npm-failure ] || return 23
}
node() {
  echo binding >> "$TEST_LOG"
  [ "$MODE" != binding-failure ] || return 25
}
${script}`;
  try {
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", harness], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, MODE: mode, TEST_LOG: shellPath(logPath), TEST_BINARY: shellPath(binary), RUNNER_TEMP: shellPath(directory), GITHUB_ENV: shellPath(envPath) },
    });
    assert.ifError(result.error);
    assert.equal(readdirSync(directory).some((name) => name.startsWith("nodebench-ffmpeg.")), false, "probe files must be cleaned on success and failure");
    return { code: result.status, stderr: result.stderr, calls: readFileSync(logPath, "utf8"), published: readFileSync(envPath, "utf8"), binary: shellPath(binary) };
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test("existing FFmpeg is probed, used by npm and persisted for later runtime imports", () => {
  const result = scenario("success");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.calls, "version\nencode\nextract\nnpm install --no-audit --no-fund\nbinding\n");
  assert.equal(result.published, `FFMPEG_BIN=${result.binary}\n`);
});

test("a missing FFmpeg is installed through apt before the same probes", () => {
  const result = scenario("missing");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.calls, /^apt apt-get -o Acquire::Retries=3 update\napt apt-get -o Acquire::Retries=3 install --yes --no-install-recommends ffmpeg\nversion/);
  assert.equal(result.published, `FFMPEG_BIN=${result.binary}\n`);
});

for (const [mode, code] of [["apt-failure", 19], ["invalid-path", 1], ["broken", 17], ["encoder-failure", 18], ["extraction-failure", 20], ["empty-output", 1]]) {
  test(`${mode} fails before npm and before publishing a runtime override`, () => {
    const result = scenario(mode);
    assert.equal(result.code, code, result.stderr);
    assert.ok(!result.calls.includes("npm "));
    assert.equal(result.published, "");
  });
}

for (const [mode, code] of [["npm-failure", 23], ["binding-failure", 25]]) {
  test(`${mode} remains fatal and does not publish an unverified override`, () => {
    const result = scenario(mode);
    assert.equal(result.code, code, result.stderr);
    assert.equal(result.published, "");
  });
}

test("all six affected installs share the action without changing lifecycle or gate policy", () => {
  for (const [path, count] of [["ci.yml", 4], ["vercel-preflight.yml", 1], ["tier-b-preview.yml", 1]]) {
    const workflow = read(`.github/workflows/${path}`);
    assert.equal(workflow.split("uses: ./.github/actions/install-dependencies").length - 1, count);
  }
  assert.ok(action.includes('require("ffmpeg-static"), process.env.FFMPEG_BIN'));
  assert.ok(!action.includes("--ignore-scripts"));
  assert.ok(!action.includes("|| true"));
  assert.ok(!action.includes("continue-on-error"));
});
