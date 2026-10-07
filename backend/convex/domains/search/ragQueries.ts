import { query } from "../../_generated/server";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Query: keywordSearch (BM25-style full-text via search index)        */
/* ------------------------------------------------------------------ */
export const keywordSearch = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      nodeId: v.id("nodes"),
      documentId: v.id("documents"),
      text: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { query, limit }) => {
    const n = Math.max(1, Math.min(10, limit ?? 5));
    const hits = await ctx.db
      .query("nodes")
      .withSearchIndex("search_text", (q) => q.search("text", query))
      .take(n);
    return hits.map((h) => ({ nodeId: h._id, documentId: h.documentId, text: h.text }));
  },
});
