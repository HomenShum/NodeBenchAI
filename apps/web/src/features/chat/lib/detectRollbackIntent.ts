/**
 * detectRollbackIntent — pure parser for chat composer rollback shortcuts.
 *
 * A-PR-A.4 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Recognizes:
 *   `/rollback`              → { kind: "stepsBack", stepsBack: 1 }
 *   `/rollback 3`            → { kind: "stepsBack", stepsBack: 3 }
 *   `/rollback to 42`        → { kind: "turnId", turnId: 42 }
 *   `/rollback turn 42`      → { kind: "turnId", turnId: 42 }
 *   "undo that"              → { kind: "stepsBack", stepsBack: 1 }
 *   "revert that"            → { kind: "stepsBack", stepsBack: 1 }
 *   "rollback that"          → { kind: "stepsBack", stepsBack: 1 }
 *   "undo last 3"            → { kind: "stepsBack", stepsBack: 3 }
 *   "rollback the last 2"    → { kind: "stepsBack", stepsBack: 2 }
 *
 * Returns `null` for inputs that do not match any rollback shortcut.
 *
 * Pure function (no React, no Convex). Easy to unit test.
 */

export type RollbackIntent =
  | { kind: "stepsBack"; stepsBack: number }
  | { kind: "turnId"; turnId: number };

/** Maximum stepsBack we will accept from natural-language phrases. Protects
 * against absurd inputs like "undo last 9999". The action enforces its own
 * upper bound at 50 (the snapshot retention window). */
const MAX_STEPS_BACK = 50;

/**
 * Try to interpret the supplied composer input as a rollback shortcut.
 * Returns `null` when the text is anything other than a rollback command.
 */
export function detectRollbackIntent(rawInput: string): RollbackIntent | null {
  if (!rawInput) return null;
  const text = rawInput.trim();
  if (!text) return null;

  // ── Slash-prefixed canonical form ──────────────────────────────────────
  // `/rollback`, `/rollback 3`, `/rollback to 42`, `/rollback turn 42`
  const slashMatch = text.match(
    /^\/rollback(?:\s+(?:to|turn)?\s*(\d+))?\s*$/i,
  );
  if (slashMatch) {
    const numberPart = slashMatch[1];
    if (numberPart === undefined) {
      return { kind: "stepsBack", stepsBack: 1 };
    }
    const n = Number.parseInt(numberPart, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    // `/rollback to 42` and `/rollback turn 42` are absolute turnIds.
    const isTurnIdForm = /to|turn/i.test(slashMatch[0]);
    if (isTurnIdForm) return { kind: "turnId", turnId: n };
    return { kind: "stepsBack", stepsBack: Math.min(n, MAX_STEPS_BACK) };
  }

  // ── Fuzzy natural-language forms ───────────────────────────────────────
  // Only fire on short inputs (<= 60 chars) to avoid swallowing real
  // questions that happen to mention "undo".
  if (text.length > 60) return null;

  const lower = text.toLowerCase();

  // "undo last 3", "rollback the last 2", "revert last 5"
  const lastNMatch = lower.match(
    /\b(?:undo|revert|rollback)(?:\s+(?:the|that))?\s+last\s+(\d+)\b/,
  );
  if (lastNMatch) {
    const n = Number.parseInt(lastNMatch[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { kind: "stepsBack", stepsBack: Math.min(n, MAX_STEPS_BACK) };
  }

  // "undo that", "revert that", "rollback that", plus "undo it"/"undo this"
  const fuzzySingleMatch = lower.match(
    /^(?:undo|revert|rollback)(?:\s+(?:that|it|this|my\s+last|the\s+last))?$/,
  );
  if (fuzzySingleMatch) {
    return { kind: "stepsBack", stepsBack: 1 };
  }

  return null;
}
