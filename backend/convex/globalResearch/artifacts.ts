// convex/globalResearch/artifacts.ts
// Global artifact store with URL deduplication.
// One row per unique canonicalUrl across all users/runs.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { hashSync, canonicalizeUrl, extractHost } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Prefix for global artifact keys */
const ARTIFACT_KEY_PREFIX = "ga_";

/** Number of shards for distributed locking (matches artifact persistence) */
export const NUM_SHARDS = 32;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate deterministic artifact key from canonical URL.
 * Key = "ga_" + hash(canonicalUrl)
 */
export function generateArtifactKey(canonicalUrl: string): string {
  return `${ARTIFACT_KEY_PREFIX}${hashSync(canonicalUrl)}`;
}

/**
 * Generate content hash for change detection.
 * Hash = hash(title + "|" + snippet)
 */
export function generateContentHash(title?: string, snippet?: string): string {
  const content = `${title || ""}|${snippet || ""}`;
  return hashSync(content);
}

/**
 * Get shard index for a canonical URL (for distributed locking).
 */
export function getShardIndex(canonicalUrl: string): number {
  const hash = hashSync(canonicalUrl);
  // Convert first 8 chars of hash to number and mod by NUM_SHARDS
  let num = 0;
  for (let i = 0; i < Math.min(8, hash.length); i++) {
    num = (num * 36) + parseInt(hash[i], 36);
  }
  return Math.abs(num) % NUM_SHARDS;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a global artifact by canonical URL.
 * 
 * Pattern: query-then-insert with race tolerance.
 * - If exists: update lastSeenAt, seenCount, and content if changed
 * - If not exists: insert new row
 * 
 * Races may create duplicates; dedupe cron handles cleanup.
 */
export const upsertGlobal = internalMutation({
  args: {
    canonicalUrl: v.string(),
    title: v.optional(v.string()),
    snippet: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    isBackfill: v.optional(v.boolean()),
  },
  returns: v.string(), // artifactKey
  handler: async (ctx, { canonicalUrl, title, snippet, thumbnail, isBackfill }) => {
    const normalized = canonicalizeUrl(canonicalUrl);
    const artifactKey = generateArtifactKey(normalized);
    const domain = extractHost(normalized);
    const contentHash = generateContentHash(title, snippet);
    const now = Date.now();

    // Query by artifactKey (more selective than canonicalUrl)
    const existing = await ctx.db
      .query("globalArtifacts")
      .withIndex("by_artifactKey", (q) => q.eq("artifactKey", artifactKey))
      .first() as Doc<"globalArtifacts"> | null;

    if (existing) {
      // Check if content changed
      const contentChanged = existing.contentHash !== contentHash;

      // Always update lastSeenAt and seenCount
      const patch: Record<string, unknown> = {
        lastSeenAt: now,
        seenCount: existing.seenCount + 1,
      };

      // Only update content fields if they changed
      if (contentChanged) {
        patch.title = title;
        patch.snippet = snippet;
        patch.thumbnail = thumbnail;
        patch.contentHash = contentHash;
      }

      await ctx.db.patch(existing._id, patch);

      if (!isBackfill) {
        console.log(
          `[globalResearch/artifacts] Updated: ${artifactKey}`,
          { contentChanged, seenCount: existing.seenCount + 1 }
        );
      }

      return artifactKey;
    }

    // Insert new
    await ctx.db.insert("globalArtifacts", {
      artifactKey,
      canonicalUrl: normalized,
      domain,
      title,
      snippet,
      thumbnail,
      contentHash,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 1,
    });

    if (!isBackfill) {
      console.log(`[globalResearch/artifacts] Inserted: ${artifactKey}`, { domain });
    }

    return artifactKey;
  },
});

/**
 * Get a global artifact by its key.
 */
export const getByKey = internalQuery({
  args: {
    artifactKey: v.string(),
  },
  handler: async (ctx, { artifactKey }) => {
    return ctx.db
      .query("globalArtifacts")
      .withIndex("by_artifactKey", (q) => q.eq("artifactKey", artifactKey))
      .first() as Doc<"globalArtifacts"> | null;
  },
});

/**
 * Get a global artifact by canonical URL.
 */
export const getByCanonicalUrl = internalQuery({
  args: {
    canonicalUrl: v.string(),
  },
  handler: async (ctx, { canonicalUrl }) => {
    const normalized = canonicalizeUrl(canonicalUrl);
    const artifactKey = generateArtifactKey(normalized);

    return ctx.db
      .query("globalArtifacts")
      .withIndex("by_artifactKey", (q) => q.eq("artifactKey", artifactKey))
      .first() as Doc<"globalArtifacts"> | null;
  },
});

/**
 * Get multiple global artifacts by keys.
 */
export const getByKeys = internalQuery({
  args: {
    artifactKeys: v.array(v.string()),
  },
  handler: async (ctx, { artifactKeys }) => {
    const results = await Promise.all(
      artifactKeys.map((key: string) =>
        ctx.db
          .query("globalArtifacts")
          .withIndex("by_artifactKey", (q) => q.eq("artifactKey", key))
          .first() as Promise<Doc<"globalArtifacts"> | null>
      )
    );
    return results.filter((r): r is Doc<"globalArtifacts"> => r !== null);
  },
});

/**
 * Get top artifacts by domain (for domain-specific dashboards).
 */
export const getByDomain = internalQuery({
  args: {
    domain: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { domain, limit = 50 }) => {
    return ctx.db
      .query("globalArtifacts")
      .withIndex("by_domain_lastSeenAt", (q) => q.eq("domain", domain))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get recently seen artifacts (for "what's trending" views).
 */
export const getRecent = internalQuery({
  args: {
    limit: v.optional(v.number()),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 100, sinceMs }) => {
    const since = sinceMs ?? Date.now() - 24 * 60 * 60 * 1000; // Default: last 24h
    
    return ctx.db
      .query("globalArtifacts")
      .withIndex("by_lastSeenAt", (q) => q.gte("lastSeenAt", since))
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPE CRON SUPPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find duplicate artifacts by canonicalUrl.
 * Returns groups of duplicates for merging.
 */
export const findDuplicates = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 100 }) => {
    // Get all artifacts ordered by canonicalUrl
    // This is expensive but only runs in cron
    const artifacts = await ctx.db
      .query("globalArtifacts")
      .withIndex("by_canonicalUrl")
      .take(10000); // Cap for safety

    // Group by canonicalUrl
    const groups = new Map<string, typeof artifacts>();
    for (const artifact of artifacts) {
      const existing = groups.get(artifact.canonicalUrl);
      if (existing) {
        existing.push(artifact);
      } else {
        groups.set(artifact.canonicalUrl, [artifact]);
      }
    }

    // Return only groups with duplicates
    const duplicates: Array<{
      canonicalUrl: string;
      count: number;
      ids: string[];
      winner: string; // Keep the one with lowest firstSeenAt
    }> = [];

    for (const [canonicalUrl, group] of groups) {
      if (group.length > 1) {
        // Sort by firstSeenAt - keep the oldest
        group.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
        const winner = group[0];
        
        duplicates.push({
          canonicalUrl,
          count: group.length,
          ids: group.map((a) => a._id.toString()),
          winner: winner._id.toString(),
        });

        if (duplicates.length >= limit) break;
      }
    }

    return duplicates;
  },
});

/**
 * Merge duplicate artifacts into winner and delete losers.
 * Aggregates seenCount and keeps earliest firstSeenAt.
 */
export const mergeDuplicates = internalMutation({
  args: {
    canonicalUrl: v.string(),
  },
  returns: v.object({
    merged: v.boolean(),
    winnerId: v.optional(v.string()),
    deletedCount: v.number(),
    totalSeenCount: v.number(),
  }),
  handler: async (ctx, { canonicalUrl }) => {
    const artifacts = await ctx.db
      .query("globalArtifacts")
      .withIndex("by_canonicalUrl", (q) => q.eq("canonicalUrl", canonicalUrl))
      .collect();

    if (artifacts.length <= 1) {
      return { merged: false, deletedCount: 0, totalSeenCount: artifacts[0]?.seenCount ?? 0 };
    }

    // Sort by firstSeenAt - keep the oldest
    artifacts.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    const winner = artifacts[0];
    const losers = artifacts.slice(1);

    // Aggregate stats
    let totalSeenCount = winner.seenCount;
    let latestSeenAt = winner.lastSeenAt;
    
    for (const loser of losers) {
      totalSeenCount += loser.seenCount;
      if (loser.lastSeenAt > latestSeenAt) {
        latestSeenAt = loser.lastSeenAt;
      }
    }

    // Update winner with aggregated stats
    await ctx.db.patch(winner._id, {
      seenCount: totalSeenCount,
      lastSeenAt: latestSeenAt,
    });

    // Delete losers
    for (const loser of losers) {
      await ctx.db.delete(loser._id);
    }

    console.log(
      `[globalResearch/artifacts] Merged ${losers.length} duplicates into ${winner.artifactKey}`,
      { totalSeenCount }
    );

    return {
      merged: true,
      winnerId: winner._id.toString(),
      deletedCount: losers.length,
      totalSeenCount,
    };
  },
});

/**
 * Run dedupe for a batch of URLs.
 * Called by compaction cron.
 * 
 * Note: This mutation directly performs merge operations inline
 * rather than calling mergeDuplicates to avoid mutation-calling-mutation issues.
 */
export const dedupeArtifactsBatch = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    duplicatesFound: v.number(),
    artifactsMerged: v.number(),
  }),
  handler: async (ctx, { batchSize = 50 }) => {
    // Find duplicates by scanning and grouping
    const allArtifacts = await ctx.db
      .query("globalArtifacts")
      .withIndex("by_canonicalUrl")
      .take(10000);

    // Group by canonicalUrl
    const groups = new Map<string, typeof allArtifacts>();
    for (const artifact of allArtifacts) {
      const existing = groups.get(artifact.canonicalUrl);
      if (existing) {
        existing.push(artifact);
      } else {
        groups.set(artifact.canonicalUrl, [artifact]);
      }
    }

    // Filter to only groups with duplicates
    const duplicateGroups: Array<{ canonicalUrl: string; artifacts: typeof allArtifacts }> = [];
    for (const [url, artifacts] of groups) {
      if (artifacts.length > 1) {
        duplicateGroups.push({ canonicalUrl: url, artifacts });
        if (duplicateGroups.length >= batchSize) break;
      }
    }

    // Merge each duplicate group inline
    let totalMerged = 0;
    for (const { artifacts } of duplicateGroups) {
      // Sort by firstSeenAt - keep the oldest
      artifacts.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
      const winner = artifacts[0];
      const losers = artifacts.slice(1);

      // Aggregate stats
      let totalSeenCount = winner.seenCount;
      let latestSeenAt = winner.lastSeenAt;

      for (const loser of losers) {
        totalSeenCount += loser.seenCount;
        if (loser.lastSeenAt > latestSeenAt) {
          latestSeenAt = loser.lastSeenAt;
        }
      }

      // Update winner
      await ctx.db.patch(winner._id, {
        seenCount: totalSeenCount,
        lastSeenAt: latestSeenAt,
      });

      // Delete losers
      for (const loser of losers) {
        await ctx.db.delete(loser._id);
      }

      totalMerged += losers.length;
    }

    if (duplicateGroups.length > 0) {
      console.log(
        `[globalResearch/artifacts] Dedupe batch completed`,
        { processed: duplicateGroups.length, merged: totalMerged }
      );
    }

    return {
      processed: duplicateGroups.length,
      duplicatesFound: duplicateGroups.length,
      artifactsMerged: totalMerged,
    };
  },
});
