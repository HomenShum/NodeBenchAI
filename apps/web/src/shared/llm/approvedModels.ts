/**
 * Approved Models - UI and frontend single source of truth.
 *
 * NOTE: Backend model resolution lives in
 * `convex/domains/agents/mcp_tools/models/modelResolver.ts`.
 * Keep this file aligned with the backend resolver.
 */

export const APPROVED_MODELS = [
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
  "glm-4.7-flash",
  "glm-4.7",
  "kimi-k2.6",
  "deepseek-r1",
  "deepseek-v3.2-speciale",
  "deepseek-v3.2",
  "qwen3-235b",
  "minimax-m2.7",
  "mistral-large",
  "qwen3-coder-free",
  "step-3.5-flash-free",
  "gpt-oss-120b-free",
  "qwen3-next-free",
  "trinity-large-free",
  "nemotron-3-nano-free",
  "mistral-small-3.1-free",
  "llama-3.3-70b-free",
  "gemma-3-27b-free",
  "gpt-oss-20b-free",
  "trinity-mini-free",
  "nemotron-nano-12b-vl-free",
  "deepseek-r1-free",
  "glm-4.5-air-free",
  "deepseek-chimera-free",
  "venice-dolphin-free",
] as const;

export type ApprovedModel = (typeof APPROVED_MODELS)[number];

export type Provider = "openai" | "anthropic" | "google" | "openrouter";

export interface ModelUIInfo {
  id: ApprovedModel;
  name: string;
  provider: Provider;
  description: string;
  tier: "fast" | "balanced" | "powerful";
  contextWindow: string;
  icon: string;
  isFree?: boolean;
}

export const MODEL_UI_INFO: Record<ApprovedModel, ModelUIInfo> = {
  "gpt-5.4": {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    description: "Frontier flagship",
    tier: "powerful",
    contextWindow: "1.05M",
    icon: "OA",
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "openai",
    description: "Strongest mini",
    tier: "balanced",
    contextWindow: "400K",
    icon: "OA",
  },
  "gpt-5.4-nano": {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 Nano",
    provider: "openai",
    description: "Cheapest GPT-5.4-class model",
    tier: "fast",
    contextWindow: "400K",
    icon: "OA",
  },
  "claude-opus-4.7": {
    id: "claude-opus-4.7",
    name: "Claude Opus 4.7",
    provider: "anthropic",
    description: "Current Anthropic flagship",
    tier: "powerful",
    contextWindow: "1M",
    icon: "AN",
  },
  "claude-sonnet-4.6": {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    description: "Current balanced Anthropic model",
    tier: "balanced",
    contextWindow: "1M",
    icon: "AN",
  },
  "claude-haiku-4.5": {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    description: "Current fast Anthropic model",
    tier: "fast",
    contextWindow: "200K",
    icon: "AN",
  },
  "claude-opus-4.1": {
    id: "claude-opus-4.1",
    name: "Claude Opus 4.1",
    provider: "anthropic",
    description: "Legacy compatibility flagship",
    tier: "powerful",
    contextWindow: "200K",
    icon: "AN",
  },
  "claude-opus-4": {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    provider: "anthropic",
    description: "Previous flagship",
    tier: "powerful",
    contextWindow: "200K",
    icon: "AN",
  },
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    description: "Legacy compatibility balance",
    tier: "balanced",
    contextWindow: "200K",
    icon: "AN",
  },
  "claude-haiku-3.5": {
    id: "claude-haiku-3.5",
    name: "Claude Haiku 3.5",
    provider: "anthropic",
    description: "Legacy compatibility fast lane",
    tier: "fast",
    contextWindow: "200K",
    icon: "AN",
  },
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "google",
    description: "Latest 3.x flagship preview",
    tier: "powerful",
    contextWindow: "1M",
    icon: "GG",
  },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    description: "Latest 3.x flash preview",
    tier: "balanced",
    contextWindow: "1M",
    icon: "GG",
  },
  "gemini-3.1-flash-lite-preview": {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash-Lite Preview",
    provider: "google",
    description: "Latest 3.x low-cost preview",
    tier: "fast",
    contextWindow: "1M",
    icon: "GG",
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    description: "Stable flagship",
    tier: "powerful",
    contextWindow: "1M",
    icon: "GG",
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    description: "Stable flash",
    tier: "balanced",
    contextWindow: "1M",
    icon: "GG",
  },
  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "google",
    description: "Stable low-cost flash-lite",
    tier: "fast",
    contextWindow: "1M",
    icon: "GG",
  },
  "glm-4.7-flash": {
    id: "glm-4.7-flash",
    name: "GLM 4.7 Flash",
    provider: "openrouter",
    description: "Cheap fast agentic coding",
    tier: "fast",
    contextWindow: "200K",
    icon: "OR",
  },
  "glm-4.7": {
    id: "glm-4.7",
    name: "GLM 4.7",
    provider: "openrouter",
    description: "Flagship reasoning and coding",
    tier: "balanced",
    contextWindow: "203K",
    icon: "OR",
  },
  "kimi-k2.6": {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "openrouter",
    description: "Moonshot advisor and orchestrator lane",
    tier: "powerful",
    contextWindow: "262K",
    icon: "OR",
  },
  "deepseek-r1": {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "openrouter",
    description: "Reasoning model",
    tier: "powerful",
    contextWindow: "164K",
    icon: "OR",
  },
  "deepseek-v3.2-speciale": {
    id: "deepseek-v3.2-speciale",
    name: "DeepSeek V3.2 Speciale",
    provider: "openrouter",
    description: "Agentic variant",
    tier: "fast",
    contextWindow: "164K",
    icon: "OR",
  },
  "deepseek-v3.2": {
    id: "deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "openrouter",
    description: "General purpose",
    tier: "balanced",
    contextWindow: "164K",
    icon: "OR",
  },
  "qwen3-235b": {
    id: "qwen3-235b",
    name: "Qwen3 235B",
    provider: "openrouter",
    description: "Tool calling, large model",
    tier: "powerful",
    contextWindow: "131K",
    icon: "OR",
  },
  "minimax-m2.7": {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "openrouter",
    description: "Fast agentic executor",
    tier: "balanced",
    contextWindow: "197K",
    icon: "OR",
  },
  "mistral-large": {
    id: "mistral-large",
    name: "Mistral Large",
    provider: "openrouter",
    description: "Function calling",
    tier: "powerful",
    contextWindow: "131K",
    icon: "OR",
  },
  "qwen3-coder-free": {
    id: "qwen3-coder-free",
    name: "Qwen3 Coder (Free)",
    provider: "openrouter",
    description: "480B MoE agentic coding",
    tier: "powerful",
    contextWindow: "262K",
    icon: "OR",
    isFree: true,
  },
  "step-3.5-flash-free": {
    id: "step-3.5-flash-free",
    name: "Step 3.5 Flash (Free)",
    provider: "openrouter",
    description: "Reasoning and tools",
    tier: "balanced",
    contextWindow: "256K",
    icon: "OR",
    isFree: true,
  },
  "gpt-oss-120b-free": {
    id: "gpt-oss-120b-free",
    name: "GPT-OSS 120B (Free)",
    provider: "openrouter",
    description: "Open-weight tool-capable model",
    tier: "powerful",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "qwen3-next-free": {
    id: "qwen3-next-free",
    name: "Qwen3 Next (Free)",
    provider: "openrouter",
    description: "Large-context free model",
    tier: "balanced",
    contextWindow: "262K",
    icon: "OR",
    isFree: true,
  },
  "trinity-large-free": {
    id: "trinity-large-free",
    name: "Trinity Large (Free)",
    provider: "openrouter",
    description: "Agentic free model",
    tier: "powerful",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "nemotron-3-nano-free": {
    id: "nemotron-3-nano-free",
    name: "Nemotron 3 Nano (Free)",
    provider: "openrouter",
    description: "High-throughput free model",
    tier: "fast",
    contextWindow: "256K",
    icon: "OR",
    isFree: true,
  },
  "mistral-small-3.1-free": {
    id: "mistral-small-3.1-free",
    name: "Mistral Small 3.1 (Free)",
    provider: "openrouter",
    description: "Solid tool calling",
    tier: "fast",
    contextWindow: "128K",
    icon: "OR",
    isFree: true,
  },
  "llama-3.3-70b-free": {
    id: "llama-3.3-70b-free",
    name: "Llama 3.3 70B (Free)",
    provider: "openrouter",
    description: "Meta workhorse",
    tier: "balanced",
    contextWindow: "128K",
    icon: "OR",
    isFree: true,
  },
  "gemma-3-27b-free": {
    id: "gemma-3-27b-free",
    name: "Gemma 3 27B (Free)",
    provider: "openrouter",
    description: "Google open-weight 27B",
    tier: "fast",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "gpt-oss-20b-free": {
    id: "gpt-oss-20b-free",
    name: "GPT-OSS 20B (Free)",
    provider: "openrouter",
    description: "Small open-weight option",
    tier: "fast",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "trinity-mini-free": {
    id: "trinity-mini-free",
    name: "Trinity Mini (Free)",
    provider: "openrouter",
    description: "Lightweight agentic model",
    tier: "fast",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "nemotron-nano-12b-vl-free": {
    id: "nemotron-nano-12b-vl-free",
    name: "Nemotron 12B VL (Free)",
    provider: "openrouter",
    description: "Vision and tools",
    tier: "fast",
    contextWindow: "128K",
    icon: "OR",
    isFree: true,
  },
  "deepseek-r1-free": {
    id: "deepseek-r1-free",
    name: "DeepSeek R1 (Free)",
    provider: "openrouter",
    description: "Reasoning model",
    tier: "powerful",
    contextWindow: "164K",
    icon: "OR",
    isFree: true,
  },
  "glm-4.5-air-free": {
    id: "glm-4.5-air-free",
    name: "GLM 4.5 Air (Free)",
    provider: "openrouter",
    description: "Agent-focused free model",
    tier: "fast",
    contextWindow: "131K",
    icon: "OR",
    isFree: true,
  },
  "deepseek-chimera-free": {
    id: "deepseek-chimera-free",
    name: "DeepSeek Chimera (Free)",
    provider: "openrouter",
    description: "Strong free reasoning model",
    tier: "powerful",
    contextWindow: "164K",
    icon: "OR",
    isFree: true,
  },
  "venice-dolphin-free": {
    id: "venice-dolphin-free",
    name: "Venice Dolphin (Free)",
    provider: "openrouter",
    description: "Low-latency Dolphin variant",
    tier: "fast",
    contextWindow: "32K",
    icon: "OR",
    isFree: true,
  },
};

export const DEFAULT_MODEL: ApprovedModel = "kimi-k2.6";
export const FALLBACK_MODEL: ApprovedModel = "gpt-5.4-mini";

export const MODEL_PRIORITY_ORDER: ApprovedModel[] = [
  "kimi-k2.6",
  "minimax-m2.7",
  "gemini-3.1-flash-lite-preview",
  "gpt-5.4-mini",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gpt-5.4",
  "claude-sonnet-4.6",
  "claude-opus-4.7",
  "claude-haiku-4.5",
  "gpt-5.4-nano",
  "qwen3-coder-free",
  "step-3.5-flash-free",
  "gpt-oss-120b-free",
  "trinity-large-free",
  "nemotron-3-nano-free",
];

export type NodeBenchRuntimeProfile = "advisor" | "executor" | "background";

export const NODEBENCH_ADVISOR_MODEL: ApprovedModel = "kimi-k2.6";

export const NODEBENCH_EXECUTOR_MODELS: ApprovedModel[] = [
  "gemini-3.1-flash-lite-preview",
  "gpt-5.4-mini",
  "minimax-m2.7",
  "gemini-3-flash-preview",
  "kimi-k2.6",
];

export const NODEBENCH_BACKGROUND_MODELS: ApprovedModel[] = [
  "gemini-3.1-pro-preview",
  "kimi-k2.6",
  "gpt-5.4",
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
  const normalized = String(input ?? "").trim();
  const candidate = isApprovedModel(normalized) ? normalized : null;
  const fallback =
    profile === "advisor"
      ? NODEBENCH_ADVISOR_MODEL
      : profile === "background"
        ? NODEBENCH_BACKGROUND_MODELS[0]
        : NODEBENCH_EXECUTOR_MODELS[0];

  if (!candidate) {
    return fallback;
  }

  if (profile === "advisor" && NODEBENCH_ADVISOR_ALLOWED.has(candidate)) {
    return candidate;
  }
  if (profile === "executor" && NODEBENCH_EXECUTOR_ALLOWED.has(candidate)) {
    return candidate;
  }
  if (profile === "background" && NODEBENCH_BACKGROUND_ALLOWED.has(candidate)) {
    return candidate;
  }

  return fallback;
}

export function isApprovedModel(model: string): model is ApprovedModel {
  return (APPROVED_MODELS as readonly string[]).includes(model);
}

export function getModelsByProvider(provider: Provider): ApprovedModel[] {
  return APPROVED_MODELS.filter((model) => MODEL_UI_INFO[model].provider === provider);
}

export function getModelUIList(): ModelUIInfo[] {
  return APPROVED_MODELS.map((model) => MODEL_UI_INFO[model]);
}

export const PROVIDER_COLORS: Record<
  Provider,
  { bg: string; border: string; text: string; icon: string }
> = {
  openai: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-content-secondary", icon: "OA" },
  anthropic: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: "AN" },
  google: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "GG" },
  openrouter: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", icon: "OR" },
};
