/**
 * Skill Discovery Queries and Mutations
 *
 * Contains database operations for skill discovery that run in the Convex runtime.
 * Actions that require Node.js (OpenAI embeddings) are in skillDiscovery.ts
 */

import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 3600000;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CachedSkillResult {
  skillName: string;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

export interface SkillSummary {
  name: string;
  description: string;
  category: string;
  categoryName: string;
  usageCount: number;
  keywords: string[];
}

export interface SkillCategoryInfo {
  categoryKey: string;
  categoryName: string;
  skillCount: number;
  skills: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a deterministic hash for cache lookup
 * Uses a simple string hash that works in Convex runtime (no Node.js crypto)
 */
function generateCacheKey(queryStr: string, category?: string): string {
  const normalized = `skill:${queryStr.toLowerCase().trim()}|${category || ""}`;
  // Simple hash function (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Get cached skill search results if available and not expired
 */
export const getCachedSkillResults = internalQuery({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    hit: boolean;
    results?: CachedSkillResult[];
    age?: number;
  }> => {
    const queryHash = generateCacheKey(args.query, args.category);
    const now = Date.now();

    const cached = await ctx.db
      .query("skillSearchCache")
      .withIndex("by_hash", (q) => q.eq("queryHash", queryHash))
      .first() as Doc<"skillSearchCache"> | null;

    if (!cached) {
      return { hit: false };
    }

    if (cached.expiresAt < now) {
      return { hit: false };
    }

    return {
      hit: true,
      results: cached.results as CachedSkillResult[],
      age: now - (cached.expiresAt - CACHE_TTL_MS),
    };
  },
});

/**
 * Store skill search results in cache
 */
export const setCachedSkillResults = internalMutation({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    results: v.array(v.object({
      skillName: v.string(),
      score: v.number(),
      matchType: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const queryHash = generateCacheKey(args.query, args.category);
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;

    const existing = await ctx.db
      .query("skillSearchCache")
      .withIndex("by_hash", (q) => q.eq("queryHash", queryHash))
      .first() as Doc<"skillSearchCache"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        results: args.results,
        expiresAt,
      });
    } else {
      await ctx.db.insert("skillSearchCache", {
        queryHash,
        queryText: args.query,
        category: args.category,
        results: args.results,
        expiresAt,
      });
    }

    return { cached: true, expiresAt };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD SEARCH (BM25 via Convex searchIndex)
// ═══════════════════════════════════════════════════════════════════════════

export const keywordSearchSkills = internalQuery({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { query: queryStr, category, limit = 20 } = args;

    // Search description field
    const descriptionQuery = ctx.db
      .query("skills")
      .withSearchIndex("search_description", (q) => {
        const search = q.search("description", queryStr);
        return category ? search.eq("category", category) : search;
      });

    const descResults = await descriptionQuery.take(limit) as Doc<"skills">[];

    // Search keywords field
    const keywordsQuery = ctx.db
      .query("skills")
      .withSearchIndex("search_keywords", (q) => {
        const search = q.search("keywordsText", queryStr);
        return category ? search.eq("category", category) : search;
      });

    const keywordResults = await keywordsQuery.take(limit) as Doc<"skills">[];

    // Merge and deduplicate results
    const seen = new Set<string>();
    const merged: Array<{
      skillName: string;
      description: string;
      category: string;
      categoryName: string;
      usageCount: number;
      rank: number;
    }> = [];

    // Add description results first (higher priority)
    for (let i = 0; i < descResults.length; i++) {
      const doc = descResults[i];
      if (!seen.has(doc.name)) {
        seen.add(doc.name);
        merged.push({
          skillName: doc.name,
          description: doc.description,
          category: doc.category,
          categoryName: doc.categoryName,
          usageCount: doc.usageCount,
          rank: i + 1,
        });
      }
    }

    // Add keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const doc = keywordResults[i];
      if (!seen.has(doc.name)) {
        seen.add(doc.name);
        merged.push({
          skillName: doc.name,
          description: doc.description,
          category: doc.category,
          categoryName: doc.categoryName,
          usageCount: doc.usageCount,
          rank: descResults.length + i + 1,
        });
      }
    }

    return merged.slice(0, limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SKILL LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get skill by name (public query)
 */
export const getSkillByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first() as Doc<"skills"> | null;

    if (!skill) return null;

    return {
      name: skill.name,
      description: skill.description,
      fullInstructions: skill.fullInstructions,
      category: skill.category,
      categoryName: skill.categoryName,
      keywords: skill.keywords,
      allowedTools: skill.allowedTools,
      usageCount: skill.usageCount,
      lastUsedAt: skill.lastUsedAt,
      isEnabled: skill.isEnabled,
    };
  },
});

/**
 * Get skill by name (internal query for actions)
 */
export const getSkillByNameInternal = internalQuery({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first() as Doc<"skills"> | null;

    if (!skill) return null;

    return {
      name: skill.name,
      description: skill.description,
      fullInstructions: skill.fullInstructions,
      category: skill.category,
      categoryName: skill.categoryName,
      keywords: skill.keywords,
      allowedTools: skill.allowedTools,
      usageCount: skill.usageCount,
      lastUsedAt: skill.lastUsedAt,
      isEnabled: skill.isEnabled,
    };
  },
});

/**
 * Get skill by ID (internal helper for vector search results)
 */
export const getSkillByIdInternal = internalQuery({
  args: {
    skillId: v.id("skills"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.skillId) as Doc<"skills"> | null;
    if (!doc) return null;
    return {
      skillName: doc.name,
      description: doc.description,
      category: doc.category,
      categoryName: doc.categoryName,
      usageCount: doc.usageCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY LISTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List all skill categories with counts
 */
export const listSkillCategories = internalQuery({
  args: {},
  handler: async (ctx): Promise<SkillCategoryInfo[]> => {
    const allSkills = await ctx.db
      .query("skills")
      .withIndex("by_enabled", (q) => q.eq("isEnabled", true))
      .collect() as Doc<"skills">[];

    // Group by category
    const categoryMap = new Map<string, { name: string; skills: string[] }>();

    for (const skill of allSkills) {
      const existing = categoryMap.get(skill.category);
      if (existing) {
        existing.skills.push(skill.name);
      } else {
        categoryMap.set(skill.category, {
          name: skill.categoryName,
          skills: [skill.name],
        });
      }
    }

    return Array.from(categoryMap.entries()).map(([key, value]) => ({
      categoryKey: key,
      categoryName: value.name,
      skillCount: value.skills.length,
      skills: value.skills,
    }));
  },
});

/**
 * Get all enabled skills (for browsing)
 */
export const listAllSkills = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillSummary[]> => {
    const { category, limit = 50 } = args;

    let query;
    if (category) {
      query = ctx.db
        .query("skills")
        .withIndex("by_enabled_category", (q) => 
          q.eq("isEnabled", true).eq("category", category)
        );
    } else {
      query = ctx.db
        .query("skills")
        .withIndex("by_enabled", (q) => q.eq("isEnabled", true));
    }

    const skills = await query.take(limit) as Doc<"skills">[];

    return skills.map((skill: Doc<"skills">) => ({
      name: skill.name,
      description: skill.description,
      category: skill.category,
      categoryName: skill.categoryName,
      usageCount: skill.usageCount,
      keywords: skill.keywords,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export const recordSkillUsage = internalMutation({
  args: {
    skillName: v.string(),
    queryText: v.string(),
    wasSuccessful: v.boolean(),
    executionTimeMs: v.optional(v.number()),
    toolsInvoked: v.optional(v.array(v.string())),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Record usage event
    await ctx.db.insert("skillUsage", {
      skillName: args.skillName,
      queryText: args.queryText,
      wasSuccessful: args.wasSuccessful,
      executionTimeMs: args.executionTimeMs,
      toolsInvoked: args.toolsInvoked,
      userId: args.userId,
    });

    // Update skill's usage count and last used timestamp
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.skillName))
      .first() as Doc<"skills"> | null;

    if (skill) {
      await ctx.db.patch(skill._id, {
        usageCount: skill.usageCount + 1,
        lastUsedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { recorded: true };
  },
});

