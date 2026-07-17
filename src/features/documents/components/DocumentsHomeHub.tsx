import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { DocumentsCoreProvider } from "../context/DocumentsCoreProvider";

/*

  UI Editing Guidelines (DocumentsHomeHub)

  ---------------------------------------

  Task Editing:

  - List mode (Today, This Week): Use InlineTaskEditor inline under the clicked TaskRowGlobal.

    No multi-field popover editors. Enter=save/apply, Esc=close, keep focus inside inline editor.

    Quick chips (status/priority/dates) may open single-purpose anchored popovers; dismiss on pick/Esc.

    Left status stripe: full height, no left-edge rounding; click cycles todo -> in_progress -> done -> blocked; don't start drag on stripe click.

  - Kanban mode: Use TaskEditorPanel for full editing (no large inline expansion).

    Allow tiny popovers for quick actions (priority menu, date picker) and keep card visuals standardized (rounded-lg, focus ring, no hover motion).


  Document Editing:

  - Full content editing opens in the main Editor view (not inline here).

  - Minimal metadata edits allowed: prefer inline rename (Enter=commit, Esc=cancel),

    or a compact anchored popover with a single input. No multi-field popovers for documents.

    Tags/favorite can be inline toggles or small, single-purpose popovers.

*/

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { toast } from "sonner";

import { useDocumentWorkspaceState } from "../hooks/useDocumentWorkspaceState";

// Lazy surfaces
const LazyDocumentsWorkspaceSurface = lazy(
  () => import("./DocumentsWorkspaceSurface"),
);
const LazyDocumentsPlannerSurface = lazy(
  () => import("./DocumentsPlannerSurface"),
);
const LazyWorkspaceExplorer = lazy(
  () => import("./WorkspaceExplorer"),
);

interface DocumentsHomeHubProps {
  onDocumentSelect: (documentId: Id<"documents">) => void;

  onGridModeToggle?: () => void;

  hideCalendarCard?: boolean;

  // Lifted task selection state & handlers from MainLayout

  selectedTaskId?: Id<"userEvents"> | null;

  selectedTaskSource?: "today" | "upcoming" | "week" | "other" | null;

  onSelectTask?: (
    id: Id<"userEvents">,

    source: "today" | "upcoming" | "week" | "other",
  ) => void;

  onClearTaskSelection?: () => void;
}

export function DocumentsHomeHub({
  onDocumentSelect,

  onGridModeToggle: _onGridModeToggle,

  hideCalendarCard: _hideCalendarCard,

  selectedTaskId,

  onSelectTask,

  onClearTaskSelection,
}: DocumentsHomeHubProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isWorkspaceView = location.pathname === "/workspace" || new URLSearchParams(location.search).get("view") === "workspace";

  // ---------------------------------------------------------------------------
  // Convex queries
  // ---------------------------------------------------------------------------

  const documents = useQuery(api.domains.documents.documents.getSidebarWithPreviews);
  const loggedInUser = useQuery(api.domains.auth.auth.loggedInUser);
  const prefs = useQuery(api.domains.auth.userPreferences.getCalendarUiPrefs);
  const spreadsheets =
    useQuery(
      api.domains.integrations.spreadsheets.listSheets,
      loggedInUser ? { limit: 10 } : "skip",
    ) ?? [];

  // ---------------------------------------------------------------------------
  // Onboarding seed on first visit
  // ---------------------------------------------------------------------------

  const ensureSeedOnLogin = useMutation(api.domains.auth.onboarding.ensureSeedOnLogin);
  const didEnsureOnHubRef = useRef(false);

  useEffect(() => {
    if (didEnsureOnHubRef.current) return;
    if (!loggedInUser) return;

    let cancelled = false;

    const run = async () => {
      didEnsureOnHubRef.current = true;

      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries && !cancelled; attempt++) {
        try {
          const res = await ensureSeedOnLogin({});

          if (res?.seeded) {
            toast.success("Welcome! We seeded some sample documents to get you started.");
          }

          break;
        } catch {
          if (attempt === maxRetries - 1) {
            // silent fail on last attempt
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [ensureSeedOnLogin, loggedInUser]);

  // ---------------------------------------------------------------------------
  // Extracted hooks
  // ---------------------------------------------------------------------------

  const docWs = useDocumentWorkspaceState({
    onDocumentSelect,
    navigate,
    loggedInUser,
    documents,
    spreadsheets,
    hideCalendarCard: _hideCalendarCard,
  });

  // ---------------------------------------------------------------------------
  // Mini editor request bridge (cross-surface communication)
  // ---------------------------------------------------------------------------

  const [miniEditorRequest, setMiniEditorRequest] = useState<{
    docId: Id<"documents">;
    anchorEl: HTMLElement;
  } | null>(null);

  const openMiniEditor = useCallback(
    (docId: Id<"documents">, anchorEl: HTMLElement) => {
      if (_hideCalendarCard) return;
      setMiniEditorRequest({ docId, anchorEl });
    },
    [_hideCalendarCard],
  );

  const clearMiniEditorRequest = useCallback(() => setMiniEditorRequest(null), []);

  // ---------------------------------------------------------------------------
  // Today label (no planner dependency — uses local Intl)
  // ---------------------------------------------------------------------------

  const todayLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date());
  }, []);

  // ---------------------------------------------------------------------------
  // Context slice projections — map hook outputs to slice interfaces
  // ---------------------------------------------------------------------------

  const documentDataSlice = useMemo(() => ({
    allDocuments: docWs.allDocuments ?? [],
    groupedDocuments: docWs.groupedDocuments ?? {},
    countsByFilter: docWs.countsByFilter ?? {},
    filteredDocuments: docWs.filteredDocuments ?? [],
    orderedDocuments: docWs.orderedDocuments ?? [],
    docsById: docWs.docsById ?? new Map(),
    emptyFileCount: docWs.emptyFileCount ?? 0,
    isDocsLoading: docWs.isDocsLoading ?? false,
    documentTypes: docWs.documentTypes ?? [],
    filter: docWs.filter,
    setFilter: docWs.setFilter,
  }), [docWs.allDocuments, docWs.groupedDocuments, docWs.countsByFilter, docWs.filteredDocuments, docWs.orderedDocuments, docWs.docsById, docWs.emptyFileCount, docWs.isDocsLoading, docWs.documentTypes, docWs.filter, docWs.setFilter]);

  const documentActionSlice = useMemo(() => ({
    selectedDocIds: docWs.selectedDocIds,
    selectAnchorByContext: docWs.selectAnchorByContext,
    handleSelectDoc: (docId: string, _shiftKey?: boolean) =>
      docWs.handleSelectDocument(docId as Id<"documents">),
    clearSelection: docWs.clearSelection,
    handleBulkArchive: docWs.handleBulkArchive,
    handleBulkFavorite: docWs.handleBulkToggleFavorite,
    handleBulkDelete: () => {
      // no-op: bulk delete not yet implemented in workspace state hook
    },
    archiveDocument: docWs.archiveDocument,
    toggleFavorite: docWs.toggleFavorite,
    duplicateDocument: async (args: { documentId: Id<"documents"> }) =>
      docWs.handleDuplicateDocument(args.documentId),
    deleteDocument: async (args: { documentId: Id<"documents"> }) =>
      docWs.handleDeleteDocument(args.documentId),
    toggleSelected: docWs.toggleSelected,
    handleSelectDocument: (docId: string) =>
      docWs.handleSelectDocument(docId as Id<"documents">),
    handleCardClickWithModifiers: docWs.handleCardClickWithModifiers,
    handleDeleteDocument: (docId: string) =>
      docWs.handleDeleteDocument(docId as Id<"documents">),
    handleToggleFavorite: (docId: string) =>
      docWs.handleToggleFavorite(docId as Id<"documents">),
    handleBulkToggleFavorite: docWs.handleBulkToggleFavorite,
    handleCleanupEmptyFiles: docWs.handleCleanupEmptyFiles,
  }), [docWs]);

  const documentOrderSlice = useMemo(() => ({
    docOrderByFilter: docWs.docOrderByFilter,
    setDocOrderByFilter: docWs.setDocOrderByFilter,
    segmentedOrderByGroup: docWs.segmentedOrderByGroup,
    setSegmentedOrderByGroup: docWs.setSegmentedOrderByGroup,
    orderDocsBy: docWs.orderDocsBy,
    saveOrderForFilter: docWs.saveOrderForFilter,
    saveOrderForSegmented: docWs.saveOrderForSegmented,
  }), [docWs.docOrderByFilter, docWs.setDocOrderByFilter, docWs.segmentedOrderByGroup, docWs.setSegmentedOrderByGroup, docWs.orderDocsBy, docWs.saveOrderForFilter, docWs.saveOrderForSegmented]);

  const documentUploadSlice = useMemo(() => ({
    isUploading: docWs.isUploading,
    uploadProgress: docWs.uploadProgress,
    isFileDragActive: docWs.isFileDragActive,
    getRootProps: docWs.getRootProps,
    getInputProps: docWs.getInputProps,
    isDragActive: docWs.isDragActive,
    openFilePicker: docWs.open,
  }), [docWs.isUploading, docWs.uploadProgress, docWs.isFileDragActive, docWs.getRootProps, docWs.getInputProps, docWs.isDragActive, docWs.open]);

  const documentOverlaySlice = useMemo(() => ({
    viewingMediaDoc: docWs.viewingMediaDoc,
    setViewingMediaDoc: docWs.setViewingMediaDoc,
    isCompiling: docWs.isCompiling,
    isSeedingTimeline: docWs.isSeedingTimeline,
    analyzeRunningDocId: docWs.analyzeRunningDocId,
    selectedFrequentDoc: docWs.selectedFrequentDoc,
    setSelectedFrequentDoc: docWs.setSelectedFrequentDoc,
    docViewMode: docWs.docViewMode,
    setDocViewMode: docWs.setDocViewMode,
    showDocsLoadingFallback: docWs.showDocsLoadingFallback,
    handleChatWithFile: docWs.handleChatWithFile,
    handleAnalyzeWithAI: docWs.handleAnalyzeWithAI,
    handleOpenMedia: docWs.handleOpenMedia,
    handleCreateDocument: docWs.handleCreateDocument,
    handleCreateTimelineDoc: docWs.handleCreateTimelineDoc,
  }), [docWs.viewingMediaDoc, docWs.setViewingMediaDoc, docWs.isCompiling, docWs.isSeedingTimeline, docWs.analyzeRunningDocId, docWs.selectedFrequentDoc, docWs.setSelectedFrequentDoc, docWs.docViewMode, docWs.setDocViewMode, docWs.showDocsLoadingFallback, docWs.handleChatWithFile, docWs.handleAnalyzeWithAI, docWs.handleOpenMedia, docWs.handleCreateDocument, docWs.handleCreateTimelineDoc]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Agent Workspace view — show WorkspaceExplorer when navigated to /workspace
  if (isWorkspaceView) {
    return (
      <Suspense fallback={null}>
        <LazyWorkspaceExplorer />
      </Suspense>
    );
  }

  return (
    <DocumentsCoreProvider
      documentData={documentDataSlice as any}
      documentActions={documentActionSlice as any}
      documentOrder={documentOrderSlice as any}
      documentUpload={documentUploadSlice as any}
      documentOverlays={documentOverlaySlice as any}
    >
      <Suspense fallback={null}>
        <LazyDocumentsWorkspaceSurface
          todayLabel={todayLabel}
          spreadsheets={spreadsheets}
          navigate={navigate}
          loggedInUser={loggedInUser}
          hideCalendarCard={_hideCalendarCard}
          openMiniEditor={openMiniEditor}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LazyDocumentsPlannerSurface
          prefs={prefs}
          loggedInUser={loggedInUser}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onClearTaskSelection={onClearTaskSelection}
          hideCalendarCard={_hideCalendarCard}
          miniEditorRequest={miniEditorRequest}
          onClearMiniEditorRequest={clearMiniEditorRequest}
          onDocumentSelect={onDocumentSelect}
        />
      </Suspense>

    </DocumentsCoreProvider>
  );
}
