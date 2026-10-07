/**
 * Evaluation Prompts - Model-Specific Variants
 *
 * The standard evaluation prompt is 2000+ tokens and designed for GPT-5.2.
 * Cheaper models (Haiku, Gemini Flash, GPT-5 Mini) need simplified versions.
 */

export type PromptComplexity = "full" | "standard" | "minimal";

export interface EvaluationPromptConfig {
  complexity: PromptComplexity;
  tokenEstimate: number;
  description: string;
}

/**
 * Determine appropriate prompt complexity for a model
 */
export function getPromptComplexityForModel(model: string): PromptComplexity {
  const normalized = model.toLowerCase();

  // Full complexity for flagship models (native + OpenRouter)
  if (normalized.includes("gpt-5.4") && !normalized.includes("mini")) {
    return "full";
  }
  if (normalized.includes("claude-opus") || normalized.includes("claude-sonnet-4")) {
    return "full";
  }
  // OpenRouter flagship reasoning/large models get full complexity
  if (normalized.includes("deepseek-r1") || normalized.includes("deepseek-v3")) {
    return "full";
  }
  if (normalized.includes("qwen3-235b") || normalized.includes("qwen3-72b")) {
    return "full";
  }
  if (normalized.includes("mistral-large")) {
    return "full";
  }

  // Minimal complexity for budget models
  if (normalized.includes("mini") || normalized.includes("flash") || normalized.includes("haiku")) {
    return "minimal";
  }

  // Standard for mid-tier models (minimax, cohere, smaller qwen, etc.)
  if (normalized.includes("pro")) {
    return "standard";
  }
  if (normalized.includes("minimax") || normalized.includes("cohere")) {
    return "standard";
  }

  // Default to standard
  return "standard";
}

/**
 * FULL COMPLEXITY - For GPT-5.2, Claude Opus, Claude Sonnet 4
 * ~2000 tokens, comprehensive schema with all fields
 */
export const FULL_EVALUATION_PROMPT = `EVALUATION MODE (machine-readable debrief required):
After your normal human-readable answer, append EXACTLY one JSON object wrapped like this:
[DEBRIEF_V1_JSON]
{
  "schemaVersion": "debrief_v1",
  "persona": { "inferred": "JPM_STARTUP_BANKER", "confidence": 0.0, "assumptions": [] },
  "clarifyingQuestionsAsked": 0,
  "clarifyingQuestions": [],
  "entity": {
    "input": "",
    "resolvedId": null,
    "canonicalName": null,
    "type": null,
    "confidence": 0.0,
    "candidates": []
  },
  "planSteps": [],
  "toolsUsed": [{ "name": "", "ok": true, "error": null }],
  "fallbacks": [],
  "verdict": "UNKNOWN",
  "keyFacts": {
    "hqLocation": null,
    "funding": {
      "stage": null,
      "amount": { "amount": null, "currency": null, "unit": null },
      "date": null,
      "coLeads": []
    },
    "people": { "founders": [], "ceo": null },
    "product": { "platform": null, "leadPrograms": [] },
    "contact": { "email": null, "channel": null },
    "freshness": { "ageDays": null }
  },
  "risks": [],
  "nextActions": [],
  "grounding": []
}
[/DEBRIEF_V1_JSON]

Rules:
- Progressive disclosure (required): call searchAvailableSkills({ query: "<the user request>" }) BEFORE any other tool call (including lookupGroundTruthEntity and initScratchpad). Even if you won't use tools, still call it once so the eval harness can verify skill-first behavior. Count this against any tool-call budget.
- The JSON must be valid (no trailing commas, no markdown fences).
- The [DEBRIEF_V1_JSON] block MUST contain the DebriefV1 schemaVersion=debrief_v1 exactly. If you output any other JSON (e.g., a UI card), put it OUTSIDE the DEBRIEF_V1_JSON block.
- Use ONLY the 10 personas in our system (see audit_mocks.ts): JPM_STARTUP_BANKER, EARLY_STAGE_VC, CTO_TECH_LEAD, FOUNDER_STRATEGY, ACADEMIC_RD, ENTERPRISE_EXEC, ECOSYSTEM_PARTNER, QUANT_ANALYST, PRODUCT_DESIGNER, SALES_ENGINEER.
- Persona inference is REQUIRED: set persona.inferred to the best-fit persona for the USER REQUEST (do not leave the template value unless it truly matches).
- Persona cue map (use the first strong match): due diligence/thesis/wedge/comps/market/funding history => EARLY_STAGE_VC; signal/metrics/what to track/timeline/time-series/telemetry/tool calls/disclosure => QUANT_ANALYST; schema/UI card/rendering/parameters => PRODUCT_DESIGNER; share-ready/one-screen/outbound/objections/CTA/sales materials/marketing materials/deck/one-pager => SALES_ENGINEER; risk exposure/CVE/patch plan/upgrade/incident/logs/screenshots/postmortem/outage/what happened => CTO_TECH_LEAD; partnerships/second-order effects => ECOSYSTEM_PARTNER; positioning/pivot/strategy => FOUNDER_STRATEGY; pricing/cost/standardize/vendor/procurement/P&L => ENTERPRISE_EXEC; literature/methodology => ACADEMIC_RD; outreach/contacts/pipeline/this week => JPM_STARTUP_BANKER.
- If persona was not explicitly stated by the user, persona.assumptions MUST include at least 1 short string explaining why you chose that persona.
- If you ask any clarifying question in your human-readable answer, set clarifyingQuestionsAsked and include the exact question text(s) in clarifyingQuestions. Ask at most 1 clarifier unless the user explicitly requests an interview.
- If GROUND_TRUTH_INJECTED is false and the request appears to be about an evaluation/synthetic entity (e.g., DISCO, AMBROS, MQUICKJS, OPEN-AUTOGLM, SOUNDCLOUD, SALESFORCE, ALZHEIMERS, GEMINI_3), call lookupGroundTruthEntity before answering (after the initial searchAvailableSkills step) and cite the returned {{fact:ground_truth:...}} anchor.
- If prompt context includes EVALUATION_EXPECTED_ENTITY_ID / EVALUATION_EXPECTED_ENTITY_NAME, treat that as authoritative harness context. Do not ask the user to restate the entity. Call lookupGroundTruthEntity with that value even if the request omits the entity name.
- If prompt context includes EVALUATION_EXPECTED_PERSONA, package the answer for that persona and set persona.inferred to that exact value unless the user explicitly conflicts with it.
- If prompt context includes EVALUATION_REQUIRED_GROUND_TRUTH_ANCHOR, copy that exact token into grounding[].
- Evaluation runs are non-interactive: do NOT call askHuman. If uncertain, proceed with best guess and state your assumption.
- Entity parsing: if the USER REQUEST starts with "<ENTITY> —" or "<ENTITY> -", treat <ENTITY> as the entity.input and pass that exact string to lookupGroundTruthEntity.
- Use null for unknown fields; do not guess.
- If the only grounded evidence you have is the injected ground-truth block, stay bounded to those explicit facts. Do not invent extra investors, dates, pricing details, partnership outcomes, comparables, CVE specifics, severity changes, or program names.
- If broader interpretation is helpful, label it as hypothesis or what to verify next rather than as established fact.
- planSteps MUST include at least 1 explicit verification step (e.g., 'Verify: freshness window + contradictions + sources') and your human-readable answer should reflect that verification happened.
- verdict MUST be exactly one of: PASS, FAIL, UNKNOWN.
- grounding[] MUST include at least 1 ground-truth anchor you used (e.g., {{fact:ground_truth:DISCO}}).
- nextActions MUST contain >= 3 items (even for PRODUCT_DESIGNER: actions can be 'rendering validation', 'QA checklist', etc.).
- If you call lookupGroundTruthEntity and it returns an HQ/location, you MUST copy it into keyFacts.hqLocation (do not leave it null).
- If lookupGroundTruthEntity returns a last known funding stage for a stale or older company, keep that last known stage in keyFacts.funding.stage and label it stale/reported instead of replacing it with null or N/A.

CRITICAL: You MUST always end your response with the [DEBRIEF_V1_JSON]...[/DEBRIEF_V1_JSON] block. This is REQUIRED for evaluation scoring. Keep your human-readable analysis concise (2-3 paragraphs max) to ensure the JSON block fits within output limits.`;

/**
 * STANDARD COMPLEXITY - For Claude Haiku, Gemini Pro
 * ~1000 tokens, simplified schema with core fields
 */
export const STANDARD_EVALUATION_PROMPT = `EVALUATION MODE - Respond with your analysis PLUS a structured JSON block:

1. First, write your normal analysis (2-3 paragraphs)
2. Then append this EXACT format:

[DEBRIEF_V1_JSON]
{
  "schemaVersion": "debrief_v1",
  "persona": { "inferred": "<INFER_FROM_QUERY>", "confidence": 0.8 },
  "entity": { "input": "<ENTITY>", "canonicalName": "<NAME>", "type": "company" },
  "planSteps": ["Step 1", "Step 2", "Verify results"],
  "toolsUsed": [{ "name": "lookupGroundTruthEntity", "ok": true }],
  "verdict": "PASS",
  "keyFacts": {
    "hqLocation": "<city, country>",
    "funding": { "stage": "Seed", "amount": { "amount": 36, "currency": "EUR", "unit": "M" }},
    "people": { "founders": ["Name"], "ceo": "Name" },
    "contact": { "email": "email@company.com" }
  },
  "nextActions": ["Action 1", "Action 2", "Action 3"],
  "grounding": ["{{fact:ground_truth:ENTITY_ID}}"]
}
[/DEBRIEF_V1_JSON]

CRITICAL RULES:
0. Progressive disclosure (required): call searchAvailableSkills({ query: "<the user request>" }) BEFORE any other tool call (including lookupGroundTruthEntity). Even if you won't use tools, still call it once so the eval harness can verify skill-first behavior.
1. **PERSONA INFERENCE IS REQUIRED** - Analyze the query and pick the best match:
   - "due diligence"/"wedge"/"thesis"/"comps"/"market"/"funding history" → EARLY_STAGE_VC
   - "signal"/"metrics"/"track"/"time-series"/"telemetry"/"tool calls"/"disclosure" → QUANT_ANALYST
   - "schema"/"UI"/"card"/"rendering"/"parameter" → PRODUCT_DESIGNER
   - "share-ready"/"one-screen"/"objections"/"sales materials"/"marketing materials"/"deck"/"one-pager" → SALES_ENGINEER
   - "CVE"/"security"/"patch"/"upgrade"/"incident"/"logs"/"screenshots"/"postmortem"/"outage"/"what happened" → CTO_TECH_LEAD
   - "partnerships"/"ecosystem"/"effects" → ECOSYSTEM_PARTNER
   - "positioning"/"strategy"/"pivot" → FOUNDER_STRATEGY
   - "pricing"/"vendor"/"cost"/"procurement" → ENTERPRISE_EXEC
   - "papers"/"methodology"/"literature" → ACADEMIC_RD
   - "outreach"/"pipeline"/"this week" → JPM_STARTUP_BANKER

2. **DO NOT default to JPM_STARTUP_BANKER** - Only use it when query explicitly mentions banker-related terms

3. For evaluation entities (DISCO, Ambros, QuickJS, OpenAutoGLM, SoundCloud, Salesforce, Alzheimer's, Gemini 3): call lookupGroundTruthEntity before answering (after the initial searchAvailableSkills step)
4. If prompt context includes EVALUATION_EXPECTED_ENTITY_ID / EVALUATION_EXPECTED_ENTITY_NAME, use that as the target even if the request omits the entity and do NOT ask the user to restate it
5. If prompt context includes EVALUATION_EXPECTED_PERSONA, package the answer for that persona and set persona.inferred to that exact value
6. If prompt context includes EVALUATION_REQUIRED_GROUND_TRUTH_ANCHOR, copy that exact token into grounding[]
7. The JSON MUST be valid - no trailing commas, proper quotes

8. Use null for unknown fields - DO NOT GUESS
9. If the only grounded evidence is the injected ground-truth block, stay bounded to those explicit facts. Do not invent extra investors, dates, pricing details, partnership outcomes, comparables, CVE specifics, or product claims
10. Label broader interpretation as hypothesis or what to verify next
11. nextActions needs at least 3 items
12. If lookupGroundTruthEntity returns a last known funding stage for a stale company, keep that stage in keyFacts.funding.stage and mark it stale/reported instead of using null or N/A
13. grounding[] must cite {{fact:ground_truth:...}} if you used ground truth

CRITICAL: You MUST always end your response with the [DEBRIEF_V1_JSON]...[/DEBRIEF_V1_JSON] block. This is REQUIRED.`;

/**
 * MINIMAL COMPLEXITY - For GPT-5 Mini, Gemini Flash
 * ~400 tokens, bare minimum schema
 */
export const MINIMAL_EVALUATION_PROMPT = `EVALUATION FORMAT REQUIRED:

Write your answer, then add this JSON block:

[DEBRIEF_V1_JSON]
{
  "schemaVersion": "debrief_v1",
  "persona": { "inferred": "<INFER_FROM_QUERY>", "confidence": 0.8 },
  "entity": { "input": "<ENTITY_NAME>", "canonicalName": "<FULL_NAME>" },
  "planSteps": ["Lookup ground truth", "Verify facts", "Format response"],
  "toolsUsed": [{ "name": "lookupGroundTruthEntity", "ok": true }],
  "verdict": "PASS",
  "keyFacts": {
    "hqLocation": "<city, country>",
    "funding": { "stage": "<stage>", "amount": { "amount": null, "currency": null, "unit": null }},
    "contact": { "email": "<email@company.com or null>" }
  },
  "nextActions": ["Action 1", "Action 2", "Action 3"],
  "grounding": ["{{fact:ground_truth:<ENTITY_ID>}}"]
}
[/DEBRIEF_V1_JSON]

**PERSONA INFERENCE IS REQUIRED** - You MUST analyze the user query and pick the correct persona:

| Query Keywords | → Persona |
|----------------|-----------|
| due diligence, wedge, thesis, comps, market fit, funding history | EARLY_STAGE_VC |
| signal, metrics, track, time-series, KPI, timeline, telemetry, tool calls, disclosure | QUANT_ANALYST |
| schema, UI, card, rendering, parameter | PRODUCT_DESIGNER |
| share-ready, one-screen, outbound-ready, talk-track, objections, sales materials, marketing materials, deck, one-pager | SALES_ENGINEER |
| CVE, security, patch, upgrade, incident, logs, screenshots, postmortem, outage, what happened | CTO_TECH_LEAD |
| partnerships, ecosystem, effects | ECOSYSTEM_PARTNER |
| positioning, strategy, pivot | FOUNDER_STRATEGY |
| pricing, vendor, cost model, procurement | ENTERPRISE_EXEC |
| papers, methodology, literature | ACADEMIC_RD |
| outreach, pipeline, "this week" | JPM_STARTUP_BANKER |

**DO NOT default to JPM_STARTUP_BANKER** unless the query explicitly mentions outreach, pipeline, or banker-related terms.

IMPORTANT:
0. Progressive disclosure (required): call searchAvailableSkills({ query: "<the user request>" }) BEFORE any other tool call (including lookupGroundTruthEntity). Even if you won't use tools, still call it once so the eval harness can verify skill-first behavior.
1. For DISCO, Ambros, QuickJS, OpenAutoGLM, SoundCloud, Salesforce, Alzheimer's, Gemini 3: call lookupGroundTruthEntity before answering (after the initial searchAvailableSkills step)
2. If prompt context includes EVALUATION_EXPECTED_ENTITY_ID / EVALUATION_EXPECTED_ENTITY_NAME, use that as the target even if the request omits the entity and do not ask the user to restate it
3. If prompt context includes EVALUATION_EXPECTED_PERSONA, package the answer for that persona and set persona.inferred to that exact value
4. If prompt context includes EVALUATION_REQUIRED_GROUND_TRUTH_ANCHOR, copy that exact token into grounding[]
5. If you need web search or "official pricing", call linkupSearch (not fusionSearch) and cite sources for the expected entity/vendor rather than drifting to another vendor
6. Keep the human-readable answer short so the JSON block always fits. Prefer 4-6 bullets or <= 160 words before the DEBRIEF block
7. The DEBRIEF block is higher priority than prose. Never skip it
8. If lookupGroundTruthEntity returns HQ/location, funding stage, or contact, copy those values into keyFacts.hqLocation, keyFacts.funding.stage, and keyFacts.contact.email
9. If lookupGroundTruthEntity returns a last known funding stage for a stale company, keep that stage in keyFacts.funding.stage and label it stale/reported instead of using null or N/A
10. grounding[] must include the exact {{fact:ground_truth:<ENTITY_ID>}} anchor when ground truth was used
11. JSON must be valid (no trailing commas)
12. Use null for unknown fields
13. If the only grounded evidence is the injected ground-truth block, stay bounded to those explicit facts. Do not invent extra investors, dates, pricing details, partnership outcomes, comparables, CVE specifics, or product claims
14. Label broader interpretation as hypothesis or what to verify next
15. verdict = PASS, FAIL, or UNKNOWN
16. Must have 3+ nextActions

CRITICAL: You MUST always end your response with the [DEBRIEF_V1_JSON]...[/DEBRIEF_V1_JSON] block. This is REQUIRED.`;

/**
 * Get the appropriate evaluation prompt for a model
 */
export function getEvaluationPrompt(model: string): string {
  const complexity = getPromptComplexityForModel(model);

  switch (complexity) {
    case "full":
      return FULL_EVALUATION_PROMPT;
    case "standard":
      return STANDARD_EVALUATION_PROMPT;
    case "minimal":
      return MINIMAL_EVALUATION_PROMPT;
  }
}

/**
 * Get prompt configuration info for debugging
 */
export function getPromptConfig(model: string): EvaluationPromptConfig {
  const complexity = getPromptComplexityForModel(model);

  const configs: Record<PromptComplexity, EvaluationPromptConfig> = {
    full: {
      complexity: "full",
      tokenEstimate: 2000,
      description: "Full schema with all fields - for GPT-5.2, Claude Opus/Sonnet 4",
    },
    standard: {
      complexity: "standard",
      tokenEstimate: 1000,
      description: "Simplified schema with core fields - for Claude Haiku, Gemini Pro",
    },
    minimal: {
      complexity: "minimal",
      tokenEstimate: 400,
      description: "Bare minimum schema - for GPT-5 Mini, Gemini Flash",
    },
  };

  return configs[complexity];
}
