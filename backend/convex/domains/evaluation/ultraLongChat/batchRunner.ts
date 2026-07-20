"use node";

/**
 * Ultra-Long Chat Batch Runner
 *
 * Runs the ultra-long-chat eval suite against the REAL agent
 * (`sendMessageInternal`) across N samples per scenario, judges each
 * turn with an LLM, persists per-turn traces + per-scenario aggregates,
 * and computes 95% confidence intervals per boolean criterion.
 *
 * This is the LangSmith/Arize-style path: real agent execution, LLM-as-judge,
 * versioned dataset, statistical sampling, regression-ready persistence.
 *
 * Entry point: `runUltraLongChatEval` action (see bottom of file).
 */

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import {
  ULTRA_LONG_CHAT_SCENARIOS,
  getDatasetDigest,
  type UltraLongChatScenario,
  type JudgeCriterion,
  ALL_CRITERIA,
} from "./scenarios";
import { judgeTurn } from "./judge";
import {
  calculateRequestCost,
  getModelPricing,
} from "../../../../shared/llm/modelCatalog";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const EVAL_TEST_USER_ID = "k17638grr3agn8cvdxa7fanbt57vrhzw" as Id<"users">;
const DEFAULT_SAMPLES_PER_SCENARIO = 3;
const DEFAULT_MODEL = "kimi-k2.6";

// ═══════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Student-t 95% confidence interval for small N. Uses 1.96 (z) as an
 * approximation for N >= 10, and a conservative 2.78 (t, df=4) for smaller N.
 */
function ci95(values: number[]): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  const m = mean(values);
  const s = stdev(values);
  const z = values.length >= 10 ? 1.96 : 2.78;
  const margin = (s / Math.sqrt(values.length)) * z;
  return {
    low: Math.max(0, m - margin),
    high: Math.min(1, m + margin),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN ONE SCENARIO SAMPLE (N turns against the real agent)
// ═══════════════════════════════════════════════════════════════════════════

interface ScenarioRunResult {
  scenarioId: string;
  sampleIndex: number;
  scenarioRunId: Id<"ultraLongChatEvalRuns">;
  turnsCompleted: number;
  turnsJudgedPassing: number;
  passRate: number;
  totalLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  perTurnCriteria: Array<Record<JudgeCriterion, boolean>>;
  status: "completed" | "failed";
  errorMessage?: string;
}

async function runScenarioSample(args: {
  ctx: any;
  suiteRunId: Id<"evalRuns">;
  scenario: UltraLongChatScenario;
  sampleIndex: number;
  model: string;
}): Promise<ScenarioRunResult> {
  const { ctx, suiteRunId, scenario, sampleIndex, model } = args;

  // Create a fresh thread for this sample to ensure clean state
  const threadIdSeed = `ulc-${scenario.id}-${sampleIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const scenarioRunId: Id<"ultraLongChatEvalRuns"> = await ctx.runMutation(
    internal.domains.evaluation.ultraLongChat.storage.createScenarioRun,
    {
      suiteRunId,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      sampleIndex,
      model,
      threadId: threadIdSeed,
      totalTurns: scenario.totalTurns,
    },
  );

  const perTurnCriteria: Array<Record<JudgeCriterion, boolean>> = [];
  const priorTurns: Array<{ role: "user" | "assistant"; content: string; turnNumber?: number }> = [];
  let totalLatencyMs = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let turnsCompleted = 0;
  let turnsJudgedPassing = 0;
  let liveThreadId: string | undefined;
  let errorMessage: string | undefined;

  const pricing = getModelPricing(model);

  try {
    for (const turn of scenario.turns) {
      const turnStart = Date.now();
      priorTurns.push({ role: "user", content: turn.userMessage, turnNumber: turn.turnNumber });

      let response = "";
      let toolsCalled: string[] = [];

      try {
        const result = await ctx.runAction(
          internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal,
          {
            threadId: liveThreadId,
            message: turn.userMessage,
            userId: EVAL_TEST_USER_ID,
          },
        );
        response = result.response || "";
        toolsCalled = result.toolsCalled || [];
        liveThreadId = result.threadId ?? liveThreadId;
      } catch (err) {
        response = `(agent error: ${(err as Error).message})`;
      }

      const latencyMs = Date.now() - turnStart;
      totalLatencyMs += latencyMs;

      // Token estimates (rough: 4 chars/token)
      const tokensIn =
        Math.ceil(turn.userMessage.length / 4) +
        Math.ceil(priorTurns.slice(-16).reduce((acc, t) => acc + t.content.length, 0) / 4);
      const tokensOut = Math.ceil(response.length / 4);
      totalTokens += tokensIn + tokensOut;
      if (pricing) {
        totalCostUsd += calculateRequestCost(model, tokensIn, tokensOut, false);
      }

      // Judge this turn
      const verdict = await judgeTurn({
        scenarioTitle: scenario.title,
        primaryEntity: scenario.primaryEntity,
        turn,
        priorTurns: priorTurns.slice(0, -1), // Exclude the current user turn
        assistantResponse: response,
        toolsCalled,
      });

      await ctx.runMutation(
        internal.domains.evaluation.ultraLongChat.storage.storeTurnResult,
        {
          runId: scenarioRunId,
          turnNumber: turn.turnNumber,
          userMessage: turn.userMessage,
          assistantResponse: response,
          toolsCalled,
          latencyMs,
          tokensIn,
          tokensOut,
          criteria: {
            rememberedPriorContext: verdict.criteria.rememberedPriorContext.value,
            didNotReFetchStaleData: verdict.criteria.didNotReFetchStaleData.value,
            prioritiesSurfacedWhenAsked: verdict.criteria.prioritiesSurfacedWhenAsked.value,
            noHallucinatedClaims: verdict.criteria.noHallucinatedClaims.value,
            appropriateAngleActivation: verdict.criteria.appropriateAngleActivation.value,
            stayedOnTopic: verdict.criteria.stayedOnTopic.value,
          },
          criteriaReasons: Object.fromEntries(
            (Object.keys(verdict.criteria) as JudgeCriterion[]).map((k) => [
              k,
              verdict.criteria[k].reason,
            ]),
          ),
          passed: verdict.overallPassed,
          judgeModel: verdict.judgeModel,
          judgeLatencyMs: verdict.judgeLatencyMs,
        },
      );

      perTurnCriteria.push({
        rememberedPriorContext: verdict.criteria.rememberedPriorContext.value,
        didNotReFetchStaleData: verdict.criteria.didNotReFetchStaleData.value,
        prioritiesSurfacedWhenAsked: verdict.criteria.prioritiesSurfacedWhenAsked.value,
        noHallucinatedClaims: verdict.criteria.noHallucinatedClaims.value,
        appropriateAngleActivation: verdict.criteria.appropriateAngleActivation.value,
        stayedOnTopic: verdict.criteria.stayedOnTopic.value,
      });

      priorTurns.push({ role: "assistant", content: response, turnNumber: turn.turnNumber });
      turnsCompleted += 1;
      if (verdict.overallPassed) turnsJudgedPassing += 1;
    }
  } catch (err) {
    errorMessage = (err as Error).message;
  }

  const passRate = turnsCompleted > 0 ? turnsJudgedPassing / turnsCompleted : 0;
  const status: "completed" | "failed" =
    errorMessage || turnsCompleted < scenario.totalTurns ? "failed" : "completed";

  await ctx.runMutation(
    internal.domains.evaluation.ultraLongChat.storage.finalizeScenarioRun,
    {
      runId: scenarioRunId,
      status,
      turnsCompleted,
      turnsJudgedPassing,
      passRate,
      totalLatencyMs,
      totalTokens,
      totalCostUsd,
      errorMessage,
    },
  );

  return {
    scenarioId: scenario.id,
    sampleIndex,
    scenarioRunId,
    turnsCompleted,
    turnsJudgedPassing,
    passRate,
    totalLatencyMs,
    totalTokens,
    totalCostUsd,
    perTurnCriteria,
    status,
    errorMessage,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE ACROSS N SAMPLES
// ═══════════════════════════════════════════════════════════════════════════

interface AggregateResult {
  scenarioId: string;
  overallMeanPassRate: number;
  overallCi95Low: number;
  overallCi95High: number;
  criterionStats: Array<{
    criterion: string;
    meanPassRate: number;
    stdev: number;
    ci95Low: number;
    ci95High: number;
  }>;
  avgLatencyMsPerTurn: number;
  avgCostUsdPerRun: number;
  sampleCount: number;
}

function aggregateScenarioSamples(
  scenario: UltraLongChatScenario,
  samples: ScenarioRunResult[],
): AggregateResult {
  const completedSamples = samples.filter((s) => s.status === "completed");
  const passRates = completedSamples.map((s) => s.passRate);
  const overall = ci95(passRates);

  const criterionStats = ALL_CRITERIA.map((crit) => {
    const perSampleRates = completedSamples.map((sample) => {
      if (sample.perTurnCriteria.length === 0) return 0;
      const passing = sample.perTurnCriteria.filter((t) => t[crit]).length;
      return passing / sample.perTurnCriteria.length;
    });
    const ci = ci95(perSampleRates);
    return {
      criterion: crit,
      meanPassRate: mean(perSampleRates),
      stdev: stdev(perSampleRates),
      ci95Low: ci.low,
      ci95High: ci.high,
    };
  });

  const avgLatencyMsPerTurn =
    completedSamples.length > 0
      ? mean(
          completedSamples.map((s) =>
            s.turnsCompleted > 0 ? s.totalLatencyMs / s.turnsCompleted : 0,
          ),
        )
      : 0;

  const avgCostUsdPerRun =
    completedSamples.length > 0
      ? mean(completedSamples.map((s) => s.totalCostUsd))
      : 0;

  return {
    scenarioId: scenario.id,
    overallMeanPassRate: mean(passRates),
    overallCi95Low: overall.low,
    overallCi95High: overall.high,
    criterionStats,
    avgLatencyMsPerTurn,
    avgCostUsdPerRun,
    sampleCount: completedSamples.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

export const runUltraLongChatEval = action({
  args: {
    scenarioIds: v.optional(v.array(v.string())),
    samplesPerScenario: v.optional(v.number()),
    model: v.optional(v.string()),
    suiteId: v.optional(v.string()),
  },
  returns: v.object({
    suiteRunId: v.id("evalRuns"),
    datasetDigest: v.string(),
    scenariosRun: v.number(),
    aggregates: v.array(v.object({
      scenarioId: v.string(),
      overallMeanPassRate: v.number(),
      overallCi95Low: v.number(),
      overallCi95High: v.number(),
      sampleCount: v.number(),
      criterionStats: v.array(v.object({
        criterion: v.string(),
        meanPassRate: v.number(),
        stdev: v.number(),
        ci95Low: v.number(),
        ci95High: v.number(),
      })),
    })),
    passRate: v.number(),
    durationMs: v.number(),
  }),

  handler: async (ctx, args) => {
    const started = Date.now();
    const model = args.model ?? DEFAULT_MODEL;
    const samples = Math.max(1, args.samplesPerScenario ?? DEFAULT_SAMPLES_PER_SCENARIO);
    const suiteId = args.suiteId ?? `ultra-long-chat-${new Date().toISOString().slice(0, 10)}`;
    const datasetDigest = getDatasetDigest();

    const scenarios = args.scenarioIds
      ? ULTRA_LONG_CHAT_SCENARIOS.filter((s) => args.scenarioIds!.includes(s.id))
      : ULTRA_LONG_CHAT_SCENARIOS;

    if (scenarios.length === 0) {
      throw new Error(
        `No scenarios matched: requested=${args.scenarioIds?.join(",") ?? "(all)"} available=${ULTRA_LONG_CHAT_SCENARIOS.map((s) => s.id).join(",")}`,
      );
    }

    const totalCases = scenarios.length * samples;
    const suiteRunId: Id<"evalRuns"> = await ctx.runMutation(
      internal.domains.evaluation.ultraLongChat.storage.createSuiteRun,
      { suiteId, model, totalCases, datasetDigest },
    );

    const aggregates: AggregateResult[] = [];
    let suitePassingSamples = 0;
    let suiteCompletedSamples = 0;
    let suiteTotalLatency = 0;

    for (const scenario of scenarios) {
      const sampleResults: ScenarioRunResult[] = [];
      for (let i = 0; i < samples; i++) {
        const res = await runScenarioSample({
          ctx,
          suiteRunId,
          scenario,
          sampleIndex: i,
          model,
        });
        sampleResults.push(res);
        if (res.status === "completed") {
          suiteCompletedSamples += 1;
          if (res.passRate >= scenario.successThreshold) suitePassingSamples += 1;
          suiteTotalLatency += res.totalLatencyMs;
        }
      }

      const agg = aggregateScenarioSamples(scenario, sampleResults);
      aggregates.push(agg);

      await ctx.runMutation(
        internal.domains.evaluation.ultraLongChat.storage.storeAggregate,
        {
          suiteRunId,
          scenarioId: agg.scenarioId,
          scenarioVersion: scenario.version,
          model,
          sampleCount: agg.sampleCount,
          criterionStats: agg.criterionStats,
          overallMeanPassRate: agg.overallMeanPassRate,
          overallCi95Low: agg.overallCi95Low,
          overallCi95High: agg.overallCi95High,
          avgLatencyMsPerTurn: agg.avgLatencyMsPerTurn,
          avgCostUsdPerRun: agg.avgCostUsdPerRun,
        },
      );
    }

    const suitePassRate =
      suiteCompletedSamples > 0 ? suitePassingSamples / suiteCompletedSamples : 0;
    const avgLatencyMs =
      suiteCompletedSamples > 0 ? suiteTotalLatency / suiteCompletedSamples : 0;

    await ctx.runMutation(
      internal.domains.evaluation.ultraLongChat.storage.finalizeSuiteRun,
      {
        runId: suiteRunId,
        status: "completed",
        passedCases: suitePassingSamples,
        failedCases: suiteCompletedSamples - suitePassingSamples,
        passRate: suitePassRate,
        avgLatencyMs,
      },
    );

    return {
      suiteRunId,
      datasetDigest,
      scenariosRun: scenarios.length,
      aggregates: aggregates.map((a) => ({
        scenarioId: a.scenarioId,
        overallMeanPassRate: a.overallMeanPassRate,
        overallCi95Low: a.overallCi95Low,
        overallCi95High: a.overallCi95High,
        sampleCount: a.sampleCount,
        criterionStats: a.criterionStats,
      })),
      passRate: suitePassRate,
      durationMs: Date.now() - started,
    };
  },
});
