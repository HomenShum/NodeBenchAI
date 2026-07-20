"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import type { ActionCtx } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { makeWebSourceCitationId } from "../../../../shared/citations/webSourceCitations";

type PreparedSource = {
  url: string;
  title: string;
  publishedAtIso?: string;
  excerpt: string;
  citationId: string;
  artifactId: Id<"sourceArtifacts">;
};

function stripTagsToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, attr: "name" | "property", key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+${attr}=[\"']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
    "i"
  );
  const m = re.exec(html);
  return m?.[1]?.trim() || undefined;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m?.[1]?.trim() || undefined;
}

function extractLikelyArticleHtml(html: string): string {
  const start = html.search(/<article\b/i);
  if (start < 0) return html;
  const tail = html.slice(start);
  const endRel = tail.search(/<\/article>/i);
  if (endRel < 0) return tail;
  return html.slice(start, start + endRel + "</article>".length);
}

function tryParsePublishedIso(html: string): string | undefined {
  const candidates: Array<string | undefined> = [
    extractMeta(html, "property", "article:published_time"),
    extractMeta(html, "property", "og:published_time"),
    extractMeta(html, "name", "pubdate"),
    extractMeta(html, "name", "publish-date"),
    extractMeta(html, "name", "date"),
    extractMeta(html, "name", "DC.date.issued"),
  ];

  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  // Common JSON-LD: {"datePublished":"..."} or {"dateModified":"..."}
  // Best-effort regex extraction to keep deterministic and lightweight.
  const jsonLdDate =
    /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ||
    /"dateModified"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  if (jsonLdDate) {
    const t = Date.parse(jsonLdDate);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  // Microdata: itemprop="datePublished" content="..."
  const microdata =
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /itemprop=["']dateModified["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  if (microdata) {
    const t = Date.parse(microdata);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  const timeTag = /<time[^>]+datetime=[\"']([^\"']+)[\"'][^>]*>/i.exec(html)?.[1];
  if (timeTag) {
    const t = Date.parse(timeTag);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  return undefined;
}

function tryParsePublishedIsoFromHeaders(headers: Headers): string | undefined {
  const lastModified = headers.get("last-modified") || headers.get("Last-Modified");
  if (lastModified) {
    const t = Date.parse(lastModified);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return undefined;
}

async function fetchOne(
  ctx: ActionCtx,
  url: string,
  opts: { workflowId?: string; preferLinkup?: boolean }
): Promise<PreparedSource> {
  const citationId = makeWebSourceCitationId(url);
  const linkupAvailable = !!process.env.LINKUP_API_KEY;
  const preferLinkup = !!opts.preferLinkup && linkupAvailable;

  let raw = "";
  let contentType = "text/html; charset=utf-8";
  let headerPublishedAtIso: string | undefined;
  let bestPublishedAtIso: string | undefined;

  const fetchViaLinkup = async () => {
    // Linkup already persists a sourceArtifact and triggers indexing.
    const markdown = await ctx.runAction(api.tools.media.linkupFetch.linkupFetch, {
      url,
      renderJs: true,
      includeRawHtml: false,
      extractImages: false,
      forceRefresh: false,
    });
    raw = String(markdown || "");
    contentType = "text/markdown; charset=utf-8";
  };

  const fetchDirect = async () => {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "nodebench-ai/1.0 (didYouKnowSources)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!resp.ok) {
      const err: any = new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
      err.status = resp.status;
      throw err;
    }
    contentType = resp.headers.get("content-type") || contentType;
    headerPublishedAtIso = tryParsePublishedIsoFromHeaders(resp.headers);
    raw = await resp.text();

    // Cache best-effort publish time from the HTML probe before we potentially
    // fall back to Linkup (which returns markdown and may not include publish time).
    if ((contentType || "").includes("html")) {
      const probe = raw.slice(0, 120_000);
      bestPublishedAtIso = tryParsePublishedIso(probe) || headerPublishedAtIso || bestPublishedAtIso;
    } else {
      bestPublishedAtIso = headerPublishedAtIso || bestPublishedAtIso;
    }
  };

  const isThin = (s: string) => {
    const wordCount = s.split(/\s+/).filter(Boolean).length;
    return s.trim().length < 800 || wordCount < 120;
  };

  try {
    // Prefer direct fetch first (more reliable for many sites).
    await fetchDirect();
    const probe = raw.slice(0, 60_000);
    const probeText = stripTagsToText(probe);
    if (preferLinkup && linkupAvailable && isThin(probeText)) {
      await fetchViaLinkup();
    }
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : undefined;
    const shouldFallback =
      linkupAvailable && (status === 401 || status === 403 || status === 429 || status === 451);
    if (!shouldFallback) throw e;
    await fetchViaLinkup();
  }

  const rawCut = raw.slice(0, 140_000);
  const isHtml = contentType.includes("html");

  const title =
    (isHtml ? extractMeta(rawCut, "property", "og:title") : undefined) ||
    (isHtml ? extractTitle(rawCut) : undefined) ||
    url;

  const description =
    (isHtml ? extractMeta(rawCut, "name", "description") : undefined) ||
    (isHtml ? extractMeta(rawCut, "property", "og:description") : undefined) ||
    "";

  const publishedAtIso = bestPublishedAtIso || (isHtml ? (tryParsePublishedIso(rawCut) || headerPublishedAtIso) : undefined);
  const htmlForText = isHtml ? extractLikelyArticleHtml(rawCut) : rawCut;
  const visibleText = isHtml ? stripTagsToText(htmlForText) : rawCut;
  const excerpt = [description, visibleText.slice(0, 2600)]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join("\n\n")
    .trim()
    .slice(0, 3000);

  const artifact = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
    sourceType: "url_fetch",
    sourceUrl: url,
    title,
    rawContent: excerpt,
    mimeType: "text/plain; charset=utf-8",
    sizeBytes: excerpt.length,
    extractedData: {
      kind: "did_you_know_source",
      workflowId: opts.workflowId,
      citationId,
      contentType,
      publishedAtIso,
    },
    fetchedAt: Date.now(),
  });

  return {
    url,
    title,
    publishedAtIso,
    excerpt,
    citationId,
    artifactId: artifact.id,
  };
}

export const fetchSourcesForDidYouKnow = internalAction({
  args: {
    urls: v.array(v.string()),
    workflowId: v.optional(v.string()),
    preferLinkup: v.optional(v.boolean()),
    maxUrls: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PreparedSource[]> => {
    const maxUrls = Math.min(Math.max(1, args.maxUrls ?? 3), 5);
    const inputUrls: string[] = Array.isArray(args.urls)
      ? (args.urls as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const urls = [...new Set(inputUrls.map((u) => u.trim()).filter((u) => u.length > 0))].slice(0, maxUrls);
    const out: PreparedSource[] = [];
    for (const url of urls) {
      out.push(await fetchOne(ctx, url, { workflowId: args.workflowId, preferLinkup: !!args.preferLinkup }));
    }
    return out;
  },
});
