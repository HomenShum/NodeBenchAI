/**
 * extendedThinkingRunner — pure helpers for orchestrating multi-checkpoint
 * Claude extended-thinking runs.
 *
 * The long-horizon pitch ("drop in 'Anthropic' → watch a 90-minute autonomous
 * build of an exec brief") can't live in a single Convex action because
 * Convex caps individual action wall-clock. Instead we chain short
 * checkpoints via ctx.scheduler.runAfter: each checkpoint is ONE Claude
 * extended-thinking call (~30s-3min), its output is persisted, and the
 * next checkpoint is scheduled immediately. Eight to thirty-six checkpoints
 * combine into a multi-hour run that survives any single action boundary.
 *
 * This module owns:
 *   - Prompt construction (system + user messages per checkpoint)
 *   - Response parsing (findings, sources, research_complete signal)
 *   - Deterministic checkpoint sequencing rules
 *
 * It does NOT call the network. The Convex action in
 * convex/domains/product/extendedThinking.ts owns I/O.
 *
 * Role (.claude/rules/agentic_reliability.md):
 *   - BOUND: prompt building caps input sizes; response parsing caps
 *     finding counts. MAX_CHECKPOINTS enforced by the Convex runner.
 *   - HONEST_STATUS: parser returns { ok: true | false, reason } rather
 *     than defaulting to "empty finding". Research-complete detection is
 *     explicit, not inferred.
 *   - DETERMINISTIC: same input (goal + prior checkpoints) yields the
 *     same prompt byte-for-byte. The Anthropic response itself is
 *     stochastic — we keep that boundary crisp so replays can detect
 *     prompt drift vs model drift.
 */

export const EXTENDED_PROMPT_VERSION = "ext-think-v1";

/** Hard safety caps — Convex actions have wall-clock limits. */
export const MAX_CHECKPOINTS = 36;
export const MAX_THINKING_BUDGET_TOKENS = 10_000;
export const MAX_OUTPUT_TOKENS = 4_000;
export const MAX_FINDINGS_PER_CHECKPOINT = 10;
export const MAX_FINDING_LEN = 600;
export const MAX_PRIOR_FINDINGS_INCLUDED = 40;

/** Input for each checkpoint. */
export type CheckpointPromptInput = {
  /** Stable run identifier — included in prompt for traceability. */
  runId: string;
  /** Company / entity being researched. */
  entityLabel: string;
  /** High-level goal from the user. */
  goal: string;
  /** 1-based checkpoint index. */
  checkpointIndex: number;
  /** Total planned checkpoints (user-configurable up to MAX_CHECKPOINTS). */
  totalCheckpoints: number;
  /**
   * Findings extracted from all prior checkpoints. The runner includes at
   * most MAX_PRIOR_FINDINGS_INCLUDED newest-first so the prompt stays
   * bounded even on 36-checkpoint runs.
   */
  priorFindings: ReadonlyArray<{ text: string; sourceRefId?: string }>;
  /**
   * Optional per-checkpoint focus hint — e.g. "founder background",
   * "patent portfolio". If absent the model is told to pick the next
   * highest-value sub-goal.
   */
  focus?: string;
};

export type CheckpointPrompt = {
  system: string;
  user: string;
  promptHash: string;
};

export type CheckpointOutput = {
  /** Newly surfaced findings in this checkpoint. */
  findings: ReadonlyArray<{ text: string; sourceRefId?: string }>;
  /** Suggested focus for the next checkpoint, if any. */
  nextFocus?: string;
  /** True when the model explicitly signaled the research is complete. */
  researchComplete: boolean;
  /** Short one-liner the UI shows as the checkpoint title. */
  headline: string;
  /** Optional reasoning summary (not full thinking trace). */
  reasoning?: string;
};

export type ParseOutcome =
  | { ok: true; result: CheckpointOutput }
  | { ok: false; error: string };

/* --------------------------------------------------------------------------
 * Prompt construction
 * ------------------------------------------------------------------------ */

function truncate(value: string | undefined, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : value.slice(0, max) + "…";
}

function formatPriorFindings(
  findings: CheckpointPromptInput["priorFindings"],
): string {
  if (findings.length === 0) return "(no prior findings — this is the first checkpoint)";
  const limited = findings.slice(0, MAX_PRIOR_FINDINGS_INCLUDED);
  return limited
    .map(
      (f, i) =>
        `${i + 1}. ${truncate(f.text, MAX_FINDING_LEN)}${
          f.sourceRefId ? ` [ref:${f.sourceRefId}]` : ""
        }`,
    )
    .join("\n");
}

function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return `djb2-${(hash >>> 0).toString(16)}`;
}

export function buildCheckpointPrompt(
  input: CheckpointPromptInput,
): CheckpointPrompt {
  const system = [
    "You are an autonomous research agent running a multi-checkpoint",
    "diligence investigation. Each checkpoint is one Anthropic extended-",
    "thinking call — you think deeply, then emit findings in a strict",
    "JSON envelope. The orchestrator chains checkpoints via a scheduler,",
    "so your output is the durable audit trail — ONLY include claims you",
    "can back with a source or explicitly flag as a hypothesis.",
    "",
    "Response format (JSON ONLY, no prose before/after):",
    "{",
    '  "headline": "one-line summary of what this checkpoint discovered",',
    '  "findings": [',
    '    { "text": "<specific claim>", "sourceRefId": "<optional ref>" }',
    "  ],",
    '  "nextFocus": "what the next checkpoint should dig into",',
    '  "researchComplete": false,',
    '  "reasoning": "<optional 1-3 sentence summary of your thinking>"',
    "}",
    "",
    'Set "researchComplete": true ONLY when a reasonable diligence brief',
    "could be written from the accumulated findings — do not stop early.",
    "Do not fabricate source refs. Write tight, verifiable claims.",
  ].join("\n");

  const userParts = [
    `Run ID: ${input.runId}`,
    `Entity: ${input.entityLabel}`,
    `Checkpoint: ${input.checkpointIndex}/${input.totalCheckpoints}`,
    "",
    "Goal:",
    truncate(input.goal, 2_000),
    "",
    "Prior findings (newest first, capped):",
    formatPriorFindings(input.priorFindings),
    "",
    input.focus
      ? `Focus for THIS checkpoint: ${truncate(input.focus, 500)}`
      : "No focus supplied — pick the next highest-value sub-goal given prior findings.",
  ];
  const user = userParts.join("\n");

  return {
    system,
    user,
    promptHash: djb2Hash(`${EXTENDED_PROMPT_VERSION}::${system}::${user}`),
  };
}

/* --------------------------------------------------------------------------
 * Response parsing
 * ------------------------------------------------------------------------ */

function extractJsonObject(raw: string): string | null {
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

function sanitizeFinding(raw: unknown): { text: string; sourceRefId?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (text.length === 0) return null;
  const capped = text.length > MAX_FINDING_LEN ? text.slice(0, MAX_FINDING_LEN) + "…" : text;
  const sourceRefId =
    typeof obj.sourceRefId === "string" && obj.sourceRefId.trim().length > 0
      ? obj.sourceRefId.trim().slice(0, 120)
      : undefined;
  return { text: capped, sourceRefId };
}

export function parseCheckpointResponse(raw: string): ParseOutcome {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "empty response" };
  }
  if (raw.length > 200_000) {
    return { ok: false, error: `response too large (${raw.length} bytes)` };
  }
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, error: "no JSON object in response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "response is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;

  const headlineRaw = obj.headline;
  if (typeof headlineRaw !== "string" || headlineRaw.trim().length === 0) {
    return { ok: false, error: "missing `headline`" };
  }
  const headline = headlineRaw.trim().slice(0, 240);

  const findingsRaw = obj.findings;
  if (!Array.isArray(findingsRaw)) {
    return { ok: false, error: "`findings` must be an array" };
  }
  const findings: Array<{ text: string; sourceRefId?: string }> = [];
  for (const item of findingsRaw.slice(0, MAX_FINDINGS_PER_CHECKPOINT)) {
    const clean = sanitizeFinding(item);
    if (clean) findings.push(clean);
  }

  const nextFocusRaw = obj.nextFocus;
  const nextFocus =
    typeof nextFocusRaw === "string" && nextFocusRaw.trim().length > 0
      ? nextFocusRaw.trim().slice(0, 500)
      : undefined;

  const reasoningRaw = obj.reasoning;
  const reasoning =
    typeof reasoningRaw === "string" && reasoningRaw.trim().length > 0
      ? reasoningRaw.trim().slice(0, 600)
      : undefined;

  const researchComplete = obj.researchComplete === true;

  return {
    ok: true,
    result: {
      headline,
      findings,
      nextFocus,
      researchComplete,
      reasoning,
    },
  };
}

/** Decide whether to schedule another checkpoint. Deterministic. */
export function shouldContinue(args: {
  currentCheckpoint: number;
  totalCheckpoints: number;
  researchComplete: boolean;
  thinkingTokensUsed: number;
  thinkingBudgetTokens: number;
}): { continue: boolean; reason: string } {
  if (args.researchComplete) {
    return { continue: false, reason: "model signaled research_complete" };
  }
  if (args.currentCheckpoint >= args.totalCheckpoints) {
    return { continue: false, reason: `reached planned checkpoint limit (${args.totalCheckpoints})` };
  }
  if (args.currentCheckpoint >= MAX_CHECKPOINTS) {
    return { continue: false, reason: `reached hard MAX_CHECKPOINTS (${MAX_CHECKPOINTS})` };
  }
  if (args.thinkingTokensUsed >= args.thinkingBudgetTokens) {
    return {
      continue: false,
      reason: `thinking token budget exhausted (${args.thinkingTokensUsed}/${args.thinkingBudgetTokens})`,
    };
  }
  return { continue: true, reason: "checkpoint limit not yet reached" };
}
