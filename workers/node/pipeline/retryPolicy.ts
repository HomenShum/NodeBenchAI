/**
 * retryPolicy — pure functions that classify errors and compute backoff
 * schedules for the pipeline's async retry layer.
 *
 * Source of truth for .claude/rules/async_reliability.md §2-3:
 *   - Exponential backoff + jitter for transient failures
 *   - Scheduled long-horizon retry for data-availability failures
 *   - Deterministic fingerprinting so the DLQ groups identical bugs
 *
 * Pure — no I/O, no wall-clock inside the math (caller passes `now` for
 * deterministic tests). The Convex action that wraps this module is
 * responsible for actual scheduling + persistence.
 */

export type ErrorClass =
  | "transient_network" // 5xx, ECONNRESET, fetch timeout
  | "rate_limited" // 429, explicit rate-limit signal
  | "data_unavailable" // e.g. USPTO returned empty — retry in hours
  | "auth_expired" // 401 with refreshable credential
  | "auth_forbidden" // 403 — fundamentally cannot access; DLQ
  | "bad_request" // 4xx non-auth — caller's bug; DLQ
  | "unknown"; // first-seen; treat as transient_network conservatively

export type RetryVerdict =
  | { kind: "retry_soon"; attempt: number; delayMs: number; reason: string }
  | { kind: "retry_scheduled"; attempt: number; nextAttemptAtMs: number; reason: string }
  | { kind: "dead_letter"; reason: string };

const MAX_TRANSIENT_ATTEMPTS = 3; // attempt 1 immediate, then 2 retries
const TRANSIENT_BASE_MS = 2_000; // 2s base → 6s → 18s (× 3 per attempt)
const TRANSIENT_JITTER_MS = 1_000; // +/- up to 1s
const DATA_AVAILABILITY_SCHEDULE_MS = [
  12 * 60 * 60 * 1_000, // +12h
  24 * 60 * 60 * 1_000, // +24h (from first attempt)
  48 * 60 * 60 * 1_000, // +48h (from first attempt)
];

/** Input shape to classifyError — lifted over both fetch-style and thrown errors. */
export type ErrorInput =
  | { kind: "http"; status: number; message?: string }
  | { kind: "thrown"; name?: string; message: string }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "data_unavailable"; source: string };

/**
 * Deterministic classifier. Same input → same ErrorClass.
 * Used by the orchestrator to decide retry vs DLQ.
 */
export function classifyError(input: ErrorInput): ErrorClass {
  switch (input.kind) {
    case "http": {
      const s = input.status;
      if (s === 429) return "rate_limited";
      if (s === 401) return "auth_expired";
      if (s === 403) return "auth_forbidden";
      if (s >= 500 && s <= 599) return "transient_network";
      if (s >= 400 && s <= 499) return "bad_request";
      return "unknown";
    }
    case "timeout":
      return "transient_network";
    case "thrown": {
      const m = (input.message ?? "").toLowerCase();
      if (
        input.name === "AbortError" ||
        m.includes("timeout") ||
        m.includes("aborted")
      ) {
        return "transient_network";
      }
      if (
        m.includes("network") ||
        m.includes("econnreset") ||
        m.includes("enotfound") ||
        m.includes("fetch failed")
      ) {
        return "transient_network";
      }
      return "unknown";
    }
    case "data_unavailable":
      return "data_unavailable";
  }
}

/**
 * Seeded pseudo-random in [0, 1). Deterministic across machines — used so
 * scenario tests can pin jitter values. Mulberry32-style.
 */
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Compute the retry verdict from classified error + attempt count + wall-clock.
 * Injected `now` and `jitterSeed` make this deterministic in tests.
 */
export function nextRetry(args: {
  errorClass: ErrorClass;
  attempt: number; // 1-based; attempt=1 means the first try already failed
  nowMs: number;
  jitterSeed?: number; // only used for transient_network
  firstAttemptAtMs?: number; // only used for data_unavailable schedule
}): RetryVerdict {
  const { errorClass, attempt, nowMs } = args;

  if (errorClass === "auth_forbidden" || errorClass === "bad_request") {
    return { kind: "dead_letter", reason: `${errorClass} — not retryable` };
  }

  if (
    errorClass === "transient_network" ||
    errorClass === "rate_limited" ||
    errorClass === "auth_expired" ||
    errorClass === "unknown"
  ) {
    if (attempt >= MAX_TRANSIENT_ATTEMPTS) {
      return {
        kind: "dead_letter",
        reason: `exhausted ${MAX_TRANSIENT_ATTEMPTS} transient attempts`,
      };
    }
    // Exponential backoff: 2s → 6s → 18s
    const baseDelay = TRANSIENT_BASE_MS * Math.pow(3, attempt - 1);
    const jitter = args.jitterSeed !== undefined ? seededRandom(args.jitterSeed) : Math.random();
    // ±1s jitter centered on base
    const jitterMs = Math.round((jitter * 2 - 1) * TRANSIENT_JITTER_MS);
    const delayMs = Math.max(0, baseDelay + jitterMs);
    return {
      kind: "retry_soon",
      attempt: attempt + 1,
      delayMs,
      reason: `${errorClass} attempt ${attempt + 1}/${MAX_TRANSIENT_ATTEMPTS}`,
    };
  }

  if (errorClass === "data_unavailable") {
    const scheduleIndex = Math.max(0, attempt - 1);
    if (scheduleIndex >= DATA_AVAILABILITY_SCHEDULE_MS.length) {
      return {
        kind: "dead_letter",
        reason: `data_unavailable — exhausted ${DATA_AVAILABILITY_SCHEDULE_MS.length} scheduled retries`,
      };
    }
    const base = args.firstAttemptAtMs ?? nowMs;
    const nextAttemptAtMs = base + DATA_AVAILABILITY_SCHEDULE_MS[scheduleIndex];
    return {
      kind: "retry_scheduled",
      attempt: attempt + 1,
      nextAttemptAtMs,
      reason: `data_unavailable scheduled attempt ${attempt + 1}`,
    };
  }

  return { kind: "dead_letter", reason: "unclassified error class" };
}

/**
 * Fingerprint a failure so the DLQ groups identical bugs together.
 * DETERMINISTIC: same (errorClass, source, messageStem) → same fingerprint.
 *
 * messageStem strips dynamic fragments (ids, timestamps) so "USPTO 500 on
 * request abc-123" and "USPTO 500 on request xyz-789" fingerprint the same.
 */
export function fingerprintFailure(args: {
  errorClass: ErrorClass;
  source: string; // e.g. "uspto", "linkedin", "crunchbase"
  messageStem: string; // normalized message (see normalizeMessageStem)
}): string {
  return `${args.errorClass}::${args.source}::${args.messageStem}`;
}

/**
 * Normalize an error message into a stable "stem":
 *   - lowercase
 *   - strip digits
 *   - strip UUIDs and hex ids
 *   - collapse whitespace
 * Stable stems are how the DLQ groups thousands of identical failures into
 * one actionable row.
 */
export function normalizeMessageStem(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240); // BOUND — ultra-long error messages don't grow fingerprints
}
