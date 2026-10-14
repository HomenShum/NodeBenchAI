/**
 * MultiSearch — Parallel search across multiple providers.
 *
 * Calls free providers first (Brave/Serper/Tavily), deduplicates by domain,
 * and only uses Linkup when paid search is explicitly enabled.
 *
 * Provider priority: Brave -> Serper -> Tavily -> Linkup only when allowed.
 * Each provider has a 10s timeout. Results are merged by URL dedup.
 */

import type { SearchSource } from "../pipeline/searchPipeline.js";
import { createPipelineBudget, fetchPipelineJson, PipelineHttpError, PIPELINE_PROVIDER_ROW_LIMIT } from "./pipelineHttp.js";

// ── Provider configs (from env) ──────────────────────────────────────

const LINKUP_KEY = process.env.LINKUP_API_KEY ?? "";
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY ?? "";
const SERPER_KEY = process.env.SERPER_API_KEY ?? "";
const TAVILY_KEY = process.env.TAVILY_API_KEY ?? "";
const ALLOW_PAID_SEARCH =
  process.env.NODEBENCH_ALLOW_PAID_SEARCH === "true" ||
  process.env.LINKUP_SEARCH_ALLOW_PAID === "true";

interface RawSource {
  name: string;
  url: string;
  content: string;
  thumbnailUrl?: string;
  imageCandidates?: string[];
  faviconUrl?: string;
  siteName?: string;
  relevanceScore?: number;
  provider: string;
}

function validateProviderItems(items: unknown, textFields: string[]): void {
  if (!Array.isArray(items) || items.length > PIPELINE_PROVIDER_ROW_LIMIT || items.some((item) =>
    !item || typeof item !== "object" || Array.isArray(item) ||
    textFields.some((field) => item[field] != null && typeof item[field] !== "string")
  )) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
}

// ── Linkup search ────────────────────────────────────────────────────

async function searchLinkup(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!LINKUP_KEY) return [];
  const data = await fetchPipelineJson("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINKUP_KEY}` },
      body: JSON.stringify({ q: query, depth: "standard", outputType: "sourcedAnswer" }),
    }, 1_048_576, signal, 10_000) as {
      results?: Array<{
        name?: string;
        title?: string;
        url?: string;
      content?: string;
      snippet?: string;
      thumbnailUrl?: string;
      thumbnail?: string;
      imageUrl?: string;
      image?: string;
      faviconUrl?: string;
      favicon?: string;
      siteName?: string;
      site_name?: string;
      images?: Array<{ thumbnailUrl?: string; thumbnail?: string; imageUrl?: string; url?: string }>;
    }>;
  };
    validateProviderItems(data.results, ["name", "title", "url", "content", "snippet"]);
    return (data.results ?? []).map((r) => ({
      name: r.name ?? r.title ?? r.url ?? "",
      url: r.url ?? "",
      content: (r.content ?? r.snippet ?? "").slice(0, 2000),
      thumbnailUrl: r.thumbnailUrl ?? r.thumbnail ?? r.imageUrl ?? r.image,
      imageCandidates: [
        r.thumbnailUrl,
        r.thumbnail,
        r.imageUrl,
        r.image,
        ...(Array.isArray(r.images) ? r.images.flatMap((image) => [image?.thumbnailUrl, image?.thumbnail, image?.imageUrl, image?.url]) : []),
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 4),
      faviconUrl: r.faviconUrl ?? r.favicon,
      siteName: r.siteName ?? r.site_name,
      provider: "linkup",
    }));
}

// ── Brave Search ─────────────────────────────────────────────────────

async function searchBrave(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!BRAVE_KEY) return [];
  const data = await fetchPipelineJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: { "X-Subscription-Token": BRAVE_KEY, Accept: "application/json" },
    }, 1_048_576, signal, 10_000) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    validateProviderItems(data.web?.results, ["title", "url", "description"]);
    return (data.web?.results ?? []).map((r) => ({
      name: r.title ?? r.url ?? "",
      url: r.url ?? "",
      content: (r.description ?? "").slice(0, 2000),
      provider: "brave",
    }));
}

// ── Serper (Google SERP) ─────────────────────────────────────────────

async function searchSerper(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!SERPER_KEY) return [];
  const data = await fetchPipelineJson("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": SERPER_KEY },
      body: JSON.stringify({ q: query, num: 10 }),
    }, 1_048_576, signal, 10_000) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
    validateProviderItems(data.organic, ["title", "link", "snippet"]);
    return (data.organic ?? []).map((r) => ({
      name: r.title ?? r.link ?? "",
      url: r.link ?? "",
      content: (r.snippet ?? "").slice(0, 2000),
      provider: "serper",
    }));
}

// ── Tavily ───────────────────────────────────────────────────────────

async function searchTavily(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!TAVILY_KEY) return [];
  const data = await fetchPipelineJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: "basic", max_results: 10 }),
    }, 1_048_576, signal, 10_000) as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }> };
    validateProviderItems(data.results, ["title", "url", "content"]);
    return (data.results ?? []).map((r) => ({
      name: r.title ?? r.url ?? "",
      url: r.url ?? "",
      content: (r.content ?? "").slice(0, 2000),
      relevanceScore: r.score,
      provider: "tavily",
    }));
}

// ── Multi-provider parallel search ───────────────────────────────────

export interface MultiSearchResult {
  sources: RawSource[];
  providers: string[];
  totalBeforeDedup: number;
  successfulProviderCount: number;
  failures: Array<{ provider: string; code: "UPSTREAM_FAILURE" | "INVALID_PROVIDER_RESPONSE"; upstreamStatus?: number }>;
}

export async function multiSearch(query: string, timeoutMs = 10000, signal?: AbortSignal): Promise<MultiSearchResult> {
  return runProviders(query, timeoutMs, signal, true);
}

/** Secondary evidence never repeats the already exhausted paid variants. */
export async function searchFreeProviders(query: string, timeoutMs: number, signal?: AbortSignal): Promise<MultiSearchResult> {
  return runProviders(query, timeoutMs, signal, false);
}

async function runProviders(query: string, timeoutMs: number, signal: AbortSignal | undefined, includePaid: boolean): Promise<MultiSearchResult> {
  const budget = createPipelineBudget(signal, timeoutMs);

  const providers: Array<{ name: string; fn: () => Promise<RawSource[]> }> = [];

  // Free providers first. Linkup is paid and only enabled by explicit env.
  if (BRAVE_KEY) providers.push({ name: "brave", fn: () => searchBrave(query, budget.signal) });
  if (SERPER_KEY) providers.push({ name: "serper", fn: () => searchSerper(query, budget.signal) });
  if (TAVILY_KEY) providers.push({ name: "tavily", fn: () => searchTavily(query, budget.signal) });
  if (includePaid && ALLOW_PAID_SEARCH && LINKUP_KEY) providers.push({ name: "linkup", fn: () => searchLinkup(query, budget.signal) });

  // Run all in parallel
  let results: PromiseSettledResult<RawSource[]>[];
  try { budget.signal.throwIfAborted(); results = await Promise.allSettled(providers.map((p) => p.fn())); }
  finally { budget.dispose(); }
  signal?.throwIfAborted();

  // Merge results
  const allSources: RawSource[] = [];
  const activeProviders: string[] = [];
  const failures: MultiSearchResult["failures"] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "fulfilled" && result.value.length > 0) {
      allSources.push(...result.value);
      activeProviders.push(providers[i]!.name);
    }
    if (result.status === "rejected") failures.push({ provider: providers[i]!.name, code: result.reason instanceof PipelineHttpError ? result.reason.code : "UPSTREAM_FAILURE", upstreamStatus: result.reason instanceof PipelineHttpError ? result.reason.upstreamStatus : undefined });
  }

  const totalBeforeDedup = allSources.length;

  // Deduplicate by domain (keep the one with most content)
  const byDomain = new Map<string, RawSource>();
  for (const src of allSources) {
    try {
      const domain = new URL(src.url).hostname.replace(/^www\./, "");
      const existing = byDomain.get(domain);
      if (!existing || src.content.length > existing.content.length) {
        byDomain.set(domain, src);
      }
    } catch {
      byDomain.set(src.url, src);
    }
  }

  return {
    sources: [...byDomain.values()].slice(0, 30),
    providers: activeProviders,
    totalBeforeDedup,
    successfulProviderCount: results.filter((result) => result.status === "fulfilled").length,
    failures,
  };
}

/**
 * Convert MultiSearch results to pipeline SearchSource format.
 */
export function toSearchSources(raw: RawSource[]): SearchSource[] {
  return raw.map((r, i) => {
    let domain = "";
    try { domain = new URL(r.url).hostname.replace(/^www\./, ""); } catch { domain = r.url; }
    return {
      name: r.name,
      url: r.url,
      snippet: r.content,
      thumbnailUrl: r.thumbnailUrl,
      imageCandidates: r.imageCandidates,
      faviconUrl: r.faviconUrl,
      siteName: r.siteName,
      relevanceScore: r.relevanceScore ?? 0.5,
      kind: "general" as const,
      domain,
      corroboration: "external" as const,
      qualityScore: r.relevanceScore ?? 0.5,
    };
  });
}

/**
 * Report which providers are configured.
 */
export function getConfiguredProviders(): string[] {
  const providers: string[] = [];
  if (BRAVE_KEY) providers.push("brave");
  if (SERPER_KEY) providers.push("serper");
  if (TAVILY_KEY) providers.push("tavily");
  if (ALLOW_PAID_SEARCH && LINKUP_KEY) providers.push("linkup");
  return providers;
}
