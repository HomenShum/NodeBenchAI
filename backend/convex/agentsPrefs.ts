/**
 * Agent Preferences API
 *
 * Provides simple key-value storage for agent-related preferences,
 * stored in the userPreferences.agentsPrefs field.
 */
import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Utility function to safely extract user ID from authentication
 */
async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) {
    return null;
  }

  let userId: Id<"users">;
  if (typeof rawUserId === 'string' && rawUserId.includes('|')) {
    const userIdPart = rawUserId.split('|')[0];
    if (!userIdPart || userIdPart.length < 10) {
      return null;
    }
    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  const user = await ctx.db.get(userId);
  if (!user) {
    return null;
  }

  return userId;
}

/**
 * Get all agent preferences for the current user
 */
export const getAgentsPrefs = query({
  args: {},
  handler: async (ctx): Promise<Record<string, string> | undefined> => {
    const userId = await getSafeUserId(ctx);
    if (!userId) {
      return undefined;
    }

    const preferences: Doc<"userPreferences"> | null = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return preferences?.agentsPrefs ?? {};
  },
});

/**
 * Set/update agent preferences for the current user
 * Merges with existing preferences
 */
export const setAgentsPrefs = mutation({
  args: {
    prefs: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing: Doc<"userPreferences"> | null = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const now = Date.now();
    const newAgentsPrefs = { ...(existing?.agentsPrefs || {}), ...args.prefs };

    if (existing) {
      await ctx.db.patch(existing._id, {
        agentsPrefs: newAgentsPrefs,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userPreferences", {
        userId,
        agentsPrefs: newAgentsPrefs,
        createdAt: now,
        updatedAt: now,
      });
    }

    return newAgentsPrefs;
  },
});

/**
 * Internal query to get agent preferences by userId
 * Used by internal actions that already have the userId
 */
export const getAgentsPrefsByUserId = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const preferences: Doc<"userPreferences"> | null = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    return preferences?.agentsPrefs ?? {};
  },
});
