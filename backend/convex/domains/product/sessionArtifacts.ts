/**
 * Session Artifacts — backend for the batched end-of-session review.
 *
 * Pattern: agent-generated candidates accumulate in a "pending" bucket during
 *          a chat session. User decides at wrap-up: keep / dismiss / skip.
 *
 * Prior art:
 *   - Claude Code — "files changed" summary at task end
 *   - Perplexity Lab — live artifacts right-rail
 *   - Cursor Composer — review edits before commit
 *
 * See: .claude/rules/scratchpad_first.md
 *      .claude/rules/async_reliability.md
 *      .claude/rules/agentic_reliability.md  (HONEST_STATUS, BOUND)
 *      docs/architecture/AGENT_PIPELINE.md
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

/**
 * Max artifacts the live panel ever shows for one session. Prevents an agent
 * loop from flooding the panel (BOUND rule). If a session legitimately
 * produces more, older ones fall off the visible list but remain queryable
 * by an admin.
 */
const MAX_PANEL_ARTIFACTS = 50;

/**
 * List all artifacts for a session, grouped by status. Used by the live panel
 * during an active chat and by the wrap-up modal.
 *
 * Scenario: a user is mid-chat — panel shows N pending items with checkboxes.
 * At wrap-up, same data powers the modal grouped by keep/dismiss/pending.
 */
export const listForSession = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sessionArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(MAX_PANEL_ARTIFACTS);

    // Group by status for the UI. Deterministic ordering within each bucket
    // by createdAt descending — so newly-emitted candidates appear on top.
    const pending: typeof rows = [];
    const kept: typeof rows = [];
    const auto: typeof rows = [];
    const dismissed: typeof rows = [];
    for (const row of rows) {
      if (row.status === "pending") pending.push(row);
      else if (row.status === "kept") kept.push(row);
      else if (row.status === "auto") auto.push(row);
      else if (row.status === "dismissed") dismissed.push(row);
    }

    return {
      pending,
      kept,
      auto,
      dismissed,
      total: rows.length,
      /** The panel chip shows this count. */
      pendingCount: pending.length,
      /** The pending-strip on Reports shows this count across all user sessions. */
      truncated: rows.length === MAX_PANEL_ARTIFACTS,
    };
  },
});

/**
 * Count pending artifacts across all sessions owned by the current user (or
 * anonymous session). Powers the "N artifacts awaiting a decision" strip at
 * the top of the Reports grid.
 */
export const pendingCountForViewer = query({
  args: {
    userId: v.optional(v.id("users")),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // HONEST_STATUS: if neither identifier is supplied, return 0 rather than
    // silently leaking another user's counts.
    if (!args.userId && !args.anonymousSessionId) return 0;

    // Prefer authenticated user records. Fall back to anonymous session.
    const byUser = args.userId
      ? await ctx.db
          .query("sessionArtifacts")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .filter((q) => q.eq(q.field("status"), "pending"))
          .take(500) // bounded read
      : [];
    const byAnon =
      args.anonymousSessionId && !args.userId
        ? await ctx.db
            .query("sessionArtifacts")
            .withIndex("by_anonymous", (q) =>
              q.eq("anonymousSessionId", args.anonymousSessionId),
            )
            .filter((q) => q.eq(q.field("status"), "pending"))
            .take(500)
        : [];
    return byUser.length + byAnon.length;
  },
});

/**
 * Create a session artifact in pending state. Called by the agent pipeline
 * after a sub-agent's structured output passes its verification gates.
 *
 * BOUND: caller throws if the session already has > MAX_PANEL_ARTIFACTS
 * pending records — downstream orchestrator must consolidate instead of
 * spamming.
 */
export const createArtifact = mutation({
  args: {
    sessionId: v.string(),
    userId: v.optional(v.id("users")),
    anonymousSessionId: v.optional(v.string()),
    artifactKind: v.union(
      v.literal("company"),
      v.literal("founder"),
      v.literal("product"),
      v.literal("funding"),
      v.literal("news"),
      v.literal("hiring"),
      v.literal("patent"),
      v.literal("publicOpinion"),
      v.literal("competitor"),
      v.literal("regulatory"),
      v.literal("memo"),
    ),
    displayName: v.string(),
    summary: v.optional(v.string()),
    confidenceTier: v.optional(
      v.union(
        v.literal("verified"),
        v.literal("corroborated"),
        v.literal("single-source"),
        v.literal("unverified"),
      ),
    ),
    sourceCount: v.optional(v.number()),
    sourceLabel: v.optional(v.string()),
    scratchpadRunId: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessionArtifacts")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "pending"),
      )
      .take(MAX_PANEL_ARTIFACTS);
    if (existing.length >= MAX_PANEL_ARTIFACTS) {
      // HONEST_STATUS: refuse rather than silently dropping
      throw new Error(
        `session ${args.sessionId} already has ${existing.length} pending artifacts (cap ${MAX_PANEL_ARTIFACTS}). Consolidate before adding more.`,
      );
    }

    const now = Date.now();
    return await ctx.db.insert("sessionArtifacts", {
      sessionId: args.sessionId,
      userId: args.userId,
      anonymousSessionId: args.anonymousSessionId,
      artifactKind: args.artifactKind,
      displayName: args.displayName,
      summary: args.summary,
      confidenceTier: args.confidenceTier,
      sourceCount: args.sourceCount,
      sourceLabel: args.sourceLabel,
      status: "pending",
      scratchpadRunId: args.scratchpadRunId,
      payload: args.payload,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Keep an artifact — promotes to a standalone entity Report.
 * The actual Report creation is deferred to the attribution pipeline; this
 * mutation only records the user's intent + the resulting entity slug.
 */
export const keepArtifact = mutation({
  args: {
    artifactId: v.id("sessionArtifacts"),
    promotedEntitySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      status: "kept",
      promotedEntitySlug: args.promotedEntitySlug,
      reviewedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Dismiss an artifact — stays in session context but does NOT become a
 * standalone Report. Decision is reversible — user can re-open from history.
 */
export const dismissArtifact = mutation({
  args: { artifactId: v.id("sessionArtifacts") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      status: "dismissed",
      reviewedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Bulk keep — used by "Keep verified ones" button in the wrap-up modal.
 * Only flips pending artifacts with verified tier; other states untouched.
 * Idempotent — running twice has the same effect as running once.
 */
export const keepAllVerified = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("sessionArtifacts")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "pending"),
      )
      .take(MAX_PANEL_ARTIFACTS);

    const now = Date.now();
    let flipped = 0;
    for (const row of pending) {
      if (row.confidenceTier === "verified") {
        await ctx.db.patch(row._id, {
          status: "kept",
          reviewedAt: now,
          updatedAt: now,
        });
        flipped++;
      }
    }
    return { flipped };
  },
});

/**
 * Bulk dismiss-all — user chose "Dismiss all" at the wrap-up modal.
 * Only affects pending artifacts.
 */
export const dismissAllPending = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("sessionArtifacts")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "pending"),
      )
      .take(MAX_PANEL_ARTIFACTS);

    const now = Date.now();
    for (const row of pending) {
      await ctx.db.patch(row._id, {
        status: "dismissed",
        reviewedAt: now,
        updatedAt: now,
      });
    }
    return { dismissed: pending.length };
  },
});

/**
 * Reverse a previous decision — moves `kept` or `dismissed` back to `pending`.
 * Supports the "wait, let me re-review" use case.
 */
export const undoDecision = mutation({
  args: { artifactId: v.id("sessionArtifacts") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artifactId);
    if (!row) return { reverted: false };
    if (row.status === "pending") return { reverted: false };
    const now = Date.now();
    await ctx.db.patch(args.artifactId, {
      status: "pending",
      reviewedAt: undefined,
      updatedAt: now,
    });
    return { reverted: true };
  },
});
