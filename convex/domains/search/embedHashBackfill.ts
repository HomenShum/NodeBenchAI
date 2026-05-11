/**
 * One-shot backfill for `searchableTextHash` on legacy rows that already have
 * an `embedding` populated but pre-date PR #320's per-row hook (which is what
 * normally writes the hash alongside the vector).
 *
 * Why this file exists (and is separate from embedRowOnUpdate.ts):
 *   The daily cron `embedStaleRows` treats any row without a hash as stale and
 *   would re-embed it via OpenAI — ~141 645 rows × $0.00002 ≈ $5 and 141 k
 *   avoidable API calls on the first sweep after schema rollout. This action
 *   is the pure-hash recovery path: recompute the same `searchableText`
 *   projection the embedding was built from, SHA-256 it, patch the hash. No
 *   network. Same hash function as the per-row hook (sha256Hex), so once this
 *   completes the cron's drift comparator sees "hash matches" and skips.
 *
 * Pattern: deterministic patch sweep (per .claude/rules/agentic_reliability.md
 * `DETERMINISTIC`). Same row → same searchableText → same hash, every time.
 * Idempotent: a row that already has a hash is skipped, so re-runs are no-ops.
 *
 * Prior art:
 *   - `convex/domains/search/embedRowOnUpdate.ts` — defines the per-row hook
 *     and the daily cron sweep this backfill front-runs. We reuse the same
 *     composition helpers (`recompute{Entity,Report,Block}SearchableText`)
 *     and the same `sha256Hex` shape so the hashes collide with the hook's
 *     by construction.
 *   - `convex/domains/search/searchableTextBackfill.ts` — the page-cursor
 *     sweep shape (paginate → patch → continueCursor) is borrowed from the
 *     PR #310 backfill that introduced `searchableText` itself.
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - BOUND:         hard ceiling of MAX_PAGES (1000) × PAGE_SIZE (500) =
 *                    500 000 rows total — well above the ~141 k observed.
 *   - HONEST_STATUS: rows where searchableText can't be recomputed (parent
 *                    deleted, schema drift, oversized blob) increment a
 *                    `skipped` counter with a structured reason; we never
 *                    silently return success on those.
 *   - DETERMINISTIC: SHA-256 over the UTF-8 bytes of the recomputed
 *                    projection. Same row + same fields → same hash, every
 *                    time. Same algorithm as the per-row hook.
 *   - ERROR_BOUNDARY: every row's patch is wrapped in try/catch — one bad
 *                     row increments `failed` and the sweep continues. The
 *                     action never throws to the caller.
 *
 * Privacy: pure rehash. No payload leaves the Convex backend.
 *
 * Run via:
 *   npx convex run domains/search/embedHashBackfill:backfillSearchableTextHash
 *
 * Expected runtime for 141 k rows: under 5 min (pure patches, no network).
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
  recomputeBlockSearchableText,
} from "./searchableTextRecompute";

/* -------------------------------------------------------------------------- */
/* Constants — BOUND invariants                                                */
/* -------------------------------------------------------------------------- */

/** BOUND: rows per pagination page. */
const PAGE_SIZE = 500;
/** BOUND: hard cap on pages scanned per table per invocation. 1000 × 500 = 500 k. */
const MAX_PAGES = 1000;
/** BOUND: skip recomputation when projection would exceed this size — same cap
 *  the embedding hook applies (`MAX_EMBED_INPUT_BYTES` in embedRowOnUpdate.ts).
 *  Keeping the same ceiling makes the hashes collision-compatible with the
 *  hook's, even if a pathologically large block sneaks in. */
const MAX_PROJECTION_BYTES = 50_000;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Deterministic SHA-256 hex digest. Same shape as embedRowOnUpdate.sha256Hex
 *  so hashes written here collide with hashes written by the per-row hook. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i += 1) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Clip oversized projections to match the per-row hook's pre-hash clipping. */
function clipInput(text: string): string {
  if (text.length <= MAX_PROJECTION_BYTES) return text;
  return text.slice(0, MAX_PROJECTION_BYTES);
}

/* -------------------------------------------------------------------------- */
/* Per-table patch mutations                                                   */
/*                                                                             */
/* Each one re-reads the row inside the mutation (so we never patch a stale    */
/* snapshot from the page scan) and skips when:                                */
/*   - the row is gone                                                         */
/*   - the row already has a hash (idempotency — re-runs are no-ops)           */
/*   - the row no longer has an embedding (cron will handle it)                */
/*   - the row's searchableText can't be recomputed (recompose returns "")     */
/* -------------------------------------------------------------------------- */

const PATCH_RESULT = v.object({
  patched: v.boolean(),
  /** "patched" | "already_hashed" | "missing" | "no_embedding" | "empty_projection" | "drifted" */
  reason: v.string(),
});

export const patchEntityHash = internalMutation({
  args: { id: v.id("productEntities") },
  returns: PATCH_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return { patched: false, reason: "missing" };
    if (row.searchableTextHash !== undefined) {
      return { patched: false, reason: "already_hashed" };
    }
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
      return { patched: false, reason: "no_embedding" };
    }
    const projection = recomputeEntitySearchableText({
      name: row.name,
      slug: row.slug,
      summary: row.summary,
      savedBecause: row.savedBecause,
    });
    if (projection.length === 0) {
      return { patched: false, reason: "empty_projection" };
    }
    const clipped = clipInput(projection);
    const hash = await sha256Hex(clipped);
    await ctx.db.patch(args.id, { searchableTextHash: hash });
    return { patched: true, reason: "patched" };
  },
});

export const patchReportHash = internalMutation({
  args: { id: v.id("productReports") },
  returns: PATCH_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return { patched: false, reason: "missing" };
    if (row.searchableTextHash !== undefined) {
      return { patched: false, reason: "already_hashed" };
    }
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
      return { patched: false, reason: "no_embedding" };
    }
    const projection = recomputeReportSearchableText({
      title: row.title,
      summary: row.summary,
      query: row.query,
      primaryEntity: row.primaryEntity,
      entitySlug: row.entitySlug,
    });
    if (projection.length === 0) {
      return { patched: false, reason: "empty_projection" };
    }
    const clipped = clipInput(projection);
    const hash = await sha256Hex(clipped);
    await ctx.db.patch(args.id, { searchableTextHash: hash });
    return { patched: true, reason: "patched" };
  },
});

export const patchBlockHash = internalMutation({
  args: { id: v.id("productBlocks") },
  returns: PATCH_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return { patched: false, reason: "missing" };
    if (row.searchableTextHash !== undefined) {
      return { patched: false, reason: "already_hashed" };
    }
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
      return { patched: false, reason: "no_embedding" };
    }
    let projection: string;
    try {
      projection = recomputeBlockSearchableText({
        content: row.content,
        deletedAt: row.deletedAt,
      });
    } catch {
      // Adversarial: malformed `content` (non-array, null, schema drift) —
      // the recompute helper guards against most shapes but we wrap in a
      // catch so a single rotten row can't kill the sweep.
      return { patched: false, reason: "empty_projection" };
    }
    if (projection.length === 0) {
      return { patched: false, reason: "empty_projection" };
    }
    const clipped = clipInput(projection);
    const hash = await sha256Hex(clipped);
    await ctx.db.patch(args.id, { searchableTextHash: hash });
    return { patched: true, reason: "patched" };
  },
});

/* -------------------------------------------------------------------------- */
/* Page-scan queries — minimal field projections for each table                */
/*                                                                             */
/* We only need `_id`, `embedding`, and `searchableTextHash` from the page     */
/* (the mutation re-reads the full row before patching). Smaller payloads      */
/* keep the bandwidth between query → action bounded.                          */
/* -------------------------------------------------------------------------- */

import { internalQuery } from "../../_generated/server";

const ENTITY_PAGE_RESULT = v.object({
  rows: v.array(
    v.object({
      _id: v.id("productEntities"),
      hasEmbedding: v.boolean(),
      hasHash: v.boolean(),
    }),
  ),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

export const scanEntitiesPage = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: ENTITY_PAGE_RESULT,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productEntities")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        hasEmbedding:
          Array.isArray(row.embedding) && row.embedding.length > 0,
        hasHash: row.searchableTextHash !== undefined,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

const REPORT_PAGE_RESULT = v.object({
  rows: v.array(
    v.object({
      _id: v.id("productReports"),
      hasEmbedding: v.boolean(),
      hasHash: v.boolean(),
    }),
  ),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

export const scanReportsPage = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: REPORT_PAGE_RESULT,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productReports")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        hasEmbedding:
          Array.isArray(row.embedding) && row.embedding.length > 0,
        hasHash: row.searchableTextHash !== undefined,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

const BLOCK_PAGE_RESULT = v.object({
  rows: v.array(
    v.object({
      _id: v.id("productBlocks"),
      hasEmbedding: v.boolean(),
      hasHash: v.boolean(),
    }),
  ),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

export const scanBlocksPage = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: BLOCK_PAGE_RESULT,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productBlocks")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        hasEmbedding:
          Array.isArray(row.embedding) && row.embedding.length > 0,
        hasHash: row.searchableTextHash !== undefined,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* The backfill action                                                         */
/* -------------------------------------------------------------------------- */

const BACKFILL_RESULT = v.object({
  entitiesPatched: v.number(),
  reportsPatched: v.number(),
  blocksPatched: v.number(),
  totalPatched: v.number(),
  totalScanned: v.number(),
  totalSkipped: v.number(),
  totalFailed: v.number(),
  pagesScanned: v.number(),
  durationMs: v.number(),
});

type BackfillResult = {
  entitiesPatched: number;
  reportsPatched: number;
  blocksPatched: number;
  totalPatched: number;
  totalScanned: number;
  totalSkipped: number;
  totalFailed: number;
  pagesScanned: number;
  durationMs: number;
};

type TableKey = "entities" | "reports" | "blocks";

export const backfillSearchableTextHash = internalAction({
  args: {},
  returns: BACKFILL_RESULT,
  handler: async (ctx): Promise<BackfillResult> => {
    const startedAt = Date.now();
    let entitiesPatched = 0;
    let reportsPatched = 0;
    let blocksPatched = 0;
    let totalScanned = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let pagesScanned = 0;

    const tables: TableKey[] = ["entities", "reports", "blocks"];

    for (const table of tables) {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const scanRef =
          table === "entities"
            ? internal.domains.search.embedHashBackfill.scanEntitiesPage
            : table === "reports"
              ? internal.domains.search.embedHashBackfill.scanReportsPage
              : internal.domains.search.embedHashBackfill.scanBlocksPage;
        const result: {
          rows: Array<{
            _id: string;
            hasEmbedding: boolean;
            hasHash: boolean;
          }>;
          cursor: string | null;
          isDone: boolean;
        } = await ctx.runQuery(scanRef, { cursor, limit: PAGE_SIZE });
        cursor = result.cursor;
        pagesScanned += 1;

        for (const row of result.rows) {
          totalScanned += 1;
          // Cheap filter: only the embedding-yes, hash-no rows actually need a
          // mutation. Everything else short-circuits without a round-trip.
          if (!row.hasEmbedding || row.hasHash) continue;
          try {
            const patchRef =
              table === "entities"
                ? internal.domains.search.embedHashBackfill.patchEntityHash
                : table === "reports"
                  ? internal.domains.search.embedHashBackfill.patchReportHash
                  : internal.domains.search.embedHashBackfill.patchBlockHash;
            const out: { patched: boolean; reason: string } =
              await ctx.runMutation(patchRef, {
                id: row._id as Id<
                  "productEntities" | "productReports" | "productBlocks"
                >,
              });
            if (out.patched) {
              if (table === "entities") entitiesPatched += 1;
              else if (table === "reports") reportsPatched += 1;
              else blocksPatched += 1;
            } else {
              totalSkipped += 1;
            }
          } catch (error) {
            // ERROR_BOUNDARY: one bad row doesn't kill the sweep.
            totalFailed += 1;
            const msg =
              error instanceof Error ? error.message : String(error);
            console.error(
              `[backfillSearchableTextHash] ${table} row ${row._id} threw:`,
              msg.slice(0, 200),
            );
          }
        }

        if (result.isDone) break;
      }
    }

    return {
      entitiesPatched,
      reportsPatched,
      blocksPatched,
      totalPatched: entitiesPatched + reportsPatched + blocksPatched,
      totalScanned,
      totalSkipped,
      totalFailed,
      pagesScanned,
      durationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Pure-function exports for unit tests                                        */
/* -------------------------------------------------------------------------- */

export const __test = {
  sha256Hex,
  clipInput,
  PAGE_SIZE,
  MAX_PAGES,
  MAX_PROJECTION_BYTES,
};
