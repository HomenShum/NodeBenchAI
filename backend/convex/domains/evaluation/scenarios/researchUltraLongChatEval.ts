import { v } from "convex/values";
import { action } from "../../../_generated/server";
import {
  buildUltraLongChatWorkingSet,
  renderUltraLongChatWorkingSetMarkdown,
  shouldLoadDailyBriefForWorkingSet,
  shouldLoadUserContextForWorkingSet,
  type EntityFastLaneCache,
  type UltraLongChatMessage,
  type UltraLongChatWorkingSet,
} from "../../../../shared/ultraLongChatContext";

type AngleId = UltraLongChatWorkingSet["activeAngles"][number];

type ChatTurn = {
  turn: number;
  userMessage: string;
  expectedAngles: AngleId[];
  expectedNewData: boolean;
  maxTokensEstimate: number;
};

type TurnResult = {
  turn: number;
  anglesLoaded: string[];
  newDataFetched: boolean;
  estimatedTokens: number;
  contextPreserved: boolean;
  relevanceScore: number;
};

const ENTITY_CACHE: EntityFastLaneCache = {
  entity: {
    slug: "stripe",
    name: "Stripe",
    entityType: "company",
    summary:
      "Stripe builds payments, revenue automation, and finance tooling for internet businesses.",
    updatedAt: Date.now(),
  },
  acceptedBlocks: [
    {
      kind: "summary",
      authorKind: "user",
      text: "Stripe keeps expanding from payments into billing, revenue automation, and embedded finance tooling.",
      updatedAt: Date.now(),
    },
    {
      kind: "interview-notes",
      authorKind: "agent",
      text: "CFO and finance org questions usually map to margins, monetization durability, and enterprise go-to-market motion.",
      updatedAt: Date.now(),
    },
  ],
  latestProjections: [
    {
      blockType: "competitive",
      title: "Competitive posture",
      summary: "Strong payments distribution, but faces overlap with Adyen, Block, and platform-first finance suites.",
      overallTier: "high",
      updatedAt: Date.now(),
    },
  ],
  latestPulse: {
    summary: "Recent signals emphasize finance automation, revenue tooling, and platform expansion.",
    body: "Finance automation and revenue tooling are the active narrative shifts in recent Stripe discussion.",
    updatedAt: Date.now(),
  },
  memory: {
    indexJson: "{\"topics\":[\"payments\",\"billing\",\"revenue automation\"]}",
    topicCount: 3,
    totalFactCount: 12,
    lastRebuildAt: Date.now(),
  },
  latestRun: {
    goal: "Prepare for Stripe PM interview and offer negotiation",
    status: "completed",
    startedAt: Date.now() - 60_000,
  },
};

const KNOWN_STATE = [
  "[KNOWN ENTITY STATE]",
  "- Stripe is already in the artifact cache.",
  "- Prior discussion emphasized finance tooling expansion and competitive overlap with Adyen and Block.",
].join("\n");

const USER_CONTEXT = [
  "Today's calendar events: 3",
  "Event highlights: Stripe recruiter sync | Final round prep | Offer review",
  "Today's tasks: 4",
  "Task highlights: Review compensation bands | Draft CFO questions | Compare Stripe vs Adyen notes",
].join("\n");

const DAILY_BRIEF = [
  "Daily brief 2026-04-23: Stripe PM interview preparation and offer decision support.",
  "Tracked tasks: 5",
  "Top headlines: Stripe expands finance tooling narrative | Adyen enterprise momentum persists",
].join("\n");

const ULTRA_LONG_CHAT_SCENARIO: ChatTurn[] = [
  {
    turn: 1,
    userMessage: "I'm interviewing at Stripe next week for a PM role.",
    expectedAngles: ["entity_profile", "people_graph", "public_signals"],
    expectedNewData: true,
    maxTokensEstimate: 2200,
  },
  {
    turn: 5,
    userMessage: "Tell me more about their recent pivot toward revenue and finance tools.",
    expectedAngles: ["narrative_tracking", "financial_health", "entity_profile"],
    expectedNewData: true,
    maxTokensEstimate: 2600,
  },
  {
    turn: 12,
    userMessage: "How do they compare to Block and Adyen right now?",
    expectedAngles: ["competitive_intelligence", "entity_profile", "market_dynamics"],
    expectedNewData: true,
    maxTokensEstimate: 2800,
  },
  {
    turn: 18,
    userMessage: "What should I ask the CFO in my final round?",
    expectedAngles: ["people_graph", "financial_health", "narrative_tracking"],
    expectedNewData: true,
    maxTokensEstimate: 2400,
  },
  {
    turn: 25,
    userMessage: "I got an offer. What should I negotiate, and what matters most to me here?",
    expectedAngles: ["financial_health", "market_dynamics", "people_graph"],
    expectedNewData: true,
    maxTokensEstimate: 2400,
  },
  {
    turn: 30,
    userMessage: "Remind me what I learned about Stripe's competitive position.",
    expectedAngles: ["competitive_intelligence"],
    expectedNewData: false,
    maxTokensEstimate: 1200,
  },
];

function contextRotScoreFromRisk(risk: UltraLongChatWorkingSet["contextRotRisk"]): number {
  if (risk === "low") return 100;
  if (risk === "medium") return 72;
  return 45;
}

function kitchenSinkTokenEstimate(messages: UltraLongChatMessage[]): number {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const payload = [KNOWN_STATE, USER_CONTEXT, DAILY_BRIEF, JSON.stringify(ENTITY_CACHE), transcript].join("\n\n");
  return Math.ceil(payload.length / 4);
}

function evaluateWorkingSetTurn(args: {
  turn: ChatTurn;
  messages: UltraLongChatMessage[];
  previousWorkingSet: UltraLongChatWorkingSet | null;
  loadedAngles: Set<AngleId>;
}): {
  workingSet: UltraLongChatWorkingSet;
  result: TurnResult;
  findings: string[];
  userContextLoaded: boolean;
  dailyBriefLoaded: boolean;
  newAngles: AngleId[];
} {
  const userContextLoaded = shouldLoadUserContextForWorkingSet(args.turn.userMessage, args.previousWorkingSet);
  const dailyBriefLoaded = shouldLoadDailyBriefForWorkingSet(args.turn.userMessage, args.previousWorkingSet);
  const workingSet = buildUltraLongChatWorkingSet({
    prompt: args.turn.userMessage,
    messages: args.messages,
    previousWorkingSet: args.previousWorkingSet,
    entitySlug: "stripe",
    entityFastLaneCache: ENTITY_CACHE,
    knownEntityStateMarkdown: KNOWN_STATE,
    userContext: userContextLoaded ? USER_CONTEXT : null,
    dailyBrief: dailyBriefLoaded ? DAILY_BRIEF : null,
  });
  const workingSetMarkdown = renderUltraLongChatWorkingSetMarkdown(workingSet);
  const estimatedTokens = Math.ceil(workingSetMarkdown.length / 4);
  const matchedAngles = args.turn.expectedAngles.filter((angleId) => workingSet.activeAngles.includes(angleId));
  const relevanceScore = Math.round((matchedAngles.length / args.turn.expectedAngles.length) * 100);
  const newAngles = workingSet.activeAngles.filter((angleId) => !args.loadedAngles.has(angleId));
  const newDataFetched = newAngles.length > 0 || userContextLoaded || dailyBriefLoaded;
  const contextPreserved =
    matchedAngles.length === args.turn.expectedAngles.length ||
    args.turn.expectedAngles.every((angleId) =>
      workingSet.angleCapsules.some((capsule) => capsule.angleId === angleId),
    );

  const findings: string[] = [];
  if (relevanceScore < 100) {
    findings.push(
      `Turn ${args.turn.turn}: expected [${args.turn.expectedAngles.join(", ")}] but got [${workingSet.activeAngles.join(", ")}]`,
    );
  }
  if (args.turn.expectedNewData && !newDataFetched) {
    findings.push(`Turn ${args.turn.turn}: expected JIT retrieval on pivot but reused stale context`);
  }
  if (!args.turn.expectedNewData && newDataFetched) {
    findings.push(`Turn ${args.turn.turn}: loaded new data when a recap should have reused cached context`);
  }
  if (!contextPreserved) {
    findings.push(`Turn ${args.turn.turn}: continuity regression, expected angle capsule was not preserved`);
  }
  if (estimatedTokens > args.turn.maxTokensEstimate) {
    findings.push(
      `Turn ${args.turn.turn}: working-set payload ${estimatedTokens} tokens exceeded budget ${args.turn.maxTokensEstimate}`,
    );
  }

  return {
    workingSet,
    result: {
      turn: args.turn.turn,
      anglesLoaded: [...workingSet.activeAngles],
      newDataFetched,
      estimatedTokens,
      contextPreserved,
      relevanceScore,
    },
    findings,
    userContextLoaded,
    dailyBriefLoaded,
    newAngles,
  };
}

export const evaluateUltraLongChatProgressiveDisclosure = action({
  args: {},
  returns: v.object({
    passed: v.boolean(),
    overallScore: v.number(),
    metrics: v.object({
      totalTurns: v.number(),
      totalTokensEstimated: v.number(),
      avgTokensPerTurn: v.number(),
      jitLoadsTriggered: v.number(),
      cacheHits: v.number(),
      contextRotScore: v.number(),
      angleSwitches: v.number(),
      tokenEfficiencyScore: v.number(),
      relevanceAccuracy: v.number(),
    }),
    turnResults: v.array(
      v.object({
        turn: v.number(),
        anglesLoaded: v.array(v.string()),
        newDataFetched: v.boolean(),
        estimatedTokens: v.number(),
        contextPreserved: v.boolean(),
        relevanceScore: v.number(),
      }),
    ),
    findings: v.array(v.string()),
  }),
  handler: async () => {
    const findings: string[] = [];
    const turnResults: TurnResult[] = [];
    const messages: UltraLongChatMessage[] = [];
    const loadedAngles = new Set<AngleId>();
    let previousWorkingSet: UltraLongChatWorkingSet | null = null;
    let totalTokensEstimated = 0;
    let kitchenSinkTokens = 0;
    let jitLoadsTriggered = 0;
    let cacheHits = 0;
    let angleSwitches = 0;
    let jitExpectationPasses = 0;
    let jitExpectationTotal = 0;
    let reuseExpectationPasses = 0;
    let reuseExpectationTotal = 0;
    let previousAngles: AngleId[] = [];

    for (const turn of ULTRA_LONG_CHAT_SCENARIO) {
      messages.push({ role: "user", content: turn.userMessage, createdAt: Date.now() + turn.turn });

      const evaluated = evaluateWorkingSetTurn({
        turn,
        messages,
        previousWorkingSet,
        loadedAngles,
      });

      turnResults.push(evaluated.result);
      findings.push(...evaluated.findings);
      totalTokensEstimated += evaluated.result.estimatedTokens;
      kitchenSinkTokens += kitchenSinkTokenEstimate(messages);

      if (evaluated.result.newDataFetched) {
        jitLoadsTriggered += 1;
      } else {
        cacheHits += 1;
      }

      if (turn.expectedNewData) {
        jitExpectationTotal += 1;
        if (evaluated.result.newDataFetched) {
          jitExpectationPasses += 1;
        }
      } else {
        reuseExpectationTotal += 1;
        if (!evaluated.result.newDataFetched) {
          reuseExpectationPasses += 1;
        }
      }

      const switched =
        previousAngles.length > 0 &&
        JSON.stringify(previousAngles) !== JSON.stringify(evaluated.workingSet.activeAngles);
      if (switched) {
        angleSwitches += 1;
      }

      evaluated.workingSet.activeAngles.forEach((angleId) => loadedAngles.add(angleId));
      previousAngles = [...evaluated.workingSet.activeAngles];
      previousWorkingSet = evaluated.workingSet;

      messages.push({
        role: "assistant",
        content: `Summary for turn ${turn.turn}: ${evaluated.workingSet.summary}`,
        createdAt: Date.now() + turn.turn + 1,
      });
    }

    const avgTokensPerTurn = Math.round(totalTokensEstimated / ULTRA_LONG_CHAT_SCENARIO.length);
    const tokenEfficiencyRatio = kitchenSinkTokens > 0 ? totalTokensEstimated / kitchenSinkTokens : 1;
    const tokenEfficiencyScore = Math.max(0, Math.round((1 - tokenEfficiencyRatio) * 140));
    const contextRotScore = previousWorkingSet ? contextRotScoreFromRisk(previousWorkingSet.contextRotRisk) : 0;
    const relevanceAccuracy = Math.round(
      turnResults.reduce((sum, result) => sum + result.relevanceScore, 0) / turnResults.length,
    );
    const jitCorrectness =
      jitExpectationTotal > 0
        ? Math.round((jitExpectationPasses / jitExpectationTotal) * 100)
        : 100;
    const cacheCorrectness =
      reuseExpectationTotal > 0
        ? Math.round((reuseExpectationPasses / reuseExpectationTotal) * 100)
        : 100;

    const overallScore = Math.round(
      relevanceAccuracy * 0.35 +
        contextRotScore * 0.25 +
        tokenEfficiencyScore * 0.2 +
        jitCorrectness * 0.1 +
        cacheCorrectness * 0.1,
    );

    return {
      passed:
        overallScore >= 80 &&
        contextRotScore >= 70 &&
        relevanceAccuracy >= 80 &&
        findings.length <= 3,
      overallScore,
      metrics: {
        totalTurns: ULTRA_LONG_CHAT_SCENARIO.length,
        totalTokensEstimated,
        avgTokensPerTurn,
        jitLoadsTriggered,
        cacheHits,
        contextRotScore,
        angleSwitches,
        tokenEfficiencyScore,
        relevanceAccuracy,
      },
      turnResults,
      findings,
    };
  },
});

export const compareProgressiveDisclosureVsKitchenSink = action({
  args: {},
  returns: v.object({
    progressiveDisclosure: v.object({
      totalTokens: v.number(),
      latencyMs: v.number(),
      contextRotRisk: v.string(),
    }),
    kitchenSink: v.object({
      totalTokens: v.number(),
      latencyMs: v.number(),
      contextRotRisk: v.string(),
    }),
    recommendation: v.string(),
  }),
  handler: async () => {
    const messages: UltraLongChatMessage[] = [];
    let previousWorkingSet: UltraLongChatWorkingSet | null = null;
    let progressiveTokens = 0;
    let kitchenSinkTokens = 0;

    for (const turn of ULTRA_LONG_CHAT_SCENARIO) {
      messages.push({ role: "user", content: turn.userMessage });
      const workingSet = buildUltraLongChatWorkingSet({
        prompt: turn.userMessage,
        messages,
        previousWorkingSet,
        entitySlug: "stripe",
        entityFastLaneCache: ENTITY_CACHE,
        knownEntityStateMarkdown: KNOWN_STATE,
        userContext: shouldLoadUserContextForWorkingSet(turn.userMessage, previousWorkingSet) ? USER_CONTEXT : null,
        dailyBrief: shouldLoadDailyBriefForWorkingSet(turn.userMessage, previousWorkingSet) ? DAILY_BRIEF : null,
      });
      progressiveTokens += Math.ceil(renderUltraLongChatWorkingSetMarkdown(workingSet).length / 4);
      kitchenSinkTokens += kitchenSinkTokenEstimate(messages);
      previousWorkingSet = workingSet;
      messages.push({ role: "assistant", content: workingSet.summary });
    }

    const progressiveLatencyMs = Math.round(progressiveTokens * 0.6);
    const kitchenSinkLatencyMs = Math.round(kitchenSinkTokens * 0.9);

    return {
      progressiveDisclosure: {
        totalTokens: progressiveTokens,
        latencyMs: progressiveLatencyMs,
        contextRotRisk: previousWorkingSet?.contextRotRisk ?? "high",
      },
      kitchenSink: {
        totalTokens: kitchenSinkTokens,
        latencyMs: kitchenSinkLatencyMs,
        contextRotRisk: kitchenSinkTokens > progressiveTokens * 1.8 ? "high" : "medium",
      },
      recommendation:
        progressiveTokens < kitchenSinkTokens
          ? "Use compaction-first working sets with JIT hydration; kitchen-sink prompts waste tokens and increase context-rot risk."
          : "Progressive disclosure is not yet outperforming the kitchen-sink baseline; tighten compaction before shipping.",
    };
  },
});
