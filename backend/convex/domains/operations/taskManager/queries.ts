/**
 * Task Manager Queries
 *
 * Provides public and authenticated queries for task sessions, traces, and spans.
 * Only deliberately public sessions are exposed without authentication.
 */

import { v } from "convex/values";
import { query } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { buildTaskSessionProofPack } from "./proofPack";
import { buildAgentResponseFlywheelSnapshot } from "../../agents/responseFlywheel";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PUBLIC QUERIES (Unauthenticated Access)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Get public task sessions (for cron job monitoring, public demos)
 * No authentication required - returns only visibility: "public" sessions
 */
export const getPublicTaskSessions = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    )),
    type: v.optional(v.union(
      v.literal("cron"),
      v.literal("scheduled"),
      v.literal("agent"),
      v.literal("swarm"),
    )),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Query public sessions by visibility index
    let sessionsQuery = ctx.db
      .query("agentTaskSessions")
      .withIndex("by_visibility_date", (q) => q.eq("visibility", "public"))
      .order("desc");

    const sessions = await sessionsQuery.take(limit + 1);

    // Apply filters in memory (Convex doesn't support complex compound filters)
    let filtered = sessions.filter((s) => {
      if (args.status && s.status !== args.status) return false;
      if (args.type && s.type !== args.type) return false;
      if (args.dateFrom && s.startedAt < args.dateFrom) return false;
      if (args.dateTo && s.startedAt > args.dateTo) return false;
      return true;
    });

    const hasMore = filtered.length > limit;
    if (hasMore) filtered = filtered.slice(0, limit);

    return {
      sessions: filtered.map((s) => ({
        _id: s._id,
        title: s.title,
        description: s.description,
        type: s.type,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        totalDurationMs: s.totalDurationMs,
        totalTokens: s.totalTokens,
        cronJobName: s.cronJobName,
        toolsUsed: s.toolsUsed,
        agentsInvolved: s.agentsInvolved,
        errorMessage: s.errorMessage,
      })),
      hasMore,
      nextCursor: hasMore ? filtered[filtered.length - 1]?._id : undefined,
    };
  },
});

/**
 * Get cron job execution history for the authenticated owner.
 */
export const getCronJobHistory = query({
  args: {
    cronJobName: v.optional(v.string()),
    limit: v.optional(v.number()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) {
      return { sessions: [], byCronJob: {}, totalRuns: 0, successCount: 0, failureCount: 0 };
    }
    const userId = await getSafeUserId(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 200));
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(500, limit * 3));

    // Apply date filters
    const filtered = sessions.filter((s) => {
      if (s.type !== "cron") return false;
      if (args.cronJobName && s.cronJobName !== args.cronJobName) return false;
      if (args.dateFrom && s.startedAt < args.dateFrom) return false;
      if (args.dateTo && s.startedAt > args.dateTo) return false;
      return true;
    }).slice(0, limit);

    // Group by cron job name for summary
    const byCronJob = new Map<string, typeof filtered>();
    for (const session of filtered) {
      const key = session.cronJobName ?? "unknown";
      if (!byCronJob.has(key)) byCronJob.set(key, []);
      byCronJob.get(key)!.push(session);
    }

    return {
      sessions: filtered,
      byCronJob: Object.fromEntries(byCronJob),
      totalRuns: filtered.length,
      successCount: filtered.filter((s) => s.status === "completed").length,
      failureCount: filtered.filter((s) => s.status === "failed").length,
    };
  },
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AUTHENTICATED QUERIES (User-specific)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Utility function to safely extract and validate user ID from authentication
 */
async function getSafeUserId(ctx: any): Promise<Id<"users">> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) {
    throw new Error("Not authenticated");
  }

  // Handle malformed user IDs with pipe characters
  let userId: Id<"users">;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const userIdPart = rawUserId.split("|")[0];
    if (!userIdPart || userIdPart.length < 10) {
      throw new Error("Invalid user ID format. Please sign out and sign back in.");
    }
    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  return userId;
}

/**
 * Get task sessions for the authenticated user
 */
export const getUserTaskSessions = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    )),
    type: v.optional(v.union(
      v.literal("manual"),
      v.literal("cron"),
      v.literal("scheduled"),
      v.literal("agent"),
      v.literal("swarm"),
    )),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Return empty for unauthenticated users (guest mode)
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) {
      return { sessions: [], hasMore: false, nextCursor: null };
    }
    const userId = await getSafeUserId(ctx);
    const limit = args.limit ?? 50;

    // Query user sessions by user_date index
    const sessionsQuery = ctx.db
      .query("agentTaskSessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc");

    const sessions = await sessionsQuery.take(limit + 1);

    // Apply filters
    let filtered = sessions.filter((s) => {
      if (args.status && s.status !== args.status) return false;
      if (args.type && s.type !== args.type) return false;
      if (args.dateFrom && s.startedAt < args.dateFrom) return false;
      if (args.dateTo && s.startedAt > args.dateTo) return false;
      return true;
    });

    const hasMore = filtered.length > limit;
    if (hasMore) filtered = filtered.slice(0, limit);

    return {
      sessions: filtered,
      hasMore,
      nextCursor: hasMore ? filtered[filtered.length - 1]?._id : undefined,
    };
  },
});

/**
 * Get detailed view of a specific task session with all traces
 */
export const getTaskSessionDetail = query({
  args: {
    sessionId: v.id("agentTaskSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId) as Doc<"agentTaskSessions"> | null;

    if (!session) {
      return null;
    }

    // Check authorization - public sessions are accessible to all
    if (session.visibility === "private") {
      const userId = await getSafeUserId(ctx);
      if (session.userId !== userId) {
        throw new Error("Not authorized to view this session");
      }
    }

    // Get all traces for this session
    const traces = await ctx.db
      .query("agentTaskTraces")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    const proofPack = buildTaskSessionProofPack(session, traces);

    return {
      session,
      traces,
      traceCount: traces.length,
      proofPack,
    };
  },
});

/**
 * Get spans for a specific trace (for telemetry detail view)
 */
export const getTraceSpans = query({
  args: {
    traceId: v.id("agentTaskTraces"),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db.get(args.traceId) as Doc<"agentTaskTraces"> | null;

    if (!trace) {
      return null;
    }

    // Check authorization via the parent session
    const session = await ctx.db.get(trace.sessionId) as Doc<"agentTaskSessions"> | null;
    if (!session) {
      return null;
    }

    if (session.visibility === "private") {
      const userId = await getSafeUserId(ctx);
      if (session.userId !== userId) {
        throw new Error("Not authorized to view this trace");
      }
    }

    // Get all spans for this trace, ordered by sequence
    const spans = await ctx.db
      .query("agentTaskSpans")
      .withIndex("by_trace", (q) => q.eq("traceId", args.traceId))
      .order("asc")
      .collect();

    // Build hierarchy tree
    const rootSpans = spans.filter((s) => !s.parentSpanId);
    const childrenByParent = new Map<string, typeof spans>();

    for (const span of spans) {
      if (span.parentSpanId) {
        const parentId = span.parentSpanId as string;
        if (!childrenByParent.has(parentId)) {
          childrenByParent.set(parentId, []);
        }
        childrenByParent.get(parentId)!.push(span);
      }
    }

    return {
      trace,
      spans,
      rootSpans,
      childrenByParent: Object.fromEntries(childrenByParent),
      spanCount: spans.length,
    };
  },
});

type DogfoodVerdict = "missing" | "watch" | "fail" | "pass";

function getDogfoodVerdict(run: Doc<"dogfoodQaRuns"> | null): {
  verdict: DogfoodVerdict;
  label: string;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  totalIssues: number;
} {
  if (!run) {
    return {
      verdict: "missing",
      label: "No dogfood evidence",
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
      totalIssues: 0,
    };
  }

  const p0 = run.issues.filter((issue) => issue.severity === "p0").length;
  const p1 = run.issues.filter((issue) => issue.severity === "p1").length;
  const p2 = run.issues.filter((issue) => issue.severity === "p2").length;
  const p3 = run.issues.filter((issue) => issue.severity === "p3").length;
  const totalIssues = run.issues.length;
  const verdict: DogfoodVerdict =
    p0 > 0 ? "fail" : p1 > 0 ? "watch" : run.issues.length > 0 ? "watch" : "pass";

  return {
    verdict,
    label:
      verdict === "pass"
        ? "Dogfood clear"
        : verdict === "fail"
          ? "Dogfood blocked"
          : "Dogfood watch",
    p0,
    p1,
    p2,
    p3,
    totalIssues,
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const getOracleControlTowerSnapshot = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 6, 12));
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) return null;
    const userId = await getSafeUserId(ctx);

    const recentSessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    const latestDogfoodRun = (
      await ctx.db
        .query("dogfoodQaRuns")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
        .order("desc")
        .take(1)
    )[0] ?? null;

    const pendingConfirmations = (
      await ctx.db
        .query("actionDrafts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(20)
    ).filter((draft) => draft.status === "pending" && draft.expiresAt > Date.now());

    const sessionsWithTraces = await Promise.all(
      recentSessions.map(async (session) => {
        const traces = await ctx.db
          .query("agentTaskTraces")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .order("desc")
          .take(6);

        const topToolSequence = uniqueStrings([
          ...(session.toolsUsed ?? []),
          ...traces.flatMap((trace) => {
            const sequence = trace.metadata?.toolSequence;
            return Array.isArray(sequence) ? sequence.filter((value): value is string => typeof value === "string") : [];
          }),
        ]).slice(0, 6);

        const traceTimeline = traces
          .slice()
          .reverse()
          .map((trace) => ({
            _id: String(trace._id),
            traceId: trace.traceId,
            workflowName: trace.workflowName,
            status: trace.status,
            startedAt: trace.startedAt,
            totalDurationMs: trace.totalDurationMs ?? 0,
            totalTokens: trace.tokenUsage?.total ?? 0,
            estimatedCostUsd: trace.estimatedCostUsd ?? 0,
            crossCheckStatus: trace.crossCheckStatus,
            deltaFromVision: trace.deltaFromVision,
            toolSequence: Array.isArray(trace.metadata?.toolSequence)
              ? trace.metadata.toolSequence.filter((value: unknown): value is string => typeof value === "string")
              : [],
          }));

        return {
          _id: String(session._id),
          title: session.title,
          description: session.description,
          status: session.status,
          type: session.type,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          totalDurationMs: session.totalDurationMs ?? 0,
          totalTokens: session.totalTokens ?? 0,
          estimatedCostUsd:
            session.estimatedCostUsd ??
            traces.reduce((sum, trace) => sum + (trace.estimatedCostUsd ?? 0), 0),
          goalId: session.goalId,
          visionSnapshot: session.visionSnapshot,
          successCriteria: session.successCriteria ?? [],
          sourceRefs: session.sourceRefs ?? [],
          crossCheckStatus: session.crossCheckStatus,
          deltaFromVision: session.deltaFromVision,
          dogfoodRunId: session.dogfoodRunId ? String(session.dogfoodRunId) : undefined,
          toolsUsed: session.toolsUsed ?? [],
          traceCount: traces.length,
          traceTimeline,
          topToolSequence,
        };
      }),
    );

    const allTraces = sessionsWithTraces.flatMap((session) => session.traceTimeline);
    const violatedCount = sessionsWithTraces.filter((session) => session.crossCheckStatus === "violated").length;
    const driftingCount = sessionsWithTraces.filter((session) => session.crossCheckStatus === "drifting").length;
    const failedSessions = sessionsWithTraces.filter((session) => session.status === "failed").length;
    const avgLatencyMs =
      allTraces.length > 0
        ? Math.round(allTraces.reduce((sum, trace) => sum + (trace.totalDurationMs || 0), 0) / allTraces.length)
        : 0;

    const dogfood = getDogfoodVerdict(latestDogfoodRun);
    const hasAlignmentEvidence =
      dogfood.verdict === "pass" ||
      sessionsWithTraces.some(
        (session) => session.crossCheckStatus === "aligned" && session.traceCount > 0,
      );
    const institutionalVerdict =
      violatedCount > 0 || dogfood.verdict === "fail"
        ? "institutional_hallucination_risk"
        : driftingCount > 0 || dogfood.verdict === "watch"
          ? "watch"
          : hasAlignmentEvidence
            ? "institutional_memory_aligned"
            : "unmeasured";

    const openFailures = [
      ...sessionsWithTraces
        .filter((session) => session.status === "failed")
        .slice(0, 2)
        .map((session) => ({
          kind: "session_failure",
          title: session.title,
          detail: session.description ?? session.deltaFromVision ?? "Task session failed without a summary.",
        })),
      ...sessionsWithTraces
        .filter((session) => session.crossCheckStatus === "violated")
        .slice(0, 2)
        .map((session) => ({
          kind: "vision_violation",
          title: `${session.title} drifted from the original idea`,
          detail: session.deltaFromVision ?? "Cross-check marked this session as violated.",
        })),
    ];

    const responseFlywheel = await buildAgentResponseFlywheelSnapshot(ctx, userId);

    let nextRecommendedAction =
      "Continue the highest-priority owned session and attach runtime evidence before marking it complete.";
    if (sessionsWithTraces.length === 0) {
      nextRecommendedAction =
        "Start an owned session and attach runtime evidence before drawing an operational conclusion.";
    } else if (violatedCount > 0) {
      nextRecommendedAction =
        "Repair violated loops first. Tighten the vision snapshot, restate the success criteria in plain English, and rerun dogfood before shipping more code.";
    } else if (pendingConfirmations.length > 0) {
      nextRecommendedAction =
        "Review the pending write approvals so the zero-draft lane can continue without blocking on confirmation debt.";
    } else if (dogfood.verdict === "missing") {
      nextRecommendedAction =
        "Attach a fresh dogfood run to the active session so the control tower has proof, not just intent.";
    } else if (
      responseFlywheel.summary.weakestDimension &&
      responseFlywheel.summary.weakestDimension.averageScore < 0.62
    ) {
      nextRecommendedAction =
        `Tighten the response flywheel first. ${responseFlywheel.summary.weakestDimension.label} is the weakest lane, so re-judge recent replies and strengthen evidence, dates, and concrete next actions.`;
    }

    return {
      summary: {
        activeSessions: sessionsWithTraces.filter((session) => session.status === "running" || session.status === "pending").length,
        violatedCount,
        driftingCount,
        failedSessions,
        pendingConfirmations: pendingConfirmations.length,
        totalTokens: sessionsWithTraces.reduce((sum, session) => sum + session.totalTokens, 0),
        totalCostUsd: sessionsWithTraces.reduce((sum, session) => sum + session.estimatedCostUsd, 0),
        avgLatencyMs,
        institutionalVerdict,
      },
      latestDogfood: latestDogfoodRun
        ? {
            _id: String(latestDogfoodRun._id),
            createdAt: latestDogfoodRun.createdAt,
            source: latestDogfoodRun.source,
            model: latestDogfoodRun.model,
            summary: latestDogfoodRun.summary,
            verdict: dogfood.verdict,
            label: dogfood.label,
            p0: dogfood.p0,
            p1: dogfood.p1,
            p2: dogfood.p2,
            p3: dogfood.p3,
            totalIssues: dogfood.totalIssues,
          }
        : null,
      pendingConfirmations: pendingConfirmations.slice(0, 5).map((draft) => ({
        _id: String(draft._id),
        toolName: draft.toolName,
        riskTier: draft.riskTier,
        actionSummary: draft.actionSummary,
        createdAt: draft.createdAt,
        expiresAt: draft.expiresAt,
      })),
      openFailures,
      recentSessions: sessionsWithTraces,
      temporalOs: null,
      successLoops: null,
      responseFlywheel,
      nextRecommendedAction,
    };
  },
});

// ── Separate query: industry metrics ─────────────────────────────────────
// Isolated from the main snapshot so a failure here never crashes the Oracle.
// Uses bounded reads (.take) and index-based queries where available.
export const getIndustryMetrics = query({
  args: {},
  handler: async (ctx) => {
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) return null;
    const userId = await getSafeUserId(ctx);
    const now = Date.now();
    const dayAgo = now - 86_400_000;
    const weekAgo = now - 7 * 86_400_000;
    const sampledSessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(12);
    const sampledTraces = (
      await Promise.all(sampledSessions.map((session) =>
        ctx.db
          .query("agentTaskTraces")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .order("desc")
          .take(4),
      ))
    ).flat();
    const sampledAuditEntries = (
      await Promise.all(sampledTraces.map((trace) =>
        ctx.db
          .query("traceAuditEntries")
          .withIndex("by_user_execution", (q) =>
            q.eq("userId", userId).eq("executionId", trace.traceId),
          )
          .take(50),
      ))
    ).flat();
    const weekToolCalls = sampledAuditEntries
      .filter((entry) => entry.timestamp >= weekAgo)
      .map((entry) => ({
        toolName: entry.toolName,
        success: entry.metadata.success,
        durationMs: entry.metadata.durationMs,
        timestamp: entry.timestamp,
      }));
    const recentToolCalls = weekToolCalls.filter((entry) => entry.timestamp >= dayAgo);
    const sourceRefKeys = new Set(
      [...sampledSessions.flatMap((session) => session.sourceRefs ?? []),
       ...sampledTraces.flatMap((trace) => trace.sourceRefs ?? [])]
        .map((ref) => `${ref.label}|${ref.href ?? ""}`),
    );
    const evidenceAttachmentCount = sampledTraces.reduce((count, trace) => {
      const evidence = trace.metadata?.executionTraceEvidence;
      return count + (Array.isArray(evidence) ? evidence.length : 0);
    }, 0);

    // Tool call stats
    const successfulCalls = recentToolCalls.filter((c) => c.success);
    const failedCalls = recentToolCalls.filter((c) => !c.success);
    const avgToolDurationMs =
      recentToolCalls.length > 0
        ? Math.round(
            recentToolCalls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / recentToolCalls.length,
          )
        : 0;

    // Top tools by frequency (last 24h)
    const toolFreq: Record<string, number> = {};
    for (const call of recentToolCalls) {
      toolFreq[call.toolName] = (toolFreq[call.toolName] ?? 0) + 1;
    }
    const topToolsByFrequency = Object.entries(toolFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    return {
      scope: "authenticated_owner" as const,
      toolCalls: {
        last24h: recentToolCalls.length,
        sampleCount: recentToolCalls.length,
        successRate24h:
          recentToolCalls.length > 0
            ? Math.round((successfulCalls.length / recentToolCalls.length) * 100)
            : null,
        failedLast24h: failedCalls.length,
        avgDurationMs: recentToolCalls.length > 0 ? avgToolDurationMs : null,
        sampledWeek: weekToolCalls.length,
        topTools: topToolsByFrequency,
      },
      evidence: {
        sourceRefCount: sourceRefKeys.size,
        attachmentCount: evidenceAttachmentCount,
        traceSampleCount: sampledTraces.length,
      },
      sessions: {
        sampleCount: sampledSessions.length,
        completed: sampledSessions.filter((session) => session.status === "completed").length,
        failed: sampledSessions.filter((session) => session.status === "failed").length,
      },
    };
  },
});
