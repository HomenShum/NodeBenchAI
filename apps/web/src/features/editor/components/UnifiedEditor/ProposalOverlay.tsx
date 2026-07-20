/**
 * ProposalOverlay component for UnifiedEditor
 * Displays AI proposal diff UI with accept/reject actions
 */

import React, { useMemo } from 'react';
import { Check, X, Sparkles } from 'lucide-react';
import type { AIToolAction, LineOp } from '../../types';

interface PendingProposal {
  message: string;
  actions: AIToolAction[];
  anchorBlockId: string | null;
}

interface ProposalOverlayProps {
  proposal: PendingProposal;
  editor: any;
  onAccept: () => void;
  onReject: () => void;
}

export const ProposalOverlay: React.FC<ProposalOverlayProps> = ({
  proposal,
  editor,
  onAccept,
  onReject,
}) => {
  const diffLines = useMemo(() => {
    return computeDiffLines(proposal, editor);
  }, [proposal, editor]);

  return (
    <div className="absolute inset-0 z-50 bg-surface/95 dark:bg-surface/95 backdrop-blur-sm overflow-auto">
      <div className="p-4 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-edge dark:border-edge">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <h3 className="text-lg font-semibold text-content dark:text-content">
            AI Proposal
          </h3>
          <span className="text-sm text-content-secondary dark:text-content-secondary ml-2">
            {proposal.message}
          </span>
        </div>

        {/* Diff View */}
        <div className="font-mono text-sm bg-surface-secondary dark:bg-surface-secondary rounded-lg border border-edge dark:border-edge overflow-hidden mb-4">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={`px-4 py-1 ${getDiffLineClass(line.type)}`}
            >
              <span className="inline-block w-6 text-content-secondary select-none">
                {line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}
              </span>
              <span>{line.line}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onAccept}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            <Check className="w-4 h-4" />
            Accept Changes
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-2 px-4 py-2 bg-surface-secondary hover:bg-surface-hover dark:bg-surface-secondary dark:hover:bg-surface-hover text-content dark:text-content rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};

function getDiffLineClass(type: 'eq' | 'del' | 'add'): string {
  switch (type) {
    case 'del':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200';
    case 'add':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200';
    default:
      return 'text-content dark:text-content';
  }
}

function computeDiffLines(proposal: PendingProposal, editor: any): LineOp[] {
  const lines: LineOp[] = [];

  try {
    // Get current document text
    const currentBlocks = editor?.topLevelBlocks || [];
    const currentText = currentBlocks
      .map((b: any) => {
        if (b.content && Array.isArray(b.content)) {
          return b.content.map((c: any) => c.text || '').join('');
        }
        return '';
      })
      .join('\n');

    const currentLines = currentText.split('\n');

    // Get proposed changes from actions
    const proposedChanges: string[] = [];
    for (const action of proposal.actions) {
      if (action.markdown) {
        proposedChanges.push(action.markdown);
      }
    }

    const proposedText = proposedChanges.join('\n');
    const proposedLines = proposedText.split('\n');

    // Simple diff: show current as deletions, proposed as additions
    // (A more sophisticated diff algorithm could be used here)
    const maxLen = Math.max(currentLines.length, proposedLines.length);
    for (let i = 0; i < maxLen; i++) {
      const curr = currentLines[i];
      const prop = proposedLines[i];

      if (curr === prop) {
        if (curr !== undefined) {
          lines.push({ type: 'eq', line: curr, aIdx: i, bIdx: i });
        }
      } else {
        if (curr !== undefined) {
          lines.push({ type: 'del', line: curr, aIdx: i });
        }
        if (prop !== undefined) {
          lines.push({ type: 'add', line: prop, bIdx: i });
        }
      }
    }
  } catch (e) {
    lines.push({ type: 'eq', line: '(Unable to compute diff)' });
  }

  return lines;
}

