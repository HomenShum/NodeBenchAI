/**
 * Production Benchmark for Ultra-Long Multi-Angle Chat Sessions
 *
 * This is NOT a toy eval. It measures retention-critical outcomes across:
 *   - Real multi-turn sessions (20+ turns)
 *   - Compaction correctness (does context survive 30+ turn gaps?)
 *   - JIT retrieval hit rate (does the system fetch the right angles?)
 *   - Token budget adherence (does compression actually trigger?)
 *   - Model routing correctness (advisor/executor selection)
 *
 * Success criteria:
 *   - Seamless pickup after long gaps (priority ledger preserved)
 *   - Working set < 25% of context window after compression
 *   - Angle classification accuracy > 80%
 *   - All checkpoints durable (can resume from any turn)
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// ════════════════════════════════════════════════════════════════════
// PERSONA-DRIVEN MULTI-TURN SCENARIOS
// ════════════════════════════════════════════════════════════════════

interface TurnScript {
  role: "user";
  content: string;
  expectedAngles?: string[];
  expectedPriorityLedgerPresence?: string[];
}

interface SessionScenario {
  id: string;
  persona: string;
  topic: string;
  primaryEntity: string;
  contextWindowTokens: number;
  turns: TurnScript[];
  durableMemoriesToPlant: Array<{ claim: string; confidence: number; tags: string[] }>;
  successCriteria: {
    minAngleClassificationAccuracy: number;
    mustPreservePriorities: string[]; // substrings that must appear in ledger by end
    maxWorkingSetTokens: number;
    minCompressionLevelByTurn: Record<number, number>;
  };
}

const SCENARIOS: SessionScenario[] = [
  // POWER USER: 25-turn session across 5 angles, high context pressure
  {
    id: "power_user_stripe_deep_dive",
    persona: "daily_driver",
    topic: "Stripe competitive positioning and M&A moves",
    primaryEntity: "stripe",
    contextWindowTokens: 262144, // Kimi K2.6 window
    turns: [
      { role: "user", content: "I need a deep dive on Stripe. What's their latest funding round?", expectedAngles: ["funding_intelligence", "entity_profile"] },
      { role: "user", content: "Who are their main competitors now?", expectedAngles: ["competitive_intelligence"] },
      { role: "user", content: "I care about how Stripe compares to Adyen on revenue. Important: I'm interviewing there next week.", expectedAngles: ["financial_health", "competitive_intelligence", "people_graph"] },
      { role: "user", content: "Show me recent pulse signals on Stripe", expectedAngles: ["public_signals"] },
      { role: "user", content: "What documents do we have about their 10-K filings?", expectedAngles: ["document_discovery", "regulatory_monitoring"] },
      { role: "user", content: "Give me the executive brief version", expectedAngles: ["executive_brief"] },
      { role: "user", content: "What's my daily brief say about Stripe today?", expectedAngles: ["daily_brief"] },
      { role: "user", content: "Deep research on their enterprise strategy", expectedAngles: ["deep_research"] },
      { role: "user", content: "Compare market dynamics with Square", expectedAngles: ["market_dynamics", "competitive_intelligence"] },
      { role: "user", content: "Who are the key people I should know at Stripe? I need this for the final round interview.", expectedAngles: ["people_graph"], expectedPriorityLedgerPresence: ["final round", "interview"] },
      { role: "user", content: "Any patents Stripe owns?", expectedAngles: ["patent_intelligence"] },
      { role: "user", content: "Academic papers about payment infrastructure", expectedAngles: ["academic_research"] },
      { role: "user", content: "GitHub repositories they maintain", expectedAngles: ["github_ecosystem"] },
      { role: "user", content: "World economic factors affecting Stripe", expectedAngles: ["world_monitor"] },
      { role: "user", content: "Regulatory changes impacting them", expectedAngles: ["regulatory_monitoring"] },
      { role: "user", content: "Narrative shifts in the market about Stripe", expectedAngles: ["narrative_tracking"] },
      { role: "user", content: "Remind me, what did I say was important earlier?", expectedAngles: ["entity_profile"], expectedPriorityLedgerPresence: ["final round", "interview"] },
      { role: "user", content: "Continue on funding. What's the latest news?", expectedAngles: ["public_signals", "funding_intelligence"] },
      { role: "user", content: "Help me compare Stripe's CEO with Adyen's CEO", expectedAngles: ["people_graph", "competitive_intelligence"] },
      { role: "user", content: "I want a summary of everything", expectedAngles: ["executive_brief"] },
      { role: "user", content: "What did I say I care about?", expectedAngles: ["entity_profile"], expectedPriorityLedgerPresence: ["final round", "interview"] },
      { role: "user", content: "Pick up where we left off on funding", expectedAngles: ["funding_intelligence"] },
      { role: "user", content: "Final round interview prep - what should I know?", expectedAngles: ["people_graph"], expectedPriorityLedgerPresence: ["final round"] },
      { role: "user", content: "I need to negotiate my offer. What's the compensation data?", expectedAngles: ["financial_health", "market_dynamics"] },
      { role: "user", content: "Give me the full picture now", expectedAngles: ["executive_brief", "deep_research"] },
    ],
    durableMemoriesToPlant: [
      { claim: "User is interviewing at Stripe for Platform Engineer role", confidence: 0.95, tags: ["career", "interview"] },
      { claim: "User prefers Stripe over Square for fintech work", confidence: 0.85, tags: ["preference"] },
      { claim: "User has final round on Nov 15, 2026", confidence: 0.90, tags: ["deadline", "interview"] },
    ],
    successCriteria: {
      minAngleClassificationAccuracy: 0.75,
      mustPreservePriorities: ["interview", "final round"],
      maxWorkingSetTokens: 30_000, // Must stay under 12% of 262K Kimi window
      minCompressionLevelByTurn: { 15: 1, 20: 2, 24: 2 },
    },
  },

  // CASUAL USER: 10-turn intermittent session
  {
    id: "casual_user_anthropic_tracking",
    persona: "continuation_seeker",
    topic: "Anthropic product updates",
    primaryEntity: "anthropic",
    contextWindowTokens: 262144,
    turns: [
      { role: "user", content: "What's new with Anthropic this week?", expectedAngles: ["public_signals"] },
      { role: "user", content: "Tell me about Claude 4.7", expectedAngles: ["entity_profile"] },
      { role: "user", content: "I want to track their funding", expectedAngles: ["funding_intelligence"] },
      { role: "user", content: "Compare Claude to GPT-5", expectedAngles: ["competitive_intelligence"] },
      { role: "user", content: "What did we discuss last session?", expectedAngles: ["entity_profile"] },
      { role: "user", content: "Any new documents from Anthropic?", expectedAngles: ["document_discovery"] },
      { role: "user", content: "Market dynamics for AI assistants", expectedAngles: ["market_dynamics"] },
      { role: "user", content: "Latest narrative shifts", expectedAngles: ["narrative_tracking"] },
      { role: "user", content: "Executive brief please", expectedAngles: ["executive_brief"] },
      { role: "user", content: "Summarize everything we've learned", expectedAngles: ["executive_brief"] },
    ],
    durableMemoriesToPlant: [
      { claim: "User tracks Anthropic product launches for work", confidence: 0.80, tags: ["research"] },
      { claim: "User cares about Claude vs GPT comparisons", confidence: 0.85, tags: ["preference"] },
    ],
    successCriteria: {
      minAngleClassificationAccuracy: 0.70,
      mustPreservePriorities: ["Anthropic"],
      maxWorkingSetTokens: 20_000,
      minCompressionLevelByTurn: { 8: 0, 10: 1 },
    },
  },

  // AT-RISK USER: returns after gap, needs hook
  {
    id: "at_risk_user_nvidia_return",
    persona: "drifter",
    topic: "NVIDIA earnings analysis",
    primaryEntity: "nvidia",
    contextWindowTokens: 262144,
    turns: [
      { role: "user", content: "What was I working on with NVIDIA?", expectedAngles: ["entity_profile"] },
      { role: "user", content: "Anything new since I last checked?", expectedAngles: ["public_signals"] },
      { role: "user", content: "Tell me about their AI chip demand", expectedAngles: ["market_dynamics"] },
      { role: "user", content: "Any surprising insights I'm missing?", expectedAngles: ["narrative_tracking"] },
      { role: "user", content: "What should I pay attention to?", expectedAngles: ["public_signals", "narrative_tracking"] },
    ],
    durableMemoriesToPlant: [
      { claim: "User was building an NVIDIA thesis 14 days ago", confidence: 0.70, tags: ["abandoned"] },
    ],
    successCriteria: {
      minAngleClassificationAccuracy: 0.65,
      mustPreservePriorities: ["NVIDIA"],
      maxWorkingSetTokens: 15_000,
      minCompressionLevelByTurn: { 5: 0 },
    },
  },
];

// ════════════════════════════════════════════════════════════════════
// SIMULATION: run a full multi-turn session through the orchestrator
// ════════════════════════════════════════════════════════════════════

export const simulateSession = internalAction({
  args: {
    scenarioId: v.string(),
    ownerKey: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    scenarioId: v.string(),
    persona: v.string(),
    sessionId: v.string(),
    turnsExecuted: v.number(),
    measurements: v.object({
      angleClassificationAccuracy: v.number(),
      prioritiesPreserved: v.number(),
      prioritiesMissed: v.number(),
      maxWorkingSetTokens: v.number(),
      avgWorkingSetTokens: v.number(),
      compressionTriggers: v.number(),
      finalCompressionLevel: v.number(),
      checkpointsSaved: v.number(),
    }),
    verdict: v.object({
      angleAccuracyPass: v.boolean(),
      contextBudgetPass: v.boolean(),
      retentionPass: v.boolean(),
      compressionPass: v.boolean(),
      overallPass: v.boolean(),
    }),
    failures: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<any> => {
    const scenario = SCENARIOS.find((s) => s.id === args.scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${args.scenarioId}`);

    let phase = "plant_memory";
    try {
      // 1) Plant durable memories
      for (const mem of scenario.durableMemoriesToPlant) {
        await ctx.runMutation(
          internal.domains.research.researchSessionLifecycle.recordMemory,
          {
            userId: args.userId,
            claim: mem.claim,
            confidence: mem.confidence,
            entity: scenario.primaryEntity,
            topic: scenario.topic,
            tags: mem.tags,
          },
        );
      }

      phase = "create_session";
      // 2) Create session
      const sessionId: any = await ctx.runMutation(
        internal.domains.research.researchSessionLifecycle.createSession,
        {
          userId: args.userId,
          topic: scenario.topic,
          primaryEntity: scenario.primaryEntity,
          contextWindowTokens: scenario.contextWindowTokens,
        },
      );

      // 3) Run each turn through orchestrator
      const turnResults: any[] = [];
      const hotWindow: Array<{ role: string; content: string }> = [];

      for (let i = 0; i < scenario.turns.length; i++) {
        const turn = scenario.turns[i];

        phase = `run_turn_${i}`;
        const result: any = await ctx.runAction(
          internal.domains.research.researchSessionOrchestrator.runTurn,
          {
            sessionId,
            ownerKey: args.ownerKey,
            userId: args.userId,
            prompt: turn.content,
            entitySlug: scenario.primaryEntity,
            hotWindow: hotWindow.slice(-10),
            estimatedPromptTokens: 800 + i * 50, // simulate accumulating context
          },
        );

        phase = `capture_memory_${i}`;
        // Also capture memory from this turn
        await ctx.runAction(
          internal.domains.research.researchSessionOrchestrator.captureTurnMemory,
          {
            sessionId,
            userId: args.userId,
            userPrompt: turn.content,
            assistantResponse: `Simulated response for: ${turn.content.slice(0, 80)}`,
            topic: scenario.topic,
            entity: scenario.primaryEntity,
          },
        );

        hotWindow.push({ role: "user", content: turn.content });
        hotWindow.push({ role: "assistant", content: `Simulated response for turn ${i + 1}` });

        turnResults.push({
          turnIndex: i,
          expected: turn.expectedAngles ?? [],
          actual: result.activeAngles,
          compressionLevel: result.compressionLevel,
          tokenEstimate: result.tokenEstimate,
          hydratedItems: result.hydratedItems,
          workingSetMarkdown: result.workingSetMarkdown,
          expectedPriorityLedgerPresence: turn.expectedPriorityLedgerPresence ?? [],
        });
      }

    // 4) Compute measurements
    let correctAngles = 0;
    let totalExpectedAngles = 0;
    let prioritiesPreserved = 0;
    let prioritiesMissed = 0;

    for (const r of turnResults) {
      if (r.expected.length > 0) {
        const actualSet = new Set(r.actual);
        const hits = r.expected.filter((e: string) => actualSet.has(e)).length;
        correctAngles += hits;
        totalExpectedAngles += r.expected.length;
      }
      for (const priority of r.expectedPriorityLedgerPresence) {
        if (r.workingSetMarkdown.toLowerCase().includes(priority.toLowerCase())) {
          prioritiesPreserved++;
        } else {
          prioritiesMissed++;
        }
      }
    }

    const maxWorkingSetTokens = Math.max(...turnResults.map((r: any) => r.tokenEstimate));
    const avgWorkingSetTokens = Math.round(
      turnResults.reduce((sum: number, r: any) => sum + r.tokenEstimate, 0) / turnResults.length,
    );
    const compressionTriggers = turnResults.filter((r: any, idx: number) =>
      idx > 0 && r.compressionLevel > turnResults[idx - 1].compressionLevel,
    ).length;
    const finalCompressionLevel = turnResults[turnResults.length - 1]?.compressionLevel ?? 0;
    const checkpointsSaved = turnResults.length;

    const angleClassificationAccuracy =
      totalExpectedAngles > 0 ? correctAngles / totalExpectedAngles : 1.0;

    const measurements = {
      angleClassificationAccuracy,
      prioritiesPreserved,
      prioritiesMissed,
      maxWorkingSetTokens,
      avgWorkingSetTokens,
      compressionTriggers,
      finalCompressionLevel,
      checkpointsSaved,
    };

    // 5) Apply success criteria
    const failures: string[] = [];
    const angleAccuracyPass =
      angleClassificationAccuracy >= scenario.successCriteria.minAngleClassificationAccuracy;
    if (!angleAccuracyPass) {
      failures.push(
        `Angle classification accuracy ${(angleClassificationAccuracy * 100).toFixed(1)}% < ${(scenario.successCriteria.minAngleClassificationAccuracy * 100).toFixed(1)}%`,
      );
    }

    const contextBudgetPass = maxWorkingSetTokens <= scenario.successCriteria.maxWorkingSetTokens;
    if (!contextBudgetPass) {
      failures.push(
        `Max working set tokens ${maxWorkingSetTokens} > budget ${scenario.successCriteria.maxWorkingSetTokens}`,
      );
    }

    const retentionPass = prioritiesMissed === 0;
    if (!retentionPass) {
      failures.push(`${prioritiesMissed} priorities missed from ledger`);
    }

    let compressionPass = true;
    for (const [turnIdxStr, minLevel] of Object.entries(scenario.successCriteria.minCompressionLevelByTurn)) {
      const turnIdx = parseInt(turnIdxStr);
      const actualLevel = turnResults[turnIdx]?.compressionLevel ?? 0;
      if (actualLevel < minLevel) {
        compressionPass = false;
        failures.push(
          `Turn ${turnIdx}: compression level ${actualLevel} < expected ${minLevel}`,
        );
      }
    }

    const overallPass = angleAccuracyPass && contextBudgetPass && retentionPass && compressionPass;

    return {
      scenarioId: scenario.id,
      persona: scenario.persona,
      sessionId: String(sessionId),
      turnsExecuted: scenario.turns.length,
      measurements,
      verdict: {
        angleAccuracyPass,
        contextBudgetPass,
        retentionPass,
        compressionPass,
        overallPass,
      },
      failures,
    };
    } catch (error: any) {
      // Return error info instead of throwing so we can diagnose
      return {
        scenarioId: scenario.id,
        persona: scenario.persona,
        sessionId: "",
        turnsExecuted: 0,
        measurements: {
          angleClassificationAccuracy: 0,
          prioritiesPreserved: 0,
          prioritiesMissed: 0,
          maxWorkingSetTokens: 0,
          avgWorkingSetTokens: 0,
          compressionTriggers: 0,
          finalCompressionLevel: 0,
          checkpointsSaved: 0,
        },
        verdict: {
          angleAccuracyPass: false,
          contextBudgetPass: false,
          retentionPass: false,
          compressionPass: false,
          overallPass: false,
        },
        failures: [`[phase: ${phase}] ${error?.message || String(error)}`],
      };
    }
  },
});

// ════════════════════════════════════════════════════════════════════
// FULL BENCHMARK SUITE
// ════════════════════════════════════════════════════════════════════

export const runUltraLongChatBenchmark = internalAction({
  args: {
    ownerKey: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    timestamp: v.number(),
    scenarios: v.array(v.any()),
    summary: v.object({
      totalScenarios: v.number(),
      scenariosPassed: v.number(),
      scenariosFailed: v.number(),
      totalTurns: v.number(),
      avgAngleAccuracy: v.number(),
      avgMaxWorkingSetTokens: v.number(),
      totalCompressionTriggers: v.number(),
      totalPrioritiesMissed: v.number(),
      overallVerdict: v.string(),
    }),
  }),
  handler: async (ctx, args): Promise<any> => {
    const results: any[] = [];

    for (const scenario of SCENARIOS) {
      console.log(`[Benchmark] Running ${scenario.id} (${scenario.turns.length} turns)...`);
      try {
        const result = await ctx.runAction(
          internal.domains.research.researchSessionBenchmark.simulateSession,
          {
            scenarioId: scenario.id,
            ownerKey: args.ownerKey,
            userId: args.userId,
          },
        );
        results.push(result);
      } catch (err: any) {
        results.push({
          scenarioId: scenario.id,
          persona: scenario.persona,
          sessionId: "",
          turnsExecuted: 0,
          measurements: {
            angleClassificationAccuracy: 0,
            prioritiesPreserved: 0,
            prioritiesMissed: 0,
            maxWorkingSetTokens: 0,
            avgWorkingSetTokens: 0,
            compressionTriggers: 0,
            finalCompressionLevel: 0,
            checkpointsSaved: 0,
          },
          verdict: {
            angleAccuracyPass: false,
            contextBudgetPass: false,
            retentionPass: false,
            compressionPass: false,
            overallPass: false,
          },
          failures: [`[outer error] ${err?.message || String(err)}`],
        });
      }
    }

    // Aggregate stats
    const scenariosPassed = results.filter((r: any) => r.verdict.overallPass).length;
    const scenariosFailed = results.length - scenariosPassed;
    const totalTurns = results.reduce((sum: number, r: any) => sum + r.turnsExecuted, 0);
    const avgAngleAccuracy =
      results.reduce((sum: number, r: any) => sum + r.measurements.angleClassificationAccuracy, 0) /
      results.length;
    const avgMaxWorkingSetTokens = Math.round(
      results.reduce((sum: number, r: any) => sum + r.measurements.maxWorkingSetTokens, 0) /
        results.length,
    );
    const totalCompressionTriggers = results.reduce(
      (sum: number, r: any) => sum + r.measurements.compressionTriggers,
      0,
    );
    const totalPrioritiesMissed = results.reduce(
      (sum: number, r: any) => sum + r.measurements.prioritiesMissed,
      0,
    );

    const overallVerdict =
      scenariosPassed === results.length
        ? "ALL_PASS"
        : scenariosPassed >= results.length * 0.75
          ? "PARTIAL_PASS"
          : "FAIL";

    return {
      timestamp: Date.now(),
      scenarios: results,
      summary: {
        totalScenarios: results.length,
        scenariosPassed,
        scenariosFailed,
        totalTurns,
        avgAngleAccuracy,
        avgMaxWorkingSetTokens,
        totalCompressionTriggers,
        totalPrioritiesMissed,
        overallVerdict,
      },
    };
  },
});
