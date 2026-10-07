/**
 * useNotebookSyncStatus — focused subscription for the save/sync indicator.
 *
 * Pattern: subscription-per-concern (PR7) + always-visible sync indicator
 *          so the notebook feels calm and trustworthy (PR2 requirement).
 *
 * Prior art:
 *   - Linear — persistent sync indicator top-right of editor
 *   - Notion — "Saving…" / "Saved" lightweight indicator
 *   - Cursor — inline save confirmation
 *
 * See: .claude/rules/reexamine_resilience.md  (retry + graceful degradation)
 *      .claude/rules/async_reliability.md
 *
 * Phase 1 scope: type-safe scaffold. Real state comes from the debounced
 * autosave queue (landed in PR2 full implementation).
 */

import { useMemo } from "react";

export type NotebookSyncState =
  /** Editor is in steady state; last save succeeded. */
  | "synced"
  /** Local changes queued; next save pending debounce. */
  | "pending"
  /** Save in flight. */
  | "saving"
  /** Most recent save failed; retry scheduled. */
  | "retrying"
  /** No network; edits queued locally. */
  | "offline";

export type NotebookSyncStatusSubscription = {
  state: NotebookSyncState;
  /** ms since last successful save (null if never saved). */
  lastSavedAgoMs: number | null;
  /** Retry attempt count if state is "retrying". */
  retryAttempt: number;
  /** Pending patch count in the local queue. */
  pendingPatchCount: number;
};

const EMPTY: NotebookSyncStatusSubscription = {
  state: "synced",
  lastSavedAgoMs: null,
  retryAttempt: 0,
  pendingPatchCount: 0,
};

export function useNotebookSyncStatus(_entitySlug: string): NotebookSyncStatusSubscription {
  return useMemo(() => EMPTY, []);
}

/**
 * Human-readable label for the sync indicator. Pure helper — safe to call
 * from any render path.
 *
 * Copy bias: calm, not alarming. Never "Error!" — always a next step.
 */
export function describeSyncState(sub: NotebookSyncStatusSubscription): string {
  switch (sub.state) {
    case "synced":
      return sub.lastSavedAgoMs == null ? "Ready" : "Saved";
    case "pending":
      return "Editing…";
    case "saving":
      return "Saving…";
    case "retrying":
      return `Retrying · attempt ${sub.retryAttempt}`;
    case "offline":
      return "Offline · changes queued locally";
  }
}
