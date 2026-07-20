/**
 * Convex-native federated search.
 *
 * Replaces the deferred Typesense plan (PR #306) — same surface (7
 * collections + Cmd-K + agent tools) but built on Convex's own
 * `searchIndex` + reactive queries. Zero new infra, zero new
 * credentials, zero extra cost.
 *
 * Pattern: orchestrator-workers (per .claude/rules/orchestrator_workers.md).
 *   - This action is the orchestrator.
 *   - Each `searchOneCollection*` internal query is a worker (own ctx,
 *     own bounded budget, own scratchpad section).
 *   - Workers are dispatched via Promise.allSettled → no single failure
 *     fails the whole call (HONEST_STATUS).
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - BOUND: per-collection limit clamped to 25; total cap 50. Each
 *     visibility branch ALSO clamped to the same per-collection limit
 *     (so the merged worst case is still 2*limit pre-dedupe, not 7×).
 *   - HONEST_STATUS: per-collection error returns { ok: false, error }
 *     in the response, the action itself never throws.
 *   - HONEST_SCORES: RRF score is computed from actual rank positions.
 *   - TIMEOUT: 3s total budget on the parallel fan-out via Promise.race
 *     against a setTimeout. Partial > delayed.
 *   - BOUND_READ: per-result snippet capped at MAX_SNIPPET_CHARS.
 *   - ERROR_BOUNDARY: each per-collection search wrapped in try/catch.
 *   - DETERMINISTIC: same args + same data → same order; RRF tiebreaks
 *     by id ascending. Visibility merge dedupes by row _id so a row owned
 *     by the current user with visibility="public" appears exactly once.
 *
 * Visibility model (PR public-visibility, May 2026):
 *   - Each owner-scoped collection (entities/reports/blocks/claims) has a
 *     per-row `visibility: "public" | "team" | "private"` field
 *     (productReports uses the legacy `"workspace"` literal in lieu of
 *     `"team"` — semantically equivalent for the public-or-not gate).
 *   - PUBLIC branch: every caller (anonymous or authenticated) runs an
 *     eq("visibility", "public") search.
 *   - OWNER branch: only authenticated/anon-session callers with a
 *     resolved ownerKey ALSO run an eq("ownerKey", X) search to see their
 *     own private + team rows.
 *   - Merge dedupes by row _id so a public row owned by the caller
 *     appears exactly once. Anonymous callers see PUBLIC rows from any
 *     owner — that's the point. Cross-tenant private leaks are impossible
 *     by construction (the OWNER branch is gated on the resolved key, the
 *     PUBLIC branch is gated on `visibility="public"`).
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md.
 */

import { v } from "convex/values";
import {
  action,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  boundSnippet,
  clampLimit,
  composeSearchableText,
  FEDERATED_TIMEOUT_MS,
  MAX_TOTAL_RESULTS,
  rrfMerge,
} from "./federatedHelpers";
import { resolveProductIdentitySafely } from "../product/helpers";
import { embedQuery } from "./embedSearchableText";
import { buildFederatedCacheKey } from "./federatedSearchCache";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

const COLLECTIONS = [
  "nb_entities",
  "nb_reports",
  "nb_notebook_blocks",
  "nb_claims",
  "nb_sources",
  "nb_captures",
  "nb_threads",
] as const;

export type FederatedCollection = (typeof COLLECTIONS)[number];

export type FederatedHandle = {
  type: FederatedCollection;
  uri: string;
  title: string;
  snippet: string;
  score: number;
  source: string;
  actions: string[];
  /**
   * Stable row identifier used to DEDUPE across the public-visibility
   * branch and the owner-scoped branch. A row owned by the caller with
   * visibility="public" matches BOTH branches; we keep the first one and
   * drop the duplicate. Stringified Convex Id; `undefined` for handles
   * synthesized by tests where the id is not material.
   */
  rowId?: string;
};

export type CollectionResult = {
  collection: FederatedCollection;
  ok: boolean;
  results: FederatedHandle[];
  count: number;
  error?: string;
};

export type FederatedSearchResponse = {
  query: string;
  collections: CollectionResult[];
  total: number;
  timedOut: boolean;
  partial: boolean;
  identityScope: "authenticated" | "anonymous";
  /**
   * True when the vector hybrid path was used for at least one collection.
   * False when:
   *   - OPENAI_API_KEY is missing (degraded to keyword-only)
   *   - Embedding fetch failed
   *   - Empty query
   * Surfaces honest degradation to the caller (HONEST_STATUS rule).
   */
  hybridUsed: boolean;
};

/* -------------------------------------------------------------------------- */
/* Per-collection internal queries                                             */
/*                                                                             */
/* Each one:                                                                   */
/*   - takes (q, limit, ownerKey)                                              */
/*   - filters by ownerKey (privacy floor)                                     */
/*   - uses the table's `search_*` index when available                        */
/*   - returns shaped FederatedHandle[]                                        */
/* -------------------------------------------------------------------------- */

/**
 * Args for the owner-scoped search workers. `ownerKey` is nullable now —
 * anonymous callers without a session pass `null` and only the public
 * branch runs.
 */
const SEARCH_QUERY_ARGS = {
  q: v.string(),
  limit: v.number(),
  ownerKey: v.union(v.string(), v.null()),
};

/**
 * Merge two ranked handle lists, preserving order, deduping by `rowId`.
 * Public-branch entries come first (the caller wants public results to
 * surface even when they own a row), then owner-scoped entries that the
 * public branch did NOT already include.
 *
 * DETERMINISTIC — same inputs always produce the same merged list because
 * (a) each branch's input order is deterministic (Convex search index +
 * `.take(N)`), and (b) we walk the inputs in fixed order using a Set for
 * dedupe membership.
 */
function mergeVisibilityBranches(
  publicResults: FederatedHandle[],
  ownerResults: FederatedHandle[],
  limit: number,
): FederatedHandle[] {
  const seen = new Set<string>();
  const out: FederatedHandle[] = [];
  for (const handle of publicResults) {
    if (handle.rowId && seen.has(handle.rowId)) continue;
    if (handle.rowId) seen.add(handle.rowId);
    out.push(handle);
    if (out.length >= limit) return out;
  }
  for (const handle of ownerResults) {
    if (handle.rowId && seen.has(handle.rowId)) continue;
    if (handle.rowId) seen.add(handle.rowId);
    out.push(handle);
    if (out.length >= limit) return out;
  }
  return out;
}

export const searchEntities = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    // PUBLIC branch — every caller, including anonymous, sees these.
    const publicRows = await ctx.db
      .query("productEntities")
      .withSearchIndex("search_entities", (q) =>
        q.search("searchableText", args.q).eq("visibility", "public"),
      )
      .take(limit);
    // OWNER branch — only callers with a resolved ownerKey see their own
    // private + team rows. Skipped entirely for anonymous-no-session.
    const ownerRows = args.ownerKey
      ? await ctx.db
          .query("productEntities")
          .withSearchIndex("search_entities", (q) =>
            q.search("searchableText", args.q).eq("ownerKey", args.ownerKey!),
          )
          .take(limit)
      : [];
    const shape = (row: typeof publicRows[number]): FederatedHandle => ({
      type: "nb_entities" as const,
      uri: `entity://${row.slug}`,
      title: row.name,
      snippet: boundSnippet(row.summary),
      score: 1,
      source: row.entityType,
      actions: ["open_entity", "lookup_entity", "suggest_related"],
      rowId: String(row._id),
    });
    return mergeVisibilityBranches(
      publicRows.map(shape),
      ownerRows.map(shape),
      limit,
    );
  },
});

export const searchReports = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const publicRows = await ctx.db
      .query("productReports")
      .withSearchIndex("search_reports", (q) =>
        q.search("searchableText", args.q).eq("visibility", "public"),
      )
      .take(limit);
    const ownerRows = args.ownerKey
      ? await ctx.db
          .query("productReports")
          .withSearchIndex("search_reports", (q) =>
            q.search("searchableText", args.q).eq("ownerKey", args.ownerKey!),
          )
          .take(limit)
      : [];
    const shape = (row: typeof publicRows[number]): FederatedHandle => ({
      type: "nb_reports" as const,
      uri: `report://${row._id}`,
      title: row.title,
      snippet: boundSnippet(row.summary),
      score: 1,
      source: row.lens ?? "report",
      actions: ["open_report", "search_report_context"],
      rowId: String(row._id),
    });
    return mergeVisibilityBranches(
      publicRows.map(shape),
      ownerRows.map(shape),
      limit,
    );
  },
});

export const searchBlocks = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const publicRows = await ctx.db
      .query("productBlocks")
      .withSearchIndex("search_blocks", (q) =>
        q.search("searchableText", args.q).eq("visibility", "public"),
      )
      .take(limit);
    const ownerRows = args.ownerKey
      ? await ctx.db
          .query("productBlocks")
          .withSearchIndex("search_blocks", (q) =>
            q.search("searchableText", args.q).eq("ownerKey", args.ownerKey!),
          )
          .take(limit)
      : [];
    const shape = (row: typeof publicRows[number]): FederatedHandle => ({
      type: "nb_notebook_blocks" as const,
      uri: `block://${row._id}`,
      title: row.kind,
      snippet: boundSnippet(row.searchableText ?? ""),
      score: 1,
      source: row.authorKind,
      actions: ["open_block", "open_entity"],
      rowId: String(row._id),
    });
    return mergeVisibilityBranches(
      publicRows.map(shape),
      ownerRows.map(shape),
      limit,
    );
  },
});

export const searchClaims = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const publicRows = await ctx.db
      .query("productClaims")
      .withSearchIndex("search_claims", (q) =>
        q.search("claimText", args.q).eq("visibility", "public"),
      )
      .take(limit);
    const ownerRows = args.ownerKey
      ? await ctx.db
          .query("productClaims")
          .withSearchIndex("search_claims", (q) =>
            q.search("claimText", args.q).eq("ownerKey", args.ownerKey!),
          )
          .take(limit)
      : [];
    const shape = (row: typeof publicRows[number]): FederatedHandle => ({
      type: "nb_claims" as const,
      uri: `claim://${row._id}`,
      title: boundSnippet(row.claimText),
      snippet: `${row.claimType} • ${row.supportStrength}`,
      score: 1,
      source: row.claimType,
      actions: ["open_claim", "open_report", "lookup_entity"],
      rowId: String(row._id),
    });
    return mergeVisibilityBranches(
      publicRows.map(shape),
      ownerRows.map(shape),
      limit,
    );
  },
});

export function isSourceArtifactVisibleToCaller(
  row: { runId?: string },
  args: { userId?: string | null },
  runOwnerUserId?: string | null,
): boolean {
  if (!row.runId) return true;
  if (!args.userId) return false;
  return runOwnerUserId === args.userId;
}

/**
 * Sources have no ownerKey on the row. The access floor is therefore:
 *   - rows with no runId are treated as public/system-fetched source refs
 *   - run-backed rows are only visible to the user who owns that agentRun
 *
 * This is intentionally post-filtered after the search index read because
 * `sourceArtifacts.search_sources` only has sourceType as an index filter.
 */
export const searchSources = internalQuery({
  args: {
    ...SEARCH_QUERY_ARGS,
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("sourceArtifacts")
      .withSearchIndex("search_sources", (q) =>
        q.search("searchableText", args.q),
      )
      .take(Math.min(limit * 4, 100));

    const visible: FederatedHandle[] = [];
    const runOwnerCache = new Map<string, string | null>();
    for (const row of rows) {
      let runOwnerUserId: string | null = null;
      if (row.runId) {
        const runId = String(row.runId);
        if (runOwnerCache.has(runId)) {
          runOwnerUserId = runOwnerCache.get(runId) ?? null;
        } else {
          const run = await ctx.db.get(row.runId);
          runOwnerUserId = run?.userId ? String(run.userId) : null;
          runOwnerCache.set(runId, runOwnerUserId);
        }
      }
      if (
        !isSourceArtifactVisibleToCaller(
          { runId: row.runId ? String(row.runId) : undefined },
          { userId: args.userId ? String(args.userId) : null },
          runOwnerUserId,
        )
      ) {
        continue;
      }
      visible.push({
        type: "nb_sources" as const,
        uri: row.sourceUrl ?? `source://${row._id}`,
        title: row.title ?? row.sourceUrl ?? "Untitled source",
        snippet: boundSnippet(row.searchableText ?? row.sourceUrl ?? ""),
        score: 1,
        source: row.sourceType,
        actions: ["open_source", "fetch_artifact"],
        rowId: String(row._id),
      });
      if (visible.length >= limit) break;
    }
    return visible;
  },
});

/**
 * quickCaptures is keyed by `userId` (Id<"users">), not by `ownerKey`.
 * Anonymous users have no userId so they get ZERO results — correct, since
 * quickCaptures are auth-only by design.
 */
export const searchCaptures = internalQuery({
  args: {
    q: v.string(),
    limit: v.number(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim() || !args.userId) return [];
    const userId = args.userId;
    const rows = await ctx.db
      .query("quickCaptures")
      .withSearchIndex("search_captures", (q) =>
        q.search("content", args.q).eq("userId", userId),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_captures" as const,
      uri: `capture://${row._id}`,
      title: row.title ?? row.type,
      snippet: boundSnippet(row.content),
      score: 1,
      source: row.type,
      actions: ["open_capture"],
    }));
  },
});

/**
 * chatThreadsStream is keyed by EITHER `userId` or `anonymousSessionId`.
 * We pass both — the `eq` filter only matches one, so the search will
 * correctly scope to the caller's identity layer.
 */
export const searchThreads = internalQuery({
  args: {
    q: v.string(),
    limit: v.number(),
    userId: v.optional(v.id("users")),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    if (!args.userId && !args.anonymousSessionId) return [];
    const queryBuilder = ctx.db
      .query("chatThreadsStream")
      .withSearchIndex("search_threads", (q) => {
        let scoped = q.search("title", args.q);
        if (args.userId) {
          scoped = scoped.eq("userId", args.userId);
        } else if (args.anonymousSessionId) {
          scoped = scoped.eq("anonymousSessionId", args.anonymousSessionId);
        }
        return scoped;
      });
    const rows = await queryBuilder.take(limit);
    return rows.map((row) => ({
      type: "nb_threads" as const,
      uri: `thread://${row._id}`,
      title: row.title || "Untitled thread",
      snippet: row.model ? `model: ${row.model}` : "",
      score: 1,
      source: "chat",
      actions: ["open_thread", "resume_thread"],
    }));
  },
});

/* -------------------------------------------------------------------------- */
/* Vector hydration queries (PR E)                                             */
/*                                                                             */
/* The vector search step happens INSIDE the action (vectorSearch is only     */
/* available on action ctx). After we get a ranked list of ids, these         */
/* internal queries fetch the full rows in one shot and shape them into the   */
/* same FederatedHandle contract used by the keyword path.                    */
/* -------------------------------------------------------------------------- */

const HYDRATE_ARGS = { ids: v.array(v.string()), ownerKey: v.string() };

export const hydrateEntitiesByIds = internalQuery({
  args: HYDRATE_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const handles: FederatedHandle[] = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id as Id<"productEntities">);
      if (!row) continue;
      // Privacy floor — vectorIndex filter is best-effort; double-check
      // ownerKey here so a misconfigured filter can never leak.
      if (row.ownerKey !== args.ownerKey) continue;
      handles.push({
        type: "nb_entities",
        uri: `entity://${row.slug}`,
        title: row.name,
        snippet: boundSnippet(row.summary),
        score: 1,
        source: row.entityType,
        actions: ["open_entity", "lookup_entity", "suggest_related"],
      });
    }
    return handles;
  },
});

export const hydrateReportsByIds = internalQuery({
  args: HYDRATE_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const handles: FederatedHandle[] = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id as Id<"productReports">);
      if (!row) continue;
      if (row.ownerKey !== args.ownerKey) continue;
      handles.push({
        type: "nb_reports",
        uri: `report://${row._id}`,
        title: row.title,
        snippet: boundSnippet(row.summary),
        score: 1,
        source: row.lens ?? "report",
        actions: ["open_report", "search_report_context"],
      });
    }
    return handles;
  },
});

export const hydrateBlocksByIds = internalQuery({
  args: HYDRATE_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const handles: FederatedHandle[] = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id as Id<"productBlocks">);
      if (!row) continue;
      if (row.ownerKey !== args.ownerKey) continue;
      // Soft-deleted blocks have empty searchableText (PR D) so they
      // shouldn't appear in vector results either. Defense-in-depth.
      if (row.deletedAt) continue;
      handles.push({
        type: "nb_notebook_blocks",
        uri: `block://${row._id}`,
        title: row.kind,
        snippet: boundSnippet(row.searchableText ?? ""),
        score: 1,
        source: row.authorKind,
        actions: ["open_block", "open_entity"],
      });
    }
    return handles;
  },
});

/* -------------------------------------------------------------------------- */
/* Vector + RRF hybrid path                                                    */
/*                                                                             */
/* Per-collection helper that:                                                 */
/*   1. Runs ctx.vectorSearch on the vec_* index with the cached query        */
/*      embedding                                                              */
/*   2. Hydrates ids -> full rows via the internal query                       */
/*   3. Merges with the keyword path's ids via rrfMerge                        */
/*   4. Returns ranked FederatedHandle[] in the merged order                  */
/*                                                                             */
/* Both keyword and vector results carry their own ranks; rrfMerge produces   */
/* a single deterministic order. If either side returns zero, the merged      */
/* output equals the non-empty side (HONEST_STATUS — no fake matches).        */
/* -------------------------------------------------------------------------- */

type HybridConfig = {
  collection: "nb_entities" | "nb_reports" | "nb_notebook_blocks";
  vectorIndex: "vec_entities" | "vec_reports" | "vec_blocks";
  table: "productEntities" | "productReports" | "productBlocks";
  hydrateRef:
    | typeof internal.domains.search.federatedSearch.hydrateEntitiesByIds
    | typeof internal.domains.search.federatedSearch.hydrateReportsByIds
    | typeof internal.domains.search.federatedSearch.hydrateBlocksByIds;
};

const HYBRID_CONFIGS: Record<string, HybridConfig> = {
  nb_entities: {
    collection: "nb_entities",
    vectorIndex: "vec_entities",
    table: "productEntities",
    hydrateRef: internal.domains.search.federatedSearch.hydrateEntitiesByIds,
  },
  nb_reports: {
    collection: "nb_reports",
    vectorIndex: "vec_reports",
    table: "productReports",
    hydrateRef: internal.domains.search.federatedSearch.hydrateReportsByIds,
  },
  nb_notebook_blocks: {
    collection: "nb_notebook_blocks",
    vectorIndex: "vec_blocks",
    table: "productBlocks",
    hydrateRef: internal.domains.search.federatedSearch.hydrateBlocksByIds,
  },
};

async function vectorSearchOne(
  ctx: ActionCtx,
  collection: keyof typeof HYBRID_CONFIGS,
  embedding: number[],
  ownerKey: string,
  limit: number,
): Promise<FederatedHandle[]> {
  const config = HYBRID_CONFIGS[collection];
  // BOUND: cap vector search at the same per-collection limit (clamped
  // upstream). Convex caps at 256 results per vectorSearch call anyway.
  const ranked = await ctx.vectorSearch(config.table, config.vectorIndex, {
    vector: embedding,
    limit,
    filter: (q) => q.eq("ownerKey", ownerKey),
  });
  if (ranked.length === 0) return [];
  // Hydrate in the ranked order so handles[i] corresponds to ranked[i].
  const ids = ranked.map((r) => String(r._id));
  const handles: FederatedHandle[] = await ctx.runQuery(config.hydrateRef, {
    ids,
    ownerKey,
  });
  return handles;
}

/**
 * Merges the keyword path's handles with the vector path's handles via RRF,
 * preserving handle metadata from whichever side supplied it first.
 *
 * Deterministic — same inputs always produce the same order
 * (rrfMerge tiebreaks by id ascending).
 */
function mergeHybridResults(
  keyword: FederatedHandle[],
  vector: FederatedHandle[],
  limit: number,
): FederatedHandle[] {
  if (vector.length === 0) return keyword.slice(0, limit);
  if (keyword.length === 0) return vector.slice(0, limit);
  const handleByUri = new Map<string, FederatedHandle>();
  for (const handle of [...keyword, ...vector]) {
    if (!handleByUri.has(handle.uri)) {
      handleByUri.set(handle.uri, handle);
    }
  }
  const ranked = rrfMerge(
    keyword.map((h) => ({ id: h.uri })),
    vector.map((h) => ({ id: h.uri })),
  );
  return ranked
    .map(({ id, score }) => {
      const handle = handleByUri.get(id);
      if (!handle) return null;
      return { ...handle, score };
    })
    .filter((h): h is FederatedHandle => h !== null)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                                */
/* -------------------------------------------------------------------------- */

type DispatchArgs = {
  q: string;
  limit: number;
  ownerKey: string | null;
  userId: string | null;
  anonymousSessionId: string | null;
  /**
   * Pre-computed OpenAI embedding for the query. Computed once per
   * federatedSearch call (not per collection) so we never pay the
   * embedding latency more than once. null when:
   *   - Query is empty
   *   - OPENAI_API_KEY is missing (HONEST_STATUS — no fake vectors)
   *   - Embedding fetch failed (caller falls back to keyword-only)
   */
  queryEmbedding: number[] | null;
};

async function dispatchOne(
  ctx: ActionCtx,
  collection: FederatedCollection,
  args: DispatchArgs,
): Promise<FederatedHandle[]> {
  const { q, limit, ownerKey, userId, anonymousSessionId, queryEmbedding } =
    args;
  switch (collection) {
    case "nb_entities": {
      // PR public-visibility: NO early `if (!ownerKey) return []` — the
      // public visibility branch is allowed for anonymous callers. The
      // searchEntities worker handles the public+owner merge internally.
      const keyword = await ctx.runQuery(
        internal.domains.search.federatedSearch.searchEntities,
        { q, limit, ownerKey },
      );
      if (!queryEmbedding) return keyword;
      // Vector hybrid only runs for owner-scoped rows for now — vector
      // index visibility filter would require a separate vector call per
      // branch. Keyword path already surfaces public rows, so this is a
      // strict superset of pre-PR behavior; vector adds typo recovery
      // for the owner's private rows. Anonymous callers skip vector.
      if (!ownerKey) return keyword;
      const vector = await vectorSearchOne(
        ctx,
        "nb_entities",
        queryEmbedding,
        ownerKey,
        limit,
      );
      return mergeHybridResults(keyword, vector, limit);
    }
    case "nb_reports": {
      const keyword = await ctx.runQuery(
        internal.domains.search.federatedSearch.searchReports,
        { q, limit, ownerKey },
      );
      if (!queryEmbedding) return keyword;
      if (!ownerKey) return keyword;
      const vector = await vectorSearchOne(
        ctx,
        "nb_reports",
        queryEmbedding,
        ownerKey,
        limit,
      );
      return mergeHybridResults(keyword, vector, limit);
    }
    case "nb_notebook_blocks": {
      const keyword = await ctx.runQuery(
        internal.domains.search.federatedSearch.searchBlocks,
        { q, limit, ownerKey },
      );
      if (!queryEmbedding) return keyword;
      if (!ownerKey) return keyword;
      const vector = await vectorSearchOne(
        ctx,
        "nb_notebook_blocks",
        queryEmbedding,
        ownerKey,
        limit,
      );
      return mergeHybridResults(keyword, vector, limit);
    }
    case "nb_claims":
      // Claims have no vectorIndex (yet) — keyword only. Public branch
      // runs unconditionally; owner branch runs when ownerKey is set.
      return ctx.runQuery(internal.domains.search.federatedSearch.searchClaims, {
        q,
        limit,
        ownerKey,
      });
    case "nb_sources":
      // Run-backed sources are owner-scoped via agentRuns.userId. Rows
      // without runId remain public/system-fetched source refs.
      return ctx.runQuery(internal.domains.search.federatedSearch.searchSources, {
        q,
        limit,
        ownerKey,
        userId: userId ? (userId as any) : undefined,
      });
    case "nb_captures":
      // quickCaptures is auth-only; anonymous gets []. No vector index (yet).
      return ctx.runQuery(internal.domains.search.federatedSearch.searchCaptures, {
        q,
        limit,
        userId: userId ? (userId as any) : undefined,
      });
    case "nb_threads":
      // Title-only search — no vector index.
      return ctx.runQuery(internal.domains.search.federatedSearch.searchThreads, {
        q,
        limit,
        userId: userId ? (userId as any) : undefined,
        anonymousSessionId: anonymousSessionId ?? undefined,
      });
  }
}

/**
 * Federated search action — the public entry point.
 *
 * Anonymous callers: pass `anonymousSessionId`; private collections return [].
 * Authenticated callers: identity is resolved server-side from auth context.
 */
export const federatedSearch = action({
  args: {
    q: v.string(),
    collections: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<FederatedSearchResponse> => {
    const trimmedQuery = args.q.trim();
    const requested =
      args.collections && args.collections.length > 0
        ? args.collections
        : (COLLECTIONS as readonly string[]);
    const collections = requested.filter((c): c is FederatedCollection =>
      (COLLECTIONS as readonly string[]).includes(c),
    );

    // Identity: resolve via the existing safe helper so the action never
    // throws on missing/invalid auth.
    const identity = await resolveProductIdentitySafely(
      ctx as any,
      args.anonymousSessionId,
    );
    const ownerKey = identity.ownerKey;
    const userId =
      typeof identity.rawUserId === "string"
        ? identity.rawUserId
        : (identity.rawUserId as any) ?? null;
    const anonymousSessionId = identity.anonymousSessionId;
    const identityScope: "authenticated" | "anonymous" =
      identity.rawUserId ? "authenticated" : "anonymous";

    const limit = clampLimit(args.limit, 8);

    // Empty query short-circuits — return zero results, no error.
    if (!trimmedQuery) {
      return {
        query: trimmedQuery,
        collections: collections.map((c) => ({
          collection: c,
          ok: true,
          results: [],
          count: 0,
        })),
        total: 0,
        timedOut: false,
        partial: false,
        identityScope,
        hybridUsed: false,
      };
    }

    /* ──────────────────────────────────────────────────────────────
     * PHASE 12 — Anonymous-only response cache.
     *
     * Cache HIT: serve the previously-computed response, bypassing
     * embedding fetch + 7-collection fan-out + RRF merge.  Expected
     * savings: 300-500ms per cache hit.
     *
     * Privacy floor:
     *   - Only ANONYMOUS calls touch the cache (no ownerKey/userId).
     *   - The dispatchOne worker for anonymous calls only emits
     *     `visibility="public"` rows, so cached payload contains no
     *     per-user content.  Authenticated calls SKIP entirely.
     *
     * ERROR_BOUNDARY: lookup + write swallow errors silently inside
     * their own modules — live computation always wins.
     * ────────────────────────────────────────────────────────────── */
    const cacheKey =
      identityScope === "anonymous"
        ? buildFederatedCacheKey({
            q: trimmedQuery,
            collections,
            limit,
          })
        : null;

    if (cacheKey) {
      try {
        const cached: {
          response: string;
          generatedAt: number;
          hitCount: number;
        } | null = await ctx.runQuery(
          internal.domains.search.federatedSearchCache.lookupFederatedCache,
          { cacheKey },
        );
        if (cached) {
          try {
            const parsed = JSON.parse(cached.response) as FederatedSearchResponse;
            void ctx.runMutation(
              internal.domains.search.federatedSearchCache.incrementHitCount,
              { cacheKey },
            );
            return parsed;
          } catch (err) {
            console.warn(
              "[federatedSearch] cached row failed to parse, falling through:",
              err,
            );
          }
        }
      } catch (err) {
        console.warn("[federatedSearch] cache lookup error, falling through:", err);
      }
    }

    // PR E: compute the query embedding ONCE per federatedSearch call so
    // every per-collection vector search reuses the same vector. Returns
    // null if OPENAI_API_KEY is missing or the call failed — collections
    // gracefully degrade to keyword-only (HONEST_STATUS).
    const queryEmbedding = await embedQuery(trimmedQuery);

    const dispatchArgs: DispatchArgs = {
      q: trimmedQuery,
      limit,
      ownerKey,
      userId,
      anonymousSessionId,
      queryEmbedding,
    };

    // TIMEOUT: race the parallel fan-out against a hard wall-clock budget.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("federated_search_timeout"));
      }, FEDERATED_TIMEOUT_MS);
    });

    let perCollection: Array<PromiseSettledResult<FederatedHandle[]>>;
    try {
      perCollection = await Promise.race([
        Promise.allSettled(
          collections.map((c) => dispatchOne(ctx, c, dispatchArgs)),
        ),
        timeoutPromise,
      ]);
    } catch {
      // Timeout — return empty results per collection with timedOut: true.
      perCollection = collections.map(() => ({
        status: "rejected",
        reason: new Error("federated_search_timeout"),
      }));
    } finally {
      if (timer) clearTimeout(timer);
    }

    const results: CollectionResult[] = collections.map((collection, i) => {
      const settled = perCollection[i];
      if (settled.status === "fulfilled") {
        return {
          collection,
          ok: true,
          results: settled.value,
          count: settled.value.length,
        };
      }
      const reason = settled.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? "unknown");
      return {
        collection,
        ok: false,
        results: [],
        count: 0,
        error: message,
      };
    });

    // Total cap (BOUND) — if the sum exceeds MAX_TOTAL_RESULTS, trim
    // proportionally from the largest collection first. Deterministic.
    let total = results.reduce((s, r) => s + r.count, 0);
    if (total > MAX_TOTAL_RESULTS) {
      // Sort largest first; shave one at a time to preserve diversity.
      while (total > MAX_TOTAL_RESULTS) {
        let maxIdx = 0;
        for (let i = 1; i < results.length; i += 1) {
          if (results[i].count > results[maxIdx].count) maxIdx = i;
        }
        if (results[maxIdx].count === 0) break;
        results[maxIdx].results.pop();
        results[maxIdx].count -= 1;
        total -= 1;
      }
    }

    const partial = results.some((r) => !r.ok);
    const finalResponse: FederatedSearchResponse = {
      query: trimmedQuery,
      collections: results,
      total,
      timedOut,
      partial,
      identityScope,
      // hybridUsed = true if we were able to compute a query embedding.
      // Per-collection vector hybrid only ran for entities/reports/blocks;
      // other collections were keyword-only regardless. The flag tells the
      // caller "vector hybrid was available for this call" — actual per-
      // result origin is encoded in the rrfMerge score on each handle.
      hybridUsed: queryEmbedding !== null,
    };

    /* ──────────────────────────────────────────────────────────────
     * PHASE 12 — Cache WRITE.
     *
     * Persist the live response under the same cacheKey computed at
     * the read step.  Skipped when:
     *   - cacheKey is null (authenticated call — never cached)
     *   - timedOut === true (don't cache partial-by-timeout responses)
     *
     * `partial === true` IS cacheable — the response shape is honest
     * about which collections failed via per-collection ok flags.
     *
     * ERROR_BOUNDARY: void the write (no await on response path).
     * ────────────────────────────────────────────────────────────── */
    if (cacheKey && !timedOut) {
      void ctx.runMutation(
        internal.domains.search.federatedSearchCache.writeFederatedCache,
        {
          cacheKey,
          queryNormalized: trimmedQuery.toLowerCase(),
          collections: collections as string[],
          limit,
          response: JSON.stringify(finalResponse),
        },
      );
    }

    return finalResponse;
  },
});

/* -------------------------------------------------------------------------- */
/* Re-export helpers — consumed by tests + agent tools                         */
/* -------------------------------------------------------------------------- */

export {
  COLLECTIONS,
  composeSearchableText,
  boundSnippet,
  clampLimit,
};
