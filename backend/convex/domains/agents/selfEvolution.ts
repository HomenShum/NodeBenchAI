"use node";
/**
 * selfEvolution.ts — Karpathy Self-Evolution Loop
 *
 * The agent analyzes its own decision logs and proposes rubric improvements.
 * Pipeline: analyzeDecisionLogs → proposeRubricChanges → applyRubricEvolution
 *
 * Every rubric check is boolean YES/NO with mandatory string reasoning.
 * Evolution changes are version-tracked with before/after state and confidence.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getLanguageModelSafe } from "./mcp_tools/models/modelResolver";
import { generateText } from "ai";
import { createHash } from "crypto";

// ============================================================================
// Safety Configuration
// ============================================================================

/**
 * Guards against runaway rubric mutation.
 * - maxChangesPerCycle: prevents large destabilizing rewrites
 * - minDataWindowDays: ensures proposals are grounded in sufficient evidence
 * - minGatesAfterChange: blocks changes that would hollow out the rubric
 */
const EVOLUTION_SAFETY_GATES = {
  maxChangesPerCycle: 2,
  minDataWindowDays: 7,
  minGatesAfterChange: 3,
} as const;

/** BOUND: Max decisions to carry in analysis */
const MAX_DECISIONS = 200;
/** TIMEOUT: LLM call timeout in ms */
const LLM_TIMEOUT_MS = 60_000;
/** BOUND_READ: Max chars to store from LLM response */
const MAX_RESPONSE_CHARS = 5_000;

// ============================================================================
// Types
// ============================================================================

interface DecisionRecord {
  action: "POST" | "SKIP";
  reason: string;
  traceId: string;
  timestamp: number;
}

interface DecisionAnalysis {
  totalDecisions: number;
  postRate: number;
  skipReasons: Record<string, number>;
  falsePositiveRate: number;
  rubricHealth: {
    gateCount: number;
    avgPassRate: number;
    stalestGate: string | null;
    dataWindowDays: number;
  };
  decisions: DecisionRecord[];
  analyzedAt: number;
}

interface RubricChange {
  type: "add_gate" | "remove_gate" | "adjust_threshold" | "add_disqualifier";
  gateName: string;
  reasoning: string;
  confidence: number;
  before: string | null;
  after: string | null;
}

interface RubricProposal {
  changes: RubricChange[];
  overallReasoning: string;
  expectedImpact: string;
  proposedAt: number;
}

// ============================================================================
// Step 1: Analyze Decision Logs
// ============================================================================

/**
 * Queries recent agentTaskTraces and evalRuns, categorizes decisions,
 * and computes post_rate, skip_reasons frequency, false positive rate,
 * and rubric health metrics.
 */
export const analyzeDecisionLogs = internalAction({
  args: {
    lookbackDays: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<DecisionAnalysis> => {
    const lookbackDays = args.lookbackDays ?? 14;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

    // Fetch recent traces
    const traces: Array<{
      _id: string;
      traceId: string;
      status: string;
      startedAt: number;
      metadata?: Record<string, unknown>;
      workflowName: string;
    }> = await ctx.runQuery(
      internal.domains.agents.selfEvolutionQueries.queryRecentTraces,
      { cutoff },
    );

    // Fetch recent eval runs
    const evalRuns: Array<{
      _id: string;
      passRate: number;
      status: string;
      startedAt: number;
      failedCases: number;
      totalCases: number;
    }> = await ctx.runQuery(
      internal.domains.agents.selfEvolutionQueries.queryRecentEvalRuns,
      { cutoff },
    );

    // BOUND: Categorize decisions from traces, capped at MAX_DECISIONS
    const decisions: DecisionRecord[] = traces.slice(0, MAX_DECISIONS).map((t) => {
      const wasPosted = t.status === "completed";
      return {
        action: wasPosted ? ("POST" as const) : ("SKIP" as const),
        reason: wasPosted
          ? `Completed workflow: ${t.workflowName}`
          : `Skipped/errored: ${t.status} in ${t.workflowName}`,
        traceId: t.traceId,
        timestamp: t.startedAt,
      };
    });

    // Compute skip reasons frequency
    const skipReasons: Record<string, number> = {};
    const skips = decisions.filter((d) => d.action === "SKIP");
    for (const s of skips) {
      skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;
    }

    // Compute false positive rate from eval runs
    const completedEvals = evalRuns.filter((e) => e.status === "completed");
    const totalFailed = completedEvals.reduce(
      (sum, e) => sum + e.failedCases,
      0,
    );
    const totalCases = completedEvals.reduce(
      (sum, e) => sum + e.totalCases,
      0,
    );
    const falsePositiveRate = totalCases > 0 ? totalFailed / totalCases : 0;

    // Rubric health
    const postCount = decisions.filter((d) => d.action === "POST").length;
    const postRate = decisions.length > 0 ? postCount / decisions.length : 0;

    const dataWindowDays =
      decisions.length > 0
        ? (Date.now() - Math.min(...decisions.map((d) => d.timestamp))) /
          (24 * 60 * 60 * 1000)
        : 0;

    // Identify stalest gate — the skip reason with highest frequency
    const stalestGate =
      Object.entries(skipReasons).sort(([, a], [, b]) => b - a)[0]?.[0] ??
      null;

    return {
      totalDecisions: decisions.length,
      postRate,
      skipReasons,
      falsePositiveRate,
      rubricHealth: {
        gateCount: Object.keys(skipReasons).length + 1, // +1 for implicit pass gate
        avgPassRate: postRate,
        stalestGate,
        dataWindowDays,
      },
      decisions,
      analyzedAt: Date.now(),
    };
  },
});

// ============================================================================
// Step 2: Propose Rubric Changes via LLM
// ============================================================================

/**
 * Takes analysis results and uses an LLM to propose rubric changes:
 * add_gate, remove_gate, adjust_threshold, add_disqualifier.
 * Enforces EVOLUTION_SAFETY_GATES before returning proposals.
 */
export const proposeRubricChanges = internalAction({
  args: {
    analysis: v.any(),
    currentGateNames: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<RubricProposal> => {
    const analysis = args.analysis as DecisionAnalysis;
    const currentGates = args.currentGateNames;

    // Safety: require minimum data window
    if (
      analysis.rubricHealth.dataWindowDays <
      EVOLUTION_SAFETY_GATES.minDataWindowDays
    ) {
      return {
        changes: [],
        overallReasoning: `Insufficient data window: ${analysis.rubricHealth.dataWindowDays.toFixed(1)} days < ${EVOLUTION_SAFETY_GATES.minDataWindowDays} required.`,
        expectedImpact: "none — blocked by safety gate",
        proposedAt: Date.now(),
      };
    }

    const model = getLanguageModelSafe("qwen3-coder-free");

    const systemPrompt = `You are an evaluation rubric optimizer. Analyze agent decision logs and propose improvements to the boolean rubric gates.

Current gates: ${JSON.stringify(currentGates)}
Safety constraints:
- Maximum ${EVOLUTION_SAFETY_GATES.maxChangesPerCycle} changes per cycle
- Must keep at least ${EVOLUTION_SAFETY_GATES.minGatesAfterChange} gates after changes
- Every change needs YES/NO boolean reasoning

Return a JSON object with this exact shape:
{
  "changes": [
    {
      "type": "add_gate" | "remove_gate" | "adjust_threshold" | "add_disqualifier",
      "gateName": "string",
      "reasoning": "string explaining WHY this change based on the data",
      "confidence": 0.0-1.0,
      "before": "current state or null",
      "after": "proposed state or null"
    }
  ],
  "overallReasoning": "string",
  "expectedImpact": "string"
}`;

    const userPrompt = `Decision analysis:
- Total decisions: ${analysis.totalDecisions}
- Post rate: ${(analysis.postRate * 100).toFixed(1)}%
- False positive rate: ${(analysis.falsePositiveRate * 100).toFixed(1)}%
- Skip reasons: ${JSON.stringify(analysis.skipReasons)}
- Rubric health: ${JSON.stringify(analysis.rubricHealth)}
- Data window: ${analysis.rubricHealth.dataWindowDays.toFixed(1)} days

Propose rubric changes to improve agent decision quality. Focus on:
1. Gates that never trigger (remove candidates)
2. Missing gates for common failure modes (add candidates)
3. Thresholds that are too strict or too lenient
4. Patterns in skip reasons that suggest new disqualifiers`;

    // ERROR_BOUNDARY + TIMEOUT: wrap LLM call with AbortController
    let proposal: RubricProposal;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      let result;
      try {
        result = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: 2000,
          abortSignal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      // BOUND_READ: cap response text before processing
      const responseText = result.text.slice(0, MAX_RESPONSE_CHARS);

      // Extract JSON from response
      const parsed = extractJson(responseText);
      const changes: RubricChange[] = (
        parsed.changes as Array<Record<string, unknown>>
      )
        .slice(0, EVOLUTION_SAFETY_GATES.maxChangesPerCycle)
        .map((c) => ({
          type: c.type as RubricChange["type"],
          gateName: String(c.gateName),
          reasoning: String(c.reasoning),
          confidence: Number(c.confidence) || 0, // HONEST_SCORES: no artificial floor
          before: c.before != null ? String(c.before) : null,
          after: c.after != null ? String(c.after) : null,
        }));

      // Safety: block changes that would drop gates below minimum
      const removalCount = changes.filter(
        (c) => c.type === "remove_gate",
      ).length;
      const addCount = changes.filter((c) => c.type === "add_gate").length;
      const projectedGateCount =
        currentGates.length - removalCount + addCount;

      if (projectedGateCount < EVOLUTION_SAFETY_GATES.minGatesAfterChange) {
        const safeChanges = changes.filter((c) => c.type !== "remove_gate");
        proposal = {
          changes: safeChanges,
          overallReasoning: `${String(parsed.overallReasoning)} [SAFETY: removal(s) blocked — would reduce gates to ${projectedGateCount} < ${EVOLUTION_SAFETY_GATES.minGatesAfterChange}]`,
          expectedImpact: String(parsed.expectedImpact),
          proposedAt: Date.now(),
        };
      } else {
        proposal = {
          changes,
          overallReasoning: String(parsed.overallReasoning),
          expectedImpact: String(parsed.expectedImpact),
          proposedAt: Date.now(),
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      proposal = {
        changes: [],
        overallReasoning: `LLM call failed: ${message.slice(0, 200)}`,
        expectedImpact: "none — LLM failure",
        proposedAt: Date.now(),
      };
    }

    return proposal;
  },
});

// ============================================================================
// Step 5: Full Pipeline
// ============================================================================

/**
 * Runs the complete self-evolution cycle:
 * analyze → propose → apply → log.
 * Returns a summary of what changed.
 */
export const runSelfEvolutionCycle = internalAction({
  args: {
    lookbackDays: v.optional(v.number()),
    currentGateNames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // DETERMINISTIC: sorted-key hash for cycle ID instead of Math.random()
    const ts = Date.now();
    const hashInput = `evo:${ts}:${JSON.stringify(args.currentGateNames ?? [])}`;
    const cycleId = `evo-${ts}-${createHash("sha256").update(hashInput).digest("hex").slice(0, 8)}`;
    const startedAt = Date.now();

    // Default gates from AgentRunJudgeCriteria
    const currentGates = args.currentGateNames ?? [
      "taskCompleted",
      "outputCorrect",
      "evidenceCited",
      "noHallucination",
      "toolsUsedEfficiently",
      "contractFollowed",
      "budgetRespected",
      "noForbiddenActions",
    ];

    // Step 1: Analyze
    const analysis: DecisionAnalysis = await ctx.runAction(
      internal.domains.agents.selfEvolution.analyzeDecisionLogs,
      { lookbackDays: args.lookbackDays },
    );

    // Step 2: Propose
    const proposal: RubricProposal = await ctx.runAction(
      internal.domains.agents.selfEvolution.proposeRubricChanges,
      { analysis, currentGateNames: currentGates },
    );

    // Step 2.5: Verification gate — simulate impact and detect thrashing before applying
    if (proposal.changes.length > 0) {
      try {
        const verification = await ctx.runAction(
          internal.domains.agents.evolutionVerification.verifyRubricProposal,
          { proposedChanges: proposal.changes },
        );
        if (!verification.approved) {
          // Block the proposal — record as skipped with rejection reason
          const evolutionId = await ctx.runMutation(
            internal.domains.agents.selfEvolutionQueries.applyRubricEvolution,
            {
              proposal: {
                ...proposal,
                changes: [], // Clear changes — they were rejected
                overallReasoning: `${proposal.overallReasoning} [VERIFICATION BLOCKED: ${verification.rejectionReason}]`,
                expectedImpact: "none — blocked by verification gate",
              },
              analysis,
              cycleId,
            },
          );
          return {
            cycleId,
            evolutionId,
            changesApplied: 0,
            overallReasoning: `Verification blocked: ${verification.rejectionReason}`,
            expectedImpact: "none — blocked by verification gate",
            analysisSnapshot: {
              totalDecisions: analysis.totalDecisions,
              postRate: analysis.postRate,
              falsePositiveRate: analysis.falsePositiveRate,
            },
            verification,
            durationMs: Date.now() - startedAt,
          };
        }
      } catch (err) {
        // Non-blocking: if verification fails, proceed with the proposal
        // (fail-open for verification — we'd rather apply a change than block on verification error)
        console.error("Verification gate error:", err instanceof Error ? err.message : String(err));
      }
    }

    // Step 3: Apply
    const evolutionId = await ctx.runMutation(
      internal.domains.agents.selfEvolutionQueries.applyRubricEvolution,
      { proposal, analysis, cycleId },
    );

    return {
      cycleId,
      evolutionId,
      changesApplied: proposal.changes.length,
      overallReasoning: proposal.overallReasoning,
      expectedImpact: proposal.expectedImpact,
      analysisSnapshot: {
        totalDecisions: analysis.totalDecisions,
        postRate: analysis.postRate,
        falsePositiveRate: analysis.falsePositiveRate,
      },
      durationMs: Date.now() - startedAt,
    };
  },
});

// ============================================================================
// Utilities
// ============================================================================

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object found");
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error("Unterminated JSON object");
  return JSON.parse(text.slice(start, end));
}
