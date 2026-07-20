/**
 * One-shot backfill mutations for `searchableText` across the 4 federated
 * search collections that compose the field at write time.
 *
 * Why this exists (PR D)
 * ----------------------
 * PR #310 shipped Convex-native federated search but only POPULATED
 * `searchableText` on the insert path. Existing rows (entities/reports/
 * blocks/sources written before PR #310) are invisible to keyword search
 * until they are touched by a mutation. This backfill makes every existing
 * row searchable in one bounded pass.
 *
 * Per .claude/rules/agentic_reliability.md:
 *   - BOUND: each call paginates 200 rows at a time, max 1000 pages per
 *     invocation (200 000 rows / call). Idempotent — re-call to continue.
 *   - HONEST_STATUS: returns { scanned, written, skipped, done, cursor }.
 *     A `done: false` means more pages remain — caller re-invokes with
 *     the returned cursor.
 *   - HONEST_SCORES: `scanned` and `written` are real counters, not
 *     synthetic estimates.
 *   - DETERMINISTIC: re-running on the same data is a no-op because the
 *     recompute helper is pure and we skip writes when the computed value
 *     equals the stored value.
 *   - TIMEOUT: Convex mutations have a 1-minute hard cap. 200 000 rows
 *     comfortably fits — the recompute is local CPU only.
 *
 * Scope: 4 tables (entities, reports, blocks, sources). The other 3
 * federated tables (productClaims, quickCaptures, chatThreadsStream)
 * index a REQUIRED field directly, so existing rows are already
 * searchable — no backfill needed.
 *
 * CLI: `npx convex run domains/search/searchableTextBackfill:backfillAll`
 *      runs all 4 backfills serially, looping until each is `done`.
 *
 * Pattern: orchestrator-workers, where the action orchestrates and each
 * per-collection internal mutation is a worker. Mirrors the federated
 * search dispatch shape.
 *
 * Privacy: backfill runs server-side with internal-only mutations. No
 * user identity is consulted — each row is reindexed in place.
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
  recomputeBlockSearchableText,
  recomputeSourceSearchableText,
} from "./searchableTextRecompute";

/* -------------------------------------------------------------------------- */
/* Pagination knobs                                                            */
/* -------------------------------------------------------------------------- */

/** BOUND: rows scanned per page. Tuned to stay under Convex's 8 MB read budget. */
const ROWS_PER_PAGE = 200;
/**
 * BOUND: pages per mutation invocation.  Convex disallows multiple
 * `.paginate()` calls within a single mutation function, so each per-table
 * mutation does ONE page and returns the cursor.  The orchestrator action
 * (`backfillAll`) loops `runMutation` calls until `done: true` — that
 * pattern is allowed because actions invoke mutations as separate calls.
 *
 * Hot-fix 2026-05-10: was 1000, which triggered Convex's "multiple
 * paginated queries" error at runtime.  Per analyst_diagnostic the bug
 * was treating page count as a per-call BOUND when it's actually a
 * per-Convex-execution constraint.
 */
const MAX_PAGES_PER_CALL = 1;

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export type BackfillResult = {
  /** Total rows scanned this call. */
  scanned: number;
  /** Rows where the stored value differed and was rewritten. */
  written: number;
  /** Rows where the stored value already matched the recomputed value. */
  skipped: number;
  /** True if the full table has been processed (no more pages). */
  done: boolean;
  /** Continuation cursor if `done: false`. Pass back into the next call. */
  cursor: string | null;
  /** Per-call wall-clock duration. */
  durationMs: number;
};

const BACKFILL_RESULT_SHAPE = {
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
  returns: v.object(BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<BackfillResult> => {
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
        const next = recomputeEntitySearchableText(row);
        if (row.searchableText === next) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { searchableText: next });
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

export const backfillReports = internalMutation({
  args: BACKFILL_ARGS,
  returns: v.object(BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<BackfillResult> => {
    const startedAt = Date.now();
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const result = await ctx.db
        .query("productReports")
        .paginate({ cursor, numItems: ROWS_PER_PAGE });
      for (const row of result.page) {
        scanned += 1;
        const next = recomputeReportSearchableText(row);
        if (row.searchableText === next) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { searchableText: next });
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
  returns: v.object(BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<BackfillResult> => {
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
        const next = recomputeBlockSearchableText(row);
        if (row.searchableText === next) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { searchableText: next });
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

export const backfillSources = internalMutation({
  args: BACKFILL_ARGS,
  returns: v.object(BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<BackfillResult> => {
    const startedAt = Date.now();
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
      const result = await ctx.db
        .query("sourceArtifacts")
        .paginate({ cursor, numItems: ROWS_PER_PAGE });
      for (const row of result.page) {
        scanned += 1;
        const next = recomputeSourceSearchableText(row);
        if (row.searchableText === next) {
          skipped += 1;
        } else {
          await ctx.db.patch(row._id, { searchableText: next });
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
/* Orchestrator — runs all 4 backfills until each is done                      */
/* -------------------------------------------------------------------------- */

export type BackfillAllResult = {
  entities: BackfillResult;
  reports: BackfillResult;
  blocks: BackfillResult;
  sources: BackfillResult;
  /** True only when every per-table backfill reported done. */
  done: boolean;
  /** Total wall-clock for the orchestrator (sum + overhead). */
  totalDurationMs: number;
};

/**
 * Runs the 4 backfills serially and loops each one until it reports done.
 * Each loop iteration is a separate mutation call (idempotent — re-running
 * is safe), so we stay within Convex's per-mutation budget even on giant
 * tables.
 *
 * CLI: `npx convex run domains/search/searchableTextBackfill:backfillAll`
 */
export const backfillAll = internalAction({
  args: {},
  returns: v.object({
    entities: v.object(BACKFILL_RESULT_SHAPE),
    reports: v.object(BACKFILL_RESULT_SHAPE),
    blocks: v.object(BACKFILL_RESULT_SHAPE),
    sources: v.object(BACKFILL_RESULT_SHAPE),
    done: v.boolean(),
    totalDurationMs: v.number(),
  }),
  handler: async (ctx): Promise<BackfillAllResult> => {
    const startedAt = Date.now();

    type TableName = "entities" | "reports" | "blocks" | "sources";

    async function runUntilDone(
      table: TableName,
    ): Promise<BackfillResult> {
      let cursor: string | null = null;
      let totalScanned = 0;
      let totalWritten = 0;
      let totalSkipped = 0;
      let totalDuration = 0;
      // Safety cap so a runaway loop can't run forever.
      // After hot-fix: each per-table mutation does ONE page (200 rows),
      // so 500 iterations × 200 rows = 100K rows per table per backfillAll
      // invocation.  Adequate for current data; re-invoke if more remain.
      for (let iter = 0; iter < 500; iter += 1) {
        const ref =
          table === "entities"
            ? internal.domains.search.searchableTextBackfill.backfillEntities
            : table === "reports"
              ? internal.domains.search.searchableTextBackfill.backfillReports
              : table === "blocks"
                ? internal.domains.search.searchableTextBackfill.backfillBlocks
                : internal.domains.search.searchableTextBackfill
                    .backfillSources;
        const result: BackfillResult = await ctx.runMutation(ref, { cursor });
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
      // Hit the safety cap — return partial with done: false. Caller can
      // re-invoke to continue.
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
    const reports = await runUntilDone("reports");
    const blocks = await runUntilDone("blocks");
    const sources = await runUntilDone("sources");

    return {
      entities,
      reports,
      blocks,
      sources,
      done:
        entities.done && reports.done && blocks.done && sources.done,
      totalDurationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public CLI-callable wrappers — per-table, page-resumable                    */
/* -------------------------------------------------------------------------- */

/**
 * Public dispatcher around the internalMutation per-table backfills.
 * Convex CLI cannot invoke internalMutation directly. Each call
 * processes ONE batch (~MAX_PAGES_PER_CALL pages × ROWS_PER_PAGE rows)
 * so it fits within the mutation budget. Re-run with the returned
 * cursor until `done: true`.
 *
 *   npx convex run domains/search/searchableTextBackfill:runBackfillForTable \
 *     '{"table":"entities"}'
 *   # next: '{"table":"entities","cursor":"<prev>"}' until done
 */
export const runBackfillForTable = action({
  args: {
    table: v.union(
      v.literal("entities"),
      v.literal("reports"),
      v.literal("blocks"),
      v.literal("sources"),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object(BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<BackfillResult> => {
    const ref =
      args.table === "entities"
        ? internal.domains.search.searchableTextBackfill.backfillEntities
        : args.table === "reports"
        ? internal.domains.search.searchableTextBackfill.backfillReports
        : args.table === "blocks"
        ? internal.domains.search.searchableTextBackfill.backfillBlocks
        : internal.domains.search.searchableTextBackfill.backfillSources;
    return await ctx.runMutation(ref, { cursor: args.cursor ?? null });
  },
});
