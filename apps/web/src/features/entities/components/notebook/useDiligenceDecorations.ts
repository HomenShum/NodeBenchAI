/**
 * useDiligenceDecorations — bridge between the diligence subscription and
 * the ProseMirror decoration plugin.
 *
 * Pattern: subscription-to-plugin dispatch (PR7 + PR4 from the refactor
 *          checklist). The hook keeps a ref to the current projection list
 *          that the plugin's getDecorations callback reads from, and fires
 *          a meta-tagged transaction when the projection changes so the
 *          plugin rebuilds its DecorationSet.
 *
 *          Typing-path isolation: the hook does NOT subscribe to editor
 *          content and never triggers an editor re-render on keystrokes.
 *          Diligence updates flow through a single plugin transaction and
 *          only rebuild decorations — document nodes are untouched.
 *
 * Prior art:
 *   - Anthropic Claude Code — tool-card updates isolated from chat message loop
 *   - LangSmith — agent trace updates don't cascade into the editor
 *   - Figma — decoration layer updates independent of document content
 *
 * See: .claude/rules/reexamine_performance.md  (subscription splitting)
 *      .claude/rules/orchestrator_workers.md
 *      .claude/rules/reference_attribution.md
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *      src/features/entities/components/notebook/useDiligenceBlocks.ts
 */

import { useEffect, useMemo, useRef, useCallback } from "react";
import type { EditorView } from "prosemirror-view";
import {
  diligenceDecorationPluginKey,
  type DiligenceDecorationData,
} from "./DiligenceDecorationPlugin";
import { useDiligenceBlocks } from "./useDiligenceBlocks";

/**
 * Version key used for memoization — if this string is unchanged between
 * renders, the hook does NOT dispatch a transaction to the editor. This is
 * the fast-path guard that keeps keystroke-unrelated re-renders free.
 *
 * DETERMINISTIC rule: the key is built from sorted (blockType, runId, version)
 * tuples so the same data always produces the same key.
 */
export function buildDecorationsMemoKey(
  decorations: ReadonlyArray<DiligenceDecorationData>,
): string {
  if (decorations.length === 0) return "empty";
  return decorations
    .map((d) => `${d.blockType}:${d.scratchpadRunId}:${d.version}`)
    .sort()
    .join("|");
}

export type UseDiligenceDecorationsOptions = {
  /**
   * Editor view — when null the hook is idle (pre-mount or editor teardown).
   * When the view becomes available, the hook triggers one rebuild to seed
   * the plugin state.
   */
  view: EditorView | null;
  /** Entity slug — passed through to the underlying data subscription. */
  entitySlug: string;
};

export type UseDiligenceDecorationsResult = {
  /**
   * Stable reference to the current projection list. Pass this to the
   * plugin config's `getDecorations` callback so the plugin can read the
   * latest data at build time:
   *
   *   const { projections } = useDiligenceDecorations({ view, entitySlug });
   *   const plugin = useMemo(() => createDiligenceDecorationPlugin({
   *     getDecorations: () => projections.current,
   *     ...
   *   }), []);
   */
  projections: { readonly current: ReadonlyArray<DiligenceDecorationData> };
  /** Human-readable memo key — handy for debugging in React DevTools. */
  memoKey: string;
  /** Manually trigger a rebuild. Usually not needed — the hook auto-fires. */
  refresh: () => void;
};

/**
 * Live-wire the plugin against the diligence subscription.
 *
 * Usage inside EntityNotebookLive:
 *   const view = editor?.view ?? null;
 *   const { projections } = useDiligenceDecorations({ view, entitySlug });
 *   // Pass `projections.current` to plugin.getDecorations at plugin creation time.
 *
 * The hook returns a ref-like `projections` object so the plugin's closure
 * always sees the latest data via `.current`, without needing to recreate
 * the plugin on every data change.
 */
export function useDiligenceDecorations(
  options: UseDiligenceDecorationsOptions,
): UseDiligenceDecorationsResult {
  const { view, entitySlug } = options;

  const sub = useDiligenceBlocks(entitySlug);

  // Ref that the plugin's getDecorations callback reads from. Stable across
  // renders — only the .current mutates, so closures captured by the plugin
  // always see the latest value without invalidating.
  const projectionsRef = useRef<ReadonlyArray<DiligenceDecorationData>>([]);

  const memoKey = useMemo(
    () => buildDecorationsMemoKey(sub.projections),
    [sub.projections],
  );
  const prevKeyRef = useRef<string | null>(null);

  // Fire a rebuild transaction — meta-truthy triggers buildDecorationSet.
  const refresh = useCallback(() => {
    if (!view) return;
    try {
      if (!view.isDestroyed) {
        view.dispatch(view.state.tr.setMeta(diligenceDecorationPluginKey, true));
      }
    } catch {
      // view already torn down; harmless
    }
  }, [view]);

  // Update the ref + trigger rebuild when the projection set changes.
  useEffect(() => {
    projectionsRef.current = sub.projections;

    // Only dispatch when the memo key actually changes. Keeps the typing
    // hot path free of spurious rebuilds.
    if (prevKeyRef.current === memoKey) return;
    prevKeyRef.current = memoKey;

    refresh();
  }, [memoKey, sub.projections, refresh]);

  // On unmount or view change, clear decorations so a subsequent mount
  // starts clean.
  useEffect(() => {
    return () => {
      projectionsRef.current = [];
      if (!view) return;
      try {
        if (!view.isDestroyed) {
          view.dispatch(view.state.tr.setMeta(diligenceDecorationPluginKey, true));
        }
      } catch {
        // view already torn down; harmless
      }
    };
  }, [view]);

  return {
    projections: projectionsRef,
    memoKey,
    refresh,
  };
}
