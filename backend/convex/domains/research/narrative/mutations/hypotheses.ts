/**
 * Narrative Hypotheses Mutations (Phase 7)
 *
 * CRUD operations for narrativeHypotheses table.
 * Hypotheses are structured, testable sub-claims within a narrative thread.
 * They support competing explanations (H1..Hn) that can all be "live" at once.
 *
 * Example thread: "AI governance ramp + labor market + attention cycles"
 *   H1: Attention displacement ("distraction")
 *   H2: AI-in-government is accelerating
 *   H3: Layoffs are structurally linked to automation
 *   H4: "Smart money" sells while attention is elsewhere
 *
 * Each hypothesis links to claims via hypothesisId and to signal metrics
 * via the narrativeSignalMetrics table.
 *
 * @module domains/narrative/mutations/hypotheses
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { speculativeRiskValidator, hypothesisStatusValidator } from "../validators";

/**
 * FNV-1a 32-bit hash for stable ID generation
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const statusValidator = hypothesisStatusValidator;

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC MUTATIONS (User-facing, require auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new hypothesis within a narrative thread.
 */
export const createHypothesis = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    label: v.string(),
    title: v.string(),
    claimForm: v.string(),
    measurementApproach: v.string(),
    speculativeRisk: speculativeRiskValidator,
    falsificationCriteria: v.optional(v.string()),
    competingHypothesisIds: v.optional(v.array(v.string())),
  },
  returns: v.id("narrativeHypotheses"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // Verify thread ownership
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId) throw new Error("Not authorized");

    const now = Date.now();
    const hypothesisId = `nh_${fnv1a32Hex(args.label + args.title + now)}`;

    return await ctx.db.insert("narrativeHypotheses", {
      hypothesisId,
      threadId: args.threadId,
      label: args.label,
      title: args.title,
      claimForm: args.claimForm,
      measurementApproach: args.measurementApproach,
      supportingEvidenceCount: 0,
      contradictingEvidenceCount: 0,
      evidenceArtifactIds: [],
      status: "active",
      confidence: 0.5,
      speculativeRisk: args.speculativeRisk,
      falsificationCriteria: args.falsificationCriteria,
      competingHypothesisIds: args.competingHypothesisIds,
      createdByAgent: "user",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update hypothesis status and confidence based on new evidence.
 */
export const updateHypothesisStatus = mutation({
  args: {
    hypothesisDocId: v.id("narrativeHypotheses"),
    status: v.optional(statusValidator),
    confidence: v.optional(v.number()),
    speculativeRisk: v.optional(speculativeRiskValidator),
    supportingEvidenceCount: v.optional(v.number()),
    contradictingEvidenceCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const hypothesis = await ctx.db.get(args.hypothesisDocId);
    if (!hypothesis) throw new Error("Hypothesis not found");

    // Verify thread ownership
    const thread = await ctx.db.get(hypothesis.threadId);
    if (!thread || thread.userId !== userId) throw new Error("Not authorized");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.confidence !== undefined) patch.confidence = args.confidence;
    if (args.speculativeRisk !== undefined) patch.speculativeRisk = args.speculativeRisk;
    if (args.supportingEvidenceCount !== undefined) patch.supportingEvidenceCount = args.supportingEvidenceCount;
    if (args.contradictingEvidenceCount !== undefined) patch.contradictingEvidenceCount = args.contradictingEvidenceCount;

    await ctx.db.patch(args.hypothesisDocId, patch);
    return null;
  },
});

/**
 * Add evidence artifact to a hypothesis.
 */
export const addEvidenceToHypothesis = mutation({
  args: {
    hypothesisDocId: v.id("narrativeHypotheses"),
    artifactId: v.string(),
    isSupporting: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const hypothesis = await ctx.db.get(args.hypothesisDocId);
    if (!hypothesis) throw new Error("Hypothesis not found");

    const thread = await ctx.db.get(hypothesis.threadId);
    if (!thread || thread.userId !== userId) throw new Error("Not authorized");

    const existingIds = hypothesis.evidenceArtifactIds || [];
    if (!existingIds.includes(args.artifactId)) {
      existingIds.push(args.artifactId);
    }

    const patch: Record<string, unknown> = {
      evidenceArtifactIds: existingIds,
      updatedAt: Date.now(),
    };
    if (args.isSupporting) {
      patch.supportingEvidenceCount = (hypothesis.supportingEvidenceCount || 0) + 1;
    } else {
      patch.contradictingEvidenceCount = (hypothesis.contradictingEvidenceCount || 0) + 1;
    }

    await ctx.db.patch(args.hypothesisDocId, patch);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (Agent-facing, no auth required)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agent-facing: create a hypothesis during newsroom pipeline execution.
 */
export const createHypothesisInternal = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    label: v.string(),
    title: v.string(),
    claimForm: v.string(),
    measurementApproach: v.string(),
    speculativeRisk: speculativeRiskValidator,
    falsificationCriteria: v.optional(v.string()),
    competingHypothesisIds: v.optional(v.array(v.string())),
    createdByAgent: v.string(),
    confidence: v.optional(v.number()),
  },
  returns: v.id("narrativeHypotheses"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hypothesisId = `nh_${fnv1a32Hex(args.label + args.title + now)}`;

    return await ctx.db.insert("narrativeHypotheses", {
      hypothesisId,
      threadId: args.threadId,
      label: args.label,
      title: args.title,
      claimForm: args.claimForm,
      measurementApproach: args.measurementApproach,
      supportingEvidenceCount: 0,
      contradictingEvidenceCount: 0,
      evidenceArtifactIds: [],
      status: "active",
      confidence: args.confidence ?? 0.5,
      speculativeRisk: args.speculativeRisk,
      falsificationCriteria: args.falsificationCriteria,
      competingHypothesisIds: args.competingHypothesisIds,
      createdByAgent: args.createdByAgent,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Agent-facing: update hypothesis evidence counts and status.
 */
export const updateHypothesisInternal = internalMutation({
  args: {
    hypothesisDocId: v.id("narrativeHypotheses"),
    status: v.optional(statusValidator),
    confidence: v.optional(v.number()),
    speculativeRisk: v.optional(speculativeRiskValidator),
    supportingEvidenceCount: v.optional(v.number()),
    contradictingEvidenceCount: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hypothesis = await ctx.db.get(args.hypothesisDocId);
    if (!hypothesis) throw new Error("Hypothesis not found");

    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.status !== undefined) patch.status = args.status;
    if (args.confidence !== undefined) patch.confidence = args.confidence;
    if (args.speculativeRisk !== undefined) patch.speculativeRisk = args.speculativeRisk;
    if (args.supportingEvidenceCount !== undefined) patch.supportingEvidenceCount = args.supportingEvidenceCount;
    if (args.contradictingEvidenceCount !== undefined) patch.contradictingEvidenceCount = args.contradictingEvidenceCount;
    if (args.reviewedBy !== undefined) {
      patch.reviewedBy = args.reviewedBy;
      patch.reviewedAt = now;
    }

    await ctx.db.patch(args.hypothesisDocId, patch);
    return null;
  },
});
