/**
 * LinkedIn Account Management (Queries & Mutations)
 *
 * These run in the Convex runtime (not Node.js) and handle
 * database operations for LinkedIn accounts.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Account Management Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current user's LinkedIn account (if connected)
 */
export const getLinkedInAccount = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("linkedinAccounts"),
      personUrn: v.optional(v.string()),
      displayName: v.optional(v.string()),
      email: v.optional(v.string()),
      profilePictureUrl: v.optional(v.string()),
      scope: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      createdAt: v.number(),
      isExpired: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const account = await ctx.db
      .query("linkedinAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"linkedinAccounts"> | null;

    if (!account) return null;

    const isExpired = account.expiresAt ? account.expiresAt < Date.now() : false;

    return {
      _id: account._id,
      personUrn: account.personUrn,
      displayName: account.displayName,
      email: account.email,
      profilePictureUrl: account.profilePictureUrl,
      scope: account.scope,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
      isExpired,
    };
  },
});

/**
 * Get LinkedIn account by ID (internal)
 */
export const getAccountById = internalQuery({
  args: { accountId: v.id("linkedinAccounts") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accountId) as Doc<"linkedinAccounts"> | null;
  },
});

/**
 * Get LinkedIn account for a specific user (internal)
 */
export const getAccountForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("linkedinAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first() as Doc<"linkedinAccounts"> | null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Account Management Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save or update LinkedIn account credentials.
 * Called after OAuth flow completion.
 */
export const saveLinkedInAccount = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresIn: v.optional(v.number()),  // seconds
    scope: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    accountId: v.optional(v.id("linkedinAccounts")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const now = Date.now();
    const expiresAt = args.expiresIn ? now + (args.expiresIn * 1000) : undefined;

    // Check for existing account
    const existing = await ctx.db
      .query("linkedinAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"linkedinAccounts"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken || existing.refreshToken,
        scope: args.scope || existing.scope,
        expiresAt,
        updatedAt: now,
      });

      // Schedule user info fetch
      await ctx.scheduler.runAfter(0, internal.domains.social.linkedinPosting.fetchUserInfo, {
        accountId: existing._id,
      });

      return { success: true, accountId: existing._id };
    }

    // Create new account
    const accountId = await ctx.db.insert("linkedinAccounts", {
      userId,
      provider: "linkedin",
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      scope: args.scope,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // Schedule user info fetch
    await ctx.scheduler.runAfter(0, internal.domains.social.linkedinPosting.fetchUserInfo, {
      accountId,
    });

    return { success: true, accountId };
  },
});

/**
 * Disconnect LinkedIn account
 */
export const disconnectLinkedIn = mutation({
  args: {},
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { success: false };

    const account = await ctx.db
      .query("linkedinAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"linkedinAccounts"> | null;

    if (account) {
      await ctx.db.delete(account._id);
    }

    return { success: true };
  },
});

/**
 * Update LinkedIn account info (internal)
 */
export const updateAccountInfo = internalMutation({
  args: {
    accountId: v.id("linkedinAccounts"),
    personUrn: v.optional(v.string()),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    profilePictureUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { accountId, ...updates } = args;
    await ctx.db.patch(accountId, {
      ...updates,
      updatedAt: Date.now(),
    });
    return null;
  },
});
