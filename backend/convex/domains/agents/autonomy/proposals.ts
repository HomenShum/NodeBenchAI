import { v } from "convex/values";

import type { Doc } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { mutation, query } from "../../../_generated/server";
import {
  findActiveTasteBenchRunId,
  recordBoundTasteBenchOperationalEvent,
} from "../../evaluation/tasteBench";
import { requireAuthenticatedProductIdentity } from "../../product/helpers";
import { productBlockChipValidator } from "../../product/schema";
import {
  normalizeOperationKey,
  resolveDecorationEvidence,
  sameOrderedStrings,
} from "./evidence";
import { findOwnedGrantByPublicId } from "./grants";
import { digestCanonical } from "./hash";
import {
  AUTONOMY_CAPABILITY_ENVELOPE,
  AUTONOMY_AGENT_ID,
  AUTONOMY_AGENT_LABEL,
  AUTONOMY_LIMITS,
  AUTONOMY_OPERATION,
  AutonomyPolicyError,
  assertChecksPassed,
  evaluateCommitSnapshot,
  evaluateDelegatedAuthority,
  evaluateUndoEligibility,
  type AutonomyApprovalMode,
  type AutonomyValidationCheck,
} from "./policy";
import {
  AUTONOMY_POLICY_VERSION,
  AUTONOMY_RECEIPT_VERSION,
  autonomyApprovalModeValidator,
  autonomyDiligenceBlockTypeValidator,
} from "./schema";

type ReadCtx = Pick<QueryCtx, "db">;
type Proposal = Doc<"autonomyProposals">;
type Receipt = Doc<"autonomyReceipts">;

function boundedText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AutonomyPolicyError(
      `${field}_invalid`,
      `${field} must contain 1-${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalBoundedText(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, field, maxLength);
}

function contentBytes(content: unknown): number {
  return new TextEncoder().encode(JSON.stringify(content)).length;
}

function analyzeSourceRefIds(values: readonly string[]): {
  canonical: string[];
  checks: AutonomyValidationCheck[];
  safeToPersist: boolean;
} {
  // Source refs are an ordered set in the notebook renderer. Keep the exact
  // persisted order for OCC/receipts/undo; reject values needing trimming and
  // duplicates instead of silently normalizing presentation state.
  const canonical = [...values];
  const unique = new Set(canonical);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical)).length;
  const checks: AutonomyValidationCheck[] = [
    validationCheck(
      "source_ref_count_bounded",
      values.length <= AUTONOMY_LIMITS.maxSourceRefIds,
    ),
    validationCheck(
      "source_ref_values_valid",
      canonical.every(
        (value) =>
          value === value.trim() &&
          value.length > 0 &&
          value.length <= AUTONOMY_LIMITS.maxSourceRefLength,
      ),
    ),
    validationCheck("source_ref_values_unique", unique.size === values.length),
    validationCheck(
      "source_ref_bytes_bounded",
      bytes <= AUTONOMY_LIMITS.maxSourceRefBytes,
    ),
  ];
  return {
    canonical,
    checks,
    safeToPersist: checks.every((item) => item.passed),
  };
}

function validationCheck(
  code: string,
  passed: boolean,
  detail?: string,
): AutonomyValidationCheck {
  return detail ? { code, passed, detail } : { code, passed };
}

async function findOwnedProposalByPublicId(
  ctx: ReadCtx,
  ownerKey: string,
  proposalId: string,
): Promise<Proposal | null> {
  const row = await ctx.db
    .query("autonomyProposals")
    .withIndex("by_proposal_id", (q) => q.eq("proposalId", proposalId))
    .unique();
  return row?.ownerKey === ownerKey ? row : null;
}

async function findOwnedReceiptByPublicId(
  ctx: ReadCtx,
  ownerKey: string,
  receiptId: string,
): Promise<Receipt | null> {
  const row = await ctx.db
    .query("autonomyReceipts")
    .withIndex("by_receipt_id", (q) => q.eq("receiptId", receiptId))
    .unique();
  return row?.ownerKey === ownerKey ? row : null;
}

function existingProposalSubmitResult(
  existing: Proposal,
  operationRecovered = false,
) {
  return {
    operationKey: existing.operationKey,
    proposalId: existing.proposalId,
    receiptId: existing.receiptId ?? null,
    status: existing.status,
    approvalMode: existing.approvalMode,
    needsApproval:
      existing.status === "pending" && existing.approvalMode === "explicit",
    needsGuardedCommit:
      existing.approvalMode === "delegated" && existing.status === "pending",
    delegationDenied: !!existing.delegationFailureCode,
    delegationFailureCode: existing.delegationFailureCode,
    validationFailed: existing.status === "blocked",
    validationFailureCode: existing.blockedReason,
    needsNewProposal: existing.status === "blocked",
    operationRecovered,
    idempotent: true,
  };
}

async function withCurrentUndoState(ctx: ReadCtx, receipt: Receipt) {
  if (receipt.event !== "commit") {
    return {
      ...receipt,
      canUndoNow: false,
      undoUnavailableReason: "receipt_is_not_commit" as string | null,
      undoReceiptId: null as string | null,
      currentBlockRevision: null as number | null,
    };
  }

  const [priorUndo, completion, block] = await Promise.all([
    ctx.db
      .query("autonomyReceipts")
      .withIndex("by_source_receipt", (q) =>
        q.eq("sourceReceiptId", receipt.receiptId),
      )
      .unique(),
    ctx.db
      .query("autonomyRemainderCompletions")
      .withIndex("by_owner_operation_key", (q) =>
        q
          .eq("ownerKey", receipt.ownerKey)
          .eq("operationKey", receipt.operationKey),
      )
      .unique(),
    ctx.db.get(receipt.blockId),
  ]);
  if (!block || block.ownerKey !== receipt.ownerKey) {
    return {
      ...receipt,
      canUndoNow: false,
      undoUnavailableReason: "undo_block_not_found" as string | null,
      undoReceiptId: priorUndo?.receiptId ?? null,
      currentBlockRevision: null as number | null,
    };
  }

  const [currentContentHash, currentSourceRefIdsHash] = await Promise.all([
    digestCanonical(block.content),
    digestCanonical(analyzeSourceRefIds(block.sourceRefIds ?? []).canonical),
  ]);
  const checks = [
    ...evaluateUndoEligibility({
      receiptOwnerKey: receipt.ownerKey,
      requesterOwnerKey: receipt.ownerKey,
      receiptEvent: receipt.event,
      canUndoAtCommit: receipt.canUndoAtCommit,
      receiptAfterRevision: receipt.afterRevision,
      currentRevision: block.revision,
      receiptAfterContentHash: receipt.afterContentHash,
      currentContentHash,
      receiptAfterSourceRefIdsHash: receipt.afterSourceRefIdsHash,
      currentSourceRefIdsHash,
      alreadyUndone: !!priorUndo,
    }),
    validationCheck("undo_block_is_live", block.deletedAt === undefined),
    validationCheck("undo_block_is_editable", block.accessMode === "edit"),
  ];
  const failed = checks.find((item) => !item.passed);
  const undoUnavailableReason = completion
    ? "remainder_completed_requires_composite_undo"
    : (failed?.code ?? null);
  return {
    ...receipt,
    canUndoNow: !completion && !failed,
    undoUnavailableReason,
    undoReceiptId: priorUndo?.receiptId ?? null,
    currentBlockRevision: block.revision,
  };
}

export const submitBlockProposal = mutation({
  args: {
    idempotencyKey: v.string(),
    operationKey: v.string(),
    blockId: v.id("productBlocks"),
    proposedContent: v.array(productBlockChipValidator),
    proposedSourceRefIds: v.array(v.string()),
    baseRevision: v.number(),
    runId: v.id("agentScratchpads"),
    decorationBlockType: autonomyDiligenceBlockTypeValidator,
    decorationScratchpadRunId: v.string(),
    decorationVersion: v.number(),
    grantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const now = Date.now();
    const idempotencyKey = boundedText(
      args.idempotencyKey,
      "idempotency_key",
      AUTONOMY_LIMITS.maxKeyLength,
    );
    const agentId = AUTONOMY_AGENT_ID;
    const agentLabel = AUTONOMY_AGENT_LABEL;
    const runId = args.runId;
    const operationKey = normalizeOperationKey(args.operationKey);
    const grantId = optionalBoundedText(
      args.grantId,
      "grant_id",
      AUTONOMY_LIMITS.maxKeyLength,
    );
    const sourceRefInputMode = "replace" as const;
    const requestedSourceRefAnalysis = analyzeSourceRefIds(
      args.proposedSourceRefIds,
    );
    const [proposedContentHash, requestedSourceRefIdsHash] = await Promise.all([
      digestCanonical(args.proposedContent),
      digestCanonical(requestedSourceRefAnalysis.canonical),
    ]);

    // The decoration operation is the reload-safe exactly-once identity. It is
    // correlation metadata only: owner auth and all live policy checks remain
    // mandatory for the first proposal. Once present, its persisted state wins
    // over any stale local target/revision reconstructed after a reload.
    const existingOperationAttempts = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_operation_key", (q) =>
        q.eq("ownerKey", identity.ownerKey).eq("operationKey", operationKey),
      )
      .order("desc")
      .take(AUTONOMY_LIMITS.maxOperationAttempts + 1);
    const mismatchedAttempt = existingOperationAttempts.find(
      (attempt) =>
        attempt.evidenceBlockType !== args.decorationBlockType ||
        attempt.evidenceScratchpadRunId !== args.decorationScratchpadRunId ||
        attempt.evidenceVersion !== args.decorationVersion ||
        attempt.runId !== runId,
    );
    if (mismatchedAttempt) {
      throw new AutonomyPolicyError(
        "operation_key_conflict",
        "operationKey is already bound to a different decoration identity.",
      );
    }
    const committedAttempt = existingOperationAttempts.find(
      (attempt) => attempt.status === "committed" && !!attempt.receiptId,
    );
    if (committedAttempt) {
      return existingProposalSubmitResult(committedAttempt, true);
    }
    // Resolve request idempotency before inspecting live block state. A retry
    // after the first commit must return its committed proposal/receipt even
    // though the block revision has advanced.
    const existing = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_idempotency", (q) =>
        q
          .eq("ownerKey", identity.ownerKey)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.operationKey !== operationKey ||
        existing.blockId !== args.blockId ||
        existing.baseRevision !== args.baseRevision ||
        existing.proposedContentHash !== proposedContentHash ||
        existing.agentId !== agentId ||
        existing.runId !== runId ||
        existing.grantId !== grantId ||
        existing.sourceRefInputMode !== sourceRefInputMode ||
        existing.proposedSourceRefIdsHash !== requestedSourceRefIdsHash ||
        existing.evidenceBlockType !== args.decorationBlockType ||
        existing.evidenceScratchpadRunId !== args.decorationScratchpadRunId ||
        existing.evidenceVersion !== args.decorationVersion
      ) {
        throw new AutonomyPolicyError(
          "proposal_idempotency_conflict",
          "idempotencyKey was already used for a different proposal.",
        );
      }
      return existingProposalSubmitResult(existing);
    }
    if (
      existingOperationAttempts.length >= AUTONOMY_LIMITS.maxOperationAttempts
    ) {
      throw new AutonomyPolicyError(
        "operation_attempt_limit_exceeded",
        "This decoration has reached its bounded proposal-attempt limit.",
      );
    }

    const bytes = contentBytes(args.proposedContent);
    const block = await ctx.db.get(args.blockId);
    if (!block || block.ownerKey !== identity.ownerKey) {
      throw new AutonomyPolicyError(
        "block_not_found",
        "Writable notebook block not found.",
      );
    }

    const [entity, scratchpad] = await Promise.all([
      ctx.db.get(block.entityId),
      ctx.db.get(runId),
    ]);
    const beforeSourceRefAnalysis = analyzeSourceRefIds(
      block.sourceRefIds ?? [],
    );
    const proposedSourceRefAnalysis = requestedSourceRefAnalysis;
    const evidence = await resolveDecorationEvidence(ctx, {
      ownerKey: identity.ownerKey,
      userId: identity.rawUserId,
      entity,
      scratchpad,
      operationKey,
      blockType: args.decorationBlockType,
      scratchpadRunId: args.decorationScratchpadRunId,
      version: args.decorationVersion,
      proposedContent: args.proposedContent,
      proposedSourceRefIds: proposedSourceRefAnalysis.canonical,
    });
    const evidencePassed = evidence.checks.every((item) => item.passed);

    const [
      beforeContentHash,
      beforeSourceRefIdsHash,
      proposedSourceRefIdsHash,
    ] = await Promise.all([
      digestCanonical(block.content),
      digestCanonical(beforeSourceRefAnalysis.canonical),
      digestCanonical(proposedSourceRefAnalysis.canonical),
    ]);
    const snapshotChecks = evaluateCommitSnapshot({
      expectedRevision: args.baseRevision,
      currentRevision: block.revision,
      expectedContentHash: beforeContentHash,
      currentContentHash: beforeContentHash,
      proposedContentHash,
      expectedSourceRefIdsHash: beforeSourceRefIdsHash,
      currentSourceRefIdsHash: beforeSourceRefIdsHash,
      proposedSourceRefIdsHash,
    });
    const validationChecks: AutonomyValidationCheck[] = [
      validationCheck(
        "block_owner_matches",
        block.ownerKey === identity.ownerKey,
      ),
      validationCheck(
        "base_revision_valid",
        Number.isSafeInteger(args.baseRevision) && args.baseRevision >= 0,
      ),
      validationCheck("block_is_live", block.deletedAt === undefined),
      validationCheck("block_is_editable", block.accessMode === "edit"),
      validationCheck("target_kind_is_text", block.kind === "text"),
      validationCheck("target_is_user_authored", block.authorKind === "user"),
      validationCheck(
        "target_content_is_trivially_empty",
        block.content.every(
          (chip) => chip.type === "linebreak" || chip.value.trim().length === 0,
        ),
      ),
      validationCheck(
        "target_source_refs_empty",
        beforeSourceRefAnalysis.canonical.length === 0,
      ),
      validationCheck(
        "target_attributes_empty",
        block.attributes === undefined ||
          (typeof block.attributes === "object" &&
            block.attributes !== null &&
            !Array.isArray(block.attributes) &&
            Object.keys(block.attributes as Record<string, unknown>).length ===
              0),
      ),
      validationCheck(
        "entity_owner_matches",
        !!entity && entity.ownerKey === identity.ownerKey,
      ),
      validationCheck(
        "scratchpad_owner_matches",
        !!scratchpad && scratchpad.ownerKey === identity.ownerKey,
      ),
      validationCheck(
        "scratchpad_entity_matches",
        !!scratchpad &&
          !!entity &&
          scratchpad.entitySlug === entity.slug &&
          scratchpad.entityId === entity._id,
      ),
      validationCheck(
        "scratchpad_state_allows_proposal",
        !!scratchpad &&
          (scratchpad.status === "streaming" ||
            scratchpad.status === "structuring" ||
            scratchpad.status === "merged"),
      ),
      validationCheck(
        "content_within_bound",
        bytes <= AUTONOMY_LIMITS.maxBlockContentBytes,
      ),
      ...beforeSourceRefAnalysis.checks.map((item) => ({
        ...item,
        code: `before_${item.code}`,
      })),
      ...proposedSourceRefAnalysis.checks,
      ...evidence.checks,
      ...snapshotChecks,
    ];

    const commonFailure = validationChecks.find((item) => !item.passed);
    let approvalMode: AutonomyApprovalMode = "explicit";
    let delegationFailureCode: string | undefined;
    if (!commonFailure && grantId) {
      const grant = await findOwnedGrantByPublicId(
        ctx,
        identity.ownerKey,
        grantId,
      );
      const decision = evaluateDelegatedAuthority(grant, {
        ownerKey: identity.ownerKey,
        operation: AUTONOMY_OPERATION,
        entityId: String(block.entityId),
        blockId: String(args.blockId),
        runId: String(runId),
        agentId,
        now,
      });
      validationChecks.push(...decision.checks);
      if (!decision.allowed) {
        // Preserve the proposal and failed checks for human review. The
        // caller gets an explicit denial flag; no block mutation occurs.
        delegationFailureCode = decision.reasonCode ?? "delegation_denied";
        approvalMode = "explicit";
      } else {
        approvalMode = "delegated";
      }
    } else if (!commonFailure) {
      validationChecks.push(
        validationCheck(
          "review_mode_explicit",
          true,
          "No grant supplied; a signed-in owner must approve the proposal.",
        ),
      );
    }

    const tasteBenchRunId = await findActiveTasteBenchRunId(
      ctx,
      identity.rawUserId,
    ).catch(() => null);
    const proposalDigest = await digestCanonical({
      ownerKey: identity.ownerKey,
      operationKey,
      idempotencyKey,
      blockId: String(args.blockId),
      entityId: String(block.entityId),
      baseRevision: args.baseRevision,
      proposedContentHash,
      proposedSourceRefIdsHash,
      agentId,
      runId: String(runId),
      grantId: grantId ?? null,
      tasteBenchRunId: tasteBenchRunId ? String(tasteBenchRunId) : null,
      evidenceProjectionId: evidence.projection
        ? String(evidence.projection._id)
        : null,
      evidenceBlockType: args.decorationBlockType,
      evidenceScratchpadRunId: args.decorationScratchpadRunId,
      evidenceVersion: args.decorationVersion,
      evidenceTier: evidence.evidenceTier ?? null,
      evidenceSourceSectionId: evidence.evidenceSourceSectionId ?? null,
      evidenceSourceCount: evidence.evidenceSourceCount ?? null,
      evidenceDerivedContentHash: evidence.derivedContentHash ?? null,
      evidenceDigest: evidence.evidenceDigest ?? null,
    });
    const proposalId = `proposal_${proposalDigest.slice("sha256:".length)}`;
    await ctx.db.insert("autonomyProposals", {
      ownerKey: identity.ownerKey,
      userId: identity.rawUserId,
      proposalId,
      idempotencyKey,
      operationKey,
      operation: AUTONOMY_OPERATION,
      entityId: block.entityId,
      blockId: args.blockId,
      runId,
      agentId,
      agentIdentityAssurance: "server_fixed",
      agentLabel,
      grantId,
      tasteBenchRunId: tasteBenchRunId ?? undefined,
      evidenceProjectionId: evidence.projection?._id,
      evidenceBlockType: args.decorationBlockType,
      evidenceScratchpadRunId: args.decorationScratchpadRunId,
      evidenceVersion: args.decorationVersion,
      evidenceTier: evidence.evidenceTier,
      evidenceSourceRefIds: evidence.evidenceSourceRefIds,
      evidenceSourceSectionId: evidence.evidenceSourceSectionId,
      evidenceSourceCount: evidence.evidenceSourceCount,
      evidenceDerivedContentHash: evidence.derivedContentHash,
      evidenceDigest: evidence.evidenceDigest,
      approvalMode,
      status: commonFailure ? "blocked" : "pending",
      baseRevision: args.baseRevision,
      beforeContent: block.content,
      proposedContent:
        bytes <= AUTONOMY_LIMITS.maxBlockContentBytes
          ? args.proposedContent
          : [],
      proposedContentOmitted:
        bytes > AUTONOMY_LIMITS.maxBlockContentBytes ? true : undefined,
      beforeContentHash,
      proposedContentHash,
      beforeSourceRefIds: beforeSourceRefAnalysis.canonical,
      proposedSourceRefIds:
        proposedSourceRefAnalysis.safeToPersist && evidencePassed
          ? proposedSourceRefAnalysis.canonical
          : [],
      proposedSourceRefIdsOmitted:
        proposedSourceRefAnalysis.safeToPersist && evidencePassed
          ? undefined
          : true,
      sourceRefInputMode,
      beforeSourceRefIdsHash,
      proposedSourceRefIdsHash,
      validationChecks,
      delegationFailureCode,
      blockedAt: commonFailure ? now : undefined,
      blockedReason: commonFailure?.code,
      createdAt: now,
      updatedAt: now,
    });

    if (tasteBenchRunId && existingOperationAttempts.length > 0) {
      await recordBoundTasteBenchOperationalEvent(ctx, {
        userId: identity.rawUserId,
        runId: tasteBenchRunId,
        eventType: "proposal_retried",
        subjectRef: proposalId,
        detail: "A changed, bounded notebook proposal was revalidated.",
        sourceKind: "autonomy_proposal",
        sourceReceiptRef: proposalId,
        sourceRunRef: proposalId,
      });
    }
    if (tasteBenchRunId && commonFailure) {
      await recordBoundTasteBenchOperationalEvent(ctx, {
        userId: identity.rawUserId,
        runId: tasteBenchRunId,
        eventType: "proposal_invalid",
        subjectRef: proposalId,
        detail: `Notebook proposal was blocked (${commonFailure.code}).`,
        sourceKind: "autonomy_proposal",
        sourceReceiptRef: proposalId,
        sourceRunRef: proposalId,
      });
    }
    if (tasteBenchRunId && delegationFailureCode) {
      await recordBoundTasteBenchOperationalEvent(ctx, {
        userId: identity.rawUserId,
        runId: tasteBenchRunId,
        eventType: "approval_interrupted",
        subjectRef: proposalId,
        detail: `Delegated notebook approval was interrupted (${delegationFailureCode}).`,
        sourceKind: "autonomy_proposal",
        sourceReceiptRef: proposalId,
        sourceRunRef: proposalId,
      });
    }

    return {
      operationKey,
      proposalId,
      receiptId: null,
      status: commonFailure ? ("blocked" as const) : ("pending" as const),
      approvalMode,
      needsApproval: !commonFailure && approvalMode === "explicit",
      needsGuardedCommit: !commonFailure && approvalMode === "delegated",
      validationFailed: !!commonFailure,
      validationFailureCode: commonFailure?.code,
      needsNewProposal: !!commonFailure,
      delegationDenied: !!delegationFailureCode,
      delegationFailureCode,
      idempotent: false,
    };
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const proposal = await findOwnedProposalByPublicId(
      ctx,
      identity.ownerKey,
      args.proposalId,
    );
    if (!proposal) {
      throw new AutonomyPolicyError(
        "proposal_not_found",
        "Proposal not found.",
      );
    }
    if (proposal.status === "rejected") {
      return { ok: true, status: "rejected" as const, idempotent: true };
    }
    if (proposal.status !== "pending" && proposal.status !== "blocked") {
      throw new AutonomyPolicyError(
        "proposal_not_pending",
        `Cannot reject a ${proposal.status} proposal.`,
      );
    }
    const rejectionReason = args.reason
      ? boundedText(
          args.reason,
          "rejection_reason",
          AUTONOMY_LIMITS.maxReasonLength,
        )
      : "Rejected by owner";
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: "rejected",
      rejectionReason,
      rejectedAt: now,
      updatedAt: now,
    });
    return { ok: true, status: "rejected" as const, idempotent: false };
  },
});

/**
 * Records the authenticated owner's explicit review action. This is separate
 * from submit/commit so review-mode proposals cannot be written merely by
 * passing `approvalMode: "explicit"` to the guarded commit endpoint.
 */
export const approveProposal = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const proposal = await findOwnedProposalByPublicId(
      ctx,
      identity.ownerKey,
      args.proposalId,
    );
    if (!proposal) {
      throw new AutonomyPolicyError(
        "proposal_not_found",
        "Proposal not found.",
      );
    }
    if (proposal.status !== "pending") {
      throw new AutonomyPolicyError(
        "proposal_not_pending",
        `Cannot approve a ${proposal.status} proposal.`,
      );
    }
    if (proposal.approvalMode !== "explicit") {
      throw new AutonomyPolicyError(
        "explicit_approval_not_applicable",
        "Pause/revoke delegated authority before manually approving this proposal.",
      );
    }
    if (proposal.ownerApprovedAt) {
      return {
        ok: true,
        approvedAt: proposal.ownerApprovedAt,
        assurance:
          proposal.ownerApprovalAssurance ?? "authenticated_owner_action",
        idempotent: true,
      };
    }
    const approvedAt = Date.now();
    await ctx.db.patch(proposal._id, {
      ownerApprovedAt: approvedAt,
      ownerApprovalAssurance: "authenticated_owner_action",
      updatedAt: approvedAt,
    });
    return {
      ok: true,
      approvedAt,
      assurance: "authenticated_owner_action" as const,
      idempotent: false,
    };
  },
});

export const getProposal = query({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    return await findOwnedProposalByPublicId(
      ctx,
      identity.ownerKey,
      args.proposalId,
    );
  },
});

export const listProposals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const rows = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(Math.min(limit * 4, 100));
    return rows
      .filter((row) => row.status === "pending" || row.status === "blocked")
      .slice(0, limit);
  },
});

async function withOperationState(ctx: ReadCtx, proposal: Proposal) {
  const [completion, receipt] = await Promise.all([
    ctx.db
      .query("autonomyRemainderCompletions")
      .withIndex("by_owner_operation_key", (q) =>
        q
          .eq("ownerKey", proposal.ownerKey)
          .eq("operationKey", proposal.operationKey),
      )
      .unique(),
    proposal.receiptId
      ? findOwnedReceiptByPublicId(ctx, proposal.ownerKey, proposal.receiptId)
      : Promise.resolve(null),
  ]);
  const receiptState = receipt
    ? await withCurrentUndoState(ctx, receipt)
    : null;
  return {
    operationKey: proposal.operationKey,
    proposalId: proposal.proposalId,
    receiptId: proposal.receiptId ?? null,
    status: proposal.status,
    entityId: proposal.entityId,
    blockId: proposal.blockId,
    baseRevision: proposal.baseRevision,
    proposedContent: proposal.proposedContent,
    proposedSourceRefIds: proposal.proposedSourceRefIds,
    runId: proposal.runId,
    grantId: proposal.grantId ?? null,
    approvalMode: proposal.approvalMode,
    validationFailed: proposal.status === "blocked",
    validationFailureCode: proposal.blockedReason ?? null,
    delegationDenied: !!proposal.delegationFailureCode,
    delegationFailureCode: proposal.delegationFailureCode ?? null,
    evidenceBlockType: proposal.evidenceBlockType,
    evidenceScratchpadRunId: proposal.evidenceScratchpadRunId,
    evidenceVersion: proposal.evidenceVersion,
    evidenceTier: proposal.evidenceTier ?? null,
    evidenceSourceRefIds: proposal.evidenceSourceRefIds,
    evidenceSourceSectionId: proposal.evidenceSourceSectionId ?? null,
    evidenceSourceCount: proposal.evidenceSourceCount ?? null,
    evidenceDerivedContentHash: proposal.evidenceDerivedContentHash ?? null,
    remainderCompletionKey: completion?.completionKey ?? null,
    remainderCompleted: !!completion,
    insertedBlockIds: completion?.insertedBlockIds ?? [],
    canUndoNow: receiptState?.canUndoNow ?? false,
    undoUnavailableReason:
      receiptState?.undoUnavailableReason ??
      (proposal.receiptId ? "receipt_not_found" : "proposal_not_committed"),
    currentBlockRevision: receiptState?.currentBlockRevision ?? null,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

/** Reload-safe lookup for one stable decoration acceptance operation. */
export const getOperationState = query({
  args: { operationKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const operationKey = normalizeOperationKey(args.operationKey);
    const attempts = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_operation_key", (q) =>
        q.eq("ownerKey", identity.ownerKey).eq("operationKey", operationKey),
      )
      .order("desc")
      .take(AUTONOMY_LIMITS.maxOperationAttempts);
    const proposal =
      attempts.find(
        (attempt) => attempt.status === "committed" && !!attempt.receiptId,
      ) ?? attempts[0];
    return proposal ? await withOperationState(ctx, proposal) : null;
  },
});

/** Latest operation states for reconstructing committed partial plans. */
export const listOperationStates = query({
  args: {
    entityId: v.id("productEntities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const entity = await ctx.db.get(args.entityId);
    if (!entity || entity.ownerKey !== identity.ownerKey) return [];
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 50);
    const attempts = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_entity_created", (q) =>
        q.eq("ownerKey", identity.ownerKey).eq("entityId", args.entityId),
      )
      .order("desc")
      .take(limit * AUTONOMY_LIMITS.maxOperationAttempts);
    const winners = new Map<string, Proposal>();
    for (const attempt of attempts) {
      const current = winners.get(attempt.operationKey);
      if (!current) {
        winners.set(attempt.operationKey, attempt);
        continue;
      }
      if (
        current.status !== "committed" &&
        attempt.status === "committed" &&
        !!attempt.receiptId
      ) {
        winners.set(attempt.operationKey, attempt);
      }
    }
    const proposals = [...winners.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
    return await Promise.all(
      proposals.map((proposal) => withOperationState(ctx, proposal)),
    );
  },
});

export const getReceipt = query({
  args: { receiptId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const receipt = await findOwnedReceiptByPublicId(
      ctx,
      identity.ownerKey,
      args.receiptId,
    );
    return receipt ? await withCurrentUndoState(ctx, receipt) : null;
  },
});

export const listReceipts = query({
  args: {
    entityId: v.optional(v.id("productEntities")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    if (args.entityId) {
      const rows = await ctx.db
        .query("autonomyReceipts")
        .withIndex("by_owner_entity_created", (q) =>
          q.eq("ownerKey", identity.ownerKey).eq("entityId", args.entityId!),
        )
        .order("desc")
        .take(limit);
      return await Promise.all(
        rows.map((row) => withCurrentUndoState(ctx, row)),
      );
    }
    const rows = await ctx.db
      .query("autonomyReceipts")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(limit);
    return await Promise.all(rows.map((row) => withCurrentUndoState(ctx, row)));
  },
});

export type PreparedProposalCommit =
  | { kind: "already_committed"; proposalId: string; receiptId: string }
  | {
      kind: "delegation_denied";
      proposalId: string;
      reasonCode: string;
      needsApproval: true;
    }
  | {
      kind: "validation_failed";
      proposalId: string;
      reasonCode: string;
      needsNewProposal: true;
    }
  | {
      kind: "ready";
      proposalId: string;
      blockId: Proposal["blockId"];
      proposedContent: Proposal["proposedContent"];
      proposedSourceRefIds: Proposal["proposedSourceRefIds"];
      expectedRevision: number;
      editedByAuthorKind: "agent";
      editedByAuthorId: string;
      forkHistory: true;
    };

/**
 * Transactional integration seam for product/blocks.ts.
 *
 * The guarded writer must call this helper, then apply its existing block
 * update primitive with exactly the returned expectedRevision/content/author
 * fields, then call finalizeProposalCommit before the same mutation returns.
 * It must branch on `kind` and MUST NOT write unless `kind === "ready"`.
 * If any step throws, Convex rolls the proposal/grant/block changes back as a
 * single transaction.
 */
export async function prepareProposalCommit(
  ctx: MutationCtx,
  args: { proposalId: string; approvalMode: AutonomyApprovalMode },
): Promise<PreparedProposalCommit> {
  const identity = await requireAuthenticatedProductIdentity(ctx);
  const proposal = await findOwnedProposalByPublicId(
    ctx,
    identity.ownerKey,
    args.proposalId,
  );
  if (!proposal) {
    throw new AutonomyPolicyError("proposal_not_found", "Proposal not found.");
  }
  if (proposal.status === "committed" && proposal.receiptId) {
    return {
      kind: "already_committed",
      proposalId: proposal.proposalId,
      receiptId: proposal.receiptId,
    };
  }
  if (proposal.status !== "pending") {
    throw new AutonomyPolicyError(
      "proposal_not_pending",
      `Cannot commit a ${proposal.status} proposal.`,
    );
  }

  const block = await ctx.db.get(proposal.blockId);
  if (!block || block.ownerKey !== identity.ownerKey) {
    throw new AutonomyPolicyError(
      "block_not_found",
      "Writable notebook block not found.",
    );
  }
  const [entity, scratchpad] = await Promise.all([
    ctx.db.get(block.entityId),
    ctx.db.get(proposal.runId),
  ]);
  const currentSourceRefAnalysis = analyzeSourceRefIds(
    block.sourceRefIds ?? [],
  );
  const currentEvidence = await resolveDecorationEvidence(ctx, {
    ownerKey: identity.ownerKey,
    userId: identity.rawUserId,
    entity,
    scratchpad,
    operationKey: proposal.operationKey,
    blockType: proposal.evidenceBlockType,
    scratchpadRunId: proposal.evidenceScratchpadRunId,
    version: proposal.evidenceVersion,
    proposedContent: proposal.proposedContent,
    proposedSourceRefIds: proposal.proposedSourceRefIds,
  });
  const [
    currentContentHash,
    currentSourceRefIdsHash,
    storedProposedContentHash,
    storedProposedSourceRefIdsHash,
  ] = await Promise.all([
    digestCanonical(block.content),
    digestCanonical(currentSourceRefAnalysis.canonical),
    digestCanonical(proposal.proposedContent),
    digestCanonical(proposal.proposedSourceRefIds),
  ]);
  const checks: AutonomyValidationCheck[] = [
    validationCheck(
      "block_owner_matches",
      block.ownerKey === identity.ownerKey,
    ),
    validationCheck(
      "block_entity_matches",
      block.entityId === proposal.entityId,
    ),
    validationCheck("block_is_live", block.deletedAt === undefined),
    validationCheck("block_is_editable", block.accessMode === "edit"),
    validationCheck("target_kind_is_text", block.kind === "text"),
    validationCheck("target_is_user_authored", block.authorKind === "user"),
    validationCheck(
      "target_content_is_trivially_empty",
      block.content.every(
        (chip) => chip.type === "linebreak" || chip.value.trim().length === 0,
      ),
    ),
    validationCheck(
      "target_source_refs_empty",
      currentSourceRefAnalysis.canonical.length === 0,
    ),
    validationCheck(
      "target_attributes_empty",
      block.attributes === undefined ||
        (typeof block.attributes === "object" &&
          block.attributes !== null &&
          !Array.isArray(block.attributes) &&
          Object.keys(block.attributes as Record<string, unknown>).length ===
            0),
    ),
    validationCheck(
      "entity_owner_matches",
      !!entity && entity.ownerKey === identity.ownerKey,
    ),
    validationCheck(
      "scratchpad_owner_matches",
      !!scratchpad && scratchpad.ownerKey === identity.ownerKey,
    ),
    validationCheck(
      "scratchpad_entity_matches",
      !!scratchpad &&
        !!entity &&
        scratchpad.entitySlug === entity.slug &&
        scratchpad.entityId === entity._id,
    ),
    validationCheck(
      "scratchpad_state_allows_commit",
      !!scratchpad &&
        (scratchpad.status === "streaming" ||
          scratchpad.status === "structuring" ||
          scratchpad.status === "merged"),
    ),
    ...currentEvidence.checks,
    validationCheck(
      "proposal_evidence_projection_matches",
      !!currentEvidence.projection &&
        currentEvidence.projection._id === proposal.evidenceProjectionId,
    ),
    validationCheck(
      "proposal_evidence_tier_matches",
      currentEvidence.evidenceTier === proposal.evidenceTier,
    ),
    validationCheck(
      "proposal_evidence_source_refs_match",
      sameOrderedStrings(
        currentEvidence.evidenceSourceRefIds,
        proposal.evidenceSourceRefIds,
      ),
    ),
    validationCheck(
      "proposal_evidence_source_section_matches",
      currentEvidence.evidenceSourceSectionId ===
        proposal.evidenceSourceSectionId,
    ),
    validationCheck(
      "proposal_evidence_source_count_matches",
      currentEvidence.evidenceSourceCount === proposal.evidenceSourceCount,
    ),
    validationCheck(
      "proposal_evidence_derived_content_matches",
      currentEvidence.derivedContentHash !== undefined &&
        currentEvidence.derivedContentHash ===
          proposal.evidenceDerivedContentHash,
    ),
    validationCheck(
      "proposal_evidence_digest_matches",
      currentEvidence.evidenceDigest !== undefined &&
        currentEvidence.evidenceDigest === proposal.evidenceDigest,
    ),
    validationCheck(
      "proposal_payload_present",
      proposal.proposedContentOmitted !== true &&
        proposal.proposedSourceRefIdsOmitted !== true,
    ),
    validationCheck(
      "proposal_content_hash_matches",
      storedProposedContentHash === proposal.proposedContentHash,
    ),
    validationCheck(
      "proposal_source_refs_hash_matches",
      storedProposedSourceRefIdsHash === proposal.proposedSourceRefIdsHash,
    ),
    ...currentSourceRefAnalysis.checks.map((item) => ({
      ...item,
      code: `current_${item.code}`,
    })),
    ...evaluateCommitSnapshot({
      expectedRevision: proposal.baseRevision,
      currentRevision: block.revision,
      expectedContentHash: proposal.beforeContentHash,
      currentContentHash,
      proposedContentHash: proposal.proposedContentHash,
      expectedSourceRefIdsHash: proposal.beforeSourceRefIdsHash,
      currentSourceRefIdsHash,
      proposedSourceRefIdsHash: proposal.proposedSourceRefIdsHash,
    }),
  ];
  const checksForReceipt = () => [
    ...proposal.validationChecks,
    ...checks.map((item) => ({ ...item, code: `commit.${item.code}` })),
  ];

  const commonFailure = checks.find((item) => !item.passed);
  if (commonFailure) {
    const blockedAt = Date.now();
    await ctx.db.patch(proposal._id, {
      status: "blocked",
      validationChecks: checksForReceipt(),
      blockedAt,
      blockedReason: commonFailure.code,
      updatedAt: blockedAt,
    });
    if (proposal.tasteBenchRunId) {
      await recordBoundTasteBenchOperationalEvent(ctx, {
        userId: identity.rawUserId,
        runId: proposal.tasteBenchRunId,
        eventType: "proposal_invalid",
        subjectRef: proposal.proposalId,
        detail: `Notebook proposal was blocked (${commonFailure.code}).`,
        sourceKind: "autonomy_proposal",
        sourceReceiptRef: proposal.proposalId,
        sourceRunRef: proposal.proposalId,
      });
    }
    return {
      kind: "validation_failed",
      proposalId: proposal.proposalId,
      reasonCode: commonFailure.code,
      needsNewProposal: true,
    };
  }

  let grant: Doc<"autonomyGrants"> | null = null;
  if (args.approvalMode === "delegated") {
    if (!proposal.grantId) {
      const reasonCode = "grant_missing";
      checks.push(
        validationCheck(
          reasonCode,
          false,
          "Delegated commit requires the proposal's grant.",
        ),
      );
      await ctx.db.patch(proposal._id, {
        approvalMode: "explicit",
        validationChecks: checksForReceipt(),
        delegationFailureCode: reasonCode,
        updatedAt: Date.now(),
      });
      if (proposal.tasteBenchRunId) {
        await recordBoundTasteBenchOperationalEvent(ctx, {
          userId: identity.rawUserId,
          runId: proposal.tasteBenchRunId,
          eventType: "approval_interrupted",
          subjectRef: proposal.proposalId,
          detail: `Delegated notebook approval was interrupted (${reasonCode}).`,
          sourceKind: "autonomy_proposal",
          sourceReceiptRef: proposal.proposalId,
          sourceRunRef: proposal.proposalId,
        });
      }
      return {
        kind: "delegation_denied",
        proposalId: proposal.proposalId,
        reasonCode,
        needsApproval: true,
      };
    }
    grant = await findOwnedGrantByPublicId(
      ctx,
      identity.ownerKey,
      proposal.grantId,
    );
    const decision = evaluateDelegatedAuthority(grant, {
      ownerKey: identity.ownerKey,
      operation: AUTONOMY_OPERATION,
      entityId: String(proposal.entityId),
      blockId: String(proposal.blockId),
      runId: String(proposal.runId),
      agentId: proposal.agentId,
      now: Date.now(),
    });
    checks.push(...decision.checks);
    if (!decision.allowed || !grant) {
      const reasonCode = decision.reasonCode ?? "grant_missing";
      await ctx.db.patch(proposal._id, {
        approvalMode: "explicit",
        validationChecks: checksForReceipt(),
        delegationFailureCode: reasonCode,
        updatedAt: Date.now(),
      });
      if (proposal.tasteBenchRunId) {
        await recordBoundTasteBenchOperationalEvent(ctx, {
          userId: identity.rawUserId,
          runId: proposal.tasteBenchRunId,
          eventType: "approval_interrupted",
          subjectRef: proposal.proposalId,
          detail: `Delegated notebook approval was interrupted (${reasonCode}).`,
          sourceKind: "autonomy_proposal",
          sourceReceiptRef: proposal.proposalId,
          sourceRunRef: proposal.proposalId,
        });
      }
      return {
        kind: "delegation_denied",
        proposalId: proposal.proposalId,
        reasonCode,
        needsApproval: true,
      };
    }

    const now = Date.now();
    const grantPatch: {
      usedOperations: number;
      lastUsedAt: number;
      updatedAt: number;
      status: "active" | "consumed";
    } = {
      usedOperations: grant.usedOperations + 1,
      lastUsedAt: now,
      updatedAt: now,
      status:
        grant.usedOperations + 1 >= grant.maxOperations ? "consumed" : "active",
    };
    assertChecksPassed(checks);
    await ctx.db.patch(grant._id, grantPatch);
  } else {
    if (
      !proposal.ownerApprovedAt ||
      proposal.ownerApprovalAssurance !== "authenticated_owner_action"
    ) {
      throw new AutonomyPolicyError(
        "owner_approval_required",
        "Call approveProposal from the authenticated review UI before explicit commit.",
      );
    }
    checks.push(
      validationCheck(
        "explicit_owner_approval",
        true,
        `Authenticated owner approved at ${proposal.ownerApprovedAt}.`,
      ),
    );
    assertChecksPassed(checks);
  }

  await ctx.db.patch(proposal._id, {
    status: "committing",
    approvalMode: args.approvalMode,
    validationChecks: checksForReceipt(),
    updatedAt: Date.now(),
  });
  return {
    kind: "ready",
    proposalId: proposal.proposalId,
    blockId: proposal.blockId,
    proposedContent: proposal.proposedContent,
    proposedSourceRefIds: proposal.proposedSourceRefIds,
    expectedRevision: proposal.baseRevision,
    editedByAuthorKind: "agent",
    editedByAuthorId: proposal.agentId,
    forkHistory: true,
  };
}

/** Final half of the same guarded block mutation; see prepareProposalCommit. */
export async function finalizeProposalCommit(
  ctx: MutationCtx,
  args: { proposalId: string },
): Promise<{ receiptId: string; afterRevision: number; idempotent: boolean }> {
  const identity = await requireAuthenticatedProductIdentity(ctx);
  const proposal = await findOwnedProposalByPublicId(
    ctx,
    identity.ownerKey,
    args.proposalId,
  );
  if (!proposal) {
    throw new AutonomyPolicyError("proposal_not_found", "Proposal not found.");
  }
  if (proposal.status === "committed" && proposal.receiptId) {
    return {
      receiptId: proposal.receiptId,
      afterRevision: proposal.baseRevision + 1,
      idempotent: true,
    };
  }
  if (proposal.status !== "committing") {
    throw new AutonomyPolicyError(
      "proposal_not_committing",
      "prepareProposalCommit must run before finalization in the same mutation.",
    );
  }

  const block = await ctx.db.get(proposal.blockId);
  if (!block || block.ownerKey !== identity.ownerKey) {
    throw new AutonomyPolicyError(
      "block_not_found",
      "Committed notebook block not found.",
    );
  }
  const afterSourceRefIds = analyzeSourceRefIds(
    block.sourceRefIds ?? [],
  ).canonical;
  const [afterContentHash, afterSourceRefIdsHash] = await Promise.all([
    digestCanonical(block.content),
    digestCanonical(afterSourceRefIds),
  ]);
  const afterChecks: AutonomyValidationCheck[] = [
    validationCheck(
      "after_owner_matches",
      block.ownerKey === identity.ownerKey,
    ),
    validationCheck(
      "after_entity_matches",
      block.entityId === proposal.entityId,
    ),
    validationCheck(
      "after_revision_incremented",
      block.revision === proposal.baseRevision + 1,
    ),
    validationCheck(
      "after_content_matches_proposal",
      afterContentHash === proposal.proposedContentHash,
    ),
    validationCheck(
      "after_source_refs_match_proposal",
      afterSourceRefIdsHash === proposal.proposedSourceRefIdsHash,
    ),
  ];
  assertChecksPassed(afterChecks);
  if (
    !proposal.evidenceProjectionId ||
    !proposal.evidenceDigest ||
    !proposal.evidenceDerivedContentHash ||
    (proposal.evidenceTier !== "verified" &&
      proposal.evidenceTier !== "corroborated")
  ) {
    throw new AutonomyPolicyError(
      "committed_evidence_missing",
      "A commit receipt requires the exact verified or corroborated projection evidence.",
    );
  }

  const grant = proposal.grantId
    ? await findOwnedGrantByPublicId(ctx, identity.ownerKey, proposal.grantId)
    : null;
  if (proposal.approvalMode === "delegated" && !grant) {
    throw new AutonomyPolicyError(
      "grant_missing_during_finalize",
      "Delegated receipt cannot be finalized without its grant.",
    );
  }
  const policyDigest =
    proposal.approvalMode === "delegated"
      ? grant!.policyDigest
      : await digestCanonical({
          policyVersion: AUTONOMY_POLICY_VERSION,
          approvalMode: "explicit",
          ownerKey: identity.ownerKey,
          operation: AUTONOMY_OPERATION,
          capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
        });
  const createdAt = Date.now();
  const validationChecks = [...proposal.validationChecks, ...afterChecks];
  const receiptBody = {
    receiptVersion: AUTONOMY_RECEIPT_VERSION,
    event: "commit" as const,
    ownerKey: identity.ownerKey,
    userId: String(identity.rawUserId),
    proposalId: proposal.proposalId,
    operationKey: proposal.operationKey,
    grantId:
      proposal.approvalMode === "delegated" ? (proposal.grantId ?? null) : null,
    approvalMode: proposal.approvalMode,
    operation: AUTONOMY_OPERATION,
    entityId: String(proposal.entityId),
    blockId: String(proposal.blockId),
    runId: String(proposal.runId),
    agentId: proposal.agentId,
    agentIdentityAssurance: "server_fixed" as const,
    agentLabel: proposal.agentLabel ?? null,
    tasteBenchRunId: proposal.tasteBenchRunId
      ? String(proposal.tasteBenchRunId)
      : null,
    evidenceProjectionId: String(proposal.evidenceProjectionId),
    evidenceBlockType: proposal.evidenceBlockType,
    evidenceScratchpadRunId: proposal.evidenceScratchpadRunId,
    evidenceVersion: proposal.evidenceVersion,
    evidenceTier: proposal.evidenceTier,
    evidenceSourceRefIds: proposal.evidenceSourceRefIds,
    evidenceSourceSectionId: proposal.evidenceSourceSectionId ?? null,
    evidenceSourceCount: proposal.evidenceSourceCount ?? null,
    evidenceDerivedContentHash: proposal.evidenceDerivedContentHash,
    evidenceDigest: proposal.evidenceDigest,
    policyVersion: AUTONOMY_POLICY_VERSION,
    policyDigest,
    grantScopeDigest:
      proposal.approvalMode === "delegated"
        ? (grant?.scopeDigest ?? null)
        : null,
    runBindingDigest:
      proposal.approvalMode === "delegated"
        ? (grant?.runBindingDigest ?? null)
        : null,
    capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
    validationChecks,
    beforeRevision: proposal.baseRevision,
    afterRevision: block.revision,
    beforeContentHash: proposal.beforeContentHash,
    afterContentHash,
    beforeSourceRefIdsHash: proposal.beforeSourceRefIdsHash,
    afterSourceRefIdsHash,
    canUndoAtCommit: true,
    createdAt,
  };
  const receiptDigest = await digestCanonical(receiptBody);
  const receiptId = `receipt_${receiptDigest.slice("sha256:".length)}`;
  const existingReceipt = await ctx.db
    .query("autonomyReceipts")
    .withIndex("by_receipt_id", (q) => q.eq("receiptId", receiptId))
    .unique();
  if (!existingReceipt) {
    await ctx.db.insert("autonomyReceipts", {
      ownerKey: identity.ownerKey,
      userId: identity.rawUserId,
      receiptId,
      receiptVersion: AUTONOMY_RECEIPT_VERSION,
      event: "commit",
      proposalId: proposal.proposalId,
      operationKey: proposal.operationKey,
      grantId:
        proposal.approvalMode === "delegated" ? proposal.grantId : undefined,
      approvalMode: proposal.approvalMode,
      operation: AUTONOMY_OPERATION,
      entityId: proposal.entityId,
      blockId: proposal.blockId,
      runId: proposal.runId,
      agentId: proposal.agentId,
      agentIdentityAssurance: "server_fixed",
      agentLabel: proposal.agentLabel,
      tasteBenchRunId: proposal.tasteBenchRunId,
      evidenceProjectionId: proposal.evidenceProjectionId,
      evidenceBlockType: proposal.evidenceBlockType,
      evidenceScratchpadRunId: proposal.evidenceScratchpadRunId,
      evidenceVersion: proposal.evidenceVersion,
      evidenceTier: proposal.evidenceTier,
      evidenceSourceRefIds: proposal.evidenceSourceRefIds,
      evidenceSourceSectionId: proposal.evidenceSourceSectionId,
      evidenceSourceCount: proposal.evidenceSourceCount,
      evidenceDerivedContentHash: proposal.evidenceDerivedContentHash,
      evidenceDigest: proposal.evidenceDigest,
      policyVersion: AUTONOMY_POLICY_VERSION,
      policyDigest,
      grantScopeDigest:
        proposal.approvalMode === "delegated" ? grant?.scopeDigest : undefined,
      runBindingDigest:
        proposal.approvalMode === "delegated"
          ? grant?.runBindingDigest
          : undefined,
      capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
      validationChecks,
      beforeRevision: proposal.baseRevision,
      afterRevision: block.revision,
      beforeContent: proposal.beforeContent,
      afterContent: block.content,
      beforeContentHash: proposal.beforeContentHash,
      afterContentHash,
      beforeSourceRefIds: proposal.beforeSourceRefIds,
      afterSourceRefIds,
      beforeSourceRefIdsHash: proposal.beforeSourceRefIdsHash,
      afterSourceRefIdsHash,
      canUndoAtCommit: true,
      createdAt,
    });
  } else if (
    existingReceipt.ownerKey !== identity.ownerKey ||
    existingReceipt.proposalId !== proposal.proposalId
  ) {
    throw new AutonomyPolicyError(
      "receipt_hash_collision",
      "Receipt digest already exists for different evidence.",
    );
  }

  await ctx.db.patch(proposal._id, {
    status: "committed",
    receiptId,
    committedAt: createdAt,
    updatedAt: createdAt,
  });
  if (proposal.tasteBenchRunId) {
    await recordBoundTasteBenchOperationalEvent(ctx, {
      userId: identity.rawUserId,
      runId: proposal.tasteBenchRunId,
      eventType: "operation_accepted",
      subjectRef: proposal.proposalId,
      detail: "A reviewed notebook proposal was accepted.",
      sourceKind: "autonomy_receipt",
      sourceReceiptRef: receiptId,
      sourceRunRef: proposal.proposalId,
    });
    await recordBoundTasteBenchOperationalEvent(ctx, {
      userId: identity.rawUserId,
      runId: proposal.tasteBenchRunId,
      eventType: "operation_changed",
      subjectRef: proposal.proposalId,
      detail: "The guarded notebook replacement committed successfully.",
      sourceKind: "autonomy_receipt",
      sourceReceiptRef: receiptId,
      sourceRunRef: proposal.proposalId,
    });
  }
  return {
    receiptId,
    afterRevision: block.revision,
    idempotent: !!existingReceipt,
  };
}

export type PreparedReceiptUndo =
  | { kind: "already_undone"; receiptId: string; undoReceiptId: string }
  | {
      kind: "ready";
      receiptId: string;
      blockId: Receipt["blockId"];
      restoreContent: Receipt["beforeContent"];
      restoreSourceRefIds: Receipt["beforeSourceRefIds"];
      expectedRevision: number;
      editedByAuthorKind: "user";
      editedByAuthorId: string;
      forkHistory: true;
    };

/**
 * Transactional undo seam for product/blocks.ts. Undo must use the same
 * guarded updater and then finalizeReceiptUndo before the mutation returns.
 */
export async function prepareReceiptUndo(
  ctx: MutationCtx,
  args: { receiptId: string },
): Promise<PreparedReceiptUndo> {
  const identity = await requireAuthenticatedProductIdentity(ctx);
  const receipt = await findOwnedReceiptByPublicId(
    ctx,
    identity.ownerKey,
    args.receiptId,
  );
  if (!receipt) {
    throw new AutonomyPolicyError(
      "receipt_not_found",
      "Commit receipt not found.",
    );
  }
  const [priorUndo, completion] = await Promise.all([
    ctx.db
      .query("autonomyReceipts")
      .withIndex("by_source_receipt", (q) =>
        q.eq("sourceReceiptId", receipt.receiptId),
      )
      .unique(),
    ctx.db
      .query("autonomyRemainderCompletions")
      .withIndex("by_owner_operation_key", (q) =>
        q
          .eq("ownerKey", identity.ownerKey)
          .eq("operationKey", receipt.operationKey),
      )
      .unique(),
  ]);
  if (priorUndo) {
    return {
      kind: "already_undone",
      receiptId: receipt.receiptId,
      undoReceiptId: priorUndo.receiptId,
    };
  }
  if (completion) {
    throw new AutonomyPolicyError(
      "remainder_completed_requires_composite_undo",
      "This accepted decoration has additional blocks; target-only undo is disabled until composite undo is available.",
    );
  }
  const block = await ctx.db.get(receipt.blockId);
  if (!block || block.ownerKey !== identity.ownerKey) {
    throw new AutonomyPolicyError(
      "block_not_found",
      "Undo target block not found.",
    );
  }
  const [currentContentHash, currentSourceRefIdsHash] = await Promise.all([
    digestCanonical(block.content),
    digestCanonical(analyzeSourceRefIds(block.sourceRefIds ?? []).canonical),
  ]);
  const checks = [
    ...evaluateUndoEligibility({
      receiptOwnerKey: receipt.ownerKey,
      requesterOwnerKey: identity.ownerKey,
      receiptEvent: receipt.event,
      canUndoAtCommit: receipt.canUndoAtCommit,
      receiptAfterRevision: receipt.afterRevision,
      currentRevision: block.revision,
      receiptAfterContentHash: receipt.afterContentHash,
      currentContentHash,
      receiptAfterSourceRefIdsHash: receipt.afterSourceRefIdsHash,
      currentSourceRefIdsHash,
      alreadyUndone: false,
    }),
    validationCheck("undo_block_is_live", block.deletedAt === undefined),
    validationCheck("undo_block_is_editable", block.accessMode === "edit"),
  ];
  assertChecksPassed(checks);

  return {
    kind: "ready",
    receiptId: receipt.receiptId,
    blockId: receipt.blockId,
    restoreContent: receipt.beforeContent,
    restoreSourceRefIds: receipt.beforeSourceRefIds,
    expectedRevision: receipt.afterRevision,
    editedByAuthorKind: "user",
    editedByAuthorId: String(identity.rawUserId),
    forkHistory: true,
  };
}

/** Final half of the same guarded undo mutation; see prepareReceiptUndo. */
export async function finalizeReceiptUndo(
  ctx: MutationCtx,
  args: { receiptId: string },
): Promise<{ receiptId: string; afterRevision: number; idempotent: boolean }> {
  const identity = await requireAuthenticatedProductIdentity(ctx);
  const source = await findOwnedReceiptByPublicId(
    ctx,
    identity.ownerKey,
    args.receiptId,
  );
  if (!source) {
    throw new AutonomyPolicyError(
      "receipt_not_found",
      "Commit receipt not found.",
    );
  }
  const priorUndo = await ctx.db
    .query("autonomyReceipts")
    .withIndex("by_source_receipt", (q) =>
      q.eq("sourceReceiptId", source.receiptId),
    )
    .unique();
  if (priorUndo) {
    return {
      receiptId: priorUndo.receiptId,
      afterRevision: priorUndo.afterRevision,
      idempotent: true,
    };
  }
  const block = await ctx.db.get(source.blockId);
  if (!block || block.ownerKey !== identity.ownerKey) {
    throw new AutonomyPolicyError(
      "block_not_found",
      "Undone notebook block not found.",
    );
  }
  const afterSourceRefIds = analyzeSourceRefIds(
    block.sourceRefIds ?? [],
  ).canonical;
  const [afterContentHash, afterSourceRefIdsHash] = await Promise.all([
    digestCanonical(block.content),
    digestCanonical(afterSourceRefIds),
  ]);
  const checks: AutonomyValidationCheck[] = [
    validationCheck(
      "undo_after_revision_incremented",
      block.revision === source.afterRevision + 1,
    ),
    validationCheck(
      "undo_restored_before_content",
      afterContentHash === source.beforeContentHash,
    ),
    validationCheck(
      "undo_restored_before_source_refs",
      afterSourceRefIdsHash === source.beforeSourceRefIdsHash,
    ),
  ];
  assertChecksPassed(checks);

  const createdAt = Date.now();
  const policyDigest = await digestCanonical({
    policyVersion: AUTONOMY_POLICY_VERSION,
    approvalMode: "explicit",
    action: "undo",
    ownerKey: identity.ownerKey,
    sourceReceiptId: source.receiptId,
    capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
  });
  const receiptBody = {
    receiptVersion: AUTONOMY_RECEIPT_VERSION,
    event: "undo" as const,
    sourceReceiptId: source.receiptId,
    ownerKey: identity.ownerKey,
    userId: String(identity.rawUserId),
    operationKey: source.operationKey,
    approvalMode: "explicit" as const,
    operation: AUTONOMY_OPERATION,
    entityId: String(source.entityId),
    blockId: String(source.blockId),
    runId: String(source.runId),
    agentId: `user:${String(identity.rawUserId)}`,
    agentIdentityAssurance: "authenticated_owner" as const,
    tasteBenchRunId: source.tasteBenchRunId
      ? String(source.tasteBenchRunId)
      : null,
    evidenceProjectionId: String(source.evidenceProjectionId),
    evidenceBlockType: source.evidenceBlockType,
    evidenceScratchpadRunId: source.evidenceScratchpadRunId,
    evidenceVersion: source.evidenceVersion,
    evidenceTier: source.evidenceTier,
    evidenceSourceRefIds: source.evidenceSourceRefIds,
    evidenceSourceSectionId: source.evidenceSourceSectionId ?? null,
    evidenceSourceCount: source.evidenceSourceCount ?? null,
    evidenceDerivedContentHash: source.evidenceDerivedContentHash,
    evidenceDigest: source.evidenceDigest,
    policyVersion: AUTONOMY_POLICY_VERSION,
    policyDigest,
    capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
    validationChecks: checks,
    beforeRevision: source.afterRevision,
    afterRevision: block.revision,
    beforeContentHash: source.afterContentHash,
    afterContentHash,
    beforeSourceRefIdsHash: source.afterSourceRefIdsHash,
    afterSourceRefIdsHash,
    canUndoAtCommit: false,
    createdAt,
  };
  const receiptDigest = await digestCanonical(receiptBody);
  const receiptId = `receipt_${receiptDigest.slice("sha256:".length)}`;
  await ctx.db.insert("autonomyReceipts", {
    ownerKey: identity.ownerKey,
    userId: identity.rawUserId,
    receiptId,
    receiptVersion: AUTONOMY_RECEIPT_VERSION,
    event: "undo",
    sourceReceiptId: source.receiptId,
    operationKey: source.operationKey,
    approvalMode: "explicit",
    operation: AUTONOMY_OPERATION,
    entityId: source.entityId,
    blockId: source.blockId,
    runId: source.runId,
    agentId: `user:${String(identity.rawUserId)}`,
    agentIdentityAssurance: "authenticated_owner",
    agentLabel: "Owner undo",
    tasteBenchRunId: source.tasteBenchRunId,
    evidenceProjectionId: source.evidenceProjectionId,
    evidenceBlockType: source.evidenceBlockType,
    evidenceScratchpadRunId: source.evidenceScratchpadRunId,
    evidenceVersion: source.evidenceVersion,
    evidenceTier: source.evidenceTier,
    evidenceSourceRefIds: source.evidenceSourceRefIds,
    evidenceSourceSectionId: source.evidenceSourceSectionId,
    evidenceSourceCount: source.evidenceSourceCount,
    evidenceDerivedContentHash: source.evidenceDerivedContentHash,
    evidenceDigest: source.evidenceDigest,
    policyVersion: AUTONOMY_POLICY_VERSION,
    policyDigest,
    capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
    validationChecks: checks,
    beforeRevision: source.afterRevision,
    afterRevision: block.revision,
    beforeContent: source.afterContent,
    afterContent: block.content,
    beforeContentHash: source.afterContentHash,
    afterContentHash,
    beforeSourceRefIds: source.afterSourceRefIds,
    afterSourceRefIds,
    beforeSourceRefIdsHash: source.afterSourceRefIdsHash,
    afterSourceRefIdsHash,
    canUndoAtCommit: false,
    createdAt,
  });
  if (source.tasteBenchRunId) {
    await recordBoundTasteBenchOperationalEvent(ctx, {
      userId: identity.rawUserId,
      runId: source.tasteBenchRunId,
      eventType: "operation_undone",
      subjectRef: source.receiptId,
      detail: "The guarded notebook replacement was undone.",
      sourceKind: "autonomy_receipt",
      sourceReceiptRef: receiptId,
      sourceRunRef: source.receiptId,
    });
  }
  return { receiptId, afterRevision: block.revision, idempotent: false };
}

/**
 * These validators are exported so the guarded product mutation can keep its
 * public RPC arguments aligned without widening the authority contract.
 */
export const proposalCommitApprovalModeValidator =
  autonomyApprovalModeValidator;
