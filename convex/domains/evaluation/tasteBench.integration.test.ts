/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "evaluation"];

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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(
    ([key, loader]) => [rerootGlobKey(key), loader],
  ),
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

const SCENARIO_ID = "app-02-pre-delegation-packet" as const;
const tasteBenchApi = (api as any).domains.evaluation.tasteBench;
const tasteBenchInternal = (internal as any).domains.evaluation.tasteBench;

const errorText = (error: any) =>
  `${error?.message ?? String(error)} ${JSON.stringify(error?.data ?? null)}`;

type Seed = {
  userId: any;
  artifactIds: [any, any];
  hashes: [string, string];
};

async function seedTasteBenchUser(
  t: any,
  label: string,
  hashCharacters: [string, string],
): Promise<Seed> {
  const baseCreatedAt = 1_800_000_000_000 + label.length * 1_000;
  const hashes: [string, string] = [
    hashCharacters[0].repeat(64),
    hashCharacters[1].repeat(64),
  ];
  return await t.run(async (ctx: any) => {
    const userId = await ctx.db.insert("users", {
      email: `${label}@example.com`,
    });
    const artifactIds = [] as any[];
    for (let index = 0; index < 2; index += 1) {
      artifactIds.push(
        await ctx.db.insert("dogfoodQaRuns", {
          userId,
          createdAt: baseCreatedAt + index,
          provider: "gemini",
          model: "gemini-test-evidence",
          source: "screenshots",
          videoUrl: `/tastebench/${label}/artifact-${index + 1}.png`,
          inputSha256: hashes[index],
          prompt: `tastebench-scenario:${SCENARIO_ID}\nReview the evidence packet.`,
          summary:
            index === 0
              ? "The cobalt packet uses a compact, source-forward review layout."
              : "The ochre packet uses a calm, progressive-disclosure layout.",
          issues: [
            {
              severity: "p2",
              title: index === 0 ? "Dense evidence row" : "Quiet hierarchy",
              details: "A real artifact-backed observation for comparison.",
              route: "/agents",
            },
          ],
        }),
      );
    }
    return {
      userId,
      artifactIds: artifactIds as [any, any],
      hashes,
    };
  });
}

function authed(t: any, seed: Pick<Seed, "userId">) {
  return t.withIdentity({ subject: String(seed.userId) });
}

async function startRun(t: any, seed: Seed) {
  return await authed(t, seed).mutation(tasteBenchApi.startTasteBenchRun, {
    scenarioId: SCENARIO_ID,
  });
}

async function getRawRun(t: any, runId: any) {
  return await t.run(async (ctx: any) => ctx.db.get(runId));
}

async function getRawEvents(t: any, runId: any) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("tasteBenchEvents")
      .withIndex("by_run_sequence", (q: any) => q.eq("runId", runId))
      .order("asc")
      .collect(),
  );
}

async function completeWithSlotA(t: any, seed: Seed, runId: any) {
  return await authed(t, seed).mutation(
    tasteBenchApi.submitTasteBenchComparison,
    {
      runId,
      presentedChoice: "a",
      reason:
        "Slot A communicates the evidence hierarchy more clearly for this audience.",
      dimensions: ["composition", "trust"],
    },
  );
}

describe.skipIf(!convexTestAvailable)("TasteBench persisted contract", () => {
  it("keeps the active comparison blind, including source IDs, hashes, and A/B roles", async () => {
    const t = convexTest(schema, convexModules);
    const seed = await seedTasteBenchUser(t, "blind-owner", ["a", "b"]);
    const started = await startRun(t, seed);

    const dashboard = await authed(t, seed).query(
      tasteBenchApi.getTasteBenchDashboard,
      {},
    );

    expect(dashboard.activeRun).toMatchObject({
      runId: started.runId,
      scenarioId: SCENARIO_ID,
      blindness: { level: "role_only" },
      slotA: { slotHandle: "a" },
      slotB: { slotHandle: "b" },
    });
    expect(dashboard.latestCompleted).toBeNull();
    for (const forbiddenField of [
      "roleReveal",
      "slotAContains",
      "baselineArtifactId",
      "candidateArtifactId",
      "slotAArtifactId",
      "slotBArtifactId",
      "evidencePack",
    ]) {
      expect(dashboard.activeRun).not.toHaveProperty(forbiddenField);
    }
    const serialized = JSON.stringify(dashboard.activeRun);
    for (const artifactId of seed.artifactIds) {
      expect(serialized).not.toContain(String(artifactId));
    }
    for (const hash of seed.hashes) {
      expect(serialized).not.toContain(hash);
    }
    expect(serialized).not.toMatch(/"(?:baseline|candidate)"/);
  });

  it("reveals the persisted A/B roles only after judgment and stores the role-normalized choice", async () => {
    const t = convexTest(schema, convexModules);
    const seed = await seedTasteBenchUser(t, "role-reveal", ["c", "d"]);
    const { runId } = await startRun(t, seed);
    const persisted = await getRawRun(t, runId);
    const expectedSlotB =
      persisted.slotAContains === "baseline" ? "candidate" : "baseline";

    const completed = await completeWithSlotA(t, seed, runId);
    expect(completed.storedChoice).toBe(persisted.slotAContains);

    const dashboard = await authed(t, seed).query(
      tasteBenchApi.getTasteBenchDashboard,
      {},
    );
    expect(dashboard.activeRun).toBeNull();
    expect(dashboard.latestCompleted).toMatchObject({
      runId,
      roleReveal: {
        slotA: persisted.slotAContains,
        slotB: expectedSlotB,
      },
      decision: {
        choice: persisted.slotAContains,
        dimensions: ["composition", "trust"],
      },
    });
  });

  it("keeps runs, dashboards, events, and mutations opaque across owners", async () => {
    const t = convexTest(schema, convexModules);
    const alice = await seedTasteBenchUser(t, "tenant-alice", ["1", "2"]);
    const bob = await seedTasteBenchUser(t, "tenant-bob", ["3", "4"]);
    const { runId } = await startRun(t, alice);

    const bobDashboard = await authed(t, bob).query(
      tasteBenchApi.getTasteBenchDashboard,
      {},
    );
    expect(bobDashboard).toMatchObject({
      activeRun: null,
      latestCompleted: null,
      metrics: { runCount: 0, completedRunCount: 0 },
    });
    expect(
      await authed(t, bob).query(tasteBenchApi.listMyTasteBenchEvents, {}),
    ).toEqual([]);

    await expect(completeWithSlotA(t, bob, runId)).rejects.toSatisfy(
      (error: unknown) => errorText(error).includes("TasteBench run not found"),
    );
    await expect(
      authed(t, bob).mutation(tasteBenchApi.abandonTasteBenchRun, {
        runId,
        reason: "This owner must not be able to alter another owner's run.",
      }),
    ).rejects.toSatisfy((error: unknown) =>
      errorText(error).includes("TasteBench run not found"),
    );
    await expect(
      t.mutation(tasteBenchInternal.recordTasteBenchOperationalEvent, {
        userId: bob.userId,
        runId,
        eventType: "operation_changed",
        sourceKind: "autonomy_receipt",
        sourceReceiptRef: "receipt:cross-tenant-probe",
      }),
    ).rejects.toSatisfy((error: unknown) =>
      errorText(error).includes("TasteBench run not found"),
    );

    expect(
      (await getRawEvents(t, runId)).map((event: any) => event.eventType),
    ).toEqual(["run_started"]);
  });

  it("appends completion and correction evidence without rewriting prior events or the run", async () => {
    const t = convexTest(schema, convexModules);
    const seed = await seedTasteBenchUser(t, "append-only", ["5", "6"]);
    const { runId } = await startRun(t, seed);
    const immutableRun = structuredClone(await getRawRun(t, runId));

    await completeWithSlotA(t, seed, runId);
    const completionEvent = structuredClone((await getRawEvents(t, runId))[1]);

    await expect(completeWithSlotA(t, seed, runId)).rejects.toSatisfy(
      (error: unknown) => errorText(error).includes("already been completed"),
    );
    await expect(
      authed(t, seed).mutation(tasteBenchApi.abandonTasteBenchRun, {
        runId,
        reason: "A completed comparison must not transition to abandoned.",
      }),
    ).rejects.toSatisfy((error: unknown) =>
      errorText(error).includes("cannot be abandoned"),
    );

    const correctionArgs = {
      runId,
      classification: "strengthened_hierarchy",
      note: "The after packet makes the primary evidence path materially easier to scan.",
      dimensions: ["composition", "craft"],
      beforeSlot: "a",
      afterSlot: "b",
    } as const;
    const firstCorrection = await authed(t, seed).mutation(
      tasteBenchApi.recordTasteBenchCorrection,
      correctionArgs,
    );
    const duplicateCorrection = await authed(t, seed).mutation(
      tasteBenchApi.recordTasteBenchCorrection,
      correctionArgs,
    );
    expect(firstCorrection.idempotent).toBe(false);
    expect(duplicateCorrection).toMatchObject({
      createdAt: firstCorrection.createdAt,
      idempotent: true,
    });

    const events = await getRawEvents(t, runId);
    expect(
      events.map((event: any) => [event.sequence, event.eventType]),
    ).toEqual([
      [1, "run_started"],
      [2, "run_completed"],
      [3, "correction_recorded"],
    ]);
    expect(events[1]).toEqual(completionEvent);
    expect(await getRawRun(t, runId)).toEqual(immutableRun);
    expect(new Set(events.map((event: any) => event.eventId)).size).toBe(3);
  });

  it("reports unavailable operational friction as null rather than fabricated zeroes", async () => {
    const t = convexTest(schema, convexModules);
    const seed = await seedTasteBenchUser(t, "honest-metrics", ["7", "8"]);
    await startRun(t, seed);

    const dashboard = await authed(t, seed).query(
      tasteBenchApi.getTasteBenchDashboard,
      {},
    );
    expect(dashboard.metrics).toMatchObject({
      runCount: 1,
      completedRunCount: 0,
      completionRate: 0,
      medianDecisionMs: null,
      manualCorrectionCount: null,
      operationChangedCount: null,
      operationUndoneCount: null,
      approvalInterruptionCount: null,
      proposalInvalidCount: null,
      proposalRetryCount: null,
      artifactReuseCount: null,
      timeToFirstReviewableMs: null,
      approvalPromptCount: null,
      retryCount: null,
      undoCount: null,
    });
  });

  it("deduplicates one authoritative operational source event and counts it once", async () => {
    const t = convexTest(schema, convexModules);
    const seed = await seedTasteBenchUser(t, "source-idempotency", ["9", "e"]);
    const { runId } = await startRun(t, seed);
    const operationalArgs = {
      userId: seed.userId,
      runId,
      eventType: "operation_changed",
      subjectRef: "block:decision-summary",
      detail: "The guarded commit changed the exact reviewed block.",
      dimensions: ["interaction", "trust"],
      sourceKind: "autonomy_receipt",
      sourceReceiptRef: "receipt:stable-operation-42",
      sourceRunRef: "scratchpad:run-42",
    } as const;

    const first = await t.mutation(
      tasteBenchInternal.recordTasteBenchOperationalEvent,
      operationalArgs,
    );
    const retry = await t.mutation(
      tasteBenchInternal.recordTasteBenchOperationalEvent,
      operationalArgs,
    );
    expect(first.idempotent).toBe(false);
    expect(retry).toMatchObject({
      eventId: first.eventId,
      createdAt: first.createdAt,
      idempotent: true,
    });
    await expect(
      t.mutation(tasteBenchInternal.recordTasteBenchOperationalEvent, {
        ...operationalArgs,
        detail:
          "A conflicting payload must not overwrite the authoritative source event.",
      }),
    ).rejects.toSatisfy((error: unknown) =>
      errorText(error).includes("operational source key conflict"),
    );

    const events = await getRawEvents(t, runId);
    expect(events.map((event: any) => event.eventType)).toEqual([
      "run_started",
      "operation_changed",
    ]);
    expect(events[1]?.operational?.source).toEqual({
      kind: "autonomy_receipt",
      receiptRef: "receipt:stable-operation-42",
      runRef: "scratchpad:run-42",
    });
    const dashboard = await authed(t, seed).query(
      tasteBenchApi.getTasteBenchDashboard,
      {},
    );
    expect(dashboard.metrics.operationChangedCount).toBe(1);
  });
});
