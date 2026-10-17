/// <reference types="vite/client" />
/**
 * Pipeline launches fail closed on an unknown model id (SPEC-v9 A.0.10, A.2.10 PR 1).
 *
 * Persona: a signed-in user (or a stale client) starts a research pipeline with a model
 * id the resolver has never heard of. Before this change the id silently became the
 * paid DEFAULT_MODEL, and the only control in front of it was a per-window launch
 * counter that knows nothing about models or dollars. Now the launch is refused before
 * it consumes an admission slot or starts a workflow, and piRuntime never forwards the
 * raw id to pi-ai.
 */

import { describe, expect, it, vi } from "vitest";

import schema from "../../schema";
import { api } from "../../_generated/api";
import { UnknownModelError } from "../agents/mcp_tools/models/modelResolver";
import { PIPELINE_SHORT_WINDOW_LIMIT } from "./pipelineAdmission";
import { parseModelKey } from "./piRuntime";

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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [rerootGlobKey(key), loader]),
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

const pipelines = (api as any).domains.pipelines;

// The model check must run BEFORE admission. A Convex mutation rolls back its writes when it throws,
// so "the counter is unchanged afterwards" cannot tell the two orders apart. Filling the owner's launch
// window can: if admission ran first the error would be the limit error, not UnknownModelError.
async function fillLaunchWindow(t: any, ownerKey: string) {
  const now = Date.now();
  await t.run(async (ctx: any) =>
    ctx.db.insert("pipelineLaunchAdmissions", {
      ownerKey,
      shortWindowStartedAt: now,
      shortCount: PIPELINE_SHORT_WINDOW_LIMIT,
      dayWindowStartedAt: now,
      dayCount: PIPELINE_SHORT_WINDOW_LIMIT,
      updatedAt: now,
    }),
  );
}
const admissionCounts = (t: any) =>
  t.run(async (ctx: any) => (await ctx.db.query("pipelineLaunchAdmissions").collect()).map((r: any) => [r.ownerKey, r.shortCount]));

describe.skipIf(!convexTestAvailable)("startPipelineRun model boundary", () => {
  it("rejects an unknown modelId before admission: with the launch window full it still says UnknownModel", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) => ctx.db.insert("users", { email: "boundary@example.com" }));
    const user = t.withIdentity({ subject: String(userId) });
    await fillLaunchWindow(t, `user:${String(userId)}`);
    const before = await admissionCounts(t);

    // Control: a launch with a valid (omitted) model hits the full window, so the window really is full.
    await expect(
      user.mutation(pipelines.pipelineWorkflow.startPipelineRun, { pipelineKind: "research", spec: "Research a company" }),
    ).rejects.toThrow(/Pipeline launch limit reached/);

    await expect(
      user.mutation(pipelines.pipelineWorkflow.startPipelineRun, {
        pipelineKind: "research",
        spec: "Research a company",
        modelId: "gpt-9-ultra",
      }),
    ).rejects.toThrow(/Unknown model "gpt-9-ultra"/);
    expect(await admissionCounts(t)).toEqual(before);
  }, 20_000);

  it("rejects an unknown modelId on the trusted internal entry point before admission too", async () => {
    const t = convexTest(schema, convexModules);
    await fillLaunchWindow(t, "user:cron-owner");
    const before = await admissionCounts(t);
    await expect(
      t.mutation(pipelines.pipelineWorkflow.startPipelineRunInternal, {
        pipelineKind: "research",
        spec: "Cron research",
        ownerKey: "user:cron-owner",
      }),
    ).rejects.toThrow(/Pipeline launch limit reached/); // control: the window is full

    await expect(
      t.mutation(pipelines.pipelineWorkflow.startPipelineRunInternal, {
        pipelineKind: "research",
        spec: "Cron research",
        modelId: "openai:gpt-9",
        ownerKey: "user:cron-owner",
      }),
    ).rejects.toThrow(/Unknown model/);
    expect(await admissionCounts(t)).toEqual(before);
  }, 20_000);
});

// Round 4: the composed entry points reserved two admission units and started a workflow for any modelId
// ("constructor" included). Same-domain pair, same rule: validate first.
describe.skipIf(!convexTestAvailable)("startComposedPipelineRun model boundary", () => {
  const composed = { composition: "research_then_code", spec: "Research then build" };

  it("rejects an unknown modelId before admission: with the launch window full it still says UnknownModel", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) => ctx.db.insert("users", { email: "composed@example.com" }));
    const user = t.withIdentity({ subject: String(userId) });
    await fillLaunchWindow(t, `user:${String(userId)}`);
    const before = await admissionCounts(t);

    // Control: a launch with an omitted model hits the full window, so the window really is full.
    await expect(user.mutation(pipelines.pipelineWorkflow.startComposedPipelineRun, composed)).rejects.toThrow(/Pipeline launch limit reached/);

    for (const modelId of ["gpt-9-ultra", "constructor"]) {
      await expect(
        user.mutation(pipelines.pipelineWorkflow.startComposedPipelineRun, { ...composed, modelId }),
        modelId,
      ).rejects.toThrow(/Unknown model/);
    }
    expect(await admissionCounts(t)).toEqual(before);
  }, 20_000);

  it("rejects an unknown modelId on the trusted internal composed entry point before admission too", async () => {
    const t = convexTest(schema, convexModules);
    await fillLaunchWindow(t, "user:cron-owner");
    const before = await admissionCounts(t);
    await expect(
      t.mutation(pipelines.pipelineWorkflow.startComposedPipelineRunInternal, { ...composed, ownerKey: "user:cron-owner" }),
    ).rejects.toThrow(/Pipeline launch limit reached/); // control: the window is full

    for (const modelId of ["openai:gpt-9", "constructor"]) {
      await expect(
        t.mutation(pipelines.pipelineWorkflow.startComposedPipelineRunInternal, { ...composed, modelId, ownerKey: "user:cron-owner" }),
        modelId,
      ).rejects.toThrow(/Unknown model/);
    }
    expect(await admissionCounts(t)).toEqual(before);
  }, 20_000);
});

// Round 6: createSchedule stored an enabled hourly schedule for "constructor". The row counted toward the
// owner's schedule limit and startPipelineRunInternal then rejected it on every run.
describe.skipIf(!convexTestAvailable)("createSchedule model boundary", () => {
  const schedule = { pipelineKind: "research", spec: "Weekly research", cadence: "hourly" };
  const scheduleCount = (t: any) => t.run(async (ctx: any) => (await ctx.db.query("scheduledPipelineRuns").collect()).length);

  it("rejects an unknown modelId before inserting, and still accepts an omitted or known one", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) => ctx.db.insert("users", { email: "schedule@example.com" }));
    const user = t.withIdentity({ subject: String(userId) });

    for (const modelId of ["constructor", "gpt-9-ultra", "openai:gpt-9"]) {
      await expect(user.mutation(pipelines.pipelineSchedule.createSchedule, { ...schedule, modelId }), modelId).rejects.toThrow(/Unknown model/);
    }
    expect(await scheduleCount(t)).toBe(0);

    await user.mutation(pipelines.pipelineSchedule.createSchedule, schedule);
    await user.mutation(pipelines.pipelineSchedule.createSchedule, { ...schedule, modelId: "gpt-5.4-mini" });
    await user.mutation(pipelines.pipelineSchedule.createSchedule, { ...schedule, modelId: "x:free" });
    expect(await scheduleCount(t)).toBe(3);
  }, 20_000);
});

describe("piRuntime.parseModelKey", () => {
  it("throws for an unknown provider:model instead of returning a raw handle", async () => {
    // Before: the catch fell through to parseRawModelKey, which forwarded "gpt-9" to pi-ai.
    await expect(parseModelKey("openai:gpt-9")).rejects.toBeInstanceOf(UnknownModelError);
    await expect(parseModelKey("gpt-9-ultra")).rejects.toBeInstanceOf(UnknownModelError);
  });

  it("still resolves approved aliases, route aliases and free-looking ids", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // was "openai:gpt-4o-mini" -> gpt-5.4-mini; a known id is refused, not rerouted, since Homen D1 (PR #662 round 8)
    expect(await parseModelKey("openai:gpt-5.4-mini")).toMatchObject({
      provider: "openai",
      modelId: "gpt-5.4-mini",
      resolvedAlias: "gpt-5.4-mini",
    });
    expect(await parseModelKey("nodebench:auto-balanced")).toMatchObject({ resolvedAlias: "kimi-k2.6" });
    expect(await parseModelKey("x:free")).toMatchObject({
      provider: "openrouter",
      modelId: "nvidia/nemotron-3-super-120b-a12b:free",
    });
    vi.restoreAllMocks();
  });
});
