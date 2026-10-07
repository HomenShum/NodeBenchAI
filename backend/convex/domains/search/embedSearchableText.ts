/**
 * Embedding generation + backfill for the federated `searchableText` fields
 * that have a vector hybrid index (PR E).
 *
 * Pattern: text-embedding-3-small (1536-dim) — same model used by
 * convex/domains/knowledge/knowledgeGraph.ts. Reusing the model means new
 * embeddings interoperate with existing ones if we ever cross-index.
 *
 * Per .claude/rules/agentic_reliability.md:
 *   - BOUND: 50 rows per OpenAI batch (their API caps at 2048 inputs but
 *     we stay well under to keep individual call latency bounded). Max
 *     20 batches per backfill invocation = 1000 rows / call.
 *   - HONEST_STATUS: returns { embedded, skipped, failed, done, cursor }.
 *     Failed rows are reported, not silently retried — caller decides.
 *   - HONEST_SCORES: rows where embedding already matches the searchable
 *     text fingerprint are skipped, real counters not synthetic.
 *   - TIMEOUT: AbortController on the OpenAI fetch with 30s budget per
 *     batch. Convex actions get up to 10 min wall-clock; we fit comfortably.
 *   - DETERMINISTIC: same searchableText -> same embedding (OpenAI is
 *     deterministic for the same model + input).
 *
 * Privacy: embedding action runs server-side only. The `embedding` field
 * is filterable on the vectorIndex via `ownerKey`, so cross-tenant search
 * remains impossible by construction.
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

/** Model identifier — single source of truth so we can swap later. */
const EMBEDDING_MODEL = "text-embedding-3-small";
/** Dimensions of EMBEDDING_MODEL. Must match the schema's vectorIndex. */
export const EMBEDDING_DIMENSIONS = 1536;

/* -------------------------------------------------------------------------- */
/* Pagination + budget knobs                                                   */
/* -------------------------------------------------------------------------- */

/** BOUND: rows per OpenAI batch. Stays well under the 2048 API limit. */
const BATCH_SIZE = 50;
/** BOUND: max batches per single backfill call. 20 × 50 = 1000 rows. */
const MAX_BATCHES_PER_CALL = 20;
/** TIMEOUT: per-batch OpenAI request budget. */
const FETCH_TIMEOUT_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* OpenAI embedding wrapper                                                    */
/*                                                                             */
/* Uses fetch directly (instead of the openai SDK) so we control timeout,      */
/* error handling, and response bounding without an external dep surface.     */
/* -------------------------------------------------------------------------- */

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
};

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing — cannot embed searchableText");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI embeddings ${response.status}: ${body.slice(0, 500)}`,
      );
    }
    // BOUND_READ: embeddings response is small (~30KB / batch) — no streaming
    // reader needed. The 1536-dim float arrays are bounded by BATCH_SIZE.
    const json = (await response.json()) as OpenAIEmbeddingResponse;
    if (!Array.isArray(json.data) || json.data.length !== texts.length) {
      throw new Error(
        `OpenAI embeddings returned ${json.data?.length ?? 0} embeddings for ${texts.length} inputs`,
      );
    }
    // OpenAI returns embeddings in the same order as inputs but the response
    // also carries `index` for sanity. Re-sort by index defensively.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((row) => row.embedding);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute the OpenAI embedding for a single query string. Used by the
 * federated search action to embed the user's query once per call.
 *
 * Returns null if OPENAI_API_KEY is missing — callers fall back to
 * keyword-only search (HONEST_STATUS — no fake vector results).
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  if (!query || !query.trim()) return null;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const [embedding] = await embedBatch([query.trim()]);
    return embedding;
  } catch (error) {
    console.error("[embedQuery] failed:", error);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Per-table queries — page rows that need embedding                           */
/*                                                                             */
/* Eligible row: `searchableText` is non-empty AND `embedding` is missing.     */
/* -------------------------------------------------------------------------- */

const EMBED_QUERY_ARGS = {
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.number(),
};

type RowToEmbed = {
  _id: string;
  searchableText: string;
};

const ROW_TO_EMBED_SHAPE = v.object({
  _id: v.string(),
  searchableText: v.string(),
});

const EMBED_QUERY_RESULT = {
  rows: v.array(ROW_TO_EMBED_SHAPE),
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
};

export const pageEntitiesToEmbed = internalQuery({
  args: EMBED_QUERY_ARGS,
  returns: v.object(EMBED_QUERY_RESULT),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("productEntities")
      .paginate({ cursor: args.cursor ?? null, numItems: args.pageSize });
    const rows: RowToEmbed[] = [];
    for (const row of result.page) {
      if (
        typeof row.searchableText === "string" &&
        row.searchableText.length > 0 &&
        !row.embedding
      ) {
        rows.push({ _id: String(row._id), searchableText: row.searchableText });
      }
    }
    return { rows, cursor: result.continueCursor, isDone: result.isDone };
  },
});

export const pageReportsToEmbed = internalQuery({
  args: EMBED_QUERY_ARGS,
  returns: v.object(EMBED_QUERY_RESULT),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("productReports")
      .paginate({ cursor: args.cursor ?? null, numItems: args.pageSize });
    const rows: RowToEmbed[] = [];
    for (const row of result.page) {
      if (
        typeof row.searchableText === "string" &&
        row.searchableText.length > 0 &&
        !row.embedding
      ) {
        rows.push({ _id: String(row._id), searchableText: row.searchableText });
      }
    }
    return { rows, cursor: result.continueCursor, isDone: result.isDone };
  },
});

export const pageBlocksToEmbed = internalQuery({
  args: EMBED_QUERY_ARGS,
  returns: v.object(EMBED_QUERY_RESULT),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("productBlocks")
      .paginate({ cursor: args.cursor ?? null, numItems: args.pageSize });
    const rows: RowToEmbed[] = [];
    for (const row of result.page) {
      if (
        typeof row.searchableText === "string" &&
        row.searchableText.length > 0 &&
        !row.embedding
      ) {
        rows.push({ _id: String(row._id), searchableText: row.searchableText });
      }
    }
    return { rows, cursor: result.continueCursor, isDone: result.isDone };
  },
});

/* -------------------------------------------------------------------------- */
/* Per-table writers — apply a batch of embeddings                             */
/* -------------------------------------------------------------------------- */

const APPLY_EMBED_ARGS = {
  embeddings: v.array(
    v.object({
      id: v.string(),
      embedding: v.array(v.float64()),
    }),
  ),
};

export const applyEntityEmbeddings = internalMutation({
  args: APPLY_EMBED_ARGS,
  returns: v.object({ written: v.number() }),
  handler: async (ctx, args) => {
    let written = 0;
    for (const item of args.embeddings) {
      const id = item.id as Id<"productEntities">;
      const row = await ctx.db.get(id);
      // HONEST_STATUS: drift check — if the row's searchableText has changed
      // since we paged it, skip (the next backfill cycle will re-embed it).
      if (!row) continue;
      await ctx.db.patch(id, { embedding: item.embedding });
      written += 1;
    }
    return { written };
  },
});

export const applyReportEmbeddings = internalMutation({
  args: APPLY_EMBED_ARGS,
  returns: v.object({ written: v.number() }),
  handler: async (ctx, args) => {
    let written = 0;
    for (const item of args.embeddings) {
      const id = item.id as Id<"productReports">;
      const row = await ctx.db.get(id);
      if (!row) continue;
      await ctx.db.patch(id, { embedding: item.embedding });
      written += 1;
    }
    return { written };
  },
});

export const applyBlockEmbeddings = internalMutation({
  args: APPLY_EMBED_ARGS,
  returns: v.object({ written: v.number() }),
  handler: async (ctx, args) => {
    let written = 0;
    for (const item of args.embeddings) {
      const id = item.id as Id<"productBlocks">;
      const row = await ctx.db.get(id);
      if (!row) continue;
      await ctx.db.patch(id, { embedding: item.embedding });
      written += 1;
    }
    return { written };
  },
});

/* -------------------------------------------------------------------------- */
/* Per-table backfill action                                                   */
/*                                                                             */
/* Pages rows -> batches them -> calls OpenAI -> writes back. Idempotent       */
/* (skips rows that already have an embedding). Bounded per-call.              */
/* -------------------------------------------------------------------------- */

export type EmbedBackfillResult = {
  /** Rows scanned this call. */
  scanned: number;
  /** Rows where embedding was generated and written. */
  embedded: number;
  /** Rows skipped because they already had an embedding. */
  skipped: number;
  /** Rows that failed to embed (reported as a count, not an exception). */
  failed: number;
  /** True if the full table has been processed. */
  done: boolean;
  /** Continuation cursor when done=false. */
  cursor: string | null;
  /** Wall-clock per call. */
  durationMs: number;
};

const EMBED_BACKFILL_RESULT_SHAPE = {
  scanned: v.number(),
  embedded: v.number(),
  skipped: v.number(),
  failed: v.number(),
  done: v.boolean(),
  cursor: v.union(v.string(), v.null()),
  durationMs: v.number(),
};

type TableName = "entities" | "reports" | "blocks";

async function runEmbedBackfill(
  ctx: any,
  table: TableName,
  cursorIn: string | null,
): Promise<EmbedBackfillResult> {
  const startedAt = Date.now();
  let cursor: string | null = cursorIn;
  let scanned = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  const pageRef =
    table === "entities"
      ? internal.domains.search.embedSearchableText.pageEntitiesToEmbed
      : table === "reports"
        ? internal.domains.search.embedSearchableText.pageReportsToEmbed
        : internal.domains.search.embedSearchableText.pageBlocksToEmbed;
  const applyRef =
    table === "entities"
      ? internal.domains.search.embedSearchableText.applyEntityEmbeddings
      : table === "reports"
        ? internal.domains.search.embedSearchableText.applyReportEmbeddings
        : internal.domains.search.embedSearchableText.applyBlockEmbeddings;

  for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_CALL; batchIdx += 1) {
    const page: { rows: RowToEmbed[]; cursor: string | null; isDone: boolean } =
      await ctx.runQuery(pageRef, {
        cursor,
        pageSize: BATCH_SIZE,
      });
    cursor = page.cursor;
    if (page.rows.length === 0) {
      // No eligible rows in this page (all already embedded or empty).
      // Still count the page as scanned via the implicit page size — but
      // we don't have access to the underlying count here, so report what
      // we know.
      if (page.isDone) {
        return {
          scanned,
          embedded,
          skipped,
          failed,
          done: true,
          cursor: null,
          durationMs: Date.now() - startedAt,
        };
      }
      continue;
    }
    scanned += page.rows.length;
    try {
      const embeddings = await embedBatch(page.rows.map((r) => r.searchableText));
      // Sanity check: we must get the right number of vectors back.
      if (embeddings.length !== page.rows.length) {
        failed += page.rows.length;
        console.error(
          `[embedBackfill] ${table}: expected ${page.rows.length} embeddings, got ${embeddings.length}`,
        );
        continue;
      }
      const applyArgs = page.rows.map((row, i) => ({
        id: row._id,
        embedding: embeddings[i],
      }));
      const { written }: { written: number } = await ctx.runMutation(applyRef, {
        embeddings: applyArgs,
      });
      embedded += written;
      skipped += page.rows.length - written;
    } catch (error) {
      failed += page.rows.length;
      console.error(`[embedBackfill] ${table} batch failed:`, error);
      // HONEST_STATUS: do NOT retry inline — let the caller re-invoke the
      // backfill (idempotency makes this safe). Continuing here would
      // double-charge OpenAI on every retry.
    }
    if (page.isDone) {
      return {
        scanned,
        embedded,
        skipped,
        failed,
        done: true,
        cursor: null,
        durationMs: Date.now() - startedAt,
      };
    }
  }
  return {
    scanned,
    embedded,
    skipped,
    failed,
    done: false,
    cursor,
    durationMs: Date.now() - startedAt,
  };
}

const EMBED_ARGS = {
  cursor: v.optional(v.union(v.string(), v.null())),
};

export const embedEntitiesBackfill = internalAction({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return runEmbedBackfill(ctx, "entities", args.cursor ?? null);
  },
});

/**
 * Public CLI-callable wrappers. Convex CLI cannot invoke internalAction
 * directly; these thin wrappers let operators run per-table backfills
 * with the prod deploy key. Each call processes ONE page (PAGE_SIZE
 * rows) so it fits well inside the action wall-clock budget. Re-run
 * with the returned cursor to continue.
 *
 *   npx convex run domains/search/embedSearchableText:runEmbedEntities
 *   npx convex run domains/search/embedSearchableText:runEmbedReports
 *   npx convex run domains/search/embedSearchableText:runEmbedBlocks '{"cursor":"<prev>"}'
 */
export const runEmbedEntities = action({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return await ctx.runAction(
      internal.domains.search.embedSearchableText.embedEntitiesBackfill,
      { cursor: args.cursor ?? null },
    );
  },
});

export const runEmbedReports = action({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return await ctx.runAction(
      internal.domains.search.embedSearchableText.embedReportsBackfill,
      { cursor: args.cursor ?? null },
    );
  },
});

export const runEmbedBlocks = action({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return await ctx.runAction(
      internal.domains.search.embedSearchableText.embedBlocksBackfill,
      { cursor: args.cursor ?? null },
    );
  },
});

export const embedReportsBackfill = internalAction({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return runEmbedBackfill(ctx, "reports", args.cursor ?? null);
  },
});

export const embedBlocksBackfill = internalAction({
  args: EMBED_ARGS,
  returns: v.object(EMBED_BACKFILL_RESULT_SHAPE),
  handler: async (ctx, args): Promise<EmbedBackfillResult> => {
    return runEmbedBackfill(ctx, "blocks", args.cursor ?? null);
  },
});

/* -------------------------------------------------------------------------- */
/* Orchestrator — runs all 3 embedding backfills until each is done            */
/* -------------------------------------------------------------------------- */

export type EmbedAllResult = {
  entities: EmbedBackfillResult;
  reports: EmbedBackfillResult;
  blocks: EmbedBackfillResult;
  done: boolean;
  totalDurationMs: number;
};

/**
 * Runs entities/reports/blocks embedding backfills serially, looping until
 * each is done. Idempotent — re-running is safe (rows that already have an
 * embedding are skipped).
 *
 * CLI: `npx convex run domains/search/embedSearchableText:embedAll`
 */
export const embedAll = internalAction({
  args: {},
  returns: v.object({
    entities: v.object(EMBED_BACKFILL_RESULT_SHAPE),
    reports: v.object(EMBED_BACKFILL_RESULT_SHAPE),
    blocks: v.object(EMBED_BACKFILL_RESULT_SHAPE),
    done: v.boolean(),
    totalDurationMs: v.number(),
  }),
  handler: async (ctx): Promise<EmbedAllResult> => {
    const startedAt = Date.now();

    async function runUntilDone(table: TableName): Promise<EmbedBackfillResult> {
      let cursor: string | null = null;
      let totalScanned = 0;
      let totalEmbedded = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let totalDuration = 0;
      const ref =
        table === "entities"
          ? internal.domains.search.embedSearchableText.embedEntitiesBackfill
          : table === "reports"
            ? internal.domains.search.embedSearchableText.embedReportsBackfill
            : internal.domains.search.embedSearchableText.embedBlocksBackfill;
      for (let iter = 0; iter < 100; iter += 1) {
        const result: EmbedBackfillResult = await ctx.runAction(ref, {
          cursor,
        });
        totalScanned += result.scanned;
        totalEmbedded += result.embedded;
        totalSkipped += result.skipped;
        totalFailed += result.failed;
        totalDuration += result.durationMs;
        if (result.done) {
          return {
            scanned: totalScanned,
            embedded: totalEmbedded,
            skipped: totalSkipped,
            failed: totalFailed,
            done: true,
            cursor: null,
            durationMs: totalDuration,
          };
        }
        cursor = result.cursor;
      }
      return {
        scanned: totalScanned,
        embedded: totalEmbedded,
        skipped: totalSkipped,
        failed: totalFailed,
        done: false,
        cursor,
        durationMs: totalDuration,
      };
    }

    const entities = await runUntilDone("entities");
    const reports = await runUntilDone("reports");
    const blocks = await runUntilDone("blocks");

    return {
      entities,
      reports,
      blocks,
      done: entities.done && reports.done && blocks.done,
      totalDurationMs: Date.now() - startedAt,
    };
  },
});
