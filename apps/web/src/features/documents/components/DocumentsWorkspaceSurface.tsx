/**
 * DocumentsWorkspaceSurface
 *
 * Lazy-loadable main content area extracted from DocumentsHomeHub.
 * Contains: Spreadsheets mini-grid, DocumentsTabContent.
 *
 * Consumes document context slices (Data, Action, Order, Upload, Overlay)
 * instead of receiving a monolithic `docWs` prop bag. Fields that don't map
 * to any context slice remain as explicit props (shell-level concerns).
 */

import type React from "react";
import type { Id } from "@convex/_generated/dataModel";
import { FileText, FileSpreadsheet } from "lucide-react";
import { TopDividerBar } from "@shared/ui/TopDividerBar";
import { UnifiedHubPills } from "@shared/ui/UnifiedHubPills";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";
import { DocumentsTabContent } from "./DocumentsTabContent";
import {
  useDocumentDataCtx,
  useDocumentActionCtx,
  useDocumentOrderCtx,
  useDocumentUploadCtx,
  useDocumentOverlayCtx,
} from "../context/DocumentsWorkspaceContext";

/**
 * Props that remain after migrating all docWs fields to context slices.
 * Only shell-level concerns that cannot be derived from context.
 */
export interface DocumentsWorkspaceSurfaceProps {
  /** Today label string, e.g. "Thursday, March 20" */
  todayLabel: string;
  /** Spreadsheets from Convex query */
  spreadsheets: any[];
  /** react-router navigate */
  navigate: (path: string) => void;
  /** Logged-in user (for persistence guards) */
  loggedInUser: unknown;
  /** Whether calendar card is hidden (timeline view) */
  hideCalendarCard?: boolean;
  /** openMiniEditor callback (defined in the hub shell) */
  openMiniEditor: (docId: Id<"documents">, anchorEl: HTMLElement) => void;
}

export default function DocumentsWorkspaceSurface({
  todayLabel,
  spreadsheets,
  navigate,
  loggedInUser,
  hideCalendarCard,
  openMiniEditor,
}: DocumentsWorkspaceSurfaceProps) {
  // ─── Context slices ─────────────────────────────────────────────────────────
  const data = useDocumentDataCtx();
  const actions = useDocumentActionCtx();
  const order = useDocumentOrderCtx();
  const upload = useDocumentUploadCtx();
  const overlay = useDocumentOverlayCtx();

  // ─── Destructure migrated fields from context ─────────────────────────────
  const { isDocsLoading, documentTypes } = data;
  const {
    toggleSelected,
    handleSelectDocument,
    handleCardClickWithModifiers,
    handleDeleteDocument,
    handleToggleFavorite,
    handleBulkToggleFavorite,
    handleCleanupEmptyFiles,
  } = actions;
  const {
    orderDocsBy,
    saveOrderForFilter,
    saveOrderForSegmented,
  } = order;
  const {
    handleChatWithFile,
    handleAnalyzeWithAI,
    handleOpenMedia,
    handleCreateDocument,
    handleCreateTimelineDoc,
  } = overlay;

  return (
    <div className="nb-page-shell premium-scrollbar">
      <div className="nb-page-inner">
        <div className="nb-page-frame flex flex-col 2xl:flex-row gap-8 lg:gap-10">
          {/* Main column */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Navigation pills */}
            <div id="floating-main-dock">
              <TopDividerBar
                left={
                  <UnifiedHubPills
                    active="documents"
                    showRoadmap
                    roadmapDisabled={false}
                  />
                }
                noBorder
              />

              <PageHeroHeader
                icon={<FileText className="w-6 h-6" />}
                title={"Agent Artifacts"}
                subtitle={"Documents, memos, and files produced by your agents and research runs"}
                date={todayLabel}
                className="mb-6"
              />

              {Array.isArray(spreadsheets) && spreadsheets.length > 0 && (
                <div className="mb-6 rounded-lg border border-edge bg-surface p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-content-secondary" />
                      Spreadsheets
                      <span className="text-content-secondary font-normal">
                        ({spreadsheets.length})
                      </span>
                    </h3>
                    <button
                      type="button"
                      className="text-xs text-content-secondary hover:text-content"
                      onClick={() => {
                        navigate("/spreadsheets");
                      }}
                    >
                      View all
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {spreadsheets.slice(0, 6).map((s: any) => (
                      <button
                        key={String(s._id)}
                        type="button"
                        className="text-left rounded-lg border border-edge bg-surface-secondary hover:bg-surface-hover p-3 focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={() => {
                          navigate(`/spreadsheets/${String(s._id)}`);
                        }}
                      >
                        <div className="text-sm font-medium text-content truncate">
                          {s.name || "Untitled spreadsheet"}
                        </div>
                        <div className="text-xs text-content-secondary mt-1">
                          Updated{" "}
                          {s.updatedAt
                            ? new Date(s.updatedAt).toLocaleString()
                            : "\u2014"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents grid */}
              <DocumentsTabContent
                {...({
                  isDocsLoading,
                  showDocsLoadingFallback: overlay.showDocsLoadingFallback,
                  filter: data.filter,
                  setFilter: data.setFilter,
                  docViewMode: overlay.docViewMode,
                  setDocViewMode: overlay.setDocViewMode,
                  documentTypes,
                  countsByFilter: data.countsByFilter as Record<string, number>,
                  filteredDocuments: data.filteredDocuments,
                  orderedDocuments: data.orderedDocuments,
                  groupedDocuments: data.groupedDocuments,
                  docsById: data.docsById,
                  docOrderByFilter: order.docOrderByFilter,
                  setDocOrderByFilter: order.setDocOrderByFilter,
                  segmentedOrderByGroup: order.segmentedOrderByGroup,
                  setSegmentedOrderByGroup: order.setSegmentedOrderByGroup,
                  orderDocsBy,
                  loggedInUser,
                  saveOrderForFilter,
                  saveOrderForSegmented,
                  selectedDocIds: actions.selectedDocIds,
                  toggleSelected,
                  clearSelection: actions.clearSelection,
                  handleSelectDocument,
                  handleCardClickWithModifiers,
                  handleDeleteDocument,
                  handleToggleFavorite,
                  openMiniEditor,
                  handleChatWithFile,
                  handleAnalyzeWithAI,
                  handleOpenMedia,
                  handleCreateDocument,
                  handleCreateTimelineDoc,
                  getRootProps: upload.getRootProps,
                  getInputProps: upload.getInputProps,
                  isDragActive: upload.isDragActive,
                  open: upload.openFilePicker,
                  isUploading: upload.isUploading,
                  uploadProgress: upload.uploadProgress,
                  handleBulkToggleFavorite,
                  handleBulkArchive: actions.handleBulkArchive,
                  emptyFileCount: data.emptyFileCount,
                  handleCleanupEmptyFiles,
                } as unknown as React.ComponentProps<typeof DocumentsTabContent>)}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
