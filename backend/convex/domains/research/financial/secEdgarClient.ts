// convex/domains/financial/secEdgarClient.ts
// SEC EDGAR API Client with Adaptive Rate Limiting
//
// SEC Policy: https://www.sec.gov/developer
// - Required: User-Agent with company name and contact email
// - Rate limit: Max 10 requests per second, avoid bursts
// - Accept 429 responses gracefully with exponential backoff
//
// Features:
// - Circuit breaker pattern for fault tolerance
// - Adaptive backoff respecting Retry-After headers
// - Aggressive caching with content-hash deduplication
// - Full request/response logging for debugging

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

// SEC requires a descriptive User-Agent with contact info
const SEC_USER_AGENT = "NodeBench AI (contact@nodebench.ai)";

// SEC data endpoints
const SEC_DATA_BASE = "https://data.sec.gov";
const SEC_FILES_BASE = "https://www.sec.gov/files";

// Rate limiting configuration (SEC-spec aware)
const SEC_RATE_LIMIT = {
  // Per SEC guidance: max 10 req/sec, but we're conservative
  maxRequestsPerMinute: 30,       // 0.5 req/sec average
  minDelayBetweenRequestsMs: 200, // At least 200ms between requests

  // Backoff configuration
  backoffBaseMs: 1000,
  backoffMaxMs: 120000,           // Max 2 minutes backoff
  backoffMultiplier: 2,

  // Circuit breaker configuration
  failureThreshold: 5,            // Open circuit after 5 failures
  successThreshold: 2,            // Close circuit after 2 successes in half-open
  windowDurationMs: 60000,        // 1 minute failure window
  openDurationMs: 30000,          // Stay open for 30 seconds

  // Cache configuration
  cacheTtlMs: 4 * 60 * 60 * 1000, // 4 hours default TTL
  tickerCacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours for ticker->CIK mapping
};

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    "dei"?: Record<string, FactConcept>;
    "us-gaap"?: Record<string, FactConcept>;
    "ifrs-full"?: Record<string, FactConcept>;
  };
}

export interface FactConcept {
  label: string;
  description: string;
  units: Record<string, FactUnit[]>;
}

export interface FactUnit {
  start?: string;  // Period start date
  end: string;     // Period end date (or instant for point-in-time)
  val: number;     // The value
  accn: string;    // Accession number
  fy: number;      // Fiscal year
  fp: string;      // Fiscal period (FY, Q1, Q2, Q3, Q4)
  form: string;    // Form type (10-K, 10-Q, etc.)
  filed: string;   // Filing date
  frame?: string;  // Frame identifier (e.g., CY2023Q4I)
}

export interface CompanySubmissions {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  fiscalYearEnd: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

interface FetchResult {
  ok: boolean;
  data?: any;
  error?: string;
  statusCode: number;
  retryAfterSec?: number;
  headers?: Record<string, string>;
}

type CircuitBreakerState = "closed" | "open" | "half_open";

/* ------------------------------------------------------------------ */
/* UTILITY FUNCTIONS                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute SHA-256 hash of content for deduplication
 */
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate cache key from endpoint URL
 */
function generateCacheKey(url: string): string {
  // Normalize the URL and create a deterministic key
  return url.toLowerCase().replace(/https?:\/\//, "").replace(/[^a-z0-9]/g, "_");
}

/* ------------------------------------------------------------------ */
/* CIRCUIT BREAKER MUTATIONS                                           */
/* ------------------------------------------------------------------ */

/**
 * Get or initialize circuit breaker state
 */
export const getCircuitBreakerState = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("secApiCircuitBreaker"),
      state: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")),
      consecutiveFailures: v.number(),
      totalFailuresInWindow: v.number(),
      windowStartTimestamp: v.number(),
      lastRateLimitTimestamp: v.optional(v.number()),
      retryAfterUntil: v.optional(v.number()),
      currentBackoffMs: v.number(),
      maxBackoffMs: v.number(),
      openedAt: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      halfOpenAt: v.optional(v.number()),
      failureThreshold: v.number(),
      successThreshold: v.number(),
      windowDurationMs: v.number(),
      openDurationMs: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const state = await ctx.db.query("secApiCircuitBreaker").first();
    return state;
  },
});

/**
 * Initialize or reset circuit breaker to default state
 */
export const initCircuitBreaker = internalMutation({
  args: {},
  returns: v.id("secApiCircuitBreaker"),
  handler: async (ctx) => {
    // Check if already exists
    const existing = await ctx.db.query("secApiCircuitBreaker").first();
    if (existing) {
      return existing._id;
    }

    // Create new with default configuration
    const now = Date.now();
    return await ctx.db.insert("secApiCircuitBreaker", {
      state: "closed",
      consecutiveFailures: 0,
      totalFailuresInWindow: 0,
      windowStartTimestamp: now,
      currentBackoffMs: SEC_RATE_LIMIT.backoffBaseMs,
      maxBackoffMs: SEC_RATE_LIMIT.backoffMaxMs,
      failureThreshold: SEC_RATE_LIMIT.failureThreshold,
      successThreshold: SEC_RATE_LIMIT.successThreshold,
      windowDurationMs: SEC_RATE_LIMIT.windowDurationMs,
      openDurationMs: SEC_RATE_LIMIT.openDurationMs,
      closedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Record a successful request - may close circuit
 */
export const recordSuccess = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db.query("secApiCircuitBreaker").first();
    if (!state) return null;

    const now = Date.now();

    if (state.state === "half_open") {
      // In half-open, track successes toward closing
      const consecutiveSuccesses = state.consecutiveFailures < 0
        ? Math.abs(state.consecutiveFailures) + 1
        : 1;

      if (consecutiveSuccesses >= state.successThreshold) {
        // Close the circuit
        await ctx.db.patch(state._id, {
          state: "closed",
          consecutiveFailures: 0,
          totalFailuresInWindow: 0,
          windowStartTimestamp: now,
          currentBackoffMs: SEC_RATE_LIMIT.backoffBaseMs,
          closedAt: now,
          updatedAt: now,
        });
      } else {
        // Track success (negative = tracking successes in half-open)
        await ctx.db.patch(state._id, {
          consecutiveFailures: -consecutiveSuccesses,
          updatedAt: now,
        });
      }
    } else {
      // In closed state, just reset failure count
      await ctx.db.patch(state._id, {
        consecutiveFailures: 0,
        currentBackoffMs: SEC_RATE_LIMIT.backoffBaseMs,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Record a failure - may open circuit
 */
export const recordFailure = internalMutation({
  args: {
    isRateLimited: v.boolean(),
    retryAfterSec: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({
    newState: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")),
    backoffMs: v.number(),
    retryAfterUntil: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    let state = await ctx.db.query("secApiCircuitBreaker").first();
    const now = Date.now();

    // Initialize if needed
    if (!state) {
      const id = await ctx.db.insert("secApiCircuitBreaker", {
        state: "closed",
        consecutiveFailures: 1,
        totalFailuresInWindow: 1,
        windowStartTimestamp: now,
        currentBackoffMs: SEC_RATE_LIMIT.backoffBaseMs,
        maxBackoffMs: SEC_RATE_LIMIT.backoffMaxMs,
        failureThreshold: SEC_RATE_LIMIT.failureThreshold,
        successThreshold: SEC_RATE_LIMIT.successThreshold,
        windowDurationMs: SEC_RATE_LIMIT.windowDurationMs,
        openDurationMs: SEC_RATE_LIMIT.openDurationMs,
        lastRateLimitTimestamp: args.isRateLimited ? now : undefined,
        retryAfterUntil: args.retryAfterSec ? now + args.retryAfterSec * 1000 : undefined,
        updatedAt: now,
      });
      state = (await ctx.db.get(id))!;
    }

    // Reset window if expired
    let failuresInWindow = state.totalFailuresInWindow;
    let windowStart = state.windowStartTimestamp;
    if (now - windowStart > state.windowDurationMs) {
      failuresInWindow = 0;
      windowStart = now;
    }
    failuresInWindow++;

    // Calculate new backoff with exponential increase
    const newBackoffMs = Math.min(
      state.maxBackoffMs,
      state.currentBackoffMs * SEC_RATE_LIMIT.backoffMultiplier
    );

    // If rate limited, use Retry-After if provided
    let retryAfterUntil = state.retryAfterUntil;
    if (args.isRateLimited && args.retryAfterSec) {
      retryAfterUntil = now + args.retryAfterSec * 1000;
    }

    const newConsecutiveFailures = Math.max(1, state.consecutiveFailures + 1);

    // Determine if we should open the circuit
    let newState: CircuitBreakerState = state.state;
    let openedAt = state.openedAt;

    if (state.state === "closed" && newConsecutiveFailures >= state.failureThreshold) {
      newState = "open";
      openedAt = now;
      console.warn(`[secEdgarClient] Circuit breaker OPENED after ${newConsecutiveFailures} failures`);
    } else if (state.state === "half_open") {
      // Any failure in half-open reopens the circuit
      newState = "open";
      openedAt = now;
      console.warn(`[secEdgarClient] Circuit breaker REOPENED from half-open`);
    }

    await ctx.db.patch(state._id, {
      state: newState,
      consecutiveFailures: newConsecutiveFailures,
      totalFailuresInWindow: failuresInWindow,
      windowStartTimestamp: windowStart,
      currentBackoffMs: newBackoffMs,
      lastRateLimitTimestamp: args.isRateLimited ? now : state.lastRateLimitTimestamp,
      retryAfterUntil,
      openedAt: newState === "open" ? openedAt : state.openedAt,
      updatedAt: now,
    });

    return {
      newState,
      backoffMs: newBackoffMs,
      retryAfterUntil,
    };
  },
});

/**
 * Check if we can make a request (circuit breaker + rate limit check)
 */
export const canMakeRequest = internalQuery({
  args: {},
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
    circuitState: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open")),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const state = await ctx.db.query("secApiCircuitBreaker").first();

    // Default to allowing if no circuit breaker state exists
    if (!state) {
      return { allowed: true, circuitState: "closed" as const };
    }

    // Check circuit breaker state
    if (state.state === "open") {
      const timeInOpen = now - (state.openedAt || now);
      if (timeInOpen < state.openDurationMs) {
        return {
          allowed: false,
          reason: "Circuit breaker is open",
          retryAfterMs: state.openDurationMs - timeInOpen,
          circuitState: "open" as const,
        };
      }
      // Time to try half-open
      return { allowed: true, circuitState: "half_open" as const };
    }

    // Check Retry-After from previous 429
    if (state.retryAfterUntil && now < state.retryAfterUntil) {
      return {
        allowed: false,
        reason: "Respecting Retry-After header from SEC",
        retryAfterMs: state.retryAfterUntil - now,
        circuitState: state.state,
      };
    }

    // Check rate limit (requests in last minute)
    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = await ctx.db
      .query("secApiRateLimits")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", oneMinuteAgo))
      .collect();

    if (recentRequests.length >= SEC_RATE_LIMIT.maxRequestsPerMinute) {
      const oldestTimestamp = Math.min(...recentRequests.map((r) => r.timestamp));
      const retryAfterMs = oldestTimestamp + 60 * 1000 - now;
      return {
        allowed: false,
        reason: `Rate limit reached (${recentRequests.length}/${SEC_RATE_LIMIT.maxRequestsPerMinute} requests/min)`,
        retryAfterMs: Math.max(0, retryAfterMs),
        circuitState: state.state,
      };
    }

    return { allowed: true, circuitState: state.state };
  },
});

/**
 * Transition circuit breaker to half-open state
 */
export const transitionToHalfOpen = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db.query("secApiCircuitBreaker").first();
    if (!state || state.state !== "open") return null;

    await ctx.db.patch(state._id, {
      state: "half_open",
      consecutiveFailures: 0, // Reset to track successes
      halfOpenAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`[secEdgarClient] Circuit breaker transitioned to HALF_OPEN`);
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* RATE LIMIT TRACKING                                                 */
/* ------------------------------------------------------------------ */

/**
 * Record an SEC API request for rate limiting with enhanced tracking
 */
export const recordSecRequest = internalMutation({
  args: {
    endpoint: v.string(),
    statusCode: v.number(),
    latencyMs: v.number(),
    retryAfterSec: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("secApiRateLimits", {
      endpoint: args.endpoint,
      timestamp: Date.now(),
      statusCode: args.statusCode,
      latencyMs: args.latencyMs,
      retryAfterSec: args.retryAfterSec,
      isRateLimited: args.statusCode === 429,
      errorMessage: args.errorMessage,
    });
    return null;
  },
});

/**
 * Check if we can make an SEC API request (rate limit check)
 */
export const checkSecRateLimit = internalQuery({
  args: {},
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
    recentCount: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Count recent requests
    const recentRequests = await ctx.db
      .query("secApiRateLimits")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", oneMinuteAgo))
      .collect();

    if (recentRequests.length >= SEC_RATE_LIMIT.maxRequestsPerMinute) {
      // Find when the oldest request will expire
      const oldestTimestamp = Math.min(...recentRequests.map((r) => r.timestamp));
      const retryAfterMs = oldestTimestamp + 60 * 1000 - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, retryAfterMs),
        recentCount: recentRequests.length,
      };
    }

    return { allowed: true, recentCount: recentRequests.length };
  },
});

/**
 * Get last request timestamp (for enforcing minimum delay)
 */
export const getLastSecRequestTime = internalQuery({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => {
    const lastRequest = await ctx.db
      .query("secApiRateLimits")
      .withIndex("by_timestamp")
      .order("desc")
      .first();
    return lastRequest?.timestamp ?? null;
  },
});

/* ------------------------------------------------------------------ */
/* RESPONSE CACHE                                                      */
/* ------------------------------------------------------------------ */

/**
 * Check cache for a response
 */
export const checkCache = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("secApiResponseCache"),
      artifactId: v.id("sourceArtifacts"),
      fetchedAt: v.number(),
      expiresAt: v.number(),
      hitCount: v.number(),
      isExpired: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("secApiResponseCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (!cached) return null;

    const now = Date.now();
    return {
      _id: cached._id,
      artifactId: cached.artifactId,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
      hitCount: cached.hitCount,
      isExpired: now > cached.expiresAt,
    };
  },
});

/**
 * Update cache entry (upsert)
 */
export const upsertCache = internalMutation({
  args: {
    endpoint: v.string(),
    cacheKey: v.string(),
    responseHash: v.string(),
    artifactId: v.id("sourceArtifacts"),
    ttlMs: v.optional(v.number()),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
  },
  returns: v.id("secApiResponseCache"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttl = args.ttlMs ?? SEC_RATE_LIMIT.cacheTtlMs;
    const expiresAt = now + ttl;

    // Check for existing entry
    const existing = await ctx.db
      .query("secApiResponseCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        responseHash: args.responseHash,
        artifactId: args.artifactId,
        fetchedAt: now,
        expiresAt,
        etag: args.etag,
        lastModified: args.lastModified,
      });
      return existing._id;
    }

    return await ctx.db.insert("secApiResponseCache", {
      endpoint: args.endpoint,
      cacheKey: args.cacheKey,
      responseHash: args.responseHash,
      artifactId: args.artifactId,
      fetchedAt: now,
      expiresAt,
      hitCount: 0,
      etag: args.etag,
      lastModified: args.lastModified,
    });
  },
});

/**
 * Increment cache hit count
 */
export const incrementCacheHit = internalMutation({
  args: {
    cacheId: v.id("secApiResponseCache"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cached = await ctx.db.get(args.cacheId);
    if (cached) {
      await ctx.db.patch(args.cacheId, {
        hitCount: cached.hitCount + 1,
      });
    }
    return null;
  },
});

/**
 * Get cache validators (ETag, Last-Modified) for conditional requests
 */
export const getCacheValidators = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      etag: v.optional(v.string()),
      lastModified: v.optional(v.string()),
      artifactId: v.id("sourceArtifacts"),
    })
  ),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("secApiResponseCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (!cached) return null;

    return {
      etag: cached.etag,
      lastModified: cached.lastModified,
      artifactId: cached.artifactId,
    };
  },
});

/**
 * Extend cache TTL when 304 Not Modified received
 */
export const extendCacheTtl = internalMutation({
  args: {
    cacheKey: v.string(),
    ttlMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("secApiResponseCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();

    if (cached) {
      const ttl = args.ttlMs ?? SEC_RATE_LIMIT.cacheTtlMs;
      await ctx.db.patch(cached._id, {
        fetchedAt: Date.now(),
        expiresAt: Date.now() + ttl,
        hitCount: cached.hitCount + 1,
      });
    }
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* SEC API FETCH HELPERS                                               */
/* ------------------------------------------------------------------ */

/**
 * Fetch from SEC API with proper headers, error handling, and Retry-After respect
 */
async function fetchFromSec(
  url: string,
  options?: { maxRetries?: number; etag?: string; lastModified?: string }
): Promise<FetchResult> {
  const maxRetries = options?.maxRetries ?? 3;
  let lastError = "";
  let lastStatusCode = 0;
  let currentBackoff = SEC_RATE_LIMIT.backoffBaseMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        "User-Agent": SEC_USER_AGENT,
        "Accept": "application/json",
      };

      // Add conditional headers for cache validation
      if (options?.etag) {
        headers["If-None-Match"] = options.etag;
      }
      if (options?.lastModified) {
        headers["If-Modified-Since"] = options.lastModified;
      }

      const response = await fetch(url, { headers });
      lastStatusCode = response.status;

      // Extract headers for caching
      const responseHeaders: Record<string, string> = {};
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      if (etag) responseHeaders["etag"] = etag;
      if (lastModified) responseHeaders["lastModified"] = lastModified;

      if (response.status === 304) {
        // Not Modified - cache is still valid
        return { ok: true, statusCode: 304, headers: responseHeaders };
      }

      if (response.status === 429) {
        // Rate limited - extract Retry-After and backoff
        const retryAfterHeader = response.headers.get("Retry-After");
        let retryAfterSec: number | undefined;

        if (retryAfterHeader) {
          // Could be seconds or HTTP date
          const parsed = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsed)) {
            retryAfterSec = parsed;
          } else {
            // Try parsing as HTTP date
            const date = new Date(retryAfterHeader);
            if (!isNaN(date.getTime())) {
              retryAfterSec = Math.ceil((date.getTime() - Date.now()) / 1000);
            }
          }
        }

        // Use Retry-After if provided, otherwise exponential backoff
        const backoff = retryAfterSec
          ? retryAfterSec * 1000
          : Math.min(SEC_RATE_LIMIT.backoffMaxMs, currentBackoff);

        console.warn(
          `[secEdgarClient] Rate limited (429), Retry-After: ${retryAfterSec ?? "not provided"}, backing off ${backoff}ms`
        );

        await new Promise((resolve) => setTimeout(resolve, backoff));
        currentBackoff = Math.min(SEC_RATE_LIMIT.backoffMaxMs, currentBackoff * SEC_RATE_LIMIT.backoffMultiplier);

        return {
          ok: false,
          error: "Rate limited",
          statusCode: 429,
          retryAfterSec,
        };
      }

      if (response.status === 404) {
        return { ok: false, error: "Resource not found", statusCode: 404 };
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        currentBackoff = Math.min(SEC_RATE_LIMIT.backoffMaxMs, currentBackoff * SEC_RATE_LIMIT.backoffMultiplier);
        await new Promise((resolve) => setTimeout(resolve, currentBackoff));
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return {
          ok: false,
          error: `Unexpected content type: ${contentType}`,
          statusCode: response.status,
        };
      }

      const data = await response.json();
      return { ok: true, data, statusCode: response.status, headers: responseHeaders };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastStatusCode = 0;
      currentBackoff = Math.min(SEC_RATE_LIMIT.backoffMaxMs, currentBackoff * SEC_RATE_LIMIT.backoffMultiplier);
      await new Promise((resolve) => setTimeout(resolve, currentBackoff));
    }
  }

  return { ok: false, error: lastError, statusCode: lastStatusCode };
}

/* ------------------------------------------------------------------ */
/* CIK LOOKUP                                                          */
/* ------------------------------------------------------------------ */

// In-memory cache for ticker to CIK mapping (populated on first use)
let tickerToCikCache: Map<string, { cik: string; name: string }> | null = null;
let cacheLoadTime: number = 0;

/**
 * Look up CIK from ticker using SEC's company_tickers.json
 */
export const lookupCikByTicker = internalAction({
  args: {
    ticker: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    cik: v.optional(v.string()),
    companyName: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Check circuit breaker first
    const canRequest = await ctx.runQuery(internal.domains.financial.secEdgarClient.canMakeRequest, {});
    if (!canRequest.allowed) {
      return { ok: false, error: `${canRequest.reason}. Retry after ${canRequest.retryAfterMs}ms` };
    }

    // If circuit is half-open, transition to half-open state
    if (canRequest.circuitState === "half_open") {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.transitionToHalfOpen, {});
    }

    // Check if we need to refresh the in-memory cache
    const now = Date.now();
    if (!tickerToCikCache || now - cacheLoadTime > SEC_RATE_LIMIT.tickerCacheTtlMs) {
      const start = Date.now();
      const result = await fetchFromSec(`${SEC_FILES_BASE}/company_tickers.json`);

      // Record the request
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSecRequest, {
        endpoint: "company_tickers.json",
        statusCode: result.statusCode,
        latencyMs: Date.now() - start,
        retryAfterSec: result.retryAfterSec,
        errorMessage: result.ok ? undefined : result.error,
      });

      if (!result.ok) {
        // Record failure in circuit breaker
        await ctx.runMutation(internal.domains.financial.secEdgarClient.recordFailure, {
          isRateLimited: result.statusCode === 429,
          retryAfterSec: result.retryAfterSec,
          errorMessage: result.error,
        });
        return { ok: false, error: result.error };
      }

      // Record success
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSuccess, {});

      // Build the cache
      tickerToCikCache = new Map();
      const tickersData = result.data;
      for (const key of Object.keys(tickersData)) {
        const company = tickersData[key];
        if (company.ticker && company.cik_str) {
          tickerToCikCache.set(company.ticker.toUpperCase(), {
            cik: String(company.cik_str),
            name: company.title,
          });
        }
      }
      cacheLoadTime = now;
    }

    // Look up in cache
    const entry = tickerToCikCache.get(tickerUpper);
    if (!entry) {
      return { ok: false, error: `Ticker not found: ${args.ticker}` };
    }

    return { ok: true, cik: entry.cik, companyName: entry.name };
  },
});

/* ------------------------------------------------------------------ */
/* COMPANY FACTS (XBRL) - WITH CACHING                                 */
/* ------------------------------------------------------------------ */

/**
 * Fetch company facts (XBRL data) from SEC EDGAR with caching
 * This is the primary endpoint for financial fundamentals
 */
export const fetchCompanyFacts = internalAction({
  args: {
    ticker: v.optional(v.string()),
    cik: v.optional(v.string()),
    skipCache: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    facts: v.optional(v.any()),
    cik: v.optional(v.string()),
    entityName: v.optional(v.string()),
    artifactId: v.optional(v.id("sourceArtifacts")),
    fromCache: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Resolve CIK
    let cik = args.cik;
    if (!cik && args.ticker) {
      const lookup = await ctx.runAction(
        internal.domains.financial.secEdgarClient.lookupCikByTicker,
        { ticker: args.ticker }
      );
      if (!lookup.ok) {
        return { ok: false, error: lookup.error };
      }
      cik = lookup.cik;
    }

    if (!cik) {
      return { ok: false, error: "Either ticker or cik must be provided" };
    }

    // Pad CIK to 10 digits
    const paddedCik = cik.padStart(10, "0");
    const url = `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${paddedCik}.json`;
    const cacheKey = generateCacheKey(url);

    // Check cache first (unless skipCache)
    let cachedEtag: string | undefined;
    let cachedLastModified: string | undefined;

    if (!args.skipCache) {
      const cached = await ctx.runQuery(
        internal.domains.financial.secEdgarClient.checkCache,
        { cacheKey }
      );

      if (cached) {
        // Get cached artifact and conditional headers
        const artifact = await ctx.runQuery(
          internal.domains.artifacts.sourceArtifacts.getArtifactById,
          { artifactId: cached.artifactId }
        );

        if (!cached.isExpired && artifact && artifact.rawContent) {
          // Fresh cache hit - return immediately
          await ctx.runMutation(
            internal.domains.financial.secEdgarClient.incrementCacheHit,
            { cacheId: cached._id }
          );

          const facts = JSON.parse(artifact.rawContent) as CompanyFacts;
          return {
            ok: true,
            facts: facts.facts,
            cik: paddedCik,
            entityName: facts.entityName,
            artifactId: cached.artifactId,
            fromCache: true,
          };
        }

        // Stale cache - try conditional request with ETag/Last-Modified
        const cacheDetails = await ctx.runQuery(
          internal.domains.financial.secEdgarClient.getCacheValidators,
          { cacheKey }
        );
        cachedEtag = cacheDetails?.etag;
        cachedLastModified = cacheDetails?.lastModified;
      }
    }

    // Check circuit breaker
    const canRequest = await ctx.runQuery(internal.domains.financial.secEdgarClient.canMakeRequest, {});
    if (!canRequest.allowed) {
      return { ok: false, error: `${canRequest.reason}. Retry after ${canRequest.retryAfterMs}ms` };
    }

    // If circuit is half-open, transition
    if (canRequest.circuitState === "half_open") {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.transitionToHalfOpen, {});
    }

    // Enforce minimum delay between requests
    const lastRequest = await ctx.runQuery(
      internal.domains.financial.secEdgarClient.getLastSecRequestTime,
      {}
    );
    if (lastRequest) {
      const timeSinceLast = Date.now() - lastRequest;
      if (timeSinceLast < SEC_RATE_LIMIT.minDelayBetweenRequestsMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, SEC_RATE_LIMIT.minDelayBetweenRequestsMs - timeSinceLast)
        );
      }
    }

    // Fetch from SEC (with conditional headers if available)
    const start = Date.now();
    const result = await fetchFromSec(url, {
      etag: cachedEtag,
      lastModified: cachedLastModified,
    });

    // Record the request
    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSecRequest, {
      endpoint: `companyfacts/CIK${paddedCik}`,
      statusCode: result.statusCode,
      latencyMs: Date.now() - start,
      retryAfterSec: result.retryAfterSec,
      errorMessage: result.ok ? undefined : result.error,
    });

    // Handle 304 Not Modified - cache is still valid
    if (result.statusCode === 304) {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSuccess, {});

      // Extend cache TTL
      await ctx.runMutation(internal.domains.financial.secEdgarClient.extendCacheTtl, {
        cacheKey,
      });

      // Return cached data
      const cacheDetails = await ctx.runQuery(
        internal.domains.financial.secEdgarClient.getCacheValidators,
        { cacheKey }
      );
      if (cacheDetails) {
        const artifact = await ctx.runQuery(
          internal.domains.artifacts.sourceArtifacts.getArtifactById,
          { artifactId: cacheDetails.artifactId }
        );
        if (artifact && artifact.rawContent) {
          const facts = JSON.parse(artifact.rawContent) as CompanyFacts;
          return {
            ok: true,
            facts: facts.facts,
            cik: paddedCik,
            entityName: facts.entityName,
            artifactId: cacheDetails.artifactId,
            fromCache: true,
          };
        }
      }
    }

    if (!result.ok) {
      // Record failure in circuit breaker
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordFailure, {
        isRateLimited: result.statusCode === 429,
        retryAfterSec: result.retryAfterSec,
        errorMessage: result.error,
      });
      return { ok: false, error: result.error };
    }

    // Record success
    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSuccess, {});

    const facts = result.data as CompanyFacts;
    const rawContent = JSON.stringify(facts);

    // Store as source artifact for provenance
    const artifactResult = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: "api_response",
        sourceUrl: url,
        rawContent,
        extractedData: {
          source: "sec_edgar_xbrl",
          cik: paddedCik,
          entityName: facts.entityName,
          factNamespaces: Object.keys(facts.facts || {}),
          fetchedAt: Date.now(),
        },
      }
    );

    // Update cache
    const responseHash = await sha256(rawContent);
    await ctx.runMutation(internal.domains.financial.secEdgarClient.upsertCache, {
      endpoint: `companyfacts/CIK${paddedCik}`,
      cacheKey,
      responseHash,
      artifactId: artifactResult.id,
      etag: result.headers?.etag,
      lastModified: result.headers?.lastModified,
    });

    return {
      ok: true,
      facts: facts.facts,
      cik: paddedCik,
      entityName: facts.entityName,
      artifactId: artifactResult.id,
      fromCache: false,
    };
  },
});

/* ------------------------------------------------------------------ */
/* COMPANY SUBMISSIONS                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fetch company submissions (filings metadata) from SEC EDGAR
 */
export const fetchCompanySubmissions = internalAction({
  args: {
    ticker: v.optional(v.string()),
    cik: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    submissions: v.optional(v.any()),
    cik: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Resolve CIK
    let cik = args.cik;
    if (!cik && args.ticker) {
      const lookup = await ctx.runAction(
        internal.domains.financial.secEdgarClient.lookupCikByTicker,
        { ticker: args.ticker }
      );
      if (!lookup.ok) {
        return { ok: false, error: lookup.error };
      }
      cik = lookup.cik;
    }

    if (!cik) {
      return { ok: false, error: "Either ticker or cik must be provided" };
    }

    // Check circuit breaker
    const canRequest = await ctx.runQuery(internal.domains.financial.secEdgarClient.canMakeRequest, {});
    if (!canRequest.allowed) {
      return { ok: false, error: `${canRequest.reason}. Retry after ${canRequest.retryAfterMs}ms` };
    }

    // If circuit is half-open, transition
    if (canRequest.circuitState === "half_open") {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.transitionToHalfOpen, {});
    }

    // Pad CIK to 10 digits
    const paddedCik = cik.padStart(10, "0");
    const url = `${SEC_DATA_BASE}/submissions/CIK${paddedCik}.json`;

    const start = Date.now();
    const result = await fetchFromSec(url);

    // Record the request
    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSecRequest, {
      endpoint: `submissions/CIK${paddedCik}`,
      statusCode: result.statusCode,
      latencyMs: Date.now() - start,
      retryAfterSec: result.retryAfterSec,
      errorMessage: result.ok ? undefined : result.error,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordFailure, {
        isRateLimited: result.statusCode === 429,
        retryAfterSec: result.retryAfterSec,
        errorMessage: result.error,
      });
      return { ok: false, error: result.error };
    }

    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSuccess, {});

    return {
      ok: true,
      submissions: result.data,
      cik: paddedCik,
    };
  },
});

/* ------------------------------------------------------------------ */
/* COMPANY CONCEPT (Single Fact)                                       */
/* ------------------------------------------------------------------ */

/**
 * Fetch a single company concept (specific XBRL tag)
 * Useful for getting detailed history of a specific metric
 */
export const fetchCompanyConcept = internalAction({
  args: {
    ticker: v.optional(v.string()),
    cik: v.optional(v.string()),
    taxonomy: v.union(v.literal("us-gaap"), v.literal("dei"), v.literal("ifrs-full")),
    tag: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    concept: v.optional(v.any()),
    cik: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Resolve CIK
    let cik = args.cik;
    if (!cik && args.ticker) {
      const lookup = await ctx.runAction(
        internal.domains.financial.secEdgarClient.lookupCikByTicker,
        { ticker: args.ticker }
      );
      if (!lookup.ok) {
        return { ok: false, error: lookup.error };
      }
      cik = lookup.cik;
    }

    if (!cik) {
      return { ok: false, error: "Either ticker or cik must be provided" };
    }

    // Check circuit breaker
    const canRequest = await ctx.runQuery(internal.domains.financial.secEdgarClient.canMakeRequest, {});
    if (!canRequest.allowed) {
      return { ok: false, error: `${canRequest.reason}. Retry after ${canRequest.retryAfterMs}ms` };
    }

    // If circuit is half-open, transition
    if (canRequest.circuitState === "half_open") {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.transitionToHalfOpen, {});
    }

    // Pad CIK to 10 digits
    const paddedCik = cik.padStart(10, "0");
    const url = `${SEC_DATA_BASE}/api/xbrl/companyconcept/CIK${paddedCik}/${args.taxonomy}/${args.tag}.json`;

    const start = Date.now();
    const result = await fetchFromSec(url);

    // Record the request
    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSecRequest, {
      endpoint: `companyconcept/CIK${paddedCik}/${args.taxonomy}/${args.tag}`,
      statusCode: result.statusCode,
      latencyMs: Date.now() - start,
      retryAfterSec: result.retryAfterSec,
      errorMessage: result.ok ? undefined : result.error,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.domains.financial.secEdgarClient.recordFailure, {
        isRateLimited: result.statusCode === 429,
        retryAfterSec: result.retryAfterSec,
        errorMessage: result.error,
      });
      return { ok: false, error: result.error };
    }

    await ctx.runMutation(internal.domains.financial.secEdgarClient.recordSuccess, {});

    return {
      ok: true,
      concept: result.data,
      cik: paddedCik,
    };
  },
});

/* ------------------------------------------------------------------ */
/* CIRCUIT BREAKER STATUS                                              */
/* ------------------------------------------------------------------ */

/**
 * Get current circuit breaker status for monitoring
 */
export const getCircuitBreakerStatus = internalQuery({
  args: {},
  returns: v.object({
    state: v.union(v.literal("closed"), v.literal("open"), v.literal("half_open"), v.literal("not_initialized")),
    consecutiveFailures: v.number(),
    totalFailuresInWindow: v.number(),
    currentBackoffMs: v.number(),
    retryAfterUntil: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    recentRequestCount: v.number(),
    rateLimitedCount: v.number(),
  }),
  handler: async (ctx) => {
    const state = await ctx.db.query("secApiCircuitBreaker").first();

    // Get recent request stats
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentRequests = await ctx.db
      .query("secApiRateLimits")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", oneMinuteAgo))
      .collect();

    const rateLimitedCount = recentRequests.filter((r) => r.statusCode === 429).length;

    if (!state) {
      return {
        state: "not_initialized" as const,
        consecutiveFailures: 0,
        totalFailuresInWindow: 0,
        currentBackoffMs: SEC_RATE_LIMIT.backoffBaseMs,
        recentRequestCount: recentRequests.length,
        rateLimitedCount,
      };
    }

    return {
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      totalFailuresInWindow: state.totalFailuresInWindow,
      currentBackoffMs: state.currentBackoffMs,
      retryAfterUntil: state.retryAfterUntil,
      openedAt: state.openedAt,
      recentRequestCount: recentRequests.length,
      rateLimitedCount,
    };
  },
});
