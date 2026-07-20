/**
 * useDocumentWorkspaceState
 *
 * Composite hook that composes 5 focused domain sub-hooks into a single
 * backward-compatible return interface. Consumers see no API change.
 *
 * Sub-hooks:
 *  - useDocumentData       — normalization, filtering, computed sets
 *  - useDocumentSelection  — multi-select, bulk actions
 *  - useDocumentUpload     — file upload, drag-drop, dropzone
 *  - useDocumentOrdering   — per-filter/segment ordering + persistence
 *  - useDocumentOverlays   — media viewer, compile flags, CRUD handlers
 */

import { useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "convex/react";

import { Id } from "@convex/_generated/dataModel";
import type { DocumentCardData } from "@features/documents/components/documentsHub/utils/documentHelpers";

import { useDocumentData } from "./useDocumentData";
import { useDocumentSelection } from "./useDocumentSelection";
import { useDocumentUpload } from "./useDocumentUpload";
import { useDocumentOrdering } from "./useDocumentOrdering";
import { useDocumentOverlays } from "./useDocumentOverlays";

// Re-export slice types for consumers
export type { DocumentDataSlice } from "./useDocumentData";
export type { DocumentSelectionSlice } from "./useDocumentSelection";
export type { DocumentUploadSlice } from "./useDocumentUpload";
export type { DocumentOrderSlice } from "./useDocumentOrdering";
export type { DocumentOverlaySlice } from "./useDocumentOverlays";

// ---------------------------------------------------------------------------
// Types (backward-compatible)
// ---------------------------------------------------------------------------

export interface UseDocumentWorkspaceStateParams {
  /** Called when user selects/opens a document */
  onDocumentSelect: (documentId: Id<"documents">) => void;
  /** react-router navigate function */
  navigate: (path: string) => void;
  /** Currently logged-in user (from Convex auth query) */
  loggedInUser: any;
  /** Raw documents array from Convex query (may be undefined while loading) */
  documents: any[] | undefined;
  /** Spreadsheets list from Convex */
  spreadsheets: any[];
  /** Whether the calendar card is hidden (e.g. Timeline view) */
  hideCalendarCard?: boolean;
}

export interface UseDocumentWorkspaceStateReturn {
  // --- Loading ---
  isDocsLoading: boolean;
  showDocsLoadingFallback: boolean;

  // --- Normalized documents ---
  documentsNorm: DocumentCardData[];

  // --- Media viewer ---
  viewingMediaDoc: DocumentCardData | null;
  setViewingMediaDoc: React.Dispatch<React.SetStateAction<DocumentCardData | null>>;
  handleOpenMedia: (doc: DocumentCardData) => void;
  handleCloseMedia: () => void;

  // --- Filter / view mode ---
  filter: string;
  setFilter: React.Dispatch<React.SetStateAction<string>>;
  docViewMode: "cards" | "list" | "segmented";
  setDocViewMode: React.Dispatch<React.SetStateAction<"cards" | "list" | "segmented">>;

  // --- Compile / seed flags ---
  isCompiling: boolean;
  setIsCompiling: React.Dispatch<React.SetStateAction<boolean>>;
  isSeedingTimeline: boolean;
  setIsSeedingTimeline: React.Dispatch<React.SetStateAction<boolean>>;

  // --- Multi-select ---
  selectedDocIds: Set<string>;
  setSelectedDocIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectAnchorByContext: Record<string, string | null>;
  setSelectAnchorByContext: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  handleCardClickWithModifiers: (
    docId: Id<"documents">,
    e: React.MouseEvent,
    contextKey: string,
    orderedIds: Array<Id<"documents">>,
  ) => boolean;

  // --- File upload / drag-drop ---
  isUploading: boolean;
  uploadProgress: string;
  isFileDragActive: boolean;
  fileDragCounterRef: React.MutableRefObject<number>;
  lastWindowDropAtRef: React.MutableRefObject<number>;
  handleFileUpload: (file: File) => Promise<void>;
  onDrop: (acceptedFiles: File[]) => void;
  getRootProps: ReturnType<typeof useDropzone>["getRootProps"];
  getInputProps: ReturnType<typeof useDropzone>["getInputProps"];
  open: ReturnType<typeof useDropzone>["open"];
  isDragActive: boolean;

  // --- Document ordering ---
  docOrderByFilter: Record<string, Array<string>>;
  setDocOrderByFilter: React.Dispatch<React.SetStateAction<Record<string, Array<string>>>>;
  segmentedOrderByGroup: Record<string, Array<string>>;
  setSegmentedOrderByGroup: React.Dispatch<React.SetStateAction<Record<string, Array<string>>>>;
  orderDocsBy: (ids: string[] | undefined, docs: DocumentCardData[]) => DocumentCardData[];

  // --- Computed document sets ---
  allDocuments: DocumentCardData[];
  groupedDocuments: {
    calendar: DocumentCardData[];
    files: DocumentCardData[];
    text: DocumentCardData[];
    favorites: DocumentCardData[];
  };
  countsByFilter: Record<string, number>;
  filteredDocuments: DocumentCardData[];
  orderedDocuments: DocumentCardData[];
  docsById: Record<string, DocumentCardData>;
  emptyFileCount: number;

  documentTypes: Array<{ id: string; label: string; icon: React.ReactNode }>;

  // --- CRUD handlers ---
  handleDeleteDocument: (documentId: Id<"documents">) => void;
  handleToggleFavorite: (documentId: Id<"documents">) => void;
  handleBulkToggleFavorite: () => Promise<void>;
  handleBulkArchive: () => Promise<void>;
  handleDuplicateDocument: (docId: Id<"documents">) => Promise<void>;
  handleCleanupEmptyFiles: () => Promise<void>;
  handleChatWithFile: (doc: { _id: Id<"documents">; title: string }) => void;
  handleAnalyzeWithAI: (doc: { _id: Id<"documents">; title: string }) => void;
  handleCreateDocument: (type: "text" | "calendar") => Promise<void>;
  handleCreateTimelineDoc: () => Promise<void>;
  handleSelectDocument: (documentId: Id<"documents">) => void;

  // --- Mutations (pass-through for consumers that need direct access) ---
  archiveDocument: ReturnType<typeof useMutation>;
  toggleFavorite: ReturnType<typeof useMutation>;
  createDocument: ReturnType<typeof useMutation>;
  createWithSnapshot: ReturnType<typeof useMutation>;
  setDocumentType: ReturnType<typeof useMutation>;
  createTimelineForDoc: ReturnType<typeof useMutation>;
  applyPlanTimeline: ReturnType<typeof useMutation>;
  generateUploadUrl: ReturnType<typeof useMutation>;
  createFileRecord: ReturnType<typeof useMutation>;
  createDocumentWithContent: ReturnType<typeof useMutation>;
  saveOrderForFilter: ReturnType<typeof useMutation>;
  saveOrderForSegmented: ReturnType<typeof useMutation>;

  // --- Misc state needed by parent ---
  selectedFrequentDoc: Id<"documents"> | null;
  setSelectedFrequentDoc: React.Dispatch<React.SetStateAction<Id<"documents"> | null>>;
  analyzeRunningDocId: Id<"documents"> | null;
}

// ---------------------------------------------------------------------------
// Composite Hook
// ---------------------------------------------------------------------------

export function useDocumentWorkspaceState({
  onDocumentSelect,
  navigate: _navigate,
  loggedInUser,
  documents,
  spreadsheets: _spreadsheets,
  hideCalendarCard,
}: UseDocumentWorkspaceStateParams): UseDocumentWorkspaceStateReturn {
  // 1. Data — normalization, filtering, computed sets
  const data = useDocumentData({ documents, hideCalendarCard });

  // 2. Selection — multi-select, bulk actions (needs allDocuments for cleanup)
  const selection = useDocumentSelection({ allDocuments: data.allDocuments });

  // 3. Upload — file upload, drag-drop, dropzone
  const upload = useDocumentUpload({ onDocumentSelect });

  // 4. Ordering — per-filter/segment ordering (needs filter + filteredDocuments)
  const ordering = useDocumentOrdering({
    loggedInUser,
    filter: data.filter,
    filteredDocuments: data.filteredDocuments,
  });

  // 5. Overlays — media viewer, compile flags, CRUD handlers
  const overlays = useDocumentOverlays({ onDocumentSelect, documents });

  // Merge docsById from data with ordering context — original used orderedDocuments
  // for docsById, so we recompute here to match original behavior exactly.
  const docsById = useMemo(() => {
    const m: Record<string, DocumentCardData> = {};
    for (const d of ordering.orderedDocuments) m[d._id] = d;
    return m;
  }, [ordering.orderedDocuments]);

  // -------------------------------------------------------------------------
  // Compose all slices into the backward-compatible return
  // -------------------------------------------------------------------------

  return {
    // --- Data slice ---
    isDocsLoading: data.isDocsLoading,
    showDocsLoadingFallback: data.showDocsLoadingFallback,
    documentsNorm: data.documentsNorm,
    filter: data.filter,
    setFilter: data.setFilter,
    docViewMode: data.docViewMode,
    setDocViewMode: data.setDocViewMode,
    allDocuments: data.allDocuments,
    groupedDocuments: data.groupedDocuments,
    countsByFilter: data.countsByFilter,
    filteredDocuments: data.filteredDocuments,
    emptyFileCount: data.emptyFileCount,
    documentTypes: data.documentTypes,

    // --- Selection slice ---
    selectedDocIds: selection.selectedDocIds,
    setSelectedDocIds: selection.setSelectedDocIds,
    selectAnchorByContext: selection.selectAnchorByContext,
    setSelectAnchorByContext: selection.setSelectAnchorByContext,
    toggleSelected: selection.toggleSelected,
    clearSelection: selection.clearSelection,
    handleCardClickWithModifiers: selection.handleCardClickWithModifiers,
    handleBulkToggleFavorite: selection.handleBulkToggleFavorite,
    handleBulkArchive: selection.handleBulkArchive,
    handleDuplicateDocument: selection.handleDuplicateDocument,
    handleCleanupEmptyFiles: selection.handleCleanupEmptyFiles,
    handleDeleteDocument: selection.handleDeleteDocument,
    handleToggleFavorite: selection.handleToggleFavorite,
    archiveDocument: selection.archiveDocument,
    toggleFavorite: selection.toggleFavorite,

    // --- Upload slice ---
    isUploading: upload.isUploading,
    uploadProgress: upload.uploadProgress,
    isFileDragActive: upload.isFileDragActive,
    fileDragCounterRef: upload.fileDragCounterRef,
    lastWindowDropAtRef: upload.lastWindowDropAtRef,
    handleFileUpload: upload.handleFileUpload,
    onDrop: upload.onDrop,
    getRootProps: upload.getRootProps,
    getInputProps: upload.getInputProps,
    open: upload.open,
    isDragActive: upload.isDragActive,
    generateUploadUrl: upload.generateUploadUrl,
    createFileRecord: upload.createFileRecord,
    createDocumentWithContent: upload.createDocumentWithContent,

    // --- Ordering slice ---
    docOrderByFilter: ordering.docOrderByFilter,
    setDocOrderByFilter: ordering.setDocOrderByFilter,
    segmentedOrderByGroup: ordering.segmentedOrderByGroup,
    setSegmentedOrderByGroup: ordering.setSegmentedOrderByGroup,
    orderDocsBy: ordering.orderDocsBy,
    orderedDocuments: ordering.orderedDocuments,
    docsById,
    saveOrderForFilter: ordering.saveOrderForFilter,
    saveOrderForSegmented: ordering.saveOrderForSegmented,

    // --- Overlays slice ---
    viewingMediaDoc: overlays.viewingMediaDoc,
    setViewingMediaDoc: overlays.setViewingMediaDoc,
    handleOpenMedia: overlays.handleOpenMedia,
    handleCloseMedia: overlays.handleCloseMedia,
    isCompiling: overlays.isCompiling,
    setIsCompiling: overlays.setIsCompiling,
    isSeedingTimeline: overlays.isSeedingTimeline,
    setIsSeedingTimeline: overlays.setIsSeedingTimeline,
    selectedFrequentDoc: overlays.selectedFrequentDoc,
    setSelectedFrequentDoc: overlays.setSelectedFrequentDoc,
    analyzeRunningDocId: overlays.analyzeRunningDocId,
    handleSelectDocument: overlays.handleSelectDocument,
    handleChatWithFile: overlays.handleChatWithFile,
    handleAnalyzeWithAI: overlays.handleAnalyzeWithAI,
    handleCreateDocument: overlays.handleCreateDocument,
    handleCreateTimelineDoc: overlays.handleCreateTimelineDoc,
    createDocument: overlays.createDocument,
    createWithSnapshot: overlays.createWithSnapshot,
    setDocumentType: overlays.setDocumentType,
    createTimelineForDoc: overlays.createTimelineForDoc,
    applyPlanTimeline: overlays.applyPlanTimeline,
  };
}
