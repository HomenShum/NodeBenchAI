/**
 * PmBridge component for UnifiedEditor
 * Exposes PM context + accepts PM operations for AI integration
 */

import React, { useEffect } from 'react';
import { useCurrentEditor } from '@tiptap/react';
import { Id } from '../../../../../convex/_generated/dataModel';
import { getBlockText } from '../../utils/blockUtils';

interface PmBridgeProps {
  documentId: string | Id<"documents"> | undefined;
  safeLatestVersion: number;
  getCurrentOrLastBlock: () => any | null;
  markHasContent: () => Promise<void>;
  syncEditor?: any;
}

export const PmBridge: React.FC<PmBridgeProps> = ({
  documentId,
  safeLatestVersion,
  getCurrentOrLastBlock,
  markHasContent,
  syncEditor,
}) => {
  const { editor } = useCurrentEditor();

  useEffect(() => {
    if (!editor) return;

    const buildContext = () => {
      try {
        const json = editor.state.doc.toJSON();
        const { from, to } = editor.state.selection;
        const nodes: any[] = [];
        editor.state.doc.descendants((node: any, pos: number) => {
          const entry: any = { type: node.type.name, from: pos, to: pos + node.nodeSize };
          if (node.attrs && Object.keys(node.attrs).length) entry.attrs = node.attrs;
          if (node.isText && typeof node.text === 'string') entry.text = node.text;
          nodes.push(entry);
        });
        return { doc: json, selection: { from, to }, nodes };
      } catch (e) {
        return null;
      }
    };

    const onRequest = (evt: Event) => {
      const e = evt as CustomEvent<{ requestId: string }>;
      const ctx = buildContext();
      try {
        window.dispatchEvent(new CustomEvent('nodebench:ai:pmContext', {
          detail: { requestId: e.detail?.requestId, documentId, context: ctx },
        }));
      } catch (err) {
      }
    };

    const onApply = (evt: Event) => {
      handleApplyOperations(evt, editor, safeLatestVersion);
    };

    window.addEventListener('nodebench:ai:requestPmContext', onRequest as EventListener);
    window.addEventListener('nodebench:ai:applyPmOperations', onApply as EventListener);
    return () => {
      window.removeEventListener('nodebench:ai:requestPmContext', onRequest as EventListener);
      window.removeEventListener('nodebench:ai:applyPmOperations', onApply as EventListener);
    };
  }, [editor, documentId, safeLatestVersion]);

  // Broadcast editor focus/selection
  useEffect(() => {
    const ed: any = syncEditor;
    if (!ed) return;

    const emit = () => {
      try {
        let preview = '';
        try {
          const blk = getCurrentOrLastBlock();
          if (blk) preview = (getBlockText(blk) || '').slice(0, 200);
        } catch {
          // Block text extraction failed
        }
        if (!preview) {
          try {
            const texts: string[] = [];
            editor?.state.doc.descendants((n: any) => {
              if (n.isText && typeof n.text === 'string') texts.push(n.text);
            });
            preview = texts.join(' ').slice(0, 200);
          } catch {
            // Doc traversal failed
          }
        }
        window.dispatchEvent(new CustomEvent('nodebench:editor:focused', { detail: { documentId, preview } }));
        if ((preview || '').trim().length > 0) {
          try {
            window.localStorage.setItem(`nb.doc.hasContent.${String(documentId)}`, '1');
          } catch {
            // localStorage not available
          }
          void markHasContent();
        }
      } catch {
        // Emit failed
      }
    };

    try {
      emit();
    } catch {
      // Initial emit failed
    }
    try {
      editor?.on('selectionUpdate', emit);
    } catch {
      // Event listener registration failed
    }
    try {
      editor?.on('update', emit);
    } catch {
      // Event listener registration failed
    }
    return () => {
      try {
        editor?.off?.('selectionUpdate', emit);
      } catch {
        // Event listener cleanup failed
      }
      try {
        editor?.off?.('update', emit);
      } catch {
        // Event listener cleanup failed
      }
    };
  }, [syncEditor, editor, documentId, getCurrentOrLastBlock, markHasContent]);

  return null;
};

interface ApplyOperationsDetail {
  operations?: any[];
  documentId?: string;
  documentVersion?: number;
  editId?: string;
  anchorOccurrenceStrategy?: "nearest" | "next" | "prev";
  onResult?: (success: boolean, error?: string) => void;
}

function handleApplyOperations(evt: Event, editor: any, safeLatestVersion: number) {
  const e = evt as CustomEvent<ApplyOperationsDetail>;
  const ops: any[] = Array.isArray(e.detail?.operations) ? e.detail?.operations : [];
  const anchorOccurrenceStrategy = e.detail?.anchorOccurrenceStrategy;
  const onResult = e.detail?.onResult;
  const editId = e.detail?.editId;
  const editDocVersion = e.detail?.documentVersion;

  if (!ops.length) {
    onResult?.(false, "No operations provided");
    return;
  }

  // Optimistic Locking Validation
  if (typeof editDocVersion === 'number' && typeof safeLatestVersion === 'number') {
    if (editDocVersion < safeLatestVersion) {
      const versionDiff = safeLatestVersion - editDocVersion;

      const MAX_VERSION_DRIFT = 10;
      if (versionDiff > MAX_VERSION_DRIFT) {
        const errMsg = `Edit is stale: document changed (${versionDiff} versions behind). Please retry.`;
        console.error(`[PM Bridge] Rejecting stale edit ${editId}:`, errMsg);
        onResult?.(false, errMsg);
        return;
      }
    }
  }

  applyPmOperations(editor, ops, anchorOccurrenceStrategy, onResult);
}

function applyPmOperations(
  editor: any,
  ops: any[],
  anchorOccurrenceStrategy: "nearest" | "next" | "prev" | undefined,
  onResult?: (success: boolean, error?: string) => void
) {
  try {
    const tr = editor.state.tr;
    let offset = 0;

    for (const op of ops) {
      if (op.type === 'anchoredReplace') {
        const { anchor, search, replace } = op;
        const result = resolveAnchoredReplace(editor, anchor, search, replace, anchorOccurrenceStrategy);
        if (!result.success) {
          continue;
        }
        const { from, to, newText } = result;
        if (from === undefined || to === undefined || newText === undefined) continue;
        tr.replaceWith(from + offset, to + offset, editor.schema.text(newText));
        offset += newText.length - (to - from);
      } else if (op.type === 'insertAt') {
        const { position, text } = op;
        const pos = Math.min(Math.max(0, position + offset), tr.doc.content.size);
        tr.insertText(text, pos);
        offset += text.length;
      } else if (op.type === 'deleteRange') {
        const { from, to } = op;
        const safeFrom = Math.max(0, from + offset);
        const safeTo = Math.min(tr.doc.content.size, to + offset);
        tr.delete(safeFrom, safeTo);
        offset -= (safeTo - safeFrom);
      } else if (op.type === 'replaceRange') {
        const { from, to, text } = op;
        const safeFrom = Math.max(0, from + offset);
        const safeTo = Math.min(tr.doc.content.size, to + offset);
        tr.replaceWith(safeFrom, safeTo, editor.schema.text(text));
        offset += text.length - (safeTo - safeFrom);
      }
    }

    editor.view.dispatch(tr);
    onResult?.(true);
  } catch (err: any) {
    console.error('[PM Bridge] applyPmOperations error:', err);
    onResult?.(false, err?.message || String(err));
  }
}

interface AnchoredReplaceResult {
  success: boolean;
  from?: number;
  to?: number;
  newText?: string;
  error?: string;
}

function resolveAnchoredReplace(
  editor: any,
  anchor: string,
  search: string,
  replace: string,
  strategy?: "nearest" | "next" | "prev"
): AnchoredReplaceResult {
  try {
    const docText = editor.state.doc.textContent;
    const anchorIdx = docText.indexOf(anchor);
    if (anchorIdx === -1) {
      return { success: false, error: `Anchor not found: "${anchor.slice(0, 50)}..."` };
    }

    // Find all occurrences of search text
    const occurrences: number[] = [];
    let idx = 0;
    while ((idx = docText.indexOf(search, idx)) !== -1) {
      occurrences.push(idx);
      idx += 1;
    }

    if (occurrences.length === 0) {
      return { success: false, error: `Search text not found: "${search.slice(0, 50)}..."` };
    }

    // Select occurrence based on strategy
    let targetIdx: number;
    if (strategy === 'next') {
      targetIdx = occurrences.find(o => o >= anchorIdx) ?? occurrences[occurrences.length - 1];
    } else if (strategy === 'prev') {
      targetIdx = [...occurrences].reverse().find(o => o <= anchorIdx) ?? occurrences[0];
    } else {
      // nearest (default)
      targetIdx = occurrences.reduce((closest, curr) =>
        Math.abs(curr - anchorIdx) < Math.abs(closest - anchorIdx) ? curr : closest
      );
    }

    // Map plain text positions to PM positions
    const from = mapPlainTextToPmPos(editor, targetIdx);
    const to = mapPlainTextToPmPos(editor, targetIdx + search.length);

    return { success: true, from, to, newText: replace };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

function mapPlainTextToPmPos(editor: any, plainTextPos: number): number {
  let charCount = 0;
  let pmPos = 0;
  let found = false;

  editor.state.doc.descendants((node: any, pos: number) => {
    if (found) return false;
    if (node.isText && typeof node.text === 'string') {
      const textLen = node.text.length;
      if (charCount + textLen >= plainTextPos) {
        pmPos = pos + (plainTextPos - charCount);
        found = true;
        return false;
      }
      charCount += textLen;
    }
    return true;
  });

  return found ? pmPos : editor.state.doc.content.size;
}

