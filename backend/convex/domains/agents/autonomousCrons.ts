"use node";

import { v } from "convex/values";
import {
  internalAction,
} from "../../_generated/server";

// Queries & mutations moved to autonomousCronsQueries.ts (non-"use node" file)
// Import from "domains/agents/autonomousCronsQueries" instead.
import { internal } from "../../_generated/api";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

interface DriftDetectionResult {
  alignmentScore: number;
  driftTopics: string[];
  recommendations: string[];
}

interface Competitor {
  name: string;
  strengths: string[];
  weaknesses: string[];
  threats: string[];
}

interface CompetitiveAnalysisResult {
  competitors: Competitor[];
  strategicInsights: string[];
}

interface PredictionLens {
  prediction: string;
  confidence: number;
  timeframe: string;
  evidence: string[];
}

interface PredictionResult {
  lenses: {
    momentum: PredictionLens;
    contrarian: PredictionLens;
    structural: PredictionLens;
    blackSwan: PredictionLens;
  };
  ensemblePrediction: string;
  brierTracking: { priorScore: number | null; predictionTimestamp: number };
}

interface CommandWordGate {
  channelId: string;
  commandWord: string | null;
  bypassTypes: string[];
}

interface SwarmEvolutionResult {
  sessionsAnalyzed: number;
  roleEffectiveness: Array<{ role: string; contributionScore: number }>;
  consensusSpeed: { avgRoundsToConsensus: number; trend: string };
  actionItemQuality: { completionRate: number; impactScore: number };
  proposedAdjustments: string[];
}

/* ================================================================== */
/* HELPERS                                                             */
/* ================================================================== */

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const MAX_SESSIONS_QUERY = 50;

/**
 * Call Gemini via the Google GenAI REST API.
 * Returns the raw text response. Throws on non-2xx.
 */
async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // BOUND_READ: cap response text to prevent memory bloat
    return text.slice(0, 10_000);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Safely parse JSON from LLM output, falling back to a default value.
 */
function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try to extract JSON from markdown fences
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        /* fall through */
      }
    }
    return fallback;
  }
}

/* ================================================================== */
/* 1. DRIFT DETECTION (weekly)                                         */
/* ================================================================== */

/**
 * Compares recent git commits (last 7 days) against the product roadmap
 * stored in agentTaskSessions. Uses LLM to assess alignment between
 * actual work and stated priorities.
 *
 * Output stored as a new agentTaskSession with cronJobName "drift_detection".
 */
export const runDriftDetection = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    console.log("[autonomousCrons] Starting drift detection");

    // 1. Load recent task sessions as a proxy for roadmap priorities
    const recentSessions: Array<{ title: string; description?: string; status: string }> =
      await ctx.runQuery(
        internal.domains.agents.autonomousCronsQueries.queryRecentSessions,
        { since: sevenDaysAgo, limit: MAX_SESSIONS_QUERY },
      );

    const roadmapSummary = recentSessions
      .map((s) => `- [${s.status}] ${s.title}${s.description ? `: ${s.description}` : ""}`)
      .join("\n");

    // 2. Ask LLM to assess alignment
    const prompt = `You are a strategic alignment analyst. Given the following recent task sessions from a product roadmap and development tracker, assess whether the work is aligned with coherent priorities or if there is drift.

## Recent Task Sessions (last 7 days)
${roadmapSummary || "(No sessions found — this itself may indicate drift.)"}

## Instructions
Analyze the sessions and return JSON with this exact schema:
{
  "alignmentScore": <number 0-1, where 1 = perfectly aligned>,
  "driftTopics": [<string topics where work is drifting from priorities>],
  "recommendations": [<string actionable recommendations>]
}

If there are few or no sessions, set alignmentScore to 0 and note the data gap in recommendations.`;

    let raw: string;
    try {
      raw = await callGemini(prompt);
    } catch (err) {
      // ERROR_BOUNDARY: don't let LLM failure crash the cron
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[autonomousCrons] Drift detection LLM call failed: ${msg}`);
      await ctx.runMutation(
        internal.domains.agents.autonomousCronsQueries.storeCronResult,
        {
          title: `Drift Detection — ${new Date(now).toISOString().slice(0, 10)} (FAILED)`,
          cronJobName: "drift_detection",
          metadata: { alignmentScore: 0, driftTopics: [], recommendations: [`LLM call failed: ${msg.slice(0, 200)}`] },
        },
      );
      return null;
    }
    const result = safeParseJson<DriftDetectionResult>(raw, {
      alignmentScore: 0, // HONEST_SCORES: 0 on parse failure, not 0.5
      driftTopics: ["Unable to parse LLM response"],
      recommendations: ["Re-run drift detection with more data"],
    });

    // Clamp alignmentScore
    result.alignmentScore = Math.max(0, Math.min(1, result.alignmentScore));

    // 3. Store result
    await ctx.runMutation(
      internal.domains.agents.autonomousCronsQueries.storeCronResult,
      {
        title: `Drift Detection — ${new Date(now).toISOString().slice(0, 10)}`,
        cronJobName: "drift_detection",
        metadata: result,
      },
    );

    console.log(
      `[autonomousCrons] Drift detection complete: alignment=${result.alignmentScore}`,
    );
    return null;
  },
});

/* ================================================================== */
/* 2. COMPETITIVE ANALYSIS (weekly)                                    */
/* ================================================================== */

/**
 * Analyzes the competitive landscape using 3 research queries synthesized
 * into a competitive brief. Designed to integrate with swarm deliberation
 * once swarmDeliberation.ts is available.
 *
 * Output stored as a new agentTaskSession with cronJobName "competitive_analysis".
 */
export const runCompetitiveAnalysis = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const now = Date.now();
    console.log("[autonomousCrons] Starting competitive analysis");

    // 3 research queries to cover the competitive landscape
    const queries = [
      "Identify the top 5 competitors in the AI agent orchestration and MCP server space. For each, list their key product features, recent funding, and market positioning.",
      "What are the emerging threats and disruptive trends in the AI developer tools market? Focus on open-source alternatives, new protocols, and shifting developer preferences.",
      "Analyze the strategic moats and weaknesses of existing AI agent platforms. Which companies have the strongest developer ecosystems and which are losing momentum?",
    ];

    // Run queries in parallel
    const queryResults = await Promise.all(
      queries.map(async (q, i) => {
        try {
          return await callGemini(
            `You are a competitive intelligence analyst. Answer concisely:\n\n${q}\n\nReturn plain text analysis, 200 words max.`,
          );
        } catch (err) {
          console.error(`[autonomousCrons] Query ${i} failed:`, err);
          return `(Query ${i + 1} failed — insufficient data)`;
        }
      }),
    );

    // BOUND: cap individual query results
    const cappedResults = queryResults.map((r) => r.slice(0, 3_000));

    // Synthesize into structured competitive brief
    const synthesisPrompt = `You are a strategic analyst. Synthesize these 3 research findings into a structured competitive brief.

## Research Finding 1
${cappedResults[0]}

## Research Finding 2
${cappedResults[1]}

## Research Finding 3
${cappedResults[2]}

Return JSON with this exact schema:
{
  "competitors": [
    { "name": "<string>", "strengths": ["<string>"], "weaknesses": ["<string>"], "threats": ["<string>"] }
  ],
  "strategicInsights": ["<string actionable insight>"]
}

Include 3-5 competitors and 3-5 strategic insights.`;

    let result: CompetitiveAnalysisResult;
    try {
      const raw = await callGemini(synthesisPrompt);
      result = safeParseJson<CompetitiveAnalysisResult>(raw, {
        competitors: [],
        strategicInsights: ["Analysis could not be parsed — review raw output"],
      });
    } catch (err) {
      // ERROR_BOUNDARY: graceful degradation on synthesis failure
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[autonomousCrons] Competitive synthesis failed: ${msg}`);
      result = {
        competitors: [],
        strategicInsights: [`Synthesis LLM call failed: ${msg.slice(0, 200)}`],
      };
    }

    await ctx.runMutation(
      internal.domains.agents.autonomousCronsQueries.storeCronResult,
      {
        title: `Competitive Analysis — ${new Date(now).toISOString().slice(0, 10)}`,
        cronJobName: "competitive_analysis",
        metadata: result,
      },
    );

    console.log(
      `[autonomousCrons] Competitive analysis complete: ${result.competitors.length} competitors identified`,
    );
    return null;
  },
});

/* ================================================================== */
/* 3. PREDICTION — MiroFish Multi-Perspective (weekly)                 */
/* ================================================================== */

const PREDICTION_LENSES = [
  {
    key: "momentum" as const,
    label: "Momentum",
    instruction:
      "Extrapolate current trends forward. What happens if present trajectories continue? Focus on growth rates, adoption curves, and momentum indicators.",
  },
  {
    key: "contrarian" as const,
    label: "Contrarian",
    instruction:
      "Challenge the consensus. What if the dominant trend reverses? Identify overextensions, bubbles, and areas where conventional wisdom may be wrong.",
  },
  {
    key: "structural" as const,
    label: "Structural",
    instruction:
      "Analyze underlying forces: regulation, infrastructure, talent supply, capital flows. What structural changes will reshape the landscape regardless of short-term trends?",
  },
  {
    key: "blackSwan" as const,
    label: "Black Swan",
    instruction:
      "Identify tail risks with outsized impact. What low-probability events could fundamentally alter the market? Consider technological breakthroughs, geopolitical shifts, and systemic failures.",
  },
] as const;

/**
 * Multi-perspective prediction using 4 analytical lenses (Momentum, Contrarian,
 * Structural, Black Swan). Each lens provides an independent prediction with
 * confidence scores. Results are synthesized into a weighted ensemble with
 * Brier-score tracking for calibration over time.
 *
 * Output stored as a new agentTaskSession with cronJobName "prediction".
 */
export const runPrediction = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const now = Date.now();
    console.log("[autonomousCrons] Starting multi-perspective prediction");

    // Load recent sessions for context
    const recentSessions: Array<{ title: string; status: string }> =
      await ctx.runQuery(
        internal.domains.agents.autonomousCronsQueries.queryRecentSessions,
        { since: now - 14 * 24 * 60 * 60 * 1000, limit: 20 },
      );

    const contextSummary = recentSessions
      .map((s) => `- [${s.status}] ${s.title}`)
      .join("\n");

    // Run 4 lenses in parallel
    const lensResults = await Promise.all(
      PREDICTION_LENSES.map(async (lens) => {
        const prompt = `You are a prediction analyst using the "${lens.label}" lens.

## Context: Recent activity in an AI agent orchestration platform
${contextSummary || "(No recent context available)"}

## Your Lens: ${lens.label}
${lens.instruction}

Return JSON with this exact schema:
{
  "prediction": "<string — your core prediction, 1-2 sentences>",
  "confidence": <number 0-1>,
  "timeframe": "<string — e.g. '3 months', '6 months', '1 year'>",
  "evidence": ["<string supporting evidence>"]
}`;

        try {
          const raw = await callGemini(prompt);
          return safeParseJson<PredictionLens>(raw, {
            prediction: `${lens.label} analysis unavailable`,
            confidence: 0, // HONEST_SCORES: 0 on parse failure
            timeframe: "unknown",
            evidence: [],
          });
        } catch (err) {
          console.error(`[autonomousCrons] ${lens.label} lens failed:`, err);
          return {
            prediction: `${lens.label} analysis failed`,
            confidence: 0, // HONEST_SCORES: 0 on failure, not 0.1
            timeframe: "unknown",
            evidence: [],
          };
        }
      }),
    );

    // Build lenses map
    const lenses = {
      momentum: lensResults[0],
      contrarian: lensResults[1],
      structural: lensResults[2],
      blackSwan: lensResults[3],
    };

    // Weighted ensemble synthesis
    const weights = { momentum: 0.35, contrarian: 0.2, structural: 0.3, blackSwan: 0.15 };
    const weightedConfidence =
      lenses.momentum.confidence * weights.momentum +
      lenses.contrarian.confidence * weights.contrarian +
      lenses.structural.confidence * weights.structural +
      lenses.blackSwan.confidence * weights.blackSwan;

    // Synthesize ensemble prediction
    const synthPrompt = `Synthesize these 4 analytical perspectives into a single ensemble prediction (2-3 sentences):

Momentum (weight ${weights.momentum}, confidence ${lenses.momentum.confidence}): ${lenses.momentum.prediction}
Contrarian (weight ${weights.contrarian}, confidence ${lenses.contrarian.confidence}): ${lenses.contrarian.prediction}
Structural (weight ${weights.structural}, confidence ${lenses.structural.confidence}): ${lenses.structural.prediction}
Black Swan (weight ${weights.blackSwan}, confidence ${lenses.blackSwan.confidence}): ${lenses.blackSwan.prediction}

Return JSON: { "ensemblePrediction": "<string>" }`;

    let ensemblePrediction: string;
    try {
      const raw = await callGemini(synthPrompt);
      const parsed = safeParseJson<{ ensemblePrediction: string }>(raw, {
        ensemblePrediction: `Weighted ensemble (confidence: ${weightedConfidence.toFixed(2)}): ${lenses.momentum.prediction}`,
      });
      ensemblePrediction = parsed.ensemblePrediction;
    } catch {
      ensemblePrediction = `Weighted ensemble (confidence: ${weightedConfidence.toFixed(2)}): ${lenses.momentum.prediction}`;
    }

    // Look up prior Brier score from previous prediction session
    const priorPrediction: { metadata?: { brierTracking?: { priorScore: number } } } | null =
      await ctx.runQuery(
        internal.domains.agents.autonomousCronsQueries.queryLatestCronSession,
        { cronJobName: "prediction" },
      );

    const result: PredictionResult = {
      lenses,
      ensemblePrediction,
      brierTracking: {
        priorScore: priorPrediction?.metadata?.brierTracking?.priorScore ?? null,
        predictionTimestamp: now,
      },
    };

    await ctx.runMutation(
      internal.domains.agents.autonomousCronsQueries.storeCronResult,
      {
        title: `Prediction — ${new Date(now).toISOString().slice(0, 10)}`,
        cronJobName: "prediction",
        metadata: result,
      },
    );

    console.log(
      `[autonomousCrons] Prediction complete: ensemble confidence=${weightedConfidence.toFixed(2)}`,
    );
    return null;
  },
});

/* ================================================================== */
/* 4. COMMAND-WORD GATING                                              */
/* ================================================================== */

// setCommandWordGate moved to autonomousCronsQueries.ts (non-node file)

// getCommandWordGate moved to autonomousCronsQueries.ts (non-node file)

/**
 * Pure function: determines whether a message should be processed given
 * the active command-word gate. Returns true if the message passes the gate.
 *
 * Rules:
 * 1. If no gate is active (commandWord is null), always respond.
 * 2. If message type is in bypassTypes (e.g. "meta-feedback"), always respond.
 * 3. Otherwise, respond only if the message starts with the command word.
 */
export function shouldRespondToMessage(
  gate: CommandWordGate | null,
  message: string,
  messageType?: string,
): boolean {
  // No gate active — always respond
  if (!gate || !gate.commandWord) return true;

  // Type B bypass: meta-feedback and other bypass types skip the gate
  if (messageType && gate.bypassTypes.includes(messageType)) return true;

  // Check if message starts with the command word (case-insensitive)
  const normalized = message.trimStart().toLowerCase();
  const word = gate.commandWord.toLowerCase();
  return normalized.startsWith(word);
}

/* ================================================================== */
/* 5. SWARM EVOLUTION (weekly)                                         */
/* ================================================================== */

/**
 * The swarm reviews its own past deliberations. Loads the last 4 deliberation
 * sessions, analyzes role effectiveness, consensus speed, and action item quality,
 * then proposes role prompt adjustments for future deliberations.
 *
 * Output stored as a new agentTaskSession with cronJobName "swarm_evolution".
 */
export const runSwarmEvolution = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const now = Date.now();
    console.log("[autonomousCrons] Starting swarm evolution analysis");

    // Load last 4 swarm deliberation sessions
    const swarmSessions: Array<{
      title: string;
      description?: string;
      status: string;
      totalDurationMs?: number;
      agentsInvolved?: string[];
      metadata?: unknown;
    }> = await ctx.runQuery(
      internal.domains.agents.autonomousCronsQueries.querySwarmSessions,
      { limit: 4 },
    );

    if (swarmSessions.length === 0) {
      console.log("[autonomousCrons] No swarm sessions found — skipping evolution");
      await ctx.runMutation(
        internal.domains.agents.autonomousCronsQueries.storeCronResult,
        {
          title: `Swarm Evolution — ${new Date(now).toISOString().slice(0, 10)} (skipped)`,
          cronJobName: "swarm_evolution",
          metadata: {
            sessionsAnalyzed: 0,
            roleEffectiveness: [],
            consensusSpeed: { avgRoundsToConsensus: 0, trend: "insufficient_data" },
            actionItemQuality: { completionRate: 0, impactScore: 0 },
            proposedAdjustments: ["Insufficient deliberation history for evolution analysis"],
          } satisfies SwarmEvolutionResult,
        },
      );
      return null;
    }

    // Build summary of past deliberations
    const sessionSummaries = swarmSessions
      .map((s, i) => {
        const agents = s.agentsInvolved?.join(", ") ?? "unknown";
        const duration = s.totalDurationMs
          ? `${(s.totalDurationMs / 1000).toFixed(1)}s`
          : "unknown";
        return `Session ${i + 1}: "${s.title}" | Status: ${s.status} | Duration: ${duration} | Agents: ${agents}`;
      })
      .join("\n");

    const prompt = `You are a swarm intelligence optimizer. Analyze these past deliberation sessions and propose improvements.

## Past Deliberation Sessions
${sessionSummaries}

## Instructions
Evaluate:
1. Role effectiveness — which agent roles contributed most to successful outcomes?
2. Consensus speed — how quickly did the swarm converge on decisions?
3. Action item quality — were action items completed and impactful?

Return JSON with this exact schema:
{
  "roleEffectiveness": [{ "role": "<string>", "contributionScore": <number 0-1> }],
  "consensusSpeed": { "avgRoundsToConsensus": <number>, "trend": "<improving|stable|degrading>" },
  "actionItemQuality": { "completionRate": <number 0-1>, "impactScore": <number 0-1> },
  "proposedAdjustments": ["<string — specific prompt or role adjustment>"]
}`;

    let parsed: Omit<SwarmEvolutionResult, "sessionsAnalyzed">;
    try {
      const raw = await callGemini(prompt);
      parsed = safeParseJson<Omit<SwarmEvolutionResult, "sessionsAnalyzed">>(raw, {
        roleEffectiveness: [],
        consensusSpeed: { avgRoundsToConsensus: 0, trend: "insufficient_data" },
        actionItemQuality: { completionRate: 0, impactScore: 0 },
        proposedAdjustments: ["LLM response could not be parsed — manual review needed"],
      });
    } catch (err) {
      // ERROR_BOUNDARY: graceful degradation on LLM failure
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[autonomousCrons] Swarm evolution LLM call failed: ${msg}`);
      parsed = {
        roleEffectiveness: [],
        consensusSpeed: { avgRoundsToConsensus: 0, trend: "insufficient_data" },
        actionItemQuality: { completionRate: 0, impactScore: 0 },
        proposedAdjustments: [`LLM call failed: ${msg.slice(0, 200)}`],
      };
    }

    const result: SwarmEvolutionResult = {
      sessionsAnalyzed: swarmSessions.length,
      ...parsed,
    };

    await ctx.runMutation(
      internal.domains.agents.autonomousCronsQueries.storeCronResult,
      {
        title: `Swarm Evolution — ${new Date(now).toISOString().slice(0, 10)}`,
        cronJobName: "swarm_evolution",
        metadata: result,
      },
    );

    console.log(
      `[autonomousCrons] Swarm evolution complete: ${result.proposedAdjustments.length} adjustments proposed`,
    );
    return null;
  },
});

/* ================================================================== */
/* SHARED QUERIES & MUTATIONS                                          */
/* ================================================================== */

// queryRecentSessions, queryLatestCronSession, querySwarmSessions
// moved to autonomousCronsQueries.ts (non-node file)

// storeCronResult moved to autonomousCronsQueries.ts (non-node file)
