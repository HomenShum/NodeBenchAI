"use node";

/**
 * Ultra-Long Chat LLM-as-Judge
 *
 * Boolean-criteria judge for multi-turn agent responses. Scores each turn
 * against 6 criteria relevant to progressive disclosure and long-horizon
 * context fidelity:
 *
 *   1. rememberedPriorContext       — mentions required prior-turn content
 *   2. didNotReFetchStaleData       — no redundant retrieval for known data
 *   3. prioritiesSurfacedWhenAsked  — returns stored user priorities on demand
 *   4. noHallucinatedClaims         — no fabricated entities/metrics
 *   5. appropriateAngleActivation   — response reflects the right research angle
 *   6. stayedOnTopic                — response does not drift off-subject
 *
 * The judge model fallback chain matches the repo convention
 * (Kimi → GPT-5.4 → Sonnet → Gemini) so the judge lane never silently fails
 * when one provider is unavailable.
 */

import { generateText } from "ai";
import { getLanguageModelSafe } from "../../agents/mcp_tools/models";
import type { JudgeCriterion, ScenarioTurn } from "./scenarios";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface JudgeInput {
  scenarioTitle: string;
  primaryEntity: string;
  turn: ScenarioTurn;
  priorTurns: Array<{ role: "user" | "assistant"; content: string; turnNumber?: number }>;
  assistantResponse: string;
  toolsCalled: string[];
}

export interface CriterionVerdict {
  value: boolean;
  reason: string;
}

export interface JudgeVerdict {
  judgeModel: string;
  judgeLatencyMs: number;
  criteria: Record<JudgeCriterion, CriterionVerdict>;
  overallPassed: boolean;
  analysis: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL SELECTION (fallback chain matches existing llmJudge.ts convention)
// ═══════════════════════════════════════════════════════════════════════════

function pickJudgeModel(): string {
  const has = (key: string) => Boolean(process.env[key]);
  if (has("OPENROUTER_API_KEY")) return "kimi-k2.6";
  if (has("OPENAI_API_KEY")) return "gpt-5.4";
  if (has("ANTHROPIC_API_KEY")) return "claude-sonnet-4.6";
  if (
    has("GOOGLE_GENERATIVE_AI_API_KEY") ||
    has("GOOGLE_AI_API_KEY") ||
    has("GEMINI_API_KEY")
  ) {
    return "gemini-3.1-pro-preview";
  }
  return "kimi-k2.6";
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════

function buildJudgePrompt(input: JudgeInput): string {
  const priorContextBlock = input.priorTurns
    .slice(-16)
    .map((t) => `[${t.role}${t.turnNumber ? ` t${t.turnNumber}` : ""}] ${t.content.slice(0, 400)}`)
    .join("\n");

  const forbiddenBlock =
    input.turn.forbiddenBehaviors && input.turn.forbiddenBehaviors.length > 0
      ? `\nFORBIDDEN BEHAVIORS (response MUST NOT do these):\n${input.turn.forbiddenBehaviors.map((b) => `- ${b}`).join("\n")}`
      : "";

  const expectedAnglesBlock =
    input.turn.expectedAngleHints && input.turn.expectedAngleHints.length > 0
      ? `\nEXPECTED ANGLE HINTS: ${input.turn.expectedAngleHints.join(", ")}`
      : "";

  const recallBlock = input.turn.groundTruthRecall
    ? `\nGROUND TRUTH RECALL REQUIREMENT:
The response for this turn MUST surface content from turn ${input.turn.groundTruthRecall.fromTurn}
that covered the concept/phrase: "${input.turn.groundTruthRecall.phrase}".
If the response does not mention or reference that concept, "rememberedPriorContext"
and "prioritiesSurfacedWhenAsked" should be FALSE.`
    : "";

  return `You are a strict evaluator for a multi-turn conversational AI assistant.

SCENARIO: ${input.scenarioTitle}
PRIMARY ENTITY: ${input.primaryEntity}
CURRENT TURN: ${input.turn.turnNumber}
USER MESSAGE (current turn):
${input.turn.userMessage}

PRIOR CONVERSATION (most recent 16 turns):
${priorContextBlock || "(no prior turns)"}
${expectedAnglesBlock}
${recallBlock}
${forbiddenBlock}

TOOLS CALLED THIS TURN: ${input.toolsCalled.length > 0 ? input.toolsCalled.join(", ") : "none"}

ASSISTANT RESPONSE TO EVALUATE:
${input.assistantResponse.slice(0, 4000)}

Evaluate the assistant response against these 6 boolean criteria.
For each, return YES (true) or NO (false) with a ≤ 20 word reason.

1. rememberedPriorContext: Does the response correctly recall / build on relevant
   content from earlier turns (especially any ground truth recall requirement)?
   If there is no prior context to recall, answer YES by default.

2. didNotReFetchStaleData: Did the assistant avoid redundant tool calls for data
   that was already loaded or discussed earlier in the conversation?
   If no tools were needed, answer YES by default.

3. prioritiesSurfacedWhenAsked: When the user asks "what were my priorities"
   or similar, does the response surface the user's stored priorities from
   earlier turns? If the user did not ask for priorities, answer YES by default.

4. noHallucinatedClaims: Are all specific claims (names, numbers, dates,
   quotes) either grounded in the prior turns, tool outputs, or common
   knowledge about the primary entity? No fabricated statistics or sources?

5. appropriateAngleActivation: Does the response reflect the expected research
   angle(s) for this turn (e.g., competitive_intelligence, public_signals)?
   If no angle hints were provided, answer YES by default.

6. stayedOnTopic: Does the response stay on-topic with respect to the user's
   current turn and does it avoid unrelated tangents or forbidden behaviors?

Respond with ONLY this JSON shape (no markdown, no code fences):
{
  "rememberedPriorContext": { "value": true, "reason": "..." },
  "didNotReFetchStaleData": { "value": true, "reason": "..." },
  "prioritiesSurfacedWhenAsked": { "value": true, "reason": "..." },
  "noHallucinatedClaims": { "value": true, "reason": "..." },
  "appropriateAngleActivation": { "value": true, "reason": "..." },
  "stayedOnTopic": { "value": true, "reason": "..." },
  "analysis": "One sentence overall take."
}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// JUDGE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

function parseJudgeJson(text: string): Record<string, unknown> | null {
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(text.slice(jsonStart, end));
  } catch {
    return null;
  }
}

function readCriterion(
  parsed: Record<string, unknown> | null,
  key: string,
): CriterionVerdict {
  const raw = parsed?.[key];
  if (
    raw &&
    typeof raw === "object" &&
    "value" in raw &&
    typeof (raw as any).value === "boolean"
  ) {
    const entry = raw as { value: boolean; reason?: unknown };
    return {
      value: entry.value,
      reason:
        typeof entry.reason === "string" && entry.reason.length > 0
          ? entry.reason
          : "(no reason provided)",
    };
  }
  return { value: false, reason: "(criterion missing or malformed)" };
}

export async function judgeTurn(input: JudgeInput): Promise<JudgeVerdict> {
  const judgeModel = pickJudgeModel();
  const prompt = buildJudgePrompt(input);
  const started = Date.now();

  let parsed: Record<string, unknown> | null = null;
  let rawText = "";
  try {
    const lm = getLanguageModelSafe(judgeModel);
    const result = await generateText({
      model: lm,
      prompt,
      temperature: 0,
    });
    rawText = result.text ?? "";
    parsed = parseJudgeJson(rawText);
  } catch (err) {
    rawText = `(judge call failed: ${(err as Error).message})`;
  }

  const criteria: Record<JudgeCriterion, CriterionVerdict> = {
    rememberedPriorContext: readCriterion(parsed, "rememberedPriorContext"),
    didNotReFetchStaleData: readCriterion(parsed, "didNotReFetchStaleData"),
    prioritiesSurfacedWhenAsked: readCriterion(parsed, "prioritiesSurfacedWhenAsked"),
    noHallucinatedClaims: readCriterion(parsed, "noHallucinatedClaims"),
    appropriateAngleActivation: readCriterion(parsed, "appropriateAngleActivation"),
    stayedOnTopic: readCriterion(parsed, "stayedOnTopic"),
  };

  // Only "active" criteria (those declared on the turn) count for pass/fail
  // so we do not over-penalize turns that weren't designed to test every axis.
  const activeCriteria =
    input.turn.criteria.length > 0
      ? input.turn.criteria
      : (Object.keys(criteria) as JudgeCriterion[]);
  const overallPassed = activeCriteria.every((key) => criteria[key].value);

  const analysis =
    typeof parsed?.analysis === "string"
      ? (parsed.analysis as string)
      : rawText.slice(0, 300);

  return {
    judgeModel,
    judgeLatencyMs: Date.now() - started,
    criteria,
    overallPassed,
    analysis,
  };
}
