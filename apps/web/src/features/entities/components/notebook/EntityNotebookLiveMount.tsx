/**
 * EntityNotebookLiveMount — memoization boundary for EntityNotebookLive.
 *
 * Pattern: stable-props render boundary (PR1 from the refactor checklist).
 *          Prevents per-keystroke EntityPage re-renders from bubbling down
 *          into the live notebook editor tree.
 *
 * Prior art:
 *   - React Profiler guidance on "unstable parent props"
 *   - Linear / Figma collaborative editor mount patterns
 *
 * See: docs/architecture/AGENT_PIPELINE.md
 *      .claude/rules/reexamine_performance.md
 *      .claude/rules/reference_attribution.md
 *
 * The issue this fixes:
 *   EntityPage composed two inline objects/closures on every render:
 *     latestHumanEdit={{ ownerKey, updatedAt }}   ← new object identity every render
 *     onOpenReferenceNotebook={() => ...}          ← new function identity every render
 *   Both cascade into EntityNotebookLive render loops — including the
 *   ProseMirror editor subtree — on every keystroke.
 *
 * This mount component:
 *   1. Accepts the primitive fields as flat props (stable identity possible).
 *   2. Memoizes the derived object/closure internally.
 *   3. Renders EntityNotebookLive with stable props.
 *   4. Is itself wrapped in React.memo so a parent re-render with identical
 *      primitive props is a no-op for the notebook subtree.
 */

import { memo, useCallback, useMemo } from "react";
import { EntityNotebookLive } from "./EntityNotebookLive";

export type EntityNotebookLiveMountProps = {
  entitySlug: string;
  shareToken?: string | null;
  canEdit: boolean;
  viewerOwnerKey: string | null;
  collaborationParticipants?: ReadonlyArray<{
    ownerKey: string;
    displayName?: string;
  }>;
  latestHumanEditorOwnerKey: string | null;
  latestHumanEditorUpdatedAt: number | null;
  /** Whether a toggle back to the reference notebook should be shown. */
  showReferenceNotebookToggle: boolean;
  /** Parent-owned handler. Memoized by the mount; caller doesn't need to. */
  onOpenReferenceNotebook?: () => void;
};

function EntityNotebookLiveMountBase(props: EntityNotebookLiveMountProps) {
  // Memoize the derived object so its identity only changes when its
  // primitive inputs change. Without this, every parent render produces a
  // new object literal → every child re-render cascades.
  const latestHumanEdit = useMemo(
    () => ({
      ownerKey: props.latestHumanEditorOwnerKey,
      updatedAt: props.latestHumanEditorUpdatedAt,
    }),
    [props.latestHumanEditorOwnerKey, props.latestHumanEditorUpdatedAt],
  );

  // Stabilize the callback: identity only changes when the underlying
  // handler or toggle visibility flips.
  const parentHandler = props.onOpenReferenceNotebook;
  const memoizedHandler = useCallback(() => {
    parentHandler?.();
  }, [parentHandler]);

  const toggleHandler = props.showReferenceNotebookToggle ? memoizedHandler : undefined;

  return (
    <EntityNotebookLive
      entitySlug={props.entitySlug}
      shareToken={props.shareToken ?? undefined}
      canEdit={props.canEdit}
      onOpenReferenceNotebook={toggleHandler}
      viewerOwnerKey={props.viewerOwnerKey}
      collaborationParticipants={props.collaborationParticipants as any}
      latestHumanEdit={latestHumanEdit}
    />
  );
}

/**
 * React.memo ensures this boundary re-renders only when its flat primitive
 * props change — not on every parent re-render caused by unrelated state
 * (keystrokes outside the editor, hover events on chrome, etc.).
 *
 * NOTE for future PR2: once EntityNotebookLive's own internal state is
 * isolated from EntityPage query subscriptions, this memo guard becomes
 * redundant. Until then, it is load-bearing.
 */
export const EntityNotebookLiveMount = memo(EntityNotebookLiveMountBase);
EntityNotebookLiveMount.displayName = "EntityNotebookLiveMount";
