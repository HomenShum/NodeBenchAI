import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { internalMutation, mutation } from "../../../_generated/server";
import {
  NODEKIT_RUN_MAX_EVENTS,
  NODEKIT_RUN_RETENTION_MS,
  NodeKitRunContractError,
  appendNodeKitRunEvent,
  verifyNodeKitRunEventPrefix,
  type NodeKitRunEvent,
  type NodeKitSafeEventPayload,
} from "./nodeKitRunEvents";

const RETENTION_TERMINAL_BATCH = 128;
const RETENTION_DELETE_BUDGET = NODEKIT_RUN_MAX_EVENTS * 4;
const STALE_TRACE_BATCH = 16;
const RETENTION_CONTINUATION_DELAY_MS = 1_000;

class ConvexError<T extends Record<string, unknown>> extends Error {
  readonly data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

function boundaryError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function requireOwnerId(ctx: unknown): Promise<Id<"users">> {
  const raw = await getAuthUserId(ctx as never);
  const normalized =
    typeof raw === "string" && raw.includes("|") ? raw.split("|")[0] : raw;
  if (!normalized) {
    boundaryError("not_authenticated", "Authentication is required.");
  }
  return normalized as Id<"users">;
}

function asRunEvent(event: Record<string, unknown>): NodeKitRunEvent {
  return {
    contractVersion:
      event.contractVersion as NodeKitRunEvent["contractVersion"],
    runId: event.runId as string,
    sequence: event.sequence as number,
    eventType: event.eventType as NodeKitRunEvent["eventType"],
    recordedAt: event.recordedAt as number,
    payload: event.payload as NodeKitSafeEventPayload,
    previousHash: event.previousHash as string,
    contentHash: event.contentHash as string,
  };
}

async function loadBoundedTraceEvents(
  ctx: { db: any },
  traceId: Id<"agentTaskTraces">,
) {
  const events = await ctx.db
    .query("nodeKitRunEvents")
    .withIndex("by_trace_sequence", (q: any) => q.eq("traceId", traceId))
    .order("asc")
    .take(NODEKIT_RUN_MAX_EVENTS + 1);
  if (events.length > NODEKIT_RUN_MAX_EVENTS) {
    boundaryError(
      "event_limit_exceeded",
      "Run history exceeds the bounded retention contract.",
    );
  }
  return events;
}

async function markTraceAndSpansError(
  ctx: { db: any },
  trace: Record<string, any>,
  now: number,
): Promise<boolean> {
  const spans = await ctx.db
    .query("agentTaskSpans")
    .withIndex("by_trace_status", (q: any) =>
      q.eq("traceId", trace._id).eq("status", "running"),
    )
    .order("asc")
    .take(NODEKIT_RUN_MAX_EVENTS + 1);
  const hasMoreSpans = spans.length > NODEKIT_RUN_MAX_EVENTS;
  for (const span of spans.slice(0, NODEKIT_RUN_MAX_EVENTS)) {
    await ctx.db.patch(span._id, {
      status: "error",
      endedAt: now,
      durationMs: Math.max(0, now - span.startedAt),
      error: {
        message: "Stale NodeKit run closed by retention maintenance.",
        code: "stale_run_timeout",
      },
    });
  }
  if (hasMoreSpans) return false;
  await ctx.db.patch(trace._id, {
    status: "error",
    endedAt: now,
    totalDurationMs: Math.max(0, now - trace.startedAt),
  });
  return true;
}

async function closeStaleTrace(
  ctx: { db: any },
  trace: Record<string, any>,
  now: number,
): Promise<"closed" | "corrupt_purged" | "pending"> {
  const session = await ctx.db.get(trace.sessionId);
  const storedEvents = await loadBoundedTraceEvents(ctx, trace._id);
  const ownershipValid =
    session &&
    storedEvents.length > 0 &&
    storedEvents.every(
      (event: Record<string, any>) =>
        event.traceId === trace._id &&
        event.sessionId === session._id &&
        event.userId === session.userId &&
        event.runId === trace.traceId,
    );

  let prefix:
    | Awaited<ReturnType<typeof verifyNodeKitRunEventPrefix>>
    | undefined;
  if (ownershipValid) {
    try {
      prefix = await verifyNodeKitRunEventPrefix(
        storedEvents.map(asRunEvent),
        trace.traceId,
      );
    } catch (error) {
      if (!(error instanceof NodeKitRunContractError)) throw error;
    }
  }

  if (!prefix || prefix.terminalEventType !== null) {
    for (const event of storedEvents) {
      await ctx.db.delete(event._id);
    }
    const maintenanceComplete = await markTraceAndSpansError(ctx, trace, now);
    return maintenanceComplete ? "corrupt_purged" : "pending";
  }

  let recordedAt = Math.max(
    now,
    storedEvents[storedEvents.length - 1].recordedAt,
  );
  for (const nodeRunId of prefix.openNodeRunIds) {
    const startedEvent = [...storedEvents]
      .reverse()
      .find(
        (event: Record<string, any>) =>
          event.eventType === "node.started" &&
          event.payload?.fields?.nodeRunId === nodeRunId,
      );
    if (!startedEvent) {
      throw new NodeKitRunContractError(
        "graph_node_start_missing",
        `Open graph node ${nodeRunId} has no start event.`,
      );
    }
    const fields = startedEvent.payload.fields;
    await appendNodeKitRunEvent(ctx as never, {
      sessionId: session._id,
      traceId: trace._id,
      userId: session.userId,
      runId: trace.traceId,
      eventType: "node.failed",
      recordedAt,
      payload: {
        graphId: fields.graphId,
        graphHash: fields.graphHash,
        caseId: fields.caseId,
        stageId: fields.stageId,
        caseContentHash: fields.caseContentHash,
        nodeId: fields.nodeId,
        nodeRunId,
        status: "error",
        reasonCode: "stale_run_timeout",
      },
      allowLegacySkip: false,
    });
  }
  for (const spanId of prefix.openSpanIds) {
    const span = await ctx.db.get(spanId as Id<"agentTaskSpans">);
    const durationMs =
      span && span.traceId === trace._id && typeof span.startedAt === "number"
        ? Math.max(0, recordedAt - span.startedAt)
        : 0;
    await appendNodeKitRunEvent(ctx as never, {
      sessionId: session._id,
      traceId: trace._id,
      userId: session.userId,
      runId: trace.traceId,
      eventType: "span.completed",
      recordedAt,
      payload: {
        spanId,
        status: "error",
        durationMs,
      },
      allowLegacySkip: false,
    });
  }
  recordedAt = Math.max(recordedAt, now);
  await appendNodeKitRunEvent(ctx as never, {
    sessionId: session._id,
    traceId: trace._id,
    userId: session.userId,
    runId: trace.traceId,
    eventType: "run.failed",
    recordedAt,
    payload: {
      status: "error",
      totalDurationMs: Math.max(0, recordedAt - trace.startedAt),
    },
    allowLegacySkip: false,
  });
  const maintenanceComplete = await markTraceAndSpansError(
    ctx,
    trace,
    recordedAt,
  );
  return maintenanceComplete ? "closed" : "pending";
}

/**
 * Privacy deletion for an owner-scoped terminal run.
 *
 * Events are immutable while retained, but they are not immortal. Deleting the
 * complete chain deliberately makes future export fail as a legacy/expired run.
 */
export const deleteOwnedNodeKitRunHistory = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const trace = await ctx.db.get(args.traceId);
    if (!trace) {
      boundaryError("trace_not_found", "Trace not found or unauthorized.");
    }
    const session = await ctx.db.get(trace.sessionId);
    if (!session || session.userId !== ownerId) {
      boundaryError("trace_not_found", "Trace not found or unauthorized.");
    }
    if (trace.status === "running") {
      boundaryError(
        "run_not_terminal",
        "Running trace history cannot be deleted.",
      );
    }
    const events = await ctx.db
      .query("nodeKitRunEvents")
      .withIndex("by_trace_sequence", (q) => q.eq("traceId", args.traceId))
      .order("asc")
      .take(NODEKIT_RUN_MAX_EVENTS + 1);
    if (events.length > NODEKIT_RUN_MAX_EVENTS) {
      boundaryError(
        "event_limit_exceeded",
        "Run history exceeds the bounded deletion contract.",
      );
    }
    for (const event of events) {
      if (event.userId !== ownerId || event.sessionId !== session._id) {
        boundaryError(
          "event_ownership_mismatch",
          "Stored event ownership does not match the trace.",
        );
      }
    }
    for (const event of events) {
      await ctx.db.delete(event._id);
    }
    return { deleted: events.length };
  },
});

/**
 * Bounded retention sweep.
 *
 * Only terminal events carry expiry timestamps, and terminal-type indexes keep
 * legacy nonterminal expiry rows from starving eligible runs. Stale running
 * traces are explicitly failed (including open spans) before their terminal
 * event starts the retention clock. Corrupt stale chains are removed rather
 * than being converted into forged complete receipts.
 */
export const purgeExpiredNodeKitRunEvents = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    skippedRunning: v.number(),
    staleScanned: v.number(),
    staleClosed: v.number(),
    staleCorruptPurged: v.number(),
    stalePending: v.number(),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const expiredByType = await Promise.all(
      (["run.completed", "run.failed"] as const).map((eventType) =>
        ctx.db
          .query("nodeKitRunEvents")
          .withIndex("by_type_retention_expiration", (q) =>
            q.eq("eventType", eventType).lte("retentionExpiresAt", now),
          )
          .order("asc")
          .take(RETENTION_TERMINAL_BATCH),
      ),
    );
    const expired = expiredByType
      .flat()
      .sort(
        (left, right) =>
          (left.retentionExpiresAt ?? 0) - (right.retentionExpiresAt ?? 0) ||
          String(left._id).localeCompare(String(right._id)),
      );
    let deleted = 0;
    let skippedRunning = 0;
    let terminalBacklogRemains = false;
    const visitedTraces = new Set<string>();
    for (const candidate of expired) {
      const traceKey = String(candidate.traceId);
      if (visitedTraces.has(traceKey)) continue;
      visitedTraces.add(traceKey);
      const trace = await ctx.db.get(candidate.traceId);
      if (trace?.status === "running") {
        skippedRunning += 1;
        continue;
      }
      const traceEvents = await loadBoundedTraceEvents(ctx, candidate.traceId);
      const terminal = traceEvents[traceEvents.length - 1];
      if (
        !terminal ||
        (terminal.eventType !== "run.completed" &&
          terminal.eventType !== "run.failed") ||
        terminal.retentionExpiresAt === undefined ||
        terminal.retentionExpiresAt > now
      ) {
        continue;
      }
      if (deleted + traceEvents.length > RETENTION_DELETE_BUDGET) {
        terminalBacklogRemains = true;
        break;
      }
      for (const event of traceEvents) {
        await ctx.db.delete(event._id);
      }
      deleted += traceEvents.length;
    }

    const staleBefore = now - NODEKIT_RUN_RETENTION_MS;
    const staleTraces = await ctx.db
      .query("agentTaskTraces")
      .withIndex("by_status_started", (q) =>
        q.eq("status", "running").lte("startedAt", staleBefore),
      )
      .order("asc")
      .take(STALE_TRACE_BATCH);
    let staleClosed = 0;
    let staleCorruptPurged = 0;
    let stalePending = 0;
    for (const trace of staleTraces) {
      const outcome = await closeStaleTrace(ctx, trace, now);
      if (outcome === "closed") staleClosed += 1;
      else if (outcome === "corrupt_purged") staleCorruptPurged += 1;
      else stalePending += 1;
    }

    const continuationScheduled =
      terminalBacklogRemains ||
      (deleted > 0 &&
        expiredByType.some(
          (events) => events.length === RETENTION_TERMINAL_BATCH,
        )) ||
      (staleClosed + staleCorruptPurged > 0 &&
        staleTraces.length === STALE_TRACE_BATCH) ||
      stalePending > 0;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        RETENTION_CONTINUATION_DELAY_MS,
        (internal as any).domains.operations.taskManager.nodeKitRunRetention
          .purgeExpiredNodeKitRunEvents,
        {},
      );
    }
    return {
      scanned: expired.length,
      deleted,
      skippedRunning,
      staleScanned: staleTraces.length,
      staleClosed,
      staleCorruptPurged,
      stalePending,
      continuationScheduled,
    };
  },
});
