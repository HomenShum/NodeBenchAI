/**
 * Spiral Detector — A-PR-B.7 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Detects when the agent has fallen into a loop — calling the same tool
 * with the same (or near-identical) arguments multiple turns in a row
 * without making progress. When a spiral is detected we auto-capture a
 * SPIRAL lesson via `captureSpiralLesson` (A-PR-B.6) so the next turn's
 * system prompt explicitly tells the agent to break out of the loop.
 *
 * Two-layer design:
 *   1. `detectSpiral` — pure function. Takes an ordered list of turn
 *      summaries (newest last) and returns a `SpiralFinding` or `null`.
 *      Easy to unit test, no Convex dependency.
 *   2. `checkAndCaptureSpiral` — internalAction. Pulls the recent turn
 *      summaries via a query the agent runtime registers, runs the
 *      detector, and writes the lesson when a spiral is found.
 *
 * Detection rules (tunable):
 *   - WINDOW_SIZE = 3 — minimum number of consecutive same-signature
 *     turns that constitutes a spiral.
 *   - Signature = `${toolName}:${argsHash}` — argsHash is sha256 of the
 *     canonicalized JSON of the args (sorted keys).
 *   - When `artifactSha256` is present on every turn AND identical
 *     across the window, that's a "no progress" signal that upgrades
 *     confidence from `suspected` to `confirmed`.
 *   - When `artifactSha256` differs across the window, the loop is
 *     downgraded to `false_positive_progress` and we do NOT capture a
 *     lesson — the agent is iterating, not spiraling.
 *
 * HONEST_STATUS: never capture a lesson on `false_positive_progress`.
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════

/** Number of consecutive same-signature turns required to trip detection. */
export const SPIRAL_WINDOW_SIZE = 3;

/** Sliding window we inspect from the tail of the turn list. */
export const SPIRAL_LOOKBACK_TURNS = 6;

// ════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════

/**
 * Minimal per-turn summary the detector needs. The agent runtime is
 * responsible for assembling these from its own turn log.
 */
export interface TurnSummary {
  /** Monotonic turn id within the thread. */
  turnId: number;
  /** Tool the agent invoked on this turn (or `null` for tool-less turns). */
  toolName: string | null;
  /** Sha256 hex of the canonicalized JSON of the tool args. */
  argsHash: string | null;
  /**
   * Optional sha256 hex of the artifact state after this turn. When
   * supplied for every turn in the window it lets the detector tell
   * "spinning in place" apart from "iterating productively".
   */
  artifactSha256?: string | null;
}

export type SpiralVerdict =
  /** ≥ WINDOW_SIZE same-signature turns AND artifact sha unchanged. */
  | "confirmed"
  /** ≥ WINDOW_SIZE same-signature turns; artifact sha unknown. */
  | "suspected"
  /** Same-signature streak detected but artifact sha changed (good iteration). */
  | "false_positive_progress";

export interface SpiralFinding {
  verdict: SpiralVerdict;
  /** Tool the agent is looping on. */
  toolName: string;
  /** Signature hash that repeats. */
  signature: string;
  /** turnIds inside the streak (oldest → newest). */
  streakTurnIds: number[];
  /** Length of the matched streak. */
  streakLength: number;
  /** Message the lesson would carry. Caller can override. */
  mistakePattern: string;
  /** Suggested break-out instruction. Caller can override. */
  correctPattern: string;
}

// ════════════════════════════════════════════════════════════════════════
// PURE DETECTOR
// ════════════════════════════════════════════════════════════════════════

function buildSignature(turn: TurnSummary): string | null {
  if (!turn.toolName) return null;
  if (!turn.argsHash) return null;
  return `${turn.toolName}:${turn.argsHash}`;
}

/**
 * Inspect the tail of the supplied turn list. Returns a `SpiralFinding`
 * when a streak of ≥ `windowSize` identical signatures sits at the tail,
 * otherwise `null`.
 */
export function detectSpiral(
  turns: readonly TurnSummary[],
  windowSize: number = SPIRAL_WINDOW_SIZE,
): SpiralFinding | null {
  if (turns.length < windowSize) return null;

  // Walk backward from the newest turn collecting same-signature entries.
  const newest = turns[turns.length - 1];
  const signature = buildSignature(newest);
  if (!signature) return null;

  const streak: TurnSummary[] = [newest];
  for (let i = turns.length - 2; i >= 0; i -= 1) {
    if (buildSignature(turns[i]) !== signature) break;
    streak.push(turns[i]);
  }

  if (streak.length < windowSize) return null;

  // Order oldest → newest for downstream readability.
  streak.reverse();

  // Verdict: do all turns in the streak share an artifact sha?
  const artifactShas = streak
    .map((t) => t.artifactSha256)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  let verdict: SpiralVerdict = "suspected";
  if (artifactShas.length === streak.length) {
    const allSame = artifactShas.every((s) => s === artifactShas[0]);
    verdict = allSame ? "confirmed" : "false_positive_progress";
  }

  // HONEST_STATUS: don't pretend a productive iteration is a spiral.
  if (verdict === "false_positive_progress") {
    // We still surface the finding so callers can log telemetry, but the
    // capture path checks the verdict and skips the lesson write.
  }

  const toolName = streak[0].toolName ?? "(unknown)";
  const mistakePattern = `Called \`${toolName}\` ${streak.length} turns in a row with identical args; no observable progress on the artifact state`;
  const correctPattern = `Try a different tool, change the args meaningfully, or hand the user a structured "I'm stuck because X" message instead of looping`;

  return {
    verdict,
    toolName,
    signature,
    streakTurnIds: streak.map((t) => t.turnId),
    streakLength: streak.length,
    mistakePattern,
    correctPattern,
  };
}

// ════════════════════════════════════════════════════════════════════════
// CONVEX ACTION
// ════════════════════════════════════════════════════════════════════════

const turnSummaryValidator = v.object({
  turnId: v.number(),
  toolName: v.union(v.string(), v.null()),
  argsHash: v.union(v.string(), v.null()),
  artifactSha256: v.optional(v.union(v.string(), v.null())),
});

const findingReturnValidator = v.union(
  v.null(),
  v.object({
    verdict: v.union(
      v.literal("confirmed"),
      v.literal("suspected"),
      v.literal("false_positive_progress"),
    ),
    toolName: v.string(),
    signature: v.string(),
    streakLength: v.number(),
    capturedLessonId: v.union(v.id("agentLessons"), v.null()),
  }),
);

/**
 * Run the detector against the supplied turn summaries. When a spiral
 * is `confirmed` or `suspected`, write a SPIRAL lesson via the lessons
 * mutations from A-PR-B.6 so it lands in the next turn's system
 * prompt. `false_positive_progress` is logged but never captured.
 *
 * The agent runtime calls this action right before each turn. It is
 * deliberately a thin wrapper so the heavy lifting can be unit tested
 * without spinning up a Convex deployment.
 */
export const checkAndCaptureSpiral = internalAction({
  args: {
    threadId: v.string(),
    currentTurnId: v.number(),
    /** Recent turn summaries, oldest → newest. The detector uses the tail. */
    turns: v.array(turnSummaryValidator),
    /** Override for the detector's window size. Defaults to 3. */
    windowSize: v.optional(v.number()),
  },
  returns: findingReturnValidator,
  handler: async (ctx, args) => {
    const finding = detectSpiral(
      args.turns,
      args.windowSize ?? SPIRAL_WINDOW_SIZE,
    );
    if (!finding) {
      return null;
    }

    let capturedLessonId: import("../../../_generated/dataModel").Id<"agentLessons"> | null = null;

    // Capture only on confirmed / suspected. Productive iterations
    // (false_positive_progress) never produce a lesson — HONEST_STATUS.
    if (
      finding.verdict === "confirmed" ||
      finding.verdict === "suspected"
    ) {
      capturedLessonId = await ctx.runMutation(
        internal.domains.agents.lessons.captureLesson.captureSpiralLesson,
        {
          threadId: args.threadId,
          turnId: args.currentTurnId,
          toolName: finding.toolName,
          mistakePattern: finding.mistakePattern,
          correctPattern: finding.correctPattern,
        },
      );
    }

    console.log(
      `[spiralDetector] thread=${args.threadId} turn=${args.currentTurnId} verdict=${finding.verdict} tool=${finding.toolName} streak=${finding.streakLength}${capturedLessonId ? ` lesson=${capturedLessonId}` : ""}`,
    );

    return {
      verdict: finding.verdict,
      toolName: finding.toolName,
      signature: finding.signature,
      streakLength: finding.streakLength,
      capturedLessonId,
    };
  },
});
