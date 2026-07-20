/**
 * DocumentCard Component - "Pro" Clean Design
 *
 * A refined, content-first card for research assets:
 * - Clean hierarchy: Icon + Bold Title, Subtle Visual Glimpse, Minimalist Footer
 * - Interactive "Magic" layer: Glass-morphism hover overlay with "Ask AI" button
 * - Visual polish: Softer borders, refined shadows, status dot indicator
 */

import { useCallback, useEffect, useRef, memo, useMemo, useState, lazy, Suspense } from "react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import {
  Edit3, Star, Trash2, Link2, Sparkles, GripVertical, Clock, Play, Eye,
} from "lucide-react";
import { FileTypeIcon } from "@/shared/components/FileTypeIcon";
import type { FileType } from "@/lib/fileTypes";
import { getThemeForFileType } from "@/lib/documentThemes";
import { getAIStatus, type DocumentCardData } from "../utils/documentHelpers";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { formatDistanceToNow } from "date-fns";
import { sanitizeDocumentTitle } from "@/lib/displayText";
import {
  SpreadsheetPreview,
  CodePreview,
  MarkdownPreview,
  NotePreview,
  EmptyStateOverlay,
} from "../../previews";
import { resolvePreviewDescriptor } from "../../previewDescriptor";
import { inferDocFileType } from "./cardFileTypeHelpers";

const LazyVisualGlimpse = lazy(() => import("./VisualGlimpse"));

export interface DocumentCardProps {
  doc: DocumentCardData;
  persistedTags?: Array<{ _id?: Id<"tags">; name: string; kind?: string; importance?: number }>;
  loadPersistedTags?: boolean;
  onSelect: (documentId: Id<"documents">) => void;
  onDelete?: (documentId: Id<"documents">) => void;
  onToggleFavorite?: (documentId: Id<"documents">) => void;
  hybrid?: boolean;
  isDragging?: boolean;
  onOpenMiniEditor?: (documentId: Id<"documents">, anchorEl: HTMLElement) => void;
  openOnSingleClick?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (documentId: Id<"documents">) => void;
  onCardMouseClick?: (documentId: Id<"documents">, e: React.MouseEvent) => boolean | void;
  onAnalyzeFile?: (doc: DocumentCardData) => void;
  analyzeRunning?: boolean;
  /** Handler for "Chat with this file" action */
  onChatWithFile?: (doc: DocumentCardData) => void;
  /** Enable drag-and-drop to agent */
  draggableToAgent?: boolean;
  /** Handler for opening media in cinema viewer (for images/videos) */
  onOpenMedia?: (doc: DocumentCardData) => void;
}

/** AI Status badge colors */
const AI_STATUS_CONFIG = {
  indexed: {
    dot: 'bg-green-500',
    bg: 'bg-green-50/80',
    border: 'border-green-100',
    text: 'text-green-700',
    label: 'AI Ready',
  },
  processing: {
    dot: 'bg-amber-500 motion-safe:animate-pulse',
    bg: 'bg-amber-50/80',
    border: 'border-amber-200',
    text: 'text-amber-700',
    label: 'AI Processing',
  },
  raw: {
    dot: 'bg-content-muted',
    bg: 'bg-surface-secondary',
    border: 'border-edge',
    text: 'text-content-secondary',
    label: 'AI Pending',
  },
} as const;

/** Format file size for display */
function formatFileSize(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DeferredPreviewPlaceholder({
  doc,
  typeGuess,
  isEmpty = false,
}: {
  doc: DocumentCardData;
  typeGuess: FileType;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <div className="w-full h-full relative">
        <MarkdownPreview hasContent={false} />
        <EmptyStateOverlay variant="empty" />
      </div>
    );
  }

  if (typeGuess === "image" || typeGuess === "video") {
    return (
      <div className="w-full h-full rounded-lg bg-gradient-to-br from-surface-secondary via-surface to-surface-hover flex items-center justify-center">
        <div className="flex items-center gap-1.5 rounded-full border border-edge bg-surface/90 px-2.5 py-1 text-[10px] font-medium text-content-secondary shadow-sm">
          {typeGuess === "video" ? (
            <Play className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
          Preview
        </div>
      </div>
    );
  }

  if (typeGuess === "csv" || typeGuess === "excel") {
    return <SpreadsheetPreview fileType={typeGuess} />;
  }

  if (typeGuess === "code" || typeGuess === "web" || typeGuess === "json") {
    return <CodePreview />;
  }

  if ((doc.documentType as string) === "document" && !doc.fileSize) {
    return <NotePreview />;
  }

  return <MarkdownPreview hasContent={!!doc.contentPreview} />;
}

export function DocumentCard({
  doc,
  persistedTags: providedPersistedTags,
  loadPersistedTags = true,
  onSelect,
  onDelete,
  onToggleFavorite,
  hybrid = true,
  isDragging = false,
  onOpenMiniEditor,
  openOnSingleClick = false,
  isSelected = false,
  onToggleSelect,
  onCardMouseClick,
  onAnalyzeFile,
  analyzeRunning,
  onChatWithFile,
  draggableToAgent = true,
  onOpenMedia,
}: DocumentCardProps) {
  const clickTimerRef = useRef<number | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const clickDelay = 250;

  const isLinkedAsset = !!(doc as any).dossierType && (doc as any).dossierType === "media-asset";
  const isDossier = !!(doc as any).dossierType && (doc as any).dossierType === "primary";

  // Image error state for fallback rendering
  const [hasImageError, setHasImageError] = useState(false);
  const [shouldRenderRichPreview, setShouldRenderRichPreview] = useState(false);
  const handleImageError = () => setHasImageError(true);

  // Empty file detection (size is 0 or no content)
  const isEmpty = useMemo(() => {
    if (doc.fileSize === 0) return true;
    // For NodeBench docs, check if content is empty
    if ((doc.documentType as string) === 'document' && !doc.contentPreview) return false; // Assume not empty unless we know
    return false;
  }, [doc.fileSize, doc.documentType, doc.contentPreview]);

  // Fetch tags from database
  const persistedTags = useQuery(
    api.tags.listForDocument,
    loadPersistedTags ? { documentId: doc._id } : "skip",
  );
  const resolvedPersistedTags = loadPersistedTags
    ? persistedTags
    : providedPersistedTags;

  // Memoized computed values
  const typeGuess = useMemo(() => inferDocFileType(doc), [doc]);
  const previewDescriptor = useMemo(
    () =>
      resolvePreviewDescriptor({
        fileType: doc.fileType,
        title: doc.title,
        contentPreview: doc.contentPreview,
        storageUrl: doc.csvUrl ?? doc.mediaUrl ?? doc.coverImage,
        isEmpty,
      }),
    [doc.fileType, doc.title, doc.contentPreview, doc.csvUrl, doc.mediaUrl, doc.coverImage, isEmpty],
  );
  const theme = useMemo(() => getThemeForFileType(typeGuess), [typeGuess]);
  const aiStatus = useMemo(() => getAIStatus(doc), [doc]);
  const statusConfig = AI_STATUS_CONFIG[aiStatus];
  const isMedia = typeGuess === 'image' || typeGuess === 'video';

  const activateRichPreview = useCallback(() => {
    setShouldRenderRichPreview(true);
  }, []);

  useEffect(() => {
    if (shouldRenderRichPreview) return;

    const node = previewContainerRef.current;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const scheduleActivate = () => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = (
          window as Window & {
            requestIdleCallback: (
              callback: () => void,
              options?: { timeout: number },
            ) => number;
          }
        ).requestIdleCallback(() => {
          setShouldRenderRichPreview(true);
        }, { timeout: 180 });
        return;
      }

      timeoutId = (window as Window).setTimeout(() => {
        setShouldRenderRichPreview(true);
      }, 80);
    };

    if (!node || typeof IntersectionObserver === "undefined") {
      scheduleActivate();
      return () => {
        if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
          (
            window as Window & {
              cancelIdleCallback: (handle: number) => void;
            }
          ).cancelIdleCallback(idleId);
        }
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          scheduleActivate();
        }
      },
      { rootMargin: "180px" },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (
          window as Window & {
            cancelIdleCallback: (handle: number) => void;
          }
        ).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [shouldRenderRichPreview]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  // Format time ago
  const timeAgo = useMemo(() => {
    const timestamp = doc.updatedAt || doc.createdAt;
    if (!timestamp) return null;
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: false });
    } catch {
      return null;
    }
  }, [doc.updatedAt, doc.createdAt]);

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(doc._id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(doc._id);
  };

  const handleChatClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChatWithFile?.(doc);
  };

  // Handle click on the visual glimpse area - opens media viewer for images/videos
  const handleGlimpseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMedia && onOpenMedia) {
      onOpenMedia(doc);
    }
  };

  // Drag handlers for agent integration
  const handleDragStart = (e: React.DragEvent) => {
    if (!draggableToAgent) return;
    e.dataTransfer.setData('application/x-document-node', JSON.stringify({
      id: doc._id,
          title: sanitizeDocumentTitle(doc.title),
      type: typeGuess,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      className="group relative"
      draggable={draggableToAgent}
      onDragStart={handleDragStart}
      onClick={(e) => {
        if (onCardMouseClick) {
          const handled = onCardMouseClick(doc._id, e);
          if (handled) return;
        }
        if (openOnSingleClick) {
          onSelect(doc._id);
          return;
        }
        if (clickTimerRef.current) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        const anchor = e.currentTarget as HTMLElement;
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null;
          onOpenMiniEditor?.(doc._id, anchor);
        }, clickDelay) as unknown as number;
      }}
      onDoubleClick={() => {
        if (clickTimerRef.current) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        onSelect(doc._id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(doc._id);
        }
      }}
    >
      {/* Card Container */}
      <div
        className={`
          bg-surface rounded-lg border p-3 h-52
          flex flex-col transition-all duration-200 ease-out cursor-pointer relative overflow-hidden

          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          ${isDragging ? "opacity-90 scale-[1.02] shadow-lg ring-2 ring-blue-400" : ""}
          ${isSelected
            ? "ring-1 ring-ring shadow-[0_0_0_4px_rgba(59,130,246,0.1)] bg-blue-50/30 border-blue-200"
            : "border-edge hover:shadow-md hover:border-primary/20"
          }
        `}
      >
        {/* Draggable grip indicator (top-left on hover) */}
        {draggableToAgent && (
          <div className="absolute top-1.5 left-1.5 z-10 opacity-0 group-hover:opacity-50 transition-opacity">
            <GripVertical className="w-3 h-3 text-content-muted" />
          </div>
        )}

        {/* Selection checkbox (top-right on hover or when selected) */}
        <div
          className={`absolute top-2 right-2 z-20 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(doc._id); }}
        >
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
            isSelected
              ? 'bg-blue-500 border-blue-500'
              : 'bg-surface border-edge hover:border-blue-400'
          }`}>
            {isSelected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {/* 1. HEADER: Small Icon + Bold 2-line Title */}
        <div className="flex items-start gap-2.5 mb-2">
          {/* Compact file type icon */}
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${theme.iconBg}`}>
            {(doc as any).icon ? (
              <span className="text-xs">{(doc as any).icon}</span>
            ) : (
              <div className="text-white">
                <FileTypeIcon type={typeGuess} className="h-3.5 w-3.5" />
              </div>
            )}
          </div>

          {/* Title (2-line max, bold) */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-semibold text-content text-sm leading-snug line-clamp-2 min-h-[2.5rem]" title={sanitizeDocumentTitle(doc.title)}>
              {sanitizeDocumentTitle(doc.title)}
            </h3>
          </div>
        </div>

        {/* 2. BODY: Visual Glimpse with Hover Overlay */}
        <div className="flex-1 min-h-0 mb-2 relative">
          <div
            ref={previewContainerRef}
            className={`w-full h-full rounded-lg border overflow-hidden bg-surface-secondary ${
              isEmpty ? 'border-dashed border-amber-200' : 'border-edge'
            } ${isMedia && onOpenMedia ? 'cursor-pointer' : ''}`}
            onMouseEnter={activateRichPreview}
            onFocusCapture={activateRichPreview}
            onClick={isMedia && onOpenMedia ? handleGlimpseClick : undefined}
          >
            {shouldRenderRichPreview ? (
              <Suspense fallback={<DeferredPreviewPlaceholder doc={doc} typeGuess={typeGuess} isEmpty={isEmpty} />}>
                <LazyVisualGlimpse
                  doc={doc}
                  typeGuess={typeGuess}
                  isEmpty={isEmpty}
                  hasImageError={hasImageError}
                  onImageError={handleImageError}
                />
              </Suspense>
            ) : (
              <DeferredPreviewPlaceholder
                doc={doc}
                typeGuess={typeGuess}
                isEmpty={isEmpty}
              />
            )}
          </div>

          {/* Glass-morphism Hover Overlay - different for media vs non-media */}
          {isMedia && onOpenMedia ? (
            // Media files: Show "View" overlay that opens cinema viewer
            <div
              className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 bg-black/20 backdrop-blur-[1px] cursor-pointer"
              onClick={handleGlimpseClick}
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface/90 text-content text-xs font-medium rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-200">
                <Play className="w-3 h-3" />
                {typeGuess === 'video' ? 'Play' : 'View'}
              </div>
            </div>
          ) : onChatWithFile ? (
            // Non-media files: Show "Ask AI" overlay
            <div className="absolute inset-0 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 bg-surface/50 backdrop-blur-[2px]">
              <button
                type="button"
                onClick={handleChatClick}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-content text-surface text-xs font-medium rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-200 hover:opacity-90"
              >
                <Sparkles className="w-3 h-3 text-purple-300" />
                Ask AI
              </button>
            </div>
          ) : null}
        </div>

        {/* 2.5. TAGS ROW: Micro-pills for semantic tags */}
        {resolvedPersistedTags && resolvedPersistedTags.length > 0 && (
          <div className="flex items-center gap-1 mb-1.5 overflow-x-auto no-scrollbar">
            {resolvedPersistedTags.slice(0, 3).map((tag: any, index: number) => {
              // Semantic color coding by tag kind
              const kindColors: Record<string, string> = {
                entity: 'bg-purple-50 text-purple-600 border-purple-100', // code key unchanged
                topic: 'bg-blue-50 text-blue-600 border-blue-100',
                community: 'bg-green-50 text-green-600 border-green-100',
                relationship: 'bg-orange-50 text-orange-600 border-orange-100',
                keyword: 'bg-surface-secondary text-content-secondary border-edge',
              };
              const colorClass = kindColors[tag.kind || 'keyword'] || kindColors.keyword;
              return (
                <span
                  key={tag._id ?? `${tag.name}:${index}`}
                  className={`px-1.5 py-0.5 text-[8px] font-medium rounded border whitespace-nowrap ${colorClass}`}
                  title={tag.kind ? `${tag.kind === 'entity' ? 'topic' : tag.kind}: ${tag.name}` : tag.name}
                >
                  #{tag.name}
                </span>
              );
            })}
            {resolvedPersistedTags.length > 3 && (
              <span className="text-[8px] text-content-muted whitespace-nowrap">+{resolvedPersistedTags.length - 3}</span>
            )}
          </div>
        )}

        {/* 3. FOOTER: Minimalist Metadata + Status Dot */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-edge">
          {/* Left: Type & Size */}
          <div className="flex items-center gap-1.5 text-xs text-content-muted min-w-0">
            <span className="font-semibold">
              {typeGuess === 'nbdoc' ? 'DOC' : typeGuess}
            </span>
            {formatFileSize(doc.fileSize) && (
              <>
                <span>•</span>
                <span className="text-content-secondary font-medium">{formatFileSize(doc.fileSize)}</span>
              </>
            )}
            {timeAgo && (
              <>
                <span>•</span>
                <span className="truncate">{timeAgo}</span>
              </>
            )}
          </div>

          {/* Right: Status Indicator */}
          <div className="flex items-center">
            <div
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border ${statusConfig.bg} ${statusConfig.border}`}
              title={statusConfig.label}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
              {aiStatus === 'processing' ? <Clock className={`w-3 h-3 ${statusConfig.text}`} /> : null}
              <span className={`text-xs font-semibold ${statusConfig.text}`}>{statusConfig.label}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons (visible on hover, positioned absolutely) */}
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 transition-opacity duration-200 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMiniEditor?.(doc._id, e.currentTarget as HTMLElement);
            }}
            className="w-6 h-6 rounded-md flex items-center justify-center bg-surface/90 hover:bg-surface-hover text-content-secondary hover:text-content transition-colors shadow-sm border border-edge"
            title="Quick edit"
          >
            <Edit3 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handlePinClick}
            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors shadow-sm border ${
              (doc as any).isFavorite
                ? "bg-amber-50 border-amber-200 text-amber-600"
                : "bg-surface/90 border-edge hover:bg-surface-hover text-content-secondary hover:text-amber-500"
            }`}
            title={(doc as any).isFavorite ? "Unpin" : "Pin"}
          >
            <Star className={`h-3 w-3 ${(doc as any).isFavorite ? "fill-current" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleDeleteClick}
            className="w-6 h-6 rounded-md flex items-center justify-center bg-surface/90 hover:bg-red-50 text-content-secondary hover:text-red-500 transition-colors shadow-sm border border-edge"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        {/* Dossier/Linked indicator (small badge at bottom-left) */}
        {(isDossier || isLinkedAsset) && (
          <div className="absolute bottom-2 left-2">
            {isDossier && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-md bg-purple-50/90 text-purple-600 border border-purple-100">
                Report
              </span>
            )}
            {isLinkedAsset && !isDossier && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded-md bg-purple-50/90 text-purple-600 border border-purple-100" title="Linked asset">
                <Link2 className="h-2 w-2" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized wrapper to prevent unnecessary re-renders
export const DocumentCardMemo = memo(DocumentCard);
