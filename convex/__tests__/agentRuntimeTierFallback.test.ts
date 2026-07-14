import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertTierModelAllowed,
  getCumulativeMeteredProviderTokens,
  getTierSelectionFailureReason,
  getRuntimeAccessTokenEstimate,
  planMeteredProviderStep,
  resolveRuntimeBillingContext,
  selectTierEligibleRuntimeModel,
  type TierModelCheck,
} from "../domains/agents/runtimeTierFallback";
import {
  canReadAgentRunPresentation,
  formatPublicAgentRunError,
  projectAgentRunPresentation,
} from "../domains/agents/agentRunPresentation";
import { setEffectiveModel } from "../domains/agents/orchestrator/queueProtocol";
import {
  checkRequestAllowed,
  finalizeAmbiguousLlmReservationInternal,
  markLlmReservationAttemptEndedInternal,
  reapExpiredLlmReservationInternal,
  recordLlmUsageInternal,
  releaseLlmReservationInternal,
  reserveLlmRequestInternal,
  settleFailedLlmReservationAttemptInternal,
} from "../domains/integrations/billing/rateLimiting";

const allowed = (estimatedCost = 0): TierModelCheck => ({
  allowed: true,
  estimatedCost,
});

const denied = (
  reason: string,
  suggestedModel?: string,
): TierModelCheck => ({
  allowed: false,
  estimatedCost: 0,
  reason,
  suggestedModel,
});

const streamingSource = readFileSync(
  resolve(process.cwd(), "convex/domains/agents/fastAgentPanelStreaming.ts"),
  "utf8",
);

describe("selectTierEligibleRuntimeModel", () => {
  it("keeps an eligible routed model unchanged", async () => {
    const checkModel = vi.fn(async () => allowed(0.01));

    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5.4-mini"],
      checkModel,
    });

    expect(result.model).toBe("gemini-3-flash-preview");
    expect(checkModel).toHaveBeenCalledTimes(1);
  });

  it("rechecks and adopts the billing gate's tier-approved suggestion", async () => {
    const checkModel = vi.fn(async (model: string) =>
      model === "gemini-3-flash-preview"
        ? denied(
            'Model "gemini-3-flash-preview" is not available on the free tier',
            "gemini-2.5-flash",
          )
        : allowed(0.002),
    );

    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5.4-mini"],
      checkModel,
    });

    expect(result.model).toBe("gemini-2.5-flash");
    expect(checkModel.mock.calls.map(([model]) => model)).toEqual([
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ]);
  });

  it("never bypasses a second denial and continues to an eligible fallback", async () => {
    const checkModel = vi.fn(async (model: string) => {
      if (model === "gemini-3-flash-preview") {
        return denied("premium model", "gemini-2.5-flash");
      }
      if (model === "gemini-2.5-flash") {
        return denied("daily token limit reached");
      }
      return allowed();
    });

    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5.4-mini"],
      checkModel,
    });

    expect(result.model).toBe("gpt-5.4-mini");
    expect(result.attempts.map(({ model }) => model)).toEqual([
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gpt-5.4-mini",
    ]);
  });

  it("ignores an unapproved suggestion and checks the configured fallback", async () => {
    const checkModel = vi.fn(async (model: string) =>
      model === "gemini-3-flash-preview"
        ? denied("premium model", "unapproved-shadow-model")
        : allowed(),
    );

    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5.4-mini"],
      checkModel,
    });

    expect(result.model).toBe("gpt-5.4-mini");
    expect(checkModel.mock.calls.map(([model]) => model)).toEqual([
      "gemini-3-flash-preview",
      "gpt-5.4-mini",
    ]);
  });

  it("preserves the hard failure when every configured candidate is denied", async () => {
    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "kimi-k2.6",
      fallbackModels: ["gpt-5.4-mini"],
      isModelAvailable: (model) => model !== "claude-haiku-4.5",
      checkModel: async () => denied("Daily request limit reached (25)"),
    });

    expect(result.model).toBeNull();
    expect(getTierSelectionFailureReason(result)).toBe(
      "Daily request limit reached (25)",
    );
  });

  it("fails closed when the billing policy check itself errors", async () => {
    await expect(
      selectTierEligibleRuntimeModel({
        primaryModel: "gpt-5.4-mini",
        checkModel: async () => {
          throw new Error("billing policy unavailable");
        },
      }),
    ).rejects.toThrow("billing policy unavailable");
  });

  it("blocks a denied model before a provider attempt", () => {
    expect(() =>
      assertTierModelAllowed(
        "gemini-3.1-flash-lite-preview",
        denied("model is unavailable on the free tier"),
      ),
    ).toThrow("Rate limit exceeded: model is unavailable on the free tier");
  });

  it("keeps the unauthenticated preflight estimate within the 2,000-token tier cap", () => {
    const estimate = getRuntimeAccessTokenEstimate(true);
    expect(estimate.estimatedInputTokens + estimate.estimatedOutputTokens).toBeLessThanOrEqual(
      2000,
    );
    expect(getRuntimeAccessTokenEstimate(false)).toEqual({
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000,
    });
  });

  it("skips already-attempted models when choosing a tier-eligible fallback", async () => {
    const checkModel = vi.fn(async () => allowed());
    const result = await selectTierEligibleRuntimeModel({
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5.4-mini", "gpt-5.4-nano"],
      excludedModels: ["gemini-3-flash-preview", "gpt-5.4-mini"],
      checkModel,
    });

    expect(result.model).toBe("gpt-5.4-nano");
    expect(checkModel).toHaveBeenCalledTimes(1);
  });

  it("preserves the explicit secret-gated evaluation billing context", () => {
    expect(
      resolveRuntimeBillingContext({
        hasAuthenticatedUser: false,
        isAnonymous: false,
        evaluationMode: true,
        usageSessionId: "__eval_personaEpisodeEval__:core:123",
      }),
    ).toBe("trusted_evaluation");
    expect(
      resolveRuntimeBillingContext({
        hasAuthenticatedUser: false,
        isAnonymous: false,
        evaluationMode: false,
        usageSessionId: "__eval_personaEpisodeEval__:core:123",
      }),
    ).toBe("anonymous_user");
  });
});

describe("cumulative metered provider token planning", () => {
  it("keeps a multi-step provider chain within one conservative total budget", () => {
    const requestTokenLimit = 4_000;
    const assignedStepTotalBudgets: number[] = [];

    const firstStep = planMeteredProviderStep({
      requestTokenLimit,
      steps: [],
      assignedStepTotalBudgets,
      system: "Answer with grounded facts.",
      messages: [{ role: "user", content: "Find the latest funding update." }],
      providerOverheadTokens: 128,
      maxStepOutputTokens: 512,
    });
    assignedStepTotalBudgets[0] = firstStep.assignedTotalTokens;

    const completedSteps = [
      {
        usage: {
          inputTokens: 220,
          outputTokens: 80,
        },
      },
    ];
    const secondStep = planMeteredProviderStep({
      requestTokenLimit,
      steps: completedSteps,
      assignedStepTotalBudgets,
      system: "Answer with grounded facts.",
      messages: [
        { role: "user", content: "Find the latest funding update." },
        {
          role: "tool",
          content: "Verified source: Example Corp raised $10M on 2026-07-01.",
        },
      ],
      providerOverheadTokens: 128,
      maxStepOutputTokens: 512,
    });

    expect(secondStep.usedTokens).toBe(300);
    expect(
      secondStep.usedTokens + secondStep.assignedTotalTokens,
    ).toBeLessThanOrEqual(requestTokenLimit);
    expect(secondStep.inputUpperBoundTokens).toBeGreaterThan(128);
  });

  it("refuses a huge second-step tool result before invoking the provider", () => {
    const invokeProvider = vi.fn();
    const prepareAndInvokeSecondStep = () => {
      const plan = planMeteredProviderStep({
        requestTokenLimit: 2_000,
        steps: [{ usage: { totalTokens: 600 } }],
        assignedStepTotalBudgets: [900],
        system: "Synthesize the tool result.",
        messages: [
          { role: "user", content: "Research this company." },
          { role: "tool", content: "x".repeat(5_000) },
        ],
        providerOverheadTokens: 128,
        maxStepOutputTokens: 512,
      });
      invokeProvider(plan);
    };

    expect(prepareAndInvokeSecondStep).toThrow(
      "Request exceeds the cumulative metered token budget",
    );
    expect(invokeProvider).not.toHaveBeenCalled();
  });

  it("fails closed to the assigned budget when prior provider usage is missing", () => {
    const assignedStepTotalBudgets = [1_900];
    expect(
      getCumulativeMeteredProviderTokens(
        [{ usage: undefined }],
        assignedStepTotalBudgets,
      ),
    ).toBe(1_900);

    expect(() =>
      planMeteredProviderStep({
        requestTokenLimit: 2_000,
        steps: [{ usage: undefined }],
        assignedStepTotalBudgets,
        messages: [{ role: "tool", content: "small result" }],
        providerOverheadTokens: 128,
        maxStepOutputTokens: 256,
      }),
    ).toThrow("Request exceeds the cumulative metered token budget");
  });
});

describe("streamAsync tier-gate wiring", () => {
  it("removes the unmetered dynamic-prompt LLM path from queued streaming", () => {
    const actionStart = streamingSource.indexOf("export const streamAsync");
    const preflight = streamingSource.indexOf(
      "const tierSelection = await selectTierEligibleRuntimeModel",
      actionStart,
    );
    const actionSource = streamingSource.slice(actionStart);

    expect(actionStart).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(actionStart);
    expect(actionSource).not.toContain("enhancePromptWithToolInstructions");
    expect(actionSource).not.toContain("getDynamicToolInstructions");
  });

  it("preflights and lease-fences setup, then atomically reserves immediately before the provider", () => {
    const attemptStart = streamingSource.indexOf(
      "const runStreamAttempt = async (",
    );
    const attemptEnd = streamingSource.indexOf(
      "// USAGE TRACKING",
      attemptStart,
    );
    const attemptBody = streamingSource.slice(attemptStart, attemptEnd);

    const tierGate = attemptBody.indexOf("await assertRuntimeModelAllowed(model)");
    const leaseFence = attemptBody.indexOf("await persistEffectiveRunModel(model)");
    const providerCreation = attemptBody.indexOf("await createAgentForModel(model)");
    const atomicReservation = attemptBody.indexOf(
      "await reserveRuntimeModelAccess(model, attemptKey)",
    );
    const providerCall = attemptBody.indexOf("result = await agent.streamText(");
    const attemptEndFence = attemptBody.indexOf(
      "await closeProviderAttempt();",
      providerCall,
    );

    expect(tierGate).toBeGreaterThanOrEqual(0);
    expect(leaseFence).toBeGreaterThan(tierGate);
    expect(providerCreation).toBeGreaterThan(leaseFence);
    expect(atomicReservation).toBeGreaterThan(providerCreation);
    expect(providerCall).toBeGreaterThan(atomicReservation);
    expect(attemptEndFence).toBeGreaterThan(providerCall);
    expect(attemptBody).toContain("abortSignal: attemptController.signal");
    expect(attemptBody).not.toContain("Promise.race(");
  });

  it("does not make hidden compaction or teachability model calls in queued streaming", () => {
    const actionStart = streamingSource.indexOf("export const streamAsync");
    const actionEnd = streamingSource.indexOf("export const generateDocumentContent", actionStart);
    const actionSource = streamingSource.slice(actionStart, actionEnd);

    expect(actionSource).not.toContain("compactContext as any");
    expect(actionSource).not.toContain("analyzeAndStoreTeachings");
    expect(actionSource).toContain("deterministic middle compaction");
    expect(actionSource).toContain("reserveMaximumTierAllowance: true");
  });

  it("retries failed reconciliation durably instead of suppressing finalization", () => {
    const actionStart = streamingSource.indexOf("export const streamAsync");
    const actionEnd = streamingSource.indexOf("export const generateDocumentContent", actionStart);
    const actionSource = streamingSource.slice(actionStart, actionEnd);

    expect(actionSource).not.toContain("runtimeUsageFinalizationAttempted");
    expect(actionSource).toContain("pendingAuthenticatedUsage");
    expect(actionSource).toContain(
      "internal.domains.billing.rateLimiting.recordLlmUsageInternal",
    );
    expect(actionSource).toContain("Immediate usage reconciliation retry failed");
  });

  it("tier-selects no-output, model-chain, and provider fallbacks before execution", () => {
    const actionStart = streamingSource.indexOf("export const streamAsync");
    const actionSource = streamingSource.slice(actionStart);
    const guardedFallbackSelections = actionSource.match(
      /await selectRuntimeFallbackModel\(/g,
    );

    expect(guardedFallbackSelections).toHaveLength(3);
  });

  it("keeps the queued runtime on an explicit provider-safe tool surface", () => {
    const constructorStart = streamingSource.indexOf(
      "const createMeteredRuntimeAgent",
    );
    const constructorEnd = streamingSource.indexOf(
      "const planSchema",
      constructorStart,
    );
    const constructorSource = streamingSource.slice(
      constructorStart,
      constructorEnd,
    );
    const actionStart = streamingSource.indexOf("export const streamAsync");
    const actionEnd = streamingSource.indexOf(
      "export const generateDocumentContent",
      actionStart,
    );
    const actionSource = streamingSource.slice(actionStart, actionEnd);
    const factoryStart = actionSource.indexOf("const createAgentForModel");
    const factoryEnd = actionSource.indexOf("const controller", factoryStart);
    const factorySource = actionSource.slice(factoryStart, factoryEnd);

    expect(constructorSource).toContain(
      "linkupSearch: createReservationSafeLinkupSearch(toolBudget)",
    );
    expect(constructorSource).toContain("lookupGroundTruthEntity");
    expect(constructorSource).toContain("lookupGroundTruth");
    expect(constructorSource).not.toContain("textEmbeddingModel");
    for (const forbidden of [
      "buildDelegationTools",
      "multiSdkTools",
      "compactContext,",
      "analyzeForTeaching",
      "invokeTool",
      "searchAvailableSkills,",
      "quickSearch,",
      "fusionSearch,",
      "createChatAgent(model)",
      "createCoordinatorAgent(",
    ]) {
      expect(constructorSource).not.toContain(forbidden);
      expect(factorySource).not.toContain(forbidden);
    }
  });

  it("rechecks durable cancellation and cumulatively bounds total provider usage", () => {
    const attemptStart = streamingSource.indexOf(
      "const runStreamAttempt = async (",
    );
    const attemptEnd = streamingSource.indexOf("// USAGE TRACKING", attemptStart);
    const attemptBody = streamingSource.slice(attemptStart, attemptEnd);

    expect(attemptBody).toContain("const freshThread = await ctx.runQuery(");
    expect(attemptBody).toContain("freshThread?.cancelRequested");
    expect(attemptBody).toContain("const admission = await reserveRuntimeModelAccess");
    expect(attemptBody).toContain("defaultSettingsMiddleware");
    expect(attemptBody).toContain("planMeteredProviderStep({");
    expect(attemptBody).toContain("settings: { maxOutputTokens: budget.maxOutputTokens }");
    expect(attemptBody).toContain("stepCountIs(2)");
    expect(attemptBody).toContain("getCumulativeMeteredProviderTokens(");
    expect(attemptBody).toContain("pollDurableCancellation");
    expect(attemptBody).toContain("controller.abort(new Error(\"Stream cancelled\"))");
    expect(attemptBody).toContain("recentMessages: 0");
  });
});

describe("agent run presentation", () => {
  it("removes internal wrappers and stack frames from an owner-visible error", () => {
    expect(
      formatPublicAgentRunError(
        'Error: Uncaught Error: Rate limit exceeded: Model "gemini-3-flash-preview" is not available on the free tier\n    at handler (/convex/file.ts:1:1)',
      ),
    ).toBe(
      'Rate limit exceeded: Model "gemini-3-flash-preview" is not available on the free tier',
    );
  });

  it("projects terminal error metadata without exposing database-only fields", () => {
    const projection = projectAgentRunPresentation({
      _id: "run-qa",
      _creationTime: 1,
      status: "error",
      model: "gemini-3-flash-preview",
      errorMessage: "Error: Uncaught Error: provider unavailable\n at handler",
    } as any);

    expect(projection).toEqual({
      runId: "run-qa",
      runStatus: "error",
      runModel: "gemini-3-flash-preview",
      runErrorMessage: "provider unavailable",
    });
  });

  it("authorizes only the authenticated thread owner", () => {
    expect(
      canReadAgentRunPresentation({
        authenticatedUserId: "user-owner",
        threadUserId: "user-owner",
      }),
    ).toBe(true);
    expect(
      canReadAgentRunPresentation({
        authenticatedUserId: "user-other",
        threadUserId: "user-owner",
      }),
    ).toBe(false);
  });

  it("authorizes only the matching anonymous session", () => {
    expect(
      canReadAgentRunPresentation({
        threadAnonymousSessionId: "anon-owner",
        anonymousSessionId: "anon-owner",
      }),
    ).toBe(true);
    expect(
      canReadAgentRunPresentation({
        threadAnonymousSessionId: "anon-owner",
        anonymousSessionId: "anon-other",
      }),
    ).toBe(false);
  });
});

describe("queueProtocol.setEffectiveModel", () => {
  it("records the model actually selected by runtime routing", async () => {
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: {
        get: async () => ({
          leaseOwner: "worker-qa",
          leaseExpiresAt: Date.now() + 60_000,
          status: "running",
          model: "kimi-k2.6",
        }),
        patch,
      },
    };

    await (setEffectiveModel as any)._handler(ctx, {
      runId: "run-qa",
      workerId: "worker-qa",
      model: "gemini-2.5-flash",
    });

    expect(patch).toHaveBeenCalledWith(
      "run-qa",
      expect.objectContaining({
        model: "gemini-2.5-flash",
        leaseExpiresAt: expect.any(Number),
      }),
    );
  });

  it("rejects model updates from a worker that does not own the lease", async () => {
    const ctx = {
      db: {
        get: async () => ({
          leaseOwner: "worker-owner",
          leaseExpiresAt: Date.now() + 60_000,
          status: "running",
          model: "kimi-k2.6",
        }),
        patch: vi.fn(),
      },
    };

    await expect(
      (setEffectiveModel as any)._handler(ctx, {
        runId: "run-qa",
        workerId: "worker-other",
        model: "gpt-5.4-mini",
      }),
    ).rejects.toThrow("Not lease owner");
  });

  it("rejects a worker after its run leaves running state", async () => {
    const ctx = {
      db: {
        get: async () => ({
          leaseOwner: "worker-qa",
          leaseExpiresAt: Date.now() + 60_000,
          status: "queued",
          model: "kimi-k2.6",
        }),
        patch: vi.fn(),
      },
    };

    await expect(
      (setEffectiveModel as any)._handler(ctx, {
        runId: "run-qa",
        workerId: "worker-qa",
        model: "gpt-5.4-mini",
      }),
    ).rejects.toThrow("Run is not active");
  });

  it("rejects an expired lease instead of resurrecting it", async () => {
    const ctx = {
      db: {
        get: async () => ({
          leaseOwner: "worker-qa",
          leaseExpiresAt: Date.now() - 1,
          status: "running",
          model: "kimi-k2.6",
        }),
        patch: vi.fn(),
      },
    };

    await expect(
      (setEffectiveModel as any)._handler(ctx, {
        runId: "run-qa",
        workerId: "worker-qa",
        model: "gpt-5.4-mini",
      }),
    ).rejects.toThrow("Run lease expired");
  });
});

function createUsageTestContext(initialRequests = 24) {
  let daily: any = {
    _id: "daily-qa",
    userId: "user-qa",
    date: new Date().toISOString().split("T")[0],
    requests: initialRequests,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalCost: 0,
    successCount: 0,
    errorCount: 0,
    providers: {},
    models: {},
    updatedAt: Date.now(),
  };
  const logs: any[] = [];
  const dailyQueryDates: string[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, apply: (q: any) => any) => {
          const filters: Record<string, unknown> = {};
          const constraints: Array<{
            op: "eq" | "gt" | "gte" | "lt" | "lte" | "neq";
            field: string;
            value: unknown;
          }> = [];
          const q = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              constraints.push({ op: "eq", field, value });
              return q;
            },
            gt(field: string, value: unknown) {
              constraints.push({ op: "gt", field, value });
              return q;
            },
            gte(field: string, value: unknown) {
              constraints.push({ op: "gte", field, value });
              return q;
            },
            lt(field: string, value: unknown) {
              constraints.push({ op: "lt", field, value });
              return q;
            },
            lte(field: string, value: unknown) {
              constraints.push({ op: "lte", field, value });
              return q;
            },
          };
          apply(q);
          if (table === "llmUsageDaily" && typeof filters.date === "string") {
            dailyQueryDates.push(filters.date);
          }
          const matches = (row: Record<string, any>) =>
            constraints.every(({ op, field, value }) => {
              const actual = row[field];
              if (op === "eq") return actual === value;
              if (op === "neq") return actual !== value;
              if (op === "gt") return actual > value!;
              if (op === "gte") return actual >= value!;
              if (op === "lt") return actual < value!;
              return actual <= value!;
            });
          const selection: any = {
            first: async () => {
              if (table === "subscriptions") return null;
              if (table === "chatThreadsStream") return null;
              if (table === "llmUsageDaily") {
                return daily?.userId === filters.userId && daily?.date === filters.date
                  ? daily
                  : null;
              }
              if (table === "llmUsageLog") {
                return logs.find(matches) ?? null;
              }
              return null;
            },
            filter: (predicate: (q: any) => unknown) => {
              const filterQ = {
                field: (field: string) => ({ field }),
                eq: (left: { field: string }, value: unknown) => {
                  constraints.push({ op: "eq", field: left.field, value });
                  return true;
                },
                neq: (left: { field: string }, value: unknown) => {
                  constraints.push({ op: "neq", field: left.field, value });
                  return true;
                },
              };
              predicate(filterQ);
              return selection;
            },
            take: async (limit: number) => {
              if (table !== "llmUsageLog") return [];
              return logs.filter(matches).slice(0, limit);
            },
          };
          return selection;
        },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        if (id === daily?._id) {
          daily = { ...daily, ...value };
          return;
        }
        const index = logs.findIndex((log) => log._id === id);
        if (index >= 0) logs[index] = { ...logs[index], ...value };
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const row = { _id: `${table}-${nextId++}`, ...value };
        if (table === "llmUsageDaily") daily = row;
        if (table === "llmUsageLog") logs.push(row);
        return row._id;
      },
    },
    scheduler: {
      runAt: vi.fn(async () => null),
      runAfter: vi.fn(async () => null),
    },
  };

  return {
    ctx,
    getDaily: () => daily,
    setDailyDate: (date: string) => {
      daily = { ...daily, date };
    },
    dailyQueryDates,
    logs,
  };
}

describe("authenticated usage reservation", () => {
  const request = {
    userId: "user-qa",
    model: "gpt-5.4-mini",
    estimatedInputTokens: 100,
    estimatedOutputTokens: 100,
  };

  it("does not price a partially cached input as fully cached", async () => {
    const uncached = createUsageTestContext(0);
    const partial = createUsageTestContext(0);
    const fullyCached = createUsageTestContext(0);
    const usage = {
      userId: "user-qa",
      model: "gpt-5.4-mini",
      inputTokens: 1_000,
      outputTokens: 100,
      success: true,
    };

    await (recordLlmUsageInternal as any)._handler(uncached.ctx, usage);
    await (recordLlmUsageInternal as any)._handler(partial.ctx, {
      ...usage,
      cachedTokens: 500,
    });
    await (recordLlmUsageInternal as any)._handler(fullyCached.ctx, {
      ...usage,
      cachedTokens: 1_000,
    });

    expect(partial.getDaily().totalCost).toBeCloseTo(
      uncached.getDaily().totalCost,
      12,
    );
    expect(fullyCached.getDaily().totalCost).toBeLessThan(
      partial.getDaily().totalCost,
    );
  });

  it("atomically admits one remaining request and rejects the next run", async () => {
    const state = createUsageTestContext(24);
    const before = await (checkRequestAllowed as any)._handler(state.ctx, request);
    expect(before.allowed).toBe(true);

    const first = await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:first",
      attemptKey: "run:first:attempt:1",
    });
    expect(first.allowed).toBe(true);
    expect(state.getDaily().requests).toBe(25);

    const idempotent = await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:first",
      attemptKey: "run:first:attempt:1",
    });
    expect(idempotent.allowed).toBe(true);
    expect(state.getDaily().requests).toBe(25);

    const concurrentFollower = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:second",
        attemptKey: "run:second:attempt:1",
      },
    );
    expect(concurrentFollower.allowed).toBe(false);
    expect(concurrentFollower.reason).toContain("already running");

    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:first",
      attemptKey: "run:first:attempt:1",
    });
    await (recordLlmUsageInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:first",
      attemptKey: "run:first:attempt:1",
      model: "gpt-5.4-mini",
      inputTokens: 120,
      outputTokens: 80,
      success: true,
    });
    expect(state.getDaily().requests).toBe(25);
    expect(state.getDaily().successCount).toBe(1);
    expect(state.logs[0].reservationStatus).toBe("reconciled");

    const after = await (checkRequestAllowed as any)._handler(state.ctx, request);
    expect(after.allowed).toBe(false);
  });

  it("releases a reservation when execution never reaches the provider", async () => {
    const state = createUsageTestContext(24);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:release",
      attemptKey: "run:release:attempt:1",
    });
    expect(state.getDaily().requests).toBe(25);

    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:release",
      attemptKey: "run:release:attempt:1",
      reason: "lease lost",
    });
    expect(state.getDaily().requests).toBe(24);
    expect(state.logs[0].reservationStatus).toBe("released");
  });

  it("accumulates distinct provider attempts exactly once and reconciles only the current estimate", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:fallback",
      attemptKey: "run:fallback:attempt:1",
    });
    const overlapping = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:fallback",
        attemptKey: "run:fallback:attempt:2",
      },
    );
    expect(overlapping.allowed).toBe(false);
    expect(overlapping.reason).toContain("still running");
    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:fallback",
      attemptKey: "run:fallback:attempt:1",
    });
    const second = await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:fallback",
      attemptKey: "run:fallback:attempt:2",
    });
    expect(second.allowed).toBe(true);
    expect(state.getDaily().requests).toBe(1);
    expect(state.getDaily().totalTokens).toBe(400);
    expect(state.logs[0]).toMatchObject({
      inputTokens: 200,
      outputTokens: 200,
      currentReservedInputTokens: 100,
      currentReservedOutputTokens: 100,
      currentReservationAttemptKey: "run:fallback:attempt:2",
    });

    const repeatedCurrent = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:fallback",
        attemptKey: "run:fallback:attempt:2",
      },
    );
    expect(repeatedCurrent.allowed).toBe(true);
    expect(state.getDaily().totalTokens).toBe(400);

    const replayedOld = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:fallback",
        attemptKey: "run:fallback:attempt:1",
      },
    );
    expect(replayedOld.allowed).toBe(false);
    expect(replayedOld.reason).toContain("already consumed");
    expect(state.getDaily().totalTokens).toBe(400);

    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:fallback",
      attemptKey: "run:fallback:attempt:2",
    });
    await (recordLlmUsageInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:fallback",
      attemptKey: "run:fallback:attempt:2",
      model: "gpt-5.4-mini",
      inputTokens: 120,
      outputTokens: 80,
      success: true,
    });
    expect(state.getDaily().totalTokens).toBe(400);
    expect(state.logs[0]).toMatchObject({
      inputTokens: 220,
      outputTokens: 180,
      reservationStatus: "reconciled",
    });
  });

  it("uses the reservation UTC day when releasing across midnight", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:midnight",
      attemptKey: "run:midnight:attempt:1",
    });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    state.logs[0].timestamp = Date.parse(`${yesterday}T23:59:59.000Z`);
    state.setDailyDate(yesterday);

    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:midnight",
      attemptKey: "run:midnight:attempt:1",
      reason: "cancelled before provider",
    });

    expect(state.dailyQueryDates.at(-1)).toBe(yesterday);
    expect(state.getDaily().requests).toBe(0);
    expect(state.getDaily().totalTokens).toBe(0);
  });

  it("uses the reservation UTC day when reconciling across midnight", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:midnight-reconcile",
      attemptKey: "run:midnight-reconcile:attempt:1",
    });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    state.logs[0].timestamp = Date.parse(`${yesterday}T23:59:59.000Z`);
    state.setDailyDate(yesterday);

    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:midnight-reconcile",
      attemptKey: "run:midnight-reconcile:attempt:1",
    });
    await (recordLlmUsageInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:midnight-reconcile",
      attemptKey: "run:midnight-reconcile:attempt:1",
      model: "gpt-5.4-mini",
      inputTokens: 70,
      outputTokens: 30,
      success: true,
    });

    expect(state.dailyQueryDates.at(-1)).toBe(yesterday);
    expect(state.getDaily().requests).toBe(1);
    expect(state.getDaily().totalTokens).toBe(100);
  });

  it("enforces ownership and keeps terminal reconciliation idempotent", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:owner",
      attemptKey: "run:owner:attempt:1",
    });
    await expect(
      (reserveLlmRequestInternal as any)._handler(state.ctx, {
        ...request,
        userId: "user-other",
        reservationKey: "run:owner",
        attemptKey: "run:owner:attempt:other",
      }),
    ).rejects.toThrow("Usage reservation owner mismatch");

    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:owner",
      attemptKey: "run:owner:attempt:1",
    });
    const finalUsage = {
      userId: "user-qa",
      reservationKey: "run:owner",
      attemptKey: "run:owner:attempt:1",
      model: "gpt-5.4-mini",
      inputTokens: 60,
      outputTokens: 40,
      success: true,
    };
    await (recordLlmUsageInternal as any)._handler(state.ctx, finalUsage);
    await (recordLlmUsageInternal as any)._handler(state.ctx, finalUsage);
    expect(state.getDaily().requests).toBe(1);
    expect(state.getDaily().successCount).toBe(1);
    expect(state.getDaily().totalTokens).toBe(100);
  });

  it("fails closed for a missing keyed reservation and invalid token values", async () => {
    const state = createUsageTestContext(0);
    await expect(
      (recordLlmUsageInternal as any)._handler(state.ctx, {
        userId: "user-qa",
        reservationKey: "run:missing",
        attemptKey: "run:missing:attempt:1",
        model: "gpt-5.4-mini",
        inputTokens: 1,
        outputTokens: 1,
        success: true,
      }),
    ).rejects.toThrow("Usage reservation not found");
    await expect(
      (recordLlmUsageInternal as any)._handler(state.ctx, {
        userId: "user-qa",
        model: "gpt-5.4-mini",
        inputTokens: -1,
        outputTokens: 0,
        success: true,
      }),
    ).rejects.toThrow("inputTokens must be a non-negative integer");
    expect(state.logs).toHaveLength(0);
  });

  it("does not let denied duplicate cleanup release another active execution", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:active-execution",
      attemptKey: "run:active-execution:attempt:1",
    });
    const deniedDuplicate = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:duplicate-execution",
        attemptKey: "run:duplicate-execution:attempt:1",
      },
    );
    expect(deniedDuplicate.allowed).toBe(false);

    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:duplicate-execution",
      attemptKey: "run:duplicate-execution:attempt:1",
      reason: "denied duplicate cleanup",
    });
    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:active-execution",
      attemptKey: "run:duplicate-execution:attempt:1",
      reason: "stale cross-attempt cleanup",
    });

    expect(state.getDaily().requests).toBe(1);
    expect(state.logs[0]).toMatchObject({
      reservationKey: "run:active-execution",
      reservationStatus: "reserved",
      currentReservationAttemptKey: "run:active-execution:attempt:1",
    });
  });

  it("settles a failed maximum before fallback and fences stale reconciliation", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:attempt-fence",
      attemptKey: "run:attempt-fence:attempt:1",
      reserveMaximumTierAllowance: true,
    });
    expect(state.getDaily().totalTokens).toBe(8_000);
    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:attempt-fence",
      attemptKey: "run:attempt-fence:attempt:1",
    });
    await (settleFailedLlmReservationAttemptInternal as any)._handler(
      state.ctx,
      {
        userId: "user-qa",
        reservationKey: "run:attempt-fence",
        attemptKey: "run:attempt-fence:attempt:1",
        model: "gpt-5.4-mini",
        inputTokens: 90,
        outputTokens: 10,
        errorMessage: "provider failed",
      },
    );
    expect(state.getDaily().totalTokens).toBe(100);
    expect(state.logs[0].currentReservationAttemptState).toBe("settled");

    const fallback = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:attempt-fence",
        attemptKey: "run:attempt-fence:attempt:2",
        reserveMaximumTierAllowance: true,
      },
    );
    expect(fallback.allowed).toBe(true);
    expect(state.logs[0].currentReservationAttemptKey).toBe(
      "run:attempt-fence:attempt:2",
    );

    await expect(
      (recordLlmUsageInternal as any)._handler(state.ctx, {
        userId: "user-qa",
        reservationKey: "run:attempt-fence",
        attemptKey: "run:attempt-fence:attempt:1",
        model: "gpt-5.4-mini",
        inputTokens: 1,
        outputTokens: 1,
        success: false,
      }),
    ).rejects.toThrow("Usage reservation attempt mismatch");
    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:attempt-fence",
      attemptKey: "run:attempt-fence:attempt:1",
      reason: "stale release",
    });
    expect(state.logs[0]).toMatchObject({
      reservationStatus: "reserved",
      currentReservationAttemptKey: "run:attempt-fence:attempt:2",
    });

    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:attempt-fence",
      attemptKey: "run:attempt-fence:attempt:2",
    });
    await (recordLlmUsageInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:attempt-fence",
      attemptKey: "run:attempt-fence:attempt:2",
      model: "gpt-5.4-mini",
      inputTokens: 80,
      outputTokens: 20,
      success: true,
    });
    expect(state.getDaily().totalTokens).toBe(200);
    expect(state.logs[0].reservationStatus).toBe("reconciled");
  });

  it("releases only the unstarted fallback reservation and preserves prior spend", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:release-fallback",
      attemptKey: "run:release-fallback:attempt:1",
      reserveMaximumTierAllowance: true,
    });
    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:release-fallback",
      attemptKey: "run:release-fallback:attempt:1",
    });
    await (settleFailedLlmReservationAttemptInternal as any)._handler(
      state.ctx,
      {
        userId: "user-qa",
        reservationKey: "run:release-fallback",
        attemptKey: "run:release-fallback:attempt:1",
        model: "gpt-5.4-mini",
        inputTokens: 90,
        outputTokens: 10,
        cachedTokens: 20,
        errorMessage: "first provider failed",
      },
    );
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:release-fallback",
      attemptKey: "run:release-fallback:attempt:2",
      reserveMaximumTierAllowance: true,
    });

    expect(state.getDaily().totalTokens).toBe(8_100);
    await (releaseLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:release-fallback",
      attemptKey: "run:release-fallback:attempt:2",
      reason: "cancelled before fallback provider",
    });

    expect(state.getDaily()).toMatchObject({
      requests: 1,
      totalTokens: 100,
      inputTokens: 90,
      outputTokens: 10,
      cachedTokens: 20,
      errorCount: 1,
    });
    expect(state.logs[0]).toMatchObject({
      reservationStatus: "reconciled",
      inputTokens: 90,
      outputTokens: 10,
      cachedTokens: 20,
      currentReservationAttemptKey: undefined,
    });
  });

  it("finalizes ambiguous provider spend at the reserved maximum exactly once", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:ambiguous-finalizer",
      attemptKey: "run:ambiguous-finalizer:attempt:1",
      reserveMaximumTierAllowance: true,
    });
    const finalizeArgs = {
      userId: "user-qa",
      reservationKey: "run:ambiguous-finalizer",
      attemptKey: "run:ambiguous-finalizer:attempt:1",
      reason: "provider timed out after invocation",
    };

    await expect(
      (finalizeAmbiguousLlmReservationInternal as any)._handler(
        state.ctx,
        finalizeArgs,
      ),
    ).rejects.toThrow("provider attempt is still running");
    await (markLlmReservationAttemptEndedInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:ambiguous-finalizer",
      attemptKey: "run:ambiguous-finalizer:attempt:1",
    });
    await (finalizeAmbiguousLlmReservationInternal as any)._handler(
      state.ctx,
      finalizeArgs,
    );
    await (finalizeAmbiguousLlmReservationInternal as any)._handler(
      state.ctx,
      finalizeArgs,
    );

    expect(state.getDaily()).toMatchObject({
      requests: 1,
      totalTokens: 8_000,
      errorCount: 1,
      providers: { openai: 1 },
      models: { "gpt-5.4-mini": 1 },
    });
    expect(state.logs[0]).toMatchObject({
      reservationStatus: "reconciled",
      inputTokens: 0,
      outputTokens: 8_000,
      success: false,
      errorMessage: "provider timed out after invocation",
    });
  });

  it("durably expires an ambiguous reservation without refunding its maximum", async () => {
    const state = createUsageTestContext(0);
    await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:expiry",
      attemptKey: "run:expiry:attempt:1",
      reserveMaximumTierAllowance: true,
    });
    state.logs[0].reservationExpiresAt = Date.now() - 1;

    await (reapExpiredLlmReservationInternal as any)._handler(state.ctx, {
      userId: "user-qa",
      reservationKey: "run:expiry",
      attemptKey: "run:expiry:attempt:1",
    });

    expect(state.getDaily()).toMatchObject({
      requests: 1,
      totalTokens: 8_000,
      errorCount: 1,
    });
    expect(state.logs[0]).toMatchObject({
      reservationStatus: "reconciled",
      success: false,
      errorMessage: "Usage reservation expired before terminal reconciliation",
    });
  });

  it("finds an active reservation beyond the former twenty-row scan", async () => {
    const state = createUsageTestContext(0);
    const now = Date.now();
    for (let index = 0; index < 25; index += 1) {
      state.logs.push({
        _id: `expired-${index}`,
        userId: "user-qa",
        reservationKey: `run:expired:${index}`,
        reservationStatus: "reserved",
        reservationExpiresAt: now - 1,
        timestamp: now - 1,
      });
    }
    state.logs.push({
      _id: "active-after-twenty",
      userId: "user-qa",
      reservationKey: "run:active-after-twenty",
      reservationStatus: "reserved",
      reservationExpiresAt: now + 60_000,
      timestamp: now,
    });

    const admission = await (reserveLlmRequestInternal as any)._handler(
      state.ctx,
      {
        ...request,
        reservationKey: "run:new",
        attemptKey: "run:new:attempt:1",
      },
    );
    expect(admission.allowed).toBe(false);
    expect(admission.reason).toContain("already running");
  });

  it("reserves the authenticated tier maximum to bound concurrent quota admission", async () => {
    const state = createUsageTestContext(0);
    const access = await (reserveLlmRequestInternal as any)._handler(state.ctx, {
      ...request,
      reservationKey: "run:max-bound",
      attemptKey: "run:max-bound:attempt:1",
      reserveMaximumTierAllowance: true,
    });

    expect(access.allowed).toBe(true);
    expect(state.getDaily().totalTokens).toBe(8_000);
    expect(state.logs[0]).toMatchObject({
      currentReservedInputTokens: 0,
      currentReservedOutputTokens: 8_000,
    });
  });
});
