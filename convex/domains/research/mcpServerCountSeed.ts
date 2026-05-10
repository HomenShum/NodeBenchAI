/**
 * Phase 9a — MCP server count daily counter.
 *
 * Resolves Phase 9 deferred item #17 ("MCP-server-count auto-counter").
 *
 * Scrapes `https://mcpservers.org/all` once a day, extracts the
 * "Showing 1-30 of N servers" total from the rendered HTML, and patches
 * today's `dailyBriefSnapshots.dashboardMetrics.keyStats` with one
 * extra row labelled "MCP servers tracked".
 *
 * No new schema — reuses the keyStats slice that the editorial home's
 * §4 Scoreboard already iterates.  The site is JS-rendered (TanStack
 * Start) but its initial HTML response includes a server-rendered
 * shell that contains the text `Showing 1-30 of N servers` for SEO.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          MAX_RESPONSE_BYTES caps the HTML body at 1 MB.
 *   - HONEST_STATUS  per-source counter; if scrape fails, returns
 *                    `{ ok:false, error }` and does NOT patch.
 *   - HONEST_SCORES  count is the literal regex-extracted integer
 *                    from the page; never invented.
 *   - TIMEOUT        AbortController, 10s budget.
 *   - SSRF           hostname `mcpservers.org` hardcoded.
 *   - BOUND_READ     1 MB streamed cap.
 *   - ERROR_BOUNDARY action wrapped in try/catch returning structured
 *                    failure JSON; mutation only fires on success.
 *   - DETERMINISTIC  scrape result is stable per-day; idempotent
 *                    upsert keyed on dateString + label.
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

const ALLOWED_HOSTS = new Set(["mcpservers.org"]);
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const TARGET_URL = "https://mcpservers.org/all";
const TARGET_LABEL = "MCP servers tracked";

/** Bounded fetch with timeout + size cap (matches scoreboard pattern). */
async function boundedFetch(url: string, label: string): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[mcpCount] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[mcpCount] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "nodebench-mcp-count/1.0 (mailto:editorial@nodebenchai.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`[mcpCount] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[mcpCount] ${label}: no response body`);
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
        throw new Error(`[mcpCount] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`);
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

/**
 * Extract the total MCP server count from the rendered HTML.
 *
 * Source pattern: the page emits a tagline like
 *   `Showing 1-30 of 8173 servers`
 * inside a `<div class="text-sm text-gray-600">` near the top of the
 * results grid.  The integer is what we want.
 *
 * Returns null when the pattern doesn't match — caller logs + skips
 * (HONEST_STATUS, never write a fake number).  If the page redesigns
 * and the pattern goes away, we miss a day rather than write a wrong
 * number.
 */
function parseServerCount(html: string): number | null {
  const m = html.match(/Showing\s+\d+\s*-\s*\d+\s+of\s+(\d{1,8})\s+servers/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/* ──────────────────────────────────────────────────────────────────
 * Mutation: patch today's snapshot's keyStats with the count.
 * Idempotent — replaces the prior MCP-count row if present, leaves
 * other keyStats untouched.
 * ──────────────────────────────────────────────────────────────── */

export const upsertMcpCountStat = internalMutation({
  args: {
    dateKey: v.string(),
    count: v.number(),
    sourceUrl: v.string(),
    previousValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();

    // The Scoreboard component reads the `delta` field for its
    // ↑ / ↓ / — badge.  We also keep the structured `previousValue`
    // and `deltaPct` so downstream consumers (LinkedIn pipeline,
    // analytics) can compute their own framing.
    const deltaInt =
      typeof args.previousValue === "number" && args.previousValue > 0
        ? args.count - args.previousValue
        : null;
    const newStat = {
      label: TARGET_LABEL,
      value: args.count,
      previousValue: args.previousValue,
      deltaPct:
        typeof args.previousValue === "number" && args.previousValue > 0
          ? Math.round(((args.count - args.previousValue) / args.previousValue) * 1000) / 10
          : undefined,
      // Human-readable delta for the Scoreboard ↑/↓ badge.  HONEST_STATUS:
      // omit when there's no comparison data.
      delta:
        deltaInt === null
          ? undefined
          : deltaInt > 0
            ? `+${deltaInt.toLocaleString()}`
            : deltaInt < 0
              ? `${deltaInt.toLocaleString()}`
              : undefined,
      sourceUrl: args.sourceUrl,
      provenance: "mcpservers.org",
    };

    if (existing) {
      const oldStats = (existing.dashboardMetrics?.keyStats ?? []) as Array<{
        label?: string;
        [k: string]: unknown;
      }>;
      // Idempotent: drop any prior MCP-count row, then append the new one.
      const filtered = oldStats.filter((s) => s?.label !== TARGET_LABEL);
      const updatedStats = [...filtered, newStat];
      await ctx.db.patch(existing._id, {
        version: (existing.version ?? 1) + 1,
        generatedAt: Date.now(),
        dashboardMetrics: {
          ...existing.dashboardMetrics,
          keyStats: updatedStats,
        },
      });
      return { mode: "patched" as const, snapshotId: existing._id };
    }

    // No snapshot for today yet — create a minimal one.  HONEST_STATUS:
    // we don't fabricate other keyStats; the scoreboard cron will add
    // them later when it runs.
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
        keyStats: [newStat],
        capabilities: [],
        annotations: [],
      },
      sourceSummary: {
        totalItems: 1,
        bySource: {},
        byCategory: {},
        topTrending: [],
      },
      version: 1,
    });
    return { mode: "created" as const, snapshotId: id };
  },
});

/**
 * Read yesterday's MCP-count value (if any) so the new row can carry
 * a deltaPct.  Returns null if no prior snapshot or no prior MCP-count
 * row exists.
 */
export const readPreviousMcpCount = internalMutation({
  args: { dateKey: v.string() },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();
    if (!previous) return null;
    const stats = (previous.dashboardMetrics?.keyStats ?? []) as Array<{
      label?: string;
      value?: number;
    }>;
    const row = stats.find((s) => s?.label === TARGET_LABEL);
    return typeof row?.value === "number" ? row.value : null;
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Action: scrape + persist.  Wired daily via cron.
 * ──────────────────────────────────────────────────────────────── */

export const seedMcpServerCount = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    ok: boolean;
    dateKey?: string;
    count?: number;
    previousValue?: number | null;
    mode?: "created" | "patched";
    error?: string;
  }> => {
    const dateKey = todayUtc();
    const yesterdayKey = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // 1. Read prior value (for delta computation).
    const previousValue: number | null = await ctx.runMutation(
      internal.domains.research.mcpServerCountSeed.readPreviousMcpCount,
      { dateKey: yesterdayKey },
    );

    // 2. Scrape current value.
    let html: string;
    try {
      html = await boundedFetch(TARGET_URL, "mcpservers.org/all");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mcpCount] fetch failed: ${msg}`);
      return { ok: false, error: msg };
    }

    const count = parseServerCount(html);
    if (count === null) {
      const msg = "regex match failed — page layout may have changed";
      console.warn(`[mcpCount] ${msg}`);
      return { ok: false, error: msg };
    }

    // 3. Patch today's snapshot.
    const result = await ctx.runMutation(
      internal.domains.research.mcpServerCountSeed.upsertMcpCountStat,
      {
        dateKey,
        count,
        sourceUrl: TARGET_URL,
        previousValue: previousValue ?? undefined,
      },
    );

    console.log(
      `[mcpCount] ${dateKey} count=${count} previous=${previousValue ?? "none"} mode=${result.mode}`,
    );

    return {
      ok: true,
      dateKey,
      count,
      previousValue,
      mode: result.mode,
    };
  },
});
