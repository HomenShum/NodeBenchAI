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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 500,
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

function parseArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i);
  if (!match) return null;
  return match[1].replace(/\.pdf$/i, "");
}

function normalizePaperId(url: string) {
  const arxivId = parseArxivId(url);
  if (arxivId) {
    return { paperId: arxivId, isArxiv: true };
  }
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  return { paperId: `url-${hash}`, isArxiv: false };
}

function extractEntryField(entry: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = entry.match(regex);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").trim();
}

function extractAuthors(entry: string): string[] {
  const names: string[] = [];
  const regex = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(entry)) !== null) {
    names.push(match[1].replace(/\s+/g, " ").trim());
  }
  return names;
}

async function fetchArxivMetadata(paperId: string) {
  const url = `https://export.arxiv.org/api/query?id_list=${paperId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status}`);
  }
  const xml = await response.text();
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) return null;
  const entry = entryMatch[1];
  const title = extractEntryField(entry, "title");
  const summary = extractEntryField(entry, "summary");
  const publishedAt = extractEntryField(entry, "published");
  const authors = extractAuthors(entry);
  return { title, summary, publishedAt, authors };
}

async function fetchSemanticScholar(title: string) {
  if (!title) return null;
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", title);
  url.searchParams.set("limit", "1");
  url.searchParams.set("fields", "title,authors,citationCount,url,externalIds");
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "nodebench-ai" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const paper = data?.data?.[0];
  if (!paper) return null;
  return {
    title: paper.title,
    authors: Array.isArray(paper.authors)
      ? paper.authors.map((author: any) => author?.name).filter(Boolean)
      : [],
    citationCount: typeof paper.citationCount === "number" ? paper.citationCount : undefined,
    url: paper.url,
    doi: paper.externalIds?.DOI ?? undefined,
  };
}

function extractSourceGalleryData(raw: string) {
  const match = raw.match(/<!--\s*SOURCE_GALLERY_DATA\s*\n([\s\S]*?)\n\s*-->/);
  if (!match || !match[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.url).map((item) => ({
      title: item.title || item.name || "Source",
      url: item.url,
      snippet: item.description || item.snippet,
    }));
  } catch {
    return [];
  }
}

function isErrorContent(text: string) {
  return /404|not found|page not found/i.test(text);
}

export const refreshPaperDetails = action({
  args: {
    url: v.string(),
    title: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { paperId, isArxiv } = normalizePaperId(args.url);

    const existing = await ctx.runQuery(api.domains.research.paperDetailsQueries.getPaperDetails, {
      paperId,
      url: args.url,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, details: existing };
      }
    }

    let metadata: any = null;
    if (isArxiv) {
      metadata = await fetchArxivMetadata(paperId);
    }

    const readerContent: any = await ctx.runAction(
      api.domains.research.readerContent.getReaderContent,
      { url: args.url, title: args.title ?? metadata?.title ?? undefined },
    );

    let alternateUrl: string | null = null;
    let alternateContent: string | null = null;
    let fallbackText: string | null = null;
    let fallbackSourceUrls: string[] = [];
    if (isErrorContent(readerContent?.excerpt || "")) {
      const baseTool = linkupSearch as any;
      if (baseTool && typeof baseTool.execute === "function") {
        const tool = { ...baseTool, ctx };
        try {
          const query = `${args.title ?? metadata?.title ?? args.url} research paper pdf`;
          const result = await tool.execute(
            {
              query,
              depth: "standard",
              outputType: "searchResults",
              includeInlineCitations: true,
              includeSources: true,
              maxResults: 6,
              includeImages: false,
            },
            { toolCallId: "paperDetailsFallback" },
          );
          if (typeof result === "string") {
            fallbackText = result;
            const sources = extractSourceGalleryData(result);
            fallbackSourceUrls = sources.map((item: any) => item.url).filter(Boolean).slice(0, 4);
            const fallback = sources.find((item: any) => item.url && (/arxiv|pdf|doi/i.test(item.url)));
            if (fallback?.url) {
              alternateUrl = fallback.url;
              const altReader: any = await ctx.runAction(
                api.domains.research.readerContent.getReaderContent,
                { url: alternateUrl, title: args.title ?? metadata?.title ?? undefined },
              );
              alternateContent = altReader?.content ?? altReader?.excerpt ?? null;
            }
          }
        } catch {
          alternateUrl = null;
        }
      }
    }

    const content = [metadata?.summary, alternateContent, fallbackText, readerContent?.excerpt, readerContent?.content]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 14000);

    const prompt =
      `Extract research details from the text below. Return JSON with keys:\n` +
      `title, methodology (1-2 sentences), keyFindings (array of 3-5 bullets), authors (array), ` +
      `doi (string), pdfUrl (string).\n` +
      `If a named compound or benchmark appears, include it in keyFindings.\n\n` +
      `${content}`;

    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      "You are a research analyst. Output JSON only.",
      prompt,
      420,
    );

    interface ParsedPaperDetails {
      title?: string;
      methodology?: string;
      keyFindings?: string[];
      authors?: string[];
      doi?: string;
      pdfUrl?: string;
    }
    const parsed = (tryParseJson(raw) ?? {}) as ParsedPaperDetails;
    const keyFindings = Array.isArray(parsed.keyFindings)
      ? parsed.keyFindings.filter((item: string) => typeof item === "string")
      : [];

    const title =
      (typeof parsed.title === "string" && parsed.title.trim()) ||
      metadata?.title ||
      readerContent?.title ||
      args.title ||
      "";

    const semanticScholar = await fetchSemanticScholar(title);

    const record = {
      paperId,
      url: args.url,
      title,
      abstract: metadata?.summary ?? readerContent?.excerpt ?? "",
      methodology: typeof parsed.methodology === "string" ? parsed.methodology : "",
      keyFindings,
      authors: parsed.authors && Array.isArray(parsed.authors)
        ? parsed.authors.filter((item: string) => typeof item === "string")
        : metadata?.authors ?? semanticScholar?.authors ?? [],
      citationCount: typeof semanticScholar?.citationCount === "number" ? semanticScholar.citationCount : 0,
      doi: typeof parsed.doi === "string" ? parsed.doi : semanticScholar?.doi,
      pdfUrl: typeof parsed.pdfUrl === "string" && parsed.pdfUrl.trim().length > 0
        ? parsed.pdfUrl
        : isArxiv
          ? `https://arxiv.org/pdf/${paperId}.pdf`
          : undefined,
      publishedAt: metadata?.publishedAt ?? "",
      sourceUrls: [args.url, alternateUrl, semanticScholar?.url, isArxiv ? `https://arxiv.org/pdf/${paperId}.pdf` : undefined, ...fallbackSourceUrls]
        .filter(Boolean),
      fetchedAt: Date.now(),
    };

    if (existing?._id) {
      await ctx.runMutation(internal.domains.research.paperDetailsQueries.patchPaperDetails, {
        id: existing._id,
        updates: record,
      });
      return { cached: false, details: { ...existing, ...record } };
    }

    const id = await ctx.runMutation(internal.domains.research.paperDetailsQueries.insertPaperDetails, {
      record,
    });
    return { cached: false, details: { _id: id, ...record } };
  },
});
