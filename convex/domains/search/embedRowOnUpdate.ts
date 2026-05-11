/**
 * Per-row embedding auto-hooks for productEntities / productReports /
 * productBlocks. Complements the bulk `embedSearchableText.ts` backfill
 * by handling NEW inserts and EDITED rows without waiting for the next
 * manual `embedAll` run.
 *
 * Pattern: fire-and-forget scheduling from mutations. Every site that
 * does `ctx.db.insert(...)` or `ctx.db.patch(...{ searchableText })`
 * on one of the 3 tables appends a single line:
 *
 *   await ctx.scheduler.runAfter(
 *     0,
 *     internal.domains.search.embedRowOnUpdate.embedEntityRow,
 *     { entityId },
 *   );
 *
 * The action is idempotent: it skips when the row's content fingerprint
 * matches the stored `searchableTextHash`. Re-scheduling is safe.
 *
 * Pattern: deterministic fingerprinting (per .claude/rules/agentic_reliability.md
 * `DETERMINISTIC`). Same `searchableText` always produces the same SHA-256.
 *
 * Prior art:
 *   - `convex/domains/search/embedSearchableText.ts` — the bulk backfill
 *     introduced these tables to OpenAI text-embedding-3-small (1536-dim).
 *     This module reuses that contract: same model, same dimensions, same
 *     row-validation drift check.
 *   - Convex `ctx.scheduler.runAfter(0, ...)` — the standard fire-and-forget
 *     pattern for "do this after the mutation commits, not in the
 *     write transaction." See `convex/domains/searchIndex/enqueue.ts`
 *     for the same pattern wired against the typesense queue.
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - BOUND:         input text capped at MAX_EMBED_INPUT_BYTES (50 KB)
 *                    before send. Output `failed` reasons capped at 200
 *                    chars in the structured response.
 *   - TIMEOUT:       AbortController with 30s budget per OpenAI call.
 *   - HONEST_STATUS: { status: "skipped" | "embedded" | "failed", reason }
 *                    — failure paths never return "embedded".
 *   - SSRF:          n/a (URL is constant — api.openai.com).
 *   - BOUND_READ:    OpenAI response is a bounded JSON object (~30 KB
 *                    for a single 1536-dim float array).
 *   - ERROR_BOUNDARY: every action wraps OpenAI fetch + db write in
 *                     try/catch and returns a structured failure.
 *   - DETERMINISTIC: SHA-256 hash of the `searchableText` string is
 *                    used as the change-detection key.
 *
 * Privacy: same as `embedSearchableText.ts` — embeddings run server-side
 * only, vector index is `ownerKey`-filtered so cross-tenant search remains
 * impossible by construction.
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Single source of truth for the embedding model. Mirrors embedSearchableText.ts. */
const EMBEDDING_MODEL = "text-embedding-3-small";
/** Dimensions of EMBEDDING_MODEL. Must match the schema's vectorIndex. */
const EMBEDDING_DIMENSIONS = 1536;
/** BOUND: cap input text after strip to keep API latency + cost bounded. */
const MAX_EMBED_INPUT_BYTES = 50_000;
/** TIMEOUT: per-call OpenAI request budget. */
const FETCH_TIMEOUT_MS = 30_000;
/** BOUND: response body cap. 1536 floats × ~10 chars + JSON overhead ≈ 25 KB. */
const MAX_RESPONSE_BYTES = 64_000;
/** BOUND: max rows the cron sweep processes per invocation. */
const DEFAULT_CRON_BATCH_SIZE = 200;
/** BOUND: hard ceiling on cron batchSize argument (caller cannot exceed). */
const MAX_CRON_BATCH_SIZE = 500;
/** BOUND: page size when scanning rows for staleness. */
const STALE_PAGE_SIZE = 100;
/** BOUND: max pages the cron walks before giving up to stay within budget. */
const MAX_STALE_PAGES = 20;

/* -------------------------------------------------------------------------- */
/* Response shape — single source of truth for HONEST_STATUS                   */
/* -------------------------------------------------------------------------- */

export type EmbedRowResult = {
  /** "skipped" — hash unchanged or no searchableText / "embedded" / "failed" */
  status: "skipped" | "embedded" | "failed";
  /** Short, bounded reason string (≤200 chars). */
  reason: string;
};

const EMBED_ROW_RESULT_SHAPE = v.object({
  status: v.union(v.literal("skipped"), v.literal("embedded"), v.literal("failed")),
  reason: v.string(),
});

function bounded(reason: string): string {
  if (reason.length <= 200) return reason;
  return reason.slice(0, 197) + "...";
}

/* -------------------------------------------------------------------------- */
/* Deterministic SHA-256 fingerprint of searchableText                         */
/*                                                                             */
/* Convex actions run on V8 with Web Crypto available. We use a single-shot   */
/* SHA-256 over the UTF-8 bytes of the input and emit lowercase hex.          */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* OpenAI embedding — same wire shape as embedSearchableText.embedBatch        */
/*                                                                             */
/* Returns null when no key is configured (HONEST_STATUS — caller decides     */
/* what to do with absent embeddings; mirrors embedQuery()).                  */
/* -------------------------------------------------------------------------- */

async function embedSingle(text: string): Promise<
  | { ok: true; embedding: number[] }
  | { ok: false; reason: string }
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "OPENAI_API_KEY missing" };
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
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        reason: `OpenAI ${response.status}: ${body.slice(0, 200)}`,
      };
    }
    // BOUND_READ: stream the body and abort if it exceeds MAX_RESPONSE_BYTES.
    // For a single 1536-dim embedding the body is ~25 KB — we'd only hit
    // this cap if OpenAI changed the schema or returned an error payload.
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, reason: "OpenAI response had no body" };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return {
            ok: false,
            reason: `OpenAI response exceeded ${MAX_RESPONSE_BYTES} bytes`,
          };
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Renamed from `text` to `responseBody` — the function param is also
    // named `text`, and the TDZ-shadowing was masked at Convex runtime but
    // throws under Vitest's transformer ("Cannot access 'text2' before
    // initialization"). Variable shadowing of a function param is a real
    // bug — not a test artifact — because any tooling that runs the
    // function through esbuild/SWC in dev mode will trip the same TDZ.
    const responseBody = new TextDecoder().decode(merged);
    const json = JSON.parse(responseBody) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };
    const embedding = json.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      return {
        ok: false,
        reason: `OpenAI returned ${embedding?.length ?? 0} dims, expected ${EMBEDDING_DIMENSIONS}`,
      };
    }
    return { ok: true, embedding };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `fetch threw: ${msg.slice(0, 180)}` };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Search-text projection helpers (re-imported via _import to avoid cycles)   */
/*                                                                             */
/* We recompute searchableText from row fields rather than trust whatever's   */
/* persisted because: (a) some legacy rows have NO searchableText yet, and    */
/* (b) recomputing matches the post-PR-D contract that every row's            */
/* projection is a deterministic function of its source fields.                */
/* -------------------------------------------------------------------------- */

import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
  recomputeBlockSearchableText,
} from "./searchableTextRecompute";

function clipInput(text: string): string {
  if (text.length <= MAX_EMBED_INPUT_BYTES) return text;
  return text.slice(0, MAX_EMBED_INPUT_BYTES);
}

/* -------------------------------------------------------------------------- */
/* Internal mutations — write the embedding + hash back                        */
/*                                                                             */
/* Split into per-table mutations because the table literal must be a const   */
/* at the call site (Convex DB types are not polymorphic on a string arg).    */
/* The drift guard: if the row's searchableText changed between the action    */
/* paging it out and the mutation writing back, skip the write (the next      */
/* schedule will catch up).                                                   */
/* -------------------------------------------------------------------------- */

const APPLY_ARGS = {
  id: v.string(),
  embedding: v.array(v.float64()),
  searchableText: v.string(),
  searchableTextHash: v.string(),
};

const APPLY_RESULT = v.object({
  applied: v.boolean(),
  reason: v.string(),
});

export const applyEntityEmbeddingFromHook = internalMutation({
  args: APPLY_ARGS,
  returns: APPLY_RESULT,
  handler: async (ctx, args) => {
    const id = args.id as Id<"productEntities">;
    const row = await ctx.db.get(id);
    if (!row) return { applied: false, reason: "row missing" };
    // Drift guard: recompute against the CURRENT row's source fields.
    const currentProjection = recomputeEntitySearchableText({
      name: row.name,
      slug: row.slug,
      summary: row.summary,
      savedBecause: row.savedBecause,
    });
    if (currentProjection !== args.searchableText) {
      return { applied: false, reason: "searchableText drifted" };
    }
    await ctx.db.patch(id, {
      embedding: args.embedding,
      searchableTextHash: args.searchableTextHash,
      // Also persist searchableText to harden the row against the legacy
      // case where the field was never written on insert.
      searchableText: args.searchableText,
    });
    return { applied: true, reason: "ok" };
  },
});

export const applyReportEmbeddingFromHook = internalMutation({
  args: APPLY_ARGS,
  returns: APPLY_RESULT,
  handler: async (ctx, args) => {
    const id = args.id as Id<"productReports">;
    const row = await ctx.db.get(id);
    if (!row) return { applied: false, reason: "row missing" };
    const currentProjection = recomputeReportSearchableText({
      title: row.title,
      summary: row.summary,
      query: row.query,
      primaryEntity: row.primaryEntity,
      entitySlug: row.entitySlug,
    });
    if (currentProjection !== args.searchableText) {
      return { applied: false, reason: "searchableText drifted" };
    }
    await ctx.db.patch(id, {
      embedding: args.embedding,
      searchableTextHash: args.searchableTextHash,
      searchableText: args.searchableText,
    });
    return { applied: true, reason: "ok" };
  },
});

export const applyBlockEmbeddingFromHook = internalMutation({
  args: APPLY_ARGS,
  returns: APPLY_RESULT,
  handler: async (ctx, args) => {
    const id = args.id as Id<"productBlocks">;
    const row = await ctx.db.get(id);
    if (!row) return { applied: false, reason: "row missing" };
    const currentProjection = recomputeBlockSearchableText({
      content: row.content,
      deletedAt: row.deletedAt,
    });
    if (currentProjection !== args.searchableText) {
      return { applied: false, reason: "searchableText drifted" };
    }
    await ctx.db.patch(id, {
      embedding: args.embedding,
      searchableTextHash: args.searchableTextHash,
      searchableText: args.searchableText,
    });
    return { applied: true, reason: "ok" };
  },
});

/* -------------------------------------------------------------------------- */
/* Per-row embed actions — the entry points scheduled from product mutations  */
/*                                                                             */
/* Contract for callers:                                                       */
/*   await ctx.scheduler.runAfter(                                            */
/*     0,                                                                      */
/*     internal.domains.search.embedRowOnUpdate.embedEntityRow,               */
/*     { entityId },                                                          */
/*   );                                                                       */
/*                                                                             */
/* Fire-and-forget. The mutation does not await the embedding to complete.    */
/* -------------------------------------------------------------------------- */

/** Tiny query helpers so the action can pull a single row without paginating. */
import { internalQuery } from "../../_generated/server";

const READ_ENTITY_RESULT = v.union(
  v.null(),
  v.object({
    name: v.string(),
    slug: v.string(),
    summary: v.optional(v.string()),
    savedBecause: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    searchableTextHash: v.optional(v.string()),
  }),
);

export const readEntityForEmbed = internalQuery({
  args: { entityId: v.id("productEntities") },
  returns: READ_ENTITY_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.entityId);
    if (!row) return null;
    return {
      name: row.name,
      slug: row.slug,
      summary: row.summary,
      savedBecause: row.savedBecause,
      embedding: row.embedding,
      searchableTextHash: row.searchableTextHash,
    };
  },
});

const READ_REPORT_RESULT = v.union(
  v.null(),
  v.object({
    title: v.string(),
    summary: v.optional(v.string()),
    query: v.optional(v.string()),
    primaryEntity: v.optional(v.string()),
    entitySlug: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    searchableTextHash: v.optional(v.string()),
  }),
);

export const readReportForEmbed = internalQuery({
  args: { reportId: v.id("productReports") },
  returns: READ_REPORT_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reportId);
    if (!row) return null;
    return {
      title: row.title,
      summary: row.summary,
      query: row.query,
      primaryEntity: row.primaryEntity,
      entitySlug: row.entitySlug,
      embedding: row.embedding,
      searchableTextHash: row.searchableTextHash,
    };
  },
});

const READ_BLOCK_RESULT = v.union(
  v.null(),
  v.object({
    content: v.any(),
    deletedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    searchableTextHash: v.optional(v.string()),
  }),
);

export const readBlockForEmbed = internalQuery({
  args: { blockId: v.id("productBlocks") },
  returns: READ_BLOCK_RESULT,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.blockId);
    if (!row) return null;
    return {
      content: row.content,
      deletedAt: row.deletedAt,
      embedding: row.embedding,
      searchableTextHash: row.searchableTextHash,
    };
  },
});

export const embedEntityRow = internalAction({
  args: { entityId: v.id("productEntities") },
  returns: EMBED_ROW_RESULT_SHAPE,
  handler: async (ctx, args): Promise<EmbedRowResult> => {
    try {
      const row = await ctx.runQuery(
        internal.domains.search.embedRowOnUpdate.readEntityForEmbed,
        { entityId: args.entityId },
      );
      if (!row) return { status: "skipped", reason: bounded("row missing") };
      const projection = recomputeEntitySearchableText({
        name: row.name,
        slug: row.slug,
        summary: row.summary,
        savedBecause: row.savedBecause,
      });
      if (projection.length === 0) {
        return { status: "skipped", reason: bounded("empty searchableText") };
      }
      const clipped = clipInput(projection);
      const nextHash = await sha256Hex(clipped);
      if (
        row.searchableTextHash === nextHash &&
        Array.isArray(row.embedding) &&
        row.embedding.length === EMBEDDING_DIMENSIONS
      ) {
        return { status: "skipped", reason: bounded("hash unchanged") };
      }
      const result = await embedSingle(clipped);
      if (!result.ok) {
        return { status: "failed", reason: bounded(result.reason) };
      }
      const apply = await ctx.runMutation(
        internal.domains.search.embedRowOnUpdate.applyEntityEmbeddingFromHook,
        {
          id: String(args.entityId),
          embedding: result.embedding,
          searchableText: clipped,
          searchableTextHash: nextHash,
        },
      );
      if (!apply.applied) {
        return { status: "skipped", reason: bounded(apply.reason) };
      }
      return { status: "embedded", reason: bounded("ok") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[embedEntityRow] error:", msg);
      return { status: "failed", reason: bounded(`exception: ${msg}`) };
    }
  },
});

export const embedReportRow = internalAction({
  args: { reportId: v.id("productReports") },
  returns: EMBED_ROW_RESULT_SHAPE,
  handler: async (ctx, args): Promise<EmbedRowResult> => {
    try {
      const row = await ctx.runQuery(
        internal.domains.search.embedRowOnUpdate.readReportForEmbed,
        { reportId: args.reportId },
      );
      if (!row) return { status: "skipped", reason: bounded("row missing") };
      const projection = recomputeReportSearchableText({
        title: row.title,
        summary: row.summary,
        query: row.query,
        primaryEntity: row.primaryEntity,
        entitySlug: row.entitySlug,
      });
      if (projection.length === 0) {
        return { status: "skipped", reason: bounded("empty searchableText") };
      }
      const clipped = clipInput(projection);
      const nextHash = await sha256Hex(clipped);
      if (
        row.searchableTextHash === nextHash &&
        Array.isArray(row.embedding) &&
        row.embedding.length === EMBEDDING_DIMENSIONS
      ) {
        return { status: "skipped", reason: bounded("hash unchanged") };
      }
      const result = await embedSingle(clipped);
      if (!result.ok) {
        return { status: "failed", reason: bounded(result.reason) };
      }
      const apply = await ctx.runMutation(
        internal.domains.search.embedRowOnUpdate.applyReportEmbeddingFromHook,
        {
          id: String(args.reportId),
          embedding: result.embedding,
          searchableText: clipped,
          searchableTextHash: nextHash,
        },
      );
      if (!apply.applied) {
        return { status: "skipped", reason: bounded(apply.reason) };
      }
      return { status: "embedded", reason: bounded("ok") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[embedReportRow] error:", msg);
      return { status: "failed", reason: bounded(`exception: ${msg}`) };
    }
  },
});

export const embedBlockRow = internalAction({
  args: { blockId: v.id("productBlocks") },
  returns: EMBED_ROW_RESULT_SHAPE,
  handler: async (ctx, args): Promise<EmbedRowResult> => {
    try {
      const row = await ctx.runQuery(
        internal.domains.search.embedRowOnUpdate.readBlockForEmbed,
        { blockId: args.blockId },
      );
      if (!row) return { status: "skipped", reason: bounded("row missing") };
      const projection = recomputeBlockSearchableText({
        content: row.content,
        deletedAt: row.deletedAt,
      });
      if (projection.length === 0) {
        // Soft-deleted or empty block — drop out of vector index too.
        return { status: "skipped", reason: bounded("empty searchableText") };
      }
      const clipped = clipInput(projection);
      const nextHash = await sha256Hex(clipped);
      if (
        row.searchableTextHash === nextHash &&
        Array.isArray(row.embedding) &&
        row.embedding.length === EMBEDDING_DIMENSIONS
      ) {
        return { status: "skipped", reason: bounded("hash unchanged") };
      }
      const result = await embedSingle(clipped);
      if (!result.ok) {
        return { status: "failed", reason: bounded(result.reason) };
      }
      const apply = await ctx.runMutation(
        internal.domains.search.embedRowOnUpdate.applyBlockEmbeddingFromHook,
        {
          id: String(args.blockId),
          embedding: result.embedding,
          searchableText: clipped,
          searchableTextHash: nextHash,
        },
      );
      if (!apply.applied) {
        return { status: "skipped", reason: bounded(apply.reason) };
      }
      return { status: "embedded", reason: bounded("ok") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[embedBlockRow] error:", msg);
      return { status: "failed", reason: bounded(`exception: ${msg}`) };
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Daily cron sweep — belt-and-suspenders for missed schedules                */
/*                                                                             */
/* Walks each of the 3 tables in paginated chunks and re-enqueues any row     */
/* where:                                                                      */
/*   (a) searchableTextHash is missing AND searchableText is non-empty, OR    */
/*   (b) searchableTextHash !== sha256(current searchableText) — i.e. the     */
/*       content changed but the embedding hasn't been refreshed, OR          */
/*   (c) embedding is missing entirely                                         */
/*                                                                             */
/* Bounded to `batchSize` rows total (default 200) across the 3 tables — the */
/* cron is the safety net, not the primary path.                              */
/* -------------------------------------------------------------------------- */

const STALE_ROWS_ARGS = {
  batchSize: v.optional(v.number()),
};

const STALE_ROWS_RESULT = v.object({
  scanned: v.number(),
  scheduled: v.number(),
  durationMs: v.number(),
});

export const embedStaleRowsScanEntities = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        _id: v.id("productEntities"),
        searchableText: v.optional(v.string()),
        embedding: v.optional(v.array(v.float64())),
        searchableTextHash: v.optional(v.string()),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productEntities")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        searchableText: row.searchableText,
        embedding: row.embedding,
        searchableTextHash: row.searchableTextHash,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const embedStaleRowsScanReports = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        _id: v.id("productReports"),
        searchableText: v.optional(v.string()),
        embedding: v.optional(v.array(v.float64())),
        searchableTextHash: v.optional(v.string()),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productReports")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        searchableText: row.searchableText,
        embedding: row.embedding,
        searchableTextHash: row.searchableTextHash,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const embedStaleRowsScanBlocks = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        _id: v.id("productBlocks"),
        searchableText: v.optional(v.string()),
        embedding: v.optional(v.array(v.float64())),
        searchableTextHash: v.optional(v.string()),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("productBlocks")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        searchableText: row.searchableText,
        embedding: row.embedding,
        searchableTextHash: row.searchableTextHash,
      })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Sweep stale rows across all 3 tables. Bounded to `batchSize` total
 * scheduled embeddings to keep per-cron-tick cost bounded.
 *
 * "Stale" means: searchableText non-empty AND
 *   - embedding missing, OR
 *   - searchableTextHash missing, OR
 *   - searchableTextHash !== sha256(searchableText)
 *
 * The action does not await each `embedXxxRow` — it schedules them in
 * parallel and returns counts. Each scheduled row runs the same
 * idempotent action used by the per-mutation hook.
 */
export const embedStaleRows = internalAction({
  args: STALE_ROWS_ARGS,
  returns: STALE_ROWS_RESULT,
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const requested = Math.max(
      1,
      Math.min(MAX_CRON_BATCH_SIZE, args.batchSize ?? DEFAULT_CRON_BATCH_SIZE),
    );
    let remaining = requested;
    let scanned = 0;
    let scheduled = 0;

    type Table = "entities" | "reports" | "blocks";
    const tables: Table[] = ["entities", "reports", "blocks"];

    for (const table of tables) {
      if (remaining <= 0) break;
      let cursor: string | null = null;
      for (let page = 0; page < MAX_STALE_PAGES && remaining > 0; page += 1) {
        const scanRef =
          table === "entities"
            ? internal.domains.search.embedRowOnUpdate.embedStaleRowsScanEntities
            : table === "reports"
              ? internal.domains.search.embedRowOnUpdate.embedStaleRowsScanReports
              : internal.domains.search.embedRowOnUpdate.embedStaleRowsScanBlocks;
        const result: {
          rows: Array<{
            _id: string;
            searchableText?: string;
            embedding?: number[];
            searchableTextHash?: string;
          }>;
          cursor: string | null;
          isDone: boolean;
        } = await ctx.runQuery(scanRef, {
          cursor,
          limit: Math.min(STALE_PAGE_SIZE, remaining),
        });
        cursor = result.cursor;
        for (const row of result.rows) {
          if (remaining <= 0) break;
          scanned += 1;
          const text = row.searchableText ?? "";
          if (text.length === 0) continue;
          const currentHash = await sha256Hex(clipInput(text));
          const isStale =
            !row.embedding ||
            row.embedding.length !== EMBEDDING_DIMENSIONS ||
            !row.searchableTextHash ||
            row.searchableTextHash !== currentHash;
          if (!isStale) continue;
          if (table === "entities") {
            await ctx.scheduler.runAfter(
              0,
              internal.domains.search.embedRowOnUpdate.embedEntityRow,
              { entityId: row._id as Id<"productEntities"> },
            );
          } else if (table === "reports") {
            await ctx.scheduler.runAfter(
              0,
              internal.domains.search.embedRowOnUpdate.embedReportRow,
              { reportId: row._id as Id<"productReports"> },
            );
          } else {
            await ctx.scheduler.runAfter(
              0,
              internal.domains.search.embedRowOnUpdate.embedBlockRow,
              { blockId: row._id as Id<"productBlocks"> },
            );
          }
          scheduled += 1;
          remaining -= 1;
        }
        if (result.isDone) break;
      }
    }

    return {
      scanned,
      scheduled,
      durationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Pure-function exports for unit tests (no Convex context required)          */
/* -------------------------------------------------------------------------- */

/** Exposed for tests: deterministic SHA-256 of a string. */
export const __test = {
  sha256Hex,
  clipInput,
  bounded,
  embedSingle,
  MAX_EMBED_INPUT_BYTES,
  EMBEDDING_DIMENSIONS,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CRON_BATCH_SIZE,
};
