/**
 * Pi-AI Runtime Wrapper
 *
 * Thin facade over `@mariozechner/pi-ai` (`getModel` + `completeSimple`)
 * mirroring the contract of NodeBench's existing `getLanguageModelSafe`
 * resolver. Exposes:
 *
 *   - resolvePiModel(input)         → Pi-AI Model | null  (fallback chain)
 *   - runPiCompletion(args)         → { text, usage, scratchpad }
 *   - runPiOrAiSdkCompletion(args)  → pi-ai with AI SDK fallback
 *
 * Why a wrapper instead of using pi-ai directly:
 *   - Single place to enforce the agentic_reliability invariants:
 *       BOUND, HONEST_STATUS, TIMEOUT, BOUND_READ, ERROR_BOUNDARY.
 *   - Consistent fallback chain (primary model → free fallbacks → paid)
 *     matching `digestAgent.generateDigestWithFactChecks`'s pattern.
 *   - Lets us swap the underlying SDK later without touching pipelines.
 *
 * Pi-AI is ESM-only and uses `proxy-agent` + `undici`, so any caller
 * MUST use `"use node"` (Convex Node runtime). We enforce that here.
 *
 * Pi-AI 0.70.6 API surface (verified against installed dist):
 *   - getModel(providerId, modelId) → Model | null
 *   - completeSimple(model, { messages }, { maxTokens, temperature })
 *       → { content: [{ type: "text", text }], usage: {...}, stopReason }
 *   - registerBuiltInApiProviders() — must be called before getModel
 *
 * Pattern: thin-adapter (Anthropic Building Effective Agents, 2024).
 * Prior art: digestAgent fallback chain · model-resolver-2026.
 */

"use node";

export type PiProviderId =
  | "openai"
  | "openrouter"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "google-gemini-cli"
  | "openai-codex-responses"
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "mistral"
  | "amazon-bedrock";

export interface PiModelHandle {
  providerId: PiProviderId;
  modelId: string;
  requestedModelId: string;
  resolvedAlias?: string;
  /** Underlying pi-ai Model — `unknown` because the type isn't exposed. */
  raw: unknown;
}

export interface PiRunArgs {
  /** Either "openai:gpt-4o-mini" or just "gpt-4o-mini" form. */
  model: string;
  prompt: string;
  /** System prompt. */
  system?: string;
  /** Hard wall-clock cap in ms (TIMEOUT invariant). Default 60_000. */
  timeoutMs?: number;
  /**
   * Max output tokens (BOUND invariant). Default 2048.
   * Note: openai-responses requires >= 16; the wrapper clamps.
   */
  maxOutputTokens?: number;
  /** Temperature; default 0.4 to match digestAgent norms. */
  temperature?: number;
  /** Optional abort signal (cooperative cancellation). */
  signal?: AbortSignal;
}

export interface PiRunResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  };
  modelId: string;
  providerId: PiProviderId;
  stopReason: string;
  /** Best-effort scratchpad: serialized AssistantMessage for replay. */
  scratchpad: string;
}

let _piRegistered = false;

/**
 * Lazy import + register pi-ai's built-in providers exactly once per
 * process. Required before `getModel` will resolve any provider.
 */
async function loadPiAi(): Promise<{
  getModel: (provider: string, modelId: string) => unknown;
  completeSimple: (model: unknown, ctx: unknown, opts: unknown) => Promise<any>;
} | null> {
  try {
    const mod = (await import("@mariozechner/pi-ai" as string).catch(() => null)) as
      | {
          getModel?: (p: string, m: string) => unknown;
          completeSimple?: (m: unknown, c: unknown, o: unknown) => Promise<any>;
          registerBuiltInApiProviders?: () => void;
        }
      | null;
    if (!mod || !mod.getModel || !mod.completeSimple) return null;
    if (!_piRegistered) {
      mod.registerBuiltInApiProviders?.();
      _piRegistered = true;
    }
    return {
      getModel: mod.getModel,
      completeSimple: mod.completeSimple,
    };
  } catch {
    return null;
  }
}

function parseRawModelKey(input: string): {
  provider: PiProviderId;
  modelId: string;
  requestedModelId: string;
  resolvedAlias?: string;
} {
  const idx = input.indexOf(":");
  if (idx > 0 && idx < input.length - 1) {
    return {
      provider: input.slice(0, idx) as PiProviderId,
      modelId: input.slice(idx + 1),
      requestedModelId: input,
    };
  }
  if (input.startsWith("claude")) {
    return { provider: "anthropic", modelId: input, requestedModelId: input };
  }
  if (input.startsWith("gemini")) {
    return { provider: "google", modelId: input, requestedModelId: input };
  }
  return { provider: "openai", modelId: input, requestedModelId: input };
}

async function parseModelKey(input: string): Promise<{
  provider: PiProviderId;
  modelId: string;
  requestedModelId: string;
  resolvedAlias?: string;
}> {
  try {
    const { getModelSpec, resolvePipelineModelSelection } = await import(
      "../agents/mcp_tools/models/modelResolver"
    );
    const selection = resolvePipelineModelSelection(input);
    const spec = getModelSpec(selection.resolvedModelId);
    return {
      provider: spec.provider as PiProviderId,
      modelId: spec.sdkId,
      requestedModelId: selection.requestedModelId,
      resolvedAlias: selection.resolvedModelId,
    };
  } catch {
    return parseRawModelKey(input);
  }
}

/**
 * Resolve a pi-ai Model handle. Returns null when pi-ai isn't installed
 * or when the provider/model id isn't registered.
 */
export async function resolvePiModel(input: string): Promise<PiModelHandle | null> {
  const lib = await loadPiAi();
  if (!lib) return null;
  const { provider, modelId, requestedModelId, resolvedAlias } = await parseModelKey(input);
  try {
    const raw = lib.getModel(provider, modelId);
    if (!raw) return null;
    return { providerId: provider, modelId, requestedModelId, resolvedAlias, raw };
  } catch (e) {
    console.warn(
      `[piRuntime] resolvePiModel(${input}) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

function aggregateText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c && typeof c === "object" && (c as any).type === "text" && typeof (c as any).text === "string") {
      parts.push((c as any).text);
    }
  }
  return parts.join("");
}

/**
 * Run a single completion through pi-ai's `completeSimple`. Honors
 * agentic_reliability invariants: bounded output, honest status (throws
 * on failure rather than swallowing), explicit timeout, and structured
 * usage so the run-row's HONEST_SCORES gate can derive cost from real
 * data.
 *
 * Throws `pi_ai_not_installed` when the dep isn't installed; caller
 * can fall back via `runPiOrAiSdkCompletion`.
 */
export async function runPiCompletion(args: PiRunArgs): Promise<PiRunResult> {
  const lib = await loadPiAi();
  if (!lib) {
    const err = new Error("pi_ai_not_installed");
    (err as any).code = "pi_ai_not_installed";
    throw err;
  }

  const handle = await resolvePiModel(args.model);
  if (!handle) {
    const err = new Error("pi_ai_model_not_resolved");
    (err as any).code = "pi_ai_model_not_resolved";
    throw err;
  }

  const timeoutMs = args.timeoutMs ?? 60_000;
  // pi-ai openai-responses requires >=16; clamp + cap.
  const requested = args.maxOutputTokens ?? 2048;
  const maxTokens = Math.max(16, Math.min(requested, 8192));

  const controller = new AbortController();
  const upstream = args.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new Error("pi_runtime_timeout"));
  }, timeoutMs);

  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });

    const result = await lib.completeSimple(
      handle.raw,
      { messages },
      {
        maxTokens,
        temperature: args.temperature ?? 0.4,
        signal: controller.signal,
      },
    );

    if (result?.stopReason === "error") {
      const err = new Error(`pi_ai_error: ${result.errorMessage ?? "unknown"}`);
      (err as any).code = "pi_ai_error";
      (err as any).raw = result;
      throw err;
    }

    const text = aggregateText(result?.content);
    const usage = result?.usage ?? {};
    const inputTokens = typeof usage.input === "number" ? usage.input : 0;
    const outputTokens = typeof usage.output === "number" ? usage.output : 0;
    const estimatedUsd =
      typeof usage.cost?.total === "number"
        ? usage.cost.total
        : 0;

    return {
      text,
      usage: { inputTokens, outputTokens, estimatedUsd },
      modelId: handle.modelId,
      providerId: handle.providerId,
      stopReason: typeof result?.stopReason === "string" ? result.stopReason : "unknown",
      scratchpad: JSON.stringify(result).slice(0, 32_000),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PiStreamArgs extends PiRunArgs {
  /**
   * Callback fired for every text delta. Wire to PersistentTextStreaming's
   * `appendChunk` to persist while streaming.
   */
  onTextDelta: (delta: string) => Promise<void> | void;
}

/**
 * Stream a pi-ai completion. Drains pi-ai's `streamSimple` AsyncGenerator,
 * routes each delta to `onTextDelta`, and aggregates the final result so
 * the caller still gets honest tokens + cost. Falls back to single-shot
 * runPiCompletion if pi-ai's stream entry isn't available.
 *
 * The `onTextDelta` callback is also where a Convex
 * `@convex-dev/persistent-text-streaming` `appendChunk` would be wired —
 * caller owns the side-effect.
 */
export async function runPiCompletionStreamed(args: PiStreamArgs): Promise<PiRunResult> {
  const lib = (await import("@mariozechner/pi-ai" as string).catch(() => null)) as
    | {
        getModel?: (p: string, m: string) => unknown;
        registerBuiltInApiProviders?: () => void;
        streamSimple?: (m: unknown, c: unknown, o: unknown) => AsyncIterable<unknown>;
      }
    | null;
  if (!lib?.streamSimple) {
    // No streaming entry → fall back to the buffered path. Caller still
    // gets a one-shot delta via onTextDelta.
    const result = await runPiCompletion(args);
    if (result.text) await args.onTextDelta(result.text);
    return result;
  }

  if (!_piRegistered) {
    lib.registerBuiltInApiProviders?.();
    _piRegistered = true;
  }
  const handle = await resolvePiModel(args.model);
  if (!handle) {
    const err = new Error("pi_ai_model_not_resolved");
    (err as any).code = "pi_ai_model_not_resolved";
    throw err;
  }

  const timeoutMs = args.timeoutMs ?? 60_000;
  const requested = args.maxOutputTokens ?? 2048;
  const maxTokens = Math.max(16, Math.min(requested, 8192));
  const controller = new AbortController();
  const upstream = args.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("pi_runtime_timeout")), timeoutMs);

  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });

    let buffered = "";
    let finalUsage: any = null;
    let stopReason = "unknown";

    for await (const event of lib.streamSimple(
      handle.raw,
      { messages },
      { maxTokens, temperature: args.temperature ?? 0.4, signal: controller.signal },
    )) {
      const e = event as any;
      if (e?.type === "text_delta" && typeof e.delta === "string") {
        buffered += e.delta;
        await args.onTextDelta(e.delta);
      } else if (e?.type === "delta" && typeof e.text === "string") {
        buffered += e.text;
        await args.onTextDelta(e.text);
      } else if (e?.type === "complete" || e?.type === "stop" || e?.role === "assistant") {
        if (e.usage) finalUsage = e.usage;
        if (e.stopReason) stopReason = e.stopReason;
      }
    }

    return {
      text: buffered,
      usage: {
        inputTokens: typeof finalUsage?.input === "number" ? finalUsage.input : 0,
        outputTokens: typeof finalUsage?.output === "number" ? finalUsage.output : 0,
        estimatedUsd:
          typeof finalUsage?.cost?.total === "number" ? finalUsage.cost.total : 0,
      },
      modelId: handle.modelId,
      providerId: handle.providerId,
      stopReason,
      scratchpad: JSON.stringify({ streamed: true, len: buffered.length, stopReason }).slice(0, 32_000),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run pi-ai with explicit fallback to the existing Vercel AI SDK
 * resolver if pi-ai isn't installed or the model can't be resolved.
 * Lets pipelines ship green even before the dep lands.
 *
 * Catches: pi_ai_not_installed, pi_ai_model_not_resolved, pi_ai_error
 * with no provider key set, and transient upstream failures that can move
 * to the approved model fallback chain while preserving HONEST_STATUS.
 */
export async function runPiOrAiSdkCompletion(args: PiRunArgs): Promise<PiRunResult> {
  try {
    return await runPiCompletion(args);
  } catch (e) {
    const code = (e as any)?.code;
    const isFallback =
      code === "pi_ai_not_installed" ||
      code === "pi_ai_model_not_resolved" ||
      // Treat "no API key registered" as fallback-eligible so callers
      // running on AI-SDK-only env (Convex without pi-ai keys) succeed.
      (code === "pi_ai_error" &&
        typeof (e as any).message === "string" &&
        /api[_ ]?key|unauthorized|401|rate.?limit|429|502|503|504|temporar/i.test((e as any).message));
    if (!isFallback) throw e;

    // Fallback: AI SDK path.
    const ai = await import("ai");
    const {
      executeWithModelFallback,
      getModelSpec,
      resolvePipelineModelSelection,
    } = await import(
      "../agents/mcp_tools/models/modelResolver"
    );
    const selection = resolvePipelineModelSelection(args.model);
    const fallback = await executeWithModelFallback(
      async (model) =>
        ai.generateText({
          model,
          prompt: args.prompt,
          system: args.system,
          temperature: args.temperature ?? 0.4,
          maxOutputTokens: Math.max(16, Math.min(args.maxOutputTokens ?? 2048, 8192)),
          abortSignal: args.signal,
        }),
      {
        startModel: selection.resolvedModelId,
        onFallback: (fromModel, toModel, error) => {
          console.warn(
            `[piRuntime] AI SDK fallback moved ${fromModel} -> ${toModel}: ${error.message}`,
          );
        },
      },
    );
    const result = fallback.result;
    const spec = getModelSpec(fallback.modelUsed);
    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        estimatedUsd: 0,
      },
      modelId: fallback.modelUsed,
      providerId: spec.provider as PiProviderId,
      stopReason: typeof result.finishReason === "string" ? result.finishReason : "unknown",
      scratchpad: JSON.stringify({
        aiSdkFallback: true,
        requestedModelId: selection.requestedModelId,
        resolvedModelId: selection.resolvedModelId,
        modelUsed: fallback.modelUsed,
        isFree: fallback.isFree,
        fallbacksUsed: fallback.fallbacksUsed,
        finishReason: result.finishReason,
      }).slice(0, 32_000),
    };
  }
}
