/**
 * MCP Gateway — API Key Validation, Generation & Rate Limiting
 *
 * Keys use format: nb_key_[32 hex chars]
 * Stored as SHA-256 hashes (raw keys never persisted).
 * Rate limiting uses a sliding-window counter per key hash.
 */
export interface ApiKeyRecord {
    keyHash: string;
    keyHashPrefix: string;
    userId: string;
    permissions: string[];
    rateLimits: {
        perMinute: number;
        perDay: number;
    };
    createdAt: number;
    lastUsedAt: number;
    revokedAt: number | null;
}
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterMs: number;
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
    rateLimits?: {
        perMinute: number;
        perDay: number;
    };
    reason?: string;
}
export declare function isValidKeyFormat(key: string): boolean;
export declare function hashApiKey(key: string): string;
export declare function hashPrefix(hash: string): string;
export interface GeneratedKey {
    rawKey: string;
    keyHash: string;
    keyHashPrefix: string;
}
export declare function generateApiKey(): GeneratedKey;
/**
 * In-process key store adapter. The gateway wires this to Convex queries
 * at startup; the default is an in-memory Map for tests / standalone mode.
 */
export type KeyLookupFn = (keyHashPrefix: string) => Promise<ApiKeyRecord | null>;
export declare function getMemoryStore(): Map<string, ApiKeyRecord>;
export declare function validateApiKey(rawKey: string, lookup?: KeyLookupFn): Promise<ValidateResult>;
export declare function rateLimit(keyHash: string, limits?: {
    perMinute: number;
    perDay: number;
}): RateLimitResult;
/** Reset rate limit counters (for tests) */
export declare function resetRateLimits(): void;
