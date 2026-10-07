/**
 * useNotebookAutosave — debounced patch queue + sync state for the notebook.
 *
 * Pattern: local-first typing (PR2 from the refactor checklist).
 *          Typing updates local state immediately; persistence is debounced
 *          so the typing hot path never blocks on the network.
 *
 * Prior art:
 *   - Linear — debounced patch queue with visible sync indicator
 *   - Notion — "Saving…" / "Saved" inline status
 *   - TipTap Collaboration — optimistic local updates + background sync
 *   - Figma — local-first edits flushed in batches
 *
 * See: .claude/rules/reexamine_performance.md  (debouncing, local-first)
 *      .claude/rules/reexamine_resilience.md   (retry with backoff, graceful degradation)
 *      .claude/rules/async_reliability.md
 *      .claude/rules/reference_attribution.md
 *      docs/architecture/NOTEBOOK_REFACTOR_NOTES.md  (Phase 2 scope)
 *
 * Phase 1 scope: hook + types + public API that callers can wire against.
 * The concrete flush-to-Convex side effect lands behind a dependency-injected
 * `flushPatch` callback so this hook stays testable and doesn't import the
 * notebook's mutation client directly.
 *
 * Contract:
 *   - enqueuePatch(patch) — call on every editor transaction; never blocks
 *   - flushNow() — called on blur / explicit checkpoint / page unload
 *   - state — readable NotebookSyncState from useNotebookSyncStatus shape
 *   - retryAttempt — current retry count if state === "retrying"
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotebookSyncState } from "./useNotebookSyncStatus";

/**
 * Opaque patch type — the editor produces these on each transaction. The
 * specific shape is owned by the ProseMirror → Convex bridge, so this hook
 * stays agnostic.
 */
export type NotebookPatch = {
  readonly version: number;
  readonly ops: ReadonlyArray<unknown>;
  readonly createdAt: number;
};

export type NotebookAutosaveConfig = {
  /** Entity slug the autosave is scoped to. */
  entitySlug: string;
  /**
   * Injected flush callback — caller-supplied so this hook stays
   * unit-testable without Convex. Must be idempotent: re-flushing the same
   * patch set must not corrupt state (see async_reliability.md idempotency).
   */
  flushPatch: (patches: ReadonlyArray<NotebookPatch>) => Promise<void>;
  /** Idle debounce before flush. Default 500ms per the refactor checklist. */
  debounceMs?: number;
  /** Max patches before force-flush regardless of idle time. Default 32. */
  maxQueueSize?: number;
  /** Max retry attempts on flush failure. Default 3. */
  maxRetries?: number;
};

export type NotebookAutosaveHandle = {
  /** Call on every editor transaction. Non-blocking. */
  enqueuePatch: (patch: NotebookPatch) => void;
  /** Force-flush the queue immediately (blur, explicit save, unload). */
  flushNow: () => Promise<void>;
  /** Current sync state — mirrors useNotebookSyncStatus shape. */
  state: NotebookSyncState;
  /** Retry attempt count; 0 unless state === "retrying". */
  retryAttempt: number;
  /** Patches still in the queue. */
  pendingPatchCount: number;
  /** ms since last successful flush, null if never. */
  lastSavedAgoMs: number | null;
};

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Exponential backoff with jitter — matches async_reliability.md rule.
 * Attempt 1 → immediate
 * Attempt 2 → 2s
 * Attempt 3 → 6s
 * Attempt 4 → 18s
 * Plus up to ±20% jitter to avoid thundering-herd on shared failures.
 */
function computeBackoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  const base = Math.pow(3, attempt - 1) * 1_000; // 3s, 9s, 27s at attempts 2/3/4
  const jitter = (Math.random() - 0.5) * 0.4 * base; // ±20%
  return Math.max(0, Math.floor(base + jitter));
}

export function useNotebookAutosave(
  config: NotebookAutosaveConfig,
): NotebookAutosaveHandle {
  const {
    flushPatch,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxQueueSize = DEFAULT_MAX_QUEUE,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = config;

  // Queue lives in a ref so enqueuePatch is referentially stable and doesn't
  // churn on every state update. This is critical: callers invoke enqueue
  // inside ProseMirror transactions, which happen on every keystroke.
  const queueRef = useRef<NotebookPatch[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const lastSavedAtRef = useRef<number | null>(null);

  const [state, setState] = useState<NotebookSyncState>("synced");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [pendingPatchCount, setPendingPatchCount] = useState(0);
  // Tick purely to refresh lastSavedAgoMs — not used for anything else.
  const [, setNow] = useState(() => Date.now());

  // Refresh lastSavedAgoMs every 5s so the "Saved 2m ago" label updates
  // without coupling to every keystroke. Cheap.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(interval);
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // The core flush — drains the current queue, handles success + retry.
  const doFlush = useCallback(async () => {
    if (inFlightRef.current) return; // already flushing
    if (queueRef.current.length === 0) return;

    const toFlush = queueRef.current.slice();
    // Don't clear until success — if flush fails we want to retry with
    // the same patch set (idempotency via flushPatch).
    inFlightRef.current = true;
    setState("saving");

    try {
      await flushPatch(toFlush);
      // Success — remove flushed patches from queue (they might have grown
      // during the in-flight window; only drain the exact ones we flushed).
      queueRef.current = queueRef.current.slice(toFlush.length);
      lastSavedAtRef.current = Date.now();
      setRetryAttempt(0);
      setPendingPatchCount(queueRef.current.length);
      setState(queueRef.current.length > 0 ? "pending" : "synced");
      inFlightRef.current = false;

      // If new patches arrived mid-flight, schedule another flush.
      if (queueRef.current.length > 0) {
        scheduleFlush();
      }
    } catch (_err) {
      inFlightRef.current = false;
      setRetryAttempt((prev) => {
        const next = prev + 1;
        if (next > maxRetries) {
          // Give up gracefully — state goes to offline so user sees queued-locally
          setState("offline");
          return prev; // don't overflow counter
        }
        setState("retrying");
        const delay = computeBackoffMs(next + 1);
        retryTimerRef.current = setTimeout(() => {
          void doFlush();
        }, delay);
        return next;
      });
    }
  }, [flushPatch, maxRetries]);

  const scheduleFlush = useCallback(() => {
    clearTimers();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void doFlush();
    }, debounceMs);
  }, [clearTimers, debounceMs, doFlush]);

  // Public: enqueue a patch. Never blocks.
  const enqueuePatch = useCallback(
    (patch: NotebookPatch) => {
      queueRef.current.push(patch);
      setPendingPatchCount(queueRef.current.length);

      // If the queue has grown past the cap, force-flush (BOUND rule).
      if (queueRef.current.length >= maxQueueSize) {
        clearTimers();
        void doFlush();
        return;
      }

      // Otherwise debounce-flush.
      if (state !== "saving" && state !== "retrying") {
        setState("pending");
      }
      scheduleFlush();
    },
    [maxQueueSize, state, clearTimers, doFlush, scheduleFlush],
  );

  // Public: force flush immediately (blur, explicit save, unmount).
  const flushNow = useCallback(async () => {
    clearTimers();
    await doFlush();
  }, [clearTimers, doFlush]);

  // Cleanup on unmount — clear pending timers but don't lose patches.
  // The next mount with the same entitySlug should pick them up (Phase 2
  // will wire a session-scoped persistence layer; for now we rely on the
  // caller invoking flushNow on beforeunload).
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // Compute lastSavedAgoMs on each render so it's current.
  const lastSavedAgoMs =
    lastSavedAtRef.current == null
      ? null
      : Math.max(0, Date.now() - lastSavedAtRef.current);

  return {
    enqueuePatch,
    flushNow,
    state,
    retryAttempt,
    pendingPatchCount,
    lastSavedAgoMs,
  };
}
