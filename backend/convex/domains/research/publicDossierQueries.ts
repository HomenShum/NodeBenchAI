/**
 * Public Dossier Queries & Mutations
 * 
 * Split from publicDossier.ts to allow proper Convex runtime handling.
 * Queries and mutations run in the Convex default runtime (not Node.js).
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES: Public access to daily dossier (no auth required)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the latest public dossier (for landing page)
 */
export const getLatestPublicDossier = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("publicDossiers"),
      sections: v.array(v.any()),
      generatedAt: v.number(),
      topic: v.string(),
      version: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const dossier = await ctx.db
      .query("publicDossiers")
      .withIndex("by_date")
      .order("desc")
      .first() as Doc<"publicDossiers"> | null;

    return dossier;
  },
});

/**
 * Get dossier by date (for historical access)
 */
export const getDossierByDate = query({
  args: { date: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, { date }) => {
    const dossier = await ctx.db
      .query("publicDossiers")
      .withIndex("by_date_string", (q) => q.eq("dateString", date))
      .first() as Doc<"publicDossiers"> | null;

    return dossier;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS: Store generated dossier
// ═══════════════════════════════════════════════════════════════════════════

export const storePublicDossier = mutation({
  args: {
    sections: v.array(v.any()),
    topic: v.string(),
    version: v.optional(v.number()),
  },
  handler: async (ctx, { sections, topic, version }) => {
    const now = Date.now();
    const dateString = new Date(now).toISOString().split("T")[0];
    
    // Check if we already have a dossier for today
    const existing = await ctx.db
      .query("publicDossiers")
      .withIndex("by_date_string", (q) => q.eq("dateString", dateString))
      .first() as Doc<"publicDossiers"> | null;
    
    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        sections,
        topic,
        generatedAt: now,
        version: (existing.version || 0) + 1,
      });
      return existing._id;
    }
    
    // Create new
    return await ctx.db.insert("publicDossiers", {
      sections,
      topic,
      generatedAt: now,
      dateString,
      version: version ?? 1,
    });
  },
});
