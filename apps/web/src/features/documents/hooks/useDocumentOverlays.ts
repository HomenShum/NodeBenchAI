/**
 * useDocumentOverlays
 *
 * Document-side overlay/controller state: media viewer, compile/seed flags,
 * frequent-doc selection, analyze state, CRUD handlers for create/timeline/chat.
 */

import { useState, useEffect, useCallback } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import type { DocumentCardData } from "@features/documents/components/documentsHub/utils/documentHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDocumentOverlaysParams {
  /** Called when user selects/opens a document */
  onDocumentSelect: (documentId: Id<"documents">) => void;
  /** Raw documents array (for frequent-doc initialization) */
  documents: any[] | undefined;
}

export interface DocumentOverlaySlice {
  // --- Media viewer ---
  viewingMediaDoc: DocumentCardData | null;
  setViewingMediaDoc: React.Dispatch<React.SetStateAction<DocumentCardData | null>>;
  handleOpenMedia: (doc: DocumentCardData) => void;
  handleCloseMedia: () => void;

  // --- Compile / seed flags ---
  isCompiling: boolean;
  setIsCompiling: React.Dispatch<React.SetStateAction<boolean>>;
  isSeedingTimeline: boolean;
  setIsSeedingTimeline: React.Dispatch<React.SetStateAction<boolean>>;

  // --- Frequent doc / analyze ---
  selectedFrequentDoc: Id<"documents"> | null;
  setSelectedFrequentDoc: React.Dispatch<React.SetStateAction<Id<"documents"> | null>>;
  analyzeRunningDocId: Id<"documents"> | null;

  // --- CRUD handlers ---
  handleSelectDocument: (documentId: Id<"documents">) => void;
  handleChatWithFile: (doc: { _id: Id<"documents">; title: string }) => void;
  handleAnalyzeWithAI: (doc: { _id: Id<"documents">; title: string }) => void;
  handleCreateDocument: (type: "text" | "calendar") => Promise<void>;
  handleCreateTimelineDoc: () => Promise<void>;

  // --- Mutations (pass-through) ---
  createDocument: ReturnType<typeof useMutation>;
  createWithSnapshot: ReturnType<typeof useMutation>;
  setDocumentType: ReturnType<typeof useMutation>;
  createTimelineForDoc: ReturnType<typeof useMutation>;
  applyPlanTimeline: ReturnType<typeof useMutation>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDocumentOverlays({
  onDocumentSelect,
  documents,
}: UseDocumentOverlaysParams): DocumentOverlaySlice {
  // -------------------------------------------------------------------------
  // Media Cinema Viewer state
  // -------------------------------------------------------------------------

  const [viewingMediaDoc, setViewingMediaDoc] = useState<DocumentCardData | null>(null);

  const handleOpenMedia = useCallback((doc: DocumentCardData) => {
    setViewingMediaDoc(doc);
  }, []);

  const handleCloseMedia = useCallback(() => {
    setViewingMediaDoc(null);
  }, []);

  // -------------------------------------------------------------------------
  // Compile / seed flags
  // -------------------------------------------------------------------------

  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [isSeedingTimeline, setIsSeedingTimeline] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Frequently-selected document & analyze state
  // -------------------------------------------------------------------------

  const [selectedFrequentDoc, setSelectedFrequentDoc] =
    useState<Id<"documents"> | null>(null);

  const [analyzeRunningDocId, setAnalyzeRunningDocId] =
    useState<Id<"documents"> | null>(null);

  // Initialize most-frequent document
  useEffect(() => {
    if (documents && !selectedFrequentDoc) {
      const calendarDoc = documents.find(
        (doc: any) =>
          !doc.isArchived &&
          (doc.title.toLowerCase().includes("calendar") ||
            doc.title.toLowerCase().includes("schedule")),
      );

      if (calendarDoc) {
        setSelectedFrequentDoc(calendarDoc._id);
      } else if (documents.length > 0) {
        const firstDoc = documents.find((doc: any) => !doc.isArchived);
        if (firstDoc) {
          setSelectedFrequentDoc(firstDoc._id);
        }
      }
    }
  }, [documents, selectedFrequentDoc]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const createDocument = useMutation(api.domains.documents.documents.create);
  const createWithSnapshot = useMutation(api.domains.documents.prosemirror.createDocumentWithInitialSnapshot);
  const setDocumentType = useMutation(api.domains.documents.documents.setDocumentType);
  const createTimelineForDoc = useMutation(
    api.domains.agents.agentTimelines.createForDocument,
  );
  const applyPlanTimeline = useMutation(api.domains.agents.agentTimelines.applyPlan);

  // -------------------------------------------------------------------------
  // CRUD handlers
  // -------------------------------------------------------------------------

  const handleSelectDocument = useCallback(
    (documentId: Id<"documents">) => {
      setSelectedFrequentDoc(documentId);
      onDocumentSelect(documentId);
    },
    [onDocumentSelect],
  );

  const handleChatWithFile = useCallback(
    (doc: { _id: Id<"documents">; title: string }) => {
      try {
        window.dispatchEvent(
          new CustomEvent("ai:chatWithDocument", {
            detail: { documentId: doc._id, documentTitle: doc.title },
          }),
        );
      } catch {
        // no-op
      }
    },
    [],
  );

  const handleAnalyzeWithAI = useCallback(
    (doc: { _id: Id<"documents">; title: string }) => {
      try {
        window.dispatchEvent(
          new CustomEvent("ai:analyzeDocument", {
            detail: {
              documentId: doc._id,
              documentTitle: doc.title,
              arbitrageMode: true,
              prompt: `Analyze the document "${doc.title}" using receipts-first research. Verify key claims, check source quality, and identify any contradictions or changes.`,
            },
          }),
        );
      } catch {
        // no-op
      }
    },
    [],
  );

  const handleCreateDocument = useCallback(
    async (type: "text" | "calendar") => {
      const title = type === "calendar" ? "New Calendar" : "Untitled Document";

      const newDoc = await createWithSnapshot({
        title,
        initialContent: { type: "doc", content: [] },
      } as any);

      handleSelectDocument(newDoc);
    },
    [createWithSnapshot, handleSelectDocument],
  );

  const handleCreateTimelineDoc = useCallback(async () => {
    const newDoc = await createDocument({ title: "Timeline Gantt" });

    try {
      await createTimelineForDoc({ documentId: newDoc, name: "Timeline" });
      await setDocumentType({ id: newDoc, documentType: "timeline" });
    } catch {
      // noop
    }

    handleSelectDocument(newDoc);
  }, [createDocument, createTimelineForDoc, handleSelectDocument, setDocumentType]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    viewingMediaDoc,
    setViewingMediaDoc,
    handleOpenMedia,
    handleCloseMedia,
    isCompiling,
    setIsCompiling,
    isSeedingTimeline,
    setIsSeedingTimeline,
    selectedFrequentDoc,
    setSelectedFrequentDoc,
    analyzeRunningDocId,
    handleSelectDocument,
    handleChatWithFile,
    handleAnalyzeWithAI,
    handleCreateDocument,
    handleCreateTimelineDoc,
    createDocument,
    createWithSnapshot,
    setDocumentType,
    createTimelineForDoc,
    applyPlanTimeline,
  };
}
