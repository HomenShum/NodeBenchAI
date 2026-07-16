/// <reference types="vite/client" />

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../../../_generated/api";
import schema from "../../../../schema";

const DIR_SEGMENTS = ["domains", "agents", "dueDiligence", "investorProtection"];
function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}

const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../../**/*.{ts,js}")).map(([key, loader]) => [
    rerootGlobKey(key),
    loader,
  ]),
);

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const investorProtectionInternal = (internal as any).domains.agents.dueDiligence
  .investorProtection.investorProtectionMutations;
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("due-diligence adjacent public-surface guard", () => {
  it("keeps demo, eval, and private-result surfaces off the public Convex API", () => {
    for (const path of [
      "convex/domains/agents/dueDiligence/deepResearch/deepResearchOrchestrator.ts",
      "convex/domains/agents/dueDiligence/investorPlaybook/agenticPlaybook.ts",
      "convex/domains/agents/dueDiligence/investorPlaybook/evalPlaybook.ts",
      "convex/domains/agents/dueDiligence/investorPlaybook/playbookActions.ts",
      "convex/domains/agents/dueDiligence/investorPlaybook/playbookMutations.ts",
      "convex/domains/agents/dueDiligence/investorProtection/investorProtectionMutations.ts",
      "convex/domains/agents/dueDiligence/investorProtection/investorProtectionOrchestrator.ts",
    ]) {
      expect(read(path)).not.toMatch(
        /export const \w+\s*=\s*(?:action|query|mutation)\(/,
      );
    }

    for (const removedPath of [
      "convex/domains/agents/dueDiligence/investorPlaybook/agenticTest.ts",
      "scripts/eval-investor-playbook.ts",
      "scripts/test-deep-research-live.ts",
    ]) {
      expect(existsSync(resolve(process.cwd(), removedPath))).toBe(false);
    }

    const generatedApi = read("convex/_generated/api.d.ts");
    const barrel = read("convex/domains/agents/dueDiligence/index.ts");
    expect(generatedApi).not.toContain("investorPlaybook/agenticTest");
    expect(barrel).not.toMatch(
      /\b(?:startVerificationJob|startDeepResearch|getInvestorProtectionJob|getPlaybookResultByEntity|runAgenticDueDiligence)\b/,
    );
  });

  it("requires owner binding before retained investor-protection writes", () => {
    const mutations = read(
      "convex/domains/agents/dueDiligence/investorProtection/investorProtectionMutations.ts",
    );
    const orchestrator = read(
      "convex/domains/agents/dueDiligence/investorProtection/investorProtectionOrchestrator.ts",
    );
    const saveResultStart = mutations.indexOf("export const internalSaveResult");
    const saveResultEnd = mutations.indexOf("// CACHE OPERATIONS", saveResultStart);
    const saveResult = mutations.slice(saveResultStart, saveResultEnd);

    expect(mutations).toContain("assertInvestorProtectionJobOwner(job, userId, jobId)");
    expect(saveResult).toContain("const job = await getOwnedJob(ctx, args.jobId, args.userId)");
    expect(saveResult.indexOf("getOwnedJob")).toBeLessThan(
      saveResult.indexOf('ctx.db.insert("investorPlaybookResults"'),
    );
    expect(orchestrator).toContain("export const startVerificationJob = internalAction");
    expect(orchestrator.match(/userId: args\.userId/g)?.length).toBeGreaterThanOrEqual(15);
  });
});

describe.skipIf(!convexTestAvailable)("investor-protection exact internal ownership", () => {
  it("rejects a cross-owner job update while allowing the exact owner", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA, ownerB } = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "ip-owner-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "ip-owner-b@example.com" });
      await ctx.db.insert("investorPlaybookJobs", {
        jobId: "ip-owner-a-job",
        userId: ownerA,
        offeringName: "Private offering",
        status: "pending",
        createdAt: 1_700_000_000_000,
      });
      return { ownerA, ownerB };
    });

    await expect(t.mutation(investorProtectionInternal.internalUpdateJobStatus, {
      jobId: "ip-owner-a-job",
      userId: ownerB,
      status: "extracting_claims",
    })).rejects.toThrow(/owner mismatch/i);

    await t.mutation(investorProtectionInternal.internalUpdateJobStatus, {
      jobId: "ip-owner-a-job",
      userId: ownerA,
      status: "extracting_claims",
    });

    const stored = await t.run(async (ctx: any) => ctx.db
      .query("investorPlaybookJobs")
      .withIndex("by_jobId", (q: any) => q.eq("jobId", "ip-owner-a-job"))
      .first());
    expect(stored?.status).toBe("extracting_claims");
  });
});
