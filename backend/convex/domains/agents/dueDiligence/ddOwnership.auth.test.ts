/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";

const DIR_SEGMENTS = ["domains", "agents", "dueDiligence"];
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
  Object.entries(import.meta.glob("../../../**/*.{ts,js}")).map(([key, loader]) => [
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

const ddInternal = (internal as any).domains.agents.dueDiligence.ddMutations;
const ddOrchestratorInternal = (internal as any).domains.agents.dueDiligence.ddOrchestrator;
const ddEnhancedInternal = (internal as any).domains.agents.dueDiligence.ddEnhancedOrchestrator;
const encounterApi = (api as any).domains.operations.encounters.encounterCapture;

async function seedOwners(t: any) {
  return t.run(async (ctx: any) => {
    const ownerA = await ctx.db.insert("users", { email: "dd-owner-a@example.com" });
    const ownerB = await ctx.db.insert("users", { email: "dd-owner-b@example.com" });
    return { ownerA, ownerB };
  });
}

describe.skipIf(!convexTestAvailable)("core due-diligence ownership", () => {
  it("isolates same-entity dedupe, job detail, branches, and lists by owner", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA, ownerB } = await seedOwners(t);
    const common = {
      entityName: "Shared Name Labs",
      entityType: "company" as const,
      triggerSource: "manual" as const,
    };

    const jobA = await t.mutation(ddInternal.createDDJobInternal, {
      ...common,
      userId: ownerA,
    });
    const jobB = await t.mutation(ddInternal.createDDJobInternal, {
      ...common,
      userId: ownerB,
    });
    const jobAAgain = await t.mutation(ddInternal.createDDJobInternal, {
      ...common,
      userId: ownerA,
    });

    expect(jobA.existing).toBe(false);
    expect(jobB.existing).toBe(false);
    expect(jobB.jobId).not.toBe(jobA.jobId);
    expect(jobAAgain).toEqual({ jobId: jobA.jobId, existing: true });

    await t.run(async (ctx: any) => {
      await ctx.db.insert("ddResearchBranches", {
        jobId: jobA.jobId,
        branchId: "owner-a-branch",
        branchType: "company_profile",
        status: "completed",
        findingsSummary: "Owner A private findings",
        createdAt: Date.now(),
      });
    });

    await expect(t.query(ddInternal.getDDJobDetailInternal, {
      jobId: jobA.jobId,
      userId: ownerB,
    })).rejects.toThrow(/not found|unauthorized/i);
    await expect(t.query(ddInternal.getDDJobInternal, {
      jobId: jobA.jobId,
      userId: ownerB,
    })).rejects.toThrow(/not found|unauthorized/i);

    const detailA = await t.query(ddInternal.getDDJobDetailInternal, {
      jobId: jobA.jobId,
      userId: ownerA,
    });
    expect(detailA.job.userId).toBe(ownerA);
    expect(detailA.branches).toHaveLength(1);
    expect(detailA.branches[0].findingsSummary).toBe("Owner A private findings");

    const listA = await t.query(ddInternal.getUserDDJobsInternal, { userId: ownerA });
    const listB = await t.query(ddInternal.getUserDDJobsInternal, { userId: ownerB });
    expect(listA.map((job: any) => job.jobId)).toEqual([jobA.jobId]);
    expect(listB.map((job: any) => job.jobId)).toEqual([jobB.jobId]);
  });

  it("denies guest and cross-owner access at the reachable encounter DD entrypoint", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA, ownerB } = await seedOwners(t);
    const encounterId = await t.run(async (ctx: any) => {
      const now = Date.now();
      return ctx.db.insert("encounterEvents", {
        userId: ownerA,
        sourceType: "web_ui",
        rawText: "Met Shared Name Labs",
        title: "Shared Name Labs encounter",
        participants: [],
        companies: [{ name: "Shared Name Labs", confidence: 1 }],
        researchStatus: "none",
        followUpRequested: false,
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    const args = {
      encounterId,
      entityName: "Shared Name Labs",
      entityType: "company" as const,
    };

    await expect(t.action(encounterApi.triggerDeepDiveFromEncounter, args))
      .rejects.toThrow(/not authenticated/i);
    await expect(t.withIdentity({ subject: String(ownerB) })
      .action(encounterApi.triggerDeepDiveFromEncounter, args))
      .rejects.toThrow(/not found|not authorized/i);

    const stored = await t.run(async (ctx: any) => ctx.db.get(encounterId));
    expect(stored.researchStatus).toBe("none");
    expect(stored.ddJobId).toBeUndefined();
  });

  it("starts tiered DD with execution options without leaking them into the job mutation", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA } = await seedOwners(t);

    const started = await t.action(ddOrchestratorInternal.startDueDiligenceJobInternal, {
      entityName: "Runtime Contract Labs",
      entityType: "company",
      triggerSource: "manual",
      userId: ownerA,
      ddTier: "FAST_VERIFY",
      branchOverride: ["company_profile"],
      riskScore: 0.42,
      escalationTriggers: ["material contradiction"],
      microBranches: ["website_verify"],
    });

    expect(started).toMatchObject({
      status: "started",
      tier: "FAST_VERIFY",
      microBranchCount: 1,
    });
    const stored = await t.run(async (ctx: any) => ctx.db
      .query("dueDiligenceJobs")
      .withIndex("by_jobId", (q: any) => q.eq("jobId", started.jobId))
      .first());
    expect(stored).toMatchObject({
      userId: ownerA,
      entityName: "Runtime Contract Labs",
      status: "pending",
    });
  });

  it("rejects wrong-owner executors without changing the victim job or scratchpad", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA, ownerB } = await seedOwners(t);
    const job = await t.mutation(ddInternal.createDDJobInternal, {
      entityName: "Victim Labs",
      entityType: "company",
      triggerSource: "manual",
      userId: ownerA,
    });

    await expect(t.action(ddOrchestratorInternal.executeDDJob, {
      jobId: job.jobId,
      userId: ownerB,
    })).rejects.toThrow(/not found|unauthorized/i);
    await expect(t.action(ddEnhancedInternal.executeEnhancedDDJob, {
      jobId: job.jobId,
      userId: ownerB,
      enableHandoffs: false,
      enableEntityMemory: false,
      enableGuardrails: false,
      existingFacts: [],
    })).rejects.toThrow(/not found|unauthorized/i);

    const stored = await t.run(async (ctx: any) => {
      const victimJob = await ctx.db
        .query("dueDiligenceJobs")
        .withIndex("by_jobId", (q: any) => q.eq("jobId", job.jobId))
        .first();
      const scratchpads = await ctx.db.query("agentScratchpads").collect();
      return { victimJob, scratchpads };
    });
    expect(stored.victimJob).toMatchObject({
      userId: ownerA,
      status: "pending",
    });
    expect(stored.victimJob.error).toBeUndefined();
    expect(stored.scratchpads).toHaveLength(0);
  });
});
