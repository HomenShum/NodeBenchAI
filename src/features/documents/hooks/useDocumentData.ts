/**
 * useDocumentData
 *
 * Document data normalization, filtering, and computed document sets.
 */

import { useState, useEffect, useMemo } from "react";
import type { DocumentCardData } from "@features/documents/components/documentsHub/utils/documentHelpers";
import { normalizeDocument } from "@features/documents/components/documentsHub/utils/documentHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDocumentDataParams {
  /** Raw documents array from Convex query (may be undefined while loading) */
  documents: any[] | undefined;
  /** Whether the calendar card is hidden (e.g. Timeline view) */
  hideCalendarCard?: boolean;
}

export interface DocumentDataSlice {
  // --- Loading ---
  isDocsLoading: boolean;
  showDocsLoadingFallback: boolean;

  // --- Normalized documents ---
  documentsNorm: DocumentCardData[];

  // --- Filter / view mode ---
  filter: string;
  setFilter: React.Dispatch<React.SetStateAction<string>>;
  docViewMode: "cards" | "list" | "segmented";
  setDocViewMode: React.Dispatch<React.SetStateAction<"cards" | "list" | "segmented">>;

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
  docsById: Record<string, DocumentCardData>;
  emptyFileCount: number;

  documentTypes: Array<{ id: string; label: string; icon: React.ReactNode }>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentData({
  documents,
}: UseDocumentDataParams): DocumentDataSlice {
  // -------------------------------------------------------------------------
  // Loading fallback
  // -------------------------------------------------------------------------

  const isDocsLoading = documents === undefined;
  const [showDocsLoadingFallback, setShowDocsLoadingFallback] = useState(false);

  useEffect(() => {
    if (!isDocsLoading) {
      setShowDocsLoadingFallback(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDocsLoadingFallback(true), 7000);
    return () => window.clearTimeout(timer);
  }, [isDocsLoading]);

  // -------------------------------------------------------------------------
  // Normalized documents
  // -------------------------------------------------------------------------

  const documentsNorm: Array<DocumentCardData> = useMemo(
    () => (documents ?? []).map(normalizeDocument),
    [documents],
  );

  // -------------------------------------------------------------------------
  // Filter / view mode
  // -------------------------------------------------------------------------

  const [filter, setFilter] = useState<string>("all");
  const [docViewMode, setDocViewMode] = useState<"cards" | "list" | "segmented">("cards");

  // -------------------------------------------------------------------------
  // Computed document sets
  // -------------------------------------------------------------------------

  const allDocuments = useMemo(
    () => documentsNorm.filter((doc) => !doc.isArchived),
    [documentsNorm],
  );

  const groupedDocuments = useMemo(
    () => ({
      calendar: allDocuments.filter(
        (doc) =>
          doc.title.toLowerCase().includes("calendar") ||
          doc.title.toLowerCase().includes("schedule"),
      ),
      files: allDocuments.filter((doc) => doc.documentType === "file"),
      text: allDocuments.filter(
        (doc) =>
          (!doc.documentType || doc.documentType === "text") &&
          !doc.title.toLowerCase().includes("calendar") &&
          !doc.title.toLowerCase().includes("schedule"),
      ),
      favorites: allDocuments.filter((doc) => doc.isFavorite),
    }),
    [allDocuments],
  );

  const countsByFilter = useMemo(
    () => ({
      all: allDocuments.length,
      calendar: groupedDocuments.calendar.length,
      text: groupedDocuments.text.length,
      files: groupedDocuments.files.length,
      favorites: groupedDocuments.favorites.length,
    }),
    [
      allDocuments.length,
      groupedDocuments.calendar.length,
      groupedDocuments.text.length,
      groupedDocuments.files.length,
      groupedDocuments.favorites.length,
    ],
  );

  const filteredDocuments = useMemo(() => {
    if (filter === "all") return allDocuments;
    if (filter === "calendar") return groupedDocuments.calendar;
    if (filter === "files") return groupedDocuments.files;
    if (filter === "text") return groupedDocuments.text;
    if (filter === "favorites") return groupedDocuments.favorites;
    return [];
  }, [filter, allDocuments, groupedDocuments]);

  const docsById = useMemo(() => {
    const m: Record<string, DocumentCardData> = {};
    for (const d of filteredDocuments) m[d._id] = d;
    return m;
  }, [filteredDocuments]);

  const emptyFileCount = useMemo(() => {
    return allDocuments.filter((doc) => doc.fileSize === 0).length;
  }, [allDocuments]);

  // -------------------------------------------------------------------------
  // Filter toolbar options
  // -------------------------------------------------------------------------

  const documentTypes = useMemo(
    () => [
      { id: "all", label: "All", icon: null as React.ReactNode },
      { id: "calendar", label: "Calendar", icon: null as React.ReactNode },
      { id: "text", label: "Documents", icon: null as React.ReactNode },
      { id: "favorites", label: "Favorites", icon: null as React.ReactNode },
    ],
    [],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    isDocsLoading,
    showDocsLoadingFallback,
    documentsNorm,
    filter,
    setFilter,
    docViewMode,
    setDocViewMode,
    allDocuments,
    groupedDocuments,
    countsByFilter,
    filteredDocuments,
    docsById,
    emptyFileCount,
    documentTypes,
  };
}
