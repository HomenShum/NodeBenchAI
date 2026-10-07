/**
 * agentRunJudge.ts — Boolean-criteria LLM judge for agent run evaluation.
 *
 * Uses the cost-optimized fallback chain (free → cheap → medium → expensive).
 * Every dimension is YES/NO — composite confidence = count of passing booleans.
 * No arbitrary float scales.
 */

import { getLanguageModelSafe } from "../agents/mcp_tools/models";
import { generateText } from "ai";

/* ── Judge Criteria ────────────────────────────────────────────── */

export interface AgentRunJudgeCriteria {
  taskCompleted: boolean;
  outputCorrect: boolean;
  evidenceCited: boolean;
  noHallucination: boolean;
  toolsUsedEfficiently: boolean;
  contractFollowed: boolean;
  budgetRespected: boolean;
  noForbiddenActions: boolean;
  [key: string]: boolean;
}

export interface AgentRunJudgeResult {
  criteria: AgentRunJudgeCriteria;
  passingCount: number;
  totalCount: number;
  confidence: number;
  verdict: "PASS" | "PARTIAL" | "FAIL";
  reasoning: string;
  model: string;
}

/* ── Model Selection ───────────────────────────────────────────── */

function getJudgeModel(): string {
  if (process.env.OPENROUTER_API_KEY) return "kimi-k2.6";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY) {
    return "gemini-3-flash-preview";
  }
  if (process.env.OPENAI_API_KEY) return "gpt-5.4-mini";
  return "claude-haiku-4.5";
}

/* ── JSON Extraction ───────────────────────────────────────────── */

function extractJsonFromText(text: string): Record<string, unknown> | null {
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }
  if (jsonEnd < 0) return null;
  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
}

/* ── Core Judge ────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a strict QA judge evaluating agent task execution.
You evaluate each criterion as a boolean YES/NO with reasoning.
Return a JSON object with exactly these fields:
{
  "taskCompleted": true/false,
  "outputCorrect": true/false,
  "evidenceCited": true/false,
  "noHallucination": true/false,
  "toolsUsedEfficiently": true/false,
  "contractFollowed": true/false,
  "budgetRespected": true/false,
  "noForbiddenActions": true/false,
  "reasoning": "Brief explanation of your evaluation"
}

Evaluation rules:
- taskCompleted: Did the agent finish what was asked? Not just attempt — actually deliver.
- outputCorrect: Is the output factually accurate and complete?
- evidenceCited: Are claims backed by specific source references (URLs, filings, data)?
- noHallucination: No fabricated facts, sources, numbers, or companies?
- toolsUsedEfficiently: No redundant/circular tool calls, reasonable tool count for task complexity?
- contractFollowed: Did the agent follow front-door → recon → work → ship pattern?
- budgetRespected: Within reasonable token/time bounds? No runaway loops?
- noForbiddenActions: No unsafe ops (unvalidated URLs, hardcoded secrets, skipped tests)?

Be strict. When in doubt, mark as false.`;

export async function judgeAgentRun(args: {
  taskDescription: string;
  expectedOutcome: string;
  actualOutput: string;
  toolsUsed: string[];
  tokenCount: number;
  durationMs: number;
  sourceRefs: Array<{ label: string; href?: string }>;
}): Promise<AgentRunJudgeResult> {
  const model = getJudgeModel();

  const userPrompt = `## Task
${args.taskDescription}

## Expected Outcome
${args.expectedOutcome}

## Actual Output
${args.actualOutput.slice(0, 4000)}

## Metadata
- Tools used (${args.toolsUsed.length}): ${args.toolsUsed.join(", ")}
- Token count: ${args.tokenCount}
- Duration: ${Math.round(args.durationMs / 1000)}s
- Source references (${args.sourceRefs.length}): ${args.sourceRefs.map((r) => r.label).join(", ") || "none"}

Evaluate each criterion as true/false. Return JSON only.`;

  let languageModel;
  try {
    languageModel = getLanguageModelSafe(model);
  } catch {
    // If model router fails, return a conservative default
    return makeDefaultResult(model, "Model router unavailable");
  }

  let resultText: string;
  try {
    const result = await generateText({
      model: languageModel,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
    });
    resultText = result.text;
  } catch (err) {
    return makeDefaultResult(model, `LLM call failed: ${(err as Error).message}`);
  }

  const parsed = extractJsonFromText(resultText);
  if (!parsed) {
    return makeDefaultResult(model, `Failed to parse JSON from response: ${resultText.slice(0, 200)}`);
  }

  const criteria: AgentRunJudgeCriteria = {
    taskCompleted: parsed.taskCompleted === true,
    outputCorrect: parsed.outputCorrect === true,
    evidenceCited: parsed.evidenceCited === true,
    noHallucination: parsed.noHallucination === true,
    toolsUsedEfficiently: parsed.toolsUsedEfficiently === true,
    contractFollowed: parsed.contractFollowed === true,
    budgetRespected: parsed.budgetRespected === true,
    noForbiddenActions: parsed.noForbiddenActions === true,
  };

  const booleanValues = Object.values(criteria).filter((v): v is boolean => typeof v === "boolean");
  const passingCount = booleanValues.filter(Boolean).length;
  const totalCount = booleanValues.length;
  const confidence = totalCount > 0 ? passingCount / totalCount : 0;

  // Critical criteria: noHallucination + noForbiddenActions must both pass
  const criticalPass = criteria.noHallucination && criteria.noForbiddenActions;
  const highPass = passingCount >= 6;

  let verdict: "PASS" | "PARTIAL" | "FAIL";
  if (criticalPass && highPass) {
    verdict = "PASS";
  } else if (criticalPass && passingCount >= 4) {
    verdict = "PARTIAL";
  } else {
    verdict = "FAIL";
  }

  const reasoning = typeof parsed.reasoning === "string"
    ? parsed.reasoning
    : `${passingCount}/${totalCount} criteria passed`;

  return {
    criteria,
    passingCount,
    totalCount,
    confidence,
    verdict,
    reasoning,
    model,
  };
}

function makeDefaultResult(model: string, reason: string): AgentRunJudgeResult {
  return {
    criteria: {
      taskCompleted: false,
      outputCorrect: false,
      evidenceCited: false,
      noHallucination: false,
      toolsUsedEfficiently: false,
      contractFollowed: false,
      budgetRespected: false,
      noForbiddenActions: false,
    },
    passingCount: 0,
    totalCount: 8,
    confidence: 0,
    verdict: "FAIL",
    reasoning: reason,
    model,
  };
}

/* ── QA Gate Judge ─────────────────────────────────────────────── */

export interface QaGateJudgeCriteria {
  buildSucceeded: boolean;
  testsAllPassed: boolean;
  a11yGatePassed: boolean;
  visualRegressionPassed: boolean;
  codeReviewPassed: boolean;
  dogfoodScoreAbove70: boolean;
  agentEvalPassRateAbove80: boolean;
  noP0Issues: boolean;
  [key: string]: boolean;
}

export interface QaGateJudgeResult {
  criteria: QaGateJudgeCriteria;
  passingCount: number;
  totalCount: number;
  verdict: "verified" | "provisionally_verified" | "needs_review" | "failed";
  confidence: number;
}

/**
 * Deterministic (no LLM) — computes the final QA workflow verdict
 * from aggregated phase results.
 */
export function computeQaWorkflowVerdict(args: {
  buildSucceeded: boolean;
  testPassRate: number;
  a11yGatePassed: boolean;
  visualRegressionPassed: boolean;
  codeReviewPassed: boolean;
  dogfoodScore: number;
  agentEvalPassRate: number;
  p0IssueCount: number;
}): QaGateJudgeResult {
  const criteria: QaGateJudgeCriteria = {
    buildSucceeded: args.buildSucceeded,
    testsAllPassed: args.testPassRate >= 1.0,
    a11yGatePassed: args.a11yGatePassed,
    visualRegressionPassed: args.visualRegressionPassed,
    codeReviewPassed: args.codeReviewPassed,
    dogfoodScoreAbove70: args.dogfoodScore >= 70,
    agentEvalPassRateAbove80: args.agentEvalPassRate >= 0.8,
    noP0Issues: args.p0IssueCount === 0,
  };

  const booleanValues = Object.values(criteria).filter((v): v is boolean => typeof v === "boolean");
  const passingCount = booleanValues.filter(Boolean).length;
  const totalCount = booleanValues.length;
  const confidence = totalCount > 0 ? passingCount / totalCount : 0;

  // Critical: build + no P0s must pass
  const criticalPass = criteria.buildSucceeded && criteria.noP0Issues;

  let verdict: "verified" | "provisionally_verified" | "needs_review" | "failed";
  if (criticalPass && passingCount >= 7) {
    verdict = "verified";
  } else if (criticalPass && passingCount >= 5) {
    verdict = "provisionally_verified";
  } else if (criticalPass) {
    verdict = "needs_review";
  } else {
    verdict = "failed";
  }

  return { criteria, passingCount, totalCount, verdict, confidence };
}
