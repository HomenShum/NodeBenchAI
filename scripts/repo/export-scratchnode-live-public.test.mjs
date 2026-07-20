// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { copyEntries, forbiddenRelativePaths } from "./export-scratchnode-live-public.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("Scenario: a release engineer exports ScratchNode after the standard-tree migration", () => {
  it("copies every allowlisted contract from a source path that exists in a clean checkout", () => {
    const missingSources = copyEntries
      .map(([source]) => source)
      .filter((source) => !existsSync(resolve(repoRoot, source)));

    expect(copyEntries).toEqual(
      expect.arrayContaining([
        ["apps/web/src/shared/agentOutputContract.ts", "contracts/agentOutputContract.ts"],
        ["apps/web/src/shared/riskAttackEvaluator.ts", "contracts/riskAttackEvaluator.ts"],
      ]),
    );
    expect(missingSources).toEqual([]);
  });

  it("continues to reject both current and legacy private-backend layouts", () => {
    expect(forbiddenRelativePaths).toEqual(expect.arrayContaining(["backend", "convex"]));
  });
});
