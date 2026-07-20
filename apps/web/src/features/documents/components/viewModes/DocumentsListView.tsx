/**
 * DocumentsListView — lazy-loaded list-mode surface for DocumentsTabContent.
 */

import React, { memo } from "react";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  DocumentRow,
  IntelligenceTable,
} from "@features/documents/components/documentsHub";
import { SortableList } from "@/shared/components/SortableList";

type PersistedTag = {
  _id?: Id<"tags">;
  name: string;
  kind?: string;
  importance?: number;
};

export interface DocumentsListViewProps {
  orderedDocumentIds: (string | Id<"documents">)[];
  docsById: Record<string, any>;
  documentTagsById: Record<string, PersistedTag[]>;
  selectedDocIds: Set<string>;
  onReorder: (newOrderIds: (string | Id<"documents">)[]) => void;
  onSelect: (id: Id<"documents">) => void;
  onToggleSelect: (id: Id<"documents">) => void;
  onToggleFavorite: (id: any) => void;
  onDelete: (id: any) => void;
  onChat: () => void;
}

const DocumentsListView = memo(function DocumentsListView(
  props: DocumentsListViewProps,
) {
  const {
    orderedDocumentIds,
    docsById,
    documentTagsById,
    selectedDocIds,
    onReorder,
    onSelect,
    onToggleSelect,
    onToggleFavorite,
    onDelete,
    onChat,
  } = props;

  return (
    <IntelligenceTable>
      <SortableList
        items={orderedDocumentIds}
        onReorder={onReorder}
        renderItem={(id, _index, _isDragging) => {
          const doc = docsById[String(id)];
          if (!doc) return null;
          return (
            <DocumentRow
              doc={doc}
              persistedTags={documentTagsById[String(doc._id)] ?? []}
              loadPersistedTags={false}
              isSelected={selectedDocIds.has(doc._id)}
              onSelect={onSelect}
              onToggleSelect={onToggleSelect}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
              onChat={onChat}
            />
          );
        }}
      />
    </IntelligenceTable>
  );
});

export default DocumentsListView;
