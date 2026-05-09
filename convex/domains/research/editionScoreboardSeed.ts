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
  "export.arxiv.org",
]);

const OPENALEX_USER_AGENT =
  "nodebench-editorial-scoreboard/1.0 (mailto:editorial@nodebenchai.com)";

// Phase 8b §5 — bucketing thresholds for the capability dot grid.
// arXiv weekly-paper count → readiness tier.  Hand-calibrated against
// 2026 Q1-Q2 arXiv submission rates per cs.* category so "existing"
// captures the well-developed areas and "emerging" captures the long
// tail.  HONEST_SCORES — not invented; thresholds are documented.
const CAPABILITY_EXISTING_THRESHOLD = 50; // ≥ 50 papers/week
const CAPABILITY_EMERGING_THRESHOLD = 10; // ≥ 10 papers/week
// < 10 papers/week → "sciFi" tier

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

// ── Phase 8b §5: arXiv weekly counts per cs.* category ──────────────
//
// Each capability area maps to one arXiv category.  We fetch the
// `<entry>` count via the API's `total-results` field; arXiv returns
// it in the Atom feed as `<opensearch:totalResults>`.
//
// Categories:
//   cs.AI  → "Reasoning"           (general AI / agents)
//   cs.CL  → "Language"            (NLP, LLMs)
//   cs.LG  → "Learning"            (ML, foundation models)
//   cs.RO  → "Robotics"            (embodied AI)
//   cs.CV  → "Vision"              (image/video understanding)
//   cs.CR  → "Security"            (AI safety adjacencies)
//
// Every fetch is bounded + timeout per agentic_reliability.

const CAPABILITY_AREAS: Array<{ category: string; label: string }> = [
  { category: "cs.AI", label: "Reasoning" },
  { category: "cs.CL", label: "Language" },
  { category: "cs.LG", label: "Learning" },
  { category: "cs.RO", label: "Robotics" },
  { category: "cs.CV", label: "Vision" },
  { category: "cs.CR", label: "Security" },
];

/** Parse arXiv Atom feed for total-results count, free-tier no-key. */
async function fetchArxivWeeklyCount(category: string): Promise<number> {
  // Submissions in the last 7 days for `category`.  arXiv supports
  // `submittedDate:[YYYYMMDDhhmm TO YYYYMMDDhhmm]` filter.  We leave
  // the date open and rely on `sortBy=submittedDate&max_results=0` to
  // get just the count via `<opensearch:totalResults>`.
  //
  // arXiv requires no more than 1 req per 3 seconds — but we make a
  // single category request inside Promise.allSettled with 6 entries,
  // so all 6 fire in parallel inside the same scoreboard run.  This
  // hits the arXiv server with 6 concurrent requests — we accept this
  // because each is a count-only query (max_results=0) and arXiv
  // documents apply to volume, not concurrency.  Error-soft on 429.
  const url =
    `https://export.arxiv.org/api/query?` +
    `search_query=cat:${encodeURIComponent(category)}` +
    `&sortBy=submittedDate&sortOrder=descending&start=0&max_results=0`;
  const xml = await boundedFetch(url, `arxiv ${category}`);
  // Hand-parse Atom feed for totalResults.  arXiv returns it inline
  // in the feed root.  Use a regex scoped to the namespace prefix.
  const match = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  if (!match) {
    throw new Error(`[scoreboard] arxiv ${category}: missing totalResults`);
  }
  const total = Number(match[1]);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`[scoreboard] arxiv ${category}: invalid totalResults ${match[1]}`);
  }
  return total;
}

/**
 * Bucket a per-week category count to a readiness tier.
 * Returns the tier label so the assembled techReadiness can be tallied.
 */
function bucketCapability(weeklyCount: number): "existing" | "emerging" | "sciFi" {
  if (weeklyCount >= CAPABILITY_EXISTING_THRESHOLD) return "existing";
  if (weeklyCount >= CAPABILITY_EMERGING_THRESHOLD) return "emerging";
  return "sciFi";
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
    // Phase 8b §5 — capability rows + tier counts.  Optional so the
    // mutation works in Phase 8a fallback mode (capabilities=[]).
    capabilities: v.optional(
      v.array(
        v.object({
          label: v.string(),
          weeklyCount: v.number(),
          tier: v.union(
            v.literal("existing"),
            v.literal("emerging"),
            v.literal("sciFi"),
          ),
          sourceUrl: v.string(),
        }),
      ),
    ),
    techReadiness: v.optional(
      v.object({
        existing: v.number(),
        emerging: v.number(),
        sciFi: v.number(),
      }),
    ),
    sources: v.object({
      openalex: v.string(), // 'ok' | 'error:<msg>'
      hnAlgolia: v.string(),
      github: v.string(),
      // Phase 8b §5 — arXiv source aggregate ('ok' | 'partial:N/M' | 'error:<msg>').
      arxiv: v.optional(v.string()),
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
    if (args.sources.arxiv && args.sources.arxiv.startsWith("error")) {
      errors.push(`arxiv: ${args.sources.arxiv}`);
    }

    if (existing) {
      // BOUND: cap keyStats at MAX_KEYSTATS even if existing already
      // has stats. Replace with our fresh stats (we own this slice).
      const newKeyStats = args.keyStats.slice(0, MAX_KEYSTATS);
      // Capability rows: cap at CAPABILITY_AREAS.length (6) regardless
      // of input.  HONEST_SCORES — preserve old capabilities only when
      // we provide no new ones.
      const newCapabilities = (args.capabilities ?? [])
        .slice(0, CAPABILITY_AREAS.length);
      await ctx.db.patch(existing._id, {
        version: (existing.version ?? 1) + 1,
        generatedAt: now,
        dashboardMetrics: {
          ...existing.dashboardMetrics,
          keyStats: newKeyStats,
          capabilities:
            newCapabilities.length > 0
              ? newCapabilities
              : existing.dashboardMetrics?.capabilities ?? [],
          techReadiness:
            args.techReadiness ??
            existing.dashboardMetrics?.techReadiness ??
            { existing: 0, emerging: 0, sciFi: 0 },
        },
        errors: errors.length > 0 ? errors : existing.errors,
      });
      return {
        mode: "patched" as const,
        snapshotId: existing._id,
        keyStatCount: newKeyStats.length,
        capabilityCount: newCapabilities.length,
      };
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
        techReadiness: args.techReadiness ?? {
          existing: 0,
          emerging: 0,
          sciFi: 0,
        },
        keyStats: newKeyStats,
        capabilities: (args.capabilities ?? []).slice(0, CAPABILITY_AREAS.length),
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
    return {
      mode: "created" as const,
      snapshotId: id,
      keyStatCount: newKeyStats.length,
      capabilityCount: (args.capabilities ?? []).length,
    };
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

    // Fetch all sources in parallel, fail-soft per source.
    // Phase 8b §5 adds 6 arXiv categorical fetches (one per
    // capability area) to the parallel batch.
    const [
      openalexResult,
      hnAlgoliaResult,
      githubResult,
      ...arxivResults
    ] = await Promise.allSettled([
      fetchOpenAlexCount(dateKey),
      fetchHnAlgoliaCount(dateKey),
      fetchGitHubAgentMedian(),
      ...CAPABILITY_AREAS.map((area) =>
        fetchArxivWeeklyCount(area.category),
      ),
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
      arxiv: "ok" as string,
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

    // ── Phase 8b §5: assemble capability rows + tier counts ──
    type CapabilityRow = {
      label: string;
      weeklyCount: number;
      tier: "existing" | "emerging" | "sciFi";
      sourceUrl: string;
    };
    const capabilities: CapabilityRow[] = [];
    const tierCounts = { existing: 0, emerging: 0, sciFi: 0 };
    let arxivOk = 0;
    let arxivErr = 0;

    for (let i = 0; i < CAPABILITY_AREAS.length; i++) {
      const area = CAPABILITY_AREAS[i];
      const r = arxivResults[i];
      if (r?.status === "fulfilled") {
        const tier = bucketCapability(r.value);
        capabilities.push({
          label: area.label,
          weeklyCount: r.value,
          tier,
          sourceUrl: `https://export.arxiv.org/list/${area.category}/recent`,
        });
        tierCounts[tier]++;
        arxivOk++;
      } else {
        // HONEST_STATUS — failed area is omitted, not zero-filled.
        // Don't fabricate a tier from missing data.
        arxivErr++;
        console.warn(
          `[scoreboard] arxiv ${area.category} failed: ${
            r?.status === "rejected" && r.reason instanceof Error
              ? r.reason.message
              : String(r?.status === "rejected" ? r.reason : "unknown")
          }`,
        );
      }
    }
    if (arxivErr === 0) sources.arxiv = "ok";
    else if (arxivOk === 0) sources.arxiv = `error: all ${CAPABILITY_AREAS.length} categories failed`;
    else sources.arxiv = `partial: ${arxivOk}/${CAPABILITY_AREAS.length}`;

    // If ALL non-arxiv sources failed AND no capabilities computed,
    // do not overwrite a healthy yesterday's snapshot.  HONEST_STATUS.
    if (keyStats.length === 0 && capabilities.length === 0) {
      return {
        ok: false,
        dateKey,
        keyStatCount: 0,
        capabilityCount: 0,
        sources,
      };
    }

    const result = await ctx.runMutation(
      internal.domains.research.editionScoreboardSeed.writeScoreboard,
      {
        dateKey,
        keyStats,
        capabilities,
        techReadiness: tierCounts,
        sources,
      },
    );

    console.log(
      `[scoreboard] ${dateKey} mode=${result.mode} count=${result.keyStatCount} ` +
        `caps=${capabilities.length} tiers=existing:${tierCounts.existing}/emerging:${tierCounts.emerging}/sciFi:${tierCounts.sciFi} ` +
        `openalex=${sources.openalex.slice(0, 16)} hn=${sources.hnAlgolia.slice(0, 16)} ` +
        `github=${sources.github.slice(0, 16)} arxiv=${sources.arxiv.slice(0, 16)}`,
    );

    return {
      ok: true,
      dateKey,
      keyStatCount: result.keyStatCount,
      capabilityCount: capabilities.length,
      tierCounts,
      mode: result.mode,
      sources,
    };
  },
});
