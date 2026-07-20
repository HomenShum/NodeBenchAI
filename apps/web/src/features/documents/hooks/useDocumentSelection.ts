/**
 * useDocumentSelection
 *
 * Document selection state and bulk action handlers.
 */

import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import type { DocumentCardData } from "@features/documents/components/documentsHub/utils/documentHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDocumentSelectionParams {
  /** All non-archived documents (for cleanup) */
  allDocuments: DocumentCardData[];
}

export interface DocumentSelectionSlice {
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

  // --- Bulk action handlers ---
  handleBulkToggleFavorite: () => Promise<void>;
  handleBulkArchive: () => Promise<void>;
  handleDuplicateDocument: (docId: Id<"documents">) => Promise<void>;
  handleCleanupEmptyFiles: () => Promise<void>;
  handleDeleteDocument: (documentId: Id<"documents">) => void;
  handleToggleFavorite: (documentId: Id<"documents">) => void;

  // --- Mutations (pass-through) ---
  archiveDocument: ReturnType<typeof useMutation>;
  toggleFavorite: ReturnType<typeof useMutation>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentSelection({
  allDocuments,
}: UseDocumentSelectionParams): DocumentSelectionSlice {
  // -------------------------------------------------------------------------
  // Multi-select state
  // -------------------------------------------------------------------------

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  const [selectAnchorByContext, setSelectAnchorByContext] = useState<
    Record<string, string | null>
  >({});

  const toggleSelected = useCallback((id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedDocIds(new Set()), []);

  const handleCardClickWithModifiers = useCallback(
    (
      docId: Id<"documents">,
      e: React.MouseEvent,
      contextKey: string,
      orderedIds: Array<Id<"documents">>,
    ): boolean => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleSelected(String(docId));
        setSelectAnchorByContext((prev) => ({
          ...prev,
          [contextKey]: String(docId),
        }));
        return true;
      }

      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const anchor = selectAnchorByContext[contextKey] ?? String(docId);
        const a = orderedIds.findIndex((id) => String(id) === String(anchor));
        const b = orderedIds.findIndex((id) => String(id) === String(docId));

        if (a !== -1 && b !== -1) {
          const [start, end] = a <= b ? [a, b] : [b, a];
          const range = orderedIds
            .slice(start, end + 1)
            .map((id) => String(id));

          setSelectedDocIds((prev) => {
            const next = new Set(prev);
            for (const id of range) next.add(id);
            return next;
          });

          setSelectAnchorByContext((prev) => ({
            ...prev,
            [contextKey]: String(docId),
          }));
          return true;
        }

        // Fallback to toggle
        toggleSelected(String(docId));
        setSelectAnchorByContext((prev) => ({
          ...prev,
          [contextKey]: String(docId),
        }));
        return true;
      }

      return false;
    },
    [selectAnchorByContext, toggleSelected],
  );

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const archiveDocument = useMutation(api.domains.documents.documents.archive);
  const toggleFavorite = useMutation(api.domains.documents.documents.toggleFavorite);
  const bulkArchiveMutation = useMutation(api.domains.documents.batchOperations.bulkArchive);
  const bulkToggleFavoriteMutation = useMutation(api.domains.documents.batchOperations.bulkToggleFavorite);
  const duplicateDocumentMutation = useMutation(api.domains.documents.documents.duplicateDocument);
  const deleteDocMutation = useMutation(api.domains.documents.documents.remove);

  // -------------------------------------------------------------------------
  // Bulk action handlers
  // -------------------------------------------------------------------------

  const handleBulkToggleFavorite = useCallback(async () => {
    const ids = Array.from(selectedDocIds) as Array<Id<"documents">>;
    if (ids.length === 0) return;
    await bulkToggleFavoriteMutation({ documentIds: ids });
    clearSelection();
  }, [selectedDocIds, bulkToggleFavoriteMutation, clearSelection]);

  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedDocIds) as Array<Id<"documents">>;
    if (ids.length === 0) return;
    await bulkArchiveMutation({ documentIds: ids });
    clearSelection();
  }, [selectedDocIds, bulkArchiveMutation, clearSelection]);

  const handleDuplicateDocument = useCallback(
    async (docId: Id<"documents">) => {
      await duplicateDocumentMutation({ documentId: docId });
    },
    [duplicateDocumentMutation],
  );

  const handleDeleteDocument = useCallback(
    (documentId: Id<"documents">) => {
      archiveDocument({ id: documentId }).catch(console.error);
    },
    [archiveDocument],
  );

  const handleToggleFavorite = useCallback(
    (documentId: Id<"documents">) => {
      toggleFavorite({ id: documentId }).catch(console.error);
    },
    [toggleFavorite],
  );

  const handleCleanupEmptyFiles = useCallback(async () => {
    const emptyDocs = allDocuments.filter((doc) => doc.fileSize === 0);
    if (emptyDocs.length === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${emptyDocs.length} empty file${emptyDocs.length > 1 ? "s" : ""}? This action cannot be undone.`,
    );
    if (!confirmed) return;

    let deleted = 0;
    for (const doc of emptyDocs) {
      try {
        await deleteDocMutation({ documentId: doc._id } as any);
        deleted++;
      } catch (e) {
        console.error("Failed to delete empty doc:", doc._id, e);
      }
    }
    toast.success(`Deleted ${deleted} empty file${deleted > 1 ? "s" : ""}`);
  }, [allDocuments, deleteDocMutation]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    selectedDocIds,
    setSelectedDocIds,
    selectAnchorByContext,
    setSelectAnchorByContext,
    toggleSelected,
    clearSelection,
    handleCardClickWithModifiers,
    handleBulkToggleFavorite,
    handleBulkArchive,
    handleDuplicateDocument,
    handleCleanupEmptyFiles,
    handleDeleteDocument,
    handleToggleFavorite,
    archiveDocument,
    toggleFavorite,
  };
}
