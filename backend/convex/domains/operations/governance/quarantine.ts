/**
 * Quarantine — Agent quarantine and incident management.
 * Handles quarantining misbehaving agents, reviewing incidents, and lifting quarantines.
 */

import { query, internalMutation } from "../../../_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quarantine an agent — sets trust tier to quarantined and pauses the agent.
 */
export const quarantineAgent = internalMutation({
  args: {
    agentId: v.string(),
    reason: v.string(),
    incidentDetails: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { agentId, reason }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) return false;

    await ctx.db.patch(identity._id, {
      authorTrustTier: "quarantined",
      status: "paused",
      updatedAt: Date.now(),
    });

    return true;
  },
});

/**
 * Lift quarantine — restores agent to a specified trust tier and reactivates.
 */
export const liftQuarantine = internalMutation({
  args: {
    agentId: v.string(),
    restoreTier: v.union(
      v.literal("verified"),
      v.literal("established"),
      v.literal("new")
    ),
    reviewNotes: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { agentId, restoreTier }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) return false;
    if (identity.authorTrustTier !== "quarantined") return false;

    await ctx.db.patch(identity._id, {
      authorTrustTier: restoreTier,
      status: "active",
      updatedAt: Date.now(),
    });

    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List quarantined agents.
 */
export const listQuarantinedAgents = query({
  args: {},
  returns: v.array(
    v.object({
      agentId: v.string(),
      name: v.string(),
      persona: v.string(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const agents = await ctx.db
      .query("agentIdentities")
      .withIndex("by_status", (q) => q.eq("status", "paused"))
      .collect();

    return agents
      .filter((a) => a.authorTrustTier === "quarantined")
      .map((a) => ({
        agentId: a.agentId,
        name: a.name,
        persona: a.persona,
        updatedAt: a.updatedAt,
      }));
  },
});

/**
 * Get agent incident history from heartbeats (failed runs).
 */
export const getAgentIncidents = query({
  args: {
    agentId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      status: v.string(),
      triggeredBy: v.string(),
      errorMessage: v.union(v.string(), v.null()),
      startedAt: v.number(),
      durationMs: v.union(v.number(), v.null()),
    })
  ),
  handler: async (ctx, { agentId, limit }) => {
    const maxResults = limit ?? 20;
    const heartbeats = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_agent_status", (q) =>
        q.eq("agentId", agentId).eq("status", "failed")
      )
      .order("desc")
      .take(maxResults);

    return heartbeats.map((h) => ({
      status: h.status,
      triggeredBy: h.triggeredBy,
      errorMessage: h.errorMessage ?? null,
      startedAt: h.startedAt,
      durationMs: h.durationMs ?? null,
    }));
  },
});
