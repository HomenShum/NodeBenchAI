// src/components/FastAgentPanel/DocumentActionCard.tsx
// Card component for displaying created/updated documents in Fast Agent Panel

import React from 'react';
import { FileText, ExternalLink, CheckCircle2, Edit3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DocumentAction {
  action: 'created' | 'updated';
  documentId: string;
  title: string;
  isPublic?: boolean;
  updatedFields?: string[];
}

interface DocumentActionCardProps {
  document: DocumentAction;
  className?: string;
  onDocumentSelect?: (documentId: string) => void;
}

/**
 * DocumentActionCard - Displays a clickable card for documents created/updated by the agent
 * Allows users to quickly navigate to the document
 */
export function DocumentActionCard({ document, className, onDocumentSelect }: DocumentActionCardProps) {
  const isCreated = document.action === 'created';

  const handleClick = () => {
    // Use custom event dispatch pattern used throughout the app
    if (onDocumentSelect) {
      onDocumentSelect(document.documentId);
    } else {
      // Fallback: dispatch custom event for document selection
      try {
        window.dispatchEvent(
          new CustomEvent('nodebench:openDocument', {
            detail: { documentId: document.documentId }
          })
        );
      } catch (err) {
        console.error('[DocumentActionCard] Failed to navigate:', err);
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full flex items-start gap-3 p-4 rounded-lg border transition-all",
        "hover:shadow-md active:scale-[0.99]",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        isCreated
          ? "bg-gradient-to-br from-green-50 to-white border-green-200 hover:border-green-300 focus:ring-green-500"
          : "bg-gradient-to-br from-violet-50 to-white border-violet-200 hover:border-violet-300 focus:ring-ring",
        className
      )}
    >
      {/* Icon */}
      <div className={cn(
        "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
        isCreated ? "bg-green-100" : "bg-blue-100"
      )}>
        {isCreated ? (
          <CheckCircle2 className={cn("h-5 w-5", "text-green-600")} />
        ) : (
          <Edit3 className={cn("h-5 w-5", "text-blue-600")} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-content-secondary flex-shrink-0" />
          <h3 className="text-sm font-semibold text-content truncate">
            {document.title}
          </h3>
        </div>

        <p className="text-xs text-content-secondary mb-2">
          {isCreated ? 'Document created' : 'Document updated'}
          {document.updatedFields && document.updatedFields.length > 0 && (
            <span className="text-content-secondary">
              {' '}• {document.updatedFields.join(', ')}
            </span>
          )}
        </p>

        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {document.isPublic && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
              Public
            </span>
          )}
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
            isCreated
              ? "bg-green-100 text-green-700 border-green-200"
              : "bg-blue-100 text-blue-700 border-blue-200"
          )}>
            {isCreated ? 'New' : 'Modified'}
          </span>
        </div>
      </div>

      {/* Arrow icon */}
      <div className="flex-shrink-0">
        <ExternalLink className="h-4 w-4 text-content-muted group-hover:text-content-secondary" />
      </div>
    </button>
  );
}

interface DocumentActionGridProps {
  documents: DocumentAction[];
  title?: string;
  className?: string;
  onDocumentSelect?: (documentId: string) => void;
}

/**
 * DocumentActionGrid - Grid layout for multiple document action cards
 */
export function DocumentActionGrid({ documents, title = "Documents", className, onDocumentSelect }: DocumentActionGridProps) {
  if (documents.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-content-secondary" />
        <h3 className="text-sm font-semibold text-content">
          {title}
        </h3>
        <span className="text-xs text-content-secondary">
          ({documents.length})
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {documents.map((doc, idx) => (
          <DocumentActionCard
            key={`${doc.documentId}-${idx}`}
            document={doc}
            onDocumentSelect={onDocumentSelect}
          />
        ))}
      </div>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseDocumentAction(value: unknown): DocumentAction | null {
  const record = asRecord(value);
  if (!record) return null;

  const action = record.action;
  const documentId = typeof record.documentId === 'string'
    ? record.documentId.trim()
    : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if ((action !== 'created' && action !== 'updated') || !documentId || !title) {
    return null;
  }

  const updatedFields = Array.isArray(record.updatedFields)
    ? record.updatedFields.flatMap((field): string[] => {
        const normalized = typeof field === 'string' ? field.trim() : '';
        return normalized ? [normalized] : [];
      })
    : undefined;

  return {
    action,
    documentId,
    title,
    isPublic: typeof record.isPublic === 'boolean' ? record.isPublic : undefined,
    updatedFields,
  };
}

/**
 * Decode the document-action contract returned by a completed tool.
 *
 * Callers must enforce the tool's `output-available` state. This parser accepts
 * the current structured object contract and the legacy marker envelope emitted
 * by document tools; it must never be run against assistant-authored prose.
 */
export function extractDocumentActionsFromToolOutput(output: unknown): DocumentAction[] {
  const decoded: unknown[] = [];

  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        decoded.push(JSON.parse(trimmed));
      } catch {
        return [];
      }
    } else {
      const regex = /<!-- DOCUMENT_ACTION_DATA\r?\n([\s\S]*?)\r?\n-->/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(output)) !== null) {
        try {
          decoded.push(JSON.parse(match[1]));
        } catch {
          // A malformed envelope is not actionable runtime evidence.
        }
      }
    }
  } else {
    decoded.push(output);
  }

  return decoded.flatMap((value): DocumentAction[] => {
    const record = asRecord(value);
    if (!record) return [];
    const payload = record.kind === 'document_action'
      ? (record.data ?? record.document)
      : record;
    const candidates = Array.isArray(payload) ? payload : [payload];
    return candidates.flatMap((candidate): DocumentAction[] => {
      const action = parseDocumentAction(candidate);
      return action ? [action] : [];
    });
  });
}

/**
 * Remove document action markers from text
 */
export function removeDocumentActionMarkers(text: string): string {
  return text.replace(/<!-- DOCUMENT_ACTION_DATA\n[\s\S]*?\n-->\n*/g, '');
}
