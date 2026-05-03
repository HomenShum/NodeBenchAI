/**
 * Model Resolver - 2026 Consolidated LLM Model Registry
 *
 * This is the SINGLE SOURCE OF TRUTH for model selection across NodeBench.
 * Current approved models include the GPT-5.4 family, current Claude 4.x family,
 * current Gemini 3.x / 2.5 families, and OpenRouter frontier models.
 *
 * POLICY:
 * - UI shows ONLY the approved ALIASES (e.g., "gpt-5.2", "gemini-3-flash")
 * - Dated SDK IDs are INTERNAL ONLY (stored in ModelSpec.sdkId)
 * - Every resolution logs BOTH requestedAlias and resolvedSdkId
 * - Default model is kimi-k2.6 via OpenRouter for the primary NodeBench agent lane
 *
 * @see MODEL_CONSOLIDATION_PLAN.md for architecture details
 * @updated April 22, 2026 - Primary default switched to Kimi K2.6 via OpenRouter
 */

import { createOpenAI, openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

// ═══════════════════════════════════════════════════════════════════════════
// OPENROUTER PROVIDER SETUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create OpenRouter provider with API key from environment
 * Falls back gracefully if key not available
 */
function getOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("[modelResolver] OPENROUTER_API_KEY not set, OpenRouter models unavailable");
    return null;
  }

  // Use OpenRouter's OpenAI-compatible API. This avoids provider-specific metadata
  // shape mismatches in downstream storage/validators.
  const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_X_TITLE) headers["X-Title"] = process.env.OPENROUTER_X_TITLE;

  return createOpenAI({
    apiKey,
    baseURL,
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

function getGoogleProvider() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[modelResolver] Google API key not set (checked GEMINI_API_KEY, GOOGLE_AI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY), Google models unavailable",
    );
    return null;
  }

  return createGoogleGenerativeAI({ apiKey });
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (Convex backend cannot import from src/shared)
// These MUST match src/shared/llm/approvedModels.ts exactly
// ═══════════════════════════════════════════════════════════════════════════

export type Provider = "openai" | "anthropic" | "google" | "openrouter";

/**
 * The approved model aliases - includes native providers + OpenRouter models
 * OpenRouter models provide access to additional frontier models at competitive pricing
 *
 * LATEST MODELS (Jan 2026):
 * - DeepSeek R1: Reasoning model, open weights ($0.70/M in)
 * - DeepSeek V3.2 Speciale: Agentic variant ($0.27/M in)
 * - Qwen3 235B: Latest Qwen with tool calling ($0.18/M in)
 */
export const APPROVED_MODELS = [
  // Native providers (direct API)
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "claude-opus-4.7",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "claude-opus-4.1",
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-3.5",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  // OpenRouter priced models (Jan 2026)
  "glm-4.7-flash",     // GLM 4.7 Flash - fast, agentic coding ($0.07/$0.40)
  "glm-4.7",           // GLM 4.7 - flagship ($0.40/$1.50)
  "kimi-k2.6",         // MoonshotAI Kimi K2.6 - long-horizon coding/research ($0.75/$3.50)
  "deepseek-r1",       // DeepSeek R1 - reasoning model $0.70/M
  "deepseek-v3.2-speciale", // DeepSeek V3.2 Speciale - agentic variant $0.27/M
  "deepseek-v3.2",     // DeepSeek V3.2 - general purpose $0.25/M
  "qwen3-235b",        // Qwen3 235B - latest Qwen $0.18/M
  "minimax-m2.7",      // MiniMax M2.7 - agentic executor lane $0.30/$1.20
  "mistral-large",     // Mistral Large 2411 - function calling $2/M
  // OpenRouter free-tier models (verified Feb 5, 2026 via API)
  "qwen3-coder-free",  // Qwen3 Coder 480B MoE (A3.5B) - 262K, agentic coding
  "step-3.5-flash-free", // StepFun Step 3.5 Flash 196B MoE (11B) - 256K, reasoning
  "gpt-oss-120b-free", // OpenAI open-source 120B - 131K, tools
  "qwen3-next-free",   // Qwen3 Next 80B A3B - 262K, tools
  "trinity-large-free", // Arcee Trinity Large 400B MoE (13B) - 131K, agentic
  "nemotron-3-nano-free", // NVIDIA Nemotron 3 Nano 30B A3B - 256K, tools
  "mistral-small-3.1-free", // Mistral Small 3.1 24B - 128K, tools
  "llama-3.3-70b-free", // Meta Llama 3.3 70B - 128K, tools
  "gemma-3-27b-free",  // Google Gemma 3 27B - 131K, tools
  "gpt-oss-20b-free",  // OpenAI open-source 20B - 131K, tools
  "trinity-mini-free", // Arcee Trinity Mini MoE - 131K, agentic
  "nemotron-nano-12b-vl-free", // NVIDIA Nemotron Nano 12B VL - 128K, vision+tools
  // Still available from Jan 2026
  "deepseek-r1-free",  // DeepSeek R1 - reasoning model
  "glm-4.5-air-free",  // GLM 4.5 Air - agent-focused
  "deepseek-chimera-free", // TNG R1T2 Chimera - 164K
  "venice-dolphin-free", // Venice Dolphin Mistral 24B
] as const;

export type ApprovedModel = (typeof APPROVED_MODELS)[number];

// PRODUCTION-FIRST STRATEGY: default to the strongest current shipping lane.
// Free / cheap models remain available for experiments and explicit budget lanes.
export const DEFAULT_MODEL: ApprovedModel = "kimi-k2.6";

// Fallback model when the primary lane is unavailable or over budget
export const FALLBACK_MODEL: ApprovedModel = "gpt-5.4-mini";

// Model priority order for production-first routing
export const MODEL_PRIORITY_ORDER: ApprovedModel[] = [
  // PRIMARY SHIPPING LANES
  "kimi-k2.6",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "minimax-m2.7",
  "gpt-5.4-mini",
  "gpt-5.4",
  "claude-sonnet-4.6",
  "claude-opus-4.7",
  "claude-haiku-4.5",
  "gpt-5.4-nano",
  // EXPERIMENTAL / FREE LANES
  "qwen3-coder-free",       // 480B MoE, agentic coding
  "step-3.5-flash-free",    // 196B MoE, reasoning + tools
  "gpt-oss-120b-free",      // OpenAI open-source 120B
  "trinity-large-free",     // Arcee 400B MoE, agentic
  "nemotron-3-nano-free",   // NVIDIA 30B A3B, 256K
  "qwen3-next-free",        // Qwen3 Next 80B A3B
  "llama-3.3-70b-free",     // Meta Llama 3.3 70B
  "glm-4.5-air-free",       // GLM 4.5 Air
  "deepseek-r1-free",       // DeepSeek R1 reasoning
  "deepseek-chimera-free",  // TNG Chimera
  "venice-dolphin-free",    // Venice Dolphin 24B
];

/**
 * Check if a string is a valid approved model
 */
export function isApprovedModel(model: string): model is ApprovedModel {
  return (APPROVED_MODELS as readonly string[]).includes(model);
}

export type NodeBenchRuntimeProfile = "advisor" | "executor" | "background";

export const NODEBENCH_ADVISOR_MODEL: ApprovedModel = "kimi-k2.6";

export const NODEBENCH_EXECUTOR_MODELS: ApprovedModel[] = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "minimax-m2.7",
  "gpt-5.4-mini",
  "kimi-k2.6",
];

export const NODEBENCH_BACKGROUND_MODELS: ApprovedModel[] = [
  "gemini-3.1-pro-preview",
  "gpt-5.4",
  "kimi-k2.6",
  "gemini-3-flash-preview",
];

const NODEBENCH_ADVISOR_ALLOWED = new Set<ApprovedModel>([
  "kimi-k2.6",
  "gemini-3.1-pro-preview",
  "gpt-5.4",
  "gpt-5.4-mini",
  "minimax-m2.7",
  "gemini-3-flash-preview",
]);

const NODEBENCH_EXECUTOR_ALLOWED = new Set<ApprovedModel>([
  ...NODEBENCH_EXECUTOR_MODELS,
  "gpt-5.4-nano",
]);

const NODEBENCH_BACKGROUND_ALLOWED = new Set<ApprovedModel>(NODEBENCH_BACKGROUND_MODELS);

export function normalizeNodeBenchRuntimeModel(
  input: string | undefined | null,
  profile: NodeBenchRuntimeProfile = "advisor",
): ApprovedModel {
  const resolved = input ? resolveModelAlias(input) : null;
  const fallback =
    profile === "advisor"
      ? NODEBENCH_ADVISOR_MODEL
      : profile === "background"
        ? NODEBENCH_BACKGROUND_MODELS[0]
        : NODEBENCH_EXECUTOR_MODELS[0];

  if (!resolved) {
    return fallback;
  }

  if (profile === "advisor" && NODEBENCH_ADVISOR_ALLOWED.has(resolved)) {
    return resolved;
  }
  if (profile === "executor" && NODEBENCH_EXECUTOR_ALLOWED.has(resolved)) {
    return resolved;
  }
  if (profile === "background" && NODEBENCH_BACKGROUND_ALLOWED.has(resolved)) {
    return resolved;
  }

  return fallback;
}

export type NodeBenchModelRouteTier = "balanced" | "free" | "frontier" | "fast" | "small";

export interface PipelineModelSelectionResolution {
  requestedModelId: string;
  resolvedModelId: ApprovedModel;
  routeTier?: NodeBenchModelRouteTier;
  isFreeRoute: boolean;
  usedDefault: boolean;
}

export const DEFAULT_PIPELINE_MODEL_ROUTE = "nodebench:auto-balanced";

function stripProviderPrefix(input: string): string {
  const match = input.match(/^(openai|anthropic|google|openrouter):(.+)$/i);
  return match ? match[2].trim() : input;
}

function routeAliasToModel(input: string): {
  routeTier: NodeBenchModelRouteTier;
  modelId: ApprovedModel;
} | null {
  switch (input) {
    case "auto":
    case "balanced":
    case "auto-balanced":
    case "nodebench:auto-balanced":
    case "kilo-auto/balanced":
      return { routeTier: "balanced", modelId: DEFAULT_MODEL };
    case "public-research":
    case "nodebench:auto-public-research":
    case "kilo-auto/public-research":
      return { routeTier: "balanced", modelId: "glm-4.7-flash" };
    case "free":
    case "auto-free":
    case "nodebench:auto-free":
    case "kilo-auto/free":
    case "openrouter/free":
      return { routeTier: "free", modelId: getBestFreeModel() };
    case "frontier":
    case "best":
    case "best-quality":
    case "auto-frontier":
    case "nodebench:auto-frontier":
    case "kilo-auto/frontier":
      return { routeTier: "frontier", modelId: "gpt-5.4" };
    case "fast":
    case "small":
    case "auto-fast":
    case "auto-small":
    case "nodebench:auto-fast":
    case "kilo-auto/small":
      return { routeTier: "fast", modelId: "gemini-3.1-flash-lite-preview" };
    default:
      return null;
  }
}

/**
 * Normalize untrusted pipeline UI / MCP model input into an approved runtime
 * alias. This is the Convex-side mirror of the Reports selector and accepts
 * Kilo-style route aliases without letting arbitrary provider strings through.
 */
export function resolvePipelineModelSelection(
  input: string | undefined | null,
): PipelineModelSelectionResolution {
  const requestedModelId = String(input?.trim() || DEFAULT_PIPELINE_MODEL_ROUTE);
  const normalized = requestedModelId.toLowerCase();
  const route = routeAliasToModel(normalized);
  if (route) {
    return {
      requestedModelId,
      resolvedModelId: route.modelId,
      routeTier: route.routeTier,
      isFreeRoute: route.routeTier === "free",
      usedDefault: !input,
    };
  }

  const stripped = stripProviderPrefix(normalized);
  const resolved =
    resolveModelAlias(requestedModelId) ??
    resolveModelAlias(normalized) ??
    resolveModelAlias(stripped);

  return {
    requestedModelId,
    resolvedModelId: resolved ?? DEFAULT_MODEL,
    isFreeRoute: resolved ? isFreeModel(resolved) : false,
    usedDefault: !resolved,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Model capabilities - used for runtime enforcement
 */
export interface ModelCapabilities {
  vision: boolean;
  toolUse: boolean;
  streaming: boolean;
  structuredOutputs: boolean;
  maxContext: number;
}

/**
 * Model pricing per million tokens (for cost tracking)
 */
export interface ModelPricing {
  inputPerMillion: number;   // USD per 1M input tokens
  outputPerMillion: number;  // USD per 1M output tokens
}

/**
 * Model specification with full metadata
 * - alias: User-facing model name (shown in UI)
 * - sdkId: Provider-specific ID sent to API (internal, may include dates)
 * - pricing: Cost per million tokens for tracking
 */
export interface ModelSpec {
  alias: ApprovedModel;
  provider: Provider;
  sdkId: string;                    // Actual SDK model ID (internal)
  capabilities: ModelCapabilities;
  pricing: ModelPricing;            // Cost tracking (Jan 2026 prices)
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY - THE SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════════════

export const MODEL_SPECS: Record<ApprovedModel, ModelSpec> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // NATIVE PROVIDERS - Direct API access
  // ═══════════════════════════════════════════════════════════════════════════
  "gpt-5.4": {
    alias: "gpt-5.4",
    provider: "openai",
    sdkId: "gpt-5.4",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_050_000 },
    pricing: { inputPerMillion: 2.50, outputPerMillion: 15.00 },
  },
  "gpt-5.4-mini": {
    alias: "gpt-5.4-mini",
    provider: "openai",
    sdkId: "gpt-5.4-mini",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 400_000 },
    pricing: { inputPerMillion: 0.75, outputPerMillion: 4.50 },
  },
  "gpt-5.4-nano": {
    alias: "gpt-5.4-nano",
    provider: "openai",
    sdkId: "gpt-5.4-nano",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 400_000 },
    pricing: { inputPerMillion: 0.20, outputPerMillion: 1.25 },
  },
  "claude-opus-4.7": {
    alias: "claude-opus-4.7",
    provider: "anthropic",
    sdkId: "claude-opus-4-7",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_000_000 },
    pricing: { inputPerMillion: 5.00, outputPerMillion: 25.00 },
  },
  "claude-sonnet-4.6": {
    alias: "claude-sonnet-4.6",
    provider: "anthropic",
    sdkId: "claude-sonnet-4-6",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_000_000 },
    pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  },
  "claude-haiku-4.5": {
    alias: "claude-haiku-4.5",
    provider: "anthropic",
    sdkId: "claude-haiku-4-5",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 1.00, outputPerMillion: 5.00 },
  },
  "claude-opus-4.1": {
    alias: "claude-opus-4.1",
    provider: "anthropic",
    sdkId: "claude-opus-4-1-20250805",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  },
  "claude-opus-4": {
    alias: "claude-opus-4",
    provider: "anthropic",
    sdkId: "claude-opus-4-20250514",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  },
  "claude-sonnet-4": {
    alias: "claude-sonnet-4",
    provider: "anthropic",
    sdkId: "claude-sonnet-4-20250514",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  },
  "claude-haiku-3.5": {
    alias: "claude-haiku-3.5",
    provider: "anthropic",
    sdkId: "claude-3-5-haiku-20241022",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  },
  "gemini-3.1-pro-preview": {
    alias: "gemini-3.1-pro-preview",
    provider: "google",
    sdkId: "gemini-3.1-pro-preview",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_000_000 },
    pricing: { inputPerMillion: 2.00, outputPerMillion: 12.00 },
  },
  "gemini-3-flash-preview": {
    alias: "gemini-3-flash-preview",
    provider: "google",
    sdkId: "gemini-3-flash-preview",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_000_000 },
    pricing: { inputPerMillion: 0.50, outputPerMillion: 3.00 },
  },
  "gemini-3.1-flash-lite-preview": {
    alias: "gemini-3.1-flash-lite-preview",
    provider: "google",
    sdkId: "gemini-3.1-flash-lite-preview",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_000_000 },
    pricing: { inputPerMillion: 0.25, outputPerMillion: 1.50 },
  },
  "gemini-2.5-pro": {
    alias: "gemini-2.5-pro",
    provider: "google",
    sdkId: "gemini-2.5-pro",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_048_576 },
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  },
  "gemini-2.5-flash": {
    alias: "gemini-2.5-flash",
    provider: "google",
    sdkId: "gemini-2.5-flash",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_048_576 },
    pricing: { inputPerMillion: 0.30, outputPerMillion: 2.50 },
  },
  "gemini-2.5-flash-lite": {
    alias: "gemini-2.5-flash-lite",
    provider: "google",
    sdkId: "gemini-2.5-flash-lite",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 1_048_576 },
    pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // OPENROUTER MODELS - Latest frontier models via unified API (Jan 2026)
  // ═══════════════════════════════════════════════════════════════════════════
  "deepseek-r1": {
    alias: "deepseek-r1",
    provider: "openrouter",
    sdkId: "deepseek/deepseek-r1",  // DeepSeek R1 - reasoning model (Jan 20, 2025)
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 163_840 },
    pricing: { inputPerMillion: 0.70, outputPerMillion: 2.40 },
  },
  "deepseek-v3.2-speciale": {
    alias: "deepseek-v3.2-speciale",
    provider: "openrouter",
    sdkId: "deepseek/deepseek-v3.2-speciale",  // DeepSeek V3.2 Speciale - agentic variant
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 163_840 },
    pricing: { inputPerMillion: 0.27, outputPerMillion: 0.41 },
  },
  "deepseek-v3.2": {
    alias: "deepseek-v3.2",
    provider: "openrouter",
    sdkId: "deepseek/deepseek-v3.2",  // DeepSeek V3.2 - general purpose
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 163_840 },
    pricing: { inputPerMillion: 0.25, outputPerMillion: 0.38 },
  },
  "qwen3-235b": {
    alias: "qwen3-235b",
    provider: "openrouter",
    sdkId: "qwen/qwen3-235b-a22b",  // Qwen3 235B - latest with tool calling
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.18, outputPerMillion: 0.54 },
  },
  "minimax-m2.7": {
    alias: "minimax-m2.7",
    provider: "openrouter",
    sdkId: "minimax/minimax-m2.7",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 196_608 },
    pricing: { inputPerMillion: 0.30, outputPerMillion: 1.20 },
  },
  "mistral-large": {
    alias: "mistral-large",
    provider: "openrouter",
    sdkId: "mistralai/mistral-large-2411",  // Mistral Large 2411 - improved function calling
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_072 },
    pricing: { inputPerMillion: 2.00, outputPerMillion: 6.00 },
  },
  "glm-4.7-flash": {
    alias: "glm-4.7-flash",
    provider: "openrouter",
    sdkId: "z-ai/glm-4.7-flash", // Canonical: z-ai/glm-4.7-flash-20260119
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 200_000 },
    pricing: { inputPerMillion: 0.07, outputPerMillion: 0.40 },
  },
  "glm-4.7": {
    alias: "glm-4.7",
    provider: "openrouter",
    sdkId: "z-ai/glm-4.7", // Canonical: z-ai/glm-4.7-20251222
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 202_752 },
    pricing: { inputPerMillion: 0.40, outputPerMillion: 1.50 },
  },
  "kimi-k2.6": {
    alias: "kimi-k2.6",
    provider: "openrouter",
    sdkId: "moonshotai/kimi-k2.6",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 262_144 },
    pricing: { inputPerMillion: 0.75, outputPerMillion: 3.50 },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // OPENROUTER FREE-TIER MODELS - Verified Feb 5, 2026 via API
  // All models below confirmed available with pricing prompt=0, completion=0
  // ═══════════════════════════════════════════════════════════════════════════
  "qwen3-coder-free": {
    alias: "qwen3-coder-free",
    provider: "openrouter",
    sdkId: "qwen/qwen3-coder:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 262_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "step-3.5-flash-free": {
    alias: "step-3.5-flash-free",
    provider: "openrouter",
    sdkId: "stepfun/step-3.5-flash:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 256_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "gpt-oss-120b-free": {
    alias: "gpt-oss-120b-free",
    provider: "openrouter",
    sdkId: "openai/gpt-oss-120b:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "qwen3-next-free": {
    alias: "qwen3-next-free",
    provider: "openrouter",
    sdkId: "qwen/qwen3-next-80b-a3b-instruct:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 262_144 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "trinity-large-free": {
    alias: "trinity-large-free",
    provider: "openrouter",
    sdkId: "arcee-ai/trinity-large-preview:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "nemotron-3-nano-free": {
    alias: "nemotron-3-nano-free",
    provider: "openrouter",
    sdkId: "nvidia/nemotron-3-nano-30b-a3b:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 256_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "mistral-small-3.1-free": {
    alias: "mistral-small-3.1-free",
    provider: "openrouter",
    sdkId: "mistralai/mistral-small-3.1-24b-instruct:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 128_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "llama-3.3-70b-free": {
    alias: "llama-3.3-70b-free",
    provider: "openrouter",
    sdkId: "meta-llama/llama-3.3-70b-instruct:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 128_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "gemma-3-27b-free": {
    alias: "gemma-3-27b-free",
    provider: "openrouter",
    sdkId: "google/gemma-3-27b-it:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "gpt-oss-20b-free": {
    alias: "gpt-oss-20b-free",
    provider: "openrouter",
    sdkId: "openai/gpt-oss-20b:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "trinity-mini-free": {
    alias: "trinity-mini-free",
    provider: "openrouter",
    sdkId: "arcee-ai/trinity-mini:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: true, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "nemotron-nano-12b-vl-free": {
    alias: "nemotron-nano-12b-vl-free",
    provider: "openrouter",
    sdkId: "nvidia/nemotron-nano-12b-v2-vl:free",
    capabilities: { vision: true, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 128_000 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "deepseek-r1-free": {
    alias: "deepseek-r1-free",
    provider: "openrouter",
    sdkId: "deepseek/deepseek-r1-0528:free",
    capabilities: { vision: false, toolUse: false, streaming: true, structuredOutputs: false, maxContext: 163_840 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "glm-4.5-air-free": {
    alias: "glm-4.5-air-free",
    provider: "openrouter",
    sdkId: "z-ai/glm-4.5-air:free",
    capabilities: { vision: false, toolUse: true, streaming: true, structuredOutputs: false, maxContext: 131_072 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "deepseek-chimera-free": {
    alias: "deepseek-chimera-free",
    provider: "openrouter",
    sdkId: "tngtech/deepseek-r1t2-chimera:free",
    capabilities: { vision: false, toolUse: false, streaming: true, structuredOutputs: false, maxContext: 163_840 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
  "venice-dolphin-free": {
    alias: "venice-dolphin-free",
    provider: "openrouter",
    sdkId: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    capabilities: { vision: false, toolUse: false, streaming: true, structuredOutputs: false, maxContext: 32_768 },
    pricing: { inputPerMillion: 0.00, outputPerMillion: 0.00 },
  },
};

/**
 * Legacy aliases for backward compatibility
 * Maps old model names to approved models
 */
export const LEGACY_ALIASES: Record<string, ApprovedModel> = {
  // Old GPT names → appropriate models
  "gpt-5.2": "gpt-5.4",
  "gpt-5.1": "gpt-5.4",
  "gpt-5.1-codex": "gpt-5.4",
  "gpt-5": "gpt-5.4",
  "gpt-5-mini": "gpt-5.4-mini",
  "gpt-5-nano": "gpt-5.4-nano",
  "gpt-5-chat-latest": "gpt-5.4",
  "gpt-4.1-mini": "gpt-5.4-mini",
  "gpt-4.1-nano": "gpt-5.4-nano",
  "gpt-4o": "gpt-5.4",
  "gpt-4o-mini": "gpt-5.4-mini",
  // Anthropic current families and legacy compatibility aliases
  "claude-opus-4.6": "claude-opus-4.7",
  "claude-opus-4.5": "claude-opus-4.7",
  "claude-sonnet-4.5": "claude-sonnet-4.6",
  "claude-opus-4-7": "claude-opus-4.7",
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "claude-haiku-4-5": "claude-haiku-4.5",
  "claude-haiku-4-5-20251001": "claude-haiku-4.5",
  "claude-opus-4-1-20250805": "claude-opus-4.1",
  "claude-opus-4-20250514": "claude-opus-4",
  "claude-sonnet-4-20250514": "claude-sonnet-4",
  "claude-3-5-haiku-20241022": "claude-haiku-3.5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4",
  "claude-opus-4-5-20251101": "claude-opus-4",
  "claude-sonnet": "claude-sonnet-4.6",
  "claude-opus": "claude-opus-4.7",
  "claude-haiku": "claude-haiku-4.5",
  "claude": "claude-sonnet-4.6",
  // Old Gemini names → current Gemini 3 / 2.5 aliases
  "gemini-3-pro": "gemini-3.1-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview-lite": "gemini-3.1-flash-lite-preview",
  "gemini-flash": "gemini-3-flash-preview",
  "gemini-pro": "gemini-3.1-pro-preview",
  "gemini": "gemini-3-flash-preview",

  // Retired free models → redirect to best available free replacement
  "mimo-v2-flash-free": "qwen3-coder-free",
  "xiaomi/mimo-v2-flash:free": "qwen3-coder-free",
  "xiaomi/mimo-v2-flash": "qwen3-coder-free",
  "mimo": "qwen3-coder-free",
  "mimo-v2": "qwen3-coder-free",
  "devstral-2-free": "qwen3-coder-free",
  "mistralai/devstral-2:free": "qwen3-coder-free",
  "devstral-2": "qwen3-coder-free",
  "devstral": "qwen3-coder-free",
  "llama-4-maverick-free": "llama-3.3-70b-free",
  "meta-llama/llama-4-maverick:free": "llama-3.3-70b-free",
  "llama-4-maverick": "llama-3.3-70b-free",
  "llama-4": "llama-3.3-70b-free",
  "llama-4-scout-free": "llama-3.3-70b-free",
  "meta-llama/llama-4-scout:free": "llama-3.3-70b-free",
  "llama-4-scout": "llama-3.3-70b-free",
  "kat-coder-pro-free": "qwen3-coder-free",
  "kwaipilot/kat-coder-pro:free": "qwen3-coder-free",
  "kat-coder": "qwen3-coder-free",
  "kat-coder-pro": "qwen3-coder-free",
  "grok-4-fast-free": "step-3.5-flash-free",
  "x-ai/grok-4-fast:free": "step-3.5-flash-free",
  "grok-4-fast": "step-3.5-flash-free",
  "grok-4": "step-3.5-flash-free",
  "grok": "step-3.5-flash-free",
  "nemotron-free": "nemotron-3-nano-free",
  "nvidia/llama-3.1-nemotron-70b-instruct:free": "nemotron-3-nano-free",
  "nemotron": "nemotron-3-nano-free",
  "nemotron-70b": "nemotron-3-nano-free",
  // New free model aliases (Feb 2026)
  "qwen/qwen3-coder:free": "qwen3-coder-free",
  "qwen3-coder": "qwen3-coder-free",
  "stepfun/step-3.5-flash:free": "step-3.5-flash-free",
  "step-3.5-flash": "step-3.5-flash-free",
  "openai/gpt-oss-120b:free": "gpt-oss-120b-free",
  "gpt-oss-120b": "gpt-oss-120b-free",
  "gpt-oss": "gpt-oss-120b-free",
  "qwen/qwen3-next-80b-a3b-instruct:free": "qwen3-next-free",
  "qwen3-next": "qwen3-next-free",
  "arcee-ai/trinity-large-preview:free": "trinity-large-free",
  "trinity-large": "trinity-large-free",
  "trinity": "trinity-large-free",
  "nvidia/nemotron-3-nano-30b-a3b:free": "nemotron-3-nano-free",
  "nemotron-3-nano": "nemotron-3-nano-free",
  "mistralai/mistral-small-3.1-24b-instruct:free": "mistral-small-3.1-free",
  "mistral-small-3.1": "mistral-small-3.1-free",
  "mistral-small": "mistral-small-3.1-free",
  "meta-llama/llama-3.3-70b-instruct:free": "llama-3.3-70b-free",
  "llama-3.3-70b": "llama-3.3-70b-free",
  "llama-3.3": "llama-3.3-70b-free",
  "google/gemma-3-27b-it:free": "gemma-3-27b-free",
  "gemma-3-27b": "gemma-3-27b-free",
  "gemma": "gemma-3-27b-free",
  "openai/gpt-oss-20b:free": "gpt-oss-20b-free",
  "gpt-oss-20b": "gpt-oss-20b-free",
  "arcee-ai/trinity-mini:free": "trinity-mini-free",
  "trinity-mini": "trinity-mini-free",
  "nvidia/nemotron-nano-12b-v2-vl:free": "nemotron-nano-12b-vl-free",
  "nemotron-nano-12b": "nemotron-nano-12b-vl-free",
  // Still-available free model aliases
  "deepseek/deepseek-r1-0528:free": "deepseek-r1-free",
  "deepseek/deepseek-r1:free": "deepseek-r1-free",
  "deepseek-r1": "deepseek-r1-free",
  "zhipu/glm-4.5-air:free": "glm-4.5-air-free",
  "z-ai/glm-4.5-air:free": "glm-4.5-air-free",
  "glm-4.5-air": "glm-4.5-air-free",
  "glm": "glm-4.5-air-free",
  "tngtech/deepseek-r1t2-chimera:free": "deepseek-chimera-free",
  "deepseek-chimera": "deepseek-chimera-free",
  "chimera": "deepseek-chimera-free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": "venice-dolphin-free",
  "venice-dolphin": "venice-dolphin-free",
  "dolphin-mistral": "venice-dolphin-free",

  // GLM 4.7 family (priced)
  "z-ai/glm-4.7-flash": "glm-4.7-flash",
  "z-ai/glm-4.7-flash-20260119": "glm-4.7-flash",
  "glm-4.7-flash": "glm-4.7-flash",
  "z-ai/glm-4.7": "glm-4.7",
  "z-ai/glm-4.7-20251222": "glm-4.7",
  "glm-4.7": "glm-4.7",
  "moonshotai/kimi-k2.6": "kimi-k2.6",
  "kimi-k2.6": "kimi-k2.6",
  "kimi-k2": "kimi-k2.6",
  "kimi": "kimi-k2.6",
};

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a LanguageModel instance from a ModelSpec
 */
function buildLanguageModel(spec: ModelSpec): LanguageModel {
  switch (spec.provider) {
    case "openai":
      return openai(spec.sdkId);
    case "anthropic":
      return anthropic(spec.sdkId);
    case "google": {
      const googleProvider = getGoogleProvider();
      if (!googleProvider) {
        throw new Error(
          `Google model "${spec.alias}" requested but no Google API key alias is configured`,
        );
      }
      return googleProvider(spec.sdkId);
    }
    case "openrouter": {
      const openrouter = getOpenRouterProvider();
      if (!openrouter) {
        throw new Error(
          `OpenRouter model "${spec.alias}" requested but OPENROUTER_API_KEY not configured`
        );
      }
      return openrouter.chat(spec.sdkId);
    }
    default:
      throw new Error(`Unknown provider: ${spec.provider}`);
  }
}

/**
 * Type-safe entry point - ONLY accepts ApprovedModel
 * Compile-time enforcement of 7-model policy
 */
export function getLanguageModel(model: ApprovedModel): LanguageModel {
  const spec = MODEL_SPECS[model];
  logModelResolution(model, spec, "getLanguageModel");
  return buildLanguageModel(spec);
}

/**
 * Resolve untrusted string input to an ApprovedModel
 * Returns null if the input is not a valid alias
 */
export function resolveModelAlias(input: string): ApprovedModel | null {
  const normalized = input.trim().toLowerCase();

  // Check if it's already an approved model
  if ((APPROVED_MODELS as readonly string[]).includes(normalized)) {
    return normalized as ApprovedModel;
  }

  // Check legacy aliases
  return LEGACY_ALIASES[input] ?? LEGACY_ALIASES[normalized] ?? null;
}

/**
 * Convenience function for untrusted input that throws on invalid
 */
export function getLanguageModelOrThrow(input: string): LanguageModel {
  const resolved = resolveModelAlias(input);
  if (!resolved) {
    throw new Error(
      `Invalid model: "${input}". Allowed models: ${APPROVED_MODELS.join(", ")}`
    );
  }
  return getLanguageModel(resolved);
}

/**
 * Get a language model from untrusted input with fallback to default
 */
export function getLanguageModelSafe(input: string | undefined | null): LanguageModel {
  if (!input) {
    return getLanguageModel(DEFAULT_MODEL);
  }
  const resolved = resolveModelAlias(input);
  if (!resolved) {
    console.warn(`[modelResolver] Unknown model "${input}", falling back to ${DEFAULT_MODEL}`);
    return getLanguageModel(DEFAULT_MODEL);
  }
  return getLanguageModel(resolved);
}

/**
 * Get the ModelSpec for an approved model
 */
export function getModelSpec(model: ApprovedModel): ModelSpec {
  return MODEL_SPECS[model];
}

/**
 * Get provider for a model
 */
export function getProviderForModel(model: ApprovedModel): Provider {
  return MODEL_SPECS[model].provider;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING (ModelResolution events per Part 10.2)
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelResolutionEvent {
  event: "ModelResolution";
  timestamp: number;
  requestedAlias: string;
  resolvedAlias: ApprovedModel | null;
  sdkModelId: string;
  provider: Provider;
  caller: string;
  success: boolean;
  errorMessage?: string;
}

function logModelResolution(
  requestedAlias: string,
  spec: ModelSpec,
  caller: string
): void {
  const event: ModelResolutionEvent = {
    event: "ModelResolution",
    timestamp: Date.now(),
    requestedAlias,
    resolvedAlias: spec.alias,
    sdkModelId: spec.sdkId,
    provider: spec.provider,
    caller,
    success: true,
  };
  console.log("[ModelResolver]", JSON.stringify(event));
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITY CHECKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a model supports a specific capability
 */
export function modelSupportsCapability(
  model: ApprovedModel,
  capability: keyof Omit<ModelCapabilities, "maxContext">
): boolean {
  return MODEL_SPECS[model].capabilities[capability] === true;
}

/**
 * Validate that a model supports all required capabilities
 * Returns an error message if validation fails, null if valid
 */
export function validateModelCapabilities(
  model: ApprovedModel,
  required: Partial<Record<keyof ModelCapabilities, boolean>>
): string | null {
  const spec = MODEL_SPECS[model];
  const missing: string[] = [];

  if (required.vision && !spec.capabilities.vision) {
    missing.push("vision");
  }
  if (required.toolUse && !spec.capabilities.toolUse) {
    missing.push("toolUse");
  }
  if (required.streaming && !spec.capabilities.streaming) {
    missing.push("streaming");
  }
  if (required.structuredOutputs && !spec.capabilities.structuredOutputs) {
    missing.push("structuredOutputs");
  }

  if (missing.length > 0) {
    return `Model "${model}" does not support required capabilities: ${missing.join(", ")}`;
  }
  return null;
}

/**
 * Get all models that support specific capabilities
 */
export function getModelsWithCapabilities(
  required: Partial<Record<keyof ModelCapabilities, boolean>>
): ApprovedModel[] {
  return APPROVED_MODELS.filter((model) => {
    return validateModelCapabilities(model, required) === null;
  });
}

/**
 * Safely resolve a model alias and return normalized alias
 * Used for API boundary normalization
 */
export function normalizeModelInput(input: string | undefined | null): ApprovedModel {
  if (!input) return DEFAULT_MODEL;
  const resolved = resolveModelAlias(input);
  if (!resolved) {
    console.warn(`[modelResolver] Normalizing unknown model "${input}" to ${DEFAULT_MODEL}`);
    return DEFAULT_MODEL;
  }
  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════
// COST TRACKING (Jan 2026)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get pricing for a model
 */
export function getModelPricing(model: ApprovedModel): ModelPricing {
  return MODEL_SPECS[model].pricing;
}

/**
 * Calculate cost for a given token usage
 */
export function calculateCost(
  model: ApprovedModel,
  inputTokens: number,
  outputTokens: number
): { inputCost: number; outputCost: number; totalCost: number } {
  const pricing = MODEL_SPECS[model].pricing;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format cost as USD string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(4)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FREE-FIRST MODEL SELECTION WITH AUTOMATIC FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retry configuration for transient errors (429/503)
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxJitterMs: 500,
  retryableStatuses: [429, 502, 503, 504] as const,
} as const;

/**
 * Check if a model is a free OpenRouter model
 */
export function isFreeModel(model: ApprovedModel): boolean {
  return MODEL_SPECS[model].pricing.inputPerMillion === 0 &&
         MODEL_SPECS[model].pricing.outputPerMillion === 0;
}

/**
 * Get all free models from the approved list
 */
export function getFreeModels(): ApprovedModel[] {
  return APPROVED_MODELS.filter((model) => isFreeModel(model));
}

/**
 * Get the next model in the priority fallback chain
 * Returns null if no more models available
 */
export function getNextFallbackModel(currentModel: ApprovedModel): ApprovedModel | null {
  const currentIndex = MODEL_PRIORITY_ORDER.indexOf(currentModel);
  if (currentIndex === -1 || currentIndex >= MODEL_PRIORITY_ORDER.length - 1) {
    return null;
  }
  return MODEL_PRIORITY_ORDER[currentIndex + 1];
}

/**
 * Get a language model with automatic fallback to next in priority chain
 * Use this when you want FREE-FIRST behavior with paid fallback
 */
export function getLanguageModelWithFallback(preferredModel?: ApprovedModel): {
  model: LanguageModel;
  modelId: ApprovedModel;
  isFree: boolean;
  fallbackChain: ApprovedModel[];
} {
  const modelId = preferredModel ?? DEFAULT_MODEL;
  const spec = MODEL_SPECS[modelId];

  return {
    model: buildLanguageModel(spec),
    modelId,
    isFree: isFreeModel(modelId),
    fallbackChain: MODEL_PRIORITY_ORDER.slice(MODEL_PRIORITY_ORDER.indexOf(modelId) + 1),
  };
}

/**
 * Execute a model call with automatic fallback on failure
 * This is the recommended way to call models with FREE-FIRST strategy
 *
 * @param fn - Async function that takes a LanguageModel and returns a result
 * @param options - Optional configuration
 * @returns The result from the first successful model call
 */
export async function executeWithModelFallback<T>(
  fn: (model: LanguageModel, modelId: ApprovedModel) => Promise<T>,
  options?: {
    startModel?: ApprovedModel;
    maxRetries?: number;
    onFallback?: (fromModel: ApprovedModel, toModel: ApprovedModel, error: Error) => void;
  }
): Promise<{ result: T; modelUsed: ApprovedModel; isFree: boolean; fallbacksUsed: number }> {
  const { startModel = DEFAULT_MODEL, maxRetries = RETRY_CONFIG.maxRetries, onFallback } = options ?? {};

  let currentModel = startModel;
  let fallbacksUsed = 0;
  let lastError: Error | null = null;

  // Get the starting index in priority order
  let modelIndex = MODEL_PRIORITY_ORDER.indexOf(currentModel);
  if (modelIndex === -1) {
    // Model not in priority order, start from beginning
    modelIndex = 0;
    currentModel = MODEL_PRIORITY_ORDER[0];
  }

  while (modelIndex < MODEL_PRIORITY_ORDER.length) {
    currentModel = MODEL_PRIORITY_ORDER[modelIndex];
    const spec = MODEL_SPECS[currentModel];

    // Try with retries for transient errors
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const model = buildLanguageModel(spec);
        const result = await fn(model, currentModel);

        return {
          result,
          modelUsed: currentModel,
          isFree: isFreeModel(currentModel),
          fallbacksUsed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        const isRetryable = RETRY_CONFIG.retryableStatuses.some(
          (status) => lastError?.message.includes(String(status))
        );

        if (isRetryable && attempt < maxRetries) {
          // Exponential backoff with jitter
          const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) +
                        Math.random() * RETRY_CONFIG.maxJitterMs;
          console.log(
            `[modelResolver] ${currentModel} retryable error, attempt ${attempt + 1}/${maxRetries + 1} after ${Math.round(delay)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable or max retries exceeded, move to next model
        break;
      }
    }

    // Move to next model in fallback chain
    const nextIndex = modelIndex + 1;
    if (nextIndex < MODEL_PRIORITY_ORDER.length) {
      const nextModel = MODEL_PRIORITY_ORDER[nextIndex];
      console.log(`[modelResolver] ${currentModel} failed, falling back to ${nextModel}`);

      if (onFallback) {
        onFallback(currentModel, nextModel, lastError!);
      }

      fallbacksUsed++;
    }

    modelIndex++;
  }

  throw new Error(
    `All models in fallback chain failed. Last error: ${lastError?.message}`
  );
}

/**
 * Get the best available free model based on verified availability (Feb 2026)
 * Returns qwen3-coder-free as primary (480B MoE, agentic coding)
 */
export function getBestFreeModel(): ApprovedModel {
  return "qwen3-coder-free";
}

/**
 * Get the fallback chain starting from a given model
 */
export function getFallbackChain(startModel: ApprovedModel = DEFAULT_MODEL): ApprovedModel[] {
  const startIndex = MODEL_PRIORITY_ORDER.indexOf(startModel);
  if (startIndex === -1) {
    return [...MODEL_PRIORITY_ORDER];
  }
  return MODEL_PRIORITY_ORDER.slice(startIndex);
}
