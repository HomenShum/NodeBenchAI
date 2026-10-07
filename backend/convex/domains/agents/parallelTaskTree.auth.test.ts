/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "agents"];
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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [
    rerootGlobKey(key),
    loader,
  ]),
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

const treeInternal = (internal as any).domains.agents.parallelTaskTree;

async function seedOwners(t: any) {
  return t.run(async (ctx: any) => {
    const ownerA = await ctx.db.insert("users", { email: "tree-owner-a@example.com" });
    const ownerB = await ctx.db.insert("users", { email: "tree-owner-b@example.com" });
    return { ownerA, ownerB };
  });
}

describe.skipIf(!convexTestAvailable)("internal due-diligence task tree ownership", () => {
  it("binds every retained mutation to the exact owner, tree, and task chain", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA, ownerB } = await seedOwners(t);
    const first = await t.mutation(treeInternal.createTaskTreeInternal, {
      userId: ownerA,
      agentThreadId: "owner-a-first",
      query: "First tree",
    });
    const second = await t.mutation(treeInternal.createTaskTreeInternal, {
      userId: ownerA,
      agentThreadId: "owner-a-second",
      query: "Second tree",
    });

    await expect(t.mutation(treeInternal.internalUpdateTreeStatus, {
      userId: ownerB,
      treeId: first.treeId,
      status: "executing",
    })).rejects.toThrow(/not found|unauthorized/i);
    await expect(t.mutation(treeInternal.createBranchTasksInternal, {
      userId: ownerA,
      treeId: first.treeId,
      parentTaskId: second.rootTaskId,
      branches: [{ title: "Cross-tree branch" }],
    })).rejects.toThrow(/not found|unauthorized/i);

    const [taskId] = await t.mutation(treeInternal.createBranchTasksInternal, {
      userId: ownerA,
      treeId: first.treeId,
      parentTaskId: first.rootTaskId,
      branches: [{ title: " Owner A branch ", description: " Private work " }],
    });
    await expect(t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerB,
      taskId,
      status: "completed",
      result: "forged result",
    })).rejects.toThrow(/not found|unauthorized/i);

    await t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerA,
      taskId,
      status: "running",
    });
    await t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerA,
      taskId,
      status: "running",
    });
    await t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerA,
      taskId,
      status: "completed",
      result: " owner result ",
      resultSummary: " owner summary ",
      confidence: 0.73,
    });
    await t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerA,
      taskId,
      status: "completed",
      result: " owner result ",
      resultSummary: " owner summary ",
      confidence: 0.73,
    });

    const stored = await t.run(async (ctx: any) => {
      const task = await ctx.db
        .query("parallelTaskNodes")
        .withIndex("by_taskId", (q: any) => q.eq("taskId", taskId))
        .first();
      const tree = await ctx.db.get(first.treeId);
      return { task, tree };
    });
    expect(stored.task).toMatchObject({
      title: "Owner A branch",
      description: "Private work",
      result: "owner result",
      resultSummary: "owner summary",
      confidence: 0.73,
      status: "completed",
    });
    expect(stored.tree).toMatchObject({
      activeBranches: 0,
      completedBranches: 1,
      totalBranches: 1,
    });
  });

  it("rejects unbounded internal payloads before persistence", async () => {
    const t = convexTest(schema, convexModules);
    const { ownerA } = await seedOwners(t);

    await expect(t.mutation(treeInternal.createTaskTreeInternal, {
      userId: ownerA,
      agentThreadId: "thread",
      query: "x".repeat(4_001),
    })).rejects.toThrow(/query must contain 1-4000/i);

    const tree = await t.mutation(treeInternal.createTaskTreeInternal, {
      userId: ownerA,
      agentThreadId: "thread",
      query: "Bounded tree",
    });
    await expect(t.mutation(treeInternal.createBranchTasksInternal, {
      userId: ownerA,
      treeId: tree.treeId,
      parentTaskId: tree.rootTaskId,
      branches: Array.from({ length: 17 }, (_, index) => ({ title: `Branch ${index}` })),
    })).rejects.toThrow(/branches must contain 1-16/i);

    const [taskId] = await t.mutation(treeInternal.createBranchTasksInternal, {
      userId: ownerA,
      treeId: tree.treeId,
      parentTaskId: tree.rootTaskId,
      branches: [{ title: "Confidence contract" }],
    });
    await expect(t.mutation(treeInternal.updateTaskStatusInternal, {
      userId: ownerA,
      taskId,
      status: "completed",
      confidence: 1.01,
    })).rejects.toThrow(/confidence must be a finite number between 0 and 1/i);
  });
});
