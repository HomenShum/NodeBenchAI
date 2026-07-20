/**
 * blipMutations.ts - Database operations for blips
 *
 * CRUD operations for newsItems, claimSpans, meaningBlips, personaLenses.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";

// ============================================================================
// Validators
// ============================================================================

const newsSourceValidator = v.union(
  v.literal("hacker_news"),
  v.literal("arxiv"),
  v.literal("reddit"),
  v.literal("rss"),
  v.literal("github"),
  v.literal("product_hunt"),
  v.literal("dev_to"),
  v.literal("twitter"),
  v.literal("manual")
);

const categoryValidator = v.union(
  v.literal("tech"),
  v.literal("ai_ml"),
  v.literal("funding"),
  v.literal("research"),
  v.literal("security"),
  v.literal("startup"),
  v.literal("product"),
  v.literal("regulatory"),
  v.literal("markets"),
  v.literal("general")
);

const processingStatusValidator = v.union(
  v.literal("ingested"),
  v.literal("claim_extraction"),
  v.literal("blips_generated"),
  v.literal("verification_queued"),
  v.literal("complete")
);

const claimTypeValidator = v.union(
  v.literal("factual"),
  v.literal("quantitative"),
  v.literal("attribution"),
  v.literal("temporal"),
  v.literal("causal"),
  v.literal("comparative"),
  v.literal("predictive"),
  v.literal("opinion")
);

const verificationStatusValidator = v.union(
  v.literal("unverified"),
  v.literal("pending"),
  v.literal("verified"),
  v.literal("partially_verified"),
  v.literal("contradicted"),
  v.literal("unverifiable")
);

const reliabilityValidator = v.union(
  v.literal("authoritative"),
  v.literal("reliable"),
  v.literal("secondary"),
  v.literal("inferred")
);

const verdictValidator = v.union(
  v.literal("verified"),
  v.literal("partially_verified"),
  v.literal("contradicted"),
  v.literal("unverifiable"),
  v.literal("insufficient_evidence")
);

// ============================================================================
// News Items Mutations (Internal)
// ============================================================================

/**
 * Upsert a news item (idempotent by sourceId)
 */
export const upsertNewsItem = internalMutation({
  args: {
    sourceId: v.string(),
    contentHash: v.string(),
    source: newsSourceValidator,
    sourceUrl: v.string(),
    title: v.string(),
    fullContent: v.optional(v.string()),
    summary: v.optional(v.string()),
    category: categoryValidator,
    tags: v.array(v.string()),
    engagementScore: v.number(),
    rawMetrics: v.optional(v.object({
      upvotes: v.optional(v.number()),
      comments: v.optional(v.number()),
      shares: v.optional(v.number()),
      stars: v.optional(v.number()),
    })),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Check for existing by sourceId
    const existing = await ctx.db
      .query("newsItems")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .first() as Doc<"newsItems"> | null;

    if (existing) {
      // Update if content changed
      if (existing.contentHash !== args.contentHash) {
        await ctx.db.patch(existing._id, {
          contentHash: args.contentHash,
          title: args.title,
          fullContent: args.fullContent,
          summary: args.summary,
          engagementScore: args.engagementScore,
          rawMetrics: args.rawMetrics,
        });
      }
      return { id: existing._id, isNew: false };
    }

    // Insert new
    const id = await ctx.db.insert("newsItems", {
      sourceId: args.sourceId,
      contentHash: args.contentHash,
      source: args.source,
      sourceUrl: args.sourceUrl,
      title: args.title,
      fullContent: args.fullContent,
      summary: args.summary,
      category: args.category,
      tags: args.tags,
      engagementScore: args.engagementScore,
      rawMetrics: args.rawMetrics,
      processingStatus: "ingested",
      publishedAt: args.publishedAt,
      ingestedAt: Date.now(),
    });

    return { id, isNew: true };
  },
});

/**
 * Update news item processing status
 */
export const updateNewsItemStatus = internalMutation({
  args: {
    newsItemId: v.id("newsItems"),
    status: processingStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.newsItemId, {
      processingStatus: args.status,
      processedAt: Date.now(),
    });
    return args.newsItemId;
  },
});

// ============================================================================
// Claim Spans Mutations (Internal)
// ============================================================================

/**
 * Insert a claim span
 */
export const insertClaimSpan = internalMutation({
  args: {
    newsItemId: v.id("newsItems"),
    claimText: v.string(),
    originalSpan: v.string(),
    spanStartIdx: v.number(),
    spanEndIdx: v.number(),
    claimType: claimTypeValidator,
    entities: v.array(v.object({
      name: v.string(),
      type: v.union(
        v.literal("company"),
        v.literal("person"),
        v.literal("product"),
        v.literal("technology"),
        v.literal("organization"),
        v.literal("location")
      ),
      linkedEntityId: v.optional(v.id("entityContexts")),
    })),
    extractionConfidence: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("claimSpans", {
      newsItemId: args.newsItemId,
      claimText: args.claimText,
      originalSpan: args.originalSpan,
      spanStartIdx: args.spanStartIdx,
      spanEndIdx: args.spanEndIdx,
      claimType: args.claimType,
      entities: args.entities,
      verificationStatus: "unverified",
      extractionConfidence: args.extractionConfidence,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Update claim span verification status
 */
export const updateClaimVerification = internalMutation({
  args: {
    claimSpanId: v.id("claimSpans"),
    verificationStatus: verificationStatusValidator,
    verificationId: v.optional(v.id("blipClaimVerifications")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.claimSpanId, {
      verificationStatus: args.verificationStatus,
      verificationId: args.verificationId,
    });
    return args.claimSpanId;
  },
});

// ============================================================================
// Meaning Blips Mutations (Internal)
// ============================================================================

/**
 * Insert a meaning blip
 */
export const insertMeaningBlip = internalMutation({
  args: {
    newsItemId: v.id("newsItems"),
    claimSpanId: v.optional(v.id("claimSpans")),
    headline: v.string(),
    summary: v.string(),
    context: v.string(),
    keyFacts: v.array(v.object({
      fact: v.string(),
      source: v.optional(v.string()),
      date: v.optional(v.string()),
      confidence: v.number(),
    })),
    primaryEntity: v.optional(v.object({
      name: v.string(),
      type: v.string(),
      linkedEntityId: v.optional(v.id("entityContexts")),
    })),
    verificationSummary: v.object({
      totalClaims: v.number(),
      verifiedClaims: v.number(),
      contradictedClaims: v.number(),
      overallConfidence: v.number(),
    }),
    sources: v.array(v.object({
      name: v.string(),
      url: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      reliability: reliabilityValidator,
    })),
    relevanceScore: v.number(),
    engagementScore: v.number(),
    freshnessScore: v.number(),
    category: v.string(),
    tags: v.array(v.string()),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("meaningBlips", {
      newsItemId: args.newsItemId,
      claimSpanId: args.claimSpanId,
      headline: args.headline,
      summary: args.summary,
      context: args.context,
      keyFacts: args.keyFacts,
      primaryEntity: args.primaryEntity,
      verificationSummary: args.verificationSummary,
      sources: args.sources,
      relevanceScore: args.relevanceScore,
      engagementScore: args.engagementScore,
      freshnessScore: args.freshnessScore,
      category: args.category,
      tags: args.tags,
      publishedAt: args.publishedAt,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update blip verification summary
 */
export const updateBlipVerificationSummary = internalMutation({
  args: {
    blipId: v.id("meaningBlips"),
    verificationSummary: v.object({
      totalClaims: v.number(),
      verifiedClaims: v.number(),
      contradictedClaims: v.number(),
      overallConfidence: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.blipId, {
      verificationSummary: args.verificationSummary,
      updatedAt: Date.now(),
    });
    return args.blipId;
  },
});

// ============================================================================
// Persona Lenses Mutations (Internal)
// ============================================================================

/**
 * Insert a persona lens
 */
export const insertPersonaLens = internalMutation({
  args: {
    blipId: v.id("meaningBlips"),
    personaId: v.string(),
    framingHook: v.string(),
    actionPrompt: v.optional(v.string()),
    relevanceScore: v.number(),
    whyItMatters: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("personaLenses", {
      blipId: args.blipId,
      personaId: args.personaId,
      framingHook: args.framingHook,
      actionPrompt: args.actionPrompt,
      relevanceScore: args.relevanceScore,
      whyItMatters: args.whyItMatters,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Bulk insert persona lenses for a blip
 */
export const bulkInsertPersonaLenses = internalMutation({
  args: {
    blipId: v.id("meaningBlips"),
    lenses: v.array(v.object({
      personaId: v.string(),
      framingHook: v.string(),
      actionPrompt: v.optional(v.string()),
      relevanceScore: v.number(),
      whyItMatters: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const ids: Id<"personaLenses">[] = [];
    const now = Date.now();

    for (const lens of args.lenses) {
      const id = await ctx.db.insert("personaLenses", {
        blipId: args.blipId,
        personaId: lens.personaId,
        framingHook: lens.framingHook,
        actionPrompt: lens.actionPrompt,
        relevanceScore: lens.relevanceScore,
        whyItMatters: lens.whyItMatters,
        createdAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// ============================================================================
// Claim Verifications Mutations (Internal)
// ============================================================================

/**
 * Insert a claim verification result
 */
export const insertClaimVerification = internalMutation({
  args: {
    claimSpanId: v.id("claimSpans"),
    verdict: verdictValidator,
    confidence: v.number(),
    supportingEvidence: v.array(v.object({
      sourceUrl: v.optional(v.string()),
      sourceName: v.string(),
      snippet: v.string(),
      publishedAt: v.optional(v.number()),
      alignment: v.union(
        v.literal("supports"),
        v.literal("contradicts"),
        v.literal("neutral")
      ),
    })),
    contradictions: v.optional(v.array(v.object({
      contradictingClaim: v.string(),
      sourceUrl: v.optional(v.string()),
      sourceName: v.string(),
    }))),
    judgeModel: v.string(),
    judgeReasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("blipClaimVerifications", {
      claimSpanId: args.claimSpanId,
      verdict: args.verdict,
      confidence: args.confidence,
      supportingEvidence: args.supportingEvidence,
      contradictions: args.contradictions,
      judgeModel: args.judgeModel,
      judgeReasoning: args.judgeReasoning,
      createdAt: now,
      updatedAt: now,
    });

    // Update the claim span with verification reference
    await ctx.db.patch(args.claimSpanId, {
      verificationStatus: mapVerdictToStatus(args.verdict),
      verificationId: id,
    });

    return id;
  },
});

// ============================================================================
// Helpers
// ============================================================================

function mapVerdictToStatus(verdict: string): "verified" | "partially_verified" | "contradicted" | "unverifiable" {
  switch (verdict) {
    case "verified":
      return "verified";
    case "partially_verified":
      return "partially_verified";
    case "contradicted":
      return "contradicted";
    case "unverifiable":
    case "insufficient_evidence":
    default:
      return "unverifiable";
  }
}
