/**
 * Phase 10a — FRED-lite macro indicators for §4 Scoreboard.
 *
 * Resolves Phase 9 deferred items #16 and #20 from
 * `docs/architecture/EDITION_INGESTION_FLYWHEEL.md`.
 *
 * Pulls 6 macroeconomic series from FRED (Federal Reserve Bank of
 * St. Louis economic data) and writes one row per series into today's
 * `dailyBriefSnapshots.dashboardMetrics.keyStats`.  No new schema —
 * the existing Scoreboard component renders the rows automatically.
 *
 * Series:
 *   CPIAUCSL  CPI (all urban consumers, SA)        YoY %
 *   DFF       Federal funds rate (effective)        %
 *   UNRATE    Unemployment rate                     %
 *   GDP       Gross domestic product (level)        $B (and YoY %)
 *   M2SL      M2 money supply                       $B
 *   DGS10     10-year Treasury constant maturity    %
 *
 * Cron: daily at 08:00 UTC.  FRED's daily release window closes
 * around 16:00 ET (~21:00 UTC), so 08:00 UTC the next morning catches
 * the previous day's release.  Series like CPI publish monthly; the
 * cron just upserts the latest available observation each day, which
 * is idempotent for unchanged series.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          6 series hardcoded; never grows from input.
 *                    256 KB read cap per FRED response.  Hard-cap
 *                    retries at 2 (wired through retry helper).
 *   - HONEST_STATUS  Per-series try/catch.  A failed series is
 *                    skipped, NOT zero-filled.  Action returns
 *                    `{ ok, succeeded, failed, errors }`.
 *   - HONEST_SCORES  Never invent observations.  If FRED returns a
 *                    "." (their missing-value sentinel), skip.  Delta
 *                    only computed when both current + previous are
 *                    real numbers.
 *   - TIMEOUT        AbortController, 8s budget per series fetch.
 *   - SSRF           Hostname `api.stlouisfed.org` hardcoded; URL
 *                    constructor + exact-match check rejects anything
 *                    else.  https only.
 *   - BOUND_READ     Streaming reader cancels on overflow above
 *                    MAX_RESPONSE_BYTES (256 KB).
 *   - ERROR_BOUNDARY Each fetch wrapped in try/catch.  Action itself
 *                    catches and returns structured failure JSON.
 *   - DETERMINISTIC  Idempotent: same dateString + same FRED data =
 *                    same keyStats row content.  Re-running in same
 *                    day overwrites cleanly via filter-then-append.
 *
 * Prior art:
 *   - convex\domains\research\editionScoreboardSeed.ts  parallel
 *     fan-out + fail-soft per source pattern (Phase 8a).
 *   - convex\domains\research\mcpServerCountSeed.ts     bounded
 *     fetch helper + idempotent upsert pattern (Phase 9a).
 */

import { internalAction, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

const ALLOWED_HOSTS = new Set(["api.stlouisfed.org"]);
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256 * 1024; // 256 KB — FRED responses are tiny JSON
const MAX_RETRIES = 2;

/** FRED series catalog.  Hardcoded — agentic_reliability BOUND. */
interface FredSeriesSpec {
  /** FRED series ID (uppercase). */
  id: string;
  /** Human-readable label rendered in the Scoreboard. */
  label: string;
  /**
   * How to format the latest observation into the Scoreboard's `value`.
   *   - "percent"     → `${n.toFixed(2)}%`
   *   - "billions"    → `$${n.toLocaleString()}B`
   *   - "yoyPercent"  → compute YoY using the observation `obsPerYear`
   *                     entries back (e.g. 12 for monthly, 4 for
   *                     quarterly).
   */
  format: "percent" | "billions" | "yoyPercent";
  /**
   * How many observations FRED publishes per year for this series.
   * Required for YoY computation.  HONEST_SCORES: getting this wrong
   * means the "YoY %" we emit is actually multi-year drift.
   *   - 12 → monthly (CPIAUCSL, UNRATE, M2SL)
   *   - 4  → quarterly (GDP)
   *   - 252→ daily business days (DFF, DGS10) — but we don't compute
   *           YoY for daily series; their format is "percent" not
   *           "yoyPercent".
   */
  obsPerYear: 12 | 4 | 252;
  /**
   * Whether to additionally publish a YoY % alongside the level.
   * Used for GDP — the level (in $B) is itself useful, but the YoY
   * delta is the more newsworthy number.
   */
  alsoYoyPercent?: boolean;
  /** Documentation URL — used as `sourceUrl` on the keyStats row. */
  sourceUrl: string;
}

const FRED_SERIES: FredSeriesSpec[] = [
  {
    id: "CPIAUCSL",
    label: "CPI (YoY %)",
    format: "yoyPercent",
    obsPerYear: 12, // monthly
    sourceUrl: "https://fred.stlouisfed.org/series/CPIAUCSL",
  },
  {
    id: "DFF",
    label: "Fed funds rate",
    format: "percent",
    obsPerYear: 252, // daily, no YoY computed
    sourceUrl: "https://fred.stlouisfed.org/series/DFF",
  },
  {
    id: "UNRATE",
    label: "Unemployment rate",
    format: "percent",
    obsPerYear: 12, // monthly, no YoY computed (format is percent not yoyPercent)
    sourceUrl: "https://fred.stlouisfed.org/series/UNRATE",
  },
  {
    id: "GDP",
    label: "GDP (level $B)",
    format: "billions",
    obsPerYear: 4, // quarterly — 4 obs back is 1 year
    alsoYoyPercent: true,
    sourceUrl: "https://fred.stlouisfed.org/series/GDP",
  },
  {
    id: "M2SL",
    label: "M2 money supply ($B)",
    format: "billions",
    obsPerYear: 12, // monthly
    sourceUrl: "https://fred.stlouisfed.org/series/M2SL",
  },
  {
    id: "DGS10",
    label: "10Y Treasury yield",
    format: "percent",
    obsPerYear: 252, // daily, no YoY computed
    sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
  },
];

/* ──────────────────────────────────────────────────────────────────
 * Bounded fetch with timeout + size cap (mirrors mcpServerCountSeed).
 * ──────────────────────────────────────────────────────────────── */

async function boundedFetch(url: string, label: string): Promise<string> {
  const u = new URL(url);
  // SSRF: exact hostname match.  No subdomain wildcards.
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[fredSeed] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[fredSeed] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "nodebench-fred-seed/1.0 (mailto:editorial@nodebenchai.com)",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`[fredSeed] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[fredSeed] ${label}: no response body`);
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
          `[fredSeed] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`,
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

/** Fetch with bounded retries (2 attempts beyond the initial). */
async function fetchWithRetry(url: string, label: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await boundedFetch(url, label);
    } catch (err) {
      lastErr = err;
      // Backoff: 500ms, 1500ms.  Skip on the last attempt.
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "unknown fetch failure"));
}

/* ──────────────────────────────────────────────────────────────────
 * FRED API — fetch latest observation(s) for a series.
 * ──────────────────────────────────────────────────────────────── */

interface FredObservation {
  realtime_start: string;
  realtime_end: string;
  date: string; // YYYY-MM-DD
  value: string; // numeric string, or "." for missing
}

interface FredObservationsResponse {
  observations?: FredObservation[];
}

/**
 * Build a FRED observations URL.
 *
 *   sort_order=desc + limit=N gives the N most-recent observations,
 *   with the very-latest first.  We use limit=2 for level/percent
 *   series (current + previous for delta), and limit=13 for YoY series
 *   (current + 12-back for year-over-year delta).
 */
function buildFredUrl(seriesId: string, apiKey: string, limit: number): string {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit),
  });
  return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

/**
 * Parse an observation's value field.  FRED uses "." for missing
 * values — return null in that case (HONEST_SCORES — never invent).
 */
function parseObservationValue(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

/* ──────────────────────────────────────────────────────────────────
 * Per-series fetch + format.
 *
 * Returns the keyStats row to push, or null if the series cannot be
 * formatted honestly (missing data, parse failure, etc.).
 * ──────────────────────────────────────────────────────────────── */

interface FredKeyStat {
  label: string;
  value: string; // formatted display string ("3.20%", "$28,123B", etc.)
  numericValue: number; // raw number (for analytics / future deltas)
  delta?: string; // "+0.10pp", "-2.3%", etc.  Honest sign.
  previousValue?: number;
  observationDate: string; // YYYY-MM-DD of the latest observation
  sourceUrl: string;
  provenance: string; // "fred:CPIAUCSL"
}

function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}

function formatBillions(n: number): string {
  // FRED returns GDP / M2SL in billions of dollars.  Thousands grouping.
  return `$${Math.round(n).toLocaleString()}B`;
}

function formatYoyPercent(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Compute the percentage-point delta between two percentage values.
 *
 *   "pp" (percentage points) is the correct unit for a difference of
 *   two percentages (e.g. CPI 3.20% vs 3.10% = +0.10pp, not +3.2%).
 *   Using "%" here would be a HONEST_SCORES violation — readers would
 *   misread the delta as a relative change.
 */
function formatPercentagePointDelta(curr: number, prev: number): string {
  const d = curr - prev;
  const sign = d > 0 ? "+" : d < 0 ? "" : "";
  return `${sign}${d.toFixed(2)}pp`;
}

/**
 * Compute a relative-percent delta (curr vs prev, divided by prev).
 *
 *   For levels (GDP $B, M2 $B), readers expect a percent-of-level
 *   change, not a raw $B delta.
 */
function formatRelativePercentDelta(curr: number, prev: number): string {
  if (!Number.isFinite(prev) || prev === 0) return "—";
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Fetch + format ONE series.  Returns null on any failure path; the
 * caller logs + skips (HONEST_STATUS — never invent).
 */
async function fetchOneSeries(
  spec: FredSeriesSpec,
  apiKey: string,
): Promise<FredKeyStat | FredKeyStat[] | null> {
  // YoY series need (obsPerYear + 1) observations so we can fetch the
  // year-ago comparison.  Level/percent series need 2 (current + prior).
  // GUARD: never fetch more than 24 observations regardless of obsPerYear
  // — daily series (DFF, DGS10) don't compute YoY (format != yoyPercent),
  // so this cap only ever bites if we mis-configure obsPerYear for a
  // monthly/quarterly YoY series.  BOUND.
  const yoyLimit = Math.min(24, spec.obsPerYear + 1);
  const limit = spec.format === "yoyPercent" || spec.alsoYoyPercent ? yoyLimit : 2;
  const url = buildFredUrl(spec.id, apiKey, limit);

  let body: string;
  try {
    body = await fetchWithRetry(url, `fred:${spec.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[fredSeed] ${spec.id} fetch failed: ${msg}`);
    return null;
  }

  let parsed: FredObservationsResponse;
  try {
    parsed = JSON.parse(body) as FredObservationsResponse;
  } catch (err) {
    console.warn(`[fredSeed] ${spec.id} JSON parse failed: ${err}`);
    return null;
  }

  const observations = Array.isArray(parsed.observations)
    ? parsed.observations
    : [];
  if (observations.length === 0) {
    console.warn(`[fredSeed] ${spec.id}: no observations returned`);
    return null;
  }

  const latest = observations[0];
  const latestVal = parseObservationValue(latest?.value);
  if (latestVal === null) {
    console.warn(
      `[fredSeed] ${spec.id}: latest observation value is missing/non-numeric`,
    );
    return null;
  }

  // Determine "previous" observation for the delta.
  //   - YoY series: obsPerYear entries back (12 for monthly, 4 for
  //     quarterly).  HONEST_SCORES: hardcoding 12 here would silently
  //     compute multi-year drift for quarterly series.
  //   - Level/percent series: the immediately prior observation.
  const prevIndex =
    spec.format === "yoyPercent" || spec.alsoYoyPercent
      ? spec.obsPerYear
      : 1;
  const previous = observations[prevIndex];
  const prevVal = parseObservationValue(previous?.value);

  // ── Format the value + delta per spec.format ────────────────────
  if (spec.format === "yoyPercent") {
    // YoY series: emit ONE row carrying the YoY %.  No separate level.
    if (prevVal === null) {
      console.warn(
        `[fredSeed] ${spec.id}: missing year-ago observation for YoY computation`,
      );
      return null;
    }
    if (prevVal === 0) {
      console.warn(`[fredSeed] ${spec.id}: year-ago value is 0, cannot compute YoY`);
      return null;
    }
    const yoy = ((latestVal - prevVal) / prevVal) * 100;
    return {
      label: spec.label,
      value: formatYoyPercent(yoy),
      numericValue: yoy,
      delta: undefined, // value IS the delta in YoY mode
      previousValue: prevVal,
      observationDate: latest.date,
      sourceUrl: spec.sourceUrl,
      provenance: `fred:${spec.id}`,
    };
  }

  if (spec.format === "percent") {
    // Percent series (DFF, UNRATE, DGS10): show level + percentage-
    // point delta vs prior observation.
    return {
      label: spec.label,
      value: formatPercent(latestVal),
      numericValue: latestVal,
      delta: prevVal !== null ? formatPercentagePointDelta(latestVal, prevVal) : undefined,
      previousValue: prevVal ?? undefined,
      observationDate: latest.date,
      sourceUrl: spec.sourceUrl,
      provenance: `fred:${spec.id}`,
    };
  }

  // Level series ($B): show level + relative-percent delta vs prior.
  // For GDP (alsoYoyPercent), emit BOTH the level row AND a paired
  // YoY % row.  The Scoreboard surface accepts arbitrary rows.
  const levelRow: FredKeyStat = {
    label: spec.label,
    value: formatBillions(latestVal),
    numericValue: latestVal,
    delta:
      prevVal !== null && prevVal !== 0
        ? formatRelativePercentDelta(latestVal, prevVal)
        : undefined,
    previousValue: prevVal ?? undefined,
    observationDate: latest.date,
    sourceUrl: spec.sourceUrl,
    provenance: `fred:${spec.id}`,
  };

  if (spec.alsoYoyPercent) {
    // Also fetch the year-ago observation for the YoY view.  We already
    // have observations[obsPerYear] from the limit=obsPerYear+1 fetch
    // above.  HONEST_SCORES: indexing by obsPerYear means a quarterly
    // series (GDP, obsPerYear=4) compares to 4 quarters ago = 1 year,
    // not 12 quarters ago = 3 years.
    const yearAgoVal = parseObservationValue(observations[spec.obsPerYear]?.value);
    if (yearAgoVal === null || yearAgoVal === 0) {
      // Fall through with just the level row — HONEST_STATUS.
      return [levelRow];
    }
    const yoy = ((latestVal - yearAgoVal) / yearAgoVal) * 100;
    const yoyRow: FredKeyStat = {
      label: `${spec.label.replace(/\s*\([^)]*\)\s*$/, "")} (YoY %)`,
      value: formatYoyPercent(yoy),
      numericValue: yoy,
      delta: undefined,
      previousValue: yearAgoVal,
      observationDate: latest.date,
      sourceUrl: spec.sourceUrl,
      provenance: `fred:${spec.id}:yoy`,
    };
    return [levelRow, yoyRow];
  }

  return levelRow;
}

/* ──────────────────────────────────────────────────────────────────
 * Mutation: upsert FRED keyStats into today's snapshot.
 * Idempotent — drops any existing fred:* rows and re-appends.
 * ──────────────────────────────────────────────────────────────── */

const FRED_PROVENANCE_PREFIX = "fred:";

export const upsertFredStats = internalMutation({
  args: {
    dateKey: v.string(),
    rows: v.array(
      v.object({
        label: v.string(),
        value: v.string(),
        numericValue: v.number(),
        delta: v.optional(v.string()),
        previousValue: v.optional(v.number()),
        observationDate: v.string(),
        sourceUrl: v.string(),
        provenance: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();

    if (existing) {
      const oldStats = (existing.dashboardMetrics?.keyStats ?? []) as Array<{
        provenance?: string;
        label?: string;
        [k: string]: unknown;
      }>;
      // Idempotent: drop ALL prior fred:* rows then append the fresh
      // batch.  This means re-running the seed in the same day cleanly
      // overwrites without duplicating.
      const filtered = oldStats.filter(
        (s) =>
          typeof s?.provenance !== "string" ||
          !s.provenance.startsWith(FRED_PROVENANCE_PREFIX),
      );
      const updatedStats = [...filtered, ...args.rows];
      await ctx.db.patch(existing._id, {
        version: (existing.version ?? 1) + 1,
        generatedAt: Date.now(),
        dashboardMetrics: {
          ...existing.dashboardMetrics,
          keyStats: updatedStats,
        },
      });
      return {
        mode: "patched" as const,
        snapshotId: existing._id,
        keyStatCount: args.rows.length,
      };
    }

    // No snapshot for today yet — create a minimal one with just the
    // FRED rows.  HONEST_STATUS: no fabricated capabilities, etc.
    const id = await ctx.db.insert("dailyBriefSnapshots", {
      dateString: args.dateKey,
      generatedAt: Date.now(),
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
        keyStats: args.rows,
        capabilities: [],
        annotations: [],
      },
      sourceSummary: {
        totalItems: args.rows.length,
        bySource: {},
        byCategory: {},
        topTrending: [],
      },
      version: 1,
    });
    return {
      mode: "created" as const,
      snapshotId: id,
      keyStatCount: args.rows.length,
    };
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Action: fetch all 6 FRED series + persist.
 *
 * Fail-soft per series: a failed series produces a console.warn and
 * is skipped; surviving series still write.  Returns
 * `{ ok, succeeded, failed, errors }` for honest observability.
 * ──────────────────────────────────────────────────────────────── */

export const seedFredStats = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ok: boolean;
    dateKey: string;
    succeeded: number;
    failed: number;
    errors: string[];
    rowsWritten: number;
    mode?: "created" | "patched";
  }> => {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      const msg = "FRED_API_KEY not set in Convex env";
      console.warn(`[fredSeed] ${msg}`);
      return {
        ok: false,
        dateKey: new Date().toISOString().slice(0, 10),
        succeeded: 0,
        failed: FRED_SERIES.length,
        errors: [msg],
        rowsWritten: 0,
      };
    }

    const dateKey = new Date().toISOString().slice(0, 10);

    // Parallel fan-out per agentic_reliability — each series fetched
    // independently so one failure doesn't block the others.
    const results = await Promise.allSettled(
      FRED_SERIES.map((spec) => fetchOneSeries(spec, apiKey)),
    );

    const rows: FredKeyStat[] = [];
    const errors: string[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < FRED_SERIES.length; i++) {
      const spec = FRED_SERIES[i];
      const r = results[i];
      if (r.status === "fulfilled" && r.value !== null) {
        succeeded++;
        if (Array.isArray(r.value)) {
          rows.push(...r.value);
        } else {
          rows.push(r.value);
        }
      } else {
        failed++;
        const reason =
          r.status === "rejected"
            ? r.reason instanceof Error
              ? r.reason.message
              : String(r.reason)
            : `${spec.id}: returned null (missing observation or parse failure)`;
        errors.push(`${spec.id}: ${reason}`);
      }
    }

    if (rows.length === 0) {
      // HONEST_STATUS — don't write anything if everything failed.
      console.warn(
        `[fredSeed] all ${FRED_SERIES.length} series failed; not patching snapshot`,
      );
      return {
        ok: false,
        dateKey,
        succeeded,
        failed,
        errors,
        rowsWritten: 0,
      };
    }

    let mode: "created" | "patched" | undefined;
    try {
      const result = await ctx.runMutation(
        internal.domains.integrations.macro.fredSeed.upsertFredStats,
        { dateKey, rows },
      );
      mode = result.mode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fredSeed] upsert failed: ${msg}`);
      return {
        ok: false,
        dateKey,
        succeeded,
        failed: failed + succeeded, // upsert failure means nothing landed
        errors: [...errors, `upsert: ${msg}`],
        rowsWritten: 0,
      };
    }

    console.log(
      `[fredSeed] ${dateKey} mode=${mode} rows=${rows.length} succeeded=${succeeded} failed=${failed}`,
    );

    return {
      ok: true,
      dateKey,
      succeeded,
      failed,
      errors,
      rowsWritten: rows.length,
      mode,
    };
  },
});
