import { describe, expect, it } from "vitest";

import { summarizePackageScriptContractEvidence } from "./scanLaunch.mjs";

describe("summarizePackageScriptContractEvidence", () => {
  it("passes when required automation scripts still point at the expected targets", () => {
    const summary = summarizePackageScriptContractEvidence(
      JSON.stringify({
        scripts: {
          "repo:augment:check": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/repo/checkAugmentUploadScope.ps1",
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      }),
      {
        "repo:augment:check": "scripts/repo/checkAugmentUploadScope.ps1",
        "scratchnode:launch:goal": "scripts/scratchnode/runLaunchGoalLoop.mjs",
      },
    );

    expect(summary).toEqual([
      {
        scriptName: "repo:augment:check",
        ok: true,
        detail: "scripts/repo/checkAugmentUploadScope.ps1",
      },
      {
        scriptName: "scratchnode:launch:goal",
        ok: true,
        detail: "scripts/scratchnode/runLaunchGoalLoop.mjs",
      },
    ]);
  });

  it("fails closed when a required script is missing or repointed", () => {
    const summary = summarizePackageScriptContractEvidence(
      JSON.stringify({
        scripts: {
          "repo:augment:check": "node scripts/repo/some-other-check.mjs",
        },
      }),
      {
        "repo:augment:check": "scripts/repo/checkAugmentUploadScope.ps1",
        "scratchnode:launch:goal": "scripts/scratchnode/runLaunchGoalLoop.mjs",
      },
    );

    expect(summary).toEqual([
      {
        scriptName: "repo:augment:check",
        ok: false,
        detail: "expected target=scripts/repo/checkAugmentUploadScope.ps1; actual=node scripts/repo/some-other-check.mjs",
      },
      {
        scriptName: "scratchnode:launch:goal",
        ok: false,
        detail: "missing script; expected target=scripts/scratchnode/runLaunchGoalLoop.mjs",
      },
    ]);
  });
});
