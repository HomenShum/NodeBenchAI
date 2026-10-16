/**
 * Central registry for LLM model selection across providers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026 MODEL CONSOLIDATION - current approved models only
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Primary NodeBench default:
 * - kimi-k2.6: OpenRouter-first advisor/orchestrator lane
 *
 * OpenAI (3 models):
 * - gpt-5.4: Latest flagship
 * - gpt-5.4-mini: Efficient reasoning
 * - gpt-5.4-nano: Ultra-efficient
 *
 * Anthropic (current + compatibility lanes):
 * - claude-opus-4.7: latest flagship
 * - claude-sonnet-4.6: latest balanced lane
 * - claude-haiku-4.5: latest fast lane
 *
 * Google (6 models):
 * - gemini-3.1-pro-preview: latest flagship preview
 * - gemini-3-flash-preview: fast preview lane
 * - gemini-3.1-flash-lite-preview: low-cost preview lane
 * - gemini-2.5-pro: Stable flagship (1M context)
 * - gemini-2.5-flash: stable efficient lane
 * - gemini-2.5-flash-lite: ultra-efficient stable lane
 *
 * For model resolution logic, see: convex/domains/agents/mcp_tools/models/
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export type LlmProvider = "openai" | "anthropic" | "gemini" | "openrouter" | "xai";

export type LlmTask =
  | "chat"
  | "agent"
  | "router"
  | "judge"
  | "analysis"
  | "deepResearch"
  | "vision"
  | "fileSearch"
  | "voice"
  | "coding";

export type UserTier = "anonymous" | "free" | "pro" | "team" | "enterprise";

/**
 * Own-property lookup for the alias, pricing, equivalent, fallback and wire-id tables below.
 * These tables are plain objects keyed by untrusted model ids, so `table["toString"]` would
 * otherwise return `Object.prototype.toString` and a name nobody registered would count as known
 * (SPEC-v9 A.0.10). `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`: backend/convex compiles with lib ES2021.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * Thrown when an id is not a model this repo knows and is not free-looking. Unknown ids never
 * become a paid default (SPEC-v9 A.0.10). Defined here, not in modelResolver.ts, so the catalog's
 * `getModelWithFailover` and the resolver reject with the same class.
 */
export class UnknownModelError extends Error {
  readonly input: string;
  constructor(input: string, detail?: string) {
    super(`Unknown model "${input}"${detail ? `. ${detail}` : ""}`);
    this.name = "UnknownModelError";
    this.input = input;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL PRICING (per 1M tokens, USD)
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelPricing {
  inputPer1M: number;    // Cost per 1M input tokens
  outputPer1M: number;   // Cost per 1M output tokens
  cachedInputPer1M?: number; // Cached input discount (if supported)
  contextWindow: number; // Max context window
}

export const modelPricing: Record<string, ModelPricing> = {
  // OpenAI - GPT-5.4 family (official docs, April 2026)
  "gpt-5.4": { inputPer1M: 2.50, outputPer1M: 15.00, cachedInputPer1M: 0.25, contextWindow: 1050000 },
  "gpt-5.4-mini": { inputPer1M: 0.75, outputPer1M: 4.50, cachedInputPer1M: 0.075, contextWindow: 400000 },
  "gpt-5.4-nano": { inputPer1M: 0.20, outputPer1M: 1.25, cachedInputPer1M: 0.02, contextWindow: 400000 },

  // Anthropic Claude family (official docs, April 2026)
  "claude-opus-4.7": { inputPer1M: 5.00, outputPer1M: 25.00, cachedInputPer1M: 0.50, contextWindow: 1000000 },
  "claude-sonnet-4.6": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 1000000 },
  "claude-haiku-4.5": { inputPer1M: 1.00, outputPer1M: 5.00, cachedInputPer1M: 0.10, contextWindow: 200000 },
  "claude-opus-4.1": { inputPer1M: 15.00, outputPer1M: 75.00, cachedInputPer1M: 1.50, contextWindow: 200000 },
  "claude-opus-4": { inputPer1M: 15.00, outputPer1M: 75.00, cachedInputPer1M: 1.50, contextWindow: 200000 },
  "claude-sonnet-4": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 200000 },
  "claude-haiku-3.5": { inputPer1M: 0.80, outputPer1M: 4.00, cachedInputPer1M: 0.08, contextWindow: 200000 },

  // Google Gemini 3 / 2.5 (official docs, April 2026)
  "gemini-3.1-pro-preview": { inputPer1M: 2.00, outputPer1M: 12.00, contextWindow: 1048576 },
  "gemini-3-flash-preview": { inputPer1M: 0.50, outputPer1M: 3.00, contextWindow: 1000000 },
  "gemini-3.1-flash-lite-preview": { inputPer1M: 0.25, outputPer1M: 1.50, contextWindow: 1000000 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10.00, cachedInputPer1M: 0.125, contextWindow: 1048576 },
  "gemini-2.5-flash": { inputPer1M: 0.30, outputPer1M: 2.50, cachedInputPer1M: 0.03, contextWindow: 1048576 },
  "gemini-2.5-flash-lite": { inputPer1M: 0.10, outputPer1M: 0.40, cachedInputPer1M: 0.01, contextWindow: 1048576 },
  // Google Deep Research agent pricing is not separately published in official docs yet.
  // Use Gemini 3.1 Pro preview rates as a planning proxy for budget guards.
  "deep-research-preview-04-2026": { inputPer1M: 2.00, outputPer1M: 12.00, contextWindow: 1048576 },
  "deep-research-max-preview-04-2026": { inputPer1M: 2.00, outputPer1M: 12.00, contextWindow: 1048576 },
  "deep-research-pro-preview-12-2025": { inputPer1M: 2.00, outputPer1M: 12.00, contextWindow: 1048576 },

  // OpenRouter (pricing used by eval cost checks; USD per 1M tokens)
  "deepseek-r1": { inputPer1M: 0.70, outputPer1M: 2.40, contextWindow: 163840 },
  "deepseek-v3.2-speciale": { inputPer1M: 0.27, outputPer1M: 0.41, contextWindow: 163840 },
  "deepseek-v3.2": { inputPer1M: 0.25, outputPer1M: 0.38, contextWindow: 163840 },
  "qwen3-235b": { inputPer1M: 0.18, outputPer1M: 0.54, contextWindow: 131072 },
  "minimax-m2.7": { inputPer1M: 0.30, outputPer1M: 1.20, contextWindow: 196608 },
  "mistral-large": { inputPer1M: 2.00, outputPer1M: 6.00, contextWindow: 131072 },
  "glm-4.7-flash": { inputPer1M: 0.07, outputPer1M: 0.40, cachedInputPer1M: 0.01, contextWindow: 200000 },
  "glm-4.7": { inputPer1M: 0.40, outputPer1M: 1.50, contextWindow: 202752 },
  "kimi-k2.6": { inputPer1M: 0.75, outputPer1M: 3.50, contextWindow: 262144 },

  // xAI Grok Series (Jan 2026) - Real-time web search + X integration
  "grok-4-1-fast-reasoning": { inputPer1M: 0.20, outputPer1M: 0.50, cachedInputPer1M: 0.02, contextWindow: 2000000 },
  "grok-4-1-fast-non-reasoning": { inputPer1M: 0.20, outputPer1M: 0.50, cachedInputPer1M: 0.02, contextWindow: 2000000 },
  "grok-4-fast-reasoning": { inputPer1M: 0.20, outputPer1M: 0.50, cachedInputPer1M: 0.02, contextWindow: 256000 },
  "grok-4-fast-non-reasoning": { inputPer1M: 0.20, outputPer1M: 0.50, cachedInputPer1M: 0.02, contextWindow: 256000 },
  "grok-4": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 256000 },
  "grok-3": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 128000 },
  "grok-3-mini": { inputPer1M: 1.00, outputPer1M: 5.00, cachedInputPer1M: 0.10, contextWindow: 128000 },
  "grok-code-fast-1": { inputPer1M: 0.20, outputPer1M: 0.50, cachedInputPer1M: 0.02, contextWindow: 256000 },
  "grok-2-vision-1212": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 128000 },
  "grok-2": { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30, contextWindow: 128000 },

  // OpenRouter Free-Tier Models ($0 pricing - verified Feb 5, 2026 via API)
  "qwen3-coder-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 262000 },
  "step-3.5-flash-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 256000 },
  "gpt-oss-120b-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131072 },
  "qwen3-next-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 262144 },
  "trinity-large-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131000 },
  "nemotron-3-nano-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 256000 },
  "mistral-small-3.1-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 128000 },
  "llama-3.3-70b-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 128000 },
  "gemma-3-27b-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131072 },
  "gpt-oss-20b-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131072 },
  "trinity-mini-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131072 },
  "nemotron-nano-12b-vl-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 128000 },
  "deepseek-r1-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 163840 },
  "glm-4.5-air-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 131072 },
  "deepseek-chimera-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 163840 },
  "venice-dolphin-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 32768 },
  // FREE_LANE_MODEL (modelResolver.ts); wire id nvidia/nemotron-3-super-120b-a12b:free, 262,144-token context (SPEC-v9 A.2.10 PR 1)
  "nemotron-3-super-free": { inputPer1M: 0.00, outputPer1M: 0.00, contextWindow: 262144 },
};

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITS BY TIER (requests per day)
// ═══════════════════════════════════════════════════════════════════════════

export interface TierLimits {
  requestsPerDay: number;
  tokensPerDay: number;
  maxTokensPerRequest: number;
  allowedProviders: LlmProvider[];
  allowedModels: string[];  // Empty = all models allowed
  costLimitPerDay: number;  // USD
}

export const tierLimits: Record<UserTier, TierLimits> = {
  anonymous: {
    requestsPerDay: 5,
    tokensPerDay: 10_000,
    maxTokensPerRequest: 2_000,
    allowedProviders: ["openai", "anthropic", "gemini"],
    allowedModels: ["gpt-5.4-nano", "claude-haiku-4.5", "gemini-3.1-flash-lite-preview"],
    costLimitPerDay: 0.01,
  },
  free: {
    requestsPerDay: 25,
    tokensPerDay: 100_000,
    maxTokensPerRequest: 8_000,
    allowedProviders: ["openai", "anthropic", "gemini"],
    allowedModels: ["gpt-5.4-mini", "gpt-5.4-nano", "claude-haiku-4.5", "gemini-2.5-flash"],
    costLimitPerDay: 0.50,
  },
  pro: {
    requestsPerDay: 500,
    tokensPerDay: 2_000_000,
    maxTokensPerRequest: 32_000,
    allowedProviders: ["openai", "anthropic", "gemini", "openrouter"],
    allowedModels: [],  // All models
    costLimitPerDay: 25.00,
  },
  team: {
    requestsPerDay: 2000,
    tokensPerDay: 10_000_000,
    maxTokensPerRequest: 128_000,
    allowedProviders: ["openai", "anthropic", "gemini", "openrouter"],
    allowedModels: [],  // All models
    costLimitPerDay: 100.00,
  },
  enterprise: {
    requestsPerDay: -1,  // Unlimited
    tokensPerDay: -1,    // Unlimited
    maxTokensPerRequest: 400_000,
    allowedProviders: ["openai", "anthropic", "gemini", "openrouter"],
    allowedModels: [],   // All models
    costLimitPerDay: -1, // Unlimited
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CATALOG BY PROVIDER AND TASK
// ═══════════════════════════════════════════════════════════════════════════

type ModelCatalog = Record<LlmProvider, Record<LlmTask, string[]>>;

export const llmModelCatalog: ModelCatalog = {
  openai: {
    chat: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    agent: ["gpt-5.4", "gpt-5.4-mini"],
    router: ["gpt-5.4-nano", "gpt-5.4-mini"],
    judge: ["gpt-5.4", "gpt-5.4-mini"],
    analysis: ["gpt-5.4", "gpt-5.4-mini"],
    deepResearch: ["gpt-5.4", "gpt-5.4-mini"],
    vision: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    fileSearch: ["gpt-5.4-nano", "gpt-5.4-mini"],
    voice: ["gpt-5.4-nano", "gpt-5.4-mini"],
    coding: ["gpt-5.4", "gpt-5.4-mini"],
  },
  anthropic: {
    chat: ["claude-haiku-4.5", "claude-sonnet-4.6"],
    agent: ["claude-haiku-4.5", "claude-sonnet-4.6", "claude-opus-4.7"],
    router: ["claude-haiku-4.5"],
    judge: ["claude-sonnet-4.6", "claude-opus-4.7"],
    analysis: ["claude-sonnet-4.6", "claude-opus-4.7"],
    deepResearch: ["claude-sonnet-4.6", "claude-opus-4.7"],
    vision: ["claude-sonnet-4.6", "claude-opus-4.7"],
    fileSearch: ["claude-haiku-4.5"],
    voice: ["claude-haiku-4.5"],
    coding: ["claude-sonnet-4.6", "claude-opus-4.7"],
  },
  gemini: {
    // Gemini 3 (preview) → 2.5 (stable) → 2.0 (deprecated March 31 2026).
    // Callers can still override explicitly with any model ID.
    chat: ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash"],
    agent: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
    router: ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"],
    judge: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
    analysis: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
    deepResearch: [
      "deep-research-preview-04-2026",
      "deep-research-max-preview-04-2026",
      "deep-research-pro-preview-12-2025",
    ],
    vision: ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    fileSearch: ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"],
    voice: ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"],
    coding: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
  },
  openrouter: {
    chat: ["kimi-k2.6", "minimax-m2.7", "glm-4.7-flash", "deepseek-v3.2-speciale", "glm-4.7"],
    agent: ["kimi-k2.6", "minimax-m2.7", "glm-4.7", "deepseek-v3.2-speciale", "glm-4.7-flash"],
    router: ["kimi-k2.6", "minimax-m2.7", "glm-4.7-flash", "deepseek-v3.2-speciale"],
    judge: ["kimi-k2.6", "deepseek-r1", "glm-4.7", "minimax-m2.7"],
    analysis: ["kimi-k2.6", "deepseek-r1", "glm-4.7", "minimax-m2.7"],
    deepResearch: ["kimi-k2.6", "deepseek-r1", "glm-4.7", "minimax-m2.7"],
    vision: [],
    fileSearch: ["kimi-k2.6", "minimax-m2.7", "glm-4.7-flash", "deepseek-v3.2-speciale"],
    voice: [],
    coding: ["kimi-k2.6", "minimax-m2.7", "glm-4.7-flash", "deepseek-v3.2-speciale", "mistral-large"],
  },
  xai: {
    chat: ["grok-3-mini", "grok-4-1-fast-reasoning"],
    agent: ["grok-4-1-fast-reasoning", "grok-4"],
    router: ["grok-3-mini"],
    judge: ["grok-4", "grok-4-1-fast-reasoning"],
    analysis: ["grok-4-1-fast-reasoning", "grok-4"],
    deepResearch: ["grok-4-1-fast-reasoning", "grok-4"],
    vision: ["grok-2-vision-1212"],
    fileSearch: ["grok-3-mini", "grok-4-1-fast-non-reasoning"],
    voice: ["grok-3-mini"],
    coding: ["grok-code-fast-1", "grok-4-1-fast-reasoning"],
  },
};

/** Default fallback model if everything else fails */
export const DEFAULT_FALLBACK_MODEL = "gpt-5.4-mini";

/**
 * Check if Gemini is fully integrated with the Agent SDK.
 * Returns true - @ai-sdk/google is now fully integrated.
 */
export function isGeminiAgentSupported(): boolean {
  return true;
}

/**
 * Resolve the preferred model for a given task/provider with optional override.
 * Override wins; otherwise the first configured model for the task is returned.
 *
 * @param task - The type of task (chat, agent, coding, etc.)
 * @param provider - "openai" or "gemini" (note: gemini falls back to openai in agents)
 * @param override - Optional explicit model name to use instead
 * @returns The model identifier string for the API
 */
export function getLlmModel(
  task: LlmTask,
  provider: LlmProvider = "openrouter",
  override?: string | null | undefined
): string {
  // If explicit override provided, use it
  if (override && override.trim().length > 0) return override.trim();

  // Warn if Gemini requested but not supported in agent context
  if (provider === "gemini" && !isGeminiAgentSupported()) {
    console.warn(`[getLlmModel] Gemini requested for "${task}" but agent SDK not integrated. Use externalOrchestrator for Gemini.`);
  }

  const candidates = llmModelCatalog[provider]?.[task];
  if (!candidates || candidates.length === 0) {
    console.warn(`[getLlmModel] No model configured for task "${task}" provider "${provider}", using fallback`);
    return DEFAULT_FALLBACK_MODEL;
  }
  return candidates[0];
}

/**
 * Get all configured models for a task (useful for UI model pickers)
 */
export function getAvailableModels(task: LlmTask, provider: LlmProvider = "openrouter"): string[] {
  return llmModelCatalog[provider]?.[task] ?? [DEFAULT_FALLBACK_MODEL];
}

/**
 * Check if a model name is valid for a given provider
 */
export function isValidModel(modelName: string, provider: LlmProvider): boolean {
  const allModels = Object.values(llmModelCatalog[provider] ?? {}).flat();
  return allModels.includes(modelName);
}

// ═══════════════════════════════════════════════════════════════════════════
// COST CALCULATION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate the cost for a request given input/output token counts
 */
export function calculateRequestCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  useCachedInput: boolean = false
): number {
  const pricing = ownEntry(modelPricing, modelName);
  if (!pricing) {
    console.warn(`[calculateRequestCost] No pricing for model "${modelName}", using estimate`);
    // Default to gpt-5.4-nano pricing as fallback
    return (inputTokens * 0.15 + outputTokens * 0.60) / 1_000_000;
  }

  const inputRate = useCachedInput && pricing.cachedInputPer1M 
    ? pricing.cachedInputPer1M 
    : pricing.inputPer1M;

  return (inputTokens * inputRate + outputTokens * pricing.outputPer1M) / 1_000_000;
}

/**
 * Get pricing info for a model
 */
export function getModelPricing(modelName: string): ModelPricing | null {
  return ownEntry(modelPricing, modelName) ?? null;
}

/**
 * Get the provider for a given model name
 */
export function getProviderForModel(modelName: string): LlmProvider | null {
  if (modelName.startsWith("gpt-") || modelName.startsWith("o1-") || modelName.startsWith("o3-") || modelName.startsWith("o4-")) {
    return "openai";
  }
  if (modelName.startsWith("claude-")) {
    return "anthropic";
  }
  if (modelName.startsWith("gemini-") || modelName.startsWith("deep-research-")) {
    return "gemini";
  }
  if (ownEntry(modelPricing, modelName) != null) {
    return "openrouter";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get rate limits for a user tier
 */
export function getTierLimits(tier: UserTier): TierLimits {
  return tierLimits[tier] ?? tierLimits.anonymous;
}

/**
 * Check if a model is allowed for a given tier
 */
export function isModelAllowedForTier(modelName: string, tier: UserTier): boolean {
  const limits = getTierLimits(tier);
  
  // Check provider first
  const provider = getProviderForModel(modelName);
  if (provider && !limits.allowedProviders.includes(provider)) {
    return false;
  }
  
  // Empty allowedModels = all models allowed
  if (limits.allowedModels.length === 0) {
    return true;
  }
  
  return limits.allowedModels.includes(modelName);
}

/**
 * Get the best allowed model for a tier and task
 * Returns the first allowed model from the task's model list
 */
export function getBestModelForTier(
  task: LlmTask, 
  tier: UserTier, 
  preferredProvider: LlmProvider = "openrouter"
): string {
  const limits = getTierLimits(tier);
  
  // Try preferred provider first
  const candidates = llmModelCatalog[preferredProvider]?.[task] ?? [];
  for (const model of candidates) {
    if (isModelAllowedForTier(model, tier)) {
      return model;
    }
  }
  
  // Try other allowed providers
  for (const provider of limits.allowedProviders) {
    if (provider === preferredProvider) continue;
    const providerCandidates = llmModelCatalog[provider]?.[task] ?? [];
    for (const model of providerCandidates) {
      if (isModelAllowedForTier(model, tier)) {
        return model;
      }
    }
  }
  
  // Fallback to default
  return DEFAULT_FALLBACK_MODEL;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  remaining?: {
    requests: number;
    tokens: number;
    cost: number;
  };
}

/**
 * Check if a request would exceed rate limits
 * Note: This is a synchronous check - actual usage tracking is in Convex
 */
export function checkRateLimitSync(
  tier: UserTier,
  currentUsage: { requests: number; tokens: number; cost: number },
  requestTokens: number,
  requestCost: number
): RateLimitCheck {
  const limits = getTierLimits(tier);
  
  // Unlimited tier
  if (limits.requestsPerDay === -1) {
    return { allowed: true };
  }
  
  // Check requests
  if (currentUsage.requests >= limits.requestsPerDay) {
    return { 
      allowed: false, 
      reason: `Daily request limit reached (${limits.requestsPerDay} requests)` 
    };
  }
  
  // Check tokens
  if (limits.tokensPerDay > 0 && currentUsage.tokens + requestTokens > limits.tokensPerDay) {
    return { 
      allowed: false, 
      reason: `Daily token limit would be exceeded (${limits.tokensPerDay.toLocaleString()} tokens)` 
    };
  }
  
  // Check cost
  if (limits.costLimitPerDay > 0 && currentUsage.cost + requestCost > limits.costLimitPerDay) {
    return { 
      allowed: false, 
      reason: `Daily cost limit would be exceeded ($${limits.costLimitPerDay.toFixed(2)})` 
    };
  }
  
  // Check max tokens per request
  if (requestTokens > limits.maxTokensPerRequest) {
    return { 
      allowed: false, 
      reason: `Request exceeds max tokens (${limits.maxTokensPerRequest.toLocaleString()} tokens)` 
    };
  }
  
  return {
    allowed: true,
    remaining: {
      requests: limits.requestsPerDay - currentUsage.requests - 1,
      tokens: limits.tokensPerDay - currentUsage.tokens - requestTokens,
      cost: limits.costLimitPerDay - currentUsage.cost - requestCost,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL ALIASES (for easier user input)
// ═══════════════════════════════════════════════════════════════════════════

/** Short aliases that map to full model IDs (7 approved models) */
export const modelAliases: Record<string, string> = {
  // OpenAI aliases -> gpt-5.4
  "gpt5": "gpt-5.4",
  "gpt-5": "gpt-5.4",
  "gpt5.4": "gpt-5.4",
  "gpt": "gpt-5.4",
  "openai": "gpt-5.4",

  // Anthropic/Claude aliases → approved aliases
  "claude": "claude-sonnet-4.6",
  "claude-4": "claude-sonnet-4.6",
  "claude-sonnet": "claude-sonnet-4.6",
  "claude-opus": "claude-opus-4.7",
  "claude-haiku": "claude-haiku-4.5",
  "sonnet": "claude-sonnet-4.6",
  "opus": "claude-opus-4.7",
  "haiku": "claude-haiku-4.5",
  "anthropic": "claude-sonnet-4.6",

  // Gemini aliases → default to latest stable or preview
  "gemini": "gemini-3-flash-preview",
  "gemini-flash": "gemini-3-flash-preview",
  "gemini-pro": "gemini-3.1-pro-preview",
  "gemini-3": "gemini-3-flash-preview",
  "gemini-2.5": "gemini-2.5-flash",
  "flash": "gemini-3-flash-preview",
  "google": "gemini-3-flash-preview",
  "deep research": "deep-research-preview-04-2026",
  "deep-research": "deep-research-preview-04-2026",
  "gemini deep research": "deep-research-preview-04-2026",
  "deep research max": "deep-research-max-preview-04-2026",
  "deep-research-max": "deep-research-max-preview-04-2026",

  // OpenRouter aliases
  "openrouter": "kimi-k2.6",
  "kimi": "kimi-k2.6",
  "kimi-k2": "kimi-k2.6",
  "kimi-k2.6": "kimi-k2.6",
  "moonshotai/kimi-k2.6": "kimi-k2.6",
  "minimax": "minimax-m2.7",
  "minimax-m2.7": "minimax-m2.7",
  "minimax/minimax-m2.7": "minimax-m2.7",
};

/**
 * Resolve a model alias to its full model ID.
 * If no alias exists, returns the original input.
 */
export function resolveModelAlias(modelInput: string): string {
  const normalized = modelInput.toLowerCase().trim();
  return ownEntry(modelAliases, normalized) ?? modelInput;
}

// -----------------------------------------------------------------------------
// ANTHROPIC WIRE IDS - explicit table, never string surgery
// -----------------------------------------------------------------------------

/**
 * Catalog alias (dotted, UI-facing) -> the id api.anthropic.com accepts.
 * The dotted alias is not a valid wire id, so every caller that hands a catalog
 * model to Anthropic must go through `anthropicWireId`. Kept in sync with the
 * `provider: "anthropic"` rows of `MODEL_SPECS` in modelResolver.ts by
 * `anthropicWireIds.test.ts` (Convex cannot import this table from there, and
 * this file cannot import from backend/convex).
 */
export const ANTHROPIC_WIRE_IDS: Readonly<Record<string, string>> = {
  "claude-opus-4.7": "claude-opus-4-7",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-haiku-4.5": "claude-haiku-4-5",
  "claude-opus-4.1": "claude-opus-4-1-20250805",
  "claude-opus-4": "claude-opus-4-20250514",
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-haiku-3.5": "claude-3-5-haiku-20241022",
};

/**
 * Ids `modelResolver.LEGACY_ALIASES` recognises and that `main` sent to the provider unchanged,
 * so they keep going out unchanged: PR 1 moves no ids (SPEC-v9 A.0.4). Each already is its own
 * wire string; the resolver's lossy alias for it (for example `claude-sonnet-4-5-20250929` ->
 * `claude-sonnet-4`, retired) is never what a caller asked for. The ids move in PR 2.
 * Left out on purpose: the dotted `claude-opus-4.6`, `claude-opus-4.5`, `claude-sonnet-4.5`
 * (never wire ids, api.anthropic.com 404s on them) and `gpt-oss*` (OpenRouter free aliases that
 * the `gpt-` prefix used to route to paid OpenAI). `anthropicWireIds.test.ts` pins this list
 * against `LEGACY_ALIASES`, so a new resolver alias that main would have passed through
 * fails the test instead of being rejected at runtime.
 */
export const LEGACY_PASSTHROUGH_IDS: ReadonlySet<string> = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-5-20251101",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-chat-latest",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-3-pro",
  "gemini-3-flash",
  "gemini-3.1-flash-lite-preview-lite",
]);

/**
 * The ids SPEC-v9 section 1.2 lists as their own wire string on the `anthropic`, `google` and
 * `openai` transports. Each is already what the provider accepts, so `main` sent every one
 * unchanged (it routed on the `claude-` / `gemini-` / `gpt-` prefix); PR 1 moves no ids
 * (A.0.4) and Homen D1 makes them known. They are dispatched as written. The resolver registers
 * them in PR 2; `anthropicWireIds.test.ts` iterates this set through every public boundary.
 */
export const SPEC_NATIVE_WIRE_IDS: ReadonlySet<string> = new Set([
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5-1",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3.8-flash-tts",
  "gemini-3.8-live",
  "gpt-6.1-sol",
  "gpt-6-luna",
  "gpt-5.4-mini",
]);

/**
 * Resolver-registry ids (`APPROVED_MODELS`, `LEGACY_ALIASES`, and their wire strings) whose
 * provider is OpenRouter and that this catalog cannot dispatch: it has no OpenRouter branch
 * (PR 2 adds it). Homen D1: a known id is never silently rerouted, so these are REFUSED with this
 * reason instead of falling to the paid default (`main`: gpt-5.4-mini) or to the free lane
 * (head, for the free-looking ones). `anthropicWireIds.test.ts` derives the same set from the
 * resolver and pins this one to it in both directions.
 */
export const OPENROUTER_ONLY_REGISTRY_IDS: ReadonlySet<string> = new Set([
  "arcee-ai/trinity-large-preview:free", "arcee-ai/trinity-mini:free", "chimera",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", "deepseek-chimera",
  "deepseek/deepseek-r1-0528:free", "deepseek/deepseek-r1:free", "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-speciale", "devstral", "devstral-2", "devstral-2-free", "dolphin-mistral", "gemma",
  "gemma-3-27b", "glm", "glm-4.5-air", "google/gemma-3-27b-it:free", "gpt-oss", "gpt-oss-120b", "gpt-oss-20b",
  "grok", "grok-4-fast", "grok-4-fast-free", "kat-coder", "kat-coder-pro", "kat-coder-pro-free",
  "kwaipilot/kat-coder-pro:free", "laguna-s-2.1", "laguna-s-2.1-free", "laguna-xs-2.1", "laguna-xs-2.1-free",
  "llama-3.3", "llama-3.3-70b", "llama-4", "llama-4-maverick", "llama-4-maverick-free", "llama-4-scout",
  "llama-4-scout-free", "meta-llama/llama-3.3-70b-instruct:free", "meta-llama/llama-4-maverick:free",
  "meta-llama/llama-4-scout:free", "mimo", "mimo-v2", "mimo-v2-flash-free", "mistral-small",
  "mistral-small-3.1", "mistralai/devstral-2:free", "mistralai/mistral-large-2411",
  "mistralai/mistral-small-3.1-24b-instruct:free", "nemotron", "nemotron-3-nano", "nemotron-70b",
  "nemotron-free", "nemotron-nano-12b", "nvidia/llama-3.1-nemotron-70b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free", "nvidia/nemotron-nano-12b-v2-vl:free", "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free", "poolside/laguna-s-2.1", "poolside/laguna-s-2.1:free", "poolside/laguna-xs-2.1",
  "poolside/laguna-xs-2.1:free", "qwen/qwen3-235b-a22b", "qwen/qwen3-coder:free",
  "qwen/qwen3-next-80b-a3b-instruct:free", "qwen3-coder", "qwen3-next", "step-3.5-flash",
  "stepfun/step-3.5-flash:free", "tngtech/deepseek-r1t2-chimera:free", "trinity", "trinity-large",
  "trinity-mini", "venice-dolphin", "x-ai/grok-4-fast:free", "xiaomi/mimo-v2-flash",
  "xiaomi/mimo-v2-flash:free", "z-ai/glm-4.5-air:free", "z-ai/glm-4.7", "z-ai/glm-4.7-20251222",
  "z-ai/glm-4.7-flash", "z-ai/glm-4.7-flash-20260119", "zhipu/glm-4.5-air:free",
]);

/**
 * The Anthropic wire id for a catalog alias (or short alias such as "claude").
 * A string that already is a wire id is returned unchanged, dated snapshots in
 * `LEGACY_PASSTHROUGH_IDS` included. Returns null when the input is none of these,
 * so callers decide whether to fail or pass it through.
 */
export function anthropicWireId(modelInput: string): string | null {
  const resolved = resolveModelAlias(modelInput.trim());
  const fromAlias = ownEntry(ANTHROPIC_WIRE_IDS, resolved);
  if (fromAlias) return fromAlias;
  if (Object.values(ANTHROPIC_WIRE_IDS).includes(resolved)) return resolved;
  return resolved.startsWith("claude-") && (LEGACY_PASSTHROUGH_IDS.has(resolved) || SPEC_NATIVE_WIRE_IDS.has(resolved)) ? resolved : null;
}

/**
 * Concatenated text of an Anthropic Messages response. Reads blocks by `type`:
 * `content[0]` is a thinking block whenever adaptive thinking is on (default
 * on Claude Haiku 5.5), so index 0 is not "the answer".
 */
export function anthropicText(
  content: ReadonlyArray<{ type: string; text?: string }> | null | undefined,
): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER INTEGRATION STATUS
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderStatus {
  provider: LlmProvider;
  sdkPackage: string;
  integrated: boolean;
  supportsAgents: boolean;
  notes: string;
}

export const providerIntegrationStatus: ProviderStatus[] = [
  {
    provider: "openai",
    sdkPackage: "@ai-sdk/openai",
    integrated: true,
    supportsAgents: true,
    notes: "Fully integrated. SDK installed.",
  },
  {
    provider: "anthropic",
    sdkPackage: "@ai-sdk/anthropic",
    integrated: true, // SDK installed
    supportsAgents: true,
    notes: "Fully integrated. SDK installed.",
  },
  {
    provider: "gemini",
    sdkPackage: "@ai-sdk/google",
    integrated: true,
    supportsAgents: true,
    notes: "Fully integrated. SDK installed.",
  },
  {
    provider: "openrouter",
    sdkPackage: "@ai-sdk/openai (OpenRouter-compatible baseURL)",
    integrated: true,
    supportsAgents: true,
    notes: "Integrated via OpenAI-compatible API; requires OPENROUTER_API_KEY.",
  },
];

export function getProviderStatus(provider: LlmProvider): ProviderStatus | undefined {
  return providerIntegrationStatus.find(p => p.provider === provider);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT WINDOW VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a prompt fits within a model's context window.
 * Returns { fits: boolean, tokenEstimate: number, contextWindow: number, overflow: number }
 */
export function validateContextWindow( 
  modelName: string, 
  promptText: string, 
  reserveOutputTokens: number = 4000 
): { fits: boolean; tokenEstimate: number; contextWindow: number; overflow: number } { 
  const pricing = ownEntry(modelPricing, modelName);
  const contextWindow = pricing?.contextWindow ?? 128000; // Default to 128K
  
  // Rough token estimation: ~4 chars per token for English
  const tokenEstimate = Math.ceil(promptText.length / 4);
  const availableTokens = contextWindow - reserveOutputTokens;
  const overflow = Math.max(0, tokenEstimate - availableTokens);
  
  return {
    fits: tokenEstimate <= availableTokens,
    tokenEstimate,
    contextWindow,
    overflow,
  };
} 

// -----------------------------------------------------------------------------
// MODEL FALLBACK CHAINS (model-level, not just provider-level)
// -----------------------------------------------------------------------------

/**
 * Explicit per-model fallback chains used when a request fails due to rate limits
 * or temporary provider issues. Chains should only include approved models.
 */
export const modelFallbackChains: Record<string, string[]> = {
  // OpenAI flagship → smaller OpenAI → cross-provider small model
  "gpt-5.4": ["kimi-k2.6", "gemini-3.1-pro-preview", "gpt-5.4-mini", "gemini-3-flash-preview", "minimax-m2.7"],
  "gpt-5.4-mini": ["gemini-3.1-flash-lite-preview", "minimax-m2.7", "gemini-3-flash-preview", "kimi-k2.6", "gpt-5.4-nano"],

  // Anthropic premium → cheaper Anthropic → cross-provider small model
  "claude-opus-4.7": ["claude-sonnet-4.6", "gpt-5.4", "gemini-3.1-pro-preview", "kimi-k2.6", "gpt-5.4-mini"],
  "claude-sonnet-4.6": ["gpt-5.4-mini", "gemini-3-flash-preview", "kimi-k2.6", "minimax-m2.7"],
  "claude-haiku-4.5": ["gpt-5.4-nano", "gemini-3.1-flash-lite-preview", "minimax-m2.7", "glm-4.7-flash"],
  "claude-opus-4.1": ["claude-opus-4", "claude-sonnet-4", "claude-haiku-3.5", "gpt-5.4-mini", "gemini-2.5-flash"],
  "claude-opus-4": ["claude-sonnet-4", "claude-haiku-3.5", "gpt-5.4-mini", "gemini-2.5-flash"],
  "claude-sonnet-4": ["claude-haiku-3.5", "gpt-5.4-mini", "gemini-2.5-flash"],

  // Gemini 3.x preview → stable 2.5 → cross-provider advisor/executor lanes
  "gemini-3.1-pro-preview": ["gemini-3-flash-preview", "gemini-2.5-pro", "kimi-k2.6", "gpt-5.4"],
  "gemini-3-flash-preview": ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash", "gpt-5.4-mini", "minimax-m2.7"],
  "gemini-3.1-flash-lite-preview": ["gemini-3-flash-preview", "gemini-2.5-flash-lite", "gpt-5.4-mini", "minimax-m2.7"],
  "gemini-2.5-pro": ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "kimi-k2.6", "gpt-5.4"],
  "gemini-2.5-flash": ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gpt-5.4-mini", "minimax-m2.7"],
  "deep-research-max-preview-04-2026": ["deep-research-preview-04-2026", "gemini-3.1-pro-preview", "gpt-5.4"],
  "deep-research-preview-04-2026": ["deep-research-max-preview-04-2026", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
  "deep-research-pro-preview-12-2025": ["deep-research-preview-04-2026", "deep-research-max-preview-04-2026", "gemini-3.1-pro-preview"],
  "kimi-k2.6": ["gemini-3.1-pro-preview", "gpt-5.4", "gemini-3-flash-preview", "minimax-m2.7", "glm-4.7"],
  "minimax-m2.7": ["gemini-3.1-flash-lite-preview", "gpt-5.4-mini", "gemini-3-flash-preview", "kimi-k2.6"],
};

export function getNextFallback(model: string, attempted: string[]): string | null {
  const chain = ownEntry(modelFallbackChains, model) ?? [];
  return chain.find((m) => !attempted.includes(m)) ?? null;
}

/**
 * Get a model with sufficient context window for the given prompt
 * Falls back to larger models if needed
 */
export function getModelForContextSize(
  promptText: string,
  preferredModel: string,
  reserveOutputTokens: number = 4000
): string {
  const validation = validateContextWindow(preferredModel, promptText, reserveOutputTokens);
  
  if (validation.fits) {
    return preferredModel;
  }
  
  // Try larger context models in order of preference
  const largeContextModels = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gpt-5.4",
    "claude-opus-4.7",
    "claude-sonnet-4.6",
  ];
  
  for (const model of largeContextModels) {
    const check = validateContextWindow(model, promptText, reserveOutputTokens);
    if (check.fits) {
      console.log(`[getModelForContextSize] Upgrading from ${preferredModel} to ${model} for context (${validation.tokenEstimate} tokens)`);
      return model;
    }
  }
  
  console.warn(`[getModelForContextSize] Prompt too large (${validation.tokenEstimate} tokens), using gemini-3.1-pro-preview`);
  return "gemini-3.1-pro-preview";
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/** Environment variable names for each provider */
export const providerEnvVars: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
};

/**
 * Check if a provider's API key is configured.
 * Note: This only works in Node.js runtime (Convex actions).
 */
export function isProviderConfigured(provider: LlmProvider): boolean {
  if (typeof process === "undefined" || !process.env) {
    // Can't check in browser context
    return true; // Assume configured
  }
  const envVar = providerEnvVars[provider];
  const value = process.env[envVar];
  return !!value && value.length > 10;
}

/**
 * Get all configured providers
 */
export function getConfiguredProviders(): LlmProvider[] {
  return (["openrouter", "openai", "anthropic", "gemini", "xai"] as LlmProvider[]).filter(isProviderConfigured);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER FAILOVER
// ═══════════════════════════════════════════════════════════════════════════

/** Fallback chain for each provider */
export const providerFallbackChain: Record<LlmProvider, LlmProvider[]> = {
  openai: ["gemini", "openrouter", "anthropic"],
  anthropic: ["openrouter", "gemini", "openai"],
  gemini: ["openrouter", "openai", "anthropic"],
  openrouter: ["gemini", "openai", "anthropic"],
  xai: ["openrouter", "anthropic", "openai"],
};

/** Model equivalents across providers (for failover) - 8 approved models */
export const modelEquivalents: Record<string, Record<LlmProvider, string>> = {
  // High-tier models
  "gpt-5.4": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "gemini-3.1-pro-preview", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "claude-opus-4.7": { openai: "gpt-5.4", anthropic: "claude-opus-4.7", gemini: "gemini-3.1-pro-preview", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "claude-sonnet-4.6": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "gemini-3.1-pro-preview", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "gemini-3.1-pro-preview": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "gemini-3.1-pro-preview", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "deep-research-preview-04-2026": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "deep-research-preview-04-2026", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "deep-research-max-preview-04-2026": { openai: "gpt-5.4", anthropic: "claude-opus-4.7", gemini: "deep-research-max-preview-04-2026", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "glm-4.7": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "gemini-3.1-pro-preview", openrouter: "glm-4.7", xai: "grok-4-1-fast-reasoning" },
  "kimi-k2.6": { openai: "gpt-5.4", anthropic: "claude-sonnet-4.6", gemini: "gemini-3.1-pro-preview", openrouter: "kimi-k2.6", xai: "grok-4-1-fast-reasoning" },
  "minimax-m2.7": { openai: "gpt-5.4-mini", anthropic: "claude-haiku-4.5", gemini: "gemini-3-flash-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },

  // Mid-tier/balanced models
  "gpt-5.4-mini": { openai: "gpt-5.4-mini", anthropic: "claude-haiku-4.5", gemini: "gemini-3-flash-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
  "glm-4.7-flash": { openai: "gpt-5.4-mini", anthropic: "claude-haiku-4.5", gemini: "gemini-3-flash-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },

  // Fast/efficient models
  "gpt-5.4-nano": { openai: "gpt-5.4-nano", anthropic: "claude-haiku-4.5", gemini: "gemini-3.1-flash-lite-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
  "claude-haiku-4.5": { openai: "gpt-5.4-nano", anthropic: "claude-haiku-4.5", gemini: "gemini-3.1-flash-lite-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
  "gemini-3-flash-preview": { openai: "gpt-5.4-mini", anthropic: "claude-haiku-4.5", gemini: "gemini-3-flash-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
  "gemini-3.1-flash-lite-preview": { openai: "gpt-5.4-nano", anthropic: "claude-haiku-4.5", gemini: "gemini-3.1-flash-lite-preview", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
  "gemini-2.5-flash": { openai: "gpt-5.4-mini", anthropic: "claude-haiku-4.5", gemini: "gemini-2.5-flash", openrouter: "minimax-m2.7", xai: "grok-3-mini" },
};

/**
 * Get equivalent model for a different provider (for failover)
 */
export function getEquivalentModel(modelName: string, targetProvider: LlmProvider): string {
  const equivalents = ownEntry(modelEquivalents, modelName);
  if (equivalents?.[targetProvider]) {
    return equivalents[targetProvider];
  }

  // Default fallback by provider (8 approved models)
  const defaults: Record<LlmProvider, string> = {
    openai: "gpt-5.4-nano",
    anthropic: "claude-haiku-4.5",
    gemini: "gemini-3.1-flash-lite-preview",
    openrouter: "kimi-k2.6",
    xai: "grok-3-mini",            // Cheapest xAI (Jan 2026)
  };

  return defaults[targetProvider];
}

/**
 * The verified free lane's OpenRouter wire id, typed once: modelResolver.ts imports it for
 * `MODEL_SPECS[FREE_LANE_MODEL].sdkId`. SPEC-v9 A.2.10: the alias `nemotron-3-super-free`
 * never reaches a provider.
 */
export const FREE_LANE_WIRE_ID = "nvidia/nemotron-3-super-120b-a12b:free";

/**
 * The string to put in a provider request. Callers of `getModelWithFailover`
 * send `model` straight to the provider SDK, so for Anthropic it must be the
 * wire id, not the dotted catalog alias (api.anthropic.com 404s on
 * "claude-sonnet-4.6"), and the free-lane alias becomes its OpenRouter wire id.
 * Only known ids reach here (`getModelWithFailover` throws on the rest), so an id
 * with no table entry is already its own wire id (openai, gemini: sdkId == alias).
 */
function toProviderWireId(model: string, provider: LlmProvider): string {
  if (provider === "openrouter" && model === FREE_LANE_CATALOG_ID) return FREE_LANE_WIRE_ID;
  return provider === "anthropic" ? (anthropicWireId(model) ?? model) : model;
}

/**
 * The verified free lane's alias, typed once: modelResolver.ts imports it as `FREE_LANE_MODEL`.
 */
export const FREE_LANE_CATALOG_ID = "nemotron-3-super-free";

/** The free route aliases; mirrors `routeAliasToModel` (routeTier "free") in modelResolver.ts. */
const FREE_ROUTE_ALIASES = new Set(["free", "auto-free", "nodebench:auto-free", "kilo-auto/free", "openrouter/free"]);

/** Free-looking unknown ids: the OpenRouter `-free` / `:free` suffix or a free route alias. */
function isFreeLookingModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return /(-|:)free$/.test(normalized) || FREE_ROUTE_ALIASES.has(normalized);
}

/**
 * A model this catalog knows by name or by wire id (`ANTHROPIC_WIRE_IDS` values; for openai and
 * gemini the resolver's sdkId equals the catalog name, pinned by anthropicWireIds.test.ts), or an id
 * main passed through that the resolver still recognises (`LEGACY_PASSTHROUGH_IDS`). A provider
 * prefix (`gpt-`, `claude-`, `gemini-`) is not knowledge: an id that is only prefix-shaped is unknown.
 */
function isKnownCatalogModel(model: string): boolean {
  return (
    ownEntry(modelPricing, model) != null ||
    ownEntry(modelEquivalents, model) != null ||
    LEGACY_PASSTHROUGH_IDS.has(model) ||
    SPEC_NATIVE_WIRE_IDS.has(model) ||
    anthropicWireId(model) !== null
  );
}

/**
 * Throws `UnknownModelError` unless `getModelWithFailover` would dispatch `model` (a known model or
 * a free-looking id). Public actions call it with `resolveModelAlias(input)` before they hand the
 * caller's string on, so the boundary accepts exactly what dispatch accepts. It reads no
 * environment: whether a provider is configured is dispatch's concern, not validation's.
 */
export function assertKnownModel(model: string): void {
  if (OPENROUTER_ONLY_REGISTRY_IDS.has(model)) {
    throw new UnknownModelError(model, "a registered OpenRouter id this catalog cannot dispatch until PR 2 adds the OpenRouter branch; it is refused, never rerouted to another model");
  }
  if (!isKnownCatalogModel(model) && !isFreeLookingModel(model)) {
    throw new UnknownModelError(model, "an unrecognised id never fails over to a paid default and is never sent to a provider");
  }
}

function isFreeCatalogModel(model: string): boolean {
  const price = ownEntry(modelPricing, model);
  return price != null && price.inputPer1M === 0 && price.outputPer1M === 0;
}

/**
 * Get a working model with failover.
 * An unknown id fails closed (SPEC-v9 A.0.10): free-looking -> the free lane (wire id),
 * anything else throws before any provider is consulted, so a public API argument can
 * never reach a paid provider unvalidated. A free model never fails over to a paid provider.
 * Tries the preferred model's provider first, then falls back to alternatives.
 * The returned `model` is the provider wire id (see `toProviderWireId`).
 */
export function getModelWithFailover(preferredModel: string): {
  model: string;
  provider: LlmProvider;
  isFallback: boolean;
} {
  assertKnownModel(preferredModel);
  const known = isKnownCatalogModel(preferredModel);
  const provider = getProviderForModel(preferredModel);

  if (!known && isFreeLookingModel(preferredModel)) {
    // The wire id, not the alias: the caller sends `model` to the provider as is.
    console.warn(`[getModelWithFailover] unrecognised free-looking id "${preferredModel}" -> the verified free lane ${FREE_LANE_WIRE_ID}`);
    return { model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true };
  }
  if (!provider) throw new UnknownModelError(preferredModel, "no provider for this id");

  // Check if preferred provider is configured
  if (isProviderConfigured(provider)) {
    return { model: toProviderWireId(preferredModel, provider), provider, isFallback: false };
  }

  if (isFreeCatalogModel(preferredModel)) {
    throw new Error(`[getModelWithFailover] Free model "${preferredModel}": ${provider} is not configured and a free request never fails over to a paid provider`);
  }

  // Try fallback providers
  const fallbacks = providerFallbackChain[provider];
  for (const fallbackProvider of fallbacks) {
    if (isProviderConfigured(fallbackProvider)) {
      const equivalentModel = getEquivalentModel(preferredModel, fallbackProvider);
      console.warn(`[getModelWithFailover] ${provider} not configured, falling back to ${fallbackProvider}: ${equivalentModel}`);
      return {
        model: toProviderWireId(equivalentModel, fallbackProvider),
        provider: fallbackProvider,
        isFallback: true,
      };
    }
  }
  
  // Last resort: return OpenAI default
  console.error(`[getModelWithFailover] No providers configured! Using default.`);
  return { model: DEFAULT_FALLBACK_MODEL, provider: "openai", isFallback: true };
}
