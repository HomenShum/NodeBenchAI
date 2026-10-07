/**
 * useEntityNotebookDoc — focused subscription for the live notebook document.
 *
 * Pattern: subscription-per-concern (PR7 from the refactor checklist).
 *          Hot-path isolation: typing must only rerender the editor subtree,
 *          not the full entity page.
 *
 * Prior art:
 *   - React Profiler guidance on subscription splitting
 *   - Linear / Figma — editor content subscription isolated from metadata
 *
 * See: .claude/rules/reexamine_performance.md
 *      .claude/rules/reference_attribution.md
 *      src/features/entities/components/notebook/EntityNotebookLive.tsx
 *
 * Phase 1 scope: type-safe scaffold. The hook returns a well-typed shape so
 * callers can wire against the final API. Concrete Convex query wiring lands
 * in Phase 2 alongside notebook persistence refactoring (PR2).
 *
 * ANTI-GOAL: do NOT subscribe to entity metadata, scratchpad summary, sync
 * status, or diligence projections from this hook. Each of those has its
 * own dedicated hook so the notebook doc subscription stays minimal.
 */

import { useMemo } from "react";

export type NotebookDocSubscription = {
  /** True while the initial load is in flight. */
  isLoading: boolean;
  /** True once at least one snapshot has been delivered. */
  isReady: boolean;
  /** Monotonic version used for optimistic concurrency. */
  version: number | null;
  /** Participant count for collab-awareness — primitive, stable. */
  participantCount: number;
  /** True if the current viewer can mutate the notebook. */
  canEdit: boolean;
};

const EMPTY: NotebookDocSubscription = {
  isLoading: true,
  isReady: false,
  version: null,
  participantCount: 0,
  canEdit: false,
};

/**
 * Phase 1 scaffold. Returns a stable "loading" shape.
 *
 * When the real impl lands, this hook will:
 *   - Query `api.domains.product.notebooks.getLatestVersion` (or equivalent)
 *   - Use a referentially-stable selector so content deltas don't force
 *     downstream re-renders of consumers that only care about version
 *   - Expose only primitive or stably-derived fields
 */
export function useEntityNotebookDoc(_entitySlug: string): NotebookDocSubscription {
  // Stable identity — this object must never change between renders once
  // the data shape stabilizes. Using useMemo guards against accidental
  // object-literal regressions.
  return useMemo(() => EMPTY, []);
}
