/**
 * Public-Trending Seed for industryUpdates
 * ─────────────────────────────────────────
 *
 * Forensic context (Track B, 2026-05-09 follow-up sprint):
 *   The editorial home's §1 Pulse falls back to a `public-trending` slice
 *   sourced from `industryUpdates` for guests with no auth/no anonymous
 *   session pulse history (`getTodayPulse` in editionQueries.ts:118).
 *   On prod, that table has been EMPTY because:
 *     1. The `enhancedIndustryScan` cron (crons.ts:67) only calls
 *        Grok-with-X-search and Grok-with-web-search to log discussions.
 *     2. It does NOT actually `ctx.db.insert("industryUpdates", ...)`
 *        — the original `scanIndustryUpdates` write path is commented
 *        out at line 209 of industryUpdatesEnhanced.ts.
 *     3. Result: cron has fired daily for weeks, written zero rows.
 *
 * Fix path:
 *   This module fetches HackerNews top stories + arXiv recent CS.AI
 *   submissions (both free, no API key required) and inserts them as
 *   `industryUpdates` rows. A daily cron (registered in crons.ts) keeps
 *   the table seeded so guest §1 always renders trending content.
 *
 *   This is INTENTIONALLY a free-tier ingestion path — no XAI key, no
 *   OpenAI key, no Linkup. Per the directive: "every empty section of
 *   the editorial home gets a free-tier ingestion path."
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - BOUND: maxRows hard cap, totalBytes cap on each fetch.
 *   - HONEST_STATUS: returns counts of inserted/skipped, never lies on failure.
 *   - TIMEOUT: AbortController with 8s budget per upstream fetch.
 *   - SSRF: only fixed allowlisted hosts (news.ycombinator.com, export.arxiv.org).
 *   - BOUND_READ: caps each response body at 256KB streaming.
 *   - DETERMINISTIC: dedup by canonical URL (sorted-key style) before insert.
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

// Bounds
const MAX_HN_STORIES = 8;
const MAX_ARXIV_PAPERS = 8;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256 * 1024; // 256 KB cap

// SSRF allowlist
const ALLOWED_HOSTS = new Set([
  "hacker-news.firebaseio.com",
  "news.ycombinator.com",
  "export.arxiv.org",
]);

/** Bounded fetch with timeout + size cap (per agentic_reliability.md). */
async function boundedFetch(url: string, label: string): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[publicTrendingSeed] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[publicTrendingSeed] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "nodebench-public-trending-seed/1.0" },
    });
    if (!res.ok) {
      throw new Error(`[publicTrendingSeed] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[publicTrendingSeed] ${label}: no response body`);
    }
    // BOUND_READ: stream and cap at MAX_RESPONSE_BYTES
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
        throw new Error(
          `[publicTrendingSeed] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`,
        );
      }
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/** HackerNews top-stories ingestion (free, no API key). */
async function fetchHnTrending(): Promise<
  Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
  }>
> {
  const idsRaw = await boundedFetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
    "HN topstories",
  );
  const allIds = JSON.parse(idsRaw) as number[];
  const topIds = allIds.slice(0, MAX_HN_STORIES);
  const stories: Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
  }> = [];
  for (const id of topIds) {
    try {
      const itemRaw = await boundedFetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        `HN item ${id}`,
      );
      const item = JSON.parse(itemRaw) as {
        title?: string;
        url?: string;
        score?: number;
        time?: number;
        descendants?: number;
        type?: string;
      };
      if (item.type !== "story" || !item.url || !item.title) continue;
      const score = typeof item.score === "number" ? item.score : 0;
      const comments =
        typeof item.descendants === "number" ? item.descendants : 0;
      // Relevance = points + comments, capped at 100. Honest score —
      // higher engagement = higher relevance, no fake floors.
      const relevance = Math.min(100, score + comments * 0.5);
      stories.push({
        url: item.url,
        title: item.title.slice(0, 280),
        summary: `${score} points, ${comments} comments on Hacker News.`,
        relevance,
        publishedAt: typeof item.time === "number" ? item.time * 1000 : Date.now(),
      });
    } catch (err) {
      console.warn(`[publicTrendingSeed] HN ${id} skipped:`, err);
    }
  }
  return stories;
}

/** arXiv cs.AI recent submissions (free, no API key). */
async function fetchArxivAi(): Promise<
  Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
  }>
> {
  // arXiv API: cs.AI most recent N submissions, sorted by submission date.
  const xml = await boundedFetch(
    `https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_ARXIV_PAPERS}`,
    "arXiv cs.AI",
  );
  // Hand-parse the Atom feed minimally — no XML parser dep.
  const entries: Array<{
    url: string;
    title: string;
    summary: string;
    relevance: number;
    publishedAt: number;
  }> = [];
  const entryBlocks = xml.split("<entry>").slice(1);
  for (const block of entryBlocks) {
    const idMatch = block.match(/<id>([^<]+)<\/id>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
    if (!idMatch || !titleMatch) continue;
    // arXiv returns http://arxiv.org/abs/... in <id>; alternate <link>
    // gives the canonical https URL. Normalize either way.
    let url = idMatch[1].trim();
    if (url.startsWith("http://arxiv.org/")) {
      url = url.replace("http://arxiv.org/", "https://arxiv.org/");
    }
    if (!url.startsWith("https://")) continue;
    const title = titleMatch[1]
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
    const summary = (summaryMatch?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    const publishedAt = publishedMatch
      ? Date.parse(publishedMatch[1].trim())
      : Date.now();
    if (!Number.isFinite(publishedAt)) continue;
    entries.push({
      url,
      title,
      summary,
      // arXiv submissions get a flat 60 — recent + curated, but we
      // don't have engagement data so we don't fake a higher score.
      relevance: 60,
      publishedAt,
    });
  }
  return entries;
}

/**
 * Internal mutation that idempotently inserts industryUpdates rows.
 * Idempotency key: canonical URL. If a row with the same URL exists,
 * skip insert (HONEST_STATUS — returns skipped count).
 */
export const upsertPublicTrending = internalMutation({
  args: {
    rows: v.array(
      v.object({
        provider: v.string(),
        providerName: v.string(),
        url: v.string(),
        title: v.string(),
        summary: v.string(),
        relevance: v.number(),
        scannedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      // Dedup by URL — bounded scan, take 1 (small table for guests).
      const existing = await ctx.db
        .query("industryUpdates")
        .filter((q) => q.eq(q.field("url"), row.url))
        .first();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.db.insert("industryUpdates", {
        provider: row.provider,
        providerName: row.providerName,
        url: row.url,
        title: row.title,
        summary: row.summary,
        relevance: row.relevance,
        actionableInsights: [],
        implementationSuggestions: [],
        status: "new" as const,
        scannedAt: row.scannedAt,
      });
      inserted++;
    }
    return { inserted, skipped, total: rows.length };
  },
});

/**
 * Public-trending seed action (cron + manual one-off entry point).
 *
 * Pulls HackerNews top stories + arXiv cs.AI recent submissions and
 * upserts them into industryUpdates. Designed to fail open per source
 * — if HN fetch errors, arXiv still seeds, and vice versa.
 *
 * Honest status invariants:
 *   - Returns count of rows actually inserted.
 *   - Returns count of rows skipped because URL already existed.
 *   - Returns per-source counts so monitoring can detect partial
 *     failures (e.g. HN works but arXiv blocked).
 */
export const seedPublicTrending = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Pull both sources in parallel, fail open per source.
    const [hnResult, arxivResult] = await Promise.allSettled([
      fetchHnTrending(),
      fetchArxivAi(),
    ]);

    const rows: Array<{
      provider: string;
      providerName: string;
      url: string;
      title: string;
      summary: string;
      relevance: number;
      scannedAt: number;
    }> = [];

    let hnFetched = 0;
    let arxivFetched = 0;

    if (hnResult.status === "fulfilled") {
      for (const story of hnResult.value) {
        rows.push({
          provider: "hackernews",
          providerName: "Hacker News",
          url: story.url,
          title: story.title,
          summary: story.summary,
          relevance: story.relevance,
          scannedAt: now,
        });
        hnFetched++;
      }
    } else {
      console.warn("[publicTrendingSeed] HN fetch failed:", hnResult.reason);
    }

    if (arxivResult.status === "fulfilled") {
      for (const paper of arxivResult.value) {
        rows.push({
          provider: "arxiv",
          providerName: "arXiv cs.AI",
          url: paper.url,
          title: paper.title,
          summary: paper.summary,
          relevance: paper.relevance,
          scannedAt: now,
        });
        arxivFetched++;
      }
    } else {
      console.warn(
        "[publicTrendingSeed] arXiv fetch failed:",
        arxivResult.reason,
      );
    }

    // If both sources failed entirely, do not write — preserve any
    // existing seeded content. The action returns honest 0s.
    if (rows.length === 0) {
      console.warn(
        "[publicTrendingSeed] both sources empty — no upsert",
      );
      return {
        hnFetched: 0,
        arxivFetched: 0,
        inserted: 0,
        skipped: 0,
        total: 0,
      };
    }

    const upsert = await ctx.runMutation(
      internal.domains.monitoring.publicTrendingSeed.upsertPublicTrending,
      { rows },
    );

    console.log(
      `[publicTrendingSeed] HN=${hnFetched} arXiv=${arxivFetched} ` +
        `inserted=${upsert.inserted} skipped=${upsert.skipped}`,
    );

    return {
      hnFetched,
      arxivFetched,
      inserted: upsert.inserted,
      skipped: upsert.skipped,
      total: upsert.total,
    };
  },
});
