/**
 * shared/llm/router.ts — NodeBench LLM Router (Prism-style planner-on-a-pool).
 *
 * One place every served LLM feature asks "which model for THIS turn?". A small
 * DETERMINISTIC planner reads a task class + cheap signals and picks from a
 * fixed, quality-targeted pool — matching Augment Prism's "you pick the router,
 * the router picks the model" shape, without paying an extra LLM call on the
 * latency-critical single-shot paths.
 *
 * Pattern: planner-on-a-pool model routing.
 * Prior art:
 *   - Augment "Prism" (2026) — a small planner routes each user turn across a
 *     pool tuned to a frontier quality target; cache-aware sticky switching is
 *     the hard part on long agent sessions.
 *     https://www.augmentcode.com/blog/augment-prism-model-routing-to-reduce-cost-and-maintain-quality
 *   - "Kilo Code" complexity routing — assessComplexity() -> model tier, already
 *     present in server/agentHarness.ts; this generalizes it into one entry point.
 *
 * NodeBench adaptation (what's DIFFERENT from Prism, and why it's easier here):
 *   Most of NodeBench's surface is SINGLE-SHOT (event /ask, query classify,
 *   extraction, QA judge) — independent requests with NO prompt cache to evict
 *   between them. Prism's ~10x "switching evicts the cache" penalty therefore
 *   does NOT apply to those paths, so we route per-request with a pure heuristic
 *   planner (zero added latency, no planner LLM call). Cache-aware stickiness —
 *   Prism's genuinely hard part — is reserved for the multi-turn agent loops
 *   (FastAgent, Convex agents) and layered ON TOP of this core in a later step.
 *
 * Routing direction:
 *   - ESCALATE-UP (default → floor, climb on complexity) is ALWAYS quality-safe
 *     and is what V1 ships (e.g. ask_answer floors at Haiku, climbs to Sonnet on
 *     hard/analytical/multi-entity questions). No eval gate needed to go up.
 *   - DEMOTE-DOWN (default → strong, drop to cheaper on clearly-light turns) is
 *     the cost lever for over-provisioned paths (e.g. a persona router pinning
 *     Opus for every turn). It is intentionally eval-GATED — only demote to a
 *     cheaper model that is CLEARED for the task class (a static conservative
 *     allowlist now; the live agentRunJudge/dogfood rolling-agreement feed plugs
 *     in via RouteOptions.clearance). Pools opt in with `mode: "demote"`. A pool
 *     with no cleared cheaper model stays on the target — quality never drops
 *     un-cleared. agent_reason is the first demote pool (no live caller yet).
 *
 * Reliability (.claude/rules/agentic_reliability.md):
 *   - DETERMINISTIC: routeLLM is a pure function of (taskClass, signals, env).
 *     No Date.now(), no Math.random() — same inputs always yield the same route.
 *   - HONEST: forceTarget and any uncertainty resolve UP to the quality target,
 *     never silently down.
 *   - BOUND: pools are fixed, finite literals.
 *
 * See docs/architecture/LLM_ROUTER.md.
 */

export type RouteProvider = "anthropic" | "google" | "openai" | "openrouter";
export type RouteTier = "light" | "balanced" | "heavy";

/**
 * Routing direction for a pool:
 *  - "escalate" (default): default to the cheap FLOOR, climb on complexity.
 *    Always quality-safe — going up never lowers quality.
 *  - "demote": default to the quality TARGET (heaviest), drop to a cheaper
 *    candidate on clearly-light turns — but ONLY to models that are eval-CLEARED
 *    for this task class. Fail-safe: nothing cleared → stay on target. This is
 *    the cost lever for over-provisioned paths (e.g. a persona router that pins
 *    Opus for every turn regardless of difficulty).
 */
export type RouteMode = "escalate" | "demote";

export type TaskClass =
  | "ask_answer" // event /ask synthesis — Haiku floor, escalate to Sonnet on hard Qs
  | "classify" // query intent classification — cheapest, latency-critical
  | "extract" // structured signal extraction from text
  | "synthesize" // final answer synthesis from a tool/retrieval trace
  | "agent_reason" // multi-turn agent reasoning — strong target, demote on light turns
  | "judge"; // eval / QA scoring — cheap but calibrated

export interface RouteCandidate {
  /** The EXACT provider model id sent on the wire (not an internal alias). */
  model: string;
  provider: RouteProvider;
  tier: RouteTier;
  /** Relative $ weight within this pool (floor candidate = 1). Telemetry only. */
  relCost: number;
}

export interface TaskPool {
  /** Ordered lightest -> heaviest. candidates[0] is the cost floor. */
  candidates: RouteCandidate[];
  /** Routing direction. Defaults to "escalate". See RouteMode. */
  mode?: RouteMode;
}

export interface RouteSignals {
  /** Length of the prompt / question in characters. */
  inputChars?: number;
  /** Number of retrieval sources to synthesize over. */
  sourceCount?: number;
  /** Upstream complexity assessment, if the caller already has one. */
  complexityHint?: "low" | "medium" | "high";
  /** Comparison / multi-subject query ("X vs Y", "compare ..."). */
  multiEntity?: boolean;
  /** The answer needs fresh/external data. */
  freshnessRequired?: boolean;
  /** Caller demands top quality regardless of signals (high-stakes). */
  forceTarget?: boolean;
}

export interface RouteDecision {
  taskClass: TaskClass;
  model: string;
  provider: RouteProvider;
  tier: RouteTier;
  /** 0..1 complexity score that drove the decision. */
  score: number;
  /** Did we route above the pool floor (escalate mode)? */
  escalated: boolean;
  /** Did we route BELOW the quality target (demote mode, eval-cleared)? */
  demoted: boolean;
  reason: string;
}

// Climb above the floor once complexity crosses this; reach the heaviest tier at
// HEAVY_THRESHOLD. Tuned conservatively: only genuinely hard turns escalate.
export const ESCALATE_THRESHOLD = 0.5;
export const HEAVY_THRESHOLD = 0.8;

// In demote-mode pools, only drop below the quality target on clearly-light
// turns — conservative, so only obviously-trivial work is demoted.
export const DEMOTE_THRESHOLD = 0.25;

/**
 * Static, CONSERVATIVE demote clearance: which cheaper models are known
 * quality-safe to demote to for a given task class, keyed "taskClass::model".
 * This is the SAFE default until the live eval feed (agentRunJudge / dogfood
 * rolling agreement) is wired via RouteOptions.clearance. Only pairs we are
 * confident hold quality on LIGHT turns belong here — when in doubt, omit it and
 * the router stays on the target model.
 */
export const DEMOTE_CLEARANCE: Record<string, boolean> = {
  // A capable mid model handles trivially-light agent turns; the heavy target
  // (Opus) is reserved for genuinely hard reasoning.
  "agent_reason::claude-sonnet-4-6": true,
};

export interface RouteOptions {
  /**
   * Live eval-clearance hook. Returns whether demoting to `model` is quality-safe
   * for `taskClass` RIGHT NOW — e.g. backed by agentRunJudge rolling agreement
   * against the target. When provided it OVERRIDES the static DEMOTE_CLEARANCE
   * table. This is the seam the eval-feedback layer plugs into.
   */
  clearance?: (taskClass: TaskClass, model: string) => boolean;
}

function isDemoteCleared(taskClass: TaskClass, model: string, opts: RouteOptions): boolean {
  if (opts.clearance) return opts.clearance(taskClass, model);
  return DEMOTE_CLEARANCE[`${taskClass}::${model}`] === true;
}

/** Pure env read (no Date/random). Lets ops pin or retune without a deploy. */
function envModel(name: string, fallback: string): string {
  const raw =
    typeof process !== "undefined" && process && process.env ? process.env[name] : undefined;
  return (raw || "").trim() || fallback;
}

/**
 * The pools. IDs are the EXACT strings each provider's API expects. Floors are
 * pinned to CURRENT production behavior, so routing a call site through here is
 * a no-op until signals say otherwise.
 *
 * Only `ask_answer` is wired into a live call site in V1. The rest are the
 * documented target-state pools the next PRs wire their call sites into.
 */
export function getPools(): Record<TaskClass, TaskPool> {
  return {
    ask_answer: {
      candidates: [
        {
          model: envModel("SCRATCHNODE_ASK_MODEL_LIGHT", "claude-haiku-4-5-20251001"),
          provider: "anthropic",
          tier: "light",
          relCost: 1,
        },
        {
          model: envModel("SCRATCHNODE_ASK_MODEL_HEAVY", "claude-sonnet-4-6"),
          provider: "anthropic",
          tier: "heavy",
          relCost: 3,
        },
      ],
    },
    classify: {
      candidates: [
        { model: "gemini-3.1-flash-lite-preview", provider: "google", tier: "light", relCost: 1 },
      ],
    },
    extract: {
      candidates: [
        { model: "gemini-3.1-flash-lite-preview", provider: "google", tier: "light", relCost: 1 },
        { model: "gemini-3-flash-preview", provider: "google", tier: "balanced", relCost: 2 },
      ],
    },
    synthesize: {
      candidates: [
        { model: "gemini-3.1-flash-lite-preview", provider: "google", tier: "light", relCost: 1 },
        { model: "gemini-3-flash-preview", provider: "google", tier: "balanced", relCost: 2 },
      ],
    },
    agent_reason: {
      // DEMOTE pool: the default IS the quality target (Opus); only clearly-light
      // turns drop to the eval-cleared mid model (Sonnet). Models the over-
      // provisioned persona/agent path (pins the top model for every turn).
      mode: "demote",
      candidates: [
        { model: "claude-sonnet-4-6", provider: "anthropic", tier: "balanced", relCost: 1 },
        { model: "claude-opus-4-7", provider: "anthropic", tier: "heavy", relCost: 5 },
      ],
    },
    judge: {
      candidates: [
        { model: "gemini-3-flash-preview", provider: "google", tier: "light", relCost: 1 },
        { model: "claude-haiku-4-5-20251001", provider: "anthropic", tier: "balanced", relCost: 2 },
      ],
    },
  };
}

/**
 * Deterministic complexity score in [0,1] from cheap signals. No model call.
 * Additive + capped so it's monotonic: more/heavier signals never lower the score.
 */
export function computeComplexityScore(signals: RouteSignals = {}): number {
  let n = 0;
  if (signals.complexityHint === "high") n += 0.5;
  else if (signals.complexityHint === "medium") n += 0.25;
  const chars = signals.inputChars ?? 0;
  if (chars > 600) n += 0.3;
  else if (chars > 240) n += 0.15;
  const sources = signals.sourceCount ?? 0;
  if (sources > 8) n += 0.25;
  else if (sources > 4) n += 0.12;
  if (signals.multiEntity) n += 0.3;
  if (signals.freshnessRequired) n += 0.1;
  return Math.min(1, Number(n.toFixed(4)));
}

function decide(
  taskClass: TaskClass,
  c: RouteCandidate,
  score: number,
  reason: string,
  escalated: boolean,
  demoted: boolean,
): RouteDecision {
  return {
    taskClass,
    model: c.model,
    provider: c.provider,
    tier: c.tier,
    score,
    escalated,
    demoted,
    reason,
  };
}

/**
 * Pick the model for a task class given cheap signals. Pure + deterministic.
 *
 * - forceTarget -> the heaviest candidate (quality target, fail-safe).
 * - else climb from the floor by complexity score:
 *     score >= HEAVY_THRESHOLD  -> heaviest
 *     score >= ESCALATE_THRESHOLD -> next tier up from floor (if any)
 *     otherwise                  -> floor
 */
export function routeLLM(
  taskClass: TaskClass,
  signals: RouteSignals = {},
  opts: RouteOptions = {},
): RouteDecision {
  const pool = getPools()[taskClass];
  const candidates = pool.candidates;
  const floor = candidates[0];
  const heaviest = candidates[candidates.length - 1];
  const mode: RouteMode = pool.mode ?? "escalate";

  // forceTarget always lands on the quality target (heaviest), regardless of mode.
  if (signals.forceTarget) {
    const escalated = mode === "escalate" && heaviest.model !== floor.model;
    return decide(taskClass, heaviest, 1, "forced quality target (high-stakes / caller override)", escalated, false);
  }

  const score = computeComplexityScore(signals);

  if (mode === "demote") {
    // Default IS the quality target (heaviest). Only on clearly-light turns drop
    // to the cheapest demote-CLEARED candidate below the target. Fail-safe:
    // nothing cleared → stay on target (never sacrifice quality un-cleared).
    let chosen = heaviest;
    if (score < DEMOTE_THRESHOLD) {
      for (const c of candidates) {
        if (c.model === heaviest.model) break; // reached the target — stop
        if (isDemoteCleared(taskClass, c.model, opts)) {
          chosen = c;
          break;
        }
      }
    }
    const demoted = chosen.model !== heaviest.model;
    const reason = demoted
      ? `demoted to ${chosen.tier} (complexity ${score.toFixed(2)}, eval-cleared)`
      : `target ${heaviest.tier} (complexity ${score.toFixed(2)})`;
    return decide(taskClass, chosen, score, reason, false, demoted);
  }

  // escalate mode (default): climb from the floor on complexity.
  let chosen = floor;
  if (score >= HEAVY_THRESHOLD) {
    chosen = heaviest;
  } else if (score >= ESCALATE_THRESHOLD && candidates.length > 1) {
    chosen = candidates[1];
  }
  const escalated = chosen.model !== floor.model || chosen.tier !== floor.tier;
  const reason = escalated
    ? `escalated to ${chosen.tier} (complexity ${score.toFixed(2)})`
    : `floor ${floor.tier} (complexity ${score.toFixed(2)})`;
  return decide(taskClass, chosen, score, reason, escalated, false);
}

// ── Per-task-class signal helpers ────────────────────────────────────────────

const ANALYTICAL_RE =
  /\b(compare|comparison|versus|vs\.?|trade-?offs?|why|how should|strateg(y|ic)|implications?|pros and cons|better or worse|risks?)\b/i;
const MULTI_ENTITY_RE = /\bvs\.?\b|\bversus\b|\bcompare\b|\bbetween\b .+ and /i;

/**
 * Derive ask_answer routing signals from the raw question + retrieved source
 * count. Short factual lookups stay on the Haiku floor; long, analytical, or
 * multi-entity questions escalate to Sonnet.
 */
export function askAnswerSignals(question: string, sourceCount: number): RouteSignals {
  const q = (question || "").trim();
  const analytical = ANALYTICAL_RE.test(q);
  return {
    inputChars: q.length,
    sourceCount,
    multiEntity: MULTI_ENTITY_RE.test(q),
    complexityHint: analytical ? "high" : q.length > 160 ? "medium" : "low",
  };
}
