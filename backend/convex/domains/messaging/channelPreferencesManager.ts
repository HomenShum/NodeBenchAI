/**
 * Channel Preferences Manager — CRUD + opt-in/opt-out + quiet hours + fallback resolution
 *
 * Manages per-user channel configuration for multi-channel delivery.
 * Integrates with the outbound pipeline for preference-based routing.
 */

import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ChannelId } from "./channelProvider.js";

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get channel preferences for a user.
 */
export const getPreferences = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

/**
 * Get the fallback chain for a user (ordered list of preferred channels).
 * Returns default chain if no preferences configured.
 */
export const getFallbackChain = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string[]> => {
    const prefs = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs || prefs.preferredChannels.length === 0) {
      return ["ui", "email", "ntfy"]; // Default fallback
    }

    // Filter to only enabled + opted-in channels
    const enabledChannels = new Set(
      prefs.channelConfigs
        .filter((c) => c.enabled && c.optedIn)
        .map((c) => c.channelId),
    );

    return prefs.preferredChannels.filter((ch) => enabledChannels.has(ch));
  },
});

/**
 * Get recipient identifier for a specific channel.
 */
export const getRecipient = internalQuery({
  args: {
    userId: v.id("users"),
    channelId: v.string(),
  },
  handler: async (ctx, { userId, channelId }): Promise<string | null> => {
    const prefs = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) return null;

    const config = prefs.channelConfigs.find((c) => c.channelId === channelId);
    return config?.identifier ?? null;
  },
});

/**
 * Check if a channel is within quiet hours for a user.
 */
export const isQuietHours = internalQuery({
  args: {
    userId: v.id("users"),
    channelId: v.string(),
  },
  handler: async (ctx, { userId, channelId }): Promise<boolean> => {
    const prefs = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) return false;

    const config = prefs.channelConfigs.find((c) => c.channelId === channelId);
    if (!config?.quietHoursStart || !config?.quietHoursEnd) return false;

    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const [startH, startM] = config.quietHoursStart.split(":").map(Number);
    const [endH, endM] = config.quietHoursEnd.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Same day range (e.g., 09:00 - 17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00 - 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  },
});

/**
 * Get user preferences (public query for settings UI).
 */
export const getUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) return null;

    return ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Set or update channel preferences for a user.
 */
export const setPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    preferredChannels: v.array(v.string()),
    channelConfigs: v.array(
      v.object({
        channelId: v.string(),
        enabled: v.boolean(),
        identifier: v.string(),
        optedIn: v.boolean(),
        quietHoursStart: v.optional(v.string()),
        quietHoursEnd: v.optional(v.string()),
        maxPerDay: v.optional(v.number()),
        contentTypes: v.optional(v.array(v.string())),
      }),
    ),
    openclawSessionKeys: v.optional(
      v.array(v.object({ channelId: v.string(), sessionKey: v.string() })),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        preferredChannels: args.preferredChannels,
        channelConfigs: args.channelConfigs,
        openclawSessionKeys: args.openclawSessionKeys,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      return ctx.db.insert("channelPreferences", {
        userId: args.userId,
        preferredChannels: args.preferredChannels,
        channelConfigs: args.channelConfigs,
        openclawSessionKeys: args.openclawSessionKeys,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Opt-in or opt-out of a specific channel.
 */
export const setChannelOptIn = internalMutation({
  args: {
    userId: v.id("users"),
    channelId: v.string(),
    optedIn: v.boolean(),
  },
  handler: async (ctx, { userId, channelId, optedIn }) => {
    const prefs = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) return;

    const updatedConfigs = prefs.channelConfigs.map((c) =>
      c.channelId === channelId ? { ...c, optedIn } : c,
    );

    await ctx.db.patch(prefs._id, {
      channelConfigs: updatedConfigs,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update preferences from the settings UI (authenticated mutation).
 */
export const updateUserPreferences = mutation({
  args: {
    preferredChannels: v.array(v.string()),
    channelConfigs: v.array(
      v.object({
        channelId: v.string(),
        enabled: v.boolean(),
        identifier: v.string(),
        optedIn: v.boolean(),
        quietHoursStart: v.optional(v.string()),
        quietHoursEnd: v.optional(v.string()),
        maxPerDay: v.optional(v.number()),
        contentTypes: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) throw new Error("User not found");

    const existing = await ctx.db
      .query("channelPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        preferredChannels: args.preferredChannels,
        channelConfigs: args.channelConfigs,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("channelPreferences", {
        userId: user._id,
        preferredChannels: args.preferredChannels,
        channelConfigs: args.channelConfigs,
        updatedAt: Date.now(),
      });
    }
  },
});
