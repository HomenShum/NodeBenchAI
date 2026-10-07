/**
 * Phase 9a — GDELT-lite ingestion for §1 Pulse + §6 Footnotes.
 *
 * Resolves Phase 9 deferred item #15 ("GDELT integration") from
 * `docs/architecture/EDITION_INGESTION_FLYWHEEL.md`.
 *
 * The Phase 9 deferred doc claimed GDELT requires "$50/mo Cloud API
 * OR self-hosted BigQuery."  Not true for the Doc 2.0 endpoint:
 * `https://api.gdeltproject.org/api/v2/doc/doc?...&format=json`
 * is FREE with no key, rate-limited to ~1 req/sec.  This is
 * sufficient for a daily news-volume signal on AI-agent topics.
 *
 * What this adds:
 *   - One daily fetch of `query=ai+agent` (URL-encoded) returning
 *     the latest articles in JSON.
 *   - Each article becomes an `industryUpdates` row (provider="gdelt")
 *     and a paired `evidenceArtifacts` footnote.
 *   - Diversifies §1 trending beyond HN/arXiv (US-tech-heavy) with
 *     global-news angle.
 *
 * Reuses existing upsert mutations from publicTrendingSeed so URL
 * dedupe logic is shared.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          MAX_GDELT_ARTICLES = 8 hard cap; 2 MB read cap.
 *   - HONEST_STATUS  per-source counters; failure returns ok:false
 *                    and writes nothing.
 *   - HONEST_SCORES  relevance is a flat baseline (35) since GDELT
 *                    doesn't expose engagement signals — never invent
 *                    a higher score.
 *   - TIMEOUT        AbortController, 8s budget.
 *   - SSRF           hostname `api.gdeltproject.org` hardcoded.
 *   - BOUND_READ     2 MB streamed cap (GDELT can return larger
 *                    bodies than HN's tiny JSON).
 *   - ERROR_BOUNDARY action wraps fetch + parse in try/catch;
 *                    upserts only fire when articles parsed.
 *   - DETERMINISTIC  dedupe by URL through existing upsert paths.
 */

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

const ALLOWED_HOSTS = new Set(["api.gdeltproject.org"]);
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_GDELT_ARTICLES = 8;

// Flat baseline relevance for GDELT rows.  GDELT doesn't expose
// engagement (no votes, no stars).  HONEST_SCORES — never invent a
// number that suggests "how trending" without data.  35 sits below
// HN (variable, often 50+) and arXiv's flat 60 so HN/arXiv outrank
// in the editorial home's relevance ordering when both are present.
const GDELT_BASELINE_RELEVANCE = 35;

// URL-encoded `"AI agent"` (quoted phrase) so GDELT treats it as a
// single discriminating phrase, not two separate keyword hits.  Yields
// notably less noise than unquoted "ai+agent" (which matches "AI" OR
// "agent" anywhere in the article).
const GDELT_QUERY = "%22AI+agent%22";

/** Bounded fetch (mirrors publicTrendingSeed pattern). */
async function boundedFetch(url: string, label: string): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[gdeltSeed] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[gdeltSeed] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "nodebench-gdelt-seed/1.0 (mailto:editorial@nodebenchai.com)",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`[gdeltSeed] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[gdeltSeed] ${label}: no response body`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`[gdeltSeed] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`);
      }
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  seendate: string; // YYYYMMDDHHMMSS UTC
  socialimage?: string;
  language?: string;
  sourcecountry?: string;
}

/** Parse GDELT seendate `20260509180000` → ms epoch UTC. */
function parseSeendate(s: string): number {
  if (!/^\d{14}$/.test(s)) return Date.now();
  const yyyy = Number(s.slice(0, 4));
  const mm = Number(s.slice(4, 6)) - 1;
  const dd = Number(s.slice(6, 8));
  const hh = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const ss = Number(s.slice(12, 14));
  const t = Date.UTC(yyyy, mm, dd, hh, mi, ss);
  return Number.isFinite(t) ? t : Date.now();
}

async function fetchGdelt(): Promise<
  Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
    domain: string;
    sourceCountry: string;
  }>
> {
  // GDELT Doc 2.0 — free + no key.  `mode=ArtList` returns articles;
  // `format=json` requested explicitly.  `maxrecords` capped to our limit.
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?` +
    `query=${GDELT_QUERY}&` +
    `mode=ArtList&` +
    `maxrecords=${MAX_GDELT_ARTICLES}&` +
    `sort=DateDesc&` +
    `format=json`;
  const body = await boundedFetch(url, "gdelt");
  let parsed: { articles?: GdeltArticle[] };
  try {
    parsed = JSON.parse(body) as { articles?: GdeltArticle[] };
  } catch (err) {
    // GDELT very occasionally returns non-JSON when the query has no
    // matches — surface as "no articles" rather than throw.
    console.warn(`[gdeltSeed] non-JSON response: ${err}`);
    return [];
  }
  const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  const out: Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
    domain: string;
    sourceCountry: string;
  }> = [];
  for (const a of articles) {
    if (!a?.url || !a?.title) continue;
    if (typeof a.url !== "string" || !a.url.startsWith("http")) continue;
    out.push({
      url: a.url,
      title: a.title.slice(0, 280),
      summary: a.domain
        ? `Published by ${a.domain}${a.sourcecountry ? ` (${a.sourcecountry})` : ""}.`
        : "GDELT global-news index.",
      relevance: GDELT_BASELINE_RELEVANCE,
      publishedAt: parseSeendate(a.seendate ?? ""),
      domain: typeof a.domain === "string" ? a.domain : "unknown",
      sourceCountry:
        typeof a.sourcecountry === "string" ? a.sourcecountry : "global",
    });
  }
  return out;
}

/** Deterministic FNV-1a hash for footnote artifactId.  Mirrors
 * publicTrendingSeed's helper so re-running both seeds for the same
 * URL doesn't double-insert. */
function fnv1aHex(input: string): string {
  const offsets = [0x811c9dc5, 0xcbf29ce4, 0x84222325, 0x55555555];
  const out: string[] = [];
  for (const seed of offsets) {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out.push(hash.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

function computeFootnoteArtifactId(url: string, nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `pt:${fnv1aHex(JSON.stringify({ url, day }))}`;
}

/**
 * Cron entry point: pull GDELT, upsert industryUpdates + paired
 * footnote artifacts.  Reuses existing publicTrendingSeed mutations
 * so URL dedupe logic is shared.
 */
export const seedGdeltTrending = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    ok: boolean;
    fetched: number;
    inserted: number;
    skipped: number;
    footnotesInserted: number;
    error?: string;
  }> => {
    const now = Date.now();

    let articles: Awaited<ReturnType<typeof fetchGdelt>>;
    try {
      articles = await fetchGdelt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gdeltSeed] fetch failed: ${msg}`);
      return {
        ok: false,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        footnotesInserted: 0,
        error: msg,
      };
    }

    if (articles.length === 0) {
      console.log("[gdeltSeed] no articles returned");
      return {
        ok: true,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        footnotesInserted: 0,
      };
    }

    // 1. Industry-update rows.
    const trendingRows = articles.map((a) => ({
      provider: "gdelt",
      providerName: a.domain
        ? `GDELT · ${a.domain}`
        : "GDELT global news",
      url: a.url,
      title: a.title,
      summary: a.summary,
      relevance: a.relevance,
      scannedAt: now,
    }));

    const trendingResult = await ctx.runMutation(
      internal.domains.monitoring.publicTrendingSeed.upsertPublicTrending,
      { rows: trendingRows },
    );

    // 2. Footnote-artifact rows (one per article).
    const footnoteRows = articles.map((a) => ({
      artifactId: computeFootnoteArtifactId(a.url, now),
      url: a.url,
      canonicalUrl: a.url,
      publisher: a.domain || "GDELT",
      publishedAt: a.publishedAt,
      firstQuote: `${a.title}${a.summary ? ` — ${a.summary}` : ""}`.slice(0, 280),
      topics: ["gdelt", "ai-agent", a.sourceCountry].filter(Boolean) as string[],
      agentName: "gdeltSeed",
      toolName: "fetchGdelt",
      searchQuery: `gdelt query="${GDELT_QUERY}"`,
    }));

    let footnotesInserted = 0;
    try {
      const fnResult = await ctx.runMutation(
        internal.domains.monitoring.publicTrendingSeed.upsertPublicTrendingFootnotes,
        { rows: footnoteRows },
      );
      footnotesInserted = fnResult.inserted;
    } catch (err) {
      // ERROR_BOUNDARY — footnote upsert failure must not poison
      // the trending insert above (it already succeeded).  Log and
      // continue.
      console.warn(`[gdeltSeed] footnote upsert failed: ${err}`);
    }

    console.log(
      `[gdeltSeed] fetched=${articles.length} inserted=${trendingResult.inserted} ` +
        `skipped=${trendingResult.skipped} footnotes=${footnotesInserted}`,
    );

    return {
      ok: true,
      fetched: articles.length,
      inserted: trendingResult.inserted,
      skipped: trendingResult.skipped,
      footnotesInserted,
    };
  },
});
