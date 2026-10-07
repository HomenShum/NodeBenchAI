/**
 * Narrative Correlations Mutations
 *
 * Detects and stores relationships between events across threads.
 * Correlation types:
 * - causal: A caused B
 * - temporal: A and B happened together
 * - entity_overlap: A and B involve same entities
 * - topic_similarity: A and B are about similar topics
 *
 * Correlation basis (for audit defensibility):
 * - shared_entity: Hard proof - same entity key
 * - shared_investor: Hard proof - investor overlap
 * - explicit_reference: Hard proof - one cites the other
 * - time_proximity: Soft proof - within same week
 * - topic_similarity: Soft proof - embedding distance
 * - llm_inference: Soft proof - LLM-detected causality
 *
 * @module domains/narrative/mutations/correlations
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Doc, Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type CorrelationType = "causal" | "temporal" | "entity_overlap" | "topic_similarity";

type CorrelationBasis =
  | "shared_entity"
  | "shared_investor"
  | "explicit_reference"
  | "time_proximity"
  | "topic_similarity"
  | "llm_inference";

type ReviewStatus =
  | "auto_approved"
  | "needs_review"
  | "human_verified"
  | "human_rejected";

/**
 * Hard proof bases that can be auto-approved.
 */
const HARD_PROOF_BASES: Set<CorrelationBasis> = new Set([
  "shared_entity",
  "shared_investor",
  "explicit_reference",
]);

/**
 * Determine if a correlation basis is hard proof (auto-approvable).
 */
function isHardProof(basis: CorrelationBasis): boolean {
  return HARD_PROOF_BASES.has(basis);
}

interface CorrelationCandidate {
  primaryEventId: Id<"narrativeEvents">;
  relatedEventId: Id<"narrativeEvents">;
  correlationType: CorrelationType;
  correlationBasis: CorrelationBasis;
  strength: number;
  description: string;
  evidenceEventIds?: Id<"narrativeEvents">[];
  evidenceCitationIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE CORRELATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new correlation between events.
 * Includes proof standard fields for audit defensibility.
 */
export const createCorrelation = internalMutation({
  args: {
    correlationId: v.string(),
    primaryEventId: v.id("narrativeEvents"),
    primaryThreadId: v.id("narrativeThreads"),
    relatedEventIds: v.array(v.id("narrativeEvents")),
    relatedThreadIds: v.array(v.id("narrativeThreads")),
    correlationType: v.union(
      v.literal("causal"),
      v.literal("temporal"),
      v.literal("entity_overlap"),
      v.literal("topic_similarity")
    ),
    strength: v.number(),
    description: v.string(),
    discoveredByAgent: v.string(),
    weekNumber: v.string(),
    // Proof standard fields (Phase 6)
    correlationBasis: v.optional(
      v.union(
        v.literal("shared_entity"),
        v.literal("shared_investor"),
        v.literal("explicit_reference"),
        v.literal("time_proximity"),
        v.literal("topic_similarity"),
        v.literal("llm_inference")
      )
    ),
    evidenceEventIds: v.optional(v.array(v.id("narrativeEvents"))),
    evidenceCitationIds: v.optional(v.array(v.string())),
    reviewStatus: v.optional(
      v.union(
        v.literal("auto_approved"),
        v.literal("needs_review"),
        v.literal("human_verified"),
        v.literal("human_rejected")
      )
    ),
  },
  returns: v.id("narrativeCorrelations"),
  handler: async (ctx, args) => {
    // Determine review status based on correlation basis
    let reviewStatus: ReviewStatus = "needs_review";
    if (args.reviewStatus) {
      reviewStatus = args.reviewStatus;
    } else if (args.correlationBasis && isHardProof(args.correlationBasis)) {
      reviewStatus = "auto_approved";
    }

    return await ctx.db.insert("narrativeCorrelations", {
      correlationId: args.correlationId,
      primaryEventId: args.primaryEventId,
      primaryThreadId: args.primaryThreadId,
      relatedEventIds: args.relatedEventIds,
      relatedThreadIds: args.relatedThreadIds,
      correlationType: args.correlationType,
      strength: args.strength,
      description: args.description,
      discoveredByAgent: args.discoveredByAgent,
      weekNumber: args.weekNumber,
      // Proof standard fields
      correlationBasis: args.correlationBasis,
      evidenceEventIds: args.evidenceEventIds,
      evidenceCitationIds: args.evidenceCitationIds,
      reviewStatus,
      createdAt: Date.now(),
    });
  },
});

/**
 * Batch create correlations with proof standard fields.
 */
export const batchCreateCorrelations = internalMutation({
  args: {
    correlations: v.array(
      v.object({
        correlationId: v.string(),
        primaryEventId: v.id("narrativeEvents"),
        primaryThreadId: v.id("narrativeThreads"),
        relatedEventIds: v.array(v.id("narrativeEvents")),
        relatedThreadIds: v.array(v.id("narrativeThreads")),
        correlationType: v.union(
          v.literal("causal"),
          v.literal("temporal"),
          v.literal("entity_overlap"),
          v.literal("topic_similarity")
        ),
        strength: v.number(),
        description: v.string(),
        discoveredByAgent: v.string(),
        weekNumber: v.string(),
        // Proof standard fields (Phase 6)
        correlationBasis: v.optional(
          v.union(
            v.literal("shared_entity"),
            v.literal("shared_investor"),
            v.literal("explicit_reference"),
            v.literal("time_proximity"),
            v.literal("topic_similarity"),
            v.literal("llm_inference")
          )
        ),
        evidenceEventIds: v.optional(v.array(v.id("narrativeEvents"))),
        evidenceCitationIds: v.optional(v.array(v.string())),
        reviewStatus: v.optional(
          v.union(
            v.literal("auto_approved"),
            v.literal("needs_review"),
            v.literal("human_verified"),
            v.literal("human_rejected")
          )
        ),
      })
    ),
  },
  returns: v.array(v.id("narrativeCorrelations")),
  handler: async (ctx, args) => {
    const ids: Id<"narrativeCorrelations">[] = [];
    const now = Date.now();

    for (const corr of args.correlations) {
      // Determine review status based on correlation basis
      let reviewStatus: ReviewStatus = "needs_review";
      if (corr.reviewStatus) {
        reviewStatus = corr.reviewStatus;
      } else if (corr.correlationBasis && isHardProof(corr.correlationBasis)) {
        reviewStatus = "auto_approved";
      }

      const id = await ctx.db.insert("narrativeCorrelations", {
        correlationId: corr.correlationId,
        primaryEventId: corr.primaryEventId,
        primaryThreadId: corr.primaryThreadId,
        relatedEventIds: corr.relatedEventIds,
        relatedThreadIds: corr.relatedThreadIds,
        correlationType: corr.correlationType,
        strength: corr.strength,
        description: corr.description,
        discoveredByAgent: corr.discoveredByAgent,
        weekNumber: corr.weekNumber,
        // Proof standard fields
        correlationBasis: corr.correlationBasis,
        evidenceEventIds: corr.evidenceEventIds,
        evidenceCitationIds: corr.evidenceCitationIds,
        reviewStatus,
        createdAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATION DETECTION QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get events within a time window for temporal correlation detection.
 */
export const getEventsInTimeWindow = internalQuery({
  args: {
    startTime: v.number(),
    endTime: v.number(),
    excludeEventIds: v.optional(v.array(v.id("narrativeEvents"))),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeEvents"),
      threadId: v.id("narrativeThreads"),
      headline: v.string(),
      occurredAt: v.number(),
      weekNumber: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("narrativeEvents")
      .withIndex("by_discovery")
      .filter((q) =>
        q.and(
          q.gte(q.field("occurredAt"), args.startTime),
          q.lte(q.field("occurredAt"), args.endTime)
        )
      )
      .collect();

    const excludeSet = new Set(args.excludeEventIds || []);

    return events
      .filter((e) => !excludeSet.has(e._id))
      .map((e) => ({
        _id: e._id,
        threadId: e.threadId,
        headline: e.headline,
        occurredAt: e.occurredAt,
        weekNumber: e.weekNumber,
      }));
  },
});

/**
 * Get events that share entity keys with a given event.
 */
export const getEventsWithSharedEntities = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    excludeEventId: v.id("narrativeEvents"),
    lookbackWeeks: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeEvents"),
      threadId: v.id("narrativeThreads"),
      headline: v.string(),
      occurredAt: v.number(),
      sharedEntities: v.array(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    // Get the thread to find its entity keys
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    const entityKeys = thread.entityKeys || [];
    if (entityKeys.length === 0) return [];

    // Get all threads that share entity keys
    const allThreads = await ctx.db.query("narrativeThreads").collect();
    const relatedThreads = allThreads.filter(
      (t) =>
        t._id !== args.threadId &&
        t.entityKeys?.some((key: string) => entityKeys.includes(key))
    );

    // Get events from related threads
    const results: Array<{
      _id: Id<"narrativeEvents">;
      threadId: Id<"narrativeThreads">;
      headline: string;
      occurredAt: number;
      sharedEntities: string[];
    }> = [];

    for (const relatedThread of relatedThreads) {
      const events = await ctx.db
        .query("narrativeEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", relatedThread._id))
        .take(20);

      for (const event of events) {
        if (event._id === args.excludeEventId) continue;

        const sharedEntities = relatedThread.entityKeys?.filter((key: string) =>
          entityKeys.includes(key)
        ) || [];

        results.push({
          _id: event._id,
          threadId: event.threadId,
          headline: event.headline,
          occurredAt: event.occurredAt,
          sharedEntities,
        });
      }
    }

    return results;
  },
});

/**
 * Get existing correlations for an event.
 */
export const getCorrelationsForEvent = internalQuery({
  args: {
    eventId: v.id("narrativeEvents"),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeCorrelations"),
      correlationId: v.string(),
      correlationType: v.string(),
      strength: v.number(),
      description: v.string(),
      relatedEventIds: v.array(v.id("narrativeEvents")),
    })
  ),
  handler: async (ctx, args) => {
    const correlations = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_event", (q) => q.eq("primaryEventId", args.eventId))
      .collect();

    return correlations.map((c) => ({
      _id: c._id,
      correlationId: c.correlationId,
      correlationType: c.correlationType,
      strength: c.strength,
      description: c.description,
      relatedEventIds: c.relatedEventIds,
    }));
  },
});

/**
 * Get correlations for a thread.
 */
export const getCorrelationsForThread = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeCorrelations"),
      correlationId: v.string(),
      primaryEventId: v.id("narrativeEvents"),
      correlationType: v.string(),
      strength: v.number(),
      description: v.string(),
      relatedEventIds: v.array(v.id("narrativeEvents")),
      relatedThreadIds: v.array(v.id("narrativeThreads")),
    })
  ),
  handler: async (ctx, args) => {
    const correlations = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_thread", (q) => q.eq("primaryThreadId", args.threadId))
      .collect();

    return correlations.map((c) => ({
      _id: c._id,
      correlationId: c.correlationId,
      primaryEventId: c.primaryEventId,
      correlationType: c.correlationType,
      strength: c.strength,
      description: c.description,
      relatedEventIds: c.relatedEventIds,
      relatedThreadIds: c.relatedThreadIds,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATION DETECTION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect correlations for events in a given week.
 * Runs as an action to allow multiple queries.
 */
export const detectCorrelationsForWeek = internalAction({
  args: {
    weekNumber: v.string(),
    minStrength: v.optional(v.number()),
  },
  returns: v.object({
    detected: v.number(),
    created: v.number(),
  }),
  handler: async (ctx, args): Promise<{ detected: number; created: number }> => {
    const minStrength = args.minStrength ?? 0.5;

    // Get all events for the week
    const events: Array<Doc<"narrativeEvents">> = await ctx.runQuery(
      internal.domains.narrative.queries.events.internalGetEventsByWeek,
      { weekNumber: args.weekNumber }
    );

    const correlationCandidates: CorrelationCandidate[] = [];

    // Detect temporal correlations (events within 24 hours)
    // Basis: time_proximity (soft proof - needs review)
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const event1 = events[i];
        const event2 = events[j];

        // Skip if same thread
        if (event1.threadId === event2.threadId) continue;

        const timeDiff = Math.abs(event1.occurredAt - event2.occurredAt);
        const oneDay = 24 * 60 * 60 * 1000;

        if (timeDiff <= oneDay) {
          const strength = 1 - timeDiff / oneDay; // Closer in time = stronger

          if (strength >= minStrength) {
            correlationCandidates.push({
              primaryEventId: event1._id,
              relatedEventId: event2._id,
              correlationType: "temporal",
              correlationBasis: "time_proximity", // Soft proof
              strength,
              description: `Events occurred within ${Math.round(timeDiff / 3600000)} hours`,
              evidenceEventIds: [event1._id, event2._id],
            });
          }
        }
      }
    }

    // Detect entity overlap correlations
    // Basis: shared_entity (hard proof - auto-approved)
    for (const event of events) {
      const sharedEntityEvents = await ctx.runQuery(
        internal.domains.narrative.mutations.correlations.getEventsWithSharedEntities,
        {
          threadId: event.threadId,
          excludeEventId: event._id,
          lookbackWeeks: 4,
        }
      );

      for (const related of sharedEntityEvents) {
        const entityCount = related.sharedEntities.length;
        const strength = Math.min(1, entityCount * 0.3); // Each shared entity adds 0.3

        if (strength >= minStrength) {
          correlationCandidates.push({
            primaryEventId: event._id,
            relatedEventId: related._id,
            correlationType: "entity_overlap",
            correlationBasis: "shared_entity", // Hard proof - auto-approved
            strength,
            description: `Events share entities: ${related.sharedEntities.join(", ")}`,
            evidenceEventIds: [event._id, related._id],
          });
        }
      }
    }

    // Deduplicate (same pair shouldn't have multiple correlations of same type)
    const seen = new Set<string>();
    const uniqueCandidates = correlationCandidates.filter((c) => {
      const key = [c.primaryEventId, c.relatedEventId, c.correlationType]
        .sort()
        .join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Get thread IDs for events
    const eventToThread = new Map<string, Id<"narrativeThreads">>();
    for (const event of events) {
      eventToThread.set(event._id, event.threadId);
    }

    // Create correlations with proof standard fields
    const toCreate = uniqueCandidates.map((c, i) => ({
      correlationId: `nc_${args.weekNumber}_${i}`,
      primaryEventId: c.primaryEventId,
      primaryThreadId: eventToThread.get(c.primaryEventId) || events[0].threadId,
      relatedEventIds: [c.relatedEventId],
      relatedThreadIds: [eventToThread.get(c.relatedEventId) || events[0].threadId],
      correlationType: c.correlationType as CorrelationType,
      strength: c.strength,
      description: c.description,
      discoveredByAgent: "CorrelationDetector",
      weekNumber: args.weekNumber,
      // Proof standard fields
      correlationBasis: c.correlationBasis,
      evidenceEventIds: c.evidenceEventIds,
      evidenceCitationIds: c.evidenceCitationIds,
      // Review status will be auto-determined based on basis
    }));

    if (toCreate.length > 0) {
      await ctx.runMutation(
        internal.domains.narrative.mutations.correlations.batchCreateCorrelations,
        { correlations: toCreate }
      );
    }

    return {
      detected: uniqueCandidates.length,
      created: toCreate.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW WORKFLOW QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get correlations by basis and review status.
 * Useful for audit workflow and HITL review.
 */
export const getByBasisAndStatus = internalQuery({
  args: {
    basis: v.optional(
      v.union(
        v.literal("shared_entity"),
        v.literal("shared_investor"),
        v.literal("explicit_reference"),
        v.literal("time_proximity"),
        v.literal("topic_similarity"),
        v.literal("llm_inference")
      )
    ),
    reviewStatus: v.optional(
      v.union(
        v.literal("auto_approved"),
        v.literal("needs_review"),
        v.literal("human_verified"),
        v.literal("human_rejected")
      )
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeCorrelations"),
      correlationId: v.string(),
      correlationType: v.string(),
      correlationBasis: v.optional(v.string()),
      strength: v.number(),
      description: v.string(),
      reviewStatus: v.optional(v.string()),
      primaryEventId: v.id("narrativeEvents"),
      relatedEventIds: v.array(v.id("narrativeEvents")),
      weekNumber: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let query;

    // Use index if we have both basis and status
    if (args.basis && args.reviewStatus) {
      query = ctx.db
        .query("narrativeCorrelations")
        .withIndex("by_basis", (q) =>
          q.eq("correlationBasis", args.basis).eq("reviewStatus", args.reviewStatus)
        );
    } else if (args.reviewStatus) {
      query = ctx.db
        .query("narrativeCorrelations")
        .withIndex("by_review_status", (q) => q.eq("reviewStatus", args.reviewStatus));
    } else {
      query = ctx.db.query("narrativeCorrelations");
      if (args.basis) {
        query = query.filter((q) => q.eq(q.field("correlationBasis"), args.basis));
      }
    }

    const correlations = await query.order("desc").take(limit);

    return correlations.map((c) => ({
      _id: c._id,
      correlationId: c.correlationId,
      correlationType: c.correlationType,
      correlationBasis: c.correlationBasis,
      strength: c.strength,
      description: c.description,
      reviewStatus: c.reviewStatus,
      primaryEventId: c.primaryEventId,
      relatedEventIds: c.relatedEventIds,
      weekNumber: c.weekNumber,
      createdAt: c.createdAt,
    }));
  },
});

/**
 * Get correlations pending human review.
 * Focuses on llm_inference correlations which are most dangerous.
 */
export const getPendingReview = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeCorrelations"),
      correlationId: v.string(),
      correlationType: v.string(),
      correlationBasis: v.optional(v.string()),
      strength: v.number(),
      description: v.string(),
      primaryEventId: v.id("narrativeEvents"),
      relatedEventIds: v.array(v.id("narrativeEvents")),
      weekNumber: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    const correlations = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_review_status", (q) => q.eq("reviewStatus", "needs_review"))
      .order("desc")
      .take(limit);

    return correlations.map((c) => ({
      _id: c._id,
      correlationId: c.correlationId,
      correlationType: c.correlationType,
      correlationBasis: c.correlationBasis,
      strength: c.strength,
      description: c.description,
      primaryEventId: c.primaryEventId,
      relatedEventIds: c.relatedEventIds,
      weekNumber: c.weekNumber,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW WORKFLOW MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update review status for a correlation.
 * Used by HITL workflow to approve/reject correlations.
 */
export const updateReviewStatus = internalMutation({
  args: {
    correlationId: v.id("narrativeCorrelations"),
    reviewStatus: v.union(
      v.literal("auto_approved"),
      v.literal("needs_review"),
      v.literal("human_verified"),
      v.literal("human_rejected")
    ),
    reviewedBy: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const isHumanReview = args.reviewStatus === "human_verified" || args.reviewStatus === "human_rejected";

    await ctx.db.patch(args.correlationId, {
      reviewStatus: args.reviewStatus,
      reviewedBy: isHumanReview ? (args.reviewedBy || "unknown") : undefined,
      reviewedAt: isHumanReview ? Date.now() : undefined,
    });

    console.log(
      `[CorrelationReview] Updated ${args.correlationId} to ${args.reviewStatus}` +
        (args.reviewNote ? `: ${args.reviewNote}` : "")
    );

    return null;
  },
});

/**
 * Batch update review status.
 * Useful for bulk approval/rejection.
 */
export const batchUpdateReviewStatus = internalMutation({
  args: {
    correlationIds: v.array(v.id("narrativeCorrelations")),
    reviewStatus: v.union(
      v.literal("auto_approved"),
      v.literal("needs_review"),
      v.literal("human_verified"),
      v.literal("human_rejected")
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let updated = 0;

    for (const id of args.correlationIds) {
      await ctx.db.patch(id, {
        reviewStatus: args.reviewStatus,
      });
      updated++;
    }

    console.log(
      `[CorrelationReview] Batch updated ${updated} correlations to ${args.reviewStatus}`
    );

    return updated;
  },
});

/**
 * Get review statistics for audit dashboard.
 */
export const getReviewStats = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    autoApproved: v.number(),
    needsReview: v.number(),
    humanVerified: v.number(),
    humanRejected: v.number(),
    byBasis: v.array(
      v.object({
        basis: v.string(),
        count: v.number(),
        needsReviewCount: v.number(),
      })
    ),
  }),
  handler: async (ctx) => {
    const allCorrelations = await ctx.db.query("narrativeCorrelations").collect();

    const stats = {
      total: allCorrelations.length,
      autoApproved: 0,
      needsReview: 0,
      humanVerified: 0,
      humanRejected: 0,
      byBasis: new Map<string, { count: number; needsReviewCount: number }>(),
    };

    for (const c of allCorrelations) {
      // Count by review status
      switch (c.reviewStatus) {
        case "auto_approved":
          stats.autoApproved++;
          break;
        case "needs_review":
          stats.needsReview++;
          break;
        case "human_verified":
          stats.humanVerified++;
          break;
        case "human_rejected":
          stats.humanRejected++;
          break;
      }

      // Count by basis
      const basis = c.correlationBasis || "unknown";
      const current = stats.byBasis.get(basis) || { count: 0, needsReviewCount: 0 };
      current.count++;
      if (c.reviewStatus === "needs_review") {
        current.needsReviewCount++;
      }
      stats.byBasis.set(basis, current);
    }

    return {
      total: stats.total,
      autoApproved: stats.autoApproved,
      needsReview: stats.needsReview,
      humanVerified: stats.humanVerified,
      humanRejected: stats.humanRejected,
      byBasis: Array.from(stats.byBasis.entries()).map(([basis, data]) => ({
        basis,
        count: data.count,
        needsReviewCount: data.needsReviewCount,
      })),
    };
  },
});
