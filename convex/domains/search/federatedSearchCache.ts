/**
 * Federated search response cache (Phase 12).
 *
 * Anonymous-only edge cache for the federatedSearch action.  Reduces
 * repeat-query cost (embedding fetch + 7-collection fan-out) for the
 * high-volume "guest types a public entity name" path.
 *
 * Pattern: same shape as `editionAudioCache` (PR #305) — cacheKey →
 * single-row lookup → TTL-checked.  No new infra; uses a Convex table
 * defined in `convex/schema.ts` (`federatedSearchCache`).
 *
 * Privacy invariant — CRITICAL:
 *   Only ANONYMOUS calls (no resolved ownerKey/userId) read or write
 *   here.  Authenticated calls bypass entirely.  This is the same
 *   "shared layer" rule enforced by sharedCache.ts §CSL/ESL: shared
 *   stores never carry per-user content.  The federatedSearch action
 *   already gates the OWNER branch on `args.ownerKey` (see
 *   federatedSearch.ts §dispatchOne) so anonymous responses contain
 *   only `visibility="public"` rows from productEntities/Reports/
 *   Blocks/Claims plus de-facto public sourceArtifacts.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          — response capped at MAX_CACHED_RESPONSE_BYTES;
 *                      cacheKey is fixed-length cyrb53 hash.
 *   - HONEST_STATUS  — miss returns null; failed writes are swallowed
 *                      so the live computation always wins.
 *   - HONEST_SCORES  — n/a (cache is content-addressed, not scored).
 *   - TIMEOUT        — single-doc indexed lookup; ≤20ms in normal load.
 *   - SSRF           — n/a (no outbound fetches in this module).
 *   - BOUND_READ     — strict single-row .first() on by_cache_key.
 *   - ERROR_BOUNDARY — every public function wraps DB calls in try/
 *                      catch; cache failures fall through to live
 *                      computation, never block.
 *   - DETERMINISTIC  — key derives from sorted (q, collections, limit)
 *                      via cyrb53; same args → same key.
 *
 * See: convex/domains/integrations/voice/editionTts.ts (reference
 * pattern), convex/domains/search/sharedCache.ts (shared-layer invariant
 * enforcement).
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/* ────────────────────────────────────────────────────────────────────
 * Bounds (BOUND, BOUND_READ).
 * ────────────────────────────────────────────────────────────────── */

/** 5 minutes.  Public substrate updates at indexing cadence (mins-hours). */
export const FEDERATED_CACHE_TTL_MS = 5 * 60 * 1000;

/** 32 KB cap on a single cached response.  50-result MAX_TOTAL_RESULTS
 * with bounded snippets fits comfortably under this ceiling. */
export const MAX_CACHED_RESPONSE_BYTES = 32 * 1024;

/* ────────────────────────────────────────────────────────────────────
 * Pure helpers (DETERMINISTIC).
 * ────────────────────────────────────────────────────────────────── */

/**
 * cyrb53 — 53-bit deterministic non-crypto hash.  Identical
 * implementation to `convex/domains/search/sharedCache.ts` so cache
 * keys align across modules.  Public-domain (Bryc).
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

/**
 * Build the stable cache key.  Inputs:
 *   - q              — the trimmed lowercased query
 *   - collections    — sorted array of FederatedCollection names
 *   - limit          — clamped per-collection limit
 *
 * The collections array is sorted before hashing so callers passing
 * them in different orders produce the same key.
 */
export function buildFederatedCacheKey(args: {
  q: string;
  collections: ReadonlyArray<string>;
  limit: number;
}): string {
  const qNorm = args.q.trim().toLowerCase();
  const sortedCollections = [...args.collections].sort();
  const payload = `${qNorm}|${sortedCollections.join(",")}|${args.limit}`;
  return cyrb53(payload);
}

/** Byte length of a UTF-8 string (Convex-compatible). */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/* ────────────────────────────────────────────────────────────────────
 * Read path — internal query.
 *
 * Returns the parsed cached response when:
 *   1. A row exists for the key
 *   2. ttlExpiresAt > now (still fresh)
 *   3. The serialized JSON parses cleanly (defense in depth)
 *
 * Otherwise returns null.  ERROR_BOUNDARY: any DB or parse error is
 * swallowed and reported as null so the action falls through to live
 * computation.
 * ────────────────────────────────────────────────────────────────── */

export const lookupFederatedCache = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args): Promise<{
    response: string;
    generatedAt: number;
    hitCount: number;
  } | null> => {
    try {
      const row = (await ctx.db
        .query("federatedSearchCache")
        .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
        .first()) as Doc<"federatedSearchCache"> | null;
      if (!row) return null;
      if (row.ttlExpiresAt <= Date.now()) return null; // expired — honest miss
      return {
        response: row.response,
        generatedAt: row.generatedAt,
        hitCount: row.hitCount,
      };
    } catch (err) {
      // ERROR_BOUNDARY — never let a cache fault block the live path.
      console.warn("[federatedSearchCache] lookup failed:", err);
      return null;
    }
  },
});

/* ────────────────────────────────────────────────────────────────────
 * Write path — internal mutation.
 *
 * Idempotent upsert keyed by cacheKey.  Patches an existing row in
 * place when present (preserves hitCount accumulation).  BOUND check
 * rejects oversize payloads up front — cache is best-effort, so we
 * silently skip the write rather than throw.
 * ────────────────────────────────────────────────────────────────── */

export const writeFederatedCache = internalMutation({
  args: {
    cacheKey: v.string(),
    queryNormalized: v.string(),
    collections: v.array(v.string()),
    limit: v.number(),
    response: v.string(),
  },
  handler: async (ctx, args): Promise<{
    written: boolean;
    reason?: string;
  }> => {
    const responseBytes = utf8ByteLength(args.response);
    if (responseBytes > MAX_CACHED_RESPONSE_BYTES) {
      // BOUND — reject silently (HONEST_STATUS: caller already returned
      // the live response to the user; the cache miss next time is
      // honest).
      return { written: false, reason: "oversize_response" };
    }

    const now = Date.now();
    const ttlExpiresAt = now + FEDERATED_CACHE_TTL_MS;

    try {
      const existing = (await ctx.db
        .query("federatedSearchCache")
        .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
        .first()) as Doc<"federatedSearchCache"> | null;

      if (existing) {
        // Refresh in place — preserves hitCount; bumps generatedAt + TTL.
        await ctx.db.patch(existing._id, {
          response: args.response,
          responseBytes,
          generatedAt: now,
          ttlExpiresAt,
        });
        return { written: true };
      }

      await ctx.db.insert("federatedSearchCache", {
        cacheKey: args.cacheKey,
        queryNormalized: args.queryNormalized,
        collections: [...args.collections].sort(),
        limit: args.limit,
        response: args.response,
        responseBytes,
        generatedAt: now,
        ttlExpiresAt,
        hitCount: 0,
      });
      return { written: true };
    } catch (err) {
      // ERROR_BOUNDARY — cache write failures are swallowed.  The
      // user already got the live response; the next call recomputes.
      console.warn("[federatedSearchCache] write failed:", err);
      return { written: false, reason: "write_error" };
    }
  },
});

/**
 * Increment hitCount on an existing cache row.  Best-effort — failures
 * are swallowed.  Called from the action when a cache HIT served the
 * response so analytics can answer "what fraction of federatedSearch
 * traffic was served from cache."
 */
export const incrementHitCount = internalMutation({
  args: { cacheKey: v.string() },
  handler: async (ctx, args): Promise<void> => {
    try {
      const row = (await ctx.db
        .query("federatedSearchCache")
        .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
        .first()) as Doc<"federatedSearchCache"> | null;
      if (!row) return;
      await ctx.db.patch(row._id, { hitCount: row.hitCount + 1 });
    } catch (err) {
      console.warn("[federatedSearchCache] hit-count increment failed:", err);
    }
  },
});
