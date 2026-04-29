/**
 * Design Generation Pipeline (pi-ai + OpenAI Images)
 *
 * Per-decision S23297/S23301 — generate design → decompose → verify →
 * iterate. v1 emits a single image and a structured component
 * decomposition; iteration is exposed via `forceFresh: true` re-runs.
 *
 * Steps:
 *   1. design.brief    — pi-ai parses the user's prompt into a brief
 *                        (palette, mood, key elements, target user).
 *   2. design.image    — OpenAI Images (`gpt-image-1`) generates the
 *                        screenshot. Stored as a Convex storage blob.
 *   3. design.decompose — pi-ai breaks the image into component tokens
 *                         (header, hero, cta, color tokens, typography).
 *   4. design.verify   — pi-ai reviews the decomposition against the
 *                        original brief; emits a verdict.
 *
 * Output handoff: image + decomposition stored as a single JSON blob
 * via `outputZipStorageId` (the runs table's existing field). No
 * documents row written v1 — keep export-only per S23264.
 *
 * Pi-ai handles all text. Image generation goes through the OpenAI
 * SDK directly (pi-ai is text-only at 0.70.6). Falls back to a stub
 * image when OPENAI_API_KEY isn't present so the pipeline ships green.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { runPiOrAiSdkCompletion } from "./piRuntime";
import { appendPipelineTraceEntry } from "./pipelineTrace";

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

function newRunId(): string {
  return `pipeline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimScratchpad(input: string, max = 32_000): string {
  return input.length > max ? input.slice(0, max - 3) + "..." : input;
}

interface DesignBrief {
  goal: string;
  targetUser: string;
  palette: string[];
  mood: string[];
  keyElements: string[];
}

interface DesignDecomposition {
  components: Array<{ name: string; role: string; copy?: string }>;
  tokens: { color: string[]; typography: string[]; spacing: string[] };
  notes: string[];
}

interface DesignVerdict {
  tier: "verified" | "provisionally_verified" | "needs_review" | "failed";
  passing: number;
  failing: number;
  notes: string[];
}

async function generateImageBytes(args: {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: args.prompt.slice(0, 4000),
        size: args.size ?? "1024x1024",
        n: 1,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`openai_images_${resp.status}: ${errText.slice(0, 280)}`);
    }
    const json: any = await resp.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string") {
      throw new Error("openai_images_no_b64");
    }
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { bytes, mimeType: "image/png" };
  } catch (e) {
    console.warn(
      "[designGenPipeline] image generation failed:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

export const runDesignGenPipeline = internalAction({
  args: {
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
    forceFresh: v.optional(v.boolean()),
    imageSize: v.optional(
      v.union(v.literal("1024x1024"), v.literal("1792x1024"), v.literal("1024x1792")),
    ),
  },
  returns: v.object({
    runId: v.string(),
    pipelineRunId: v.id("pipelineRuns"),
    status: v.string(),
    verdict: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    bundleStorageId: v.optional(v.id("_storage")),
    decomposition: v.optional(
      v.object({
        components: v.array(
          v.object({ name: v.string(), role: v.string(), copy: v.optional(v.string()) }),
        ),
        tokens: v.object({
          color: v.array(v.string()),
          typography: v.array(v.string()),
          spacing: v.array(v.string()),
        }),
        notes: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const pipelineKind = "design_gen" as const;
    const modelId = args.modelId ?? "openai:gpt-4o-mini";
    const title = args.title ?? args.spec.slice(0, 80);
    const idempotencyKey = stableHash(
      [pipelineKind, args.spec, args.ownerKey ?? "anon"].sort().join(" "),
    );
    const runId = newRunId();

    const create = await ctx.runMutation(
      internal.domains.pipelines.pipelineRunsMutations.createOrGetRun,
      {
        pipelineKind,
        title,
        spec: args.spec,
        modelId,
        ownerKey: args.ownerKey,
        runId,
        idempotencyKey,
      },
    );
    const pipelineRunId: Id<"pipelineRuns"> = create.pipelineRunId;
    const effectiveRunId = create.runId;

    if (
      !create.created &&
      !args.forceFresh &&
      (create.status === "succeeded" || create.status === "running")
    ) {
      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: create.status,
        verdict: undefined,
        imageStorageId: undefined,
        bundleStorageId: undefined,
        decomposition: undefined,
      };
    }

    await ctx.runMutation(
      internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
      { pipelineRunId, status: "running" },
    );

    let totalIn = 0;
    let totalOut = 0;
    let totalUsd = 0;
    let traceSeq = 0;

    const recordStep = async (
      name: string,
      status: "ok" | "error" | "skipped",
      input: { startedAt: number; tokens?: { in?: number; out?: number; usd?: number } },
      scratchpad?: string,
      errorMessage?: string,
      traceChoiceType:
        | "gather_info"
        | "execute_data_op"
        | "execute_output"
        | "finalize" = "execute_data_op",
      traceDescription?: string,
    ) => {
      const durationMs = Date.now() - input.startedAt;
      totalIn += input.tokens?.in ?? 0;
      totalOut += input.tokens?.out ?? 0;
      totalUsd += input.tokens?.usd ?? 0;
      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.appendStep,
        {
          pipelineRunId,
          runId: effectiveRunId,
          name,
          status,
          durationMs,
          inputTokens: input.tokens?.in,
          outputTokens: input.tokens?.out,
          estimatedUsd: input.tokens?.usd,
          modelId,
          scratchpad,
          errorMessage,
        },
      );
      await appendPipelineTraceEntry({
        ctx,
        runId: effectiveRunId,
        seq: traceSeq++,
        toolName: name,
        description: traceDescription ?? name,
        choiceType: traceChoiceType,
        durationMs,
        success: status === "ok",
        errorMessage,
        originalRequest: traceSeq === 1 ? args.spec.slice(0, 280) : undefined,
      });
    };

    try {
      // Step 1: design.brief
      const briefStart = Date.now();
      const briefRes = await runPiOrAiSdkCompletion({
        model: modelId,
        prompt: [
          "You are a senior product designer. Parse the brief into STRICT JSON:",
          "{ \"goal\": string, \"targetUser\": string, \"palette\": string[],",
          "  \"mood\": string[], \"keyElements\": string[] }",
          "",
          "Output ONLY JSON. No prose.",
          "",
          "BRIEF:",
          args.spec,
        ].join("\n"),
        temperature: 0.2,
        maxOutputTokens: 800,
        timeoutMs: 30_000,
      });
      let brief: DesignBrief;
      try {
        const cleaned = briefRes.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        brief = JSON.parse(cleaned);
      } catch {
        brief = {
          goal: args.spec.slice(0, 200),
          targetUser: "general",
          palette: [],
          mood: [],
          keyElements: [],
        };
      }
      await recordStep(
        "design.brief",
        "ok",
        {
          startedAt: briefStart,
          tokens: {
            in: briefRes.usage.inputTokens,
            out: briefRes.usage.outputTokens,
            usd: briefRes.usage.estimatedUsd,
          },
        },
        trimScratchpad(JSON.stringify({ raw: briefRes.text, brief })),
        undefined,
        "gather_info",
        `Parsed brief — palette[${brief.palette.length}] mood[${brief.mood.length}]`,
      );

      // Step 2: design.image — direct OpenAI call
      const imageStart = Date.now();
      const imagePrompt = [
        `Design a clean, modern UI screenshot for: ${brief.goal}`,
        brief.targetUser ? `Target user: ${brief.targetUser}` : "",
        brief.palette.length > 0 ? `Palette: ${brief.palette.join(", ")}` : "",
        brief.mood.length > 0 ? `Mood: ${brief.mood.join(", ")}` : "",
        brief.keyElements.length > 0 ? `Key elements: ${brief.keyElements.join(", ")}` : "",
        "Layout: balanced, generous whitespace, premium typography, real-looking copy.",
      ]
        .filter(Boolean)
        .join("\n");
      const imageResult = await generateImageBytes({
        prompt: imagePrompt,
        size: args.imageSize,
      });
      let imageStorageId: Id<"_storage"> | undefined = undefined;
      if (imageResult) {
        // Cast: Convex's Blob types don't include the Uint8Array overload.
        const blob = new Blob([imageResult.bytes as BlobPart], { type: imageResult.mimeType });
        imageStorageId = await ctx.storage.store(blob);
      }
      await recordStep(
        "design.image",
        imageStorageId ? "ok" : "skipped",
        { startedAt: imageStart },
        imageStorageId
          ? `image_storage_id=${imageStorageId} prompt_len=${imagePrompt.length}`
          : "no_api_key_or_failed",
        imageStorageId ? undefined : "image_generation_unavailable",
        "execute_data_op",
        imageStorageId
          ? `Generated image (${imageResult?.bytes.length ?? 0} bytes)`
          : "Skipped image (no OPENAI_API_KEY)",
      );

      // Step 3: design.decompose
      const decomposeStart = Date.now();
      const decomposeRes = await runPiOrAiSdkCompletion({
        model: modelId,
        prompt: [
          "Given the design brief, propose a component decomposition. STRICT JSON:",
          "{ \"components\": [ { \"name\": string, \"role\": string, \"copy\"?: string } ],",
          "  \"tokens\": { \"color\": string[], \"typography\": string[], \"spacing\": string[] },",
          "  \"notes\": string[] }",
          "",
          "Output ONLY JSON. No prose.",
          "",
          "BRIEF:",
          JSON.stringify(brief, null, 2),
        ].join("\n"),
        temperature: 0.3,
        maxOutputTokens: 1500,
        timeoutMs: 45_000,
      });
      let decomposition: DesignDecomposition;
      try {
        const cleaned = decomposeRes.text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        decomposition = JSON.parse(cleaned);
      } catch {
        decomposition = {
          components: [],
          tokens: { color: [], typography: [], spacing: [] },
          notes: ["decomposition parse failed; manual review required"],
        };
      }
      await recordStep(
        "design.decompose",
        decomposition.components.length > 0 ? "ok" : "error",
        {
          startedAt: decomposeStart,
          tokens: {
            in: decomposeRes.usage.inputTokens,
            out: decomposeRes.usage.outputTokens,
            usd: decomposeRes.usage.estimatedUsd,
          },
        },
        trimScratchpad(JSON.stringify({ raw: decomposeRes.text, decomposition })),
        decomposition.components.length === 0 ? "no_components" : undefined,
        "execute_data_op",
        `Decomposed into ${decomposition.components.length} component(s)`,
      );

      // Step 4: design.verify
      const verifyStart = Date.now();
      const verifyRes = await runPiOrAiSdkCompletion({
        model: modelId,
        prompt: [
          "You are reviewing the decomposition against the brief. STRICT JSON:",
          "{ \"tier\": \"verified\"|\"provisionally_verified\"|\"needs_review\"|\"failed\",",
          "  \"passing\": number, \"failing\": number, \"notes\": string[] }",
          "",
          "BRIEF:",
          JSON.stringify(brief, null, 2),
          "",
          "DECOMPOSITION:",
          JSON.stringify(decomposition, null, 2),
        ].join("\n"),
        temperature: 0.0,
        maxOutputTokens: 600,
        timeoutMs: 30_000,
      });
      let verdict: DesignVerdict;
      try {
        const cleaned = verifyRes.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        verdict = JSON.parse(cleaned);
      } catch {
        verdict = {
          tier: "needs_review",
          passing: 0,
          failing: 0,
          notes: ["judge returned non-JSON; manual review required"],
        };
      }
      await recordStep(
        "design.verify",
        "ok",
        {
          startedAt: verifyStart,
          tokens: {
            in: verifyRes.usage.inputTokens,
            out: verifyRes.usage.outputTokens,
            usd: verifyRes.usage.estimatedUsd,
          },
        },
        trimScratchpad(JSON.stringify({ raw: verifyRes.text, verdict })),
        undefined,
        "finalize",
        `Verdict: ${verdict.tier} (passing=${verdict.passing} failing=${verdict.failing})`,
      );

      const verdictTier =
        verdict.tier === "verified"
          ? "verified"
          : verdict.tier === "provisionally_verified"
            ? "provisionally_verified"
            : verdict.tier === "failed"
              ? "failed"
              : "needs_review";

      // Bundle persist (image ref + decomposition + brief).
      const persistStart = Date.now();
      let bundleStorageId: Id<"_storage"> | undefined = undefined;
      try {
        const bundleJson = JSON.stringify(
          {
            runId: effectiveRunId,
            pipelineKind,
            spec: args.spec,
            brief,
            imageStorageId,
            decomposition,
            verdict,
          },
          null,
          2,
        );
        const bundleBlob = new Blob([bundleJson], { type: "application/json" });
        bundleStorageId = await ctx.storage.store(bundleBlob);
      } catch (e) {
        console.warn(
          "[designGenPipeline] bundle.persist failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
      await recordStep(
        "bundle.persist",
        bundleStorageId ? "ok" : "skipped",
        { startedAt: persistStart },
        bundleStorageId ? `bundle_storage_id=${bundleStorageId}` : "no_storage_id",
        bundleStorageId ? undefined : "no_storage_id",
        "execute_output",
        bundleStorageId ? "Persisted bundle" : "Skipped bundle persistence",
      );

      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
        {
          pipelineRunId,
          status: verdictTier === "failed" ? "failed" : "succeeded",
          verdict: verdictTier as any,
          inputTokens: totalIn,
          outputTokens: totalOut,
          estimatedUsd: totalUsd,
          outputZipStorageId: bundleStorageId,
        },
      );

      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: verdictTier === "failed" ? "failed" : "succeeded",
        verdict: verdictTier,
        imageStorageId,
        bundleStorageId,
        decomposition,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
        {
          pipelineRunId,
          status: "failed",
          verdict: "failed",
          errorMessage: message,
          inputTokens: totalIn,
          outputTokens: totalOut,
          estimatedUsd: totalUsd,
        },
      );
      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: "failed",
        verdict: "failed",
        imageStorageId: undefined,
        bundleStorageId: undefined,
        decomposition: undefined,
      };
    }
  },
});
