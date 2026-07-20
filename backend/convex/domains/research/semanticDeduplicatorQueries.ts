/**
 * Semantic Deduplicator Queries
 *
 * Separated from semanticDeduplicator.ts because queries cannot run in Node.js.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES (copied from main file)
// ═══════════════════════════════════════════════════════════════════════════

function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeContentHash(content: string, postType: string): string {
  const normalized = normalizeText(content);
  return fnv1a32Hex(`${postType}:${normalized}`);
}

function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(normalizeText(text1).split(" ").filter(w => w.length > 3));
  const words2 = new Set(normalizeText(text2).split(" ").filter(w => w.length > 3));

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find existing posts by content hash
 */
export const findByContentHash = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .order("desc")
      .take(100);

    for (const post of posts) {
      const hash = computeContentHash(post.content, post.postType);
      if (hash === args.contentHash) {
        return post;
      }
    }

    return null;
  },
});

/**
 * Find similar posts using title/content similarity
 */
export const findSimilarPosts = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    content: v.string(),
    title: v.optional(v.string()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.lookbackHours || 48) * 60 * 60 * 1000;

    const recentPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .filter(q => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(50);

    const candidates = recentPosts
      .map(post => {
        const contentSimilarity = jaccardSimilarity(args.content, post.content);
        const titleSimilarity = args.title && post.title
          ? jaccardSimilarity(args.title, post.title)
          : 0;

        const similarity = Math.max(contentSimilarity, titleSimilarity * 0.8);

        return { post, similarity };
      })
      .filter(({ similarity }) => similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    return candidates.map(({ post, similarity }) => ({
      _id: post._id,
      postId: post.postId,
      postType: post.postType,
      title: post.title,
      content: post.content,
      createdAt: post.createdAt,
      similarity,
    }));
  },
});
