/**
 * Rate Limiting Module
 * 
 * Integrates with the model catalog to enforce usage limits based on user tier.
 * Tracks requests, tokens, and costs per user per day.
 */

import { v } from "convex/values";
import { internalMutation, query, mutation } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  type UserTier,
  type LlmProvider,
  getTierLimits,
  calculateRequestCost,
  isModelAllowedForTier,
  getBestModelForTier,
  getProviderForModel,
  type LlmTask,
} from "../../../../shared/llm/modelCatalog";

const UNLIMITED_SMALL_MODELS = new Set([
  "gpt-5.4-nano",
  "gemini-3.1-flash-lite-preview",
  "claude-haiku-4.5",
]);

const RESERVATION_TTL_MS = 20 * 60 * 1000;
const RESERVATION_REAPER_GRACE_MS = 1_000;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function dateISOFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

async function getUserTier(ctx: any, userId: any): Promise<UserTier> {
  if (!userId) return "anonymous";

  try {
    // Query subscription directly from the database since we have the userId
    // This works even when called from actions where auth context isn't available
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user_status", (q: any) => q.eq("userId", userId).eq("status", "active"))
      .first();

    if (sub) {
      // Map subscription plan to tier
      const plan = (sub.plan as string)?.toLowerCase() || "";
      if (plan.includes("enterprise")) return "enterprise";
      if (plan.includes("team")) return "team";
      if (plan.includes("pro")) return "pro";
      if (plan.includes("supporter")) return "pro"; // Supporter plan = pro tier
      return "pro"; // Default active subscription to pro
    }
    return "free";
  } catch {
    return "free";
  }
}

type UsageCredit = {
  requests: number;
  tokens: number;
  cost: number;
};

async function checkRequestAccess(args: {
  ctx: any;
  userId?: Id<"users">;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  usageCredit?: UsageCredit;
  usageDate?: string;
}) {
  const tier = await getUserTier(args.ctx, args.userId);
  const limits = getTierLimits(tier);
  const date = args.usageDate ?? todayISO();

  if (!isModelAllowedForTier(args.model, tier)) {
    const provider = getProviderForModel(args.model);
    return {
      allowed: false,
      reason: `Model "${args.model}" is not available on the ${tier} tier`,
      estimatedCost: 0,
      suggestedModel: getBestModelForTier("chat", tier, provider || "openai"),
    };
  }

  const outputTokens =
    args.estimatedOutputTokens ?? Math.ceil(args.estimatedInputTokens * 0.5);
  const estimatedCost = calculateRequestCost(
    args.model,
    args.estimatedInputTokens,
    outputTokens,
  );
  const totalTokens = args.estimatedInputTokens + outputTokens;

  if (totalTokens > limits.maxTokensPerRequest) {
    return {
      allowed: false,
      reason: `Request exceeds max tokens per request (${limits.maxTokensPerRequest.toLocaleString()})`,
      estimatedCost,
    };
  }

  if (UNLIMITED_SMALL_MODELS.has(args.model)) {
    return { allowed: true, estimatedCost: 0, reason: "unlimited_small_model" };
  }

  let currentUsage = { requests: 0, tokens: 0, cost: 0 };
  if (args.userId) {
    const usageRecord = await args.ctx.db
      .query("llmUsageDaily")
      .withIndex("by_user_date", (q: any) =>
        q.eq("userId", args.userId).eq("date", date),
      )
      .first() as Doc<"llmUsageDaily"> | null;
    if (usageRecord) {
      currentUsage = {
        requests: usageRecord.requests,
        tokens: usageRecord.totalTokens,
        cost: usageRecord.totalCost,
      };
    }
  }

  if (args.usageCredit) {
    currentUsage = {
      requests: Math.max(0, currentUsage.requests - args.usageCredit.requests),
      tokens: Math.max(0, currentUsage.tokens - args.usageCredit.tokens),
      cost: Math.max(0, currentUsage.cost - args.usageCredit.cost),
    };
  }

  if (limits.requestsPerDay !== -1 && currentUsage.requests >= limits.requestsPerDay) {
    return {
      allowed: false,
      reason: `Daily request limit reached (${limits.requestsPerDay})`,
      estimatedCost,
    };
  }
  if (limits.tokensPerDay !== -1 && currentUsage.tokens + totalTokens > limits.tokensPerDay) {
    return {
      allowed: false,
      reason: `Would exceed daily token limit (${limits.tokensPerDay.toLocaleString()})`,
      estimatedCost,
    };
  }
  if (limits.costLimitPerDay !== -1 && currentUsage.cost + estimatedCost > limits.costLimitPerDay) {
    return {
      allowed: false,
      reason: `Would exceed daily cost limit ($${limits.costLimitPerDay.toFixed(2)})`,
      estimatedCost,
    };
  }

  return { allowed: true, estimatedCost };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current usage and limits for the authenticated user
 */
export const getCurrentUsage = query({
  args: {},
  returns: v.object({
    tier: v.string(),
    usage: v.object({
      requests: v.number(),
      tokens: v.number(),
      cost: v.number(),
    }),
    limits: v.object({
      requestsPerDay: v.number(),
      tokensPerDay: v.number(),
      costLimitPerDay: v.number(),
      maxTokensPerRequest: v.number(),
    }),
    remaining: v.object({
      requests: v.number(),
      tokens: v.number(),
      cost: v.number(),
    }),
    allowedModels: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const tier = await getUserTier(ctx, userId);
    const limits = getTierLimits(tier);
    const date = todayISO();

    // Get today's usage
    let usage = { requests: 0, tokens: 0, cost: 0 };
    
    if (userId) {
      const usageRecord = await ctx.db
        .query("llmUsageDaily")
        .withIndex("by_user_date", (q: any) => q.eq("userId", userId).eq("date", date))
        .first() as Doc<"llmUsageDaily"> | null;

      if (usageRecord) {
        usage = {
          requests: usageRecord.requests,
          tokens: usageRecord.totalTokens,
          cost: usageRecord.totalCost,
        };
      }
    }

    // Calculate remaining
    const remaining = {
      requests: limits.requestsPerDay === -1 ? -1 : Math.max(0, limits.requestsPerDay - usage.requests),
      tokens: limits.tokensPerDay === -1 ? -1 : Math.max(0, limits.tokensPerDay - usage.tokens),
      cost: limits.costLimitPerDay === -1 ? -1 : Math.max(0, limits.costLimitPerDay - usage.cost),
    };

    return {
      tier,
      usage,
      limits: {
        requestsPerDay: limits.requestsPerDay,
        tokensPerDay: limits.tokensPerDay,
        costLimitPerDay: limits.costLimitPerDay,
        maxTokensPerRequest: limits.maxTokensPerRequest,
      },
      remaining,
      allowedModels: limits.allowedModels,
    };
  },
});

/**
 * Check if a specific model is allowed for the current user
 */
export const canUseModel = query({
  args: { model: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    suggestedModel: v.optional(v.string()),
  }),
  handler: async (ctx, { model }) => {
    const userId = await getAuthUserId(ctx);
    const tier = await getUserTier(ctx, userId);
    
    if (isModelAllowedForTier(model, tier)) {
      return { allowed: true };
    }
    
    // Suggest an alternative
    const provider = getProviderForModel(model);
    const suggestedModel = getBestModelForTier("chat", tier, provider || "openai");
    
    return {
      allowed: false,
      reason: `Model "${model}" is not available on the ${tier} tier`,
      suggestedModel,
    };
  },
});

/**
 * Pre-flight check before making an LLM request
 *
 * Note: When called from an action, pass the userId explicitly since auth context
 * is not available in action -> query calls.
 */
export const checkRequestAllowed = query({ 
  args: {
    model: v.string(),
    estimatedInputTokens: v.number(),
    estimatedOutputTokens: v.optional(v.number()),
    userId: v.optional(v.id("users")), // Optional: pass explicitly from actions
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    estimatedCost: v.number(),
    suggestedModel: v.optional(v.string()),
  }),
  handler: async (ctx, { model, estimatedInputTokens, estimatedOutputTokens, userId: explicitUserId }) => { 
    // Use explicit userId if provided (from actions), otherwise try auth context
    const userId = explicitUserId ?? await getAuthUserId(ctx);
    return checkRequestAccess({
      ctx,
      userId: userId ?? undefined,
      model,
      estimatedInputTokens,
      estimatedOutputTokens,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

const recordLlmUsageArgs = {
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  cachedTokens: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  success: v.boolean(),
  errorMessage: v.optional(v.string()),
};

type RecordLlmUsageArgs = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  latencyMs?: number;
  success: boolean;
  errorMessage?: string;
  reservationKey?: string;
  attemptKey?: string;
};

function assertNonNegativeUsageValue(name: string, value: number | undefined) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertValidUsageArgs(args: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  latencyMs?: number;
}) {
  assertNonNegativeUsageValue("inputTokens", args.inputTokens);
  assertNonNegativeUsageValue("outputTokens", args.outputTokens);
  assertNonNegativeUsageValue("cachedTokens", args.cachedTokens);
  assertNonNegativeUsageValue("latencyMs", args.latencyMs);
  if ((args.cachedTokens ?? 0) > args.inputTokens) {
    throw new Error("cachedTokens cannot exceed inputTokens");
  }
}

function incrementCounter(
  counters: Record<string, number> | undefined,
  key: string,
): Record<string, number> {
  return {
    ...(counters ?? {}),
    [key]: Number(counters?.[key] ?? 0) + 1,
  };
}

function usesFullyCachedInput(
  inputTokens: number,
  cachedTokens: number | undefined,
): boolean {
  return inputTokens > 0 && cachedTokens === inputTokens;
}

async function recordUsageForUser(
  ctx: any,
  userId: Id<"users">,
  args: RecordLlmUsageArgs,
) {
  assertValidUsageArgs(args);
  const cost = calculateRequestCost(
    args.model,
    args.inputTokens,
    args.outputTokens,
    usesFullyCachedInput(args.inputTokens, args.cachedTokens),
  );
  const totalTokens = args.inputTokens + args.outputTokens;
  const provider = getProviderForModel(args.model) || "openai";

  const reservation = args.reservationKey
    ? await ctx.db
        .query("llmUsageLog")
        .withIndex("by_reservation_key", (q: any) =>
          q.eq("reservationKey", args.reservationKey),
        )
        .first() as Doc<"llmUsageLog"> | null
    : null;

  if (reservation && reservation.userId !== userId) {
    throw new Error("Usage reservation owner mismatch");
  }
  if (args.reservationKey && !reservation) {
    throw new Error("Usage reservation not found");
  }
  if (
    reservation &&
    (!args.attemptKey ||
      reservation.currentReservationAttemptKey !== args.attemptKey)
  ) {
    throw new Error("Usage reservation attempt mismatch");
  }

  if (reservation?.reservationStatus === "reconciled" || reservation?.reservationStatus === "released") {
    return;
  }
  if (
    reservation?.reservationStatus === "reserved" &&
    reservation.currentReservationAttemptState !== "provider_ended" &&
    reservation.currentReservationAttemptState !== "settled"
  ) {
    throw new Error("Usage reservation provider attempt is still running");
  }

  const date = reservation
    ? dateISOFromTimestamp(reservation.timestamp)
    : todayISO();

  const existing = await ctx.db
    .query("llmUsageDaily")
    .withIndex("by_user_date", (q: any) => q.eq("userId", userId).eq("date", date))
    .first() as Doc<"llmUsageDaily"> | null;

  if (existing && reservation?.reservationStatus === "reserved") {
    const currentReservedInput =
      reservation.currentReservedInputTokens ?? reservation.inputTokens;
    const currentReservedOutput =
      reservation.currentReservedOutputTokens ?? reservation.outputTokens;
    const currentReservedCost =
      reservation.currentReservedCost ?? reservation.cost;
    const currentReservedTokens = currentReservedInput + currentReservedOutput;
    await ctx.db.patch(existing._id, {
      totalTokens: Math.max(0, existing.totalTokens - currentReservedTokens + totalTokens),
      inputTokens: Math.max(0, existing.inputTokens - currentReservedInput + args.inputTokens),
      outputTokens: Math.max(0, existing.outputTokens - currentReservedOutput + args.outputTokens),
      cachedTokens: existing.cachedTokens + (args.cachedTokens ?? 0),
      totalCost: Math.max(0, existing.totalCost - currentReservedCost + cost),
      successCount: existing.successCount + (args.success ? 1 : 0),
      errorCount: existing.errorCount + (args.success ? 0 : 1),
      providers: incrementCounter(existing.providers as Record<string, number> | undefined, provider),
      models: incrementCounter(existing.models as Record<string, number> | undefined, args.model),
      updatedAt: Date.now(),
    });
  } else if (existing) {
    await ctx.db.patch(existing._id, {
      requests: existing.requests + 1,
      totalTokens: existing.totalTokens + totalTokens,
      inputTokens: existing.inputTokens + args.inputTokens,
      outputTokens: existing.outputTokens + args.outputTokens,
      cachedTokens: existing.cachedTokens + (args.cachedTokens ?? 0),
      totalCost: existing.totalCost + cost,
      successCount: existing.successCount + (args.success ? 1 : 0),
      errorCount: existing.errorCount + (args.success ? 0 : 1),
      providers: incrementCounter(existing.providers as Record<string, number> | undefined, provider),
      models: incrementCounter(existing.models as Record<string, number> | undefined, args.model),
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("llmUsageDaily", {
      userId,
      date,
      requests: 1,
      totalTokens,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedTokens: args.cachedTokens ?? 0,
      totalCost: cost,
      successCount: args.success ? 1 : 0,
      errorCount: args.success ? 0 : 1,
      providers: { [provider]: 1 },
      models: { [args.model]: 1 },
      updatedAt: Date.now(),
    });
  }

  const logPatch = {
    timestamp: reservation?.timestamp ?? Date.now(),
    model: args.model,
    provider,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cachedTokens: args.cachedTokens ?? 0,
    cost,
    latencyMs: args.latencyMs,
    success: args.success,
    errorMessage: args.errorMessage,
  };
  if (reservation?.reservationStatus === "reserved") {
    await ctx.db.patch(reservation._id, {
      ...logPatch,
      inputTokens:
        Math.max(
          0,
          reservation.inputTokens -
            (reservation.currentReservedInputTokens ?? reservation.inputTokens),
        ) + args.inputTokens,
      outputTokens:
        Math.max(
          0,
          reservation.outputTokens -
            (reservation.currentReservedOutputTokens ?? reservation.outputTokens),
        ) + args.outputTokens,
      cachedTokens: reservation.cachedTokens + (args.cachedTokens ?? 0),
      cost:
        Math.max(
          0,
          reservation.cost -
            (reservation.currentReservedCost ?? reservation.cost),
        ) + cost,
      currentReservedInputTokens: undefined,
      currentReservedOutputTokens: undefined,
      currentReservedCost: undefined,
      reservationStatus: "reconciled",
    });
  } else {
    await ctx.db.insert("llmUsageLog", {
      userId,
      ...logPatch,
    });
  }
}

/**
 * Atomically admit and reserve one authenticated request. Reusing the same key
 * updates the reservation for a tier-eligible provider fallback without double
 * counting the request.
 */
export const reserveLlmRequestInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
    model: v.string(),
    estimatedInputTokens: v.number(),
    estimatedOutputTokens: v.number(),
    reserveMaximumTierAllowance: v.optional(v.boolean()),
    agentThreadId: v.optional(v.string()),
    runId: v.optional(v.id("agentRuns")),
    workerId: v.optional(v.string()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    estimatedCost: v.number(),
    suggestedModel: v.optional(v.string()),
    maxTokensPerRequest: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    assertValidUsageArgs({
      inputTokens: args.estimatedInputTokens,
      outputTokens: args.estimatedOutputTokens,
    });
    const now = Date.now();
    const tier = await getUserTier(ctx, args.userId);
    const tierLimits = getTierLimits(tier);
    const maximumTierTokens = tierLimits.maxTokensPerRequest;

    if (Boolean(args.runId) !== Boolean(args.workerId)) {
      throw new Error("runId and workerId must be provided together");
    }
    if (args.agentThreadId) {
      const thread = await ctx.db
        .query("chatThreadsStream")
        .withIndex("by_agentThreadId", (q: any) =>
          q.eq("agentThreadId", args.agentThreadId),
        )
        .first() as Doc<"chatThreadsStream"> | null;
      if (thread?.cancelRequested) {
        return {
          allowed: false,
          reason: "Run was cancelled before provider execution",
          estimatedCost: 0,
          maxTokensPerRequest: maximumTierTokens,
        };
      }
    }
    if (args.runId && args.workerId) {
      const run = await ctx.db.get(args.runId) as {
        userId?: Id<"users">;
        leaseOwner?: string;
        leaseExpiresAt?: number;
        status?: string;
      } | null;
      if (
        !run ||
        run.userId !== args.userId ||
        run.leaseOwner !== args.workerId ||
        run.status !== "running" ||
        typeof run.leaseExpiresAt !== "number" ||
        run.leaseExpiresAt <= now
      ) {
        return {
          allowed: false,
          reason: "Queued run lease is no longer active",
          estimatedCost: 0,
          maxTokensPerRequest: maximumTierTokens,
        };
      }
    }
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;

    if (reservation && reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation?.reservationStatus === "reconciled" || reservation?.reservationStatus === "released") {
      return {
        allowed: false,
        reason: "Usage reservation is already finalized",
        estimatedCost: 0,
        maxTokensPerRequest: maximumTierTokens,
      };
    }

    const reservationAttemptKeys = reservation?.reservationAttemptKeys ?? [];
    if (reservationAttemptKeys.includes(args.attemptKey)) {
      if (
        reservation.currentReservationAttemptKey !== args.attemptKey ||
        reservation.currentReservationAttemptState !== "admitted" ||
        reservation.model !== args.model
      ) {
        return {
          allowed: false,
          reason: "Reservation attempt key was already consumed",
          estimatedCost: 0,
          maxTokensPerRequest: maximumTierTokens,
        };
      }
      return {
        allowed: true,
        estimatedCost: calculateRequestCost(
          args.model,
          args.estimatedInputTokens,
          args.estimatedOutputTokens,
        ),
        reason: "reservation_attempt_already_admitted",
        maxTokensPerRequest: maximumTierTokens,
      };
    }
    if (
      reservation?.reservationStatus === "reserved" &&
      reservation.currentReservationAttemptState !== "provider_ended" &&
      reservation.currentReservationAttemptState !== "settled"
    ) {
      return {
        allowed: false,
        reason: "The previous provider attempt is still running",
        estimatedCost: 0,
        maxTokensPerRequest: maximumTierTokens,
      };
    }

    // One active logical run per user keeps an underestimated provider response
    // from racing another atomic admission against the same daily allowance.
    // The compound index avoids the old 20-row scan blind spot. Missing-expiry
    // rows are treated as active for one TTL as a compatibility fence.
    const activeDefined = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_user_reservation_status_expiry_timestamp", (q: any) =>
        q
          .eq("userId", args.userId)
          .eq("reservationStatus", "reserved")
          .gt("reservationExpiresAt", now),
      )
      .filter((q: any) =>
        q.neq(q.field("reservationKey"), args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    const activeLegacy = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_user_reservation_status_expiry_timestamp", (q: any) =>
        q
          .eq("userId", args.userId)
          .eq("reservationStatus", "reserved")
          .eq("reservationExpiresAt", undefined)
          .gt("timestamp", now - RESERVATION_TTL_MS),
      )
      .filter((q: any) =>
        q.neq(q.field("reservationKey"), args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (activeDefined || activeLegacy) {
      return {
        allowed: false,
        reason: "Another authenticated model request is already running",
        estimatedCost: 0,
        maxTokensPerRequest: maximumTierTokens,
      };
    }

    const inputOnlyMaximumCost = calculateRequestCost(
      args.model,
      maximumTierTokens,
      0,
    );
    const outputOnlyMaximumCost = calculateRequestCost(
      args.model,
      0,
      maximumTierTokens,
    );
    const reserveMaximumAsInput =
      args.reserveMaximumTierAllowance === true &&
      inputOnlyMaximumCost > outputOnlyMaximumCost;
    const effectiveInputTokens = args.reserveMaximumTierAllowance
      ? reserveMaximumAsInput
        ? maximumTierTokens
        : 0
      : args.estimatedInputTokens;
    const effectiveOutputTokens = args.reserveMaximumTierAllowance
      ? reserveMaximumAsInput
        ? 0
        : maximumTierTokens
      : args.estimatedOutputTokens;

    const date = reservation
      ? dateISOFromTimestamp(reservation.timestamp)
      : todayISO();
    const currentReservedInput = reservation
      ? reservation.currentReservedInputTokens ?? reservation.inputTokens
      : 0;
    const currentReservedOutput = reservation
      ? reservation.currentReservedOutputTokens ?? reservation.outputTokens
      : 0;
    const currentReservedCost = reservation
      ? reservation.currentReservedCost ?? reservation.cost
      : 0;
    const accumulatePrevious =
      reservation?.reservationStatus === "reserved";

    const usageCredit = reservation?.reservationStatus === "reserved"
      ? {
          requests: 1,
          tokens: accumulatePrevious
            ? 0
            : currentReservedInput + currentReservedOutput,
          cost: accumulatePrevious ? 0 : currentReservedCost,
        }
      : undefined;
    const access = await checkRequestAccess({
      ctx,
      userId: args.userId,
      model: args.model,
      estimatedInputTokens: effectiveInputTokens,
      estimatedOutputTokens: effectiveOutputTokens,
      usageCredit,
      usageDate: date,
    });
    if (!access.allowed) {
      return { ...access, maxTokensPerRequest: maximumTierTokens };
    }

    const reservationCost = calculateRequestCost(
      args.model,
      effectiveInputTokens,
      effectiveOutputTokens,
    );
    const reservationTokens = effectiveInputTokens + effectiveOutputTokens;
    const provider = getProviderForModel(args.model) || "openai";
    const daily = await ctx.db
      .query("llmUsageDaily")
      .withIndex("by_user_date", (q: any) =>
        q.eq("userId", args.userId).eq("date", date),
      )
      .first() as Doc<"llmUsageDaily"> | null;

    if (daily && reservation?.reservationStatus === "reserved") {
      await ctx.db.patch(daily._id, {
        totalTokens: accumulatePrevious
          ? daily.totalTokens + reservationTokens
          : Math.max(
              0,
              daily.totalTokens -
                currentReservedInput -
                currentReservedOutput +
                reservationTokens,
            ),
        inputTokens: accumulatePrevious
          ? daily.inputTokens + effectiveInputTokens
          : Math.max(
              0,
              daily.inputTokens - currentReservedInput + effectiveInputTokens,
            ),
        outputTokens: accumulatePrevious
          ? daily.outputTokens + effectiveOutputTokens
          : Math.max(
              0,
              daily.outputTokens - currentReservedOutput + effectiveOutputTokens,
            ),
        totalCost: accumulatePrevious
          ? daily.totalCost + reservationCost
          : Math.max(
              0,
              daily.totalCost - currentReservedCost + reservationCost,
            ),
        updatedAt: now,
      });
    } else if (daily) {
      await ctx.db.patch(daily._id, {
        requests: daily.requests + 1,
        totalTokens: daily.totalTokens + reservationTokens,
        inputTokens: daily.inputTokens + effectiveInputTokens,
        outputTokens: daily.outputTokens + effectiveOutputTokens,
        totalCost: daily.totalCost + reservationCost,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("llmUsageDaily", {
        userId: args.userId,
        date,
        requests: 1,
        totalTokens: reservationTokens,
        inputTokens: effectiveInputTokens,
        outputTokens: effectiveOutputTokens,
        cachedTokens: 0,
        totalCost: reservationCost,
        successCount: 0,
        errorCount: 0,
        updatedAt: now,
      });
    }

    const totalReservedInput = reservation?.reservationStatus === "reserved"
      ? accumulatePrevious
        ? reservation.inputTokens + effectiveInputTokens
        : Math.max(0, reservation.inputTokens - currentReservedInput) +
          effectiveInputTokens
      : effectiveInputTokens;
    const totalReservedOutput = reservation?.reservationStatus === "reserved"
      ? accumulatePrevious
        ? reservation.outputTokens + effectiveOutputTokens
        : Math.max(0, reservation.outputTokens - currentReservedOutput) +
          effectiveOutputTokens
      : effectiveOutputTokens;
    const totalReservedCost = reservation?.reservationStatus === "reserved"
      ? accumulatePrevious
        ? reservation.cost + reservationCost
        : Math.max(0, reservation.cost - currentReservedCost) + reservationCost
      : reservationCost;
    const reservationPatch = {
      reservationKey: args.reservationKey,
      reservationStatus: "reserved" as const,
      timestamp: reservation?.timestamp ?? now,
      model: args.model,
      provider,
      inputTokens: totalReservedInput,
      outputTokens: totalReservedOutput,
      cachedTokens: reservation?.reservationStatus === "reserved"
        ? reservation.cachedTokens
        : 0,
      cost: totalReservedCost,
      currentReservedInputTokens: effectiveInputTokens,
      currentReservedOutputTokens: effectiveOutputTokens,
      currentReservedCost: reservationCost,
      currentReservationAttemptKey: args.attemptKey,
      currentReservationAttemptState: "admitted" as const,
      reservationAttemptKeys: [...reservationAttemptKeys, args.attemptKey],
      reservationExpiresAt: now + RESERVATION_TTL_MS,
      success: false,
      errorMessage: undefined,
    };
    if (reservation?.reservationStatus === "reserved") {
      await ctx.db.patch(reservation._id, reservationPatch);
    } else {
      await ctx.db.insert("llmUsageLog", {
        userId: args.userId,
        ...reservationPatch,
      });
    }
    await ctx.scheduler.runAt(
      reservationPatch.reservationExpiresAt + RESERVATION_REAPER_GRACE_MS,
      internal.domains.billing.rateLimiting.reapExpiredLlmReservationInternal,
      {
        reservationKey: args.reservationKey,
        attemptKey: args.attemptKey,
        userId: args.userId,
      },
    );
    return { ...access, maxTokensPerRequest: maximumTierTokens };
  },
});

/**
 * Close the currently admitted provider attempt before any fallback can reserve
 * another one. This is the no-overlap fence for duplicate actions and retries.
 */
export const markLlmReservationAttemptEndedInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (!reservation || reservation.reservationStatus !== "reserved") {
      throw new Error("Active usage reservation not found");
    }
    if (reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation.currentReservationAttemptKey !== args.attemptKey) {
      throw new Error("Usage reservation attempt mismatch");
    }
    if (reservation.currentReservationAttemptState === "provider_ended") {
      return null;
    }
    if (reservation.currentReservationAttemptState !== "admitted") {
      throw new Error("Usage reservation attempt is not admitted");
    }
    await ctx.db.patch(reservation._id, {
      currentReservationAttemptState: "provider_ended",
      reservationExpiresAt: Date.now() + RESERVATION_TTL_MS,
    });
    return null;
  },
});

/**
 * Replace the current attempt's maximum reservation with a bounded failure
 * estimate before a fallback is admitted. The logical request remains open,
 * so requests/success/error counters are finalized only once at terminal exit.
 */
export const settleFailedLlmReservationAttemptInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertValidUsageArgs(args);
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (!reservation || reservation.reservationStatus !== "reserved") {
      throw new Error("Active usage reservation not found");
    }
    if (reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation.currentReservationAttemptKey !== args.attemptKey) {
      throw new Error("Usage reservation attempt mismatch");
    }
    if (reservation.currentReservationAttemptState === "settled") return null;
    if (reservation.currentReservationAttemptState !== "provider_ended") {
      throw new Error("Usage reservation provider attempt is still running");
    }

    const actualCost = calculateRequestCost(
      args.model,
      args.inputTokens,
      args.outputTokens,
      usesFullyCachedInput(args.inputTokens, args.cachedTokens),
    );
    const currentInput =
      reservation.currentReservedInputTokens ?? reservation.inputTokens;
    const currentOutput =
      reservation.currentReservedOutputTokens ?? reservation.outputTokens;
    const currentCost = reservation.currentReservedCost ?? reservation.cost;
    const daily = await ctx.db
      .query("llmUsageDaily")
      .withIndex("by_user_date", (q: any) =>
        q.eq("userId", args.userId).eq(
          "date",
          dateISOFromTimestamp(reservation.timestamp),
        ),
      )
      .first() as Doc<"llmUsageDaily"> | null;
    if (!daily) throw new Error("Usage reservation daily ledger not found");

    await ctx.db.patch(daily._id, {
      totalTokens: Math.max(
        0,
        daily.totalTokens - currentInput - currentOutput +
          args.inputTokens + args.outputTokens,
      ),
      inputTokens: Math.max(
        0,
        daily.inputTokens - currentInput + args.inputTokens,
      ),
      outputTokens: Math.max(
        0,
        daily.outputTokens - currentOutput + args.outputTokens,
      ),
      cachedTokens: daily.cachedTokens + (args.cachedTokens ?? 0),
      totalCost: Math.max(0, daily.totalCost - currentCost + actualCost),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(reservation._id, {
      model: args.model,
      provider: getProviderForModel(args.model) || "openai",
      inputTokens:
        Math.max(0, reservation.inputTokens - currentInput) + args.inputTokens,
      outputTokens:
        Math.max(0, reservation.outputTokens - currentOutput) + args.outputTokens,
      cachedTokens: reservation.cachedTokens + (args.cachedTokens ?? 0),
      cost: Math.max(0, reservation.cost - currentCost) + actualCost,
      currentReservedInputTokens: 0,
      currentReservedOutputTokens: 0,
      currentReservedCost: 0,
      currentReservationAttemptState: "settled",
      reservationExpiresAt: Date.now() + RESERVATION_TTL_MS,
      latencyMs: args.latencyMs,
      success: false,
      errorMessage: args.errorMessage?.slice(0, 500),
    });
    return null;
  },
});

async function finalizeAmbiguousReservation(
  ctx: any,
  reservation: Doc<"llmUsageLog">,
  reason: string,
) {
  const provider = reservation.provider ||
    getProviderForModel(reservation.model) ||
    "openai";
  const daily = await ctx.db
    .query("llmUsageDaily")
    .withIndex("by_user_date", (q: any) =>
      q.eq("userId", reservation.userId).eq(
        "date",
        dateISOFromTimestamp(reservation.timestamp),
      ),
    )
    .first() as Doc<"llmUsageDaily"> | null;
  if (!daily) throw new Error("Usage reservation daily ledger not found");

  const now = Date.now();
  await ctx.db.patch(daily._id, {
    errorCount: daily.errorCount + 1,
    providers: incrementCounter(
      daily.providers as Record<string, number> | undefined,
      provider,
    ),
    models: incrementCounter(
      daily.models as Record<string, number> | undefined,
      reservation.model,
    ),
    updatedAt: now,
  });
  await ctx.db.patch(reservation._id, {
    reservationStatus: "reconciled",
    currentReservedInputTokens: undefined,
    currentReservedOutputTokens: undefined,
    currentReservedCost: undefined,
    success: false,
    errorMessage: reason.slice(0, 500),
  });
}

/**
 * Terminally finalize an exact attempt whose provider spend is ambiguous.
 * The reservation's full aggregate charge and original UTC accounting day are
 * retained; the reserved status is the idempotence fence for counters.
 */
export const finalizeAmbiguousLlmReservationInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (!reservation) return null;
    if (reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation.reservationStatus !== "reserved") return null;
    if (reservation.currentReservationAttemptKey !== args.attemptKey) return null;
    if (reservation.currentReservationAttemptState !== "provider_ended") {
      throw new Error("Usage reservation provider attempt is still running");
    }

    await finalizeAmbiguousReservation(
      ctx,
      reservation,
      args.reason ?? "Provider attempt ended with ambiguous usage",
    );
    return null;
  },
});

/**
 * Durable crash cleanup for a single exact attempt. Ambiguous provider work is
 * conservatively left charged at its reservation maximum, then finalized so it
 * cannot hold the user's active-run lock forever.
 */
export const reapExpiredLlmReservationInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (!reservation || reservation.reservationStatus !== "reserved") return null;
    if (reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation.currentReservationAttemptKey !== args.attemptKey) return null;

    const now = Date.now();
    const expiresAt =
      reservation.reservationExpiresAt ??
      reservation.timestamp + RESERVATION_TTL_MS;
    if (expiresAt > now) {
      await ctx.scheduler.runAt(
        expiresAt + RESERVATION_REAPER_GRACE_MS,
        internal.domains.billing.rateLimiting.reapExpiredLlmReservationInternal,
        args,
      );
      return null;
    }

    await finalizeAmbiguousReservation(
      ctx,
      reservation,
      "Usage reservation expired before terminal reconciliation",
    );
    return null;
  },
});

/** Release an admitted request that never reached a provider call. */
export const releaseLlmReservationInternal = internalMutation({
  args: {
    reservationKey: v.string(),
    attemptKey: v.string(),
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("llmUsageLog")
      .withIndex("by_reservation_key", (q: any) =>
        q.eq("reservationKey", args.reservationKey),
      )
      .first() as Doc<"llmUsageLog"> | null;
    if (!reservation || reservation.reservationStatus !== "reserved") return null;
    if (reservation.userId !== args.userId) {
      throw new Error("Usage reservation owner mismatch");
    }
    if (reservation.currentReservationAttemptKey !== args.attemptKey) {
      return null;
    }
    if (reservation.currentReservationAttemptState !== "admitted") {
      throw new Error("Only an admitted pre-provider attempt can be released");
    }

    const currentInput =
      reservation.currentReservedInputTokens ?? reservation.inputTokens;
    const currentOutput =
      reservation.currentReservedOutputTokens ?? reservation.outputTokens;
    const currentCost = reservation.currentReservedCost ?? reservation.cost;
    const priorInput = Math.max(0, reservation.inputTokens - currentInput);
    const priorOutput = Math.max(0, reservation.outputTokens - currentOutput);
    const priorCost = Math.max(0, reservation.cost - currentCost);
    const priorCachedTokens = reservation.cachedTokens;
    const hasPriorAttempt = (reservation.reservationAttemptKeys ?? []).some(
      (attemptKey) => attemptKey !== args.attemptKey,
    );
    const hasPriorUsage =
      hasPriorAttempt ||
      priorInput > 0 ||
      priorOutput > 0 ||
      priorCachedTokens > 0 ||
      priorCost > 0;

    const daily = await ctx.db
      .query("llmUsageDaily")
      .withIndex("by_user_date", (q: any) =>
        q.eq("userId", args.userId).eq(
          "date",
          dateISOFromTimestamp(reservation.timestamp),
        ),
      )
      .first() as Doc<"llmUsageDaily"> | null;
    if (!daily) throw new Error("Usage reservation daily ledger not found");

    const now = Date.now();
    await ctx.db.patch(daily._id, {
      requests: hasPriorUsage
        ? daily.requests
        : Math.max(0, daily.requests - 1),
      totalTokens: Math.max(
        0,
        daily.totalTokens - currentInput - currentOutput,
      ),
      inputTokens: Math.max(0, daily.inputTokens - currentInput),
      outputTokens: Math.max(0, daily.outputTokens - currentOutput),
      totalCost: Math.max(0, daily.totalCost - currentCost),
      ...(hasPriorUsage
        ? {
            errorCount: daily.errorCount + 1,
            providers: incrementCounter(
              daily.providers as Record<string, number> | undefined,
              reservation.provider ||
                getProviderForModel(reservation.model) ||
                "openai",
            ),
            models: incrementCounter(
              daily.models as Record<string, number> | undefined,
              reservation.model,
            ),
          }
        : {}),
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, {
      reservationStatus: hasPriorUsage ? "reconciled" : "released",
      inputTokens: priorInput,
      outputTokens: priorOutput,
      cachedTokens: hasPriorUsage ? priorCachedTokens : 0,
      cost: priorCost,
      currentReservedInputTokens: undefined,
      currentReservedOutputTokens: undefined,
      currentReservedCost: undefined,
      currentReservationAttemptKey: undefined,
      currentReservationAttemptState: undefined,
      success: false,
      errorMessage: args.reason?.slice(0, 500),
    });
    return null;
  },
});

/**
 * Record an LLM request (called after successful completion)
 */
export const recordLlmUsage = mutation({
  args: recordLlmUsageArgs,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return; // Anonymous users still tracked but not persisted
    await recordUsageForUser(ctx, userId, args);
  },
});

/** Record usage from an internal action that already resolved the thread owner. */
export const recordLlmUsageInternal = internalMutation({
  args: {
    userId: v.id("users"),
    reservationKey: v.optional(v.string()),
    attemptKey: v.optional(v.string()),
    ...recordLlmUsageArgs,
  },
  handler: async (ctx, { userId, ...args }) => {
    await recordUsageForUser(ctx, userId, args);
  },
});

/**
 * Record usage for a non-authenticated "session" (anonymous user or internal eval run).
 *
 * This updates the `anonymousUsageDaily` table which is keyed by `sessionId` + date.
 * It is intentionally separate from `llmUsageDaily/Log` which require a real `userId`.
 */
export const recordSessionLlmUsage = mutation({
  args: {
    sessionId: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    /** Set true if the caller did not already count this request elsewhere. */
    incrementRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertValidUsageArgs(args);
    const date = todayISO();
    const cost = calculateRequestCost(
      args.model,
      args.inputTokens,
      args.outputTokens,
      usesFullyCachedInput(args.inputTokens, args.cachedTokens)
    );
    const totalTokens = args.inputTokens + args.outputTokens;
    const now = Date.now();

    const existing = await ctx.db
      .query("anonymousUsageDaily")
      .withIndex("by_session_date", (q: any) => q.eq("sessionId", args.sessionId).eq("date", date))
      .first() as Doc<"anonymousUsageDaily"> | null;

    const inc = args.incrementRequest === true ? 1 : 0;

    if (existing) {
      await ctx.db.patch(existing._id, {
        requests: existing.requests + inc,
        totalTokens: existing.totalTokens + totalTokens,
        totalCost: existing.totalCost + cost,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("anonymousUsageDaily", {
        sessionId: args.sessionId,
        date,
        requests: inc,
        totalTokens,
        totalCost: cost,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Get the best model for current user's tier
 */
export const getRecommendedModel = query({
  args: {
    task: v.string(),
    preferredProvider: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, { task, preferredProvider }) => {
    const userId = await getAuthUserId(ctx);
    const tier = await getUserTier(ctx, userId);
    
    return getBestModelForTier(
      task as LlmTask,
      tier,
      (preferredProvider as LlmProvider) || "openai"
    );
  },
});
