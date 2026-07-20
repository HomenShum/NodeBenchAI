/**
 * diligenceLlmJudge — non-deterministic semantic judge layered on top of the
 * deterministic boolean-gate judge.
 *
 * Role (agentic_reliability.md):
 *   - HONEST_SCORES: scores are parsed directly from LLM output; on parse
 *     failure we return { ok: false } rather than defaulting to 0.5. No
 *     hardcoded floors.
 *   - BOUND: every text field has a character cap; parse rejects oversized
 *     payloads (a rogue LLM can't OOM us).
 *   - DETERMINISTIC wrapping: the LLM itself is stochastic, but the prompt
 *     is a pure fn of inputs and we hash it (promptHash) so replays can
 *     tell whether a score changed because of the prompt or because of the
 *     model. The validator + parser are pure deterministic code.
 *   - ERROR_BOUNDARY: the caller owns the fetch; this module only builds
 *     prompts and parses responses. No network I/O here.
 *   - Reference attribution (reference_attribution.md): the scoring
 *     dimensions are adapted from:
 *       - Deepchecks claim-level grounding verification
 *       - Anthropic RLHF rubric (helpful / harmless / honest)
 *       - Vertex AI grounding pipeline research
 *
 * Non-goals:
 *   - Replacing the deterministic judge. The deterministic judge stays the
 *     source of truth for verdict tier. This module's output is auxiliary
 *     — think of it as peer review notes hanging off the verdict.
 *   - Making scoring calls. That lives in the Convex internalAction that
 *     wraps this module (convex/domains/product/diligenceLlmJudgeRuns.ts).
 */

/** Bump when the prompt structure or dimension set changes. Stored with
 *  every run so dashboards can separate "old prompt" from "new prompt" cohorts. */
export const JUDGE_PROMPT_VERSION = "llmjudge-v1";

/** Hard caps — BOUND invariant. A rogue LLM must not OOM us. */
const MAX_PROSE_LEN = 8_000;
const MAX_SOURCE_LINES = 20;
const MAX_STRENGTHS = 5;
const MAX_CONCERNS = 5;
const MAX_STRENGTH_CONCERN_LEN = 240;
const MAX_NEXT_STEP_LEN = 240;
const MAX_REASON_LEN = 480;

export type LlmJudgeInput = {
  entitySlug: string;
  blockType: string;
  overallTier: "verified" | "corroborated" | "single-source" | "unverified" | string;
  headerText: string;
  bodyProse?: string;
  /**
   * Optional structured payload the orchestrator attached. Stringified inside
   * the prompt for the LLM to read — we don't require any particular shape.
   */
  payload?: unknown;
  /** Optional source snippets / URLs supplied with the projection. */
  sources?: ReadonlyArray<{ label?: string; url?: string; snippet?: string }>;
};

export type LlmJudgeScores = {
  proseQuality: number;
  citationCoherence: number;
  sourceCredibility: number;
  tierAppropriate: number;
  overallSemantic: number;
};

export type LlmJudgeResult = {
  scores: LlmJudgeScores;
  strengths: ReadonlyArray<string>;
  concerns: ReadonlyArray<string>;
  proposedNextStep: string;
  /** Short free-text justification tied to the overallSemantic score. */
  reason: string;
};

export type ParseOutcome =
  | { ok: true; result: LlmJudgeResult }
  | { ok: false; error: string };

/* --------------------------------------------------------------------------
 * Prompt construction — pure, deterministic.
 * ------------------------------------------------------------------------ */

function truncate(value: string | undefined, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : value.slice(0, max) + "…";
}

function safeStringifyPayload(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  try {
    const json = JSON.stringify(payload, null, 2);
    return truncate(json, 4_000);
  } catch {
    return "(payload could not be serialized)";
  }
}

function formatSources(sources?: LlmJudgeInput["sources"]): string {
  if (!sources || sources.length === 0) return "(no sources attached)";
  return sources
    .slice(0, MAX_SOURCE_LINES)
    .map((s, i) => {
      const label = s.label ?? s.url ?? `source ${i + 1}`;
      const snippet = truncate(s.snippet, 240);
      return snippet ? `- [${label}] ${snippet}` : `- [${label}]`;
    })
    .join("\n");
}

export function buildLlmJudgePrompt(input: LlmJudgeInput): string {
  const prose = truncate(input.bodyProse, MAX_PROSE_LEN);
  const payload = safeStringifyPayload(input.payload);
  const sources = formatSources(input.sources);

  // JSON-only response contract. Strict schema reduces parse variance.
  return [
    "You are reviewing one block of a company-intelligence projection.",
    "The orchestrator already ran a deterministic gate check; you are scoring",
    "the NON-deterministic dimensions that boolean gates cannot evaluate.",
    "",
    "Return ONLY a single JSON object, no prose before or after.",
    "",
    "Dimensions (every score is a float in [0, 1]):",
    "  - proseQuality: is the prose specific, readable, non-generic?",
    "  - citationCoherence: do claims line up with the attached sources?",
    "  - sourceCredibility: are the sources authoritative for this block?",
    "  - tierAppropriate: does the evidence actually justify the declared tier?",
    "  - overallSemantic: holistic quality across the four dimensions",
    "",
    "Also return:",
    `  - strengths: up to ${MAX_STRENGTHS} short bullets (≤ ${MAX_STRENGTH_CONCERN_LEN} chars each)`,
    `  - concerns: up to ${MAX_CONCERNS} short bullets a reviewer should double-check`,
    `  - proposedNextStep: one actionable sentence (≤ ${MAX_NEXT_STEP_LEN} chars)`,
    `  - reason: short justification for overallSemantic (≤ ${MAX_REASON_LEN} chars)`,
    "",
    "Be critical but calibrated. Do not inflate scores to be polite.",
    "If sources are missing or weak, citationCoherence and sourceCredibility",
    "MUST drop below 0.5 — HONEST SCORES only.",
    "",
    "JSON shape:",
    "{",
    '  "scores": {',
    '    "proseQuality": 0.0,',
    '    "citationCoherence": 0.0,',
    '    "sourceCredibility": 0.0,',
    '    "tierAppropriate": 0.0,',
    '    "overallSemantic": 0.0',
    "  },",
    '  "strengths": ["..."],',
    '  "concerns": ["..."],',
    '  "proposedNextStep": "...",',
    '  "reason": "..."',
    "}",
    "",
    "--- PROJECTION CONTEXT ---",
    `entitySlug: ${input.entitySlug}`,
    `blockType: ${input.blockType}`,
    `declaredTier: ${input.overallTier}`,
    `header: ${input.headerText}`,
    "",
    "--- PROSE ---",
    prose || "(no prose attached)",
    "",
    "--- PAYLOAD ---",
    payload || "(no payload attached)",
    "",
    "--- SOURCES ---",
    sources,
  ].join("\n");
}

/**
 * Small deterministic hash so different prompts can be bucketed in dashboards.
 * NOT cryptographic — just a cheap fingerprint (DJB2-style) that's stable
 * across machines.
 */
export function promptHashOf(prompt: string): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return `djb2-${(hash >>> 0).toString(16)}`;
}

/* --------------------------------------------------------------------------
 * Response parsing — pure, deterministic, bounded.
 * ------------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceScore(value: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return { ok: false, error: `score "${label}" is not a number` };
  }
  if (value < 0 || value > 1) {
    return { ok: false, error: `score "${label}" = ${value} is outside [0, 1]` };
  }
  return { ok: true, value };
}

function sanitizeStringList(
  raw: unknown,
  maxItems: number,
  maxLen: number,
): { ok: true; value: ReadonlyArray<string> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "expected an array" };
  const cleaned: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    cleaned.push(trimmed.length > maxLen ? trimmed.slice(0, maxLen) + "…" : trimmed);
  }
  return { ok: true, value: cleaned };
}

function extractJsonObject(raw: string): string | null {
  // LLMs often wrap JSON in ```json fences or include stray prose. Extract
  // the first balanced {...} span.
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const open = raw.indexOf("{");
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Parse a Gemini response into a typed LlmJudgeResult. Every failure mode
 * returns { ok: false, error } — the caller persists the parse error and
 * marks the run status = "parse_error" per HONEST_STATUS.
 */
export function parseLlmJudgeResponse(raw: string): ParseOutcome {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "empty response" };
  }
  if (raw.length > 200_000) {
    // BOUND_READ mirror — even though this is in-memory, we keep the same
    // discipline: don't attempt to parse absurd blobs.
    return { ok: false, error: `response too large (${raw.length} bytes)` };
  }

  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return { ok: false, error: "no JSON object found in response" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "response is not a JSON object" };
  }

  const scoresRaw = parsed["scores"];
  if (!isRecord(scoresRaw)) {
    return { ok: false, error: "missing `scores` object" };
  }

  const scoreFields = [
    "proseQuality",
    "citationCoherence",
    "sourceCredibility",
    "tierAppropriate",
    "overallSemantic",
  ] as const;

  const scores: Partial<LlmJudgeScores> = {};
  for (const field of scoreFields) {
    const outcome = coerceScore(scoresRaw[field], field);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    scores[field] = outcome.value;
  }

  const strengthsOutcome = sanitizeStringList(
    parsed["strengths"],
    MAX_STRENGTHS,
    MAX_STRENGTH_CONCERN_LEN,
  );
  if (!strengthsOutcome.ok)
    return { ok: false, error: `strengths: ${strengthsOutcome.error}` };

  const concernsOutcome = sanitizeStringList(
    parsed["concerns"],
    MAX_CONCERNS,
    MAX_STRENGTH_CONCERN_LEN,
  );
  if (!concernsOutcome.ok)
    return { ok: false, error: `concerns: ${concernsOutcome.error}` };

  const nextStepRaw = parsed["proposedNextStep"];
  if (nextStepRaw !== undefined && typeof nextStepRaw !== "string") {
    return { ok: false, error: "proposedNextStep must be a string" };
  }
  const proposedNextStep = truncate(
    typeof nextStepRaw === "string" ? nextStepRaw.trim() : "",
    MAX_NEXT_STEP_LEN,
  );

  const reasonRaw = parsed["reason"];
  if (reasonRaw !== undefined && typeof reasonRaw !== "string") {
    return { ok: false, error: "reason must be a string" };
  }
  const reason = truncate(
    typeof reasonRaw === "string" ? reasonRaw.trim() : "",
    MAX_REASON_LEN,
  );

  return {
    ok: true,
    result: {
      scores: scores as LlmJudgeScores,
      strengths: strengthsOutcome.value,
      concerns: concernsOutcome.value,
      proposedNextStep,
      reason,
    },
  };
}

/**
 * Validate an already-typed LlmJudgeScores payload. Used by the Convex
 * recordLlmJudgeScore mutation as defense-in-depth — even if a caller hand-
 * writes scores, we never persist out-of-range values.
 */
export function validateLlmJudgeScores(scores: LlmJudgeScores): void {
  for (const field of Object.keys(scores) as Array<keyof LlmJudgeScores>) {
    const v = scores[field];
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new Error(`llmJudge: ${field} is not a number`);
    }
    if (v < 0 || v > 1) {
      throw new Error(`llmJudge: ${field} = ${v} outside [0, 1]`);
    }
  }
}
