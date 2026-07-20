/**
 * ShadowTiptap component for UnifiedEditor
 * Hidden TipTap editor that provides PM context for AI operations
 */

import React from 'react';
import { EditorProvider } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { PmBridge } from './PmBridge';
import { Id } from '../../../../../convex/_generated/dataModel';

interface ShadowTiptapProps {
  documentId: Id<"documents">;
  safeLatestVersion: number;
  getCurrentOrLastBlock: () => any | null;
  markHasContent: () => Promise<void>;
  syncEditor?: any;
}

const extensions = [StarterKit];

export const ShadowTiptap: React.FC<ShadowTiptapProps> = ({
  documentId,
  safeLatestVersion,
  getCurrentOrLastBlock,
  markHasContent,
  syncEditor,
}) => {
  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      <EditorProvider extensions={extensions} content="">
        <PmBridge
          documentId={documentId}
          safeLatestVersion={safeLatestVersion}
          getCurrentOrLastBlock={getCurrentOrLastBlock}
          markHasContent={markHasContent}
          syncEditor={syncEditor}
        />
      </EditorProvider>
    </div>
  );
};

