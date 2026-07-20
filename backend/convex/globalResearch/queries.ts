// convex/globalResearch/queries.ts
// Global query fingerprinting and cache management.
// Each unique (query, toolConfig) combination gets a queryKey for cache lookup.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { hashSync } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Fingerprint algorithm version - bump when algo changes */
export const FINGERPRINT_VERSION = 1;

/** Tool versions - bump when tool behavior changes significantly */
export const TOOL_VERSIONS: Record<string, string> = {
  linkup_search: "v2",
  linkup_structured_search: "v1",
  sec_filings_search: "v1",
  sec_filing_content: "v1",
  youtube_search: "v1",
  crunchbase_lookup: "v1",
};

/** Default TTLs by query type (in milliseconds) */
export const DEFAULT_TTLS = {
  news: 6 * 60 * 60 * 1000,              // 6 hours
  funding: 24 * 60 * 60 * 1000,          // 24 hours
  companyOverview: 7 * 24 * 60 * 60 * 1000, // 7 days
  background: 30 * 24 * 60 * 60 * 1000,  // 30 days
  default: 24 * 60 * 60 * 1000,          // 24 hours
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a query string for fingerprinting.
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Stable JSON stringify with sorted keys.
 */
function stableStringify(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

/**
 * Generate a deterministic query key from query + config.
 * 
 * Key = "qk_" + hash(normalizedQuery + toolName + toolVersion + configHash + fpVersion)
 */
export function generateQueryKey(
  query: string,
  toolName: string,
  toolConfig: Record<string, unknown>
): string {
  const normalized = normalizeQuery(query);
  const toolVersion = TOOL_VERSIONS[toolName] || "v0";
  const configHash = hashSync(stableStringify(toolConfig));

  const fingerprint = [
    normalized,
    toolName,
    toolVersion,
    configHash,
    `fp${FINGERPRINT_VERSION}`,
  ].join("|");

  return `qk_${hashSync(fingerprint)}`;
}

/**
 * Generate tool config hash for storage.
 */
export function generateToolConfigHash(toolConfig: Record<string, unknown>): string {
  return hashSync(stableStringify(toolConfig));
}

/**
 * Determine TTL for a query based on content.
 */
export function getTTLForQuery(
  query: string,
  toolConfig: Record<string, unknown>
): number {
  const q = query.toLowerCase();

  // If explicit date constraints, use short TTL
  if (
    toolConfig.fromDate ||
    toolConfig.toDate ||
    q.includes("today") ||
    q.includes("this week") ||
    q.includes("latest") ||
    q.includes("recent")
  ) {
    return DEFAULT_TTLS.news;
  }

  // Funding-related queries
  if (
    q.includes("funding") ||
    q.includes("raised") ||
    q.includes("series") ||
    q.includes("investment")
  ) {
    return DEFAULT_TTLS.funding;
  }

  // Background/overview queries
  if (
    q.includes("overview") ||
    q.includes("background") ||
    q.includes("history") ||
    q.includes("founded")
  ) {
    return DEFAULT_TTLS.background;
  }

  return DEFAULT_TTLS.default;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a global query record.
 * Creates if not exists, or returns existing queryKey.
 */
export const upsertQuery = internalMutation({
  args: {
    query: v.string(),
    toolName: v.string(),
    toolConfig: v.any(),
    entityKey: v.optional(v.string()),
  },
  returns: v.object({
    queryKey: v.string(),
    ttlMs: v.number(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, { query, toolName, toolConfig, entityKey }) => {
    const queryKey = generateQueryKey(query, toolName, toolConfig);
    const normalizedQuery = normalizeQuery(query);
    const toolConfigHash = generateToolConfigHash(toolConfig);
    const toolVersion = TOOL_VERSIONS[toolName] || "v0";
    const ttlMs = getTTLForQuery(query, toolConfig);

    // Check if exists
    const existing = await ctx.db
      .query("globalQueries")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueries"> | null;

    if (existing) {
      return {
        queryKey,
        ttlMs: existing.ttlMs,
        isNew: false,
      };
    }

    // Insert new
    await ctx.db.insert("globalQueries", {
      queryKey,
      normalizedQuery,
      toolName,
      toolConfig,
      toolConfigHash,
      toolVersion,
      fingerprintVersion: FINGERPRINT_VERSION,
      entityKey: entityKey ?? "", // Empty string for unscoped
      ttlMs,
      createdAt: Date.now(),
    });

    console.log(
      `[globalResearch/queries] Created query: ${queryKey}`,
      { toolName, ttlMs }
    );

    return {
      queryKey,
      ttlMs,
      isNew: true,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a global query by its key.
 */
export const getByKey = internalQuery({
  args: {
    queryKey: v.string(),
  },
  handler: async (ctx, { queryKey }) => {
    return (await ctx.db
      .query("globalQueries")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first()) as Doc<"globalQueries"> | null;
  },
});

/**
 * Get queries for an entity.
 * WARNING: Only use when entityKey !== "".
 */
export const getByEntity = internalQuery({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, limit = 50 }) => {
    if (!entityKey) {
      console.warn("[globalResearch/queries] getByEntity called with empty entityKey");
      return [];
    }

    return ctx.db
      .query("globalQueries")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", entityKey))
      .take(limit);
  },
});

/**
 * Check if a queryKey exists and get its metadata.
 */
export const checkQueryExists = internalQuery({
  args: {
    query: v.string(),
    toolName: v.string(),
    toolConfig: v.any(),
  },
  returns: v.union(
    v.object({
      exists: v.literal(true),
      queryKey: v.string(),
      ttlMs: v.number(),
      createdAt: v.number(),
    }),
    v.object({
      exists: v.literal(false),
      queryKey: v.string(),
      ttlMs: v.number(),
    })
  ),
  handler: async (ctx, { query, toolName, toolConfig }) => {
    const queryKey = generateQueryKey(query, toolName, toolConfig);
    const ttlMs = getTTLForQuery(query, toolConfig);

    const existing = await ctx.db
      .query("globalQueries")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueries"> | null;

    if (existing) {
      return {
        exists: true as const,
        queryKey,
        ttlMs: existing.ttlMs,
        createdAt: existing.createdAt,
      };
    }

    return {
      exists: false as const,
      queryKey,
      ttlMs,
    };
  },
});
