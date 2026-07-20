/**
 * DocumentsSegmentedView — lazy-loaded segmented-mode surface for DocumentsTabContent.
 *
 * Contains the segmented reorder logic and renderSegmentedGroup callback so
 * the parent only passes data + action handlers.
 */

import React, { memo, useCallback } from "react";
import { Calendar, File, FileText, Star } from "lucide-react";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  DocumentCardMemo,
  type DocumentCardData,
} from "@features/documents/components/documentsHub";
import { DocumentsGridSortable } from "../DocumentsGridSortable";
import type { GroupedDocuments } from "../DocumentsTabContent";

type PersistedTag = {
  _id?: Id<"tags">;
  name: string;
  kind?: string;
  importance?: number;
};

export interface DocumentsSegmentedViewProps {
  filter: string;
  groupedDocuments: GroupedDocuments;
  docsById: Record<string, DocumentCardData>;
  documentTagsById: Record<string, PersistedTag[]>;
  selectedDocIds: Set<string>;
  segmentedOrderByGroup: Record<string, string[]>;
  setSegmentedOrderByGroup: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  orderDocsBy: (
    order: string[] | undefined,
    docs: DocumentCardData[],
  ) => DocumentCardData[];
  loggedInUser: unknown;
  saveOrderForSegmented: (args: {
    groupKey: string;
    order: (string | Id<"documents">)[];
  }) => Promise<unknown>;
  renderDocumentDragOverlay: (id: string | Id<"documents">) => React.ReactNode;
  onSelectDocument: (id: any, toggle?: boolean) => void;
  onDeleteDocument: (id: any) => void;
  onToggleFavorite: (id: any) => void;
  onOpenMiniEditor: (doc: any) => void;
  onChatWithFile: (doc: any) => void;
  onOpenMedia: (doc: any) => void;
  toggleSelected: (id: string) => void;
  onCardClickWithModifiers: (
    docId: any,
    e: React.MouseEvent,
    groupKey: string,
    orderedIds: any[],
  ) => void;
}

const DocumentsSegmentedView = memo(function DocumentsSegmentedView(
  props: DocumentsSegmentedViewProps,
) {
  const {
    filter,
    groupedDocuments,
    docsById,
    documentTagsById,
    selectedDocIds,
    segmentedOrderByGroup,
    setSegmentedOrderByGroup,
    orderDocsBy,
    loggedInUser,
    saveOrderForSegmented,
    renderDocumentDragOverlay,
    onSelectDocument,
    onDeleteDocument,
    onToggleFavorite,
    onOpenMiniEditor,
    onChatWithFile,
    onOpenMedia,
    toggleSelected,
    onCardClickWithModifiers,
  } = props;

  // -------------------------------------------------------------------------
  // Segmented reorder
  // -------------------------------------------------------------------------

  const handleSegmentedReorder = useCallback(
    (
      groupKey: string,
      groupDocs: DocumentCardData[],
      newOrderIds: (string | Id<"documents">)[],
    ) => {
      const valid = new Set(groupDocs.map((doc) => doc._id));
      const pruned = newOrderIds.filter((id) => valid.has(id as any));
      setSegmentedOrderByGroup((prev) => ({
        ...prev,
        [groupKey]: pruned.map((id) => String(id)),
      }));
      if (loggedInUser) {
        void saveOrderForSegmented({ groupKey, order: pruned }).catch(
          () => {},
        );
      } else {
        try {
          localStorage.setItem(
            "nodebench:docOrderBySegmented",
            JSON.stringify({
              ...segmentedOrderByGroup,
              [groupKey]: pruned.map((id) => String(id)),
            }),
          );
        } catch {
          /* no-op */
        }
      }
    },
    [
      loggedInUser,
      saveOrderForSegmented,
      segmentedOrderByGroup,
      setSegmentedOrderByGroup,
    ],
  );

  // -------------------------------------------------------------------------
  // Segmented group renderer
  // -------------------------------------------------------------------------

  const renderSegmentedGroup = useCallback(
    (
      groupKey: string,
      docs: DocumentCardData[],
      label: string,
      icon: React.ReactNode,
      filterKeys: string[],
    ) => {
      if (!filterKeys.includes(filter)) return null;
      if (docs.length === 0) return null;

      const orderedGroupDocs = orderDocsBy(
        segmentedOrderByGroup[groupKey],
        docs,
      );
      const orderedGroupIds = orderedGroupDocs.map((doc) => doc._id);

      return (
        <div>
          <h3
            className="text-sm font-semibold text-content mb-3 flex items-center gap-2"
            title={`${label} documents`}
          >
            {icon}
            {label}{" "}
            <span className="text-content-secondary font-normal">
              ({docs.length})
            </span>
          </h3>

          <DocumentsGridSortable
            items={orderedGroupIds}
            onReorder={(ids) => handleSegmentedReorder(groupKey, docs, ids)}
            renderOverlayItem={renderDocumentDragOverlay}
            renderItem={(id, _index, isDragging) => {
              const doc =
                orderedGroupDocs.find((groupDoc) => groupDoc._id === id) ??
                docsById[String(id)];
              if (!doc) return null;
              const persistedTags = documentTagsById[String(doc._id)] ?? [];
              return (
                <DocumentCardMemo
                  key={doc._id}
                  doc={doc}
                  persistedTags={persistedTags}
                  loadPersistedTags={false}
                  onSelect={onSelectDocument}
                  onDelete={onDeleteDocument}
                  onToggleFavorite={onToggleFavorite}
                  onOpenMiniEditor={onOpenMiniEditor}
                  onChatWithFile={onChatWithFile}
                  onOpenMedia={onOpenMedia}
                  hybrid={true}
                  isDragging={isDragging}
                  isSelected={selectedDocIds.has(String(doc._id))}
                  onToggleSelect={(docId) => toggleSelected(String(docId))}
                  onCardMouseClick={(docId, e) =>
                    onCardClickWithModifiers(
                      docId,
                      e,
                      `segmented:${groupKey}`,
                      orderedGroupIds,
                    )
                  }
                />
              );
            }}
            gridClassName="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-6"
          />
        </div>
      );
    },
    [
      docsById,
      documentTagsById,
      filter,
      handleSegmentedReorder,
      onCardClickWithModifiers,
      onChatWithFile,
      onDeleteDocument,
      onOpenMedia,
      onOpenMiniEditor,
      onSelectDocument,
      onToggleFavorite,
      orderDocsBy,
      renderDocumentDragOverlay,
      segmentedOrderByGroup,
      selectedDocIds,
      toggleSelected,
    ],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      {renderSegmentedGroup(
        "favorites",
        groupedDocuments.favorites,
        "Favorites",
        <Star className="h-4 w-4 text-yellow-500" />,
        ["all", "favorites"],
      )}

      {renderSegmentedGroup(
        "calendar",
        groupedDocuments.calendar,
        "Calendar",
        <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
        ["all", "calendar"],
      )}

      {renderSegmentedGroup(
        "text",
        groupedDocuments.text,
        "Documents",
        <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
        ["all", "text"],
      )}

      {renderSegmentedGroup(
        "files",
        groupedDocuments.files,
        "Files",
        <File className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
        ["all", "files"],
      )}

      {filter === "all" &&
        groupedDocuments.calendar.length === 0 &&
        groupedDocuments.text.length === 0 &&
        groupedDocuments.files.length === 0 &&
        groupedDocuments.favorites.length === 0 && (
          <div className="text-sm text-content-secondary">
            No documents found.
          </div>
        )}

      {filter !== "all" &&
        ((filter === "calendar" &&
          groupedDocuments.calendar.length === 0) ||
          (filter === "text" && groupedDocuments.text.length === 0) ||
          (filter === "files" && groupedDocuments.files.length === 0) ||
          (filter === "favorites" &&
            groupedDocuments.favorites.length === 0)) && (
          <div className="text-sm text-content-secondary">
            No documents found.
          </div>
        )}
    </div>
  );
});

export default DocumentsSegmentedView;
