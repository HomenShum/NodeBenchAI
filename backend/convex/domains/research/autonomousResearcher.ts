/**
 * Autonomous Researcher - Self-Executing Research Pipeline
 * Deep Agents 3.0 - Executes research tasks without human intervention
 *
 * Pipeline:
 * 1. Dequeue highest priority task
 * 2. Execute multi-persona research swarm
 * 3. Run self-questioning validation
 * 4. Queue for publishing on success
 * 5. Handle retries on failure
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { RESEARCH_CONFIG, QUALITY_CONFIG, FREE_MODEL_CONFIG } from "../../config/autonomousConfig";
import type { Doc, Id } from "../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

interface ResearchResult {
  entityId: string;
  entityName: string;
  persona: string;
  content: {
    raw: string;
    summary: string;
    keyFacts: Array<{
      label: string;
      value: string;
      category?: string;
      confidence?: number;
    }>;
    nextActions: string[];
  };
  sources: Array<{
    name: string;
    url: string;
    snippet?: string;
  }>;
  tokensUsed: number;
  costUsd: number;
  elapsedMs: number;
}

interface ValidationResult {
  passed: boolean;
  score: number;
  issues: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
}

/* ================================================================== */
/* RESEARCH EXECUTION                                                  */
/* ================================================================== */

/**
 * Execute research for a single task
 * Uses free models from OpenRouter when FREE_MODEL_CONFIG.preferFreeModels is true
 * Falls back to paid models with automatic retry handling
 */
async function executeResearch(
  ctx: any,
  task: Doc<"researchTasks">
): Promise<ResearchResult> {
  const startTime = Date.now();

  console.log(
    `[AutonomousResearcher] Executing research for ${task.entityName || task.entityId}`
  );
  console.log(`[AutonomousResearcher] Personas: ${task.personas.join(", ")}`);
  console.log(`[AutonomousResearcher] Using free models: ${FREE_MODEL_CONFIG.preferFreeModels}`);

  // Build the research prompt
  const personaContext = (task.personas as string[])
    .map((p: string) => `- ${p}: Focus on relevant ${p.toLowerCase()} insights`)
    .join("\n");

  const researchPrompt = `You are conducting research on "${task.entityName || task.entityId}".

Entity Type: ${task.entityType || "Unknown"}
Research Depth: ${task.researchDepth || "standard"}

Personas to consider:
${personaContext}

Please provide:
1. A comprehensive summary (2-3 paragraphs)
2. Key facts as bullet points (at least 5)
3. Recommended next actions (at least 3)

Focus on recent, verifiable information. Include confidence levels where applicable.`;

  try {
    // Use the autonomous model resolver with fallback chain
    const response = await ctx.runAction(
      internal.domains.models.autonomousModelResolver.executeWithFallback,
      {
        taskType: "research",
        messages: [
          {
            role: "system" as const,
            content: "You are a research assistant specializing in comprehensive entity analysis. Provide factual, well-structured research outputs.",
          },
          {
            role: "user" as const,
            content: researchPrompt,
          },
        ],
        maxTokens: 2000,
        temperature: 0.7,
      }
    );

    const elapsedMs = Date.now() - startTime;

    console.log(
      `[AutonomousResearcher] Research completed using ${response.modelUsed} (free: ${response.isFree}, fallback: ${response.fallbackLevel})`
    );

    // Parse the response into structured format
    const rawContent = response.content;

    // Extract key facts (simple heuristic - lines starting with - or *)
    const factLines = rawContent
      .split("\n")
      .filter((line: string) => line.trim().startsWith("-") || line.trim().startsWith("*"))
      .slice(0, 10)
      .map((line: string, idx: number) => ({
        label: `Fact ${idx + 1}`,
        value: line.replace(/^[-*]\s*/, "").trim(),
        category: "research",
        confidence: 0.8,
      }));

    // Extract next actions (look for "action" or numbered items at the end)
    const actionSection = rawContent.toLowerCase().includes("next actions") ||
      rawContent.toLowerCase().includes("recommended actions");
    const actions = actionSection
      ? rawContent
          .split(/next actions|recommended actions/i)[1]
          ?.split("\n")
          .filter((line: string) => line.trim().match(/^[1-9]|^[-*]/))
          .slice(0, 5)
          .map((line: string) => line.replace(/^[0-9]+[.)]?\s*|^[-*]\s*/, "").trim())
          .filter((a: string) => a.length > 0) || []
      : ["Review research results", "Verify key claims", "Follow up on leads"];

    return {
      entityId: task.entityId,
      entityName: task.entityName || task.entityId,
      persona: task.primaryPersona || task.personas[0],
      content: {
        raw: rawContent,
        summary: rawContent.substring(0, 500) + (rawContent.length > 500 ? "..." : ""),
        keyFacts: factLines.length > 0 ? factLines : [
          {
            label: "Entity Type",
            value: task.entityType || "Unknown",
            category: "meta",
            confidence: 1.0,
          },
        ],
        nextActions: actions.length > 0 ? actions : [
          "Review research results",
          "Verify key claims",
          "Follow up on leads",
        ],
      },
      sources: [], // Sources would come from tool calls in production
      tokensUsed: 2000, // Estimate
      costUsd: response.isFree ? 0 : 0.01,
      elapsedMs,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error(`[AutonomousResearcher] Research failed:`, error);

    // Return minimal result so validation can fail gracefully
    return {
      entityId: task.entityId,
      entityName: task.entityName || task.entityId,
      persona: task.primaryPersona || task.personas[0],
      content: {
        raw: `Research failed: ${error instanceof Error ? error.message : String(error)}`,
        summary: "Research could not be completed due to model errors.",
        keyFacts: [],
        nextActions: ["Retry research", "Check model availability"],
      },
      sources: [],
      tokensUsed: 0,
      costUsd: 0,
      elapsedMs,
    };
  }
}

/**
 * Run self-questioning validation on research results
 */
async function validateResearch(
  ctx: any,
  task: Doc<"researchTasks">,
  result: ResearchResult
): Promise<ValidationResult> {
  console.log(
    `[AutonomousResearcher] Validating research for ${task.entityName || task.entityId}`
  );

  // TODO: Replace with actual self-question agent call:
  // const validation = await ctx.runAction(
  //   internal.domains.validation.selfQuestionAgent.selfQuestion,
  //   {
  //     content: result.content.raw,
  //     entityId: task.entityId,
  //     persona: task.primaryPersona || task.personas[0],
  //   }
  // );

  // Placeholder validation - in production, this runs actual validation
  const issues: ValidationResult["issues"] = [];

  // Check for minimum sources
  if (result.sources.length < QUALITY_CONFIG.minSources) {
    issues.push({
      type: "grounding",
      severity: "warning",
      description: `Only ${result.sources.length} sources found, minimum ${QUALITY_CONFIG.minSources} required`,
    });
  }

  // Check for key facts
  if (result.content.keyFacts.length < 3) {
    issues.push({
      type: "completeness",
      severity: "warning",
      description: "Fewer than 3 key facts extracted",
    });
  }

  // Check for next actions
  if (result.content.nextActions.length < 2) {
    issues.push({
      type: "completeness",
      severity: "info",
      description: "Fewer than 2 next actions suggested",
    });
  }

  // Calculate score
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case "blocker":
        score -= QUALITY_CONFIG.penalties.blockerIssue;
        break;
      case "warning":
        score -= QUALITY_CONFIG.penalties.warningIssue;
        break;
      case "info":
        score -= QUALITY_CONFIG.penalties.infoIssue;
        break;
    }
  }

  const blockers = issues.filter((i) => i.severity === "blocker");
  const passed = blockers.length === 0 && score >= QUALITY_CONFIG.minQualityScore;

  return {
    passed,
    score: Math.max(score, 0),
    issues,
  };
}

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Create a publishing task from research results
 */
export const createPublishingTask = internalMutation({
  args: {
    researchTaskId: v.id("researchTasks"),
    entityId: v.string(),
    entityName: v.optional(v.string()),
    content: v.object({
      raw: v.string(),
      summary: v.string(),
      keyFacts: v.array(
        v.object({
          label: v.string(),
          value: v.string(),
          category: v.optional(v.string()),
          confidence: v.optional(v.number()),
        })
      ),
      nextActions: v.array(v.string()),
      persona: v.string(),
    }),
    channels: v.array(
      v.object({
        channel: v.string(),
        enabled: v.boolean(),
        format: v.string(),
        urgency: v.optional(v.string()),
        recipients: v.optional(v.array(v.string())),
        scheduledFor: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"publishingTasks">> => {
    return await ctx.db.insert("publishingTasks", {
      researchTaskId: args.researchTaskId,
      entityId: args.entityId,
      entityName: args.entityName,
      content: args.content,
      channels: args.channels,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Run autonomous research for a single task
 */
export const runResearch = internalAction({
  args: { taskId: v.id("researchTasks") },
  handler: async (ctx, { taskId }): Promise<void> => {
    console.log(`[AutonomousResearcher] Starting research for task ${taskId}`);

    // 1. Get the task
    const task = await ctx.runQuery(
      internal.domains.research.researchQueue.getTask,
      { taskId }
    );

    if (!task) {
      console.error(`[AutonomousResearcher] Task not found: ${taskId}`);
      return;
    }

    if (task.status !== "queued") {
      console.log(`[AutonomousResearcher] Task ${taskId} is not queued (status: ${task.status})`);
      return;
    }

    // 2. Mark as researching
    await ctx.runMutation(
      internal.domains.research.researchQueue.updateStatus,
      { taskId, status: "researching" }
    );

    try {
      // 3. Execute research
      const result = await executeResearch(ctx, task);

      // 4. Mark as validating
      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        { taskId, status: "validating" }
      );

      // 5. Validate results
      const validation = await validateResearch(ctx, task, result);

      if (!validation.passed) {
        console.log(
          `[AutonomousResearcher] Validation failed for ${task.entityId}: ${validation.issues.map((i) => i.description).join(", ")}`
        );

        // Check if we should retry
        const canRetry = await ctx.runMutation(
          internal.domains.research.researchQueue.markForRetry,
          {
            taskId,
            error: `Validation failed (score: ${validation.score}): ${validation.issues.map((i) => i.description).join("; ")}`,
          }
        );

        if (canRetry) {
          console.log(`[AutonomousResearcher] Task ${taskId} queued for retry`);
        } else {
          console.log(`[AutonomousResearcher] Task ${taskId} failed permanently`);
        }

        return;
      }

      // 6. Update task with validation results
      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        {
          taskId,
          status: "publishing",
          qualityScore: validation.score,
          validationPassed: true,
          validationIssues: validation.issues,
          tokensUsed: result.tokensUsed,
          costUsd: result.costUsd,
        }
      );

      // 7. Create publishing task
      const publishingTaskId = await ctx.runMutation(
        internal.domains.research.autonomousResearcher.createPublishingTask,
        {
          researchTaskId: taskId,
          entityId: task.entityId,
          entityName: task.entityName,
          content: {
            ...result.content,
            persona: result.persona,
          },
          channels: [
            { channel: "ui", enabled: true, format: "full" },
            { channel: "ntfy", enabled: true, format: "alert" },
            { channel: "email", enabled: false, format: "digest" },
          ],
        }
      );

      console.log(
        `[AutonomousResearcher] Created publishing task ${publishingTaskId} for ${task.entityId}`
      );

      // 8. Mark research task as completed
      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        { taskId, status: "completed" }
      );

      // 9. Schedule publishing
      await ctx.scheduler.runAfter(
        0,
        internal.domains.publishing.publishingOrchestrator.processPublishingTask,
        { publishingTaskId }
      );

      console.log(
        `[AutonomousResearcher] Research completed for ${task.entityId} (score: ${validation.score})`
      );
    } catch (error) {
      console.error(
        `[AutonomousResearcher] Error researching ${task.entityId}:`,
        error
      );

      await ctx.runMutation(
        internal.domains.research.researchQueue.markForRetry,
        {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  },
});

/**
 * Run research for a specific persona
 */
export const runForPersona = internalAction({
  args: {
    entityId: v.string(),
    personaId: v.string(),
  },
  handler: async (ctx, { entityId, personaId }): Promise<ResearchResult | null> => {
    console.log(
      `[AutonomousResearcher] Running persona research: ${personaId} for ${entityId}`
    );

    // Create a temporary task for this persona
    const taskId = await ctx.runMutation(
      internal.domains.research.researchQueue.enqueue,
      {
        entityId,
        personas: [personaId],
        primaryPersona: personaId,
        priority: 50,
        triggeredBy: "manual",
      }
    );

    // Get the task
    const task = await ctx.runQuery(
      internal.domains.research.researchQueue.getTask,
      { taskId }
    );

    if (!task) {
      return null;
    }

    // Execute research
    try {
      const result = await executeResearch(ctx, task);

      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        {
          taskId,
          status: "completed",
          tokensUsed: result.tokensUsed,
          costUsd: result.costUsd,
        }
      );

      return result;
    } catch (error) {
      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        {
          taskId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  },
});

/**
 * Main research loop - processes the next available task
 */
export const runAutonomousResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[AutonomousResearcher] Checking for queued tasks...");

    // Check concurrent research limit
    const activeTasks = await ctx.runQuery(
      internal.domains.research.researchQueue.getActiveTasks,
      {}
    );

    if (activeTasks.length >= RESEARCH_CONFIG.maxConcurrentResearch) {
      console.log(
        `[AutonomousResearcher] Max concurrent research reached (${activeTasks.length}/${RESEARCH_CONFIG.maxConcurrentResearch})`
      );
      return;
    }

    // Get next task
    const task = await ctx.runQuery(
      internal.domains.research.researchQueue.dequeueNext,
      {}
    );

    if (!task) {
      console.log("[AutonomousResearcher] No tasks in queue");
      return;
    }

    console.log(
      `[AutonomousResearcher] Dequeued task ${task._id} for ${task.entityName || task.entityId} (priority: ${task.priority})`
    );

    // Run research
    await ctx.runAction(
      internal.domains.research.autonomousResearcher.runResearch,
      { taskId: task._id }
    );
  },
});

/**
 * Process retryable failed tasks
 */
export const processRetryableTasks = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    console.log("[AutonomousResearcher] Processing retryable tasks...");

    const retryableTasks = await ctx.runQuery(
      internal.domains.research.researchQueue.getRetryableTasks,
      { limit: 5 }
    );

    if (retryableTasks.length === 0) {
      console.log("[AutonomousResearcher] No retryable tasks found");
      return 0;
    }

    let processed = 0;
    for (const task of retryableTasks) {
      // Re-queue the task
      await ctx.runMutation(
        internal.domains.research.researchQueue.updateStatus,
        { taskId: task._id, status: "queued" }
      );
      processed++;
    }

    console.log(`[AutonomousResearcher] Re-queued ${processed} tasks for retry`);
    return processed;
  },
});

/**
 * Main tick function - called by cron every minute
 */
export const tickAutonomousResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[AutonomousResearcher] Starting autonomous research tick...");

    // 1. Process retryable tasks first
    await ctx.runAction(
      internal.domains.research.autonomousResearcher.processRetryableTasks,
      {}
    );

    // 2. Run autonomous research loop
    await ctx.runAction(
      internal.domains.research.autonomousResearcher.runAutonomousResearch,
      {}
    );

    // 3. Get and log stats
    const stats = await ctx.runQuery(
      internal.domains.research.researchQueue.getQueueStats,
      {}
    );

    console.log(
      `[AutonomousResearcher] Tick complete. Queue: ${stats.queued} queued, ${stats.researching} researching, ${stats.completed} completed`
    );
  },
});
