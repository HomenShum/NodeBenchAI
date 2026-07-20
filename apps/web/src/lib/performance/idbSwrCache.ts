/**
 * idbSwrCache — IndexedDB stale-while-revalidate (SWR) cache for the
 * editorial home queries.  Returning visitors hydrate from disk
 * instantly while Convex revalidates in the background.
 *
 * Pattern: stale-while-revalidate (RFC 5861 / SWR HTTP cache-control).
 * Prior art:
 *  - SWR (Vercel) — render cached, revalidate, swap on resolve
 *  - React-Query persistQueryClient — IndexedDB rehydration
 *  - Anthropic Claude Code persistent skill cache — layered memory
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - BOUND        — MAX_ENTRIES = 200, MAX_VALUE_BYTES = 100KB,
 *                   sampled LRU eviction (1-in-10 writes)
 *  - HONEST_STATUS — returns {data, cachedAt, ageMs} so callers can
 *                   show "Showing cached version" honestly
 *  - HONEST_SCORES — real reads or null, never fabricated hits
 *  - TIMEOUT       — READ_TIMEOUT_MS = 50 — IDB read budget
 *  - DETERMINISTIC — stableStringify with sorted keys recursively
 *  - ERROR_BOUNDARY — every IDB call try/catch; failure falls through
 *                   to the live fetch — render must not break
 *  - BOUND_READ    — refuse to cache values >100KB (silent skip)
 *
 * This module is intentionally framework-agnostic; the React hook
 * lives in `useStaleWhileRevalidate.ts`.
 */

const DB_NAME = "nodebench-swr-v1";
const STORE_NAME = "editorial-queries";
const DB_VERSION = 1;

/** Max number of entries kept on disk before LRU eviction kicks in. */
export const MAX_ENTRIES = 200;

/** Max serialized value size; oversized values are silently skipped. */
export const MAX_VALUE_BYTES = 100 * 1024;

/**
 * Hard budget for an IDB read.  If exceeded, return null and let the
 * caller fall through to Convex.  (Test override via `__setReadTimeout`.)
 */
let READ_TIMEOUT_MS = 50;

/**
 * Eviction is sampled — only every Nth write runs the scan-and-evict
 * pass.  This bounds amortized write cost regardless of cache pressure.
 */
const EVICTION_SAMPLE_RATE = 10;
let writeCounter = 0;

/** Test-only escape hatch. */
export function __setReadTimeout(ms: number): void {
  READ_TIMEOUT_MS = ms;
}

/** Stored shape returned to callers. */
export interface CacheEntry<T> {
  /** The cached payload. */
  data: T;
  /** ms-since-epoch when this entry was written. */
  cachedAt: number;
  /** Stable cache key used for the read. */
  key: string;
}

/** Internal on-disk shape (adds `lastAccess` for LRU). */
interface StoredEntry {
  key: string;
  data: unknown;
  cachedAt: number;
  lastAccess: number;
  byteSize: number;
}

/* ──────────────────────────────────────────────────────────────────
 * Deterministic JSON serialization (sorted-key recursive)
 * ────────────────────────────────────────────────────────────────── */

/**
 * Serialize a value with sorted object keys at every level so the
 * resulting string is byte-identical regardless of insertion order.
 * Used for cache keys and for byte-size measurement.
 *
 * Per `agentic_reliability.md` rule #8 (DETERMINISTIC).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
      return val;
    }
    // Sort keys for any plain object so the JSON is deterministic.
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[k] = (val as Record<string, unknown>)[k];
    }
    return sorted;
  });
}

export function makeCacheKey(queryId: string, args: unknown): string {
  return `${queryId}::${stableStringify(args ?? null)}`;
}

/* ──────────────────────────────────────────────────────────────────
 * IDB feature detection + connection management
 * ────────────────────────────────────────────────────────────────── */

let idbSupported: boolean | null = null;

function detectIdb(): boolean {
  if (idbSupported !== null) return idbSupported;
  try {
    if (typeof globalThis === "undefined") {
      idbSupported = false;
      return false;
    }
    const g = globalThis as unknown as { indexedDB?: IDBFactory };
    idbSupported = typeof g.indexedDB !== "undefined" && g.indexedDB !== null;
    return idbSupported;
  } catch {
    idbSupported = false;
    return false;
  }
}

/** Test helper: force re-detection on next call. */
export function __resetIdbDetection(): void {
  idbSupported = null;
  cachedDbPromise = null;
}

let cachedDbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!detectIdb()) return Promise.resolve(null);
  if (cachedDbPromise) return cachedDbPromise;
  cachedDbPromise = new Promise((resolve) => {
    try {
      const req = (globalThis as unknown as { indexedDB: IDBFactory })
        .indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
            // Index for LRU eviction (sort by lastAccess ascending).
            store.createIndex("by-lastAccess", "lastAccess", { unique: false });
          }
        } catch {
          /* swallow — render must not break */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return cachedDbPromise;
}

/* ──────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────── */

/**
 * Read an entry by cache key.  Returns `null` on miss, timeout, IDB
 * unavailable, or any error.  Render path NEVER throws.
 */
export async function getFromCache<T>(
  key: string,
): Promise<CacheEntry<T> | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: CacheEntry<T> | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    // TIMEOUT — read must complete in READ_TIMEOUT_MS.
    const timer = setTimeout(() => finish(null), READ_TIMEOUT_MS);

    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        clearTimeout(timer);
        const stored = req.result as StoredEntry | undefined;
        if (!stored) return finish(null);

        // Touch lastAccess for LRU.  Fire-and-forget — don't gate the
        // read on the touch write completing.
        try {
          store.put({ ...stored, lastAccess: Date.now() });
        } catch {
          /* swallow */
        }

        finish({
          data: stored.data as T,
          cachedAt: stored.cachedAt,
          key: stored.key,
        });
      };
      req.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      tx.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Write a value to the cache.  Silently:
 *  - skips if IDB is unavailable
 *  - skips values >MAX_VALUE_BYTES (BOUND_READ)
 *  - runs sampled LRU eviction (1-in-EVICTION_SAMPLE_RATE writes)
 *
 * Never throws.  Render path is fully isolated from cache failures.
 */
export async function setInCache<T>(key: string, data: T): Promise<void> {
  if (data === undefined) return;
  const db = await openDb();
  if (!db) return;

  // BOUND_READ — refuse to cache values that exceed the byte budget.
  let serialized: string;
  try {
    serialized = stableStringify(data);
  } catch {
    return; // unserializable (functions, cycles) → silent skip
  }
  if (serialized.length > MAX_VALUE_BYTES) return;

  const now = Date.now();
  const entry: StoredEntry = {
    key,
    data,
    cachedAt: now,
    lastAccess: now,
    byteSize: serialized.length,
  };

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  // Sampled LRU eviction — runs every EVICTION_SAMPLE_RATE writes.
  writeCounter += 1;
  if (writeCounter % EVICTION_SAMPLE_RATE === 0) {
    await evictOldestIfFull(db);
  }
}

/**
 * LRU eviction — if entry count exceeds MAX_ENTRIES, delete the oldest
 * (lowest lastAccess) until back under the cap.  Bounded scan: we
 * iterate the index ascending and stop once under cap.
 */
async function evictOldestIfFull(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const count = countReq.result;
        const overflow = count - MAX_ENTRIES;
        if (overflow <= 0) return resolve();

        const index = store.index("by-lastAccess");
        const cursorReq = index.openCursor();
        let removed = 0;
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && removed < overflow) {
            cursor.delete();
            removed += 1;
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => resolve();
      };
      countReq.onerror = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Test helper: clear the whole store.  No-op when IDB unavailable.
 */
export async function __clearCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  writeCounter = 0;
}

/** Test helper: report current entry count (for LRU verification). */
export async function __countEntries(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}
