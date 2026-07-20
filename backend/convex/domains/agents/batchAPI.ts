/**
 * Batch API Integration for Anthropic & OpenAI (2026)
 *
 * Cost Savings: 50% discount on input + output tokens
 * Latency: Async processing over 24 hours
 * Use Cases: Non-urgent workflows (daily briefs, scheduled content, reports)
 *
 * Based on:
 * - Anthropic Batch API (2025-2026)
 * - OpenAI Batch API (2024-2026)
 *
 * Pattern:
 * 1. Create batch job with multiple requests
 * 2. Poll for completion (24hr max)
 * 3. Retrieve results when ready
 * 4. Process and store outputs
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal, api } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type BatchProvider = "anthropic" | "openai";

export type BatchStatus =
  | "queued"       // Waiting to start
  | "processing"   // Currently processing
  | "completed"    // All requests completed
  | "failed"       // Batch failed
  | "cancelled";   // User cancelled

export interface BatchRequest {
  custom_id: string;      // Unique ID for this request (e.g., "workflow_123")
  params: {
    model: string;
    messages?: any[];     // Anthropic format
    max_tokens?: number;
    temperature?: number;
    system?: string | any[];
    // OpenAI format
    prompt?: string;
    // Common
    [key: string]: any;
  };
}

export interface BatchJob {
  batchId: string;           // Our internal ID
  provider: BatchProvider;   // "anthropic" | "openai"
  providerBatchId: string;   // Provider's batch ID
  status: BatchStatus;
  requestCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;        // 24hrs from creation
  results?: any[];           // Completed results
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH JOB CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create batch job for Anthropic
 */
export const createAnthropicBatch = action({
  args: {
    requests: v.array(v.any()), // BatchRequest[]
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }

    // Create batch via Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        requests: args.requests,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic batch creation failed: ${error}`);
    }

    const batch = await response.json();

    // Store in database
    const batchId = crypto.randomUUID();
    await ctx.runMutation(internal.domains.agents.batchAPI.saveBatchJob, {
      job: {
        batchId,
        provider: "anthropic",
        providerBatchId: batch.id,
        status: "queued",
        requestCount: args.requests.length,
        completedCount: 0,
        failedCount: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      },
    });

    // Schedule polling job
    await ctx.scheduler.runAfter(
      60 * 1000, // Poll after 1 minute
      internal.domains.agents.batchAPI.pollBatchStatus,
      { batchId, provider: "anthropic" }
    );

    console.log(`[BatchAPI] Created Anthropic batch ${batchId} (provider: ${batch.id})`);

    return { batchId, providerBatchId: batch.id };
  },
});

/**
 * Create batch job for OpenAI
 */
export const createOpenAIBatch = action({
  args: {
    requests: v.array(v.any()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }

    // OpenAI requires requests in JSONL format uploaded to a file
    const jsonlContent = args.requests
      .map((req: any) => JSON.stringify(req))
      .join("\n");

    // Upload file
    const uploadResponse = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        file: jsonlContent,
        purpose: "batch",
      }),
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`OpenAI file upload failed: ${error}`);
    }

    const file = await uploadResponse.json();

    // Create batch
    const batchResponse = await fetch("https://api.openai.com/v1/batches", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input_file_id: file.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      }),
    });

    if (!batchResponse.ok) {
      const error = await batchResponse.text();
      throw new Error(`OpenAI batch creation failed: ${error}`);
    }

    const batch = await batchResponse.json();

    // Store in database
    const batchId = crypto.randomUUID();
    await ctx.runMutation(internal.domains.agents.batchAPI.saveBatchJob, {
      job: {
        batchId,
        provider: "openai",
        providerBatchId: batch.id,
        status: "queued",
        requestCount: args.requests.length,
        completedCount: 0,
        failedCount: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      },
    });

    // Schedule polling
    await ctx.scheduler.runAfter(
      60 * 1000,
      internal.domains.agents.batchAPI.pollBatchStatus,
      { batchId, provider: "openai" }
    );

    console.log(`[BatchAPI] Created OpenAI batch ${batchId} (provider: ${batch.id})`);

    return { batchId, providerBatchId: batch.id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH JOB POLLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Poll batch status (scheduled job)
 */
export const pollBatchStatus = internalAction({
  args: {
    batchId: v.string(),
    provider: v.union(v.literal("anthropic"), v.literal("openai")),
  },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.domains.agents.batchAPI.getBatchJob, {
      batchId: args.batchId,
    });

    if (!job) {
      console.error(`[BatchAPI] Job ${args.batchId} not found`);
      return;
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      console.log(`[BatchAPI] Job ${args.batchId} already ${job.status}, skipping poll`);
      return;
    }

    try {
      if (args.provider === "anthropic") {
        await pollAnthropicBatch(ctx, job);
      } else {
        await pollOpenAIBatch(ctx, job);
      }
    } catch (error: any) {
      console.error(`[BatchAPI] Error polling ${args.batchId}:`, error.message);

      // Retry polling after 5 minutes if not expired
      if (Date.now() < job.expiresAt!) {
        await ctx.scheduler.runAfter(
          5 * 60 * 1000,
          internal.domains.agents.batchAPI.pollBatchStatus,
          args
        );
      }
    }
  },
});

async function pollAnthropicBatch(ctx: any, job: any) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

  const response = await fetch(
    `https://api.anthropic.com/v1/messages/batches/${job.providerBatchId}`,
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to poll Anthropic batch: ${response.statusText}`);
  }

  const batch = await response.json();

  console.log(`[BatchAPI] Anthropic batch ${job.batchId} status: ${batch.processing_status}`);

  // Update status
  const status: BatchStatus =
    batch.processing_status === "ended" ? "completed" :
    batch.processing_status === "in_progress" ? "processing" :
    batch.processing_status === "canceling" || batch.processing_status === "canceled" ? "cancelled" :
    "queued";

  await ctx.runMutation(internal.domains.agents.batchAPI.updateBatchStatus, {
    batchId: job.batchId,
    status,
    completedCount: batch.request_counts?.succeeded || 0,
    failedCount: batch.request_counts?.errored || 0,
  });

  // If completed, fetch results
  if (status === "completed") {
    const resultsResponse = await fetch(
      `https://api.anthropic.com/v1/messages/batches/${job.providerBatchId}/results`,
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      }
    );

    const results = await resultsResponse.json();

    await ctx.runMutation(internal.domains.agents.batchAPI.saveBatchResults, {
      batchId: job.batchId,
      results: results.results || [],
    });

    console.log(`[BatchAPI] ✅ Batch ${job.batchId} completed with ${results.results?.length || 0} results`);
  } else {
    // Schedule next poll in 5 minutes
    await ctx.scheduler.runAfter(
      5 * 60 * 1000,
      internal.domains.agents.batchAPI.pollBatchStatus,
      { batchId: job.batchId, provider: "anthropic" }
    );
  }
}

async function pollOpenAIBatch(ctx: any, job: any) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

  const response = await fetch(
    `https://api.openai.com/v1/batches/${job.providerBatchId}`,
    {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to poll OpenAI batch: ${response.statusText}`);
  }

  const batch = await response.json();

  console.log(`[BatchAPI] OpenAI batch ${job.batchId} status: ${batch.status}`);

  const status: BatchStatus =
    batch.status === "completed" ? "completed" :
    batch.status === "in_progress" || batch.status === "validating" || batch.status === "finalizing" ? "processing" :
    batch.status === "failed" || batch.status === "expired" ? "failed" :
    batch.status === "cancelled" || batch.status === "cancelling" ? "cancelled" :
    "queued";

  await ctx.runMutation(internal.domains.agents.batchAPI.updateBatchStatus, {
    batchId: job.batchId,
    status,
    completedCount: batch.request_counts?.completed || 0,
    failedCount: batch.request_counts?.failed || 0,
  });

  if (status === "completed" && batch.output_file_id) {
    // Download results file
    const resultsResponse = await fetch(
      `https://api.openai.com/v1/files/${batch.output_file_id}/content`,
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const resultsText = await resultsResponse.text();
    const results = resultsText.split("\n").filter(Boolean).map(line => JSON.parse(line));

    await ctx.runMutation(internal.domains.agents.batchAPI.saveBatchResults, {
      batchId: job.batchId,
      results,
    });

    console.log(`[BatchAPI] ✅ Batch ${job.batchId} completed with ${results.length} results`);
  } else if (status !== "completed") {
    // Schedule next poll
    await ctx.scheduler.runAfter(
      5 * 60 * 1000,
      internal.domains.agents.batchAPI.pollBatchStatus,
      { batchId: job.batchId, provider: "openai" }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const saveBatchJob = internalMutation({
  args: { job: v.any() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("batchJobs", args.job);
  },
});

export const updateBatchStatus = internalMutation({
  args: {
    batchId: v.string(),
    status: v.string(),
    completedCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("batchJobs")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();

    if (!job) return;

    await ctx.db.patch(job._id, {
      status: args.status as any,
      completedCount: args.completedCount,
      failedCount: args.failedCount,
      ...(args.status === "completed" || args.status === "failed"
        ? { completedAt: Date.now() }
        : {}),
    });
  },
});

export const saveBatchResults = internalMutation({
  args: {
    batchId: v.string(),
    results: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("batchJobs")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();

    if (!job) return;

    await ctx.db.patch(job._id, {
      results: args.results,
      status: "completed",
      completedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const getBatchJob = internalQuery({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("batchJobs")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();
  },
});

export const listBatchJobs = internalQuery({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    if (args.status) {
      return await ctx.db
        .query("batchJobs")
        .withIndex("by_status", (q) => q.eq("status", args.status as any))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("batchJobs")
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLES & INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Daily Morning Brief as Batch Job
 *
 * Instead of generating immediately, queue as batch for 50% cost savings
 */
export const generateDailyBriefBatch = action({
  args: {
    userId: v.id("users"),
    date: v.string(),
    topics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Prepare batch requests (one per topic)
    const requests: BatchRequest[] = args.topics.map((topic, i) => ({
      custom_id: `brief_${args.date}_${i}`,
      params: {
        model: "claude-haiku-4-5",
        max_tokens: 500,
        system: "You are a concise news briefing assistant.",
        messages: [
          {
            role: "user",
            content: `Provide a brief summary of key developments in ${topic} for ${args.date}.`,
          },
        ],
      },
    }));

    // Create batch
    const { batchId } = await ctx.runAction(
      internal.domains.agents.batchAPI.createAnthropicBatch,
      {
        requests,
        description: `Daily brief for ${args.date}`,
      }
    );

    console.log(`[DailyBrief] Created batch ${batchId} for ${args.date}`);
    console.log(`[DailyBrief] ${requests.length} topics queued`);
    console.log(`[DailyBrief] Expected completion: ~4-24 hours`);
    console.log(`[DailyBrief] Cost savings: 50% vs immediate execution`);

    return { batchId, topicCount: requests.length };
  },
});
