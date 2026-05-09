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

// Phase 8a §6: cap footnote artifacts written per cron run.
// agentic_reliability::BOUND.
const MAX_FOOTNOTES_PER_RUN = 24;

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
 * Phase 8a §6: derive a deterministic artifactId for a public-trending
 * row's evidenceArtifacts entry.  Per agentic_reliability::DETERMINISTIC
 * — same URL+day → same hash, so re-runs collide and dedupe naturally.
 *
 * Format: stable JSON of { url, day } sorted by key, deterministic
 * 32-bit FNV-1a hash repeated 4 times for a 32-char hex; prefixed
 * 'pt:' so audit logs distinguish public-trending artifacts from
 * agent-generated ones.  Cryptographic strength is unnecessary for
 * an idempotency key — collision-resistance for the day+URL space
 * (~10^4 entries/day) is sufficient.
 */
function fnv1aHex(input: string): string {
  // Mix 4 separate FNV-1a runs with different offsets to give 128
  // bits of state (collision space ~3.4×10^38).  Output as 32-char
  // hex so it lines up with sha256 truncation that previously used.
  const offsets = [0x811c9dc5, 0xcbf29ce4, 0x84222325, 0x55555555];
  const out: string[] = [];
  for (const seed of offsets) {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      // FNV prime 16777619, multiply mod 2^32
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out.push(hash.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

function computeFootnoteArtifactId(url: string, dayMs: number): string {
  const day = new Date(dayMs).toISOString().slice(0, 10); // UTC YYYY-MM-DD
  // Sort-stable JSON: only two keys, alphabetic.
  const stable = JSON.stringify({ day, url });
  return `pt:${fnv1aHex(stable)}`;
}

/**
 * Phase 8a §6: idempotent insert of evidenceArtifacts rows derived from
 * public-trending data.  Each row pairs with one industryUpdates row
 * (same URL, same scannedAt) and gives §6 Footnotes a publisher +
 * first-quote + canonical URL — extending the 8 baseline footnotes
 * Track B already shows.
 *
 * Skips silently if `evidenceArtifacts.by_artifact_id` already has the
 * deterministic key.  HONEST_STATUS: returns counts, no fakes.
 */
export const upsertPublicTrendingFootnotes = internalMutation({
  args: {
    rows: v.array(
      v.object({
        artifactId: v.string(),
        url: v.string(),
        canonicalUrl: v.string(),
        publisher: v.string(),
        publishedAt: v.optional(v.number()),
        firstQuote: v.string(),
        topics: v.array(v.string()),
        agentName: v.string(),
        toolName: v.string(),
        searchQuery: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let inserted = 0;
    let skipped = 0;
    const now = Date.now();
    // Stable contentHash placeholder per row — public-trending doesn't
    // fetch the body, so we hash the (URL + first-quote + day) tuple.
    // This is HONEST: it's not a content hash; it's a footnote
    // identity hash, marked by the version string below.
    for (const row of rows) {
      const existing = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_artifact_id", (q) => q.eq("artifactId", row.artifactId))
        .first();
      if (existing) {
        skipped++;
        continue;
      }
      const day = new Date(now).toISOString().slice(0, 10);
      const stable = JSON.stringify({
        day,
        firstQuote: row.firstQuote,
        url: row.url,
      });
      // Footnote-identity hash, marked by `contentHashVersion:
      // "footnote-id-v1"`.  Collision-resistant for daily key space.
      const contentHash = fnv1aHex(stable);
      await ctx.db.insert("evidenceArtifacts", {
        artifactId: row.artifactId,
        artifactVersion: "1",
        urlNormalizationVersion: "v1",
        // Footnote identity, not body content — marker version.
        contentHashVersion: "footnote-id-v1",
        url: row.url,
        canonicalUrl: row.canonicalUrl,
        publisher: row.publisher,
        publishedAt: row.publishedAt,
        fetchedAt: now,
        contentHash,
        extractedQuotes: [{ text: row.firstQuote }],
        entities: [],
        topics: row.topics,
        // Public-trending sources are tier3 (HN/arXiv aggregators) per
        // narrativeSignalMetrics.sourceTier convention.
        credibilityTier: "tier3",
        retrievalTrace: {
          searchQuery: row.searchQuery,
          agentName: row.agentName,
          toolName: row.toolName,
        },
        createdAt: now,
      });
      inserted++;
    }
    return { inserted, skipped, total: rows.length };
  },
});

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

    // Phase 8a §6: write a paired evidenceArtifact for each row so
    // §6 Footnotes is rich (target ≥15-20 footnotes total, vs the 8
    // Track B already provides via the industryUpdates slice).
    //
    // Capped by MAX_FOOTNOTES_PER_RUN. Failures here MUST NOT poison
    // the trending insert above — wrap in try/catch and log.
    let footnoteUpsertInserted = 0;
    let footnoteUpsertSkipped = 0;
    try {
      const footnoteRows = rows.slice(0, MAX_FOOTNOTES_PER_RUN).map((r) => {
        const isHn = r.provider === "hackernews";
        const firstQuote = r.summary.trim().length > 0
          ? `${r.title} — ${r.summary}`.slice(0, 280)
          : r.title.slice(0, 280);
        const topics = isHn ? ["hacker-news", "trending"] : ["arxiv", "cs.AI"];
        return {
          artifactId: computeFootnoteArtifactId(r.url, now),
          url: r.url,
          canonicalUrl: r.url, // already canonical (https + no fragments).
          publisher: r.providerName,
          publishedAt: r.scannedAt,
          firstQuote,
          topics,
          agentName: "publicTrendingSeed",
          toolName: isHn ? "fetchHnTrending" : "fetchArxivAi",
          searchQuery: isHn ? "HN top stories" : "arXiv cs.AI recent",
        };
      });
      if (footnoteRows.length > 0) {
        const fnUpsert = await ctx.runMutation(
          internal.domains.monitoring.publicTrendingSeed
            .upsertPublicTrendingFootnotes,
          { rows: footnoteRows },
        );
        footnoteUpsertInserted = fnUpsert.inserted;
        footnoteUpsertSkipped = fnUpsert.skipped;
      }
    } catch (err) {
      // ERROR_BOUNDARY: footnote write failure must not silently
      // succeed and must not break the trending write above.
      console.warn("[publicTrendingSeed] footnote upsert failed:", err);
    }

    console.log(
      `[publicTrendingSeed] HN=${hnFetched} arXiv=${arxivFetched} ` +
        `inserted=${upsert.inserted} skipped=${upsert.skipped} ` +
        `footnotes_inserted=${footnoteUpsertInserted} ` +
        `footnotes_skipped=${footnoteUpsertSkipped}`,
    );

    return {
      hnFetched,
      arxivFetched,
      inserted: upsert.inserted,
      skipped: upsert.skipped,
      total: upsert.total,
      footnotesInserted: footnoteUpsertInserted,
      footnotesSkipped: footnoteUpsertSkipped,
    };
  },
});
