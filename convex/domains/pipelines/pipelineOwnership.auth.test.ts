/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import {
  requireAuthenticatedPipelineOwnerKey,
  requirePipelineCallerOwnerKey,
} from "./pipelineOwnership";
import {
  PIPELINE_DAY_WINDOW_LIMIT,
  PIPELINE_MODEL_ID_MAX_LENGTH,
  PIPELINE_SHORT_WINDOW_LIMIT,
  PIPELINE_SHORT_WINDOW_MS,
  PIPELINE_SPEC_MAX_LENGTH,
  PIPELINE_TITLE_MAX_LENGTH,
  normalizePipelineLaunchText,
  reservePipelineLaunchAdmission,
} from "./pipelineAdmission";

const DIR_SEGMENTS = ["domains", "pipelines"];
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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [
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

const pipelines = (api as any).domains.pipelines;
const sessionA = { anonymousSessionId: "anon-session-a" };
const sessionB = { anonymousSessionId: "anon-session-b" };
const NOW = 1_700_000_000_000;

function runFields(
  runId: string,
  ownerKey: string | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    pipelineKind: "research" as const,
    status: "succeeded" as const,
    verdict: "verified" as const,
    title: `Run ${runId}`,
    spec: `Research ${runId}`,
    modelId: "nodebench:auto-balanced",
    ownerKey,
    createdAt: NOW,
    durationMs: 100,
    estimatedUsd: 1,
    runId,
    idempotencyKey: `key-${runId}`,
    ...overrides,
  };
}

describe.skipIf(!convexTestAvailable)("pipeline caller ownership", () => {
  it("resolves the public-start owner from server auth or the guest session", async () => {
    const guestCtx = {
      auth: { getUserIdentity: async () => null },
    } as any;
    const authenticatedCtx = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user-server-id",
          issuer: "https://nodebench.test",
          tokenIdentifier: "nodebench|user-server-id",
        }),
      },
    } as any;

    expect(
      await requirePipelineCallerOwnerKey(guestCtx, "anon-session-a"),
    ).toBe("session:anon-session-a");
    expect(
      await requirePipelineCallerOwnerKey(authenticatedCtx, "spoofed-guest-session"),
    ).toBe("user:user-server-id");
    await expect(requireAuthenticatedPipelineOwnerKey(guestCtx)).rejects.toThrow(
      /authentication required/i,
    );
    expect(await requireAuthenticatedPipelineOwnerKey(authenticatedCtx)).toBe(
      "user:user-server-id",
    );
  });

  it("isolates run lists, details, streams, stats, bundles, and evals by anonymous session", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const runA = await ctx.db.insert(
        "pipelineRuns",
        runFields("run-a", "session:anon-session-a"),
      );
      const runB = await ctx.db.insert(
        "pipelineRuns",
        runFields("run-b", "session:anon-session-b", {
          status: "failed",
          verdict: "failed",
          estimatedUsd: 50,
          createdAt: NOW + 1,
        }),
      );
      await ctx.db.insert("pipelineRuns", runFields("legacy", undefined));
      await ctx.db.insert("pipelineSteps", {
        runId: "run-a",
        pipelineRunId: runA,
        seq: 1,
        name: "research.synthesize",
        status: "ok",
        startedAt: NOW,
      });
      await ctx.db.insert("pipelineSteps", {
        runId: "run-b",
        pipelineRunId: runB,
        seq: 1,
        name: "research.private",
        status: "error",
        startedAt: NOW,
      });
      await ctx.db.insert("pipelineRunStreams", {
        runId: "run-a",
        pipelineRunId: runA,
        stepName: "research.synthesize",
        partialText: "session A output",
        status: "streaming",
        startedAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("pipelineRunStreams", {
        runId: "run-b",
        pipelineRunId: runB,
        stepName: "research.private",
        partialText: "session B private output",
        status: "streaming",
        startedAt: NOW,
        updatedAt: NOW + 1,
      });
      return { runA, runB };
    });

    await expect(
      t.query(pipelines.pipelineRunsQueries.listRecentRuns, { limit: 10 }),
    ).rejects.toThrow(/authentication or anonymous session required/i);

    const listA = await t.query(pipelines.pipelineRunsQueries.listRecentRuns, {
      ...sessionA,
      limit: 10,
    });
    const listB = await t.query(pipelines.pipelineRunsQueries.listRecentRuns, {
      ...sessionB,
      limit: 10,
    });
    expect(listA.map((row: any) => row.runId)).toEqual(["run-a"]);
    expect(listB.map((row: any) => row.runId)).toEqual(["run-b"]);

    expect(
      await t.query(pipelines.pipelineRunsQueries.getRunDetail, {
        ...sessionA,
        runId: "run-a",
      }),
    ).toMatchObject({ run: { _id: seeded.runA, runId: "run-a" } });
    expect(
      await t.query(pipelines.pipelineRunsQueries.getRunDetail, {
        ...sessionB,
        runId: "run-a",
      }),
    ).toBeNull();

    expect(
      await t.query(pipelines.pipelineStreamMutations.getPipelineStream, {
        ...sessionA,
        runId: "run-a",
      }),
    ).toMatchObject({ partialText: "session A output" });
    expect(
      await t.query(pipelines.pipelineStreamMutations.getPipelineStream, {
        ...sessionB,
        runId: "run-a",
      }),
    ).toBeNull();

    expect(
      await t.query(pipelines.pipelineRunsQueries.getRunSummaryStats, sessionA),
    ).toMatchObject({ totalRuns: 1, succeeded: 1, failed: 0, totalEstimatedUsd: 1 });
    expect(
      await t.query(pipelines.pipelineRunsQueries.getRunBundleDownloadUrl, {
        ...sessionA,
        runId: "run-a",
      }),
    ).toEqual({ bundleUrl: null, imageUrl: null });
    expect(
      await t.query(pipelines.pipelineRunsQueries.getRunBundleDownloadUrl, {
        ...sessionB,
        runId: "run-a",
      }),
    ).toBeNull();

    const evalA = await t.query(
      pipelines.pipelineEvalQueries.getPipelineEvalScorecard,
      { ...sessionA, limit: 100 },
    );
    expect(evalA).toMatchObject({ samples: 1, verifiedShare: 1 });
    expect(evalA).not.toHaveProperty("verdictAccuracy");
    expect(evalA).not.toHaveProperty("brier");
    expect(evalA.costByVerdict).toEqual([
      { verdict: "verified", count: 1, usd: 1 },
    ]);
  }, 20_000);

  it("anchors schedules to authenticated callers and rejects cross-user control", async () => {
    const t = convexTest(schema, convexModules);
    const { userA, userB } = await t.run(async (ctx: any) => ({
      userA: await ctx.db.insert("users", { email: "schedule-a@example.com" }),
      userB: await ctx.db.insert("users", { email: "schedule-b@example.com" }),
    }));
    const ownerA = t.withIdentity({ subject: String(userA) });
    const ownerB = t.withIdentity({ subject: String(userB) });
    const created = await ownerA.mutation(pipelines.pipelineSchedule.createSchedule, {
      pipelineKind: "research",
      spec: "Track Acme",
      cadence: "daily",
    });

    const stored = await t.run(async (ctx: any) => ctx.db.get(created.scheduleId));
    expect(stored.ownerKey).toBe(`user:${String(userA)}`);

    await expect(
      ownerB.mutation(pipelines.pipelineSchedule.setScheduleEnabled, {
        scheduleId: created.scheduleId,
        enabled: false,
      }),
    ).rejects.toThrow(/not found or unauthorized/i);
    await expect(
      ownerB.mutation(pipelines.pipelineSchedule.deleteSchedule, {
        scheduleId: created.scheduleId,
      }),
    ).rejects.toThrow(/not found or unauthorized/i);

    await ownerA.mutation(pipelines.pipelineSchedule.setScheduleEnabled, {
      scheduleId: created.scheduleId,
      enabled: false,
    });
    const rowsA = await ownerA.query(pipelines.pipelineSchedule.listSchedules, {
      limit: 10,
    });
    const rowsB = await ownerB.query(pipelines.pipelineSchedule.listSchedules, {
      limit: 10,
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({ enabled: false });
    expect(rowsA[0]).not.toHaveProperty("ownerKey");
    expect(rowsB).toEqual([]);

    await ownerA.mutation(pipelines.pipelineSchedule.deleteSchedule, {
      scheduleId: created.scheduleId,
    });
    expect(
      await ownerA.query(pipelines.pipelineSchedule.listSchedules, {
        limit: 10,
      }),
    ).toEqual([]);
  }, 20_000);

  it("requires authentication for public launches and every schedule operation", async () => {
    const t = convexTest(schema, convexModules);
    const scheduleId = await t.run(async (ctx: any) =>
      ctx.db.insert("scheduledPipelineRuns", {
        ownerKey: "user:unreachable-owner",
        pipelineKind: "research",
        spec: "Private schedule",
        modelId: "nodebench:auto-balanced",
        cadence: "daily",
        enabled: true,
        nextRunAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await expect(
      t.mutation(pipelines.pipelineWorkflow.startPipelineRun, {
        pipelineKind: "research",
        spec: "Guest launch",
      }),
    ).rejects.toThrow(/authentication required/i);
    await expect(
      t.mutation(pipelines.pipelineWorkflow.startComposedPipelineRun, {
        composition: "research_then_code",
        spec: "Guest composed launch",
      }),
    ).rejects.toThrow(/authentication required/i);
    await expect(
      t.mutation(pipelines.pipelineSchedule.createSchedule, {
        pipelineKind: "research",
        spec: "Guest schedule",
        cadence: "daily",
      }),
    ).rejects.toThrow(/authentication required/i);
    await expect(
      t.query(pipelines.pipelineSchedule.listSchedules, { limit: 10 }),
    ).rejects.toThrow(/authentication required/i);
    await expect(
      t.mutation(pipelines.pipelineSchedule.setScheduleEnabled, {
        scheduleId,
        enabled: false,
      }),
    ).rejects.toThrow(/authentication required/i);
    await expect(
      t.mutation(pipelines.pipelineSchedule.deleteSchedule, { scheduleId }),
    ).rejects.toThrow(/authentication required/i);
  }, 20_000);

  it("does not execute legacy anonymous schedules", async () => {
    const t = convexTest(schema, convexModules);
    await t.run(async (ctx: any) => {
      for (const ownerKey of ["session:legacy-guest", "user:authenticated-owner"]) {
        await ctx.db.insert("scheduledPipelineRuns", {
          ownerKey,
          pipelineKind: "research",
          spec: `Schedule for ${ownerKey}`,
          modelId: "nodebench:auto-balanced",
          cadence: "daily",
          enabled: true,
          nextRunAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const due = await t.mutation(
      (internal as any).domains.pipelines.pipelineSchedule.findDueSchedules,
      { now: NOW + 1 },
    );
    expect(due.map((row: any) => row.ownerKey)).toEqual([
      "user:authenticated-owner",
    ]);
  }, 20_000);

  it("enforces shared server-side input bounds for launches and schedules", () => {
    expect(() =>
      normalizePipelineLaunchText({ spec: "x".repeat(PIPELINE_SPEC_MAX_LENGTH + 1) }),
    ).toThrow(/spec exceeds/i);
    expect(() =>
      normalizePipelineLaunchText({
        spec: "valid",
        title: "x".repeat(PIPELINE_TITLE_MAX_LENGTH + 1),
      }),
    ).toThrow(/title exceeds/i);
    expect(() =>
      normalizePipelineLaunchText({
        spec: "valid",
        modelId: "x".repeat(PIPELINE_MODEL_ID_MAX_LENGTH + 1),
      }),
    ).toThrow(/model id exceeds/i);
    expect(normalizePipelineLaunchText({ spec: "  valid  ", title: "  " })).toEqual({
      spec: "valid",
      title: undefined,
      modelId: undefined,
    });
  });

  it("durably enforces authenticated-owner short and daily launch windows", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", { email: "quota-owner@example.com" }),
    );
    const ownerKey = `user:${String(userId)}`;
    const now = NOW;

    for (let i = 0; i < PIPELINE_SHORT_WINDOW_LIMIT; i += 1) {
      await t.run(async (ctx: any) =>
        reservePipelineLaunchAdmission(ctx, ownerKey, { now }),
      );
    }
    await expect(
      t.run(async (ctx: any) =>
        reservePipelineLaunchAdmission(ctx, ownerKey, { now }),
      ),
    ).rejects.toThrow(/launch limit reached/i);

    const nextWindow = now + PIPELINE_SHORT_WINDOW_MS;
    await t.run(async (ctx: any) => {
      const row = await ctx.db
        .query("pipelineLaunchAdmissions")
        .withIndex("by_owner", (q: any) => q.eq("ownerKey", ownerKey))
        .unique();
      await ctx.db.patch(row._id, {
        shortWindowStartedAt: nextWindow,
        shortCount: 0,
        dayCount: PIPELINE_DAY_WINDOW_LIMIT,
      });
    });
    await expect(
      t.run(async (ctx: any) =>
        reservePipelineLaunchAdmission(ctx, ownerKey, { now: nextWindow }),
      ),
    ).rejects.toThrow(/daily pipeline launch limit reached/i);
    await expect(
      t.run(async (ctx: any) =>
        reservePipelineLaunchAdmission(ctx, "session:rotated-id", { now }),
      ),
    ).rejects.toThrow(/authenticated owner/i);
  }, 20_000);

  it("gives authenticated identity precedence over a supplied guest session", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", { email: "pipeline-owner@example.com" }),
    );
    await t.run(async (ctx: any) => {
      await ctx.db.insert(
        "pipelineRuns",
        runFields("user-run", `user:${String(userId)}`),
      );
      await ctx.db.insert(
        "pipelineRuns",
        runFields("guest-run", "session:anon-session-a"),
      );
    });

    const authenticated = t.withIdentity({ subject: String(userId) });
    const rows = await authenticated.query(
      pipelines.pipelineRunsQueries.listRecentRuns,
      { ...sessionA, limit: 10 },
    );
    expect(rows.map((row: any) => row.runId)).toEqual(["user-run"]);
  }, 20_000);

  it("rejects spoofed public ownerKey arguments at start and create boundaries", async () => {
    const t = convexTest(schema, convexModules);
    await expect(
      t.mutation(pipelines.pipelineWorkflow.startPipelineRun, {
        ...sessionA,
        pipelineKind: "research",
        spec: "Spoof attempt",
        ownerKey: "user:victim",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(pipelines.pipelineSchedule.createSchedule, {
        ...sessionA,
        pipelineKind: "research",
        spec: "Spoof attempt",
        cadence: "daily",
        ownerKey: "user:victim",
      }),
    ).rejects.toThrow();
  }, 20_000);
});
