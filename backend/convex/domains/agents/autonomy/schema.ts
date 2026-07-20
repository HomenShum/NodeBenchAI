import { defineTable } from "convex/server";
import { v } from "convex/values";

import { productBlockChipValidator } from "../../product/schema";

export const AUTONOMY_POLICY_VERSION = "notebook-authority.v1" as const;
export const AUTONOMY_RECEIPT_VERSION = "autonomy-receipt.v1" as const;

export const autonomyOperationValidator = v.literal("notebook.update_block");

export const autonomyGrantModeValidator = v.union(
  v.literal("run"),
  v.literal("workspace"),
);

export const autonomyGrantStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("revoked"),
  v.literal("expired"),
  v.literal("consumed"),
);

export const autonomyRunBindingValidator = v.union(
  v.literal("not_applicable"),
  v.literal("first_operation"),
  v.literal("bound"),
);

export const autonomyCapabilityEnvelopeValidator = v.object({
  networkEgress: v.literal("deny"),
  fileAccess: v.literal("deny"),
  spendLimitUsd: v.literal(0),
});

export const autonomyApprovalModeValidator = v.union(
  v.literal("explicit"),
  v.literal("delegated"),
);

export const autonomyDiligenceBlockTypeValidator = v.union(
  v.literal("projection"),
  v.literal("founder"),
  v.literal("product"),
  v.literal("funding"),
  v.literal("news"),
  v.literal("hiring"),
  v.literal("patent"),
  v.literal("publicOpinion"),
  v.literal("competitor"),
  v.literal("regulatory"),
  v.literal("financial"),
);

export const autonomyEvidenceTierValidator = v.union(
  v.literal("verified"),
  v.literal("corroborated"),
  v.literal("single-source"),
  v.literal("unverified"),
);

export const autonomyProposalStatusValidator = v.union(
  v.literal("pending"),
  v.literal("blocked"),
  v.literal("committing"),
  v.literal("committed"),
  v.literal("rejected"),
);

export const autonomyValidationCheckValidator = v.object({
  code: v.string(),
  passed: v.boolean(),
  detail: v.optional(v.string()),
});

/**
 * A user-created, revocable delegation. There is deliberately no
 * `review_every_change` row: absence of a grant is the review-first state.
 *
 * V1 is capability-honest. The operation validator has exactly one member,
 * `notebook.update_block`; widening it requires a policy and schema revision.
 */
export const autonomyGrants = defineTable({
  ownerKey: v.string(),
  userId: v.id("users"),
  grantId: v.string(),
  creationKey: v.string(),

  mode: autonomyGrantModeValidator,
  operation: autonomyOperationValidator,
  entityId: v.optional(v.id("productEntities")),
  runId: v.optional(v.id("agentScratchpads")),
  runBinding: autonomyRunBindingValidator,
  runBoundAt: v.optional(v.number()),
  runBindingDigest: v.optional(v.string()),
  blockIds: v.optional(v.array(v.id("productBlocks"))),

  agentId: v.string(),
  // V1 is deliberately bound to the server-selected notebook coordinator.
  agentIdentityAssurance: v.literal("server_fixed"),
  agentLabel: v.optional(v.string()),
  runtime: v.optional(v.string()),

  capabilityEnvelope: autonomyCapabilityEnvelopeValidator,
  restrictedOperations: v.array(v.string()),
  maxOperations: v.number(),
  usedOperations: v.number(),
  expiresAt: v.number(),
  status: autonomyGrantStatusValidator,

  policyVersion: v.literal(AUTONOMY_POLICY_VERSION),
  policyDigest: v.string(),
  scopeDigest: v.string(),

  pausedAt: v.optional(v.number()),
  resumedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  revokeReason: v.optional(v.string()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_grant_id", ["grantId"])
  .index("by_owner_creation_key", ["ownerKey", "creationKey"])
  .index("by_owner_status", ["ownerKey", "status"])
  .index("by_owner_entity", ["ownerKey", "entityId"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

/**
 * Every requested mutation is first represented as a proposal. Delegated
 * authority changes who may approve a valid proposal; it never removes the
 * proposal or validation boundary.
 */
export const autonomyProposals = defineTable({
  ownerKey: v.string(),
  userId: v.id("users"),
  proposalId: v.string(),
  idempotencyKey: v.string(),
  /** Stable decoration identity used only for exactly-once correlation. */
  operationKey: v.string(),

  operation: autonomyOperationValidator,
  entityId: v.id("productEntities"),
  blockId: v.id("productBlocks"),
  runId: v.id("agentScratchpads"),
  agentId: v.string(),
  agentIdentityAssurance: v.literal("server_fixed"),
  agentLabel: v.optional(v.string()),
  grantId: v.optional(v.string()),
  /** Evaluation run active when this proposal was first persisted. */
  tasteBenchRunId: v.optional(v.id("tasteBenchRuns")),

  evidenceProjectionId: v.optional(v.id("diligenceProjections")),
  evidenceBlockType: autonomyDiligenceBlockTypeValidator,
  evidenceScratchpadRunId: v.string(),
  evidenceVersion: v.number(),
  evidenceTier: v.optional(autonomyEvidenceTierValidator),
  evidenceSourceRefIds: v.array(v.string()),
  evidenceSourceSectionId: v.optional(v.string()),
  evidenceSourceCount: v.optional(v.number()),
  evidenceDerivedContentHash: v.optional(v.string()),
  evidenceDigest: v.optional(v.string()),

  approvalMode: autonomyApprovalModeValidator,
  status: autonomyProposalStatusValidator,
  baseRevision: v.number(),
  beforeContent: v.array(productBlockChipValidator),
  proposedContent: v.array(productBlockChipValidator),
  proposedContentOmitted: v.optional(v.boolean()),
  beforeContentHash: v.string(),
  proposedContentHash: v.string(),
  beforeSourceRefIds: v.array(v.string()),
  proposedSourceRefIds: v.array(v.string()),
  sourceRefInputMode: v.union(v.literal("preserve"), v.literal("replace")),
  proposedSourceRefIdsOmitted: v.optional(v.boolean()),
  beforeSourceRefIdsHash: v.string(),
  proposedSourceRefIdsHash: v.string(),
  validationChecks: v.array(autonomyValidationCheckValidator),

  receiptId: v.optional(v.string()),
  ownerApprovedAt: v.optional(v.number()),
  ownerApprovalAssurance: v.optional(v.literal("authenticated_owner_action")),
  delegationFailureCode: v.optional(v.string()),
  blockedAt: v.optional(v.number()),
  blockedReason: v.optional(v.string()),
  rejectionReason: v.optional(v.string()),
  rejectedAt: v.optional(v.number()),
  committedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_proposal_id", ["proposalId"])
  .index("by_owner_idempotency", ["ownerKey", "idempotencyKey"])
  .index("by_owner_operation_key", ["ownerKey", "operationKey"])
  .index("by_owner_created", ["ownerKey", "createdAt"])
  .index("by_owner_entity_created", ["ownerKey", "entityId", "createdAt"])
  .index("by_owner_status_created", ["ownerKey", "status", "createdAt"])
  .index("by_owner_block_created", ["ownerKey", "blockId", "createdAt"]);

/**
 * Append-only, content-addressed commit/undo evidence. No mutation in the
 * autonomy module patches or deletes these rows. Undo is represented by a new
 * receipt and a new block revision, never by rewriting history.
 */
export const autonomyReceipts = defineTable({
  ownerKey: v.string(),
  userId: v.id("users"),
  receiptId: v.string(),
  receiptVersion: v.literal(AUTONOMY_RECEIPT_VERSION),
  event: v.union(v.literal("commit"), v.literal("undo")),
  sourceReceiptId: v.optional(v.string()),

  proposalId: v.optional(v.string()),
  operationKey: v.string(),
  grantId: v.optional(v.string()),
  approvalMode: autonomyApprovalModeValidator,
  operation: autonomyOperationValidator,
  entityId: v.id("productEntities"),
  blockId: v.id("productBlocks"),
  runId: v.id("agentScratchpads"),
  agentId: v.string(),
  agentIdentityAssurance: v.union(
    v.literal("server_fixed"),
    v.literal("authenticated_owner"),
  ),
  agentLabel: v.optional(v.string()),
  /** Inherited from the proposal; never selected from ambient later state. */
  tasteBenchRunId: v.optional(v.id("tasteBenchRuns")),

  evidenceProjectionId: v.id("diligenceProjections"),
  evidenceBlockType: autonomyDiligenceBlockTypeValidator,
  evidenceScratchpadRunId: v.string(),
  evidenceVersion: v.number(),
  evidenceTier: v.union(v.literal("verified"), v.literal("corroborated")),
  evidenceSourceRefIds: v.array(v.string()),
  evidenceSourceSectionId: v.optional(v.string()),
  evidenceSourceCount: v.optional(v.number()),
  evidenceDerivedContentHash: v.string(),
  evidenceDigest: v.string(),

  policyVersion: v.literal(AUTONOMY_POLICY_VERSION),
  policyDigest: v.string(),
  grantScopeDigest: v.optional(v.string()),
  runBindingDigest: v.optional(v.string()),
  capabilityEnvelope: autonomyCapabilityEnvelopeValidator,
  validationChecks: v.array(autonomyValidationCheckValidator),

  beforeRevision: v.number(),
  afterRevision: v.number(),
  beforeContent: v.array(productBlockChipValidator),
  afterContent: v.array(productBlockChipValidator),
  beforeContentHash: v.string(),
  afterContentHash: v.string(),
  beforeSourceRefIds: v.array(v.string()),
  afterSourceRefIds: v.array(v.string()),
  beforeSourceRefIdsHash: v.string(),
  afterSourceRefIdsHash: v.string(),
  canUndoAtCommit: v.boolean(),
  createdAt: v.number(),
})
  .index("by_receipt_id", ["receiptId"])
  .index("by_source_receipt", ["sourceReceiptId"])
  .index("by_owner_created", ["ownerKey", "createdAt"])
  .index("by_owner_entity_created", ["ownerKey", "entityId", "createdAt"])
  .index("by_owner_block_created", ["ownerKey", "blockId", "createdAt"]);

/**
 * Exactly-once completion record for the explicit blocks surrounding a
 * committed replacement. The row and all inserted block ids are written in
 * one transaction; retries return this evidence instead of duplicating rows.
 */
export const autonomyRemainderCompletions = defineTable({
  ownerKey: v.string(),
  userId: v.id("users"),
  completionKey: v.string(),
  operationKey: v.string(),
  proposalId: v.string(),
  receiptId: v.string(),
  entityId: v.id("productEntities"),
  targetBlockId: v.id("productBlocks"),
  runId: v.id("agentScratchpads"),
  targetAfterRevision: v.number(),
  targetAfterContentHash: v.string(),
  targetAfterSourceRefIdsHash: v.string(),
  draftsDigest: v.string(),
  beforeDraftCount: v.number(),
  afterDraftCount: v.number(),
  insertedBlockIds: v.array(v.id("productBlocks")),
  lastBlockId: v.id("productBlocks"),
  createdAt: v.number(),
})
  .index("by_owner_completion_key", ["ownerKey", "completionKey"])
  .index("by_owner_operation_key", ["ownerKey", "operationKey"])
  .index("by_owner_entity_created", ["ownerKey", "entityId", "createdAt"]);
