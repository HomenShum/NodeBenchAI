/**
 * FiltersToolsBar - Document workspace filter and bulk-action controls.
 */

import React, { memo } from "react";
import { Star, Trash2, X, Plus, Loader2, Sparkles } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ai-ui/toggle-group";

export type DocumentType = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

type ViewMode = "cards" | "list" | "segmented";

type Props = {
  documentTypes: Array<DocumentType>;
  filter: string;
  setFilter: (id: string) => void;
  countsByFilter: Record<string, number>;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onUploadClick: () => void;
  isUploading: boolean;
  uploadProgress?: string;
  loggedInUser: unknown;
  selectedCount: number;
  onBulkToggleFavorite: () => void;
  onBulkArchive: () => void;
  onClearSelection: () => void;
  emptyFileCount?: number;
  onCleanupEmptyFiles?: () => void;
};

const FiltersToolsBar = memo(function FiltersToolsBar(props: Props) {
  const {
    documentTypes,
    filter,
    setFilter,
    countsByFilter,
    viewMode,
    setViewMode,
    loggedInUser,
    onUploadClick,
    isUploading,
    uploadProgress,
    selectedCount,
    onBulkToggleFavorite,
    onBulkArchive,
    onClearSelection,
    emptyFileCount = 0,
    onCleanupEmptyFiles,
  } = props;

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(value) => value && setFilter(value)}
        className="flex flex-wrap items-center gap-2"
        aria-label="Document filters"
      >
        {documentTypes.map((t) => {
          const isActive = filter === t.id;
          const count = countsByFilter[t.id] ?? 0;
          return (
            <ToggleGroupItem
              key={t.id}
              value={t.id}
              aria-label={`Filter by ${t.label}`}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all duration-200 ${
                isActive
                  ? "bg-content text-surface border-content shadow-sm"
                  : "bg-surface text-content-secondary border-edge hover:border-content-muted/30 hover:text-content"
              }`}
            >
              <span className={isActive ? "opacity-90" : "opacity-70"}>{t.icon}</span>
              <span>{t.label}</span>
              {count > 0 && (
                <span
                  className={`ml-0.5 tabular-nums ${
                    isActive ? "text-surface/80" : "text-content-muted"
                  }`}
                >
                  ({count})
                </span>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      <div className="flex items-center gap-3">
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => value && setViewMode(value as ViewMode)}
          aria-label="Document view"
          className="flex gap-0.5 rounded-lg border border-edge bg-surface-secondary p-1 shadow-sm"
        >
          <ToggleGroupItem
            value="cards"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              viewMode === "cards"
                ? "border border-edge bg-surface text-content shadow-sm"
                : "text-content-secondary hover:bg-surface hover:text-content"
            }`}
          >
            Cards
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              viewMode === "list"
                ? "border border-edge bg-surface text-content shadow-sm"
                : "text-content-secondary hover:bg-surface hover:text-content"
            }`}
          >
            List
          </ToggleGroupItem>
          <ToggleGroupItem
            value="segmented"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              viewMode === "segmented"
                ? "border border-edge bg-surface text-content shadow-sm"
                : "text-content-secondary hover:bg-surface hover:text-content"
            }`}
            title="Show grouped sections"
          >
            Grouped
          </ToggleGroupItem>
        </ToggleGroup>

        <button
          onClick={onUploadClick}
          disabled={!loggedInUser || isUploading}
          aria-label={isUploading ? "Uploading document..." : "Upload document"}
          title={isUploading ? "Uploading..." : "Upload a document"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>{isUploading ? "Uploading..." : "Upload"}</span>
        </button>

        {isUploading && uploadProgress && (
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
            <span className="max-w-[120px] truncate">{uploadProgress}</span>
          </div>
        )}

        {emptyFileCount > 0 && onCleanupEmptyFiles && selectedCount === 0 && (
          <button
            type="button"
            onClick={onCleanupEmptyFiles}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
            title={`Remove ${emptyFileCount} empty file${emptyFileCount > 1 ? "s" : ""}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Clean {emptyFileCount} Empty</span>
          </button>
        )}

        {selectedCount > 0 && (
          <div className="ml-1 flex items-center gap-1 border-l border-edge pl-3">
            <span className="mr-2 text-xs font-medium text-content-secondary">
              {selectedCount} selected
            </span>
            <button
              type="button"
              className="rounded-lg p-2 transition-colors hover:bg-surface-hover"
              onClick={onBulkToggleFavorite}
              title="Toggle favorite"
            >
              <Star className="h-4 w-4 text-amber-500" />
            </button>
            <button
              type="button"
              className="rounded-lg p-2 transition-colors hover:bg-red-50"
              onClick={onBulkArchive}
              title="Move to trash"
            >
              <Trash2 className="h-4 w-4 text-content-muted hover:text-red-500" />
            </button>
            <button
              type="button"
              className="rounded-lg p-2 transition-colors hover:bg-surface-hover"
              onClick={onClearSelection}
              title="Clear selection"
            >
              <X className="h-4 w-4 text-content-muted" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default FiltersToolsBar;
