import { v } from "convex/values";

import { mutation } from "../../../_generated/server";
import { applyGuardedBlockUpdate } from "../../product/blocks";
import {
  finalizeProposalCommit,
  finalizeReceiptUndo,
  prepareProposalCommit,
  prepareReceiptUndo,
  proposalCommitApprovalModeValidator,
} from "./proposals";

/**
 * The only public delegated-commit path in v1.
 *
 * Grant revalidation and operation accounting happen in
 * prepareProposalCommit; the existing product-block guard performs the write;
 * finalization verifies the resulting revision/content and appends the
 * immutable receipt. Convex executes the entire handler transactionally, so a
 * failure at any point leaves the grant, proposal, block, and receipt
 * unchanged.
 */
export const commitBlockProposal = mutation({
  args: {
    proposalId: v.string(),
    approvalMode: proposalCommitApprovalModeValidator,
  },
  handler: async (ctx, args) => {
    const prepared = await prepareProposalCommit(ctx, args);
    if (prepared.kind === "already_committed") {
      return {
        proposalId: prepared.proposalId,
        receiptId: prepared.receiptId,
        idempotent: true,
      };
    }
    if (prepared.kind === "delegation_denied") {
      return {
        proposalId: prepared.proposalId,
        delegationDenied: true,
        reasonCode: prepared.reasonCode,
        needsApproval: prepared.needsApproval,
      };
    }
    if (prepared.kind === "validation_failed") {
      return {
        proposalId: prepared.proposalId,
        validationFailed: true,
        reasonCode: prepared.reasonCode,
        needsNewProposal: prepared.needsNewProposal,
      };
    }

    const write = await applyGuardedBlockUpdate(ctx, {
      blockId: prepared.blockId,
      content: prepared.proposedContent,
      sourceRefIds: prepared.proposedSourceRefIds,
      expectedRevision: prepared.expectedRevision,
      editedByAuthorKind: prepared.editedByAuthorKind,
      editedByAuthorId: prepared.editedByAuthorId,
      forkHistory: prepared.forkHistory,
    });
    const receipt = await finalizeProposalCommit(ctx, {
      proposalId: prepared.proposalId,
    });
    return {
      proposalId: prepared.proposalId,
      blockId: write.blockId,
      receiptId: receipt.receiptId,
      beforeRevision: write.beforeRevision,
      afterRevision: receipt.afterRevision,
      idempotent: receipt.idempotent,
    };
  },
});

/** Owner-only, OCC-safe undo. Undo restores content as a new revision. */
export const undoBlockReceipt = mutation({
  args: { receiptId: v.string() },
  handler: async (ctx, args) => {
    const prepared = await prepareReceiptUndo(ctx, args);
    if (prepared.kind === "already_undone") {
      return {
        sourceReceiptId: prepared.receiptId,
        receiptId: prepared.undoReceiptId,
        idempotent: true,
      };
    }

    const write = await applyGuardedBlockUpdate(ctx, {
      blockId: prepared.blockId,
      content: prepared.restoreContent,
      sourceRefIds: prepared.restoreSourceRefIds,
      expectedRevision: prepared.expectedRevision,
      editedByAuthorKind: prepared.editedByAuthorKind,
      editedByAuthorId: prepared.editedByAuthorId,
      forkHistory: prepared.forkHistory,
    });
    const receipt = await finalizeReceiptUndo(ctx, {
      receiptId: prepared.receiptId,
    });
    return {
      sourceReceiptId: prepared.receiptId,
      blockId: write.blockId,
      receiptId: receipt.receiptId,
      beforeRevision: write.beforeRevision,
      afterRevision: receipt.afterRevision,
      idempotent: receipt.idempotent,
    };
  },
});
