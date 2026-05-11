/**
 * One-shot backfill mutations for `visibility` across the 3 product
 * collections that gained the field in the public-visibility PR
 * (productEntities, productBlocks, productClaims).
 *
 * Why this exists
 * ---------------
 * The PR adds `visibility: v.optional("public" | "team" | "private")` to
 * the schema for entities/blocks/claims. The federated search action
 * relies on `eq("visibility", "public")` against the search index to
 * surface public rows to anonymous callers. Pre-existing rows have
 * `visibility === undefined`, so the index filter would NOT match them.
 *
 * This backfill makes every existing row hit the public visibility
 * filter in one bounded pass — restoring the federated search privacy
 * default of "public unless owner explicitly chose otherwise."
 *
 * productReports already had `visibility` as a REQUIRED field at
 * schema-define time, so no rows have undefined visibility — no backfill
 * needed for reports.
 *
 * Per .claude/rules/agentic_reliability.md:
 *   - BOUND: each call paginates 200 rows at a time, ONE page per
 *     mutation invocation (Convex disallows multiple `.paginate()` calls
 *     within a single mutation function — see PR #316).
 *   - HONEST_STATUS: returns { scanned, written, skipped, done, cursor,
 *     durationMs }. A `done: false` means more pages remain — caller
 *     re-invokes with the returned cursor.
 *   - HONEST_SCORES: `scanned`, `written`, `skipped` are real counters,
 *     not synthetic estimates. `written` increments only when we actually
 *     patched the row.
 *   - DETERMINISTIC: re-running on the same data is a no-op because we
 *     skip writes when `visibility` is already set. Idempotent.
 *   - TIMEOUT: per-page work is local CPU + small patch. Comfortably
 *     fits Convex's 1-minute mutation cap.
 *
 * Pattern: orchestrator-workers. Action loops `runMutation` calls until
 * each per-table backfill reports `done: true`. Mirrors PR #316's
 * single-page-per-mutation hot fix.
 *
 * CLI: `npx convex run domains/product/visibilityBackfill:backfillAll`
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md (PR public-visibility).
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

/* -------------------------------------------------------------------------- */
/* Pagination knobs                                                            */
/* -------------------------------------------------------------------------- */

/** BOUND: rows scanned per page. Tuned to stay under Convex's 8 MB read budget. */
const ROWS_PER_PAGE = 200;
/**
 * BOUND: pages per mutation invocation. Convex disallows multiple
 * `.paginate()` calls within a single mutation function — see the hot
 * fix in PR #316 for the searchableText backfill.
 *
 * Each per-table mutation does ONE page and returns the cursor; the
 * orchestrator action (`backfillAll`) loops `runMutation` calls until
 * `done: true`. Actions invoke mutations as separate calls, so the
 * single-paginate-per-mutation constraint is satisfied per call.
 */
const MAX_PAGES_PER_CALL = 1;

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export type VisibilityBackfillResult = {
  /** Total rows scanned this call. */
  scanned: number;
  /** Rows where visibility was undefined and we set it to "public". */
  written: number;
  /** Rows where visibility was already set (any value) — skipped. */
  skipped: number;
  /** True if the full table has been processed (no more pages). */
  done: boolean;
  /** Continuation cursor if `done: false`. Pass back into the next call. */
  cursor: string | null;
  /** Per-call wall-clock duration. */
  durationMs: number;
};

const RESULT_SHAPE = {
  scanned: v.number(),
  written: v.number(),
  skipped: v.number(),
  done: v.boolean(),
  cursor: v.union(v.string(), v.null()),
  durationMs: v.number(),
};

const BACKFILL_ARGS = {
  cursor: v.optional(v.union(v.string(), v.null())),
};

/* -------------------------------------------------------------------------- */
/* Per-table workers                                                           */
/* -------------------------------------------------------------------------- */

export const backfillEntities = internalMutation({
  args: BACKFILL_ARGS,
  returns: v.object(RESULT_SHAPE),
  handler: async (ctx, args): Promise<VisibilityBackfillResult> => {
    const startedAt = Date.now();
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const result = await ctx.db
        .query("productEntities")
        .paginate({ cursor, numItems: ROWS_PER_PAGE });
      for (const row of result.page) {
        scanned += 1;
        if (row.visibility !== undefined) {
          // Idempotent — owner already chose a visibility, never overwrite.
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { visibility: "public" });
          written += 1;
        }
      }
      cursor = result.continueCursor;
      if (result.isDone) {
        return {
          scanned,
          written,
          skipped,
          done: true,
          cursor: null,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    return {
      scanned,
      written,
      skipped,
      done: false,
      cursor,
      durationMs: Date.now() - startedAt,
    };
  },
});

export const backfillBlocks = internalMutation({
  args: BACKFILL_ARGS,
  returns: v.object(RESULT_SHAPE),
  handler: async (ctx, args): Promise<VisibilityBackfillResult> => {
    const startedAt = Date.now();
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const result = await ctx.db
        .query("productBlocks")
        .paginate({ cursor, numItems: ROWS_PER_PAGE });
      for (const row of result.page) {
        scanned += 1;
        if (row.visibility !== undefined) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { visibility: "public" });
          written += 1;
        }
      }
      cursor = result.continueCursor;
      if (result.isDone) {
        return {
          scanned,
          written,
          skipped,
          done: true,
          cursor: null,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    return {
      scanned,
      written,
      skipped,
      done: false,
      cursor,
      durationMs: Date.now() - startedAt,
    };
  },
});

export const backfillClaims = internalMutation({
  args: BACKFILL_ARGS,
  returns: v.object(RESULT_SHAPE),
  handler: async (ctx, args): Promise<VisibilityBackfillResult> => {
    const startedAt = Date.now();
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const result = await ctx.db
        .query("productClaims")
        .paginate({ cursor, numItems: ROWS_PER_PAGE });
      for (const row of result.page) {
        scanned += 1;
        if (row.visibility !== undefined) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { visibility: "public" });
          written += 1;
        }
      }
      cursor = result.continueCursor;
      if (result.isDone) {
        return {
          scanned,
          written,
          skipped,
          done: true,
          cursor: null,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    return {
      scanned,
      written,
      skipped,
      done: false,
      cursor,
      durationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Orchestrator — runs all 3 backfills until each is done                      */
/* -------------------------------------------------------------------------- */

export type VisibilityBackfillAllResult = {
  entities: VisibilityBackfillResult;
  blocks: VisibilityBackfillResult;
  claims: VisibilityBackfillResult;
  /** True only when every per-table backfill reported done. */
  done: boolean;
  /** Total wall-clock for the orchestrator. */
  totalDurationMs: number;
};

/**
 * Runs the 3 backfills serially and loops each one until done. Each loop
 * iteration is a separate mutation call (idempotent — re-running is
 * safe), so we stay within Convex's per-mutation budget on giant tables.
 *
 * CLI: `npx convex run domains/product/visibilityBackfill:backfillAll`
 */
export const backfillAll = internalAction({
  args: {},
  returns: v.object({
    entities: v.object(RESULT_SHAPE),
    blocks: v.object(RESULT_SHAPE),
    claims: v.object(RESULT_SHAPE),
    done: v.boolean(),
    totalDurationMs: v.number(),
  }),
  handler: async (ctx): Promise<VisibilityBackfillAllResult> => {
    const startedAt = Date.now();

    type TableName = "entities" | "blocks" | "claims";

    async function runUntilDone(
      table: TableName,
    ): Promise<VisibilityBackfillResult> {
      let cursor: string | null = null;
      let totalScanned = 0;
      let totalWritten = 0;
      let totalSkipped = 0;
      let totalDuration = 0;
      // Safety cap: 500 iterations × 200 rows = 100K rows per table per
      // backfillAll invocation. Adequate for current data; re-invoke if
      // more remain (the CLI command is safe to re-run; it's idempotent).
      for (let iter = 0; iter < 500; iter += 1) {
        const ref =
          table === "entities"
            ? internal.domains.product.visibilityBackfill.backfillEntities
            : table === "blocks"
              ? internal.domains.product.visibilityBackfill.backfillBlocks
              : internal.domains.product.visibilityBackfill.backfillClaims;
        const result: VisibilityBackfillResult = await ctx.runMutation(ref, {
          cursor,
        });
        totalScanned += result.scanned;
        totalWritten += result.written;
        totalSkipped += result.skipped;
        totalDuration += result.durationMs;
        if (result.done) {
          return {
            scanned: totalScanned,
            written: totalWritten,
            skipped: totalSkipped,
            done: true,
            cursor: null,
            durationMs: totalDuration,
          };
        }
        cursor = result.cursor;
      }
      // Hit safety cap — return partial; caller re-invokes to continue.
      return {
        scanned: totalScanned,
        written: totalWritten,
        skipped: totalSkipped,
        done: false,
        cursor,
        durationMs: totalDuration,
      };
    }

    const entities = await runUntilDone("entities");
    const blocks = await runUntilDone("blocks");
    const claims = await runUntilDone("claims");

    return {
      entities,
      blocks,
      claims,
      done: entities.done && blocks.done && claims.done,
      totalDurationMs: Date.now() - startedAt,
    };
  },
});
