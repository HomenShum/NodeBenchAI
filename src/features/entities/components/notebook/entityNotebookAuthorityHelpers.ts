import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AcceptedNotebookBlockDraft } from "./acceptDecorationIntoNotebook";
import type { BlockChip } from "./BlockChipRenderer";
import {
  chipsEqual,
  chipsToPlainText,
  isTriviallyEmptyNotebookBlock,
  type LiveBlock,
} from "./entityNotebookLiveHelpers";

export type NotebookAuthorityCandidate = {
  operationKey: string;
  blockId: Id<"productBlocks">;
  baseRevision: number;
  runId: Id<"agentScratchpads">;
  proposedContent: BlockChip[];
  proposedSourceRefIds: string[];
  selectedDraftIndex: number;
  remainingDrafts: AcceptedNotebookBlockDraft[];
  selectedAttributesRemainExplicit: boolean;
  idempotencyKey: string;
};

export type NotebookAuthorityCandidateFailure =
  | "scratchpad_run_unavailable"
  | "scratchpad_run_mismatch"
  | "decoration_timestamp_invalid"
  | "evidence_tier_insufficient"
  | "source_refs_required"
  | "proposal_content_too_large"
  | "remainder_plan_too_large"
  | "target_not_editable"
  | "target_not_trivially_empty"
  | "target_has_unsaved_content"
  | "target_has_attributes"
  | "no_kind_preserving_draft"
  | "source_refs_not_preserved"
  | "draft_attributes_not_preserved";

export type NotebookAuthorityCandidateEvaluation =
  | { eligible: true; candidate: NotebookAuthorityCandidate }
  | { eligible: false; reason: NotebookAuthorityCandidateFailure };

export type NotebookAuthorityOperationSnapshot = {
  operationKey: string;
  proposalId: string;
  receiptId: string | null;
  blockId: Id<"productBlocks">;
  baseRevision: number;
  proposedContent: BlockChip[];
  proposedSourceRefIds: string[];
  runId: Id<"agentScratchpads">;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Two independent 32-bit FNV-1a passes keep the browser-only key compact. */
function stableKeyDigest(value: unknown): string {
  const input = canonicalJson(value);
  const hash = (seed: number) => {
    let result = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

function hasAttributes(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function sameAttributes(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  return canonicalJson(left ?? {}) === canonicalJson(right ?? {});
}

function exactBoundedSourceRefIds(
  sourceRefIds: readonly string[] | undefined,
): string[] | null {
  if ((sourceRefIds?.length ?? 0) > 100) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const sourceRefId of sourceRefIds ?? []) {
    if (
      !sourceRefId ||
      sourceRefId !== sourceRefId.trim() ||
      sourceRefId.length > 240 ||
      seen.has(sourceRefId)
    ) {
      return null;
    }
    seen.add(sourceRefId);
    result.push(sourceRefId);
  }
  return new TextEncoder().encode(JSON.stringify(result)).length <= 20_000
    ? result
    : null;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "null").length;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function readScratchpadBaseRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const value = (payload as Record<string, unknown>).scratchpadBaseRunId;
  if (typeof value !== "string" || value !== value.trim()) return null;
  return value.length > 0 && value.length <= 160 ? value : null;
}

export function runInFlightOnly<K, V>(
  inFlight: Map<K, Promise<V>>,
  key: K,
  request: () => Promise<V>,
): Promise<V> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = request().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

export function buildNotebookAuthorityOperationKey(args: {
  entityId: Id<"productEntities">;
  scratchpadId: Id<"agentScratchpads">;
  scratchpadRunId: string;
  blockType: string;
  decorationVersion: number;
}): string {
  return `notebook-decoration-op:${stableKeyDigest({
    entityId: String(args.entityId),
    scratchpadId: String(args.scratchpadId),
    scratchpadRunId: args.scratchpadRunId,
    blockType: args.blockType,
    decorationVersion: args.decorationVersion,
  })}`;
}

export function buildNotebookAuthorityRemainderCompletionKey(
  operationKey: string,
): string {
  return `${operationKey}:remainder:v1`;
}

export function shouldSubmitNewNotebookAuthorityAttempt(args: {
  status: "pending" | "blocked" | "committing" | "committed" | "rejected";
  persistedGrantId: string | null;
  activeGrantId?: string;
}): boolean {
  return Boolean(
    args.status === "pending" &&
    args.activeGrantId &&
    args.activeGrantId !== args.persistedGrantId,
  );
}

export function shouldAutoCommitNotebookAuthorityProposal(args: {
  approvalMode?: "explicit" | "delegated";
  delegationDenied?: boolean;
}): boolean {
  return args.approvalMode === "delegated" && !args.delegationDenied;
}

/**
 * A blocked proposal may be retried only after its bound candidate changes.
 * This keeps render-driven recovery bounded: the same rejected payload never
 * spins, while a fresh revision, source set, or generated body gets one new
 * server-validated attempt.
 */
export function hasNotebookAuthorityCandidateChanged(
  operation: NotebookAuthorityOperationSnapshot,
  candidate: NotebookAuthorityCandidate,
): boolean {
  return (
    operation.operationKey !== candidate.operationKey ||
    operation.blockId !== candidate.blockId ||
    operation.baseRevision !== candidate.baseRevision ||
    operation.runId !== candidate.runId ||
    !chipsEqual(operation.proposedContent, candidate.proposedContent) ||
    !sameStrings(operation.proposedSourceRefIds, candidate.proposedSourceRefIds)
  );
}

export function recoverNotebookAuthorityCandidate(args: {
  operation: NotebookAuthorityOperationSnapshot;
  expectedOperationKey: string;
  block: LiveBlock | undefined;
  drafts: readonly AcceptedNotebookBlockDraft[];
  authorityScopeKey?: string;
}): NotebookAuthorityCandidate | null {
  if (
    args.operation.operationKey !== args.expectedOperationKey ||
    !args.block ||
    args.block._id !== args.operation.blockId
  ) {
    return null;
  }
  const proposedSourceRefIds = exactBoundedSourceRefIds(
    args.operation.proposedSourceRefIds,
  );
  if (!proposedSourceRefIds || proposedSourceRefIds.length === 0) return null;

  const selectedDraftIndex = args.drafts.findIndex((draft, index) => {
    if (draft.kind !== args.block!.kind) return false;
    if (!chipsEqual(draft.content, args.operation.proposedContent))
      return false;
    const draftSourceRefIds = exactBoundedSourceRefIds(draft.sourceRefIds);
    if (
      !draftSourceRefIds ||
      !sameStrings(draftSourceRefIds, proposedSourceRefIds)
    ) {
      return false;
    }
    if (!hasAttributes(draft.attributes)) return true;
    return args.drafts.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        hasAttributes(other.attributes) &&
        sameAttributes(other.attributes, draft.attributes),
    );
  });
  if (selectedDraftIndex < 0) return null;

  const selectedDraft = args.drafts[selectedDraftIndex];
  return {
    operationKey: args.operation.operationKey,
    blockId: args.operation.blockId,
    baseRevision: args.operation.baseRevision,
    runId: args.operation.runId,
    proposedContent: args.operation.proposedContent,
    proposedSourceRefIds,
    selectedDraftIndex,
    remainingDrafts: args.drafts.filter(
      (_, index) => index !== selectedDraftIndex,
    ),
    selectedAttributesRemainExplicit: hasAttributes(selectedDraft.attributes),
    idempotencyKey: `notebook-recovered:${stableKeyDigest({
      operationKey: args.operation.operationKey,
      proposalId: args.operation.proposalId,
      authorityScopeKey: args.authorityScopeKey ?? "review",
    })}`,
  };
}

/**
 * Selects the one field-safe replacement that delegated authority may apply.
 *
 * A normal accepted decoration is a multi-draft plan (marker, heading, body).
 * V1 may replace one existing empty block with the first same-kind body draft;
 * kind changes, attributes, and every insertion stay on the explicit path.
 * When the selected draft carries provenance attributes, an identical copy
 * must remain on another explicit draft (normally the generated marker), so
 * the partial delegated write cannot silently erase the plan's provenance.
 */
export function evaluateNotebookAuthorityCandidate(args: {
  block: LiveBlock;
  displayContent: BlockChip[];
  drafts: readonly AcceptedNotebookBlockDraft[];
  decorationSourceRefIds?: readonly string[];
  decorationScratchpadRunId: string;
  decorationScratchpadBaseRunId?: string | null;
  scratchpadThreadRunId?: string | null;
  scratchpadId?: Id<"agentScratchpads"> | null;
  entityId: Id<"productEntities">;
  blockType: string;
  overallTier: "verified" | "corroborated" | "single-source" | "unverified";
  decorationVersion: number;
  decorationUpdatedAt: number;
  currentTimeMs?: number;
  authorityScopeKey: string;
}): NotebookAuthorityCandidateEvaluation {
  if (!args.scratchpadId || !args.scratchpadThreadRunId) {
    return { eligible: false, reason: "scratchpad_run_unavailable" };
  }
  if (
    (args.decorationScratchpadBaseRunId ?? args.decorationScratchpadRunId) !==
    args.scratchpadThreadRunId
  ) {
    return { eligible: false, reason: "scratchpad_run_mismatch" };
  }
  const currentTimeMs = args.currentTimeMs ?? Date.now();
  if (
    !Number.isSafeInteger(args.decorationUpdatedAt) ||
    args.decorationUpdatedAt <= 0 ||
    args.decorationUpdatedAt > currentTimeMs + 5 * 60_000
  ) {
    return { eligible: false, reason: "decoration_timestamp_invalid" };
  }
  if (args.overallTier !== "verified" && args.overallTier !== "corroborated") {
    return { eligible: false, reason: "evidence_tier_insufficient" };
  }
  if (args.block.accessMode !== "edit") {
    return { eligible: false, reason: "target_not_editable" };
  }
  if (!isTriviallyEmptyNotebookBlock(args.block, args.displayContent)) {
    return { eligible: false, reason: "target_not_trivially_empty" };
  }
  if (!chipsEqual(args.block.content, args.displayContent)) {
    return { eligible: false, reason: "target_has_unsaved_content" };
  }
  if (hasAttributes(args.block.attributes)) {
    return { eligible: false, reason: "target_has_attributes" };
  }

  const expectedSourceRefIds = exactBoundedSourceRefIds(
    args.decorationSourceRefIds,
  );
  if (!expectedSourceRefIds) {
    return { eligible: false, reason: "source_refs_not_preserved" };
  }
  if (expectedSourceRefIds.length === 0) {
    return { eligible: false, reason: "source_refs_required" };
  }
  let selectedDraftIndex = -1;
  let proposedSourceRefIds: string[] = [];
  let sawSourceRefMismatch = false;
  let sawUnrepresentedAttributes = false;
  let sawOversizedContent = false;
  let sawOversizedRemainder = false;

  for (let index = 0; index < args.drafts.length; index += 1) {
    const draft = args.drafts[index];
    if (draft.kind !== args.block.kind) continue;
    if (chipsToPlainText(draft.content).trim().length === 0) continue;

    const draftSourceRefIds = exactBoundedSourceRefIds(draft.sourceRefIds);
    if (
      !draftSourceRefIds ||
      !sameStrings(draftSourceRefIds, expectedSourceRefIds)
    ) {
      sawSourceRefMismatch = true;
      continue;
    }

    if (hasAttributes(draft.attributes)) {
      const representedExplicitly = args.drafts.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          hasAttributes(other.attributes) &&
          sameAttributes(other.attributes, draft.attributes),
      );
      if (!representedExplicitly) {
        sawUnrepresentedAttributes = true;
        continue;
      }
    }

    if (jsonBytes(draft.content) > 50_000) {
      sawOversizedContent = true;
      continue;
    }
    const remainderDrafts = args.drafts.filter(
      (_, otherIndex) => otherIndex !== index,
    );
    if (remainderDrafts.length > 24 || jsonBytes(remainderDrafts) > 200_000) {
      sawOversizedRemainder = true;
      continue;
    }

    selectedDraftIndex = index;
    proposedSourceRefIds = draftSourceRefIds;
    break;
  }

  if (selectedDraftIndex < 0) {
    if (sawSourceRefMismatch) {
      return { eligible: false, reason: "source_refs_not_preserved" };
    }
    if (sawUnrepresentedAttributes) {
      return { eligible: false, reason: "draft_attributes_not_preserved" };
    }
    if (sawOversizedContent) {
      return { eligible: false, reason: "proposal_content_too_large" };
    }
    if (sawOversizedRemainder) {
      return { eligible: false, reason: "remainder_plan_too_large" };
    }
    return { eligible: false, reason: "no_kind_preserving_draft" };
  }

  const selectedDraft = args.drafts[selectedDraftIndex];
  const remainingDrafts = args.drafts.filter(
    (_, index) => index !== selectedDraftIndex,
  );
  const operationKey = buildNotebookAuthorityOperationKey({
    entityId: args.entityId,
    scratchpadId: args.scratchpadId,
    scratchpadRunId: args.decorationScratchpadRunId,
    blockType: args.blockType,
    decorationVersion: args.decorationVersion,
  });
  const idempotencyKey = `notebook-decoration:${stableKeyDigest({
    operationKey,
    authorityScopeKey: args.authorityScopeKey,
    blockId: String(args.block._id),
    baseRevision: args.block.revision,
    blockType: args.blockType,
    decorationRunId: args.decorationScratchpadRunId,
    decorationVersion: args.decorationVersion,
    proposedContent: selectedDraft.content,
    proposedSourceRefIds,
  })}`;

  return {
    eligible: true,
    candidate: {
      operationKey,
      blockId: args.block._id,
      baseRevision: args.block.revision,
      runId: args.scratchpadId,
      proposedContent: selectedDraft.content,
      proposedSourceRefIds,
      selectedDraftIndex,
      remainingDrafts,
      selectedAttributesRemainExplicit: hasAttributes(selectedDraft.attributes),
      idempotencyKey,
    },
  };
}
