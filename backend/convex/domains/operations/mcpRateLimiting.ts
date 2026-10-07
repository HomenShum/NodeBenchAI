// convex/domains/operations/mcpRateLimiting.ts
// MCP API Rate Limiting & Quota Management
//
// Implements OWASP API4: Unrestricted Resource Consumption
// - Token bucket algorithm for per-token rate limiting
// - Multiple time windows (per-minute, per-hour, per-day quotas)
// - Burst allowances for legitimate traffic spikes
// - Backpressure mechanisms (429 responses with Retry-After)
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* RATE LIMIT TYPES                                                    */
/* ------------------------------------------------------------------ */

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstAllowance?: number; // Extra tokens for burst traffic
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "minute_exceeded" | "hour_exceeded" | "day_exceeded";
  retryAfterSeconds?: number;
  quotaRemaining: {
    minute: number;
    hour: number;
    day: number;
  };
}

export interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
  capacity: number;
  refillRate: number; // tokens per second
}

/* ------------------------------------------------------------------ */
/* TOKEN BUCKET ALGORITHM                                              */
/* ------------------------------------------------------------------ */

/**
 * Refill token bucket based on elapsed time
 */
function refillBucket(
  bucket: TokenBucket,
  nowMs: number
): TokenBucket {
  const elapsedSeconds = (nowMs - bucket.lastRefillAt) / 1000;
  const tokensToAdd = elapsedSeconds * bucket.refillRate;

  return {
    ...bucket,
    tokens: Math.min(bucket.capacity, bucket.tokens + tokensToAdd),
    lastRefillAt: nowMs,
  };
}

/**
 * Try to consume N tokens from bucket
 */
function consumeTokens(
  bucket: TokenBucket,
  count: number,
  nowMs: number
): { allowed: boolean; bucket: TokenBucket; retryAfterSeconds?: number } {
  const refilled = refillBucket(bucket, nowMs);

  if (refilled.tokens >= count) {
    return {
      allowed: true,
      bucket: {
        ...refilled,
        tokens: refilled.tokens - count,
      },
    };
  }

  // Calculate retry-after based on refill rate
  const tokensNeeded = count - refilled.tokens;
  const retryAfterSeconds = Math.ceil(tokensNeeded / refilled.refillRate);

  return {
    allowed: false,
    bucket: refilled,
    retryAfterSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* RATE LIMIT ENFORCEMENT                                              */
/* ------------------------------------------------------------------ */

/**
 * Check if request is allowed under rate limits
 */
export const checkRateLimit = internalQuery({
  args: {
    tokenId: v.id("mcpApiTokens"),
    tokensToConsume: v.optional(v.number()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.union(
      v.literal("minute_exceeded"),
      v.literal("hour_exceeded"),
      v.literal("day_exceeded")
    )),
    retryAfterSeconds: v.optional(v.number()),
    quotaRemaining: v.object({
      minute: v.number(),
      hour: v.number(),
      day: v.number(),
    }),
  }),
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) {
      return {
        allowed: false,
        reason: "minute_exceeded",
        quotaRemaining: { minute: 0, hour: 0, day: 0 },
      };
    }

    const nowMs = Date.now();
    const tokensToConsume = args.tokensToConsume ?? 1;

    // Get or create rate limit buckets
    const buckets = await ctx.db
      .query("mcpRateLimitBuckets")
      .withIndex("by_token", (q) => q.eq("tokenId", args.tokenId))
      .first();

    const config = token.rateLimit;
    if (!config) {
      // No rate limits configured - allow
      return {
        allowed: true,
        quotaRemaining: {
          minute: Infinity,
          hour: Infinity,
          day: Infinity,
        },
      };
    }

    // Initialize buckets if not exist
    const minuteBucket: TokenBucket = buckets?.minuteBucket ?? {
      tokens: config.requestsPerMinute,
      lastRefillAt: nowMs,
      capacity: config.requestsPerMinute + (config.burstAllowance ?? 0),
      refillRate: config.requestsPerMinute / 60, // per second
    };

    const hourBucket: TokenBucket = buckets?.hourBucket ?? {
      tokens: config.requestsPerHour,
      lastRefillAt: nowMs,
      capacity: config.requestsPerHour,
      refillRate: config.requestsPerHour / 3600, // per second
    };

    const dayBucket: TokenBucket = buckets?.dayBucket ?? {
      tokens: config.requestsPerDay,
      lastRefillAt: nowMs,
      capacity: config.requestsPerDay,
      refillRate: config.requestsPerDay / 86400, // per second
    };

    // Try to consume from each bucket
    const minuteResult = consumeTokens(minuteBucket, tokensToConsume, nowMs);
    if (!minuteResult.allowed) {
      return {
        allowed: false,
        reason: "minute_exceeded",
        retryAfterSeconds: minuteResult.retryAfterSeconds,
        quotaRemaining: {
          minute: Math.floor(minuteResult.bucket.tokens),
          hour: Math.floor(hourBucket.tokens),
          day: Math.floor(dayBucket.tokens),
        },
      };
    }

    const hourResult = consumeTokens(hourBucket, tokensToConsume, nowMs);
    if (!hourResult.allowed) {
      return {
        allowed: false,
        reason: "hour_exceeded",
        retryAfterSeconds: hourResult.retryAfterSeconds,
        quotaRemaining: {
          minute: Math.floor(minuteResult.bucket.tokens),
          hour: Math.floor(hourResult.bucket.tokens),
          day: Math.floor(dayBucket.tokens),
        },
      };
    }

    const dayResult = consumeTokens(dayBucket, tokensToConsume, nowMs);
    if (!dayResult.allowed) {
      return {
        allowed: false,
        reason: "day_exceeded",
        retryAfterSeconds: dayResult.retryAfterSeconds,
        quotaRemaining: {
          minute: Math.floor(minuteResult.bucket.tokens),
          hour: Math.floor(hourResult.bucket.tokens),
          day: Math.floor(dayResult.bucket.tokens),
        },
      };
    }

    // All buckets allow - update state
    // Note: State update happens in separate mutation

    return {
      allowed: true,
      quotaRemaining: {
        minute: Math.floor(minuteResult.bucket.tokens),
        hour: Math.floor(hourResult.bucket.tokens),
        day: Math.floor(dayResult.bucket.tokens),
      },
    };
  },
});

/**
 * Update rate limit buckets after consumption
 */
export const updateRateLimitBuckets = internalMutation({
  args: {
    tokenId: v.id("mcpApiTokens"),
    minuteBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),
    hourBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),
    dayBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpRateLimitBuckets")
      .withIndex("by_token", (q) => q.eq("tokenId", args.tokenId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        minuteBucket: args.minuteBucket,
        hourBucket: args.hourBucket,
        dayBucket: args.dayBucket,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("mcpRateLimitBuckets", {
        tokenId: args.tokenId,
        minuteBucket: args.minuteBucket,
        hourBucket: args.hourBucket,
        dayBucket: args.dayBucket,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});

/* ------------------------------------------------------------------ */
/* QUOTA MONITORING                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get current quota usage for a token
 */
export const getQuotaUsage = query({
  args: {
    tokenId: v.id("mcpApiTokens"),
  },
  returns: v.object({
    tokenId: v.id("mcpApiTokens"),
    quotaRemaining: v.object({
      minute: v.number(),
      hour: v.number(),
      day: v.number(),
    }),
    quotaLimit: v.object({
      minute: v.number(),
      hour: v.number(),
      day: v.number(),
    }),
    utilizationPercent: v.object({
      minute: v.number(),
      hour: v.number(),
      day: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) {
      throw new Error("Token not found");
    }

    const buckets = await ctx.db
      .query("mcpRateLimitBuckets")
      .withIndex("by_token", (q) => q.eq("tokenId", args.tokenId))
      .first();

    const config = token.rateLimit;
    if (!config) {
      return {
        tokenId: args.tokenId,
        quotaRemaining: {
          minute: Infinity,
          hour: Infinity,
          day: Infinity,
        },
        quotaLimit: {
          minute: Infinity,
          hour: Infinity,
          day: Infinity,
        },
        utilizationPercent: {
          minute: 0,
          hour: 0,
          day: 0,
        },
      };
    }

    const nowMs = Date.now();

    // Refill buckets to get current state
    const minuteBucket = buckets?.minuteBucket
      ? refillBucket(buckets.minuteBucket, nowMs)
      : {
          tokens: config.requestsPerMinute,
          lastRefillAt: nowMs,
          capacity: config.requestsPerMinute,
          refillRate: config.requestsPerMinute / 60,
        };

    const hourBucket = buckets?.hourBucket
      ? refillBucket(buckets.hourBucket, nowMs)
      : {
          tokens: config.requestsPerHour,
          lastRefillAt: nowMs,
          capacity: config.requestsPerHour,
          refillRate: config.requestsPerHour / 3600,
        };

    const dayBucket = buckets?.dayBucket
      ? refillBucket(buckets.dayBucket, nowMs)
      : {
          tokens: config.requestsPerDay,
          lastRefillAt: nowMs,
          capacity: config.requestsPerDay,
          refillRate: config.requestsPerDay / 86400,
        };

    return {
      tokenId: args.tokenId,
      quotaRemaining: {
        minute: Math.floor(minuteBucket.tokens),
        hour: Math.floor(hourBucket.tokens),
        day: Math.floor(dayBucket.tokens),
      },
      quotaLimit: {
        minute: config.requestsPerMinute,
        hour: config.requestsPerHour,
        day: config.requestsPerDay,
      },
      utilizationPercent: {
        minute:
          ((config.requestsPerMinute - minuteBucket.tokens) /
            config.requestsPerMinute) *
          100,
        hour:
          ((config.requestsPerHour - hourBucket.tokens) /
            config.requestsPerHour) *
          100,
        day:
          ((config.requestsPerDay - dayBucket.tokens) / config.requestsPerDay) *
          100,
      },
    };
  },
});

/**
 * Get tokens approaching rate limits
 */
export const getHighUtilizationTokens = query({
  args: {
    thresholdPercent: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      tokenId: v.id("mcpApiTokens"),
      tokenName: v.string(),
      userId: v.string(),
      utilizationPercent: v.object({
        minute: v.number(),
        hour: v.number(),
        day: v.number(),
      }),
      quotaRemaining: v.object({
        minute: v.number(),
        hour: v.number(),
        day: v.number(),
      }),
    })
  ),
  handler: async (ctx, args) => {
    const threshold = args.thresholdPercent ?? 80;

    const allTokens = await ctx.db.query("mcpApiTokens").collect();
    const highUtilization: Array<{
      tokenId: Id<"mcpApiTokens">;
      tokenName: string;
      userId: string;
      utilizationPercent: { minute: number; hour: number; day: number };
      quotaRemaining: { minute: number; hour: number; day: number };
    }> = [];

    const nowMs = Date.now();

    for (const token of allTokens) {
      if (!token.rateLimit) continue;

      const buckets = await ctx.db
        .query("mcpRateLimitBuckets")
        .withIndex("by_token", (q) => q.eq("tokenId", token._id))
        .first();

      if (!buckets) continue;

      const minuteBucket = refillBucket(buckets.minuteBucket, nowMs);
      const hourBucket = refillBucket(buckets.hourBucket, nowMs);
      const dayBucket = refillBucket(buckets.dayBucket, nowMs);

      const minuteUtil =
        ((token.rateLimit.requestsPerMinute - minuteBucket.tokens) /
          token.rateLimit.requestsPerMinute) *
        100;
      const hourUtil =
        ((token.rateLimit.requestsPerHour - hourBucket.tokens) /
          token.rateLimit.requestsPerHour) *
        100;
      const dayUtil =
        ((token.rateLimit.requestsPerDay - dayBucket.tokens) /
          token.rateLimit.requestsPerDay) *
        100;

      if (
        minuteUtil >= threshold ||
        hourUtil >= threshold ||
        dayUtil >= threshold
      ) {
        highUtilization.push({
          tokenId: token._id,
          tokenName: token.name,
          userId: token.userId,
          utilizationPercent: {
            minute: minuteUtil,
            hour: hourUtil,
            day: dayUtil,
          },
          quotaRemaining: {
            minute: Math.floor(minuteBucket.tokens),
            hour: Math.floor(hourBucket.tokens),
            day: Math.floor(dayBucket.tokens),
          },
        });
      }
    }

    return highUtilization;
  },
});

/* ------------------------------------------------------------------ */
/* ADAPTIVE RATE LIMITING (Future Enhancement)                        */
/* ------------------------------------------------------------------ */

/**
 * Adjust rate limits based on system load
 * (Not implemented - placeholder for future adaptive limits)
 */
export interface AdaptiveRateLimitConfig {
  enabled: boolean;
  baseConfig: RateLimitConfig;
  scalingFactors: {
    systemLoad: number; // 0.5 = half rate when system load high
    timeOfDay: number; // 0.8 = 80% rate during peak hours
  };
}

/**
 * Calculate retry-after header value
 */
export function calculateRetryAfter(result: RateLimitResult): number {
  return result.retryAfterSeconds ?? 60;
}

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */
// Types are exported inline above.
