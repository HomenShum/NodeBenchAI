/**
 * Model registry for the leaderboard pipeline.
 *
 * Categorizes free + paid OpenRouter models by recency + capability per
 * AI Index trends. Each entry carries metadata so the leaderboard can
 * group + sort by tier, release era, and cost expectation.
 *
 * Pulled from @mariozechner/pi-ai's openrouter registry (free models
 * confirmed available; paid models require credits in OPENROUTER_API_KEY).
 */

export type ModelTier = "frontier-free" | "free" | "paid-frontier" | "paid";
export type ReleaseEra = "2024" | "2025-h1" | "2025-h2" | "2026";

export interface LeaderboardModel {
  id: string;
  display: string;
  vendor: string;
  paramsApprox?: string; // e.g. "120B", "1T", "70B"
  tier: ModelTier;
  era: ReleaseEra;
  notes?: string;
}

/**
 * Free models — most recent first per AI Index trends. The ones above the
 * `--- separator ---` (in the comments) are the highest-capability free
 * choices in late 2025 / early 2026; below are smaller / older.
 */
export const FREE_MODELS: LeaderboardModel[] = [
  // ── 2025-H2 / 2026 frontier-free (recent + large) ────────────────────
  { id: "inclusionai/ling-2.6-1t:free",            display: "Ling 2.6 1T",        vendor: "InclusionAI", paramsApprox: "1T",   tier: "frontier-free", era: "2025-h2", notes: "1T sparse MoE; reasoning-strong" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",   display: "Qwen3-Next 80B",     vendor: "Alibaba",     paramsApprox: "80B",  tier: "frontier-free", era: "2025-h2", notes: "Qwen3 next-gen instruct" },
  { id: "openai/gpt-oss-120b:free",                display: "GPT-OSS 120B",       vendor: "OpenAI",      paramsApprox: "120B", tier: "frontier-free", era: "2025-h2", notes: "OpenAI open-weight release" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",  display: "Nemotron 3 Super",   vendor: "NVIDIA",      paramsApprox: "120B", tier: "frontier-free", era: "2025-h2", notes: "Nemotron 3 super" },
  { id: "minimax/minimax-m2.5:free",               display: "MiniMax M2.5",       vendor: "MiniMax",     paramsApprox: "?",    tier: "frontier-free", era: "2025-h2" },
  { id: "tencent/hy3-preview:free",                display: "Hunyuan 3 Preview",  vendor: "Tencent",     paramsApprox: "?",    tier: "frontier-free", era: "2025-h2", notes: "Tencent Hunyuan 3 preview" },
  { id: "z-ai/glm-4.5-air:free",                   display: "GLM 4.5 Air",        vendor: "Z-AI",        paramsApprox: "?",    tier: "frontier-free", era: "2025-h2" },
  { id: "inclusionai/ling-2.6-flash:free",         display: "Ling 2.6 Flash",     vendor: "InclusionAI", paramsApprox: "?",    tier: "free",          era: "2025-h2" },
  { id: "qwen/qwen3-coder:free",                   display: "Qwen3 Coder",        vendor: "Alibaba",     paramsApprox: "?",    tier: "free",          era: "2025-h2", notes: "code-tuned" },

  // ── Mid-size free (capable, smaller) ─────────────────────────────────
  { id: "google/gemma-4-31b-it:free",              display: "Gemma 4 31B",        vendor: "Google",      paramsApprox: "31B",  tier: "free",          era: "2025-h2" },
  { id: "google/gemma-4-26b-a4b-it:free",          display: "Gemma 4 26B-A4B",    vendor: "Google",      paramsApprox: "26B",  tier: "free",          era: "2025-h2", notes: "MoE" },
  { id: "openai/gpt-oss-20b:free",                 display: "GPT-OSS 20B",        vendor: "OpenAI",      paramsApprox: "20B",  tier: "free",          era: "2025-h2" },
  { id: "meta-llama/llama-3.3-70b-instruct:free",  display: "Llama 3.3 70B",      vendor: "Meta",        paramsApprox: "70B",  tier: "free",          era: "2024",    notes: "older but proven" },

  // ── Small / specialized free ─────────────────────────────────────────
  { id: "nvidia/nemotron-3-nano-30b-a3b:free",     display: "Nemotron 3 Nano 30B",vendor: "NVIDIA",      paramsApprox: "30B",  tier: "free",          era: "2025-h2" },
  { id: "nvidia/nemotron-nano-12b-v2-vl:free",     display: "Nemotron Nano VL",   vendor: "NVIDIA",      paramsApprox: "12B",  tier: "free",          era: "2025-h2", notes: "VLM" },
  { id: "nvidia/nemotron-nano-9b-v2:free",         display: "Nemotron Nano 9B",   vendor: "NVIDIA",      paramsApprox: "9B",   tier: "free",          era: "2025-h2" },
];

/**
 * Paid models — frontier reference points for comparison. Used in the
 * leaderboard to provide a ceiling so the free models can be measured
 * against a known-good benchmark.
 */
export const PAID_MODELS: LeaderboardModel[] = [
  { id: "anthropic/claude-opus-4.7",          display: "Claude Opus 4.7",     vendor: "Anthropic",  paramsApprox: "?",    tier: "paid-frontier", era: "2026",    notes: "current Anthropic frontier" },
  { id: "anthropic/claude-sonnet-4.6",        display: "Claude Sonnet 4.6",   vendor: "Anthropic",  paramsApprox: "?",    tier: "paid-frontier", era: "2025-h2", notes: "balanced" },
  { id: "moonshotai/kimi-k2.6",               display: "Kimi K2.6",           vendor: "Moonshot",   paramsApprox: "?",    tier: "paid-frontier", era: "2025-h2", notes: "proven in parity-studio repo" },
  { id: "deepseek/deepseek-v4-pro",           display: "DeepSeek V4 Pro",     vendor: "DeepSeek",   paramsApprox: "?",    tier: "paid-frontier", era: "2025-h2" },
  { id: "google/gemini-3.1-pro-preview",      display: "Gemini 3.1 Pro",      vendor: "Google",     paramsApprox: "?",    tier: "paid-frontier", era: "2025-h2" },
];

export const ALL_MODELS = [...FREE_MODELS, ...PAID_MODELS];
