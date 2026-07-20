/**
 * SelectionContext - Shared context for document selection across viewers
 * 
 * Enables "Chat with Selection" feature by capturing selected content
 * from any document viewer and injecting it into Fast Agent context.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type { Id } from '../../../../convex/_generated/dataModel';

export type SelectionSourceType = 
  | 'spreadsheet' 
  | 'text' 
  | 'pdf' 
  | 'image' 
  | 'video' 
  | 'code' 
  | 'dossier';

export interface SelectionMetadata {
  /** Source type of the selection */
  sourceType: SelectionSourceType;
  /** Document ID if available */
  documentId?: Id<"documents">;
  /** Filename or document title */
  filename: string;
  /** Human-readable range description (e.g., "rows 5-12", "cells A1:C5", "00:15-00:45") */
  rangeDescription?: string;
  /** For spreadsheets: column headers if available */
  columnHeaders?: string[];
  /** For spreadsheets: row indices */
  rowRange?: { start: number; end: number };
  /** For video: timestamp range in seconds */
  timestampRange?: { start: number; end: number };
  /** For images: region bounds */
  regionBounds?: { x: number; y: number; width: number; height: number };
}

export interface DocumentSelection {
  /** The actual selected content (text, CSV data, etc.) */
  content: string;
  /** Metadata about the selection */
  metadata: SelectionMetadata;
  /** Timestamp when selection was made */
  timestamp: number;
}

interface SelectionContextValue {
  /** Current selection, if any */
  selection: DocumentSelection | null;
  /** Set a new selection */
  setSelection: (content: string, metadata: SelectionMetadata) => void;
  /** Clear the current selection */
  clearSelection: () => void;
  /** Format selection for AI context injection */
  formatForContext: () => string | null;
  /** Whether there's an active selection */
  hasSelection: boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelectionState] = useState<DocumentSelection | null>(null);

  const setSelection = useCallback((content: string, metadata: SelectionMetadata) => {
    setSelectionState({
      content,
      metadata,
      timestamp: Date.now(),
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionState(null);
  }, []);

  const formatForContext = useCallback((): string | null => {
    if (!selection) return null;

    const { content, metadata } = selection;
    const { sourceType, filename, rangeDescription } = metadata;

    // Format based on source type
    let header = '';
    switch (sourceType) {
      case 'spreadsheet':
        header = rangeDescription 
          ? `[Selected ${rangeDescription} from "${filename}"]`
          : `[Selected data from "${filename}"]`;
        break;
      case 'text':
      case 'code':
      case 'dossier':
        header = `[Selected text from "${filename}"]`;
        break;
      case 'pdf':
        header = `[Selected text from PDF "${filename}"]`;
        break;
      case 'image':
        header = `[Selected region from image "${filename}"]`;
        break;
      case 'video':
        const timeRange = metadata.timestampRange;
        header = timeRange 
          ? `[Selected segment ${formatTime(timeRange.start)}-${formatTime(timeRange.end)} from "${filename}"]`
          : `[Selected from video "${filename}"]`;
        break;
      default:
        header = `[Selected content from "${filename}"]`;
    }

    return `${header}\n\n${content}`;
  }, [selection]);

  const hasSelection = selection !== null && selection.content.trim().length > 0;

  const value = useMemo<SelectionContextValue>(() => ({
    selection,
    setSelection,
    clearSelection,
    formatForContext,
    hasSelection,
  }), [selection, setSelection, clearSelection, formatForContext, hasSelection]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}

// Helper to format seconds as MM:SS
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default SelectionContext;

