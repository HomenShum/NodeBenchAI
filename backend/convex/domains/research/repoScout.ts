"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { createHash } from "crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";
import { linkupSearch } from "../../tools/media/linkupSearch";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type SourceMatrixItem = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
};

type MoatAnalysis = {
  moatSummary?: string;
  moatRisks?: string[];
};

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 360,
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

function extractSourceGalleryData(raw: string): SourceMatrixItem[] {
  const match = raw.match(/<!--\s*SOURCE_GALLERY_DATA\s*\n([\s\S]*?)\n\s*-->/);
  if (!match || !match[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.url)
      .map((item) => ({
        title: item.title || item.name || "Source",
        url: item.url,
        domain: item.domain,
        snippet: item.description || item.snippet,
      }));
  } catch {
    return [];
  }
}

function extractGitHubUrls(raw: string): string[] {
  const urls = new Set<string>();
  const regex = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    urls.add(match[0].replace(/\.git$/, ""));
  }
  return Array.from(urls);
}

function buildSignalKey(title: string, summary?: string, url?: string) {
  const payload = `${title}|${summary ?? ""}|${url ?? ""}`;
  return `repo-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function computeStarVelocity(starHistory: Array<{ stars?: number; delta?: number }>) {
  const recent = starHistory.slice(-7);
  if (!recent.length) return 0;
  const total = recent.reduce((sum, item) => sum + (item.delta ?? item.stars ?? 0), 0);
  return Math.round(total / recent.length);
}

function computeCommitVelocity(commitHistory: Array<{ commits?: number }>) {
  const recent = commitHistory.slice(-4);
  if (!recent.length) return 0;
  const total = recent.reduce((sum, item) => sum + (item.commits ?? 0), 0);
  return Math.round(total / recent.length);
}

function buildFallbackRepos(title: string) {
  const lower = title.toLowerCase();
  if (/salesforce|agentforce|agentic|crm/.test(lower)) {
    return [
      "https://github.com/microsoft/autogen",
      "https://github.com/Significant-Gravitas/AutoGPT",
      "https://github.com/crewAIInc/crewAI",
      "https://github.com/OpenAutoGLM/open-autoglm",
    ];
  }
  if (/model|llm/.test(lower)) {
    return [
      "https://github.com/vllm-project/vllm",
      "https://github.com/huggingface/transformers",
      "https://github.com/ollama/ollama",
    ];
  }
  return ["https://github.com/microsoft/autogen", "https://github.com/crewAIInc/crewAI"];
}

export const refreshRepoScout = action({
  args: {
    title: v.string(),
    summary: v.optional(v.string()),
    url: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const signalKey = buildSignalKey(args.title, args.summary, args.url);
    const existing = await ctx.runQuery(api.domains.research.repoScoutQueries.getRepoScout, {
      signalKey,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, report: existing };
      }
    }

    let linkupAnswer = "";
    let sources: SourceMatrixItem[] = [];
    const baseTool = linkupSearch as any;
    if (baseTool && typeof baseTool.execute === "function") {
      const tool = { ...baseTool, ctx };
      try {
        const query = `${args.title} open source repo github alternatives`;
        const result = await tool.execute(
          {
            query,
            depth: "standard",
            outputType: "sourcedAnswer",
            includeInlineCitations: true,
            includeSources: true,
            maxResults: 10,
            includeImages: false,
          },
          { toolCallId: "repoScout" },
        );
        if (typeof result === "string") {
          linkupAnswer = result;
          sources = extractSourceGalleryData(result);
        }
      } catch (err: any) {
        console.warn("[repoScout] Linkup search failed:", err?.message || err);
      }
    }

    const urlsFromSources = sources
      .map((item) => item.url)
      .filter((url) => url && url.includes("github.com"));
    const urlsFromText = extractGitHubUrls(linkupAnswer);
    const fallbackUrls = buildFallbackRepos(args.title);
    const directRepo = args.url && args.url.includes("github.com") ? args.url : null;
    const repoUrls = Array.from(
      new Set([directRepo, ...urlsFromSources, ...urlsFromText, ...fallbackUrls].filter(Boolean)),
    ).slice(0, 5);

    const repos = [] as any[];
    for (const repoUrl of repoUrls) {
      try {
        const result = await ctx.runAction(api.domains.research.repoStats.refreshRepoStats, {
          repoUrl,
        });
        const stats = result?.stats;
        if (!stats) continue;
        repos.push({
          name: stats.repoFullName || repoUrl.split("/").slice(-2).join("/"),
          url: stats.repoUrl || repoUrl,
          description: stats.description || "",
          stars: stats.stars ?? 0,
          starVelocity: computeStarVelocity(stats.starHistory ?? []),
          commitsPerWeek: computeCommitVelocity(stats.commitHistory ?? []),
          lastPush: stats.pushedAt,
          languages: stats.languages,
        });
      } catch (err) {
        continue;
      }
    }

    if (!repos.length) {
      fallbackUrls.slice(0, 3).forEach((repoUrl) => {
        repos.push({
          name: repoUrl.split("/").slice(-2).join("/"),
          url: repoUrl,
          description: "Repository metrics unavailable.",
          stars: 0,
          starVelocity: 0,
          commitsPerWeek: 0,
          lastPush: undefined,
          languages: undefined,
        });
      });
    }

    const systemPrompt =
      "You are a venture analyst mapping open-source disruption. Output JSON only.";
    const userPrompt =
      `Signal: ${args.title}\n` +
      `Repos: ${JSON.stringify(repos, null, 2)}\n\n` +
      `Return JSON with keys: moatSummary (2 sentences) and moatRisks (array of 3 bullets).`;

    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      systemPrompt,
      userPrompt,
      260,
    );

    const parsed = (tryParseJson(raw) ?? {}) as MoatAnalysis;
    const moatSummary = typeof parsed.moatSummary === "string" && parsed.moatSummary.trim().length > 0
      ? parsed.moatSummary.trim()
      : "Open-source alternatives are accelerating, compressing switching costs and time-to-implementation.";
    const moatRisks = Array.isArray(parsed.moatRisks)
      ? parsed.moatRisks.filter((item: string) => typeof item === "string").slice(0, 4)
      : ["Rapid OSS adoption", "Growing community velocity", "Enterprise pilots compressing sales cycles"];

    const record = {
      signalKey,
      signalTitle: args.title,
      signalSummary: args.summary ?? "",
      repos,
      moatSummary,
      moatRisks,
      fetchedAt: Date.now(),
    };

    if (existing?._id) {
      await ctx.runMutation(internal.domains.research.repoScoutQueries.patchRepoScout, {
        id: existing._id,
        updates: record,
      });
      return { cached: false, report: { ...existing, ...record } };
    }

    const id = await ctx.runMutation(internal.domains.research.repoScoutQueries.insertRepoScout, {
      record,
    });

    return { cached: false, report: { _id: id, ...record } };
  },
});
