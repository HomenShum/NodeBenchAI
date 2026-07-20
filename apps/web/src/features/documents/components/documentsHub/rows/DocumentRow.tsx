/**
 * DocumentRow Component
 *
 * A high-density row optimized for document scanning with:
 * - Name & Format with file icon
 * - AI Tags (colorful pills) - fetched from database or inferred from file type
 * - Intelligence Status indicator
 * - Meta (Date Modified and Size)
 * - Hover-only actions
 */

import { memo, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Calendar, Star, Trash2, MessageCircle, Loader2, Sparkles, Edit3, Share2 } from "lucide-react";
import { FileTypeIcon } from "@/shared/components/FileTypeIcon";
import { sanitizeDocumentTitle } from "@/lib/displayText";
import { inferFileType, type FileType } from "@/lib/fileTypes";
import { getThemeForFileType } from "@/lib/documentThemes";
import type { DocumentCardData } from "../utils/documentHelpers";

// ============================================================================
// Types
// ============================================================================

export interface DocumentRowProps {
  doc: DocumentCardData;
  persistedTags?: Array<{ name: string; kind?: string }>;
  loadPersistedTags?: boolean;
  isSelected?: boolean;
  onSelect: (documentId: Id<"documents">) => void;
  onToggleSelect?: (documentId: Id<"documents">) => void;
  onToggleFavorite?: (documentId: Id<"documents">) => void;
  onDelete?: (documentId: Id<"documents">) => void;
  onChat?: (documentId: Id<"documents">) => void;
  onEdit?: (documentId: Id<"documents">) => void;
  onShare?: (documentId: Id<"documents">) => void;
  density?: "compact" | "comfortable"; // Kept for compatibility, though unused in new design
}

// ============================================================================
// Helpers
// ============================================================================

function getIntelligenceStatus(doc: DocumentCardData): {
  label: string;
  variant: "ready" | "analyzing" | "raw";
} {
  // Check for AI indicators on the document
  const hasEmbeddings = !!(doc as any).embeddingId || !!(doc as any).vectorStoreFileId;
  const isProcessing = (doc as any).processingStatus === "processing";

  if (hasEmbeddings) {
    return { label: "AI Ready", variant: "ready" };
  }
  if (isProcessing) {
    return { label: "Analyzing...", variant: "analyzing" };
  }
  return { label: "Raw", variant: "raw" };
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "—";

  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Get semantic color styling for tags based on their kind
 * - entity: Purple (companies, products, people)
 * - topic: Blue (broader themes)
 * - keyword: Gray (single terms)
 * - community: Green (groups, ecosystems)
 * - relationship: Orange (connections)
 */
function getTagStyle(kind?: string, fallbackStyle?: string): string {
  switch (kind) {
    case "entity":
      return "bg-purple-500/10 text-purple-600 border border-purple-500/20";
    case "topic":
      return "bg-blue-500/10 text-blue-600 border border-blue-500/20";
    case "community":
      return "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20";
    case "relationship":
      return "bg-orange-500/10 text-orange-600 border border-orange-500/20";
    case "keyword":
    default:
      return fallbackStyle || "bg-surface-hover text-content-secondary border border-edge";
  }
}

// ============================================================================
// Component
// ============================================================================

export const DocumentRow = memo(function DocumentRow({
  doc,
  persistedTags: providedPersistedTags,
  loadPersistedTags = true,
  isSelected = false,
  onSelect,
  onToggleSelect,
  onToggleFavorite,
  onDelete,
  onChat,
  onEdit,
  onShare,
}: DocumentRowProps) {
  // Infer file type for theming
  const typeGuess: FileType = useMemo(() => {
    if (doc.documentType === "file") {
      const ft = String(doc.fileType || "").toLowerCase();
      if (["video", "audio", "image", "csv", "pdf", "excel", "json", "text", "code", "web", "document"].includes(ft)) {
        return ft as FileType;
      }
      return inferFileType({ name: doc.fileName || doc.title });
    }
    return inferFileType({ name: doc.title, isNodebenchDoc: true });
  }, [doc.documentType, doc.fileType, doc.fileName, doc.title]);

  const theme = getThemeForFileType(typeGuess);
  const status = getIntelligenceStatus(doc);

  // Fetch persisted tags from database (LLM-generated)
  const persistedTags = useQuery(
    api.tags.listForDocument,
    loadPersistedTags ? { documentId: doc._id } : "skip",
  );
  const resolvedPersistedTags = loadPersistedTags
    ? persistedTags
    : providedPersistedTags;

  // Get tags: prefer persisted LLM-generated tags, fall back to file-type inference
  const tags: Array<{ name: string; kind?: string }> = useMemo(() => {
    // If we have persisted tags from the database, use them
    if (resolvedPersistedTags && resolvedPersistedTags.length > 0) {
      return resolvedPersistedTags.slice(0, 4).map((t) => ({
        name: t.name,
        kind: t.kind,
      }));
    }

    // Fall back to simple file-type-based tags
    const fallbackTags: Array<{ name: string; kind?: string }> = [];

    if (doc.documentType === "file") {
      switch (typeGuess) {
        case "excel":
        case "csv":
          fallbackTags.push({ name: "finance", kind: "topic" }, { name: "data", kind: "keyword" });
          break;
        case "pdf":
          fallbackTags.push({ name: "research", kind: "topic" }, { name: "report", kind: "keyword" });
          break;
        case "image":
          fallbackTags.push({ name: "media", kind: "keyword" }, { name: "asset", kind: "keyword" });
          break;
        case "video":
          fallbackTags.push({ name: "content", kind: "keyword" }, { name: "video", kind: "keyword" });
          break;
        case "audio":
          fallbackTags.push({ name: "media", kind: "keyword" }, { name: "audio", kind: "keyword" });
          break;
        case "code":
        case "web":
          fallbackTags.push({ name: "code", kind: "keyword" }, { name: "dev", kind: "topic" });
          break;
        case "json":
          fallbackTags.push({ name: "data", kind: "keyword" }, { name: "config", kind: "keyword" });
          break;
        case "text":
          fallbackTags.push({ name: "notes", kind: "keyword" }, { name: "text", kind: "keyword" });
          break;
        default:
          fallbackTags.push({ name: typeGuess, kind: "keyword" });
      }
    } else if (doc.documentType === "timeline") {
      fallbackTags.push({ name: "timeline", kind: "keyword" }, { name: "agent", kind: "entity" });
    } else {
      // NodeBench documents - infer from title
      const title = doc.title.toLowerCase();
      if (title.includes("calendar") || title.includes("📅")) {
        fallbackTags.push({ name: "calendar", kind: "keyword" }, { name: "schedule", kind: "topic" });
      } else if (title.includes("note") || title.includes("📝")) {
        fallbackTags.push({ name: "notes", kind: "keyword" }, { name: "daily", kind: "topic" });
      } else if (title.includes("chat")) {
        fallbackTags.push({ name: "chat", kind: "keyword" }, { name: "conversation", kind: "topic" });
      } else if (title.includes("analysis")) {
        fallbackTags.push({ name: "analysis", kind: "topic" }, { name: "ai", kind: "entity" });
      } else if (title.includes("dossier") || title.includes("example:")) {
        fallbackTags.push({ name: "dossier", kind: "keyword" }, { name: "research", kind: "topic" });
      } else if (title.includes("agent")) {
        fallbackTags.push({ name: "agent", kind: "entity" }, { name: "timeline", kind: "keyword" });
      } else {
        fallbackTags.push({ name: "document", kind: "keyword" });
      }
    }

    return fallbackTags;
  }, [doc, resolvedPersistedTags, typeGuess]);

  // Check if tags are LLM-generated (from database)
  const hasAITags = !!(resolvedPersistedTags && resolvedPersistedTags.length > 0);

  const isFavorite = !!(doc as any).isFavorite;
  const modifiedAt = (doc as any).updatedAt || (doc as any)._creationTime;
  const fileSize = (doc as any).size || (doc as any).fileSize;

  return (
    <div
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          onToggleSelect?.(doc._id);
        } else {
          onSelect(doc._id);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(doc._id);
        }
      }}
      role="button"
      tabIndex={0}
      className={`
        group flex items-center gap-4 px-4 py-3 
        border-b border-edge 
        hover:bg-surface-hover cursor-pointer 
        transition-colors duration-150
        ${isSelected ? "bg-indigo-600/10" : ""}
      `}
    >
      {/* 1. Selection Checkbox */}
      <div className="w-6 flex justify-center shrink-0">
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(doc._id);
          }}
          className={`
            w-4 h-4 rounded border transition-all duration-150 flex items-center justify-center
            ${isSelected
              ? "bg-indigo-600 border-indigo-500/30"
              : "border-edge bg-surface opacity-0 group-hover:opacity-100"
            }
          `}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      </div>

      {/* 2. Name & Icon */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <div className={`p-2 rounded-lg shrink-0 ${theme.iconBg}`}>
          <FileTypeIcon type={typeGuess} className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-content truncate">
            {sanitizeDocumentTitle(doc.title)}
          </span>
          <span className="text-xs text-content-muted truncate">
            {typeGuess.toUpperCase()} {fileSize ? `• ${formatFileSize(fileSize)}` : ""}
          </span>
        </div>
      </div>

      {/* 3. Tags Column - Semantic color coding by tag kind */}
      <div className="w-48 hidden md:flex items-center gap-1.5">
        {tags.slice(0, 3).map((tag, i) => {
          // Semantic color coding based on tag kind
          const tagStyle = getTagStyle(tag.kind, i === 0 ? theme.label : undefined);
          return (
            <span
              key={i}
              className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${tagStyle}`}
              title={tag.kind ? `${tag.kind}: ${tag.name}` : tag.name}
            >
              #{tag.name}
            </span>
          );
        })}
        {tags.length > 3 && (
          <span className="text-xs text-content-muted">+{tags.length - 3}</span>
        )}
        {hasAITags && (
          <Sparkles className="w-3 h-3 text-purple-400 ml-0.5" aria-label="AI-generated tags" />
        )}
      </div>

      {/* 4. AI Status */}
      <div className="w-28 hidden lg:flex items-center">
        {status.variant === "ready" ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 text-xs font-medium border border-indigo-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {status.label}
          </div>
        ) : status.variant === "analyzing" ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium border border-amber-500/20">
            <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
            {status.label}
          </div>
        ) : (
          <span className="text-xs text-content-muted">{status.label}</span>
        )}
      </div>

      {/* 5. Date Modified */}
      <div className="w-24 hidden sm:flex items-center gap-2 text-xs text-content-secondary">
        <Calendar className="w-3 h-3 text-content-muted" />
        <span>{formatRelativeTime(modifiedAt)}</span>
      </div>

      {/* 6. Actions (Hover only) - Intelligence Table action toolbar */}
      <div className="w-28 flex justify-end items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {/* Primary actions */}
        {onChat && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChat(doc._id);
            }}
            title="Chat with AI"
            className="p-1.5 hover:bg-indigo-600/10 rounded text-content-muted hover:text-indigo-600 dark:text-indigo-400 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(doc._id);
            }}
            title="Quick Edit"
            className="p-1.5 hover:bg-blue-500/10 rounded text-content-muted hover:text-blue-500 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare(doc._id);
            }}
            title="Share"
            className="p-1.5 hover:bg-indigo-500/10 rounded text-content-muted hover:text-indigo-500 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Secondary actions */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(doc._id);
          }}
          title={isFavorite ? "Unpin" : "Pin"}
          className={`p-1.5 rounded transition-colors ${isFavorite
            ? "text-yellow-500 hover:bg-yellow-500/10"
            : "text-content-muted hover:text-yellow-500 hover:bg-surface"
            }`}
        >
          <Star className={`w-3.5 h-3.5 ${isFavorite ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(doc._id);
          }}
          title="Delete"
          className="p-1.5 hover:bg-red-500/10 rounded text-content-muted hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
