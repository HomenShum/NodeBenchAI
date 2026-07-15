import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import {
  TASTE_BENCH_CATALOG_VERSION,
  TASTE_BENCH_SCENARIOS,
  assertTasteBenchCorrectionKind,
  assertTasteBenchEventCanAppend,
  assertTasteBenchOperationalEventType,
  assertTasteBenchOwner,
  assertTasteBenchScenarioId,
  buildTasteBenchBlindOrder,
  deriveTasteBenchRunState,
  isTasteBenchEvidenceEligible,
  normalizeBlindTasteBenchChoice,
  normalizeTasteBenchReason,
  validateTasteBenchDimensions,
  type TasteBenchEventType,
  type TasteBenchPresentedChoice,
  type TasteBenchStateEvent,
} from "./tasteBenchPolicy";
import {
  tasteBenchCorrectionKindValidator,
  tasteBenchDimensionValidator,
  tasteBenchOperationalEventTypeValidator,
  tasteBenchScenarioIdValidator,
} from "./tasteBenchSchema";

type TasteBenchCtx = QueryCtx | MutationCtx;
type TasteBenchOperationalSourceKind =
  | "autonomy_proposal"
  | "autonomy_receipt"
  | "execution_trace"
  | "dogfood_telemetry";

async function requireTasteBenchUserId(
  ctx: TasteBenchCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

async function getRunEvents(
  ctx: TasteBenchCtx,
  runId: Id<"tasteBenchRuns">,
): Promise<Doc<"tasteBenchEvents">[]> {
  return await ctx.db
    .query("tasteBenchEvents")
    .withIndex("by_run_sequence", (q) => q.eq("runId", runId))
    .order("asc")
    .collect();
}

function toStateEvents(
  events: Doc<"tasteBenchEvents">[],
): TasteBenchStateEvent[] {
  return events.map((event) => ({
    eventType: event.eventType as TasteBenchEventType,
    sequence: event.sequence,
  }));
}

async function getOwnedArtifact(
  ctx: TasteBenchCtx,
  userId: Id<"users">,
  artifactId: Id<"dogfoodQaRuns">,
): Promise<Doc<"dogfoodQaRuns">> {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || String(artifact.userId) !== String(userId)) {
    throw new Error("TasteBench artifact not found");
  }
  if (!artifact.summary.trim()) {
    throw new Error("TasteBench requires a reviewable artifact packet");
  }
  return artifact;
}

function toBlindArtifactPacket(
  artifact: Doc<"dogfoodQaRuns">,
  slot: "a" | "b",
) {
  return {
    // Never expose the source row ID, immutable hash, creation time, or
    // baseline/candidate role before judgment. The handle is scoped to this
    // persisted run and is resolved server-side by subsequent mutations.
    slotHandle: slot,
    summary: artifact.summary.slice(0, 4_000),
    issues: artifact.issues.slice(0, 12).map((issue) => ({
      severity: issue.severity,
      title: issue.title,
      details: issue.details,
      route: issue.route ?? null,
    })),
    evidenceUrl: artifact.videoUrl ?? null,
  };
}

async function toBlindRunPacket(
  ctx: TasteBenchCtx,
  userId: Id<"users">,
  run: Doc<"tasteBenchRuns">,
) {
  const [slotA, slotB] = await Promise.all([
    getOwnedArtifact(ctx, userId, run.slotAArtifactId),
    getOwnedArtifact(ctx, userId, run.slotBArtifactId),
  ]);
  return {
    runId: run._id,
    scenarioId: run.scenarioId,
    catalogVersion: run.catalogVersion,
    createdAt: run.createdAt,
    blindness: {
      level: "role_only" as const,
      disclosure:
        "A/B roles and source row identities are withheld. Artifact content and media URLs are not anonymized.",
    },
    slotA: toBlindArtifactPacket(slotA, "a"),
    slotB: toBlindArtifactPacket(slotB, "b"),
  };
}

async function getOwnedRun(
  ctx: TasteBenchCtx,
  userId: Id<"users">,
  runId: Id<"tasteBenchRuns">,
): Promise<Doc<"tasteBenchRuns">> {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("TasteBench run not found");
  assertTasteBenchOwner(run.userId, userId);
  return run;
}

function makeEventId(
  runId: Id<"tasteBenchRuns">,
  sequence: number,
  eventType: TasteBenchEventType,
) {
  return `${runId}:${sequence}:${eventType}`;
}

function stableOperationalDigest(value: unknown): string {
  const input = JSON.stringify(value) ?? "null";
  const hash = (seed: number) => {
    let result = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

type OperationalEventArgs = {
  userId: Id<"users">;
  runId: Id<"tasteBenchRuns">;
  eventType: Parameters<typeof assertTasteBenchOperationalEventType>[0];
  subjectRef?: string;
  detail?: string;
  dimensions?: string[];
  artifactSlot?: "a" | "b";
  sourceKind: TasteBenchOperationalSourceKind;
  sourceReceiptRef: string;
  sourceRunRef?: string;
};

async function appendTasteBenchOperationalEvent(
  ctx: MutationCtx,
  args: OperationalEventArgs,
) {
  const run = await getOwnedRun(ctx, args.userId, args.runId);
  assertTasteBenchOperationalEventType(args.eventType);

  const subjectRef = args.subjectRef?.trim() || undefined;
  const detail = args.detail?.trim() || undefined;
  if (subjectRef && subjectRef.length > 500) {
    throw new Error(
      "TasteBench subject reference must be 500 characters or fewer",
    );
  }
  if (detail && detail.length > 1_200) {
    throw new Error(
      "TasteBench event detail must be 1,200 characters or fewer",
    );
  }
  const sourceReceiptRef = args.sourceReceiptRef.trim();
  const sourceRunRef = args.sourceRunRef?.trim() || undefined;
  if (!sourceReceiptRef || sourceReceiptRef.length > 500) {
    throw new Error("A bounded authoritative source receipt is required");
  }
  if (sourceRunRef && sourceRunRef.length > 500) {
    throw new Error(
      "TasteBench source run reference must be 500 characters or fewer",
    );
  }
  const dimensions = args.dimensions
    ? validateTasteBenchDimensions(args.dimensions)
    : undefined;
  const eventId = `tastebench-operational:${stableOperationalDigest({
    runId: String(run._id),
    eventType: args.eventType,
    sourceKind: args.sourceKind,
    sourceReceiptRef,
    sourceRunRef: sourceRunRef ?? null,
  })}`;
  const existing = await ctx.db
    .query("tasteBenchEvents")
    .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
    .unique();
  if (existing) {
    const source = existing.operational?.source;
    const sameEvent =
      existing.userId === args.userId &&
      existing.runId === run._id &&
      existing.eventType === args.eventType &&
      existing.operational?.subjectRef === subjectRef &&
      existing.operational?.detail === detail &&
      JSON.stringify(existing.operational?.dimensions ?? null) ===
        JSON.stringify(dimensions ?? null) &&
      existing.operational?.artifactSlot === args.artifactSlot &&
      source?.kind === args.sourceKind &&
      source.receiptRef === sourceReceiptRef &&
      source.runRef === sourceRunRef;
    if (!sameEvent) {
      throw new Error("TasteBench operational source key conflict");
    }
    return { eventId, createdAt: existing.createdAt, idempotent: true };
  }

  const events = await getRunEvents(ctx, run._id);
  const sequence = events.length + 1;
  const stateEvent: TasteBenchStateEvent = {
    eventType: args.eventType,
    sequence,
  };
  assertTasteBenchEventCanAppend(toStateEvents(events), stateEvent);
  const createdAt = Date.now();
  await ctx.db.insert("tasteBenchEvents", {
    userId: args.userId,
    runId: run._id,
    eventId,
    sequence,
    eventType: args.eventType,
    operational: {
      subjectRef,
      detail,
      dimensions,
      artifactSlot: args.artifactSlot,
      source: {
        kind: args.sourceKind,
        receiptRef: sourceReceiptRef,
        runRef: sourceRunRef,
      },
    },
    createdAt,
  });
  return { eventId, createdAt, idempotent: false };
}

export async function findActiveTasteBenchRunId(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"tasteBenchRuns"> | null> {
  const recentRuns = await ctx.db
    .query("tasteBenchRuns")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(10);
  for (const run of recentRuns) {
    const events = await getRunEvents(ctx, run._id);
    if (deriveTasteBenchRunState(toStateEvents(events)) === "active") {
      return run._id;
    }
  }
  return null;
}

/**
 * Best-effort bridge used by real workflows. The caller supplies the run ID
 * captured on the proposal/receipt transition; ambient "latest active" state
 * is never consulted, so historical retries cannot contaminate a later run.
 */
export async function recordBoundTasteBenchOperationalEvent(
  ctx: MutationCtx,
  args: OperationalEventArgs,
): Promise<
  | { recorded: true; eventId: string; createdAt: number; idempotent: boolean }
  | { recorded: false }
> {
  try {
    const result = await appendTasteBenchOperationalEvent(ctx, args);
    return { recorded: true, ...result };
  } catch {
    // Operational evidence is deliberately non-blocking. The absence remains
    // visible as null metrics instead of being fabricated as zero.
  }
  return { recorded: false };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null;
  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];
  return left == null || right == null ? null : Math.round((left + right) / 2);
}

/**
 * Eligibility only: source IDs and timestamps stay private so the browser
 * cannot reconstruct the persisted A/B order before a human judgment.
 */
export const listTasteBenchArtifactCandidates = query({
  args: { scenarioId: tasteBenchScenarioIdValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { eligibleCount: 0, requiredCount: 2, ready: false };
    assertTasteBenchScenarioId(args.scenarioId);
    const scenario = TASTE_BENCH_SCENARIOS.find(
      (candidate) => candidate.id === args.scenarioId,
    );
    if (!scenario) return { eligibleCount: 0, requiredCount: 2, ready: false };
    const artifacts = await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const eligibleHashes = new Set(
      artifacts
        .filter((artifact) =>
          isTasteBenchEvidenceEligible({
            prompt: artifact.prompt,
            scenarioId: scenario.id,
            mediaUrl: artifact.videoUrl,
            inputSha256: artifact.inputSha256,
            summary: artifact.summary,
          }),
        )
        .map((artifact) => artifact.inputSha256 as string),
    );
    return {
      eligibleCount: eligibleHashes.size,
      requiredCount: 2,
      ready: eligibleHashes.size >= 2,
    };
  },
});

export const getTasteBenchDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const unavailableMetrics = {
      runCount: 0,
      completedRunCount: 0,
      completionRate: null,
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
    };
    if (!userId) {
      return {
        activeRun: null,
        latestCompleted: null,
        metrics: unavailableMetrics,
      };
    }

    const runs = await ctx.db
      .query("tasteBenchRuns")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const eventsByRun = await Promise.all(
      runs.map((run) => getRunEvents(ctx, run._id)),
    );
    const entries = runs.map((run, index) => ({
      run,
      events: eventsByRun[index] ?? [],
    }));
    const activeEntry = entries.find(
      ({ events }) =>
        deriveTasteBenchRunState(toStateEvents(events)) === "active",
    );
    const completedEntry = entries.find(
      ({ events }) =>
        deriveTasteBenchRunState(toStateEvents(events)) === "completed",
    );

    const activeRun = activeEntry
      ? await toBlindRunPacket(ctx, userId, activeEntry.run)
      : null;

    const latestCompleted = completedEntry
      ? await (async () => {
          const blindRun = await toBlindRunPacket(
            ctx,
            userId,
            completedEntry.run,
          );
          const decision = completedEntry.events.find(
            (event) => event.eventType === "run_completed",
          );
          return decision?.comparison
            ? {
                ...blindRun,
                roleReveal: {
                  slotA: completedEntry.run.slotAContains,
                  slotB:
                    completedEntry.run.slotAContains === "baseline"
                      ? ("candidate" as const)
                      : ("baseline" as const),
                  disclosure:
                    "Roles are revealed only after the human judgment is persisted.",
                },
                decision: {
                  choice: decision.comparison.storedChoice,
                  reason: decision.comparison.reason,
                  dimensions: decision.comparison.dimensions,
                  createdAt: decision.createdAt,
                },
              }
            : null;
        })()
      : null;

    const completedEntries = entries.filter(
      ({ events }) =>
        deriveTasteBenchRunState(toStateEvents(events)) === "completed",
    );
    const decisionDurations = completedEntries.flatMap(({ run, events }) => {
      const decision = events.find(
        (event) => event.eventType === "run_completed",
      );
      return decision ? [Math.max(0, decision.createdAt - run.createdAt)] : [];
    });
    const allEvents = entries.flatMap((entry) => entry.events);
    const evidencedCount = (eventTypes: readonly TasteBenchEventType[]) => {
      const count = allEvents.filter((event) =>
        eventTypes.includes(event.eventType as TasteBenchEventType),
      ).length;
      return count > 0 ? count : null;
    };
    const reviewableDurations = entries.flatMap(({ run, events }) => {
      const reviewable = events.find(
        (event) => event.eventType === "reviewable_output",
      );
      return reviewable
        ? [Math.max(0, reviewable.createdAt - run.createdAt)]
        : [];
    });

    return {
      activeRun,
      latestCompleted,
      metrics: {
        runCount: runs.length,
        completedRunCount: completedEntries.length,
        completionRate:
          runs.length > 0 ? completedEntries.length / runs.length : null,
        medianDecisionMs: median(decisionDurations),
        // Browser-authored before/after observations are preference evidence,
        // not proof that an editor operation occurred. Keep this unavailable
        // until an internal workflow event links the actual edit receipt.
        manualCorrectionCount: null,
        operationChangedCount: evidencedCount(["operation_changed"]),
        operationUndoneCount: evidencedCount(["operation_undone"]),
        approvalInterruptionCount: evidencedCount(["approval_interrupted"]),
        proposalInvalidCount: evidencedCount(["proposal_invalid"]),
        proposalRetryCount: evidencedCount(["proposal_retried"]),
        artifactReuseCount: evidencedCount(["artifact_reused"]),
        timeToFirstReviewableMs: median(reviewableDurations),
        // Compatibility aliases for the first UI slice. Null means the event
        // ledger did not prove a value; it must never render as zero.
        approvalPromptCount: evidencedCount(["approval_interrupted"]),
        retryCount: evidencedCount(["proposal_retried"]),
        undoCount: evidencedCount(["operation_undone"]),
      },
    };
  },
});

export const startTasteBenchRun = mutation({
  args: {
    scenarioId: tasteBenchScenarioIdValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireTasteBenchUserId(ctx);
    assertTasteBenchScenarioId(args.scenarioId);
    const scenario = TASTE_BENCH_SCENARIOS.find(
      (candidate) => candidate.id === args.scenarioId,
    );
    if (!scenario) throw new Error("Unknown TasteBench scenario");
    const existingRuns = await ctx.db
      .query("tasteBenchRuns")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    for (const run of existingRuns) {
      const events = await getRunEvents(ctx, run._id);
      if (deriveTasteBenchRunState(toStateEvents(events)) === "active") {
        throw new Error(
          "Finish or abandon the active TasteBench comparison first",
        );
      }
    }

    const recentArtifacts = await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const uniqueByHash = new Map<string, Doc<"dogfoodQaRuns">>();
    for (const artifact of recentArtifacts) {
      if (
        isTasteBenchEvidenceEligible({
          prompt: artifact.prompt,
          scenarioId: scenario.id,
          mediaUrl: artifact.videoUrl,
          inputSha256: artifact.inputSha256,
          summary: artifact.summary,
        }) &&
        artifact.inputSha256 &&
        !uniqueByHash.has(artifact.inputSha256)
      ) {
        uniqueByHash.set(artifact.inputSha256, artifact);
      }
    }
    const selectedArtifacts = Array.from(uniqueByHash.values()).slice(0, 2);
    if (selectedArtifacts.length < 2) {
      throw new Error(
        "Two scenario-matched, hashed media evidence packs are required",
      );
    }
    const ordered = selectedArtifacts.sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        String(left._id).localeCompare(String(right._id)),
    );
    const baseline = ordered[0];
    const candidate = ordered[1];
    if (!baseline || !candidate)
      throw new Error("Two real TasteBench artifacts are required");

    const createdAt = Date.now();
    const blindOrder = buildTasteBenchBlindOrder({
      baselineArtifactRef: String(baseline._id),
      candidateArtifactRef: String(candidate._id),
      salt: `${userId}:${args.scenarioId}:${createdAt}`,
    });
    const slotAArtifactId =
      blindOrder.slotA === "baseline" ? baseline._id : candidate._id;
    const slotBArtifactId =
      blindOrder.slotB === "baseline" ? baseline._id : candidate._id;
    const runId = await ctx.db.insert("tasteBenchRuns", {
      userId,
      scenarioId: args.scenarioId,
      catalogVersion: TASTE_BENCH_CATALOG_VERSION,
      baselineArtifactId: baseline._id,
      candidateArtifactId: candidate._id,
      slotAArtifactId,
      slotBArtifactId,
      slotAContains: blindOrder.slotA,
      audience: scenario.audience,
      expectedOutcome: scenario.expectedOutcome,
      expectedPrimitiveCoverage: [...scenario.expectedPrimitiveCoverage],
      evidencePack: {
        source: "dogfood_qa_runs",
        evidencePackRef: `tastebench:${userId}:${args.scenarioId}:${createdAt}`,
        artifactIds: [baseline._id, candidate._id],
      },
      createdAt,
    });

    const stateEvent: TasteBenchStateEvent = {
      eventType: "run_started",
      sequence: 1,
    };
    assertTasteBenchEventCanAppend([], stateEvent);
    await ctx.db.insert("tasteBenchEvents", {
      userId,
      runId,
      eventId: makeEventId(runId, 1, "run_started"),
      sequence: 1,
      eventType: "run_started",
      createdAt,
    });
    return { runId };
  },
});

export const submitTasteBenchComparison = mutation({
  args: {
    runId: v.id("tasteBenchRuns"),
    presentedChoice: v.union(
      v.literal("a"),
      v.literal("b"),
      v.literal("tie"),
      v.literal("both_fail"),
    ),
    reason: v.string(),
    dimensions: v.array(tasteBenchDimensionValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireTasteBenchUserId(ctx);
    const run = await getOwnedRun(ctx, userId, args.runId);
    const events = await getRunEvents(ctx, run._id);
    const dimensions = validateTasteBenchDimensions(args.dimensions);
    const reason = normalizeTasteBenchReason(args.reason);
    const sequence = events.length + 1;
    const stateEvent: TasteBenchStateEvent = {
      eventType: "run_completed",
      sequence,
    };
    assertTasteBenchEventCanAppend(toStateEvents(events), stateEvent);
    const presentedChoice = args.presentedChoice as TasteBenchPresentedChoice;
    const storedChoice = normalizeBlindTasteBenchChoice(
      presentedChoice,
      run.slotAContains,
    );
    const createdAt = Date.now();

    await ctx.db.insert("tasteBenchEvents", {
      userId,
      runId: run._id,
      eventId: makeEventId(run._id, sequence, "run_completed"),
      sequence,
      eventType: "run_completed",
      comparison: { presentedChoice, storedChoice, reason, dimensions },
      createdAt,
    });
    return { storedChoice, createdAt };
  },
});

/**
 * Records workflow-reported operational evidence without changing the
 * immutable run. This is internal-only: browser claims are not accepted.
 * Source references are retained for audit, but referential verification is
 * a future integration step and the UI labels this limitation explicitly.
 */
export const recordTasteBenchOperationalEvent = internalMutation({
  args: {
    userId: v.id("users"),
    runId: v.id("tasteBenchRuns"),
    eventType: tasteBenchOperationalEventTypeValidator,
    subjectRef: v.optional(v.string()),
    detail: v.optional(v.string()),
    dimensions: v.optional(v.array(tasteBenchDimensionValidator)),
    artifactSlot: v.optional(v.union(v.literal("a"), v.literal("b"))),
    sourceKind: v.union(
      v.literal("autonomy_proposal"),
      v.literal("autonomy_receipt"),
      v.literal("execution_trace"),
      v.literal("dogfood_telemetry"),
    ),
    sourceReceiptRef: v.string(),
    sourceRunRef: v.optional(v.string()),
  },
  handler: appendTasteBenchOperationalEvent,
});

export const recordTasteBenchCorrection = mutation({
  args: {
    runId: v.id("tasteBenchRuns"),
    classification: tasteBenchCorrectionKindValidator,
    note: v.string(),
    dimensions: v.array(tasteBenchDimensionValidator),
    beforeSlot: v.union(v.literal("a"), v.literal("b")),
    afterSlot: v.union(v.literal("a"), v.literal("b")),
  },
  handler: async (ctx, args) => {
    const userId = await requireTasteBenchUserId(ctx);
    const run = await getOwnedRun(ctx, userId, args.runId);
    const events = await getRunEvents(ctx, run._id);
    const sequence = events.length + 1;
    const stateEvent: TasteBenchStateEvent = {
      eventType: "correction_recorded",
      sequence,
    };
    assertTasteBenchEventCanAppend(toStateEvents(events), stateEvent);
    assertTasteBenchCorrectionKind(args.classification);
    const note = normalizeTasteBenchReason(args.note, "Correction note");
    const dimensions = validateTasteBenchDimensions(args.dimensions);
    if (args.beforeSlot === args.afterSlot) {
      throw new Error(
        "Correction before and after artifacts must be different",
      );
    }
    const beforeArtifactId =
      args.beforeSlot === "a" ? run.slotAArtifactId : run.slotBArtifactId;
    const afterArtifactId =
      args.afterSlot === "a" ? run.slotAArtifactId : run.slotBArtifactId;
    await Promise.all([
      getOwnedArtifact(ctx, userId, beforeArtifactId),
      getOwnedArtifact(ctx, userId, afterArtifactId),
    ]);
    const duplicate = events.find(
      (event) =>
        event.eventType === "correction_recorded" &&
        event.correction?.classification === args.classification &&
        event.correction.note === note &&
        event.correction.beforeArtifactId === beforeArtifactId &&
        event.correction.afterArtifactId === afterArtifactId &&
        event.correction.dimensions.length === dimensions.length &&
        event.correction.dimensions.every(
          (dimension, index) => dimension === dimensions[index],
        ),
    );
    if (duplicate) {
      return { createdAt: duplicate.createdAt, idempotent: true };
    }
    const createdAt = Date.now();

    await ctx.db.insert("tasteBenchEvents", {
      userId,
      runId: run._id,
      eventId: makeEventId(run._id, sequence, "correction_recorded"),
      sequence,
      eventType: "correction_recorded",
      correction: {
        classification: args.classification,
        note,
        dimensions,
        beforeArtifactId,
        afterArtifactId,
      },
      createdAt,
    });
    return { createdAt, idempotent: false };
  },
});

export const abandonTasteBenchRun = mutation({
  args: { runId: v.id("tasteBenchRuns"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireTasteBenchUserId(ctx);
    const run = await getOwnedRun(ctx, userId, args.runId);
    const events = await getRunEvents(ctx, run._id);
    const sequence = events.length + 1;
    const stateEvent: TasteBenchStateEvent = {
      eventType: "run_abandoned",
      sequence,
    };
    assertTasteBenchEventCanAppend(toStateEvents(events), stateEvent);
    const abandonReason = args.reason?.trim()
      ? normalizeTasteBenchReason(args.reason, "Abandon reason")
      : undefined;
    const createdAt = Date.now();
    await ctx.db.insert("tasteBenchEvents", {
      userId,
      runId: run._id,
      eventId: makeEventId(run._id, sequence, "run_abandoned"),
      sequence,
      eventType: "run_abandoned",
      abandonReason,
      createdAt,
    });
    return { createdAt };
  },
});

export const listMyTasteBenchEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const events = await ctx.db
      .query("tasteBenchEvents")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    return events.map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      comparison: event.comparison,
      correction: event.correction
        ? {
            classification: event.correction.classification,
            note: event.correction.note,
            dimensions: event.correction.dimensions,
          }
        : undefined,
      operational: event.operational
        ? {
            subjectRef: event.operational.subjectRef,
            detail: event.operational.detail,
            dimensions: event.operational.dimensions,
            source: event.operational.source,
          }
        : undefined,
      abandonReason: event.abandonReason,
      createdAt: event.createdAt,
    }));
  },
});
