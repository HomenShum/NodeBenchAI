import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  launchContractFiles,
  resolveInteractiveGotoTimeoutMs,
  resolveInteractiveWaitUntil,
  summarizePackageScriptContractEvidence,
} from "./scanLaunch.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("Scenario: a launch operator scans the migrated ScratchNode release tree", () => {
  it("resolves every required UI and goal artifact from its canonical location", () => {
    expect(launchContractFiles).toMatchObject({
      wikiBridgeSpec: "apps/web/src/features/events/views/ScratchnodeWikiBridge.test.tsx",
      eventHandoffGoal: "adw/goals/nodebench/001-event-handoff.md",
      boundaryGoal: "adw/goals/scratchnode/003-privacy-boundary-honesty-gates.md",
    });

    const missing = Object.values(launchContractFiles).filter(
      (relativePath) => !existsSync(resolve(repoRoot, relativePath)),
    );
    expect(missing).toEqual([]);
  });
});

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
