/**
 * DocumentsTabContent - Memoized document grid/list content.
 *
 * Extracted from DocumentsHomeHub to prevent re-renders when calendar
 * or sidebar state changes. All document-grid rendering lives here.
 */

import React, { lazy, memo, Suspense, useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { FileText, Calendar, File, Loader2 } from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";

import {
  type DocumentCardData,
} from "@features/documents/components/documentsHub";

import FiltersToolsBar from "@features/documents/components/FiltersToolsBar";
import type { DocumentType } from "@features/documents/components/FiltersToolsBar";
import { toast } from "sonner";

// Lazy-loaded view-mode surfaces (separate Vite chunks)
const LazyCardsView = lazy(() => import("./viewModes/DocumentsCardsView"));
const LazyListView = lazy(() => import("./viewModes/DocumentsListView"));
const LazySegmentedView = lazy(() => import("./viewModes/DocumentsSegmentedView"));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "cards" | "list" | "segmented";

export interface GroupedDocuments {
  favorites: DocumentCardData[];
  calendar: DocumentCardData[];
  text: DocumentCardData[];
  files: DocumentCardData[];
}

export interface DocumentsTabContentProps {
  // Loading
  isDocsLoading: boolean;
  showDocsLoadingFallback: boolean;

  // Filter & view
  filter: string;
  setFilter: (id: string) => void;
  docViewMode: ViewMode;
  setDocViewMode: (mode: ViewMode) => void;
  documentTypes: DocumentType[];
  countsByFilter: Record<string, number>;

  // Documents data
  filteredDocuments: DocumentCardData[];
  orderedDocuments: DocumentCardData[];
  groupedDocuments: GroupedDocuments;
  docsById: Record<string, DocumentCardData>;

  // Order state
  docOrderByFilter: Record<string, string[]>;
  setDocOrderByFilter: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  segmentedOrderByGroup: Record<string, string[]>;
  setSegmentedOrderByGroup: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  orderDocsBy: (
    order: string[] | undefined,
    docs: DocumentCardData[],
  ) => DocumentCardData[];

  // Persistence
  loggedInUser: unknown;
  saveOrderForFilter: (args: {
    filterKey: string;
    order: (string | Id<"documents">)[];
  }) => Promise<unknown>;
  saveOrderForSegmented: (args: {
    groupKey: string;
    order: (string | Id<"documents">)[];
  }) => Promise<unknown>;

  // Selection
  selectedDocIds: Set<string>;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  handleSelectDocument: (id: any, toggle?: boolean) => void;
  handleCardClickWithModifiers: (
    docId: any,
    e: React.MouseEvent,
    groupKey: string,
    orderedIds: any[],
  ) => void;

  // Document actions
  handleDeleteDocument: (id: any) => void;
  handleToggleFavorite: (id: any) => void;
  openMiniEditor: (doc: any) => void;
  handleChatWithFile: (doc: any) => void;
  handleAnalyzeWithAI?: (doc: any) => void;
  handleOpenMedia: (doc: any) => void;
  handleCreateDocument: (type: "text" | "calendar") => Promise<void>;
  handleCreateTimelineDoc: () => Promise<void>;

  // Upload / dropzone
  getRootProps: (props?: any) => any;
  getInputProps: () => any;
  isDragActive: boolean;
  open: () => void;
  isUploading: boolean;
  uploadProgress: string;

  // Bulk actions
  handleBulkToggleFavorite: () => void;
  handleBulkArchive: () => void;
  emptyFileCount: number;
  handleCleanupEmptyFiles: () => void;
}

type PersistedTag = {
  _id?: Id<"tags">;
  name: string;
  kind?: string;
  importance?: number;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DocumentsTabContent = memo(function DocumentsTabContent(
  props: DocumentsTabContentProps,
) {
  const {
    isDocsLoading,
    showDocsLoadingFallback,
    filter,
    setFilter,
    docViewMode,
    setDocViewMode,
    documentTypes,
    countsByFilter,
    filteredDocuments,
    orderedDocuments,
    groupedDocuments,
    docsById,
    docOrderByFilter,
    setDocOrderByFilter,
    segmentedOrderByGroup,
    setSegmentedOrderByGroup,
    orderDocsBy,
    loggedInUser,
    saveOrderForFilter,
    saveOrderForSegmented,
    selectedDocIds,
    toggleSelected,
    clearSelection,
    handleSelectDocument,
    handleCardClickWithModifiers,
    handleDeleteDocument,
    handleToggleFavorite,
    openMiniEditor,
    handleChatWithFile,
    handleAnalyzeWithAI,
    handleOpenMedia,
    handleCreateDocument,
    getRootProps,
    getInputProps,
    isDragActive,
    open,
    isUploading,
    uploadProgress,
    handleBulkToggleFavorite,
    handleBulkArchive,
    emptyFileCount,
    handleCleanupEmptyFiles,
  } = props;

  const filteredDocumentIds = useMemo(
    () => filteredDocuments.map((doc) => doc._id),
    [filteredDocuments],
  );
  const filteredDocumentIdSet = useMemo(
    () => new Set(filteredDocumentIds),
    [filteredDocumentIds],
  );
  const orderedDocumentIds = useMemo(
    () => orderedDocuments.map((doc) => doc._id),
    [orderedDocuments],
  );
  const visibleDocumentTags = useQuery(
    (api as any).tags.listForDocuments,
    orderedDocumentIds.length > 0 ? { documentIds: orderedDocumentIds } : "skip",
  ) as Array<{ documentId: Id<"documents">; tags: PersistedTag[] }> | undefined;
  const documentTagsById = useMemo(() => {
    const next: Record<string, PersistedTag[]> = {};
    for (const entry of visibleDocumentTags ?? []) {
      next[String(entry.documentId)] = entry.tags;
    }
    return next;
  }, [visibleDocumentTags]);

  const handleUploadClick = useCallback(() => {
    open();
  }, [open]);

  const handleBulkToggleFavoriteClick = useCallback(() => {
    void handleBulkToggleFavorite();
  }, [handleBulkToggleFavorite]);

  const handleBulkArchiveClick = useCallback(() => {
    void handleBulkArchive();
  }, [handleBulkArchive]);

  const handleCleanupEmptyFilesClick = useCallback(() => {
    void handleCleanupEmptyFiles();
  }, [handleCleanupEmptyFiles]);

  const handleRowSelect = useCallback(
    (id: Id<"documents">) => {
      handleSelectDocument(id, false);
    },
    [handleSelectDocument],
  );

  const handleRowToggleSelect = useCallback(
    (id: Id<"documents">) => {
      handleSelectDocument(id, true);
    },
    [handleSelectDocument],
  );

  const handleRowChat = useCallback(() => {
    toast.info("Open a document to start a conversation");
  }, []);

  const renderDocumentDragOverlay = useCallback(
    (id: string | Id<"documents">) => {
      const doc = docsById[String(id)];
      if (!doc) return null;

      const badge =
        (doc.documentType as string) === "calendar" ? (
          <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        ) : doc.documentType === "file" ? (
          <File className="h-4 w-4 text-content-secondary" />
        ) : (
          <FileText className="h-4 w-4 text-content-secondary" />
        );

      return (
        <div className="w-[240px] rounded-xl border border-edge bg-surface/95 px-3 py-2 shadow-xl backdrop-blur-sm">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-edge bg-surface-secondary">
              {badge}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-content">
                {doc.title}
              </div>
              <div className="mt-0.5 text-xs text-content-secondary">
                {(doc.documentType as string) === "calendar"
                  ? "Calendar"
                  : doc.documentType === "file"
                    ? "File"
                    : "Document"}
              </div>
            </div>
          </div>
        </div>
      );
    },
    [docsById],
  );

  const handleCreateTextDocument = useCallback(() => {
    void handleCreateDocument("text");
  }, [handleCreateDocument]);

  // -----------------------------------------------------------------------
  // Reorder helpers (flat list / flat cards)
  // -----------------------------------------------------------------------

  const handleFlatReorder = useCallback(
    (newOrderIds: (string | Id<"documents">)[]) => {
      const pruned = newOrderIds.filter((id) => filteredDocumentIdSet.has(id as any));
      setDocOrderByFilter((prev) => ({
        ...prev,
        [filter]: pruned.map((id) => id as string),
      }));
      if (loggedInUser) {
        void saveOrderForFilter({ filterKey: filter, order: pruned }).catch(
          () => {},
        );
      } else {
        try {
          localStorage.setItem(
            "nodebench:docOrderByFilter",
            JSON.stringify({
              ...docOrderByFilter,
              [filter]: pruned.map((id) => String(id)),
            }),
          );
        } catch {
          /* no-op */
        }
      }
    },
    [
      docOrderByFilter,
      filter,
      filteredDocumentIdSet,
      loggedInUser,
      saveOrderForFilter,
      setDocOrderByFilter,
    ],
  );


  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {isDocsLoading && !showDocsLoadingFallback && (
        <div className="mt-6 nb-surface-card px-6 py-12 text-center">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-surface-secondary">
            <Loader2 className="h-4 w-4 text-content-muted motion-safe:animate-spin" />
          </div>
          <p className="text-sm font-semibold text-content">
            Loading documents
          </p>
          <p className="mt-1 text-xs text-content-secondary">
            Preparing your workspace, calendar context, and recent files.
          </p>
        </div>
      )}

      {isDocsLoading && showDocsLoadingFallback && (
        <div className="mt-6 nb-surface-card px-6 py-6">
          <p className="text-sm font-semibold text-content">
            Documents are taking longer than expected
          </p>
          <p className="mt-1 text-xs text-content-secondary">
            This view will continue with the current cache. You can retry if
            your network just changed.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary-sm"
            >
              Retry
            </button>
            <span className="text-xs text-content-muted">
              Showing available content below.
            </span>
          </div>
        </div>
      )}

      {(!isDocsLoading || showDocsLoadingFallback) && (
        <section
          id="documents-grid"
          aria-label="Documents grid"
          className="mt-6"
        >
          {/* Dropzone root wrapping filters + grid */}
          <div
            {...getRootProps({
              className: "relative",
              onDragOver: (e: any) => e.preventDefault(),
            })}
          >
            <input {...getInputProps()} />

            {isDragActive && (
              <div className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-content-muted bg-surface/95 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center">
                  <p className="font-semibold text-content text-lg">
                    Drop files to upload
                  </p>
                  <p className="text-sm text-content-secondary mt-1">
                    They will be uploaded and analyzed automatically
                  </p>
                </div>
              </div>
            )}

            <FiltersToolsBar
              documentTypes={documentTypes}
              filter={filter}
              setFilter={setFilter}
              countsByFilter={countsByFilter}
              viewMode={docViewMode}
              setViewMode={setDocViewMode}
              loggedInUser={loggedInUser}
              onUploadClick={handleUploadClick}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              selectedCount={selectedDocIds.size}
              onBulkToggleFavorite={handleBulkToggleFavoriteClick}
              onBulkArchive={handleBulkArchiveClick}
              onClearSelection={clearSelection}
              emptyFileCount={emptyFileCount}
              onCleanupEmptyFiles={handleCleanupEmptyFilesClick}
            />

            {(docViewMode === "list" || docViewMode === "cards") &&
              filteredDocuments.length === 0 && (
                <div className="w-full rounded-lg border border-dashed border-edge bg-surface-secondary/40">
                  <button
                      type="button"
                      onClick={handleUploadClick}
                      className="w-full flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg hover:bg-surface-hover/40 transition-colors cursor-pointer group"
                    >
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4 transition-transform duration-200 group-hover:scale-[1.02]">
                      <FileText className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <p className="text-lg font-semibold text-content mb-1">
                      Drop files or run an agent
                    </p>
                    <p className="text-sm text-content-muted max-w-xs">
                      Agent research runs produce memos and reports here automatically.
                      You can also drag any file to upload and analyze.
                    </p>
                  </button>

                  {/* Suggested actions (Notion-style) */}
                  <div className="px-6 pb-6 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      className="btn-outline-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        open();
                      }}
                    >
                      Upload
                    </button>
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateTextDocument();
                      }}
                    >
                      New document
                    </button>
                  </div>
                </div>
              )}

            <Suspense fallback={null}>
              {docViewMode === "list" ? (
                <LazyListView
                  orderedDocumentIds={orderedDocumentIds}
                  docsById={docsById}
                  documentTagsById={documentTagsById}
                  selectedDocIds={selectedDocIds}
                  onReorder={handleFlatReorder}
                  onSelect={handleRowSelect}
                  onToggleSelect={handleRowToggleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  onDelete={handleDeleteDocument}
                  onChat={handleRowChat}
                />
              ) : docViewMode === "cards" ? (
                <LazyCardsView
                  orderedDocumentIds={orderedDocumentIds}
                  docsById={docsById}
                  documentTagsById={documentTagsById}
                  selectedDocIds={selectedDocIds}
                  filter={filter}
                  onReorder={handleFlatReorder}
                  renderDocumentDragOverlay={renderDocumentDragOverlay}
                  onSelectDocument={handleSelectDocument}
                  onDeleteDocument={handleDeleteDocument}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenMiniEditor={openMiniEditor}
                  onChatWithFile={handleChatWithFile}
                  onAnalyzeWithAI={handleAnalyzeWithAI}
                  onOpenMedia={handleOpenMedia}
                  toggleSelected={toggleSelected}
                  onCardClickWithModifiers={handleCardClickWithModifiers}
                />
              ) : (
                <LazySegmentedView
                  filter={filter}
                  groupedDocuments={groupedDocuments}
                  docsById={docsById}
                  documentTagsById={documentTagsById}
                  selectedDocIds={selectedDocIds}
                  segmentedOrderByGroup={segmentedOrderByGroup}
                  setSegmentedOrderByGroup={setSegmentedOrderByGroup}
                  orderDocsBy={orderDocsBy}
                  loggedInUser={loggedInUser}
                  saveOrderForSegmented={saveOrderForSegmented}
                  renderDocumentDragOverlay={renderDocumentDragOverlay}
                  onSelectDocument={handleSelectDocument}
                  onDeleteDocument={handleDeleteDocument}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenMiniEditor={openMiniEditor}
                  onChatWithFile={handleChatWithFile}
                  onOpenMedia={handleOpenMedia}
                  toggleSelected={toggleSelected}
                  onCardClickWithModifiers={handleCardClickWithModifiers}
                />
              )}
            </Suspense>
          </div>
        </section>
      )}
    </>
  );
});

export default DocumentsTabContent;
