/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import { executeHarness, generatePlan, type HarnessPlan, type HarnessTraceEvent } from "./agentHarness.js";
import { MEMORY_CONTEXT_STEP_ID } from "./lib/entityMemoryRecall.js";

describe("agentHarness v2", () => {
  it("normalizes deterministic company_search plans into tiered v2 steps", async () => {
    const plan = await generatePlan(
      "What is Ramp fintech?",
      "company_search",
      ["Ramp"],
      "founder",
      async () => {
        throw new Error("callTool should not be used for deterministic company_search planning");
      },
    );

    expect(plan.steps).toHaveLength(5);

    const [s1, s2, s3, s4, s5] = plan.steps;
    expect(s1).toMatchObject({
      id: "s1",
      stepIndex: 0,
      groupId: "discover",
      toolName: "linkup_search",
    });
    expect(s2).toMatchObject({
      id: "s2",
      stepIndex: 0,
      groupId: "discover",
      toolName: "web_search",
    });
    expect(s3).toMatchObject({
      id: "s3",
      stepIndex: 0,
      groupId: "discover",
      toolName: "web_search",
    });
    expect(s4).toMatchObject({
      id: "s4",
      stepIndex: 1,
      groupId: "analyze",
      toolName: "run_recon",
      dependsOn: ["s1", "s2", "s3"],
      injectPriorResults: ["s1", "s2", "s3"],
      model: "gemini-3.1-flash-lite-preview",
    });
    expect(s5).toMatchObject({
      id: "s5",
      stepIndex: 1,
      groupId: "analyze",
      toolName: "enrich_entity",
      dependsOn: ["s1", "s2", "s3"],
      injectPriorResults: ["s1", "s2", "s3"],
    });
    expect(plan.steps.every((step) => step.dependsOn == null || Array.isArray(step.dependsOn))).toBe(true);
  });

  it("executes tiers concurrently, injects prior results, and emits v2 step telemetry", async () => {
    const observedArgs = new Map<string, Record<string, unknown>>();
    const startedAt = new Map<string, number>();
    const trace: HarnessTraceEvent[] = [];

    const plan: HarnessPlan = {
      objective: "Test tiered execution",
      classification: "general",
      entityTargets: ["Ramp"],
      synthesisPrompt: "unused",
      steps: [
        {
          id: "s1",
          stepIndex: 0,
          groupId: "discover",
          toolName: "web_search",
          args: { query: "Ramp fintech" },
          purpose: "Find sources",
        },
        {
          id: "s2",
          stepIndex: 1,
          groupId: "analyze",
          toolName: "run_recon",
          args: { target: "Ramp" },
          purpose: "Analyze sources",
          dependsOn: ["s1"],
          injectPriorResults: ["s1"],
          model: "gemini-3.1-flash-lite-preview",
        },
        {
          id: "s3",
          stepIndex: 1,
          groupId: "analyze",
          toolName: "founder_local_gather",
          args: { daysBack: 7 },
          purpose: "Gather local context",
          dependsOn: ["s1"],
          injectPriorResults: ["s1"],
          acceptsSteering: true,
          model: "gemini-3.1-flash-lite-preview",
        },
      ],
    };

    const execution = await executeHarness(
      plan,
      async (toolName, args) => {
        observedArgs.set(toolName, args);
        startedAt.set(toolName, Date.now());
        if (toolName === "web_search") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { topSource: "Ramp.com", count: 3 };
        }
        if (toolName === "run_recon") {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { recon: "complete" };
        }
        if (toolName === "founder_local_gather") {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { notes: 2 };
        }
        throw new Error(`unexpected tool ${toolName}`);
      },
      (event) => {
        trace.push(event);
      },
      {
        pendingUserSteering: { btw: "Prioritize GTM relevance" },
      },
    );

    const reconArgs = observedArgs.get("run_recon");
    const localArgs = observedArgs.get("founder_local_gather");
    expect(reconArgs?._priorResults).toEqual({
      s1: { topSource: "Ramp.com", count: 3 },
    });
    expect(localArgs?._priorResults).toEqual({
      s1: { topSource: "Ramp.com", count: 3 },
    });
    expect(localArgs?._steering).toEqual({ btw: "Prioritize GTM relevance" });

    const reconStart = startedAt.get("run_recon") ?? 0;
    const localStart = startedAt.get("founder_local_gather") ?? 0;
    expect(Math.abs(reconStart - localStart)).toBeLessThan(40);

    expect(execution.stepResults).toHaveLength(3);
    const [searchResult, reconResult, localResult] = execution.stepResults;
    expect(searchResult.stepIndex).toBe(0);
    expect(reconResult.groupId).toBe("analyze");
    expect(reconResult.model).toBe("gemini-3.1-flash-lite-preview");
    expect(reconResult.tokensIn).toBeGreaterThan(0);
    expect(reconResult.tokensOut).toBeGreaterThan(0);
    expect(reconResult.costUsd).toBeGreaterThan(0);
    expect(localResult.injectedContext).toEqual(["s1"]);
    expect(localResult.steeringApplied).toBe(true);

    expect(trace.some((event) => event.type === "trace" && event.step === "parallel_dispatch")).toBe(true);
    expect(trace.filter((event) => event.type === "step_start")).toHaveLength(3);
    expect(trace.filter((event) => event.type === "step_done")).toHaveLength(3);
    expect(trace.some((event) => event.type === "step_done" && event.stepId === "s2" && event.success)).toBe(true);
    expect(trace.some((event) => event.type === "step_done" && event.stepId === "s3" && event.steeringApplied)).toBe(true);
  });

  it("injects recalled entity memory into planned and executed context", async () => {
    const plan = await generatePlan(
      "What is Ramp fintech?",
      "company_search",
      ["Ramp"],
      "founder",
      async () => {
        throw new Error("callTool should not be used for deterministic company_search planning");
      },
      {
        recalledMemory: [
          {
            entitySlug: "ramp",
            entityName: "Ramp",
            entityType: "company",
            summary: "Saved market and product memory for Ramp.",
            savedBecause: "competitor watch",
            latestRevision: 4,
            updatedAt: Date.now(),
            latestReportTitle: "Ramp company brief",
            latestReportSummary: "Ramp keeps compounding product and GTM context.",
            noteSnippet: "Focus on GTM and moat continuity.",
          },
        ],
      },
    );

    expect(plan.steps.every((step) => step.injectPriorResults?.includes(MEMORY_CONTEXT_STEP_ID))).toBe(true);

    const observedArgs = new Map<string, Record<string, unknown>>();
    await executeHarness(
      {
        objective: "Use recalled memory",
        classification: "company_search",
        entityTargets: ["Ramp"],
        synthesisPrompt: "unused",
        steps: [
          {
            id: "s1",
            stepIndex: 0,
            groupId: "analyze",
            toolName: "run_recon",
            args: { target: "Ramp" },
            purpose: "Analyze using recalled memory",
            injectPriorResults: [MEMORY_CONTEXT_STEP_ID],
          },
        ],
      },
      async (toolName, args) => {
        observedArgs.set(toolName, args);
        return { ok: true };
      },
      undefined,
      {
        seedContext: {
          [MEMORY_CONTEXT_STEP_ID]: {
            entities: [{ entityName: "Ramp" }],
            summary: "Saved market and product memory for Ramp.",
          },
        },
      },
    );

    expect(observedArgs.get("run_recon")?._priorResults).toEqual({
      [MEMORY_CONTEXT_STEP_ID]: {
        entities: [{ entityName: "Ramp" }],
        summary: "Saved market and product memory for Ramp.",
      },
    });
  });
});
