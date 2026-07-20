"use node";

/**
 * Daily Brief Worker (Worker Agent)
 *
 * Statelessly advances one failing/pending task in a dailyBriefMemory.
 */

import { v } from "convex/values";
import { internalAction, action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 400,
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

function normalizeWhitespace(input: string): string {
  return (input || "").replace(/\s+/g, " ").trim();
}

function clipText(input: string, maxLen: number): string {
  const cleaned = normalizeWhitespace(input);
  if (cleaned.length <= maxLen) return cleaned;
  const slice = cleaned.slice(0, maxLen);
  const sentenceEnd = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (sentenceEnd > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, lastSpace).trim();
  }
  return slice.trim();
}

function buildCoverageRollupFallback(items: Array<{
  title: string;
  summary: string;
  source?: string | null;
}>): { overallSummary: string; sourceSummaries: Array<{ source: string; summary: string; count: number }> } {
  const totalItems = items.length;
  const sourceMap = new Map<string, { count: number; samples: string[] }>();

  items.forEach((item) => {
    const source = item.source && item.source.trim() ? item.source.trim() : "Unknown";
    const entry = sourceMap.get(source) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (item.summary && entry.samples.length < 2) entry.samples.push(item.summary);
    sourceMap.set(source, entry);
  });

  const sources = Array.from(sourceMap.entries())
    .sort((a, b) => b[1].count - a[1].count);
  const sourceSummaries = sources.map(([source, data]) => ({
    source,
    count: data.count,
    summary: clipText(data.samples.join(" "), 140) || "Coverage concentrated in this source today.",
  }));

  const overallSummary = totalItems > 0
    ? `Coverage spans ${totalItems} items across ${sources.length} sources, led by ${sources[0]?.[0] ?? "top sources"}.`
    : "Coverage is still building for this cycle.";

  return { overallSummary, sourceSummaries };
}

function slugify(input: string): string {
  const normalized = normalizeWhitespace(input).toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "signal";
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
      const slice = unfenced.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function buildFallbackGraph(items: any[]) {
  const nodes = items.map((item, idx) => {
    const title = clipText(item?.title ?? `Signal ${idx + 1}`, 50);
    const id = `${slugify(title)}-${idx + 1}`;
    return {
      id,
      label: title,
      type: "concept",
      importance: idx === 0 ? 1 : 0.6,
      tier: 1,
    };
  });

  if (nodes.length === 0) {
    return {
      focusNodeId: "signal-1",
      nodes: [{ id: "signal-1", label: "Signal", type: "concept", importance: 1 }],
      edges: [],
    };
  }

  const focusNodeId = nodes[0].id;
  const edges = nodes.slice(1).map((node) => ({
    source: focusNodeId,
    target: node.id,
    relationship: "Relates",
    context: "Shared signal context",
    order: "primary",
  }));

  return { focusNodeId, nodes, edges };
}

async function buildStoryContext(ctx: any, source: any): Promise<string> {
  const base = normalizeWhitespace(source?.summary || "");
  const url = typeof source?.url === "string" ? source.url.trim() : "";
  if (base.length >= 120 || !url) {
    return base;
  }

  try {
    const reader: any = await ctx.runAction(
      (api as any).domains.research.readerContent.getReaderContent,
      { url, title: source?.title },
    );
    const excerpt = normalizeWhitespace(reader?.excerpt || "");
    if (excerpt.length >= 120) return excerpt;
  } catch {
    // Best-effort; fall back to feed summary.
  }

  return base;
}

async function buildDeepStoryContext(
  ctx: any,
  source: any,
  maxChars: number = 12000,
): Promise<string> {
  const base = normalizeWhitespace(source?.summary || "");
  const url = typeof source?.url === "string" ? source.url.trim() : "";
  if (!url) return base;

  try {
    const reader: any = await ctx.runAction(
      (api as any).domains.research.readerContent.getReaderContent,
      { url, title: source?.title },
    );
    const content = normalizeWhitespace(reader?.content || reader?.excerpt || "");
    if (content) return clipText(content, maxChars);
  } catch {
    // Best-effort; fall back to feed summary.
  }

  return base;
}

async function executeFeature(
  ctx: any,
  feature: any,
  memory: any,
  modelOverride?: string,
): Promise<{ status: "passing" | "failing"; markdown: string; notes?: string }> {
  const source = feature.sourceRefs?.feedItem ?? feature.sourceRefs ?? null;
  let systemPrompt =
    "You are a senior research analyst. Produce crisp, evidence-based markdown.";
  let maxTokens = 500;
  let deepStoryContext: string | null = null;

  let userPrompt = `TASK: ${feature.name}\n\nCRITERIA:\n${feature.testCriteria}\n\nSOURCE:\n${JSON.stringify(
    source,
    null,
    2,
  )}\n\nCONTEXT (metrics + summary):\n${JSON.stringify(
    memory.context,
    null,
    2,
  )}\n\nOUTPUT: Provide a concise markdown response that satisfies the criteria.`;

  if (feature.type === "repo_analysis") {
    userPrompt =
      `Analyze the GitHub repo described below.\n\n` +
      `Criteria: ${feature.testCriteria}\n\n` +
      `Repo/Feed data:\n${JSON.stringify(source, null, 2)}\n\n` +
      `Return markdown with sections: Purpose, Key Features, Recent Signals, Relevance to NodeBench AI.`;
  } else if (feature.type === "paper_summary") {
    userPrompt =
      `Summarize the research paper described below.\n\n` +
      `Criteria: ${feature.testCriteria}\n\n` +
      `Paper/Feed data:\n${JSON.stringify(source, null, 2)}\n\n` +
      `Return markdown with sections: Main Contribution, Methodology, Results, Implications.`;
  } else if (feature.type === "story_summary") {
    const storyContext = await buildDeepStoryContext(ctx, source, 8000);
    systemPrompt =
      "You are a senior research analyst. Write a concise, high-signal summary.";
    maxTokens = 320;
    userPrompt =
      `Summarize the story below for a morning intelligence digest. ` +
      `Return 3-4 sentences of plain text (no bullets). ` +
      `Sentence 1 must start with "What happened:" and sentence 2 must start with "Why it matters:". ` +
      `Sentence 3 must start with "Key number:" using any numeric detail (points, dollars, %, headcount, dates). ` +
      `Sentence 4 should start with "Key quote:" if a direct quote exists; otherwise start with "Key detail:" and cite a specific fact. ` +
      `Use only the source text; do not invent.\n\n` +
      `Title: ${source?.title ?? "Untitled"}\n` +
      `Source: ${source?.source ?? "Unknown"}\n` +
      `URL: ${source?.url ?? "n/a"}\n` +
      `Context: ${storyContext || "No excerpt available."}\n`;
  } else if (feature.type === "story_intel") {
    const deepContext = await buildDeepStoryContext(ctx, source, 14000);
    deepStoryContext = deepContext;
    systemPrompt =
      "You are an Intelligence Officer. Extract hard facts and signal shifts. Output JSON only.";
    maxTokens = 420;
    userPrompt =
      `Extract intelligence from the source text. ` +
      `Return JSON with keys: summary, hard_numbers, direct_quote, conflict, pivot, lesson. ` +
      `Use null when missing. Keep summary to 1 sentence.\n\n` +
      `Title: ${source?.title ?? "Untitled"}\n` +
      `Source: ${source?.source ?? "Unknown"}\n` +
      `URL: ${source?.url ?? "n/a"}\n` +
      `Full Text:\n${deepContext || "No content available."}\n`;
  } else if (feature.type === "graph_extraction") {
    const items = Array.isArray(feature.sourceRefs?.items)
      ? feature.sourceRefs.items
      : [];
    const contexts = await Promise.all(
      items.map(async (item: any) => {
        const deep = await buildDeepStoryContext(ctx, item, 9000);
        return `Title: ${item?.title ?? "Untitled"}\nURL: ${item?.url ?? "n/a"}\nText: ${deep}`;
      }),
    );
    systemPrompt =
      "You are a Knowledge Graph Architect. Output JSON only.";
    maxTokens = 500;
    userPrompt =
      `Analyze the texts and extract an entity relationship map. ` +
      `Return JSON: { focusNodeId, nodes, edges }. ` +
      `Nodes: { id, label, type, importance, tier }. ` +
      `Edges: { source, target, relationship, context, order }. ` +
      `tier: 1 for direct/primary nodes, 2 for second-order impact nodes. ` +
      `order: "primary" for direct edges, "secondary" for second-order effects. ` +
      `Use relationship verbs like Acquires, Partners, Competes, Launches, Impacts. ` +
      `Limit to 10 nodes and 12 edges.\n\n` +
      contexts.join("\n\n---\n\n");
  } else if (feature.type === "metric_anomaly") {
    userPrompt =
      `Investigate the metric anomaly described below.\n\n` +
      `Criteria: ${feature.testCriteria}\n\n` +
      `Delta data:\n${JSON.stringify(source, null, 2)}\n\n` +
      `Use today's top feed items to hypothesize causes. Provide a short markdown explanation with 2-4 bullet evidence points.`;
  }

  let text = await generateWithProvider(
    modelOverride ?? getLlmModel("analysis"),
    systemPrompt,
    userPrompt,
    maxTokens,
  );

  if (feature.type === "story_intel") {
    const parsed = tryParseJson(text);
    if (!parsed || typeof parsed !== "object") {
      const cleaned = clipText(normalizeWhitespace(text), 180);
      if (cleaned.length >= 30) {
        text = JSON.stringify(
          {
            summary: cleaned,
            hard_numbers: null,
            direct_quote: null,
            conflict: null,
            pivot: null,
            lesson: null,
          },
          null,
          2,
        );
      } else if (deepStoryContext) {
        const fallbackSummary = await generateWithProvider(
          modelOverride ?? getLlmModel("analysis"),
          "You are a senior research analyst. Provide a single-sentence summary.",
          `Summarize the source in one sentence.\n\n${deepStoryContext}`,
          120,
        );
        const summaryText = clipText(normalizeWhitespace(fallbackSummary), 180);
        if (summaryText) {
          text = JSON.stringify(
            {
              summary: summaryText,
              hard_numbers: null,
              direct_quote: null,
              conflict: null,
              pivot: null,
              lesson: null,
            },
            null,
            2,
          );
        }
      }
    }
  }

  if (feature.type === "graph_extraction") {
    const parsed = tryParseJson(text) as { nodes?: unknown[] } | null;
    if (!parsed || !Array.isArray(parsed.nodes)) {
      const items = Array.isArray(feature.sourceRefs?.items)
        ? feature.sourceRefs.items
        : [];
      text = JSON.stringify(buildFallbackGraph(items), null, 2);
    }
  }

  if (!text || text.trim().length < 20) {
    return {
      status: "failing",
      markdown: text?.trim() ? text : "",
      notes: "Worker returned insufficient output.",
    };
  }

  return { status: "passing", markdown: text };
}

export const summarizeCoverageRollup = internalAction({
  args: {
    items: v.array(
      v.object({
        title: v.string(),
        summary: v.string(),
        source: v.optional(v.string()),
        url: v.optional(v.string()),
        category: v.optional(v.string()),
      }),
    ),
    maxSources: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const items = args.items
      .filter((item: any) => item && item.summary)
      .map((item: any) => ({
        title: clipText(item.title, 120),
        summary: clipText(item.summary, 220),
        source: item.source ?? "Unknown",
        url: item.url,
        category: item.category,
      }));

    if (items.length === 0) {
      return {
        overallSummary: "Coverage is still building for this cycle.",
        sourceSummaries: [],
        themes: [],
      };
    }

    const maxSources = Math.max(1, Math.min(args.maxSources ?? 6, 10));
    const bySource = new Map<string, number>();
    items.forEach((item: any) => {
      const key = item.source?.trim() || "Unknown";
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    });

    const sourceCounts = Array.from(bySource.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSources)
      .map(([source, count]) => `${source} (${count})`)
      .join(", ");

    const contextLines = items
      .slice(0, 60)
      .map((item: any) => `- [${item.source}] ${item.title}: ${item.summary}`)
      .join("\n");

    const prompt =
      `You are an intelligence editor. Create a scan-ready rollup from the summaries below.\n` +
      `Return JSON with keys:\n` +
      `overall_summary (2-3 sentences),\n` +
      `source_summaries (array of {source, count, summary}),\n` +
      `themes (array of 3-5 short phrases).\n` +
      `Make each source summary 1 sentence. Keep concise and actionable.\n\n` +
      `Top sources: ${sourceCounts}\n\n` +
      `Summaries:\n${contextLines}\n`;

    let responseText = "";
    try {
      responseText = await generateWithProvider(
        getLlmModel("analysis"),
        "You are a senior intelligence editor. Output JSON only.",
        prompt,
        480,
      );
    } catch (err: any) {
      console.warn("[dailyBriefWorker] coverage rollup failed:", err?.message || err);
    }

    const parsed = tryParseJson(responseText) as {
      overall_summary?: string;
      overallSummary?: string;
      source_summaries?: Array<{ source?: string; count?: number; summary?: string }>;
      themes?: string[];
    } | null;
    if (parsed && typeof parsed === "object") {
      const overallSummary =
        typeof parsed.overall_summary === "string"
          ? parsed.overall_summary.trim()
          : typeof parsed.overallSummary === "string"
            ? parsed.overallSummary.trim()
            : null;
      const sourceSummaries = Array.isArray(parsed.source_summaries)
        ? parsed.source_summaries
            .filter((entry: { source?: string; summary?: string }) => entry && entry.source && entry.summary)
            .map((entry: { source?: string; count?: number; summary?: string }) => ({
              source: String(entry.source),
              count: typeof entry.count === "number" ? entry.count : (bySource.get(String(entry.source)) ?? 0),
              summary: String(entry.summary),
            }))
        : [];
      const themes = Array.isArray(parsed.themes)
        ? parsed.themes.filter((theme: string) => typeof theme === "string")
        : [];

      if (overallSummary) {
        return {
          overallSummary,
          sourceSummaries,
          themes,
        };
      }
    }

    const fallback = buildCoverageRollupFallback(items);
    return {
      overallSummary: fallback.overallSummary,
      sourceSummaries: fallback.sourceSummaries,
      themes: [],
    };
  },
});

export const runNextTaskInternal = internalAction({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
    taskId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const memory: any = args.memoryId
      ? await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getMemoryByIdInternal,
          { memoryId: args.memoryId },
        )
      : await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getLatestMemoryInternal,
          {},
        );

    if (!memory) {
      return { done: true, message: "No daily brief memory available." };
    }

    const features: any[] = memory.features ?? [];

    const forced = args.taskId
      ? features.find((f) => f.id === args.taskId)
      : null;

    const pending = features.filter(
      (f) => f?.status === "pending" || f?.status == null,
    );
    const failing = features.filter((f) => f?.status === "failing");

    if (pending.length === 0 && failing.length === 0) {
      return { done: true, memoryId: memory._id, message: "All tasks passing." };
    }

    const candidates = pending.length > 0 ? pending : failing;
    candidates.sort((a, b) => (a?.priority ?? 999) - (b?.priority ?? 999));

    const next = forced ?? candidates[0];
    if (!next) {
      return { done: true, memoryId: memory._id, message: "No runnable tasks." };
    }

    const exec = await executeFeature(ctx, next, memory, args.model ?? undefined);

    const resultId = await ctx.runMutation(
      internal.domains.research.dailyBriefMemoryMutations.insertTaskResult,
      {
        memoryId: memory._id,
        taskId: next.id,
        resultMarkdown: exec.markdown,
      },
    );

    await ctx.runMutation(
      internal.domains.research.dailyBriefMemoryMutations.updateTaskStatus,
      {
        memoryId: memory._id,
        taskId: next.id,
        status: exec.status,
        notes: exec.notes,
        resultId,
        logMessage: `${next.name} → ${exec.status}`,
        logStatus: exec.status,
        meta: { taskType: next.type },
      },
    );

    return {
      done: false,
      memoryId: memory._id,
      taskId: next.id,
      status: exec.status,
      resultId,
    };
  },
});

// Public wrapper for UI/on-demand runs. Requires auth.
export const runNextTask = action({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
    taskId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const res: any = await ctx.runAction(
      internal.domains.research.dailyBriefWorker.runNextTaskInternal,
      args,
    );
    return res;
  },
});
