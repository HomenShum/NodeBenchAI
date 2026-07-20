/**
 * MCP Gateway — API Key Validation, Generation & Rate Limiting
 *
 * Keys use format: nb_key_[32 hex chars]
 * Stored as SHA-256 hashes (raw keys never persisted).
 * Rate limiting uses a sliding-window counter per key hash.
 */
import { createHash, randomBytes } from "node:crypto";
// ═══════════════════════════════════════════════════════════════════════════
// Key format helpers
// ═══════════════════════════════════════════════════════════════════════════
const KEY_PREFIX = "nb_key_";
const KEY_HEX_LENGTH = 32; // 32 hex chars = 16 bytes of entropy
const KEY_REGEX = /^nb_key_[0-9a-f]{32}$/;
export function isValidKeyFormat(key) {
    return KEY_REGEX.test(key);
}
export function hashApiKey(key) {
    return createHash("sha256").update(key).digest("hex");
}
export function hashPrefix(hash) {
    return hash.slice(0, 12);
}
export function generateApiKey() {
    const hexPart = randomBytes(16).toString("hex"); // 32 hex chars
    const rawKey = `${KEY_PREFIX}${hexPart}`;
    const kHash = hashApiKey(rawKey);
    return {
        rawKey,
        keyHash: kHash,
        keyHashPrefix: hashPrefix(kHash),
    };
}
// Default: in-memory store (tests / local dev)
const memoryStore = new Map();
export function getMemoryStore() {
    return memoryStore;
}
export async function validateApiKey(rawKey, lookup) {
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
// BOUND: max 200 tracked keys to prevent memory leak under bot flood
const MAX_TRACKED_KEYS = 200;
const counters = new Map();
function evictOldestCounters() {
    if (counters.size <= MAX_TRACKED_KEYS)
        return;
    // Evict least-recently-used: key with oldest last timestamp
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [key, counter] of counters) {
        const lastTs = Math.max(counter.minuteTimestamps[counter.minuteTimestamps.length - 1] ?? 0, counter.dayTimestamps[counter.dayTimestamps.length - 1] ?? 0);
        if (lastTs < oldestTs) {
            oldestTs = lastTs;
            oldestKey = key;
        }
    }
    if (oldestKey)
        counters.delete(oldestKey);
}
export function rateLimit(keyHash, limits = { perMinute: 100, perDay: 10_000 }) {
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
        const oldestInWindow = counter.minuteTimestamps[0];
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
        const oldestInWindow = counter.dayTimestamps[0];
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
export function resetRateLimits() {
    counters.clear();
}
//# sourceMappingURL=mcpAuth.js.map