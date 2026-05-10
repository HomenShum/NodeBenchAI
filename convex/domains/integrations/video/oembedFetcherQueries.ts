/**
 * Phase 10b — Video oEmbed cache queries.
 *
 * Split out from `oembedFetcher.ts` because that file is `"use node"`
 * (needs `node:crypto`) and Convex restricts internalQuery / public
 * query / mutation definitions to non-node modules.
 *
 * Three exported functions:
 *   - getCachedRow      (internal): action-side lookup by sha256 hash.
 *   - getCachedRowsForHashes (public): editorial-section read path —
 *     bulk-fetches cached rows for a list of URL hashes in one
 *     round-trip so the EditorialHomeSurface can render thumbnails
 *     inline without waterfalling N queries per page.
 *   - upsertOembedCacheRow (internal): writer called by the action
 *     after a (successful or failed) provider fetch.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          getCachedRowsForHashes capped at MAX_BULK_LOOKUP
 *                    (32) to keep a single editorial page render
 *                    bounded.  Exceeding it returns the first 32 only;
 *                    callers must paginate.
 *   - HONEST_STATUS  Misses return an absent map entry, NOT a fabricated
 *                    row.  The component falls back to a plain link.
 *   - DETERMINISTIC  Cache key = sha256(url) — pure hashing on the
 *                    caller side so same URL string always probes the
 *                    same row.
 */

import { internalMutation, internalQuery, query } from "../../../_generated/server";
import { v } from "convex/values";

const MAX_BULK_LOOKUP = 32;

export const getCachedRow = internalQuery({
  args: { urlHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("videoOembedCache")
      .withIndex("by_url_hash", (q) => q.eq("urlHash", args.urlHash))
      .first();
  },
});

/**
 * Public query — bulk fetch cache rows for a list of URL hashes.
 *
 * The frontend computes sha256(url) for each video URL it wants to
 * render and asks for a single batch.  Misses are silently dropped
 * from the response (the component falls back to a plain link).
 *
 * Returns an object map keyed by hash so the frontend can merge the
 * result back into its in-memory list of pulses / footnotes.
 */
export const getCachedRowsForHashes = query({
  args: {
    urlHashes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const hashes: string[] = Array.from(new Set<string>(args.urlHashes)).slice(
      0,
      MAX_BULK_LOOKUP,
    );
    const now = Date.now();
    const out: Record<
      string,
      {
        urlHash: string;
        url: string;
        provider: "youtube" | "vimeo" | "twitch" | "loom";
        thumbnailUrl: string | null;
        title: string | null;
        author: string | null;
        durationSec: number | null;
        embedUrl: string;
        fetchedAt: number;
        ttlExpiresAt: number;
        errorMessage: string | null;
        expired: boolean;
      }
    > = {};
    for (const hash of hashes) {
      const row = await ctx.db
        .query("videoOembedCache")
        .withIndex("by_url_hash", (q) => q.eq("urlHash", hash))
        .first();
      if (!row) continue;
      out[hash] = {
        urlHash: row.urlHash,
        url: row.url,
        provider: row.provider,
        thumbnailUrl: row.thumbnailUrl ?? null,
        title: row.title ?? null,
        author: row.author ?? null,
        durationSec: row.durationSec ?? null,
        embedUrl: row.embedUrl,
        fetchedAt: row.fetchedAt,
        ttlExpiresAt: row.ttlExpiresAt,
        errorMessage: row.errorMessage ?? null,
        expired: row.ttlExpiresAt <= now,
      };
    }
    return out;
  },
});

/**
 * Upsert a single cache row.  Called by the oEmbed action after a
 * successful (or failed) provider fetch.  Idempotent — same urlHash
 * always patches the same row.
 *
 * Lives here (non-`"use node"` module) because Convex restricts
 * mutations to the standard runtime; the action that calls it is in
 * `oembedFetcher.ts` (which is `"use node"` for `node:crypto`).
 */
export const upsertOembedCacheRow = internalMutation({
  args: {
    urlHash: v.string(),
    url: v.string(),
    provider: v.union(
      v.literal("youtube"),
      v.literal("vimeo"),
      v.literal("twitch"),
      v.literal("loom"),
    ),
    thumbnailUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    embedUrl: v.string(),
    fetchedAt: v.number(),
    ttlExpiresAt: v.number(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("videoOembedCache")
      .withIndex("by_url_hash", (q) => q.eq("urlHash", args.urlHash))
      .first();
    const patch = {
      urlHash: args.urlHash,
      url: args.url,
      provider: args.provider,
      thumbnailUrl: args.thumbnailUrl,
      title: args.title,
      author: args.author,
      durationSec: args.durationSec,
      embedUrl: args.embedUrl,
      fetchedAt: args.fetchedAt,
      ttlExpiresAt: args.ttlExpiresAt,
      errorMessage: args.errorMessage,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("videoOembedCache", patch);
  },
});
