/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api } from "../../../_generated/api";
import schema from "../../../schema";
import { buildDecorationOperationKey } from "./evidence";

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

const SCENARIO_ID = "app-02-pre-delegation-packet" as const;
const grantsApi = (api as any).domains.agents.autonomy.grants;
const proposalsApi = (api as any).domains.agents.autonomy.proposals;
const commitsApi = (api as any).domains.agents.autonomy.commits;
const tasteBenchApi = (api as any).domains.evaluation.tasteBench;

const text = (value: string) => [{ type: "text" as const, value }];

type Seed = {
  userId: any;
  ownerKey: string;
  entityId: any;
  blockId: any;
  scratchpadId: any;
  scratchpadRunId: string;
  operationKey: string;
  body: string;
  sourceRefIds: string[];
};

async function seedAuthorityAndTasteBench(
  t: any,
  label: string,
): Promise<Seed> {
  const now = Date.now();
  const body = `Trusted ${label} decision paragraph.`;
  const sourceRefIds = [`source:${label}:primary`, `source:${label}:secondary`];
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
      summary: "Authority and TasteBench integration fixture",
      latestRevision: 1,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const scratchpadBaseRunId = `scratchpad:${entitySlug}:${label}`;
    const scratchpadRunId = `${scratchpadBaseRunId}:decision`;
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
    await ctx.db.insert("diligenceProjections", {
      ownerKey,
      entityId,
      producerScratchpadId: scratchpadId,
      producerAssurance: "internal_structuring_v1",
      entitySlug,
      blockType: "product",
      scratchpadRunId,
      version: 1,
      overallTier: "verified",
      headerText: `Decision ${label}`,
      bodyProse: body,
      sourceRefIds,
      sourceCount: sourceRefIds.length,
      sourceSectionId: `section-${label}`,
      payload: { scratchpadBaseRunId },
      updatedAt: now,
    });

    for (const [index, hashCharacter] of ["a", "b"].entries()) {
      await ctx.db.insert("dogfoodQaRuns", {
        userId,
        createdAt: now + index,
        provider: "gemini",
        model: "gemini-authority-tastebench-contract",
        source: "screenshots",
        videoUrl: `/tastebench/${label}/artifact-${index + 1}.png`,
        inputSha256: hashCharacter.repeat(64),
        prompt: `tastebench-scenario:${SCENARIO_ID}\nReview this real evidence packet.`,
        summary: `Evidence packet ${index + 1} for ${label}.`,
        issues: [
          {
            severity: "p2",
            title: `Contract observation ${index + 1}`,
            details: "Artifact-backed authority integration observation.",
            route: "/agents",
          },
        ],
      });
    }

    return {
      userId,
      ownerKey,
      entityId,
      blockId,
      scratchpadId,
      scratchpadRunId,
    };
  });

  return {
    ...seeded,
    body,
    sourceRefIds,
    operationKey: buildDecorationOperationKey({
      entityId: seeded.entityId,
      scratchpadId: seeded.scratchpadId,
      scratchpadRunId: seeded.scratchpadRunId,
      blockType: "product",
      decorationVersion: 1,
    }),
  };
}

function authed(t: any, seed: Pick<Seed, "userId">) {
  return t.withIdentity({ subject: String(seed.userId) });
}

async function startTasteBenchRun(t: any, seed: Seed) {
  return await authed(t, seed).mutation(tasteBenchApi.startTasteBenchRun, {
    scenarioId: SCENARIO_ID,
  });
}

async function completeTasteBenchRun(t: any, seed: Seed, runId: any) {
  return await authed(t, seed).mutation(
    tasteBenchApi.submitTasteBenchComparison,
    {
      runId,
      presentedChoice: "a",
      reason:
        "Artifact A makes the authority boundary and resulting evidence easier to verify.",
      dimensions: ["interaction", "trust"],
    },
  );
}

async function createRunGrant(t: any, seed: Seed, suffix: string) {
  return await authed(t, seed).mutation(grantsApi.createGrant, {
    creationKey: `grant:${seed.operationKey}:${suffix}`,
    mode: "run",
    entityId: seed.entityId,
    runId: seed.scratchpadId,
    maxOperations: 2,
    expiresAt: Date.now() + 120_000,
  });
}

function proposalArgs(seed: Seed, grantId: string, suffix: string) {
  return {
    idempotencyKey: `proposal:${seed.operationKey}:${suffix}`,
    operationKey: seed.operationKey,
    blockId: seed.blockId,
    proposedContent: text(seed.body),
    proposedSourceRefIds: seed.sourceRefIds,
    baseRevision: 1,
    runId: seed.scratchpadId,
    decorationBlockType: "product",
    decorationScratchpadRunId: seed.scratchpadRunId,
    decorationVersion: 1,
    grantId,
  };
}

async function rawRunEvents(t: any, runId: any) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("tasteBenchEvents")
      .withIndex("by_run_sequence", (q: any) => q.eq("runId", runId))
      .order("asc")
      .collect(),
  );
}

async function rawProposal(t: any, ownerKey: string, proposalId: string) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("autonomyProposals")
      .withIndex("by_owner_created", (q: any) => q.eq("ownerKey", ownerKey))
      .filter((q: any) => q.eq(q.field("proposalId"), proposalId))
      .unique(),
  );
}

async function rawReceipt(t: any, receiptId: string) {
  return await t.run(async (ctx: any) =>
    ctx.db
      .query("autonomyReceipts")
      .withIndex("by_receipt_id", (q: any) => q.eq("receiptId", receiptId))
      .unique(),
  );
}

function eventTypes(events: any[]): string[] {
  return events.map((event) => event.eventType);
}

describe.skipIf(!convexTestAvailable)(
  "authority to TasteBench evidence binding",
  () => {
    it("keeps commit and post-judgment undo evidence on the proposal-bound run and ignores replays", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedAuthorityAndTasteBench(t, "bound-lifecycle");
      const caller = authed(t, seed);
      const firstRun = await startTasteBenchRun(t, seed);
      const grant = await createRunGrant(t, seed, "lifecycle");
      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, grant.grantId, "lifecycle"),
      );

      expect(
        await rawProposal(t, seed.ownerKey, submitted.proposalId),
      ).toMatchObject({
        tasteBenchRunId: firstRun.runId,
      });

      const committed = await caller.mutation(commitsApi.commitBlockProposal, {
        proposalId: submitted.proposalId,
        approvalMode: "delegated",
      });
      expect(await rawReceipt(t, committed.receiptId)).toMatchObject({
        tasteBenchRunId: firstRun.runId,
      });
      expect(eventTypes(await rawRunEvents(t, firstRun.runId))).toEqual([
        "run_started",
        "operation_accepted",
        "operation_changed",
      ]);

      const sameRunReplay = await caller.mutation(
        commitsApi.commitBlockProposal,
        {
          proposalId: submitted.proposalId,
          approvalMode: "delegated",
        },
      );
      expect(sameRunReplay.idempotent).toBe(true);
      expect(eventTypes(await rawRunEvents(t, firstRun.runId))).toEqual([
        "run_started",
        "operation_accepted",
        "operation_changed",
      ]);

      await completeTasteBenchRun(t, seed, firstRun.runId);
      const laterRun = await startTasteBenchRun(t, seed);
      const laterReplay = await caller.mutation(
        commitsApi.commitBlockProposal,
        {
          proposalId: submitted.proposalId,
          approvalMode: "delegated",
        },
      );
      expect(laterReplay.idempotent).toBe(true);
      expect(eventTypes(await rawRunEvents(t, laterRun.runId))).toEqual([
        "run_started",
      ]);

      const undone = await caller.mutation(commitsApi.undoBlockReceipt, {
        receiptId: committed.receiptId,
      });
      expect(eventTypes(await rawRunEvents(t, firstRun.runId))).toEqual([
        "run_started",
        "operation_accepted",
        "operation_changed",
        "run_completed",
        "operation_undone",
      ]);
      expect(eventTypes(await rawRunEvents(t, laterRun.runId))).toEqual([
        "run_started",
      ]);

      const undoReplay = await caller.mutation(commitsApi.undoBlockReceipt, {
        receiptId: committed.receiptId,
      });
      expect(undoReplay).toMatchObject({
        receiptId: undone.receiptId,
        idempotent: true,
      });
      expect(eventTypes(await rawRunEvents(t, firstRun.runId))).toEqual([
        "run_started",
        "operation_accepted",
        "operation_changed",
        "run_completed",
        "operation_undone",
      ]);
      expect(eventTypes(await rawRunEvents(t, laterRun.runId))).toEqual([
        "run_started",
      ]);
    });

    it("counts an initial delegated denial once even if the denied commit RPC is retried", async () => {
      const t = convexTest(schema, convexModules);
      const seed = await seedAuthorityAndTasteBench(t, "single-denial");
      const caller = authed(t, seed);
      const run = await startTasteBenchRun(t, seed);
      const grant = await createRunGrant(t, seed, "single-denial");
      await caller.mutation(grantsApi.revokeGrant, {
        grantId: grant.grantId,
        reason: "Test a stable interrupted-approval receipt.",
      });

      const submitted = await caller.mutation(
        proposalsApi.submitBlockProposal,
        proposalArgs(seed, grant.grantId, "single-denial"),
      );
      expect(submitted).toMatchObject({
        delegationDenied: true,
        needsApproval: true,
      });
      expect(
        await rawProposal(t, seed.ownerKey, submitted.proposalId),
      ).toMatchObject({
        tasteBenchRunId: run.runId,
      });
      expect(eventTypes(await rawRunEvents(t, run.runId))).toEqual([
        "run_started",
        "approval_interrupted",
      ]);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const denied = await caller.mutation(commitsApi.commitBlockProposal, {
          proposalId: submitted.proposalId,
          approvalMode: "delegated",
        });
        expect(denied).toMatchObject({
          delegationDenied: true,
          needsApproval: true,
        });
      }
      const events = await rawRunEvents(t, run.runId);
      expect(eventTypes(events)).toEqual([
        "run_started",
        "approval_interrupted",
      ]);
      expect(
        events.filter(
          (event: any) => event.eventType === "approval_interrupted",
        ),
      ).toHaveLength(1);
    });
  },
);
