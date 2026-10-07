/**
 * useNotebookMeta — focused subscription for page-level entity metadata.
 *
 * Pattern: subscription-per-concern (PR7). Metadata changes (entity name
 *          updates, source-count changes, participant shifts) should NOT
 *          cause the notebook editor to re-render.
 *
 * Prior art:
 *   - React 18 concurrent rendering — subscription boundaries
 *   - Linear — per-concern useQuery splitting
 *
 * See: .claude/rules/reexamine_performance.md
 *      src/features/entities/components/EntityNotebookMeta.tsx
 *
 * Phase 1 scope: type-safe scaffold. Concrete wiring reuses the existing
 * entity query but routes through this dedicated hook so any caller that
 * only needs metadata (e.g., the header chrome) stays decoupled from the
 * editor subtree.
 *
 * ANTI-GOAL: do NOT expose notebook document content, diligence
 * projections, or scratchpad state from this hook.
 */

import { useMemo } from "react";

export type NotebookMetaSubscription = {
  isLoading: boolean;
  entityName: string | null;
  entityType: "company" | "person" | "job" | "market" | "note" | null;
  sourceCount: number;
  updatedAt: number | null;
};

const EMPTY: NotebookMetaSubscription = {
  isLoading: true,
  entityName: null,
  entityType: null,
  sourceCount: 0,
  updatedAt: null,
};

export function useNotebookMeta(_entitySlug: string): NotebookMetaSubscription {
  return useMemo(() => EMPTY, []);
}
