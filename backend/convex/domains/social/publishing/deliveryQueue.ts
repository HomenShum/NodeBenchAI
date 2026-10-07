/**
 * Delivery Queue - Reliable Message Delivery with Retry
 * Deep Agents 3.0 - Low-level delivery job management
 *
 * Features:
 * - Exponential backoff retry
 * - Channel-specific rate limiting
 * - Delivery tracking and analytics
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { PUBLISHING_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export type DeliveryJobStatus =
  | "pending"
  | "sending"
  | "delivered"
  | "failed"
  | "retrying";

/* ================================================================== */
/* UTILITY FUNCTIONS                                                   */
/* ================================================================== */

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempts: number): number {
  const baseDelay = 5000; // 5 seconds
  const maxDelay = 300000; // 5 minutes
  const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get a delivery job by ID
 */
export const getJob = internalQuery({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }): Promise<Doc<"deliveryJobs"> | null> => {
    return await ctx.db.get(jobId) as Doc<"deliveryJobs"> | null;
  },
});

/**
 * Get ready-to-process jobs (pending or due for retry)
 */
export const getReadyJobs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"deliveryJobs">[]> => {
    const now = Date.now();

    // Get pending jobs
    const pendingJobs = await ctx.db
      .query("deliveryJobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(limit) as Doc<"deliveryJobs">[];

    // Get retrying jobs that are due
    const retryingJobs = await ctx.db
      .query("deliveryJobs")
      .withIndex("by_retry", (q) => q.eq("status", "retrying"))
      .filter((q) =>
        q.or(
          q.eq(q.field("nextRetryAt"), undefined),
          q.lte(q.field("nextRetryAt"), now)
        )
      )
      .take(limit) as Doc<"deliveryJobs">[];

    // Combine and deduplicate
    const allJobs = [...pendingJobs, ...retryingJobs];
    const seen = new Set<string>();
    return allJobs.filter((job) => {
      if (seen.has(job._id)) return false;
      seen.add(job._id);
      return true;
    }).slice(0, limit);
  },
});

/**
 * Get jobs by publishing task
 */
export const getJobsByPublishingTask = internalQuery({
  args: { publishingTaskId: v.id("publishingTasks") },
  handler: async (ctx, { publishingTaskId }): Promise<Doc<"deliveryJobs">[]> => {
    return await ctx.db
      .query("deliveryJobs")
      .withIndex("by_publishing_task", (q) => q.eq("publishingTaskId", publishingTaskId))
      .collect() as Doc<"deliveryJobs">[];
  },
});

/**
 * Get delivery queue statistics
 */
export const getQueueStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    pending: number;
    sending: number;
    delivered: number;
    failed: number;
    retrying: number;
    byChannel: Record<string, number>;
  }> => {
    const allJobs = await ctx.db.query("deliveryJobs").collect() as Doc<"deliveryJobs">[];

    const stats = {
      pending: 0,
      sending: 0,
      delivered: 0,
      failed: 0,
      retrying: 0,
      byChannel: {} as Record<string, number>,
    };

    for (const job of allJobs) {
      switch (job.status) {
        case "pending":
          stats.pending++;
          break;
        case "sending":
          stats.sending++;
          break;
        case "delivered":
          stats.delivered++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "retrying":
          stats.retrying++;
          break;
      }

      stats.byChannel[job.channel] = (stats.byChannel[job.channel] || 0) + 1;
    }

    return stats;
  },
});

export const getDeliveryStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    pending: number;
    deliveredToday: number;
    failedToday: number;
    retriesExhausted: number;
  }> => {
    const allJobs = await ctx.db.query("deliveryJobs").collect() as Doc<"deliveryJobs">[];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();

    let pending = 0;
    let deliveredToday = 0;
    let failedToday = 0;
    let retriesExhausted = 0;

    for (const job of allJobs) {
      if (job.status === "pending" || job.status === "retrying" || job.status === "sending") {
        pending++;
      }
      if (job.status === "delivered" && (job.deliveredAt ?? 0) >= startOfDayMs) {
        deliveredToday++;
      }
      if (job.status === "failed" && job.createdAt >= startOfDayMs) {
        failedToday++;
      }
      if (job.status === "failed" && job.attempts >= job.maxAttempts) {
        retriesExhausted++;
      }
    }

    return { pending, deliveredToday, failedToday, retriesExhausted };
  },
});

export const getFailedJobs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"deliveryJobs">[]> => {
    return await ctx.db
      .query("deliveryJobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .take(Math.min(Math.max(limit, 1), 500)) as Doc<"deliveryJobs">[];
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Mark a job as delivered
 */
export const markDelivered = internalMutation({
  args: {
    jobId: v.id("deliveryJobs"),
    externalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, externalMessageId }): Promise<void> => {
    await ctx.db.patch(jobId, {
      status: "delivered",
      deliveredAt: Date.now(),
      externalMessageId,
    });
  },
});

/**
 * Mark a job for retry
 */
export const markForRetry = internalMutation({
  args: {
    jobId: v.id("deliveryJobs"),
    error: v.string(),
  },
  handler: async (ctx, { jobId, error }): Promise<boolean> => {
    const job = await ctx.db.get(jobId) as Doc<"deliveryJobs"> | null;
    if (!job) return false;

    const newAttempts = job.attempts + 1;

    if (newAttempts >= job.maxAttempts) {
      // Max attempts exceeded - mark as failed
      await ctx.db.patch(jobId, {
        status: "failed",
        lastError: `Max attempts exceeded. Last error: ${error}`,
        attempts: newAttempts,
      });
      return false;
    }

    // Schedule for retry
    const nextRetryAt = Date.now() + calculateBackoff(newAttempts);
    await ctx.db.patch(jobId, {
      status: "retrying",
      lastError: error,
      attempts: newAttempts,
      nextRetryAt,
    });

    return true;
  },
});

export const requeueJob = internalMutation({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }): Promise<boolean> => {
    const job = await ctx.db.get(jobId) as Doc<"deliveryJobs"> | null;
    if (!job || job.status !== "failed") return false;
    await ctx.db.patch(jobId, {
      status: "retrying",
      nextRetryAt: Date.now(),
      lastError: undefined,
    });
    return true;
  },
});

/**
 * Mark a job as sending
 */
export const markSending = internalMutation({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }): Promise<void> => {
    await ctx.db.patch(jobId, { status: "sending" });
  },
});

/**
 * Clean up old delivered/failed jobs
 */
export const cleanupOldJobs = internalMutation({
  args: {
    maxAgeDays: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { maxAgeDays = 7, limit = 100 }): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    const oldJobs = await ctx.db
      .query("deliveryJobs")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("status"), "delivered"),
            q.eq(q.field("status"), "failed")
          ),
          q.lt(q.field("createdAt"), cutoff)
        )
      )
      .take(limit) as Doc<"deliveryJobs">[];

    for (const job of oldJobs) {
      await ctx.db.delete(job._id);
    }

    return { deleted: oldJobs.length };
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Deliver to ntfy channel
 */
async function deliverToNtfy(payload: unknown): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const ntfyPayload = payload as {
    topic: string;
    title: string;
    message: string;
    priority: number;
    tags?: string[];
    click?: string;
  };

  try {
    const ntfyUrl = process.env.NTFY_URL || "https://ntfy.sh";
    const response = await fetch(`${ntfyUrl}/${ntfyPayload.topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: ntfyPayload.title,
        message: ntfyPayload.message,
        priority: ntfyPayload.priority,
        tags: ntfyPayload.tags,
        click: ntfyPayload.click,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    return { success: true, messageId: `ntfy-${Date.now()}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Deliver to email channel (via Resend)
 */
async function deliverToEmail(payload: unknown): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const emailPayload = payload as {
    to: string[];
    subject: string;
    html: string;
    text?: string;
  };

  // TODO: Implement Resend integration
  // const resend = new Resend(process.env.RESEND_API_KEY);
  // const { data, error } = await resend.emails.send({
  //   from: 'NodeBench <noreply@nodebench.ai>',
  //   to: emailPayload.to,
  //   subject: emailPayload.subject,
  //   html: emailPayload.html,
  // });

  console.log(`[DeliveryQueue] Would send email to ${emailPayload.to.join(", ")}`);
  return { success: true, messageId: `email-${Date.now()}` };
}

/**
 * Deliver to Slack channel
 */
async function deliverToSlack(payload: unknown): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // TODO: Implement Slack webhook integration
  console.log("[DeliveryQueue] Slack delivery not implemented yet");
  return { success: true, messageId: `slack-${Date.now()}` };
}

/**
 * Deliver to SMS channel (via Twilio)
 */
async function deliverToSms(payload: unknown): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // TODO: Implement Twilio integration
  console.log("[DeliveryQueue] SMS delivery not implemented yet");
  return { success: true, messageId: `sms-${Date.now()}` };
}

/**
 * Process a single delivery job
 */
export const processJob = internalAction({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }): Promise<void> => {
    const job = await ctx.runQuery(
      internal.domains.publishing.deliveryQueue.getJob,
      { jobId }
    );

    if (!job) {
      console.error(`[DeliveryQueue] Job not found: ${jobId}`);
      return;
    }

    if (job.status === "delivered" || job.status === "failed") {
      return;
    }

    // Mark as sending
    await ctx.runMutation(
      internal.domains.publishing.deliveryQueue.markSending,
      { jobId }
    );

    // Attempt delivery
    let result: { success: boolean; messageId?: string; error?: string };

    switch (job.channel) {
      case "ntfy":
        result = await deliverToNtfy(job.payload);
        break;
      case "email":
        result = await deliverToEmail(job.payload);
        break;
      case "slack":
        result = await deliverToSlack(job.payload);
        break;
      case "sms":
        result = await deliverToSms(job.payload);
        break;
      default:
        result = { success: false, error: `Unknown channel: ${job.channel}` };
    }

    if (result.success) {
      await ctx.runMutation(
        internal.domains.publishing.deliveryQueue.markDelivered,
        { jobId, externalMessageId: result.messageId }
      );
      console.log(`[DeliveryQueue] Job ${jobId} delivered successfully`);
    } else {
      const canRetry = await ctx.runMutation(
        internal.domains.publishing.deliveryQueue.markForRetry,
        { jobId, error: result.error || "Unknown error" }
      );
      console.log(
        `[DeliveryQueue] Job ${jobId} failed: ${result.error}${canRetry ? " (will retry)" : " (max retries exceeded)"}`
      );
    }
  },
});

/**
 * Process batch of ready jobs
 */
export const processDeliveryQueue = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = PUBLISHING_CONFIG.batchSize }): Promise<number> => {
    const readyJobs = await ctx.runQuery(
      internal.domains.publishing.deliveryQueue.getReadyJobs,
      { limit }
    );

    if (readyJobs.length === 0) {
      return 0;
    }

    console.log(`[DeliveryQueue] Processing ${readyJobs.length} jobs`);

    // Process in parallel with concurrency limit
    const batchSize = 10;
    let processed = 0;

    for (let i = 0; i < readyJobs.length; i += batchSize) {
      const batch = readyJobs.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (job: Doc<"deliveryJobs">) => {
          try {
            await ctx.runAction(
              internal.domains.publishing.deliveryQueue.processJob,
              { jobId: job._id }
            );
            processed++;
          } catch (error) {
            console.error(`[DeliveryQueue] Error processing job ${job._id}:`, error);
          }
        })
      );
    }

    return processed;
  },
});

/**
 * Main tick function - called by cron
 */
export const tickDeliveryQueue = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[DeliveryQueue] Starting delivery queue tick...");

    // 1. Process ready jobs
    const processed = await ctx.runAction(
      internal.domains.publishing.deliveryQueue.processDeliveryQueue,
      {}
    );

    // 2. Cleanup old jobs
    const cleanup = await ctx.runMutation(
      internal.domains.publishing.deliveryQueue.cleanupOldJobs,
      {}
    );

    // 3. Log stats
    const stats = await ctx.runQuery(
      internal.domains.publishing.deliveryQueue.getQueueStats,
      {}
    );

    console.log(
      `[DeliveryQueue] Tick complete. Processed: ${processed}, Cleaned: ${cleanup.deleted}, Pending: ${stats.pending}, Retrying: ${stats.retrying}`
    );
  },
});
