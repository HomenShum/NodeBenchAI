/**
 * Realtime voice audit event mutations.
 *
 * Pattern: Append-only audit log for voice gate decisions.
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (RealtimeAuditEvent)
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          — query.take(200) cap on every list
 *   - HONEST_STATUS  — mutations throw when args fail validators (Convex enforces)
 *   - DETERMINISTIC  — decisionHash optional but recommended; pure
 *   - ERROR_BOUNDARY — callers (Express routes) treat failures as non-fatal
 *
 * Routes call these via ConvexHttpClient with graceful fallback:
 *   if (convex unavailable) { route still serves; audit lost — logged once }
 */

import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";

const MAX_RATIONALE_CHARS = 500;
const QUERY_CAP = 200;

export const append = mutation({
  args: {
    userId: v.optional(v.id("users")),
    anonId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    gate: v.union(
      v.literal("anonymous_no_persist"),
      v.literal("anonymous_to_linked"),
      v.literal("budget_cap_hit"),
      v.literal("budget_warning_80pct"),
      v.literal("pii_redacted"),
      v.literal("idempotent_replay"),
      v.literal("escalation_to_async"),
      v.literal("approval_required"),
      v.literal("approval_granted"),
      v.literal("approval_rejected"),
      v.literal("model_routing"),
      v.literal("session_terminated_pii"),
      v.literal("session_terminated_cap"),
    ),
    decision: v.union(
      v.literal("allowed"),
      v.literal("denied"),
      v.literal("needs_consent"),
      v.literal("needs_approval"),
      v.literal("downgraded"),
    ),
    decisionHash: v.optional(v.string()),
    rationale: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        modelTier: v.optional(v.string()),
        capUsd: v.optional(v.number()),
        spentUsd: v.optional(v.number()),
        idempotencyKey: v.optional(v.string()),
        redactedSpanCount: v.optional(v.number()),
        temporalJobId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const rationale = args.rationale?.slice(0, MAX_RATIONALE_CHARS);
    return await ctx.db.insert("realtimeAuditEvents", {
      userId: args.userId,
      anonId: args.anonId,
      sessionId: args.sessionId,
      gate: args.gate,
      decision: args.decision,
      decisionHash: args.decisionHash,
      rationale,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

/**
 * List audit events for a user — bounded to 200 to satisfy BOUND invariant.
 * Used by the dogfood UI (Phase 5-B) to show recent gate decisions.
 */
export const listForUser = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, QUERY_CAP);
    return await ctx.db
      .query("realtimeAuditEvents")
      .withIndex("by_user_recent", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Aggregate gate counts by user — used by the operator dashboard.
 */
export const countByGate = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("realtimeAuditEvents")
      .withIndex("by_user_recent", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(QUERY_CAP);
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.gate] = (counts[e.gate] ?? 0) + 1;
    }
    return { totalEvents: events.length, counts };
  },
});
