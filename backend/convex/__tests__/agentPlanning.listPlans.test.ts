import { describe, expect, it } from "vitest";
import {
  getEpisodicByRunId,
  listMemory,
  readMemory,
} from "../domains/agents/agentMemory";
import { projectAgentPlanSummary } from "../domains/agents/agentPlanSummary";
import {
  projectAgentEpisodicSummary,
  projectAgentMemorySummary,
} from "../domains/agents/agentMemorySummary";
import { getPlan, listPlans } from "../domains/agents/agentPlanning";

function authenticatedQueryContext(rows: unknown[]) {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: "user-qa|session-qa" }),
    },
    db: {
      query: () => ({
        withIndex: () => ({
          order: () => ({
            take: async () => rows,
          }),
        }),
      }),
    },
  };
}

function authenticatedGetContext(row: unknown) {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: "user-qa|session-qa" }),
    },
    db: {
      get: async () => row,
    },
  };
}

function authenticatedFirstContext(row: unknown) {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: "user-qa|session-qa" }),
    },
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => row,
        }),
      }),
    },
  };
}

describe("agentPlanning.listPlans summary projection", () => {
  it("strips initializer-only and database metadata fields", () => {
    const initializerPlan = {
      _id: "plan-qa",
      _creationTime: 3,
      userId: "user-qa",
      agentThreadId: "thread-qa",
      goal: "Verify the production plan subscription",
      steps: [{ description: "Search the source", status: "pending" as const }],
      features: [
        {
          name: "search",
          status: "pending",
          testCriteria: "A source is returned",
        },
      ],
      progressLog: [{ ts: 1, status: "info", message: "seeded" }],
      createdAt: 1,
      updatedAt: 2,
    };
    const summary = projectAgentPlanSummary(initializerPlan);

    expect(summary).toEqual({
      _id: "plan-qa",
      userId: "user-qa",
      goal: "Verify the production plan subscription",
      steps: [{ description: "Search the source", status: "pending" }],
      createdAt: 1,
      updatedAt: 2,
    });
    expect(Object.keys(summary).sort()).toEqual([
      "_id",
      "createdAt",
      "goal",
      "steps",
      "updatedAt",
      "userId",
    ]);
  });

  it("projects rows in the registered listPlans handler", async () => {
    const initializerPlan = {
      _id: "plan-qa",
      _creationTime: 3,
      userId: "user-qa",
      agentThreadId: "thread-qa",
      goal: "Verify the production plan subscription",
      steps: [{ description: "Search the source", status: "pending" as const }],
      features: [],
      progressLog: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await (listPlans as any)._handler(
      authenticatedQueryContext([initializerPlan]),
      { limit: 5 },
    );

    expect(result).toEqual([projectAgentPlanSummary(initializerPlan)]);
  });

  it("projects a row in the registered getPlan handler", async () => {
    const initializerPlan = {
      _id: "plan-qa",
      _creationTime: 3,
      userId: "user-qa",
      agentThreadId: "thread-qa",
      goal: "Verify the production plan subscription",
      steps: [{ description: "Search the source", status: "pending" as const }],
      features: [],
      progressLog: [],
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await (getPlan as any)._handler(
      authenticatedGetContext(initializerPlan),
      { planId: "plan-qa" },
    );

    expect(result).toEqual(projectAgentPlanSummary(initializerPlan));
  });
});

describe("agentMemory public summary projection", () => {
  it("strips database metadata while preserving optional metadata", () => {
    const storedMemory = {
      _id: "memory-qa",
      _creationTime: 3,
      userId: "user-qa",
      key: "constraint:region",
      content: "US only",
      metadata: { source: "qa" },
      createdAt: 1,
      updatedAt: 2,
    };
    const summary = projectAgentMemorySummary(storedMemory);

    expect(summary).toEqual({
      _id: "memory-qa",
      userId: "user-qa",
      key: "constraint:region",
      content: "US only",
      metadata: { source: "qa" },
      createdAt: 1,
      updatedAt: 2,
    });
    expect(summary).not.toHaveProperty("_creationTime");
  });

  it("projects rows in the registered listMemory handler", async () => {
    const storedMemory = {
      _id: "memory-qa",
      _creationTime: 3,
      userId: "user-qa",
      key: "scratchpad",
      content: "Remember this",
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await (listMemory as any)._handler(
      authenticatedQueryContext([storedMemory]),
      { limit: 10 },
    );

    expect(result).toEqual([projectAgentMemorySummary(storedMemory)]);
  });

  it("projects a row in the registered readMemory handler", async () => {
    const storedMemory = {
      _id: "memory-qa",
      _creationTime: 3,
      userId: "user-qa",
      key: "scratchpad",
      content: "Remember this",
      metadata: { source: "qa" },
      createdAt: 1,
      updatedAt: 2,
    };

    const result = await (readMemory as any)._handler(
      authenticatedFirstContext(storedMemory),
      { key: "scratchpad" },
    );

    expect(result).toEqual(projectAgentMemorySummary(storedMemory));
  });
});

describe("agentMemory episodic summary projection", () => {
  it("projects registered getEpisodicByRunId rows onto its strict return contract", async () => {
    const ownEntry = {
      _id: "episode-own",
      _creationTime: 3,
      runId: "run-qa",
      userId: "user-qa",
      ts: 2,
      tags: ["verification"],
      data: { passed: true },
    };
    const otherEntry = {
      ...ownEntry,
      _id: "episode-other",
      userId: "other-user",
    };

    const result = await (getEpisodicByRunId as any)._handler(
      authenticatedQueryContext([ownEntry, otherEntry]),
      { runId: "run-qa", limit: 10 },
    );

    expect(result).toEqual([projectAgentEpisodicSummary(ownEntry)]);
    expect(result[0]).not.toHaveProperty("_creationTime");
  });
});
