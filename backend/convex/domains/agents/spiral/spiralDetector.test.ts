/**
 * Unit tests for detectSpiral.  Pure function — no Convex / I/O.
 *
 * Tests the contract:
 *  1. Returns null when fewer than windowSize turns
 *  2. Returns null when newest turn has no toolName / argsHash (no signature)
 *  3. Tail streak of ≥ windowSize identical signatures → returns SpiralFinding
 *  4. Verdict logic:
 *     - "confirmed" when every turn in streak has artifactSha256 AND all match
 *     - "false_positive_progress" when shas differ within the streak
 *     - "suspected" when artifactSha256 is missing on any streak turn
 *  5. Streak count + turnIds (oldest → newest) reported correctly
 *  6. Custom windowSize parameter respected
 *  7. Streak walk backs only as far as the same signature persists (a
 *     different signature anywhere in the streak ends the run)
 */
import { describe, expect, it } from "vitest";
import {
  detectSpiral,
  SPIRAL_WINDOW_SIZE,
  type TurnSummary,
} from "./spiralDetector";

const turn = (over: Partial<TurnSummary>): TurnSummary => ({
  turnId: 0,
  toolName: "patch_notebook",
  argsHash: "deadbeef",
  ...over,
});

describe("detectSpiral", () => {
  describe("returns null when there's no streak to find", () => {
    it("empty turn list", () => {
      expect(detectSpiral([])).toBe(null);
    });
    it("fewer turns than windowSize", () => {
      const turns = [turn({ turnId: 1 }), turn({ turnId: 2 })];
      expect(detectSpiral(turns)).toBe(null);
    });
    it("newest turn has no toolName → no signature → null", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3, toolName: null }),
      ];
      expect(detectSpiral(turns)).toBe(null);
    });
    it("newest turn has no argsHash → no signature → null", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3, argsHash: null }),
      ];
      expect(detectSpiral(turns)).toBe(null);
    });
    it("3 turns but only 2 share signature → null", () => {
      const turns = [
        turn({ turnId: 1, argsHash: "diff" }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      expect(detectSpiral(turns)).toBe(null);
    });
  });

  describe("detects same-signature tail streaks", () => {
    it("3 identical signature turns → finding with streakLength 3", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      const result = detectSpiral(turns);
      expect(result).not.toBe(null);
      expect(result!.streakLength).toBe(3);
      expect(result!.signature).toBe("patch_notebook:deadbeef");
    });

    it("ordering: turnIds reported oldest → newest", () => {
      const turns = [
        turn({ turnId: 5 }),
        turn({ turnId: 7 }),
        turn({ turnId: 9 }),
      ];
      const result = detectSpiral(turns);
      expect(result!.streakTurnIds).toEqual([5, 7, 9]);
    });

    it("4 identical at tail with prior different turn → streak counts only the matching tail", () => {
      const turns = [
        turn({ turnId: 1, argsHash: "old" }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
        turn({ turnId: 4 }),
        turn({ turnId: 5 }),
      ];
      const result = detectSpiral(turns);
      expect(result).not.toBe(null);
      expect(result!.streakLength).toBe(4); // turns 2..5
      expect(result!.streakTurnIds[0]).toBe(2);
    });
  });

  describe("verdict logic", () => {
    it("'confirmed' when every streak turn has same artifactSha256", () => {
      const sha = "aaa";
      const turns = [
        turn({ turnId: 1, artifactSha256: sha }),
        turn({ turnId: 2, artifactSha256: sha }),
        turn({ turnId: 3, artifactSha256: sha }),
      ];
      const result = detectSpiral(turns);
      expect(result!.verdict).toBe("confirmed");
    });

    it("'false_positive_progress' when artifact shas differ inside the streak", () => {
      const turns = [
        turn({ turnId: 1, artifactSha256: "aaa" }),
        turn({ turnId: 2, artifactSha256: "bbb" }),
        turn({ turnId: 3, artifactSha256: "ccc" }),
      ];
      const result = detectSpiral(turns);
      expect(result!.verdict).toBe("false_positive_progress");
    });

    it("'suspected' when ANY streak turn lacks artifactSha256", () => {
      const turns = [
        turn({ turnId: 1, artifactSha256: "aaa" }),
        turn({ turnId: 2 }), // no sha
        turn({ turnId: 3, artifactSha256: "aaa" }),
      ];
      const result = detectSpiral(turns);
      expect(result!.verdict).toBe("suspected");
    });

    it("'suspected' when no streak turn has artifactSha256", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      const result = detectSpiral(turns);
      expect(result!.verdict).toBe("suspected");
    });
  });

  describe("custom windowSize", () => {
    it("windowSize=2 detects 2-turn streaks the default ignores", () => {
      const turns = [
        turn({ turnId: 1, argsHash: "diff" }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      // Default = 3, so the 2-tail-streak doesn't trip default detection.
      // (The 3rd turn shares signature with 2nd but the 1st is different,
      // and there are 3 turns total. Actually default counts streak from
      // tail, so this one IS a 2-streak under windowSize=2 and missed
      // under windowSize=3 unless the 1st shares too.)
      const wDefault = detectSpiral(turns);
      expect(wDefault).toBe(null);
      const w2 = detectSpiral(turns, 2);
      expect(w2).not.toBe(null);
      expect(w2!.streakLength).toBe(2);
    });

    it("windowSize=4 requires 4 same-signature turns", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      expect(detectSpiral(turns, 4)).toBe(null);
    });
  });

  describe("payload shape", () => {
    it("returns toolName + signature + mistakePattern + correctPattern", () => {
      const turns = [
        turn({ turnId: 1 }),
        turn({ turnId: 2 }),
        turn({ turnId: 3 }),
      ];
      const result = detectSpiral(turns);
      expect(result!.toolName).toBe("patch_notebook");
      expect(result!.signature).toBe("patch_notebook:deadbeef");
      expect(result!.mistakePattern).toContain("patch_notebook");
      expect(result!.mistakePattern).toContain("3 turns in a row");
      expect(result!.correctPattern).toMatch(/different tool|change the args|stuck/i);
    });
  });

  describe("constants", () => {
    it("SPIRAL_WINDOW_SIZE is 3 (matches plan PR #116)", () => {
      expect(SPIRAL_WINDOW_SIZE).toBe(3);
    });
  });
});
