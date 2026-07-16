/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";

const DIR_SEGMENTS = ["domains", "operations", "taskManager"];
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

const taskMutations = (api as any).domains.taskManager.mutations;
const taskQueries = (api as any).domains.taskManager.queries;
const serviceMutations = (internal as any).domains.operations.taskManager.mutations;
const NOW = 1_700_000_000_000;

async function seedOwners(t: any) {
  return t.run(async (ctx: any) => {
    const ownerA = await ctx.db.insert("users", { email: "task-owner-a@example.com" });
    const ownerB = await ctx.db.insert("users", { email: "task-owner-b@example.com" });
    const sessionA = await ctx.db.insert("agentTaskSessions", {
      title: "Owner A cron",
      type: "cron",
      visibility: "private",
      userId: ownerA,
      status: "running",
      startedAt: NOW,
      cronJobName: "owner-a-cron",
    });
    const sessionB = await ctx.db.insert("agentTaskSessions", {
      title: "Owner B cron",
      type: "cron",
      visibility: "private",
      userId: ownerB,
      status: "completed",
      startedAt: NOW - 1_000,
      cronJobName: "owner-b-cron",
    });
    const ownerless = await ctx.db.insert("agentTaskSessions", {
      title: "Legacy ownerless cron",
      type: "cron",
      visibility: "public",
      status: "completed",
      startedAt: NOW - 2_000,
      cronJobName: "legacy-cron",
    });
    const traceA = await ctx.db.insert("agentTaskTraces", {
      sessionId: sessionA,
      traceId: "trace-owner-a",
      workflowName: "Owner A workflow",
      status: "running",
      startedAt: NOW,
    });
    return { ownerA, ownerB, ownerless, sessionA, sessionB, traceA };
  });
}

describe.skipIf(!convexTestAvailable)("task-manager owner isolation", () => {
  it("rejects anonymous and cross-owner public writes", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await seedOwners(t);
    const args = { sessionId: seeded.sessionA, status: "completed" as const };

    await expect(t.mutation(taskMutations.updateSessionStatus, args)).rejects.toThrow(
      /not authenticated/i,
    );
    await expect(
      t.withIdentity({ subject: String(seeded.ownerB) }).mutation(
        taskMutations.updateSessionStatus,
        args,
      ),
    ).rejects.toThrow(/not found|unauthorized/i);
    await expect(
      t.withIdentity({ subject: String(seeded.ownerB) }).mutation(
        taskMutations.recordStep,
        {
          traceId: seeded.traceA,
          stage: "edit",
          type: "cells_updated",
          title: "Forged step",
          tool: "forged",
          action: "write",
          target: "other tenant",
          resultSummary: "Fabricated completion",
        },
      ),
    ).rejects.toThrow(/not found|unauthorized/i);
  });

  it("keeps service writes owner-checked even with an injected identity", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await seedOwners(t);

    await expect(
      t.mutation(serviceMutations.updateSessionStatusForService, {
        userId: String(seeded.ownerB),
        sessionId: seeded.sessionA,
        status: "completed",
      }),
    ).rejects.toThrow(/not found|unauthorized/i);

    await t.mutation(serviceMutations.updateSessionStatusForService, {
      userId: String(seeded.ownerA),
      sessionId: seeded.sessionA,
      status: "completed",
    });
    const stored = await t.run((ctx: any) => ctx.db.get(seeded.sessionA));
    expect(stored.status).toBe("completed");
  });

  it("returns no operational history to guests and only owner rows after sign-in", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await seedOwners(t);

    expect(await t.query(taskQueries.getCronJobHistory, {})).toEqual({
      sessions: [],
      byCronJob: {},
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
    });
    expect(await t.query(taskQueries.getOracleControlTowerSnapshot, { limit: 6 })).toBeNull();

    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });
    const history = await ownerA.query(taskQueries.getCronJobHistory, {});
    expect(history.sessions.map((session: any) => session._id)).toEqual([seeded.sessionA]);
    const snapshot = await ownerA.query(taskQueries.getOracleControlTowerSnapshot, { limit: 6 });
    expect(snapshot.recentSessions.map((session: any) => session._id)).toEqual([
      String(seeded.sessionA),
    ]);
    expect(snapshot.summary.institutionalVerdict).not.toBe("institutional_memory_aligned");

    const metrics = await ownerA.query(taskQueries.getIndustryMetrics, {});
    expect(metrics.toolCalls).toMatchObject({
      sampleCount: 0,
      successRate24h: null,
      avgDurationMs: null,
    });
  });
});

describe("task-manager source guards", () => {
  it("does not ship fixture seeds or heuristic proof confidence", () => {
    const mutations = readFileSync(
      resolve(process.cwd(), "convex/domains/operations/taskManager/mutations.ts"),
      "utf8",
    );
    const proofPack = readFileSync(
      resolve(process.cwd(), "convex/domains/operations/taskManager/proofPack.ts"),
      "utf8",
    );
    const detail = readFileSync(
      resolve(process.cwd(), "src/features/agents/components/TaskManager/TaskSessionDetail.tsx"),
      "utf8",
    );

    expect(mutations).not.toContain("seedSampleData");
    expect(mutations).not.toContain("seedHistoricalData");
    expect(proofPack).not.toContain("let confidence =");
    expect(proofPack).not.toContain("confidence,");
    expect(detail).not.toContain("proofPack.confidence");
  });

  it("keeps MCP trace writes on injected internal service contracts", () => {
    const dispatcher = readFileSync(
      resolve(process.cwd(), "convex/domains/mcp/mcpGatewayDispatcher.ts"),
      "utf8",
    );

    for (const name of [
      "updateSessionStatusForService",
      "updateSessionMetricsForService",
      "completeTraceForService",
      "recordStepForService",
      "recordDecisionForService",
      "recordVerificationForService",
      "attachEvidenceForService",
      "requestTraceApprovalForService",
    ]) {
      expect(dispatcher).toContain(name);
    }
  });
});
