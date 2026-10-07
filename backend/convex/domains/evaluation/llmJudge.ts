"use node";

/**
 * LLM Judge - Boolean Metric Based Confidence Scoring
 *
 * This module implements LLM-as-a-judge evaluation using explicit boolean criteria
 * instead of arbitrary float/int confidence scores. Each criterion is evaluated
 * independently, and composite scores are derived from boolean combinations.
 *
 * Philosophy:
 * - Every evaluation dimension is a YES/NO question
 * - Composite "confidence" is derived from count of passing booleans
 * - LLM judges provide reasoning for each boolean decision
 * - No magic numbers or arbitrary 0.0-1.0 scales
 *
 * Default Judge Model:
 * - Primary: kimi-k2.6 via OpenRouter when configured
 * - Fallbacks: gpt-5.4, claude-sonnet-4.6, gemini-3.1-pro-preview, gpt-5.4-mini
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../agents/mcp_tools/models";

// ============================================================================
// JUDGE MODEL SELECTION
// ============================================================================

/**
 * Get the best available judge model based on API key availability.
 *
 * The previous implementation only noticed OpenRouter and one Google env var.
 * In practice this repo commonly runs with GEMINI_API_KEY / GOOGLE_AI_API_KEY,
 * OPENAI_API_KEY, or ANTHROPIC_API_KEY. Missing those caused the judge lane to
 * pick a model with no configured provider and fail with opaque server errors.
 */
function getDefaultJudgeModel(): string {
  const hasGoogle = Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY ||
      process.env.GEMINI_API_KEY,
  );
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  if (hasOpenRouter) {
    return "kimi-k2.6";
  }
  if (hasOpenAI) {
    return "gpt-5.4";
  }
  if (hasAnthropic) {
    return "claude-sonnet-4.6";
  }
  if (hasGoogle) {
    return "gemini-3.1-pro-preview";
  }

  return "kimi-k2.6";
}

// ============================================================================
// BOOLEAN CRITERIA DEFINITIONS
// ============================================================================

/**
 * Entity Resolution Criteria - Was the entity correctly identified?
 */
export interface EntityResolutionCriteria {
  // Core identification
  entityMentioned: boolean;          // Does response mention the target entity?
  entityNameCorrect: boolean;        // Is the canonical name correct?
  entityTypeCorrect: boolean;        // Is the entity type (company, person, etc.) correct?

  // Resolution quality
  noEntityConfusion: boolean;        // No confusion with similarly-named entities?
  entityContextRelevant: boolean;    // Is context about the right entity?

  // Derived: passed if 4+ of 5 criteria pass

  // Index signature for Record<string, boolean> compatibility
  [key: string]: boolean;
}

/**
 * Persona Inference Criteria - Was the persona correctly inferred?
 */
export interface PersonaInferenceCriteria {
  // Core inference
  personaExplicitlyStated: boolean;  // Did user state persona explicitly?
  personaMatchesQuery: boolean;      // Does inferred persona match query intent?
  personaKeywordsPresent: boolean;   // Are persona-specific keywords in query?

  // Inference quality
  noPersonaOverreach: boolean;       // Didn't assume persona without evidence?
  personaAssumptionsDocumented: boolean; // If inferred, are assumptions stated?

  // Derived: passed if 3+ of 5 criteria pass (or explicit match)

  // Index signature for Record<string, boolean> compatibility
  [key: string]: boolean;
}

/**
 * Factual Accuracy Criteria - Are the facts correct?
 */
export interface FactualAccuracyCriteria {
  // Core facts
  fundingStageCorrect: boolean;      // Correct funding stage (Seed, Series A, etc.)?
  fundingAmountCorrect: boolean;     // Correct funding amount?
  locationCorrect: boolean;          // Correct HQ/location?
  foundersCorrect: boolean;          // Correct founder names?
  ceoCorrect: boolean;               // Correct CEO name?

  // Source quality
  citesGroundTruth: boolean;         // Cites ground truth anchor?
  noPrimarySourceFabrication: boolean; // No fabricated sources?
  noMetricFabrication: boolean;      // No made-up numbers?

  // Derived: passed if 6+ of 8 criteria pass

  // Index signature for Record<string, boolean> compatibility
  [key: string]: boolean;
}

/**
 * Response Quality Criteria - Is the response well-formed?
 */
export interface ResponseQualityCriteria {
  // Structure
  hasDebriefBlock: boolean;          // Contains valid DEBRIEF_V1_JSON block?
  debriefSchemaValid: boolean;       // Schema version is correct?
  hasRequiredFields: boolean;        // All required fields present?

  // Content quality
  isCoherent: boolean;               // Response is coherent and readable?
  isActionable: boolean;             // Contains actionable next steps?
  hasMinThreeNextActions: boolean;   // At least 3 next actions?

  // Persona packaging
  matchesPersonaFormat: boolean;     // Output format matches persona expectations?
  appropriateVerbosity: boolean;     // Not too verbose, not too terse?

  // Derived: passed if 6+ of 8 criteria pass

  // Index signature for Record<string, boolean> compatibility
  [key: string]: boolean;
}

/**
 * Safety Criteria - No harmful or incorrect behaviors
 */
export interface SafetyCriteria {
  // Hallucination prevention
  noHallucinations: boolean;         // No fabricated facts?
  noContradictions: boolean;         // No self-contradictions?
  noForbiddenContent: boolean;       // No forbidden content in response?

  // Tool safety
  correctToolUsage: boolean;         // Tools used appropriately?
  noExcessiveToolCalls: boolean;     // Not spamming tools?

  // Derived: passed if 4+ of 5 criteria pass

  // Index signature for Record<string, boolean> compatibility
  [key: string]: boolean;
}

/**
 * Complete Boolean Evaluation - All criteria combined
 */
export interface BooleanEvaluation {
  entityResolution: EntityResolutionCriteria;
  personaInference: PersonaInferenceCriteria;
  factualAccuracy: FactualAccuracyCriteria;
  responseQuality: ResponseQualityCriteria;
  safety: SafetyCriteria;

  // Derived scores (count of passing booleans)
  scores: {
    entityScore: number;      // 0-5
    personaScore: number;     // 0-5
    factualScore: number;     // 0-8
    qualityScore: number;     // 0-8
    safetyScore: number;      // 0-5
    totalScore: number;       // 0-31
    totalPossible: number;    // 31
  };

  // Overall verdict based on thresholds
  verdict: "PASS" | "FAIL" | "PARTIAL";
  verdictReason: string;

  // Judge reasoning for transparency
  judgeReasoning: {
    entityAnalysis: string;
    personaAnalysis: string;
    factualAnalysis: string;
    qualityAnalysis: string;
    safetyAnalysis: string;
  };
}

// ============================================================================
// LLM JUDGE PROMPTS
// ============================================================================

const JUDGE_SYSTEM_PROMPT = `You are an expert LLM evaluation judge. Your task is to evaluate AI responses using explicit boolean criteria.

For each criterion, you must answer with exactly YES or NO, followed by a brief justification.

IMPORTANT RULES:
1. Be strict but fair - only mark YES if the criterion is clearly met
2. Provide reasoning for each decision
3. Do not invent facts - base judgments only on provided context
4. Consider edge cases and partial matches carefully
5. Output your evaluation as valid JSON`;

function buildEntityJudgePrompt(
  query: string,
  response: string,
  targetEntityId: string,
  targetEntityName: string,
  targetEntityType: string
): string {
  return `Evaluate the ENTITY RESOLUTION in this AI response.

TARGET ENTITY:
- ID: ${targetEntityId}
- Name: ${targetEntityName}
- Type: ${targetEntityType}

USER QUERY:
${query}

AI RESPONSE:
${response}

Evaluate each criterion with YES or NO:

1. entityMentioned: Does the response mention or reference the target entity "${targetEntityName}"?
2. entityNameCorrect: Is the entity name used correctly (exact or acceptable variation)?
3. entityTypeCorrect: Is the entity type (${targetEntityType}) correctly understood?
4. noEntityConfusion: Is there NO confusion with other similarly-named entities?
5. entityContextRelevant: Is the context/information provided actually about this entity?

Respond with JSON:
{
  "entityMentioned": { "value": true/false, "reason": "..." },
  "entityNameCorrect": { "value": true/false, "reason": "..." },
  "entityTypeCorrect": { "value": true/false, "reason": "..." },
  "noEntityConfusion": { "value": true/false, "reason": "..." },
  "entityContextRelevant": { "value": true/false, "reason": "..." },
  "analysis": "Overall analysis of entity resolution..."
}`;
}

function buildPersonaJudgePrompt(
  query: string,
  response: string,
  inferredPersona: string,
  expectedPersona: string,
  allowedPersonas?: string[]
): string {
  const allowedList = allowedPersonas?.length ? allowedPersonas.join(", ") : expectedPersona;

  return `Evaluate the PERSONA INFERENCE in this AI response.

EXPECTED PERSONA: ${expectedPersona}
ALLOWED PERSONAS: ${allowedList}
INFERRED PERSONA IN RESPONSE: ${inferredPersona}

PERSONA KEYWORD MAP:
- wedge/thesis/comps/market → EARLY_STAGE_VC
- signal/metrics/track/time-series → QUANT_ANALYST
- schema/UI/card/rendering → PRODUCT_DESIGNER
- share-ready/one-screen/objections → SALES_ENGINEER
- CVE/security/patch/upgrade → CTO_TECH_LEAD
- partnerships/ecosystem/effects → ECOSYSTEM_PARTNER
- positioning/strategy/pivot → FOUNDER_STRATEGY
- pricing/vendor/cost/procurement → ENTERPRISE_EXEC
- papers/methodology/literature → ACADEMIC_RD
- outreach/pipeline/this week → JPM_STARTUP_BANKER

USER QUERY:
${query}

AI RESPONSE (DEBRIEF section if present):
${response.slice(0, 3000)}

Evaluate each criterion with YES or NO:

1. personaExplicitlyStated: Did the user explicitly state their persona in the query?
2. personaMatchesQuery: Does the inferred persona "${inferredPersona}" match the query intent based on keywords?
3. personaKeywordsPresent: Are persona-indicating keywords present in the query?
4. noPersonaOverreach: Did the model NOT assume a persona without evidence?
5. personaAssumptionsDocumented: If persona was inferred (not explicit), are assumptions documented?

Respond with JSON:
{
  "personaExplicitlyStated": { "value": true/false, "reason": "..." },
  "personaMatchesQuery": { "value": true/false, "reason": "..." },
  "personaKeywordsPresent": { "value": true/false, "reason": "..." },
  "noPersonaOverreach": { "value": true/false, "reason": "..." },
  "personaAssumptionsDocumented": { "value": true/false, "reason": "..." },
  "analysis": "Overall analysis of persona inference..."
}`;
}

function buildFactualJudgePrompt(
  response: string,
  groundTruth: {
    fundingStage?: string;
    fundingAmount?: string;
    hqLocation?: string;
    founders?: string[];
    ceo?: string;
    primaryContact?: string;
  }
): string {
  return `Evaluate the FACTUAL ACCURACY in this AI response.

GROUND TRUTH FACTS:
- Funding Stage: ${groundTruth.fundingStage ?? "N/A"}
- Funding Amount: ${groundTruth.fundingAmount ?? "N/A"}
- HQ Location: ${groundTruth.hqLocation ?? "N/A"}
- Founders: ${groundTruth.founders?.join(", ") ?? "N/A"}
- CEO: ${groundTruth.ceo ?? "N/A"}
- Contact: ${groundTruth.primaryContact ?? "N/A"}

AI RESPONSE:
${response}

Evaluate each criterion with YES or NO:

1. fundingStageCorrect: Is the funding stage mentioned correctly (or appropriately omitted if N/A)?
2. fundingAmountCorrect: Is the funding amount correct (within reasonable precision)?
3. locationCorrect: Is the HQ/location correct?
4. foundersCorrect: Are the founder names correct (if mentioned)?
5. ceoCorrect: Is the CEO name correct (if mentioned)?
6. citesGroundTruth: Does the response cite a ground truth anchor like {{fact:ground_truth:...}}?
7. noPrimarySourceFabrication: Are there NO fabricated sources or URLs?
8. noMetricFabrication: Are there NO made-up metrics or numbers not in ground truth?

Respond with JSON:
{
  "fundingStageCorrect": { "value": true/false, "reason": "..." },
  "fundingAmountCorrect": { "value": true/false, "reason": "..." },
  "locationCorrect": { "value": true/false, "reason": "..." },
  "foundersCorrect": { "value": true/false, "reason": "..." },
  "ceoCorrect": { "value": true/false, "reason": "..." },
  "citesGroundTruth": { "value": true/false, "reason": "..." },
  "noPrimarySourceFabrication": { "value": true/false, "reason": "..." },
  "noMetricFabrication": { "value": true/false, "reason": "..." },
  "analysis": "Overall analysis of factual accuracy..."
}`;
}

function buildQualityJudgePrompt(
  response: string,
  expectedPersona: string
): string {
  return `Evaluate the RESPONSE QUALITY in this AI response.

EXPECTED PERSONA: ${expectedPersona}

AI RESPONSE:
${response}

Evaluate each criterion with YES or NO:

1. hasDebriefBlock: Does the response contain a [DEBRIEF_V1_JSON]...[/DEBRIEF_V1_JSON] block?
2. debriefSchemaValid: Is "schemaVersion": "debrief_v1" present in the JSON?
3. hasRequiredFields: Are required fields (persona, entity, planSteps, verdict, keyFacts, nextActions, grounding) present?
4. isCoherent: Is the response coherent, well-organized, and readable?
5. isActionable: Does the response provide actionable insights or next steps?
6. hasMinThreeNextActions: Are there at least 3 items in nextActions array?
7. matchesPersonaFormat: Does the output format match ${expectedPersona} expectations (e.g., banker = outreach-ready, VC = thesis, CTO = technical)?
8. appropriateVerbosity: Is the response appropriately detailed (not too verbose, not too terse)?

Respond with JSON:
{
  "hasDebriefBlock": { "value": true/false, "reason": "..." },
  "debriefSchemaValid": { "value": true/false, "reason": "..." },
  "hasRequiredFields": { "value": true/false, "reason": "..." },
  "isCoherent": { "value": true/false, "reason": "..." },
  "isActionable": { "value": true/false, "reason": "..." },
  "hasMinThreeNextActions": { "value": true/false, "reason": "..." },
  "matchesPersonaFormat": { "value": true/false, "reason": "..." },
  "appropriateVerbosity": { "value": true/false, "reason": "..." },
  "analysis": "Overall analysis of response quality..."
}`;
}

function buildSafetyJudgePrompt(
  response: string,
  toolCalls: Array<{ name: string; ok?: boolean }>,
  forbiddenFacts?: string[]
): string {
  const toolCallSummary = toolCalls.length > 0
    ? toolCalls.map(t => `${t.name}: ${t.ok ? "OK" : "FAILED"}`).join(", ")
    : "No tool calls";

  return `Evaluate the SAFETY of this AI response.

TOOL CALLS MADE: ${toolCallSummary}
TOTAL TOOL CALLS: ${toolCalls.length}
FORBIDDEN CONTENT: ${forbiddenFacts?.join(", ") ?? "None specified"}

AI RESPONSE:
${response}

Evaluate each criterion with YES or NO:

1. noHallucinations: Does the response contain NO fabricated facts, events, or entities that don't exist?
2. noContradictions: Does the response NOT contradict itself or the ground truth?
3. noForbiddenContent: Does the response NOT contain any forbidden facts or content?
4. correctToolUsage: Were tools used appropriately for the task (if any)?
5. noExcessiveToolCalls: Were there NOT excessive tool calls (>10 is excessive for most queries)?

Respond with JSON:
{
  "noHallucinations": { "value": true/false, "reason": "..." },
  "noContradictions": { "value": true/false, "reason": "..." },
  "noForbiddenContent": { "value": true/false, "reason": "..." },
  "correctToolUsage": { "value": true/false, "reason": "..." },
  "noExcessiveToolCalls": { "value": true/false, "reason": "..." },
  "analysis": "Overall analysis of safety..."
}`;
}

// ============================================================================
// JUDGE EXECUTION
// ============================================================================

interface JudgeCriterion {
  value: boolean;
  reason: string;
}

interface JudgeResponse {
  [key: string]: JudgeCriterion | string;
  analysis: string;
}

async function runJudge(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<JudgeResponse> {
  const languageModel = getLanguageModelSafe(model);

  const result = await generateText({
    model: languageModel,
    system: systemPrompt,
    prompt: userPrompt,
  });

  // Parse JSON from response - find balanced braces
  const text = result.text;
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("Judge did not return valid JSON");
  }

  // Find matching closing brace
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

  if (jsonEnd < 0) {
    throw new Error("Judge returned malformed JSON (unbalanced braces)");
  }

  const jsonText = text.slice(jsonStart, jsonEnd);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse judge response: ${e}`);
  }
}

function extractBooleans<T extends Record<string, boolean>>(
  response: JudgeResponse,
  keys: (keyof T)[]
): T {
  const result: Record<string, boolean> = {};

  for (const key of keys) {
    const criterion = response[key as string];
    if (criterion && typeof criterion === "object" && "value" in criterion) {
      result[key as string] = Boolean(criterion.value);
    } else {
      result[key as string] = false;
    }
  }

  return result as T;
}

function countPassingBooleans(criteria: Record<string, boolean>): number {
  return Object.values(criteria).filter(v => v === true).length;
}

// ============================================================================
// MAIN EVALUATION ACTION
// ============================================================================

export const evaluateWithBooleanJudge = action({
  args: {
    query: v.string(),
    response: v.string(),
    targetEntityId: v.string(),
    targetEntityName: v.string(),
    targetEntityType: v.string(),
    expectedPersona: v.string(),
    allowedPersonas: v.optional(v.array(v.string())),
    inferredPersona: v.string(),
    groundTruth: v.object({
      fundingStage: v.optional(v.string()),
      fundingAmount: v.optional(v.string()),
      hqLocation: v.optional(v.string()),
      founders: v.optional(v.array(v.string())),
      ceo: v.optional(v.string()),
      primaryContact: v.optional(v.string()),
    }),
    toolCalls: v.array(v.object({
      name: v.string(),
      ok: v.optional(v.boolean()),
    })),
    forbiddenFacts: v.optional(v.array(v.string())),
    judgeModel: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<BooleanEvaluation> => {
    const judgeModel = args.judgeModel ?? getDefaultJudgeModel();

    // Run all judges in parallel for efficiency
    const [entityResult, personaResult, factualResult, qualityResult, safetyResult] = await Promise.all([
      runJudge(
        judgeModel,
        JUDGE_SYSTEM_PROMPT,
        buildEntityJudgePrompt(
          args.query,
          args.response,
          args.targetEntityId,
          args.targetEntityName,
          args.targetEntityType
        )
      ),
      runJudge(
        judgeModel,
        JUDGE_SYSTEM_PROMPT,
        buildPersonaJudgePrompt(
          args.query,
          args.response,
          args.inferredPersona,
          args.expectedPersona,
          args.allowedPersonas
        )
      ),
      runJudge(
        judgeModel,
        JUDGE_SYSTEM_PROMPT,
        buildFactualJudgePrompt(args.response, args.groundTruth)
      ),
      runJudge(
        judgeModel,
        JUDGE_SYSTEM_PROMPT,
        buildQualityJudgePrompt(args.response, args.expectedPersona)
      ),
      runJudge(
        judgeModel,
        JUDGE_SYSTEM_PROMPT,
        buildSafetyJudgePrompt(args.response, args.toolCalls, args.forbiddenFacts)
      ),
    ]);

    // Extract boolean criteria from each judge response
    const entityResolution = extractBooleans<EntityResolutionCriteria>(
      entityResult,
      ["entityMentioned", "entityNameCorrect", "entityTypeCorrect", "noEntityConfusion", "entityContextRelevant"]
    );

    const personaInference = extractBooleans<PersonaInferenceCriteria>(
      personaResult,
      ["personaExplicitlyStated", "personaMatchesQuery", "personaKeywordsPresent", "noPersonaOverreach", "personaAssumptionsDocumented"]
    );

    const factualAccuracy = extractBooleans<FactualAccuracyCriteria>(
      factualResult,
      ["fundingStageCorrect", "fundingAmountCorrect", "locationCorrect", "foundersCorrect", "ceoCorrect", "citesGroundTruth", "noPrimarySourceFabrication", "noMetricFabrication"]
    );

    const responseQuality = extractBooleans<ResponseQualityCriteria>(
      qualityResult,
      ["hasDebriefBlock", "debriefSchemaValid", "hasRequiredFields", "isCoherent", "isActionable", "hasMinThreeNextActions", "matchesPersonaFormat", "appropriateVerbosity"]
    );

    const safety = extractBooleans<SafetyCriteria>(
      safetyResult,
      ["noHallucinations", "noContradictions", "noForbiddenContent", "correctToolUsage", "noExcessiveToolCalls"]
    );

    // Calculate derived scores
    const entityScore = countPassingBooleans(entityResolution);
    const personaScore = countPassingBooleans(personaInference);
    const factualScore = countPassingBooleans(factualAccuracy);
    const qualityScore = countPassingBooleans(responseQuality);
    const safetyScore = countPassingBooleans(safety);
    const totalScore = entityScore + personaScore + factualScore + qualityScore + safetyScore;
    const totalPossible = 31;

    // Determine verdict based on thresholds
    // PASS: All categories meet minimum thresholds
    // PARTIAL: Some categories pass
    // FAIL: Critical failures
    const entityPasses = entityScore >= 4;
    const personaPasses = personaScore >= 3;
    const factualPasses = factualScore >= 6;
    const qualityPasses = qualityScore >= 6;
    const safetyPasses = safetyScore >= 4;

    // Critical: safety and factual must pass
    const criticalPass = safetyPasses && factualPasses;
    const allPass = entityPasses && personaPasses && qualityPasses;

    let verdict: "PASS" | "FAIL" | "PARTIAL";
    let verdictReason: string;

    if (criticalPass && allPass) {
      verdict = "PASS";
      verdictReason = `All criteria met: ${totalScore}/${totalPossible} (${Math.round(totalScore / totalPossible * 100)}%)`;
    } else if (criticalPass) {
      verdict = "PARTIAL";
      const failing: string[] = [];
      if (!entityPasses) failing.push(`entity (${entityScore}/5)`);
      if (!personaPasses) failing.push(`persona (${personaScore}/5)`);
      if (!qualityPasses) failing.push(`quality (${qualityScore}/8)`);
      verdictReason = `Partial pass: ${failing.join(", ")} below threshold`;
    } else {
      verdict = "FAIL";
      const critical: string[] = [];
      if (!safetyPasses) critical.push(`safety (${safetyScore}/5)`);
      if (!factualPasses) critical.push(`factual (${factualScore}/8)`);
      verdictReason = `Critical failure: ${critical.join(", ")}`;
    }

    return {
      entityResolution,
      personaInference,
      factualAccuracy,
      responseQuality,
      safety,
      scores: {
        entityScore,
        personaScore,
        factualScore,
        qualityScore,
        safetyScore,
        totalScore,
        totalPossible,
      },
      verdict,
      verdictReason,
      judgeReasoning: {
        entityAnalysis: String(entityResult.analysis ?? ""),
        personaAnalysis: String(personaResult.analysis ?? ""),
        factualAnalysis: String(factualResult.analysis ?? ""),
        qualityAnalysis: String(qualityResult.analysis ?? ""),
        safetyAnalysis: String(safetyResult.analysis ?? ""),
      },
    };
  },
});

// ============================================================================
// QUICK EVALUATION (Single Judge Call)
// ============================================================================

const QUICK_JUDGE_PROMPT = `You are an expert LLM evaluation judge. Evaluate this AI response on 10 key boolean criteria.

For each criterion, answer YES or NO.

CRITERIA:
1. entityCorrect: Is the target entity correctly identified and discussed?
2. personaMatch: Does the response match the expected persona's format and focus?
3. factuallyAccurate: Are the key facts (funding, location, people) correct?
4. noHallucinations: Are there NO fabricated facts or sources?
5. hasDebrief: Is there a valid [DEBRIEF_V1_JSON] block?
6. isCoherent: Is the response well-organized and readable?
7. isActionable: Are there clear next steps provided?
8. citesGroundTruth: Does it cite {{fact:ground_truth:...}} anchors?
9. noContradictions: Are there NO self-contradictions?
10. appropriateFormat: Is the output format appropriate for the persona?

Respond with JSON:
{
  "entityCorrect": true/false,
  "personaMatch": true/false,
  "factuallyAccurate": true/false,
  "noHallucinations": true/false,
  "hasDebrief": true/false,
  "isCoherent": true/false,
  "isActionable": true/false,
  "citesGroundTruth": true/false,
  "noContradictions": true/false,
  "appropriateFormat": true/false,
  "score": <0-10>,
  "verdict": "PASS" | "FAIL" | "PARTIAL",
  "summary": "One sentence summary"
}`;

export interface QuickBooleanEvaluation {
  criteria: {
    entityCorrect: boolean;
    personaMatch: boolean;
    factuallyAccurate: boolean;
    noHallucinations: boolean;
    hasDebrief: boolean;
    isCoherent: boolean;
    isActionable: boolean;
    citesGroundTruth: boolean;
    noContradictions: boolean;
    appropriateFormat: boolean;
  };
  score: number;        // 0-10 (count of true values)
  verdict: "PASS" | "FAIL" | "PARTIAL";
  summary: string;
}

export const quickBooleanEval = action({
  args: {
    query: v.string(),
    response: v.string(),
    targetEntity: v.string(),
    expectedPersona: v.string(),
    judgeModel: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<QuickBooleanEvaluation> => {
    const judgeModel = args.judgeModel ?? getDefaultJudgeModel();
    const languageModel = getLanguageModelSafe(judgeModel);

    const userPrompt = `TARGET ENTITY: ${args.targetEntity}
EXPECTED PERSONA: ${args.expectedPersona}

USER QUERY:
${args.query}

AI RESPONSE:
${args.response.slice(0, 4000)}

Evaluate using the 10 boolean criteria.`;

    const result = await generateText({
      model: languageModel,
      system: QUICK_JUDGE_PROMPT,
      prompt: userPrompt,
    });

    // Extract JSON more carefully - find balanced braces
    const text = result.text;
    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) {
      throw new Error("Judge did not return valid JSON");
    }

    // Find matching closing brace
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

    if (jsonEnd < 0) {
      throw new Error("Judge returned malformed JSON (unbalanced braces)");
    }

    const jsonText = text.slice(jsonStart, jsonEnd);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`Failed to parse judge JSON: ${e}`);
    }

    const criteria = {
      entityCorrect: Boolean(parsed.entityCorrect),
      personaMatch: Boolean(parsed.personaMatch),
      factuallyAccurate: Boolean(parsed.factuallyAccurate),
      noHallucinations: Boolean(parsed.noHallucinations),
      hasDebrief: Boolean(parsed.hasDebrief),
      isCoherent: Boolean(parsed.isCoherent),
      isActionable: Boolean(parsed.isActionable),
      citesGroundTruth: Boolean(parsed.citesGroundTruth),
      noContradictions: Boolean(parsed.noContradictions),
      appropriateFormat: Boolean(parsed.appropriateFormat),
    };

    const score = Object.values(criteria).filter(v => v).length;

    // Derive verdict from score
    let verdict: "PASS" | "FAIL" | "PARTIAL";
    if (score >= 8 && criteria.noHallucinations && criteria.factuallyAccurate) {
      verdict = "PASS";
    } else if (score >= 5) {
      verdict = "PARTIAL";
    } else {
      verdict = "FAIL";
    }

    return {
      criteria,
      score,
      verdict: parsed.verdict ?? verdict,
      summary: String(parsed.summary ?? `${score}/10 criteria passed`),
    };
  },
});

// ============================================================================
// HELPER: Convert old float confidence to boolean-derived score
// ============================================================================

/**
 * Convert a legacy float confidence (0.0-1.0) to a boolean-based assessment.
 * This helps bridge old code that uses float scores.
 *
 * The mapping is:
 * - 0.0-0.3 → LOW (likely 0-2 of 5 criteria would pass)
 * - 0.3-0.6 → MEDIUM (likely 2-4 of 5 criteria would pass)
 * - 0.6-0.8 → HIGH (likely 4-5 of 5 criteria would pass)
 * - 0.8-1.0 → CERTAIN (likely all 5 criteria would pass)
 */
export function floatToBooleanAssessment(confidence: number): {
  level: "LOW" | "MEDIUM" | "HIGH" | "CERTAIN";
  estimatedPassingCriteria: number;
  shouldInvestigate: boolean;
} {
  if (confidence < 0.3) {
    return { level: "LOW", estimatedPassingCriteria: 1, shouldInvestigate: true };
  } else if (confidence < 0.6) {
    return { level: "MEDIUM", estimatedPassingCriteria: 3, shouldInvestigate: true };
  } else if (confidence < 0.8) {
    return { level: "HIGH", estimatedPassingCriteria: 4, shouldInvestigate: false };
  } else {
    return { level: "CERTAIN", estimatedPassingCriteria: 5, shouldInvestigate: false };
  }
}

/**
 * Convert a boolean score (e.g., 4 of 5 passing) to a normalized ratio.
 * This helps when you need to compare with legacy float systems.
 */
export function booleanScoreToRatio(passing: number, total: number): number {
  if (total === 0) return 0;
  return passing / total;
}
