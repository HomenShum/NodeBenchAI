/**
 * Agent Dispatch — routes proactiveEvents and opportunities to agent identities.
 * Connects the proactive event bus → agent heartbeat system.
 *
 * Flow:
 *   proactiveEvents (pending) → dispatchToAgent → agentHeartbeats (started)
 *   opportunity (created) → routeOpportunityToAgent → agent processes → heartbeat (completed)
 */

import { internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

/**
 * Route mapping: event types → agent IDs.
 * In production, this would be stored in a config table.
 * For now, hardcoded as a starting point.
 */
const EVENT_AGENT_ROUTING: Record<string, string[]> = {
  web_article_discovered: ["research-analyst"],
  slack_message: ["comms-analyst"],
  slack_mention: ["comms-analyst"],
  email_received: ["comms-analyst", "research-analyst"],
  voice_capture: ["content-curator"],
  text_capture: ["content-curator"],
  photo_capture: ["content-curator"],
};

/**
 * Dispatch a proactive event to the appropriate agent(s).
 * Called after detector processing completes.
 */
export const dispatchEventToAgent = internalMutation({
  args: {
    eventId: v.id("proactiveEvents"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error(`Event not found: ${args.eventId}`);
    if (event.dispatchedToAgentId) return { skipped: true, reason: "already_dispatched" };

    // Find eligible agents for this event type
    const candidateAgentIds = EVENT_AGENT_ROUTING[event.eventType] ?? [];
    if (candidateAgentIds.length === 0) {
      return { skipped: true, reason: "no_routing_rule" };
    }

    // Find first active agent that has budget remaining
    for (const agentId of candidateAgentIds) {
      const agent = await ctx.db
        .query("agentIdentities")
        .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
        .first();

      if (!agent || agent.status !== "active") continue;

      // Check daily budget if configured
      if (agent.budgetDailyTokens) {
        const dayAgo = Date.now() - 86400000;
        const recentHeartbeats = await ctx.db
          .query("agentHeartbeats")
          .withIndex("by_agent", (q) =>
            q.eq("agentId", agentId).gte("startedAt", dayAgo)
          )
          .collect();
        const tokensUsed = recentHeartbeats.reduce(
          (s, h) => s + (h.tokensBurned ?? 0),
          0
        );
        if (tokensUsed >= agent.budgetDailyTokens) continue;
      }

      // Dispatch to this agent
      await ctx.db.patch(args.eventId, {
        dispatchedToAgentId: agentId,
        dispatchedAt: Date.now(),
      });

      // Record heartbeat start
      await ctx.db.insert("agentHeartbeats", {
        agentId,
        triggeredBy: "event",
        triggerEventId: event.eventId,
        status: "started",
        startedAt: Date.now(),
      });

      // Schedule agent work cycle to process this event
      await ctx.scheduler.runAfter(
        0,
        internal.domains.agents.agentLoop.tickSingleAgent,
        { agentId }
      );

      return { dispatched: true, agentId, eventType: event.eventType };
    }

    return { skipped: true, reason: "no_available_agent" };
  },
});

/**
 * Get undispatched events that need agent processing.
 * Used by sweep jobs to catch events that missed real-time dispatch.
 */
export const getUndispatchedEvents = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    // Get processed events that haven't been dispatched to an agent
    const events = await ctx.db
      .query("proactiveEvents")
      .withIndex("by_status", (q) => q.eq("processingStatus", "processed"))
      .order("desc")
      .take(limit * 2); // Over-fetch to filter

    return events
      .filter((e) => !e.dispatchedToAgentId)
      .slice(0, limit);
  },
});

/**
 * Sweep job: dispatch any unprocessed events to agents.
 * Run on a schedule (e.g., every 30 min) to catch missed events.
 */
export const sweepAndDispatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get undispatched processed events
    const events = await ctx.db
      .query("proactiveEvents")
      .withIndex("by_status", (q) => q.eq("processingStatus", "processed"))
      .order("desc")
      .take(100);

    const undispatched = events.filter((e) => !e.dispatchedToAgentId);
    let dispatched = 0;
    let skipped = 0;

    for (const event of undispatched.slice(0, 20)) {
      const candidateAgentIds =
        EVENT_AGENT_ROUTING[event.eventType] ?? [];
      if (candidateAgentIds.length === 0) {
        skipped++;
        continue;
      }

      // Try first available agent
      for (const agentId of candidateAgentIds) {
        const agent = await ctx.db
          .query("agentIdentities")
          .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
          .first();
        if (!agent || agent.status !== "active") continue;

        await ctx.db.patch(event._id, {
          dispatchedToAgentId: agentId,
          dispatchedAt: Date.now(),
        });

        await ctx.db.insert("agentHeartbeats", {
          agentId,
          triggeredBy: "sweep",
          triggerEventId: event.eventId,
          status: "started",
          startedAt: Date.now(),
        });

        dispatched++;
        break;
      }
    }

    return {
      totalUndispatched: undispatched.length,
      dispatched,
      skipped,
    };
  },
});
