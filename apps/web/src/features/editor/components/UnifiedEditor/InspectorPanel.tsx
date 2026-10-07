/**
 * InspectorPanel component for UnifiedEditor
 * Debug panel for viewing editor state
 */

import React from 'react';

interface InspectorPanelProps {
  editor: any;
  isOpen: boolean;
  onClose: () => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  editor,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const getEditorState = () => {
    try {
      if (!editor) return { error: 'No editor instance' };
      const blocks = editor.topLevelBlocks || [];
      return {
        blockCount: blocks.length,
        blocks: blocks.slice(0, 10).map((b: any) => ({
          id: b.id,
          type: b.type,
          props: b.props,
          contentPreview: (b.content || []).slice(0, 3),
        })),
      };
    } catch (e: any) {
      return { error: e?.message || 'Failed to get editor state' };
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 max-h-96 overflow-auto bg-content text-surface rounded-lg shadow-xl border border-edge z-50">
      <div className="flex items-center justify-between p-3 border-b border-edge">
        <h3 className="text-sm font-semibold">Editor Inspector</h3>
        <button
          onClick={onClose}
          className="text-content-muted hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
      <div className="p-3">
        <pre className="text-xs font-mono whitespace-pre-wrap">
          {JSON.stringify(getEditorState(), null, 2)}
        </pre>
      </div>
    </div>
  );
};

