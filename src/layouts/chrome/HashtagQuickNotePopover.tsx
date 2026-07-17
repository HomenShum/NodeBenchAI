import React, { useMemo } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { X, ExternalLink } from "lucide-react";
import { useQuery, useMutation, useAction} from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { toast } from "sonner";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ai-ui/popover";

interface HashtagQuickNotePopoverProps {
  isOpen: boolean;
  dossierId: Id<"documents"> | null;
  hashtag: string | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export default function HashtagQuickNotePopover({
  isOpen,
  dossierId,
  hashtag,
  anchorEl,
  onClose,
}: HashtagQuickNotePopoverProps) {
  const virtualAnchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
  if (!dossierId || !anchorEl) return null;

  return (
    <Popover open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="z-[9999] w-[min(640px,calc(100vw-16px))] max-h-[420px] bg-surface border border-edge rounded-lg shadow-2xl overflow-hidden p-0"
      >
      <HashtagContent dossierId={dossierId} hashtag={hashtag || ""} onClose={onClose} />
      </PopoverContent>
    </Popover>
  );
}

function HashtagContent({
  dossierId,
  hashtag,
  onClose,
}: {
  dossierId: Id<"documents">;
  hashtag: string;
  onClose: () => void;
}) {
  const api = useConvexApi();
  const reindexMyDocuments = useAction((api as any)?.domains?.search?.ragEnhancedBatchIndex?.reindexMyDocuments);
  const [isReindexing, setIsReindexing] = React.useState(false);

  const handleReindex = async () => {
    try {
      setIsReindexing(true);
      const res: any = await reindexMyDocuments({});
      toast.success(`Re-indexed ${res?.totalSuccess ?? 0}/${res?.totalProcessed ?? 0} documents`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Re-index failed: ${msg}`);
    } finally {
      setIsReindexing(false);
    }
  };

  const document = useQuery((api as any)?.domains?.documents?.documents?.getById ?? "skip", { documentId: dossierId } as any);

  const handleOpenFullDossier = () => {
    window.dispatchEvent(
      new CustomEvent("nodebench:openDocument", {
        detail: { documentId: dossierId },
      })
    );
    onClose();
  };

  if (document === undefined) {
    return (
      <div className="p-6 space-y-4">
        <div className="motion-safe:animate-pulse h-6 w-32 bg-surface-secondary rounded" />
        <div className="motion-safe:animate-pulse h-4 w-full bg-surface-secondary rounded" />
        <div className="motion-safe:animate-pulse h-4 w-3/4 bg-surface-secondary rounded" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="p-6">
        <p className="text-sm text-content-muted">Hashtag document not found</p>
      </div>
    );
  }

  // Parse TipTap content to extract context
  const contextItems: Array<{ title: string; snippet?: string; matchType: string; documentId?: string }> = [];
  try {
    const content = JSON.parse(document.content || "{}");
    if (content.content && Array.isArray(content.content)) {
      // Extract paragraphs that contain document references
      // New format: { type: "paragraph", content: [{ type: "text", text: "🎯 " }, { type: "text", text: "@", }, { type: "text", text: "Title", marks: [{ type: "link", attrs: { href: "/documents/id" } }] }, { type: "text", text: " (95%)" }] }

      let currentSnippet: string | undefined;

      content.content.forEach((node: any, idx: number) => {
        if (node.type === "paragraph" && node.content) {
          // Check if this paragraph has a link (document reference)
          const hasLink = node.content.some((c: any) =>
            c.marks?.some((m: any) => m.type === "link" && m.attrs?.href?.startsWith("/documents/"))
          );

          if (hasLink) {
            // Extract badge emoji to determine match type
            const badgeText = node.content.find((c: any) => c.type === "text" && /[🎯📍📄🔍]/.test(c.text))?.text || "";
            const matchType =
              badgeText.includes("🎯") ? "hybrid" :
              badgeText.includes("📍") ? "exact" :
              badgeText.includes("📄") ? "exact-content" :
              "semantic";

            // Extract title from link text
            const linkNode = node.content.find((c: any) =>
              c.marks?.some((m: any) => m.type === "link")
            );
            const title = linkNode?.text || "";

            // Extract document ID from link href
            const linkMark = linkNode?.marks?.find((m: any) => m.type === "link");
            const href = linkMark?.attrs?.href || "";
            const documentId = href.split("/documents/")[1] || undefined;

            if (title) {
              contextItems.push({
                title,
                matchType,
                documentId,
                snippet: currentSnippet,
              });
              currentSnippet = undefined; // Reset snippet after using it
            }
          } else {
            // Check if this is a snippet paragraph (italic text)
            const isSnippet = node.content.some((c: any) =>
              c.marks?.some((m: any) => m.type === "italic")
            );

            if (isSnippet) {
              // Store snippet for next document reference
              currentSnippet = node.content
                .map((c: any) => c.text || "")
                .join("")
                .trim();
            }
          }
        }

    });
    }
  } catch (error) {
    console.error("[HashtagQuickNotePopover] Error parsing content:", error);
  }

  return (
    <div className="flex flex-col h-full max-h-[420px]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-surface-secondary">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-content">#{hashtag}</h3>
          <span className="text-xs text-content-muted bg-surface px-2 py-1 rounded">
            {contextItems.length} related {contextItems.length === 1 ? "document" : "documents"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReindex}
            disabled={isReindexing}
            className="px-2 py-1 text-xs border rounded-md hover:bg-surface-hover disabled:opacity-60"
            title="Re-index your documents into Enhanced RAG so hashtag search uses LLM validation"
          >
            {isReindexing ? "Re-indexing…" : "Re-index RAG"}
          </button>
          <button
            onClick={handleOpenFullDossier}
            className="p-2 hover:bg-surface-hover rounded-md transition-colors"
            title="Open full document"
            aria-label="Open full document"
          >
            <ExternalLink className="w-4 h-4 text-content-muted" />
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-hover rounded-md transition-colors"
            title="Close"
            aria-label="Close note"
          >
            <X className="w-4 h-4 text-content-muted" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {contextItems.length === 0 ? (
          <div className="text-center py-8 px-6">
            <p className="text-sm text-content-muted italic">
              No related documents found yet. Context is being gathered...
            </p>
            <button
              onClick={handleOpenFullDossier}
              className="mt-4 text-sm text-[var(--accent-primary)] hover:underline"
            >
              Open full document to see details
            </button>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {contextItems.map((item, idx) => (
              <div key={idx}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.documentId) {
                      // Open the specific document
                      window.dispatchEvent(
                        new CustomEvent("nodebench:openDocument", {
                          detail: { documentId: item.documentId },
                        })
                      );
                      onClose();
                    } else {
                      // Fallback: open the dossier
                      handleOpenFullDossier();
                    }
                  }}
                  className="block w-full text-left p-3 rounded-lg border border-edge hover:border-[var(--accent-primary)]/30 transition-all group cursor-pointer"
                >
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-content line-clamp-2 group-hover:text-[var(--accent-primary)] transition-colors">
                        {item.matchType === "hybrid" ? "🎯" :
                         item.matchType === "exact" || item.matchType === "exact-title" || item.matchType === "exact-hybrid" ? "📍" :
                         item.matchType === "exact-content" ? "📄" :
                         "🔍"}{" "}
                        {item.title}
                      </h4>
                      {item.snippet && (
                        <p className="text-xs text-content-muted mt-1 line-clamp-2">
                          {item.snippet}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-edge bg-surface-secondary">
        <p className="text-xs text-content-muted">
          💡 <strong>Tip:</strong> Double-click the hashtag to open the full document view
        </p>
      </div>
    </div>
  );
}
