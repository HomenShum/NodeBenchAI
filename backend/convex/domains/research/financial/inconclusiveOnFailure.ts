// convex/domains/financial/inconclusiveOnFailure.ts
// Inconclusive-on-Failure Pattern for External Dependencies
//
// Ensures all external API calls degrade gracefully with consistent behavior.
// Critical for robust evaluation pipelines and user experience.
//
// ============================================================================
// WHY INCONCLUSIVE-ON-FAILURE MATTERS
// ============================================================================
//
// 1. EXTERNAL APIS ARE UNRELIABLE
//    - SEC EDGAR may be down for maintenance
//    - Rate limits may be exceeded
//    - Network issues may occur
//    - APIs may return malformed data
//
// 2. DISTINCTION BETWEEN "FAILED" AND "COULDN'T CHECK"
//    - "Failed" = We checked and found a problem (e.g., balance sheet doesn't balance)
//    - "Inconclusive" = We couldn't perform the check (e.g., API timeout)
//    - This distinction is critical for evaluation quality
//
// 3. USER EXPERIENCE
//    - Users shouldn't see cryptic error messages
//    - System should continue with available data
//    - Failures should be transparent but not blocking
//
// 4. AUDIT TRAIL
//    - All failures must be logged with context
//    - Reproducibility requires knowing what failed
//    - Metrics help identify chronic issues
//
// ============================================================================
// PATTERN: Result<T, InconclusiveReason>
// ============================================================================
//
// Every external call returns one of:
// - Success: { status: "success", data: T }
// - Inconclusive: { status: "inconclusive", reason: InconclusiveReason }
//
// Evaluation logic treats "inconclusive" as:
// - Not a pass (don't assume data is correct)
// - Not a fail (don't penalize for external issues)
// - Requires manual review or retry
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Categories of inconclusive reasons
 */
export type InconclusiveCategory =
  | "api_error"           // External API returned error
  | "timeout"             // Request timed out
  | "rate_limited"        // Hit rate limit
  | "network_error"       // Network/connectivity issue
  | "malformed_response"  // API returned invalid data
  | "data_not_found"      // Expected data not in response
  | "service_unavailable" // Service explicitly unavailable
  | "auth_error"          // Authentication failed
  | "circuit_breaker"     // Circuit breaker tripped
  | "dependency_failed";  // Upstream dependency failed

/**
 * External dependency types
 */
export type ExternalDependency =
  | "sec_edgar"           // SEC EDGAR API
  | "financial_api"       // Third-party financial APIs
  | "news_api"            // News/press release APIs
  | "market_data"         // Real-time market data
  | "embedding_service"   // Vector embedding service
  | "llm_service"         // LLM inference service
  | "storage_service"     // Cloud storage
  | "database";           // Database operations

/**
 * Detailed inconclusive reason
 */
export interface InconclusiveReason {
  /** Category of failure */
  category: InconclusiveCategory;

  /** Which external dependency failed */
  dependency: ExternalDependency;

  /** Human-readable message */
  message: string;

  /** Whether this is retriable */
  retriable: boolean;

  /** Suggested retry delay in ms (if retriable) */
  retryAfterMs?: number;

  /** HTTP status code (if applicable) */
  httpStatus?: number;

  /** Error code from external service */
  externalErrorCode?: string;

  /** Timestamp of failure */
  occurredAt: number;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Result type for external calls - either success or inconclusive
 */
export type ExternalResult<T> =
  | { status: "success"; data: T; latencyMs: number }
  | { status: "inconclusive"; reason: InconclusiveReason };

/**
 * Evaluation probe result with inconclusive handling
 */
export type ProbeResult =
  | { outcome: "pass"; score: number; details?: string }
  | { outcome: "fail"; score: number; details: string }
  | { outcome: "inconclusive"; reason: InconclusiveReason };

/* ------------------------------------------------------------------ */
/* INCONCLUSIVE REASON BUILDERS                                        */
/* ------------------------------------------------------------------ */

/**
 * Build inconclusive reason for API error
 */
export function apiError(
  dependency: ExternalDependency,
  message: string,
  httpStatus?: number,
  retriable = true
): InconclusiveReason {
  return {
    category: "api_error",
    dependency,
    message,
    retriable,
    httpStatus,
    retryAfterMs: retriable ? 5000 : undefined,
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for timeout
 */
export function timeout(
  dependency: ExternalDependency,
  timeoutMs: number
): InconclusiveReason {
  return {
    category: "timeout",
    dependency,
    message: `Request to ${dependency} timed out after ${timeoutMs}ms`,
    retriable: true,
    retryAfterMs: 10000,
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for rate limiting
 */
export function rateLimited(
  dependency: ExternalDependency,
  retryAfterMs: number
): InconclusiveReason {
  return {
    category: "rate_limited",
    dependency,
    message: `Rate limited by ${dependency}`,
    retriable: true,
    retryAfterMs,
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for network error
 */
export function networkError(
  dependency: ExternalDependency,
  errorMessage: string
): InconclusiveReason {
  return {
    category: "network_error",
    dependency,
    message: `Network error connecting to ${dependency}: ${errorMessage}`,
    retriable: true,
    retryAfterMs: 15000,
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for malformed response
 */
export function malformedResponse(
  dependency: ExternalDependency,
  details: string
): InconclusiveReason {
  return {
    category: "malformed_response",
    dependency,
    message: `Malformed response from ${dependency}: ${details}`,
    retriable: false, // Malformed data won't fix itself
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for data not found
 */
export function dataNotFound(
  dependency: ExternalDependency,
  what: string
): InconclusiveReason {
  return {
    category: "data_not_found",
    dependency,
    message: `${what} not found in ${dependency} response`,
    retriable: false, // If data doesn't exist, retry won't help
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason for circuit breaker
 */
export function circuitBreakerOpen(
  dependency: ExternalDependency,
  cooldownMs: number
): InconclusiveReason {
  return {
    category: "circuit_breaker",
    dependency,
    message: `Circuit breaker open for ${dependency}`,
    retriable: true,
    retryAfterMs: cooldownMs,
    occurredAt: Date.now(),
  };
}

/**
 * Build inconclusive reason from generic error
 */
export function fromError(
  dependency: ExternalDependency,
  error: unknown
): InconclusiveReason {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "UnknownError";

  // Detect specific error types
  if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
    return networkError(dependency, message);
  }

  if (message.includes("timeout") || name === "AbortError") {
    return timeout(dependency, 30000);
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return rateLimited(dependency, 60000);
  }

  return {
    category: "api_error",
    dependency,
    message: `Error from ${dependency}: ${message}`,
    retriable: true,
    retryAfterMs: 10000,
    occurredAt: Date.now(),
    context: { errorName: name },
  };
}

/* ------------------------------------------------------------------ */
/* HELPER FUNCTIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Wrap an external call with inconclusive-on-failure handling
 */
export async function wrapExternalCall<T>(
  dependency: ExternalDependency,
  operation: () => Promise<T>,
  options: {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
  } = {}
): Promise<ExternalResult<T>> {
  const { timeoutMs = 30000, retries = 0, retryDelayMs = 1000 } = options;
  const startTime = Date.now();

  let lastError: InconclusiveReason | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs
        );
      });

      // Race operation against timeout
      const data = await Promise.race([operation(), timeoutPromise]);

      return {
        status: "success",
        data,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = fromError(dependency, error);

      // Only retry if retriable and attempts remaining
      if (!lastError.retriable || attempt >= retries) {
        break;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return {
    status: "inconclusive",
    reason: lastError ?? fromError(dependency, new Error("Unknown error")),
  };
}

/**
 * Check if a result is successful
 */
export function isSuccess<T>(
  result: ExternalResult<T>
): result is { status: "success"; data: T; latencyMs: number } {
  return result.status === "success";
}

/**
 * Check if a result is inconclusive
 */
export function isInconclusive<T>(
  result: ExternalResult<T>
): result is { status: "inconclusive"; reason: InconclusiveReason } {
  return result.status === "inconclusive";
}

/**
 * Unwrap a result, throwing if inconclusive
 */
export function unwrap<T>(result: ExternalResult<T>): T {
  if (result.status === "success") {
    return result.data;
  }
  throw new Error(`Inconclusive: ${result.reason.message}`);
}

/**
 * Unwrap a result with default value for inconclusive
 */
export function unwrapOr<T>(result: ExternalResult<T>, defaultValue: T): T {
  if (result.status === "success") {
    return result.data;
  }
  return defaultValue;
}

/**
 * Map over a successful result
 */
export function mapResult<T, U>(
  result: ExternalResult<T>,
  fn: (data: T) => U
): ExternalResult<U> {
  if (result.status === "success") {
    return {
      status: "success",
      data: fn(result.data),
      latencyMs: result.latencyMs,
    };
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* PROBE RESULT HELPERS                                                */
/* ------------------------------------------------------------------ */

/**
 * Create a passing probe result
 */
export function probePass(score: number, details?: string): ProbeResult {
  return { outcome: "pass", score, details };
}

/**
 * Create a failing probe result
 */
export function probeFail(score: number, details: string): ProbeResult {
  return { outcome: "fail", score, details };
}

/**
 * Create an inconclusive probe result
 */
export function probeInconclusive(reason: InconclusiveReason): ProbeResult {
  return { outcome: "inconclusive", reason };
}

/**
 * Successful probe result (pass or fail)
 */
export type SuccessfulProbeResult =
  | { outcome: "pass"; score: number; details?: string }
  | { outcome: "fail"; score: number; details: string };

/**
 * Convert external result to probe result
 */
export function externalToProbe<T>(
  result: ExternalResult<T>,
  onSuccess: (data: T) => SuccessfulProbeResult
): ProbeResult {
  if (result.status === "success") {
    const successful = onSuccess(result.data);
    if (successful.outcome === "pass") {
      return probePass(successful.score, successful.details);
    }
    return probeFail(successful.score, successful.details);
  }
  return probeInconclusive(result.reason);
}

/* ------------------------------------------------------------------ */
/* AGGREGATION                                                         */
/* ------------------------------------------------------------------ */

/**
 * Aggregate multiple probe results
 *
 * - If all pass: overall pass with average score
 * - If any fail: overall fail with details
 * - If any inconclusive (and no fails): overall inconclusive
 */
export function aggregateProbeResults(
  results: ProbeResult[]
): ProbeResult & { breakdown: ProbeResult[] } {
  if (results.length === 0) {
    return {
      outcome: "inconclusive",
      reason: {
        category: "data_not_found",
        dependency: "database",
        message: "No probe results to aggregate",
        retriable: false,
        occurredAt: Date.now(),
      },
      breakdown: [],
    };
  }

  const fails = results.filter((r) => r.outcome === "fail");
  const inconclusives = results.filter((r) => r.outcome === "inconclusive");
  const passes = results.filter((r) => r.outcome === "pass");

  // Any fail means overall fail
  if (fails.length > 0) {
    const avgScore = fails.reduce((sum, f) => sum + f.score, 0) / fails.length;
    const details = fails.map((f) => f.details).join("; ");
    return {
      outcome: "fail",
      score: avgScore,
      details: `${fails.length} probe(s) failed: ${details}`,
      breakdown: results,
    };
  }

  // Any inconclusive (without fails) means overall inconclusive
  if (inconclusives.length > 0) {
    // Return first inconclusive reason
    const firstInconclusive = inconclusives[0] as {
      outcome: "inconclusive";
      reason: InconclusiveReason;
    };
    return {
      outcome: "inconclusive",
      reason: {
        ...firstInconclusive.reason,
        message: `${inconclusives.length} probe(s) inconclusive: ${firstInconclusive.reason.message}`,
      },
      breakdown: results,
    };
  }

  // All pass
  const avgScore = passes.reduce((sum, p) => sum + p.score, 0) / passes.length;
  return {
    outcome: "pass",
    score: avgScore,
    details: `All ${passes.length} probe(s) passed`,
    breakdown: results,
  };
}

/* ------------------------------------------------------------------ */
/* LOGGING                                                             */
/* ------------------------------------------------------------------ */

/**
 * Format inconclusive reason for logging
 */
export function formatInconclusiveForLog(reason: InconclusiveReason): string {
  const parts = [
    `[${reason.category.toUpperCase()}]`,
    `dependency=${reason.dependency}`,
    `message="${reason.message}"`,
    `retriable=${reason.retriable}`,
  ];

  if (reason.httpStatus) {
    parts.push(`httpStatus=${reason.httpStatus}`);
  }

  if (reason.retryAfterMs) {
    parts.push(`retryAfterMs=${reason.retryAfterMs}`);
  }

  return parts.join(" ");
}

/**
 * Convert inconclusive reason to structured log object
 */
export function inconclusiveToLogObject(reason: InconclusiveReason): Record<string, unknown> {
  return {
    category: reason.category,
    dependency: reason.dependency,
    message: reason.message,
    retriable: reason.retriable,
    retryAfterMs: reason.retryAfterMs,
    httpStatus: reason.httpStatus,
    externalErrorCode: reason.externalErrorCode,
    occurredAt: new Date(reason.occurredAt).toISOString(),
    context: reason.context,
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX MUTATIONS - Log failures for monitoring                      */
/* ------------------------------------------------------------------ */

/**
 * Log an inconclusive event for monitoring
 */
export const logInconclusiveEvent = internalMutation({
  args: {
    dependency: v.string(),
    category: v.string(),
    message: v.string(),
    retriable: v.boolean(),
    httpStatus: v.optional(v.number()),
    retryAfterMs: v.optional(v.number()),
    context: v.optional(v.any()),
    // Optional context
    ticker: v.optional(v.string()),
    fiscalYear: v.optional(v.number()),
    operation: v.optional(v.string()),
    runId: v.optional(v.string()),
  },
  returns: v.id("inconclusiveEventLog"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("inconclusiveEventLog", {
      dependency: args.dependency,
      category: args.category,
      message: args.message,
      retriable: args.retriable,
      httpStatus: args.httpStatus,
      retryAfterMs: args.retryAfterMs,
      context: args.context,
      ticker: args.ticker,
      fiscalYear: args.fiscalYear,
      operation: args.operation,
      runId: args.runId,
      occurredAt: Date.now(),
    });

    return id;
  },
});

/**
 * Get recent inconclusive events for a dependency
 */
export const getRecentInconclusiveEvents = query({
  args: {
    dependency: v.optional(v.string()),
    hoursBack: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("inconclusiveEventLog"),
      dependency: v.string(),
      category: v.string(),
      message: v.string(),
      retriable: v.boolean(),
      ticker: v.optional(v.string()),
      occurredAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack ?? 24;
    const limit = args.limit ?? 100;
    const since = Date.now() - hoursBack * 60 * 60 * 1000;

    let query = ctx.db
      .query("inconclusiveEventLog")
      .withIndex("by_occurred_at", (q) => q.gte("occurredAt", since));

    if (args.dependency) {
      query = query.filter((q) => q.eq(q.field("dependency"), args.dependency));
    }

    const events = await query.order("desc").take(limit);

    return events.map((e) => ({
      _id: e._id,
      dependency: e.dependency,
      category: e.category,
      message: e.message,
      retriable: e.retriable,
      ticker: e.ticker,
      occurredAt: e.occurredAt,
    }));
  },
});

/**
 * Get failure rate for a dependency over time period
 */
export const getDependencyHealthMetrics = query({
  args: {
    dependency: v.string(),
    hoursBack: v.optional(v.number()),
  },
  returns: v.object({
    dependency: v.string(),
    totalEvents: v.number(),
    retriableCount: v.number(),
    nonRetriableCount: v.number(),
    categoryBreakdown: v.any(),
    oldestEvent: v.optional(v.number()),
    newestEvent: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack ?? 24;
    const since = Date.now() - hoursBack * 60 * 60 * 1000;

    const events = await ctx.db
      .query("inconclusiveEventLog")
      .withIndex("by_dependency", (q) => q.eq("dependency", args.dependency))
      .filter((q) => q.gte(q.field("occurredAt"), since))
      .collect();

    const categoryBreakdown: Record<string, number> = {};
    let retriableCount = 0;
    let nonRetriableCount = 0;
    let oldest: number | undefined;
    let newest: number | undefined;

    for (const event of events) {
      categoryBreakdown[event.category] = (categoryBreakdown[event.category] ?? 0) + 1;

      if (event.retriable) {
        retriableCount++;
      } else {
        nonRetriableCount++;
      }

      if (!oldest || event.occurredAt < oldest) {
        oldest = event.occurredAt;
      }
      if (!newest || event.occurredAt > newest) {
        newest = event.occurredAt;
      }
    }

    return {
      dependency: args.dependency,
      totalEvents: events.length,
      retriableCount,
      nonRetriableCount,
      categoryBreakdown,
      oldestEvent: oldest,
      newestEvent: newest,
    };
  },
});
