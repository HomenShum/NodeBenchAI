import { v } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import { parseOperatorMarkdown, DEFAULT_PERMISSIONS, DEFAULT_BUDGET, DEFAULT_OUTPUT_PREFERENCES } from "./parser";

/**
 * Create or update an operator profile from wizard answers.
 * Stores the markdown in the documents table and parsed config in operatorProfiles.
 */
export const upsertProfile = mutation({
  args: {
    markdown: v.string(),
  },
  handler: async (ctx, { markdown }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    const now = Date.now();
    const config = parseOperatorMarkdown(markdown);

    // Check for existing profile
    const existing = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      // Update the linked document
      await ctx.db.patch(existing.documentId, {
        content: markdown,
        contentPreview: markdown.slice(0, 500),
        updatedAt: now,
      });

      // Update the profile metadata
      await ctx.db.patch(existing._id, {
        identity: config.identity,
        goals: config.goals,
        autonomyMode: config.autonomyMode,
        scheduleInterval: config.scheduleInterval,
        scheduleTimeUtc: config.scheduleTimeUtc,
        permissions: config.permissions,
        budget: config.budget,
        outputPreferences: config.outputPreferences,
        updatedAt: now,
      });

      return existing._id;
    }

    // Create new document
    const documentId = await ctx.db.insert("documents", {
      title: `Operator Profile — ${config.identity.displayName}`,
      content: markdown,
      contentPreview: markdown.slice(0, 500),
      isPublic: false,
      documentType: "operator_profile",
      tags: ["operator-profile", "generated"],
      createdAt: now,
      updatedAt: now,
    });

    // Create profile metadata
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: user._id,
      documentId,
      identity: config.identity,
      goals: config.goals,
      autonomyMode: config.autonomyMode,
      scheduleInterval: config.scheduleInterval,
      scheduleTimeUtc: config.scheduleTimeUtc,
      permissions: config.permissions,
      budget: config.budget,
      outputPreferences: config.outputPreferences,
      updatedAt: now,
      createdAt: now,
    });

    return profileId;
  },
});

/**
 * Update just the autonomy mode and schedule (from the Autopilot tab).
 */
export const updateAutonomySettings = mutation({
  args: {
    autonomyMode: v.string(),
    scheduleInterval: v.optional(v.string()),
    scheduleTimeUtc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) throw new Error("No operator profile found. Create one first.");

    await ctx.db.patch(profile._id, {
      autonomyMode: args.autonomyMode,
      scheduleInterval: args.scheduleInterval,
      scheduleTimeUtc: args.scheduleTimeUtc,
      updatedAt: Date.now(),
    });

    return profile._id;
  },
});

/**
 * Delete the operator profile and its linked document.
 */
export const deleteProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return;

    await ctx.db.delete(profile.documentId);
    await ctx.db.delete(profile._id);
  },
});

/**
 * Internal: mark filesystem sync timestamp
 */
export const markFilesystemSync = internalMutation({
  args: { profileId: v.id("operatorProfiles") },
  handler: async (ctx, { profileId }) => {
    await ctx.db.patch(profileId, {
      lastSyncedToFilesystem: Date.now(),
    });
  },
});
