/**
 * DocumentsCardsView — lazy-loaded cards-mode surface for DocumentsTabContent.
 */

import React, { memo } from "react";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  DocumentCardMemo,
  type DocumentCardData,
} from "@features/documents/components/documentsHub";
import { DocumentsGridSortable } from "../DocumentsGridSortable";

type PersistedTag = {
  _id?: Id<"tags">;
  name: string;
  kind?: string;
  importance?: number;
};

export interface DocumentsCardsViewProps {
  orderedDocumentIds: (string | Id<"documents">)[];
  docsById: Record<string, DocumentCardData>;
  documentTagsById: Record<string, PersistedTag[]>;
  selectedDocIds: Set<string>;
  filter: string;
  onReorder: (newOrderIds: (string | Id<"documents">)[]) => void;
  renderDocumentDragOverlay: (id: string | Id<"documents">) => React.ReactNode;
  onSelectDocument: (id: any, toggle?: boolean) => void;
  onDeleteDocument: (id: any) => void;
  onToggleFavorite: (id: any) => void;
  onOpenMiniEditor: (doc: any) => void;
  onChatWithFile: (doc: any) => void;
  onAnalyzeWithAI?: (doc: any) => void;
  onOpenMedia: (doc: any) => void;
  toggleSelected: (id: string) => void;
  onCardClickWithModifiers: (
    docId: any,
    e: React.MouseEvent,
    groupKey: string,
    orderedIds: any[],
  ) => void;
}

const DocumentsCardsView = memo(function DocumentsCardsView(
  props: DocumentsCardsViewProps,
) {
  const {
    orderedDocumentIds,
    docsById,
    documentTagsById,
    selectedDocIds,
    filter,
    onReorder,
    renderDocumentDragOverlay,
    onSelectDocument,
    onDeleteDocument,
    onToggleFavorite,
    onOpenMiniEditor,
    onChatWithFile,
    onAnalyzeWithAI,
    onOpenMedia,
    toggleSelected,
    onCardClickWithModifiers,
  } = props;

  return (
    <DocumentsGridSortable
      items={orderedDocumentIds}
      onReorder={onReorder}
      renderOverlayItem={renderDocumentDragOverlay}
      renderItem={(id, _index, isDragging) => {
        const doc = docsById[String(id)];
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
            onAnalyzeFile={onAnalyzeWithAI}
            onOpenMedia={onOpenMedia}
            hybrid={true}
            isDragging={isDragging}
            isSelected={selectedDocIds.has(String(doc._id))}
            onToggleSelect={(docId) => toggleSelected(String(docId))}
            onCardMouseClick={(docId, e) =>
              onCardClickWithModifiers(
                docId,
                e,
                `cards:${filter}`,
                orderedDocumentIds,
              )
            }
          />
        );
      }}
      gridClassName="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-6"
    />
  );
});

export default DocumentsCardsView;
