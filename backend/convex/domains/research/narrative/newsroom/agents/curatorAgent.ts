/**
 * Curator Agent - Thread Thesis Management
 *
 * The fifth agent in the Newsroom pipeline. Responsible for:
 * 1. Deciding whether to append, revise thesis, or spawn new thread
 * 2. Enforcing "diff-first" writing (what changed since last time)
 * 3. Ensuring citation coverage for all claims
 * 4. Managing thread quality and coherence
 *
 * Acts as a quality gate before publishing updates to narrative threads.
 *
 * @module domains/narrative/newsroom/agents/curatorAgent
 */

import { generateText } from "ai";
import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../../agents/mcp_tools/models";
import type {
  NewsroomState,
  NarrativeShift,
  GeneratedNarrative,
} from "../state";

/**
 * Configuration for Curator Agent
 */
export interface CuratorConfig {
  /** Model to use for curation decisions */
  model?: string;
  /** Minimum citation coverage required (0-1) */
  minCitationCoverage?: number;
  /** Maximum post length in characters */
  maxPostLength?: number;
  /** Require at least N unique sources */
  minUniqueSources?: number;
  /** Force thesis revision for plot twists */
  forceThesisRevisionOnPlotTwist?: boolean;
}

const DEFAULT_CONFIG: Required<CuratorConfig> = {
  model: "qwen3-coder-free",
  minCitationCoverage: 0.8,
  maxPostLength: 2000,
  minUniqueSources: 2,
  forceThesisRevisionOnPlotTwist: true,
};

/**
 * Curation decision types
 */
type CurationDecision =
  | "append_delta" // Add delta update post
  | "revise_thesis" // Thesis needs significant revision
  | "spawn_thread" // Create new thread from material
  | "skip" // Not enough material or too similar
  | "needs_sources"; // Needs more evidence before publishing

/**
 * Curation result for a single narrative shift
 */
interface CurationResult {
  shiftIndex: number;
  decision: CurationDecision;
  reason: string;
  citationCoverage: number;
  uniqueSourceCount: number;
  suggestedChangeSummary?: string[];
  qualityIssues?: string[];
}

/**
 * Build curation prompt for LLM
 */
function buildCurationPrompt(
  shift: NarrativeShift,
  existingThesis: string | undefined,
  recentPosts: Array<{ content: string; createdAt: number }>,
  citationCount: number
): string {
  const recentContent = recentPosts
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.content.slice(0, 300)}...`)
    .join("\n\n");

  return `You are a narrative curator ensuring quality updates to research threads.

## CURRENT SHIFT TO EVALUATE
Type: ${shift.type}
Description: ${shift.description}
Confidence: ${shift.confidence}
${shift.newThreadProposal ? `New Thread Proposal: "${shift.newThreadProposal.name}" - ${shift.newThreadProposal.thesis}` : ""}
${shift.affectedThreadId ? `Affects Thread: ${shift.affectedThreadId}` : ""}

## EXISTING THESIS
${existingThesis || "No existing thesis - this would be a new thread."}

## RECENT POSTS IN THIS THREAD
${recentContent || "No recent posts."}

## EVIDENCE
Available citations: ${citationCount}

## CURATION RULES
1. **Diff-first**: Focus on what CHANGED since the last update. Don't repeat known information.
2. **Citation coverage**: Every factual claim must have a citation. Minimum 80% coverage.
3. **Thesis revision**: Only revise thesis for significant paradigm shifts, not routine updates.
4. **New thread**: Only spawn if fundamentally different narrative, not a subplot.
5. **Quality gate**: Skip if the material is too thin or duplicates recent posts.

## TASK
Decide how to handle this shift:
- "append_delta": Add as a delta update showing what changed
- "revise_thesis": This fundamentally changes the thread's central thesis
- "spawn_thread": This deserves its own separate narrative thread
- "skip": Not enough material or too similar to recent posts
- "needs_sources": Good material but needs more evidence

Respond in JSON:
{
  "decision": "append_delta",
  "reason": "Explains key development without changing thesis",
  "suggestedChangeSummary": [
    "Company X announced Y",
    "This represents Z shift from prior position"
  ],
  "qualityIssues": ["Minor: could use more analyst commentary"],
  "citationCoverageEstimate": 0.9
}`;
}

/**
 * Extract unique source count from narrative shift.
 * Since NarrativeShift doesn't have explicit URLs, estimate based on confidence.
 */
function countUniqueSources(shift: NarrativeShift): number {
  // Estimate based on shift quality indicators
  // High confidence typically means multiple corroborating sources
  if (shift.newThreadProposal) {
    // New thread proposals with entity keys suggest multiple sources
    return Math.max(1, shift.newThreadProposal.entityKeys.length);
  }
  // Estimate based on confidence level
  if (shift.confidence > 0.8) return 3;
  if (shift.confidence > 0.6) return 2;
  return 1;
}

/**
 * Calculate citation coverage estimate.
 * Estimates based on shift description and confidence.
 */
function estimateCitationCoverage(shift: NarrativeShift): number {
  // Rough estimate: factual claims should have proportional citations
  const factualSentences = shift.description.split(/[.!?]/).filter((s) =>
    /\b(announced|reported|said|confirmed|raised|valued|launched)\b/i.test(s)
  ).length;

  // Use confidence as proxy for citation coverage
  // Higher confidence shifts typically have better citation support
  if (factualSentences === 0) return shift.confidence;

  return shift.confidence;
}

/**
 * Run Curator Agent on narrative shifts
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Curator configuration
 * @returns Updated state with curated narratives
 */
export async function runCuratorAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: CuratorConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`[CuratorAgent] Curating ${state.narrativeShifts.length} shifts`);

  const curationResults: CurationResult[] = [];
  const curatedNarratives: GeneratedNarrative[] = [];
  const errors: string[] = [];

  // Get model
  const model = await getLanguageModelSafe(cfg.model);
  if (!model) {
    errors.push(`Model ${cfg.model} not available`);
    return { ...state, errors: [...state.errors, ...errors] };
  }

  for (let i = 0; i < state.narrativeShifts.length; i++) {
    const shift = state.narrativeShifts[i];

    try {
      // Get existing thread context if updating
      let existingThesis: string | undefined;
      let recentPosts: Array<{ content: string; createdAt: number }> = [];

      if (shift.affectedThreadId) {
        // Query recent posts from the thread
        // This would be a real query in production
        existingThesis = state.existingThreads.find(
          (t) => t.threadId === shift.affectedThreadId
        )?.thesis;
      }

      // Calculate quality metrics
      const uniqueSourceCount = countUniqueSources(shift);
      const citationCoverage = estimateCitationCoverage(shift);

      // Quick checks before LLM
      if (uniqueSourceCount < cfg.minUniqueSources) {
        curationResults.push({
          shiftIndex: i,
          decision: "needs_sources",
          reason: `Only ${uniqueSourceCount} unique sources, need ${cfg.minUniqueSources}`,
          citationCoverage,
          uniqueSourceCount,
          qualityIssues: ["Insufficient source diversity"],
        });
        continue;
      }

      if (citationCoverage < cfg.minCitationCoverage) {
        curationResults.push({
          shiftIndex: i,
          decision: "needs_sources",
          reason: `Citation coverage ${(citationCoverage * 100).toFixed(0)}% below ${(cfg.minCitationCoverage * 100).toFixed(0)}% threshold`,
          citationCoverage,
          uniqueSourceCount,
          qualityIssues: ["Insufficient citation coverage"],
        });
        continue;
      }

      // Force thesis revision for plot twists
      if (cfg.forceThesisRevisionOnPlotTwist && shift.type === "plot_twist") {
        curationResults.push({
          shiftIndex: i,
          decision: "revise_thesis",
          reason: "Plot twist requires thesis revision",
          citationCoverage,
          uniqueSourceCount,
          suggestedChangeSummary: [
            `Previous understanding: ${existingThesis || "Unknown"}`,
            `New development: ${shift.description}`,
            "This fundamentally changes the narrative trajectory",
          ],
        });

        // Add to curated narratives
        curatedNarratives.push({
          threadId: shift.affectedThreadId || "new",
          isNewThread: !shift.affectedThreadId,
          newEvents: [],
          updatedThesis: shift.description,
        });
        continue;
      }

      // Use LLM for nuanced decision
      const prompt = buildCurationPrompt(
        shift,
        existingThesis,
        recentPosts,
        countUniqueSources(shift)
      );

      const { text } = await generateText({
        model,
        prompt,
        temperature: 0.3,
      });

      // Parse LLM response
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          curationResults.push({
            shiftIndex: i,
            decision: parsed.decision as CurationDecision,
            reason: parsed.reason || "LLM decision",
            citationCoverage: parsed.citationCoverageEstimate || citationCoverage,
            uniqueSourceCount,
            suggestedChangeSummary: parsed.suggestedChangeSummary,
            qualityIssues: parsed.qualityIssues,
          });

          // Create curated narrative based on decision
          if (parsed.decision === "append_delta" || parsed.decision === "revise_thesis") {
            curatedNarratives.push({
              threadId: shift.affectedThreadId || "pending",
              isNewThread: !shift.affectedThreadId,
              newEvents: [],
              updatedThesis: parsed.decision === "revise_thesis" ? shift.description : undefined,
            });
          } else if (parsed.decision === "spawn_thread" && shift.newThreadProposal) {
            curatedNarratives.push({
              threadId: "new",
              isNewThread: true,
              newEvents: [],
              updatedThesis: shift.newThreadProposal.thesis,
            });
          }
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        console.error(`[CuratorAgent] Parse error for shift ${i}:`, parseError);
        // Default to append_delta if parsing fails
        curationResults.push({
          shiftIndex: i,
          decision: "append_delta",
          reason: "Default decision (parse error)",
          citationCoverage,
          uniqueSourceCount,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CuratorAgent] Error curating shift ${i}:`, errorMsg);
      errors.push(`Shift ${i}: ${errorMsg}`);
    }
  }

  // Log curation summary
  const decisions = curationResults.reduce(
    (acc, r) => {
      acc[r.decision] = (acc[r.decision] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log(`[CuratorAgent] Curation complete:`, decisions);
  console.log(`[CuratorAgent] Curated ${curatedNarratives.length} narratives`);

  return {
    ...state,
    generatedNarratives: [...state.generatedNarratives, ...curatedNarratives],
    curationResults,
    errors: [...state.errors, ...errors],
    currentStep: "publisher",
  } as NewsroomState;
}

/**
 * Curator Agent tool definition for use in LangGraph
 */
export const curatorAgentTool = {
  name: "curate_narratives",
  description: "Curate and quality-gate narrative updates before publishing",
  parameters: {
    minCitationCoverage: {
      type: "number",
      description: "Minimum citation coverage required (0-1)",
    },
    forceThesisRevisionOnPlotTwist: {
      type: "boolean",
      description: "Whether plot twists should force thesis revision",
    },
  },
};
