/**
 * MCP Gateway — API Key Validation, Generation & Rate Limiting
 *
 * Keys use format: nb_key_[32 hex chars]
 * Stored as SHA-256 hashes (raw keys never persisted).
 * Rate limiting uses a sliding-window counter per key hash.
 */

import { createHash, randomBytes } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiKeyRecord {
  keyHash: string;
  keyHashPrefix: string; // first 12 chars of hash — fast lookup index
  userId: string;
  permissions: string[]; // e.g. ["tools:read", "tools:execute"]
  rateLimits: { perMinute: number; perDay: number };
  createdAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms when the minute window resets
  retryAfterMs: number; // 0 if allowed
  /** Per-minute remaining (always present when allowed) */
  minuteRemaining: number;
  /** Per-minute limit */
  minuteLimit: number;
  /** Per-day remaining (always present when allowed) */
  dailyRemaining: number;
  /** Per-day limit */
  dailyLimit: number;
}

export interface ValidateResult {
  valid: boolean;
  userId?: string;
  permissions?: string[];
  rateLimits?: { perMinute: number; perDay: number };
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Key format helpers
// ═══════════════════════════════════════════════════════════════════════════

const KEY_PREFIX = "nb_key_";
const KEY_HEX_LENGTH = 32; // 32 hex chars = 16 bytes of entropy
const KEY_REGEX = /^nb_key_[0-9a-f]{32}$/;

export function isValidKeyFormat(key: string): boolean {
  return KEY_REGEX.test(key);
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function hashPrefix(hash: string): string {
  return hash.slice(0, 12);
}

// ═══════════════════════════════════════════════════════════════════════════
// generateApiKey — create a new API key (returns raw key + hash)
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratedKey {
  rawKey: string; // shown to user exactly once
  keyHash: string;
  keyHashPrefix: string;
}

export function generateApiKey(): GeneratedKey {
  const hexPart = randomBytes(16).toString("hex"); // 32 hex chars
  const rawKey = `${KEY_PREFIX}${hexPart}`;
  const kHash = hashApiKey(rawKey);
  return {
    rawKey,
    keyHash: kHash,
    keyHashPrefix: hashPrefix(kHash),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// validateApiKey — check format + look up in store
// ═══════════════════════════════════════════════════════════════════════════

/**
 * In-process key store adapter. The gateway wires this to Convex queries
 * at startup; the default is an in-memory Map for tests / standalone mode.
 */
export type KeyLookupFn = (
  keyHashPrefix: string,
) => Promise<ApiKeyRecord | null>;

// Default: in-memory store (tests / local dev)
const memoryStore = new Map<string, ApiKeyRecord>();

export function getMemoryStore(): Map<string, ApiKeyRecord> {
  return memoryStore;
}

export async function validateApiKey(
  rawKey: string,
  lookup?: KeyLookupFn,
): Promise<ValidateResult> {
  // 1. Format check
  if (!isValidKeyFormat(rawKey)) {
    return { valid: false, reason: "Invalid key format — expected nb_key_[32 hex chars]" };
  }

  // 2. Hash + lookup
  const kHash = hashApiKey(rawKey);
  const prefix = hashPrefix(kHash);

  const record = lookup
    ? await lookup(prefix)
    : memoryStore.get(prefix) ?? null;

  if (!record) {
    return { valid: false, reason: "API key not found" };
  }

  // 3. Full hash comparison (prefix match alone is not sufficient)
  if (record.keyHash !== kHash) {
    return { valid: false, reason: "API key not found" };
  }

  // 4. Revocation check
  if (record.revokedAt !== null) {
    return { valid: false, reason: "API key has been revoked" };
  }

  return {
    valid: true,
    userId: record.userId,
    permissions: record.permissions,
    rateLimits: record.rateLimits,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiter — sliding window counter
// ═══════════════════════════════════════════════════════════════════════════

interface WindowCounter {
  /** Timestamps of calls in the current minute window */
  minuteTimestamps: number[];
  /** Timestamps of calls in the current day window */
  dayTimestamps: number[];
}

// BOUND: max 200 tracked keys to prevent memory leak under bot flood
const MAX_TRACKED_KEYS = 200;
const counters = new Map<string, WindowCounter>();

function evictOldestCounters(): void {
  if (counters.size <= MAX_TRACKED_KEYS) return;
  // Evict least-recently-used: key with oldest last timestamp
  let oldestKey = "";
  let oldestTs = Infinity;
  for (const [key, counter] of counters) {
    const lastTs = Math.max(
      counter.minuteTimestamps[counter.minuteTimestamps.length - 1] ?? 0,
      counter.dayTimestamps[counter.dayTimestamps.length - 1] ?? 0,
    );
    if (lastTs < oldestTs) {
      oldestTs = lastTs;
      oldestKey = key;
    }
  }
  if (oldestKey) counters.delete(oldestKey);
}

export function rateLimit(
  keyHash: string,
  limits: { perMinute: number; perDay: number } = { perMinute: 100, perDay: 10_000 },
): RateLimitResult {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const oneDayAgo = now - 86_400_000;

  let counter = counters.get(keyHash);
  if (!counter) {
    evictOldestCounters();
    counter = { minuteTimestamps: [], dayTimestamps: [] };
    counters.set(keyHash, counter);
  }

  // Prune expired timestamps
  counter.minuteTimestamps = counter.minuteTimestamps.filter((t) => t > oneMinuteAgo);
  counter.dayTimestamps = counter.dayTimestamps.filter((t) => t > oneDayAgo);

  // Check minute limit
  if (counter.minuteTimestamps.length >= limits.perMinute) {
    const oldestInWindow = counter.minuteTimestamps[0]!;
    const resetAt = oldestInWindow + 60_000;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
      minuteRemaining: 0,
      minuteLimit: limits.perMinute,
      dailyRemaining: limits.perDay - counter.dayTimestamps.length,
      dailyLimit: limits.perDay,
    };
  }

  // Check day limit
  if (counter.dayTimestamps.length >= limits.perDay) {
    const oldestInWindow = counter.dayTimestamps[0]!;
    const resetAt = oldestInWindow + 86_400_000;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
      minuteRemaining: limits.perMinute - counter.minuteTimestamps.length,
      minuteLimit: limits.perMinute,
      dailyRemaining: 0,
      dailyLimit: limits.perDay,
    };
  }

  // Allowed — record the call
  counter.minuteTimestamps.push(now);
  counter.dayTimestamps.push(now);

  const minuteRemaining = limits.perMinute - counter.minuteTimestamps.length;
  const dayRemaining = limits.perDay - counter.dayTimestamps.length;

  return {
    allowed: true,
    remaining: Math.min(minuteRemaining, dayRemaining),
    resetAt: now + 60_000,
    retryAfterMs: 0,
    minuteRemaining,
    minuteLimit: limits.perMinute,
    dailyRemaining: dayRemaining,
    dailyLimit: limits.perDay,
  };
}

/** Reset rate limit counters (for tests) */
export function resetRateLimits(): void {
  counters.clear();
}
