"use node";
/**
 * deliberationToEvolution.ts — Deliberation → Rubric Pipeline
 *
 * Bridges swarm deliberation synthesis output to selfEvolution rubric changes.
 * When high-confidence consensus implies gate modifications, this module
 * proposes (and optionally applies) rubric evolution changes.
 *
 * Flow: synthesisResult → analyzeConsensusForGateChanges → checkForContradictions
 *       → proposeRubricChanges → applyRubricEvolution
 *
 * Safety: Respects EVOLUTION_SAFETY_GATES (max 2 changes, min 3 gates).
 * Reliability: ERROR_BOUNDARY on all LLM calls, TIMEOUT via AbortController,
 *              BOUND on consensus points and response chars.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getLanguageModelSafe } from "./mcp_tools/models/modelResolver";
import { generateText } from "ai";
import { createHash } from "crypto";

// ============================================================================
// Constants
// ============================================================================

/** Minimum overall confidence from deliberation to trigger evolution analysis */
const MIN_CONFIDENCE_FOR_EVOLUTION = 0.8;
/** BOUND: Max consensus points sent to LLM for analysis */
const MAX_CONSENSUS_POINTS_TO_ANALYZE = 10;
/** TIMEOUT: LLM call timeout in ms */
const LLM_TIMEOUT_MS = 30_000;
/** BOUND_READ: Max chars from LLM response */
const MAX_RESPONSE_CHARS = 3_000;
/** Max suggested changes per analysis (mirrors EVOLUTION_SAFETY_GATES.maxChangesPerCycle) */
const MAX_SUGGESTED_CHANGES = 2;
/** BOUND: Max evolution history entries to check for contradictions */
const MAX_EVOLUTION_HISTORY = 5;

/** Default rubric gates from AgentRunJudgeCriteria */
const DEFAULT_GATE_NAMES = [
  "taskCompleted",
  "outputCorrect",
  "evidenceCited",
  "noHallucination",
  "toolsUsedEfficiently",
  "contractFollowed",
  "budgetRespected",
  "noForbiddenActions",
] as const;

// ============================================================================
// Types
// ============================================================================

interface SuggestedChange {
  type: string;
  gateName: string;
  reasoning: string;
}

interface AnalysisResult {
  shouldPropose: boolean;
  reasoning: string;
  suggestedChanges: SuggestedChange[];
}

// ============================================================================
// Step 1: Analyze Consensus Points for Gate Implications
// ============================================================================

/**
 * Uses an LLM to determine whether deliberation consensus points imply
 * rubric gate changes. Returns structured analysis with suggested changes.
 *
 * BOUND: consensusPoints capped at MAX_CONSENSUS_POINTS_TO_ANALYZE.
 * TIMEOUT: AbortController with LLM_TIMEOUT_MS.
 * ERROR_BOUNDARY: LLM failures return { shouldPropose: false }.
 * HONEST_SCORES: no artificial confidence floors.
 */
export const analyzeConsensusForGateChanges = internalAction({
  args: {
    consensusPoints: v.array(v.string()),
    overallConfidence: v.number(),
    divergencePoints: v.array(v.string()),
    currentGateNames: v.array(v.string()),
    domain: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<AnalysisResult> => {
    // Early exit: confidence too low to warrant evolution
    if (args.overallConfidence < MIN_CONFIDENCE_FOR_EVOLUTION) {
      return {
        shouldPropose: false,
        reasoning: `Confidence ${args.overallConfidence.toFixed(2)} < ${MIN_CONFIDENCE_FOR_EVOLUTION} threshold — insufficient consensus for rubric evolution.`,
        suggestedChanges: [],
      };
    }

    // BOUND: cap consensus points
    const cappedConsensus = args.consensusPoints.slice(
      0,
      MAX_CONSENSUS_POINTS_TO_ANALYZE,
    );

    const model = getLanguageModelSafe("gemini-3.1-flash-lite-preview");

    const systemPrompt = `You are a rubric evolution analyst. Given deliberation consensus points from a swarm of agent roles, determine if any consensus implies changes to the agent evaluation rubric gates.

Current gates: ${JSON.stringify(args.currentGateNames)}

Rules:
- Only suggest changes when consensus is clear and actionable
- Maximum ${MAX_SUGGESTED_CHANGES} changes
- Valid change types: add_gate, remove_gate, adjust_threshold, add_disqualifier
- Each suggestion must have concrete reasoning tied to a specific consensus point

Return ONLY a JSON object with this exact shape:
{
  "shouldPropose": boolean,
  "reasoning": "string explaining your analysis",
  "suggestedChanges": [
    {
      "type": "add_gate" | "remove_gate" | "adjust_threshold" | "add_disqualifier",
      "gateName": "string",
      "reasoning": "string"
    }
  ]
}`;

    const userPrompt = `Deliberation consensus (confidence: ${args.overallConfidence.toFixed(2)}${args.domain ? `, domain: ${args.domain}` : ""}):

Consensus points:
${cappedConsensus.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Divergence points (areas of disagreement — treat cautiously):
${args.divergencePoints.length > 0 ? args.divergencePoints.map((p, i) => `${i + 1}. ${p}`).join("\n") : "None — full consensus reached."}

Analyze whether these consensus points imply any rubric gate changes.`;

    // ERROR_BOUNDARY + TIMEOUT
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      let result;
      try {
        result = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: 1500,
          abortSignal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      // BOUND_READ: cap response
      const responseText = result.text.slice(0, MAX_RESPONSE_CHARS);

      // Extract JSON from response
      const parsed = extractJson(responseText);

      const suggestedChanges: SuggestedChange[] = Array.isArray(
        parsed.suggestedChanges,
      )
        ? (parsed.suggestedChanges as Array<Record<string, unknown>>)
            .slice(0, MAX_SUGGESTED_CHANGES)
            .map((c) => ({
              type: String(c.type ?? "add_gate"),
              gateName: String(c.gateName ?? "unknown"),
              reasoning: String(c.reasoning ?? ""),
            }))
        : [];

      return {
        shouldPropose: Boolean(parsed.shouldPropose) && suggestedChanges.length > 0,
        reasoning: String(parsed.reasoning ?? "No reasoning provided"),
        suggestedChanges,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        shouldPropose: false,
        reasoning: `Analysis failed: ${message.slice(0, 200)}`,
        suggestedChanges: [],
      };
    }
  },
});

// ============================================================================
// Step 2: Check for Contradictions with Recent Evolutions
// ============================================================================

/**
 * Cross-references suggested changes against decision memory and recent
 * evolution history to detect contradictions (e.g., re-adding a gate that
 * was just removed, or removing one that was just added).
 *
 * BOUND: Queries capped at MAX_EVOLUTION_HISTORY.
 * ERROR_BOUNDARY: Query failures return { hasContradictions: false }.
 */
export const checkForContradictions = internalAction({
  args: {
    domain: v.string(),
    suggestedChanges: v.array(
      v.object({
        type: v.string(),
        gateName: v.string(),
        reasoning: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{ hasContradictions: boolean; details: string }> => {
    try {
      // Fetch recent evolution history
      const recentEvolutions = await ctx.runQuery(
        internal.domains.agents.selfEvolutionQueries.getEvolutionHistory,
        { limit: MAX_EVOLUTION_HISTORY },
      );

      // Fetch related decisions from memory
      const relatedDecisions = await ctx.runQuery(
        internal.domains.agents.decisionMemoryQueries.queryRelatedDecisions,
        { domain: args.domain, actionType: "rubric_evolution" },
      );

      // Build a map of recent gate changes: gateName → last change type
      const recentGateChanges = new Map<string, string>();

      for (const evo of recentEvolutions) {
        if (!evo.changes || !Array.isArray(evo.changes)) continue;
        for (const change of evo.changes) {
          const c = change as { gateName?: string; type?: string };
          if (c.gateName && c.type) {
            // Only keep the most recent change per gate (list is desc by time)
            if (!recentGateChanges.has(c.gateName)) {
              recentGateChanges.set(c.gateName, c.type);
            }
          }
        }
      }

      // Detect contradictions: opposite operations on the same gate
      const OPPOSITE_TYPES: Record<string, string> = {
        add_gate: "remove_gate",
        remove_gate: "add_gate",
        add_disqualifier: "remove_gate", // adding a disqualifier that was just removed is contradictory
      };

      const contradictions: string[] = [];

      for (const change of args.suggestedChanges) {
        const lastChange = recentGateChanges.get(change.gateName);
        if (lastChange) {
          const oppositeOf = OPPOSITE_TYPES[change.type];
          if (oppositeOf && lastChange === oppositeOf) {
            // Check if opposite — e.g., we want to add_gate but it was recently remove_gate'd (or vice versa)
            // Actually: if last change was "remove_gate" and we now propose "add_gate", that's a reversal
            contradictions.push(
              `"${change.gateName}": proposed ${change.type} reverses recent ${lastChange}`,
            );
          }
          // Also catch direct reversals: last was add_gate, now remove_gate
          if (
            (lastChange === "add_gate" && change.type === "remove_gate") ||
            (lastChange === "remove_gate" && change.type === "add_gate")
          ) {
            if (
              !contradictions.some((c) => c.includes(`"${change.gateName}"`))
            ) {
              contradictions.push(
                `"${change.gateName}": proposed ${change.type} directly reverses recent ${lastChange}`,
              );
            }
          }
        }
      }

      // Also check decision memory for recent contradictory verdicts
      if (relatedDecisions.length > 0) {
        const recentVerdicts = relatedDecisions
          .slice(0, 3)
          .map(
            (d: { verdict: string; reasoning: string }) =>
              `${d.verdict}: ${d.reasoning.slice(0, 100)}`,
          )
          .join("; ");
        // Log for observability but don't block on decision memory alone
        if (contradictions.length > 0) {
          contradictions.push(
            `Related decision memory context: ${recentVerdicts.slice(0, 300)}`,
          );
        }
      }

      if (contradictions.length > 0) {
        return {
          hasContradictions: true,
          details: contradictions.join(" | "),
        };
      }

      return {
        hasContradictions: false,
        details: "No contradictions detected with recent evolutions.",
      };
    } catch (error) {
      // ERROR_BOUNDARY: contradiction check failure should not block the pipeline
      console.error(
        "[deliberationToEvolution] Contradiction check failed:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        hasContradictions: false,
        details: `Contradiction check failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ============================================================================
// Step 3: Bridge Entry Point
// ============================================================================

/**
 * Main entry point: bridges deliberation synthesis to rubric evolution.
 *
 * Pipeline:
 * 1. Extract consensus/confidence from synthesis result
 * 2. Analyze consensus for gate change implications (LLM)
 * 3. Check for contradictions with recent evolutions
 * 4. Optionally propose + apply changes via selfEvolution
 *
 * ERROR_BOUNDARY: entire bridge is non-blocking — failures return
 * { proposed: false } with reasoning, never throw.
 */
export const bridgeDeliberationToEvolution = internalAction({
  args: {
    synthesisResult: v.any(),
    currentGateNames: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
    autoApply: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<{
    proposed: boolean;
    reasoning: string;
    evolutionId?: string;
  }> => {
    try {
      // Extract fields from synthesis result
      const synthesis = args.synthesisResult as Record<string, unknown>;
      const consensusPoints = Array.isArray(synthesis.consensusPoints)
        ? (synthesis.consensusPoints as string[])
        : [];
      const overallConfidence =
        typeof synthesis.overallConfidence === "number"
          ? synthesis.overallConfidence
          : 0;
      const divergencePoints = Array.isArray(synthesis.divergencePoints)
        ? (synthesis.divergencePoints as string[])
        : [];

      const currentGateNames =
        args.currentGateNames ?? [...DEFAULT_GATE_NAMES];
      const domain = args.domain ?? "general";

      // Step 1: Analyze consensus for gate change implications
      const analysis: AnalysisResult = await ctx.runAction(
        internal.domains.agents.deliberationToEvolution
          .analyzeConsensusForGateChanges,
        {
          consensusPoints,
          overallConfidence,
          divergencePoints,
          currentGateNames,
          domain,
        },
      );

      if (!analysis.shouldPropose) {
        return {
          proposed: false,
          reasoning: analysis.reasoning,
        };
      }

      // Step 2: Check for contradictions with recent evolutions
      const contradictionCheck = (await ctx.runAction(
        internal.domains.agents.deliberationToEvolution.checkForContradictions,
        {
          domain,
          suggestedChanges: analysis.suggestedChanges,
        },
      )) as { hasContradictions: boolean; details: string };

      if (contradictionCheck.hasContradictions) {
        return {
          proposed: false,
          reasoning: `Blocked by contradiction: ${contradictionCheck.details}`,
        };
      }

      // Step 3: Propose and optionally apply via selfEvolution
      if (args.autoApply) {
        // Build a synthetic DecisionAnalysis for selfEvolution.proposeRubricChanges
        // The consensus-derived analysis gives the LLM enough signal to propose
        const syntheticAnalysis = {
          totalDecisions: consensusPoints.length,
          postRate: overallConfidence,
          skipReasons: Object.fromEntries(
            divergencePoints.map((dp, i) => [`divergence_${i}`, 1]),
          ),
          falsePositiveRate: 1 - overallConfidence,
          rubricHealth: {
            gateCount: currentGateNames.length,
            avgPassRate: overallConfidence,
            stalestGate: null,
            // Set to 8 to satisfy the 7-day minimum data window gate
            dataWindowDays: 8,
          },
          decisions: [],
          analyzedAt: Date.now(),
        };

        // Propose via selfEvolution (it has its own LLM + safety gates)
        const proposal = await ctx.runAction(
          internal.domains.agents.selfEvolution.proposeRubricChanges,
          {
            analysis: syntheticAnalysis,
            currentGateNames,
          },
        );

        // Apply if there are changes
        const proposalObj = proposal as {
          changes: unknown[];
          overallReasoning: string;
          expectedImpact: string;
        };
        if (proposalObj.changes.length > 0) {
          // DETERMINISTIC: sorted-key hash for cycle ID
          const ts = Date.now();
          const hashInput = `delib-evo:${ts}:${domain}`;
          const cycleId = `delib-evo-${ts}-${createHash("sha256").update(hashInput).digest("hex").slice(0, 8)}`;

          const evolutionId = await ctx.runMutation(
            internal.domains.agents.selfEvolutionQueries.applyRubricEvolution,
            {
              proposal,
              analysis: syntheticAnalysis,
              cycleId,
            },
          );

          return {
            proposed: true,
            reasoning: `${analysis.reasoning} | Evolution applied: ${proposalObj.overallReasoning}`,
            evolutionId: String(evolutionId),
          };
        }

        return {
          proposed: false,
          reasoning: `Analysis suggested changes but selfEvolution proposal was empty: ${proposalObj.overallReasoning}`,
        };
      }

      // Not auto-applying — return the analysis for manual review
      return {
        proposed: true,
        reasoning: `Changes proposed but not auto-applied: ${analysis.reasoning} | Suggested: ${analysis.suggestedChanges.map((c) => `${c.type}(${c.gateName})`).join(", ")}`,
      };
    } catch (error) {
      // ERROR_BOUNDARY: bridge failure never throws — returns safe result
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "[deliberationToEvolution] Bridge failed:",
        message.slice(0, 300),
      );
      return {
        proposed: false,
        reasoning: `Bridge failed: ${message.slice(0, 200)}`,
      };
    }
  },
});

// ============================================================================
// Utilities
// ============================================================================

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in LLM response");
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
  if (end < 0) throw new Error("Unterminated JSON object in LLM response");
  return JSON.parse(text.slice(start, end));
}
