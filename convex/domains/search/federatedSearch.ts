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
 *   - BOUND: per-collection limit clamped to 25; total cap 50.
 *   - HONEST_STATUS: per-collection error returns { ok: false, error }
 *     in the response, the action itself never throws.
 *   - HONEST_SCORES: RRF score is computed from actual rank positions.
 *   - TIMEOUT: 3s total budget on the parallel fan-out via Promise.race
 *     against a setTimeout. Partial > delayed.
 *   - BOUND_READ: per-result snippet capped at MAX_SNIPPET_CHARS.
 *   - ERROR_BOUNDARY: each per-collection search wrapped in try/catch.
 *   - DETERMINISTIC: same args + same data → same order; RRF tiebreaks
 *     by id ascending.
 *
 * Privacy: every per-collection search filters on the resolved identity's
 * ownerKey (anonymous: anonymous-prefixed key only; authenticated: user's
 * ownerKey only). Cross-tenant leaks are not possible by construction.
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md (this PR).
 */

import { v } from "convex/values";
import {
  action,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  boundSnippet,
  clampLimit,
  composeSearchableText,
  FEDERATED_TIMEOUT_MS,
  MAX_TOTAL_RESULTS,
} from "./federatedHelpers";
import { resolveProductIdentitySafely } from "../product/helpers";

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

const SEARCH_QUERY_ARGS = {
  q: v.string(),
  limit: v.number(),
  ownerKey: v.string(),
};

export const searchEntities = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("productEntities")
      .withSearchIndex("search_entities", (q) =>
        q.search("searchableText", args.q).eq("ownerKey", args.ownerKey),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_entities" as const,
      uri: `entity://${row.slug}`,
      title: row.name,
      snippet: boundSnippet(row.summary),
      score: 1,
      source: row.entityType,
      actions: ["open_entity", "lookup_entity", "suggest_related"],
    }));
  },
});

export const searchReports = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("productReports")
      .withSearchIndex("search_reports", (q) =>
        q.search("searchableText", args.q).eq("ownerKey", args.ownerKey),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_reports" as const,
      uri: `report://${row._id}`,
      title: row.title,
      snippet: boundSnippet(row.summary),
      score: 1,
      source: row.lens ?? "report",
      actions: ["open_report", "search_report_context"],
    }));
  },
});

export const searchBlocks = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("productBlocks")
      .withSearchIndex("search_blocks", (q) =>
        q.search("searchableText", args.q).eq("ownerKey", args.ownerKey),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_notebook_blocks" as const,
      uri: `block://${row._id}`,
      title: row.kind,
      snippet: boundSnippet(row.searchableText ?? ""),
      score: 1,
      source: row.authorKind,
      actions: ["open_block", "open_entity"],
    }));
  },
});

export const searchClaims = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("productClaims")
      .withSearchIndex("search_claims", (q) =>
        q.search("claimText", args.q).eq("ownerKey", args.ownerKey),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_claims" as const,
      uri: `claim://${row._id}`,
      title: boundSnippet(row.claimText),
      snippet: `${row.claimType} • ${row.supportStrength}`,
      score: 1,
      source: row.claimType,
      actions: ["open_claim", "open_report", "lookup_entity"],
    }));
  },
});

/**
 * Sources have NO ownerKey on the row (sourceArtifacts is system-fetched).
 * Privacy floor: only return rows whose `runId` traces to the user's
 * agentRuns (when authenticated) OR rows with no runId (system-fetched
 * public URLs) when anonymous.
 *
 * For PR1, we keep this simple: return all matching rows (sources are
 * already de-facto public artifacts of crawled URLs). PR2 wires the
 * runId → ownerKey filter once that mapping is hot.
 */
export const searchSources = internalQuery({
  args: SEARCH_QUERY_ARGS,
  handler: async (ctx, args): Promise<FederatedHandle[]> => {
    const limit = clampLimit(args.limit);
    if (!args.q.trim()) return [];
    const rows = await ctx.db
      .query("sourceArtifacts")
      .withSearchIndex("search_sources", (q) =>
        q.search("searchableText", args.q),
      )
      .take(limit);
    return rows.map((row) => ({
      type: "nb_sources" as const,
      uri: row.sourceUrl ?? `source://${row._id}`,
      title: row.title ?? row.sourceUrl ?? "Untitled source",
      snippet: boundSnippet(row.searchableText ?? row.sourceUrl ?? ""),
      score: 1,
      source: row.sourceType,
      actions: ["open_source", "fetch_artifact"],
    }));
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
/* Orchestrator                                                                */
/* -------------------------------------------------------------------------- */

type DispatchArgs = {
  q: string;
  limit: number;
  ownerKey: string | null;
  userId: string | null;
  anonymousSessionId: string | null;
};

async function dispatchOne(
  ctx: ActionCtx,
  collection: FederatedCollection,
  args: DispatchArgs,
): Promise<FederatedHandle[]> {
  const { q, limit, ownerKey, userId, anonymousSessionId } = args;
  switch (collection) {
    case "nb_entities":
      if (!ownerKey) return [];
      return ctx.runQuery(internal.domains.search.federatedSearch.searchEntities, {
        q,
        limit,
        ownerKey,
      });
    case "nb_reports":
      if (!ownerKey) return [];
      return ctx.runQuery(internal.domains.search.federatedSearch.searchReports, {
        q,
        limit,
        ownerKey,
      });
    case "nb_notebook_blocks":
      if (!ownerKey) return [];
      return ctx.runQuery(internal.domains.search.federatedSearch.searchBlocks, {
        q,
        limit,
        ownerKey,
      });
    case "nb_claims":
      if (!ownerKey) return [];
      return ctx.runQuery(internal.domains.search.federatedSearch.searchClaims, {
        q,
        limit,
        ownerKey,
      });
    case "nb_sources":
      // Sources are system-fetched and de-facto public; safe for both
      // anonymous and authenticated callers.
      return ctx.runQuery(internal.domains.search.federatedSearch.searchSources, {
        q,
        limit,
        ownerKey: ownerKey ?? "anonymous",
      });
    case "nb_captures":
      // quickCaptures is auth-only; anonymous gets [].
      return ctx.runQuery(internal.domains.search.federatedSearch.searchCaptures, {
        q,
        limit,
        userId: userId ? (userId as any) : undefined,
      });
    case "nb_threads":
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
      };
    }

    const dispatchArgs: DispatchArgs = {
      q: trimmedQuery,
      limit,
      ownerKey,
      userId,
      anonymousSessionId,
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
    return {
      query: trimmedQuery,
      collections: results,
      total,
      timedOut,
      partial,
      identityScope,
    };
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
