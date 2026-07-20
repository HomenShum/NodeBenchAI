/**
 * diligenceJudge — deterministic boolean-gate judge over projection emissions
 * and run telemetry.
 *
 * Role: Agentic Systems Reliability Engineer — verify every orchestrator run
 *       against a fixed set of gates so the eval signal is deterministic,
 *       reproducible, and agent-legible. No vibe scoring.
 *
 * Design posture (from .claude/rules/agentic_reliability.md):
 *   - HONEST_SCORES: every gate returns a real boolean derived from actual
 *     inputs. No hardcoded `passed: true` floors.
 *   - DETERMINISTIC: same telemetry produces the same verdict byte-for-byte.
 *     Gates never read wall-clock time, never call LLMs, never randomize.
 *   - HONEST_STATUS: when a gate cannot evaluate (missing input), we return
 *     `skipped` — never a false pass.
 *
 * Consumers:
 *   - server/pipeline/diligenceProjectionWriter.ts — runs the judge inline
 *     after every emit, attaches the verdict to the batch outcome.
 *   - convex/domains/product/diligenceJudge.ts — re-runs the judge over any
 *     historical RunTelemetry row so we can score past runs retroactively.
 *   - docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md — cites the gate
 *     catalog as the contract.
 *
 * NOT in scope (by design):
 *   - LLM judging (kept out so this file stays deterministic). The LLM path
 *     lives in convex/domains/product/diligenceJudge.ts as a separate action
 *     that WRAPS this function and annotates the non-deterministic
 *     dimensions (e.g., prose quality, citation quality).
 */
import type { EmitProjectionArgs, EmitProjectionResult } from "./diligenceProjectionWriter";

/** Single telemetry record emitted per projection write attempt. */
export type RunTelemetry = {
  /** ms since epoch when emit started. */
  startedAt: number;
  /** ms since epoch when emit finished (success or error). */
  endedAt: number;
  /** Number of tool calls made during the structuring pass that produced this projection. */
  toolCalls?: number;
  /** Tokens consumed by the LLM that produced the prose/payload, if known. */
  tokensIn?: number;
  tokensOut?: number;
  /** Number of source refs merged into the projection. */
  sourceCount?: number;
  /** Non-empty when the emit failed. */
  errorMessage?: string;
};

/** Canonical gate names. Add new gates ONLY by extending this union — never rename. */
export type GateName =
  | "hasValidTier"
  | "hasStableScratchpadRunId"
  | "hasMonotonicVersion"
  | "hasHeader"
  | "tierMatchesBodyProse"
  | "latencyWithinBudget"
  | "reportsToolCalls"
  | "reportsTokenCounts"
  | "capturedSources"
  | "emitStatusIsTerminal";

export type GateResult = {
  name: GateName;
  status: "pass" | "fail" | "skipped";
  /** Human-readable reason — agents and humans both read this. */
  reason: string;
};

export type JudgeVerdict = {
  /** Overall verdict — bounded enum. Mirrors AGENT_RUN_VERDICT_WORKFLOW.md values. */
  verdict: "verified" | "provisionally_verified" | "needs_review" | "failed";
  /** Count of gates that passed / failed / were skipped — for dashboards. */
  passCount: number;
  failCount: number;
  skipCount: number;
  /** Per-gate breakdown — stable ordering matches GATE_ORDER. */
  gates: ReadonlyArray<GateResult>;
  /** Deterministic score: passCount / evaluatedCount (skipped gates are excluded). */
  score: number;
  /** Budget used for the latency gate — exposed so telemetry dashboards can show it. */
  latencyBudgetMs: number;
};

export type JudgeInput = {
  args: EmitProjectionArgs;
  result?: EmitProjectionResult;
  telemetry: RunTelemetry;
  /** Optional previous version number seen for (entitySlug, blockType) — used for monotonicity check. */
  priorVersion?: number;
  /** Latency budget. Defaults to 30s — a structuring pass should never take longer. */
  latencyBudgetMs?: number;
};

const DEFAULT_LATENCY_BUDGET_MS = 30_000;
const MIN_BODY_PROSE_FOR_VERIFIED = 40; // chars — verified tier demands real prose, not a stub
const MIN_BODY_PROSE_FOR_CORROBORATED = 20;

/** Stable gate ordering — dashboards rely on this. Do not reshuffle without a migration. */
const GATE_ORDER: ReadonlyArray<GateName> = [
  "hasValidTier",
  "hasStableScratchpadRunId",
  "hasMonotonicVersion",
  "hasHeader",
  "tierMatchesBodyProse",
  "latencyWithinBudget",
  "reportsToolCalls",
  "reportsTokenCounts",
  "capturedSources",
  "emitStatusIsTerminal",
];

function gate(name: GateName, status: GateResult["status"], reason: string): GateResult {
  return { name, status, reason };
}

function evaluateHasValidTier(input: JudgeInput): GateResult {
  const tier = input.args.overallTier;
  const valid = ["verified", "corroborated", "single-source", "unverified"].includes(tier);
  return valid
    ? gate("hasValidTier", "pass", `tier=${tier}`)
    : gate("hasValidTier", "fail", `unknown tier: ${String(tier)}`);
}

function evaluateHasStableScratchpadRunId(input: JudgeInput): GateResult {
  const id = input.args.scratchpadRunId;
  if (!id || id.trim().length === 0) {
    return gate("hasStableScratchpadRunId", "fail", "scratchpadRunId missing");
  }
  // Stability heuristic: must have at least 3 chars and be a single token (no whitespace).
  if (id.trim().length < 3 || /\s/.test(id)) {
    return gate("hasStableScratchpadRunId", "fail", `unstable id shape: ${JSON.stringify(id)}`);
  }
  return gate("hasStableScratchpadRunId", "pass", `id=${id}`);
}

function evaluateHasMonotonicVersion(input: JudgeInput): GateResult {
  if (typeof input.args.version !== "number" || Number.isNaN(input.args.version)) {
    return gate("hasMonotonicVersion", "fail", "version is not a number");
  }
  if (input.args.version < 0) {
    return gate("hasMonotonicVersion", "fail", `negative version: ${input.args.version}`);
  }
  if (input.priorVersion !== undefined) {
    if (input.args.version <= input.priorVersion) {
      return gate(
        "hasMonotonicVersion",
        "fail",
        `version ${input.args.version} not greater than prior ${input.priorVersion}`,
      );
    }
  }
  return gate("hasMonotonicVersion", "pass", `version=${input.args.version}`);
}

function evaluateHasHeader(input: JudgeInput): GateResult {
  const header = input.args.headerText?.trim() ?? "";
  if (header.length === 0) {
    return gate("hasHeader", "fail", "headerText missing");
  }
  if (header.length > 120) {
    return gate("hasHeader", "fail", `headerText too long (${header.length} chars)`);
  }
  return gate("hasHeader", "pass", `header="${header}"`);
}

function evaluateTierMatchesBodyProse(input: JudgeInput): GateResult {
  const tier = input.args.overallTier;
  const prose = input.args.bodyProse?.trim() ?? "";
  if (tier === "verified" && prose.length < MIN_BODY_PROSE_FOR_VERIFIED) {
    return gate(
      "tierMatchesBodyProse",
      "fail",
      `verified tier but prose only ${prose.length} chars (min ${MIN_BODY_PROSE_FOR_VERIFIED})`,
    );
  }
  if (tier === "corroborated" && prose.length < MIN_BODY_PROSE_FOR_CORROBORATED) {
    return gate(
      "tierMatchesBodyProse",
      "fail",
      `corroborated tier but prose only ${prose.length} chars (min ${MIN_BODY_PROSE_FOR_CORROBORATED})`,
    );
  }
  return gate("tierMatchesBodyProse", "pass", `tier=${tier} prose=${prose.length} chars`);
}

function evaluateLatencyWithinBudget(input: JudgeInput): GateResult {
  const budget = input.latencyBudgetMs ?? DEFAULT_LATENCY_BUDGET_MS;
  const elapsed = input.telemetry.endedAt - input.telemetry.startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return gate("latencyWithinBudget", "skipped", "telemetry timestamps invalid");
  }
  if (elapsed > budget) {
    return gate(
      "latencyWithinBudget",
      "fail",
      `elapsed ${elapsed}ms exceeds budget ${budget}ms`,
    );
  }
  return gate("latencyWithinBudget", "pass", `elapsed=${elapsed}ms (budget ${budget}ms)`);
}

function evaluateReportsToolCalls(input: JudgeInput): GateResult {
  if (input.telemetry.toolCalls === undefined) {
    return gate("reportsToolCalls", "skipped", "toolCalls not reported");
  }
  if (input.telemetry.toolCalls < 0) {
    return gate("reportsToolCalls", "fail", `negative toolCalls: ${input.telemetry.toolCalls}`);
  }
  return gate("reportsToolCalls", "pass", `toolCalls=${input.telemetry.toolCalls}`);
}

function evaluateReportsTokenCounts(input: JudgeInput): GateResult {
  const { tokensIn, tokensOut } = input.telemetry;
  if (tokensIn === undefined && tokensOut === undefined) {
    return gate("reportsTokenCounts", "skipped", "token counts not reported");
  }
  if ((tokensIn ?? 0) < 0 || (tokensOut ?? 0) < 0) {
    return gate("reportsTokenCounts", "fail", `negative tokens in=${tokensIn} out=${tokensOut}`);
  }
  return gate(
    "reportsTokenCounts",
    "pass",
    `tokensIn=${tokensIn ?? 0} tokensOut=${tokensOut ?? 0}`,
  );
}

function evaluateCapturedSources(input: JudgeInput): GateResult {
  const count = input.telemetry.sourceCount;
  const tier = input.args.overallTier;
  if (count === undefined) {
    return gate("capturedSources", "skipped", "sourceCount not reported");
  }
  if (count < 0) {
    return gate("capturedSources", "fail", `negative sourceCount: ${count}`);
  }
  // Tier-aware floor: verified/corroborated must cite >= 1 source.
  if ((tier === "verified" || tier === "corroborated") && count === 0) {
    return gate("capturedSources", "fail", `${tier} tier with zero sources`);
  }
  return gate("capturedSources", "pass", `sourceCount=${count}`);
}

function evaluateEmitStatusIsTerminal(input: JudgeInput): GateResult {
  if (input.telemetry.errorMessage) {
    return gate("emitStatusIsTerminal", "fail", `emit errored: ${input.telemetry.errorMessage}`);
  }
  if (!input.result) {
    return gate("emitStatusIsTerminal", "skipped", "no result attached (dry-run?)");
  }
  const terminal = ["created", "updated", "stale"].includes(input.result.status);
  return terminal
    ? gate("emitStatusIsTerminal", "pass", `status=${input.result.status}`)
    : gate("emitStatusIsTerminal", "fail", `non-terminal status: ${String(input.result.status)}`);
}

/**
 * Evaluate every gate against the input. Deterministic — same input produces
 * the same verdict byte-for-byte. Never touches I/O, wall-clock, or randomness.
 */
export function judgeDiligenceRun(input: JudgeInput): JudgeVerdict {
  const evaluators: Record<GateName, (i: JudgeInput) => GateResult> = {
    hasValidTier: evaluateHasValidTier,
    hasStableScratchpadRunId: evaluateHasStableScratchpadRunId,
    hasMonotonicVersion: evaluateHasMonotonicVersion,
    hasHeader: evaluateHasHeader,
    tierMatchesBodyProse: evaluateTierMatchesBodyProse,
    latencyWithinBudget: evaluateLatencyWithinBudget,
    reportsToolCalls: evaluateReportsToolCalls,
    reportsTokenCounts: evaluateReportsTokenCounts,
    capturedSources: evaluateCapturedSources,
    emitStatusIsTerminal: evaluateEmitStatusIsTerminal,
  };

  const gates = GATE_ORDER.map((name) => evaluators[name](input));
  const passCount = gates.filter((g) => g.status === "pass").length;
  const failCount = gates.filter((g) => g.status === "fail").length;
  const skipCount = gates.filter((g) => g.status === "skipped").length;
  const evaluated = passCount + failCount;
  const score = evaluated === 0 ? 0 : passCount / evaluated;

  // Verdict tiers — bounded enum from AGENT_RUN_VERDICT_WORKFLOW.md.
  let verdict: JudgeVerdict["verdict"];
  if (failCount === 0 && passCount >= GATE_ORDER.length - 2) {
    // All evaluable gates pass AND at most 2 skipped — we're confident.
    verdict = "verified";
  } else if (failCount === 0) {
    // No failures but too many skipped — we trust what we saw but want more signal.
    verdict = "provisionally_verified";
  } else if (failCount <= 2) {
    // Minor failures — human should look.
    verdict = "needs_review";
  } else {
    verdict = "failed";
  }

  return {
    verdict,
    passCount,
    failCount,
    skipCount,
    gates,
    score,
    latencyBudgetMs: input.latencyBudgetMs ?? DEFAULT_LATENCY_BUDGET_MS,
  };
}

/** Re-export for callers that want the gate list without loading the evaluator. */
export const DILIGENCE_JUDGE_GATES: ReadonlyArray<GateName> = GATE_ORDER;
