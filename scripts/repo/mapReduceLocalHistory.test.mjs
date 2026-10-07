import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const reviewDir = path.join(repoRoot, ".tmp", "scratchnode-aesthetic-review");
const reviewPath = path.join(reviewDir, "aesthetic-review-summary.json");
const reportPath = path.join(repoRoot, ".tmp", "local-history-map-reduce.json");
const backupRoot = path.join(os.tmpdir(), "nodebench-map-reduce-local-history-test");

function runScript(args = []) {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/repo/mapReduceLocalHistory.ps1",
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(fs.readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
}

function ensureBackupRoot() {
  fs.mkdirSync(backupRoot, { recursive: true });
}

function cleanupPath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function restoreBackup(backupPath) {
  cleanupPath(reviewDir);
  if (!backupPath) return;
  fs.mkdirSync(path.dirname(reviewDir), { recursive: true });
  fs.cpSync(backupPath, reviewDir, { recursive: true });
}

afterEach(() => {
  cleanupPath(backupRoot);
});

describe("mapReduceLocalHistory", () => {
  it("keeps the ScratchNode aesthetic review tmp directory out of safe cleanup", () => {
    ensureBackupRoot();
    const backupPath = fs.existsSync(reviewDir) ? path.join(backupRoot, "review-backup") : null;
    if (backupPath) {
      fs.cpSync(reviewDir, backupPath, { recursive: true });
    }

    cleanupPath(reviewDir);
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      reviewPath,
      `${JSON.stringify({ passed: null, judgeSkipped: "artifact-only" })}\n`,
      "utf8",
    );

    try {
      const beforeApply = runScript();
      expect(beforeApply.buckets.safe.map((entry) => entry.path)).not.toContain(".tmp\\scratchnode-aesthetic-review");

      const afterApply = runScript(["-ApplySafe"]);
      expect(afterApply.actions.removedSafe).not.toContain(".tmp\\scratchnode-aesthetic-review");
      expect(fs.existsSync(reviewPath)).toBe(true);
      expect(afterApply.buckets.safe.map((entry) => entry.path)).not.toContain(".tmp\\scratchnode-aesthetic-review");
    } finally {
      restoreBackup(backupPath);
    }
  });
});
