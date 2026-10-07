/**
 * encounterMutations.ts - Database operations for encounters
 *
 * CRUD operations for the encounterEvents table.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../_generated/server";
import { Id, Doc } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  EncounterParticipant,
  EncounterCompany,
  FastPassResults,
  EncounterResearchStatus,
} from "./types";

// ============================================================================
// Validators (reusable)
// ============================================================================

const participantValidator = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  company: v.optional(v.string()),
  email: v.optional(v.string()),
  linkedEntityId: v.optional(v.id("entityContexts")),
  confidence: v.number(),
});

const companyValidator = v.object({
  name: v.string(),
  linkedEntityId: v.optional(v.id("entityContexts")),
  confidence: v.number(),
});

const researchStatusValidator = v.union(
  v.literal("none"),
  v.literal("fast_pass_queued"),
  v.literal("fast_pass_complete"),
  v.literal("deep_dive_queued"),
  v.literal("deep_dive_running"),
  v.literal("complete")
);

// ============================================================================
// Public Mutations
// ============================================================================

/**
 * Create a new encounter from web UI
 */
export const createEncounter = mutation({
  args: {
    rawText: v.string(),
    title: v.optional(v.string()),
    context: v.optional(v.string()),
    participants: v.optional(v.array(participantValidator)),
    companies: v.optional(v.array(companyValidator)),
    requestFastPass: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();

    const encounterId = await ctx.db.insert("encounterEvents", {
      userId,
      sourceType: "web_ui",
      rawText: args.rawText,
      title: args.title || generateTitle(args.rawText),
      context: args.context,
      participants: args.participants || [],
      companies: args.companies || [],
      researchStatus: args.requestFastPass ? "fast_pass_queued" : "none",
      followUpRequested: false,
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return encounterId;
  },
});

/**
 * Update encounter with fast-pass results
 */
export const updateWithFastPassResults = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    fastPassResults: v.object({
      entitySummaries: v.array(v.object({
        entityName: v.string(),
        summary: v.string(),
        keyFacts: v.array(v.string()),
        fundingStage: v.optional(v.string()),
        lastFundingAmount: v.optional(v.string()),
        sector: v.optional(v.string()),
      })),
      generatedAt: v.number(),
      elapsedMs: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.encounterId, {
      fastPassResults: args.fastPassResults,
      researchStatus: "fast_pass_complete",
      enrichedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

/**
 * Request deep dive (trigger full DD job)
 */
export const requestDeepDive = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    entityName: v.string(),
    entityType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    // Update status to deep_dive_queued
    await ctx.db.patch(args.encounterId, {
      researchStatus: "deep_dive_queued",
      updatedAt: Date.now(),
    });

    // Return info for triggering DD job
    return {
      encounterId: args.encounterId,
      entityName: args.entityName,
      entityType: args.entityType || "company",
    };
  },
});

/**
 * Update encounter with DD job ID
 */
export const linkDDJob = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    ddJobId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.encounterId, {
      ddJobId: args.ddJobId,
      researchStatus: "deep_dive_running",
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

/**
 * Update encounter with completed DD memo
 */
export const completeDDEnrichment = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    ddMemoId: v.id("dueDiligenceMemos"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.encounterId, {
      ddMemoId: args.ddMemoId,
      researchStatus: "complete",
      enrichedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

/**
 * Update extracted entities after NER
 */
export const updateExtractedEntities = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    participants: v.array(participantValidator),
    companies: v.array(companyValidator),
    title: v.optional(v.string()),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.encounterId, {
      participants: args.participants,
      companies: args.companies,
      title: args.title || encounter.title,
      context: args.context || encounter.context,
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

/**
 * Set follow-up request
 */
export const setFollowUp = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
    followUpRequested: v.boolean(),
    followUpDate: v.optional(v.number()),
    suggestedNextAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.encounterId, {
      followUpRequested: args.followUpRequested,
      followUpDate: args.followUpDate,
      suggestedNextAction: args.suggestedNextAction,
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

/**
 * Delete an encounter
 */
export const deleteEncounter = mutation({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) throw new Error("Encounter not found");
    if (encounter.userId !== userId) throw new Error("Not authorized");

    await ctx.db.delete(args.encounterId);
    return { deleted: true };
  },
});

// ============================================================================
// Internal Mutations (for system-side operations)
// ============================================================================

/**
 * Create encounter from Slack (internal, called by Slack webhook handler)
 */
export const createFromSlack = internalMutation({
  args: {
    userId: v.id("users"),
    rawText: v.string(),
    title: v.string(),
    channelId: v.string(),
    messageTs: v.string(),
    participants: v.array(participantValidator),
    companies: v.array(companyValidator),
    requestFastPass: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const encounterId = await ctx.db.insert("encounterEvents", {
      userId: args.userId,
      sourceType: "slack",
      sourceId: args.messageTs,
      sourceChannelId: args.channelId,
      rawText: args.rawText,
      title: args.title,
      participants: args.participants,
      companies: args.companies,
      researchStatus: args.requestFastPass ? "fast_pass_queued" : "none",
      followUpRequested: false,
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return encounterId;
  },
});

/**
 * Update research status (internal)
 */
export const updateResearchStatus = internalMutation({
  args: {
    encounterId: v.id("encounterEvents"),
    status: researchStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.encounterId, {
      researchStatus: args.status,
      updatedAt: Date.now(),
    });
    return args.encounterId;
  },
});

/**
 * Complete DD enrichment (internal, called by DD orchestrator)
 */
export const internalCompleteDDEnrichment = internalMutation({
  args: {
    encounterId: v.id("encounterEvents"),
    ddMemoId: v.id("dueDiligenceMemos"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.encounterId, {
      ddMemoId: args.ddMemoId,
      researchStatus: "complete",
      enrichedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return args.encounterId;
  },
});

/**
 * Save fast pass results (internal, called by fast pass action)
 */
export const saveFastPassResults = internalMutation({
  args: {
    encounterId: v.id("encounterEvents"),
    fastPassResults: v.object({
      entitySummaries: v.array(v.object({
        entityName: v.string(),
        summary: v.string(),
        keyFacts: v.array(v.string()),
        fundingStage: v.optional(v.string()),
        lastFundingAmount: v.optional(v.string()),
        sector: v.optional(v.string()),
      })),
      generatedAt: v.number(),
      elapsedMs: v.number(),
    }),
    suggestedNextAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.encounterId, {
      fastPassResults: args.fastPassResults,
      researchStatus: "fast_pass_complete",
      suggestedNextAction: args.suggestedNextAction,
      enrichedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.encounterId;
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a title from raw text
 */
function generateTitle(rawText: string): string {
  // Extract first meaningful phrase
  const cleaned = rawText.trim().slice(0, 100);

  // Try to find "Met with X" or "Coffee with X" patterns
  const meetingMatch = cleaned.match(
    /(?:met|meeting|coffee|call|spoke|chat)\s+(?:with\s+)?([^,\.\-@]+)/i
  );
  if (meetingMatch) {
    return `Meeting with ${meetingMatch[1].trim()}`;
  }

  // Try to find "X @ Y" pattern
  const atMatch = cleaned.match(/([^@\-]+)\s*[@\-]\s*([^,\.]+)/);
  if (atMatch) {
    return `${atMatch[1].trim()} at ${atMatch[2].trim()}`;
  }

  // Fall back to first 50 chars
  return cleaned.slice(0, 50) + (rawText.length > 50 ? "..." : "");
}
