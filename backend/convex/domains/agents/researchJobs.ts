// convex/domains/agents/researchJobs.ts
// Background research job processing for GAM

import { v } from "convex/values";
import { 
  mutation, 
  query, 
  internalMutation, 
  internalQuery, 
  internalAction 
} from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { MEMORY_LIMITS } from "../../lib/memoryLimits";
import { isMemoryEnabled } from "../../lib/featureFlags";
import type { Id, Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type JobType = "initial" | "refresh" | "merge_review" | "deep_upgrade";
type JobStatus = "pending" | "running" | "completed" | "failed";
type ResearchDepth = "shallow" | "standard" | "deep";

// ═══════════════════════════════════════════════════════════════════════════
// CREATE JOB - With rate limiting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new research job with rate limiting.
 * 
 * Rate limits:
 * - Max 10 jobs per user per hour
 * - 12-hour cooldown per entity
 * - Max 3 concurrent jobs per user
 */
export const createJob = internalMutation({
  args: {
    targetType: v.union(v.literal("entity"), v.literal("theme")),
    targetId: v.string(),
    targetDisplayName: v.string(),
    jobType: v.union(
      v.literal("initial"),
      v.literal("refresh"),
      v.literal("merge_review"),
      v.literal("deep_upgrade")
    ),
    researchDepth: v.optional(v.union(
      v.literal("shallow"),
      v.literal("standard"),
      v.literal("deep")
    )),
    priority: v.number(),
    triggerSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Rate limit: max jobs per hour
    const recentJobs = await ctx.db
      .query("researchJobs")
      .withIndex("by_user_status", q => q.eq("userId", userId))
      .filter(q => q.gte(q.field("createdAt"), oneHourAgo))
      .collect();

    if (recentJobs.length >= MEMORY_LIMITS.maxJobsPerUserPerHour) {
      console.warn(`[researchJobs] Rate limit exceeded for user ${userId}: ${recentJobs.length} jobs in last hour`);
      throw new Error(`Rate limit exceeded: max ${MEMORY_LIMITS.maxJobsPerUserPerHour} research jobs per hour`);
    }

    // Cooldown: check if this entity was recently researched
    const cooldownHours = MEMORY_LIMITS.cooldownPerEntityHours;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    
    const recentForTarget = await ctx.db
      .query("researchJobs")
      .withIndex("by_target", q =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .order("desc")
      .first() as Doc<"researchJobs"> | null;

    if (recentForTarget && recentForTarget.status === "completed") {
      const hoursSince = (now - recentForTarget.createdAt) / (1000 * 60 * 60);
      if (hoursSince < cooldownHours) {
        console.log(`[researchJobs] Cooldown active for ${args.targetId}: ${hoursSince.toFixed(1)}h < ${cooldownHours}h`);
        // Return existing job ID instead of creating new one
        return recentForTarget._id;
      }
    }

    // Check concurrent jobs
    const runningJobs = recentJobs.filter(j => j.status === "running" || j.status === "pending");
    if (runningJobs.length >= MEMORY_LIMITS.maxConcurrentJobsPerUser) {
      console.warn(`[researchJobs] Too many concurrent jobs for user ${userId}: ${runningJobs.length}`);
      throw new Error(`Too many concurrent jobs: max ${MEMORY_LIMITS.maxConcurrentJobsPerUser}`);
    }

    // Create the job
    const jobId = await ctx.db.insert("researchJobs", {
      userId,
      targetType: args.targetType,
      targetId: args.targetId,
      targetDisplayName: args.targetDisplayName,
      jobType: args.jobType,
      researchDepth: args.researchDepth || "standard",
      status: "pending",
      priority: args.priority,
      triggerSource: args.triggerSource,
      createdAt: now,
    });

    console.log(`[researchJobs] Created job ${jobId} for ${args.targetType}:${args.targetId} (${args.jobType})`);

    // Schedule processing
    await ctx.scheduler.runAfter(0, internal.domains.agents.researchJobs.processJob, { 
      jobId 
    });

    return jobId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS JOB - Execute research
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a research job.
 */
export const processJob = internalAction({
  args: { 
    jobId: v.id("researchJobs") 
  },
  handler: async (ctx, { jobId }) => {
    // Get job
    const job = await ctx.runQuery(internal.domains.agents.researchJobs.getJob, { jobId });
    if (!job) {
      console.error(`[researchJobs] Job ${jobId} not found`);
      return;
    }

    if (job.status !== "pending") {
      console.log(`[researchJobs] Job ${jobId} is ${job.status}, skipping`);
      return;
    }

    const startTime = Date.now();

    // Mark as running
    await ctx.runMutation(internal.domains.agents.researchJobs.updateJobStatus, {
      jobId,
      status: "running",
      startedAt: startTime,
    });

    try {
      if (job.targetType === "entity") {
        // Process entity research
        await processEntityResearch(ctx, job);
      } else if (job.targetType === "theme") {
        // Process theme research (simplified for now)
        console.log(`[researchJobs] Theme research not yet implemented for ${job.targetDisplayName}`);
      }

      // Mark as completed
      await ctx.runMutation(internal.domains.agents.researchJobs.updateJobStatus, {
        jobId,
        status: "completed",
        completedAt: Date.now(),
        durationMs: Date.now() - startTime,
      });

      console.log(`[researchJobs] Completed job ${jobId} in ${Date.now() - startTime}ms`);

    } catch (error) {
      console.error(`[researchJobs] Job ${jobId} failed:`, error);
      
      await ctx.runMutation(internal.domains.agents.researchJobs.updateJobStatus, {
        jobId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
    }
  },
});

/**
 * Process entity research.
 * 
 * Note: enrichCompanyDossier is a createTool, not a Convex action.
 * For background research, we log the request and optionally upgrade existing entities.
 * Full background enrichment would require an agent runner or separate action.
 */
async function processEntityResearch(
  ctx: any, 
  job: {
    targetDisplayName: string;
    jobType: JobType;
    researchDepth?: ResearchDepth;
    userId: Id<"users">;
  }
) {
  const { targetDisplayName, jobType, researchDepth } = job;

  console.log(`[processEntityResearch] Processing ${targetDisplayName} (${jobType}, ${researchDepth})`);

  // Check if entity already exists
  const entity = await ctx.runQuery(api.domains.knowledge.entityContexts.getEntityContext, {
    entityName: targetDisplayName,
    entityType: "company",
  });

  if (!entity) {
    // Entity doesn't exist yet - we can't do background enrichment without agent
    // This would typically trigger an agent to run enrichCompanyDossier
    console.log(`[processEntityResearch] Entity ${targetDisplayName} not found. Background enrichment requires agent runner.`);
    
    // For now, just mark the job as needing manual enrichment
    // In a full implementation, this would trigger an agent workflow
    return;
  }

  // If deep research requested and entity exists, upgrade to deep memory
  if (researchDepth === "deep" && jobType !== "merge_review") {
    // Synthesize narratives and heuristics
    // In production, this would call an LLM - simplified for now
    const narratives = [
      {
        label: "business_overview",
        description: `${targetDisplayName} business model and market position`,
        supportingFactIds: [] as string[],
        isWellSupported: true,
      },
    ];
    
    const heuristics = [
      `When analyzing ${targetDisplayName}, check for recent funding rounds`,
      `Consider ${targetDisplayName}'s competitive landscape`,
    ];

    await ctx.runMutation(internal.domains.knowledge.entityContexts.upgradeToDeepMemory, {
      entityId: entity._id,
      narratives,
      heuristics,
    });

    console.log(`[processEntityResearch] Upgraded ${targetDisplayName} to deep memory`);
  } else if (jobType === "refresh") {
    // For refresh jobs, just update timestamps and mark not stale
    // The actual data refresh would happen when agent calls enrichment tools
    console.log(`[processEntityResearch] Refresh requested for ${targetDisplayName}. Agent should run enrichment tools.`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a job by ID.
 */
export const getJob = internalQuery({
  args: { 
    jobId: v.id("researchJobs") 
  },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

/**
 * List jobs for current user.
 */
export const listJobs = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let query = ctx.db
      .query("researchJobs")
      .withIndex("by_user_status", q => q.eq("userId", userId));

    if (args.status) {
      query = query.filter(q => q.eq(q.field("status"), args.status));
    }

    const jobs = await query
      .order("desc")
      .take(args.limit || 20);

    return jobs;
  },
});

/**
 * Get job statistics for current user.
 */
export const getJobStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const allJobs = await ctx.db
      .query("researchJobs")
      .withIndex("by_user_status", q => q.eq("userId", userId))
      .collect();

    const recentJobs = allJobs.filter(j => j.createdAt >= oneHourAgo);
    const todayJobs = allJobs.filter(j => j.createdAt >= oneDayAgo);

    return {
      total: allJobs.length,
      pending: allJobs.filter(j => j.status === "pending").length,
      running: allJobs.filter(j => j.status === "running").length,
      completed: allJobs.filter(j => j.status === "completed").length,
      failed: allJobs.filter(j => j.status === "failed").length,
      lastHour: recentJobs.length,
      lastDay: todayJobs.length,
      remainingThisHour: Math.max(0, MEMORY_LIMITS.maxJobsPerUserPerHour - recentJobs.length),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// JOB MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update job status.
 */
export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("researchJobs"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status };
    
    if (args.startedAt !== undefined) updates.startedAt = args.startedAt;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;
    if (args.error !== undefined) updates.error = args.error;
    if (args.durationMs !== undefined) updates.durationMs = args.durationMs;

    await ctx.db.patch(args.jobId, updates);
  },
});

/**
 * Cancel a pending job.
 */
export const cancelJob = mutation({
  args: {
    jobId: v.id("researchJobs"),
  },
  handler: async (ctx, { jobId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const job = await ctx.db.get(jobId) as Doc<"researchJobs"> | null;
    if (!job) throw new Error("Job not found");
    if (job.userId !== userId) throw new Error("Not authorized");
    if (job.status !== "pending") throw new Error("Can only cancel pending jobs");

    await ctx.db.patch(jobId, { 
      status: "failed",
      error: "Cancelled by user",
    });

    console.log(`[researchJobs] Cancelled job ${jobId}`);
  },
});
