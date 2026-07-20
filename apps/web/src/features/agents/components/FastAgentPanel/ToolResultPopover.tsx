// src/components/FastAgentPanel/ToolResultPopover.tsx
// Popover component for displaying tool execution results in a formatted view

import React, { useState, useMemo } from 'react';
import { X, Copy, CheckCircle2, AlertCircle, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { YouTubeGallery, SECDocumentGallery, type YouTubeVideo, type SECDocument } from './MediaGallery';
import { CompanySelectionCard, type CompanyOption } from './CompanySelectionCard';
import { PeopleSelectionCard, type PersonOption } from './PeopleSelectionCard';
import { EventSelectionCard, type EventOption } from './EventSelectionCard';
import { NewsSelectionCard, type NewsArticleOption } from './NewsSelectionCard';
import { extractMediaFromText, removeMediaMarkersFromText } from './utils/mediaExtractor';
import { ResourceLinkCard, type ResourceLink } from './ResourceLinkCard';

function isResourceLinkResult(value: unknown): value is ResourceLink {
  return typeof value === 'object' && value !== null && (value as any).type === 'resource_link';
}

interface ToolResultPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  toolName: string;
  result: unknown;
  args?: unknown;
  error?: string;
  // Callbacks for selection cards
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
}

type TabType = 'result' | 'args' | 'error';

/**
 * ToolResultPopover - Modal for displaying formatted tool results
 * Supports multiple result types: JSON, galleries, selection cards, etc.
 */
export function ToolResultPopover({
  isOpen,
  onClose,
  toolName,
  result,
  args,
  error,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
}: ToolResultPopoverProps) {
  const [activeTab, setActiveTab] = useState<TabType>('result');
  const [copied, setCopied] = useState(false);

  // Extract media from result if it's a string
  const extractedMedia = useMemo(() => {
    if (typeof result === 'string') {
      return extractMediaFromText(result);
    }
    return { youtubeVideos: [], secDocuments: [], images: [] };
  }, [result]);

  // Clean result text if it's a string
  const cleanedResult = useMemo<any>(() => {
    if (typeof result === 'string') {
      return removeMediaMarkersFromText(result);
    }
    return result;
  }, [result]);

  // Format JSON for display
  const formattedResult = useMemo(() => {
    if (typeof cleanedResult === 'string') {
      return cleanedResult;
    }
    return JSON.stringify(cleanedResult, null, 2);
  }, [cleanedResult]);

  const formattedArgs = useMemo(() => {
    if (typeof args === 'string') {
      return args;
    }
    return JSON.stringify(args, null, 2);
  }, [args]);

  // Handle copy to clipboard
  const handleCopy = async () => {
    try {
      const textToCopy = activeTab === 'result' ? formattedResult : formattedArgs;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle keyboard close (ESC)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Format tool name for display (convert camelCase to Title Case)
  const displayToolName = toolName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`${displayToolName} result`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-surface-secondary">
            <div className="flex items-center gap-3">
              <Code2 className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-content">{displayToolName}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 hover:bg-surface-hover rounded-lg transition-colors"
              aria-label="Close result details"
            >
              <X className="h-5 w-5 text-content-secondary" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-edge px-6 bg-surface">
            <button
              type="button"
              onClick={() => setActiveTab('result')}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'result'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-content-secondary hover:text-content'
              )}
              aria-current={activeTab === 'result' ? 'page' : undefined}
            >
              Result
            </button>
            {Boolean(args) && (
              <button
                type="button"
                onClick={() => setActiveTab('args')}
                className={cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === 'args'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-content-secondary hover:text-content'
                )}
                aria-current={activeTab === 'args' ? 'page' : undefined}
              >
                Arguments
              </button>
            )}
            {error && (
              <button
                type="button"
                onClick={() => setActiveTab('error')}
                className={cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === 'error'
                    ? 'border-red-600 text-red-600'
                    : 'border-transparent text-content-secondary hover:text-content'
                )}
                aria-current={activeTab === 'error' ? 'page' : undefined}
              >
                Error
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {activeTab === 'result' && (
              <div className="space-y-4">
                {/* MCP-style resource_link renderer */}
                {isResourceLinkResult(result) && (
                  <ResourceLinkCard resourceLink={result} />
                )}

                {/* Media galleries */}
                {extractedMedia.youtubeVideos.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Videos</h3>
                    <YouTubeGallery videos={extractedMedia.youtubeVideos} />
                  </div>
                )}

                {extractedMedia.secDocuments.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Documents</h3>
                    <SECDocumentGallery documents={extractedMedia.secDocuments} />
                  </div>
                )}

                {extractedMedia.images.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Images</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {extractedMedia.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img.url}
                          alt={img.alt}
                          className="rounded-lg border border-edge w-full h-auto"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Text result */}
                {typeof cleanedResult === 'string' && cleanedResult.trim() && !isResourceLinkResult(result) && (
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Output</h3>
                    <pre className="bg-surface text-content p-3 rounded-lg text-xs overflow-x-auto max-h-64">
                      {cleanedResult}
                    </pre>
                  </div>
                )}

                {/* JSON result */}
                {typeof cleanedResult !== 'string' && cleanedResult !== undefined && cleanedResult !== null && !isResourceLinkResult(result) && (
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Output</h3>
                    <pre className="bg-surface text-content p-3 rounded-lg text-xs overflow-x-auto max-h-64">
                      {formattedResult}
                    </pre>
                  </div>
                )}

                {/* No result message */}
                {(cleanedResult === undefined || cleanedResult === null || (typeof cleanedResult === 'string' && !cleanedResult.trim())) &&
                 extractedMedia.youtubeVideos.length === 0 &&
                 extractedMedia.secDocuments.length === 0 &&
                 extractedMedia.images.length === 0 && (
                  <div className="flex items-center justify-center p-6 text-content-secondary">
                    <div className="text-center">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-content-muted" />
                      <p className="text-sm">No result available</p>
                      <p className="text-xs mt-1">This tool may still be executing or returned no data</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'args' && Boolean(args) && (
              <div>
                <h3 className="text-sm font-medium text-content mb-2">Tool Arguments</h3>
                <pre className="bg-surface text-content p-3 rounded-lg text-xs overflow-x-auto max-h-64">
                  {formattedArgs}
                </pre>
              </div>
            )}

            {activeTab === 'error' && error && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-edge rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-red-900 mb-1">Error</h3>
                  <pre className="text-sm text-red-800 overflow-x-auto">
                    {error}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Footer with copy button */}
          {(activeTab === 'result' || activeTab === 'args') && (
            <div className="px-6 py-3 border-t border-edge bg-surface-secondary flex justify-end">
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy to clipboard"
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-surface-secondary text-content hover:bg-surface-hover'
                )}
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
