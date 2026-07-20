/**
 * Route-local context slice types for the documents workspace.
 *
 * Each slice is a narrow, memo-stable contract that consumers subscribe to
 * independently. A change in one slice does NOT trigger rerenders in consumers
 * of another slice.
 */

import type React from "react";
import type { Id } from "@convex/_generated/dataModel";

// ─── Document Data Slice ─────────────────────────────────────────────────────
/** Read-only document data: queries, filtering, grouping, counts. */
export interface DocumentDataSlice {
  /** All raw documents from the query */
  allDocuments: any[];
  /** Documents grouped by category */
  groupedDocuments: Record<string, any[]>;
  /** Counts per filter category */
  countsByFilter: Record<string, number>;
  /** Documents filtered by the active filter */
  filteredDocuments: any[];
  /** Documents with ordering applied */
  orderedDocuments: any[];
  /** Lookup map by document ID */
  docsById: Map<string, any>;
  /** Count of empty/zero-byte files */
  emptyFileCount: number;
  /** Whether documents query is still loading */
  isDocsLoading: boolean;
  /** Available document type strings for filter pills */
  documentTypes: string[];
  /** Active filter value */
  filter: string;
  /** Set active filter */
  setFilter: (filter: string) => void;
}

// ─── Document Action Slice ───────────────────────────────────────────────────
/** Selection, bulk actions, and single-document mutations. */
export interface DocumentActionSlice {
  /** Set of currently selected document IDs */
  selectedDocIds: Set<string>;
  /** Selection anchor for shift-click range selection */
  selectAnchorByContext: string | null;
  /** Select/deselect a single document */
  handleSelectDoc: (docId: string, shiftKey?: boolean) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Bulk archive selected documents */
  handleBulkArchive: () => void;
  /** Bulk toggle favorite on selected documents */
  handleBulkFavorite: () => void;
  /** Bulk delete selected documents */
  handleBulkDelete: () => void;
  /** Archive a single document */
  archiveDocument: (args: { documentId: Id<"documents"> }) => Promise<any>;
  /** Toggle favorite on a single document */
  toggleFavorite: (args: { documentId: Id<"documents"> }) => Promise<any>;
  /** Duplicate a document */
  duplicateDocument: (args: { documentId: Id<"documents"> }) => Promise<any>;
  /** Delete a single document */
  deleteDocument: (args: { documentId: Id<"documents"> }) => Promise<any>;
  /** Toggle selection state for a document */
  toggleSelected: (docId: string) => void;
  /** Select a document (navigate or open) */
  handleSelectDocument: (docId: string) => void;
  /** Card click with keyboard modifiers (shift/meta/ctrl) */
  handleCardClickWithModifiers: (docId: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  /** Delete a document by string ID */
  handleDeleteDocument: (docId: string) => void;
  /** Toggle favorite on a document by string ID */
  handleToggleFavorite: (docId: string) => void;
  /** Bulk toggle favorite on selected documents */
  handleBulkToggleFavorite: () => void;
  /** Cleanup empty/zero-byte files */
  handleCleanupEmptyFiles: () => void;
}

// ─── Document Order Slice ────────────────────────────────────────────────────
/** Ordering preferences and persistence. */
export interface DocumentOrderSlice {
  /** Current order-by filter value */
  docOrderByFilter: string;
  /** Set the order-by filter */
  setDocOrderByFilter: (value: string) => void;
  /** Current segmented order-by group */
  segmentedOrderByGroup: string;
  /** Set the segmented order-by group */
  setSegmentedOrderByGroup: (value: string) => void;
  /** Current ordering key for documents */
  orderDocsBy: string;
  /** Persist order preference for filter context */
  saveOrderForFilter: (value: string) => void;
  /** Persist order preference for segmented context */
  saveOrderForSegmented: (value: string) => void;
}

// ─── Document Upload Slice ───────────────────────────────────────────────────
/** File upload state and actions. */
export interface DocumentUploadSlice {
  /** Whether a file upload is in progress */
  isUploading: boolean;
  /** Upload progress percentage (0-100) */
  uploadProgress: number;
  /** Whether files are being dragged over the workspace */
  isFileDragActive: boolean;
  /** Dropzone root props for the workspace container */
  getRootProps: (...args: any[]) => any;
  /** Dropzone input props for the hidden file input */
  getInputProps: (...args: any[]) => any;
  /** Whether the dropzone is currently drag-active */
  isDragActive: boolean;
  /** Open the file picker programmatically */
  openFilePicker: () => void;
}

// ─── Document Overlay Slice ──────────────────────────────────────────────────
/** Overlay/modal controller state for the documents surface. */
export interface DocumentOverlaySlice {
  /** Currently viewing media document (cinema viewer) */
  viewingMediaDoc: any | null;
  /** Set the media document to view */
  setViewingMediaDoc: (doc: any | null) => void;
  /** Whether a compilation is in progress */
  isCompiling: boolean;
  /** Whether timeline seeding is in progress */
  isSeedingTimeline: boolean;
  /** Currently-analyzing document ID */
  analyzeRunningDocId: string | null;
  /** Currently selected frequent document */
  selectedFrequentDoc: any | null;
  /** Set the selected frequent doc */
  setSelectedFrequentDoc: (doc: any | null) => void;
  /** Current document view mode (grid/list/etc) */
  docViewMode: string;
  /** Set the document view mode */
  setDocViewMode: (mode: string) => void;
  /** Whether the loading fallback is showing */
  showDocsLoadingFallback: boolean;
  /** Chat with a file (open agent panel for document) */
  handleChatWithFile: (docId: string) => void;
  /** Analyze a document with AI */
  handleAnalyzeWithAI: (docId: string) => void;
  /** Open media viewer for a document */
  handleOpenMedia: (doc: any) => void;
  /** Create a new document (optionally of a specific type) */
  handleCreateDocument: (type?: string) => void;
  /** Create a timeline document from an existing document */
  handleCreateTimelineDoc: (docId: string) => void;
}

// ─── Planner Date Nav Slice ──────────────────────────────────────────────────
/** Date navigation and week/day labeling. */
export interface PlannerDateNavSlice {
  /** Selected date as epoch ms */
  agendaSelectedDateMs: number;
  /** Set the selected date */
  setAgendaSelectedDateMs: (ms: number) => void;
  /** Whether to show week view in agenda */
  showWeekInAgenda: boolean;
  /** Toggle week view */
  setShowWeekInAgenda: (show: boolean) => void;
  /** Timezone offset in minutes */
  tzOffsetMinutes: number;
  /** Formatted week range label */
  weekRangeLabel: string;
  /** Formatted agenda day label */
  agendaDayLabel: string;
  /** Formatted agenda range label */
  agendaRangeLabel: string;
  /** Navigate to previous week */
  goToPrevWeek: () => void;
  /** Navigate to next week */
  goToNextWeek: () => void;
  /** Navigate to today */
  goToToday: () => void;
  /** Change agenda day by N days */
  changeAgendaByDays: (days: number) => void;
}

// ─── Planner Agenda Slice ────────────────────────────────────────────────────
/** Agenda data shaping and query results. */
export interface PlannerAgendaSlice {
  /** Agenda mode (day/week/month) */
  agendaMode: string;
  /** Set agenda mode */
  setAgendaMode: (mode: string) => void;
  /** Agenda scope */
  agendaScope: string;
  /** Set agenda scope */
  setAgendaScope: (scope: string) => void;
  /** Merged events for the current week */
  weekEventsMerged: any[];
  /** Merged tasks for the current week */
  weekTasksMerged: any[];
  /** Merged holidays for the current week */
  weekHolidaysMerged: any[];
}

// ─── Planner View Slice ──────────────────────────────────────────────────────
/** Planner view preferences and mode. */
export interface PlannerViewSlice {
  /** Current planner mode */
  mode: string;
  /** Set planner mode */
  setMode: (mode: string) => void;
  /** Display density */
  density: string;
  /** Set density */
  setDensity: (density: string) => void;
  /** Kanban orientation */
  kanbanOrientation: string;
  /** Set kanban orientation */
  setKanbanOrientation: (orientation: string) => void;
  /** Whether the view menu is open */
  viewMenuOpen: boolean;
  /** Set view menu open state */
  setViewMenuOpen: (open: boolean) => void;
  /** Upcoming mode */
  upcomingMode: string;
  /** Set upcoming mode */
  setUpcomingMode: (mode: string) => void;
}

// ─── Planner Editor Slice ────────────────────────────────────────────────────
/** Editor/modal/inline state for planner surfaces. */
export interface PlannerEditorSlice {
  /** Mini editor anchor element */
  miniEditorAnchor: any | null;
  /** Set mini editor anchor */
  setMiniEditorAnchor: (anchor: any | null) => void;
  /** Selected event ID for editing */
  selectedEventId: string | null;
  /** Set selected event ID */
  setSelectedEventId: (id: string | null) => void;
  /** Quick agenda text input */
  quickAgendaText: string;
  /** Set quick agenda text */
  setQuickAgendaText: (text: string) => void;
  /** Agenda popover state */
  agendaPopover: any | null;
  /** Set agenda popover */
  setAgendaPopover: (popover: any | null) => void;
  /** Inline create state */
  inlineCreate: any | null;
  /** Set inline create */
  setInlineCreate: (create: any | null) => void;
  /** Event editor inline state */
  eventEditorInline: any | null;
  /** Set event editor inline */
  setEventEditorInline: (editor: any | null) => void;
  /** Submit new task handler */
  handleSubmitNewTask: () => void;
  /** Modal keyboard handler */
  handleModalKeyDown: (e: React.KeyboardEvent) => void;
  /** View a specific day */
  handleViewDayLocal: (dateMs: number) => void;
  /** View a specific week */
  handleViewWeekLocal: (dateMs: number) => void;
  /** Whether the new task modal is open */
  showNewTaskModal: boolean;
  /** Set the new task modal open state */
  setShowNewTaskModal: (show: boolean) => void;
  /** New task modal title value */
  newTaskModalTitle: string;
  /** Set new task modal title */
  setNewTaskModalTitle: (title: string) => void;
  /** New task modal due date value */
  newTaskModalDue: string;
  /** Set new task modal due date */
  setNewTaskModalDue: (due: string) => void;
  /** New task modal priority value */
  newTaskModalPriority: string;
  /** Set new task modal priority */
  setNewTaskModalPriority: (priority: string) => void;
  /** New task modal description value */
  newTaskModalDescription: string;
  /** Set new task modal description */
  setNewTaskModalDescription: (desc: string) => void;
  /** Whether a task is currently being submitted */
  isSubmittingTask: boolean;
  /** Ref for the new task title input (focus management) */
  newTaskTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  /** Ref for the modal container (focus trap) */
  modalRef: React.MutableRefObject<HTMLDivElement | null>;
}
