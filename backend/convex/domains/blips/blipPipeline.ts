/**
 * blipPipeline.ts - Daily blip pipeline orchestration
 *
 * Orchestrates the full pipeline: Ingest → Extract Claims → Generate Blips → Verify → Persona Lenses
 */

"use node";

import { v } from "convex/values";
import { internalAction, action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import type { PipelineStats } from "./types";

// ============================================================================
// Public Actions
// ============================================================================

/**
 * Run the full daily blip pipeline
 * This is the main entry point for the daily cron job.
 */
export const runDailyPipeline = action({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    console.log("[BlipPipeline] Starting daily pipeline...");

    // Stage 1: Ingest from all sources
    console.log("[BlipPipeline] Stage 1: Ingesting from sources...");
    const ingestionResult = await ctx.runAction(
      internal.domains.blips.blipIngestion.runAllIngestors,
      {}
    );
    console.log(`[BlipPipeline] Ingested ${ingestionResult.totalIngested} new items`);

    // Stage 2: Extract claims
    console.log("[BlipPipeline] Stage 2: Extracting claims...");
    const claimResult = await ctx.runAction(
      internal.domains.blips.blipClaimExtraction.extractClaimsBatch,
      { limit: 30 }
    );
    console.log(`[BlipPipeline] Extracted ${claimResult.totalClaims} claims`);

    // Stage 3: Generate blips
    console.log("[BlipPipeline] Stage 3: Generating blips...");
    const blipResult = await ctx.runAction(
      internal.domains.blips.blipGeneration.generateBlipsBatch,
      { limit: 30 }
    );
    console.log(`[BlipPipeline] Generated ${blipResult.successful} blips`);

    // Stage 4: Verify claims
    console.log("[BlipPipeline] Stage 4: Verifying claims...");
    const verifyResult = await ctx.runAction(
      internal.domains.blips.blipVerification.verifyClaimsBatch,
      { limit: 50 }
    );
    console.log(`[BlipPipeline] Verified ${verifyResult.processed} claims`);

    // Stage 5: Generate persona lenses
    console.log("[BlipPipeline] Stage 5: Generating persona lenses...");
    const lensResult = await ctx.runAction(
      internal.domains.blips.blipPersonaLens.generatePersonaLensesBatch,
      { limit: 20 }
    );
    console.log(`[BlipPipeline] Generated lenses for ${lensResult.successful} blips`);

    const elapsedMs = Date.now() - startTime;
    console.log(`[BlipPipeline] Pipeline complete in ${elapsedMs}ms`);

    const stats: PipelineStats = {
      ingested: ingestionResult.totalIngested || 0,
      claimsExtracted: claimResult.totalClaims || 0,
      blipsGenerated: blipResult.successful || 0,
      verified: verifyResult.processed || 0,
      personaLensesGenerated: (lensResult.successful || 0) * 10, // 10 lenses per blip
      elapsedMs,
    };

    return stats;
  },
});

/**
 * Run a quick test pipeline (smaller batches)
 */
export const runTestPipeline = action({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    console.log("[BlipPipeline] Starting test pipeline...");

    // Stage 1: Ingest just from HN
    const ingestionResult = await ctx.runAction(
      internal.domains.blips.blipIngestion.ingestHackerNews,
      { limit: 5 }
    );

    // Stage 2: Extract claims
    const claimResult = await ctx.runAction(
      internal.domains.blips.blipClaimExtraction.extractClaimsBatch,
      { limit: 5 }
    );

    // Stage 3: Generate blips
    const blipResult = await ctx.runAction(
      internal.domains.blips.blipGeneration.generateBlipsBatch,
      { limit: 5 }
    );

    const elapsedMs = Date.now() - startTime;

    return {
      ingested: ingestionResult.ingested || 0,
      claimsExtracted: claimResult.totalClaims || 0,
      blipsGenerated: blipResult.successful || 0,
      elapsedMs,
    };
  },
});

// ============================================================================
// Internal Pipeline Actions
// ============================================================================

/**
 * Run ingestion only
 */
export const runIngestionPhase = internalAction({
  args: {},
  handler: async (ctx) => {
    return ctx.runAction(
      internal.domains.blips.blipIngestion.runAllIngestors,
      {}
    );
  },
});

/**
 * Run claim extraction phase
 */
export const runClaimExtractionPhase = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.runAction(
      internal.domains.blips.blipClaimExtraction.extractClaimsBatch,
      { limit: args.limit ?? 30 }
    );
  },
});

/**
 * Run blip generation phase
 */
export const runBlipGenerationPhase = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.runAction(
      internal.domains.blips.blipGeneration.generateBlipsBatch,
      { limit: args.limit ?? 30 }
    );
  },
});

/**
 * Run verification phase
 */
export const runVerificationPhase = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.runAction(
      internal.domains.blips.blipVerification.verifyClaimsBatch,
      { limit: args.limit ?? 50 }
    );
  },
});

/**
 * Run persona lens generation phase
 */
export const runPersonaLensPhase = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.runAction(
      internal.domains.blips.blipPersonaLens.generatePersonaLensesBatch,
      { limit: args.limit ?? 20 }
    );
  },
});

/**
 * Run pipeline in phases with scheduling (for large batches)
 * This breaks the pipeline into scheduled phases to avoid timeouts.
 */
export const runPipelinePhased = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[BlipPipeline] Starting phased pipeline execution...");

    // Phase 1: Ingest now
    const ingestionResult = await ctx.runAction(
      internal.domains.blips.blipPipeline.runIngestionPhase,
      {}
    );

    // Schedule remaining phases with delays
    await ctx.scheduler.runAfter(
      5000, // 5 seconds
      internal.domains.blips.blipPipeline.runClaimExtractionPhase,
      { limit: 50 }
    );

    await ctx.scheduler.runAfter(
      30000, // 30 seconds
      internal.domains.blips.blipPipeline.runBlipGenerationPhase,
      { limit: 50 }
    );

    await ctx.scheduler.runAfter(
      60000, // 1 minute
      internal.domains.blips.blipPipeline.runVerificationPhase,
      { limit: 100 }
    );

    await ctx.scheduler.runAfter(
      90000, // 1.5 minutes
      internal.domains.blips.blipPipeline.runPersonaLensPhase,
      { limit: 30 }
    );

    return {
      started: true,
      ingested: ingestionResult.totalIngested || 0,
      message: "Pipeline phases scheduled",
    };
  },
});
