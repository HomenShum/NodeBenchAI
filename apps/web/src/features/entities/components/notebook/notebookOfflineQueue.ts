/**
 * notebookOfflineQueue.ts — localStorage-backed queue for pending notebook
 * saves that happened while the client was offline.
 *
 * Rationale (per production-readiness scenarios 9 + 10 + 20):
 *   The Tiptap sync provider buffers steps in memory. If the tab closes
 *   before reconnect, in-flight steps are lost. This helper keeps an
 *   append-only list of "I typed this at time T on block B" entries in
 *   localStorage so a crashed/closed tab can replay on next mount.
 *
 * Behavior:
 *   - Fail-open: if localStorage is unavailable (Safari private, quota,
 *     disabled), every call is a silent no-op and returns empty.
 *   - Per-entity scope so draining one notebook doesn't touch another.
 *   - Hard cap of 100 entries per entity; oldest evicted with a one-time
 *     warning flag so the UI can surface "some offline edits were dropped".
 *
 * This module is intentionally DOM-free: it takes the string key prefix
 * and a clock injection so it's trivially unit-testable in Node.
 */

export type QueuedNotebookEdit = {
  id: string;                 // UUID per edit
  blockId: string;            // Convex Id<"productBlocks">
  entitySlug: string;
  kind: "content";
  payload: unknown;           // snapshot of BlockChip[] at edit time
  queuedAt: number;
};

const PREFIX = "nodebench.notebook.offline.queue";
const MAX_PER_ENTITY = 100;
const DROPPED_FLAG = "nodebench.notebook.offline.dropped";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const test = `${PREFIX}.__probe`;
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(entitySlug: string): string {
  return `${PREFIX}.${entitySlug}`;
}

export function isOfflineQueueAvailable(): boolean {
  return safeStorage() !== null;
}

export function readQueue(entitySlug: string): QueuedNotebookEdit[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(keyFor(entitySlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QueuedNotebookEdit[];
  } catch {
    return [];
  }
}

export function enqueue(entry: QueuedNotebookEdit): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const queue = readQueue(entry.entitySlug);
    queue.push(entry);
    let dropped = false;
    while (queue.length > MAX_PER_ENTITY) {
      queue.shift();
      dropped = true;
    }
    storage.setItem(keyFor(entry.entitySlug), JSON.stringify(queue));
    if (dropped) storage.setItem(DROPPED_FLAG, "1");
  } catch {
    // Quota exceeded or disabled — silently drop.
  }
}

export function removeById(entitySlug: string, id: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const queue = readQueue(entitySlug).filter((entry) => entry.id !== id);
    if (queue.length === 0) {
      storage.removeItem(keyFor(entitySlug));
    } else {
      storage.setItem(keyFor(entitySlug), JSON.stringify(queue));
    }
  } catch {
    /* noop */
  }
}

export function clearEntity(entitySlug: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(keyFor(entitySlug));
  } catch {
    /* noop */
  }
}

export function wasDropped(): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  return storage.getItem(DROPPED_FLAG) === "1";
}

export function clearDroppedFlag(): void {
  const storage = safeStorage();
  if (!storage) return;
  storage.removeItem(DROPPED_FLAG);
}

// Generate a non-cryptographic uuid v4-ish for queue entries. crypto.randomUUID
// isn't guaranteed in Safari <15.4; fall back to a short random string.
export function makeEditId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
