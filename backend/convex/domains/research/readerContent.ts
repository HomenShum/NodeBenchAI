"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { linkupSearch } from "../../tools/media/linkupSearch";

type SourceMatrixItem = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CONTENT_BYTES = 240 * 1024;
const MAX_EXCERPT_CHARS = 800;
const MAX_RAW_CHARS = 120000;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function clipToByteLimit(text: string, byteLimit: number): { text: string; bytes: number; truncated: boolean } {
  const originalBytes = Buffer.byteLength(text, "utf8");
  if (originalBytes <= byteLimit) {
    return { text, bytes: originalBytes, truncated: false };
  }

  const ratio = byteLimit / Math.max(originalBytes, 1);
  let end = Math.max(200, Math.floor(text.length * ratio));
  let clipped = text.slice(0, end);
  let clippedBytes = Buffer.byteLength(clipped, "utf8");

  while (clippedBytes > byteLimit && end > 200) {
    end = Math.max(200, Math.floor(end * 0.9));
    clipped = text.slice(0, end);
    clippedBytes = Buffer.byteLength(clipped, "utf8");
  }

  return { text: clipped, bytes: clippedBytes, truncated: true };
}

function buildExcerpt(text: string): string {
  if (!text) return "";
  if (text.length <= MAX_EXCERPT_CHARS) return text;
  return `${text.slice(0, MAX_EXCERPT_CHARS - 3)}...`;
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
        domain: item.domain || extractDomain(item.url),
        snippet: item.description || item.snippet,
      }));
  } catch {
    return [];
  }
}

async function fetchUrlText(url: string): Promise<{ text: string; contentType: string }> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let response: Response | null = null;
  try {
    response = await fetch(url, { headers });
  } catch {
    response = null;
  }

  if (!response || !response.ok) {
    const stripped = url.replace(/^https?:\/\//, "");
    const jinaUrls = [
      `https://r.jina.ai/http://${stripped}`,
      `https://r.jina.ai/https://${stripped}`,
    ];
    for (const jinaUrl of jinaUrls) {
      try {
        const jinaResp = await fetch(jinaUrl, {
          headers: {
            "User-Agent": headers["User-Agent"],
            Accept: "text/plain, text/html;q=0.9,*/*;q=0.8",
          },
        });
        if (jinaResp.ok) {
          const text = (await jinaResp.text()).slice(0, MAX_RAW_CHARS);
          return { text: normalizeWhitespace(text), contentType: "text/plain" };
        }
      } catch {
        // Try next fallback
      }
    }
    throw new Error("Unable to fetch URL content");
  }

  const contentType = response.headers.get("content-type") || "text/html";
  const rawText = await response.text();
  const cleaned = contentType.includes("text/html")
    ? normalizeWhitespace(stripHtml(rawText)).slice(0, MAX_RAW_CHARS)
    : normalizeWhitespace(rawText).slice(0, MAX_RAW_CHARS);
  return { text: cleaned, contentType };
}

async function fetchSourceMatrix(ctx: any, query: string): Promise<SourceMatrixItem[]> {
  const baseTool = linkupSearch as any;
  if (!baseTool || typeof baseTool.execute !== "function") {
    return [];
  }

  const tool = { ...baseTool, ctx };
  const result = await tool.execute({
    query,
    depth: "standard",
    outputType: "sourcedAnswer",
    includeInlineCitations: true,
    includeSources: true,
    maxResults: 8,
    includeImages: false,
  }, { toolCallId: "readerContent" });

  if (typeof result !== "string") return [];
  return extractSourceGalleryData(result).slice(0, 8);
}

export const getReaderContent: any = action({
  args: {
    url: v.string(),
    title: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = (await getAuthUserId(ctx)) ?? "anonymous";

    const existing: any = await ctx.runQuery(
      internal.domains.documents.fileQueries.getUrlAnalysisForUser,
      { url: args.url, userId },
    );

    const now = Date.now();
    const existingMeta: any = existing?.structuredData?.readerContent ?? {};
    const existingSources: SourceMatrixItem[] = existing?.structuredData?.sourceMatrix ?? [];
    const isFresh =
      !!existing &&
      !args.forceRefresh &&
      typeof existing.analyzedAt === "number" &&
      now - existing.analyzedAt < CACHE_TTL_MS;

    if (isFresh) {
      const cachedContent: string = existingMeta.content ?? existing.analysis ?? "";
      const cachedExcerpt: string = existingMeta.excerpt ?? buildExcerpt(cachedContent);
      const contentBytes: number = existingMeta.contentBytes ?? Buffer.byteLength(cachedContent, "utf8");
      return {
        ok: true,
        cached: true,
        url: args.url,
        content: cachedContent,
        excerpt: cachedExcerpt,
        contentBytes,
        isTruncated: existingMeta.isTruncated ?? false,
        sourceMatrix: existingMeta.sourceMatrix ?? existingSources,
        analyzedAt: existing.analyzedAt ?? existing._creationTime,
      };
    }

    const query = args.title?.trim() || args.url;

    const [contentResult, sourceResult] = await Promise.allSettled([
      fetchUrlText(args.url),
      fetchSourceMatrix(ctx, query),
    ]);

    if (contentResult.status !== "fulfilled") {
      const message = contentResult.reason?.message || "Failed to load content";
      throw new Error(message);
    }

    const sourceMatrix =
      sourceResult.status === "fulfilled" ? sourceResult.value : [];

    const { text, contentType } = contentResult.value;
    const { text: clipped, bytes, truncated } = clipToByteLimit(text, MAX_CONTENT_BYTES);
    const excerpt = buildExcerpt(clipped);

    const structuredData = {
      readerContent: {
        url: args.url,
        title: args.title,
        content: clipped,
        excerpt,
        contentBytes: bytes,
        isTruncated: truncated,
        fetchedAt: now,
        sourceMatrix,
      },
      sourceMatrix,
      sourceMatrixQuery: query,
    };

    await ctx.runMutation(
      internal.domains.documents.fileQueries.upsertUrlAnalysisForUser,
      {
        url: args.url,
        userId,
        analysis: clipped,
        structuredData,
        contentType,
      },
    );

    return {
      ok: true,
      cached: false,
      url: args.url,
      content: clipped,
      excerpt,
      contentBytes: bytes,
      isTruncated: truncated,
      sourceMatrix,
      analyzedAt: now,
    };
  },
});
