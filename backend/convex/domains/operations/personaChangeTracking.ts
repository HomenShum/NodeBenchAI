/**
 * Persona Change Tracking
 *
 * Tracks changes to persona configurations for analysis and rollback.
 * Enables understanding of how persona adjustments impact recommendations.
 *
 * Created: 2026-01-22 (P1 - Critical for persona optimization)
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Utility to safely get user ID from auth context
 */
async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  try {
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) return null;

    let userId: Id<"users">;
    if (typeof rawUserId === "string" && rawUserId.includes("|")) {
      const userIdPart = rawUserId.split("|")[0];
      if (!userIdPart || userIdPart.length < 10) return null;
      userId = userIdPart as Id<"users">;
    } else {
      userId = rawUserId as Id<"users">;
    }

    const user = await ctx.db.get(userId);
    if (!user) return null;

    return userId;
  } catch {
    return null;
  }
}

/**
 * Log a persona configuration change
 */
export const logPersonaChange = mutation({
  args: {
    personaId: v.string(),
    personaType: v.union(
      v.literal("budget"),
      v.literal("lens"),
      v.literal("hook"),
      v.literal("preference"),
      v.literal("setting")
    ),
    fieldChanged: v.string(),
    previousValue: v.any(),
    newValue: v.any(),
    changeType: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("reset")
    ),
    actorType: v.optional(v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("admin"),
      v.literal("automation")
    )),
    reason: v.optional(v.string()),
    impactedRecommendations: v.optional(v.number()),
    impactedJobs: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    const changeId = await ctx.db.insert("personaChangeLog", {
      personaId: args.personaId,
      personaType: args.personaType,
      fieldChanged: args.fieldChanged,
      previousValue: args.previousValue,
      newValue: args.newValue,
      changeType: args.changeType,
      actor: userId || undefined,
      actorType: args.actorType || (userId ? "user" : "system"),
      reason: args.reason,
      impactedRecommendations: args.impactedRecommendations,
      impactedJobs: args.impactedJobs,
      metadata: args.metadata,
      timestamp: Date.now(),
    });

    console.log(
      `[PersonaChange] ${args.personaId}.${args.fieldChanged}: ${JSON.stringify(args.previousValue)} → ${JSON.stringify(args.newValue)}`
    );

    return { success: true, changeId };
  },
});

/**
 * Internal mutation for logging persona changes from system contexts
 */
export const logPersonaChangeInternal = internalMutation({
  args: {
    personaId: v.string(),
    personaType: v.union(
      v.literal("budget"),
      v.literal("lens"),
      v.literal("hook"),
      v.literal("preference"),
      v.literal("setting")
    ),
    fieldChanged: v.string(),
    previousValue: v.any(),
    newValue: v.any(),
    changeType: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("reset")
    ),
    actor: v.optional(v.id("users")),
    actorType: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("admin"),
      v.literal("automation")
    ),
    reason: v.optional(v.string()),
    impactedRecommendations: v.optional(v.number()),
    impactedJobs: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const changeId = await ctx.db.insert("personaChangeLog", {
      personaId: args.personaId,
      personaType: args.personaType,
      fieldChanged: args.fieldChanged,
      previousValue: args.previousValue,
      newValue: args.newValue,
      changeType: args.changeType,
      actor: args.actor,
      actorType: args.actorType,
      reason: args.reason,
      impactedRecommendations: args.impactedRecommendations,
      impactedJobs: args.impactedJobs,
      metadata: args.metadata,
      timestamp: Date.now(),
    });

    console.log(
      `[PersonaChange] ${args.personaId}.${args.fieldChanged}: ${JSON.stringify(args.previousValue)} → ${JSON.stringify(args.newValue)}`
    );

    return { success: true, changeId };
  },
});

/**
 * Get change history for a specific persona
 */
export const getPersonaChangeHistory = query({
  args: {
    personaId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    const changes = await ctx.db
      .query("personaChangeLog")
      .withIndex("by_persona", (q) => q.eq("personaId", args.personaId))
      .order("desc")
      .take(limit);

    // Enrich with actor information
    const enrichedChanges = await Promise.all(
      changes.map(async (change) => {
        let actorInfo: { name: any; email: any } | null = null;
        if (change.actor) {
          const user = await ctx.db.get(change.actor);
          if (user) {
            actorInfo = {
              name: user.name,
              email: user.email,
            };
          }
        }

        return {
          ...change,
          actorInfo: actorInfo || { name: change.actorType, email: null },
        };
      })
    );

    return enrichedChanges;
  },
});

/**
 * Get changes by persona type
 */
export const getChangesByType = query({
  args: {
    personaType: v.union(
      v.literal("budget"),
      v.literal("lens"),
      v.literal("hook"),
      v.literal("preference"),
      v.literal("setting")
    ),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let changes = await ctx.db
      .query("personaChangeLog")
      .withIndex("by_type", (q) => q.eq("personaType", args.personaType))
      .order("desc")
      .take(limit * 2); // Over-fetch for filtering

    // Filter by date range
    if (args.startDate || args.endDate) {
      changes = changes.filter((change) => {
        if (args.startDate && change.timestamp < args.startDate) return false;
        if (args.endDate && change.timestamp > args.endDate) return false;
        return true;
      });
    }

    // Limit results
    changes = changes.slice(0, limit);

    return changes;
  },
});

/**
 * Get most frequently changed fields
 */
export const getMostChangedFields = query({
  args: {
    personaType: v.optional(v.union(
      v.literal("budget"),
      v.literal("lens"),
      v.literal("hook"),
      v.literal("preference"),
      v.literal("setting")
    )),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    let changes = await ctx.db.query("personaChangeLog").collect();

    // Filter by persona type
    if (args.personaType) {
      changes = changes.filter((change) => change.personaType === args.personaType);
    }

    // Filter by date range
    if (args.startDate || args.endDate) {
      changes = changes.filter((change) => {
        if (args.startDate && change.timestamp < args.startDate) return false;
        if (args.endDate && change.timestamp > args.endDate) return false;
        return true;
      });
    }

    // Count by field
    const fieldCounts = new Map<string, number>();
    for (const change of changes) {
      const key = `${change.personaType}:${change.fieldChanged}`;
      const count = fieldCounts.get(key) || 0;
      fieldCounts.set(key, count + 1);
    }

    // Sort and limit
    const results = Array.from(fieldCounts.entries())
      .map(([key, count]) => {
        const [personaType, fieldChanged] = key.split(":");
        return { personaType, fieldChanged, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return results;
  },
});

/**
 * Get persona change statistics
 */
export const getPersonaChangeStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let changes = await ctx.db.query("personaChangeLog").collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      changes = changes.filter((change) => {
        if (args.startDate && change.timestamp < args.startDate) return false;
        if (args.endDate && change.timestamp > args.endDate) return false;
        return true;
      });
    }

    // Count by persona type
    const typeCounts = new Map<string, number>();
    for (const change of changes) {
      const count = typeCounts.get(change.personaType) || 0;
      typeCounts.set(change.personaType, count + 1);
    }

    // Count by change type
    const changeTypeCounts = new Map<string, number>();
    for (const change of changes) {
      const count = changeTypeCounts.get(change.changeType) || 0;
      changeTypeCounts.set(change.changeType, count + 1);
    }

    // Calculate impact metrics
    const totalImpactedRecommendations = changes.reduce(
      (sum, change) => sum + (change.impactedRecommendations || 0),
      0
    );
    const totalImpactedJobs = changes.reduce(
      (sum, change) => sum + (change.impactedJobs || 0),
      0
    );

    const topTypes = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const topChangeTypes = Array.from(changeTypeCounts.entries())
      .map(([changeType, count]) => ({ changeType, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: changes.length,
      topTypes,
      topChangeTypes,
      totalImpactedRecommendations,
      totalImpactedJobs,
      avgImpactedRecommendations:
        changes.length > 0 ? totalImpactedRecommendations / changes.length : 0,
      avgImpactedJobs: changes.length > 0 ? totalImpactedJobs / changes.length : 0,
      dateRange: {
        start: args.startDate || (changes.length > 0 ? changes[changes.length - 1].timestamp : null),
        end: args.endDate || (changes.length > 0 ? changes[0].timestamp : null),
      },
    };
  },
});
