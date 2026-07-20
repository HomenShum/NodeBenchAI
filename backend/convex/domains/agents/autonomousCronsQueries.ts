/**
 * autonomousCronsQueries.ts — Query & mutation functions extracted from autonomousCrons.ts.
 *
 * Convex requires that "use node" files only export actions.
 * These internalQuery/internalMutation functions must live in a non-node file.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";

interface CommandWordGate {
  channelId: string;
  commandWord: string | null;
  bypassTypes: string[];
}

/**
 * Check if command-word gating is active for a channel.
 * Returns the gate configuration or null if no gate is set.
 */
export const getCommandWordGate = internalQuery({
  args: { channelId: v.string() },
  returns: v.union(
    v.object({
      channelId: v.string(),
      commandWord: v.union(v.string(), v.null()),
      bypassTypes: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_cron", (q) =>
        q.eq("cronJobName", `command_gate:${args.channelId}`),
      )
      .order("desc")
      .first();

    if (!record?.metadata) return null;

    const meta = record.metadata as CommandWordGate;
    if (!meta.commandWord) return null;

    return {
      channelId: meta.channelId,
      commandWord: meta.commandWord,
      bypassTypes: meta.bypassTypes ?? ["meta-feedback"],
    };
  },
});

/**
 * Query recent agentTaskSessions within a time window.
 * Used by drift detection and prediction for context gathering.
 */
export const queryRecentSessions = internalQuery({
  args: {
    since: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      status: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date")
      .order("desc")
      .filter((q) => q.gte(q.field("startedAt"), args.since))
      .take(args.limit);

    return sessions.map((s) => ({
      title: s.title,
      description: s.description,
      status: s.status,
    }));
  },
});

/**
 * Query the latest cron session by cronJobName.
 * Used for Brier-score tracking continuity in predictions.
 */
export const queryLatestCronSession = internalQuery({
  args: { cronJobName: v.string() },
  returns: v.union(
    v.object({ metadata: v.optional(v.any()) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_cron", (q) => q.eq("cronJobName", args.cronJobName))
      .order("desc")
      .first();

    if (!session) return null;
    return { metadata: session.metadata };
  },
});

/**
 * Query recent swarm-type sessions for evolution analysis.
 */
export const querySwarmSessions = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      status: v.string(),
      totalDurationMs: v.optional(v.number()),
      agentsInvolved: v.optional(v.array(v.string())),
      metadata: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date", (q) => q.eq("type", "swarm"))
      .order("desc")
      .take(args.limit);

    return sessions.map((s) => ({
      title: s.title,
      description: s.description,
      status: s.status,
      totalDurationMs: s.totalDurationMs,
      agentsInvolved: s.agentsInvolved,
      metadata: s.metadata,
    }));
  },
});

// ═══════════════════════════════════════════════════════════
// Mutations (also cannot live in "use node" files)
// ═══════════════════════════════════════════════════════════

interface CommandWordGateMutation {
  channelId: string;
  commandWord: string | null;
  bypassTypes: string[];
}

/**
 * Set or clear the command word gate for a channel.
 */
export const setCommandWordGate = internalMutation({
  args: {
    channelId: v.string(),
    commandWord: v.union(v.string(), v.null()),
    bypassTypes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_cron", (q) =>
        q.eq("cronJobName", `command_gate:${args.channelId}`),
      )
      .order("desc")
      .first();

    const gateData: CommandWordGateMutation = {
      channelId: args.channelId,
      commandWord: args.commandWord,
      bypassTypes: args.bypassTypes ?? ["meta-feedback"],
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        metadata: gateData,
        completedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("agentTaskSessions", {
        title: `Command Gate: ${args.channelId}`,
        type: "cron",
        visibility: "private",
        status: "completed",
        startedAt: Date.now(),
        completedAt: Date.now(),
        cronJobName: `command_gate:${args.channelId}`,
        metadata: gateData,
      });
    }

    console.log(
      `[autonomousCrons] Command gate ${args.commandWord ? "set" : "cleared"} for channel ${args.channelId}`,
    );
    return null;
  },
});

/**
 * Store a cron job result as a new agentTaskSession.
 */
export const storeCronResult = internalMutation({
  args: {
    title: v.string(),
    cronJobName: v.string(),
    metadata: v.any(),
  },
  returns: v.id("agentTaskSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("agentTaskSessions", {
      title: args.title,
      type: "cron",
      visibility: "public",
      status: "completed",
      startedAt: now,
      completedAt: now,
      cronJobName: args.cronJobName,
      metadata: args.metadata,
    });
  },
});
