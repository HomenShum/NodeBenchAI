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

describe.skipIf(!convexTestAvailable)("startPipelineRun model boundary", () => {
  it("rejects an unknown modelId and leaves pipelineLaunchAdmissions unchanged", async () => {
    const t = convexTest(schema, convexModules);
    const userId = await t.run(async (ctx: any) => ctx.db.insert("users", { email: "boundary@example.com" }));
    const user = t.withIdentity({ subject: String(userId) });
    const countAdmissions = () => t.run(async (ctx: any) => (await ctx.db.query("pipelineLaunchAdmissions").collect()).length);

    const before = await countAdmissions();
    await expect(
      user.mutation(pipelines.pipelineWorkflow.startPipelineRun, {
        pipelineKind: "research",
        spec: "Research a company",
        modelId: "gpt-9-ultra",
      }),
    ).rejects.toThrow(/Unknown model "gpt-9-ultra"/);
    expect(await countAdmissions()).toBe(before);
  }, 20_000);

  it("rejects an unknown modelId on the trusted internal entry point too", async () => {
    const t = convexTest(schema, convexModules);
    const countAdmissions = () => t.run(async (ctx: any) => (await ctx.db.query("pipelineLaunchAdmissions").collect()).length);
    const before = await countAdmissions();
    await expect(
      t.mutation(pipelines.pipelineWorkflow.startPipelineRunInternal, {
        pipelineKind: "research",
        spec: "Cron research",
        modelId: "openai:gpt-9",
        ownerKey: "user:cron-owner",
      }),
    ).rejects.toThrow(/Unknown model/);
    expect(await countAdmissions()).toBe(before);
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
    expect(await parseModelKey("openai:gpt-4o-mini")).toMatchObject({
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
