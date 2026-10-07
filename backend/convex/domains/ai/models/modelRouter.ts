"use node";

/**
 * Model Router — Unified Inference Layer (Action)
 *
 * Single entrypoint for ALL model calls in the system.
 * Enforces: routing by task/cost/quality tier, caching, token budgets per agent,
 * model version pinning for repro packs, rate limiting, and audit logging.
 *
 * Queries and mutations live in modelRouterQueries.ts (cannot be in "use node" files).
 *
 * Architecture upgrade: turns "we use models" into "we operate an inference layer."
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../agents/mcp_tools/models";
// B-PR4: capability-aware fallback chain.
// resolveChain replaces the static `[...TIER_MODELS[tier]]` candidate list
// with a tier-floor-enforced ordering that respects requested capabilities
// (vision, tools, reasoning, long-context). See chainResolver.ts (B-PR3)
// and capabilityRegistry.ts (B-PR2).
import { resolveChain } from "./chainResolver";
import type { CapabilityRequirement, ModelTier } from "./capabilityRegistry";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TaskTier = "free" | "cheap" | "standard" | "premium";
export type TaskCategory =
  | "research"
  | "synthesis"
  | "publishing"
  | "validation"
  | "judge"
  | "agent_loop"
  | "content_generation"
  | "entity_extraction"
  | "translation"
  | "summarization";

export interface RouteRequest {
  /** Task category for routing decisions */
  taskCategory: TaskCategory;
  /** Quality tier (free→premium) */
  tier?: TaskTier;
  /** System prompt */
  systemPrompt: string;
  /** User message(s) */
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Max output tokens */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Calling agent ID (for budget enforcement) */
  agentId?: string;
  /** Pin to specific model (for repro packs) */
  pinnedModel?: string;
  /** Cache key for response caching (omit to disable caching) */
  cacheKey?: string;
  /** Cache TTL in ms (default: 5 min) */
  cacheTtlMs?: number;
  /** Require specific capabilities */
  requiredCapabilities?: {
    toolUse?: boolean;
    vision?: boolean;
    structuredOutputs?: boolean;
    minContext?: number;
  };
}

export interface RouteResult {
  /** Generated text */
  text: string;
  /** Model used */
  modelId: string;
  /** Whether this was a free model */
  isFree: boolean;
  /** Token usage */
  inputTokens: number;
  outputTokens: number;
  /** Cost in USD */
  costUsd: number;
  /** Latency in ms */
  latencyMs: number;
  /** Whether result came from cache */
  fromCache: boolean;
  /** Routing decision metadata */
  routing: {
    requestedTier: TaskTier;
    actualTier: TaskTier;
    taskCategory: TaskCategory;
    fallbacksUsed: number;
    pinnedModel: string | null;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL TIERS — which models serve which tier
// ═══════════════════════════════════════════════════════════════════════════

const TIER_MODELS: Record<TaskTier, string[]> = {
  free: [
    "qwen3-coder-free",
    "step-3.5-flash-free",
    "openai-gpt-oss-120b-free",
    "arcee-trinity-large-free",
    "nemotron-3-nano-30b-free",
    "llama-3.3-70b-free",
  ],
  cheap: [
    "glm-4.7-flash",       // $0.07/M
    "gemini-3-flash-preview",
    "claude-haiku-4.5",
    "gpt-5.4-nano",
  ],
  standard: [
    "kimi-k2.6",
    "gemini-3-flash-preview",
    "claude-haiku-4.5",
    "gpt-5.4-mini",
  ],
  premium: [
    "kimi-k2.6",
    "claude-sonnet-4.6",
    "claude-opus-4.7",
    "gpt-5.4",
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro",
  ],
};

/** Cost per million tokens (input/output) for budget tracking */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "qwen3-coder-free": { input: 0, output: 0 },
  "step-3.5-flash-free": { input: 0, output: 0 },
  "openai-gpt-oss-120b-free": { input: 0, output: 0 },
  "arcee-trinity-large-free": { input: 0, output: 0 },
  "nemotron-3-nano-30b-free": { input: 0, output: 0 },
  "llama-3.3-70b-free": { input: 0, output: 0 },
  "glm-4.7-flash": { input: 0.07, output: 0.07 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "claude-haiku-4.5": { input: 1.00, output: 5.00 },
  "gpt-5.4-nano": { input: 0.20, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.50 },
  "claude-sonnet-4.6": { input: 3.00, output: 15.00 },
  "claude-opus-4.7": { input: 5.00, output: 25.00 },
  "gpt-5.4": { input: 2.50, output: 15.00 },
  "kimi-k2.6": { input: 0.75, output: 3.50 },
  "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 },
  "gemini-2.5-pro": { input: 1.25, output: 10.00 },
};

/** Task → default tier mapping */
const TASK_DEFAULT_TIER: Record<TaskCategory, TaskTier> = {
  research: "free",
  synthesis: "cheap",
  publishing: "cheap",
  validation: "free",
  judge: "standard",
  agent_loop: "standard",
  content_generation: "standard",
  entity_extraction: "free",
  translation: "cheap",
  summarization: "free",
};

// ═══════════════════════════════════════════════════════════════════════════
// COST CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[modelId] ?? { input: 1.0, output: 5.0 };
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY RESPONSE CACHE (per-process, ephemeral)
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry {
  text: string;
  modelId: string;
  expiresAt: number;
  inputTokens: number;
  outputTokens: number;
}

const responseCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): CacheEntry | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, entry: CacheEntry): void {
  // Evict old entries if cache grows too large (max 200 entries)
  if (responseCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of responseCache) {
      if (now > v.expiresAt) responseCache.delete(k);
    }
    // If still too large, evict oldest
    if (responseCache.size > 200) {
      const oldest = responseCache.keys().next().value;
      if (oldest) responseCache.delete(oldest);
    }
  }
  responseCache.set(key, entry);
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE — Main entrypoint
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Route a model call through the unified inference layer.
 * This is the ONLY entrypoint that should be used for model calls.
 *
 * Handles: tier-based model selection, caching, budget enforcement,
 * version pinning, fallback chains, and audit logging.
 */
export const route = internalAction({
  args: {
    taskCategory: v.string(),
    tier: v.optional(v.string()),
    systemPrompt: v.string(),
    messages: v.array(
      v.object({
        role: v.union(
          v.literal("user"),
          v.literal("assistant"),
          v.literal("system")
        ),
        content: v.string(),
      })
    ),
    maxTokens: v.optional(v.number()),
    temperature: v.optional(v.number()),
    agentId: v.optional(v.string()),
    pinnedModel: v.optional(v.string()),
    cacheKey: v.optional(v.string()),
    cacheTtlMs: v.optional(v.number()),
    requireToolUse: v.optional(v.boolean()),
    requireVision: v.optional(v.boolean()),
    requireStructuredOutputs: v.optional(v.boolean()),
    minContext: v.optional(v.number()),
    // B-PR8: lesson-aware failover. When supplied, the router queries
    // past infrastructure lessons for this thread to bias `preferIds`
    // and writes new lessons after each successful failover so future
    // routing prefers proven-good fallback chains.
    threadId: v.optional(v.string()),
    turnId: v.optional(v.number()),
  },
  returns: v.object({
    text: v.string(),
    modelId: v.string(),
    isFree: v.boolean(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    fromCache: v.boolean(),
    routing: v.object({
      requestedTier: v.string(),
      actualTier: v.string(),
      taskCategory: v.string(),
      fallbacksUsed: v.number(),
      pinnedModel: v.union(v.string(), v.null()),
    }),
  }),
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const tier = (args.tier ?? TASK_DEFAULT_TIER[args.taskCategory as TaskCategory] ?? "cheap") as TaskTier;

    // ─── Check cache ─────────────────────────────────────────────────
    if (args.cacheKey) {
      const cached = getCached(args.cacheKey);
      if (cached) {
        return {
          text: cached.text,
          modelId: cached.modelId,
          isFree: MODEL_PRICING[cached.modelId]?.input === 0,
          inputTokens: cached.inputTokens,
          outputTokens: cached.outputTokens,
          costUsd: 0,
          latencyMs: 0,
          fromCache: true,
          routing: {
            requestedTier: tier,
            actualTier: tier,
            taskCategory: args.taskCategory,
            fallbacksUsed: 0,
            pinnedModel: args.pinnedModel ?? null,
          },
        };
      }
    }

    // ─── Check agent budget ──────────────────────────────────────────
    if (args.agentId) {
      const budgetCheck = await ctx.runQuery(
        internal.domains.models.modelRouterQueries.checkAgentBudget,
        { agentId: args.agentId }
      );
      if (!budgetCheck.allowed) {
        throw new Error(
          `Agent ${args.agentId} budget exceeded: ${budgetCheck.reason}`
        );
      }
    }

    // ─── Build model candidate list ──────────────────────────────────
    // B-PR4: capability-aware chain with tier-floor enforcement.
    // We map the existing flat capability args onto a structured
    // `CapabilityRequirement` and ask the chain resolver (B-PR3) for an
    // ordered list. The static `TIER_MODELS` table remains a safety net
    // for two cases: (a) the resolver returns an empty chain (e.g. an
    // unusual capability requirement no registered model satisfies),
    // (b) `pinnedModel` overrides everything for repro-pack determinism.
    let candidates: string[];
    let chainDiagnostics: ReturnType<typeof resolveChain>["diagnostics"] | null =
      null;
    if (args.pinnedModel) {
      // Version pinning for repro packs — use exactly this model.
      candidates = [args.pinnedModel];
    } else {
      const requirement: CapabilityRequirement = {
        supportsTools: args.requireToolUse === true ? true : undefined,
        supportsVision: args.requireVision === true ? true : undefined,
        // 128k is the threshold the registry uses for `supportsLongContext`.
        supportsLongContext:
          (args.minContext ?? 0) >= 128_000 ? true : undefined,
      };

      // B-PR8: lesson-aware preferIds. When the caller passes a
      // `threadId` we ask the lessons store for proven-good fallback
      // toModels from past failovers and place them in front of the
      // operator-tuned `TIER_MODELS[tier]` ordering. HONEST_STATUS:
      // returns `[]` when no thread or no successful infrastructure
      // lessons exist, so we fall through to the static prefer list.
      let lessonPreferIds: string[] = [];
      if (args.threadId) {
        try {
          lessonPreferIds = await ctx.runQuery(
            internal.domains.agents.lessons.infraPreferIds
              .getInfraPreferIdsForThread,
            { threadId: args.threadId },
          );
        } catch (err) {
          console.warn(
            "[modelRouter] infraPreferIds query failed; continuing without lesson-bias:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // Lesson-derived preferIds first, then operator-tuned tier list.
      // Duplicates are de-duped by the resolver itself.
      const mergedPreferIds = [
        ...lessonPreferIds,
        ...(TIER_MODELS[tier] ?? []),
      ];

      const resolution = resolveChain({
        requirement,
        tierFloor: tier as ModelTier,
        primaryModelId: TIER_MODELS[tier]?.[0] ?? null,
        preferIds: mergedPreferIds,
      });
      chainDiagnostics = resolution.diagnostics;
      candidates = resolution.chain;
      console.log(
        `[modelRouter] resolved chain tier=${tier} task=${args.taskCategory} length=${candidates.length} primary=${chainDiagnostics.primaryOutcome} pool=${chainDiagnostics.candidatePoolSize} lessonPrefer=${lessonPreferIds.length}`,
      );

      // HONEST_STATUS safety net — fall back to the legacy static list
      // when the registry has no matching entry (e.g. a brand-new model
      // not yet added to capabilityRegistry.ts). The audit log records
      // the resolver reason so this is visible, not silent.
      if (candidates.length === 0) {
        console.warn(
          `[modelRouter] chain resolver returned empty (reason=${resolution.reason}); falling back to TIER_MODELS[${tier}]`,
        );
        candidates = [...(TIER_MODELS[tier] ?? TIER_MODELS.cheap)];
        if (tier === "free") {
          candidates.push(...TIER_MODELS.cheap);
        }
      }
    }

    // ─── Try models in order with fallback ───────────────────────────
    let lastError: Error | null = null;
    let fallbacksUsed = 0;
    let actualTier = tier;

    // B-PR8: track each abandoned attempt with the status code that
    // caused us to move on. The on-success and on-terminal-failure
    // paths consume this list to capture infrastructure lessons.
    const failedAttempts: Array<{
      modelId: string;
      failedWith: number | string;
    }> = [];

    for (const modelId of candidates) {
      try {
        const model = getLanguageModelSafe(modelId);
        if (!model) continue;

        const result = await generateText({
          model,
          system: args.systemPrompt,
          messages: args.messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
          maxOutputTokens: args.maxTokens ?? 2048,
          temperature: args.temperature ?? 0.3,
        });

        const inputTokens = result.usage?.inputTokens ?? 0;
        const outputTokens = result.usage?.outputTokens ?? 0;
        const costUsd = calculateCost(modelId, inputTokens, outputTokens);
        const latencyMs = Date.now() - startTime;
        const isFree = MODEL_PRICING[modelId]?.input === 0;

        // Determine actual tier based on model used
        if (isFree) actualTier = "free";
        else if (TIER_MODELS.cheap.includes(modelId)) actualTier = "cheap";
        else if (TIER_MODELS.standard.includes(modelId)) actualTier = "standard";
        else actualTier = "premium";

        // ─── Cache result ──────────────────────────────────────────
        if (args.cacheKey) {
          setCache(args.cacheKey, {
            text: result.text,
            modelId,
            expiresAt: Date.now() + (args.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
            inputTokens,
            outputTokens,
          });
        }

        // ─── Log to audit trail ────────────────────────────────────
        await ctx.runMutation(
          internal.domains.models.modelRouterQueries.logRouterCall,
          {
            modelId,
            taskCategory: args.taskCategory,
            requestedTier: tier,
            actualTier,
            agentId: args.agentId,
            inputTokens,
            outputTokens,
            costUsd,
            latencyMs,
            fallbacksUsed,
            fromCache: false,
            pinnedModel: args.pinnedModel ?? null,
            success: true,
            errorMessage: null,
          }
        );

        // B-PR8: capture infrastructure lessons for every fromModel ->
        // succeeded toModel hop in this chain. Future routing decisions
        // see these lessons via `getInfraPreferIdsForThread` and bias
        // towards proven-good fallbacks. Best-effort — capture failures
        // log a warning but never bring down a successful response.
        if (args.threadId && args.turnId !== undefined && failedAttempts.length > 0) {
          for (const failed of failedAttempts) {
            try {
              await ctx.runMutation(
                internal.domains.agents.lessons.captureLesson
                  .captureInfrastructureLesson,
                {
                  threadId: args.threadId,
                  turnId: args.turnId,
                  fromModel: failed.modelId,
                  toModel: modelId,
                  failedWith: failed.failedWith,
                  succeeded: true,
                },
              );
            } catch (lessonErr) {
              console.warn(
                `[modelRouter] captureInfrastructureLesson failed for ${failed.modelId} -> ${modelId}:`,
                lessonErr instanceof Error
                  ? lessonErr.message
                  : String(lessonErr),
              );
            }
          }
        }

        return {
          text: result.text,
          modelId,
          isFree,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs,
          fromCache: false,
          routing: {
            requestedTier: tier,
            actualTier,
            taskCategory: args.taskCategory,
            fallbacksUsed,
            pinnedModel: args.pinnedModel ?? null,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        fallbacksUsed++;

        // B-PR8: record this attempt for downstream lesson capture.
        const rawStatus = (err as any)?.status ?? (err as any)?.statusCode;
        const failedWith: number | string =
          typeof rawStatus === "number"
            ? rawStatus
            : (lastError.message || "error").slice(0, 80);
        failedAttempts.push({ modelId, failedWith });

        // Retry on 429/503 with backoff
        if (
          typeof rawStatus === "number" &&
          [429, 502, 503, 504].includes(rawStatus)
        ) {
          const delay = Math.min(1000 * fallbacksUsed, 5000) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // ─── All models failed — log and throw ───────────────────────────
    await ctx.runMutation(
      internal.domains.models.modelRouterQueries.logRouterCall,
      {
        modelId: candidates[0] ?? "unknown",
        taskCategory: args.taskCategory,
        requestedTier: tier,
        actualTier: tier,
        agentId: args.agentId,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startTime,
        fallbacksUsed,
        fromCache: false,
        pinnedModel: args.pinnedModel ?? null,
        success: false,
        errorMessage: lastError?.message ?? "All models failed",
      }
    );

    // B-PR8: record a single terminal-failure lesson with succeeded=false
    // covering the first → last hop. Future planning sees that this chain
    // exhausted on this thread and can request a higher tier or different
    // capabilities up-front. Best-effort — capture errors are warned, not
    // thrown, so the original failure surfaces to the caller intact.
    if (
      args.threadId &&
      args.turnId !== undefined &&
      failedAttempts.length >= 1
    ) {
      const first = failedAttempts[0];
      const last = failedAttempts[failedAttempts.length - 1];
      try {
        await ctx.runMutation(
          internal.domains.agents.lessons.captureLesson
            .captureInfrastructureLesson,
          {
            threadId: args.threadId,
            turnId: args.turnId,
            fromModel: first.modelId,
            toModel: last.modelId,
            failedWith: last.failedWith,
            succeeded: false,
          },
        );
      } catch (lessonErr) {
        console.warn(
          "[modelRouter] terminal captureInfrastructureLesson failed:",
          lessonErr instanceof Error
            ? lessonErr.message
            : String(lessonErr),
        );
      }
    }

    throw new Error(
      `ModelRouter: All ${candidates.length} models failed for ${args.taskCategory} (tier: ${tier}). Last error: ${lastError?.message}`
    );
  },
});
