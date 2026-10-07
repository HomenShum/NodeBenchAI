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

// ── Linkup search ────────────────────────────────────────────────────

async function searchLinkup(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!LINKUP_KEY) return [];
  try {
    const resp = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINKUP_KEY}` },
      body: JSON.stringify({ q: query, depth: "standard", outputType: "sourcedAnswer" }),
      signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json() as {
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
  } catch { return []; }
}

// ── Brave Search ─────────────────────────────────────────────────────

async function searchBrave(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!BRAVE_KEY) return [];
  try {
    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: { "X-Subscription-Token": BRAVE_KEY, Accept: "application/json" },
      signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
    return (data.web?.results ?? []).map((r) => ({
      name: r.title ?? r.url ?? "",
      url: r.url ?? "",
      content: (r.description ?? "").slice(0, 2000),
      provider: "brave",
    }));
  } catch { return []; }
}

// ── Serper (Google SERP) ─────────────────────────────────────────────

async function searchSerper(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!SERPER_KEY) return [];
  try {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": SERPER_KEY },
      body: JSON.stringify({ q: query, num: 10 }),
      signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
    return (data.organic ?? []).map((r) => ({
      name: r.title ?? r.link ?? "",
      url: r.link ?? "",
      content: (r.snippet ?? "").slice(0, 2000),
      provider: "serper",
    }));
  } catch { return []; }
}

// ── Tavily ───────────────────────────────────────────────────────────

async function searchTavily(query: string, signal: AbortSignal): Promise<RawSource[]> {
  if (!TAVILY_KEY) return [];
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: "basic", max_results: 10 }),
      signal,
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }> };
    return (data.results ?? []).map((r) => ({
      name: r.title ?? r.url ?? "",
      url: r.url ?? "",
      content: (r.content ?? "").slice(0, 2000),
      relevanceScore: r.score,
      provider: "tavily",
    }));
  } catch { return []; }
}

// ── Multi-provider parallel search ───────────────────────────────────

export interface MultiSearchResult {
  sources: RawSource[];
  providers: string[];
  totalBeforeDedup: number;
}

export async function multiSearch(query: string, timeoutMs = 10000): Promise<MultiSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const providers: Array<{ name: string; fn: () => Promise<RawSource[]> }> = [];

  // Free providers first. Linkup is paid and only enabled by explicit env.
  if (BRAVE_KEY) providers.push({ name: "brave", fn: () => searchBrave(query, controller.signal) });
  if (SERPER_KEY) providers.push({ name: "serper", fn: () => searchSerper(query, controller.signal) });
  if (TAVILY_KEY) providers.push({ name: "tavily", fn: () => searchTavily(query, controller.signal) });
  if (ALLOW_PAID_SEARCH && LINKUP_KEY) providers.push({ name: "linkup", fn: () => searchLinkup(query, controller.signal) });

  // Run all in parallel
  const results = await Promise.allSettled(providers.map((p) => p.fn()));
  clearTimeout(timer);

  // Merge results
  const allSources: RawSource[] = [];
  const activeProviders: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "fulfilled" && result.value.length > 0) {
      allSources.push(...result.value);
      activeProviders.push(providers[i]!.name);
    }
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
