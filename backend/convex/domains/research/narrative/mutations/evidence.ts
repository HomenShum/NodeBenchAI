/**
 * Evidence Artifact Mutations
 *
 * CRUD operations for immutable evidence artifacts.
 * Evidence artifacts are append-only and never modified after creation.
 * Used for audit trail and provenance tracking.
 *
 * @module domains/narrative/mutations/evidence
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../../_generated/server";
import { fnv1a32Hex } from "../adapters/types";

const EVIDENCE_ARTIFACT_VERSION = "v1" as const;
const EVIDENCE_URL_NORMALIZER_VERSION = "v1" as const;
const EVIDENCE_CONTENT_HASH_VERSION = "v1" as const;

// ═══════════════════════════════════════════════════════════════════════════
// CREDIBILITY TIER DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Known tier 1 (primary) publishers - authoritative sources.
 */
const TIER1_PUBLISHERS = new Set([
  "reuters.com",
  "wsj.com",
  "bloomberg.com",
  "ft.com",
  "sec.gov",
  "federalreserve.gov",
  "treasury.gov",
  "bls.gov",
  "census.gov",
  "epa.gov",
  "fda.gov",
  "who.int",
]);

/**
 * Known tier 2 (established) publishers - major tech/business outlets.
 */
const TIER2_PUBLISHERS = new Set([
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "arstechnica.com",
  "businessinsider.com",
  "cnbc.com",
  "fortune.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "bbc.com",
  "bbc.co.uk",
  "axios.com",
  "politico.com",
  "theatlantic.com",
]);

/**
 * Known tier 3 (community) publishers - social/forum content.
 */
const TIER3_PUBLISHERS = new Set([
  "news.ycombinator.com",
  "reddit.com",
  "twitter.com",
  "x.com",
  "medium.com",
  "substack.com",
  "linkedin.com",
  "github.com",
]);

type CredibilityTier =
  | "tier1_primary"
  | "tier2_established"
  | "tier3_community"
  | "tier4_unverified";

/**
 * Detect credibility tier based on publisher domain.
 */
function detectCredibilityTier(publisher: string): CredibilityTier {
  const normalizedPublisher = publisher.toLowerCase().replace(/^www\./, "");

  if (TIER1_PUBLISHERS.has(normalizedPublisher)) {
    return "tier1_primary";
  }
  if (TIER2_PUBLISHERS.has(normalizedPublisher)) {
    return "tier2_established";
  }
  if (TIER3_PUBLISHERS.has(normalizedPublisher)) {
    return "tier3_community";
  }
  return "tier4_unverified";
}

/**
 * Normalize URL for dedup comparison.
 * Removes trailing slashes, query params, and fragments.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Keep only protocol, host, and pathname
    let canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    // Remove trailing slash
    canonical = canonical.replace(/\/$/, "");
    return canonical.toLowerCase();
  } catch {
    // If URL parsing fails, return cleaned original
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Extract publisher domain from URL.
 */
function extractPublisher(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Generate stable artifact ID from URL and content hash.
 */
function generateArtifactId(canonicalUrl: string, contentHash: string): string {
  return `ea_${fnv1a32Hex(`${canonicalUrl}:${contentHash}`)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE EVIDENCE ARTIFACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new evidence artifact (immutable).
 * Returns existing artifact ID if content already exists.
 */
export const createEvidenceArtifact = internalMutation({
  args: {
    url: v.string(),
    contentHash: v.string(),
    publishedAt: v.optional(v.number()),
    fetchedAt: v.optional(v.number()),
    extractedQuotes: v.array(
      v.object({
        text: v.string(),
        context: v.optional(v.string()),
      })
    ),
    entities: v.array(v.string()),
    topics: v.array(v.string()),
    retrievalTrace: v.object({
      searchQuery: v.optional(v.string()),
      agentName: v.string(),
      toolName: v.string(),
    }),
    // Optional overrides
    publisher: v.optional(v.string()),
    credibilityTier: v.optional(
      v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      )
    ),
  },
  returns: v.object({
    artifactId: v.string(),
    _id: v.id("evidenceArtifacts"),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const canonicalUrl = normalizeUrl(args.url);
    const now = args.fetchedAt ?? Date.now();

    // Check if artifact with same content hash already exists
    const existingByHash = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();

    if (existingByHash) {
      return {
        artifactId: existingByHash.artifactId,
        _id: existingByHash._id,
        isNew: false,
      };
    }

    // Check if artifact with same canonical URL exists
    const existingByUrl = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", canonicalUrl))
      .order("desc")
      .first();

    if (existingByUrl) {
      if (existingByUrl.contentHash === args.contentHash) {
      return {
        artifactId: existingByUrl.artifactId,
        _id: existingByUrl._id,
        isNew: false,
      };
      }
    }

    // Create new artifact
    const publisher = args.publisher || extractPublisher(args.url);
    const credibilityTier = args.credibilityTier || detectCredibilityTier(publisher);
    const artifactId = generateArtifactId(canonicalUrl, args.contentHash);

    const _id = await ctx.db.insert("evidenceArtifacts", {
      artifactId,
      artifactVersion: EVIDENCE_ARTIFACT_VERSION,
      urlNormalizationVersion: EVIDENCE_URL_NORMALIZER_VERSION,
      contentHashVersion: EVIDENCE_CONTENT_HASH_VERSION,
      url: args.url,
      canonicalUrl,
      publisher,
      publishedAt: args.publishedAt,
      fetchedAt: now,
      contentHash: args.contentHash,
      extractedQuotes: args.extractedQuotes,
      entities: args.entities,
      topics: args.topics,
      credibilityTier,
      retrievalTrace: args.retrievalTrace,
      supersedesArtifactId: existingByUrl ? existingByUrl.artifactId : undefined,
      createdAt: now,
    });

    return { artifactId, _id, isNew: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH CREATE EVIDENCE ARTIFACTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create multiple evidence artifacts in a batch.
 * Automatically deduplicates by content hash and canonical URL.
 */
export const batchCreateEvidenceArtifacts = internalMutation({
  args: {
    artifacts: v.array(
      v.object({
        url: v.string(),
        contentHash: v.string(),
        publishedAt: v.optional(v.number()),
        fetchedAt: v.optional(v.number()),
        extractedQuotes: v.array(
          v.object({
            text: v.string(),
            context: v.optional(v.string()),
          })
        ),
        entities: v.array(v.string()),
        topics: v.array(v.string()),
        retrievalTrace: v.object({
          searchQuery: v.optional(v.string()),
          agentName: v.string(),
          toolName: v.string(),
        }),
        publisher: v.optional(v.string()),
        credibilityTier: v.optional(
          v.union(
            v.literal("tier1_primary"),
            v.literal("tier2_established"),
            v.literal("tier3_community"),
            v.literal("tier4_unverified")
          )
        ),
      })
    ),
  },
  returns: v.array(
    v.object({
      artifactId: v.string(),
      _id: v.id("evidenceArtifacts"),
      isNew: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const results: Array<{
      artifactId: string;
      _id: any;
      isNew: boolean;
    }> = [];

    for (const artifact of args.artifacts) {
      const canonicalUrl = normalizeUrl(artifact.url);
      const now = artifact.fetchedAt ?? Date.now();

      // Check for existing by content hash
      const existingByHash = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_content_hash", (q) =>
          q.eq("contentHash", artifact.contentHash)
        )
        .first();

      if (existingByHash) {
        results.push({
          artifactId: existingByHash.artifactId,
          _id: existingByHash._id,
          isNew: false,
        });
        continue;
      }

      // Check for existing by URL
      const existingByUrl = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", canonicalUrl))
        .order("desc")
        .first();

      if (existingByUrl) {
        if (existingByUrl.contentHash === artifact.contentHash) {
        results.push({
          artifactId: existingByUrl.artifactId,
          _id: existingByUrl._id,
          isNew: false,
        });
        continue;
        }
      }

      // Create new artifact
      const publisher = artifact.publisher || extractPublisher(artifact.url);
      const credibilityTier =
        artifact.credibilityTier || detectCredibilityTier(publisher);
      const artifactId = generateArtifactId(canonicalUrl, artifact.contentHash);

      const _id = await ctx.db.insert("evidenceArtifacts", {
        artifactId,
        artifactVersion: EVIDENCE_ARTIFACT_VERSION,
        urlNormalizationVersion: EVIDENCE_URL_NORMALIZER_VERSION,
        contentHashVersion: EVIDENCE_CONTENT_HASH_VERSION,
        url: artifact.url,
        canonicalUrl,
        publisher,
        publishedAt: artifact.publishedAt,
        fetchedAt: now,
        contentHash: artifact.contentHash,
        extractedQuotes: artifact.extractedQuotes,
        entities: artifact.entities,
        topics: artifact.topics,
        credibilityTier,
        retrievalTrace: artifact.retrievalTrace,
        supersedesArtifactId: existingByUrl ? existingByUrl.artifactId : undefined,
        createdAt: now,
      });

      results.push({ artifactId, _id, isNew: true });
    }

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY EVIDENCE ARTIFACTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get evidence artifact by stable artifact ID.
 */
export const getByArtifactId = internalQuery({
  args: {
    artifactId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      canonicalUrl: v.string(),
      publisher: v.string(),
      publishedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      contentHash: v.string(),
      extractedQuotes: v.array(
        v.object({
          text: v.string(),
          context: v.optional(v.string()),
        })
      ),
      entities: v.array(v.string()),
      topics: v.array(v.string()),
      credibilityTier: v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      ),
      retrievalTrace: v.object({
        searchQuery: v.optional(v.string()),
        agentName: v.string(),
        toolName: v.string(),
      }),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Artifact IDs start with "ea_" prefix
    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .filter((q) => q.eq(q.field("artifactId"), args.artifactId))
      .first();

    return artifacts;
  },
});

/**
 * Get evidence artifact by canonical URL.
 */
export const getByCanonicalUrl = internalQuery({
  args: {
    url: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      canonicalUrl: v.string(),
      publisher: v.string(),
      publishedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      contentHash: v.string(),
      credibilityTier: v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      ),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const canonicalUrl = normalizeUrl(args.url);

    const artifact = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", canonicalUrl))
      .order("desc")
      .first();

    if (!artifact) return null;

    return {
      _id: artifact._id,
      artifactId: artifact.artifactId,
      url: artifact.url,
      canonicalUrl: artifact.canonicalUrl,
      publisher: artifact.publisher,
      publishedAt: artifact.publishedAt,
      fetchedAt: artifact.fetchedAt,
      contentHash: artifact.contentHash,
      credibilityTier: artifact.credibilityTier,
      createdAt: artifact.createdAt,
    };
  },
});

/**
 * Get evidence artifact by content hash.
 */
export const getByContentHash = internalQuery({
  args: {
    contentHash: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      canonicalUrl: v.string(),
      publisher: v.string(),
      contentHash: v.string(),
      credibilityTier: v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      ),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const artifact = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();

    if (!artifact) return null;

    return {
      _id: artifact._id,
      artifactId: artifact.artifactId,
      url: artifact.url,
      canonicalUrl: artifact.canonicalUrl,
      publisher: artifact.publisher,
      contentHash: artifact.contentHash,
      credibilityTier: artifact.credibilityTier,
      createdAt: artifact.createdAt,
    };
  },
});

/**
 * Get evidence artifacts by credibility tier.
 * Useful for filtering by source quality.
 */
export const getByCredibilityTier = internalQuery({
  args: {
    tier: v.union(
      v.literal("tier1_primary"),
      v.literal("tier2_established"),
      v.literal("tier3_community"),
      v.literal("tier4_unverified")
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      publisher: v.string(),
      publishedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_credibility", (q) => q.eq("credibilityTier", args.tier))
      .order("desc")
      .take(limit);

    return artifacts.map((a) => ({
      _id: a._id,
      artifactId: a.artifactId,
      url: a.url,
      publisher: a.publisher,
      publishedAt: a.publishedAt,
      fetchedAt: a.fetchedAt,
      createdAt: a.createdAt,
    }));
  },
});

/**
 * Get evidence artifacts by publisher.
 * Useful for source-specific queries.
 */
export const getByPublisher = internalQuery({
  args: {
    publisher: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      publishedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      extractedQuotes: v.array(
        v.object({
          text: v.string(),
          context: v.optional(v.string()),
        })
      ),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const normalizedPublisher = args.publisher.toLowerCase().replace(/^www\./, "");

    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_publisher", (q) => q.eq("publisher", normalizedPublisher))
      .order("desc")
      .take(limit);

    return artifacts.map((a) => ({
      _id: a._id,
      artifactId: a.artifactId,
      url: a.url,
      publishedAt: a.publishedAt,
      fetchedAt: a.fetchedAt,
      extractedQuotes: a.extractedQuotes,
      createdAt: a.createdAt,
    }));
  },
});

/**
 * Get multiple evidence artifacts by their stable IDs.
 * Useful for resolving evidence references in events/claims.
 */
export const getByArtifactIds = internalQuery({
  args: {
    artifactIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("evidenceArtifacts"),
      artifactId: v.string(),
      url: v.string(),
      publisher: v.string(),
      publishedAt: v.optional(v.number()),
      credibilityTier: v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      ),
      extractedQuotes: v.array(
        v.object({
          text: v.string(),
          context: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const results: Array<{
      _id: any;
      artifactId: string;
      url: string;
      publisher: string;
      publishedAt?: number;
      credibilityTier:
        | "tier1_primary"
        | "tier2_established"
        | "tier3_community"
        | "tier4_unverified";
      extractedQuotes: Array<{ text: string; context?: string }>;
    }> = [];

    for (const artifactId of args.artifactIds) {
      const artifact = await ctx.db
        .query("evidenceArtifacts")
        .filter((q) => q.eq(q.field("artifactId"), artifactId))
        .first();

      if (artifact) {
        results.push({
          _id: artifact._id,
          artifactId: artifact.artifactId,
          url: artifact.url,
          publisher: artifact.publisher,
          publishedAt: artifact.publishedAt,
          credibilityTier: artifact.credibilityTier,
          extractedQuotes: artifact.extractedQuotes,
        });
      }
    }

    return results;
  },
});
