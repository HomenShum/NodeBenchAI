/**
 * Ultra-Long Chat Real-Path Evaluation
 *
 * Exercises the REAL `buildUltraLongChatWorkingSet` kernel
 * (shared/ultraLongChatContext.ts) across a 52-turn conversation with
 * 6 angle pivots, scoring:
 *
 * - Compaction activation (messagesCompacted > 0 by mid-session)
 * - Priority ledger persistence (early priorities survive to late turns)
 * - Angle relevance per turn (correct active angles for each pivot)
 * - Context rot risk (stays ≤ medium across full session)
 * - Advisor/executor routing (Kimi K2.6 advisor, approved lite executors)
 *
 * Industry pattern sources (Apr 2026):
 * - Claude Code subagents: separate contexts, bounded tool access, MCP inheritance
 * - Kimi K2.6: advisor/orchestrator ($0.75/M in, 262K ctx)
 * - MiniMax M2.7: bounded executor fallback ($0.30/M in, 197K ctx)
 * - Gemini 3.1 Flash Lite / Gemini 3 Flash: primary cheap executors ($0.25 / $0.50 in, 1M ctx)
 * - LangGraph: thread-based checkpointing + state persistence
 * - DeerFlow / Hermes: aggressive summarization + isolated specialist contexts
 *
 * Success criteria: overall score ≥ 100.
 */

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import {
  buildUltraLongChatWorkingSet,
  shouldLoadDailyBriefForWorkingSet,
  shouldLoadUserContextForWorkingSet,
  type EntityFastLaneCache,
  type UltraLongChatMessage,
  type UltraLongChatWorkingSet,
} from "../../../../shared/ultraLongChatContext";
import {
  NODEBENCH_ADVISOR_MODEL,
  NODEBENCH_EXECUTOR_MODELS,
  type ApprovedModel,
} from "../../agents/mcp_tools/models/modelResolver";
import { chooseNodeBenchRuntimeRoute } from "../../agents/runtimeRouting";

// ═══════════════════════════════════════════════════════════════════════════
// 52-TURN CONVERSATION SCENARIO (job prep → offer → role pivot → new topic)
// ═══════════════════════════════════════════════════════════════════════════

type ScenarioTurn = {
  turn: number;
  role: "user" | "assistant";
  content: string;
  expectAngles?: string[];      // Assertions applied only on user turns
  expectRotAtMost?: "low" | "medium" | "high";
};

const SCENARIO: ScenarioTurn[] = [
  // Turn 1: interview keyword activates multiple angles (people_graph, financial_health) → rot=medium is correct
  { turn: 1, role: "user", content: "I need your help prepping for my Stripe PM interview next Thursday. I want to nail it.", expectAngles: ["entity_profile"], expectRotAtMost: "medium" },
  { turn: 2, role: "assistant", content: "Got it. Let me start with Stripe's recent positioning and what's top-of-mind for the PM org." },
  { turn: 3, role: "user", content: "What's their current product focus? Give me the overview of what they are building." },
  { turn: 4, role: "assistant", content: "Stripe has been expanding beyond payments into revenue and finance automation." },
  { turn: 5, role: "user", content: "Tell me more about their recent pivot — I want the latest public signals from this week, not stale news.", expectAngles: ["public_signals"] },
  { turn: 6, role: "assistant", content: "Here are this week's narrative signals for Stripe." },
  { turn: 7, role: "user", content: "I need to understand their competitive position. Compare them vs Adyen and Square.", expectAngles: ["competitive_intelligence"] },
  { turn: 8, role: "assistant", content: "Comparing across payments depth, platform breadth, and developer experience." },
  { turn: 9, role: "user", content: "What funding rounds have they done and what's their valuation trajectory?" },
  { turn: 10, role: "assistant", content: "Stripe's funding history and implied valuation momentum." },
  { turn: 11, role: "user", content: "Who are the key people I should know for this interview? The hiring manager and above.", expectAngles: ["people_graph"] },
  { turn: 12, role: "assistant", content: "Key org lines + decision-makers in the PM track." },
  { turn: 13, role: "user", content: "What is their current narrative in the press this week?" },
  { turn: 14, role: "assistant", content: "Narrative tracking update for Stripe this week." },
  { turn: 15, role: "user", content: "Help me prepare talking points for the product loop interview." },
  { turn: 16, role: "assistant", content: "Talking points tuned to Stripe's current focus." },
  { turn: 17, role: "user", content: "Give me an executive brief I can skim before the phone screen.", expectAngles: ["executive_brief"], expectRotAtMost: "medium" },
  { turn: 18, role: "assistant", content: "One-page exec brief, ready for the screen." },
  { turn: 19, role: "user", content: "What are the biggest risks I should flag if asked about Stripe's strategy?" },
  { turn: 20, role: "assistant", content: "Strategic risks: ACH dependence, regulatory surface, platform sprawl." },
  { turn: 21, role: "user", content: "What is their financial health? Revenue, burn, margin trajectory." },
  { turn: 22, role: "assistant", content: "Financial health picture: top line growth, unit economics, reinvestment." },
  { turn: 23, role: "user", content: "What should I ask the CFO in the final round about capital strategy?" },
  { turn: 24, role: "assistant", content: "Final-round CFO questions focused on capital and leverage." },
  { turn: 25, role: "user", content: "I got the offer! Now help me negotiate — what should I negotiate on?", expectAngles: ["people_graph"] },
  { turn: 26, role: "assistant", content: "Negotiation vectors: base, equity refresh, sign-on, scope ladder." },
  { turn: 27, role: "user", content: "My priority is equity and ramp-time. I care about long-term upside more than base." },
  { turn: 28, role: "assistant", content: "Noted priority: equity upside and ramp. Structuring counter around that." },
  { turn: 29, role: "user", content: "What's the market rate for a senior PM at a fintech at this scale?" },
  { turn: 30, role: "assistant", content: "Market comp bands for senior PM at late-stage fintech." },
  { turn: 31, role: "user", content: "Remind me what I learned about their competitive position earlier. I do not want to re-research it.", expectAngles: ["competitive_intelligence"] },
  { turn: 32, role: "assistant", content: "Recalling prior competitive intelligence from turn 7 — keeping it from the working set, not re-fetching." },
  { turn: 33, role: "user", content: "What changed in their competitive position this week? Latest signals only." },
  { turn: 34, role: "assistant", content: "Only this week's delta — not full re-run." },
  { turn: 35, role: "user", content: "OK switching gears — I also want to track Anthropic as a potential next move after Stripe." },
  { turn: 36, role: "assistant", content: "Spinning up a parallel research anchor on Anthropic." },
  { turn: 37, role: "user", content: "What's the latest at Anthropic this week?", expectAngles: ["public_signals"] },
  { turn: 38, role: "assistant", content: "Anthropic weekly signals." },
  { turn: 39, role: "user", content: "How do Anthropic and OpenAI compare on enterprise product maturity?", expectAngles: ["competitive_intelligence"] },
  { turn: 40, role: "assistant", content: "Enterprise maturity comparison: sales motion, onboarding, platform depth." },
  { turn: 41, role: "user", content: "Give me a brief on both — digest format.", expectAngles: ["daily_brief"] },
  { turn: 42, role: "assistant", content: "Combined digest, ranked by signal strength." },
  { turn: 43, role: "user", content: "Back to Stripe for a moment — what was I told to negotiate on? I want to make sure I did not drop anything." },
  { turn: 44, role: "assistant", content: "Replaying the earlier Stripe negotiation vectors from the priority ledger — no re-research needed." },
  { turn: 45, role: "user", content: "What about Stripe's leadership changes in the last 90 days?" },
  { turn: 46, role: "assistant", content: "Leadership change delta for the last 90 days." },
  { turn: 47, role: "user", content: "Is there anything today on either Stripe or Anthropic I should care about as a candidate?", expectRotAtMost: "medium" },
  { turn: 48, role: "assistant", content: "Today's candidate-relevant signal across both anchors." },
  { turn: 49, role: "user", content: "Remind me — what are my priorities for this whole job search? The ones I told you earlier." },
  { turn: 50, role: "assistant", content: "Priority ledger snapshot: equity upside, ramp, long-term over base." },
  { turn: 51, role: "user", content: "Give me the final executive brief before I sign.", expectAngles: ["executive_brief"], expectRotAtMost: "medium" },
  { turn: 52, role: "assistant", content: "Final signing brief consolidating everything since turn 1." },
];

// ═══════════════════════════════════════════════════════════════════════════
// REAL ENTITY CACHE (used by the working-set builder for angle capsules)
// ═══════════════════════════════════════════════════════════════════════════

const STRIPE_CACHE: EntityFastLaneCache = {
  entity: {
    slug: "stripe",
    name: "Stripe",
    entityType: "company",
    summary: "Payments + revenue & finance automation platform.",
    updatedAt: Date.now(),
  },
  acceptedBlocks: [
    { kind: "overview", authorKind: "user", text: "Stripe is a fintech infrastructure platform with recent moves into revenue automation and finance tooling.", updatedAt: Date.now() },
    { kind: "strategy", authorKind: "user", text: "Strategic focus on SMB+enterprise bundles and expanding platform breadth vs payments depth.", updatedAt: Date.now() },
  ],
  latestProjections: [
    { blockType: "competitive", title: "Stripe vs Adyen vs Square", summary: "Stripe leads on developer experience, Adyen on enterprise scale, Square on SMB retail.", overallTier: "T1", updatedAt: Date.now() },
    { blockType: "funding", title: "Recent round + implied valuation", summary: "Secondary tender with strong implied valuation trajectory.", overallTier: "T2", updatedAt: Date.now() },
  ],
  latestPulse: {
    summary: "This week Stripe shipped new Revenue and Finance Automation surface, reinforcing the post-payments narrative.",
    body: "The latest narrative frames Stripe less as a payments company and more as a revenue operating system.",
    updatedAt: Date.now(),
  },
  memory: {
    indexJson: "stripe:index:overview+strategy+competitive+funding+people",
    topicCount: 5,
    totalFactCount: 38,
    lastRebuildAt: Date.now(),
  },
  latestRun: { goal: "Stripe interview prep", status: "active", startedAt: Date.now() - 86_400_000 },
};

const USER_CONTEXT = [
  "Today's tasks: interview prep for Stripe PM loop, draft counter for offer",
  "Today's calendar: 3pm product loop, 5pm CFO panel",
  "Tracked topics: Stripe, Anthropic, fintech comp bands",
  "Priority: equity upside and ramp over base comp",
].join("\n");

const DAILY_BRIEF = [
  "Stripe this week: Revenue & Finance Automation surface launched",
  "Anthropic this week: enterprise product maturity continues to compound",
  "Fintech comp: late-stage senior PM bands trending up on equity refresh",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING MATRIX (advisor/executor split, Apr 2026)
// ═══════════════════════════════════════════════════════════════════════════

type RoutingDecision = {
  turn: number;
  profile: "advisor" | "executor";
  requested: string;
  resolved: ApprovedModel;
  costPerMInput: number;
};

const MODEL_COST_IN: Record<string, number> = {
  "kimi-k2.6": 0.75,
  "gemini-3.1-flash-lite-preview": 0.25,
  "gpt-5.4-mini": 0.75,
  "minimax-m2.7": 0.30,
  "gemini-3-flash-preview": 0.50,
  "gpt-5.4-nano": 0.20,
};

// ═══════════════════════════════════════════════════════════════════════════
// ACTION
// ═══════════════════════════════════════════════════════════════════════════

export const evaluateUltraLongChatRealPath = action({
  args: {
    hotWindow: v.optional(v.number()),
  },
  returns: v.object({
    passed: v.boolean(),
    overallScore: v.number(),
    subscores: v.object({
      compactionActive: v.number(),
      priorityLedgerPersistence: v.number(),
      angleRelevance: v.number(),
      contextRotControl: v.number(),
      advisorExecutorRouting: v.number(),
      jitRetrievalDiscipline: v.number(),
      kitchenSinkSavingsBonus: v.number(),
    }),
    kernel: v.object({
      turns: v.number(),
      finalActiveAngles: v.array(v.string()),
      finalRotRisk: v.string(),
      finalMessagesCompacted: v.number(),
      finalPriorityLedgerLen: v.number(),
      finalJitSliceCount: v.number(),
      finalAngleCapsuleCount: v.number(),
      finalHotWindowLen: v.number(),
    }),
    routing: v.object({
      advisorModel: v.string(),
      executorSamples: v.array(v.string()),
      kitchenSinkInputCostPerM: v.number(),
      realPathInputCostPerM: v.number(),
      savingsPercent: v.number(),
    }),
    findings: v.array(v.string()),
    assertionFailures: v.array(v.string()),
  }),

  handler: async (_ctx, args) => {
    const hotWindowSize = args.hotWindow ?? 10;
    const messages: UltraLongChatMessage[] = [];
    let previous: UltraLongChatWorkingSet | null = null;
    const findings: string[] = [];
    const assertionFailures: string[] = [];
    const routingLog: RoutingDecision[] = [];

    // Track priority ledger survival: we expect equity/ramp priority from turn 27
    // to still be present when user asks for a reminder at turn 49.
    let turn27PriorityPhraseSeen = false;

    // Angle correctness scoring: count of user turns where the kernel activated
    // at least one of the expected angles.
    let userTurnsWithAssertions = 0;
    let userTurnsWithAssertionsPassed = 0;

    // Context rot bound counters
    let rotBoundPass = 0;
    let rotBoundTotal = 0;

    // JIT discipline: count of user turns where the kernel produced at least
    // one jit slice OR an angle capsule (something was disclosed just-in-time).
    let userTurnsJitActive = 0;

    for (const entry of SCENARIO) {
      messages.push({ role: entry.role, content: entry.content, createdAt: Date.now() });

      // Only user turns trigger a rebuild of the working set (matches runtime).
      if (entry.role !== "user") continue;

      const entityAnchor = entry.turn <= 34 || entry.turn >= 43 ? "stripe" : "anthropic";

      const loadUserContext = shouldLoadUserContextForWorkingSet(entry.content, previous);
      const loadDailyBrief = shouldLoadDailyBriefForWorkingSet(entry.content, previous);

      const workingSet = buildUltraLongChatWorkingSet({
        prompt: entry.content,
        messages,
        previousWorkingSet: previous,
        entitySlug: entityAnchor,
        entityFastLaneCache: entityAnchor === "stripe" ? STRIPE_CACHE : undefined,
        knownEntityStateMarkdown: entityAnchor === "stripe" ? "Stripe: payments + rev/fin automation; SMB+enterprise bundles." : undefined,
        userContext: loadUserContext ? USER_CONTEXT : null,
        dailyBrief: loadDailyBrief ? DAILY_BRIEF : null,
        maxHotWindowMessages: hotWindowSize,
      });

      // Advisor/executor routing for this turn: first user turn + "remind me"
      // turns run as advisor (Kimi K2.6). Everything else is executor.
      const route = chooseNodeBenchRuntimeRoute({
        prompt: entry.content,
        requestedModel: undefined,
        useCoordinator: true,
        isAnonymous: false,
        hasOpenRouter: true,
        workingSet,
      });
      routingLog.push({
        turn: entry.turn,
        profile: route.profile === "background" ? "advisor" : route.profile,
        requested: route.model,
        resolved: route.model,
        costPerMInput: MODEL_COST_IN[route.model] ?? 0,
      });

      // Assertions
      if (entry.expectAngles && entry.expectAngles.length > 0) {
        userTurnsWithAssertions += 1;
        const hit = entry.expectAngles.some((expected) => workingSet.activeAngles.includes(expected as any));
        if (hit) {
          userTurnsWithAssertionsPassed += 1;
        } else {
          assertionFailures.push(
            `turn ${entry.turn}: expected one of [${entry.expectAngles.join(", ")}] but got [${workingSet.activeAngles.join(", ")}]`,
          );
        }
      }

      if (entry.expectRotAtMost) {
        rotBoundTotal += 1;
        const order = { low: 0, medium: 1, high: 2 } as const;
        const ok = order[workingSet.contextRotRisk] <= order[entry.expectRotAtMost];
        if (ok) rotBoundPass += 1;
        else assertionFailures.push(
          `turn ${entry.turn}: contextRotRisk=${workingSet.contextRotRisk} exceeded bound=${entry.expectRotAtMost}`,
        );
      }

      if (workingSet.jitSlices.length > 0 || workingSet.angleCapsules.length > 0) {
        userTurnsJitActive += 1;
      }

      // Detect priority-ledger persistence signal (equity/ramp phrase from t27).
      if (entry.turn === 27 && /equity|ramp/i.test(workingSet.priorityLedger.join(" | "))) {
        turn27PriorityPhraseSeen = true;
      }

      // Key finding logs for later turns.
      if (entry.turn === 31) {
        findings.push(
          `turn 31 (recall competitive): messagesCompacted=${workingSet.messagesCompacted}, activeAngles=[${workingSet.activeAngles.join(", ")}], rot=${workingSet.contextRotRisk}`,
        );
      }
      if (entry.turn === 49) {
        findings.push(
          `turn 49 (priority recall): priorityLedger=[${workingSet.priorityLedger.slice(0, 3).join(" | ")}]`,
        );
      }
      if (entry.turn === 51) {
        findings.push(
          `turn 51 (final brief): rot=${workingSet.contextRotRisk}, compacted=${workingSet.messagesCompacted}, capsules=${workingSet.angleCapsules.length}`,
        );
      }

      previous = workingSet;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Scoring (target ≥ 100)
    // ─────────────────────────────────────────────────────────────────────
    const final = previous!;

    // 1. Compaction active (compaction kicked in before final turn)
    const compactionActive = final.messagesCompacted > 0 ? 18 : 0;

    // 2. Priority ledger persistence
    const priorityLedgerHasPriority =
      final.priorityLedger.some((line) => /equity|ramp|priority|care/i.test(line));
    const priorityLedgerPersistence =
      (turn27PriorityPhraseSeen ? 6 : 0) +
      (priorityLedgerHasPriority ? 12 : 0);

    // 3. Angle relevance (ratio of asserted user turns that hit expected angles)
    const angleRelevance = userTurnsWithAssertions === 0
      ? 18
      : Math.round((userTurnsWithAssertionsPassed / userTurnsWithAssertions) * 18);

    // 4. Context rot control
    const contextRotControl =
      rotBoundTotal === 0
        ? 15
        : Math.round((rotBoundPass / rotBoundTotal) * 15);

    // 5. Advisor/executor routing
    const advisorUsesKimi = routingLog
      .filter((r) => r.profile === "advisor")
      .every((r) => r.resolved === NODEBENCH_ADVISOR_MODEL);
    const executorUsesApproved = routingLog
      .filter((r) => r.profile === "executor")
      .every((r) => NODEBENCH_EXECUTOR_MODELS.includes(r.resolved));
    const advisorExecutorRouting =
      (advisorUsesKimi ? 10 : 0) + (executorUsesApproved ? 10 : 0);

    // 6. JIT retrieval discipline (fraction of user turns with any disclosure)
    const totalUserTurns = routingLog.length;
    const jitRetrievalDiscipline = totalUserTurns === 0
      ? 0
      : Math.round((userTurnsJitActive / totalUserTurns) * 15);

    // 7. Kitchen-sink savings bonus (target: ≥ 60% savings → 14 pts bonus)
    // Kitchen sink: assume every turn pays advisor-class cost ($0.75/M input).
    // Real path: advisor only when needed, executor otherwise.
    const kitchenSinkCost = totalUserTurns * 0.75;
    const realCost = routingLog.reduce((acc, r) => acc + r.costPerMInput, 0);
    const savingsPercent =
      kitchenSinkCost > 0
        ? Math.round(((kitchenSinkCost - realCost) / kitchenSinkCost) * 100)
        : 0;
    const kitchenSinkSavingsBonus =
      savingsPercent >= 60 ? 14 : savingsPercent >= 40 ? 8 : savingsPercent >= 20 ? 4 : 0;

    const overallScore =
      compactionActive +
      priorityLedgerPersistence +
      angleRelevance +
      contextRotControl +
      advisorExecutorRouting +
      jitRetrievalDiscipline +
      kitchenSinkSavingsBonus;

    findings.push(
      `Scoring: compaction=${compactionActive}, ledger=${priorityLedgerPersistence}, angles=${angleRelevance}, rot=${contextRotControl}, routing=${advisorExecutorRouting}, jit=${jitRetrievalDiscipline}, savingsBonus=${kitchenSinkSavingsBonus}`,
    );

    return {
      passed: overallScore >= 100 && assertionFailures.length === 0,
      overallScore,
      subscores: {
        compactionActive,
        priorityLedgerPersistence,
        angleRelevance,
        contextRotControl,
        advisorExecutorRouting,
        jitRetrievalDiscipline,
        kitchenSinkSavingsBonus,
      },
      kernel: {
        turns: SCENARIO.length,
        finalActiveAngles: [...final.activeAngles],
        finalRotRisk: final.contextRotRisk,
        finalMessagesCompacted: final.messagesCompacted,
        finalPriorityLedgerLen: final.priorityLedger.length,
        finalJitSliceCount: final.jitSlices.length,
        finalAngleCapsuleCount: final.angleCapsules.length,
        finalHotWindowLen: final.hotWindow.length,
      },
      routing: {
        advisorModel: NODEBENCH_ADVISOR_MODEL,
        executorSamples: routingLog.filter((r) => r.profile === "executor").slice(0, 5).map((r) => r.resolved),
        kitchenSinkInputCostPerM: Math.round(kitchenSinkCost * 100) / 100,
        realPathInputCostPerM: Math.round(realCost * 100) / 100,
        savingsPercent,
      },
      findings,
      assertionFailures,
    };
  },
});
