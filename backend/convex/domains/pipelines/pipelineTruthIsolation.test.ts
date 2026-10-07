/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import {
  buildPipelineIdempotencyKey,
  buildScheduleOccurrenceAttemptKey,
  createManualPipelineAttemptKey,
} from "./pipelineAttempt";
import {
  applyCitationBoundVerdict,
  selectCitationsUsed,
  validateCitationMarkers,
} from "./researchProvenance";

const DIR_SEGMENTS = ["domains", "pipelines"];
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

const pipelineMutations = (internal as any).domains.pipelines;
const NOW = 1_800_000_000_000;

function runArgs(overrides: Record<string, unknown> = {}) {
  return {
    pipelineKind: "research",
    title: "Attempt isolation",
    spec: "Investigate one bounded question",
    modelId: "nodebench:auto-balanced",
    ownerKey: "user:test-owner",
    runId: "pipeline_attempt_1",
    attemptKey: "manual:attempt-1",
    workflowExecutionKey: "workflow:one",
    idempotencyKey: buildPipelineIdempotencyKey({
      pipelineKind: "research",
      spec: "Investigate one bounded question",
      ownerKey: "user:test-owner",
      attemptKey: "manual:attempt-1",
    }),
    ...overrides,
  };
}

describe("pipeline attempt identities", () => {
  it("isolates manual refreshes while keeping one attempt deterministic", () => {
    const attemptA = createManualPipelineAttemptKey(NOW, "a");
    const attemptB = createManualPipelineAttemptKey(NOW, "b");
    const base = {
      pipelineKind: "research" as const,
      spec: "same input",
      ownerKey: "user:one",
    };
    expect(attemptA).not.toBe(attemptB);
    expect(
      buildPipelineIdempotencyKey({ ...base, attemptKey: attemptA }),
    ).toBe(buildPipelineIdempotencyKey({ ...base, attemptKey: attemptA }));
    expect(
      buildPipelineIdempotencyKey({ ...base, attemptKey: attemptA }),
    ).not.toBe(buildPipelineIdempotencyKey({ ...base, attemptKey: attemptB }));
  });

  it("keys each schedule due occurrence deterministically", () => {
    expect(buildScheduleOccurrenceAttemptKey("schedule-1", NOW)).toBe(
      buildScheduleOccurrenceAttemptKey("schedule-1", NOW),
    );
    expect(buildScheduleOccurrenceAttemptKey("schedule-1", NOW)).not.toBe(
      buildScheduleOccurrenceAttemptKey("schedule-1", NOW + 60_000),
    );
    expect(() =>
      buildScheduleOccurrenceAttemptKey("schedule-1", Number.NaN),
    ).toThrow(/finite dueNextRunAt/i);
  });
});

describe("research citation provenance", () => {
  const sources = [
    { title: "One", url: "https://one.test" },
    { title: "Two", url: "https://two.test" },
    { title: "Three", url: "https://three.test" },
  ];

  it("calls only synthesis-bound sources citations", () => {
    const validation = validateCitationMarkers(
      "Second source [2], then first [1], and second again [2].",
      sources.length,
    );
    expect(validation).toEqual({
      state: "valid",
      validMarkers: [2, 1],
      invalidMarkers: [],
      sourceCount: 3,
    });
    expect(selectCitationsUsed(sources, validation)).toEqual([
      { idx: 2, title: "Two", url: "https://two.test" },
      { idx: 1, title: "One", url: "https://one.test" },
    ]);
  });

  it("rejects non-canonical and out-of-range markers and downgrades verified", () => {
    const validation = validateCitationMarkers(
      "Bad [0], [-1], [01], and [4]; one real marker [2].",
      sources.length,
    );
    expect(validation.state).toBe("invalid_markers");
    expect(validation.invalidMarkers).toEqual(["[0]", "[-1]", "[01]", "[4]"]);
    expect(validation.validMarkers).toEqual([2]);
    expect(
      applyCitationBoundVerdict(
        { tier: "verified", passing: 5, failing: 0, notes: [] },
        validation,
      ),
    ).toMatchObject({ tier: "needs_review" });
  });

  it.each([
    ["no_external_sources", "Internal knowledge only", 0],
    ["unbound_sources", "Sources were retrieved but never cited.", 3],
  ] as const)("prevents verified for %s", (state, synthesis, sourceCount) => {
    const validation = validateCitationMarkers(synthesis, sourceCount);
    expect(validation.state).toBe(state);
    expect(
      applyCitationBoundVerdict(
        { tier: "verified", passing: 1, failing: 0, notes: [] },
        validation,
      ).tier,
    ).toBe("needs_review");
  });

  it("allows a verified verdict only with valid bound external evidence", () => {
    const validation = validateCitationMarkers("Grounded claim [1].", 1);
    expect(
      applyCitationBoundVerdict(
        { tier: "verified", passing: 1, failing: 0, notes: [] },
        validation,
      ).tier,
    ).toBe("verified");
    expect(applyCitationBoundVerdict(null, validation).tier).toBe(
      "needs_review",
    );
  });
});

describe.skipIf(!convexTestAvailable)("pipeline attempt mutation isolation", () => {
  it("reuses one row for a workflow retry, clears stale artifacts, and fences old generations", async () => {
    const t = convexTest(schema, convexModules);
    const created = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs(),
    );
    expect(created).toMatchObject({
      created: true,
      acquired: true,
      restarted: false,
      status: "running",
      executionGeneration: 1,
    });
    const runningOverlap = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs({ workflowExecutionKey: "workflow:overlap-running" }),
    );
    expect(runningOverlap).toMatchObject({
      pipelineRunId: created.pipelineRunId,
      acquired: false,
      status: "running",
      executionGeneration: 1,
    });
    const fenceV1 = {
      workflowExecutionKey: "workflow:one",
      executionGeneration: 1,
    };
    await t.mutation(pipelineMutations.pipelineRunsMutations.appendStep, {
      pipelineRunId: created.pipelineRunId,
      runId: created.runId,
      ...fenceV1,
      name: "research.scope",
      status: "ok",
    });
    const streamId = await t.mutation(
      pipelineMutations.pipelineStreamMutations.startPipelineStream,
      {
        pipelineRunId: created.pipelineRunId,
        runId: created.runId,
        stepName: "research.synthesize",
        ...fenceV1,
      },
    );
    await t.mutation(
      pipelineMutations.pipelineStreamMutations.appendPipelineStreamChunk,
      { streamId, delta: "stale output", ...fenceV1 },
    );
    const documentId = await t.run(async (ctx: any) => {
      const userId = await ctx.db.insert("users", { email: "attempt@test.dev" });
      const documentId = await ctx.db.insert("documents", {
        title: "Stale output",
        isPublic: false,
        createdBy: userId,
        summary: `pipeline_run:${created.runId}`,
      });
      await ctx.db.patch(created.pipelineRunId, { outputDocumentId: documentId });
      return documentId;
    });
    await t.mutation(
      pipelineMutations.pipelineRunsMutations.transitionRunStatus,
      {
        pipelineRunId: created.pipelineRunId,
        ...fenceV1,
        status: "failed",
        verdict: "failed",
        inputTokens: 123,
        outputTokens: 456,
        estimatedUsd: 7.89,
        errorMessage: "first generation failed",
      },
    );

    const overlapping = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs({ workflowExecutionKey: "workflow:overlap" }),
    );
    expect(overlapping).toMatchObject({
      pipelineRunId: created.pipelineRunId,
      acquired: false,
      restarted: false,
      status: "failed",
      executionGeneration: 1,
    });

    const retry = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs(),
    );
    expect(retry).toMatchObject({
      pipelineRunId: created.pipelineRunId,
      acquired: true,
      restarted: true,
      status: "running",
      executionGeneration: 2,
    });

    const resetState = await t.run(async (ctx: any) => {
      const run = await ctx.db.get(created.pipelineRunId);
      const steps = await ctx.db
        .query("pipelineSteps")
        .withIndex("by_run", (q: any) =>
          q.eq("pipelineRunId", created.pipelineRunId),
        )
        .collect();
      const streams = await ctx.db
        .query("pipelineRunStreams")
        .withIndex("by_pipelineRunId", (q: any) =>
          q.eq("pipelineRunId", created.pipelineRunId),
        )
        .collect();
      return { run, steps, streams, document: await ctx.db.get(documentId) };
    });
    expect(resetState.steps).toEqual([]);
    expect(resetState.streams).toEqual([]);
    expect(resetState.document).toBeNull();
    expect(resetState.run).toMatchObject({
      status: "running",
      verdict: "in_progress",
      executionGeneration: 2,
    });
    for (const field of [
      "completedAt",
      "durationMs",
      "inputTokens",
      "outputTokens",
      "estimatedUsd",
      "outputDocumentId",
      "outputArchiveRowId",
      "outputZipStorageId",
      "errorMessage",
    ]) {
      expect(resetState.run).not.toHaveProperty(field);
    }

    const staleTransition = await t.mutation(
      pipelineMutations.pipelineRunsMutations.transitionRunStatus,
      {
        pipelineRunId: created.pipelineRunId,
        ...fenceV1,
        status: "succeeded",
        verdict: "verified",
      },
    );
    expect(staleTransition).toEqual({
      ok: false,
      reason: "stale_execution_generation",
    });
    const staleStep = await t.mutation(
      pipelineMutations.pipelineRunsMutations.appendStep,
      {
        pipelineRunId: created.pipelineRunId,
        runId: created.runId,
        ...fenceV1,
        name: "stale.step",
        status: "ok",
      },
    );
    expect(staleStep).toEqual({
      ok: false,
      reason: "stale_execution_generation",
    });
  }, 20_000);

  it("creates distinct rows for distinct force-fresh attempt keys", async () => {
    const t = convexTest(schema, convexModules);
    const first = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs(),
    );
    const secondAttempt = "manual:attempt-2";
    const second = await t.mutation(
      pipelineMutations.pipelineRunsMutations.createOrGetRun,
      runArgs({
        runId: "pipeline_attempt_2",
        attemptKey: secondAttempt,
        workflowExecutionKey: "workflow:two",
        idempotencyKey: buildPipelineIdempotencyKey({
          pipelineKind: "research",
          spec: "Investigate one bounded question",
          ownerKey: "user:test-owner",
          attemptKey: secondAttempt,
        }),
      }),
    );
    expect(second.pipelineRunId).not.toBe(first.pipelineRunId);
  }, 20_000);

  it("advances a due schedule occurrence exactly once", async () => {
    const t = convexTest(schema, convexModules);
    const scheduleId = await t.run(async (ctx: any) =>
      ctx.db.insert("scheduledPipelineRuns", {
        ownerKey: "user:schedule-owner",
        pipelineKind: "research",
        spec: "Scheduled question",
        modelId: "nodebench:auto-balanced",
        cadence: "daily",
        enabled: true,
        nextRunAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    const first = await t.mutation(
      pipelineMutations.pipelineSchedule.advanceSchedule,
      { scheduleId, dueNextRunAt: NOW, runId: "workflow-one", status: "kicked" },
    );
    const overlap = await t.mutation(
      pipelineMutations.pipelineSchedule.advanceSchedule,
      { scheduleId, dueNextRunAt: NOW, runId: "workflow-two", status: "kicked" },
    );
    expect(first).toEqual({ ok: true });
    expect(overlap).toEqual({
      ok: false,
      reason: "occurrence_already_advanced",
    });
    const row = await t.run(async (ctx: any) => ctx.db.get(scheduleId));
    expect(row.nextRunAt).toBe(NOW + 24 * 60 * 60 * 1_000);
    expect(row.lastRunId).toBe("workflow-one");
  }, 20_000);
});

describe("pipeline truth static guards", () => {
  it("keeps attempt propagation, occurrence refresh, reset fields, and truthful provenance names", () => {
    const pipelineDir = join(process.cwd(), "backend", "convex", "domains", "pipelines");
    const workflow = readFileSync(join(pipelineDir, "pipelineWorkflow.ts"), "utf8");
    const schedule = readFileSync(join(pipelineDir, "pipelineSchedule.ts"), "utf8");
    const lifecycle = readFileSync(
      join(pipelineDir, "pipelineRunsMutations.ts"),
      "utf8",
    );
    const research = readFileSync(join(pipelineDir, "researchPipeline.ts"), "utf8");
    expect(workflow).toContain("createManualPipelineAttemptKey()");
    expect(workflow).toContain("attemptKey, workflowExecutionKey");
    expect(schedule).toContain("buildScheduleOccurrenceAttemptKey");
    expect(schedule).toMatch(/forceFresh:\s*true/);
    expect(schedule).toContain("dueNextRunAt");
    for (const field of [
      "completedAt: undefined",
      "durationMs: undefined",
      "outputDocumentId: undefined",
      "outputArchiveRowId: undefined",
      "outputZipStorageId: undefined",
      "errorMessage: undefined",
    ]) {
      expect(lifecycle).toContain(field);
    }
    expect(research).toContain("sourcesConsulted: allSnippets");
    expect(research).toContain("citationsUsed");
    expect(research).not.toMatch(/\bsources:\s*allSnippets/);
    expect(research).not.toMatch(/\bcitations,\s*$/m);
  });
});
