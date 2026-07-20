/**
 * Enrichment Worker
 *
 * Main job processor that routes enrichment jobs to appropriate handlers.
 * Uses workpool for rate limiting and retry management.
 */
import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { enrichHighPriorityPool, enrichBackfillPool } from "./workpools";

 
type AnyFunction = (...args: any[]) => any;

/** Context type for enrichment job handlers */
type EnrichmentContext = {
  runMutation: AnyFunction;
  runAction: AnyFunction;
  runQuery: AnyFunction;
};

/**
 * Process a single enrichment job.
 * Routes to appropriate handler based on job type.
 */
export const processJob = internalAction({
  args: {
    enrichmentJobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    // Get the job
    const job = await ctx.runQuery(internal.domains.enrichment.enrichmentQueue.getJob, {
      jobId: args.enrichmentJobId,
    });

    if (!job) {
      console.error(`Job not found: ${args.enrichmentJobId}`);
      return { success: false, error: "Job not found" };
    }

    // Skip if already completed or failed
    if (job.status === "completed" || job.status === "failed") {
      return { success: false, error: `Job already ${job.status}` };
    }

    // Check max attempts
    if (job.attempts >= job.maxAttempts) {
      await ctx.runMutation(internal.domains.enrichment.enrichmentQueue.updateJobStatus, {
        jobId: args.enrichmentJobId,
        status: "failed",
        error: `Max attempts (${job.maxAttempts}) exceeded`,
      });
      return { success: false, error: "Max attempts exceeded" };
    }

    // Mark as in_progress
    await ctx.runMutation(internal.domains.enrichment.enrichmentQueue.updateJobStatus, {
      jobId: args.enrichmentJobId,
      status: "in_progress",
    });

    try {
      let result: unknown;

      // Route to appropriate handler based on job type
      switch (job.jobType) {
        case "funding_detection":
          result = await processFundingDetection(ctx, job);
          break;

        case "entity_promotion":
          result = await processEntityPromotion(ctx, job);
          break;

        case "full_article_fetch":
          result = await processFullArticleFetch(ctx, job);
          break;

        case "structured_search":
          result = await processStructuredSearch(ctx, job);
          break;

        case "verification":
          result = await processVerification(ctx, job);
          break;

        case "persona_evaluation":
          result = await processPersonaEvaluation(ctx, job);
          break;

        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }

      // Mark as completed
      await ctx.runMutation(internal.domains.enrichment.enrichmentQueue.updateJobStatus, {
        jobId: args.enrichmentJobId,
        status: "completed",
        outputPayload: result,
      });

      return { success: true, result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Job ${job.jobId} failed:`, errorMessage);

      // Determine if retryable
      const isRetryable = job.attempts + 1 < job.maxAttempts;

      await ctx.runMutation(internal.domains.enrichment.enrichmentQueue.updateJobStatus, {
        jobId: args.enrichmentJobId,
        status: isRetryable ? "retrying" : "failed",
        error: errorMessage,
      });

      // Schedule retry if applicable
      if (isRetryable) {
        const retryDelay = Math.min(1000 * Math.pow(2, job.attempts + 1), 60000);
        await ctx.scheduler.runAfter(
          retryDelay,
          internal.domains.enrichment.enrichmentWorker.processJob,
          { enrichmentJobId: args.enrichmentJobId }
        );
      }

      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Process funding detection for a feed item.
 * Analyzes content for funding keywords and extracts structured data.
 */
async function processFundingDetection(
  ctx: EnrichmentContext,
  job: { inputPayload: { feedItemId?: Id<"feedItems"> } }
): Promise<{ detected: boolean; confidence?: number; extractedData?: unknown; fundingEventId?: Id<"fundingEvents"> }> {
  const { feedItemId } = job.inputPayload;

  if (!feedItemId) {
    throw new Error("feedItemId required for funding_detection");
  }

  console.log(`[FundingDetection] Processing feed item: ${feedItemId}`);

  // Use the actual funding detection logic
  const result = await ctx.runAction(
    internal.domains.enrichment.fundingDetection.processFeedItemForFunding,
    { feedItemId }
  );

  return {
    detected: result.detected,
    confidence: result.confidence,
    extractedData: result.extractedData,
    fundingEventId: result.fundingEventId,
  };
}

/**
 * Process entity promotion from feed item to entityContexts.
 */
async function processEntityPromotion(
  ctx: EnrichmentContext,
  job: { inputPayload: { fundingEventId?: Id<"fundingEvents"> } }
): Promise<{ promoted: boolean; entityId?: Id<"entityContexts">; created?: boolean }> {
  const { fundingEventId } = job.inputPayload;

  if (!fundingEventId) {
    throw new Error("fundingEventId required for entity_promotion");
  }

  console.log(`[EntityPromotion] Processing funding event: ${fundingEventId}`);

  const result = await ctx.runAction(
    internal.domains.enrichment.entityPromotion.promoteToEntity,
    { fundingEventId }
  );

  return {
    promoted: result.promoted,
    entityId: result.entityId,
    created: result.created,
  };
}

/**
 * Fetch full article content via Linkup /fetch.
 */
async function processFullArticleFetch(
  ctx: EnrichmentContext,
  job: { inputPayload: { url?: string; feedItemId?: Id<"feedItems">; fundingEventId?: Id<"fundingEvents"> } }
): Promise<{ fetched: boolean; contentLength?: number }> {
  const { url, feedItemId, fundingEventId } = job.inputPayload;

  if (!url) {
    throw new Error("url required for full_article_fetch");
  }

  console.log(`[FullArticleFetch] Fetching: ${url}`);

  const result = await ctx.runAction(
    internal.tools.media.linkupFetch.linkupFetchInternal,
    { url, feedItemId, fundingEventId }
  );

  return {
    fetched: true,
    contentLength: result.content?.length || 0,
  };
}

/**
 * Run structured search via Linkup for additional data.
 */
async function processStructuredSearch(
  ctx: EnrichmentContext,
  job: { inputPayload: unknown }
): Promise<{ searched: boolean; resultsCount?: number }> {
  // Uses existing linkupStructuredSearch
  console.log("[StructuredSearch] Processing...", job.inputPayload);

  return {
    searched: false,
  };
}

/**
 * Verify funding claims across multiple sources.
 */
async function processVerification(
  ctx: EnrichmentContext,
  job: { inputPayload: { fundingEventId?: Id<"fundingEvents"> } }
): Promise<{ verified: boolean; confidence?: number; sources?: number }> {
  const { fundingEventId } = job.inputPayload;

  if (!fundingEventId) {
    throw new Error("fundingEventId required for verification");
  }

  console.log(`[Verification] Verifying funding event: ${fundingEventId}`);

  const result = await ctx.runAction(
    internal.domains.enrichment.fundingVerification.verifyFundingClaim,
    { fundingEventId }
  );

  return {
    verified: result.verified,
    confidence: result.confidence,
    sources: result.newSources.length,
  };
}

/**
 * Run persona evaluation on entity/funding event.
 */
async function processPersonaEvaluation(
  ctx: { runMutation: Function; runAction: Function; runQuery: Function },
  job: { inputPayload: { entityId?: Id<"entityContexts">; fundingEventId?: Id<"fundingEvents"> } }
): Promise<{ evaluated: boolean; passCount?: number; failCount?: number }> {
  // Uses existing entityInsights.generatePersonaHooks
  console.log("[PersonaEvaluation] Processing...", job.inputPayload);

  return {
    evaluated: false,
  };
}

/**
 * Start batch processing from workpool.
 * Called by scheduler to drain pending jobs.
 */
export const startBatchProcessing = internalAction({
  args: {
    poolName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pool = args.poolName === "backfill" ? enrichBackfillPool : enrichHighPriorityPool;
    const limit = args.limit ?? 10;

    // Get pending jobs
    const pendingJobs = await ctx.runQuery(
      internal.domains.enrichment.enrichmentQueue.getRetryableJobs,
      { limit }
    );

    // Enqueue each to workpool
    const started: Id<"enrichmentJobs">[] = [];
    for (const job of pendingJobs) {
      try {
        await pool.enqueueAction(ctx, internal.domains.enrichment.enrichmentWorker.processJob, {
          enrichmentJobId: job._id,
        });
        started.push(job._id);
      } catch (error) {
        console.error(`Failed to enqueue job ${job._id}:`, error);
      }
    }

    return { started: started.length, jobs: started };
  },
});
