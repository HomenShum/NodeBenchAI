/**
 * ProposalInlineDecorations component for UnifiedEditor
 * Renders inline diff overlays for AI proposals
 */

import React, { useState, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useProposal } from '@/components/proposals/ProposalProvider';
import { computeStructuredOps, annotateMoves, prismHighlight, detectFenceLang, diffWords } from '@/components/proposals/diffUtils';
import { getBlockText } from '../../utils/blockUtils';

interface AIToolAction {
  type: 'createDocument' | 'updateDocument' | 'archiveDocument' | 'findDocuments' | 'createNode' | 'updateNode' | 'archiveNode';
  documentId?: string;
  title?: string;
  content?: unknown;
  nodeId?: string;
  parentId?: string | null;
  markdown?: string;
  anchorHeading?: string;
}

interface PendingProposal {
  message: string;
  actions: AIToolAction[];
  anchorBlockId: string | null;
}

interface ProposalInlineDecorationsProps {
  pendingProposal: PendingProposal | null;
  setPendingProposal: (proposal: PendingProposal | null) => void;
  computeProposalTargets: () => Array<{ blockId: string; nodeId?: string; ops: { type: 'eq'|'add'|'del'; line: string }[]; action: any }>;
  findBlockByNodeId: (nodeId: string) => any | null;
  syncEditor: any;
  editorContainerRef: React.RefObject<HTMLDivElement>;
  getBlockEl: (blockId: string) => HTMLElement | null;
}

export const ProposalInlineDecorations: React.FC<ProposalInlineDecorationsProps> = ({
  pendingProposal,
  setPendingProposal,
  computeProposalTargets,
  findBlockByNodeId,
  syncEditor,
  editorContainerRef,
  getBlockEl,
}) => {
  const { selections, toggleLine, setBlockDefaults } = useProposal();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const overlayIndexRef = useRef(0);

  // Keyboard navigation for overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingProposal) return;
      const overlays = Array.from(document.querySelectorAll('[data-nodebench-overlay]')) as HTMLElement[];
      if (e.key === 'j' || e.key === 'J') {
        if (overlays.length === 0) return;
        overlayIndexRef.current = (overlayIndexRef.current + 1) % overlays.length;
        overlays[overlayIndexRef.current]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (e.key === 'k' || e.key === 'K') {
        if (overlays.length === 0) return;
        overlayIndexRef.current = (overlayIndexRef.current - 1 + overlays.length) % overlays.length;
        overlays[overlayIndexRef.current]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (e.key === 'Enter') {
        try {
          const targets = computeProposalTargets();
          const actions: any[] = [];
          for (const t of targets) {
            const sel = selections[t.blockId] || {};
            const merged: string[] = [];
            for (let k = 0; k < t.ops.length; k++) {
              const op = t.ops[k];
              const accepted = sel[k] ?? (op.type === 'add');
              if (op.type === 'eq') merged.push(op.line);
              else if (op.type === 'del') { if (!accepted) merged.push(op.line); }
              else if (op.type === 'add') { if (accepted) merged.push(op.line); }
            }
            const markdown = merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
            const base = t.action?.nodeId ? { type: 'updateNode', nodeId: t.action.nodeId, markdown } : { type: 'createNode', markdown };
            actions.push({ ...base, anchorBlockId: t.blockId });
          }
          window.dispatchEvent(new CustomEvent('nodebench:applyActions', { detail: { actions } }));
          setPendingProposal(null);
        } catch { /* ignore */ }
      } else if (e.key === 'Escape') {
        setPendingProposal(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingProposal, selections, computeProposalTargets, setPendingProposal]);

  // Initialize default line selections
  useEffect(() => {
    if (!pendingProposal) return;
    try {
      const seen = new Set<string>();
      for (const action of (pendingProposal.actions || []) as any[]) {
        let blk = findBlockByNodeId(action.nodeId);
        if (!blk && pendingProposal.anchorBlockId) {
          try {
            const anyEd: any = syncEditor as any;
            const top: any[] = anyEd?.topLevelBlocks ?? [];
            blk = top.find((b: any) => b.id === pendingProposal.anchorBlockId) ?? null;
          } catch { /* noop */ }
        }
        if (!blk) continue;
        if (seen.has(blk.id)) continue;
        seen.add(blk.id);
        if (selections[blk.id]) continue;
        const current = getBlockText(blk);
        const proposed = String(action.markdown || '');
        const { ops } = computeStructuredOps(current, proposed);
        const { ops: annotatedOps } = annotateMoves(ops);
        const defaults: Record<number, boolean> = {};
        annotatedOps.forEach((op: any, idx: number) => {
          if (op.type === 'add') defaults[idx] = true;
          if (op.type === 'del' && op.moved) defaults[idx] = true;
        });
        setBlockDefaults(blk.id, defaults);
      }
    } catch { /* ignore */ }
  }, [pendingProposal, selections, findBlockByNodeId, syncEditor, setBlockDefaults]);

  const container = editorContainerRef.current;
  const actions = pendingProposal?.actions?.filter(a => typeof (a as any)?.markdown === 'string') as any[] | undefined;
  if (!pendingProposal || !actions || actions.length === 0 || !container || typeof window === 'undefined' || !window.document?.body) return null;

  const anyEd: any = syncEditor as any;
  const allBlocks: any[] = anyEd?.topLevelBlocks ?? [];

  // Unique overlay targets by block id
  const seen = new Set<string>();
  const overlayTargets: Array<{ action: any; block: any }> = [];
  for (const action of actions) {
    let blk: any | null = null;
    if (action.nodeId) {
      blk = findBlockByNodeId(String(action.nodeId));
    }
    if (!blk && pendingProposal.anchorBlockId) {
      blk = allBlocks.find(b => b.id === pendingProposal.anchorBlockId) ?? null;
    }
    if (!blk) continue;
    if (seen.has(blk.id)) continue;
    seen.add(blk.id);
    overlayTargets.push({ action, block: blk });
  }

  if (overlayTargets.length === 0) return null;

  const renderOverlay = (action: any, blk: any, i: number) => {
    const current = getBlockText(blk);
    const proposed = String(action.markdown || '');
    const { ops } = computeStructuredOps(current, proposed);
    const { ops: annotatedOps, pairs } = annotateMoves(ops);

    const toFrom = new Map<number, number>();
    const fromTo = new Map<number, number>();
    pairs.forEach(p => { fromTo.set(p.from, p.to); toFrom.set(p.to, p.from); });

    const blockEl = getBlockEl(blk.id);
    if (!blockEl) return null;
    const rect = blockEl.getBoundingClientRect();
    const panelWidth = Math.min(Math.max(280, Math.round(rect.width * 0.6)), 420);
    const gutter = 12;
    const left = Math.min(rect.left + window.scrollX + gutter, window.scrollX + window.innerWidth - panelWidth - 16);
    const top = Math.max(16, rect.top + window.scrollY + 4);

    const sel = selections[blk.id] || {};

    const applySelected = () => {
      const merged: string[] = [];
      for (let k = 0; k < ops.length; k++) {
        const op = ops[k];
        const accepted = sel[k] ?? (op.type === 'add');
        if (op.type === 'eq') merged.push(op.line);
        else if (op.type === 'del') { if (!accepted) merged.push(op.line); }
        else if (op.type === 'add') { if (accepted) merged.push(op.line); }
      }
      const newMarkdown = merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const actionToDispatch = action.nodeId
        ? { type: 'updateNode', nodeId: action.nodeId, markdown: newMarkdown }
        : { type: 'createNode', markdown: newMarkdown };
      try {
        window.dispatchEvent(new CustomEvent('nodebench:applyActions', {
          detail: { actions: [actionToDispatch], anchorBlockId: blk.id },
        }));
      } catch { /* ignore */ }
      setPendingProposal(null);
    };

    return createPortal(
      <div
        key={`inline-proposal-${blk.id}`}
        contentEditable={false}
        data-nodebench-overlay
        className="rounded-md border border-edge bg-surface text-content shadow-sm"
        style={{ position: 'fixed', top, left, width: panelWidth, zIndex: 60, pointerEvents: 'auto' }}
        aria-live="polite"
        onMouseDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="px-3 py-2 border-b border-edge flex items-center justify-between gap-3">
          <div className="text-xs font-medium truncate">Proposed change</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded((prev) => ({ ...prev, [blk.id]: !prev[blk.id] }))} className="text-xs px-2 py-0.5 rounded border">
              {expanded[blk.id] ? 'Collapse' : 'Expand'}
            </button>
            <button onClick={applySelected} className="text-xs px-2 py-0.5 rounded bg-indigo-600 text-white">Apply</button>
            <button onClick={() => setPendingProposal(null)} className="text-xs px-2 py-0.5 rounded border">Dismiss</button>
          </div>
        </div>
        {expanded[blk.id] ? (
          <div className="p-3 grid grid-cols-2 gap-3 max-h-56 overflow-auto text-[12px] leading-[1.2] nb-code-pane">
            <pre className="bg-surface-secondary/60 rounded p-2 overflow-auto"><code dangerouslySetInnerHTML={{ __html: prismHighlight(current, detectFenceLang(proposed)) }} /></pre>
            <pre className="bg-surface-secondary/60 rounded p-2 overflow-auto"><code dangerouslySetInnerHTML={{ __html: prismHighlight(proposed, detectFenceLang(proposed)) }} /></pre>
          </div>
        ) : (
          <DiffLinesList
            annotatedOps={annotatedOps}
            toFrom={toFrom}
            sel={sel}
            blkId={blk.id}
            toggleLine={toggleLine}
          />
        )}
      </div>,
      window.document.body
    );
  };

  return <>{overlayTargets.map(({ action, block }, i) => (<Fragment key={block.id}>{renderOverlay(action, block, i)}</Fragment>))}</>;
};

// Sub-component for diff lines list
interface DiffLinesListProps {
  annotatedOps: any[];
  toFrom: Map<number, number>;
  sel: Record<number, boolean>;
  blkId: string;
  toggleLine: (blockId: string, lineIdx: number) => void;
}

const DiffLinesList: React.FC<DiffLinesListProps> = ({ annotatedOps, toFrom, sel, blkId, toggleLine }) => {
  return (
    <div className="max-h-56 overflow-auto text-[12px] leading-[1.2]">
      <ul className="px-3 py-2 space-y-1">
        {annotatedOps.slice(0, 200).map((op, idx) => {
          if (op.moved && op.role === 'from') return null;
          let rowClass = 'text-content-secondary nb-diff-row';
          let sym = ' ';
          if (op.moved && op.role === 'to') {
            rowClass = 'nb-diff-row moved nb-moved text-purple-700 dark:text-purple-300';
            sym = '↕';
          } else if (op.type === 'add') {
            rowClass = 'nb-diff-row add ai-changes--new';
            sym = '+';
          } else if (op.type === 'del') {
            rowClass = 'nb-diff-row del ai-changes--old';
            sym = '-';
          }

          const partnerFromIdx = op.moved && op.role === 'to' ? toFrom.get(idx) : undefined;
          const partnerFromLine = (typeof partnerFromIdx === 'number') ? annotatedOps[partnerFromIdx].line : undefined;
          const words = (partnerFromLine !== undefined) ? diffWords(partnerFromLine, op.line) : undefined;

          const checked = sel[idx] ?? (op.type === 'add');

          const onToggle = () => {
            if (partnerFromIdx !== undefined) {
              toggleLine(blkId, idx);
              toggleLine(blkId, partnerFromIdx);
            } else {
              toggleLine(blkId, idx);
            }
          };

          return (
            <li key={idx} className={rowClass}>
              <label className="inline-flex items-start gap-2 cursor-pointer select-none w-full">
                <input type="checkbox" className="mt-0.5" checked={checked} onChange={onToggle} />
                <span className="flex-1">
                  <span className="inline-block w-3 select-none" title={op.moved ? 'Moved' : op.type === 'add' ? 'Added' : op.type === 'del' ? 'Deleted' : ''}>{sym}</span>
                  {words ? (
                    <span className="whitespace-pre-wrap">
                      <span className="text-red-700 dark:text-red-300" dangerouslySetInnerHTML={{ __html: words.oldHtml }} />
                      <span className="mx-1 text-content-secondary">→</span>
                      <span className="text-green-700 dark:text-green-300" dangerouslySetInnerHTML={{ __html: words.newHtml }} />
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap">{op.line}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

