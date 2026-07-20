/**
 * usePendingEdits - Hook to subscribe to pending document edits and dispatch to PmBridge
 *
 * This hook implements the client-side of the Deep Agent edit round-trip:
 * 1. Subscribes to pendingDocumentEdits table (Convex real-time)
 * 2. Queues edits and processes them sequentially to prevent race conditions
 * 3. Dispatches edits to PmBridge via custom events in createdAt order
 * 4. Reports success/failure back to Convex for agent self-correction
 *
 * Enhanced with:
 * - Sequential edit queue to prevent concurrent edit conflicts
 * - Per-thread edit grouping for multi-agent scenarios
 * - Document version tracking for optimistic locking
 *
 * Pattern based on useUIMessages and useArtifactStreamConsumer hooks
 */

import { useQuery, useMutation } from "convex/react";
import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export interface PendingEdit {
  _id: Id<"pendingDocumentEdits">;
  documentId: Id<"documents">;
  agentThreadId: string;
  documentVersion: number;
  operation: {
    type: "anchoredReplace";
    anchor: string;
    search: string;
    replace: string;
    sectionHint?: string;
  };
  status: "pending" | "applied" | "failed" | "cancelled" | "stale";
  errorMessage?: string;
  retryCount: number;
  createdAt: number;
  appliedAt?: number;
}

/** Statistics for a specific agent thread */
export interface ThreadEditStats {
  threadId: string;
  pending: number;
  applied: number;
  failed: number;
  stale: number;
  total: number;
  edits: PendingEdit[];
}

interface UsePendingEditsResult {
  /** All pending and failed edits for this document */
  pendingEdits: PendingEdit[];
  /** Whether there are any failed edits requiring attention */
  hasFailedEdits: boolean;
  /** Count of currently pending edits */
  pendingCount: number;
  /** Count of applied edits */
  appliedCount: number;
  /** Count of failed edits */
  failedCount: number;
  /** Count of stale edits */
  staleCount: number;
  /** Whether agent is actively editing */
  isAgentEditing: boolean;
  /** Whether the queue is currently processing an edit */
  isProcessing: boolean;
  /** The edit currently being processed (if any) */
  currentEdit: PendingEdit | null;
  /** Edit statistics grouped by agent thread */
  editsByThread: Map<string, ThreadEditStats>;
  /** Retry a specific failed edit */
  retryEdit: (editId: Id<"pendingDocumentEdits">) => Promise<void>;
  /** Cancel all pending edits for a specific thread */
  cancelThreadEdits: (threadId: string) => Promise<void>;
  /** Cancel all pending edits for all threads */
  cancelAllEdits: () => Promise<void>;
}

/**
 * Hook to subscribe to pending document edits and process them sequentially
 *
 * @param documentId - The document to monitor for pending edits
 * @returns Edit state and control functions
 */
export function usePendingEdits(
  documentId: Id<"documents"> | undefined
): UsePendingEditsResult {
  // Subscribe to pending edits from Convex (real-time updates)
  const pendingEdits = useQuery(
    api.domains.documents.pendingEdits.getPendingEditsForDocument,
    documentId ? { documentId } : "skip"
  ) as PendingEdit[] | undefined;

  // Mutations for reporting results and control
  const reportResult = useMutation(api.domains.documents.pendingEdits.reportEditResult);
  const retryEditMutation = useMutation(api.domains.documents.pendingEdits.retryEdit);
  const cancelAllMutation = useMutation(api.domains.documents.pendingEdits.cancelAllForThread);

  // Track which edits we've already dispatched to avoid duplicates
  const dispatchedIdsRef = useRef<Set<string>>(new Set());

  // Edit queue for sequential processing
  const editQueueRef = useRef<PendingEdit[]>([]);
  const isProcessingRef = useRef<boolean>(false);

  // State for current processing status (exposed to UI)
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentEdit, setCurrentEdit] = useState<PendingEdit | null>(null);

  /**
   * Process the next edit in the queue sequentially
   * Waits for each edit to complete before processing the next
   */
  const processNextEdit = useCallback(async () => {
    // If already processing or queue is empty, do nothing
    if (isProcessingRef.current || editQueueRef.current.length === 0) {
      if (editQueueRef.current.length === 0) {
        setIsProcessing(false);
        setCurrentEdit(null);
      }
      return;
    }

    // Mark as processing
    isProcessingRef.current = true;
    setIsProcessing(true);

    // Get the next edit (sorted by createdAt, oldest first)
    const edit = editQueueRef.current.shift()!;
    setCurrentEdit(edit);

    // Create a promise that resolves when the edit is complete
    const editComplete = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const onResult = async (success: boolean, error?: string) => {

        try {
          await reportResult({
            editId: edit._id,
            success,
            errorMessage: error,
          });
        } catch (err) {
          console.error("[usePendingEdits] Failed to report result:", err);
        }

        resolve({ success, error });
      };

      // Dispatch to PmBridge for application
      const event = new CustomEvent("nodebench:ai:applyPmOperations", {
        detail: {
          editId: edit._id,
          documentId: edit.documentId,
          documentVersion: edit.documentVersion,
          operations: [edit.operation],
          onResult,
        },
      });

      window.dispatchEvent(event);

      // Timeout after 30 seconds to prevent stuck edits
      setTimeout(() => {
        resolve({ success: false, error: "Edit timed out after 30 seconds" });
      }, 30000);
    });

    // Wait for this edit to complete
    await editComplete;

    // Mark as not processing and process next
    isProcessingRef.current = false;
    setCurrentEdit(null);

    // Small delay between edits to allow DOM updates
    await new Promise((r) => setTimeout(r, 50));

    // Process next edit in queue
    void processNextEdit();
  }, [reportResult]);

  // Queue new pending edits and trigger processing
  useEffect(() => {
    if (!pendingEdits || !documentId) return;

    // Find new pending edits that haven't been dispatched yet
    // Sort by createdAt to ensure oldest edits are processed first
    const newPendingEdits = pendingEdits
      .filter(
        (edit) =>
          edit.status === "pending" &&
          !dispatchedIdsRef.current.has(edit._id)
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    if (newPendingEdits.length === 0) return;

    // Add to queue and mark as dispatched
    for (const edit of newPendingEdits) {
      dispatchedIdsRef.current.add(edit._id);
      editQueueRef.current.push(edit);
    }

    // Sort queue by createdAt to maintain order
    editQueueRef.current.sort((a, b) => a.createdAt - b.createdAt);

    // Start processing if not already
    if (!isProcessingRef.current) {
      void processNextEdit();
    }
  }, [pendingEdits, documentId, processNextEdit]);

  // Clean up dispatched IDs and queue when document changes
  useEffect(() => {
    dispatchedIdsRef.current.clear();
    editQueueRef.current = [];
    isProcessingRef.current = false;
    setIsProcessing(false);
    setCurrentEdit(null);
  }, [documentId]);

  // Control functions
  const retryEdit = useCallback(
    async (editId: Id<"pendingDocumentEdits">) => {
      dispatchedIdsRef.current.delete(editId); // Allow re-dispatch after retry
      await retryEditMutation({ editId });
    },
    [retryEditMutation]
  );

  const cancelThreadEdits = useCallback(
    async (threadId: string) => {

      // Remove from local queue
      editQueueRef.current = editQueueRef.current.filter(
        (e) => e.agentThreadId !== threadId
      );

      // Cancel on backend
      await cancelAllMutation({ agentThreadId: threadId });
    },
    [cancelAllMutation]
  );

  const cancelAllEdits = useCallback(async () => {

    // Get unique thread IDs
    const threadIds = new Set<string>();
    pendingEdits?.forEach((e) => {
      if (e.status === "pending") {
        threadIds.add(e.agentThreadId);
      }
    });

    // Clear local queue
    editQueueRef.current = [];

    // Cancel all threads
    await Promise.all(
      Array.from(threadIds).map((threadId) =>
        cancelAllMutation({ agentThreadId: threadId })
      )
    );
  }, [pendingEdits, cancelAllMutation]);

  // Computed values with per-thread grouping
  const result = useMemo(() => {
    const edits = pendingEdits ?? [];
    const pending = edits.filter((e) => e.status === "pending");
    const failed = edits.filter((e) => e.status === "failed");
    const stale = edits.filter((e) => e.status === "stale");
    const applied = edits.filter((e) => e.status === "applied");

    // Group edits by thread
    const editsByThread = new Map<string, ThreadEditStats>();

    for (const edit of edits) {
      const threadId = edit.agentThreadId;

      if (!editsByThread.has(threadId)) {
        editsByThread.set(threadId, {
          threadId,
          pending: 0,
          applied: 0,
          failed: 0,
          stale: 0,
          total: 0,
          edits: [],
        });
      }

      const stats = editsByThread.get(threadId)!;
      stats.total++;
      stats.edits.push(edit);

      switch (edit.status) {
        case "pending":
          stats.pending++;
          break;
        case "applied":
          stats.applied++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "stale":
          stats.stale++;
          break;
      }
    }

    return {
      pendingEdits: edits,
      hasFailedEdits: failed.length > 0,
      pendingCount: pending.length,
      appliedCount: applied.length,
      failedCount: failed.length,
      staleCount: stale.length,
      isAgentEditing: pending.length > 0 || isProcessing,
      isProcessing,
      currentEdit,
      editsByThread,
      retryEdit,
      cancelThreadEdits,
      cancelAllEdits,
    };
  }, [pendingEdits, isProcessing, currentEdit, retryEdit, cancelThreadEdits, cancelAllEdits]);

  return result;
}

export default usePendingEdits;

