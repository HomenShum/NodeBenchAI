/**
 * Forecasting OS — Refresh Forecast Action
 *
 * LLM-driven forecast refresh: gathers recent signals relevant to the
 * forecast question, runs a superforecaster judgment pass, and updates
 * the probability + evidence ledger.
 *
 * Model routing:
 * - Signal triage: free tier (qwen3-coder-free)
 * - Superforecaster judgment: low tier (deepseek-chat / minimax-m2.5)
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { v } from "convex/values";

export const refreshForecastAction = internalAction({
  args: {
    forecastId: v.id("forecasts"),
  },
  handler: async (ctx, args) => {
    // 1. Get the forecast
    const forecast = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getActiveForecastsForRefresh,
      { limit: 1 }
    );

    const target = forecast.find((f) => f._id === args.forecastId);
    if (!target) {
      return { skipped: true, reason: "Forecast not found or not active" };
    }

    // 2. Get existing evidence for context
    const existingEvidence = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getEvidenceForForecast,
      { forecastId: args.forecastId, limit: 10 }
    );

    // 3. Build the superforecaster prompt
    const prompt = buildSuperforecasterPrompt(target, existingEvidence);

    // 4. Call LLM for judgment (use model router if available)
    let llmResult: SuperforecasterOutput;
    try {
      const response = await ctx.runAction(
        internal.domains.models.modelRouter.route,
        {
          taskCategory: "validation",
          tier: "cheap",
          systemPrompt:
            "You are a calibrated superforecaster. Return only the requested JSON probability update.",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 1500,
        }
      );
      llmResult = parseSuperforecasterOutput(response.text ?? "");
    } catch {
      // If model router unavailable, skip refresh gracefully
      return {
        skipped: true,
        reason: "Model router unavailable",
        forecastId: args.forecastId,
      };
    }

    // 5. Update probability if LLM returned a valid one
    if (
      llmResult.probability != null &&
      llmResult.probability >= 0 &&
      llmResult.probability <= 1
    ) {
      await ctx.runMutation(
        internal.domains.forecasting.forecastManager.updateProbability,
        {
          forecastId: args.forecastId,
          probability: llmResult.probability,
          topDrivers: llmResult.drivers?.slice(0, 3),
          topCounterarguments: llmResult.counterarguments?.slice(0, 3),
          reasoning: llmResult.reasoning || "Automated refresh",
        }
      );
    }

    return {
      forecastId: args.forecastId,
      previousProbability: target.probability,
      newProbability: llmResult.probability,
      reasoning: llmResult.reasoning,
      skipped: false,
    };
  },
});

// ─── Prompt Construction ────────────────────────────────────────────────────

interface ForecastForPrompt {
  question: string;
  probability?: number;
  resolutionDate: string;
  resolutionCriteria: string;
  topDrivers: string[];
  topCounterarguments: string[];
  baseRate?: number;
}

interface EvidenceForPrompt {
  sourceTitle: string;
  excerpt: string;
  signal: string;
  addedAt: number;
}

function buildSuperforecasterPrompt(
  forecast: ForecastForPrompt,
  evidence: EvidenceForPrompt[]
): string {
  const evidenceSummary =
    evidence.length > 0
      ? evidence
          .map(
            (e) =>
              `- [${e.signal.toUpperCase()}] ${e.sourceTitle}: ${e.excerpt}`
          )
          .join("\n")
      : "No evidence collected yet.";

  return `You are a calibrated superforecaster. Given the following forecast question and evidence, provide an updated probability estimate.

QUESTION: ${forecast.question}
RESOLUTION DATE: ${forecast.resolutionDate}
RESOLUTION CRITERIA: ${forecast.resolutionCriteria}
CURRENT PROBABILITY: ${forecast.probability != null ? (forecast.probability * 100).toFixed(0) + "%" : "Not set"}
BASE RATE: ${forecast.baseRate != null ? (forecast.baseRate * 100).toFixed(0) + "%" : "Unknown"}

EXISTING EVIDENCE:
${evidenceSummary}

CURRENT DRIVERS: ${forecast.topDrivers.join("; ") || "None"}
CURRENT COUNTERARGUMENTS: ${forecast.topCounterarguments.join("; ") || "None"}

Instructions:
1. Consider the base rate and adjust from there (reference class forecasting).
2. Weight evidence by recency and source quality.
3. Be well-calibrated: if you say 70%, events like this should happen 70% of the time.
4. Avoid extremes unless evidence is overwhelming (stay between 5% and 95%).

Respond in this exact JSON format:
{
  "probability": 0.XX,
  "reasoning": "Brief explanation of your judgment (1-2 sentences)",
  "drivers": ["driver1", "driver2", "driver3"],
  "counterarguments": ["counter1", "counter2"]
}`;
}

// ─── Output Parsing ─────────────────────────────────────────────────────────

interface SuperforecasterOutput {
  probability: number | null;
  reasoning: string;
  drivers: string[];
  counterarguments: string[];
}

function parseSuperforecasterOutput(text: string): SuperforecasterOutput {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        probability:
          typeof parsed.probability === "number" ? parsed.probability : null,
        reasoning: parsed.reasoning || "",
        drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
        counterarguments: Array.isArray(parsed.counterarguments)
          ? parsed.counterarguments
          : [],
      };
    }
  } catch {
    // Fall through to default
  }

  return {
    probability: null,
    reasoning: "Failed to parse LLM output",
    drivers: [],
    counterarguments: [],
  };
}
