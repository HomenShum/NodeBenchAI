/**
 * Redesign Sprint S5 — Style profile queries + mutations.
 *
 * Powers the MeSurface style profile section. Inferred via scripts/qa/inferStyle.ts
 * (Gemini 3.1 Pro Preview) which mirrors the same modelRouter contract used by
 * convex/domains/operations/batchAutopilot/runner.ts.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const PROVENANCE_VALIDATOR = v.array(v.object({
  label: v.string(),
  chars: v.number(),
  weightPct: v.number(),
}));

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("styleProfiles")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", true))
      .unique();
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("styleProfiles")
      .withIndex("by_user_inferred", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 10);
  },
});

export const upsert = mutation({
  args: {
    label: v.string(),
    slug: v.string(),
    voice: v.string(),
    sectionOrder: v.array(v.string()),
    recommendationPhrasings: v.array(v.string()),
    riskLens: v.array(v.string()),
    sourcePreferences: v.array(v.string()),
    sentenceRhythm: v.string(),
    confidence: v.number(),
    patternsFound: v.number(),
    provenance: PROVENANCE_VALIDATOR,
    modelUsed: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");

    // Demote any existing active profile so there's only ever one active per user.
    const existingActive = await ctx.db
      .query("styleProfiles")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", true))
      .collect();
    for (const row of existingActive) {
      await ctx.db.patch(row._id, { isActive: false });
    }

    const id = await ctx.db.insert("styleProfiles", {
      userId,
      label: args.label,
      slug: args.slug,
      voice: args.voice,
      sectionOrder: args.sectionOrder,
      recommendationPhrasings: args.recommendationPhrasings,
      riskLens: args.riskLens,
      sourcePreferences: args.sourcePreferences,
      sentenceRhythm: args.sentenceRhythm,
      confidence: Math.max(0, Math.min(1, args.confidence)),
      patternsFound: Math.max(0, Math.floor(args.patternsFound)),
      provenance: args.provenance,
      modelUsed: args.modelUsed,
      inferredAt: Date.now(),
      isActive: true,
    });
    return id;
  },
});

export const setActive = mutation({
  args: { profileId: v.id("styleProfiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const target = await ctx.db.get(args.profileId);
    if (!target || target.userId !== userId) throw new Error("Profile not found");

    const others = await ctx.db
      .query("styleProfiles")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", true))
      .collect();
    for (const row of others) {
      if (row._id !== args.profileId) await ctx.db.patch(row._id, { isActive: false });
    }
    await ctx.db.patch(args.profileId, { isActive: true });
    return args.profileId;
  },
});
