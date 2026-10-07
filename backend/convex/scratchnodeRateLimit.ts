/**
 * ScratchNode public-mutation rate limiting (DB-backed fixed-window counter).
 *
 * Pattern: Fixed-window counter persisted in Convex (NOT in-memory).
 * Prior art:
 *   - Cloudflare / Stripe fixed-window rate limiters (windowStart bucketing)
 *   - OWASP API Security Top 10 (API4:2023 — Unrestricted Resource Consumption)
 *
 * WHY DB-backed and not the in-memory `server/rateLimitGuard.ts`:
 *   Convex mutations run in V8 isolates that do NOT share memory and get
 *   recycled between invocations. An in-memory Map would lose its counts on
 *   every cold isolate — a HONEST_SCORES violation (the limiter would report
 *   "allowed" while actually counting nothing). Convex OCC serializability
 *   makes the read-modify-write below atomic: a range-read that finds no row
 *   is in the txn read set, so a competing insert into the same
 *   (key, windowStart) range invalidates it → retry → exact count under burst.
 *
 * See: .claude/rules/agentic_reliability.md (BOUND, HONEST_SCORES, DETERMINISTIC)
 */
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

// Local ConvexError shim — mirrors convex/events.ts and convex/users.ts so the
// thrown error serializes to the client with `data` intact (code + retryAfterMs).
class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;
  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

export type RateLimitSpec = { key: string; limit: number; windowMs: number };

// BOUND — janitor evicts at most this many stale rows per sweep.
const MAX_RATE_LIMIT_EVICT = 500;

/**
 * Throws ConvexError({ code: "rate_limited", retryAfterMs }) when the caller has
 * exceeded `limit` actions within the current `windowMs` window for `key`.
 *
 * key convention: "<action>:<identity>"
 *   signin   -> "signin:<normalizedEmail>"
 *   join     -> "join:<sessionId>"
 *   send     -> "send:<sessionId>"
 *   hostclaim-> "hostclaim:<sessionId>"
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  { key, limit, windowMs }: RateLimitSpec,
): Promise<void> {
  const now = Date.now();
  // DETERMINISTIC — same now+windowMs always maps to the same bucket.
  const windowStart = Math.floor(now / windowMs) * windowMs;

  const existing = await ctx.db
    .query("scratchnodeRateLimits")
    .withIndex("by_key_window", (q) =>
      q.eq("key", key).eq("windowStart", windowStart),
    )
    .first();

  if (existing) {
    if (existing.count >= limit) {
      throw new ConvexError({
        code: "rate_limited",
        message: "Too many requests. Please wait a moment and try again.",
        retryAfterMs: windowStart + windowMs - now,
      });
    }
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return;
  }

  // First request in this window — OCC ensures only one insert wins; the loser
  // retries, re-reads the now-present row, and patches.
  await ctx.db.insert("scratchnodeRateLimits", {
    key,
    windowStart,
    count: 1,
    expiresAt: windowStart + windowMs,
  });
}

/**
 * Janitor — evicts expired rate-limit rows. Called by a cron every 15 min.
 * Uses the by_expiresAt index range (not a full-scan filter) and is BOUND at
 * MAX_RATE_LIMIT_EVICT rows per sweep so it never runs unbounded.
 */
export const _evictStaleRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("scratchnodeRateLimits")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(MAX_RATE_LIMIT_EVICT);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { evicted: stale.length };
  },
});
