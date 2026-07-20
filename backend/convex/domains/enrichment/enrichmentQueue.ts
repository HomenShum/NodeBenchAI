/**
 * Enrichment Queue Mutations
 *
 * CRUD operations for enrichmentJobs table and workpool integration.
 */
import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

// Job type union for validation
const jobTypeValidator = v.union(
  v.literal("funding_detection"),
  v.literal("entity_promotion"),
  v.literal("full_article_fetch"),
  v.literal("structured_search"),
  v.literal("verification"),
  v.literal("persona_evaluation")
);

// Job status union for validation
const jobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("retrying")
);

/**
 * Create a new enrichment job and optionally enqueue to workpool.
 */
export const enqueueEnrichmentJob = mutation({
  args: {
    jobType: jobTypeValidator,
    priority: v.number(),
    inputPayload: v.any(),
    targetEntityId: v.optional(v.id("entityContexts")),
    targetFeedItemId: v.optional(v.id("feedItems")),
    sourceFundingEventId: v.optional(v.id("fundingEvents")),
    maxAttempts: v.optional(v.number()),
    poolName: v.optional(v.string()),
    enqueueToWorkpool: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = `enr_${now}_${Math.random().toString(36).slice(2, 9)}`;

    const jobDoc = await ctx.db.insert("enrichmentJobs", {
      jobId,
      jobType: args.jobType,
      status: args.enqueueToWorkpool ? "queued" : "pending",
      priority: args.priority,
      attempts: 0,
      maxAttempts: args.maxAttempts ?? 3,
      inputPayload: args.inputPayload,
      targetEntityId: args.targetEntityId,
      targetFeedItemId: args.targetFeedItemId,
      sourceFundingEventId: args.sourceFundingEventId,
      createdAt: now,
      poolName: args.poolName ?? "high",
    });

    // If enqueuing to workpool, schedule the worker
    if (args.enqueueToWorkpool) {
      await ctx.scheduler.runAfter(
        0,
        internal.domains.enrichment.enrichmentWorker.processJob,
        { enrichmentJobId: jobDoc }
      );
    }

    return { jobId: jobDoc, externalId: jobId };
  },
});

/**
 * Bulk enqueue funding detection jobs for multiple feed items.
 */
export const bulkEnqueueFundingDetection = mutation({
  args: {
    feedItemIds: v.array(v.id("feedItems")),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: { feedItemId: Id<"feedItems">; jobId: Id<"enrichmentJobs"> }[] = [];

    for (const feedItemId of args.feedItemIds) {
      // Check if job already exists for this feed item
      const existingJob = await ctx.db
        .query("enrichmentJobs")
        .withIndex("by_targetFeedItem", (q) => q.eq("targetFeedItemId", feedItemId))
        .filter((q) =>
          q.and(
            q.eq(q.field("jobType"), "funding_detection"),
            q.neq(q.field("status"), "completed"),
            q.neq(q.field("status"), "failed")
          )
        )
        .first();

      if (existingJob) {
        continue; // Skip duplicate
      }

      const jobId = `enr_${now}_${Math.random().toString(36).slice(2, 9)}`;
      const jobDoc = await ctx.db.insert("enrichmentJobs", {
        jobId,
        jobType: "funding_detection",
        status: "queued",
        priority: args.priority ?? 5,
        attempts: 0,
        maxAttempts: 3,
        inputPayload: { feedItemId },
        targetFeedItemId: feedItemId,
        createdAt: now,
        poolName: "high",
      });

      // Schedule the worker
      await ctx.scheduler.runAfter(
        0,
        internal.domains.enrichment.enrichmentWorker.processJob,
        { enrichmentJobId: jobDoc }
      );

      results.push({ feedItemId, jobId: jobDoc });
    }

    return { enqueued: results.length, jobs: results };
  },
});

/**
 * Update job status with optional error tracking.
 */
export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    status: jobStatusValidator,
    error: v.optional(v.string()),
    outputPayload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId) as Doc<"enrichmentJobs"> | null;
    if (!job) {
      throw new Error(`Job not found: ${args.jobId}`);
    }

    const now = Date.now();
    const updates: Partial<Doc<"enrichmentJobs">> = {
      status: args.status,
    };

    if (args.status === "in_progress" && !job.startedAt) {
      updates.startedAt = now;
    }

    if (args.status === "completed" || args.status === "failed") {
      updates.completedAt = now;
    }

    if (args.error) {
      updates.lastError = args.error;
      updates.attempts = job.attempts + 1;
    }

    if (args.outputPayload) {
      updates.outputPayload = args.outputPayload;
    }

    // Handle retry logic
    if (args.status === "retrying") {
      const nextRetryDelay = Math.min(
        1000 * Math.pow(2, job.attempts),
        60000
      );
      updates.nextRetryAt = now + nextRetryDelay;
      updates.attempts = job.attempts + 1;
    }

    await ctx.db.patch(args.jobId, updates);
    return { success: true, newStatus: args.status };
  },
});

/**
 * Get job by ID.
 */
export const getJob = query({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/**
 * Get pending jobs for a specific type.
 */
export const getPendingJobs = query({
  args: {
    jobType: jobTypeValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_type_status", (q) =>
        q.eq("jobType", args.jobType).eq("status", "pending")
      )
      .take(args.limit ?? 50);
  },
});

/**
 * Get jobs ready for retry.
 */
export const getRetryableJobs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_status", (q) => q.eq("status", "retrying"))
      .filter((q) =>
        q.or(
          q.eq(q.field("nextRetryAt"), undefined),
          q.lte(q.field("nextRetryAt"), now)
        )
      )
      .take(args.limit ?? 20);
  },
});

/**
 * Get job statistics by status.
 */
export const getJobStats = query({
  args: {},
  handler: async (ctx) => {
    const allJobs = await ctx.db.query("enrichmentJobs").collect();

    const statusCounts: Record<string, number> = {
      pending: 0,
      queued: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      retrying: 0,
    };
    const byType: Record<string, number> = {};

    for (const job of allJobs) {
      statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
      byType[job.jobType] = (byType[job.jobType] ?? 0) + 1;
    }

    return {
      total: allJobs.length,
      ...statusCounts,
      byType,
    };
  },
});

/**
 * Clean up old completed/failed jobs (called by cron).
 */
export const cleanupOldJobs = internalMutation({
  args: {
    maxAgeDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxAge = (args.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    const oldJobs = await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_createdAt")
      .filter((q) =>
        q.and(
          q.lt(q.field("createdAt"), cutoff),
          q.or(
            q.eq(q.field("status"), "completed"),
            q.eq(q.field("status"), "failed")
          )
        )
      )
      .take(100);

    for (const job of oldJobs) {
      await ctx.db.delete(job._id);
    }

    return { deleted: oldJobs.length };
  },
});
