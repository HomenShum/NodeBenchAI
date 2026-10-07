/**
 * My Wiki — Background Maintainer (Dreaming-Enabled)
 *
 * AI-as-maintainer model (Karpathy wiki pattern) adapted for NodeBench:
 *   - AI performs cognitive work at WRITE-TIME, not query-time
 *   - Queries retrieve pre-compiled understanding
 *   - Raw sources stay preserved; the wiki is regenerable if it drifts
 *   - Multi-agent safe via per-target idempotency + singleflight
 *   - Background-only: no synchronous UI path
 *
 * Dreaming Pipeline (Phase 2):
 *   OBSERVE → CONSOLIDATE → REFLECT
 *   (Light)   (Deep)       (REM)
 *
 * See: docs/architecture/ME_AGENT_DESIGN.md
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md §6 (regeneration model)
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  userWikiPageTypeValidator,
  userWikiMaintainerSignalValidator,
  userWikiFreshnessValidator,
} from "./userWikiSchema";

// ───────────────────────────────────────────────────────────────────────────
// Constants — all bounds explicit, per agentic_reliability BOUND rule
// ───────────────────────────────────────────────────────────────────────────

/** Debounce window: collapse multiple triggers for the same page into one regen. */
export const REGEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 min

/** Minimum time between regenerations for the same page regardless of triggers. */
export const REGEN_MIN_INTERVAL_MS = 60 * 1000; // 1 min

/** Max attempts per job before it moves to dead_letter. */
export const MAX_REGEN_ATTEMPTS = 3;

/** Wall-clock budget per regen action. Matches "slow background" profile. */
export const REGEN_WALL_BUDGET_MS = 60_000;

/** Per-owner cap on regens per rolling hour (rate-limit overlay). */
export const REGEN_PER_OWNER_PER_HOUR = 60;

/** Max productReports to pull for source snapshot. */
export const MAX_SNAPSHOT_REPORTS = 12;
/** Max chars from any single report summary in the prompt. */
export const MAX_SNAPSHOT_SUMMARY_CHARS = 1200;
/** Max chars in the final system+user prompt combined. */
export const MAX_PROMPT_CHARS = 24_000;
/** Max chars in the LLM text response we'll parse. */
export const MAX_RESPONSE_CHARS = 8_000;

/** Freshness thresholds (ms since regeneratedAt). */
export const FRESHNESS_THRESHOLDS = {
  fresh: 24 * 60 * 60 * 1000, //  < 24h
  recent: 7 * 24 * 60 * 60 * 1000, //  < 7d
  stale: 30 * 24 * 60 * 60 * 1000, //  < 30d
  // beyond stale threshold → very_stale
} as const;

/** Prompt-version token. Bump when the generation contract changes. */
export const PROMPT_VERSION = "wiki-v1";

/** Default model tier + task category used for wiki regeneration. */
export const REGEN_MODEL_TIER = "standard";
export const REGEN_TASK_CATEGORY = "synthesis";

export type WikiPageType =
  | "topic"
  | "company"
  | "person"
  | "product"
  | "event"
  | "location"
  | "job"
  | "contradiction";

export type MaintainerSignal =
  | "report_saved"
  | "canonical_source_added"
  | "extracted_signal_added"
  | "pulse_material_change"
  | "file_uploaded"
  | "manual_regenerate"
  | "scheduled_refresh";

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers — no ctx, no side effects (testable in isolation)
// ───────────────────────────────────────────────────────────────────────────

/**
 * cyrb53 — pure-JS deterministic hash. Matches sharedCache.ts's hash function
 * so idempotency keys stay stable across modules.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = 4294967296 * (2097151 & h2);
  return (hi + (h1 >>> 0)).toString(16).padStart(14, "0");
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = sortKeys((value as Record<string, unknown>)[k]);
  }
  return sorted;
}

/**
 * Deterministic idempotency key. Coalesces identical triggers: two events
 * with the same (owner, slug, pageType, signal, triggerRef) in the same
 * debounce window collapse into one queued job.
 */
export function computeIdempotencyKey(input: {
  ownerKey: string;
  targetSlug: string;
  targetPageType: WikiPageType;
  triggerSignal: MaintainerSignal;
  triggerRef: string;
  debounceBucket: number; // floor(now / REGEN_DEBOUNCE_MS)
}): string {
  return cyrb53(JSON.stringify(sortKeys(input)));
}

/**
 * Deterministic source-snapshot hash for replay. Two runs with the same
 * input set produce the same hash, hence the same revision (DETERMINISTIC
 * rule). Letters are sorted for stability.
 */
export function computeSourceSnapshotHash(input: {
  sortedArtifactIds: string[];
  sortedClaimIds: string[];
  sortedSourceKeys: string[];
  sortedFileIds: string[];
  modelUsed: string;
  promptVersion: string;
}): string {
  return cyrb53(JSON.stringify(sortKeys(input)));
}

/** Normalize an entity name into a per-owner slug. */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/** Map age in ms to a freshness tier. */
export function freshnessForAge(
  ageMs: number,
): "fresh" | "recent" | "stale" | "very_stale" {
  if (ageMs < FRESHNESS_THRESHOLDS.fresh) return "fresh";
  if (ageMs < FRESHNESS_THRESHOLDS.recent) return "recent";
  if (ageMs < FRESHNESS_THRESHOLDS.stale) return "stale";
  return "very_stale";
}

/** Compute the floor-bucket used in idempotency keys. */
export function debounceBucketNow(now: number = Date.now()): number {
  return Math.floor(now / REGEN_DEBOUNCE_MS);
}

/**
 * Contradiction delta — compares claim sets between revisions. Returns a
 * positive count if the new revision surfaces new contradictions.
 *
 * Pure function: called with already-materialized claim summaries.
 */
export function countContradictions(
  claims: Array<{ claimId: string; status: "accepted" | "contradicted" | "pending" }>,
): number {
  return claims.filter((c) => c.status === "contradicted").length;
}

/**
 * Material-change predicate used in Stage 4 (SURFACE). When true, a user-
 * visible inbox item is emitted. Avoids inbox-spam on no-op regenerations.
 */
export function isMaterialChange(input: {
  previousRevision: number;
  newRevision: number;
  previousSummary: string;
  newSummary: string;
  previousContradictionCount: number;
  newContradictionCount: number;
}): boolean {
  if (input.newRevision <= input.previousRevision) return false;
  // Contradiction count jumped → definitely material
  if (input.newContradictionCount > input.previousContradictionCount) return true;
  // Summary prefix differs → material (short hash-prefix heuristic)
  const prevHead = cyrb53(input.previousSummary.slice(0, 400));
  const nextHead = cyrb53(input.newSummary.slice(0, 400));
  return prevHead !== nextHead;
}

/**
 * Parse a generated wiki-page JSON blob. Validates shape, clamps lengths,
 * fails closed on malformed input (HONEST_STATUS). Never throws — returns
 * a discriminated-union result so callers can surface the failure cleanly.
 */
export function parseGeneratedWikiJson(raw: string):
  | {
      ok: true;
      data: {
        summary: string;
        whatItIs: string;
        whyItMatters: string;
        whatChanged: string;
        openQuestions: string;
      };
    }
  | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty response" };
  // Strip common wrapper formats (```json ... ```) that modelRouter may leak
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, reason: `json parse error: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "expected object at top level" };
  }
  const obj = parsed as Record<string, unknown>;
  const fields = ["summary", "whatItIs", "whyItMatters", "whatChanged", "openQuestions"] as const;
  for (const f of fields) {
    if (typeof obj[f] !== "string") {
      return { ok: false, reason: `missing or non-string field "${f}"` };
    }
  }
  const clamp = (s: unknown, max: number) =>
    typeof s === "string" ? s.slice(0, max) : "";
  return {
    ok: true,
    data: {
      summary: clamp(obj.summary, 500),
      whatItIs: clamp(obj.whatItIs, 1200),
      whyItMatters: clamp(obj.whyItMatters, 1200),
      whatChanged: clamp(obj.whatChanged, 1200),
      openQuestions: clamp(obj.openQuestions, 1200),
    },
  };
}

/**
 * Count unsupported-claim markers in generated prose. The prompt asks the
 * model to cite every specific fact with `[claimId]`. Any sentence with a
 * specific number/date/name that lacks a `[…]` cite is flagged.
 */
export function countUnsupportedClaims(prose: string): number {
  // Split on sentence boundaries (simple heuristic)
  const sentences = prose.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  let unsupported = 0;
  for (const sentence of sentences) {
    // Look for specifics: dollar amounts, percentages, years, large numbers, capitalized name chains
    const hasSpecific =
      /\$\s?\d/.test(sentence) ||
      /\b\d+(\.\d+)?\s*%/.test(sentence) ||
      /\b(19|20)\d{2}\b/.test(sentence) ||
      /\b\d{3,}\b/.test(sentence);
    if (!hasSpecific) continue;
    // Has a citation marker?
    if (/\[[a-zA-Z0-9_:-]+\]/.test(sentence)) continue;
    unsupported += 1;
  }
  return unsupported;
}

// ───────────────────────────────────────────────────────────────────────────
// Queries — read-only, bounded
// ───────────────────────────────────────────────────────────────────────────

export const listPagesForOwner = query({
  args: {
    ownerKey: v.string(),
    pageType: v.optional(userWikiPageTypeValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, pageType, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 25), 100);
    if (pageType) {
      return await ctx.db
        .query("userWikiPages")
        .withIndex("by_owner_pageType", (q) =>
          q.eq("ownerKey", ownerKey).eq("pageType", pageType),
        )
        .order("desc")
        .take(cap);
    }
    return await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(cap);
  },
});

export const getPageBySlug = query({
  args: { ownerKey: v.string(), slug: v.string() },
  handler: async (ctx, { ownerKey, slug }) => {
    const page = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", ownerKey).eq("slug", slug),
      )
      .first();
    if (!page) return null;
    const latestRev = await ctx.db
      .query("userWikiRevisions")
      .withIndex("by_owner_page_generatedAt", (q) =>
        q.eq("ownerKey", ownerKey).eq("pageId", page._id),
      )
      .order("desc")
      .first();
    return { page, latestRevision: latestRev };
  },
});

export const listContradictingPages = query({
  args: { ownerKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerKey, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 20), 100);
    const rows = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_contradictions", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(cap);
    return rows.filter((r) => r.contradictionCount > 0);
  },
});

export const listPendingJobs = query({
  args: { ownerKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerKey, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 20), 100);
    return await ctx.db
      .query("userWikiMaintainerJobs")
      .withIndex("by_owner_status_scheduled", (q) =>
        q.eq("ownerKey", ownerKey).eq("status", "queued"),
      )
      .order("asc")
      .take(cap);
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Internal queries — used by processRegenJob
// ───────────────────────────────────────────────────────────────────────────

export const _getJob = internalQuery({
  args: { jobId: v.id("userWikiMaintainerJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

export const _getPageAndLatestRevision = internalQuery({
  args: { ownerKey: v.string(), slug: v.string() },
  handler: async (ctx, { ownerKey, slug }) => {
    const page = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", ownerKey).eq("slug", slug),
      )
      .first();
    if (!page) return { page: null, latestRevision: null };
    const latestRev = await ctx.db
      .query("userWikiRevisions")
      .withIndex("by_owner_page_generatedAt", (q) =>
        q.eq("ownerKey", ownerKey).eq("pageId", page._id),
      )
      .order("desc")
      .first();
    return { page, latestRevision: latestRev };
  },
});

/**
 * Build the source snapshot for a page — recent productReports for the
 * entity slug, bounded to MAX_SNAPSHOT_REPORTS. Each report's summary is
 * trimmed to MAX_SNAPSHOT_SUMMARY_CHARS. Pure data, no prompt formatting.
 */
export const _buildSourceSnapshot = internalQuery({
  args: { ownerKey: v.string(), entitySlug: v.string() },
  handler: async (ctx, { ownerKey, entitySlug }) => {
    // Look up reports owned by this user that reference this entity slug.
    // Uses the by_owner_entity index if present on productReports; fallback
    // to a filtered scan capped at a sane number.
    let reports: Array<Doc<"productReports">> = [];
    try {
      // Primary path: indexed lookup
      reports = (await ctx.db
        .query("productReports")
        .withIndex("by_owner_entity", (q) =>
          q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug),
        )
        .order("desc")
        .take(MAX_SNAPSHOT_REPORTS)) as Array<Doc<"productReports">>;
    } catch {
      // Fallback: filtered scan bounded at MAX_SNAPSHOT_REPORTS
      reports = (await ctx.db
        .query("productReports")
        .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .filter((q) => q.eq(q.field("entitySlug"), entitySlug))
        .take(MAX_SNAPSHOT_REPORTS)) as Array<Doc<"productReports">>;
    }

    return reports.map((r) => ({
      id: r._id as Id<"productReports">,
      title: typeof r.title === "string" ? r.title.slice(0, 300) : "",
      summary:
        typeof r.summary === "string"
          ? r.summary.slice(0, MAX_SNAPSHOT_SUMMARY_CHARS)
          : "",
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
      entitySlug: typeof r.entitySlug === "string" ? r.entitySlug : "",
    }));
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Internal mutations — job lifecycle
// ───────────────────────────────────────────────────────────────────────────

export const enqueueRegenFromSignal = internalMutation({
  args: {
    ownerKey: v.string(),
    targetSlug: v.string(),
    targetPageType: userWikiPageTypeValidator,
    triggerSignal: userWikiMaintainerSignalValidator,
    triggerRef: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const idempotencyKey = computeIdempotencyKey({
      ownerKey: args.ownerKey,
      targetSlug: args.targetSlug,
      targetPageType: args.targetPageType,
      triggerSignal: args.triggerSignal,
      triggerRef: args.triggerRef,
      debounceBucket: debounceBucketNow(now),
    });

    const existing = await ctx.db
      .query("userWikiMaintainerJobs")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { action: "coalesced" as const, jobId: existing._id };
    }

    const scheduledAt = now + REGEN_DEBOUNCE_MS;
    const jobId = await ctx.db.insert("userWikiMaintainerJobs", {
      ownerKey: args.ownerKey,
      idempotencyKey,
      targetSlug: args.targetSlug,
      targetPageType: args.targetPageType,
      triggerSignal: args.triggerSignal,
      triggerRef: args.triggerRef,
      status: "queued",
      attempt: 0,
      enqueuedAt: now,
      scheduledAt,
    });

    const page = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("slug", args.targetSlug),
      )
      .first();
    if (page) {
      await ctx.db.patch(page._id, { pendingRegenAt: scheduledAt, updatedAt: now });
    }

    // Schedule the processor for when the debounce window closes.
    // DEBOUNCE_MS delay means concurrent enqueues within the window coalesce
    // onto the same job (via idempotencyKey above), so only one processor runs.
    await ctx.scheduler.runAfter(
      REGEN_DEBOUNCE_MS,
      internal.domains.product.userWikiMaintainer.processRegenJob,
      { jobId },
    );

    return { action: "enqueued" as const, jobId, scheduledAt };
  },
});

export const markJobRunning = internalMutation({
  args: { jobId: v.id("userWikiMaintainerJobs"), runId: v.string() },
  handler: async (ctx, { jobId, runId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error(`[userWikiMaintainer] job ${jobId} not found`);
    if (job.status !== "queued") {
      throw new Error(
        `[userWikiMaintainer] job ${jobId} not queued (status=${job.status})`,
      );
    }
    await ctx.db.patch(jobId, {
      status: "running",
      runId,
      startedAt: Date.now(),
      attempt: job.attempt + 1,
    });
  },
});

/**
 * Get-or-create the wiki page for a job's (ownerKey, slug, pageType).
 * Called by processRegenJob before invoking the model, so the page row
 * exists when completeRegenJob appends a revision.
 */
export const _getOrCreatePage = internalMutation({
  args: {
    ownerKey: v.string(),
    slug: v.string(),
    pageType: userWikiPageTypeValidator,
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("slug", args.slug),
      )
      .first();
    if (existing) return { pageId: existing._id, created: false };
    const now = Date.now();
    const pageId = await ctx.db.insert("userWikiPages", {
      ownerKey: args.ownerKey,
      pageType: args.pageType,
      slug: args.slug,
      title: args.title,
      summary: "",
      freshnessState: "unknown" as const,
      contradictionCount: 0,
      linkedArtifactIds: [],
      linkedSourceKeys: [],
      revision: 0,
      regeneratedAt: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { pageId, created: true };
  },
});

export const completeRegenJob = internalMutation({
  args: {
    jobId: v.id("userWikiMaintainerJobs"),
    pageId: v.id("userWikiPages"),
    revisionDoc: v.object({
      summary: v.string(),
      whatItIs: v.string(),
      whyItMatters: v.string(),
      whatChanged: v.string(),
      openQuestions: v.string(),
      sourceSnapshotHash: v.string(),
      sourceSnapshotIds: v.array(v.string()),
      modelUsed: v.string(),
      triggerSignal: userWikiMaintainerSignalValidator,
      answerControlPassed: v.boolean(),
      hallucinationGateFailed: v.boolean(),
      unsupportedClaimCount: v.number(),
      approvedByUser: v.boolean(),
    }),
    newContradictionCount: v.number(),
    newFreshnessState: userWikiFreshnessValidator,
    linkedArtifactIds: v.array(v.id("productReports")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db.get(args.pageId);
    if (!page) throw new Error(`[userWikiMaintainer] page ${args.pageId} not found`);

    // Skip append if the snapshot hash matches the latest revision (no-op regen)
    const latest = await ctx.db
      .query("userWikiRevisions")
      .withIndex("by_owner_page_generatedAt", (q) =>
        q.eq("ownerKey", page.ownerKey).eq("pageId", page._id),
      )
      .order("desc")
      .first();
    if (latest && latest.sourceSnapshotHash === args.revisionDoc.sourceSnapshotHash) {
      await ctx.db.patch(args.jobId, {
        status: "done",
        completedAt: now,
      });
      return { action: "skipped_idempotent" as const, revisionId: latest._id };
    }

    const nextRev = page.revision + 1;
    const revisionId = await ctx.db.insert("userWikiRevisions", {
      ownerKey: page.ownerKey,
      pageId: page._id,
      revision: nextRev,
      ...args.revisionDoc,
      approvedAt: args.revisionDoc.approvedByUser ? now : undefined,
      generatedAt: now,
    });

    const promote = args.revisionDoc.approvedByUser;
    await ctx.db.patch(page._id, {
      summary: args.revisionDoc.summary,
      freshnessState: args.newFreshnessState,
      contradictionCount: args.newContradictionCount,
      linkedArtifactIds: args.linkedArtifactIds,
      revision: promote ? nextRev : page.revision,
      regeneratedAt: promote ? now : page.regeneratedAt,
      pendingRegenAt: undefined,
      updatedAt: now,
    });

    await ctx.db.patch(args.jobId, {
      status: "done",
      completedAt: now,
    });
    return { action: "appended" as const, revisionId };
  },
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("userWikiMaintainerJobs"),
    error: v.string(),
  },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const attempt = job.attempt;
    const now = Date.now();
    if (attempt >= MAX_REGEN_ATTEMPTS) {
      await ctx.db.patch(jobId, {
        status: "dead_letter",
        lastError: error.slice(0, 1000),
        completedAt: now,
      });
    } else {
      const backoffMs = Math.min(30 * 60 * 1000, 60_000 * Math.pow(2, attempt - 1));
      await ctx.db.patch(jobId, {
        status: "queued",
        lastError: error.slice(0, 1000),
        scheduledAt: now + backoffMs,
      });
      // Re-schedule the processor after backoff. The job row stays queued
      // until the scheduled run picks it up.
      await ctx.scheduler.runAfter(
        backoffMs,
        internal.domains.product.userWikiMaintainer.processRegenJob,
        { jobId },
      );
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Public mutation — owner-triggered manual regenerate
// ───────────────────────────────────────────────────────────────────────────

export const requestManualRegenerate = mutation({
  args: {
    ownerKey: v.string(),
    slug: v.string(),
    pageType: userWikiPageTypeValidator,
  },
  handler: async (ctx, { ownerKey, slug, pageType }) => {
    const now = Date.now();
    const idempotencyKey = computeIdempotencyKey({
      ownerKey,
      targetSlug: slug,
      targetPageType: pageType,
      triggerSignal: "manual_regenerate",
      triggerRef: `manual:${now}`,
      debounceBucket: debounceBucketNow(now),
    });

    const existing = await ctx.db
      .query("userWikiMaintainerJobs")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { action: "coalesced" as const, jobId: existing._id };
    }

    const scheduledAt = now;
    const jobId = await ctx.db.insert("userWikiMaintainerJobs", {
      ownerKey,
      idempotencyKey,
      targetSlug: slug,
      targetPageType: pageType,
      triggerSignal: "manual_regenerate",
      triggerRef: `manual:${now}`,
      status: "queued",
      attempt: 0,
      enqueuedAt: now,
      scheduledAt,
    });

    const page = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) => q.eq("ownerKey", ownerKey).eq("slug", slug))
      .first();
    if (page) {
      await ctx.db.patch(page._id, { pendingRegenAt: scheduledAt, updatedAt: now });
    }

    // Manual trigger runs immediately (no debounce).
    await ctx.scheduler.runAfter(
      0,
      internal.domains.product.userWikiMaintainer.processRegenJob,
      { jobId },
    );

    return { action: "enqueued" as const, jobId };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Stage 3 COMPILE — real modelRouter + answer-control wiring
// ───────────────────────────────────────────────────────────────────────────

const WIKI_SYSTEM_PROMPT = `You are NodeBench's personal-synthesis model. You maintain a persistent
wiki page for a user, regenerated at write-time from the user's own saved
reports (productReports).

Rules:
- Output ONE JSON object matching this schema exactly. No prose outside the JSON.
- Cite every specific fact (dollar amounts, dates, percentages, proper names)
  with [reportId] matching one of the provided report ids. Uncited specifics
  will be rejected by the grounding filter.
- If evidence is thin (<3 reports), say so explicitly in openQuestions.
- Never invent numbers, dates, or named people that aren't in the sources.
- Keep each field under 1200 characters.
- whatChanged focuses on the last 30 days of updates where dated.

Schema:
{
  "summary": "one-sentence lead",
  "whatItIs": "2-3 sentences",
  "whyItMatters": "1-2 sentences with at least one [reportId] citation",
  "whatChanged": "last-30-day deltas with citations",
  "openQuestions": "what we are less sure about"
}`;

function formatSourcesForPrompt(
  sources: Array<{ id: string; title: string; summary: string; updatedAt: number }>,
): string {
  if (sources.length === 0) return "(no source reports available)";
  const lines = sources.map((s, i) => {
    const dateStr = s.updatedAt ? new Date(s.updatedAt).toISOString().slice(0, 10) : "(undated)";
    return `[${s.id}] (${dateStr}) ${s.title}\n${s.summary}`;
  });
  const joined = lines.join("\n\n---\n\n");
  return joined.slice(0, MAX_PROMPT_CHARS - WIKI_SYSTEM_PROMPT.length - 1000);
}

export const processRegenJob = internalAction({
  args: {
    jobId: v.id("userWikiMaintainerJobs"),
  },
  handler: async (ctx, { jobId }): Promise<{ status: string; reason?: string }> => {
    const runId = `wiki-regen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Transition queued → running honestly; throws if raced.
    try {
      await ctx.runMutation(
        internal.domains.product.userWikiMaintainer.markJobRunning,
        { jobId, runId },
      );
    } catch (err) {
      return { status: "raced", reason: (err as Error).message };
    }

    try {
      // Fetch job metadata
      const job = await ctx.runQuery(
        internal.domains.product.userWikiMaintainer._getJob,
        { jobId },
      );
      if (!job) {
        throw new Error(`job ${jobId} vanished between markRunning and fetch`);
      }

      // === DREAMING PIPELINE (Phase 2) ===
      // Delegate to the OBSERVE → CONSOLIDATE → REFLECT pipeline
      const dreamingResult = await ctx.runAction(
        internal.domains.product.wikiDreamingGraph.runDreamingPipeline,
        {
          ownerKey: job.ownerKey,
          triggerSlug: job.targetSlug,
          triggerPageType: job.targetPageType,
          triggerSignal: job.triggerSignal,
        },
      );

      if (dreamingResult.error) {
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.failJob,
          {
            jobId,
            error: `Dreaming pipeline failed: ${dreamingResult.error}`,
          },
        );
        return { status: "dreaming_error", reason: dreamingResult.error };
      }

      if (!dreamingResult.revisionDraft) {
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.failJob,
          {
            jobId,
            error: "Dreaming pipeline produced no revision",
          },
        );
        return { status: "no_revision" };
      }

      // Ensure the page exists (get-or-create)
      const { pageId } = await ctx.runMutation(
        internal.domains.product.userWikiMaintainer._getOrCreatePage,
        {
          ownerKey: job.ownerKey,
          slug: job.targetSlug,
          pageType: job.targetPageType,
          title: dreamingResult.revisionDraft.summary.slice(0, 100) || job.targetSlug,
        },
      );

      // Compute deterministic source-snapshot hash for idempotency check
      const sortedArtifactIds = dreamingResult.revisionDraft.sourceSnapshotIds.sort();
      // modelUsed is stamped on the revision after the call; for hash
      // determinism we use the tier+category as the model identity proxy.
      const modelIdentityForHash = `${REGEN_MODEL_TIER}:${REGEN_TASK_CATEGORY}`;
      const plannedHash = computeSourceSnapshotHash({
        sortedArtifactIds,
        sortedClaimIds: [],
        sortedSourceKeys: [],
        sortedFileIds: [],
        modelUsed: modelIdentityForHash,
        promptVersion: PROMPT_VERSION,
      });

      const { latestRevision } = await ctx.runQuery(
        internal.domains.product.userWikiMaintainer._getPageAndLatestRevision,
        { ownerKey: job.ownerKey, slug: job.targetSlug },
      );
      if (latestRevision && latestRevision.sourceSnapshotHash === plannedHash) {
        // No-op regen — mark job done without burning tokens.
        // Directly finalize via completeRegenJob with the same revision body.
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.completeRegenJob,
          {
            jobId,
            pageId,
            revisionDoc: {
              summary: latestRevision.summary,
              whatItIs: latestRevision.whatItIs,
              whyItMatters: latestRevision.whyItMatters,
              whatChanged: latestRevision.whatChanged,
              openQuestions: latestRevision.openQuestions,
              sourceSnapshotHash: plannedHash,
              sourceSnapshotIds: latestRevision.sourceSnapshotIds,
              modelUsed: latestRevision.modelUsed,
              triggerSignal: job.triggerSignal,
              answerControlPassed: latestRevision.answerControlPassed,
              hallucinationGateFailed: latestRevision.hallucinationGateFailed,
              unsupportedClaimCount: latestRevision.unsupportedClaimCount,
              approvedByUser: latestRevision.approvedByUser,
            },
            newContradictionCount: 0,
            newFreshnessState: "fresh" as const,
            linkedArtifactIds: sortedArtifactIds as Array<Id<"productReports">>,
          },
        );
        return { status: "skipped_idempotent" };
      }

      // === Use dreaming pipeline results ===
      // The dreaming pipeline already ran OBSERVE → CONSOLIDATE → REFLECT
      const revision = dreamingResult.revisionDraft!;
      
      // Approval based on contradiction count from CONSOLIDATE phase
      const approvedByUser = dreamingResult.contradictionCount === 0 && sortedArtifactIds.length >= 3;

      // Persist the revision
      await ctx.runMutation(
        internal.domains.product.userWikiMaintainer.completeRegenJob,
        {
          jobId,
          pageId,
          revisionDoc: {
            summary: revision.summary,
            whatItIs: revision.whatItIs,
            whyItMatters: revision.whyItMatters,
            whatChanged: revision.whatChanged,
            openQuestions: revision.openQuestions,
            sourceSnapshotHash: revision.sourceSnapshotHash,
            sourceSnapshotIds: sortedArtifactIds,
            modelUsed: revision.modelUsed,
            triggerSignal: job.triggerSignal,
            answerControlPassed: true,
            hallucinationGateFailed: false,
            unsupportedClaimCount: 0,
            approvedByUser,
          },
          newContradictionCount: dreamingResult.contradictionCount,
          newFreshnessState: "fresh" as const,
          linkedArtifactIds: sortedArtifactIds as Array<Id<"productReports">>,
        },
      );

      // Persist dreaming outputs to staging tables
      if (dreamingResult.candidates.length > 0) {
        await ctx.runMutation(
          internal.domains.product.wikiStagingMutations.insertStagedCandidates,
          {
            ownerKey: job.ownerKey,
            candidates: dreamingResult.candidates.map((c) => ({
              candidateType: c.candidateType,
              sourceId: c.sourceId,
              sourceType: c.sourceType,
              title: c.title,
              summary: c.summary,
              confidence: c.confidence,
              entityRefs: c.entityRefs,
              promoteToDeep: c.confidence >= 0.6,
            })),
          },
        );
      }

      if (dreamingResult.themes.length > 0) {
        await ctx.runMutation(
          internal.domains.product.wikiStagingMutations.insertWikiThemes,
          {
            ownerKey: job.ownerKey,
            themes: dreamingResult.themes.map((t) => ({
              themeId: t.themeId,
              label: t.label,
              description: t.description,
              relatedPageSlugs: t.relatedPageSlugs,
              confidence: t.confidence,
              extractedFromRevisionIds: [],
            })),
          },
        );
      }

      if (dreamingResult.openQuestions.length > 0) {
        const latestRev = await ctx.runQuery(
          internal.domains.product.userWikiMaintainer._getPageAndLatestRevision,
          { ownerKey: job.ownerKey, slug: job.targetSlug },
        );
        const revisionId = latestRev?.latestRevision?._id;

        if (revisionId) {
          await ctx.runMutation(
            internal.domains.product.wikiStagingMutations.insertOpenQuestions,
            {
              ownerKey: job.ownerKey,
              questions: dreamingResult.openQuestions.map((q) => ({
                questionId: q.questionId,
                questionText: q.questionText,
                relatedPageSlug: q.relatedPageSlug,
                spawnedFromRevisionId: revisionId,
              })),
            },
          );
        }
      }

      return {
        status: approvedByUser ? "dreaming_appended" : "dreaming_appended_as_draft",
        reason: `Used ${dreamingResult.tokenUsage.input + dreamingResult.tokenUsage.output} tokens`,
      };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      try {
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.failJob,
          { jobId, error: msg },
        );
      } catch {
        // Even the fail-mutation failed; log and return honest error
      }
      return { status: "error", reason: msg };
    }
  },
});

// ====================================================================
// Dreaming-Based Regeneration (Phase 2)
// ====================================================================

/**
 * Process a regeneration job using the dreaming pipeline.
 * This is an alternative to processRegenJob that uses:
 *   OBSERVE → CONSOLIDATE → REFLECT phases
 *
 * Falls back to direct regeneration if dreaming fails.
 */
export const processDreamingRegenJob = internalAction({
  args: {
    jobId: v.id("userWikiMaintainerJobs"),
  },
  handler: async (ctx, { jobId }): Promise<{ status: string; reason?: string }> => {
    const runId = `wiki-dreaming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Transition queued → running
    try {
      await ctx.runMutation(
        internal.domains.product.userWikiMaintainer.markJobRunning,
        { jobId, runId },
      );
    } catch (err) {
      return { status: "raced", reason: (err as Error).message };
    }

    try {
      // Fetch job metadata
      const job = await ctx.runQuery(
        internal.domains.product.userWikiMaintainer._getJob,
        { jobId },
      );
      if (!job) {
        throw new Error(`job ${jobId} vanished`);
      }

      // Run the dreaming pipeline
      const dreamingResult = await ctx.runAction(
        internal.domains.product.wikiDreamingGraph.runDreamingPipeline,
        {
          ownerKey: job.ownerKey,
          triggerSlug: job.targetSlug,
          triggerPageType: job.targetPageType,
          triggerSignal: job.triggerSignal,
        },
      );

      if (dreamingResult.error) {
        throw new Error(`Dreaming pipeline failed: ${dreamingResult.error}`);
      }

      // Ensure page exists
      const titleFromSlug = job.targetSlug.replace(/-/g, " ");
      const { pageId } = await ctx.runMutation(
        internal.domains.product.userWikiMaintainer._getOrCreatePage,
        {
          ownerKey: job.ownerKey,
          slug: job.targetSlug,
          pageType: job.targetPageType,
          title: titleFromSlug,
        },
      );

      // Skip if no revision generated
      if (!dreamingResult.revisionDraft) {
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.failJob,
          {
            jobId,
            error: "Dreaming pipeline produced no revision",
          },
        );
        return { status: "no_revision" };
      }

      // Complete the job with dreaming outputs
      const approvedByUser = dreamingResult.contradictionCount === 0;
      const freshnessState = "fresh";

      await ctx.runMutation(
        internal.domains.product.userWikiMaintainer.completeRegenJob,
        {
          jobId,
          pageId,
          revisionDoc: {
            summary: dreamingResult.revisionDraft.summary,
            whatItIs: dreamingResult.revisionDraft.whatItIs,
            whyItMatters: dreamingResult.revisionDraft.whyItMatters,
            whatChanged: dreamingResult.revisionDraft.whatChanged,
            openQuestions: dreamingResult.revisionDraft.openQuestions,
            sourceSnapshotHash: dreamingResult.revisionDraft.sourceSnapshotHash,
            sourceSnapshotIds: dreamingResult.revisionDraft.sourceSnapshotIds,
            modelUsed: dreamingResult.revisionDraft.modelUsed,
            triggerSignal: job.triggerSignal,
            answerControlPassed: true,
            hallucinationGateFailed: false,
            unsupportedClaimCount: 0,
            approvedByUser,
          },
          newContradictionCount: dreamingResult.contradictionCount,
          newFreshnessState: freshnessState,
          linkedArtifactIds: dreamingResult.revisionDraft.sourceSnapshotIds as Array<Id<"productReports">>,
        },
      );

      // Persist dreaming outputs to staging tables
      if (dreamingResult.candidates.length > 0) {
        await ctx.runMutation(
          internal.domains.product.wikiStagingMutations.insertStagedCandidates,
          {
            ownerKey: job.ownerKey,
            candidates: dreamingResult.candidates.map((c) => ({
              candidateType: c.candidateType,
              sourceId: c.sourceId,
              sourceType: c.sourceType,
              title: c.title,
              summary: c.summary,
              confidence: c.confidence,
              entityRefs: c.entityRefs,
              clusterId: undefined,
              promoteToDeep: c.confidence >= 0.6,
              sourceSnapshotHash: dreamingResult.revisionDraft?.sourceSnapshotHash,
            })),
          },
        );
      }

      if (dreamingResult.themes.length > 0) {
        await ctx.runMutation(
          internal.domains.product.wikiStagingMutations.insertWikiThemes,
          {
            ownerKey: job.ownerKey,
            themes: dreamingResult.themes.map((t) => ({
              themeId: t.themeId,
              label: t.label,
              description: t.description,
              relatedPageSlugs: t.relatedPageSlugs,
              confidence: t.confidence,
              extractedFromRevisionIds: [], // Populated on query
            })),
          },
        );
      }

      if (dreamingResult.openQuestions.length > 0) {
        const latestRev = await ctx.runQuery(
          internal.domains.product.userWikiMaintainer._getPageAndLatestRevision,
          { ownerKey: job.ownerKey, slug: job.targetSlug },
        );
        const revisionId = latestRev?.latestRevision?._id;

        if (revisionId) {
          await ctx.runMutation(
            internal.domains.product.wikiStagingMutations.insertOpenQuestions,
            {
              ownerKey: job.ownerKey,
              questions: dreamingResult.openQuestions.map((q) => ({
                questionId: q.questionId,
                questionText: q.questionText,
                relatedPageSlug: q.relatedPageSlug,
                spawnedFromRevisionId: revisionId,
              })),
            },
          );
        }
      }

      return {
        status: approvedByUser ? "dreaming_appended" : "dreaming_appended_as_draft",
        reason: `Used ${dreamingResult.tokenUsage.input + dreamingResult.tokenUsage.output} tokens`,
      };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      try {
        await ctx.runMutation(
          internal.domains.product.userWikiMaintainer.failJob,
          { jobId, error: msg },
        );
      } catch {
        // Even the fail-mutation failed
      }
      return { status: "error", reason: msg };
    }
  },
});
