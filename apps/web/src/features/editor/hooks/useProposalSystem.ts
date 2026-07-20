/**
 * Proposal system hook for UnifiedEditor
 * Handles AI proposal/apply wiring
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import type { AIToolAction } from '../types';

interface PendingProposal {
  message: string;
  actions: AIToolAction[];
  anchorBlockId: string | null;
}

interface UseProposalSystemOptions {
  editor: any;
  documentId: Id<"documents">;
  blocksFromMarkdown: (md: string) => Promise<any[]>;
  autoCreateIfEmpty: boolean;
}

export function useProposalSystem({
  editor,
  documentId,
  blocksFromMarkdown,
  autoCreateIfEmpty: _autoCreateIfEmpty,
}: UseProposalSystemOptions) {
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const attemptedAutoCreateRef = useRef(false);

  // Server-side content flag via agentsPrefs
  const prefs = useQuery((api as any).agentsPrefs.getAgentsPrefs, {} as any) as (Record<string, string> | undefined);
  const serverHadContent = useMemo(() => {
    try { return (prefs && prefs[`doc.hasContent.${String(documentId)}`] === '1') || false; } catch { return false; }
  }, [prefs, documentId]);

  const setAgentsPrefs = useMutation((api as any).agentsPrefs.setAgentsPrefs);
  const serverMarkedRef = useRef(false);

  const markHasContent = useCallback(async () => {
    if (serverMarkedRef.current) return;
    serverMarkedRef.current = true;
    try {
      await setAgentsPrefs({ prefs: { [`doc.hasContent.${String(documentId)}`]: '1' } as any });
    } catch {
      // Prefs mutation failed
    }
  }, [setAgentsPrefs, documentId]);

  // ProseMirror latest version preflight
  const latestVersion = useQuery((api as any).prosemirror.latestVersion, { id: String(documentId) } as any) as number | null;
  const safeLatestVersion: number = typeof latestVersion === 'number' ? latestVersion : 0;

  // Helper: get current or last block as a reasonable default target
  const getCurrentOrLastBlock = useCallback((): unknown => {
    try {
      const anyEd: any = editor;
      const pos = anyEd?.getTextCursorPosition?.();
      if (pos?.block) return pos.block;
      const all = anyEd?.topLevelBlocks ?? [];
      return all.length ? all[all.length - 1] : null;
    } catch { return null; }
  }, [editor]);

  // Helper: resolve target block by heading text
  const resolvePositionByHeading = useCallback((heading: string): unknown => {
    try {
      const anyEd: any = editor;
      const blocks: any[] = anyEd?.topLevelBlocks ?? [];
      const needle = heading.trim().toLowerCase();
      return blocks.find((b: any) => {
        if (b?.type !== 'heading') return false;
        const text = (b?.content || []).map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ').trim().toLowerCase();
        return text === needle;
      }) ?? null;
    } catch { return null; }
  }, [editor]);

  const findBlockByNodeId = useCallback((nodeId: string): unknown => {
    try {
      const anyEd: any = editor;
      const all: any[] = anyEd?.topLevelBlocks ?? [];
      return all.find((b: any) => String(b?.props?.nodeId ?? "") === nodeId) ?? null;
    } catch { return null; }
  }, [editor]);

  // Apply a set of actions
  const applyActions = useCallback(async (actions: AIToolAction[], detail?: any) => {
    const ed: any = editor;
    if (!ed) return;

    let anchor: unknown = null;
    try {
      const anchorId: string | undefined = typeof detail?.anchorBlockId === 'string' ? detail.anchorBlockId : undefined;
      if (anchorId) {
        const all = ed.topLevelBlocks ?? [];
        anchor = all.find((b: any) => b.id === anchorId) ?? null;
      }
    } catch { /* noop */ }

    for (const action of actions) {
      if (action.type === 'updateDocument' && typeof action.title === 'string') {
        continue; // Title rename handled elsewhere
      }
      if ((action.type === 'updateNode' || action.type === 'createNode') && typeof action.markdown === 'string') {
        let target: unknown = null;
        const nodeId: string | undefined = (action as any)?.nodeId;
        const perActionAnchorId: string | undefined = (action as any)?.anchorBlockId;

        if (nodeId) target = findBlockByNodeId(String(nodeId));
        if (!target && perActionAnchorId) {
          try {
            const all = ed.topLevelBlocks ?? [];
            target = all.find((b: any) => b.id === perActionAnchorId) ?? null;
          } catch { /* noop */ }
        }
        if (!target && action.anchorHeading) target = resolvePositionByHeading(action.anchorHeading);
        if (!target) target = anchor ?? getCurrentOrLastBlock();

        const newBlocks = await blocksFromMarkdown(action.markdown);
        if (!newBlocks.length) continue;

        if (action.type === 'updateNode' && target) {
          if (newBlocks.length === 1) {
            ed.updateBlock(target.id, newBlocks[0]);
          } else {
            ed.replaceBlocks([target], newBlocks);
          }
        } else if (action.type === 'createNode' && target) {
          ed.insertBlocks(newBlocks, target, 'after');
        } else if (action.type === 'createNode' && !target) {
          const all = ed.topLevelBlocks ?? [];
          const last = all.length ? all[all.length - 1] : null;
          if (last) ed.insertBlocks(newBlocks, last, 'after');
          else ed.replaceBlocks([], newBlocks);
        }
      }
    }
  }, [editor, blocksFromMarkdown, getCurrentOrLastBlock, resolvePositionByHeading, findBlockByNodeId]);

  // Listen for proposals and apply requests
  useEffect(() => {
    const onProposal = (evt: Event) => {
      const e = evt as CustomEvent<any>;
      const detail = e?.detail || {};
      const actions: AIToolAction[] = Array.isArray(detail?.actions) ? detail.actions : [];
      const message: string = typeof detail?.message === 'string' ? detail.message : 'AI proposed changes';
      if (!actions.length) return;

      let anchorBlockId: string | null = null;
      try {
        const anyEd: any = editor;
        const pos = anyEd?.getTextCursorPosition?.();
        if (pos?.block?.id) anchorBlockId = String(pos.block.id);
        if (!anchorBlockId) {
          const all: any[] = anyEd?.topLevelBlocks ?? [];
          const first = all?.[0] ?? null;
          const second = all?.[1] ?? null;
          anchorBlockId = second?.id ?? first?.id ?? null;
        }
      } catch { /* noop */ }
      setPendingProposal({ message, actions, anchorBlockId });
    };

    const onApply = (evt: Event) => {
      const e = evt as CustomEvent<any>;
      const detail = e?.detail || {};
      const actions: AIToolAction[] = Array.isArray(detail?.actions) ? detail.actions : [];
      if (!actions.length) return;
      void applyActions(actions, detail);
      setPendingProposal(null);
    };

    window.addEventListener('nodebench:aiProposal', onProposal);
    window.addEventListener('nodebench:applyActions', onApply);
    return () => {
      window.removeEventListener('nodebench:aiProposal', onProposal);
      window.removeEventListener('nodebench:applyActions', onApply);
    };
  }, [applyActions, editor]);

  return {
    pendingProposal,
    setPendingProposal,
    serverHadContent,
    safeLatestVersion,
    markHasContent,
    getCurrentOrLastBlock,
    findBlockByNodeId,
    applyActions,
    attemptedAutoCreateRef,
  };
}

