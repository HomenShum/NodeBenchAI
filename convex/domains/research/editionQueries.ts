/**
 * Editorial Home — public queries (Phase 7a).
 *
 * Source of truth: docs/architecture/HOME_EDITORIAL_REDESIGN.md §5.
 * Each query is bounded, fails honestly, and never fakes data. Per
 * .claude/rules/agentic_reliability.md (BOUND, HONEST_STATUS,
 * HONEST_SCORES) and .claude/rules/scratchpad_first.md (the persisted
 * fields are the source of truth — derive, don't fabricate).
 *
 * Public queries here are scoped to the redesign editorial home and
 * intentionally do NOT require an authenticated user. They read
 * already-publishable substrates:
 *   - dailyBriefSnapshots (curated daily metrics)
 *   - narrativeHypotheses on public threads
 *   - forecasts (active set used by the LinkedIn pipeline)
 *   - evidenceArtifacts referenced by the above
 *   - industryUpdates (already publicly browsable)
 *
 * The pulse query *does* require an owner identity because pulses are
 * per-user. It uses resolveProductIdentitySafely so guests get []
 * rather than a thrown error.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { resolveProductIdentitySafely } from "../product/helpers";
import {
  type EvidenceChecklist,
  countPassingChecks,
  deriveEvidenceLevel,
} from "./narrative/validators";

/* ────────────────────────────────────────────────────────────────────
 * BOUNDS — every list query caps results.  agentic_reliability::BOUND.
 * ────────────────────────────────────────────────────────────────── */
const HARD_CAP = 200;
const PULSE_DEFAULT = 12;
const HYPOTHESIS_DEFAULT = 8;
const HYPOTHESIS_MAX = 20;
const FORECAST_DEFAULT = 5;
const FORECAST_MAX = 12;
const FOOTNOTE_ARTIFACT_DEFAULT = 24;
const FOOTNOTE_ARTIFACT_MAX = 60;
const FOOTNOTE_INDUSTRY_DEFAULT = 8;
const FOOTNOTE_INDUSTRY_MAX = 24;

const ACTIVE_STATUSES = new Set<Doc<"narrativeHypotheses">["status"]>([
  "active",
  "supported",
  "weakened",
]);

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Date-key used by pulseReports — UTC YYYY-MM-DD. */
function todayDateKey(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bound a user-supplied limit to [1, max]. */
function boundLimit(value: number | undefined, def: number, max: number): number {
  const n = Math.floor(value ?? def);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max, HARD_CAP);
}

/* ────────────────────────────────────────────────────────────────────
 * §1 — "What moved today" : today's pulses for the current owner.
 *
 * P0 #2 (2026-05-09) — bootstrap content for guests + empty users.
 * When the caller has no pulse for today (anonymous, or signed-in but
 * inactive), fall back to a "public-trending" feed sourced from
 * `industryUpdates`.  The fallback is labelled `provenance:
 * "public-trending"` so the surface can render an explicit affordance
 * ("You haven't run a pulse today.  Here's what's trending publicly").
 *
 * agentic_reliability invariants:
 *  - BOUND: fallback hard-capped at PULSE_FALLBACK_MAX (5) regardless
 *    of `args.limit`.
 *  - HONEST_STATUS: when both pulse AND industryUpdates are empty, we
 *    return `provenance: "empty"` and `pulses: []` — no fabrication.
 *  - HONEST_SCORES: change counts are TRUE counts (1) per industry
 *    update; we do not invent material-change counts.  The
 *    `summaryMarkdown` field is the actual provider summary.
 * ────────────────────────────────────────────────────────────────── */
const PULSE_FALLBACK_MAX = 5;

type PulseProjection = {
  _id: string;
  entitySlug: string;
  dateKey: string;
  status: "generating" | "ready" | "failed";
  summaryMarkdown: string | null;
  changeCount: number;
  materialChangeCount: number;
  generatedAt: number;
};

/**
 * Slugify a provider name into a stable entitySlug-shaped string.
 * Keeps the rendering path's `entitySlug.replace(/-/g, " ")` cosmetic
 * happy without inventing a fake entity.
 */
function providerNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "trending";
}

/** Compose a public-trending fallback from industryUpdates. */
async function loadPublicTrendingFallback(
  ctx: QueryCtx,
  dateKey: string,
): Promise<PulseProjection[]> {
  // Read at most PULSE_FALLBACK_MAX rows directly from the
  // most-recent `by_scanned_at` ordering — bounded read.
  const rows = await ctx.db
    .query("industryUpdates")
    .withIndex("by_scanned_at")
    .order("desc")
    .take(PULSE_FALLBACK_MAX);
  return rows.map((u) => ({
    _id: u._id as string,
    entitySlug: providerNameToSlug(u.providerName ?? u.provider ?? "trending"),
    dateKey,
    status: "ready" as const,
    summaryMarkdown:
      typeof u.summary === "string" && u.summary.trim().length > 0
        ? `**${u.title}**\n\n${u.summary}`
        : (u.title as string) ?? null,
    // honest counts: 1 update = 1 change, 0 material claims (we don't
    // know whether a public update is "material" to any owner).
    changeCount: 1,
    materialChangeCount: 0,
    generatedAt: typeof u.scannedAt === "number" ? u.scannedAt : Date.now(),
  }));
}

export const getTodayPulse = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundLimit(args.limit, PULSE_DEFAULT, 50);
    const dateKey = todayDateKey();
    const identity = await resolveProductIdentitySafely(
      ctx,
      args.anonymousSessionId,
    );

    // ── Branch A: identifiable user (authed or anonymous-session). ──
    if (identity) {
      const ownerKey =
        identity.anonymousSessionId ?? (identity.ownerKey as string);
      const today = await ctx.db
        .query("pulseReports")
        .withIndex("by_owner_date", (q) =>
          q.eq("ownerKey", ownerKey).eq("dateKey", dateKey),
        )
        .order("desc")
        .take(limit);

      if (today.length > 0) {
        return {
          provenance: "user" as const,
          pulses: today.map<PulseProjection>((p) => ({
            _id: p._id,
            entitySlug: p.entitySlug,
            dateKey: p.dateKey,
            status: p.status,
            summaryMarkdown: p.summaryMarkdown ?? null,
            changeCount: p.changeCount,
            materialChangeCount: p.materialChangeCount,
            generatedAt: p.generatedAt,
          })),
          dateKey,
          lastDateKey: null as string | null,
        };
      }

      // Empty for today — surface the user's most-recent pulse date so
      // the affordance line can be honest ("Last pulse: 2026-05-04").
      const last = await ctx.db
        .query("pulseReports")
        .withIndex("by_owner_date", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .first();
      const lastDateKey = last?.dateKey ?? null;

      // Fall through to the public-trending fallback when even the
      // user's history is empty (cold-start).
      const fallback = await loadPublicTrendingFallback(ctx, dateKey);
      if (fallback.length === 0) {
        return {
          provenance: "empty" as const,
          pulses: [],
          dateKey,
          lastDateKey,
        };
      }
      return {
        provenance: "public-trending" as const,
        pulses: fallback,
        dateKey,
        lastDateKey,
      };
    }

    // ── Branch B: anonymous, no resolvable session — guest visitor. ──
    const fallback = await loadPublicTrendingFallback(ctx, dateKey);
    if (fallback.length === 0) {
      return {
        provenance: "empty" as const,
        pulses: [],
        dateKey,
        lastDateKey: null as string | null,
      };
    }
    return {
      provenance: "public-trending" as const,
      pulses: fallback,
      dateKey,
      lastDateKey: null as string | null,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────
 * §2 — "The competing explanations" : active hypotheses on public
 * threads, recent.  We deterministically derive a 6-bool checklist
 * from persisted hypothesis fields (HONEST_SCORES — no fakes).
 * ────────────────────────────────────────────────────────────────── */
function deriveHypothesisChecklist(
  hyp: Doc<"narrativeHypotheses">,
): EvidenceChecklist {
  // Each boolean has a deterministic, observable trigger.  These
  // mirror the spirit of evidenceChecklistValidator without inventing
  // new state.  When the persisted record adds a real checklist field
  // later, replace this derivation with the stored value.
  const supporting = hyp.supportingEvidenceCount ?? 0;
  const contradicting = hyp.contradictingEvidenceCount ?? 0;
  const totalEvidence = supporting + contradicting;
  return {
    hasPrimarySource: supporting > 0,                        // at least one supporting artifact
    hasCorroboration: supporting >= 2,                       // 2+ supporting artifacts
    hasFalsifiableClaim: !!hyp.falsificationCriteria,        // explicit falsification text
    hasQuantitativeData: hyp.measurementApproach.length > 0  // measurement plan recorded
      && /\d/.test(hyp.measurementApproach),                 //   …with at least one number
    hasNamedAttribution: !!hyp.reviewedBy && hyp.reviewedBy.length > 0,
    isReproducible: totalEvidence >= 2 && hyp.confidence >= 0.5,
  };
}

export const getActiveHypotheses = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundLimit(args.limit, HYPOTHESIS_DEFAULT, HYPOTHESIS_MAX);
    const cutoff = Date.now() - RECENT_WINDOW_MS;

    // Fetch each status separately via the by_status index, then merge.
    const statusBatches = await Promise.all(
      Array.from(ACTIVE_STATUSES).map((status) =>
        ctx.db
          .query("narrativeHypotheses")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .take(limit * 3),
      ),
    );

    const merged: Doc<"narrativeHypotheses">[] = [];
    const seen = new Set<string>();
    for (const batch of statusBatches) {
      for (const h of batch) {
        if (seen.has(h._id)) continue;
        if (h.updatedAt < cutoff) continue;
        seen.add(h._id);
        merged.push(h);
      }
    }
    merged.sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = merged.slice(0, limit);

    // Resolve thread for visibility — only return hypotheses on
    // threads marked public.  Authenticated callers can use the
    // existing per-thread query for private threads.
    type EditionHypothesis = {
      _id: Id<"narrativeHypotheses">;
      hypothesisId: string;
      threadId: Id<"narrativeThreads">;
      threadName: string;
      label: string;
      title: string;
      claimForm: string;
      measurementApproach: string;
      falsificationCriteria: string | null;
      status: Doc<"narrativeHypotheses">["status"];
      confidence: number;
      speculativeRisk: Doc<"narrativeHypotheses">["speculativeRisk"];
      supportingEvidenceCount: number;
      contradictingEvidenceCount: number;
      evidenceArtifactIds: string[];
      competingHypothesisIds: string[];
      updatedAt: number;
      evidenceChecklist: EvidenceChecklist;
      evidenceChecksPassing: number;
      evidenceChecksTotal: number;
      evidenceLevel: ReturnType<typeof deriveEvidenceLevel>;
    };
    const result: EditionHypothesis[] = [];
    for (const h of recent) {
      const thread = await ctx.db.get(h.threadId);
      if (!thread || !thread.isPublic) continue;
      const checklist = deriveHypothesisChecklist(h);
      const passing = countPassingChecks(checklist);
      const evidenceLevel = deriveEvidenceLevel(checklist);
      result.push({
        _id: h._id,
        hypothesisId: h.hypothesisId,
        threadId: h.threadId,
        threadName: thread.name,
        label: h.label,
        title: h.title,
        claimForm: h.claimForm,
        measurementApproach: h.measurementApproach,
        falsificationCriteria: h.falsificationCriteria ?? null,
        status: h.status,
        confidence: h.confidence,
        speculativeRisk: h.speculativeRisk,
        supportingEvidenceCount: h.supportingEvidenceCount,
        contradictingEvidenceCount: h.contradictingEvidenceCount,
        evidenceArtifactIds: h.evidenceArtifactIds,
        competingHypothesisIds: h.competingHypothesisIds ?? [],
        updatedAt: h.updatedAt,
        evidenceChecklist: checklist,
        evidenceChecksPassing: passing,
        evidenceChecksTotal: 6,
        evidenceLevel,
      });
    }
    return result;
  },
});

/* ────────────────────────────────────────────────────────────────────
 * §3 — "What to look at this week" : top forecasts (public wrapper
 * over the existing internal getTopForecastsForLinkedIn shape).
 * ────────────────────────────────────────────────────────────────── */
export const getTopForecasts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundLimit(args.limit, FORECAST_DEFAULT, FORECAST_MAX);

    const all = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(limit * 6);

    const updated = all.filter(
      (f) => f.updateCount > 0 && f.probability != null,
    );
    updated.sort((a, b) => {
      const aFresh = a.lastRefreshedAt ?? a.createdAt;
      const bFresh = b.lastRefreshedAt ?? b.createdAt;
      const freshDiff = bFresh - aFresh;
      if (Math.abs(freshDiff) > 86_400_000) return freshDiff;
      const aDate = new Date(a.resolutionDate).getTime();
      const bDate = new Date(b.resolutionDate).getTime();
      return aDate - bDate;
    });

    const top = updated.slice(0, limit);
    type EditionForecast = {
      _id: Id<"forecasts">;
      question: string;
      forecastType: Doc<"forecasts">["forecastType"];
      probability: number | null;
      previousProbability: number | null;
      confidenceInterval: Doc<"forecasts">["confidenceInterval"] | null;
      resolutionDate: string;
      resolutionCriteria: string;
      topDrivers: string[];
      topCounterarguments: string[];
      updateCount: number;
      lastRefreshedAt: number;
      status: Doc<"forecasts">["status"];
    };
    const enriched: EditionForecast[] = [];
    for (const f of top) {
      const lastUpdate = await ctx.db
        .query("forecastUpdateHistory")
        .withIndex("by_forecast_date", (q) => q.eq("forecastId", f._id))
        .order("desc")
        .first();
      enriched.push({
        _id: f._id,
        question: f.question,
        forecastType: f.forecastType,
        probability: f.probability ?? null,
        previousProbability: lastUpdate?.previousProbability ?? null,
        confidenceInterval: f.confidenceInterval ?? null,
        resolutionDate: f.resolutionDate,
        resolutionCriteria: f.resolutionCriteria,
        topDrivers: f.topDrivers ?? [],
        topCounterarguments: f.topCounterarguments ?? [],
        updateCount: f.updateCount,
        lastRefreshedAt: f.lastRefreshedAt ?? f.createdAt,
        status: f.status,
      });
    }
    return enriched;
  },
});

/* ────────────────────────────────────────────────────────────────────
 * §4 — Latest dailyBriefSnapshot : already-public, used as-is.
 * Re-exported here so the editorial home has a single import surface
 * and so the BOUND contract stays in this file.
 * ────────────────────────────────────────────────────────────────── */
export const getLatestDailyBriefSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const snapshot = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_generated_at")
      .order("desc")
      .first();
    if (!snapshot) return null;
    return {
      _id: snapshot._id,
      dateString: snapshot.dateString,
      generatedAt: snapshot.generatedAt,
      version: snapshot.version,
      dashboardMetrics: snapshot.dashboardMetrics,
      sourceSummary: snapshot.sourceSummary,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────
 * §6 — Footnotes : evidenceArtifacts referenced by §1–§3 plus recent
 * industryUpdates capped at MAX.
 * ────────────────────────────────────────────────────────────────── */
export const getEditionFootnotes = query({
  args: {
    artifactIds: v.optional(v.array(v.string())),
    industryLimit: v.optional(v.number()),
    artifactLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const industryLimit = boundLimit(
      args.industryLimit,
      FOOTNOTE_INDUSTRY_DEFAULT,
      FOOTNOTE_INDUSTRY_MAX,
    );
    const artifactLimit = boundLimit(
      args.artifactLimit,
      FOOTNOTE_ARTIFACT_DEFAULT,
      FOOTNOTE_ARTIFACT_MAX,
    );

    // 1. Evidence artifacts by (string) artifactId.
    const requestedIds = (args.artifactIds ?? []).slice(0, artifactLimit);
    const artifacts: Array<{
      _id: Id<"evidenceArtifacts">;
      artifactId: string;
      url: string;
      canonicalUrl: string;
      publisher: string;
      publishedAt: number | null;
      credibilityTier: string;
      firstQuote: string | null;
    }> = [];
    const seen = new Set<string>();
    for (const id of requestedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_artifact_id", (q) => q.eq("artifactId", id))
        .first();
      if (!row) continue;
      artifacts.push({
        _id: row._id,
        artifactId: row.artifactId,
        url: row.url,
        canonicalUrl: row.canonicalUrl,
        publisher: row.publisher,
        publishedAt: row.publishedAt ?? null,
        credibilityTier: row.credibilityTier,
        firstQuote: row.extractedQuotes[0]?.text ?? null,
      });
    }

    // 2. Industry updates — most recent first.
    const industryRows = await ctx.db
      .query("industryUpdates")
      .withIndex("by_scanned_at")
      .order("desc")
      .take(industryLimit);
    const industry = industryRows.map((u) => ({
      _id: u._id,
      provider: u.provider,
      providerName: u.providerName,
      url: u.url,
      title: u.title,
      summary: u.summary,
      relevance: u.relevance,
      scannedAt: u.scannedAt,
    }));

    return { artifacts, industry };
  },
});
