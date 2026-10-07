/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "product"];
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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(
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

const NOW = 1_700_000_000_000;

async function seedEntity(
  ctx: any,
  ownerKey: string,
  slug: string,
  label: string,
) {
  return await ctx.db.insert("productEntities", {
    ownerKey,
    slug,
    name: label,
    entityType: "company",
    summary: `${label} summary`,
    latestRevision: 1,
    reportCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe.skipIf(!convexTestAvailable)("diligence tenant isolation", () => {
  it("returns a sanitized public projection DTO for only the shared tenant", async () => {
    const t = convexTest(schema, convexModules);
    await t.run(async (ctx: any) => {
      const slug = "shared-slug";
      const ownerA = "user:owner-a";
      const ownerB = "user:owner-b";
      const entityA = await seedEntity(ctx, ownerA, slug, "Tenant A");
      const entityB = await seedEntity(ctx, ownerB, slug, "Tenant B");
      const userId = await ctx.db.insert("users", {
        email: "owner-a@example.com",
      });
      const scratchpadId = await ctx.db.insert("agentScratchpads", {
        agentThreadId: "scratchpad:tenant-a",
        userId,
        scratchpad: {},
        ownerKey: ownerA,
        entityId: entityA,
        entitySlug: slug,
        status: "merged",
        createdAt: NOW,
        updatedAt: NOW,
      });

      await ctx.db.insert("diligenceProjections", {
        ownerKey: ownerA,
        entityId: entityA,
        producerScratchpadId: scratchpadId,
        producerAssurance: "internal_structuring_v1",
        entitySlug: slug,
        blockType: "product",
        scratchpadRunId: "scratchpad:tenant-a:product",
        version: 1,
        overallTier: "verified",
        headerText: "Tenant A finding",
        bodyProse: "Only tenant A may be returned.",
        sourceRefIds: ["source-a"],
        sourceCount: 1,
        updatedAt: NOW,
      });
      await ctx.db.insert("diligenceProjections", {
        ownerKey: ownerB,
        entityId: entityB,
        producerAssurance: "internal_canonical_v1",
        entitySlug: slug,
        blockType: "product",
        scratchpadRunId: "scratchpad:tenant-b:product",
        version: 1,
        overallTier: "verified",
        headerText: "Tenant B secret",
        bodyProse: "Must not cross the tenant boundary.",
        updatedAt: NOW + 1,
      });
      await ctx.db.insert("publicShares", {
        token: "tenant-a-share-token",
        resourceType: "entity",
        resourceSlug: slug,
        ownerKey: ownerA,
        createdAt: NOW,
        viewCount: 0,
      });
    });

    const result = await t.query(
      (api as any).domains.product.publicShares.getPublicEntityProjections,
      { token: "tenant-a-share-token", limit: 20 },
    );
    expect(result.status).toBe("active");
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].headerText).toBe("Tenant A finding");
    expect(result.projections[0]).not.toHaveProperty("ownerKey");
    expect(result.projections[0]).not.toHaveProperty("entityId");
    expect(result.projections[0]).not.toHaveProperty("producerScratchpadId");
    expect(result.projections[0]).not.toHaveProperty("producerAssurance");
  });

  it("mints new public shares with the canonical authenticated owner key", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const userId = await ctx.db.insert("users", {
        email: "share-owner@example.com",
      });
      const ownerKey = `user:${String(userId)}`;
      await seedEntity(ctx, ownerKey, "shareable-entity", "Shareable entity");
      return { ownerKey, userId };
    });
    const caller = t.withIdentity({ subject: String(seeded.userId) });
    const minted = await caller.mutation(
      (api as any).domains.product.publicShares.mintPublicShare,
      { resourceType: "entity", resourceSlug: "shareable-entity" },
    );
    const stored = await t.run(async (ctx: any) =>
      ctx.db
        .query("publicShares")
        .withIndex("by_token", (q: any) => q.eq("token", minted.token))
        .unique(),
    );
    expect(stored.ownerKey).toBe(seeded.ownerKey);
  });

  it("keeps pulse and run cache rows owner-scoped and omits slug-global memory", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const slug = "same-company";
      const ownerA = "user:owner-a";
      const ownerB = "user:owner-b";
      await seedEntity(ctx, ownerA, slug, "Tenant A");
      await seedEntity(ctx, ownerB, slug, "Tenant B");

      await ctx.db.insert("pulseReports", {
        ownerKey: ownerA,
        entitySlug: slug,
        dateKey: "2026-07-14",
        status: "ready",
        summaryMarkdown: "Tenant A pulse",
        changeCount: 1,
        materialChangeCount: 1,
        generatedAt: NOW,
      });
      await ctx.db.insert("pulseReports", {
        ownerKey: ownerB,
        entitySlug: slug,
        dateKey: "2026-07-15",
        status: "ready",
        summaryMarkdown: "Tenant B secret pulse",
        changeCount: 1,
        materialChangeCount: 1,
        generatedAt: NOW + 1,
      });

      const runA = await ctx.db.insert("extendedThinkingRuns", {
        ownerKey: ownerA,
        entitySlug: slug,
        goal: "Tenant A run",
        status: "running",
        currentCheckpoint: 0,
        totalCheckpoints: 1,
        thinkingBudgetTokens: 100,
        thinkingTokensUsed: 0,
        modelName: "test",
        startedAt: NOW,
        lastActivityAt: NOW,
      });
      await ctx.db.insert("extendedThinkingRuns", {
        ownerKey: ownerB,
        entitySlug: slug,
        goal: "Tenant B secret run",
        status: "running",
        currentCheckpoint: 0,
        totalCheckpoints: 1,
        thinkingBudgetTokens: 100,
        thinkingTokensUsed: 0,
        modelName: "test",
        startedAt: NOW + 1,
        lastActivityAt: NOW + 1,
      });
      await ctx.db.insert("entityMemoryIndex", {
        entitySlug: slug,
        indexJson: JSON.stringify([
          { oneLineSummary: "Tenant B secret memory" },
        ]),
        topicCount: 1,
        totalFactCount: 1,
        lastRebuildAt: NOW + 1,
      });
      return { ownerA, runA, slug };
    });

    const cache = await t.query(
      (internal as any).domains.agents.canonicalRuntimeQueries
        .getEntityFastLaneCache,
      { ownerKey: seeded.ownerA, entitySlug: seeded.slug },
    );
    expect(cache.latestPulse.summaryMarkdown).toBe("Tenant A pulse");
    expect(cache.latestRun.runId).toBe(seeded.runA);
    expect(cache.latestRun.goal).toBe("Tenant A run");
    expect(cache.memory).toBeNull();
  });

  it("does not return a same-slug scratchpad across owners", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const slug = "same-run-slug";
      const userA = await ctx.db.insert("users", {
        email: "run-owner-a@example.com",
      });
      const userB = await ctx.db.insert("users", {
        email: "run-owner-b@example.com",
      });
      const ownerA = `user:${String(userA)}`;
      const ownerB = `user:${String(userB)}`;
      const runA = await ctx.db.insert("extendedThinkingRuns", {
        ownerKey: ownerA,
        entitySlug: slug,
        goal: "Tenant A run",
        status: "running",
        currentCheckpoint: 0,
        totalCheckpoints: 1,
        thinkingBudgetTokens: 100,
        thinkingTokensUsed: 0,
        modelName: "test",
        startedAt: NOW,
        lastActivityAt: NOW,
      });
      await ctx.db.insert("agentScratchpads", {
        agentThreadId: "tenant-a-thread",
        userId: userA,
        scratchpad: { markdown: "Tenant A scratchpad" },
        ownerKey: ownerA,
        entitySlug: slug,
        status: "streaming",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("agentScratchpads", {
        agentThreadId: "tenant-b-thread",
        userId: userB,
        scratchpad: { markdown: "Tenant B secret scratchpad" },
        ownerKey: ownerB,
        entitySlug: slug,
        status: "streaming",
        createdAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      return { runA, userA, userB };
    });

    const ownerCaller = t.withIdentity({ subject: String(seeded.userA) });
    const ownResult = await ownerCaller.query(
      (api as any).domains.agents.canonicalRuntimeQueries.getRunWithScratchpad,
      { runId: seeded.runA },
    );
    expect(ownResult.scratchpad.agentThreadId).toBe("tenant-a-thread");

    const otherCaller = t.withIdentity({ subject: String(seeded.userB) });
    expect(
      await otherCaller.query(
        (api as any).domains.agents.canonicalRuntimeQueries
          .getRunWithScratchpad,
        { runId: seeded.runA },
      ),
    ).toBeNull();
  });

  it("keeps canonical pulse notebook pages isolated for the same slug and date", async () => {
    const t = convexTest(schema, convexModules);
    const dateKey = "2026-07-15";
    await t.run(async (ctx: any) => {
      await ctx.db.insert("productNotebookPages", {
        ownerKey: "user:owner-a",
        entitySlug: "same-page-slug",
        pageType: "pulse",
        dateKey,
        title: "Tenant A page",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("productNotebookPages", {
        ownerKey: "user:owner-b",
        entitySlug: "same-page-slug",
        pageType: "pulse",
        dateKey,
        title: "Tenant B page",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const queryRef = (internal as any).domains.agents.canonicalRuntimeQueries
      .getEntityNotebookPage;
    const mutationRef = (internal as any).domains.agents
      .canonicalRuntimeMutations.upsertNotebookPage;
    expect(
      await t.query(queryRef, {
        ownerKey: "user:owner-a",
        entitySlug: "same-page-slug",
        pageType: "pulse",
        dateKey,
      }),
    ).toMatchObject({ title: "Tenant A page" });

    await t.mutation(mutationRef, {
      ownerKey: "user:owner-a",
      entitySlug: "same-page-slug",
      pageType: "pulse",
      dateKey,
      title: "Tenant A page updated",
      createdAt: NOW,
      updatedAt: NOW + 1,
    });
    expect(
      await t.query(queryRef, {
        ownerKey: "user:owner-b",
        entitySlug: "same-page-slug",
        pageType: "pulse",
        dateKey,
      }),
    ).toMatchObject({ title: "Tenant B page" });
  });

  it("rejects verdict metadata that does not match its tenant-bound telemetry", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerKey = "user:judge-owner";
      const entitySlug = "judge-entity";
      const entityId = await seedEntity(
        ctx,
        ownerKey,
        entitySlug,
        "Judge entity",
      );
      const telemetryId = await ctx.db.insert("diligenceRunTelemetry", {
        ownerKey,
        entityId,
        entitySlug,
        blockType: "product",
        scratchpadRunId: "scratchpad:judge:product",
        version: 1,
        overallTier: "verified",
        headerText: "Product evidence",
        status: "created",
        startedAt: NOW,
        endedAt: NOW + 1,
        elapsedMs: 1,
      });
      return { ownerKey, entitySlug, entityId, telemetryId };
    });

    await expect(
      t.mutation(
        (internal as any).domains.product.diligenceJudge.recordVerdict,
        {
          ...seeded,
          blockType: "funding",
          scratchpadRunId: "scratchpad:judge:product",
          verdict: "verified",
          passCount: 10,
          failCount: 0,
          skipCount: 0,
          score: 1,
          latencyBudgetMs: 1_000,
          gatesJson: "[]",
          autoScore: false,
        },
      ),
    ).rejects.toThrow("invalid owner/entity telemetry context");

    const mismatchedVerdictId = await t.run(async (ctx: any) =>
      ctx.db.insert("diligenceJudgeVerdicts", {
        ownerKey: seeded.ownerKey,
        entityId: seeded.entityId,
        telemetryId: seeded.telemetryId,
        entitySlug: seeded.entitySlug,
        blockType: "funding",
        scratchpadRunId: "scratchpad:judge:funding",
        verdict: "verified",
        passCount: 10,
        failCount: 0,
        skipCount: 0,
        score: 1,
        latencyBudgetMs: 1_000,
        gatesJson: "[]",
        judgedAt: NOW,
        judgeVersion: "test",
      }),
    );
    await expect(
      t.query(
        (internal as any).domains.product.diligenceLlmJudgeRuns
          .getVerdictContext,
        { verdictId: mismatchedVerdictId },
      ),
    ).rejects.toThrow("tenant-bound verdict context is unavailable");
  });
});
