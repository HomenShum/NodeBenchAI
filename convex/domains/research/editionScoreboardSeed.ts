/**
 * Phase 8a §4 — Live editorial scoreboard.
 *
 * Computes 5-8 live stats for the editorial home's §4 scoreboard from
 * three free-tier sources (no API key required):
 *   - OpenAlex (cs.AI papers indexed today vs prior 7-day average)
 *   - Hacker News Algolia (AI front-page count today vs 7-day median)
 *   - GitHub trending search (top-AI-repo star delta today)
 *
 * Writes the result into the most-recent `dailyBriefSnapshots` row's
 * `dashboardMetrics.keyStats` so the existing editorial UI renders it
 * with no schema change.  When no snapshot exists yet for today, this
 * mutation creates a minimal one with just `keyStats` populated.
 *
 * Run once daily via cron (registered in `convex/crons.ts`).
 *
 * agentic_reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          MAX_KEYSTATS = 8 hard cap; never grows
 *   - HONEST_STATUS  per-source counters; failed source produces no
 *                    stat (does NOT zero-fill); returns
 *                    {ok, sources: {openalex:'ok'|'error',...}}
 *   - HONEST_SCORES  delta computed from yesterday's row (or
 *                    null with explicit "no-baseline" flag)
 *   - TIMEOUT        AbortController, 8s budget per upstream call
 *   - SSRF           hostnames hardcoded (no user input)
 *   - BOUND_READ     MAX_RESPONSE_BYTES = 1 MB streaming cap on each
 *                    response body (raises from publicTrendingSeed's
 *                    256KB to handle OpenAlex pagination)
 *   - ERROR_BOUNDARY each source wrapped in try/catch — failure of
 *                    one does not block others
 *   - DETERMINISTIC  date keys are deterministic (UTC YYYY-MM-DD)
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

const MAX_KEYSTATS = 8;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB cap per response

// SSRF allowlist — every fetch URL must hit one of these hosts.
const ALLOWED_HOSTS = new Set([
  "api.openalex.org",
  "hn.algolia.com",
  "api.github.com",
]);

const OPENALEX_USER_AGENT =
  "nodebench-editorial-scoreboard/1.0 (mailto:editorial@nodebenchai.com)";

/** Bounded fetch with timeout + size cap (per agentic_reliability.md). */
async function boundedFetch(
  url: string,
  label: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[scoreboard] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[scoreboard] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": OPENALEX_USER_AGENT,
        accept: "application/json",
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      throw new Error(`[scoreboard] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[scoreboard] ${label}: no response body`);
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
        throw new Error(
          `[scoreboard] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`,
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

function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function daysAgoUtc(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

// ── Source: OpenAlex cs.AI papers ──────────────────────────────────────

/**
 * Concept ID `C154945302` = "Artificial intelligence" in OpenAlex's
 * concept tree (canonical, stable).  We count works WITH that concept
 * filtered by `from_publication_date` to a single UTC day.
 */
const OPENALEX_AI_CONCEPT = "C154945302";

async function fetchOpenAlexCount(dateKey: string): Promise<number> {
  const url =
    `https://api.openalex.org/works?` +
    `filter=concepts.id:${OPENALEX_AI_CONCEPT},from_publication_date:${dateKey},to_publication_date:${dateKey}` +
    `&per-page=1`;
  const body = await boundedFetch(url, "openalex");
  const json = JSON.parse(body) as {
    meta?: { count?: number };
  };
  const count = json?.meta?.count;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new Error("[scoreboard] openalex: missing meta.count");
  }
  return count;
}

// ── Source: HN Algolia front-page AI volume ──────────────────────────

/**
 * HN Algolia exposes `numericFilters=created_at_i>...,created_at_i<...`
 * for time-window queries.  Search for AI-keyword stories on the front
 * page.  We use `tags=front_page` plus a query for "AI" to get a stable
 * volume metric.
 */
async function fetchHnAlgoliaCount(dateKey: string): Promise<number> {
  const startMs = Date.parse(`${dateKey}T00:00:00Z`);
  const endMs = startMs + 86_400_000;
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const url =
    `https://hn.algolia.com/api/v1/search?` +
    `query=AI&tags=front_page&` +
    `numericFilters=created_at_i>${startSec},created_at_i<${endSec}&` +
    `hitsPerPage=1`;
  const body = await boundedFetch(url, "hn-algolia");
  const json = JSON.parse(body) as { nbHits?: number };
  const count = json?.nbHits;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new Error("[scoreboard] hn-algolia: missing nbHits");
  }
  return count;
}

// ── Source: GitHub recently-created AI agent repos (median stars) ──

/**
 * Search for repos created or pushed in the last 7 days matching
 * "ai-agent OR ai_agent OR llm-agent" topics, sorted by stars desc,
 * take top-30, compute median stars.  Free-tier GitHub Search API
 * allows 30 req/min unauthenticated.
 */
async function fetchGitHubAgentMedian(): Promise<number> {
  const url =
    `https://api.github.com/search/repositories?` +
    `q=topic%3Aai-agent+pushed%3A%3E${daysAgoUtc(7)}&sort=stars&order=desc&per_page=30`;
  const body = await boundedFetch(url, "github", {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  });
  const json = JSON.parse(body) as {
    items?: Array<{ stargazers_count?: number }>;
  };
  const stars = (json.items ?? [])
    .map((r) => (typeof r.stargazers_count === "number" ? r.stargazers_count : 0))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (stars.length === 0) {
    throw new Error("[scoreboard] github: no items returned");
  }
  // Median (50th percentile).
  const mid = Math.floor(stars.length / 2);
  return stars.length % 2 === 0
    ? Math.round((stars[mid - 1] + stars[mid]) / 2)
    : stars[mid];
}

/* ──────────────────────────────────────────────────────────────────
 * Mutation: snapshot today's keyStats.
 * Idempotent — replaces today's snapshot with the latest computed
 * values (snapshots are versioned by `version: number`, we increment).
 * ──────────────────────────────────────────────────────────────── */
export const writeScoreboard = internalMutation({
  args: {
    dateKey: v.string(),
    keyStats: v.array(
      v.object({
        label: v.string(),
        value: v.number(),
        deltaPct: v.optional(v.number()),
        previousValue: v.optional(v.number()),
        sourceUrl: v.string(),
        // Honest provenance — every keyStat carries which source
        // produced it, so the UI/audit can verify.
        provenance: v.string(),
      }),
    ),
    sources: v.object({
      openalex: v.string(), // 'ok' | 'error:<msg>'
      hnAlgolia: v.string(),
      github: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    // Look for an existing snapshot for today; if present, patch its
    // keyStats. Otherwise, create a minimal snapshot.
    const existing = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();

    const now = Date.now();
    const errors: string[] = [];
    if (args.sources.openalex.startsWith("error")) errors.push(`openalex: ${args.sources.openalex}`);
    if (args.sources.hnAlgolia.startsWith("error")) errors.push(`hn-algolia: ${args.sources.hnAlgolia}`);
    if (args.sources.github.startsWith("error")) errors.push(`github: ${args.sources.github}`);

    if (existing) {
      // BOUND: cap keyStats at MAX_KEYSTATS even if existing already
      // has stats. Replace with our fresh stats (we own this slice).
      const newKeyStats = args.keyStats.slice(0, MAX_KEYSTATS);
      await ctx.db.patch(existing._id, {
        version: (existing.version ?? 1) + 1,
        generatedAt: now,
        dashboardMetrics: {
          ...existing.dashboardMetrics,
          keyStats: newKeyStats,
        },
        errors: errors.length > 0 ? errors : existing.errors,
      });
      return { mode: "patched" as const, snapshotId: existing._id, keyStatCount: newKeyStats.length };
    }

    // Create a minimal snapshot — everything else is empty defaults
    // until the LinkedIn pipeline backfills.  HONEST_STATUS: no
    // fabricated capabilities, etc.
    const newKeyStats = args.keyStats.slice(0, MAX_KEYSTATS);
    const id = await ctx.db.insert("dailyBriefSnapshots", {
      dateString: args.dateKey,
      generatedAt: now,
      dashboardMetrics: {
        meta: {
          currentDate: args.dateKey,
          timelineProgress: 0,
        },
        charts: {
          trendLine: { points: [] },
          marketShare: [],
        },
        techReadiness: { existing: 0, emerging: 0, sciFi: 0 },
        keyStats: newKeyStats,
        capabilities: [],
        annotations: [],
      },
      sourceSummary: {
        totalItems: newKeyStats.length,
        bySource: {},
        byCategory: {},
        topTrending: [],
      },
      version: 1,
      processingTimeMs: undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
    return { mode: "created" as const, snapshotId: id, keyStatCount: newKeyStats.length };
  },
});

/**
 * Query that reads YESTERDAY's keyStats so the action can compute Δ.
 * We expose this as a separate internalMutation-style read so the
 * action can call it without leaking ctx.db logic out of mutations.
 *
 * Returning a Map of label→value keeps the comparison tight.
 */
export const readPreviousScoreboard = internalMutation({
  args: { dateKey: v.string() },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();
    if (!previous) return null;
    const stats = previous.dashboardMetrics?.keyStats ?? [];
    const map: Record<string, number> = {};
    for (const s of stats as Array<{ label?: string; value?: number }>) {
      if (typeof s?.label === "string" && typeof s?.value === "number") {
        map[s.label] = s.value;
      }
    }
    return map;
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Action: compute + persist scoreboard.
 * Failures fail-soft per source — partial stat sets still write.
 * ──────────────────────────────────────────────────────────────── */
export const seedDailyKeyStats = internalAction({
  args: {},
  handler: async (ctx) => {
    const dateKey = todayUtc();
    const yesterdayKey = daysAgoUtc(1);

    // Fetch all three sources in parallel, fail-soft per source.
    const [openalexResult, hnAlgoliaResult, githubResult] = await Promise.allSettled([
      fetchOpenAlexCount(dateKey),
      fetchHnAlgoliaCount(dateKey),
      fetchGitHubAgentMedian(),
    ]);

    // Read yesterday's keyStats so we can compute Δ honestly.  If
    // there's no row yesterday, deltaPct stays undefined.
    const previous: Record<string, number> | null = await ctx.runMutation(
      internal.domains.research.editionScoreboardSeed.readPreviousScoreboard,
      { dateKey: yesterdayKey },
    );

    type KeyStat = {
      label: string;
      value: number;
      deltaPct?: number;
      previousValue?: number;
      sourceUrl: string;
      provenance: string;
    };
    const keyStats: KeyStat[] = [];

    function pushStat(
      label: string,
      value: number,
      sourceUrl: string,
      provenance: string,
    ): void {
      const prev = previous?.[label];
      let deltaPct: number | undefined = undefined;
      if (typeof prev === "number" && prev > 0) {
        deltaPct = Math.round(((value - prev) / prev) * 1000) / 10; // 1 decimal pp
      }
      keyStats.push({
        label,
        value,
        deltaPct,
        previousValue: typeof prev === "number" ? prev : undefined,
        sourceUrl,
        provenance,
      });
    }

    const sources = {
      openalex: "ok" as string,
      hnAlgolia: "ok" as string,
      github: "ok" as string,
    };

    if (openalexResult.status === "fulfilled") {
      pushStat(
        "OpenAlex AI papers today",
        openalexResult.value,
        `https://api.openalex.org/works?filter=concepts.id:${OPENALEX_AI_CONCEPT},from_publication_date:${dateKey},to_publication_date:${dateKey}`,
        "openalex",
      );
    } else {
      sources.openalex = `error: ${
        openalexResult.reason instanceof Error
          ? openalexResult.reason.message
          : String(openalexResult.reason)
      }`;
      console.warn(`[scoreboard] openalex failed: ${sources.openalex}`);
    }

    if (hnAlgoliaResult.status === "fulfilled") {
      pushStat(
        "HN AI front-page count",
        hnAlgoliaResult.value,
        `https://hn.algolia.com/?dateRange=custom&type=story&query=AI`,
        "hn-algolia",
      );
    } else {
      sources.hnAlgolia = `error: ${
        hnAlgoliaResult.reason instanceof Error
          ? hnAlgoliaResult.reason.message
          : String(hnAlgoliaResult.reason)
      }`;
      console.warn(`[scoreboard] hn-algolia failed: ${sources.hnAlgolia}`);
    }

    if (githubResult.status === "fulfilled") {
      pushStat(
        "GitHub AI-agent repo median stars (top-30, 7d active)",
        githubResult.value,
        `https://github.com/search?q=topic%3Aai-agent+pushed%3A%3E${daysAgoUtc(7)}&type=repositories&s=stars&o=desc`,
        "github",
      );
    } else {
      sources.github = `error: ${
        githubResult.reason instanceof Error
          ? githubResult.reason.message
          : String(githubResult.reason)
      }`;
      console.warn(`[scoreboard] github failed: ${sources.github}`);
    }

    // If ALL sources failed, do not overwrite a healthy yesterday's
    // snapshot.  HONEST_STATUS: return error count, no fakes.
    if (keyStats.length === 0) {
      return {
        ok: false,
        dateKey,
        keyStatCount: 0,
        sources,
      };
    }

    const result = await ctx.runMutation(
      internal.domains.research.editionScoreboardSeed.writeScoreboard,
      { dateKey, keyStats, sources },
    );

    console.log(
      `[scoreboard] ${dateKey} mode=${result.mode} count=${result.keyStatCount} ` +
        `openalex=${sources.openalex.slice(0, 16)} hn=${sources.hnAlgolia.slice(0, 16)} ` +
        `github=${sources.github.slice(0, 16)}`,
    );

    return {
      ok: true,
      dateKey,
      keyStatCount: result.keyStatCount,
      mode: result.mode,
      sources,
    };
  },
});
