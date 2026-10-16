/// <reference types="vite/client" />
/**
 * Public queue boundaries reject an unknown model id at the call, not later (SPEC-v9 A.0.10).
 *
 * Persona: a signed-in user (or a stale client) clicks "Score with LLM", or starts a coordinator run, with a
 * model id nobody registered ("constructor"). Before this change both calls answered "queued" / a run id and
 * the run failed closed minutes later in getLanguageModelSafe: nothing was spent, but the caller was told yes.
 */

import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { api } from "../../_generated/api";

const DIR_SEGMENTS = ["domains", "product"];
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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [rerootGlobKey(key), loader]),
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

const scheduledCount = (t: any) => t.run(async (ctx: any) => (await ctx.db.system.query("_scheduled_functions").collect()).length);

describe.skipIf(!convexTestAvailable)("requestLlmJudge model boundary", () => {
  it("rejects an unknown modelName before scheduling, and still queues an omitted or known one", async () => {
    const t = convexTest(schema, convexModules);
    const { userId, verdictId } = await t.run(async (ctx: any) => {
      const userId = await ctx.db.insert("users", { email: "judge-boundary@example.com" });
      const now = Date.now();
      const telemetryId = await ctx.db.insert("diligenceRunTelemetry", {
        entitySlug: "acme",
        ownerKey: `user:${String(userId)}`,
        blockType: "overview",
        scratchpadRunId: "run-1",
        version: 1,
        overallTier: "pass",
        headerText: "h",
        status: "done",
        startedAt: now,
        endedAt: now,
        elapsedMs: 0,
      });
      const verdictId = await ctx.db.insert("diligenceJudgeVerdicts", {
        telemetryId,
        entitySlug: "acme",
        ownerKey: `user:${String(userId)}`,
        blockType: "overview",
        scratchpadRunId: "run-1",
        verdict: "pass",
        passCount: 1,
        failCount: 0,
        skipCount: 0,
        score: 1,
        latencyBudgetMs: 1000,
        gatesJson: "[]",
        judgedAt: Date.now(),
      });
      return { userId, verdictId };
    });
    const user = t.withIdentity({ subject: String(userId) });
    const request = api.domains.product.diligenceLlmJudgeRuns.requestLlmJudge;

    for (const modelName of ["constructor", "gpt-9-ultra"]) {
      await expect(user.mutation(request, { verdictId, modelName }), modelName).rejects.toThrow(/Unknown model/);
    }
    expect(await scheduledCount(t)).toBe(0);

    await expect(user.mutation(request, { verdictId })).resolves.toEqual({ status: "queued" });
    await expect(user.mutation(request, { verdictId, modelName: "gpt-5.4-mini" })).resolves.toEqual({ status: "queued" });
    expect(await scheduledCount(t)).toBe(2);
  }, 20_000);
});

describe.skipIf(!convexTestAvailable)("startCoordinatorWorkflow model boundary", () => {
  it("rejects an unknown model before anything is queued", async () => {
    const t = convexTest(schema, convexModules);
    for (const model of ["constructor", "gpt-9-ultra"]) {
      await expect(
        t.action(api.actions.coordinatorWorkflowActions.startCoordinatorWorkflow, { threadId: "t1", prompt: "go", model }),
        model,
      ).rejects.toThrow(/Unknown model/);
    }
    expect(await scheduledCount(t)).toBe(0);
  }, 20_000);
});
