/**
 * Ultra-Long Chat Evaluation Scenarios (Versioned Dataset)
 *
 * Each scenario is a multi-turn conversation with:
 * - Turn-by-turn user messages
 * - Per-turn criteria that should be scored
 * - Forbidden behaviors (hallucination, re-fetching, forgetting)
 * - Ground truth recall expectations (what must be surfaced at turn N
 *   based on content from turn M < N)
 *
 * Versioning: Any change to a scenario's content bumps `version`.
 * Aggregates and regression gates compare only across the same version.
 */

// Pure-JS djb2 hash (avoids node:crypto bundling issues in Convex runtime)
function shortHash(input: string): string {
  let hash = 5381n;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5n) + hash) ^ BigInt(input.charCodeAt(i));
    hash = hash & 0xFFFFFFFFFFFFFFFFn; // 64-bit mask
  }
  return hash.toString(16).padStart(16, "0").slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type JudgeCriterion =
  | "rememberedPriorContext"
  | "didNotReFetchStaleData"
  | "prioritiesSurfacedWhenAsked"
  | "noHallucinatedClaims"
  | "appropriateAngleActivation"
  | "stayedOnTopic";

export const ALL_CRITERIA: JudgeCriterion[] = [
  "rememberedPriorContext",
  "didNotReFetchStaleData",
  "prioritiesSurfacedWhenAsked",
  "noHallucinatedClaims",
  "appropriateAngleActivation",
  "stayedOnTopic",
];

export interface ScenarioTurn {
  turnNumber: number;                // 1-indexed
  userMessage: string;
  criteria: JudgeCriterion[];        // Criteria scored on this turn
  groundTruthRecall?: {
    fromTurn: number;                // Content that MUST be recalled
    phrase: string;                  // Phrase/concept expected in response
  };
  forbiddenBehaviors?: string[];     // Short phrases judge checks against
  expectedAngleHints?: string[];     // Angles the response should reflect
  maxLatencyMs?: number;
}

export interface UltraLongChatScenario {
  id: string;                        // Stable scenario ID
  version: number;                   // Monotonic version number
  contentHash: string;               // sha256 of turns payload
  title: string;
  description: string;
  primaryEntity: string;
  secondaryEntity?: string;
  totalTurns: number;
  turns: ScenarioTurn[];
  successThreshold: number;          // Fraction of turns that must pass to mark scenario passing (e.g., 0.8)
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scenario 1: Interview Prep → Offer Negotiation → Role Pivot
 * The canonical 50+ turn career journey with priority recall.
 */
const SCENARIO_1_TURNS: Omit<ScenarioTurn, "turnNumber">[] = [
  { userMessage: "I'm interviewing at Stripe for a senior PM role. Get me prepped.", criteria: ["appropriateAngleActivation", "stayedOnTopic"], expectedAngleHints: ["entity_profile"] },
  { userMessage: "What's their product focus right now?", criteria: ["noHallucinatedClaims", "stayedOnTopic"], expectedAngleHints: ["entity_profile"] },
  { userMessage: "Any recent news? Focus on this month.", criteria: ["appropriateAngleActivation", "noHallucinatedClaims"], expectedAngleHints: ["public_signals"] },
  { userMessage: "Compare them to Adyen and Square — who has the edge?", criteria: ["appropriateAngleActivation", "noHallucinatedClaims"], expectedAngleHints: ["competitive_intelligence"] },
  { userMessage: "Tell me about their funding history.", criteria: ["noHallucinatedClaims"], expectedAngleHints: ["funding_intelligence"] },
  { userMessage: "Who are the senior PMs there? Give me names I should know.", criteria: ["noHallucinatedClaims"], expectedAngleHints: ["people_graph"] },
  { userMessage: "Remind me who their competitors are.", criteria: ["rememberedPriorContext", "didNotReFetchStaleData"], groundTruthRecall: { fromTurn: 4, phrase: "Adyen" } },
  { userMessage: "What risks should I flag in the interview?", criteria: ["stayedOnTopic"] },
  { userMessage: "My priorities for this job: equity upside, ramp time, long-term impact over base comp.", criteria: ["stayedOnTopic"], forbiddenBehaviors: ["dismiss the user's priority"] },
  { userMessage: "What would a senior PM at a fintech this size typically earn?", criteria: ["noHallucinatedClaims"] },
  { userMessage: "How should I negotiate equity specifically?", criteria: ["rememberedPriorContext"], groundTruthRecall: { fromTurn: 9, phrase: "equity" } },
  { userMessage: "I got an offer! Let me think through my response.", criteria: ["stayedOnTopic"] },
  { userMessage: "What did I say my priorities were again?", criteria: ["prioritiesSurfacedWhenAsked", "rememberedPriorContext"], groundTruthRecall: { fromTurn: 9, phrase: "equity" } },
  { userMessage: "Given those priorities, what should my counter look like?", criteria: ["rememberedPriorContext", "stayedOnTopic"] },
  { userMessage: "Now I also want to track Anthropic as a potential pivot. What's going on there?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["entity_profile", "public_signals"] },
  { userMessage: "How does Anthropic compare to OpenAI on enterprise readiness?", criteria: ["appropriateAngleActivation", "noHallucinatedClaims"], expectedAngleHints: ["competitive_intelligence"] },
  { userMessage: "Give me a combined brief on both Stripe and Anthropic.", criteria: ["rememberedPriorContext", "stayedOnTopic"] },
  { userMessage: "Going back to Stripe — what was the equity nuance in negotiation?", criteria: ["rememberedPriorContext", "didNotReFetchStaleData"], groundTruthRecall: { fromTurn: 11, phrase: "equity" } },
  { userMessage: "What specific questions should I ask Stripe's CFO in the final round?", criteria: ["stayedOnTopic"] },
  { userMessage: "One more: any leadership changes at Stripe in the past 90 days?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["narrative_tracking", "people_graph"] },
  { userMessage: "OK final brief before I sign — summarize everything that matters.", criteria: ["prioritiesSurfacedWhenAsked", "rememberedPriorContext", "stayedOnTopic"], groundTruthRecall: { fromTurn: 9, phrase: "equity" } },
];

/**
 * Scenario 2: Research Deep-Dive With Angle Pivots
 * Tests JIT disclosure across ~15 turns with sharp angle shifts.
 */
const SCENARIO_2_TURNS: Omit<ScenarioTurn, "turnNumber">[] = [
  { userMessage: "I'm researching OpenAI's enterprise strategy. Where should we start?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["entity_profile"] },
  { userMessage: "What's their latest enterprise product launch?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["public_signals"] },
  { userMessage: "How are enterprises actually using it in production?", criteria: ["noHallucinatedClaims", "stayedOnTopic"] },
  { userMessage: "Compare with Anthropic's enterprise traction.", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["competitive_intelligence"] },
  { userMessage: "What's the funding environment for AI infra competitors right now?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["funding_intelligence"] },
  { userMessage: "Who leads OpenAI's enterprise sales?", criteria: ["noHallucinatedClaims"], expectedAngleHints: ["people_graph"] },
  { userMessage: "Refresh me — what angle were we just on before funding?", criteria: ["rememberedPriorContext"], groundTruthRecall: { fromTurn: 4, phrase: "Anthropic" } },
  { userMessage: "What's the biggest risk to OpenAI's enterprise growth?", criteria: ["stayedOnTopic"] },
  { userMessage: "What changed in the narrative about them in the last 30 days?", criteria: ["appropriateAngleActivation"], expectedAngleHints: ["narrative_tracking"] },
  { userMessage: "Give me a one-pager: research summary so far.", criteria: ["rememberedPriorContext", "stayedOnTopic"], groundTruthRecall: { fromTurn: 4, phrase: "Anthropic" } },
  { userMessage: "Which angle has the weakest evidence so far?", criteria: ["rememberedPriorContext"] },
  { userMessage: "Let me pivot — how would this analysis look for a pharma co instead?", criteria: ["appropriateAngleActivation", "stayedOnTopic"] },
  { userMessage: "Actually back to OpenAI — what did I ask about their sales lead earlier?", criteria: ["rememberedPriorContext", "didNotReFetchStaleData"], groundTruthRecall: { fromTurn: 6, phrase: "enterprise sales" } },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function hashTurns(turns: ScenarioTurn[]): string {
  const payload = JSON.stringify(turns.map((t) => ({
    t: t.turnNumber,
    u: t.userMessage,
    c: t.criteria,
    g: t.groundTruthRecall ?? null,
    f: t.forbiddenBehaviors ?? [],
    a: t.expectedAngleHints ?? [],
  })));
  return shortHash(payload);
}

function numberTurns(
  rawTurns: Omit<ScenarioTurn, "turnNumber">[],
): ScenarioTurn[] {
  return rawTurns.map((turn, index) => ({ ...turn, turnNumber: index + 1 }));
}

function buildScenario(input: {
  id: string;
  version: number;
  title: string;
  description: string;
  primaryEntity: string;
  secondaryEntity?: string;
  rawTurns: Omit<ScenarioTurn, "turnNumber">[];
  successThreshold: number;
}): UltraLongChatScenario {
  const turns = numberTurns(input.rawTurns);
  return {
    id: input.id,
    version: input.version,
    contentHash: hashTurns(turns),
    title: input.title,
    description: input.description,
    primaryEntity: input.primaryEntity,
    secondaryEntity: input.secondaryEntity,
    totalTurns: turns.length,
    turns,
    successThreshold: input.successThreshold,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const ULTRA_LONG_CHAT_SCENARIOS: UltraLongChatScenario[] = [
  buildScenario({
    id: "ulc-001-career-journey",
    version: 1,
    title: "Career Journey: Stripe interview → offer → Anthropic pivot",
    description: "21-turn conversation testing priority persistence, angle pivots, and cross-entity recall.",
    primaryEntity: "Stripe",
    secondaryEntity: "Anthropic",
    rawTurns: SCENARIO_1_TURNS,
    successThreshold: 0.75,
  }),
  buildScenario({
    id: "ulc-002-enterprise-research",
    version: 1,
    title: "Enterprise Research Deep-Dive with Angle Pivots",
    description: "13-turn research conversation with sharp angle shifts and cross-turn recall.",
    primaryEntity: "OpenAI",
    secondaryEntity: "Anthropic",
    rawTurns: SCENARIO_2_TURNS,
    successThreshold: 0.75,
  }),
];

export function getScenarioById(id: string): UltraLongChatScenario | null {
  return ULTRA_LONG_CHAT_SCENARIOS.find((s) => s.id === id) ?? null;
}

export function listScenarioIds(): string[] {
  return ULTRA_LONG_CHAT_SCENARIOS.map((s) => s.id);
}

/**
 * Compute the current dataset digest — a single hash across all scenarios.
 * Useful for detecting dataset drift between runs.
 */
export function getDatasetDigest(): string {
  const payload = JSON.stringify(
    ULTRA_LONG_CHAT_SCENARIOS.map((s) => ({
      id: s.id,
      version: s.version,
      contentHash: s.contentHash,
    })),
  );
  return shortHash(payload);
}
