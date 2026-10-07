/**
 * ddOrchestrator.ts
 *
 * Due Diligence Orchestrator - Entry point for parallelized DD research.
 * Contains ONLY actions (Node.js runtime).
 * All queries/mutations are in ddMutations.ts.
 *
 * Flow:
 * 1. startDueDiligenceJob() - Create job, initialize state
 * 2. analyzeComplexitySignals() - Determine which branches to spawn
 * 3. spawnDDBranches() - Create branch records, integrate with parallelTaskTree
 * 4. executeBranches() - Fan-out execution using parallel task infrastructure
 * 5. crossCheckFindings() - Compare findings, identify contradictions
 * 6. synthesizeMemo() - Generate traditional DD memo structure
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal, api } from "../../../_generated/api";
import { Doc, Id } from "../../../_generated/dataModel";
import {
  BranchType,
  CORE_BRANCHES,
  CONDITIONAL_BRANCHES,
  BRANCH_TRIGGERS,
  ComplexitySignals,
  DDJobStatus,
  Contradiction,
  DDSource,
  Verdict,
  MicroBranchType,
  RISK_BASED_BRANCHES,
  DDTier,
} from "./types";

// Import actual branch handlers
import { executeCompanyProfileBranch } from "./branches/companyProfile";
import { executeTeamFoundersBranch } from "./branches/teamDeepResearch";
import { executeMarketCompetitiveBranch } from "./branches/marketCompetitive";
import {
  executeTechnicalDDBranch,
  executeIPPatentsBranch,
  executeRegulatoryBranch,
  executeFinancialDeepBranch,
  executeNetworkMappingBranch,
} from "./branches/conditionalBranches";

// Import LLM tools for synthesis
import { generateText } from "ai";
import { getLanguageModelSafe, DEFAULT_MODEL } from "../mcp_tools/models/modelResolver";

// ============================================================================
// LLM Synthesis Configuration
// ============================================================================

// Use FREE models first (qwen3-coder-free is proven 100% pass rate)
const SYNTHESIS_MODEL = "qwen3-coder-free"; // Free OpenRouter model for synthesis
const SYNTHESIS_TIMEOUT_MS = 90_000; // 90s timeout (free models may be slower)

// ============================================================================
// Constants
// ============================================================================

const DD_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
const BRANCH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per branch
const MAX_RETRIES = 3; // Max retries for OCC errors
const RETRY_BASE_DELAY_MS = 100; // Base delay for exponential backoff

// ============================================================================
// Retry Helper for OCC Errors
// ============================================================================

/**
 * Helper to retry mutations that may fail due to OCC errors
 * Uses exponential backoff with jitter
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is an OCC error (Convex returns this message)
      const isOCCError = lastError.message.includes("OptimisticConcurrencyControl") ||
                         lastError.message.includes("OCC") ||
                         lastError.message.includes("concurrent");

      if (!isOCCError || attempt === maxRetries) {
        // Not an OCC error or final attempt - throw
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 50;
      console.log(`[DD] ${operationName}: OCC error, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// Actions - Main Orchestration
// ============================================================================

/**
 * Start a due diligence job - main entry point.
 * Now supports tiered DD with branchOverride for automatic tier selection.
 */
export const startDueDiligenceJobInternal = internalAction({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),
    triggerSource: v.union(
      v.literal("funding_detection"),
      v.literal("deals_feed"),
      v.literal("manual"),
      v.literal("scheduled_refresh"),
      v.literal("encounter")
    ),
    triggerEventId: v.optional(v.string()),
    triggerEncounterId: v.optional(v.id("encounterEvents")),
    entityId: v.optional(v.id("entityContexts")),
    userId: v.id("users"),
    // NEW: Tiered DD support
    ddTier: v.optional(v.union(
      v.literal("FULL_PLAYBOOK"),
      v.literal("STANDARD_DD"),
      v.literal("LIGHT_DD"),
      v.literal("FAST_VERIFY")
    )),
    branchOverride: v.optional(v.array(v.string())),
    // NEW: Risk scoring metadata (v3)
    riskScore: v.optional(v.number()),
    escalationTriggers: v.optional(v.array(v.string())),
    // NEW: Micro-branches for fast checks
    microBranches: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const tierLabel = args.ddTier ?? "FULL_PLAYBOOK";
    console.log(`[DD] Starting ${tierLabel} due diligence for ${args.entityName} (${args.entityType})`);
    if (args.branchOverride) {
      console.log(`[DD] Using branch override: ${args.branchOverride.join(", ")}`);
    }

    // 1. Create the persisted job from the storage contract only. Tier and
    // execution options belong to the scheduled action payload below.
    const { jobId, existing } = await ctx.runMutation(
      internal.domains.agents.dueDiligence.ddMutations.createDDJobInternal,
      {
        entityName: args.entityName,
        entityType: args.entityType,
        triggerSource: args.triggerSource,
        triggerEventId: args.triggerEventId,
        triggerEncounterId: args.triggerEncounterId,
        entityId: args.entityId,
        userId: args.userId,
      }
    );

    if (existing) {
      console.log(`[DD] Existing job found: ${jobId}`);
      return { jobId, status: "existing" };
    }

    // 2. Determine micro-branches based on tier
    const microBranchesToRun: MicroBranchType[] = args.microBranches
      ? (args.microBranches as MicroBranchType[])
      : RISK_BASED_BRANCHES[tierLabel as DDTier] ?? [];

    console.log(`[DD] Micro-branches for ${tierLabel}: ${microBranchesToRun.join(", ")}`);

    // 3. Schedule the execution action (pass branchOverride and microBranches)
    await ctx.scheduler.runAfter(
      0,
      internal.domains.agents.dueDiligence.ddOrchestrator.executeDDJob,
      {
        jobId,
        userId: args.userId,
        branchOverride: args.branchOverride,
        microBranches: microBranchesToRun,
        riskScore: args.riskScore,
        escalationTriggers: args.escalationTriggers,
      }
    );

    return {
      jobId,
      status: "started",
      tier: tierLabel,
      microBranchCount: microBranchesToRun.length,
    };
  },
});

/**
 * Execute DD job - internal action that runs the full pipeline.
 * Now supports branchOverride for tiered DD and micro-branches for fast checks.
 *
 * Pipeline:
 * 1. Analyze complexity signals
 * 2. Run micro-branches (fast, parallel pre-checks)
 * 3. Spawn full DD branches
 * 4. Execute branches in parallel
 * 5. Cross-check findings
 * 6. Synthesize memo
 */
export const executeDDJob = internalAction({
  args: {
    jobId: v.string(),
    userId: v.id("users"),
    branchOverride: v.optional(v.array(v.string())),
    microBranches: v.optional(v.array(v.string())),
    riskScore: v.optional(v.number()),
    escalationTriggers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { jobId, userId, branchOverride, microBranches, riskScore, escalationTriggers }) => {
    const startTime = Date.now();
    let ownerValidated = false;

    // Validate the scheduled owner before entering any state-changing path.
    const job = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddMutations.getDDJobInternal,
      { jobId, userId }
    );
    ownerValidated = true;

    try {
      // Phase 1: Analyze complexity signals
      console.log(`[DD] Phase 1: Analyzing complexity signals for ${jobId}`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "analyzing" }
      );

      const signals = await analyzeComplexitySignals(ctx, jobId, userId);

      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "analyzing", complexitySignals: signals }
      );

      // ─────────────────────────────────────────────────────────────────────────
      // Phase 1.5: Run micro-branches (fast parallel pre-checks)
      // These run even for FAST_VERIFY tier to catch fraud indicators early
      // ─────────────────────────────────────────────────────────────────────────
      let microBranchResults: any = null;

      if (microBranches && microBranches.length > 0) {
        console.log(`[DD] Phase 1.5: Running ${microBranches.length} micro-branches for ${jobId}`);
        console.log(`[DD] Micro-branches: ${microBranches.join(", ")}`);

        try {
          microBranchResults = await ctx.runAction(
            internal.domains.agents.dueDiligence.microBranches.runMicroBranches,
            {
              companyName: job.entityName,
              branches: microBranches,
              websiteUrl: (job as any).websiteUrl,
              founderNames: (job as any).founderNames,
              sourceUrl: (job as any).sourceUrl,
            }
          );

          console.log(`[DD] Micro-branch results for ${jobId}:`);
          console.log(`  Overall: ${microBranchResults.overallStatus}`);
          console.log(`  Pass: ${microBranchResults.passCount}, Warn: ${microBranchResults.warnCount}, Fail: ${microBranchResults.failCount}`);
          console.log(`  Time: ${microBranchResults.totalTimeMs}ms`);

          // Log escalation if micro-branches found issues
          if (microBranchResults.overallStatus === "fail") {
            console.log(`[DD] ⚠️ MICRO-BRANCH FAILURE: ${job.entityName} flagged by fast checks`);
          }
        } catch (error) {
          console.warn(`[DD] Micro-branch execution failed, continuing with full DD:`, error);
        }
      }

      // Phase 2: Determine branches and spawn them
      // Use branchOverride if provided (tiered DD), otherwise use signal-based selection
      console.log(`[DD] Phase 2: Spawning branches for ${jobId}`);
      const branchesToSpawn: BranchType[] = branchOverride
        ? (branchOverride as BranchType[])
        : determineBranches(signals);

      console.log(`[DD] Branches to spawn: ${branchesToSpawn.join(", ")} (${branchOverride ? "tier override" : "signal-based"})`);

      // Create parallel task tree for integration
      const { treeId, rootTaskId } = await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.createTaskTreeInternal,
        {
          userId: job.userId,
          agentThreadId: `dd-${jobId}`,
          query: `Due diligence on ${job.entityName}`,
        }
      );

      // Create branch tasks in parallel task tree
      const branchConfigs = branchesToSpawn.map((bt) => ({
        title: getBranchTitle(bt),
        description: getBranchDescription(bt, job.entityName),
        agentName: `DD-${bt}`,
      }));

      const taskNodeIds = await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.createBranchTasksInternal,
        { userId: job.userId, treeId, parentTaskId: rootTaskId, branches: branchConfigs }
      );

      // Create DD branch records
      const branchRecords = branchesToSpawn.map((bt, idx) => ({
        branchType: bt,
        taskTreeId: treeId,
        taskNodeId: taskNodeIds[idx],
      }));

      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.createDDBranches,
        { jobId, userId: job.userId, branches: branchRecords }
      );

      const conditionalSpawned = branchesToSpawn.filter(
        (bt) => !CORE_BRANCHES.includes(bt as any)
      );

      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        {
          jobId,
          userId: job.userId,
          status: "executing",
          parallelTreeId: treeId,
          activeBranches: branchesToSpawn,
          conditionalBranchesSpawned: conditionalSpawned,
        }
      );

      // Phase 3: Execute branches in parallel
      console.log(`[DD] Phase 3: Executing ${branchesToSpawn.length} branches for ${jobId}`);
      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "executing", phase: "Executing parallel research branches" }
      );

      // Execute each branch
      const branchResults = await Promise.all(
        branchesToSpawn.map((branchType, idx) =>
          executeBranch(ctx, jobId, branchType, taskNodeIds[idx], job.entityName, job.entityType, job.userId)
        )
      );

      // Phase 4: Cross-check findings
      console.log(`[DD] Phase 4: Cross-checking findings for ${jobId}`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "cross_checking" }
      );

      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "cross_checking", phase: "Cross-checking branch findings" }
      );

      const contradictions = await crossCheckFindings(ctx, jobId, branchResults);

      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "cross_checking", contradictions }
      );

      // Phase 5: Synthesize memo
      console.log(`[DD] Phase 5: Synthesizing memo for ${jobId}`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "synthesizing" }
      );

      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "merging", phase: "Synthesizing due diligence memo" }
      );

      const memoId = await synthesizeMemo(ctx, jobId, branchResults, contradictions, job);

      // Calculate overall confidence
      const avgConfidence = branchResults.reduce((sum, r) => sum + (r.confidence ?? 0), 0) /
        branchResults.filter(r => r.confidence !== undefined).length;

      const unresolvedContradictions = contradictions.filter(c => c.resolution === "unresolved").length;
      const confidencePenalty = unresolvedContradictions * 0.05;
      const overallConfidence = Math.max(0, avgConfidence - confidencePenalty);

      // Complete
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        {
          jobId,
          userId: job.userId,
          status: "completed",
          ddMemoId: memoId,
          overallConfidence,
        }
      );

      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "completed", phase: "Due diligence complete" }
      );

      // If triggered from encounter, update the encounter with DD completion
      if (job.triggerSource === "encounter" && job.triggerEncounterId) {
        console.log(`[DD] Updating encounter ${job.triggerEncounterId} with DD completion`);
        await ctx.runMutation(
          internal.domains.encounters.encounterMutations.internalCompleteDDEnrichment,
          {
            encounterId: job.triggerEncounterId,
            ddMemoId: memoId,
          }
        );
      }

      const elapsedMs = Date.now() - startTime;
      console.log(`[DD] Completed ${jobId} in ${elapsedMs}ms with confidence ${(overallConfidence * 100).toFixed(1)}%`);

      return { jobId, memoId, overallConfidence, elapsedMs };

    } catch (error) {
      console.error(`[DD] Failed ${jobId}:`, error);

      if (ownerValidated) {
        await ctx.runMutation(
          internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
          {
            jobId,
            userId: job.userId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      throw error;
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Analyze complexity signals to determine which conditional branches to spawn
 */
async function analyzeComplexitySignals(
  ctx: any,
  jobId: string,
  userId: Id<"users">,
): Promise<ComplexitySignals> {
  // Get job details
  const job = await ctx.runQuery(
    internal.domains.agents.dueDiligence.ddMutations.getDDJobInternal,
    { jobId, userId }
  );

  if (!job) throw new Error("Job not found");

  // Try to get existing entity context if available
  let entityData: any = null;
  if (job.entityId) {
    entityData = await ctx.runQuery(api.domains.knowledge.entityContexts.getById, {
      entityContextId: job.entityId,
    });
  }

  // Build signals from available data
  const signals: ComplexitySignals = {
    sectors: [],
  };

  if (entityData) {
    // Extract signals from existing entity data
    if (entityData.funding?.totalRaised) {
      const amount = entityData.funding.totalRaised;
      signals.fundingSize = parseFloat(amount.amount) *
        (amount.unit === "B" ? 1_000_000_000 : amount.unit === "M" ? 1_000_000 : 1_000);
    }

    if (entityData.people) {
      const peopleCount =
        (entityData.people.founders?.length ?? 0) +
        (entityData.people.executives?.length ?? 0);
      signals.teamSize = peopleCount;
    }

    if (entityData.summary) {
      const summary = entityData.summary.toLowerCase();
      signals.hasPatentMentions = summary.includes("patent") || summary.includes("ip ");
      signals.hasRegulatoryMentions =
        summary.includes("fda") ||
        summary.includes("sec ") ||
        summary.includes("regulatory") ||
        summary.includes("compliance");
      signals.hasRepoMentions =
        summary.includes("github") ||
        summary.includes("open source") ||
        summary.includes("repository");
    }

    // Detect sectors
    const sectors: string[] = [];
    const summary = (entityData.summary ?? "").toLowerCase();
    if (summary.includes("biotech") || summary.includes("pharma")) sectors.push("Biotech");
    if (summary.includes("fintech") || summary.includes("financial tech")) sectors.push("Fintech");
    if (summary.includes("ai") || summary.includes("machine learning")) sectors.push("AI/ML");
    if (summary.includes("cybersecurity") || summary.includes("security")) sectors.push("Cybersecurity");
    if (summary.includes("health") || summary.includes("medical")) sectors.push("HealthTech");
    if (summary.includes("crypto") || summary.includes("blockchain")) sectors.push("Crypto");
    signals.sectors = sectors;

    // Detect industry risk
    const highRiskSectors = ["Crypto", "Cybersecurity", "HealthTech", "Biotech"];
    signals.industryRisk = signals.sectors?.some(s => highRiskSectors.includes(s))
      ? "high"
      : signals.sectors?.length
        ? "medium"
        : "low";
  }

  return signals;
}

/**
 * Determine which branches to spawn based on complexity signals
 */
function determineBranches(signals: ComplexitySignals): BranchType[] {
  // Always include core branches
  const branches: BranchType[] = [...CORE_BRANCHES];

  // Check each conditional branch trigger
  for (const conditionalBranch of CONDITIONAL_BRANCHES) {
    const trigger = BRANCH_TRIGGERS[conditionalBranch];
    if (trigger(signals)) {
      branches.push(conditionalBranch);
    }
  }

  return branches;
}

/**
 * Execute a single branch
 */
async function executeBranch(
  ctx: any,
  jobId: string,
  branchType: BranchType,
  taskNodeId: string,
  entityName: string,
  entityType: string,
  userId: Id<"users">,
): Promise<{
  branchType: BranchType;
  findings: any;
  confidence?: number;
  sources: DDSource[];
  error?: string;
}> {
  // Get branches for this job
  const jobData = await ctx.runQuery(
    internal.domains.agents.dueDiligence.ddMutations.getDDJobDetailInternal,
    { jobId, userId }
  );

  const branch = jobData?.branches?.find((b: any) => b.branchType === branchType);
  if (!branch) throw new Error(`Branch not found: ${branchType}`);

  try {
    // Mark branch as running (with retry for OCC)
    await withRetry(
      () => ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDBranch,
        { branchId: branch.branchId, userId, status: "running" }
      ),
      `updateDDBranch-running-${branchType}`
    );

    // Update task node status (with retry for OCC - task tree is shared)
    await withRetry(
      () => ctx.runMutation(internal.domains.agents.parallelTaskTree.updateTaskStatusInternal, {
        userId,
        taskId: taskNodeId,
        status: "running",
      }),
      `updateTaskStatus-running-${branchType}`
    );

    // Execute branch-specific handler
    let findings: any;
    let sources: DDSource[] = [];
    let confidence = 0.5;

    // Dispatch to branch handler
    switch (branchType) {
      case "company_profile":
        ({ findings, sources, confidence } = await executeCompanyProfileBranch(
          ctx, entityName, entityType
        ));
        break;
      case "team_founders":
        ({ findings, sources, confidence } = await executeTeamFoundersBranch(
          ctx, entityName, entityType
        ));
        break;
      case "market_competitive":
        ({ findings, sources, confidence } = await executeMarketCompetitiveBranch(
          ctx, entityName, entityType
        ));
        break;
      case "technical_dd":
        ({ findings, sources, confidence } = await executeTechnicalDDBranch(
          ctx, entityName, entityType
        ));
        break;
      case "ip_patents":
        ({ findings, sources, confidence } = await executeIPPatentsBranch(
          ctx, entityName, entityType
        ));
        break;
      case "regulatory":
        ({ findings, sources, confidence } = await executeRegulatoryBranch(
          ctx, entityName, entityType
        ));
        break;
      case "financial_deep":
        ({ findings, sources, confidence } = await executeFinancialDeepBranch(
          ctx, entityName, entityType
        ));
        break;
      case "network_mapping":
        ({ findings, sources, confidence } = await executeNetworkMappingBranch(
          ctx, entityName, entityType
        ));
        break;
      default:
        throw new Error(`Unknown branch type: ${branchType}`);
    }

    // Update branch with findings (with retry for OCC)
    await withRetry(
      () => ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDBranch,
        {
          branchId: branch.branchId,
          userId,
          status: "completed",
          findings,
          findingsSummary: summarizeFindings(branchType, findings),
          confidence,
          sourcesUsed: sources,
        }
      ),
      `updateDDBranch-completed-${branchType}`
    );

    // Update task node (with retry for OCC)
    await withRetry(
      () => ctx.runMutation(internal.domains.agents.parallelTaskTree.updateTaskStatusInternal, {
        userId,
        taskId: taskNodeId,
        status: "completed",
        result: JSON.stringify(findings),
        resultSummary: summarizeFindings(branchType, findings),
        confidence,
      }),
      `updateTaskStatus-completed-${branchType}`
    );

    try {
      await ctx.runAction(
        internal.domains.deepTrace.integrations.syncDueDiligenceBranchToDeepTrace,
        {
          jobId,
          branchType,
          entityName,
          entityType,
          findings,
          sources,
          confidence,
        },
      );
    } catch (deepTraceError) {
      console.warn(`[DD] DeepTrace sync failed for ${branchType}:`, deepTraceError);
    }

    return { branchType, findings, confidence, sources };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Try to update branch status (with retry), but don't fail if this fails
    try {
      await withRetry(
        () => ctx.runMutation(
          internal.domains.agents.dueDiligence.ddMutations.updateDDBranch,
          {
            branchId: branch.branchId,
            userId,
            status: "failed",
            error: errorMsg,
          }
        ),
        `updateDDBranch-failed-${branchType}`
      );
    } catch (updateError) {
      console.error(`[DD] Failed to update branch status for ${branchType}:`, updateError);
    }

    // Try to update task node status (with retry), but don't fail if this fails
    try {
      await withRetry(
        () => ctx.runMutation(internal.domains.agents.parallelTaskTree.updateTaskStatusInternal, {
          userId,
          taskId: taskNodeId,
          status: "failed",
          errorMessage: errorMsg,
        }),
        `updateTaskStatus-failed-${branchType}`
      );
    } catch (updateError) {
      console.error(`[DD] Failed to update task status for ${branchType}:`, updateError);
    }

    return {
      branchType,
      findings: null,
      sources: [],
      error: errorMsg,
    };
  }
}

/**
 * Cross-check findings across branches to identify contradictions
 */
async function crossCheckFindings(
  ctx: any,
  jobId: string,
  branchResults: Array<{
    branchType: BranchType;
    findings: any;
    confidence?: number;
    sources: DDSource[];
  }>
): Promise<Contradiction[]> {
  const contradictions: Contradiction[] = [];

  // Get successful branches
  const successfulBranches = branchResults.filter(r => r.findings !== null);

  // Cross-check founding year
  const foundingYears: Array<{ source: string; value: number }> = [];
  for (const branch of successfulBranches) {
    if (branch.findings?.foundedYear) {
      foundingYears.push({
        source: branch.branchType,
        value: branch.findings.foundedYear,
      });
    }
  }
  if (foundingYears.length > 1) {
    const uniqueYears = [...new Set(foundingYears.map(f => f.value))];
    if (uniqueYears.length > 1) {
      contradictions.push({
        field: "foundedYear",
        sourceA: foundingYears[0].source,
        valueA: String(foundingYears[0].value),
        sourceB: foundingYears[1].source,
        valueB: String(foundingYears[1].value),
        resolution: "unresolved",
      });
    }
  }

  // Cross-check employee count
  const employeeCounts: Array<{ source: string; value: number }> = [];
  for (const branch of successfulBranches) {
    if (branch.findings?.employeeCount) {
      employeeCounts.push({
        source: branch.branchType,
        value: branch.findings.employeeCount,
      });
    }
  }
  if (employeeCounts.length > 1) {
    const counts = employeeCounts.map(e => e.value);
    const maxDiff = Math.max(...counts) - Math.min(...counts);
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Flag if difference is more than 20%
    if (maxDiff / avgCount > 0.2) {
      contradictions.push({
        field: "employeeCount",
        sourceA: employeeCounts[0].source,
        valueA: String(employeeCounts[0].value),
        sourceB: employeeCounts[1].source,
        valueB: String(employeeCounts[1].value),
        resolution: "both_valid", // Employee counts can vary by source date
        resolutionReason: "Employee counts may vary based on data source date",
      });
    }
  }

  // Cross-check total funding
  const fundingAmounts: Array<{ source: string; value: string }> = [];
  for (const branch of successfulBranches) {
    if (branch.findings?.totalRaised) {
      const amt = branch.findings.totalRaised;
      fundingAmounts.push({
        source: branch.branchType,
        value: typeof amt === "object" ? `${amt.amount}${amt.unit}` : String(amt),
      });
    }
  }
  if (fundingAmounts.length > 1) {
    const uniqueAmounts = [...new Set(fundingAmounts.map(f => f.value))];
    if (uniqueAmounts.length > 1) {
      contradictions.push({
        field: "totalRaised",
        sourceA: fundingAmounts[0].source,
        valueA: fundingAmounts[0].value,
        sourceB: fundingAmounts[1].source,
        valueB: fundingAmounts[1].value,
        resolution: "unresolved",
      });
    }
  }

  return contradictions;
}

/**
 * Synthesize findings into traditional DD memo
 */
async function synthesizeMemo(
  ctx: any,
  jobId: string,
  branchResults: Array<{
    branchType: BranchType;
    findings: any;
    confidence?: number;
    sources: DDSource[];
  }>,
  contradictions: Contradiction[],
  job: Doc<"dueDiligenceJobs">
): Promise<Id<"dueDiligenceMemos">> {
  const now = Date.now();

  // Get findings by branch type
  const getFindings = (branchType: BranchType) =>
    branchResults.find(r => r.branchType === branchType)?.findings;

  const companyProfile = getFindings("company_profile") ?? {};
  const teamFounders = getFindings("team_founders") ?? {};
  const marketCompetitive = getFindings("market_competitive") ?? {};
  const financialDeep = getFindings("financial_deep") ?? {};
  const technicalDD = getFindings("technical_dd");
  const ipPatents = getFindings("ip_patents");
  const regulatory = getFindings("regulatory");

  // Aggregate sources
  const allSources: DDSource[] = branchResults.flatMap(r => r.sources ?? []);

  // Calculate data completeness
  const requiredFields = [
    "description",
    "sectors",
    "founders",
    "marketSize",
    "thesisSummary",
  ];
  const presentFields = [
    companyProfile.description,
    companyProfile.sectors?.length,
    teamFounders.founders?.length,
    marketCompetitive.marketSize,
    true, // Will generate thesis
  ].filter(Boolean).length;
  const dataCompleteness = presentFields / requiredFields.length;

  // Determine source quality
  const authoritativeCount = allSources.filter(s => s.reliability === "authoritative").length;
  const totalSources = allSources.length;
  const sourceQuality = authoritativeCount > totalSources * 0.3
    ? "high"
    : authoritativeCount > 0
      ? "medium"
      : "low";

  // Calculate overall confidence
  const avgConfidence = branchResults
    .filter(r => r.confidence !== undefined)
    .reduce((sum, r) => sum + (r.confidence ?? 0), 0) /
    branchResults.filter(r => r.confidence !== undefined).length || 0.5;

  const unresolvedContradictions = contradictions.filter(c => c.resolution === "unresolved").length;
  const overallConfidence = Math.max(0, avgConfidence - unresolvedContradictions * 0.05);

  // Generate risks
  const risks = generateRisks(companyProfile, teamFounders, marketCompetitive, regulatory);

  // Generate verdict
  const verdict = generateVerdict(overallConfidence, risks, dataCompleteness);

  // Generate executive summary using LLM synthesis
  console.log(`[DD] Generating LLM-synthesized executive summary for ${job.entityName}`);
  const executiveSummary = await generateLLMExecutiveSummary(
    job.entityName,
    companyProfile,
    teamFounders,
    marketCompetitive,
    financialDeep,
    risks,
    verdict,
    dataCompleteness
  );

  // Generate investment thesis using LLM synthesis
  console.log(`[DD] Generating LLM-synthesized investment thesis for ${job.entityName}`);
  const investmentThesis = await generateLLMInvestmentThesis(
    job.entityName,
    companyProfile,
    teamFounders,
    marketCompetitive,
    risks
  );

  // Create memo
  const memoId = await ctx.runMutation(
    internal.domains.agents.dueDiligence.ddMutations.insertDDMemo,
    {
      jobId,
      userId: job.userId,
      entityName: job.entityName,
      entityType: job.entityType,
      executiveSummary,
      verdict,
      verdictRationale: `Based on ${dataCompleteness * 100}% data completeness, ${
        unresolvedContradictions
      } unresolved contradictions, and ${risks.filter(r => r.severity === "critical").length} critical risks.`,
      companyOverview: {
        description: companyProfile.description ?? `${job.entityName} - details pending`,
        hqLocation: companyProfile.hqLocation,
        foundedYear: companyProfile.foundedYear,
        employeeCount: companyProfile.employeeCount,
        employeeGrowth: companyProfile.employeeGrowth,
        sectors: companyProfile.sectors ?? [],
        stage: companyProfile.stage,
        businessModel: companyProfile.businessModel,
        keyProducts: companyProfile.keyProducts ?? [],
      },
      marketAnalysis: {
        marketSize: marketCompetitive.marketSize?.tam,
        marketGrowth: marketCompetitive.marketGrowth,
        competitors: marketCompetitive.competitors ?? [],
        differentiators: marketCompetitive.differentiators ?? [],
        whyNow: marketCompetitive.whyNow,
        tailwinds: marketCompetitive.tailwinds ?? [],
        headwinds: marketCompetitive.headwinds ?? [],
      },
      teamAnalysis: {
        founders: teamFounders.founders ?? [],
        executives: teamFounders.executives ?? [],
        boardMembers: teamFounders.boardMembers ?? [],
        advisors: teamFounders.advisors,
        trackRecordSummary: teamFounders.trackRecordSummary,
        teamStrengths: teamFounders.teamStrengths ?? [],
        teamGaps: teamFounders.teamGaps ?? [],
        founderMarketFit: teamFounders.founderMarketFit,
      },
      fundingHistory: {
        totalRaised: financialDeep.totalRaised,
        rounds: financialDeep.fundingHistory ?? [],
        valuationComps: financialDeep.valuationComps,
        burnRate: financialDeep.burnRate,
        runway: financialDeep.runway,
      },
      risks,
      investmentThesis,
      verificationSummary: {
        contradictionsFound: contradictions.length,
        contradictionsResolved: contradictions.filter(c => c.resolution !== "unresolved").length,
        overallConfidence,
        dataCompleteness,
        sourceQuality,
      },
      sources: allSources.map(s => ({
        sourceType: s.sourceType,
        url: s.url,
        title: s.title,
        reliability: s.reliability,
        section: s.section,
      })),
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
  );

  return memoId;
}

// ============================================================================
// Generation Helpers
// ============================================================================

function generateRisks(
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  regulatory: any
): Array<{
  category: string;
  description: string;
  severity: string;
  likelihood?: string;
  mitigation?: string;
}> {
  const risks: Array<{
    category: string;
    description: string;
    severity: string;
    likelihood?: string;
    mitigation?: string;
  }> = [];

  // Team risks
  if (teamFounders?.teamGaps?.length > 0) {
    risks.push({
      category: "Team",
      description: `Team gaps identified: ${teamFounders.teamGaps.join(", ")}`,
      severity: "medium",
      likelihood: "medium",
    });
  }

  if (teamFounders?.keyPersonRisk?.length > 0) {
    risks.push({
      category: "Team",
      description: `Key person risk: ${teamFounders.keyPersonRisk.join(", ")}`,
      severity: "high",
      likelihood: "medium",
    });
  }

  // Market risks
  if (marketCompetitive?.headwinds?.length > 0) {
    for (const headwind of marketCompetitive.headwinds.slice(0, 2)) {
      risks.push({
        category: "Market",
        description: headwind,
        severity: "medium",
        likelihood: "medium",
      });
    }
  }

  // Competitive risks
  const highThreatCompetitors = marketCompetitive?.competitors?.filter(
    (c: any) => c.threat === "high"
  ) ?? [];
  if (highThreatCompetitors.length > 0) {
    risks.push({
      category: "Competitive",
      description: `High-threat competitors: ${highThreatCompetitors.map((c: any) => c.name).join(", ")}`,
      severity: "high",
      likelihood: "high",
    });
  }

  // Regulatory risks
  if (regulatory?.complianceRisks?.length > 0) {
    for (const risk of regulatory.complianceRisks.slice(0, 2)) {
      risks.push({
        category: "Regulatory",
        description: risk,
        severity: "high",
        likelihood: "medium",
      });
    }
  }

  return risks;
}

function generateVerdict(
  confidence: number,
  risks: Array<{ severity: string }>,
  dataCompleteness: number
): "STRONG_BUY" | "BUY" | "HOLD" | "PASS" | "INSUFFICIENT_DATA" {
  if (dataCompleteness < 0.4) return "INSUFFICIENT_DATA";

  const criticalRisks = risks.filter(r => r.severity === "critical").length;
  const highRisks = risks.filter(r => r.severity === "high").length;

  if (criticalRisks > 0) return "PASS";
  if (highRisks >= 3) return "PASS";
  if (highRisks >= 2) return "HOLD";
  if (confidence >= 0.8 && highRisks === 0) return "STRONG_BUY";
  if (confidence >= 0.6) return "BUY";
  return "HOLD";
}

function generateExecutiveSummary(
  entityName: string,
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  verdict: string
): string {
  const sectors = companyProfile.sectors?.join(", ") || "technology";
  const teamSize = teamFounders?.teamSize || "small";
  const marketPosition = marketCompetitive?.differentiators?.[0] || "emerging player";

  return `${entityName} is a ${sectors} company with a ${teamSize}-person team. ${
    companyProfile.description || ""
  } The company's key differentiator is being a ${marketPosition}. Overall assessment: ${verdict}.`;
}

// ============================================================================
// LLM-Powered Synthesis Functions
// ============================================================================

/**
 * Generate a professional executive summary using LLM synthesis.
 * Falls back to template-based summary if LLM fails.
 */
async function generateLLMExecutiveSummary(
  entityName: string,
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  financialDeep: any,
  risks: Array<{ category: string; description: string; severity: string }>,
  verdict: string,
  dataCompleteness: number
): Promise<string> {
  try {
    const model = await getLanguageModelSafe(SYNTHESIS_MODEL);
    if (!model) {
      console.log("[DD] LLM model not available, using template summary");
      return generateExecutiveSummary(entityName, companyProfile, teamFounders, marketCompetitive, verdict);
    }

    // Build structured context for LLM
    const contextData = {
      company: {
        name: entityName,
        description: companyProfile?.description || "Unknown",
        sectors: companyProfile?.sectors || [],
        stage: companyProfile?.stage || "Unknown",
        hqLocation: companyProfile?.hqLocation || "Unknown",
        foundedYear: companyProfile?.foundedYear,
        employeeCount: companyProfile?.employeeCount,
        keyProducts: companyProfile?.keyProducts || [],
        businessModel: companyProfile?.businessModel,
      },
      team: {
        foundersCount: teamFounders?.founders?.length || 0,
        founderNames: (teamFounders?.founders || []).map((f: any) => f.name).slice(0, 3),
        executivesCount: teamFounders?.executives?.length || 0,
        hasSerialFounders: teamFounders?.hasSerialFounders || false,
        trackRecordSummary: teamFounders?.trackRecordSummary,
        teamStrengths: teamFounders?.teamStrengths || [],
        teamGaps: teamFounders?.teamGaps || [],
      },
      market: {
        marketSize: marketCompetitive?.marketSize?.tam,
        marketGrowth: marketCompetitive?.marketGrowth,
        competitorsCount: marketCompetitive?.competitors?.length || 0,
        topCompetitors: (marketCompetitive?.competitors || []).slice(0, 3).map((c: any) => c.name),
        differentiators: marketCompetitive?.differentiators || [],
        whyNow: marketCompetitive?.whyNow,
        tailwinds: marketCompetitive?.tailwinds || [],
        headwinds: marketCompetitive?.headwinds || [],
      },
      funding: {
        totalRaised: financialDeep?.totalRaised,
        roundsCount: financialDeep?.fundingHistory?.length || 0,
        latestRound: financialDeep?.fundingHistory?.[0],
      },
      risks: risks.slice(0, 5),
      verdict,
      dataCompleteness: Math.round(dataCompleteness * 100),
    };

    const prompt = `You are an investment analyst writing an executive summary for a due diligence memo.

Write a professional, concise 2-3 paragraph executive summary for ${entityName} based on these findings:

${JSON.stringify(contextData, null, 2)}

Guidelines:
- Start with a clear thesis statement about the company
- Summarize what the company does, its market position, and key differentiators
- Highlight team strengths or notable founders if data is available
- Mention market opportunity and competitive landscape
- Note key risks or concerns
- End with the investment verdict and reasoning
- Be specific with numbers and names when available
- If data is incomplete (${contextData.dataCompleteness}% complete), acknowledge uncertainty
- Write in professional investment memo style - concise, factual, analytical
- Do NOT use bullet points - write in flowing prose
- Keep to 150-250 words

Write the executive summary now:`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
      temperature: 0.3,
    });

    if (text && text.length > 50) {
      console.log(`[DD] LLM executive summary generated (${text.length} chars)`);
      return text.trim();
    }

    // Fallback if LLM returned empty/short response
    return generateExecutiveSummary(entityName, companyProfile, teamFounders, marketCompetitive, verdict);
  } catch (error) {
    console.error("[DD] LLM executive summary failed:", error);
    return generateExecutiveSummary(entityName, companyProfile, teamFounders, marketCompetitive, verdict);
  }
}

/**
 * Generate a coherent investment thesis using LLM synthesis.
 */
async function generateLLMInvestmentThesis(
  entityName: string,
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  risks: Array<{ category: string; description: string; severity: string }>
): Promise<{
  thesisSummary: string;
  keyDrivers: string[];
  keyMilestones?: Array<{ milestone: string }>;
  exitScenarios?: Array<{ scenario: string; probability: string }>;
}> {
  try {
    const model = await getLanguageModelSafe(SYNTHESIS_MODEL);
    if (!model) {
      return generateInvestmentThesis(companyProfile, teamFounders, marketCompetitive, risks);
    }

    const contextData = {
      company: entityName,
      sectors: companyProfile?.sectors || [],
      stage: companyProfile?.stage,
      businessModel: companyProfile?.businessModel,
      differentiators: marketCompetitive?.differentiators || [],
      tailwinds: marketCompetitive?.tailwinds || [],
      headwinds: marketCompetitive?.headwinds || [],
      whyNow: marketCompetitive?.whyNow,
      hasSerialFounders: teamFounders?.hasSerialFounders,
      trackRecord: teamFounders?.trackRecordSummary,
      competitors: (marketCompetitive?.competitors || []).slice(0, 5).map((c: any) => c.name),
      marketSize: marketCompetitive?.marketSize?.tam,
      risks: risks.slice(0, 3),
    };

    const prompt = `You are an investment analyst writing the investment thesis section of a due diligence memo.

Based on these findings for ${entityName}, write a compelling investment thesis:

${JSON.stringify(contextData, null, 2)}

Provide:
1. A 2-3 sentence thesis summary explaining WHY this is an attractive (or unattractive) investment
2. 3-5 key investment drivers (specific, actionable reasons to invest)
3. 3-4 key milestones to track
4. 2-3 realistic exit scenarios with probability assessment

Format your response as JSON:
{
  "thesisSummary": "Your thesis summary here...",
  "keyDrivers": ["Driver 1", "Driver 2", "Driver 3"],
  "keyMilestones": [{"milestone": "Milestone 1"}, {"milestone": "Milestone 2"}],
  "exitScenarios": [{"scenario": "Scenario 1", "probability": "High/Medium/Low"}]
}

Write in professional investment memo style. Be specific with numbers when available.`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 600,
      temperature: 0.3,
    });

    if (text) {
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.thesisSummary && parsed.keyDrivers?.length > 0) {
            console.log("[DD] LLM investment thesis generated");
            return {
              thesisSummary: parsed.thesisSummary,
              keyDrivers: parsed.keyDrivers,
              keyMilestones: parsed.keyMilestones,
              exitScenarios: parsed.exitScenarios,
            };
          }
        }
      } catch (parseError) {
        console.error("[DD] Failed to parse LLM thesis JSON:", parseError);
      }
    }

    return generateInvestmentThesis(companyProfile, teamFounders, marketCompetitive, risks);
  } catch (error) {
    console.error("[DD] LLM investment thesis failed:", error);
    return generateInvestmentThesis(companyProfile, teamFounders, marketCompetitive, risks);
  }
}

function generateInvestmentThesis(
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  risks: Array<{ category: string; description: string }>
): {
  thesisSummary: string;
  keyDrivers: string[];
  keyMilestones?: Array<{ milestone: string }>;
  exitScenarios?: Array<{ scenario: string; probability: string }>;
} {
  const keyDrivers: string[] = [];

  if (marketCompetitive?.tailwinds?.length > 0) {
    keyDrivers.push(`Market tailwinds: ${marketCompetitive.tailwinds[0]}`);
  }

  if (marketCompetitive?.differentiators?.length > 0) {
    keyDrivers.push(`Differentiation: ${marketCompetitive.differentiators[0]}`);
  }

  if (teamFounders?.hasSerialFounders) {
    keyDrivers.push("Serial founder(s) with proven track record");
  }

  const thesisSummary = keyDrivers.length > 0
    ? `Investment thesis based on: ${keyDrivers.slice(0, 2).join("; ")}`
    : "Investment thesis requires further validation of key drivers.";

  return {
    thesisSummary,
    keyDrivers,
    exitScenarios: [
      { scenario: "Strategic acquisition", probability: "Medium" },
      { scenario: "IPO", probability: "Low" },
    ],
  };
}

function summarizeFindings(branchType: BranchType, findings: any): string {
  if (!findings) return `${branchType}: No findings`;

  switch (branchType) {
    case "company_profile":
      return `Company: ${findings.description?.slice(0, 100) ?? "N/A"}`;
    case "team_founders":
      return `Team: ${findings.founders?.length ?? 0} founders, ${findings.executives?.length ?? 0} execs`;
    case "market_competitive":
      return `Market: ${findings.competitors?.length ?? 0} competitors, ${findings.differentiators?.length ?? 0} differentiators`;
    case "technical_dd":
      return `Tech: ${findings.techStack?.join(", ") ?? "N/A"}`;
    case "ip_patents":
      return `IP: ${findings.patents?.length ?? 0} patents`;
    case "regulatory":
      return `Regulatory: ${findings.approvals?.length ?? 0} approvals, ${findings.complianceRisks?.length ?? 0} risks`;
    case "financial_deep":
      return `Funding: ${findings.fundingHistory?.length ?? 0} rounds`;
    case "network_mapping":
      return `Network: ${findings.keyConnections?.length ?? 0} key connections`;
    default:
      return `${branchType}: completed`;
  }
}

function getBranchTitle(branchType: BranchType): string {
  const titles: Record<BranchType, string> = {
    company_profile: "Company Profile Research",
    team_founders: "Team & Founders Deep Dive",
    market_competitive: "Market & Competitive Analysis",
    technical_dd: "Technical Due Diligence",
    ip_patents: "IP & Patent Research",
    regulatory: "Regulatory & Compliance",
    financial_deep: "Deep Financial Analysis",
    network_mapping: "Network & Relationship Mapping",
  };
  return titles[branchType] ?? branchType;
}

function getBranchDescription(branchType: BranchType, entityName: string): string {
  const descriptions: Record<BranchType, string> = {
    company_profile: `Research basic company information, products, and milestones for ${entityName}`,
    team_founders: `Deep dive into founders, executives, board members, and their track records for ${entityName}`,
    market_competitive: `Analyze market size, competitors, differentiators, and market timing for ${entityName}`,
    technical_dd: `Evaluate technology stack, architecture, and technical risks for ${entityName}`,
    ip_patents: `Research patent portfolio, IP defensibility, and trademark status for ${entityName}`,
    regulatory: `Analyze regulatory status, compliance, and approval timelines for ${entityName}`,
    financial_deep: `Deep analysis of funding history, valuation, burn rate, and runway for ${entityName}`,
    network_mapping: `Map relationships, investor networks, and reference paths for ${entityName}`,
  };
  return descriptions[branchType] ?? `Research ${branchType} for ${entityName}`;
}
