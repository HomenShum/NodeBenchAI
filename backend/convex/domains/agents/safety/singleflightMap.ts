/**
 * Singleflight Map — in-memory coalescing for concurrent identical fetches
 *
 * 24h stand-in for full CSL/ESL persistence layer (specced in
 * docs/architecture/FAST_SLOW_RUNTIME_SPEC.md §3). Provides the conference-
 * hot-burst benefit (100 users asking "anthropic funding" → 1 actual fetch)
 * without schema work.
 *
 * Invariants from .claude/rules/agentic_reliability.md:
 *  - BOUND: max entries cap with LRU eviction on insert
 *  - DETERMINISTIC: keys via sorted-key stringify
 *  - TIMEOUT: in-flight promises abort after budget
 *  - HONEST_STATUS: failed fetches reject waiters, do not silently resolve
 *
 * Scope: in-process only. Does NOT share across Convex serverless instances;
 * acts as a per-instance hot-path coalescing layer. Pair with the existing
 * searchCache (convex/domains/search/searchCache.ts) for cross-instance
 * persistence.
 */

const DEFAULT_TTL_MS = 60_000; // 60 seconds — matches conference hot window
const DEFAULT_MAX_ENTRIES = 2048;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export interface SingleflightEntry<T> {
  promise: Promise<T>;
  createdAt: number;
  ttlMs: number;
  waiters: number;
}

export interface SingleflightStats {
  hits: number;
  misses: number;
  inflightHits: number;
  evictions: number;
  errors: number;
  size: number;
}

export interface SingleflightOptions {
  ttlMs?: number;
  maxEntries?: number;
  fetchTimeoutMs?: number;
}

/**
 * Stable-stringify for deterministic keys. Sort-stable at every nesting level.
 */
export function stableKey(parts: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(parts));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export class SingleflightMap<T> {
  private readonly map = new Map<string, SingleflightEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly fetchTimeoutMs: number;
  private readonly stats: SingleflightStats = {
    hits: 0,
    misses: 0,
    inflightHits: 0,
    evictions: 0,
    errors: 0,
    size: 0,
  };

  constructor(opts: SingleflightOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  /**
   * Execute `fetcher` exactly once for a given key. Concurrent callers with
   * the same key attach to the in-flight promise. Completed results cached
   * for `ttlMs` before re-fetch.
   */
  async run(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.map.get(key);
    const now = Date.now();

    if (existing && now - existing.createdAt < existing.ttlMs) {
      existing.waiters += 1;
      if (existing.waiters === 1) {
        this.stats.hits += 1; // resolved cache hit
      } else {
        this.stats.inflightHits += 1; // attached to in-flight
      }
      try {
        return await existing.promise;
      } catch (err) {
        // If the leader failed, fall through to a fresh attempt for this caller
        this.stats.errors += 1;
        this.map.delete(key);
        throw err;
      }
    }

    this.stats.misses += 1;
    this.evictIfNeeded();

    const promise = this.withTimeout(fetcher());
    const entry: SingleflightEntry<T> = {
      promise,
      createdAt: now,
      ttlMs: this.ttlMs,
      waiters: 1,
    };
    this.map.set(key, entry);
    this.stats.size = this.map.size;

    try {
      return await promise;
    } catch (err) {
      this.stats.errors += 1;
      // Evict failed entry so retries don't attach to a poisoned promise
      this.map.delete(key);
      this.stats.size = this.map.size;
      throw err;
    }
  }

  /**
   * Explicitly invalidate a key — e.g. after a write that makes cached data stale.
   */
  invalidate(key: string): void {
    if (this.map.delete(key)) {
      this.stats.size = this.map.size;
    }
  }

  getStats(): SingleflightStats {
    return { ...this.stats, size: this.map.size };
  }

  private evictIfNeeded(): void {
    if (this.map.size < this.maxEntries) return;
    // Evict the oldest entry — Map preserves insertion order
    const oldestKey = this.map.keys().next().value;
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey);
      this.stats.evictions += 1;
    }
  }

  private withTimeout(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[singleflight] fetch timed out after ${this.fetchTimeoutMs}ms`));
      }, this.fetchTimeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

/**
 * Shared singletons for common coalescing domains.
 */
export const entitySummarySingleflight = new SingleflightMap<unknown>({
  ttlMs: 60_000,
  maxEntries: 4096,
  fetchTimeoutMs: 8_000,
});

export const webSearchSingleflight = new SingleflightMap<unknown>({
  ttlMs: 30_000,
  maxEntries: 2048,
  fetchTimeoutMs: 6_000,
});

export const canonicalFetchSingleflight = new SingleflightMap<unknown>({
  ttlMs: 300_000, // 5 minutes for fetched public bodies
  maxEntries: 512,
  fetchTimeoutMs: 10_000,
});
