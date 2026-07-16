/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";
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

const swarmApi = (api as any).domains.agents.swarmQueries;
const swarmInternal = (internal as any).domains.agents.swarmQueries;
const NOW = 1_700_000_000_000;

async function seedSwarms(t: any) {
  return await t.run(async (ctx: any) => {
    const ownerA = await ctx.db.insert("users", { email: "swarm-owner-a@example.com" });
    const ownerB = await ctx.db.insert("users", { email: "swarm-owner-b@example.com" });
    const threadA = await ctx.db.insert("chatThreadsStream", {
      userId: ownerA,
      title: "Owner A private team",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const threadB = await ctx.db.insert("chatThreadsStream", {
      userId: ownerB,
      title: "Owner B private team",
      createdAt: NOW + 1,
      updatedAt: NOW + 1,
    });
    const agentConfigs = [{
      agentName: "DocumentAgent",
      role: "Private document research",
      query: "private query",
      stateKeyPrefix: "private-prefix",
    }];
    await ctx.db.insert("agentSwarms", {
      swarmId: "swarm-a",
      userId: ownerA,
      threadId: String(threadA),
      query: "Owner A private question",
      pattern: "fan_out_gather",
      status: "executing",
      agentConfigs,
      createdAt: NOW,
    });
    await ctx.db.insert("agentSwarms", {
      swarmId: "swarm-b",
      userId: ownerB,
      threadId: String(threadB),
      query: "Owner B private question",
      pattern: "fan_out_gather",
      status: "completed",
      agentConfigs,
      createdAt: NOW + 1,
    });
    await ctx.db.insert("swarmAgentTasks", {
      swarmId: "swarm-a",
      taskId: "task-a",
      delegationId: "delegation-b",
      agentName: "DocumentAgent",
      query: "Owner A task payload",
      role: "Private document research",
      stateKeyPrefix: "private-prefix-a",
      status: "running",
      createdAt: NOW,
    });
    await ctx.db.insert("swarmAgentTasks", {
      swarmId: "swarm-b",
      taskId: "task-b",
      agentName: "DocumentAgent",
      query: "Owner B task payload",
      role: "Private document research",
      stateKeyPrefix: "private-prefix-b",
      status: "completed",
      result: "Owner B private result",
      createdAt: NOW + 1,
    });
    await ctx.db.insert("agentDelegations", {
      runId: "swarm-b",
      delegationId: "delegation-b",
      userId: ownerB,
      agentName: "DocumentAgent",
      query: "Owner B delegated query",
      status: "completed",
      scheduledAt: NOW + 1,
      finishedAt: NOW + 2,
    });
    await ctx.db.insert("agentWriteEvents", {
      delegationId: "delegation-b",
      seq: 0,
      kind: "final",
      textChunk: "Owner B private delegated output",
      createdAt: NOW + 2,
    });
    return { ownerA, ownerB, threadA, threadB };
  });
}

describe.skipIf(!convexTestAvailable)("swarm owner isolation", () => {
  it("returns no swarm, task, thread, or context data to guests", async () => {
    const t = convexTest(schema, convexModules);
    await seedSwarms(t);

    expect(await t.query(swarmApi.getSwarmStatus, { swarmId: "swarm-a" })).toBeNull();
    expect(await t.query(swarmApi.getSwarmByThread, { threadId: "any" })).toBeNull();
    expect(await t.query(swarmApi.getSwarmTasks, { swarmId: "swarm-a" })).toEqual([]);
    expect(await t.query(swarmApi.subscribeToSwarmTasks, { swarmId: "swarm-a" })).toBeNull();
    expect(await t.query(swarmApi.getSwarmWithContext, { swarmId: "swarm-a" })).toBeNull();
    expect(await t.query(swarmApi.isThreadSwarmActive, { threadId: "any" })).toEqual({
      hasSwarm: false,
      isActive: false,
    });
    expect(await t.query(swarmApi.listActiveSwarms, { limit: 20 })).toEqual([]);
  });

  it("isolates every public projection by the authenticated owner", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await seedSwarms(t);
    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });
    const ownerB = t.withIdentity({ subject: String(seeded.ownerB) });

    expect(await ownerA.query(swarmApi.getSwarmStatus, { swarmId: "swarm-a" }))
      .toMatchObject({ swarmId: "swarm-a", userId: seeded.ownerA });
    expect(await ownerB.query(swarmApi.getSwarmStatus, { swarmId: "swarm-a" })).toBeNull();
    expect(await ownerA.query(swarmApi.getSwarmByThread, { threadId: String(seeded.threadA) }))
      .toMatchObject({ swarmId: "swarm-a" });
    expect(await ownerB.query(swarmApi.getSwarmByThread, { threadId: String(seeded.threadA) }))
      .toBeNull();
    expect((await ownerA.query(swarmApi.getSwarmTasks, { swarmId: "swarm-a" }))
      .map((task: any) => task.taskId)).toEqual(["task-a"]);
    expect(await ownerB.query(swarmApi.getSwarmTasks, { swarmId: "swarm-a" })).toEqual([]);
    const ownerAContext = await ownerA.query(swarmApi.getSwarmWithContext, {
      swarmId: "swarm-a",
    });
    expect(ownerAContext)
      .toMatchObject({ swarm: { swarmId: "swarm-a" }, thread: { _id: seeded.threadA } });
    expect(ownerAContext.taskEvents).toEqual({});
    expect(await ownerB.query(swarmApi.getSwarmWithContext, { swarmId: "swarm-a" }))
      .toBeNull();
    expect((await ownerA.query(swarmApi.listActiveSwarms, { limit: 20 }))
      .map((swarm: any) => swarm.swarmId)).toEqual(["swarm-a"]);
    expect((await ownerB.query(swarmApi.listActiveSwarms, { limit: 20 }))
      .map((swarm: any) => swarm.swarmId)).toEqual(["swarm-b"]);
  });

  it("keeps trusted internal reads owner-checked", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await seedSwarms(t);

    expect(await t.query(swarmInternal.getSwarmStatusInternal, {
      swarmId: "swarm-a",
      userId: seeded.ownerB,
    })).toBeNull();
    expect(await t.query(swarmInternal.getSwarmTasksInternal, {
      swarmId: "swarm-a",
      userId: seeded.ownerB,
    })).toEqual([]);
    expect(await t.query(swarmInternal.getSwarmStatusInternal, {
      swarmId: "swarm-a",
      userId: seeded.ownerA,
    })).toMatchObject({ userId: seeded.ownerA });
  });
});

describe("swarm ownership source guards", () => {
  it("keeps all raw swarm writes internal and orchestrators on owner-checked reads", () => {
    const mutations = readFileSync(
      resolve(process.cwd(), "convex/domains/agents/swarmMutations.ts"),
      "utf8",
    );
    const orchestrator = readFileSync(
      resolve(process.cwd(), "convex/domains/agents/swarmOrchestrator.ts"),
      "utf8",
    );
    const enhanced = readFileSync(
      resolve(process.cwd(), "convex/domains/agents/swarmOrchestratorEnhanced.ts"),
      "utf8",
    );
    const liveSmoke = readFileSync(
      resolve(process.cwd(), "convex/domains/evaluation/liveApiSmoke.ts"),
      "utf8",
    );
    const cancelSwarm = orchestrator.slice(
      orchestrator.indexOf("export const cancelSwarm"),
      orchestrator.indexOf("// Helper Functions"),
    );

    expect(mutations).toContain("internalMutation");
    expect(mutations).not.toMatch(/=\s*mutation\s*\(/);
    expect(orchestrator).not.toContain("api.domains.agents.swarmMutations");
    expect(enhanced).not.toContain("api.domains.agents.swarmMutations");
    expect(orchestrator).toContain("getSwarmStatusInternal");
    expect(orchestrator).toContain("getSwarmTasksInternal");
    expect(enhanced).toContain("getSwarmStatusInternal");
    expect(enhanced).not.toContain("synthesis.confidence");
    expect(enhanced).not.toContain('"llm.cost.total"');
    expect(enhanced).not.toContain('"llm.usage.input_tokens"');
    expect(cancelSwarm).toContain("getAuthUserId(ctx)");
    expect(cancelSwarm).toContain("getSwarmStatusInternal");
    expect(cancelSwarm).toContain("getSwarmTasksInternal");
    expect(cancelSwarm).toContain("{ swarmId: args.swarmId, userId }");
    expect(liveSmoke).toContain("requireSecret(args.secret)");
    expect(liveSmoke).toContain("getSwarmStatusInternal");
    expect(liveSmoke).toContain("getSwarmTasksInternal");
    expect(liveSmoke).toContain("{ swarmId, userId }");
    expect(liveSmoke).not.toContain("api.domains.agents.swarmMutations");
  });

  it("does not expose arbitrary email lookup or caller-selected list ownership", () => {
    const queries = readFileSync(
      resolve(process.cwd(), "convex/domains/agents/swarmQueries.ts"),
      "utf8",
    );
    const listActive = queries.slice(
      queries.indexOf("export const listActiveSwarms"),
      queries.indexOf("export const listUserSwarms"),
    );

    expect(queries).not.toContain("export const getUserByEmail = query");
    expect(listActive).not.toContain("args.userId");
    expect(listActive).toContain("getAuthUserId(ctx)");
  });
});
