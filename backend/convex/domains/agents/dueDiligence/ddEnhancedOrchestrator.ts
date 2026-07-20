/**
 * ddEnhancedOrchestrator.ts
 *
 * Enhanced DD Orchestrator - Full Industry Best Practices Implementation
 *
 * Wraps the base orchestrator with:
 * 1. Context Engineering (Manus pattern)
 * 2. Branch Handoffs (OpenAI pattern)
 * 3. Guardrails (OpenAI pattern)
 * 4. Entity Memory (mem0/Google ADK pattern)
 * 5. Error Preservation (Manus pattern)
 * 6. Goal Recitation (Manus pattern)
 *
 * This module can be used as an alternative entry point for DD jobs
 * that require full industry-standard agent capabilities.
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
} from "./types";

// Context Engineering imports
import {
  DDScratchpad,
  BranchFindingSummary,
  FailedApproach,
  generateGoalRecitation,
  summarizeBranchFindings,
  createFailedApproach,
  generateErrorContext,
  BRANCH_ALLOWED_TOOLS,
  isToolAllowed,
  extractVerifiedFacts,
  buildDDBranchSystemPrompt,
  validateDDInput,
  validateDDOutput,
  checkRateLimit,
  RateLimitState,
  RATE_LIMITS,
} from "./ddContextEngine";

// Branch Handoff imports
import {
  BranchHandoff,
  HandoffQueue,
  detectHandoffs,
  processHandoffQueue,
  buildSignalsFromHandoff,
  formatHandoffContextForPrompt,
} from "./ddBranchHandoff";

// Branch handlers
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

// LLM tools
import { generateText } from "ai";
import { getLanguageModelSafe, DEFAULT_MODEL } from "../mcp_tools/models/modelResolver";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SYNTHESIS_MODEL = "qwen3-coder-free";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 100;
const MAX_HANDOFF_BRANCHES = 2; // Max additional branches from handoffs
const ENABLE_HANDOFFS = true;
const ENABLE_ENTITY_MEMORY = true;
const ENABLE_GUARDRAILS = true;

// ============================================================================
// RETRY HELPER
// ============================================================================

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

      const isOCCError =
        lastError.message.includes("OptimisticConcurrencyControl") ||
        lastError.message.includes("OCC") ||
        lastError.message.includes("concurrent");

      if (!isOCCError || attempt === maxRetries) {
        throw lastError;
      }

      const delay =
        RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 50;
      console.log(
        `[DD-Enhanced] ${operationName}: OCC error, retrying in ${Math.round(delay)}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// ENHANCED START JOB
// ============================================================================

/**
 * Start an enhanced due diligence job with full industry patterns
 */
export const startEnhancedDDJobInternal = internalAction({
  args: {
    entityName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("fund"),
      v.literal("person")
    ),
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
    // Enhanced options
    enableHandoffs: v.optional(v.boolean()),
    enableEntityMemory: v.optional(v.boolean()),
    enableGuardrails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    console.log(
      `[DD-Enhanced] Starting enhanced due diligence for ${args.entityName}`
    );

    // 1. Input Guardrails
    if (args.enableGuardrails !== false && ENABLE_GUARDRAILS) {
      const inputValidation = validateDDInput(args.entityName, args.entityType);
      if (!inputValidation.passed) {
        console.error(
          `[DD-Enhanced] Input validation failed:`,
          inputValidation.issues
        );
        return {
          jobId: null,
          status: "rejected",
          reason: inputValidation.issues.join("; "),
        };
      }
      if (inputValidation.warnings.length > 0) {
        console.warn(
          `[DD-Enhanced] Input warnings:`,
          inputValidation.warnings
        );
      }
    }

    // 2. Check Entity Memory for existing research
    let entityMemory: any = null;
    if (args.enableEntityMemory !== false && ENABLE_ENTITY_MEMORY) {
      entityMemory = await ctx.runQuery(
        internal.domains.agents.dueDiligence.ddContextEngine.getEntityMemory,
        { entityName: args.entityName }
      );

      if (entityMemory) {
        const lastJob = entityMemory.previousJobs[0];
        const daysSinceLastJob = lastJob
          ? (Date.now() - lastJob.completedAt) / (1000 * 60 * 60 * 24)
          : Infinity;

        console.log(
          `[DD-Enhanced] Found entity memory: ${entityMemory.verifiedFacts.length} facts, ` +
            `last job ${daysSinceLastJob.toFixed(1)} days ago`
        );

        // If recent job exists and not force refresh, return existing
        if (daysSinceLastJob < 7 && args.triggerSource !== "manual") {
          console.log(`[DD-Enhanced] Recent DD exists, skipping`);
          return {
            jobId: lastJob.jobId,
            status: "existing_recent",
            daysSinceLastJob: daysSinceLastJob,
          };
        }
      }
    }

    // 3. Create the job
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
      console.log(`[DD-Enhanced] Existing job found: ${jobId}`);
      return { jobId, status: "existing" };
    }

    // 4. Schedule enhanced execution
    await ctx.scheduler.runAfter(
      0,
      internal.domains.agents.dueDiligence.ddEnhancedOrchestrator.executeEnhancedDDJob,
      {
        jobId,
        userId: args.userId,
        enableHandoffs: args.enableHandoffs ?? ENABLE_HANDOFFS,
        enableEntityMemory: args.enableEntityMemory ?? ENABLE_ENTITY_MEMORY,
        enableGuardrails: args.enableGuardrails ?? ENABLE_GUARDRAILS,
        existingFacts: entityMemory?.verifiedFacts ?? [],
      }
    );

    return { jobId, status: "started", enhanced: true };
  },
});

// ============================================================================
// ENHANCED EXECUTION
// ============================================================================

export const executeEnhancedDDJob = internalAction({
  args: {
    jobId: v.string(),
    userId: v.id("users"),
    enableHandoffs: v.boolean(),
    enableEntityMemory: v.boolean(),
    enableGuardrails: v.boolean(),
    existingFacts: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const { jobId, userId, enableHandoffs, enableEntityMemory, enableGuardrails } =
      args;
    const startTime = Date.now();
    let ownerValidated = false;

    // Validate the scheduled owner before entering any state-changing path.
    const job = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddMutations.getDDJobInternal,
      { jobId, userId }
    );
    ownerValidated = true;

    try {
      // Phase 1: Initialize Context Engineering
      console.log(`[DD-Enhanced] Phase 1: Initializing context for ${jobId}`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "analyzing" }
      );

      // Analyze complexity signals
      const signals = await analyzeComplexitySignals(ctx, jobId, userId);

      // Determine initial branches
      let branchesToSpawn = determineBranches(signals);

      // Initialize scratchpad with context engineering
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddContextEngine.createDDScratchpad,
        {
          jobId,
          entityName: job.entityName,
          entityType: job.entityType,
          branches: branchesToSpawn,
        }
      );

      // Initialize handoff queue if enabled
      if (enableHandoffs) {
        await ctx.runMutation(
          internal.domains.agents.dueDiligence.ddBranchHandoff.createHandoffQueue,
          { jobId }
        );
      }

      console.log(
        `[DD-Enhanced] Initial branches: ${branchesToSpawn.join(", ")}`
      );

      // Update job status
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        {
          jobId,
          userId: job.userId,
          status: "analyzing",
          complexitySignals: signals,
        }
      );

      // Phase 2: Create parallel task tree
      console.log(`[DD-Enhanced] Phase 2: Creating task tree for ${jobId}`);
      const { treeId, rootTaskId } = await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.createTaskTreeInternal,
        {
          userId: job.userId,
          agentThreadId: `dd-enhanced-${jobId}`,
          query: `Enhanced due diligence on ${job.entityName}`,
        }
      );

      // Create branch tasks
      const branchConfigs = branchesToSpawn.map((bt) => ({
        title: getBranchTitle(bt),
        description: getBranchDescription(bt, job.entityName),
        agentName: `DD-Enhanced-${bt}`,
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

      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        {
          jobId,
          userId: job.userId,
          status: "executing",
          parallelTreeId: treeId,
          activeBranches: branchesToSpawn,
        }
      );

      // Phase 3: Execute branches with enhanced context
      console.log(
        `[DD-Enhanced] Phase 3: Executing ${branchesToSpawn.length} branches`
      );
      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        {
          userId: job.userId,
          treeId,
          status: "executing",
          phase: "Executing parallel research branches with context engineering",
        }
      );

      // Execute branches in parallel with context
      const branchResults = await Promise.all(
        branchesToSpawn.map((branchType, idx) =>
          executeEnhancedBranch(
            ctx,
            jobId,
            branchType,
            taskNodeIds[idx],
            job.entityName,
            job.entityType,
            enableGuardrails,
            job.userId,
          )
        )
      );

      // Phase 3.5: Process handoffs if enabled
      let handoffBranchResults: typeof branchResults = [];
      if (enableHandoffs) {
        console.log(`[DD-Enhanced] Phase 3.5: Processing handoffs`);

        // Detect handoffs from completed branches
        for (const result of branchResults) {
          if (result.findings) {
            const handoffs = detectHandoffs(
              result.branchType,
              result.findings,
              branchesToSpawn
            );

            if (handoffs.length > 0) {
              console.log(
                `[DD-Enhanced] Detected ${handoffs.length} handoffs from ${result.branchType}`
              );
              await ctx.runMutation(
                internal.domains.agents.dueDiligence.ddBranchHandoff.addHandoffsToQueue,
                { jobId, handoffs }
              );
            }
          }
        }

        // Process handoff queue
        const { toSpawn } = await ctx.runMutation(
          internal.domains.agents.dueDiligence.ddBranchHandoff.processHandoffs,
          {
            jobId,
            maxAdditionalBranches: MAX_HANDOFF_BRANCHES,
            currentBranchCount: branchesToSpawn.length,
          }
        );

        if (toSpawn.length > 0) {
          console.log(
            `[DD-Enhanced] Spawning ${toSpawn.length} handoff branches: ` +
              toSpawn.map((h: BranchHandoff) => h.to).join(", ")
          );

          // Create tasks for handoff branches
          const handoffConfigs = toSpawn.map((h: BranchHandoff) => ({
            title: `${getBranchTitle(h.to)} (Handoff)`,
            description: `${getBranchDescription(h.to, job.entityName)} - Triggered by ${h.from}`,
            agentName: `DD-Handoff-${h.to}`,
          }));

          const handoffTaskIds = await ctx.runMutation(
            internal.domains.agents.parallelTaskTree.createBranchTasksInternal,
            { userId: job.userId, treeId, parentTaskId: rootTaskId, branches: handoffConfigs }
          );

          // Create branch records for handoffs
          const handoffBranchRecords = toSpawn.map((h: BranchHandoff, idx: number) => ({
            branchType: h.to,
            taskTreeId: treeId,
            taskNodeId: handoffTaskIds[idx],
          }));

          await ctx.runMutation(
            internal.domains.agents.dueDiligence.ddMutations.createDDBranches,
            { jobId, userId: job.userId, branches: handoffBranchRecords }
          );

          // Execute handoff branches
          handoffBranchResults = await Promise.all(
            toSpawn.map((handoff: BranchHandoff, idx: number) =>
              executeEnhancedBranch(
                ctx,
                jobId,
                handoff.to,
                handoffTaskIds[idx],
                job.entityName,
                job.entityType,
                enableGuardrails,
                job.userId,
                handoff // Pass handoff context
              )
            )
          );

          // Mark handoffs completed
          for (const handoff of toSpawn as BranchHandoff[]) {
            await ctx.runMutation(
              internal.domains.agents.dueDiligence.ddBranchHandoff.markHandoffCompleted,
              { jobId, handoffId: handoff.id }
            );
          }
        }
      }

      // Combine all results
      const allBranchResults = [...branchResults, ...handoffBranchResults];

      // Phase 4: Cross-check findings
      console.log(`[DD-Enhanced] Phase 4: Cross-checking findings`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "cross_checking" }
      );

      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "cross_checking", phase: "Cross-checking findings" }
      );

      const contradictions = await crossCheckFindings(
        ctx,
        jobId,
        allBranchResults
      );

      // Update scratchpad with contradictions
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddContextEngine.updateDDScratchpad,
        {
          jobId,
          updates: { contradictions, phase: "cross_checking" },
        }
      );

      // Phase 5: Synthesize memo
      console.log(`[DD-Enhanced] Phase 5: Synthesizing memo`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddMutations.updateDDJobStatus,
        { jobId, userId: job.userId, status: "synthesizing" }
      );

      await ctx.runMutation(
        internal.domains.agents.parallelTaskTree.internalUpdateTreeStatus,
        { userId: job.userId, treeId, status: "merging", phase: "Synthesizing investment memo" }
      );

      const memoId = await synthesizeMemo(
        ctx,
        jobId,
        allBranchResults,
        contradictions,
        job
      );

      // Calculate confidence
      const avgConfidence =
        allBranchResults.reduce((sum, r) => sum + (r.confidence ?? 0), 0) /
        allBranchResults.filter((r) => r.confidence !== undefined).length;

      const unresolvedContradictions = contradictions.filter(
        (c) => c.resolution === "unresolved"
      ).length;
      const overallConfidence = Math.max(
        0,
        avgConfidence - unresolvedContradictions * 0.05
      );

      // Phase 6: Update Entity Memory if enabled
      if (enableEntityMemory) {
        console.log(`[DD-Enhanced] Phase 6: Updating entity memory`);

        const verifiedFacts = extractVerifiedFacts(jobId, allBranchResults);
        const keyFindings = allBranchResults
          .filter((r) => r.findings)
          .map(
            (r) =>
              `${r.branchType}: ${summarizeBranchFindings(r.branchType, r.findings, r.sources, r.confidence ?? 0).summaryText}`
          )
          .slice(0, 10);

        // Extract unresolved questions from contradictions
        const unresolvedQuestions = contradictions
          .filter((c) => c.resolution === "unresolved")
          .map(
            (c) =>
              `Conflicting data for ${c.field}: ${c.valueA} vs ${c.valueB}`
          );

        await ctx.runMutation(
          internal.domains.agents.dueDiligence.ddContextEngine.updateEntityMemory,
          {
            entityName: job.entityName,
            entityType: job.entityType,
            jobId,
            verdict: determineVerdict(overallConfidence, [], 0.7),
            overallConfidence,
            keyFindings,
            verifiedFacts,
            unresolvedQuestions,
          }
        );
      }

      // Complete job
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
        { userId: job.userId, treeId, status: "completed", phase: "Enhanced due diligence complete" }
      );

      // Update encounter if triggered from one
      if (job.triggerSource === "encounter" && job.triggerEncounterId) {
        console.log(
          `[DD-Enhanced] Updating encounter ${job.triggerEncounterId}`
        );
        await ctx.runMutation(
          internal.domains.encounters.encounterMutations.internalCompleteDDEnrichment,
          {
            encounterId: job.triggerEncounterId,
            ddMemoId: memoId,
          }
        );
      }

      const elapsedMs = Date.now() - startTime;
      console.log(
        `[DD-Enhanced] Completed ${jobId} in ${elapsedMs}ms with confidence ${(overallConfidence * 100).toFixed(1)}%`
      );

      return {
        jobId,
        memoId,
        overallConfidence,
        elapsedMs,
        branchCount: allBranchResults.length,
        handoffCount: handoffBranchResults.length,
        enhanced: true,
      };
    } catch (error) {
      console.error(`[DD-Enhanced] Failed ${jobId}:`, error);

      if (ownerValidated) {
        // Record error in scratchpad for learning only after exact ownership is known.
        await ctx.runMutation(
          internal.domains.agents.dueDiligence.ddContextEngine.recordFailedApproach,
          {
            jobId,
            branchType: "company_profile", // Generic
            attemptNumber: 1,
            approach: "Full DD job execution",
            error: error instanceof Error ? error.message : String(error),
          }
        );

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
// ENHANCED BRANCH EXECUTION
// ============================================================================

async function executeEnhancedBranch(
  ctx: any,
  jobId: string,
  branchType: BranchType,
  taskNodeId: string,
  entityName: string,
  entityType: string,
  enableGuardrails: boolean,
  userId: Id<"users">,
  handoff?: BranchHandoff
): Promise<{
  branchType: BranchType;
  findings: any;
  confidence?: number;
  sources: DDSource[];
  error?: string;
}> {
  // Get job branches
  const jobData = await ctx.runQuery(
    internal.domains.agents.dueDiligence.ddMutations.getDDJobDetailInternal,
    { jobId, userId }
  );

  const branch = jobData?.branches?.find(
    (b: any) => b.branchType === branchType
  );
  if (!branch) throw new Error(`Branch not found: ${branchType}`);

  // Initialize rate limit state for this branch
  const rateLimitState: RateLimitState = {
    toolCalls: 0,
    tokensUsed: 0,
    apiCalls: 0,
    lastReset: Date.now(),
  };

  try {
    // Get scratchpad for context
    const scratchpad = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddContextEngine.getDDScratchpad,
      { jobId }
    );

    // Update branch to running
    await withRetry(
      () =>
        ctx.runMutation(
          internal.domains.agents.dueDiligence.ddMutations.updateDDBranch,
          { branchId: branch.branchId, userId, status: "running" }
        ),
      `updateDDBranch-running-${branchType}`
    );

    await withRetry(
      () =>
        ctx.runMutation(internal.domains.agents.parallelTaskTree.updateTaskStatusInternal, {
          userId,
          taskId: taskNodeId,
          status: "running",
        }),
      `updateTaskStatus-running-${branchType}`
    );

    // Update scratchpad
    if (scratchpad) {
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddContextEngine.updateDDScratchpad,
        {
          jobId,
          updates: {
            currentBranch: branchType,
            [`branchProgress.${branchType}`]: {
              branchType,
              status: "running",
              startedAt: Date.now(),
              attemptCount: 1,
              toolCallCount: 0,
              tokenUsage: 0,
            },
          },
        }
      );
    }

    // Generate goal recitation if scratchpad available
    let goalRecitation = "";
    if (scratchpad) {
      goalRecitation = generateGoalRecitation(scratchpad, branchType);
    }

    // Generate handoff context if this is a handoff branch
    let handoffContext = "";
    if (handoff) {
      handoffContext = formatHandoffContextForPrompt(handoff);
    }

    // Execute branch handler
    let findings: any;
    let sources: DDSource[] = [];
    let confidence = 0.5;

    // Dispatch to branch handler
    switch (branchType) {
      case "company_profile":
        ({ findings, sources, confidence } = await executeCompanyProfileBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "team_founders":
        ({ findings, sources, confidence } = await executeTeamFoundersBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "market_competitive":
        ({ findings, sources, confidence } =
          await executeMarketCompetitiveBranch(ctx, entityName, entityType));
        break;
      case "technical_dd":
        ({ findings, sources, confidence } = await executeTechnicalDDBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "ip_patents":
        ({ findings, sources, confidence } = await executeIPPatentsBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "regulatory":
        ({ findings, sources, confidence } = await executeRegulatoryBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "financial_deep":
        ({ findings, sources, confidence } = await executeFinancialDeepBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      case "network_mapping":
        ({ findings, sources, confidence } = await executeNetworkMappingBranch(
          ctx,
          entityName,
          entityType
        ));
        break;
      default:
        throw new Error(`Unknown branch type: ${branchType}`);
    }

    // Output guardrails
    if (enableGuardrails) {
      const outputValidation = validateDDOutput(findings, sources, branchType);
      if (!outputValidation.passed) {
        console.warn(
          `[DD-Enhanced] Output validation warnings for ${branchType}:`,
          outputValidation.issues
        );
        // Reduce confidence for validation issues
        confidence = Math.max(0.2, confidence - 0.1 * outputValidation.issues.length);
      }
    }

    // Record summary in scratchpad
    await ctx.runMutation(
      internal.domains.agents.dueDiligence.ddContextEngine.recordBranchSummary,
      {
        jobId,
        branchType,
        findings,
        sources,
        confidence,
      }
    );

    // Update branch with findings
    const findingsSummary = summarizeBranchFindings(
      branchType,
      findings,
      sources,
      confidence
    );

    await withRetry(
      () =>
        ctx.runMutation(
          internal.domains.agents.dueDiligence.ddMutations.updateDDBranch,
          {
            branchId: branch.branchId,
            userId,
            status: "completed",
            findings,
            findingsSummary: findingsSummary.summaryText,
            confidence,
            sourcesUsed: sources,
          }
        ),
      `updateDDBranch-completed-${branchType}`
    );

    await withRetry(
      () =>
        ctx.runMutation(internal.domains.agents.parallelTaskTree.updateTaskStatusInternal, {
          userId,
          taskId: taskNodeId,
          status: "completed",
          result: JSON.stringify(findings),
          resultSummary: findingsSummary.summaryText,
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
      console.warn(`[DD-Enhanced] DeepTrace sync failed for ${branchType}:`, deepTraceError);
    }

    return { branchType, findings, confidence, sources };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Record failed approach for learning (Manus pattern)
    const scratchpad = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddContextEngine.getDDScratchpad,
      { jobId }
    );

    const attemptCount =
      (scratchpad?.branchProgress?.[branchType]?.attemptCount || 0) + 1;

    await ctx.runMutation(
      internal.domains.agents.dueDiligence.ddContextEngine.recordFailedApproach,
      {
        jobId,
        branchType,
        attemptNumber: attemptCount,
        approach: `Execute ${branchType} branch`,
        error: errorMsg,
      }
    );

    // Update branch status
    try {
      await withRetry(
        () =>
          ctx.runMutation(
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
      console.error(
        `[DD-Enhanced] Failed to update branch status for ${branchType}:`,
        updateError
      );
    }

    try {
      await withRetry(
        () =>
          ctx.runMutation(
            internal.domains.agents.parallelTaskTree.updateTaskStatusInternal,
            {
              userId,
              taskId: taskNodeId,
              status: "failed",
              errorMessage: errorMsg,
            }
          ),
        `updateTaskStatus-failed-${branchType}`
      );
    } catch (updateError) {
      console.error(
        `[DD-Enhanced] Failed to update task status for ${branchType}:`,
        updateError
      );
    }

    return {
      branchType,
      findings: null,
      sources: [],
      error: errorMsg,
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function analyzeComplexitySignals(
  ctx: any,
  jobId: string,
  userId: Id<"users">,
): Promise<ComplexitySignals> {
  const job = await ctx.runQuery(
    internal.domains.agents.dueDiligence.ddMutations.getDDJobInternal,
    { jobId, userId }
  );

  if (!job) throw new Error("Job not found");

  let entityData: any = null;
  if (job.entityId) {
    entityData = await ctx.runQuery(
      api.domains.knowledge.entityContexts.getById,
      { entityContextId: job.entityId }
    );
  }

  const signals: ComplexitySignals = { sectors: [] };

  if (entityData) {
    if (entityData.funding?.totalRaised) {
      const amount = entityData.funding.totalRaised;
      signals.fundingSize =
        parseFloat(amount.amount) *
        (amount.unit === "B"
          ? 1_000_000_000
          : amount.unit === "M"
            ? 1_000_000
            : 1_000);
    }

    if (entityData.people) {
      signals.teamSize =
        (entityData.people.founders?.length ?? 0) +
        (entityData.people.executives?.length ?? 0);
    }

    if (entityData.summary) {
      const summary = entityData.summary.toLowerCase();
      signals.hasPatentMentions =
        summary.includes("patent") || summary.includes("ip ");
      signals.hasRegulatoryMentions =
        summary.includes("fda") ||
        summary.includes("sec ") ||
        summary.includes("regulatory");
      signals.hasRepoMentions =
        summary.includes("github") || summary.includes("open source");
    }

    const sectors: string[] = [];
    const summary = (entityData.summary ?? "").toLowerCase();
    if (summary.includes("biotech") || summary.includes("pharma"))
      sectors.push("Biotech");
    if (summary.includes("fintech")) sectors.push("Fintech");
    if (summary.includes("ai") || summary.includes("machine learning"))
      sectors.push("AI/ML");
    if (summary.includes("cybersecurity")) sectors.push("Cybersecurity");
    if (summary.includes("health")) sectors.push("HealthTech");
    if (summary.includes("crypto")) sectors.push("Crypto");
    signals.sectors = sectors;

    const highRiskSectors = ["Crypto", "Cybersecurity", "HealthTech", "Biotech"];
    signals.industryRisk = signals.sectors?.some((s) =>
      highRiskSectors.includes(s)
    )
      ? "high"
      : signals.sectors?.length
        ? "medium"
        : "low";
  }

  return signals;
}

function determineBranches(signals: ComplexitySignals): BranchType[] {
  const branches: BranchType[] = [...CORE_BRANCHES];

  for (const conditionalBranch of CONDITIONAL_BRANCHES) {
    const trigger = BRANCH_TRIGGERS[conditionalBranch];
    if (trigger(signals)) {
      branches.push(conditionalBranch);
    }
  }

  return branches;
}

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
  const successfulBranches = branchResults.filter((r) => r.findings !== null);

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
    const uniqueYears = [...new Set(foundingYears.map((f) => f.value))];
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
    const counts = employeeCounts.map((e) => e.value);
    const maxDiff = Math.max(...counts) - Math.min(...counts);
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (maxDiff / avgCount > 0.2) {
      contradictions.push({
        field: "employeeCount",
        sourceA: employeeCounts[0].source,
        valueA: String(employeeCounts[0].value),
        sourceB: employeeCounts[1].source,
        valueB: String(employeeCounts[1].value),
        resolution: "both_valid",
        resolutionReason: "Employee counts may vary by source date",
      });
    }
  }

  return contradictions;
}

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

  const getFindings = (branchType: BranchType) =>
    branchResults.find((r) => r.branchType === branchType)?.findings;

  const companyProfile = getFindings("company_profile") ?? {};
  const teamFounders = getFindings("team_founders") ?? {};
  const marketCompetitive = getFindings("market_competitive") ?? {};
  const financialDeep = getFindings("financial_deep") ?? {};

  const allSources: DDSource[] = branchResults.flatMap((r) => r.sources ?? []);

  // Calculate metrics
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
    true,
  ].filter(Boolean).length;
  const dataCompleteness = presentFields / requiredFields.length;

  const authoritativeCount = allSources.filter(
    (s) => s.reliability === "authoritative"
  ).length;
  const sourceQuality =
    authoritativeCount > allSources.length * 0.3
      ? "high"
      : authoritativeCount > 0
        ? "medium"
        : "low";

  const avgConfidence =
    branchResults
      .filter((r) => r.confidence !== undefined)
      .reduce((sum, r) => sum + (r.confidence ?? 0), 0) /
      branchResults.filter((r) => r.confidence !== undefined).length || 0.5;

  const unresolvedContradictions = contradictions.filter(
    (c) => c.resolution === "unresolved"
  ).length;
  const overallConfidence = Math.max(
    0,
    avgConfidence - unresolvedContradictions * 0.05
  );

  // Generate verdict
  const risks = generateRisks(companyProfile, teamFounders, marketCompetitive);
  const verdict = determineVerdict(overallConfidence, risks, dataCompleteness);

  // Generate summaries using LLM
  const executiveSummary = await generateExecutiveSummary(
    job.entityName,
    companyProfile,
    teamFounders,
    marketCompetitive,
    verdict
  );

  const investmentThesis = await generateInvestmentThesis(
    job.entityName,
    companyProfile,
    teamFounders,
    marketCompetitive
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
      verdictRationale: `Based on ${(dataCompleteness * 100).toFixed(0)}% data completeness, ${unresolvedContradictions} unresolved contradictions.`,
      companyOverview: {
        description: companyProfile.description ?? `${job.entityName} - pending`,
        hqLocation: companyProfile.hqLocation,
        foundedYear: companyProfile.foundedYear,
        employeeCount: companyProfile.employeeCount,
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
        trackRecordSummary: teamFounders.trackRecordSummary,
        teamStrengths: teamFounders.teamStrengths ?? [],
        teamGaps: teamFounders.teamGaps ?? [],
      },
      fundingHistory: {
        totalRaised: financialDeep.totalRaised,
        rounds: financialDeep.fundingHistory ?? [],
        burnRate: financialDeep.burnRate,
        runway: financialDeep.runway,
      },
      risks,
      investmentThesis,
      verificationSummary: {
        contradictionsFound: contradictions.length,
        contradictionsResolved: contradictions.filter(
          (c) => c.resolution !== "unresolved"
        ).length,
        overallConfidence,
        dataCompleteness,
        sourceQuality,
      },
      sources: allSources.map((s) => ({
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

function generateRisks(
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any
): Array<{
  category: string;
  description: string;
  severity: string;
  likelihood?: string;
}> {
  const risks: Array<{
    category: string;
    description: string;
    severity: string;
    likelihood?: string;
  }> = [];

  if (teamFounders?.teamGaps?.length > 0) {
    risks.push({
      category: "Team",
      description: `Team gaps: ${teamFounders.teamGaps.join(", ")}`,
      severity: "medium",
      likelihood: "medium",
    });
  }

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

  return risks;
}

function determineVerdict(
  confidence: number,
  risks: Array<{ severity: string }>,
  dataCompleteness: number
): "STRONG_BUY" | "BUY" | "HOLD" | "PASS" | "INSUFFICIENT_DATA" {
  if (dataCompleteness < 0.4) return "INSUFFICIENT_DATA";

  const criticalRisks = risks.filter((r) => r.severity === "critical").length;
  const highRisks = risks.filter((r) => r.severity === "high").length;

  if (criticalRisks > 0) return "PASS";
  if (highRisks >= 3) return "PASS";
  if (highRisks >= 2) return "HOLD";
  if (confidence >= 0.8 && highRisks === 0) return "STRONG_BUY";
  if (confidence >= 0.6) return "BUY";
  return "HOLD";
}

/**
 * Generate LLM-powered executive summary using FREE-FIRST model strategy
 * Falls back to template if LLM unavailable
 */
async function generateExecutiveSummary(
  entityName: string,
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any,
  verdict: string
): Promise<string> {
  // Template fallback
  const templateSummary = () => {
    const sectors = companyProfile.sectors?.join(", ") || "technology";
    const teamSize = teamFounders?.teamSize || "small";
    const marketPosition =
      marketCompetitive?.differentiators?.[0] || "emerging player";
    return `${entityName} is a ${sectors} company with a ${teamSize}-person team. ${
      companyProfile.description || ""
    } The company's key differentiator is being a ${marketPosition}. Overall assessment: ${verdict}.`;
  };

  try {
    // FREE-FIRST: Use qwen3-coder-free (proven 100% pass rate)
    const model = await getLanguageModelSafe(SYNTHESIS_MODEL);
    if (!model) {
      console.log("[DD-Enhanced] LLM unavailable, using template summary");
      return templateSummary();
    }

    const contextData = {
      company: entityName,
      description: companyProfile?.description || "Unknown",
      sectors: companyProfile?.sectors || [],
      stage: companyProfile?.stage || "Unknown",
      teamSize: teamFounders?.teamSize || 0,
      founders: (teamFounders?.founders || []).slice(0, 3).map((f: any) => f.name),
      hasSerialFounders: teamFounders?.hasSerialFounders || false,
      marketSize: marketCompetitive?.marketSize?.tam || "Unknown",
      competitors: (marketCompetitive?.competitors || []).slice(0, 3).map((c: any) => c.name),
      differentiators: marketCompetitive?.differentiators || [],
      verdict,
    };

    const prompt = `Write a professional 2-3 paragraph executive summary for ${entityName} based on:

${JSON.stringify(contextData, null, 2)}

Guidelines:
- Start with a clear thesis statement
- Summarize what the company does and key differentiators
- Note team strengths if available
- End with the investment verdict
- Keep to 150-200 words, professional investment memo style
- Do NOT use bullet points`;

    const { text } = await generateText({
      model,
      prompt,
      maxTokens: 500,
      temperature: 0.3,
    } as Parameters<typeof generateText>[0]);

    if (text && text.length > 50) {
      console.log(`[DD-Enhanced] LLM executive summary generated (${text.length} chars) using FREE model`);
      return text.trim();
    }

    return templateSummary();
  } catch (error) {
    console.warn("[DD-Enhanced] LLM synthesis failed, using template:", error);
    return templateSummary();
  }
}

/**
 * Generate investment thesis using FREE-FIRST LLM strategy
 * Falls back to template if LLM unavailable
 */
async function generateInvestmentThesis(
  entityName: string,
  companyProfile: any,
  teamFounders: any,
  marketCompetitive: any
): Promise<{
  thesisSummary: string;
  keyDrivers: string[];
  keyMilestones?: Array<{ milestone: string }>;
  exitScenarios?: Array<{ scenario: string; probability: string }>;
}> {
  // Template fallback
  const templateThesis = () => {
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
    return {
      thesisSummary:
        keyDrivers.length > 0
          ? `Investment thesis based on: ${keyDrivers.slice(0, 2).join("; ")}`
          : "Investment thesis requires further validation.",
      keyDrivers,
      exitScenarios: [
        { scenario: "Strategic acquisition", probability: "Medium" },
        { scenario: "IPO", probability: "Low" },
      ],
    };
  };

  try {
    // FREE-FIRST: Use qwen3-coder-free
    const model = await getLanguageModelSafe(SYNTHESIS_MODEL);
    if (!model) {
      return templateThesis();
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
    };

    const prompt = `Write investment thesis for ${entityName}:

${JSON.stringify(contextData, null, 2)}

Return JSON:
{
  "thesisSummary": "2-3 sentence thesis",
  "keyDrivers": ["Driver 1", "Driver 2", "Driver 3"],
  "keyMilestones": [{"milestone": "M1"}, {"milestone": "M2"}],
  "exitScenarios": [{"scenario": "S1", "probability": "High/Medium/Low"}]
}`;

    const { text } = await generateText({
      model,
      prompt,
      maxTokens: 600,
      temperature: 0.3,
    } as Parameters<typeof generateText>[0]);

    if (text) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.thesisSummary && parsed.keyDrivers?.length > 0) {
            console.log("[DD-Enhanced] LLM investment thesis generated using FREE model");
            return {
              thesisSummary: parsed.thesisSummary,
              keyDrivers: parsed.keyDrivers,
              keyMilestones: parsed.keyMilestones,
              exitScenarios: parsed.exitScenarios,
            };
          }
        }
      } catch {
        // JSON parse failed
      }
    }

    return templateThesis();
  } catch (error) {
    console.warn("[DD-Enhanced] LLM thesis failed, using template:", error);
    return templateThesis();
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

function getBranchDescription(
  branchType: BranchType,
  entityName: string
): string {
  const descriptions: Record<BranchType, string> = {
    company_profile: `Research basic company information for ${entityName}`,
    team_founders: `Deep dive into founders and executives for ${entityName}`,
    market_competitive: `Analyze market and competitors for ${entityName}`,
    technical_dd: `Evaluate technology stack for ${entityName}`,
    ip_patents: `Research patent portfolio for ${entityName}`,
    regulatory: `Analyze regulatory status for ${entityName}`,
    financial_deep: `Deep financial analysis for ${entityName}`,
    network_mapping: `Map relationships and networks for ${entityName}`,
  };
  return descriptions[branchType] ?? `Research ${branchType} for ${entityName}`;
}
