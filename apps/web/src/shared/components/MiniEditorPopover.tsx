import React, { Suspense, useMemo, Component, type ReactNode, type ErrorInfo } from "react";
import { Id } from "@convex/_generated/dataModel";
import { X } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ai-ui/popover";

// Lazy-load heavy editors so they don't bloat the main bundle.
const UnifiedEditor = React.lazy(() => import("@features/editor/components/UnifiedEditor"));
const SpreadsheetMiniEditor = React.lazy(() => import("@/features/documents/editors/SpreadsheetMiniEditor"));
const DossierMiniEditor = React.lazy(() => import("@/features/documents/editors/DossierMiniEditor"));

// Error boundary to gracefully handle editor initialization failures
class EditorErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[EditorErrorBoundary] Editor failed to load:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
          Failed to load editor. The document may have invalid content.
        </div>
      );
    }
    return this.props.children;
  }
}

interface MiniEditorPopoverProps {
  isOpen: boolean;
  documentId: Id<"documents"> | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export default function MiniEditorPopover({ isOpen, documentId, anchorEl, onClose }: MiniEditorPopoverProps) {
  const virtualAnchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
  if (!documentId || !anchorEl) return null;

  return (
    <Popover open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
      role="dialog"
      aria-modal="false"
      aria-label="Mini editor"
      side="bottom"
      align="start"
      sideOffset={8}
      collisionPadding={8}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="z-[70] w-[min(640px,calc(100vw-24px))] shadow-2xl rounded-lg border border-edge bg-surface p-0"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge bg-surface-secondary dark:bg-gray-800 rounded-t-xl">
        <div className="text-xs text-content-secondary">Quick Edit</div>
        <button
          type="button"
          aria-label="Close mini editor"
          className="w-7 h-7 p-1.5 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover dark:hover:bg-gray-700 border border-edge text-content-secondary"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3 max-h-[360px] overflow-auto bg-surface rounded-b-xl">
        <MiniContent documentId={documentId} onClose={onClose} />
      </div>
      </PopoverContent>
    </Popover>
  );
}

function MiniContent({ documentId, onClose }: { documentId: Id<"documents">; onClose: () => void }) {
  const document = useQuery(api.domains.documents.documents.getById, { documentId });
  const fileDoc = useQuery(api.domains.documents.fileDocuments.getFileDocument, { documentId });

  if (document === undefined || fileDoc === undefined) {
    return (
      <div className="space-y-2">
        <div className="motion-safe:animate-pulse h-4 w-24 bg-surface rounded" />
        <div className="motion-safe:animate-pulse h-8 w-full bg-surface rounded" />
      </div>
    );
  }

  // Check if this is a dossier document
  if (document?.dossierType === "primary") {
    return (
      <div className="min-h-[240px]">
        <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
          <DossierMiniEditor documentId={documentId} onClose={onClose} />
        </Suspense>
      </div>
    );
  }

  if (!fileDoc) {
    // Not a file document or no access: fall back to unified document quick editor
    return (
      <div className="min-h-[240px]">
        <EditorErrorBoundary>
          <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
            <UnifiedEditor documentId={documentId} mode="quickNote" />
          </Suspense>
        </EditorErrorBoundary>
      </div>
    );
  }
  // Open spreadsheet mini editor for CSV or Excel (by stored type OR filename extension)
  {
    const name = String(fileDoc?.file?.fileName || '').toLowerCase();
    const ft = String(fileDoc?.document?.fileType || '').toLowerCase();
    const isSpreadsheet = ft === 'csv' || ft === 'excel' || /\.(xlsx?)$/.test(name) || /\.csv$/.test(name);
    if (isSpreadsheet) {
      return (
        <div className="min-h-[240px]">
          <Suspense fallback={<div className="text-xs text-content-secondary">Loading spreadsheet…</div>}>
            <SpreadsheetMiniEditor documentId={documentId} onClose={onClose} />
          </Suspense>
        </div>
      );
    }
  }
  return (
    <div className="min-h-[240px]">
      <EditorErrorBoundary>
        <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
          <UnifiedEditor documentId={documentId} mode="quickNote" />
        </Suspense>
      </EditorErrorBoundary>
    </div>
  );
}
