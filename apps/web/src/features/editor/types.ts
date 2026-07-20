/**
 * UnifiedEditor type definitions
 * Extracted from UnifiedEditor.tsx for modularity
 */

import { Id } from "../../../convex/_generated/dataModel";

export type EditorMode = "quickEdit" | "quickNote" | "full";

export interface UnifiedEditorProps {
  documentId: Id<"documents">;
  mode?: EditorMode;
  isGridMode?: boolean;
  isFullscreen?: boolean;
  /** If false, editor renders in view-only mode (no edits, no slash menu) */
  editable?: boolean;
  /** If true, automatically initialize an empty document when none exists */
  autoCreateIfEmpty?: boolean;
  /** Optional: when creating a new doc (or when empty), seed from this markdown */
  seedMarkdown?: string;
  /** Signal to force-restore from provided markdown (increments to trigger) */
  restoreSignal?: number;
  /** Markdown to use for restore/seed operations */
  restoreMarkdown?: string;
  /** Provide a way for parent to extract plain text from the editor */
  registerExporter?: (fn: () => Promise<{ plain: string }>) => void;
}

export type AIToolAction = {
  type: 'createDocument' | 'updateDocument' | 'archiveDocument' | 'findDocuments' | 'createNode' | 'updateNode' | 'archiveNode';
  documentId?: Id<'documents'>;
  title?: string;
  content?: unknown;
  nodeId?: Id<'nodes'>;
  parentId?: Id<'nodes'> | null;
  markdown?: string;
  /** Optional semantic anchor: resolve target position by heading text */
  anchorHeading?: string;
  /** Optional block anchor for positioning */
  anchorBlockId?: string;
};

export type LineOp = {
  type: 'eq' | 'del' | 'add';
  line: string;
  aIdx?: number;
  bIdx?: number;
};

