import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

const MAX_OBSERVE_SOURCES = 20;
const MAX_SNAPSHOT_CHARS = 4000;

/**
 * Fetch source material for OBSERVE phase.
 * Returns recent reports, claims, and evidence items for the entity.
 */
export const _fetchObserveSources = internalQuery({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, entitySlug, daysBack = 30 }) => {
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    const reports = await ctx.db
      .query("productReports")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug),
      )
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    const claims = await ctx.db
      .query("productClaims")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug),
      )
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    const evidence = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_entitySlug", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug),
      )
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    return {
      reports: reports.map((r) => ({
        id: r._id,
        type: "productReports" as const,
        title: typeof r.title === "string" ? r.title.slice(0, 200) : "",
        summary:
          typeof r.summary === "string"
            ? r.summary.slice(0, MAX_SNAPSHOT_CHARS / 3)
            : "",
        updatedAt: r.updatedAt,
      })),
      claims: claims.map((c) => ({
        id: c._id,
        type: "productClaims" as const,
        text: typeof c.claimText === "string" ? c.claimText.slice(0, 500) : "",
        confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
        updatedAt: c.updatedAt,
      })),
      evidence: evidence.map((e) => ({
        id: e._id,
        type: "productEvidenceItems" as const,
        description:
          typeof e.description === "string" ? e.description.slice(0, 500) : "",
        sourceUrl: typeof e.sourceUrl === "string" ? e.sourceUrl : undefined,
        createdAt: e.createdAt,
      })),
    };
  },
});

/**
 * Fetch all wiki pages for an owner (for REFLECT phase cross-page analysis).
 */
export const _fetchAllWikiPages = internalQuery({
  args: { ownerKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerKey, limit = 100 }) => {
    const pages = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);

    return await Promise.all(
      pages.map(async (page) => {
        const rev = await ctx.db
          .query("userWikiRevisions")
          .withIndex("by_owner_page_generatedAt", (q) =>
            q.eq("ownerKey", ownerKey).eq("pageId", page._id),
          )
          .order("desc")
          .first();

        return {
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          revision: rev
            ? {
                summary: rev.summary,
                whatItIs: rev.whatItIs,
                whyItMatters: rev.whyItMatters,
                openQuestions: rev.openQuestions,
              }
            : null,
        };
      }),
    );
  },
});
