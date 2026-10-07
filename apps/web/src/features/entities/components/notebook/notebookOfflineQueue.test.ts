/**
 * notebookOfflineQueue.test.ts — verifies localStorage-backed queue for
 * offline notebook edits.
 *
 * Scenario coverage (per the user-case matrix):
 *   - 9  transient offline; edits queue and drain
 *   - 10 extended offline; queue enforces 100-entry cap
 *   - 20 localStorage blocked (Safari private); silent no-op
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearEntity,
  enqueue,
  isOfflineQueueAvailable,
  makeEditId,
  readQueue,
  removeById,
  wasDropped,
  clearDroppedFlag,
} from "./notebookOfflineQueue";

// Minimal localStorage polyfill for vitest's jsdom-less default pool.
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: storage };
}

describe("notebookOfflineQueue", () => {
  beforeEach(() => {
    installMemoryStorage();
    clearDroppedFlag();
  });

  afterEach(() => {
    clearDroppedFlag();
  });

  it("enqueue + readQueue roundtrips a single edit", () => {
    expect(isOfflineQueueAvailable()).toBe(true);
    const entry = {
      id: makeEditId(),
      blockId: "blk_1",
      entitySlug: "softbank",
      kind: "content" as const,
      payload: [{ type: "text", value: "hello" }],
      queuedAt: Date.now(),
    };
    enqueue(entry);
    const out = readQueue("softbank");
    expect(out).toHaveLength(1);
    expect(out[0].blockId).toBe("blk_1");
  });

  it("scopes per-entity — reading one does not leak the other", () => {
    enqueue({
      id: "a",
      blockId: "blk_a",
      entitySlug: "softbank",
      kind: "content",
      payload: {},
      queuedAt: 1,
    });
    enqueue({
      id: "b",
      blockId: "blk_b",
      entitySlug: "stripe",
      kind: "content",
      payload: {},
      queuedAt: 2,
    });
    expect(readQueue("softbank")).toHaveLength(1);
    expect(readQueue("stripe")).toHaveLength(1);
    expect(readQueue("softbank")[0].id).toBe("a");
  });

  it("caps at 100 entries per entity and flags dropped", () => {
    for (let i = 0; i < 105; i++) {
      enqueue({
        id: `e-${i}`,
        blockId: `blk_${i}`,
        entitySlug: "softbank",
        kind: "content",
        payload: {},
        queuedAt: i,
      });
    }
    expect(readQueue("softbank")).toHaveLength(100);
    expect(wasDropped()).toBe(true);
    clearDroppedFlag();
    expect(wasDropped()).toBe(false);
  });

  it("removeById drops a specific entry, clearEntity empties", () => {
    enqueue({ id: "a", blockId: "1", entitySlug: "e", kind: "content", payload: {}, queuedAt: 1 });
    enqueue({ id: "b", blockId: "2", entitySlug: "e", kind: "content", payload: {}, queuedAt: 2 });
    removeById("e", "a");
    expect(readQueue("e").map((x) => x.id)).toEqual(["b"]);
    clearEntity("e");
    expect(readQueue("e")).toEqual([]);
  });

  it("fail-open when localStorage is unavailable", () => {
    (globalThis as unknown as { window?: unknown }).window = undefined;
    expect(isOfflineQueueAvailable()).toBe(false);
    enqueue({ id: "x", blockId: "y", entitySlug: "z", kind: "content", payload: {}, queuedAt: 1 });
    // Must NOT throw and return empty.
    expect(readQueue("z")).toEqual([]);
  });
});
