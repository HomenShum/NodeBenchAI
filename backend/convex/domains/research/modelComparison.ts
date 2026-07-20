"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
  modelPricing,
} from "../../../shared/llm/modelCatalog";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 420,
): Promise<string> {
  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(modelInput),
  );

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  if (provider === "gemini") {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content || "";
}

function tryParseJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeRecommendation(input: unknown): "Buy" | "Wait" | "" {
  const value = asString(input).toLowerCase();
  if (value === "buy") return "Buy";
  if (value === "wait") return "Wait";
  return "";
}

function buildFallbackSummary(rows: Array<{ model: string; inputCostPer1M: number; outputCostPer1M: number; contextWindow: number }>) {
  if (!rows.length) return "Pricing comparison unavailable.";
  const byCost = [...rows].sort((a, b) => (a.inputCostPer1M + a.outputCostPer1M) - (b.inputCostPer1M + b.outputCostPer1M));
  const lowest = byCost[0];
  const highest = byCost[byCost.length - 1];
  const largestContext = [...rows].sort((a, b) => b.contextWindow - a.contextWindow)[0];
  return (
    `Pricing comparison across ${rows.length} models. ` +
    `Lowest blended cost is ${lowest.model} ($${lowest.inputCostPer1M}/${lowest.outputCostPer1M}); ` +
    `${highest.model} is highest, and ${largestContext.model} leads on context window.`
  );
}

function buildFallbackRecommendation(
  rows: Array<{ model: string; inputCostPer1M: number; outputCostPer1M: number }>,
  modelKey: string,
) {
  if (!rows.length) return "Wait";
  const key = modelKey.toLowerCase();
  const target = rows.find((row) => row.model.toLowerCase().includes(key)) ?? rows[0];
  const minCost = Math.min(...rows.map((row) => row.inputCostPer1M + row.outputCostPer1M));
  const targetCost = target.inputCostPer1M + target.outputCostPer1M;
  return targetCost <= minCost * 1.15 ? "Buy" : "Wait";
}

function buildRowPerformance(
  row: { model: string; inputCostPer1M: number; outputCostPer1M: number; contextWindow: number },
  allRows: Array<{ model: string; inputCostPer1M: number; outputCostPer1M: number; contextWindow: number }>,
) {
  const minCost = Math.min(...allRows.map((r) => r.inputCostPer1M + r.outputCostPer1M));
  const maxContext = Math.max(...allRows.map((r) => r.contextWindow));
  if (row.inputCostPer1M + row.outputCostPer1M === minCost) return "Lowest cost profile";
  if (row.contextWindow === maxContext) return "Largest context window";
  return "Balanced cost and context";
}

function estimateReliabilityScore(model: string) {
  const name = model.toLowerCase();
  if (name.includes("gpt") || name.includes("openai")) return 92;
  if (name.includes("claude") || name.includes("anthropic")) return 90;
  if (name.includes("gemini")) return 88;
  if (name.includes("llama")) return 82;
  return 85;
}

function selectModels(modelKey?: string) {
  const models = Object.keys(modelPricing);
  const defaults = ["gpt-5.4-mini", "claude-sonnet-4.6", "gemini-3.1-pro-preview"];
  const normalized = (modelKey || "").toLowerCase();

  const matches = models.find((m) => normalized && m.toLowerCase().includes(normalized));
  const selected = new Set<string>();

  if (matches) selected.add(matches);
  defaults.forEach((m) => selected.add(m));

  return Array.from(selected).slice(0, 4);
}

export const refreshModelComparison = action({
  args: {
    modelKey: v.string(),
    context: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.runQuery(api.domains.research.modelComparisonQueries.getModelComparison, {
      modelKey: args.modelKey,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, comparison: existing };
      }
    }

    const models = selectModels(args.modelKey);
    const rows = models.map((model) => {
      const pricing = modelPricing[model];
      return {
        model,
        inputCostPer1M: pricing?.inputPer1M ?? 0,
        outputCostPer1M: pricing?.outputPer1M ?? 0,
        contextWindow: pricing?.contextWindow ?? 0,
      };
    });

    const systemPrompt =
      "You are a CFO-grade AI strategist. Provide concise model trade-offs and a buy/wait recommendation.";
    const userPrompt =
      `Context: ${args.context ?? "Model update"}\n\n` +
      `Models and costs:\n${JSON.stringify(rows, null, 2)}\n\n` +
      `Return JSON with keys:\n` +
      `summary (2-3 sentences), recommendation ("Buy" or "Wait"), rows (array of {model, performance, notes, reliabilityScore}).\n` +
      `Focus on cost vs reliability and practical deployment impact.`;

    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      systemPrompt,
      userPrompt,
      420,
    );

    const parsed = (tryParseJson(raw) ?? {}) as {
      summary?: string;
      recommendation?: string;
      rows?: Array<{ model?: string; performance?: string; notes?: string; reliabilityScore?: number }>;
    };
    const perfRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const perfMap = new Map<string, { performance?: string; notes?: string; reliabilityScore?: number }>();
    perfRows.forEach((entry: any) => {
      if (entry?.model) {
        perfMap.set(String(entry.model), {
          performance: typeof entry.performance === "string" ? entry.performance : "",
          notes: typeof entry.notes === "string" ? entry.notes : "",
          reliabilityScore: typeof entry.reliabilityScore === "number" ? entry.reliabilityScore : undefined,
        });
      }
    });

    const fallbackSummary = buildFallbackSummary(rows);
    const fallbackRecommendation = buildFallbackRecommendation(rows, args.modelKey);
    const normalizedSummary = asString(parsed.summary) || fallbackSummary;
    const normalizedRecommendation = normalizeRecommendation(parsed.recommendation) || fallbackRecommendation;
    const mergedRows = rows.map((row) => {
      const performance = asString(perfMap.get(row.model)?.performance) || buildRowPerformance(row, rows);
      const notes = asString(perfMap.get(row.model)?.notes);
      const reliabilityScore = perfMap.get(row.model)?.reliabilityScore ?? estimateReliabilityScore(row.model);
      return {
        ...row,
        reliabilityScore,
        performance,
        notes,
      };
    });

    const record = {
      modelKey: args.modelKey,
      context: args.context ?? "",
      summary: normalizedSummary,
      recommendation: normalizedRecommendation,
      rows: mergedRows,
      sourceUrls: [],
      fetchedAt: Date.now(),
    };

    if (existing?._id) {
      await ctx.runMutation(internal.domains.research.modelComparisonQueries.patchModelComparison, {
        id: existing._id,
        updates: record,
      });
      return { cached: false, comparison: { ...existing, ...record } };
    }

    const id = await ctx.runMutation(internal.domains.research.modelComparisonQueries.insertModelComparison, {
      record,
    });
    return { cached: false, comparison: { _id: id, ...record } };
  },
});
