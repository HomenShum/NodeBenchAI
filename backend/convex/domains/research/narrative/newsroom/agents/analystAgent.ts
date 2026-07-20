/**
 * Analyst Agent - Narrative Shift Detection
 *
 * The third agent in the Newsroom pipeline. Responsible for:
 * 1. Analyzing news against historical context
 * 2. Detecting narrative shifts and plot twists
 * 3. Identifying sentiment changes
 * 4. Proposing new threads or thread updates
 *
 * Uses LLM reasoning for sophisticated pattern detection.
 *
 * @module domains/narrative/newsroom/agents/analystAgent
 */

import { generateText } from "ai";
import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../../agents/mcp_tools/models";
import { fnv1a32Hex } from "../../../../../../shared/citations/webSourceCitations";
import type {
  NewsroomState,
  NarrativeShift,
  NewsItem,
  HistoricalClaim,
  ExistingThread,
} from "../state";
import type { HypothesisCandidate } from "../../validators";

/**
 * Configuration for Analyst Agent
 */
export interface AnalystConfig {
  /** Model to use for analysis */
  model?: string;
  /** Minimum confidence threshold for shifts */
  minConfidence?: number;
  /** Maximum shifts to detect */
  maxShifts?: number;
  /** Enable plot twist detection */
  detectPlotTwists?: boolean;
  /** Enable sentiment analysis */
  analyzeSentiment?: boolean;
  /**
   * Deterministic mode for evaluation/regression tests.
   * Skips LLM calls and uses simple heuristics to emit shifts.
   */
  useHeuristicOnly?: boolean;
  /**
   * Record/replay mode for external tools (LLM calls).
   * - live: call tools normally
   * - record: call tools and persist immutable recordings keyed by workflowId
   * - replay: use persisted recordings, no external calls
   */
  toolReplayMode?: "live" | "record" | "replay";
  /** Recording set identifier; defaults to `state.workflowId` when not provided. */
  toolReplayId?: string;
}

const DEFAULT_CONFIG: Required<AnalystConfig> = {
  model: "qwen3-coder-free",
  minConfidence: 0.6,
  maxShifts: 10,
  detectPlotTwists: true,
  analyzeSentiment: true,
  useHeuristicOnly: false,
  toolReplayMode: "live",
  toolReplayId: "",
};

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  });
}

function heuristicDetectShifts(
  state: NewsroomState,
  cfg: Required<AnalystConfig>
): NarrativeShift[] {
  const shifts: NarrativeShift[] = [];

  const news = [...state.weeklyNews].sort(
    (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
  );
  const top = news.slice(0, Math.max(1, Math.min(cfg.maxShifts, 10)));

  const targetThreadId = state.existingThreads[0]?.threadId;
  if (targetThreadId) {
    for (const item of top) {
      const confidence = Math.max(
        cfg.minConfidence,
        Math.min(0.95, item.relevanceScore || cfg.minConfidence)
      );
      shifts.push({
        type: "thread_update",
        description: item.headline,
        confidence,
        affectedThreadId: targetThreadId,
      });
      if (shifts.length >= cfg.maxShifts) break;
    }
  } else {
    const primaryEntity = state.targetEntityKeys[0] || "topic:unknown";
    const cleanName =
      primaryEntity.split(":")[1]?.replace(/_/g, " ") || primaryEntity;
    const name = `${cleanName} Weekly Update`;
    const thesis = top[0]?.headline || `Weekly developments for ${cleanName}`;

    shifts.push({
      type: "new_thread",
      description: thesis,
      confidence: 0.8,
      newThreadProposal: {
        name,
        thesis,
        entityKeys: state.targetEntityKeys,
        topicTags: (state.focusTopics || []).slice(0, 5),
      },
    });
  }

  if (cfg.detectPlotTwists && shifts.length < cfg.maxShifts) {
    const plotTwists = detectPlotTwists(state.weeklyNews, state.historicalContext);
    for (const pt of plotTwists) {
      shifts.push(pt);
      if (shifts.length >= cfg.maxShifts) break;
    }
  }

  return shifts
    .filter((s) => s.confidence >= cfg.minConfidence)
    .slice(0, cfg.maxShifts);
}

/**
 * Build analysis prompt for LLM
 */
function buildAnalysisPrompt(
  news: NewsItem[],
  claims: HistoricalClaim[],
  threads: ExistingThread[],
  entityKeys: string[]
): string {
  const newsSection = news
    .slice(0, 15)
    .map((n, i) => `${i + 1}. [${n.source}] ${n.headline}\n   ${n.snippet.slice(0, 200)}`)
    .join("\n\n");

  const claimsSection = claims
    .slice(0, 10)
    .map((c) => `- ${c.claimText}`)
    .join("\n");

  const threadsSection = threads
    .slice(0, 5)
    .map((t) => `- "${t.name}" (${t.currentPhase}): ${t.thesis.slice(0, 150)}`)
    .join("\n");

  return `You are a narrative analyst detecting shifts in ongoing stories about: ${entityKeys.join(", ")}

## THIS WEEK'S NEWS
${newsSection}

## HISTORICAL CONTEXT (Known Facts)
${claimsSection || "No historical claims available."}

## EXISTING NARRATIVE THREADS
${threadsSection || "No existing threads."}

## TASK
Analyze the news against historical context and detect:
1. **New Threads** - Significant new storylines that deserve tracking
2. **Thread Updates** - Major developments in existing threads
3. **Plot Twists** - Surprising reversals or contradictions
4. **Sentiment Shifts** - Notable changes in public discourse

For each shift detected, provide:
- type: "new_thread" | "thread_update" | "plot_twist" | "sentiment_shift"
- description: Clear explanation of what changed
- confidence: 0.0-1.0 (how certain are you?)
- affectedThreadId: (if updating existing thread)
- newThreadProposal: { name, thesis, entityKeys, topicTags } (if new thread)

Additionally, if there are competing explanations for what the news means, output them as **hypotheses**. Each hypothesis should be:
- label: "H1", "H2", etc.
- title: Short name (e.g. "Attention displacement")
- claimForm: Testable claim statement
- measurementApproach: How to evaluate this hypothesis with data
- speculativeRisk: "grounded" (tier1/2 evidence supports) | "mixed" (partly supported) | "speculative" (mostly interpretive)
- falsificationCriteria: What evidence would disprove this hypothesis

Respond in JSON format:
{
  "shifts": [
    {
      "type": "new_thread",
      "description": "...",
      "confidence": 0.85,
      "newThreadProposal": {
        "name": "Short memorable name",
        "thesis": "Current state of this narrative",
        "entityKeys": ["company:EXAMPLE"],
        "topicTags": ["funding", "ai"]
      }
    }
  ],
  "hypotheses": [
    {
      "label": "H1",
      "title": "Short hypothesis name",
      "claimForm": "Testable claim: X correlates with Y because Z",
      "measurementApproach": "Compare metric A vs metric B over time window",
      "speculativeRisk": "mixed",
      "falsificationCriteria": "If X does not correlate with Y within 30 days, this is falsified"
    }
  ],
  "summary": "Brief overview of this week's narrative developments"
}

Only detect shifts with confidence >= 0.6. Be specific and cite evidence from the news.
Only output hypotheses when there are genuinely competing explanations. Do not force hypotheses.`;
}

/**
 * Parse LLM response to extract narrative shifts and hypothesis candidates
 */
function parseAnalysisResponse(
  response: string,
  minConfidence: number
): { shifts: NarrativeShift[]; hypotheses: HypothesisCandidate[]; summary: string } {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find JSON object directly
      const objectMatch = response.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);
    const rawShifts = parsed.shifts || [];

    // Filter by confidence and validate structure
    const validShifts: NarrativeShift[] = rawShifts
      .filter((s: any) => {
        if (!s.type || !s.description || typeof s.confidence !== "number") {
          return false;
        }
        return s.confidence >= minConfidence;
      })
      .map((s: any) => ({
        type: s.type as NarrativeShift["type"],
        description: s.description,
        confidence: s.confidence,
        affectedThreadId: s.affectedThreadId,
        newThreadProposal: s.newThreadProposal
          ? {
              name: s.newThreadProposal.name || "Unnamed Thread",
              thesis: s.newThreadProposal.thesis || s.description,
              entityKeys: s.newThreadProposal.entityKeys || [],
              topicTags: s.newThreadProposal.topicTags || [],
            }
          : undefined,
      }));

    // Parse hypothesis candidates (Phase 7)
    const rawHypotheses = parsed.hypotheses || [];
    const validRisks = new Set(["grounded", "mixed", "speculative"]);
    const hypotheses: HypothesisCandidate[] = rawHypotheses
      .filter((h: any) => h.label && h.title && h.claimForm && h.measurementApproach)
      .map((h: any) => ({
        label: String(h.label),
        title: String(h.title),
        claimForm: String(h.claimForm),
        measurementApproach: String(h.measurementApproach),
        speculativeRisk: validRisks.has(h.speculativeRisk) ? h.speculativeRisk : "speculative",
        falsificationCriteria: h.falsificationCriteria ? String(h.falsificationCriteria) : undefined,
      }));

    return {
      shifts: validShifts,
      hypotheses,
      summary: parsed.summary || "",
    };
  } catch (error) {
    console.error("[AnalystAgent] Failed to parse response:", error);
    return { shifts: [], hypotheses: [], summary: "" };
  }
}

/**
 * Detect plot twists by finding contradictions
 */
function detectPlotTwists(
  news: NewsItem[],
  claims: HistoricalClaim[]
): NarrativeShift[] {
  const plotTwists: NarrativeShift[] = [];

  // Simple heuristic: look for news that contradicts known claims
  const contradictionKeywords = [
    "reversal",
    "pivot",
    "abandons",
    "cancels",
    "walks back",
    "contrary to",
    "despite earlier",
    "surprising",
    "unexpected",
    "shocking",
    "u-turn",
    "backtracks",
  ];

  for (const newsItem of news) {
    const headlineLower = newsItem.headline.toLowerCase();
    const snippetLower = newsItem.snippet.toLowerCase();
    const text = headlineLower + " " + snippetLower;

    // Check for contradiction keywords
    const hasContradiction = contradictionKeywords.some((kw) =>
      text.includes(kw)
    );

    if (hasContradiction && newsItem.relevanceScore > 0.7) {
      // Check if it relates to any existing claim
      for (const claim of claims) {
        const claimSubject = claim.subject.toLowerCase();
        if (text.includes(claimSubject)) {
          plotTwists.push({
            type: "plot_twist",
            description: `Potential reversal: "${newsItem.headline}" may contradict known fact: "${claim.claimText}"`,
            confidence: 0.7,
          });
          break; // One plot twist per news item
        }
      }
    }
  }

  return plotTwists;
}

/**
 * Analyst Agent: Detect narrative shifts and plot twists
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Analyst configuration
 * @returns Updated state with detected shifts
 */
export async function runAnalystAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: AnalystConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`[AnalystAgent] Analyzing ${state.weeklyNews.length} news items against ${state.historicalContext.length} claims`);
  console.log(`[AnalystAgent] Model: ${cfg.model}, Min confidence: ${cfg.minConfidence}`);

  const allShifts: NarrativeShift[] = [];
  const allHypothesisCandidates: HypothesisCandidate[] = [];
  const errors: string[] = [];

  try {
    // Skip if no news to analyze
    if (state.weeklyNews.length === 0) {
      console.log("[AnalystAgent] No news to analyze, skipping");
      return {
        ...state,
        narrativeShifts: [],
        currentStep: "publisher",
      };
    }

    // Deterministic mode: no LLM calls.
    if (cfg.useHeuristicOnly) {
      console.log("[AnalystAgent] Using heuristic-only shift detection");
      const shifts = heuristicDetectShifts(state, cfg as Required<AnalystConfig>);
      return {
        ...state,
        narrativeShifts: shifts,
        currentStep: "publisher",
      };
    }

    // Build and execute LLM analysis
    const prompt = buildAnalysisPrompt(
      state.weeklyNews,
      state.historicalContext,
      state.existingThreads,
      state.targetEntityKeys
    );

    console.log("[AnalystAgent] Running LLM analysis...");

    const toolName = "generateText.newsroom_analyst";
    const parentWorkflowId = cfg.toolReplayId ?? state.workflowId;
    const toolInput = {
      model: cfg.model,
      prompt,
      maxRetries: 2,
      temperature: 0.3,
    };
    const inputHash = fnv1a32Hex(stableStringify(toolInput));

    let result: any;
    if (cfg.toolReplayMode === "replay" && parentWorkflowId) {
      const recorded = await ctx.runQuery(
        internal.domains.narrative.mutations.toolReplay.getToolRecord,
        { parentWorkflowId, toolName, inputHash }
      );
      if (!recorded) {
        throw new Error(
          `[AnalystAgent] Replay record missing for ${toolName} (${inputHash})`
        );
      }
      result = recorded;
    } else {
      result = await generateText({
        model: getLanguageModelSafe(cfg.model),
        prompt,
        maxRetries: 2,
        temperature: 0.3, // Lower temperature for more consistent analysis
      });
      if (cfg.toolReplayMode === "record" && parentWorkflowId) {
        await ctx.runMutation(internal.domains.narrative.mutations.toolReplay.saveToolRecord, {
          parentWorkflowId,
          toolName,
          inputHash,
          input: toolInput,
          output: result,
        });
      }
    }

    // Parse LLM response
    const { shifts: llmShifts, hypotheses: llmHypotheses, summary } = parseAnalysisResponse(
      result.text,
      cfg.minConfidence
    );

    allShifts.push(...llmShifts);
    console.log(`[AnalystAgent] LLM detected ${llmShifts.length} shifts, ${llmHypotheses.length} hypotheses`);

    if (summary) {
      console.log(`[AnalystAgent] Summary: ${summary.slice(0, 200)}...`);
    }

    // Persist hypothesis candidates to narrativeHypotheses (Phase 7)
    if (llmHypotheses.length > 0) {
      const targetThreadId = state.existingThreads[0]?.threadId;
      if (targetThreadId) {
        const competingIds: string[] = [];
        for (const h of llmHypotheses) {
          try {
            const hypothesisId = await ctx.runMutation(
              internal.domains.narrative.mutations.hypotheses.createHypothesisInternal,
              {
                threadId: targetThreadId as any,
                label: h.label,
                title: h.title,
                claimForm: h.claimForm,
                measurementApproach: h.measurementApproach,
                speculativeRisk: h.speculativeRisk,
                confidence: 0.5,
                falsificationCriteria: h.falsificationCriteria,
                createdByAgent: "analyst",
              }
            );
            competingIds.push(String(hypothesisId));
            console.log(`[AnalystAgent] Created hypothesis ${h.label}: ${h.title}`);
          } catch (e) {
            console.warn(`[AnalystAgent] Hypothesis creation failed (non-fatal):`, e);
          }
        }
        // Store hypothesis candidates on the state so publisher can link claims
        allHypothesisCandidates.push(...llmHypotheses);
      } else {
        // No thread yet — stash candidates for publisher to persist after thread creation
        allHypothesisCandidates.push(...llmHypotheses);
        console.log(`[AnalystAgent] Deferred ${llmHypotheses.length} hypothesis(es) — no thread yet`);
      }
    }

    // Add heuristic plot twist detection
    if (cfg.detectPlotTwists) {
      const heuristicTwists = detectPlotTwists(
        state.weeklyNews,
        state.historicalContext
      );

      // Only add heuristic twists that don't overlap with LLM-detected ones
      for (const twist of heuristicTwists) {
        const isDuplicate = llmShifts.some(
          (s) =>
            s.type === "plot_twist" &&
            s.description.toLowerCase().includes(
              twist.description.toLowerCase().slice(0, 50)
            )
        );
        if (!isDuplicate) {
          allShifts.push(twist);
        }
      }

      console.log(`[AnalystAgent] Added ${heuristicTwists.length} heuristic plot twists`);
    }
  } catch (error) {
    const errorMsg = `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[AnalystAgent] ${errorMsg}`);
    errors.push(errorMsg);

    // Fall back to heuristic-only detection
    if (cfg.detectPlotTwists) {
      const fallbackTwists = detectPlotTwists(
        state.weeklyNews,
        state.historicalContext
      );
      allShifts.push(...fallbackTwists);
      console.log(`[AnalystAgent] Fallback: ${fallbackTwists.length} heuristic twists`);
    }
  }

  // Sort by confidence and limit
  allShifts.sort((a, b) => b.confidence - a.confidence);
  const topShifts = allShifts.slice(0, cfg.maxShifts);

  console.log(`[AnalystAgent] Final: ${topShifts.length} narrative shifts detected`);

  // Log shift types
  const shiftCounts = topShifts.reduce(
    (acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log(`[AnalystAgent] Breakdown:`, shiftCounts);

  // Return updated state with hypothesis candidates for publisher
  return {
    ...state,
    narrativeShifts: topShifts,
    hypothesisCandidates: allHypothesisCandidates.length > 0 ? allHypothesisCandidates : undefined,
    errors: [...state.errors, ...errors],
    currentStep: "publisher", // Advance to next step
  };
}

/**
 * Analyst Agent tool definition for use in LangGraph
 */
export const analystAgentTool = {
  name: "analyze_narratives",
  description: "Analyze news against history to detect narrative shifts",
  parameters: {
    minConfidence: {
      type: "number",
      description: "Minimum confidence threshold (0-1)",
    },
    detectPlotTwists: {
      type: "boolean",
      description: "Enable plot twist detection",
    },
  },
};
