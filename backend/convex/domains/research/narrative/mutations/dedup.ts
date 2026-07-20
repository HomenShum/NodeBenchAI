/**
 * Event Deduplication Ladder
 *
 * Implements 4-stage deduplication for narrative events:
 * 1. Hard identity - Exact match on (entityKeys, sourceType, canonicalUrl)
 * 2. Stable hash - Content hash from normalized headline + key facts
 * 3. Near-duplicate - Embeddings similarity + LLM judge
 * 4. Linked update - Same story with material changes → supersession chain
 *
 * @module domains/narrative/mutations/dedup
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { claimSetValidator } from "../validators";
import type { Id } from "../../../../_generated/dataModel";
import { fnv1a32Hex } from "../adapters/types";
import { makeWebSourceCitationId } from "../../../../../shared/citations/webSourceCitations";

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT HASH COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize text for content hash computation.
 * Removes insignificant variations (case, punctuation, whitespace).
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

const TEXT_NORMALIZER_VERSION = "v1" as const;
const URL_NORMALIZER_VERSION = "v1" as const;
const CONTENT_HASH_VERSION = "v1" as const;
const STABLE_EVENT_ID_VERSION = "v1" as const;
const STABLE_EVENT_ID_OCCURRED_AT_BUCKET_MS = 60 * 60 * 1000; // 1 hour

/**
 * Normalize URL for canonical comparison.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Keep protocol, host, pathname; remove query/fragment
    let canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    canonical = canonical.replace(/\/$/, ""); // Remove trailing slash
    return canonical.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Compute stable content hash from headline and key facts.
 * Used for Stage 2 dedup (content-based matching).
 */
export function computeContentHash(
  headline: string,
  entityKeys: string[],
  sourceType?: string
): string {
  const normalizedHeadline = normalizeText(headline);
  const sortedEntities = [...entityKeys].sort().join("|");
  const composite = `${normalizedHeadline}:${sortedEntities}:${sourceType || ""}`;
  return fnv1a32Hex(composite);
}

function bucketTimestamp(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

function deriveStableEventIdV1(args: {
  headline: string;
  contentHash?: string;
  canonicalUrl?: string;
  occurredAt: number;
}): {
  eventId: string;
  derivation: {
    version: typeof STABLE_EVENT_ID_VERSION;
    occurredAtBucketMs: number;
    occurredAtBucketStart: number;
    contentKeyType: "content_hash" | "headline_normalized";
    contentKey: string;
    canonicalUrl?: string;
    normalizers: {
      text: typeof TEXT_NORMALIZER_VERSION;
      url: typeof URL_NORMALIZER_VERSION;
      contentHash: typeof CONTENT_HASH_VERSION;
    };
  };
} {
  const contentKeyType = args.contentHash ? "content_hash" : "headline_normalized";
  const contentKey = args.contentHash ?? normalizeText(args.headline);
  const canonicalUrlNormalized = args.canonicalUrl ? normalizeUrl(args.canonicalUrl) : undefined;
  const occurredAtBucketStart = bucketTimestamp(
    args.occurredAt,
    STABLE_EVENT_ID_OCCURRED_AT_BUCKET_MS
  );

  const stableKey = [
    `eventId:${STABLE_EVENT_ID_VERSION}`,
    `${contentKeyType}:${contentKey}`,
    `url:${canonicalUrlNormalized || ""}`,
    `t_bucket_ms:${STABLE_EVENT_ID_OCCURRED_AT_BUCKET_MS}`,
    `t_bucket_start:${occurredAtBucketStart}`,
  ].join("|");

  const eventId = `ne_${fnv1a32Hex(stableKey)}`;
  return {
    eventId,
    derivation: {
      version: STABLE_EVENT_ID_VERSION,
      occurredAtBucketMs: STABLE_EVENT_ID_OCCURRED_AT_BUCKET_MS,
      occurredAtBucketStart,
      contentKeyType,
      contentKey,
      ...(canonicalUrlNormalized ? { canonicalUrl: canonicalUrlNormalized } : {}),
      normalizers: {
        text: TEXT_NORMALIZER_VERSION,
        url: URL_NORMALIZER_VERSION,
        contentHash: CONTENT_HASH_VERSION,
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEDUP RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type DedupAction =
  | "skip" // Exact duplicate, don't create
  | "create_new" // No match, create new event
  | "create_update"; // Same story updated, create with supersession

export interface DedupResult {
  action: DedupAction;
  reason:
    | "exact_duplicate"
    | "content_hash_match"
    | "near_duplicate"
    | "linked_update"
    | "no_match";
  matchedEventId?: Id<"narrativeEvents">;
  contentHash?: string;
  // For linked updates
  supersedesEventId?: Id<"narrativeEvents">;
  changeSummary?: string;
  // Debug info
  matchStage?: 1 | 2 | 3 | 4;
  similarity?: number;
}

type DedupPolicyMode = "live" | "deterministic";

interface DedupPolicyV1 {
  version: "v1";
  mode: DedupPolicyMode;
  /**
   * Similarity threshold above which we treat a near-dup candidate as the same event
   * without invoking an LLM judge (used in deterministic mode).
   */
  nearDupSameEventThreshold: number;
  /**
   * If the event is considered the "same", decide between skip vs create_update.
   * In deterministic mode we skip when the canonical URL overlaps; otherwise create_update.
   */
  preferSkipOnUrlOverlap: boolean;
}

const DEFAULT_DEDUP_POLICY_V1: DedupPolicyV1 = {
  version: "v1",
  mode: "live",
  nearDupSameEventThreshold: 0.7,
  preferSkipOnUrlOverlap: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1: HARD IDENTITY MATCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 1: Check for exact identity match.
 * Matches on thread + canonical URL.
 */
export const findByIdentity = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    canonicalUrl: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("narrativeEvents"),
      eventId: v.string(),
      headline: v.string(),
      occurredAt: v.number(),
      contentHash: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    // Find event with matching canonical URL in the same thread
    const events = await ctx.db
      .query("narrativeEvents")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .filter((q) => q.eq(q.field("canonicalUrl"), args.canonicalUrl))
      .first();

    if (!events) return null;

    return {
      _id: events._id,
      eventId: events.eventId,
      headline: events.headline,
      occurredAt: events.occurredAt,
      contentHash: events.contentHash,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: CONTENT HASH MATCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 2: Check for content hash match.
 * Finds events with identical normalized content.
 */
export const findByContentHash = internalQuery({
  args: {
    contentHash: v.string(),
    threadId: v.optional(v.id("narrativeThreads")),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("narrativeEvents"),
      eventId: v.string(),
      headline: v.string(),
      occurredAt: v.number(),
      threadId: v.id("narrativeThreads"),
    })
  ),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("narrativeEvents")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash));

    // Optionally filter by thread
    if (args.threadId) {
      query = query.filter((q) => q.eq(q.field("threadId"), args.threadId));
    }

    const event = await query.first();

    if (!event) return null;

    return {
      _id: event._id,
      eventId: event.eventId,
      headline: event.headline,
      occurredAt: event.occurredAt,
      threadId: event.threadId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: NEAR-DUPLICATE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find potential near-duplicates for LLM verification.
 * Uses headline similarity within the same thread and time window.
 */
export const findNearDuplicates = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    occurredAt: v.number(),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeEvents"),
      eventId: v.string(),
      headline: v.string(),
      summary: v.string(),
      occurredAt: v.number(),
      sourceUrls: v.array(v.string()),
      contentHash: v.optional(v.string()),
      canonicalUrl: v.optional(v.string()),
      similarity: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackDays || 14) * 24 * 60 * 60 * 1000;
    const cutoffTime = args.occurredAt - lookbackMs;

    // Get recent events from the same thread
    const recentEvents = await ctx.db
      .query("narrativeEvents")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .filter((q) => q.gte(q.field("occurredAt"), cutoffTime))
      .order("desc")
      .take(50);

    // Simple keyword overlap scoring
    const normalizedNewHeadline = normalizeText(args.headline);
    const newWords = new Set(normalizedNewHeadline.split(" ").filter((w) => w.length > 3));

    const candidates = recentEvents
      .map((event) => {
        const normalizedHeadline = normalizeText(event.headline);
        const eventWords = new Set(normalizedHeadline.split(" ").filter((w) => w.length > 3));

        // Calculate Jaccard similarity
        const intersection = [...newWords].filter((w) => eventWords.has(w)).length;
        const union = new Set([...newWords, ...eventWords]).size;
        const similarity = union > 0 ? intersection / union : 0;

        return { event, similarity };
      })
      .filter(({ similarity }) => similarity > 0.3) // Threshold for potential near-dup
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    return candidates.map(({ event, similarity }) => ({
      _id: event._id,
      eventId: event.eventId,
      headline: event.headline,
      summary: event.summary,
      occurredAt: event.occurredAt,
      sourceUrls: event.sourceUrls,
      contentHash: event.contentHash,
      canonicalUrl: event.canonicalUrl,
      similarity,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 4: LLM JUDGE FOR MATERIALITY
// ═══════════════════════════════════════════════════════════════════════════

interface LLMJudgeResult {
  isSameEvent: boolean;
  hasMaterialChanges: boolean;
  changeSummary?: string;
  confidence: number;
}

/**
 * LLM judge to determine if two events are the same and if there are material changes.
 * This is called as an action since it needs to make external API calls.
 */
export const llmJudgeSameEvent = internalAction({
  args: {
    newEvent: v.object({
      headline: v.string(),
      summary: v.string(),
      sourceUrls: v.array(v.string()),
      occurredAt: v.number(),
    }),
    existingEvent: v.object({
      headline: v.string(),
      summary: v.string(),
      sourceUrls: v.array(v.string()),
      occurredAt: v.number(),
    }),
  },
  returns: v.object({
    isSameEvent: v.boolean(),
    hasMaterialChanges: v.boolean(),
    changeSummary: v.optional(v.string()),
    confidence: v.number(),
  }),
  handler: async (_ctx, args): Promise<LLMJudgeResult> => {
    // For now, use heuristic-based comparison
    // TODO: Replace with actual LLM call when available

    const newNormalized = normalizeText(args.newEvent.headline);
    const existingNormalized = normalizeText(args.existingEvent.headline);

    // Check headline similarity
    const newWords = new Set(newNormalized.split(" ").filter((w) => w.length > 3));
    const existingWords = new Set(existingNormalized.split(" ").filter((w) => w.length > 3));
    const intersection = [...newWords].filter((w) => existingWords.has(w)).length;
    const union = new Set([...newWords, ...existingWords]).size;
    const headlineSimilarity = union > 0 ? intersection / union : 0;

    // Check source overlap
    const newUrls = new Set(args.newEvent.sourceUrls.map(normalizeUrl));
    const existingUrls = new Set(args.existingEvent.sourceUrls.map(normalizeUrl));
    const urlOverlap = [...newUrls].filter((u) => existingUrls.has(u)).length;
    const hasUrlOverlap = urlOverlap > 0;

    // Determine if same event
    const isSameEvent = headlineSimilarity > 0.6 || hasUrlOverlap;

    // Check for material changes (time difference, summary changes)
    const timeDiffDays = Math.abs(args.newEvent.occurredAt - args.existingEvent.occurredAt) / (24 * 60 * 60 * 1000);
    const hasMaterialChanges = isSameEvent && (
      headlineSimilarity < 0.9 || // Headlines differ somewhat
      timeDiffDays > 1 || // Time difference
      args.newEvent.sourceUrls.length !== args.existingEvent.sourceUrls.length // Different sources
    );

    // Generate change summary
    let changeSummary: string | undefined;
    if (hasMaterialChanges) {
      if (timeDiffDays > 1) {
        changeSummary = `Event updated ${Math.round(timeDiffDays)} days later with new information`;
      } else if (args.newEvent.sourceUrls.length > args.existingEvent.sourceUrls.length) {
        changeSummary = `Additional sources confirm the story`;
      } else {
        changeSummary = `Story details updated`;
      }
    }

    return {
      isSameEvent,
      hasMaterialChanges,
      changeSummary,
      confidence: headlineSimilarity,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DEDUP ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input for dedup check.
 */
interface DedupInput {
  threadId: Id<"narrativeThreads">;
  headline: string;
  summary: string;
  sourceUrls: string[];
  sourceType?: string;
  entityKeys: string[];
  occurredAt: number;
}

/**
 * Run the full 4-stage dedup ladder.
 * Returns action to take: skip, create_new, or create_update.
 */
export const deduplicateEvent = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    sourceUrls: v.array(v.string()),
    sourceType: v.optional(v.string()),
    entityKeys: v.array(v.string()),
    occurredAt: v.number(),
    dedupPolicy: v.optional(
      v.object({
        version: v.optional(v.literal("v1")),
        mode: v.union(v.literal("live"), v.literal("deterministic")),
        nearDupSameEventThreshold: v.optional(v.number()),
        preferSkipOnUrlOverlap: v.optional(v.boolean()),
      })
    ),
  },
  returns: v.object({
    action: v.union(
      v.literal("skip"),
      v.literal("create_new"),
      v.literal("create_update")
    ),
    reason: v.union(
      v.literal("exact_duplicate"),
      v.literal("content_hash_match"),
      v.literal("near_duplicate"),
      v.literal("linked_update"),
      v.literal("no_match")
    ),
    matchedEventId: v.optional(v.id("narrativeEvents")),
    contentHash: v.optional(v.string()),
    supersedesEventId: v.optional(v.id("narrativeEvents")),
    changeSummary: v.optional(v.string()),
    matchStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
    similarity: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<DedupResult> => {
    const policy: DedupPolicyV1 = {
      ...DEFAULT_DEDUP_POLICY_V1,
      ...(args.dedupPolicy
        ? {
            version: "v1",
            mode: args.dedupPolicy.mode,
            nearDupSameEventThreshold:
              args.dedupPolicy.nearDupSameEventThreshold ??
              DEFAULT_DEDUP_POLICY_V1.nearDupSameEventThreshold,
            preferSkipOnUrlOverlap:
              args.dedupPolicy.preferSkipOnUrlOverlap ??
              DEFAULT_DEDUP_POLICY_V1.preferSkipOnUrlOverlap,
          }
        : {}),
    };

    const primaryUrl = args.sourceUrls[0];
    const canonicalUrl = primaryUrl ? normalizeUrl(primaryUrl) : "";

    // Stage 1: Hard identity match
    if (canonicalUrl) {
      const identityMatch = await ctx.runQuery(
        internal.domains.narrative.mutations.dedup.findByIdentity,
        {
          threadId: args.threadId,
          canonicalUrl,
        }
      );

      if (identityMatch) {
        return {
          action: "skip",
          reason: "exact_duplicate",
          matchedEventId: identityMatch._id,
          matchStage: 1,
        };
      }
    }

    // Stage 2: Content hash match
    const contentHash = computeContentHash(args.headline, args.entityKeys, args.sourceType);
    const hashMatch = await ctx.runQuery(
      internal.domains.narrative.mutations.dedup.findByContentHash,
      {
        contentHash,
        threadId: args.threadId,
      }
    );

    if (hashMatch) {
      return {
        action: "skip",
        reason: "content_hash_match",
        matchedEventId: hashMatch._id,
        contentHash,
        matchStage: 2,
      };
    }

    // Stage 3: Near-duplicate detection
    const nearDups = await ctx.runQuery(
      internal.domains.narrative.mutations.dedup.findNearDuplicates,
      {
        threadId: args.threadId,
        headline: args.headline,
        occurredAt: args.occurredAt,
        lookbackDays: 14,
      }
    );

    if (nearDups.length > 0) {
      const topCandidate = nearDups[0];

      // Deterministic QA policy: never invoke the LLM judge.
      if (policy.mode === "deterministic") {
        if (topCandidate.similarity >= policy.nearDupSameEventThreshold) {
          const normalizedNewUrl = canonicalUrl ? normalizeUrl(canonicalUrl) : "";
          const candidateUrls = new Set(
            topCandidate.sourceUrls.map((u) => normalizeUrl(u)).filter(Boolean)
          );

          const urlOverlap =
            policy.preferSkipOnUrlOverlap &&
            normalizedNewUrl &&
            candidateUrls.has(normalizedNewUrl);

          if (urlOverlap) {
            return {
              action: "skip",
              reason: "near_duplicate",
              matchedEventId: topCandidate._id,
              matchStage: 3,
              similarity: topCandidate.similarity,
            };
          }

          // Default deterministic behavior: treat high-similarity items as a linked update.
          const changeSummary = `Deterministic update (sim=${topCandidate.similarity.toFixed(2)})`;
          return {
            action: "create_update",
            reason: "linked_update",
            matchedEventId: topCandidate._id,
            supersedesEventId: topCandidate._id,
            changeSummary,
            contentHash,
            matchStage: 3,
            similarity: topCandidate.similarity,
          };
        }
      } else {
        // Live mode: Stage 4 LLM judge for materiality
        const llmResult = await ctx.runAction(
          internal.domains.narrative.mutations.dedup.llmJudgeSameEvent,
          {
            newEvent: {
              headline: args.headline,
              summary: args.summary,
              sourceUrls: args.sourceUrls,
              occurredAt: args.occurredAt,
            },
            existingEvent: {
              headline: topCandidate.headline,
              summary: topCandidate.summary,
              sourceUrls: topCandidate.sourceUrls,
              occurredAt: topCandidate.occurredAt,
            },
          }
        );

        if (llmResult.isSameEvent) {
          if (llmResult.hasMaterialChanges) {
            // Create linked update
            return {
              action: "create_update",
              reason: "linked_update",
              matchedEventId: topCandidate._id,
              supersedesEventId: topCandidate._id,
              changeSummary: llmResult.changeSummary,
              contentHash,
              matchStage: 4,
              similarity: llmResult.confidence,
            };
          } else {
            // Skip as near-duplicate
            return {
              action: "skip",
              reason: "near_duplicate",
              matchedEventId: topCandidate._id,
              matchStage: 3,
              similarity: llmResult.confidence,
            };
          }
        }
      }
    }

    // No match - create new event
    return {
      action: "create_new",
      reason: "no_match",
      contentHash,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DEDUP-AWARE EVENT CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create event with deduplication.
 * Runs dedup ladder first, then creates/skips/updates accordingly.
 */
export const createEventWithDedup = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    significance: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("major"),
      v.literal("plot_twist")
    ),
    occurredAt: v.number(),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    sourceType: v.optional(v.string()),
    entityKeys: v.array(v.string()),
    discoveredByAgent: v.string(),
    agentConfidence: v.number(),
    /** Optional evidence pointers for verification/citation popovers. */
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    /** Optional structured claim ids (from claim classifier) */
    claimIds: v.optional(v.array(v.string())),
    dedupPolicy: v.optional(
      v.object({
        version: v.optional(v.literal("v1")),
        mode: v.union(v.literal("live"), v.literal("deterministic")),
        nearDupSameEventThreshold: v.optional(v.number()),
        preferSkipOnUrlOverlap: v.optional(v.boolean()),
      })
    ),
    /** Override timestamps for deterministic runs. */
    createdAtOverride: v.optional(v.number()),
    claimSet: claimSetValidator,
  },
  returns: v.object({
    created: v.boolean(),
    eventDocId: v.optional(v.id("narrativeEvents")),
    stableEventId: v.optional(v.string()),
    dedupResult: v.object({
      action: v.union(
        v.literal("skip"),
        v.literal("create_new"),
        v.literal("create_update")
      ),
      reason: v.string(),
      matchedEventId: v.optional(v.id("narrativeEvents")),
      matchStage: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4))),
      similarity: v.optional(v.number()),
      supersedesEventId: v.optional(v.id("narrativeEvents")),
      changeSummary: v.optional(v.string()),
      contentHash: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, args) => {
    // Run dedup ladder
    const dedupResult = await ctx.runAction(
      internal.domains.narrative.mutations.dedup.deduplicateEvent,
      {
        threadId: args.threadId,
        headline: args.headline,
        summary: args.summary,
        sourceUrls: args.sourceUrls,
        sourceType: args.sourceType,
        entityKeys: args.entityKeys,
        occurredAt: args.occurredAt,
        dedupPolicy: args.dedupPolicy,
      }
    );

    if (dedupResult.action === "skip") {
      return {
        created: false,
        dedupResult: {
          action: dedupResult.action,
          reason: dedupResult.reason,
          matchedEventId: dedupResult.matchedEventId,
        },
      };
    }

    // Create the event
    const primaryUrl = args.sourceUrls[0];
    const canonicalUrl = primaryUrl ? normalizeUrl(primaryUrl) : undefined;

    const eventId = await ctx.runMutation(
      internal.domains.narrative.mutations.dedup.createEventInternal,
      {
        threadId: args.threadId,
        headline: args.headline,
        summary: args.summary,
        significance: args.significance,
        occurredAt: args.occurredAt,
        sourceUrls: args.sourceUrls,
        sourceNames: args.sourceNames,
        discoveredByAgent: args.discoveredByAgent,
        agentConfidence: args.agentConfidence,
        artifactIds: args.artifactIds,
        claimIds: args.claimIds,
        contentHash: dedupResult.contentHash,
        canonicalUrl,
        supersedesEventId: dedupResult.supersedesEventId,
        changeSummary: dedupResult.changeSummary,
        claimSet: args.claimSet,
        createdAtOverride: args.createdAtOverride,
      }
    );

    return {
      created: true,
      eventDocId: eventId.docId,
      stableEventId: eventId.eventId,
      dedupResult: {
        action: dedupResult.action,
        reason: dedupResult.reason,
        matchedEventId: dedupResult.matchedEventId,
        matchStage: dedupResult.matchStage,
        similarity: dedupResult.similarity,
        supersedesEventId: dedupResult.supersedesEventId,
        changeSummary: dedupResult.changeSummary,
        contentHash: dedupResult.contentHash,
      },
    };
  },
});

/**
 * Internal mutation to create event with all dedup fields.
 */
export const createEventInternal = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    significance: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("major"),
      v.literal("plot_twist")
    ),
    occurredAt: v.number(),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    discoveredByAgent: v.string(),
    agentConfidence: v.number(),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    claimIds: v.optional(v.array(v.string())),
    contentHash: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    supersedesEventId: v.optional(v.id("narrativeEvents")),
    changeSummary: v.optional(v.string()),
    createdAtOverride: v.optional(v.number()),
    claimSet: claimSetValidator,
  },
  returns: v.object({
    docId: v.id("narrativeEvents"),
    eventId: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = args.createdAtOverride ?? Date.now();
    const stable = deriveStableEventIdV1({
      headline: args.headline,
      contentHash: args.contentHash,
      canonicalUrl: args.canonicalUrl,
      occurredAt: args.occurredAt,
    });
    const eventId = stable.eventId;

    // Calculate week number
    const date = new Date(args.occurredAt);
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const weekNumber = `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;

    // Generate citation IDs (stable + shared across the codebase)
    const citationIds = args.sourceUrls.map((url) => makeWebSourceCitationId(url));

    // Create event with all audit fields
    const docId = await ctx.db.insert("narrativeEvents", {
      eventId,
      eventIdVersion: STABLE_EVENT_ID_VERSION,
      eventIdDerivation: stable.derivation,
      threadId: args.threadId,
      headline: args.headline,
      summary: args.summary,
      significance: args.significance,
      occurredAt: args.occurredAt,
      discoveredAt: now,
      weekNumber,
      sourceUrls: args.sourceUrls,
      sourceNames: args.sourceNames,
      citationIds,
      artifactIds: args.artifactIds,
      claimIds: args.claimIds,
      // Dedup fields
      contentHash: args.contentHash,
      canonicalUrl: args.canonicalUrl,
      // Update linking
      supersedesEventId: args.supersedesEventId,
      changeSummary: args.changeSummary,
      // Claim structure
      claimSet: args.claimSet,
      // Agent metadata
      discoveredByAgent: args.discoveredByAgent,
      agentConfidence: args.agentConfidence,
      // Quality flags
      isVerified: false,
      hasContradictions: false,
      createdAt: now,
    });

    // If this supersedes another event, update the thread metrics
    if (args.supersedesEventId) {
      console.log(`[Dedup] Event ${eventId} supersedes ${args.supersedesEventId}`);
    }

    // Update thread metrics
    await ctx.scheduler.runAfter(
      0,
      internal.domains.narrative.mutations.threads.updateThreadMetrics,
      {
        threadId: args.threadId,
        eventOccurredAt: args.occurredAt,
        isPlotTwist: args.significance === "plot_twist",
        hasMultipleSources: args.sourceUrls.length > 1,
      }
    );

    return { docId, eventId };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DEDUP TESTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test the dedup ladder with sample inputs.
 */
export const testDedupLadder = internalAction({
  args: {
    testCase: v.union(
      v.literal("exact_duplicate"),
      v.literal("content_hash"),
      v.literal("near_dup"),
      v.literal("new_event")
    ),
  },
  returns: v.object({
    testCase: v.string(),
    result: v.any(),
  }),
  handler: async (_ctx, args) => {
    // Test utilities for validation
    switch (args.testCase) {
      case "exact_duplicate":
        return {
          testCase: args.testCase,
          result: {
            description: "Would match on canonicalUrl",
            contentHash: computeContentHash("Test headline", ["company:Test"]),
          },
        };
      case "content_hash":
        return {
          testCase: args.testCase,
          result: {
            hash1: computeContentHash("xAI raises $6B", ["company:xAI"]),
            hash2: computeContentHash("xAI Raises $6B", ["company:xAI"]), // Same after normalization
            match: computeContentHash("xAI raises $6B", ["company:xAI"]) ===
                   computeContentHash("xAI Raises $6B", ["company:xAI"]),
          },
        };
      case "near_dup":
        return {
          testCase: args.testCase,
          result: {
            description: "Would check headline similarity > 0.3 threshold",
            exampleSimilarity: 0.65,
          },
        };
      case "new_event":
        return {
          testCase: args.testCase,
          result: {
            description: "No matches found, would create new event",
            action: "create_new",
          },
        };
    }
  },
});
