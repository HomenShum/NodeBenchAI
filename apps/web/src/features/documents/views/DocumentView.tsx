import { useQuery } from "convex/react";
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { DocumentHeader } from "@/features/documents/components/DocumentHeader";
// Editor wrapper with UnifiedEditor (BlockNote/ProseMirror)
import { Editor } from "@/components/Editor/Editor";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { isValidConvexId } from "@/lib/ids";

const UnifiedEditor = lazy(() => import("@features/editor/components/UnifiedEditor"));
const FileViewer = lazy(() =>
  import("@/features/documents/views/FileViewer").then((mod) => ({ default: mod.FileViewer })),
);
const SpreadsheetView = lazy(() =>
  import("@/features/documents/views/SpreadsheetView").then((mod) => ({ default: mod.SpreadsheetView })),
);
const DossierViewer = lazy(() =>
  import("@/features/research/views/DossierViewer").then((mod) => ({ default: mod.DossierViewer })),
);

const viewFallback = (
  <div className="flex items-center justify-center h-full bg-surface">
    <div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500/30"></div>
  </div>
);

interface DocumentViewProps {
  documentId: Id<"documents">;
  isGridMode?: boolean;
  isFullscreen?: boolean;
}

// tiny, local pointer gate (matches Editor's logic)
function usePointerGate() {
  const downRef = useRef(false);

  useEffect(() => {
    const onDown = () => (downRef.current = true);
    const onUp = () => (downRef.current = false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, []);

  const waitForPointerUp = useCallback(() => {
    if (!downRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("pointerup", done, true);
        resolve();
      };
      window.addEventListener("pointerup", done, true);
    });
  }, []);

  // blocks the one stale mouseup that PM registered before we unmount
  const blockNextMouseUpIfNeeded = useCallback(() => {
    if (!downRef.current) return;
    const blockOnce = (e: Event) => {
      try { (e as any).stopImmediatePropagation?.(); } catch { /* noop */ }
      window.removeEventListener("mouseup", blockOnce, true);
    };
    window.addEventListener("mouseup", blockOnce, true);
  }, []);

  return { isPointerDown: () => downRef.current, waitForPointerUp, blockNextMouseUpIfNeeded } as const;
}

export function DocumentView({ documentId, isGridMode = false, isFullscreen = false }: DocumentViewProps) {
  // Validate id before issuing any Convex query. When invalid, skip the query entirely.
  const isValidId = isValidConvexId(documentId);
  const document = useQuery(api.domains.documents.documents.getById, isValidId ? { documentId } : "skip");
  // Gate editor swap on pointer-up to avoid ProseMirror mouseup-after-destroy race
  const [mountedDocId, setMountedDocId] = useState<Id<"documents">>(documentId);
  const prevDocIdRef = useRef<Id<"documents">>(documentId);
  const { waitForPointerUp, blockNextMouseUpIfNeeded } = usePointerGate();

  // When documentId changes, delay swapping the Editor until after pointer-up (unconditional hook)
  useEffect(() => {
    if (documentId === prevDocIdRef.current) return;
    let cancelled = false;
    void (async () => {
      blockNextMouseUpIfNeeded();
      await waitForPointerUp();
      // next frame to let native handlers unwind
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (!cancelled) {
        setMountedDocId(documentId);
        prevDocIdRef.current = documentId;
      }
    })();
    return () => { cancelled = true; };
  }, [documentId, waitForPointerUp, blockNextMouseUpIfNeeded]);

  // Render branch only in JSX (no early hook returns)
  const isSpreadsheetDocument = !!document && document.documentType === "file" && document.fileType === "csv";
  const shouldShowHeader = !isGridMode || isFullscreen;
  const shouldShowCoverImage = shouldShowHeader && !!document && !isSpreadsheetDocument;

  // Feature flag: allow testing UnifiedEditor in place of legacy Editor via URL or localStorage
  const useUnifiedEditorFlag = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("ue");
      if (q === "1" || q === "true") return true;
      const ls = window.localStorage.getItem("useUnifiedEditor");
      return ls === "1" || ls === "true";
    } catch {
      return false;
    }
  })();

  // Determine if this viewer can edit: owner or public+allowPublicEdit
  const userId = useQuery(api.domains.auth.presence.getUserId);
  const isOwner = !!userId && !!document && userId === (document as any).createdBy;

	  // Timeline Gantt: check if this doc has an associated agent timeline
	  const timelineBundle = useQuery(api.domains.agents.agentTimelines.getByDocumentId, isValidId ? { documentId } : "skip");

  const editable = !!isOwner || (!!document?.isPublic && !!(document as any).allowPublicEdit);

  return (
    <ErrorBoundary title="Document Error">
      <div className="flex flex-col h-full bg-surface">
        {(!isValidId) ? (
          <div className="flex items-center justify-center h-full bg-surface">
            <div className="text-center max-w-md mx-4">
              <h2 className="text-base font-semibold text-content mb-2">Invalid document</h2>
              <p className="text-content-secondary mb-2">The provided document id is invalid or missing.</p>
              {isGridMode ? (
                <p className="text-[var(--text-tertiary)] text-sm">Close this tab or select another document from the sidebar.</p>
              ) : (
                <p className="text-[var(--text-tertiary)] text-sm">Please select another document from the sidebar.</p>
              )}
            </div>
          </div>
        ) : (document === undefined) ? (
          <div className="flex items-center justify-center h-full bg-surface">
            <div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500/30"></div>
          </div>
        ) : (document === null) ? (
          <div className="flex items-center justify-center h-full bg-surface">
            <div className="text-center">
              <h2 className="text-base font-semibold text-content mb-2">Document not found</h2>
              <p className="text-content-secondary">This document may have been deleted or you don't have permission to view it.</p>
            </div>
          </div>
        ) : (
          <>
            {shouldShowHeader && !isSpreadsheetDocument && <DocumentHeader document={document} />}
            <div className="flex-1 flex flex-col overflow-hidden">
              {document.coverImage && shouldShowCoverImage && (
                <div className="h-48 bg-surface-secondary border-b border-edge">
                  <CoverImage storageId={document.coverImage} />
                </div>
              )}
              <div className={`flex-1 ${isSpreadsheetDocument ? '' : 'overflow-y-auto'} bg-surface`}>
                {(document.documentType === "timeline") || (timelineBundle !== undefined && timelineBundle !== null) ? (
                  <div className="h-full w-full flex items-center justify-center">
                    <div className="text-content-secondary text-sm">Timeline view is not available.</div>
                  </div>
                ) : document.documentType === "dossier" ? (
                  <Suspense fallback={viewFallback}>
                    <DossierViewer documentId={documentId} isGridMode={isGridMode} isFullscreen={isFullscreen} />
                  </Suspense>
                ) : document.documentType === "file" ? (
                  document.fileType === "csv" ? (
                    <Suspense fallback={viewFallback}>
                      <SpreadsheetView documentId={documentId} isGridMode={isGridMode} isFullscreen={isFullscreen} />
                    </Suspense>
                  ) : (
                    <Suspense fallback={viewFallback}>
                      <FileViewer documentId={documentId} />
                    </Suspense>
                  )
                ) : (
                  <div className={isGridMode && !isFullscreen ? 'w-full h-full px-2 py-2' : 'max-w-4xl mx-auto px-6 py-8'}>
                    {useUnifiedEditorFlag ? (
                      <Suspense fallback={viewFallback}>
                        <UnifiedEditor
                          documentId={mountedDocId}
                          mode={isGridMode && !isFullscreen ? 'quickEdit' : 'full'}
                          isGridMode={isGridMode}
                          isFullscreen={isFullscreen}
                          editable={editable}
                        />
                      </Suspense>
                    ) : (
                      // Legacy editor remains default until we flip the flag
                      <Editor documentId={mountedDocId} isGridMode={isGridMode} isFullscreen={isFullscreen} editable={editable} />
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}

function CoverImage({ storageId }: { storageId: Id<"_storage"> }) {
  const imageUrl = useQuery(api.domains.documents.files.getUrl, { storageId });

  if (!imageUrl) {
    return <div className="h-full bg-muted/30" aria-hidden="true" />;
  }

  return (
    <img
      src={imageUrl}
      alt="Cover"
      className="w-full h-full object-cover"
    />
  );
}

