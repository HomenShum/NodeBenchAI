import React, { useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FileStack, ExternalLink, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { FileTypeIcon } from "@/shared/components/FileTypeIcon";

export default function DossierMiniEditor({ 
  documentId, 
  onClose,
  onOpenFull,
}: { 
  documentId: Id<"documents">; 
  onClose: () => void;
  onOpenFull?: () => void;
}) {
  const dossier = useQuery(api.domains.documents.documents.getById, { documentId });
  const linkedAssets = useQuery(api.domains.documents.documents.getLinkedAssets, { dossierId: documentId });

  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const handleCopyTranscript = useCallback(async () => {
    if (!dossier?.content) return;

    try {
      // Parse EditorJS content and extract plain text
      const content = JSON.parse(dossier.content);
      const blocks = content.blocks || [];

      // Helper function to strip HTML tags and decode entities
      const stripHtml = (html: string): string => {
        if (!html) return '';
        // Create a temporary div to decode HTML entities
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || '';
      };

      const plainText = blocks
        .map((block: any) => {
          switch (block.type) {
            case "header":
              return stripHtml(block.data.text || '');
            case "paragraph":
              return stripHtml(block.data.text || '');
            case "list":
              // Handle ordered and unordered lists
              const items = (block.data.items || []).map((item: string, idx: number) => {
                const prefix = block.data.style === 'ordered' ? `${idx + 1}. ` : '• ';
                return prefix + stripHtml(item);
              });
              return items.join('\n');
            case "delimiter":
              return "---";
            case "quote":
              return `"${stripHtml(block.data.text || '')}"`;
            case "code":
              return `\`\`\`\n${block.data.code || ''}\n\`\`\``;
            case "table":
              // Simple table representation
              return (block.data.content || [])
                .map((row: string[]) => row.map(stripHtml).join(' | '))
                .join('\n');
            default:
              // For any other block type, try to extract text
              if (block.data?.text) {
                return stripHtml(block.data.text);
              }
              return '';
          }
        })
        .filter(Boolean)
        .join("\n\n");

      await navigator.clipboard.writeText(plainText);
      setCopiedTranscript(true);
      toast.success("Transcript copied to clipboard");
      setTimeout(() => setCopiedTranscript(false), 2000);
    } catch (error) {
      console.error("Failed to copy transcript:", error);
      toast.error("Failed to copy transcript");
    }
  }, [dossier?.content]);

  if (dossier === undefined || linkedAssets === undefined) {
    return (
      <div className="mt-1 rounded-md p-3 bg-surface border border-edge/60">
        <div className="motion-safe:animate-pulse space-y-3">
          <div className="h-4 w-32 bg-surface-secondary rounded" />
          <div className="h-3 w-48 bg-surface-secondary rounded" />
          <div className="h-20 bg-surface-secondary rounded" />
        </div>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="mt-1 rounded-md p-3 bg-surface border border-edge/60">
        <div className="text-sm text-content-secondary">Report not found</div>
      </div>
    );
  }

  // Parse content to get message count
  let messageCount = 0;
  try {
    const content = JSON.parse(dossier.content || "{}");
    const blocks = content.blocks || [];
    // Count header blocks with "User" or "Assistant" in them
    messageCount = blocks.filter((b: any) => 
      b.type === "header" && 
      b.data?.text && 
      (b.data.text.includes("User") || b.data.text.includes("Assistant"))
    ).length;
  } catch {
    // Ignore parse errors
  }

  const assetCount = linkedAssets?.length || 0;

  return (
    <div
      className="mt-1 rounded-md p-3 bg-surface border border-edge/60 transition-all relative z-10 pointer-events-auto"
      data-inline-editor="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <FileStack className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-content truncate">
              {dossier.title}
            </div>
            <div className="text-xs text-content-secondary mt-0.5">
              {messageCount} messages • {assetCount} assets
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 p-1 hover:bg-surface-secondary rounded transition-colors"
          title="Close"
          aria-label="Close report preview"
        >
          <X className="w-4 h-4 text-content-secondary" />
        </button>
      </div>

      {/* Linked Assets Carousel */}
      {linkedAssets && linkedAssets.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-content-secondary mb-2">
            Attachments
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-edge scrollbar-track-transparent">
            {linkedAssets.map((asset) => (
              <AssetThumbnail key={asset._id} asset={asset} />
            ))}
          </div>
        </div>
      )}

      {/* Transcript Preview */}
      <div className="mb-3">
        <div className="text-xs font-medium text-content-secondary mb-2 flex items-center justify-between">
          <span>Chat Transcript</span>
          <span className="text-xs text-[var(--text-tertiary)] font-normal">
            Use "Copy Transcript" button below
          </span>
        </div>
        <div
          className="max-h-[240px] overflow-y-auto text-xs text-content-secondary bg-surface-secondary rounded-md p-2 border border-edge/40 select-none"
          title="Use the Copy Transcript button to copy this content"
        >
          {(() => {
            try {
              const content = JSON.parse(dossier.content || "{}");
              const blocks = content.blocks || [];

              // Helper to strip HTML
              const stripHtml = (html: string): string => {
                if (!html) return '';
                const temp = document.createElement('div');
                temp.innerHTML = html;
                return temp.textContent || temp.innerText || '';
              };

              return blocks.slice(0, 10).map((block: any, idx: number) => {
                if (block.type === "header") {
                  return (
                    <div key={idx} className="font-medium text-content mt-2 first:mt-0">
                      {stripHtml(block.data.text || '')}
                    </div>
                  );
                } else if (block.type === "paragraph") {
                  const text = stripHtml(block.data.text || '');
                  return (
                    <div key={idx} className="mt-1">
                      {text}
                    </div>
                  );
                } else if (block.type === "delimiter") {
                  return (
                    <div key={idx} className="my-2 border-t border-edge/40" />
                  );
                }
                return null;
              });
            } catch {
              return <div className="text-[var(--text-tertiary)]">Unable to preview transcript</div>;
            }
          })()}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCopyTranscript}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-secondary hover:bg-surface-secondary text-content rounded-md transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          {copiedTranscript ? "Copied!" : "Copy Transcript"}
        </button>
        {onOpenFull && (
          <button
            type="button"
            onClick={onOpenFull}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded-md transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Full View
          </button>
        )}
      </div>
    </div>
  );
}

function AssetThumbnail({ asset }: { asset: any }) {
  const assetType = asset.assetMetadata?.assetType || asset.fileType || "file";
  const title = asset.title || "Untitled";
  const thumbnailUrl = asset.assetMetadata?.thumbnailUrl;
  const sourceUrl = asset.assetMetadata?.sourceUrl;

  return (
    <a
      href={sourceUrl || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-24 group"
      title={title}
    >
      <div className="relative w-24 h-16 rounded-md overflow-hidden bg-surface-secondary border border-edge/40 group-hover:border-indigo-500/30/40 transition-colors">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileTypeIcon type={assetType as any} className="w-6 h-6 text-[var(--text-tertiary)]" />
          </div>
        )}
        {/* Type badge */}
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded text-xs font-medium text-white">
          {assetType}
        </div>
      </div>
      <div className="mt-1 text-xs text-content-secondary truncate">
        {title}
      </div>
    </a>
  );
}

