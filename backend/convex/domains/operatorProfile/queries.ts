import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { parseOperatorManifestMarkdown } from "./manifest";

/**
 * Get the operator profile for the current authenticated user.
 * Returns null if no profile exists.
 */
export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Look up user by tokenIdentifier
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return profile;
  },
});

/**
 * Get the operator profile markdown content for the current user.
 * Returns the full document content from the linked documents table entry.
 */
export const getProfileMarkdown = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return null;

    const doc = await ctx.db.get(profile.documentId);
    return doc?.content ?? null;
  },
});

/**
 * Get the parsed operator manifest for the current user.
 * The linked USER.md document is still the durable source of truth.
 */
export const getManifest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) return null;

    const doc = await ctx.db.get(profile.documentId);
    const markdown = doc?.content;
    return markdown ? parseOperatorManifestMarkdown(markdown) : null;
  },
});

/**
 * Internal query: get profile by userId (for batch runner, scheduler, etc.)
 */
export const getProfileByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * Internal query: get parsed manifest by userId for batch, chat-to-batch,
 * style inference, and audit-safe memory update workflows.
 */
export const getManifestByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;

    const doc = await ctx.db.get(profile.documentId);
    const markdown = doc?.content;
    return markdown ? parseOperatorManifestMarkdown(markdown) : null;
  },
});

/**
 * Internal query: get document by ID (for filesystem sync)
 */
export const _getDocumentById = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    return await ctx.db.get(documentId);
  },
});
