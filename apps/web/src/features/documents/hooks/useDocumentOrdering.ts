/**
 * useDocumentOrdering
 *
 * Document ordering persistence (per-filter and per-segment) with
 * localStorage + server hydration.
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { DocumentCardData } from "@features/documents/components/documentsHub/utils/documentHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDocumentOrderingParams {
  /** Currently logged-in user (from Convex auth query) */
  loggedInUser: any;
  /** Current filter key (used for ordered-documents derivation) */
  filter: string;
  /** Filtered documents to order */
  filteredDocuments: DocumentCardData[];
}

export interface DocumentOrderSlice {
  docOrderByFilter: Record<string, Array<string>>;
  setDocOrderByFilter: React.Dispatch<React.SetStateAction<Record<string, Array<string>>>>;
  segmentedOrderByGroup: Record<string, Array<string>>;
  setSegmentedOrderByGroup: React.Dispatch<React.SetStateAction<Record<string, Array<string>>>>;
  orderDocsBy: (ids: string[] | undefined, docs: DocumentCardData[]) => DocumentCardData[];
  orderedDocuments: DocumentCardData[];

  // --- Mutations (pass-through) ---
  saveOrderForFilter: ReturnType<typeof useMutation>;
  saveOrderForSegmented: ReturnType<typeof useMutation>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentOrdering({
  loggedInUser,
  filter,
  filteredDocuments,
}: UseDocumentOrderingParams): DocumentOrderSlice {
  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const saveOrderForFilter = useMutation(
    api.domains.auth.userPreferences.setDocOrderForFilter,
  );
  const saveOrderForSegmented = useMutation(
    api.domains.auth.userPreferences.setDocOrderForSegmented,
  );

  // -------------------------------------------------------------------------
  // Server query
  // -------------------------------------------------------------------------

  const docOrders = useQuery(
    api.domains.auth.userPreferences.getDocOrders,
    loggedInUser ? {} : "skip",
  );

  // -------------------------------------------------------------------------
  // Per-filter ordering
  // -------------------------------------------------------------------------

  const [docOrderByFilter, setDocOrderByFilter] = useState<
    Record<string, Array<string>>
  >({});

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nodebench:docOrderByFilter");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Array<string>>;
        if (parsed && typeof parsed === "object") setDocOrderByFilter(parsed);
      }
    } catch {
      // no-op
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "nodebench:docOrderByFilter",
        JSON.stringify(docOrderByFilter),
      );
    } catch {
      // no-op
    }
  }, [docOrderByFilter]);

  // Hydrate from server when available
  useEffect(() => {
    if (!loggedInUser || !docOrders) return;
    if (docOrders.docOrderByFilter) {
      setDocOrderByFilter(docOrders.docOrderByFilter);
    }
  }, [loggedInUser, docOrders]);

  // -------------------------------------------------------------------------
  // Segmented ordering (per-group)
  // -------------------------------------------------------------------------

  const [segmentedOrderByGroup, setSegmentedOrderByGroup] = useState<
    Record<string, Array<string>>
  >({});

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nodebench:docOrderBySegmented");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Array<string>>;
        if (parsed && typeof parsed === "object")
          setSegmentedOrderByGroup(parsed);
      }
    } catch {
      /* no-op */
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "nodebench:docOrderBySegmented",
        JSON.stringify(segmentedOrderByGroup),
      );
    } catch {
      /* no-op */
    }
  }, [segmentedOrderByGroup]);

  // Hydrate from server when available
  useEffect(() => {
    if (!loggedInUser || !docOrders) return;
    if (docOrders.docOrderBySegmented) {
      setSegmentedOrderByGroup(docOrders.docOrderBySegmented);
    }
  }, [loggedInUser, docOrders]);

  // -------------------------------------------------------------------------
  // Ordering utility
  // -------------------------------------------------------------------------

  const orderDocsBy = useCallback(
    (ids: string[] | undefined, docs: DocumentCardData[]) => {
      if (!ids || ids.length === 0) return docs;

      const byId: Record<string, DocumentCardData> = {};
      for (const d of docs) byId[d._id] = d;

      const ordered: DocumentCardData[] = [];
      const seen = new Set<string>();

      for (const id of ids) {
        const found = byId[id];
        if (found) {
          ordered.push(found);
          seen.add(id);
        }
      }

      for (const d of docs) {
        if (!seen.has(d._id)) ordered.push(d);
      }

      return ordered;
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Ordered documents (derived)
  // -------------------------------------------------------------------------

  const orderedDocuments = (() => {
    const order = docOrderByFilter[filter] ?? [];
    if (order.length === 0) return filteredDocuments;

    const byId: Record<string, DocumentCardData> = {};
    for (const d of filteredDocuments) byId[d._id] = d;

    const inOrder: DocumentCardData[] = [];
    for (const id of order) {
      const doc = byId[id];
      if (doc) inOrder.push(doc);
    }

    // Append any docs not yet in the saved order
    for (const d of filteredDocuments) {
      if (!order.includes(d._id)) inOrder.push(d);
    }

    return inOrder;
  })();

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    docOrderByFilter,
    setDocOrderByFilter,
    segmentedOrderByGroup,
    setSegmentedOrderByGroup,
    orderDocsBy,
    orderedDocuments,
    saveOrderForFilter,
    saveOrderForSegmented,
  };
}
