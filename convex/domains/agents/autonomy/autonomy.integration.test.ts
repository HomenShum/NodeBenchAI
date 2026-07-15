/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api } from "../../../_generated/api";
import schema from "../../../schema";
import {
  buildDecorationOperationKey,
  type AutonomyDiligenceBlockType,
} from "./evidence";

const DIR_SEGMENTS = ["domains", "agents", "autonomy"];
function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}
const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../**/*.{ts,js}")).map(
    ([key, loader]) => [rerootGlobKey(key), loader],
  ),
);

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const grantsApi = (api as any).domains.agents.autonomy.grants;
const proposalsApi = (api as any).domains.agents.autonomy.proposals;
const commitsApi = (api as any).domains.agents.autonomy.commits;
const remaindersApi = (api as any).domains.agents.autonomy.remainders;
const blocksApi = (api as any).domains.product.blocks;

const text = (value: string) => [{ type: "text" as const, value }];
const errBlob = (error: any) =>
  `${error?.message ?? String(error)} ${JSON.stringify(error?.data ?? null)}`;

type Seed = {
  userId: any;
  ownerKey: string;
  entityId: any;
  entitySlug: string;
  blockId: any;
  scratchpadId: any;
  scratchpadBaseRunId: string;
  scratchpadRunId: string;
  projectionId: any;
  blockType: AutonomyDiligenceBlockType;
  version: number;
  body: string;
  sourceRefIds: string[];
  operationKey: string;
};

async function seedNotebook(
  t: any,
  label: string,
  options: {
    blockType?: AutonomyDiligenceBlockType;
    version?: number;
    body?: string;
    sourceRefIds?: string[];
    tier?: "verified" | "corroborated" | "single-source" | "unverified";
  } = {},
): Promise<Seed> {
  const now = Date.now();
  const blockType = options.blockType ?? "product";
  const version = options.version ?? 1;
  const body = options.body ?? `Trusted ${label} body paragraph.`;
  const sourceRefIds = options.sourceRefIds ?? ["src-b", "src-a"];
  const seeded = await t.run(async (ctx: any) => {
    const userId = await ctx.db.insert("users", {
      email: `${label}@example.com`,
    });
    const ownerKey = `user:${String(userId)}`;
    const entitySlug = `entity-${label}`;
    const entityId = await ctx.db.insert("productEntities", {
      ownerKey,
      slug: entitySlug,
      name: `Entity ${label}`,
      entityType: "company",
      summary: "Seeded autonomy integration entity",
      latestRevision: 1,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const scratchpadBaseRunId = `scratchpad:${entitySlug}:${label}`;
    const scratchpadRunId = `${scratchpadBaseRunId}:section-${label}`;
    const scratchpadId = await ctx.db.insert("agentScratchpads", {
      agentThreadId: scratchpadBaseRunId,
      userId,
      scratchpad: {},
      entitySlug,
      ownerKey,
      entityId,
      status: "merged",
      createdAt: now,
      updatedAt: now,
    });
    const blockId = await ctx.db.insert("productBlocks", {
      ownerKey,
      entityId,
      kind: "text",
      authorKind: "user",
      authorId: String(userId),
      content: text(""),
      positionInt: now,
      positionFrac: "a0",
      accessMode: "edit",
      isPublic: false,
      revision: 1,
      searchableText: "",
      createdAt: now,
      updatedAt: now,
    });
    const projectionId = await ctx.db.insert("diligenceProjections", {
      ownerKey,
      entityId,
      producerScratchpadId: scratchpadId,
      producerAssurance: "internal_structuring_v1",
      entitySlug,
      blockType,
      scratchpadRunId,
      version,
      overallTier: options.tier ?? "verified",
      headerText: `Header ${label}`,
      bodyProse: body,
      sourceRefIds,
      sourceCount: sourceRefIds.length,
      sourceSectionId: `section-${label}`,
      payload: { scratchpadBaseRunId },
      updatedAt: now,
    });
    return {
      userId,
      ownerKey,
      entityId,
      entitySlug,
      blockId,
      scratchpadId,
      scratchpadBaseRunId,
      scratchpadRunId,
      projectionId,
    };
  });
  return {
    ...seeded,
    blockType,
    version,
    body,
    sourceRefIds,
    operationKey: buildDecorationOperationKey({
      entityId: seeded.entityId,
      scratchpadId: seeded.scratchpadId,
      scratchpadRunId: seeded.scratchpadRunId,
      blockType,
      decorationVersion: version,
    }),
  };
}

async function seedAdditionalTarget(
  t: any,
  seed: Seed,
  blockType: AutonomyDiligenceBlockType,
  body: string,
): Promise<Seed> {
  const now = Date.now();
  const blockId = await t.run(async (ctx: any) => {
    const nextBlockId = await ctx.db.insert("productBlocks", {
      ownerKey: seed.ownerKey,
      entityId: seed.entityId,
      kind: "text",
      authorKind: "user",
      authorId: String(seed.userId),
      content: text(""),
      positionInt: now + 1,
      positionFrac: "a0",
      accessMode: "edit",
      isPublic: false,
      revision: 1,
      searchableText: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("diligenceProjections", {
      ownerKey: seed.ownerKey,
      entityId: seed.entityId,
      producerScratchpadId: seed.scratchpadId,
      producerAssurance: "internal_structuring_v1",
      entitySlug: seed.entitySlug,
      blockType,
      scratchpadRunId: `${seed.scratchpadBaseRunId}:section-additional`,
      version: 1,
      overallTier: "corroborated",
      headerText: "Additional header",
      bodyProse: body,
      sourceRefIds: seed.sourceRefIds,
      sourceCount: seed.sourceRefIds.length,
      sourceSectionId: "section-additional",
      payload: { scratchpadBaseRunId: seed.scratchpadBaseRunId },
      updatedAt: now,
    });
    return nextBlockId;
  });
  return {
    ...seed,
    blockId,
    blockType,
    version: 1,
    body,
    scratchpadRunId: `${seed.scratchpadBaseRunId}:section-additional`,
    operationKey: buildDecorationOperationKey({
      entityId: seed.entityId,
      scratchpadId: seed.scratchpadId,
      scratchpadRunId: `${seed.scratchpadBaseRunId}:section-additional`,
      blockType,
      decorationVersion: 1,
    }),
  };
}

function authed(t: any, seed: Pick<Seed, "userId">) {
  return t.withIdentity({ subject: String(seed.userId) });
}

function proposalArgs(
  seed: Seed,
  overrides: Record<string, unknown> = {},
) {
  return {
    idempotencyKey: `proposal:${seed.operationKey}`,
    operationKey: seed.operationKey,
    blockId: seed.blockId,
    proposedContent: text(seed.body.split(/\n\s*\n/)[0]!.trim()),
    proposedSourceRefIds: seed.sourceRefIds,
    baseRevision: 1,
    runId: seed.scratchpadId,
    decorationBlockType: seed.blockType,
    decorationScratchpadRunId: seed.scratchpadRunId,
    decorationVersion: seed.version,
    ...overrides,
  };
}

async function createRunGrant(t: any, seed: Seed, maxOperations = 2) {
  return await authed(t, seed).mutation(grantsApi.createGrant, {
    creationKey: `grant:${seed.operationKey}:${maxOperations}`,
    mode: "run",
    entityId: seed.entityId,
    runId: seed.scratchpadId,
    maxOperations,
    expiresAt: Date.now() + 120_000,
  });
}

async function rawOwnerState(t: any, seed: Seed) {
  return await t.run(async (ctx: any) => ({
    block: await ctx.db.get(seed.blockId),
    proposals: await ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_created", (q: any) => q.eq("ownerKey", seed.ownerKey))
      .collect(),
    receipts: await ctx.db
      .query("autonomyReceipts")
      .withIndex("by_owner_created", (q: any) => q.eq("ownerKey", seed.ownerKey))
      .collect(),
    grants: await ctx.db
      .query("autonomyGrants")
      .withIndex("by_owner_created", (q: any) => q.eq("ownerKey", seed.ownerKey))
      .collect(),
    completions: await ctx.db
      .query("autonomyRemainderCompletions")
      .withIndex("by_owner_entity_created", (q: any) =>
        q.eq("ownerKey", seed.ownerKey).eq("entityId", seed.entityId),
      )
      .collect(),
  }));
}

describe.skipIf(!convexTestAvailable)(
  "notebook authority transactional contract",
  () => {
    it("commits one exact run-bound edit, returns post-commit retries, consumes the cap, and appends immutable undo evidence", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "happy");
      const grant = await createRunGrant(t, seed, 1);
      const caller = authed(t, seed);
      const args = proposalArgs(seed, { grantId: grant.grantId });

      const submitted = await caller.mutation(proposalsApi.submitBlockProposal, args);
      expect(submitted).toMatchObject({
        status: "pending",
        approvalMode: "delegated",
        needsGuardedCommit: true,
      });
      const committed = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: submitted.proposalId,
        approvalMode: "delegated",
      });
      expect(committed.afterRevision).toBe(2);

      const afterCommit = await rawOwnerState(t, seed);
      expect(afterCommit.block.content).toEqual(text(seed.body));
      expect(afterCommit.block.sourceRefIds).toEqual(["src-b", "src-a"]);
      expect(afterCommit.grants[0]).toMatchObject({
        runId: seed.scratchpadId,
        runBinding: "bound",
        usedOperations: 1,
        maxOperations: 1,
        status: "consumed",
      });
      expect(afterCommit.receipts).toHaveLength(1);
      const immutableReceipt = structuredClone(afterCommit.receipts[0]);

      const retry = await caller.mutation(proposalsApi.submitBlockProposal, args);
      expect(retry).toMatchObject({
        proposalId: submitted.proposalId,
        receiptId: committed.receiptId,
        status: "committed",
        idempotent: true,
      });
      const operationState = await caller.query(proposalsApi.getOperationState, {
        operationKey: seed.operationKey,
      });
      expect(operationState).toMatchObject({
        status: "committed",
        receiptId: committed.receiptId,
        grantId: grant.grantId,
        canUndoNow: true,
      });

      const undo = await caller.mutation(commitsApi.undoBlockReceipt, {
        receiptId: committed.receiptId,
      });
      expect(undo.afterRevision).toBe(3);
      const afterUndo = await rawOwnerState(t, seed);
      expect(afterUndo.block.content).toEqual(text(""));
      expect(afterUndo.block.sourceRefIds).toEqual([]);
      expect(afterUndo.receipts).toHaveLength(2);
      expect(afterUndo.receipts.find((row: any) => row.receiptId === committed.receiptId)).toEqual(
        immutableReceipt,
      );
      const repeatedUndo = await caller.mutation(commitsApi.undoBlockReceipt, {
        receiptId: committed.receiptId,
      });
      expect(repeatedUndo).toMatchObject({
        receiptId: undo.receiptId,
        idempotent: true,
      });
    });

    it("requires a distinct authenticated approval action in review mode", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "explicit");
      const caller = authed(t, seed);
      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed),
      );
      expect(submitted).toMatchObject({
        approvalMode: "explicit",
        needsApproval: true,
      });
      await expect(
        caller.mutation(commitsApi.commitBlockProposal, {
          proposalId: submitted.proposalId,
          approvalMode: "explicit",
        }),
      ).rejects.toSatisfy((error: unknown) =>
        errBlob(error).includes("owner_approval_required"),
      );
      expect((await rawOwnerState(t, seed)).block.revision).toBe(1);

      await caller.mutation(proposalsApi.approveProposal, {
        proposalId: submitted.proposalId,
      });
      const committed = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: submitted.proposalId,
        approvalMode: "explicit",
      });
      const receipt = await caller.query(proposalsApi.getReceipt, {
        receiptId: committed.receiptId,
      });
      expect(receipt.validationChecks.map((item: any) => item.code)).toEqual(
        expect.arrayContaining([
          "review_mode_explicit",
          "commit.explicit_owner_approval",
          "after_content_matches_proposal",
        ]),
      );
    });

    it("allows a fresh audited attempt when Review becomes run autonomy, while recovery selects the committed winner", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "rebind");
      const caller = authed(t, seed);
      const review = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, { idempotencyKey: "rebind:review" }),
      );
      const grant = await createRunGrant(t, seed, 2);
      const delegated = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, {
          idempotencyKey: "rebind:delegated",
          grantId: grant.grantId,
        }),
      );
      expect(delegated.proposalId).not.toBe(review.proposalId);
      expect(delegated.approvalMode).toBe("delegated");
      await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: delegated.proposalId,
        approvalMode: "delegated",
      });
      const state = await caller.query(proposalsApi.getOperationState, {
        operationKey: seed.operationKey,
      });
      expect(state).toMatchObject({
        proposalId: delegated.proposalId,
        status: "committed",
        grantId: grant.grantId,
      });
      expect((await rawOwnerState(t, seed)).proposals).toHaveLength(2);
    });

    it("returns an exact retry at the proposal-attempt boundary and rejects only a new attempt", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "attempt-boundary");
      const caller = authed(t, seed);
      let tenth: any = null;
      for (let index = 1; index <= 10; index += 1) {
        tenth = await caller.mutation(
          proposalsApi.submitBlockProposal,
          proposalArgs(seed, { idempotencyKey: `attempt-boundary:${index}` }),
        );
      }
      const retry = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, { idempotencyKey: "attempt-boundary:10" }),
      );
      expect(retry).toMatchObject({
        proposalId: tenth.proposalId,
        idempotent: true,
      });
      await expect(
        caller.mutation(
          proposalsApi.submitBlockProposal,
          proposalArgs(seed, { idempotencyKey: "attempt-boundary:11" }),
        ),
      ).rejects.toSatisfy((error: unknown) =>
        errBlob(error).includes("operation_attempt_limit_exceeded"),
      );
    });

    it("denies revoke or expiry between proposal and commit without spending an operation or writing", async () => {
      for (const transition of ["revoked", "expired"] as const) {
        const t = convexTest(schema, convexModules);
        const seed = await seedNotebook(t, `between-${transition}`);
        const grant = await createRunGrant(t, seed, 2);
        const caller = authed(t, seed);
        const submitted = await caller.mutation(
          proposalsApi.submitBlockProposal,
          proposalArgs(seed, { grantId: grant.grantId }),
        );
        if (transition === "revoked") {
          await caller.mutation(grantsApi.revokeGrant, {
            grantId: grant.grantId,
            reason: "owner stopped autonomy",
          });
        } else {
          await t.run(async (ctx: any) => {
            const row = await ctx.db
              .query("autonomyGrants")
              .withIndex("by_grant_id", (q: any) => q.eq("grantId", grant.grantId))
              .unique();
            await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
          });
        }
        const denied = await caller.mutation(commitsApi.commitBlockProposal, {
          proposalId: submitted.proposalId,
          approvalMode: "delegated",
        });
        expect(denied).toMatchObject({ delegationDenied: true, needsApproval: true });
        const state = await rawOwnerState(t, seed);
        expect(state.block.revision).toBe(1);
        expect(state.receipts).toHaveLength(0);
        expect(state.grants[0].usedOperations).toBe(0);
      }
    });

    it("keeps tenant failures opaque and persists server evidence failures without a write", async () => {
      const t = convexTest(schema, convexModules);
      const alice = await seedNotebook(t, "alice");
      const bob = await seedNotebook(t, "bob");
      await expect(
        authed(t, bob).mutation(
          proposalsApi.submitBlockProposal,
          proposalArgs(alice, {
            idempotencyKey: "bob-cross-tenant",
            runId: bob.scratchpadId,
          }),
        ),
      ).rejects.toSatisfy((error: unknown) => errBlob(error).includes("block_not_found"));
      expect((await rawOwnerState(t, alice)).proposals).toHaveLength(0);

      const arbitrary = await authed(t, alice).mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(alice, {
          idempotencyKey: "alice-arbitrary",
          proposedContent: text("Client invented this claim."),
        }),
      );
      expect(arbitrary).toMatchObject({
        status: "blocked",
        validationFailed: true,
        validationFailureCode: "proposed_content_matches_evidence",
      });
      const wrongOrder = await authed(t, alice).mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(alice, {
          idempotencyKey: "alice-ref-order",
          proposedSourceRefIds: [...alice.sourceRefIds].reverse(),
        }),
      );
      expect(wrongOrder).toMatchObject({
        status: "blocked",
        validationFailureCode: "proposed_source_refs_match_evidence",
      });
      const state = await rawOwnerState(t, alice);
      expect(state.block.revision).toBe(1);
      expect(state.receipts).toHaveLength(0);
      expect(state.proposals).toHaveLength(2);
    });

    it("rolls grant/proposal changes back when the guarded writer rate-limits", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "rollback");
      const grant = await createRunGrant(t, seed, 2);
      const caller = authed(t, seed);
      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, { grantId: grant.grantId }),
      );
      await t.run(async (ctx: any) => {
        const now = Date.now();
        await ctx.db.insert("productBlockWriteWindows", {
          ownerKey: seed.ownerKey,
          sessionKey: seed.ownerKey,
          actorKey: "actor:nodebench.notebook_coordinator",
          bucketStartMs: Math.floor(now / 10_000) * 10_000,
          shard: 0,
          writeCount: 1_200,
          createdAt: now,
          updatedAt: now,
        });
      });
      await expect(
        caller.mutation(commitsApi.commitBlockProposal, {
          proposalId: submitted.proposalId,
          approvalMode: "delegated",
        }),
      ).rejects.toSatisfy((error: unknown) => errBlob(error).includes("RATE_LIMITED"));
      const state = await rawOwnerState(t, seed);
      expect(state.block.revision).toBe(1);
      expect(state.receipts).toHaveLength(0);
      expect(state.grants[0]).toMatchObject({ usedOperations: 0, status: "active" });
      expect(state.proposals[0].status).toBe("pending");
    });

    it("fails stale undo without mutating the immutable receipt", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "stale-undo");
      const grant = await createRunGrant(t, seed, 2);
      const caller = authed(t, seed);
      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, { grantId: grant.grantId }),
      );
      const committed = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: submitted.proposalId,
        approvalMode: "delegated",
      });
      const before = structuredClone((await rawOwnerState(t, seed)).receipts[0]);
      await caller.mutation(blocksApi.updateBlock, {
        blockId: seed.blockId,
        content: text("Owner edited after commit."),
        expectedRevision: 2,
        editedByAuthorKind: "user",
        editedByAuthorId: String(seed.userId),
      });
      await expect(
        caller.mutation(commitsApi.undoBlockReceipt, {
          receiptId: committed.receiptId,
        }),
      ).rejects.toBeTruthy();
      const after = await rawOwnerState(t, seed);
      expect(after.block).toMatchObject({ revision: 3, content: text("Owner edited after commit.") });
      expect(after.receipts).toHaveLength(1);
      expect(after.receipts[0]).toEqual(before);
    });

    it("materializes explicit remainder blocks exactly once and disables unsafe target-only undo", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedNotebook(t, "remainder", {
        body: "Trusted remainder body.\n\n- Supported bullet.",
      });
      const grant = await createRunGrant(t, seed, 2);
      const caller = authed(t, seed);
      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, { grantId: grant.grantId }),
      );
      const committed = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: submitted.proposalId,
        approvalMode: "delegated",
      });
      const frozenAt = Date.now();
      const attributes = {
        acceptedFromLive: {
          blockType: seed.blockType,
          sourceScratchpadRunId: seed.scratchpadRunId,
          sourceSectionId: "section-remainder",
          sourceRefIds: seed.sourceRefIds,
          overallTier: "verified",
          sourceCount: seed.sourceRefIds.length,
          frozenAt,
        },
      };
      const completionKey = `${seed.operationKey}:remainder:v1`;
      const remainderArgs = {
        proposalId: submitted.proposalId,
        receiptId: committed.receiptId,
        completionKey,
        beforeDrafts: [
          { kind: "generated_marker", content: text("Accepted from live intelligence"), attributes },
          { kind: "heading_3", content: text("Header remainder"), attributes },
        ],
        afterDrafts: [
          {
            kind: "bullet",
            content: text("Supported bullet."),
            sourceRefIds: seed.sourceRefIds,
            attributes,
          },
        ],
      };
      const first = await caller.mutation(
        remaindersApi.commitProposalRemainder,
        remainderArgs,
      );
      expect(first).toMatchObject({ completionKey, idempotent: false });
      expect(first.insertedBlockIds).toHaveLength(3);
      const retry = await caller.mutation(
        remaindersApi.commitProposalRemainder,
        remainderArgs,
      );
      expect(retry).toMatchObject({
        insertedBlockIds: first.insertedBlockIds,
        lastBlockId: first.lastBlockId,
        idempotent: true,
      });
      const ownerState = await rawOwnerState(t, seed);
      expect(ownerState.completions).toHaveLength(1);
      const operationState = await caller.query(proposalsApi.getOperationState, {
        operationKey: seed.operationKey,
      });
      expect(operationState).toMatchObject({
        remainderCompleted: true,
        remainderCompletionKey: completionKey,
        insertedBlockIds: first.insertedBlockIds,
        canUndoNow: false,
        undoUnavailableReason: "remainder_completed_requires_composite_undo",
      });
      await expect(
        caller.mutation(commitsApi.undoBlockReceipt, {
          receiptId: committed.receiptId,
        }),
      ).rejects.toSatisfy((error: unknown) =>
        errBlob(error).includes("remainder_completed_requires_composite_undo"),
      );
    });

    it("holds a second valid operation for review after the grant operation cap is consumed", async () => {
      const t = convexTest(schema, convexModules);
      const first = await seedNotebook(t, "cap");
      const second = await seedAdditionalTarget(
        t,
        first,
        "news",
        "Trusted news body paragraph.",
      );
      const grant = await createRunGrant(t, first, 1);
      const caller = authed(t, first);
      const firstProposal = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(first, { grantId: grant.grantId }),
      );
      await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: firstProposal.proposalId,
        approvalMode: "delegated",
      });
      const held = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(second, {
          idempotencyKey: "cap:second",
          grantId: grant.grantId,
        }),
      );
      expect(held).toMatchObject({
        status: "pending",
        approvalMode: "explicit",
        delegationDenied: true,
      });
      const denied = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: held.proposalId,
        approvalMode: "delegated",
      });
      expect(denied).toMatchObject({ delegationDenied: true, needsApproval: true });
      expect((await t.run(async (ctx: any) => ctx.db.get(second.blockId))).revision).toBe(1);
      expect((await rawOwnerState(t, first)).receipts).toHaveLength(1);
    });
  },
);
