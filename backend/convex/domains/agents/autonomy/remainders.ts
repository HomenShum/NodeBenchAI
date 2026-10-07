import { v } from "convex/values";

import { mutation } from "../../../_generated/server";
import {
  applyGuardedBlockBatchInsert,
  type GuardedBlockInsertDraft,
} from "../../product/blocks";
import { requireAuthenticatedProductIdentity } from "../../product/helpers";
import {
  productBlockChipValidator,
  productBlockKindValidator,
} from "../../product/schema";
import {
  normalizeOperationKey,
  sameOrderedStrings,
} from "./evidence";
import { digestCanonical } from "./hash";
import {
  AUTONOMY_LIMITS,
  AutonomyPolicyError,
} from "./policy";

const remainderDraftValidator = v.object({
  kind: productBlockKindValidator,
  content: v.array(productBlockChipValidator),
  sourceRefIds: v.optional(v.array(v.string())),
  attributes: v.optional(v.any()),
});

function exactCompletionKey(value: string, operationKey: string): string {
  const expected = `${operationKey}:remainder:v1`;
  if (value !== expected || value.length > AUTONOMY_LIMITS.maxOperationKeyLength) {
    throw new AutonomyPolicyError(
      "completion_key_invalid",
      "completionKey must be the canonical operationKey remainder key.",
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactOptionalString(
  value: unknown,
  expected: string | undefined,
): boolean {
  return value === expected;
}

function validateDraftsAgainstReceipt(
  drafts: readonly GuardedBlockInsertDraft[],
  receipt: {
    evidenceBlockType: string;
    evidenceScratchpadRunId: string;
    evidenceTier: "verified" | "corroborated";
    evidenceSourceRefIds: string[];
    evidenceSourceSectionId?: string;
    evidenceSourceCount?: number;
  },
): void {
  for (const draft of drafts) {
    if (
      draft.kind !== "generated_marker" &&
      draft.kind !== "heading_3" &&
      draft.kind !== "bullet" &&
      draft.kind !== "text"
    ) {
      throw new AutonomyPolicyError(
        "remainder_kind_not_allowed",
        "Remainder drafts may only materialize the accepted decoration block kinds.",
      );
    }
    if (!draft.content.some((chip) => chip.value.trim().length > 0)) {
      throw new AutonomyPolicyError(
        "remainder_content_empty",
        "Remainder drafts must contain visible content.",
      );
    }
    const refs = draft.sourceRefIds;
    if (
      refs !== undefined &&
      !sameOrderedStrings(refs, receipt.evidenceSourceRefIds)
    ) {
      throw new AutonomyPolicyError(
        "remainder_source_refs_mismatch",
        "Draft source refs must exactly match the receipt evidence order.",
      );
    }
    if (
      (draft.kind === "text" || draft.kind === "bullet") &&
      !refs
    ) {
      throw new AutonomyPolicyError(
        "remainder_source_refs_required",
        "Materialized body drafts require the receipt's proven source refs.",
      );
    }

    const attributes = asRecord(draft.attributes);
    const accepted = asRecord(attributes?.acceptedFromLive);
    if (!attributes || Object.keys(attributes).length !== 1 || !accepted) {
      throw new AutonomyPolicyError(
        "remainder_attributes_invalid",
        "Each remainder draft must carry only acceptedFromLive provenance.",
      );
    }
    const allowedKeys = new Set([
      "blockType",
      "sourceScratchpadRunId",
      "sourceSectionId",
      "sourceRefIds",
      "overallTier",
      "sourceCount",
      "frozenAt",
    ]);
    if (Object.keys(accepted).some((key) => !allowedKeys.has(key))) {
      throw new AutonomyPolicyError(
        "remainder_attributes_invalid",
        "acceptedFromLive contains an unsupported field.",
      );
    }
    const attributeRefs = Array.isArray(accepted.sourceRefIds)
      ? accepted.sourceRefIds
      : null;
    const frozenAt = accepted.frozenAt;
    if (
      accepted.blockType !== receipt.evidenceBlockType ||
      accepted.sourceScratchpadRunId !== receipt.evidenceScratchpadRunId ||
      accepted.overallTier !== receipt.evidenceTier ||
      !attributeRefs ||
      !attributeRefs.every((value): value is string => typeof value === "string") ||
      !sameOrderedStrings(attributeRefs, receipt.evidenceSourceRefIds) ||
      !exactOptionalString(
        accepted.sourceSectionId,
        receipt.evidenceSourceSectionId,
      ) ||
      accepted.sourceCount !== receipt.evidenceSourceCount ||
      typeof frozenAt !== "number" ||
      !Number.isSafeInteger(frozenAt) ||
      frozenAt <= 0 ||
      frozenAt > Date.now() + 5 * 60_000
    ) {
      throw new AutonomyPolicyError(
        "remainder_attributes_mismatch",
        "Draft provenance must exactly match the committed receipt evidence.",
      );
    }
  }
}

/**
 * Exactly-once owner completion for the explicit blocks surrounding a
 * committed replacement. Receipt verification, inserts, and durable
 * completion evidence share one Convex transaction.
 */
export const commitProposalRemainder = mutation({
  args: {
    proposalId: v.string(),
    receiptId: v.string(),
    completionKey: v.string(),
    beforeDrafts: v.array(remainderDraftValidator),
    afterDrafts: v.array(remainderDraftValidator),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const proposal = await ctx.db
      .query("autonomyProposals")
      .withIndex("by_proposal_id", (q) => q.eq("proposalId", args.proposalId))
      .unique();
    if (!proposal || proposal.ownerKey !== identity.ownerKey) {
      throw new AutonomyPolicyError("proposal_not_found", "Proposal not found.");
    }
    const operationKey = normalizeOperationKey(proposal.operationKey);
    const completionKey = exactCompletionKey(args.completionKey, operationKey);
    const drafts = [...args.beforeDrafts, ...args.afterDrafts];
    if (drafts.length > AUTONOMY_LIMITS.maxRemainderDrafts) {
      throw new AutonomyPolicyError(
        "remainder_draft_limit_exceeded",
        `At most ${AUTONOMY_LIMITS.maxRemainderDrafts} remainder drafts are allowed.`,
      );
    }
    const draftBytes = new TextEncoder().encode(JSON.stringify(drafts)).length;
    if (draftBytes > AUTONOMY_LIMITS.maxRemainderTotalBytes) {
      throw new AutonomyPolicyError(
        "remainder_bytes_exceeded",
        "Remainder plan exceeds the bounded transaction payload.",
      );
    }
    const draftsDigest = await digestCanonical({
      operationKey,
      proposalId: args.proposalId,
      receiptId: args.receiptId,
      beforeDrafts: args.beforeDrafts,
      afterDrafts: args.afterDrafts,
    });

    const [existingByKey, existingByOperation] = await Promise.all([
      ctx.db
        .query("autonomyRemainderCompletions")
        .withIndex("by_owner_completion_key", (q) =>
          q
            .eq("ownerKey", identity.ownerKey)
            .eq("completionKey", completionKey),
        )
        .unique(),
      ctx.db
        .query("autonomyRemainderCompletions")
        .withIndex("by_owner_operation_key", (q) =>
          q.eq("ownerKey", identity.ownerKey).eq("operationKey", operationKey),
        )
        .unique(),
    ]);
    const existing = existingByKey ?? existingByOperation;
    if (existing) {
      if (
        existing.completionKey !== completionKey ||
        existing.proposalId !== args.proposalId ||
        existing.receiptId !== args.receiptId ||
        existing.draftsDigest !== draftsDigest
      ) {
        throw new AutonomyPolicyError(
          "remainder_idempotency_conflict",
          "The remainder operation is already completed with a different plan.",
        );
      }
      return {
        completionKey,
        insertedBlockIds: existing.insertedBlockIds,
        lastBlockId: existing.lastBlockId,
        idempotent: true,
      };
    }

    const receipt = await ctx.db
      .query("autonomyReceipts")
      .withIndex("by_receipt_id", (q) => q.eq("receiptId", args.receiptId))
      .unique();
    if (
      !receipt ||
      receipt.ownerKey !== identity.ownerKey ||
      receipt.event !== "commit" ||
      receipt.proposalId !== proposal.proposalId ||
      receipt.operationKey !== operationKey ||
      proposal.status !== "committed" ||
      proposal.receiptId !== receipt.receiptId ||
      receipt.entityId !== proposal.entityId ||
      receipt.blockId !== proposal.blockId ||
      receipt.runId !== proposal.runId
    ) {
      throw new AutonomyPolicyError(
        "remainder_receipt_mismatch",
        "Remainder requires the proposal's exact committed receipt.",
      );
    }
    const [target, priorUndo] = await Promise.all([
      ctx.db.get(receipt.blockId),
      ctx.db
        .query("autonomyReceipts")
        .withIndex("by_source_receipt", (q) =>
          q.eq("sourceReceiptId", receipt.receiptId),
        )
        .unique(),
    ]);
    if (
      !target ||
      target.ownerKey !== identity.ownerKey ||
      target.entityId !== receipt.entityId ||
      target.deletedAt !== undefined ||
      target.accessMode !== "edit" ||
      priorUndo
    ) {
      throw new AutonomyPolicyError(
        "remainder_target_unavailable",
        "The committed target is no longer a live undo-safe anchor.",
      );
    }
    const [targetContentHash, targetSourceRefIdsHash] = await Promise.all([
      digestCanonical(target.content),
      digestCanonical(target.sourceRefIds ?? []),
    ]);
    if (
      target.revision !== receipt.afterRevision ||
      targetContentHash !== receipt.afterContentHash ||
      targetSourceRefIdsHash !== receipt.afterSourceRefIdsHash
    ) {
      throw new AutonomyPolicyError(
        "remainder_target_drifted",
        "The committed target changed before the explicit remainder completed.",
      );
    }

    validateDraftsAgainstReceipt(drafts, receipt);
    const inserted = await applyGuardedBlockBatchInsert(ctx, {
      entityId: receipt.entityId,
      targetBlockId: receipt.blockId,
      expectedTargetRevision: receipt.afterRevision,
      beforeDrafts: args.beforeDrafts,
      afterDrafts: args.afterDrafts,
    });
    const createdAt = Date.now();
    await ctx.db.insert("autonomyRemainderCompletions", {
      ownerKey: identity.ownerKey,
      userId: identity.rawUserId,
      completionKey,
      operationKey,
      proposalId: proposal.proposalId,
      receiptId: receipt.receiptId,
      entityId: receipt.entityId,
      targetBlockId: receipt.blockId,
      runId: receipt.runId,
      targetAfterRevision: receipt.afterRevision,
      targetAfterContentHash: receipt.afterContentHash,
      targetAfterSourceRefIdsHash: receipt.afterSourceRefIdsHash,
      draftsDigest,
      beforeDraftCount: args.beforeDrafts.length,
      afterDraftCount: args.afterDrafts.length,
      insertedBlockIds: inserted.insertedBlockIds,
      lastBlockId: inserted.lastBlockId,
      createdAt,
    });
    return {
      completionKey,
      insertedBlockIds: inserted.insertedBlockIds,
      lastBlockId: inserted.lastBlockId,
      idempotent: false,
    };
  },
});
