/**
 * Benchmark Harness - Deterministic evaluation & regression testing
 *
 * Provides reusable benchmark infrastructure for:
 * - SEC filing retrieval tests
 * - Banking memo workflow tests
 * - Social media ingestion tests
 * - Tool health verification
 * - Artifact idempotency checks
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TASK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Seed a benchmark task into the golden dataset.
 */
export const seedBenchmarkTask = internalMutation({
  args: {
    taskId: v.string(),
    suite: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    taskType: v.union(
      v.literal("sec_retrieval"),
      v.literal("memo_generation"),
      v.literal("instagram_ingestion"),
      v.literal("claim_extraction"),
      v.literal("citation_validation"),
      v.literal("tool_health"),
      v.literal("artifact_replay"),
    ),
    inputPayload: v.any(),
    expectations: v.object({
      minArtifacts: v.optional(v.number()),
      requiredFields: v.optional(v.array(v.string())),
      maxLatencyMs: v.optional(v.number()),
      successRequired: v.boolean(),
      idempotent: v.optional(v.boolean()),
    }),
    priority: v.optional(v.number()),
  },
  returns: v.id("benchmarkTasks"),
  handler: async (ctx, args) => {
    // Check if task already exists
    const existing = await ctx.db
      .query("benchmarkTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first() as Doc<"benchmarkTasks"> | null;

    if (existing) {
      // Update existing task
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    // Create new task
    return await ctx.db.insert("benchmarkTasks", {
      ...args,
      createdAt: Date.now(),
      isActive: true,
    });
  },
});

/**
 * Get all active tasks for a suite.
 */
export const getTasksBySuite = internalQuery({
  args: {
    suite: v.string(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("benchmarkTasks")
      .withIndex("by_suite", (q) => q.eq("suite", args.suite))
      .collect() as Doc<"benchmarkTasks">[];

    return tasks.filter((t: Doc<"benchmarkTasks">) => t.isActive).sort((a: Doc<"benchmarkTasks">, b: Doc<"benchmarkTasks">) => (a.priority ?? 0) - (b.priority ?? 0));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a new benchmark run.
 */
export const startBenchmarkRun = internalMutation({
  args: {
    suite: v.string(),
    triggeredBy: v.optional(v.string()),
    gitCommit: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.string(),
    dbId: v.id("benchmarkRuns"),
  }),
  handler: async (ctx, args) => {
    const runId = `${args.suite}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Count active tasks
    const tasks = await ctx.db
      .query("benchmarkTasks")
      .withIndex("by_suite", (q) => q.eq("suite", args.suite))
      .collect() as Doc<"benchmarkTasks">[];
    const activeTasks = tasks.filter((t: Doc<"benchmarkTasks">) => t.isActive);

    const dbId = await ctx.db.insert("benchmarkRuns", {
      runId,
      suite: args.suite,
      triggeredBy: args.triggeredBy ?? "manual",
      gitCommit: args.gitCommit,
      status: "running",
      totalTasks: activeTasks.length,
      completedTasks: 0,
      passedTasks: 0,
      failedTasks: 0,
      startedAt: Date.now(),
    });

    return { runId, dbId };
  },
});

/**
 * Record a task result within a run.
 */
export const recordBenchmarkScore = internalMutation({
  args: {
    runId: v.string(),
    taskId: v.string(),
    suite: v.string(),
    passed: v.boolean(),
    latencyMs: v.number(),
    validationResults: v.object({
      artifactCountValid: v.optional(v.boolean()),
      requiredFieldsPresent: v.optional(v.boolean()),
      latencyWithinThreshold: v.optional(v.boolean()),
      idempotencyVerified: v.optional(v.boolean()),
      customChecks: v.optional(v.array(v.object({
        name: v.string(),
        passed: v.boolean(),
        message: v.optional(v.string()),
      }))),
    }),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    outputPreview: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.id("benchmarkScores"),
  handler: async (ctx, args) => {
    // Insert score
    const scoreId = await ctx.db.insert("benchmarkScores", {
      ...args,
      executedAt: Date.now(),
    });

    // Update run progress
    const run = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first() as Doc<"benchmarkRuns"> | null;

    if (run) {
      await ctx.db.patch(run._id, {
        completedTasks: run.completedTasks + 1,
        passedTasks: args.passed ? run.passedTasks + 1 : run.passedTasks,
        failedTasks: args.passed ? run.failedTasks : run.failedTasks + 1,
        totalLatencyMs: (run.totalLatencyMs ?? 0) + args.latencyMs,
        errors: args.error
          ? [...(run.errors ?? []), { taskId: args.taskId, error: args.error }]
          : run.errors,
      });
    }

    return scoreId;
  },
});

/**
 * Complete a benchmark run.
 */
export const completeBenchmarkRun = internalMutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first() as Doc<"benchmarkRuns"> | null;

    if (!run) return null;

    const avgLatencyMs = run.completedTasks > 0
      ? Math.round((run.totalLatencyMs ?? 0) / run.completedTasks)
      : 0;

    await ctx.db.patch(run._id, {
      status: args.status,
      completedAt: Date.now(),
      avgLatencyMs,
    });

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get detailed results for a run.
 */
export const getBenchmarkRunResults = internalQuery({
  args: {
    runId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first() as Doc<"benchmarkRuns"> | null;

    if (!run) return null;

    const scores = await ctx.db
      .query("benchmarkScores")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect() as Doc<"benchmarkScores">[];

    return {
      run,
      scores,
      summary: {
        passRate: run.totalTasks > 0 ? Math.round((run.passedTasks / run.totalTasks) * 100) : 0,
        avgLatencyMs: run.avgLatencyMs ?? 0,
        totalDurationMs: run.completedAt ? run.completedAt - run.startedAt : null,
      },
    };
  },
});

/**
 * Get latest run for a suite.
 */
export const getLatestBenchmarkRun = internalQuery({
  args: {
    suite: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_suite", (q) => q.eq("suite", args.suite))
      .order("desc")
      .take(1) as Doc<"benchmarkRuns">[];

    return runs[0] ?? null;
  },
});

/**
 * Generate a markdown report for a run.
 */
export const generateBenchmarkReport = internalQuery({
  args: {
    runId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first() as Doc<"benchmarkRuns"> | null;

    if (!run) return "# Benchmark Run Not Found\n";

    const scores = await ctx.db
      .query("benchmarkScores")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect() as Doc<"benchmarkScores">[];

    const passRate = run.totalTasks > 0
      ? Math.round((run.passedTasks / run.totalTasks) * 100)
      : 0;

    const passEmoji = passRate >= 90 ? "✅" : passRate >= 70 ? "⚠️" : "❌";

    let report = `# Benchmark Report: ${run.suite}\n\n`;
    report += `**Run ID:** \`${run.runId}\`\n`;
    report += `**Status:** ${run.status} ${passEmoji}\n`;
    report += `**Triggered By:** ${run.triggeredBy ?? "unknown"}\n`;
    if (run.gitCommit) {
      report += `**Git Commit:** \`${run.gitCommit}\`\n`;
    }
    report += `**Started:** ${new Date(run.startedAt).toISOString()}\n`;
    if (run.completedAt) {
      report += `**Completed:** ${new Date(run.completedAt).toISOString()}\n`;
      report += `**Duration:** ${run.completedAt - run.startedAt}ms\n`;
    }
    report += `\n`;

    report += `## Summary\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Tasks | ${run.totalTasks} |\n`;
    report += `| Passed | ${run.passedTasks} |\n`;
    report += `| Failed | ${run.failedTasks} |\n`;
    report += `| Pass Rate | ${passRate}% |\n`;
    report += `| Avg Latency | ${run.avgLatencyMs ?? 0}ms |\n`;
    report += `\n`;

    report += `## Task Results\n\n`;
    report += `| Task | Status | Latency |\n`;
    report += `|------|--------|--------|\n`;
    for (const score of scores) {
      const status = score.passed ? "✅ Pass" : "❌ Fail";
      report += `| ${score.taskId} | ${status} | ${score.latencyMs}ms |\n`;
    }
    report += `\n`;

    if (run.errors && run.errors.length > 0) {
      report += `## Errors\n\n`;
      for (const error of run.errors) {
        report += `### ${error.taskId}\n`;
        report += `\`\`\`\n${error.error}\n\`\`\`\n\n`;
      }
    }

    return report;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TASK EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a SEC retrieval benchmark task.
 */
export const executeSECRetrievalTask = internalAction({
  args: {
    runId: v.string(),
    taskId: v.string(),
    suite: v.string(),
    inputPayload: v.object({
      ticker: v.string(),
      formType: v.optional(v.string()),
      limit: v.optional(v.number()),
    }),
    expectations: v.object({
      minArtifacts: v.optional(v.number()),
      requiredFields: v.optional(v.array(v.string())),
      maxLatencyMs: v.optional(v.number()),
      successRequired: v.boolean(),
      idempotent: v.optional(v.boolean()),
    }),
  },
  returns: v.object({ passed: v.boolean(), latencyMs: v.number() }),
  handler: async (ctx, args) => {
    const startTime = Date.now();
    let passed = true;
    let error: string | undefined;
    const validationResults: any = {};
    let artifactIds: Id<"sourceArtifacts">[] = [];

    try {
      // Execute SEC retrieval
      const result = await ctx.runAction(
        internal.domains.agents.orchestrator.secEdgarWrapper.searchFilings,
        {
          ticker: args.inputPayload.ticker,
          formType: args.inputPayload.formType,
          limit: args.inputPayload.limit ?? 3,
        }
      );

      const latencyMs = Date.now() - startTime;

      // Validate success
      if (args.expectations.successRequired && !result.success) {
        passed = false;
        error = result.error ?? "SEC retrieval failed";
      }

      // Validate artifact count
      if (args.expectations.minArtifacts !== undefined) {
        validationResults.artifactCountValid = result.artifactIds.length >= args.expectations.minArtifacts;
        if (!validationResults.artifactCountValid) {
          passed = false;
        }
      }

      // Validate latency
      if (args.expectations.maxLatencyMs !== undefined) {
        validationResults.latencyWithinThreshold = latencyMs <= args.expectations.maxLatencyMs;
        if (!validationResults.latencyWithinThreshold) {
          passed = false;
        }
      }

      artifactIds = result.artifactIds;

      // Validate idempotency if required
      if (args.expectations.idempotent && result.success) {
        const secondResult = await ctx.runAction(
          internal.domains.agents.orchestrator.secEdgarWrapper.searchFilings,
          {
            ticker: args.inputPayload.ticker,
            formType: args.inputPayload.formType,
            limit: args.inputPayload.limit ?? 3,
          }
        );

        validationResults.idempotencyVerified =
          JSON.stringify(result.artifactIds.sort()) === JSON.stringify(secondResult.artifactIds.sort());
        if (!validationResults.idempotencyVerified) {
          passed = false;
        }
      }

      // Record score
      await ctx.runMutation(internal.domains.evaluation.benchmarkHarness.recordBenchmarkScore, {
        runId: args.runId,
        taskId: args.taskId,
        suite: args.suite,
        passed,
        latencyMs,
        validationResults,
        artifactIds: artifactIds.length > 0 ? artifactIds : undefined,
        outputPreview: JSON.stringify(result.filings?.slice(0, 2)).substring(0, 500),
        error,
      });

      return { passed, latencyMs };
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      error = e instanceof Error ? e.message : String(e);

      await ctx.runMutation(internal.domains.evaluation.benchmarkHarness.recordBenchmarkScore, {
        runId: args.runId,
        taskId: args.taskId,
        suite: args.suite,
        passed: false,
        latencyMs,
        validationResults: {},
        error,
      });

      return { passed: false, latencyMs };
    }
  },
});

/**
 * Execute a tool health benchmark task.
 */
export const executeToolHealthTask = internalAction({
  args: {
    runId: v.string(),
    taskId: v.string(),
    suite: v.string(),
    inputPayload: v.object({
      toolNames: v.optional(v.array(v.string())),
    }),
    expectations: v.object({
      minArtifacts: v.optional(v.number()),
      requiredFields: v.optional(v.array(v.string())),
      maxLatencyMs: v.optional(v.number()),
      successRequired: v.boolean(),
      idempotent: v.optional(v.boolean()),
    }),
  },
  returns: v.object({ passed: v.boolean(), latencyMs: v.number() }),
  handler: async (ctx, args) => {
    const startTime = Date.now();

    try {
      // Get tool health snapshot
      const health = await ctx.runQuery(
        internal.domains.agents.orchestrator.toolHealth.getToolHealthSnapshot,
        {}
      );

      const latencyMs = Date.now() - startTime;

      // Check for open circuits
      const openCircuits = health.filter((h: any) => h.circuitOpen);
      const passed = openCircuits.length === 0;

      const validationResults = {
        customChecks: health.map((h: any) => ({
          name: h.toolName,
          passed: !h.circuitOpen,
          message: h.circuitOpen ? `Circuit open, ${h.consecutiveFailures} failures` : `OK, ${h.successCount} successes`,
        })),
      };

      await ctx.runMutation(internal.domains.evaluation.benchmarkHarness.recordBenchmarkScore, {
        runId: args.runId,
        taskId: args.taskId,
        suite: args.suite,
        passed,
        latencyMs,
        validationResults,
        outputPreview: JSON.stringify(health.map((h: any) => ({
          tool: h.toolName,
          circuit: h.circuitOpen ? "OPEN" : "closed",
          rate: `${h.failureRate * 100}%`,
        }))).substring(0, 500),
        error: openCircuits.length > 0 ? `${openCircuits.length} circuits open` : undefined,
      });

      return { passed, latencyMs };
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      const error = e instanceof Error ? e.message : String(e);

      await ctx.runMutation(internal.domains.evaluation.benchmarkHarness.recordBenchmarkScore, {
        runId: args.runId,
        taskId: args.taskId,
        suite: args.suite,
        passed: false,
        latencyMs,
        validationResults: {},
        error,
      });

      return { passed: false, latencyMs };
    }
  },
});
