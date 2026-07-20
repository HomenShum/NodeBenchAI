/**
 * EntityNotebookLive — Phase 3-4 of the Roam-inspired notebook.
 *
 * Renders the entity as a single flowing document of persisted blocks from
 * productBlocks. Focused editable blocks use a Tiptap + Convex ProseMirror
 * sync editor so collaboration happens on maintained OT plumbing while the
 * notebook keeps its existing BlockChip[] persistence contract and provenance.
 * Enter appends a block, Backspace at start merges with previous, and `/`
 * opens the slash command palette.
 *
 * The notebook keeps the backend contract stable and only swaps the editing
 * shell, so report/backfill/query behavior can harden independently from the
 * editor implementation.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink, Link2, Lock } from "lucide-react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  chipsEqual,
  chipsToPlainText,
  describeNotebookMutationFailure,
  extractConvexRequestId,
  getNotebookLoadState,
  isSyncEditableBlock,
  isTriviallyEmptyNotebookBlock,
  parseNotebookMutationError,
  resolvePresenceSelfUserId,
  shouldRefreshAgentNotebookProjection,
  type AccessMode,
  type AuthorKind,
  type BlockKind,
  type LiveBlock,
  type ParsedNotebookMutationError,
} from "./entityNotebookLiveHelpers";
// Re-exports keep existing imports (`./EntityNotebookLive`) working for
// consumers like EntityNotebookLive.test.tsx without forcing a test rewrite.
export {
  describeNotebookMutationFailure,
  extractConvexRequestId,
  getNotebookLoadState,
  parseNotebookMutationError,
  shouldRefreshAgentNotebookProjection,
};
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useStreamingSearch } from "@/hooks/useStreamingSearch";
import { publishNotebookAlert } from "@/lib/notebookAlerts";
import { useToast } from "@/shared/ui";
import {
  chipsFromMarkup,
  BlockChipRenderer,
  type BlockChip,
} from "./BlockChipRenderer";
import { BlockProvenance } from "./BlockProvenance";
import {
  NotebookBlockEditor,
  type NotebookBlockEditorHandle,
  type MarkdownBlockKind,
} from "./NotebookBlockEditor";
import { SlashPalette, type SlashCommand } from "./SlashPalette";
import { MentionPicker, type EntityMatch } from "./MentionPicker";
import { BlockStatusBar } from "./BlockStatusBar";
import { NotebookDiligenceOverlayHost } from "./NotebookDiligenceOverlayHost";
import { NotebookDismissalsSync } from "./NotebookDismissalsSync";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { NotebookTopStatusRow } from "@/features/entities/components/NotebookTopStatusRow";
import { WorkspaceDrawerPill } from "./WorkspaceDrawerPill";
import {
  enqueue as enqueueOfflineEdit,
  makeEditId,
  readQueue,
  removeById as removeOfflineEdit,
} from "./notebookOfflineQueue";
import { buildProductBlockSyncId } from "../../../../../shared/productBlockSync";
import { useDiligenceBlocks } from "./useDiligenceBlocks";
import type { DiligenceDecorationData } from "./DiligenceDecorationPlugin";
import { acceptDecorationIntoNotebook } from "./acceptDecorationIntoNotebook";
import {
  buildNotebookAuthorityOperationKey,
  buildNotebookAuthorityRemainderCompletionKey,
  evaluateNotebookAuthorityCandidate,
  hasNotebookAuthorityCandidateChanged,
  readScratchpadBaseRunId,
  recoverNotebookAuthorityCandidate,
  runInFlightOnly,
  shouldAutoCommitNotebookAuthorityProposal,
  shouldSubmitNewNotebookAuthorityAttempt,
  type NotebookAuthorityCandidate,
  type NotebookAuthorityOperationSnapshot,
} from "./entityNotebookAuthorityHelpers";
import {
  useAgentActions,
  type DecorationContext,
} from "@/features/agents/hooks/useAgentActions";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { AgentAuthorTag } from "@/features/agents/primitives/AgentAuthorTag";
import { NotebookAuthorityControl } from "@/features/agents/authority";
import { useViewMode } from "@/features/entities/lib/useViewMode";

type Props = {
  entitySlug: string;
  shareToken?: string;
  canEdit?: boolean;
  onOpenReferenceNotebook?: () => void;
  viewerOwnerKey?: string | null;
  collaborationParticipants?: Array<{
    ownerKey: string;
    label: string;
    email?: string;
  }>;
  latestHumanEdit?: {
    ownerKey?: string | null;
    updatedAt?: number | null;
  } | null;
};

type NotebookAuthorityGrant = {
  grantId: string;
  mode: "run" | "workspace";
  effectiveStatus: "active" | "paused" | "revoked" | "expired" | "consumed";
  entityId?: Id<"productEntities">;
  runId?: Id<"agentScratchpads">;
};

type NotebookAuthorityState = {
  mode: "review" | "run" | "workspace";
  grant: NotebookAuthorityGrant | null;
};

type NotebookAuthorityProposalResult = {
  proposalId: string;
  status: "pending" | "blocked" | "committing" | "committed" | "rejected";
  approvalMode: "explicit" | "delegated";
  receiptId: string | null;
  needsApproval?: boolean;
  needsGuardedCommit?: boolean;
  delegationDenied?: boolean;
  delegationFailureCode?: string;
  validationFailed?: boolean;
  validationFailureCode?: string;
  needsNewProposal?: boolean;
};

type NotebookAuthorityCommitResult = {
  proposalId: string;
  receiptId?: string;
  delegationDenied?: boolean;
  validationFailed?: boolean;
  reasonCode?: string;
  needsApproval?: boolean;
  needsNewProposal?: boolean;
};

type NotebookAuthorityRemainderResult = {
  completionKey: string;
  insertedBlockIds: Id<"productBlocks">[];
  lastBlockId: Id<"productBlocks">;
  idempotent: boolean;
};

type NotebookAuthorityDecorationPlan = {
  key: string;
  decoration: DiligenceDecorationData;
  candidate: NotebookAuthorityCandidate;
  grantId?: string;
  shouldSubmitProposal: boolean;
  operationState?: NotebookAuthorityServerOperationState;
};

type NotebookAuthorityServerOperationState =
  NotebookAuthorityOperationSnapshot & {
    status: "pending" | "blocked" | "committing" | "committed" | "rejected";
    entityId: Id<"productEntities">;
    approvalMode: "explicit" | "delegated";
    grantId: string | null;
    validationFailed: boolean;
    validationFailureCode: string | null;
    delegationDenied: boolean;
    delegationFailureCode: string | null;
    evidenceBlockType: DiligenceDecorationData["blockType"];
    evidenceScratchpadRunId: string;
    evidenceVersion: number;
    remainderCompletionKey: string | null;
    remainderCompleted: boolean;
    insertedBlockIds: Id<"productBlocks">[];
    canUndoNow: boolean;
    undoUnavailableReason: string | null;
    currentBlockRevision: number | null;
  };

type NotebookAuthorityWriteStatus = {
  key: string;
  tone: "review" | "partial" | "blocked" | "failed";
  title: string;
  detail: string;
  proposalId?: string;
  receiptId?: string;
};

// Helper implementations live in `./entityNotebookLiveHelpers`; removed here
// so this file stays focused on orchestration. Re-exports above preserve the
// historical `./EntityNotebookLive` import path for tests.

export function EntityNotebookLive({
  entitySlug,
  shareToken,
  canEdit: canEditProp = true,
  onOpenReferenceNotebook,
  viewerOwnerKey,
  collaborationParticipants,
  latestHumanEdit,
}: Props) {
  const api = useConvexApi();
  const navigate = useNavigate();
  const { openWithContext } = useFastAgent();
  const anonymousSessionId = getAnonymousProductSessionId();
  const toast = useToast();
  // Read-mode mask: when the page is in ?view=read, the notebook must
  // behave as if the viewer has no edit rights. Empty-state CTAs,
  // overlay accept affordances, and inline insert paths all branch on
  // canEdit — masking it here keeps the change surgical instead of
  // sprinkling `isReadMode &&` guards across 29 call sites.
  const { isReadMode } = useViewMode();
  const canEdit = canEditProp && !isReadMode;
  // Unified agent actions — routes inline decoration events into the
  // drawer's history + persists dismissals. See useAgentActions for
  // the seam contract. Keep this call ONCE at component top so the
  // React identity of the returned callbacks is stable for memoized
  // handlers below.
  const agentActions = useAgentActions();
  const participantDirectory = useMemo(
    () =>
      Object.fromEntries(
        (collaborationParticipants ?? []).map((participant) => [
          participant.ownerKey,
          participant.label,
        ]),
      ),
    [collaborationParticipants],
  );

  const blocksPagination = usePaginatedQuery(
    api?.domains.product.blocks.listEntityBlocksPaginated ?? ("skip" as any),
    api?.domains.product.blocks.listEntityBlocksPaginated
      ? { anonymousSessionId, shareToken, entitySlug }
      : "skip",
    { initialNumItems: 150 },
  );
  const blocks = blocksPagination.results as LiveBlock[] | undefined;
  const authorityBlock = blocks?.[0];
  const authorityEntityId = authorityBlock?.entityId;
  const isAuthorityOwner = Boolean(
    canEdit &&
    !shareToken &&
    viewerOwnerKey &&
    authorityBlock?.ownerKey === viewerOwnerKey,
  );
  const authorityState = useQuery(
    api?.domains?.agents?.autonomy?.grants?.getAuthorityState ?? "skip",
    api && isAuthorityOwner && authorityEntityId
      ? { entityId: authorityEntityId }
      : "skip",
  ) as NotebookAuthorityState | undefined;
  const authorityOperationStates = useQuery(
    api?.domains?.agents?.autonomy?.proposals?.listOperationStates ?? "skip",
    api && isAuthorityOwner && authorityEntityId
      ? { entityId: authorityEntityId, limit: 50 }
      : "skip",
  ) as NotebookAuthorityServerOperationState[] | undefined;

  const snapshot = useQuery(
    api?.domains.product.blocks.getEntityNotebook ?? "skip",
    api?.domains.product.blocks.getEntityNotebook
      ? { anonymousSessionId, shareToken, entitySlug }
      : "skip",
  );

  const blockSummary = useQuery(
    api?.domains.product.blocks.getEntityBlockSummary ?? "skip",
    api?.domains.product.blocks.getEntityBlockSummary
      ? { anonymousSessionId, shareToken, entitySlug }
      : "skip",
  );

  const latestScratchpadRun = useQuery(
    api?.domains.product.diligenceScratchpads?.getLatestForEntity as never,
    (canEdit && api?.domains.product.diligenceScratchpads?.getLatestForEntity
      ? { anonymousSessionId, shareToken, entitySlug, checkpointLimit: 8 }
      : "skip") as never,
  ) as
    | {
        scratchpadId: Id<"agentScratchpads">;
        runId: string;
        status: "streaming" | "structuring" | "merged" | "failed";
        markdownSource: string | null;
        version: number;
        updatedAt: number;
        checkpointCount: number;
        latestBlockType?: string | null;
        latestHeaderText?: string | null;
        checkpoints: Array<{
          checkpointId: string;
          checkpointNumber: number;
          currentStep: string;
          status:
            | "active"
            | "paused"
            | "completed"
            | "error"
            | "waiting_approval";
          progress: number;
          createdAt: number;
          error?: string;
        }>;
      }
    | null
    | undefined;

  const appendBlock = useMutation(
    api?.domains.product.blocks.appendBlock ?? ("skip" as any),
  );
  const backfillEntityBlocks = useMutation(
    api?.domains.product.blocks.backfillEntityBlocks ?? ("skip" as any),
  );
  const moveBlock = useMutation(
    api?.domains.product.blocks.moveBlock ?? ("skip" as any),
  );
  const insertBlockBetween = useMutation(
    api?.domains.product.blocks.insertBlockBetween ?? ("skip" as any),
  );
  const updateBlock = useMutation(
    api?.domains.product.blocks.updateBlock ?? ("skip" as any),
  );
  const deleteBlock = useMutation(
    api?.domains.product.blocks.deleteBlock ?? ("skip" as any),
  );
  const createBlockRelation = useMutation(
    api?.domains.product.blocks.createBlockRelation ?? ("skip" as any),
  );
  const notebookHeartbeat = useMutation(
    api?.domains.product.notebookPresence.notebookHeartbeat ?? ("skip" as any),
  );
  const notebookPresenceDisconnect = useMutation(
    api?.domains.product.notebookPresence.notebookPresenceDisconnect ??
      ("skip" as any),
  );
  const submitOfflineSnapshot = useMutation(
    api?.domains.product.blockProsemirror.submitOfflineSnapshot ??
      ("skip" as any),
  );
  const materializeProjectionOverlays = useMutation(
    api?.domains.product.diligenceProjections?.materializeForEntity as never,
  );
  const requestProjectionRefreshAndRun = useMutation(
    api?.domains.product.diligenceProjections?.requestRefreshAndRun as never,
  );
  const submitBlockProposal = useMutation(
    api?.domains?.agents?.autonomy?.proposals?.submitBlockProposal ??
      ("skip" as never),
  );
  const approveBlockProposal = useMutation(
    api?.domains?.agents?.autonomy?.proposals?.approveProposal ??
      ("skip" as never),
  );
  const commitBlockProposal = useMutation(
    api?.domains?.agents?.autonomy?.commits?.commitBlockProposal ??
      ("skip" as never),
  );
  const commitProposalRemainder = useMutation(
    api?.domains?.agents?.autonomy?.remainders?.commitProposalRemainder ??
      ("skip" as never),
  );

  const [slashFor, setSlashFor] = useState<Id<"productBlocks"> | null>(null);
  const [mentionFor, setMentionFor] = useState<{
    blockId: Id<"productBlocks">;
    initial: string;
  } | null>(null);
  const [focusedBlockId, setFocusedBlockId] =
    useState<Id<"productBlocks"> | null>(null);
  // Sticky mount set: once a block has been focused (or hovered near) this
  // session, keep its Tiptap editor mounted so subsequent clicks don't
  // re-fetch the Convex sync snapshot. Fixes the click-reload delay.
  const [mountedBlockIds, setMountedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const warmBlock = useCallback((blockId: Id<"productBlocks">) => {
    setMountedBlockIds((prev) => {
      const key = String(blockId);
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  // Hover-intent debounce for rapid mouse traversal across rows.
  // Flushes pending warms in a single setState call per animation-frame-ish
  // window. Keeps `warmBlock` synchronous for focus / delete paths where
  // we need the editor mounted on the next render.
  const hoverWarmBufferRef = useRef<Set<string>>(new Set());
  const hoverWarmTimerRef = useRef<number | null>(null);
  const scheduleWarm = useCallback((blockId: Id<"productBlocks">) => {
    const key = String(blockId);
    hoverWarmBufferRef.current.add(key);
    if (hoverWarmTimerRef.current !== null) return;
    hoverWarmTimerRef.current = window.setTimeout(() => {
      hoverWarmTimerRef.current = null;
      const buffer = hoverWarmBufferRef.current;
      if (buffer.size === 0) return;
      setMountedBlockIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const k of buffer) {
          if (!next.has(k)) {
            next.add(k);
            changed = true;
          }
        }
        buffer.clear();
        return changed ? next : prev;
      });
    }, 80);
  }, []);
  useEffect(
    () => () => {
      if (hoverWarmTimerRef.current !== null) {
        window.clearTimeout(hoverWarmTimerRef.current);
        hoverWarmTimerRef.current = null;
      }
    },
    [],
  );
  // Defer the dismissals Convex subscription to post-first-paint so the
  // WebSocket handshake doesn't compete with the notebook's initial render.
  // The subscription returns null visually and feeds into `dismissedKeySet`;
  // a one-frame delay before keys populate is imperceptible.
  const [dismissalsReady, setDismissalsReady] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setDismissalsReady(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const [runtimeError, setRuntimeError] = useState<{
    title: string;
    detail?: string;
  } | null>(null);
  const [creatingFirstBlock, setCreatingFirstBlock] = useState(false);
  const [preparingSeedContent, setPreparingSeedContent] = useState(false);
  const [optimisticBlockContent, setOptimisticBlockContent] = useState<
    Record<string, BlockChip[]>
  >({});
  const [presenceRoomToken, setPresenceRoomToken] = useState<string | null>(
    null,
  );
  const [presenceSessionToken, setPresenceSessionToken] = useState<
    string | null
  >(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [offlineQueueLength, setOfflineQueueLength] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);
  const [hiddenDecorationRunIds, setHiddenDecorationRunIds] = useState<
    Record<string, true>
  >({});
  const [authorityWriteStatus, setAuthorityWriteStatus] =
    useState<NotebookAuthorityWriteStatus | null>(null);
  const createFirstBlockInFlightRef =
    useRef<Promise<Id<"productBlocks"> | null> | null>(null);
  const autoCreateFirstBlockAttemptedRef = useRef(false);
  const autoSeedNotebookAttemptedRef = useRef(false);
  const editorHandlesRef = useRef<Map<string, NotebookBlockEditorHandle>>(
    new Map(),
  );
  const pendingOptimisticBlockContentRef = useRef<Record<string, BlockChip[]>>(
    {},
  );
  const presenceClientSessionIdRef = useRef(
    `nb-live-${entitySlug}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const materializedProjectionVersionKeyRef = useRef<string | null>(null);
  const authorityProposalPromisesRef = useRef<
    Map<string, Promise<NotebookAuthorityProposalResult>>
  >(new Map());
  const authorityProposalResultsRef = useRef<
    Map<string, NotebookAuthorityProposalResult>
  >(new Map());
  const authorityCommitPromisesRef = useRef<
    Map<string, Promise<NotebookAuthorityCommitResult>>
  >(new Map());
  const authorityReceiptByPlanRef = useRef<Map<string, string>>(new Map());
  const authorityPlanByDecorationRef = useRef<
    Map<string, NotebookAuthorityDecorationPlan>
  >(new Map());
  const authorityCompletedPlanKeysRef = useRef<Set<string>>(new Set());
  const authorityAcceptInFlightRef = useRef<Set<string>>(new Set());
  const authorityCandidateAvailableRef = useRef(false);

  const presence = useQuery(
    api?.domains.product.notebookPresence.notebookPresenceList ?? "skip",
    api?.domains.product.notebookPresence.notebookPresenceList &&
      presenceRoomToken
      ? { roomToken: presenceRoomToken }
      : "skip",
  ) as
    | Array<{ userId: string; online: boolean; lastDisconnected: number }>
    | undefined;

  const describeError = useCallback((error: unknown): string | undefined => {
    if (!error) return undefined;
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return undefined;
  }, []);

  const reportNotebookError = useCallback(
    (title: string, error: unknown) => {
      const detail = describeError(error);
      console.warn(`[notebook] ${title}`, error);
      setRuntimeError({ title, detail });
      toast.error(title, detail);
    },
    [describeError, toast],
  );

  // Codes we expect and handle gracefully — do NOT alert on these. They
  // correspond to the `level: "warning"` branch in describeNotebookMutationFailure
  // plus rate limit, both of which are designed-for states that don't need
  // a page-the-on-call signal.
  const EXPECTED_ALERT_CODES = useMemo(
    () => new Set(["REVISION_MISMATCH", "RATE_LIMITED", "CONTENT_TOO_LARGE"]),
    [],
  );

  const reportNotebookMutationFailure = useCallback(
    (action: "save" | "mention" | "command", error: unknown) => {
      const failure = describeNotebookMutationFailure(action, error);
      const parsed = parseNotebookMutationError(error);
      console.warn(`[notebook] ${failure.title}`, error);
      setRuntimeError({ title: failure.title, detail: failure.detail });
      if (failure.level === "warning") {
        toast.warning(failure.title, failure.detail);
      } else {
        toast.error(failure.title, failure.detail);
      }
      // Real-time alert: fire ntfy only on UNEXPECTED failures. Expected
      // codes (conflict, rate limit, content too large) are designed states
      // and would otherwise pager-storm on normal usage. Sampling at the
      // ntfy helper guarantees at most 1 alert per code per 60s per tab.
      const code = parsed.code ?? "UNKNOWN_ERROR";
      if (code === "RATE_LIMITED") {
        setRateLimited(true);
        window.setTimeout(
          () => setRateLimited(false),
          typeof parsed.retryAfterMs === "number" && parsed.retryAfterMs > 0
            ? parsed.retryAfterMs
            : 3_000,
        );
      }
      if (!EXPECTED_ALERT_CODES.has(code)) {
        publishNotebookAlert({
          severity:
            code === "SERVER_ERROR" || code === "UNKNOWN_ERROR" ? "P0" : "P1",
          code,
          title: failure.title,
          detail: failure.detail,
          requestId: parsed.requestId,
          context: { action, entitySlug },
        });
      }
    },
    [EXPECTED_ALERT_CODES, entitySlug, toast],
  );

  const notifyReadOnly = useCallback(
    (action: string) => {
      const title = "Block is read-only";
      const detail = `You cannot ${action} this block until its access mode is set to edit.`;
      setRuntimeError({ title, detail });
      toast.warning(title, detail);
    },
    [toast],
  );

  const openFirstBlock =
    useCallback(async (): Promise<Id<"productBlocks"> | null> => {
      if (createFirstBlockInFlightRef.current) {
        return createFirstBlockInFlightRef.current;
      }
      setCreatingFirstBlock(true);
      const run = appendBlock({
        anonymousSessionId,
        shareToken,
        entitySlug,
        kind: "text",
        content: [{ type: "text", value: "" }],
        authorKind: "user",
      })
        .then((blockId: any) => {
          setRuntimeError(null);
          setFocusedBlockId(blockId);
          return blockId;
        })
        .catch((error: unknown) => {
          reportNotebookError("Failed to open the live notebook editor", error);
          return null;
        })
        .finally(() => {
          setCreatingFirstBlock(false);
          createFirstBlockInFlightRef.current = null;
        });
      createFirstBlockInFlightRef.current = run;
      return run;
    }, [
      anonymousSessionId,
      appendBlock,
      entitySlug,
      reportNotebookError,
      shareToken,
    ]);

  useEffect(() => {
    autoCreateFirstBlockAttemptedRef.current = false;
    autoSeedNotebookAttemptedRef.current = false;
    createFirstBlockInFlightRef.current = null;
    authorityProposalPromisesRef.current.clear();
    authorityProposalResultsRef.current.clear();
    authorityCommitPromisesRef.current.clear();
    authorityReceiptByPlanRef.current.clear();
    authorityPlanByDecorationRef.current.clear();
    authorityCompletedPlanKeysRef.current.clear();
    authorityAcceptInFlightRef.current.clear();
    setAuthorityWriteStatus(null);
    setCreatingFirstBlock(false);
    setPreparingSeedContent(false);
  }, [entitySlug, shareToken]);

  const hasDerivedNotebookSeed = Boolean(
    (snapshot?.blocks?.length ?? 0) > 0 ||
    (snapshot?.reportCount ?? 0) > 0 ||
    snapshot?.reportUpdatedAt,
  );

  const hasOnlyEmptyPlaceholderBlocks = useMemo(() => {
    if (!blocks || blocks.length === 0) return false;
    return blocks.every((block) =>
      isTriviallyEmptyNotebookBlock(
        block,
        optimisticBlockContent[String(block._id)] ?? block.content,
      ),
    );
  }, [blocks, optimisticBlockContent]);

  useEffect(() => {
    if (!canEdit || !blocks || snapshot === undefined) return;
    if (!hasDerivedNotebookSeed) return;
    if (autoSeedNotebookAttemptedRef.current) return;
    if (
      isAuthorityOwner &&
      (authorityState === undefined ||
        authorityOperationStates === undefined ||
        latestScratchpadRun === undefined)
    ) {
      return;
    }
    if (authorityCandidateAvailableRef.current) return;

    const needsSeed = blocks.length === 0 || hasOnlyEmptyPlaceholderBlocks;
    if (!needsSeed) return;

    autoSeedNotebookAttemptedRef.current = true;
    setPreparingSeedContent(true);
    void backfillEntityBlocks({ anonymousSessionId, shareToken, entitySlug })
      .then(() => {
        setRuntimeError(null);
      })
      .catch((error: unknown) => {
        autoSeedNotebookAttemptedRef.current = false;
        reportNotebookError(
          "Failed to prepare the notebook from the saved brief",
          error,
        );
      })
      .finally(() => {
        setPreparingSeedContent(false);
      });
  }, [
    anonymousSessionId,
    backfillEntityBlocks,
    blocks,
    canEdit,
    entitySlug,
    authorityState,
    authorityOperationStates,
    hasDerivedNotebookSeed,
    hasOnlyEmptyPlaceholderBlocks,
    isAuthorityOwner,
    latestScratchpadRun,
    reportNotebookError,
    shareToken,
    snapshot,
  ]);

  useEffect(() => {
    if (!canEdit || !blocks || snapshot === undefined) return;
    if (blocks.length > 0) return;
    if (hasDerivedNotebookSeed) return;
    if (autoCreateFirstBlockAttemptedRef.current) return;
    autoCreateFirstBlockAttemptedRef.current = true;
    void openFirstBlock();
  }, [blocks, canEdit, hasDerivedNotebookSeed, openFirstBlock, snapshot]);

  useEffect(() => {
    if (!blocks || Object.keys(optimisticBlockContent).length === 0) return;
    setOptimisticBlockContent((current) => {
      let changed = false;
      const next = { ...current };
      for (const block of blocks) {
        const key = String(block._id);
        const optimistic = next[key];
        if (optimistic && chipsEqual(optimistic, block.content)) {
          delete next[key];
          changed = true;
        }
      }
      if (changed) {
        setLastSyncedAt(Date.now());
      }
      return changed ? next : current;
    });
  }, [blocks, optimisticBlockContent]);

  const registerEditorHandle = useCallback(
    (
      blockId: Id<"productBlocks">,
      handle: NotebookBlockEditorHandle | null,
    ) => {
      const key = String(blockId);
      if (handle) {
        editorHandlesRef.current.set(key, handle);
      } else {
        editorHandlesRef.current.delete(key);
      }
    },
    [],
  );

  const focusBlockHandleWithRetry = useCallback(
    (blockId: Id<"productBlocks">) => {
      if (typeof window === "undefined") return;
      let cancelled = false;
      let attempts = 0;

      const tryFocus = () => {
        if (cancelled) return;
        const handle = editorHandlesRef.current.get(String(blockId));
        if (handle) {
          handle.focus();
          return;
        }
        if (attempts >= 12) return;
        attempts += 1;
        window.requestAnimationFrame(tryFocus);
      };

      window.requestAnimationFrame(tryFocus);
      return () => {
        cancelled = true;
      };
    },
    [],
  );

  useEffect(() => {
    if (!focusedBlockId) return;
    return focusBlockHandleWithRetry(focusedBlockId);
  }, [focusBlockHandleWithRetry, focusedBlockId]);

  const refreshOfflineQueueLength = useCallback(() => {
    setOfflineQueueLength(readQueue(entitySlug).length);
  }, [entitySlug]);

  const flushOptimisticBlockContent = useCallback(
    (blockId: Id<"productBlocks">) => {
      const key = String(blockId);
      const pending = pendingOptimisticBlockContentRef.current[key];
      if (!pending) return;
      setOptimisticBlockContent((current) => {
        if (chipsEqual(current[key], pending)) return current;
        return { ...current, [key]: pending };
      });
    },
    [],
  );

  const handleLocalContentChange = useCallback(
    (blockId: Id<"productBlocks">, content: BlockChip[]) => {
      pendingOptimisticBlockContentRef.current[String(blockId)] = content;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueueOfflineEdit({
          id: makeEditId(),
          blockId: String(blockId),
          entitySlug,
          kind: "content",
          payload: content,
          queuedAt: Date.now(),
        });
        refreshOfflineQueueLength();
      }
      setRuntimeError(null);
    },
    [entitySlug, refreshOfflineQueueLength],
  );

  useEffect(() => {
    refreshOfflineQueueLength();
    const handleOnline = () => {
      setIsOffline(false);
      refreshOfflineQueueLength();
    };
    const handleOffline = () => {
      setIsOffline(true);
      refreshOfflineQueueLength();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshOfflineQueueLength]);

  useEffect(() => {
    if (!blocks || blocks.length === 0) return;
    if (lastSyncedAt == null) {
      setLastSyncedAt(Date.now());
    }
  }, [blocks, lastSyncedAt]);

  useEffect(() => {
    if (!api?.domains.product.notebookPresence?.notebookHeartbeat) return;
    const sessionId = presenceClientSessionIdRef.current;
    let disposed = false;
    let intervalId: number | null = null;

    const beat = async () => {
      try {
        const result = await notebookHeartbeat({
          anonymousSessionId,
          shareToken,
          entitySlug,
          sessionId,
          interval: 30_000,
        });
        if (disposed) return;
        setPresenceRoomToken(result.roomToken || null);
        setPresenceSessionToken(result.sessionToken || null);
      } catch {
        if (!disposed) {
          setPresenceRoomToken(null);
          setPresenceSessionToken(null);
        }
      }
    };

    void beat();
    intervalId = window.setInterval(() => {
      void beat();
    }, 25_000);

    return () => {
      disposed = true;
      if (intervalId != null) window.clearInterval(intervalId);
      const token = presenceSessionToken;
      if (token) {
        void notebookPresenceDisconnect({ sessionToken: token }).catch(
          () => undefined,
        );
      }
    };
  }, [
    anonymousSessionId,
    api,
    entitySlug,
    notebookHeartbeat,
    notebookPresenceDisconnect,
    presenceSessionToken,
    shareToken,
  ]);

  useEffect(() => {
    if (
      isOffline ||
      !api?.domains.product.blockProsemirror?.submitOfflineSnapshot
    )
      return;
    const queued = readQueue(entitySlug);
    if (queued.length === 0) return;

    let cancelled = false;
    const replay = async () => {
      for (const entry of queued) {
        if (cancelled) break;
        if (!Array.isArray(entry.payload)) continue;
        try {
          await submitOfflineSnapshot({
            anonymousSessionId,
            shareToken,
            id: buildProductBlockSyncId({
              anonymousSessionId,
              shareToken,
              blockId: entry.blockId,
            }),
            chips: entry.payload as BlockChip[],
          });
          removeOfflineEdit(entitySlug, entry.id);
          setLastSyncedAt(Date.now());
        } catch {
          break;
        }
      }
      if (!cancelled) {
        refreshOfflineQueueLength();
      }
    };

    void replay();
    return () => {
      cancelled = true;
    };
  }, [
    anonymousSessionId,
    api,
    entitySlug,
    isOffline,
    refreshOfflineQueueLength,
    shareToken,
    submitOfflineSnapshot,
  ]);

  const handleEnter = useCallback(
    async (block: LiveBlock, blockIndex: number) => {
      if (!blocks) return;
      if (!canEdit || block.accessMode === "read") {
        notifyReadOnly("insert after");
        return;
      }
      const next = blocks[blockIndex + 1];
      const insertedBlockId = await insertBlockBetween({
        anonymousSessionId,
        shareToken,
        entitySlug,
        beforeBlockId: block._id,
        afterBlockId: next?._id,
        parentBlockId: block.parentBlockId,
        kind: "text",
        content: [{ type: "text", value: "" }],
        authorKind: "user",
      });
      setFocusedBlockId(insertedBlockId);
    },
    [
      blocks,
      canEdit,
      insertBlockBetween,
      anonymousSessionId,
      entitySlug,
      notifyReadOnly,
      shareToken,
    ],
  );

  const streaming = useStreamingSearch();

  const handleMentionPick = useCallback(
    async (match: EntityMatch) => {
      if (!mentionFor) return;
      const targetBlockId = mentionFor.blockId;
      setMentionFor(null);
      // Find the current block to append a mention chip inline.
      const block = blocks?.find((b) => b._id === targetBlockId);
      if (!block) return;
      if (!canEdit || block.accessMode !== "edit") {
        notifyReadOnly("add mentions to");
        return;
      }
      try {
        const handle = editorHandlesRef.current.get(String(targetBlockId));
        if (handle) {
          handle.insertMention(match);
          handle.focus();
        } else if (!isSyncEditableBlock(block)) {
          await updateBlock({
            anonymousSessionId,
            shareToken,
            blockId: targetBlockId,
            content: [
              ...block.content,
              ...(block.content.length > 0
                ? ([{ type: "text", value: " " }] as BlockChip[])
                : []),
              {
                type: "mention",
                value: match.name,
                mentionTrigger: "@",
                mentionTarget: match.slug,
              },
            ],
            expectedRevision: block.revision,
          });
        } else {
          throw new Error(
            "Focused notebook editor was not available for this mention.",
          );
        }
        // Record the relation so backlinks work.
        await createBlockRelation({
          anonymousSessionId,
          shareToken,
          fromBlockId: targetBlockId,
          toEntityId: undefined,
          toBlockId: undefined,
          toUrl: undefined,
          relationKind: "mention",
          relationLabel: match.slug,
          authorKind: "user",
        });
      } catch (err) {
        reportNotebookMutationFailure("mention", err);
      }
    },
    [
      anonymousSessionId,
      canEdit,
      blocks,
      createBlockRelation,
      editorHandlesRef,
      mentionFor,
      notifyReadOnly,
      reportNotebookMutationFailure,
      shareToken,
      updateBlock,
    ],
  );

  const runSlashCommand = useCallback(
    async (command: SlashCommand, block: LiveBlock) => {
      setSlashFor(null);
      const prompt = command.prompt ?? "";
      if (!prompt.trim() && command.id !== "mention") return;
      if (!canEdit || block.accessMode === "read") {
        notifyReadOnly("run notebook commands from");
        return;
      }

      if (
        command.id === "ai" ||
        command.id === "search" ||
        command.id === "deepresearch"
      ) {
        // Insert a lightweight progress callout so the user sees work start immediately.
        const progressBlockId = await appendBlock({
          anonymousSessionId,
          shareToken,
          entitySlug,
          parentBlockId: block.parentBlockId,
          kind: "callout",
          content: [
            { type: "text", value: `${command.label}: ${prompt}` },
            { type: "text", value: " - working..." },
          ],
          authorKind: "agent",
          authorId: `slash:${command.id}`,
        });

        // Kick off the existing streaming search. On complete, we persist each
        // section as a block so the user can edit them inline.
        const lens = command.id === "deepresearch" ? "founder" : "general";
        streaming.startStream(prompt, lens, {
          onComplete: async (payload) => {
            const packet = (payload.packet ?? payload) as {
              answerBlocks?: Array<{
                text?: string;
                title?: string;
                sourceRefIds?: string[];
              }>;
              answer?: string;
            };
            // Mark the progress block as complete and capture the headline answer.
            try {
              if (packet.answerBlocks && packet.answerBlocks.length > 0) {
                for (let i = 0; i < packet.answerBlocks.length; i++) {
                  const ab = packet.answerBlocks[i];
                  const text = ab.text ?? "";
                  if (!text.trim()) continue;
                  await appendBlock({
                    anonymousSessionId,
                    shareToken,
                    entitySlug,
                    parentBlockId: block.parentBlockId,
                    kind: ab.title ? "heading_3" : "text",
                    content: [{ type: "text", value: ab.title ?? text }],
                    authorKind: "agent",
                    authorId: `slash:${command.id}`,
                    sourceRefIds: ab.sourceRefIds,
                  });
                  if (ab.title && ab.text) {
                    await appendBlock({
                      anonymousSessionId,
                      shareToken,
                      entitySlug,
                      parentBlockId: block.parentBlockId,
                      kind: "text",
                      content: [{ type: "text", value: ab.text }],
                      authorKind: "agent",
                      authorId: `slash:${command.id}`,
                      sourceRefIds: ab.sourceRefIds,
                    });
                  }
                }
              } else if (packet.answer) {
                await appendBlock({
                  anonymousSessionId,
                  shareToken,
                  entitySlug,
                  parentBlockId: block.parentBlockId,
                  kind: "text",
                  content: [{ type: "text", value: packet.answer }],
                  authorKind: "agent",
                  authorId: `slash:${command.id}`,
                });
              }
              // Mark the progress block as complete.
              await updateBlock({
                anonymousSessionId,
                shareToken,
                blockId: progressBlockId,
                content: [
                  { type: "text", value: `[done] ${command.label}: ${prompt}` },
                ],
                expectedRevision: 1,
              });
            } catch (err) {
              reportNotebookMutationFailure("command", err);
            }
          },
          onError: (message) => {
            updateBlock({
              anonymousSessionId,
              shareToken,
              blockId: progressBlockId,
              content: [
                {
                  type: "text",
                  value: `[error] ${command.label}: ${prompt} - ${message}`,
                },
              ],
              expectedRevision: 1,
            }).catch((err: any) =>
              reportNotebookMutationFailure("command", err),
            );
            setRuntimeError({
              title: `Notebook command failed`,
              detail: message,
            });
            toast.error("Notebook command failed", message);
          },
        });
      } else if (command.id === "mention") {
        // Open the entity picker seeded with whatever the user typed.
        setMentionFor({ blockId: block._id, initial: prompt });
      }
    },
    [
      anonymousSessionId,
      appendBlock,
      canEdit,
      entitySlug,
      notifyReadOnly,
      reportNotebookMutationFailure,
      shareToken,
      streaming,
      toast,
      updateBlock,
    ],
  );

  const sourcesById = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        label: string;
        href?: string;
        confidence?: number;
        domain?: string;
      }
    >();
    if (snapshot?.sources) {
      for (const src of snapshot.sources) {
        map.set(src.id, src);
      }
    }
    return map;
  }, [snapshot?.sources]);

  const citationLabelsById = useMemo(() => {
    const map = new Map<string, string>();
    if (snapshot?.sources) {
      snapshot.sources.forEach((src: any, index: number) => {
        map.set(src.id, `s${index + 1}`);
      });
    }
    return map;
  }, [snapshot?.sources]);

  const diligenceBlocks = useDiligenceBlocks(entitySlug, snapshot, {
    anonymousSessionId: anonymousSessionId ?? undefined,
    shareToken,
  });
  // Persisted dismissals live as lifted state. The actual Convex subscription
  // runs inside <NotebookDismissalsSync /> which is wrapped in a local
  // ErrorBoundary at the render site — so a server-side failure on the
  // dismissals query (schema drift, deploy lag) degrades to "empty set"
  // instead of crashing the whole notebook. See decorationPreferences.ts
  // and NotebookDismissalsSync.tsx.
  const [dismissedKeySet, setDismissedKeySet] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const visibleDiligenceDecorations = useMemo(
    () =>
      diligenceBlocks.projections.filter((projection) => {
        if (hiddenDecorationRunIds[projection.scratchpadRunId]) return false;
        // Honor persisted dismissals (Milestone 4c — dismissal now
        // survives refresh). Keyed by (scratchpadRunId, blockType)
        // so dismissing one block's decoration from a run does not
        // silence the other block types produced by the same run.
        if (
          dismissedKeySet.has(
            `${projection.scratchpadRunId}::${projection.blockType}`,
          )
        ) {
          return false;
        }
        // Suppress starter/placeholder cards that have no real content.
        // Notion/Linear rule: if the agent returned nothing, render nothing —
        // not a card saying "the agent returned nothing".
        const prose = (projection.bodyProse ?? "").trim();
        if (prose.length === 0) return false;
        const placeholderFragments = [
          "no clear summary was returned",
          "no explicit gap was returned",
          "no next action was returned",
          "the agent did not return",
          "no live diligence content is available",
          "use this notebook to accumulate",
        ];
        const lower = prose.toLowerCase();
        if (placeholderFragments.some((frag) => lower.includes(frag)))
          return false;
        return true;
      }),
    [diligenceBlocks.projections, hiddenDecorationRunIds, dismissedKeySet],
  );

  const notebookLoadState = getNotebookLoadState({
    loadedCount: blocks?.length ?? 0,
    totalCount: blockSummary?.blockCount,
    paginationStatus: blocksPagination.status,
  });
  const latestRunCheckpoint = latestScratchpadRun?.checkpoints?.at(-1);
  const isNotebookRunActive =
    latestScratchpadRun?.status === "streaming" ||
    latestScratchpadRun?.status === "structuring";
  const focusedBlock = blocks?.find((block) => block._id === focusedBlockId);
  // Nesting depth per block. Walks parentBlockId chain once, caches in a
  // Map for O(1) lookup during the render map. Guards against parent cycles
  // by stopping after 16 hops.
  const blockDepthMap = useMemo(() => {
    const byId = new Map<string, LiveBlock>();
    for (const b of blocks ?? []) byId.set(String(b._id), b);
    const depthByBlock = new Map<string, number>();
    for (const b of blocks ?? []) {
      let depth = 0;
      let cursor: LiveBlock | undefined = b;
      const seen = new Set<string>();
      while (cursor?.parentBlockId && depth < 16) {
        const parentKey = String(cursor.parentBlockId);
        if (seen.has(parentKey)) break;
        seen.add(parentKey);
        const parent = byId.get(parentKey);
        if (!parent) break;
        // Only indent when parent is an editable sibling block, not a
        // seeded section marker (heading_1 / heading_2). This matches the
        // Roam/Notion behavior where Tab indents lists and paragraphs but
        // doesn't push headings under headings.
        if (parent.kind === "heading_1" || parent.kind === "heading_2") {
          break;
        }
        depth += 1;
        cursor = parent;
      }
      depthByBlock.set(String(b._id), depth);
    }
    return depthByBlock;
  }, [blocks]);
  const openWorkspaceDrawer = useCallback(
    (initialTab: "chat" | "scratchpad" | "flow") => {
      openWithContext({
        initialTab,
        contextEntitySlug: entitySlug,
        contextTitle: snapshot?.entityName ?? entitySlug,
      });
    },
    [entitySlug, openWithContext, snapshot?.entityName],
  );
  const canUseOverlayActions = canEdit && notebookLoadState.fullyLoaded;

  useEffect(() => {
    const reportUpdatedAt = snapshot?.reportUpdatedAt;
    const reportBlockCount = snapshot?.blocks?.length ?? 0;
    if (!canEdit) return;
    if (!entitySlug) return;
    if (!reportUpdatedAt || reportBlockCount === 0) return;

    const versionKey = `${entitySlug}:${reportUpdatedAt}:${reportBlockCount}`;
    if (materializedProjectionVersionKeyRef.current === versionKey) return;
    materializedProjectionVersionKeyRef.current = versionKey;

    void materializeProjectionOverlays({
      anonymousSessionId,
      shareToken,
      entitySlug,
    } as never).catch((error: unknown) => {
      materializedProjectionVersionKeyRef.current = null;
      console.warn(
        "[notebook] failed to materialize diligence overlays",
        error,
      );
    });
  }, [
    anonymousSessionId,
    canEdit,
    entitySlug,
    materializeProjectionOverlays,
    shareToken,
    snapshot?.blocks?.length,
    snapshot?.reportUpdatedAt,
  ]);

  /**
   * Shared helper — turn a decoration into the context shape the
   * drawer and action log expect. Keeps the three call sites below
   * (ask / accept / dismiss / refresh) reading identically.
   */
  const buildDecorationContext = useCallback(
    (decoration: DiligenceDecorationData): DecorationContext => ({
      entitySlug,
      scratchpadRunId: decoration.scratchpadRunId,
      blockType: decoration.blockType,
      overallTier: decoration.overallTier,
      headerText: decoration.headerText,
      bodyProse: decoration.bodyProse,
      sourceCount: decoration.sourceCount,
      sourceRefIds: decoration.sourceRefIds,
    }),
    [entitySlug],
  );

  const activeMatchingAuthorityGrant = useMemo(() => {
    const grant = authorityState?.grant;
    if (
      !grant ||
      grant.effectiveStatus !== "active" ||
      !latestScratchpadRun?.scratchpadId
    ) {
      return null;
    }
    if (grant.mode === "workspace") return grant;
    if (grant.entityId && grant.entityId !== authorityEntityId) return null;
    if (grant.runId && grant.runId !== latestScratchpadRun.scratchpadId)
      return null;
    return grant;
  }, [
    authorityEntityId,
    authorityState?.grant,
    latestScratchpadRun?.scratchpadId,
  ]);

  const authorityDecorationPlans = useMemo<
    NotebookAuthorityDecorationPlan[]
  >(() => {
    if (
      !api ||
      !isAuthorityOwner ||
      authorityState === undefined ||
      authorityOperationStates === undefined ||
      !canUseOverlayActions ||
      !blocks ||
      !latestScratchpadRun?.scratchpadId ||
      !authorityEntityId
    ) {
      return [];
    }

    const plans: NotebookAuthorityDecorationPlan[] = [];
    const usedBlockIds = new Set<string>();
    const operationByDecoration = new Map<
      string,
      NotebookAuthorityServerOperationState
    >();
    for (const operation of authorityOperationStates) {
      const operationDecorationKey = `${operation.evidenceScratchpadRunId}::${operation.evidenceBlockType}::${operation.evidenceVersion}`;
      // The server returns effective operations newest-first. Preserve the
      // first match so an older retry can never shadow the recovery state.
      if (!operationByDecoration.has(operationDecorationKey)) {
        operationByDecoration.set(operationDecorationKey, operation);
      }
    }

    for (const decoration of visibleDiligenceDecorations) {
      const accepted = acceptDecorationIntoNotebook({
        decoration,
        frozenAt: decoration.updatedAt,
      });
      if (!accepted.succeeded || !accepted.drafts?.length) continue;

      const decorationKey = `${decoration.scratchpadRunId}::${decoration.blockType}::${decoration.version}`;
      const persistedOperation = operationByDecoration.get(decorationKey);
      const operationKey =
        persistedOperation?.operationKey ??
        buildNotebookAuthorityOperationKey({
          entityId: authorityEntityId,
          scratchpadId: latestScratchpadRun.scratchpadId,
          scratchpadRunId: decoration.scratchpadRunId,
          blockType: decoration.blockType,
          decorationVersion: decoration.version,
        });
      if (persistedOperation) {
        if (
          persistedOperation.remainderCompleted ||
          persistedOperation.status === "rejected"
        ) {
          continue;
        }
        const persistedBlock = blocks.find(
          (block) => block._id === persistedOperation.blockId,
        );
        const liveGrantId = activeMatchingAuthorityGrant?.grantId;
        if (persistedOperation.status === "blocked") {
          if (!persistedBlock) continue;
          const refreshed = evaluateNotebookAuthorityCandidate({
            block: persistedBlock,
            displayContent:
              optimisticBlockContent[String(persistedBlock._id)] ??
              persistedBlock.content,
            drafts: accepted.drafts,
            decorationSourceRefIds: decoration.sourceRefIds,
            decorationScratchpadRunId: decoration.scratchpadRunId,
            decorationScratchpadBaseRunId: readScratchpadBaseRunId(
              decoration.payload,
            ),
            scratchpadThreadRunId: latestScratchpadRun.runId,
            scratchpadId: latestScratchpadRun.scratchpadId,
            entityId: persistedBlock.entityId,
            blockType: decoration.blockType,
            overallTier: decoration.overallTier,
            decorationVersion: decoration.version,
            decorationUpdatedAt: decoration.updatedAt,
            authorityScopeKey: liveGrantId ?? "blocked-retry",
          });
          if (
            refreshed.eligible &&
            hasNotebookAuthorityCandidateChanged(
              persistedOperation,
              refreshed.candidate,
            )
          ) {
            usedBlockIds.add(String(refreshed.candidate.blockId));
            plans.push({
              key: decorationKey,
              decoration,
              candidate: refreshed.candidate,
              grantId: liveGrantId,
              shouldSubmitProposal: true,
              operationState: persistedOperation,
            });
          }
          continue;
        }
        const shouldSubmitProposal = shouldSubmitNewNotebookAuthorityAttempt({
          status: persistedOperation.status,
          persistedGrantId: persistedOperation.grantId,
          activeGrantId: liveGrantId,
        });
        const recovered = recoverNotebookAuthorityCandidate({
          operation: persistedOperation,
          expectedOperationKey: operationKey,
          block: persistedBlock,
          drafts: accepted.drafts,
          authorityScopeKey: shouldSubmitProposal ? liveGrantId! : "persisted",
        });
        if (recovered) {
          usedBlockIds.add(String(recovered.blockId));
          plans.push({
            key: decorationKey,
            decoration,
            candidate: recovered,
            grantId: liveGrantId,
            shouldSubmitProposal,
            operationState: persistedOperation,
          });
        }
        continue;
      }

      for (const block of blocks) {
        if (usedBlockIds.has(String(block._id))) continue;
        const evaluation = evaluateNotebookAuthorityCandidate({
          block,
          displayContent:
            optimisticBlockContent[String(block._id)] ?? block.content,
          drafts: accepted.drafts,
          decorationSourceRefIds: decoration.sourceRefIds,
          decorationScratchpadRunId: decoration.scratchpadRunId,
          decorationScratchpadBaseRunId: readScratchpadBaseRunId(
            decoration.payload,
          ),
          scratchpadThreadRunId: latestScratchpadRun.runId,
          scratchpadId: latestScratchpadRun.scratchpadId,
          entityId: block.entityId,
          blockType: decoration.blockType,
          overallTier: decoration.overallTier,
          decorationVersion: decoration.version,
          decorationUpdatedAt: decoration.updatedAt,
          authorityScopeKey: activeMatchingAuthorityGrant?.grantId ?? "review",
        });
        if (!evaluation.eligible) continue;

        usedBlockIds.add(String(block._id));
        plans.push({
          key: decorationKey,
          decoration,
          candidate: evaluation.candidate,
          grantId: activeMatchingAuthorityGrant?.grantId,
          shouldSubmitProposal: true,
        });
        break;
      }
    }
    return plans;
  }, [
    activeMatchingAuthorityGrant?.grantId,
    api,
    authorityEntityId,
    authorityOperationStates,
    authorityState,
    blocks,
    canUseOverlayActions,
    isAuthorityOwner,
    latestScratchpadRun?.runId,
    latestScratchpadRun?.scratchpadId,
    optimisticBlockContent,
    visibleDiligenceDecorations,
  ]);
  authorityCandidateAvailableRef.current = authorityDecorationPlans.length > 0;

  useEffect(() => {
    for (const plan of authorityDecorationPlans) {
      authorityPlanByDecorationRef.current.set(plan.key, plan);
    }
  }, [authorityDecorationPlans]);

  const ensureAuthorityProposal = useCallback(
    (
      plan: NotebookAuthorityDecorationPlan,
    ): Promise<NotebookAuthorityProposalResult> => {
      const proposalKey = plan.candidate.idempotencyKey;
      if (plan.operationState && !plan.shouldSubmitProposal) {
        const persisted: NotebookAuthorityProposalResult = {
          proposalId: plan.operationState.proposalId,
          status: plan.operationState.status,
          approvalMode: plan.operationState.approvalMode,
          receiptId: plan.operationState.receiptId,
          needsApproval:
            plan.operationState.status === "pending" &&
            plan.operationState.approvalMode === "explicit",
          needsGuardedCommit:
            plan.operationState.status === "pending" &&
            plan.operationState.approvalMode === "delegated",
          delegationDenied: plan.operationState.delegationDenied,
          delegationFailureCode:
            plan.operationState.delegationFailureCode ?? undefined,
          validationFailed: plan.operationState.validationFailed,
          validationFailureCode:
            plan.operationState.validationFailureCode ?? undefined,
          needsNewProposal: plan.operationState.validationFailed,
        };
        authorityProposalResultsRef.current.set(proposalKey, persisted);
        return Promise.resolve(persisted);
      }
      const cached = authorityProposalResultsRef.current.get(proposalKey);
      if (cached) return Promise.resolve(cached);
      const pending = authorityProposalPromisesRef.current.get(proposalKey);
      if (pending) return pending;

      const request = Promise.resolve(
        submitBlockProposal({
          operationKey: plan.candidate.operationKey,
          idempotencyKey: proposalKey,
          decorationBlockType: plan.decoration.blockType,
          decorationScratchpadRunId: plan.decoration.scratchpadRunId,
          decorationVersion: plan.decoration.version,
          blockId: plan.candidate.blockId,
          proposedContent: plan.candidate.proposedContent,
          proposedSourceRefIds: plan.candidate.proposedSourceRefIds,
          baseRevision: plan.candidate.baseRevision,
          runId: plan.candidate.runId,
          grantId: plan.grantId,
        } as never) as unknown,
      )
        .then((result) => {
          const proposal = result as NotebookAuthorityProposalResult;
          authorityProposalResultsRef.current.set(proposalKey, proposal);
          return proposal;
        })
        .catch((error) => {
          authorityProposalPromisesRef.current.delete(proposalKey);
          throw error;
        });
      authorityProposalPromisesRef.current.set(proposalKey, request);
      return request;
    },
    [submitBlockProposal],
  );

  const commitAuthorityProposalOnce = useCallback(
    (
      proposalId: string,
      approvalMode: "explicit" | "delegated",
    ): Promise<NotebookAuthorityCommitResult> => {
      const commitKey = `${proposalId}:${approvalMode}`;
      return runInFlightOnly(
        authorityCommitPromisesRef.current,
        commitKey,
        () =>
          Promise.resolve(
            commitBlockProposal({
              proposalId,
              approvalMode,
            } as never) as unknown,
          ).then((result) => result as NotebookAuthorityCommitResult),
      );
    },
    [commitBlockProposal],
  );

  const completeAuthorityDecoration = useCallback(
    (
      plan: NotebookAuthorityDecorationPlan,
      receiptId: string,
      focusBlockId: Id<"productBlocks"> = plan.candidate.blockId,
    ) => {
      const completionKey = plan.candidate.idempotencyKey;
      if (authorityCompletedPlanKeysRef.current.has(completionKey)) return;
      authorityCompletedPlanKeysRef.current.add(completionKey);
      setDismissedKeySet((current) => {
        const next = new Set(current);
        next.add(
          `${plan.decoration.scratchpadRunId}::${plan.decoration.blockType}`,
        );
        return next;
      });
      setRuntimeError(null);
      setLastSyncedAt(Date.now());
      setFocusedBlockId(focusBlockId);
      setAuthorityWriteStatus({
        key: plan.key,
        tone: "partial",
        title: "Validated notebook change applied.",
        detail: `Receipt ${receiptId}. Current undo availability is shown in Authority history.`,
        proposalId: authorityProposalResultsRef.current.get(
          plan.candidate.idempotencyKey,
        )?.proposalId,
        receiptId,
      });
      toast.success("Live snapshot added to notebook");
      agentActions.logAcceptDecoration(
        buildDecorationContext(plan.decoration),
        anonymousSessionId ?? undefined,
      );
    },
    [agentActions, anonymousSessionId, buildDecorationContext, toast],
  );

  const recordAuthorityReceipt = useCallback(
    (plan: NotebookAuthorityDecorationPlan, receiptId: string) => {
      authorityReceiptByPlanRef.current.set(
        plan.candidate.idempotencyKey,
        receiptId,
      );
      if (
        authorityCompletedPlanKeysRef.current.has(plan.candidate.idempotencyKey)
      ) {
        return;
      }
      if (plan.candidate.remainingDrafts.length === 0) {
        completeAuthorityDecoration(plan, receiptId);
        return;
      }
      if (
        plan.operationState?.receiptId === receiptId &&
        !plan.operationState.canUndoNow &&
        !plan.operationState.remainderCompleted
      ) {
        setAuthorityWriteStatus({
          key: plan.key,
          tone: "failed",
          title: "Validated replacement is no longer current.",
          detail: `Receipt ${receiptId} remains in history, but the target changed (${plan.operationState.undoUnavailableReason ?? "receipt_state_changed"}). No remaining blocks were inserted.`,
          proposalId: plan.operationState.proposalId,
          receiptId,
        });
        return;
      }
      setAuthorityWriteStatus({
        key: plan.key,
        tone: "partial",
        title: "1 safe block applied; remaining structure requires review.",
        detail: `Receipt ${receiptId}. Accept to add the remaining marker, headings, attributes, or blocks explicitly. Current undo availability is shown in Authority history.`,
        proposalId: authorityProposalResultsRef.current.get(
          plan.candidate.idempotencyKey,
        )?.proposalId,
        receiptId,
      });
    },
    [completeAuthorityDecoration],
  );

  const handleAuthorityCommitResult = useCallback(
    (
      plan: NotebookAuthorityDecorationPlan,
      result: NotebookAuthorityCommitResult,
    ): string | null => {
      if (result.receiptId) {
        recordAuthorityReceipt(plan, result.receiptId);
        return result.receiptId;
      }
      if (result.delegationDenied) {
        setAuthorityWriteStatus({
          key: plan.key,
          tone: "blocked",
          title: "Delegated notebook change blocked.",
          detail: `No notebook write occurred. The proposal remains reviewable (${result.reasonCode ?? "delegation_denied"}).`,
          proposalId: result.proposalId,
        });
        return null;
      }
      if (result.validationFailed) {
        setAuthorityWriteStatus({
          key: plan.key,
          tone: "failed",
          title: "Notebook proposal validation failed.",
          detail: `No notebook write occurred. Refresh before reviewing a new proposal (${result.reasonCode ?? "validation_failed"}).`,
          proposalId: result.proposalId,
        });
        return null;
      }
      setAuthorityWriteStatus({
        key: plan.key,
        tone: "failed",
        title: "Notebook commit returned no receipt.",
        detail:
          "The decoration remains visible and no acceptance was recorded.",
        proposalId: result.proposalId,
      });
      return null;
    },
    [recordAuthorityReceipt],
  );

  useEffect(() => {
    if (authorityDecorationPlans.length === 0) return;
    let cancelled = false;

    for (const plan of authorityDecorationPlans) {
      void ensureAuthorityProposal(plan)
        .then(async (proposal) => {
          if (cancelled) return;
          if (proposal.receiptId) {
            recordAuthorityReceipt(plan, proposal.receiptId);
            return;
          }
          if (proposal.validationFailed || proposal.status === "blocked") {
            setAuthorityWriteStatus({
              key: plan.key,
              tone: "failed",
              title: "Notebook proposal validation failed.",
              detail: `No notebook write occurred. Refresh before reviewing a new proposal (${proposal.validationFailureCode ?? "validation_failed"}).`,
              proposalId: proposal.proposalId,
            });
            return;
          }
          if (proposal.delegationDenied) {
            setAuthorityWriteStatus({
              key: plan.key,
              tone: "blocked",
              title: "Delegated notebook change blocked.",
              detail: `No notebook write occurred. The saved proposal requires review (${proposal.delegationFailureCode ?? "delegation_denied"}).`,
              proposalId: proposal.proposalId,
            });
            return;
          }
          if (shouldAutoCommitNotebookAuthorityProposal(proposal)) {
            const committed = await commitAuthorityProposalOnce(
              proposal.proposalId,
              "delegated",
            );
            if (!cancelled) handleAuthorityCommitResult(plan, committed);
            return;
          }
          setAuthorityWriteStatus((current) =>
            current?.receiptId
              ? current
              : {
                  key: plan.key,
                  tone: "review",
                  title: "Notebook change ready for review.",
                  detail:
                    "Accept applies the saved proposal explicitly; kind, attributes, and inserted blocks remain review-only.",
                  proposalId: proposal.proposalId,
                },
          );
          return;
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setAuthorityWriteStatus({
            key: plan.key,
            tone: "failed",
            title: "Notebook proposal could not be validated.",
            detail: `${error instanceof Error ? error.message : "Unknown proposal failure."} No notebook write occurred.`,
          });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    authorityDecorationPlans,
    commitAuthorityProposalOnce,
    ensureAuthorityProposal,
    handleAuthorityCommitResult,
    recordAuthorityReceipt,
  ]);

  useEffect(() => {
    if (!authorityOperationStates) return;
    for (const decoration of visibleDiligenceDecorations) {
      const operation = authorityOperationStates.find(
        (candidate) =>
          candidate.evidenceScratchpadRunId === decoration.scratchpadRunId &&
          candidate.evidenceBlockType === decoration.blockType &&
          candidate.evidenceVersion === decoration.version,
      );
      if (!operation) continue;

      const decorationKey = `${decoration.scratchpadRunId}::${decoration.blockType}::${decoration.version}`;
      if (operation.remainderCompleted) {
        setDismissedKeySet((current) => {
          const next = new Set(current);
          next.add(`${decoration.scratchpadRunId}::${decoration.blockType}`);
          return next;
        });
        setAuthorityWriteStatus({
          key: decorationKey,
          tone: "partial",
          title: "Validated notebook change applied.",
          detail: `Receipt ${operation.receiptId}. The explicit remainder is recorded by ${operation.remainderCompletionKey}.`,
          proposalId: operation.proposalId,
          receiptId: operation.receiptId ?? undefined,
        });
      } else if (operation.validationFailed) {
        setAuthorityWriteStatus({
          key: decorationKey,
          tone: "failed",
          title: "Notebook proposal validation failed.",
          detail: `No notebook write occurred (${operation.validationFailureCode ?? "validation_failed"}).`,
          proposalId: operation.proposalId,
        });
      }
    }
  }, [authorityOperationStates, visibleDiligenceDecorations]);

  /**
   * "Ask NodeBench about this" — opens the drawer pre-loaded with this
   * decoration as context. Logs the escalation so the drawer timeline
   * reflects the inline ↔ chat continuity (Milestone 4 seam).
   */
  const handleAskAboutDecoration = useCallback(
    (
      scratchpadRunId: string,
      blockType: DiligenceDecorationData["blockType"],
    ) => {
      const decoration = visibleDiligenceDecorations.find(
        (c) =>
          c.scratchpadRunId === scratchpadRunId && c.blockType === blockType,
      );
      if (!decoration) return;
      agentActions.askAboutDecoration(
        buildDecorationContext(decoration),
        anonymousSessionId ?? undefined,
      );
    },
    [
      agentActions,
      anonymousSessionId,
      buildDecorationContext,
      visibleDiligenceDecorations,
    ],
  );

  const handleDismissDecoration = useCallback(
    (
      scratchpadRunId: string,
      blockType?: DiligenceDecorationData["blockType"],
    ) => {
      // Still update the local Set instantly for responsive UX — the
      // Convex write is fire-and-forget so the user never sees a lag
      // between click and fade-out. The persisted state syncs via
      // query reactivity in the next tick.
      setHiddenDecorationRunIds((current) =>
        current[scratchpadRunId]
          ? current
          : { ...current, [scratchpadRunId]: true },
      );
      if (!blockType) return; // legacy callers (should shrink to zero)
      const decoration = visibleDiligenceDecorations.find(
        (c) =>
          c.scratchpadRunId === scratchpadRunId && c.blockType === blockType,
      );
      if (!decoration) return;
      void agentActions.dismissDecoration(
        buildDecorationContext(decoration),
        anonymousSessionId ?? undefined,
      );
    },
    [
      agentActions,
      anonymousSessionId,
      buildDecorationContext,
      visibleDiligenceDecorations,
    ],
  );

  /**
   * Refresh handler — requests a re-run of a specific decoration's block.
   *
   * UX contract (industry-standard async acknowledgement, Linear / Figma /
   * Notion pattern):
   *   1. Click acknowledged instantly with a toast so the button doesn't
   *      feel dead while the mutation round-trips.
   *   2. requestRefreshAndRun flags the row when it exists, then re-runs the
   *      same generic projection orchestrator that writes authoritative
   *      overlay rows from saved report sections.
   *   3. useQuery reactivity picks up the newer version automatically when
   *      the rerun finishes. No imperative re-fetch is needed here.
   *   4. Snapshot-only fallback overlays also converge because the mutation
   *      materializes server rows when the old client-only row is missing.
   */
  const handleRefreshDecoration = useCallback(
    async (
      scratchpadRunId: string,
      blockType: DiligenceDecorationData["blockType"],
    ) => {
      const decoration = visibleDiligenceDecorations.find(
        (candidate) =>
          candidate.scratchpadRunId === scratchpadRunId &&
          candidate.blockType === blockType,
      );
      if (!decoration) return;

      toast.info(
        "Refreshing live intelligence…",
        `Queued a refresh for this ${blockType} block. The overlay will update when the orchestrator emits a newer version.`,
      );

      try {
        const result = (await requestProjectionRefreshAndRun({
          anonymousSessionId,
          shareToken,
          entitySlug,
          blockType,
          scratchpadRunId,
        } as never)) as
          | {
              refreshStatus: "queued" | "already-queued" | "not-found";
              queuedAt?: number;
              rerun?: {
                status: "materialized" | "noop";
                total: number;
                created: number;
                updated: number;
                stale: number;
                deleted: number;
              };
            }
          | undefined;

        if (!result) return;
        if (result.refreshStatus === "already-queued") {
          toast.info(
            "Already refreshing",
            "The orchestrator is still processing your previous refresh request.",
          );
          return;
        }
        if (result.rerun?.status === "materialized") {
          toast.success(
            "Live intelligence refreshed",
            result.rerun.updated + result.rerun.created > 0
              ? "The overlay now reflects the latest structured diligence projection."
              : "The overlay was re-run but no newer structured output was produced.",
          );
        } else if (result.refreshStatus === "not-found") {
          toast.info(
            "Overlay resynced",
            "The overlay was rebuilt from the latest saved report for this entity.",
          );
        }
      } catch (err) {
        toast.error(
          "Refresh failed",
          err instanceof Error
            ? err.message
            : "Unknown error while requesting a refresh.",
        );
      }
    },
    [
      anonymousSessionId,
      entitySlug,
      requestProjectionRefreshAndRun,
      shareToken,
      toast,
      visibleDiligenceDecorations,
    ],
  );

  const materializeAuthorityRemainder = useCallback(
    async (
      plan: NotebookAuthorityDecorationPlan,
      receiptId: string,
    ): Promise<NotebookAuthorityRemainderResult> => {
      const proposalId =
        authorityProposalResultsRef.current.get(plan.candidate.idempotencyKey)
          ?.proposalId ?? plan.operationState?.proposalId;
      if (!proposalId) {
        throw new Error("The persisted proposal could not be recovered.");
      }
      const beforeDrafts = plan.candidate.remainingDrafts.slice(
        0,
        plan.candidate.selectedDraftIndex,
      );
      const afterDrafts = plan.candidate.remainingDrafts.slice(
        plan.candidate.selectedDraftIndex,
      );
      return (await commitProposalRemainder({
        proposalId,
        receiptId,
        completionKey: buildNotebookAuthorityRemainderCompletionKey(
          plan.candidate.operationKey,
        ),
        beforeDrafts,
        afterDrafts,
      } as never)) as NotebookAuthorityRemainderResult;
    },
    [commitProposalRemainder],
  );

  const acceptAuthorityDecorationPlan = useCallback(
    async (plan: NotebookAuthorityDecorationPlan): Promise<void> => {
      const planKey = plan.candidate.idempotencyKey;
      if (authorityAcceptInFlightRef.current.has(planKey)) return;
      authorityAcceptInFlightRef.current.add(planKey);
      let receiptId = authorityReceiptByPlanRef.current.get(planKey) ?? null;

      try {
        if (!receiptId) {
          const proposal = await ensureAuthorityProposal(plan);
          if (proposal.receiptId) {
            receiptId = proposal.receiptId;
            recordAuthorityReceipt(plan, receiptId);
          } else {
            if (proposal.validationFailed || proposal.status === "blocked") {
              setAuthorityWriteStatus({
                key: plan.key,
                tone: "failed",
                title: "Notebook proposal validation failed.",
                detail: `No notebook write occurred. Refresh before reviewing a new proposal (${proposal.validationFailureCode ?? "validation_failed"}).`,
                proposalId: proposal.proposalId,
              });
              return;
            }
            const shouldTryDelegated =
              Boolean(plan.grantId) || proposal.approvalMode === "delegated";
            let committed: NotebookAuthorityCommitResult;
            if (shouldTryDelegated) {
              committed = await commitAuthorityProposalOnce(
                proposal.proposalId,
                "delegated",
              );
              if (committed.delegationDenied) {
                // The user clicked Accept, so a live-grant race may safely
                // fall back to the same proposal's authenticated explicit
                // approval after the server has downgraded it to review.
                await approveBlockProposal({
                  proposalId: proposal.proposalId,
                } as never);
                committed = await commitAuthorityProposalOnce(
                  proposal.proposalId,
                  "explicit",
                );
              }
            } else {
              await approveBlockProposal({
                proposalId: proposal.proposalId,
              } as never);
              committed = await commitAuthorityProposalOnce(
                proposal.proposalId,
                "explicit",
              );
            }
            receiptId = handleAuthorityCommitResult(plan, committed);
          }
        }

        if (!receiptId) return;
        const remainder = await materializeAuthorityRemainder(plan, receiptId);
        completeAuthorityDecoration(plan, receiptId, remainder.lastBlockId);
      } catch (error) {
        const committedReceipt = authorityReceiptByPlanRef.current.get(planKey);
        if (committedReceipt) {
          setAuthorityWriteStatus({
            key: plan.key,
            tone: "failed",
            title: "Safe block applied; remaining review did not finish.",
            detail: `Receipt ${committedReceipt} proves the replacement. The decoration remains visible because the explicit marker, attributes, or inserted blocks were not fully added.`,
            proposalId: authorityProposalResultsRef.current.get(
              plan.candidate.idempotencyKey,
            )?.proposalId,
            receiptId: committedReceipt,
          });
          console.warn("[notebook] explicit authority remainder failed", error);
          return;
        }
        setAuthorityWriteStatus({
          key: plan.key,
          tone: "failed",
          title: "Notebook proposal was not applied.",
          detail: `${error instanceof Error ? error.message : "Unknown authority failure."} No receipt was returned, so the decoration remains visible.`,
          proposalId: authorityProposalResultsRef.current.get(
            plan.candidate.idempotencyKey,
          )?.proposalId,
        });
        reportNotebookMutationFailure("save", error);
      } finally {
        authorityAcceptInFlightRef.current.delete(planKey);
      }
    },
    [
      approveBlockProposal,
      commitAuthorityProposalOnce,
      completeAuthorityDecoration,
      ensureAuthorityProposal,
      handleAuthorityCommitResult,
      materializeAuthorityRemainder,
      recordAuthorityReceipt,
      reportNotebookMutationFailure,
    ],
  );

  const handleAcceptDecoration = useCallback(
    async (
      scratchpadRunId: string,
      blockType: DiligenceDecorationData["blockType"],
    ) => {
      if (!blocks || blocks.length === 0) return;
      if (!canEdit || !notebookLoadState.fullyLoaded) {
        notifyReadOnly("accept live intelligence into");
        return;
      }

      const decoration = visibleDiligenceDecorations.find(
        (candidate) =>
          candidate.scratchpadRunId === scratchpadRunId &&
          candidate.blockType === blockType,
      );
      if (!decoration) return;

      const accepted = acceptDecorationIntoNotebook({ decoration });
      if (
        !accepted.succeeded ||
        !accepted.drafts ||
        accepted.drafts.length === 0
      ) {
        const title = "Could not add the live snapshot";
        const detail =
          accepted.failureReason ?? "No notebook content was generated.";
        setRuntimeError({ title, detail });
        toast.error(title, detail);
        return;
      }

      const authorityPlanKey = `${decoration.scratchpadRunId}::${decoration.blockType}::${decoration.version}`;
      const authorityPlan =
        authorityDecorationPlans.find(
          (plan) => plan.key === authorityPlanKey,
        ) ?? authorityPlanByDecorationRef.current.get(authorityPlanKey);
      if (authorityPlan) {
        await acceptAuthorityDecorationPlan(authorityPlan);
        return;
      }
      const persistedOperation = authorityOperationStates?.find(
        (operation) =>
          operation.evidenceScratchpadRunId === decoration.scratchpadRunId &&
          operation.evidenceBlockType === decoration.blockType &&
          operation.evidenceVersion === decoration.version,
      );
      if (persistedOperation) {
        setAuthorityWriteStatus({
          key: authorityPlanKey,
          tone: persistedOperation.remainderCompleted ? "partial" : "failed",
          title: persistedOperation.remainderCompleted
            ? "Validated notebook change already applied."
            : "Saved notebook operation requires recovery.",
          detail: persistedOperation.remainderCompleted
            ? `Receipt ${persistedOperation.receiptId}; explicit remainder ${persistedOperation.remainderCompletionKey}.`
            : `NodeBench will not use the legacy write path for persisted operation ${persistedOperation.operationKey}. Refresh to recover its exact proposal state.`,
          proposalId: persistedOperation.proposalId,
          receiptId: persistedOperation.receiptId ?? undefined,
        });
        return;
      }
      if (
        api &&
        isAuthorityOwner &&
        (authorityState === undefined ||
          authorityOperationStates === undefined ||
          latestScratchpadRun === undefined)
      ) {
        setAuthorityWriteStatus({
          key: authorityPlanKey,
          tone: "review",
          title: "Checking notebook authority.",
          detail:
            "Accept will be available after the server confirms the grant and scratchpad run. No notebook write occurred.",
        });
        return;
      }

      const anchorBlock =
        blocks.find((block) => block._id === focusedBlockId) ??
        blocks.find((block) => (block.accessMode ?? "edit") === "edit") ??
        blocks[0];
      if (!anchorBlock) return;

      const anchorIndex = blocks.findIndex(
        (block) => block._id === anchorBlock._id,
      );
      const afterOriginalBlockId = blocks[anchorIndex + 1]?._id;
      const anchorDisplayContent =
        optimisticBlockContent[String(anchorBlock._id)] ?? anchorBlock.content;
      const shouldReuseAnchor = isTriviallyEmptyNotebookBlock(
        anchorBlock,
        anchorDisplayContent,
      );
      let beforeBlockId = anchorBlock._id;
      let lastCreatedBlockId: Id<"productBlocks"> = anchorBlock._id;
      let draftStartIndex = 0;

      try {
        if (shouldReuseAnchor) {
          const firstDraft = accepted.drafts[0];
          await updateBlock({
            anonymousSessionId,
            shareToken,
            blockId: anchorBlock._id,
            kind: firstDraft.kind,
            content: firstDraft.content,
            sourceRefIds: firstDraft.sourceRefIds,
            attributes: firstDraft.attributes,
            expectedRevision: anchorBlock.revision,
          });
          draftStartIndex = 1;
        }

        for (
          let index = draftStartIndex;
          index < accepted.drafts.length;
          index += 1
        ) {
          const draft = accepted.drafts[index];
          const insertedBlockId = await insertBlockBetween({
            anonymousSessionId,
            shareToken,
            entitySlug,
            beforeBlockId,
            afterBlockId: afterOriginalBlockId,
            parentBlockId: anchorBlock.parentBlockId,
            kind: draft.kind,
            content: draft.content,
            authorKind: "user",
            authorId: viewerOwnerKey ?? undefined,
            sourceRefIds: draft.sourceRefIds,
            attributes: draft.attributes,
          });
          beforeBlockId = insertedBlockId;
          lastCreatedBlockId = insertedBlockId;
        }

        setHiddenDecorationRunIds((current) => ({
          ...current,
          [scratchpadRunId]: true,
        }));
        setRuntimeError(null);
        setLastSyncedAt(Date.now());
        setFocusedBlockId(lastCreatedBlockId);
        toast.success("Live snapshot added to notebook");
        // Log the accept so the drawer's activity timeline shows it.
        // Fire-and-forget; network/log failure must NEVER undo the
        // successful accept (HONEST_STATUS applies: the notebook was
        // truly updated).
        agentActions.logAcceptDecoration(
          buildDecorationContext(decoration),
          anonymousSessionId ?? undefined,
        );
      } catch (error) {
        reportNotebookMutationFailure("save", error);
      }
    },
    [
      agentActions,
      anonymousSessionId,
      api,
      acceptAuthorityDecorationPlan,
      authorityDecorationPlans,
      authorityOperationStates,
      authorityState,
      blocks,
      buildDecorationContext,
      canEdit,
      entitySlug,
      focusedBlockId,
      insertBlockBetween,
      isAuthorityOwner,
      latestScratchpadRun,
      notebookLoadState.fullyLoaded,
      notifyReadOnly,
      optimisticBlockContent,
      reportNotebookMutationFailure,
      shareToken,
      toast,
      updateBlock,
      viewerOwnerKey,
      visibleDiligenceDecorations,
    ],
  );

  if (
    blocksPagination.status === "LoadingFirstPage" ||
    blocks === undefined ||
    snapshot === undefined
  ) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        Loading notebook...
      </div>
    );
  }

  const keepAuthorityTargetVisible =
    hasOnlyEmptyPlaceholderBlocks &&
    (authorityDecorationPlans.length > 0 ||
      Boolean(
        authorityWriteStatus?.proposalId || authorityWriteStatus?.receiptId,
      ));

  if (
    !blocks ||
    blocks.length === 0 ||
    (hasOnlyEmptyPlaceholderBlocks && !keepAuthorityTargetVisible)
  ) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white/[0.02] px-6 py-16 text-center dark:border-white/10">
        <div className="mx-auto max-w-xl">
          <p className="text-base font-medium text-gray-900 dark:text-gray-100">
            {canEdit
              ? hasDerivedNotebookSeed
                ? preparingSeedContent
                  ? "Preparing the notebook from the saved brief."
                  : "This notebook can be restored from the saved brief."
                : creatingFirstBlock
                  ? "Opening the live notebook editor."
                  : "This live notebook is ready for the first block."
              : "No live notebook blocks yet."}
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {canEdit
              ? hasDerivedNotebookSeed
                ? "NodeBench is turning the latest saved report into the notebook so you land on real content instead of an empty draft."
                : visibleDiligenceDecorations.length > 0
                  ? "Your notes stay editable. The latest intelligence will appear as a read-only reference overlay as soon as the editor opens."
                  : "Start writing directly. The first editable block will open for you."
              : "This workspace has no persisted live blocks yet. Ask an editor to open the live notebook first."}
          </p>
          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {hasDerivedNotebookSeed ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreparingSeedContent(true);
                    void backfillEntityBlocks({
                      anonymousSessionId,
                      shareToken,
                      entitySlug,
                    })
                      .then(() => {
                        setRuntimeError(null);
                      })
                      .catch((error: unknown) => {
                        autoSeedNotebookAttemptedRef.current = false;
                        reportNotebookError(
                          "Failed to prepare the notebook from the saved brief",
                          error,
                        );
                      })
                      .finally(() => {
                        setPreparingSeedContent(false);
                      });
                  }}
                  disabled={preparingSeedContent}
                  className="rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {preparingSeedContent
                    ? "Preparing notebook..."
                    : "Load saved brief"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void openFirstBlock()}
                  disabled={creatingFirstBlock}
                  className="rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingFirstBlock
                    ? "Opening editor..."
                    : "Open live notebook"}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="entity-live-notebook">
      {/* Dismissals sync — isolated boundary so a backend error on this
          specific query (e.g. schema drift, prod deploy lag) can't crash
          the whole notebook. Degrades to "no persisted dismissals". */}
      {dismissalsReady ? (
        <ErrorBoundary section="Dismissals sync" fallback={null}>
          <NotebookDismissalsSync
            entitySlug={entitySlug}
            anonymousSessionId={anonymousSessionId}
            onKeysChange={setDismissedKeySet}
          />
        </ErrorBoundary>
      ) : null}
      <NotebookTopStatusRow
        entitySlug={entitySlug}
        expanded={false}
        onToggle={() => openWorkspaceDrawer("flow")}
        className="mb-4"
      />
      {authorityEntityId && api?.domains?.agents?.autonomy ? (
        <NotebookAuthorityControl
          entityId={authorityEntityId}
          runId={latestScratchpadRun?.scratchpadId}
          isOwner={isAuthorityOwner}
          className="mb-4"
        />
      ) : null}
      {authorityWriteStatus ? (
        <div
          role={
            authorityWriteStatus.tone === "blocked" ||
            authorityWriteStatus.tone === "failed"
              ? "alert"
              : "status"
          }
          data-testid="notebook-authority-write-status"
          data-authority-status={authorityWriteStatus.tone}
          data-proposal-id={authorityWriteStatus.proposalId}
          data-receipt-id={authorityWriteStatus.receiptId}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            authorityWriteStatus.tone === "partial"
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
              : authorityWriteStatus.tone === "review"
                ? "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
                : authorityWriteStatus.tone === "blocked"
                  ? "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                  : "border-red-200 bg-red-50/80 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100"
          }`}
        >
          <div className="font-medium">{authorityWriteStatus.title}</div>
          <div className="mt-1 text-xs opacity-80">
            {authorityWriteStatus.detail}
          </div>
        </div>
      ) : null}
      {runtimeError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{runtimeError.title}</div>
              {runtimeError.detail ? (
                <div className="mt-1 text-xs opacity-80">
                  {runtimeError.detail}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setRuntimeError(null)}
              className="rounded border border-amber-300/70 px-2 py-1 text-[11px] transition-colors hover:bg-amber-100/70 dark:border-amber-400/30 dark:hover:bg-amber-400/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {visibleDiligenceDecorations.length > 0 ? (
        <NotebookDiligenceOverlayHost
          decorations={visibleDiligenceDecorations}
          onAcceptDecoration={
            canUseOverlayActions
              ? (runId, blockType) =>
                  void handleAcceptDecoration(runId, blockType)
              : undefined
          }
          onDismissDecoration={
            canUseOverlayActions
              ? (runId, blockType) => handleDismissDecoration(runId, blockType)
              : undefined
          }
          onRefreshDecoration={canEdit ? handleRefreshDecoration : undefined}
          onAskAboutDecoration={handleAskAboutDecoration}
        />
      ) : null}

      {!notebookLoadState.fullyLoaded ? (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Live notebook loaded {blocks.length} of{" "}
                {notebookLoadState.totalCount} block
                {notebookLoadState.totalCount === 1 ? "" : "s"}
              </div>
              <div className="mt-1 text-xs opacity-80">
                Editing stays locked until the full notebook is loaded so
                inserts and saves cannot target a partial block list.
              </div>
            </div>
            {notebookLoadState.canLoadMore ? (
              <button
                type="button"
                onClick={() =>
                  blocksPagination.loadMore(
                    Math.min(
                      Math.max(notebookLoadState.remainingCount, 1),
                      150,
                    ),
                  )
                }
                disabled={notebookLoadState.isLoadingMore}
                className="shrink-0 rounded border border-sky-300/70 px-2 py-1 text-[11px] transition-colors hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-400/30 dark:hover:bg-sky-400/10"
              >
                {notebookLoadState.isLoadingMore
                  ? "Loading..."
                  : `Load ${Math.min(notebookLoadState.remainingCount, 150)} more`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="mx-auto w-full max-w-[920px]">
          <div className="space-y-0">
            {blocks.map((block, blockIndex) => (
              <BlockRow
                key={block._id}
                block={block}
                prev={blocks[blockIndex - 1]}
                sourcesById={sourcesById}
                citationLabelsById={citationLabelsById}
                displayContent={
                  optimisticBlockContent[String(block._id)] ?? block.content
                }
                isEditable={
                  canEdit &&
                  notebookLoadState.fullyLoaded &&
                  block.accessMode === "edit"
                }
                accessMode={
                  canEdit && notebookLoadState.fullyLoaded
                    ? (block.accessMode ?? "edit")
                    : "read"
                }
                isFocused={focusedBlockId === block._id}
                hasBeenMounted={mountedBlockIds.has(String(block._id))}
                depth={blockDepthMap.get(String(block._id)) ?? 0}
                onHoverPrewarm={() => scheduleWarm(block._id)}
                showSlash={slashFor === block._id}
                syncDocumentId={buildProductBlockSyncId({
                  blockId: String(block._id),
                  anonymousSessionId,
                  shareToken,
                })}
                onFocus={() => {
                  warmBlock(block._id);
                  setFocusedBlockId(block._id);
                }}
                onBlur={() => {
                  flushOptimisticBlockContent(block._id);
                  setFocusedBlockId((current: string | null) =>
                    current === block._id ? null : current,
                  );
                }}
                onLocalContentChange={(content) =>
                  handleLocalContentChange(block._id, content)
                }
                registerEditorHandle={(handle) =>
                  registerEditorHandle(block._id, handle)
                }
                onEnter={() => void handleEnter(block, blockIndex)}
                onBackspaceAtStart={async () => {
                  if (blockIndex === 0) return;
                  if (!canEdit || block.accessMode !== "edit") {
                    notifyReadOnly("delete");
                    return;
                  }
                  const prevBlock = blocks[blockIndex - 1];
                  if (prevBlock) {
                    warmBlock(prevBlock._id);
                    setFocusedBlockId(prevBlock._id);
                  }
                  await deleteBlock({
                    anonymousSessionId,
                    shareToken,
                    blockId: block._id,
                  });
                }}
                onOpenSlash={() => setSlashFor(block._id)}
                onCloseSlash={() => setSlashFor(null)}
                onSlashCommand={(cmd) => void runSlashCommand(cmd, block)}
                onMarkdownShortcut={(kind) => {
                  if (!canEdit || block.accessMode !== "edit") return;
                  void updateBlock({
                    anonymousSessionId,
                    shareToken,
                    blockId: block._id,
                    kind,
                    content: [],
                    expectedRevision: block.revision,
                  });
                }}
                onTabIndent={() => {
                  if (!canEdit || block.accessMode !== "edit") return;
                  const prevBlock = blocks[blockIndex - 1];
                  if (!prevBlock) return;
                  if (prevBlock._id === block._id) return;
                  const nextBlock = blocks[blockIndex + 1];
                  void moveBlock({
                    anonymousSessionId,
                    shareToken,
                    blockId: block._id,
                    parentBlockId: prevBlock._id,
                    beforeBlockId: prevBlock._id,
                    afterBlockId: nextBlock?._id,
                  });
                }}
                onShiftTabOutdent={() => {
                  if (!canEdit || block.accessMode !== "edit") return;
                  if (!block.parentBlockId) return;
                  const currentParent = blocks.find(
                    (b) => b._id === block.parentBlockId,
                  );
                  const grandparentId = currentParent?.parentBlockId;
                  const prevBlock = blocks[blockIndex - 1];
                  const nextBlock = blocks[blockIndex + 1];
                  void moveBlock({
                    anonymousSessionId,
                    shareToken,
                    blockId: block._id,
                    beforeBlockId: prevBlock?._id,
                    afterBlockId: nextBlock?._id,
                    ...(grandparentId
                      ? { parentBlockId: grandparentId }
                      : { clearParent: true }),
                  });
                }}
                onAcceptDecoration={(runId, blockType) =>
                  void handleAcceptDecoration(runId, blockType)
                }
                onDismissDecoration={(runId, blockType) =>
                  handleDismissDecoration(runId, blockType)
                }
                onRefreshDecoration={(runId, blockType) =>
                  handleRefreshDecoration(runId, blockType)
                }
                onAskAboutDecoration={handleAskAboutDecoration}
                navigate={navigate}
              />
            ))}
          </div>

          {notebookLoadState.canLoadMore ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() =>
                  blocksPagination.loadMore(
                    Math.min(
                      Math.max(notebookLoadState.remainingCount, 1),
                      150,
                    ),
                  )
                }
                disabled={notebookLoadState.isLoadingMore}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300"
              >
                {notebookLoadState.isLoadingMore
                  ? "Loading more blocks..."
                  : `Load ${Math.min(notebookLoadState.remainingCount, 150)} more block${Math.min(notebookLoadState.remainingCount, 150) === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}

          <BlockStatusBar
            presence={presence ?? []}
            selfUserId={resolvePresenceSelfUserId(
              viewerOwnerKey,
              anonymousSessionId,
            )}
            participantDirectory={participantDirectory}
            latestHumanEdit={latestHumanEdit}
            lastSyncedAt={lastSyncedAt}
            offlineQueueLength={offlineQueueLength}
            isOffline={isOffline}
            rateLimited={rateLimited}
            readOnly={
              !canEdit ||
              !notebookLoadState.fullyLoaded ||
              (!!focusedBlock && (focusedBlock.accessMode ?? "edit") !== "edit")
            }
          />
        </div>
      </div>

      <WorkspaceDrawerPill
        entitySlug={entitySlug}
        runActive={isNotebookRunActive}
        runLabel={latestRunCheckpoint?.currentStep}
      />

      {/* Mention picker â€” modal overlay when active */}
      {mentionFor ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-4 pt-32"
          onClick={() => setMentionFor(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative">
            <MentionPicker
              entitySlug={entitySlug}
              shareToken={shareToken}
              initialQuery={mentionFor.initial}
              onSelect={(match) => void handleMentionPick(match)}
              onClose={() => setMentionFor(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BlockRow - per-block inline editor / renderer
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type BlockRowProps = {
  block: LiveBlock;
  prev?: LiveBlock;
  sourcesById: Map<
    string,
    {
      id: string;
      label: string;
      href?: string;
      confidence?: number;
      domain?: string;
    }
  >;
  citationLabelsById: Map<string, string>;
  displayContent: BlockChip[];
  isEditable: boolean;
  accessMode: AccessMode;
  isFocused: boolean;
  /** Sticky mount flag — once a block has been focused or pre-warmed, keep
      its editor mounted so re-clicks don't re-fetch the sync snapshot. */
  hasBeenMounted?: boolean;
  /** Hover prewarm callback — schedules the editor to mount before the
      user actually clicks, for near-instant interaction. */
  onHoverPrewarm?: () => void;
  showSlash: boolean;
  diligenceDecorations?: readonly DiligenceDecorationData[];
  // Encoded sync id combining anonymousSessionId + blockId; drives
  // useTiptapSync inside NotebookBlockEditor. Must be stable across renders.
  syncDocumentId: string;
  onFocus: () => void;
  onBlur: () => void;
  onLocalContentChange: (content: BlockChip[]) => void;
  registerEditorHandle: (handle: NotebookBlockEditorHandle | null) => void;
  onEnter: () => void;
  onBackspaceAtStart: () => void;
  onOpenSlash: () => void;
  onCloseSlash: () => void;
  onSlashCommand: (cmd: SlashCommand) => void;
  onMarkdownShortcut: (kind: MarkdownBlockKind) => void;
  onTabIndent: () => void;
  onShiftTabOutdent: () => void;
  /** Nesting depth — 0 for top-level, 1+ for indented children. Used to
      apply visual indent (`ml-6` per depth). */
  depth?: number;
  onAcceptDecoration: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  onDismissDecoration: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  onRefreshDecoration: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  /** Seam to side-panel drawer — opens with decoration as context. */
  onAskAboutDecoration?: (
    scratchpadRunId: string,
    blockType: DiligenceDecorationData["blockType"],
  ) => void;
  navigate: (path: string) => void;
};

// Custom memo comparator — data props only.
// ---------------------------------------------------------------------------
// `BlockRow` receives ~20 inline-closure props (`onFocus`, `onBlur`, `onEnter`,
// the per-row indent/outdent/delete handlers, and the decoration callbacks).
// Each of those is re-created on every `EntityNotebookLive` render, so React's
// default shallow-equal comparator always saw "props changed" and re-rendered
// every block in the list on every keystroke anywhere in the notebook — even
// blocks the user wasn't typing into. Profiler traces showed ~40 blocks × 5ms
// per keystroke on a warm cache.
//
// Why this is safe:
// 1. Every inline closure closes over callbacks that are already `useCallback`-
//    wrapped at the parent (`warmBlock`, `setFocusedBlockId`,
//    `handleLocalContentChange`, mutations from `useMutation`, etc.), so their
//    BEHAVIOUR is stable even when their identity changes.
// 2. The closures reference `block._id` / `blockIndex` / `blocks[i±1]`. If any
//    of those structurally change, at least one DATA prop listed below also
//    changes (`block`, `prev`, `displayContent`, `depth`) — the comparator
//    still forces a re-render in those cases.
// 3. Focus, slash-menu, and decoration state are all captured via data props,
//    so the row still updates when the user interacts.
//
// Prior art: Linear, Figma, Notion — all collaborative editors route per-row
// actions through a custom-compared memo boundary or a dispatcher-style
// single-callback API. We take the comparator path because the dispatcher
// refactor would touch every handler in this 2.2k-line file.
const blockRowPropsEqual = (
  prev: BlockRowProps,
  next: BlockRowProps,
): boolean => {
  return (
    prev.block === next.block &&
    prev.prev === next.prev &&
    prev.displayContent === next.displayContent &&
    prev.sourcesById === next.sourcesById &&
    prev.citationLabelsById === next.citationLabelsById &&
    prev.isEditable === next.isEditable &&
    prev.accessMode === next.accessMode &&
    prev.isFocused === next.isFocused &&
    prev.hasBeenMounted === next.hasBeenMounted &&
    prev.showSlash === next.showSlash &&
    prev.syncDocumentId === next.syncDocumentId &&
    prev.depth === next.depth &&
    prev.diligenceDecorations === next.diligenceDecorations
  );
};

const BlockRow = memo(function BlockRow({
  block,
  prev,
  sourcesById,
  citationLabelsById,
  displayContent,
  isEditable,
  accessMode,
  isFocused,
  hasBeenMounted,
  onHoverPrewarm,
  showSlash,
  diligenceDecorations,
  syncDocumentId,
  onFocus,
  onBlur,
  onLocalContentChange,
  registerEditorHandle,
  onEnter,
  onBackspaceAtStart,
  onOpenSlash,
  onCloseSlash,
  onSlashCommand,
  onMarkdownShortcut,
  onTabIndent,
  onShiftTabOutdent,
  depth = 0,
  onAcceptDecoration,
  onDismissDecoration,
  onRefreshDecoration,
  onAskAboutDecoration,
}: BlockRowProps) {
  const isEvidence = block.kind === "evidence";
  const supportsSyncEditing = isSyncEditableBlock(block);
  const shouldMountSyncEditor =
    supportsSyncEditing &&
    (isFocused || hasBeenMounted || (diligenceDecorations?.length ?? 0) > 0);
  const isAgentAuthored = block.authorKind === "agent";
  const isRecentAgentEdit =
    isAgentAuthored && Date.now() - block.updatedAt < 5 * 60 * 1000;
  const startsAuthorRun =
    !prev ||
    prev.authorKind !== block.authorKind ||
    prev.authorId !== block.authorId ||
    prev.sourceSessionId !== block.sourceSessionId;
  const followsParentHeading = Boolean(
    block.parentBlockId && prev?._id === block.parentBlockId,
  );
  const opensSection =
    block.kind === "heading_2" ||
    block.kind === "heading_3" ||
    (!prev && block.kind === "text");
  const isEmptyTextBlock = isTriviallyEmptyNotebookBlock(block, displayContent);
  // Heading rhythm mirrors v4 prototype (.block-h1 / .block-h2 margins):
  // H1 gets 24px top-gap, H2 gets 20px, H3 gets 16px. Regular blocks use
  // 4px to match .block-text margin. Followers of a heading collapse to
  // 1px so the body hugs its section title like the prototype.
  const blockSpacingClass =
    block.kind === "heading_1"
      ? "pt-6"
      : block.kind === "heading_2"
        ? "pt-5"
        : block.kind === "heading_3"
          ? "pt-4"
          : followsParentHeading
            ? "pt-px"
            : isEmptyTextBlock
              ? "pt-px"
              : "pt-1";

  // Typography locked to v4 prototype (docs/inspo_prototype_htmls/
  // nodebench_v4_notionLike_reactFlow.html):
  //   H1 30/1.3, H2 24/1.3, H3 18/1.3, body 16/1.75.
  // The prototype uses weight 600 for headings and leaves body at 400.
  const classesForKind = (): string => {
    switch (block.kind) {
      case "heading_1":
        return "text-[30px] font-semibold leading-[1.3] tracking-tight text-gray-900 dark:text-gray-100";
      case "heading_2":
        return "text-[24px] font-semibold leading-[1.3] tracking-tight text-gray-900 dark:text-gray-100";
      case "heading_3":
        return "text-[18px] font-semibold leading-[1.3] tracking-tight text-gray-900 dark:text-gray-100";
      case "bullet":
        return "text-[16px] leading-[1.75] text-gray-700 dark:text-gray-200";
      case "todo":
        return "text-[16px] leading-[1.75] text-gray-700 dark:text-gray-200";
      case "callout":
        return "border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 py-1 pl-3 text-[16px] leading-[1.75] text-gray-700 dark:text-gray-200";
      case "quote":
        return "border-l-2 border-gray-300 pl-3 text-[16px] italic leading-[1.75] text-gray-600 dark:border-white/20 dark:text-gray-400";
      case "code":
        return "rounded bg-gray-100 px-3 py-2 font-mono text-[13px] text-gray-800 dark:bg-white/[0.04] dark:text-gray-200";
      case "generated_marker":
        return "text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400";
      default:
        return "text-[16px] leading-[1.75] text-gray-700 dark:text-gray-200";
    }
  };

  if (isEvidence) {
    const href =
      displayContent.find((c) => c.type === "link")?.url ??
      displayContent[0]?.url;
    const label =
      displayContent.find((c) => c.type === "link")?.value ??
      chipsToPlainText(displayContent);
    return (
      <div className="group ml-6 py-1">
        <a
          href={href ?? "#"}
          target={href ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white/40 px-2.5 py-1 text-[12.5px] text-gray-600 transition-colors hover:border-gray-300 dark:border-white/10 dark:bg-white/[0.02] dark:text-gray-400"
        >
          <Link2 className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <span className="truncate">{label}</span>
          {href ? <ExternalLink className="h-3 w-3 text-gray-400" /> : null}
        </a>
      </div>
    );
  }

  return (
    <div
      data-testid="notebook-block"
      data-block-id={String(block._id)}
      data-block-kind={block.kind}
      data-block-focused={String(isFocused)}
      data-author-kind={block.authorKind}
      onMouseEnter={onHoverPrewarm}
      onClick={() => {
        if (supportsSyncEditing) {
          onFocus();
        }
      }}
      data-depth={depth}
      className={`group relative -mx-2 px-2 ${blockSpacingClass} ${
        supportsSyncEditing ? "cursor-text" : ""
      } ${isRecentAgentEdit ? "notebook-block-wet-ink" : ""}`}
      style={depth > 0 ? { marginLeft: `${depth * 1.5}rem` } : undefined}
    >
      <div className="relative min-w-0">
        {isAgentAuthored && startsAuthorRun ? (
          <div
            className={`${opensSection ? "mb-3" : "mb-2"} flex flex-wrap items-center gap-2`}
          >
            {/* Per-agent author tag — colored pill carrying WHICH agent
                wrote this block, not a generic "AI generated" stamp.
                Pulled from the v3/v4 prototypes: attribution is what
                makes the notebook feel co-authored rather than auto-
                generated. `authorId` parsed into a display name:
                  - "agent:<name>"  → <name>
                  - "slash:<cmd>"   → "/<cmd>"
                  - anything else   → "Agent" (fallback) */}
            <AgentAuthorTag
              agentId={block.authorId ?? "agent"}
              agentName={
                typeof block.authorId === "string"
                  ? block.authorId.startsWith("agent:")
                    ? block.authorId.slice(6) || "Agent"
                    : block.authorId.startsWith("slash:")
                      ? `/${block.authorId.slice(6)}`
                      : "Agent"
                  : "Agent"
              }
            />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {shouldMountSyncEditor ? (
              <NotebookBlockEditor
                ref={registerEditorHandle}
                syncDocumentId={syncDocumentId}
                chips={displayContent}
                diligenceDecorations={diligenceDecorations}
                className={classesForKind()}
                isEditable={isEditable}
                ariaLabel={`Block - ${block.kind}`}
                autoFocus={isFocused}
                onFocus={onFocus}
                onBlur={onBlur}
                onLocalContentChange={onLocalContentChange}
                onEnter={onEnter}
                onBackspaceAtStart={onBackspaceAtStart}
                onOpenSlash={onOpenSlash}
                onMarkdownShortcut={onMarkdownShortcut}
                onTabIndent={onTabIndent}
                onShiftTabOutdent={onShiftTabOutdent}
                onCloseSlash={onCloseSlash}
                onAcceptDecoration={onAcceptDecoration}
                onDismissDecoration={onDismissDecoration}
                onRefreshDecoration={onRefreshDecoration}
                onAskAboutDecoration={onAskAboutDecoration}
              />
            ) : (
              <div
                className={`ProseMirror nb-block-shell outline-none focus-visible:outline-none min-h-[1.5em] ${classesForKind()} ${
                  !isEditable
                    ? "cursor-default opacity-80"
                    : supportsSyncEditing
                      ? "cursor-text"
                      : ""
                }`}
                onFocus={shouldMountSyncEditor ? undefined : onFocus}
                onBlur={shouldMountSyncEditor ? undefined : onBlur}
                role="textbox"
                aria-readonly={!isEditable}
                aria-label={`Block - ${block.kind}`}
                tabIndex={supportsSyncEditing ? 0 : undefined}
              >
                <BlockChipRenderer chips={displayContent} />
                {isEmptyTextBlock ? <br aria-hidden="true" /> : null}
              </div>
            )}
            {/* Render inline citations (sourceRefIds) after the editable surface */}
            {block.sourceRefIds && block.sourceRefIds.length > 0 ? (
              <span className="mt-1.5 inline-flex flex-wrap items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                {block.sourceRefIds.map((refId, idx) => {
                  const source = sourcesById.get(refId);
                  const tooltip = source
                    ? `${source.domain ?? source.label}${
                        source.confidence != null
                          ? ` - confidence ${source.confidence.toFixed(2)}`
                          : ""
                      }`
                    : refId;
                  const citationLabel =
                    citationLabelsById.get(refId) ?? `s${idx + 1}`;
                  return (
                    <a
                      key={`${block._id}-cite-${idx}`}
                      href={source?.href ?? "#"}
                      target={source?.href ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      title={tooltip}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/10"
                    >
                      [{citationLabel}]
                    </a>
                  );
                })}
              </span>
            ) : null}
          </div>
          {accessMode !== "edit" ||
          (block.authorKind === "agent" &&
            !block.kind.startsWith("heading_") &&
            block.kind !== "evidence") ? (
            <div className="flex shrink-0 items-start gap-2">
              {accessMode !== "edit" ? (
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-amber-600 bg-amber-500/10"
                  title={
                    accessMode === "read"
                      ? "Read-only block"
                      : "Append-only block"
                  }
                >
                  <Lock className="h-2.5 w-2.5" />
                  {accessMode}
                </span>
              ) : null}
              <BlockProvenance block={block} />
            </div>
          ) : null}
        </div>

        {showSlash ? (
          <SlashPalette onCommand={onSlashCommand} onClose={onCloseSlash} />
        ) : null}
      </div>
    </div>
  );
}, blockRowPropsEqual);

BlockRow.displayName = "BlockRow";

export default EntityNotebookLive;
