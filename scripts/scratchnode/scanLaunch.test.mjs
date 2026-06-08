import { describe, expect, it } from "vitest";

import {
  resolveInteractiveGotoTimeoutMs,
  resolveInteractiveWaitUntil,
  summarizePackageScriptContractEvidence,
} from "./scanLaunch.mjs";

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

describe("resolveInteractiveGotoTimeoutMs", () => {
  it("keeps the default navigation budget for ordinary interactive checks", () => {
    expect(
      resolveInteractiveGotoTimeoutMs("https://scratchnode.live/", {
        defaultTimeoutMs: 20_000,
        slowRouteTimeoutMs: 35_000,
      }),
    ).toBe(20_000);
  });

  it("allows the known cold-loading NodeBench handoff route more time", () => {
    expect(
      resolveInteractiveGotoTimeoutMs("https://nodebenchai.com/scratchnode-events", {
        defaultTimeoutMs: 20_000,
        slowRouteTimeoutMs: 35_000,
      }),
    ).toBe(35_000);
  });
});

describe("resolveInteractiveWaitUntil", () => {
  it("waits for DOMContentLoaded on ordinary interactive checks", () => {
    expect(resolveInteractiveWaitUntil("https://scratchnode.live/")).toBe("domcontentloaded");
  });

  it("uses commit readiness for the known slow NodeBench handoff route", () => {
    expect(resolveInteractiveWaitUntil("https://nodebenchai.com/scratchnode-events")).toBe("commit");
  });
});
