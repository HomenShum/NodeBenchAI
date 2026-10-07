/**
 * Unit tests for detectRollbackIntent.  Pure function — no Convex / React.
 *
 * Covers: canonical /rollback forms, natural-language fuzzy forms, the
 * MAX_STEPS_BACK clamp, and rejected inputs (empty, long, malformed).
 */
import { describe, expect, it } from "vitest";
import { detectRollbackIntent } from "./detectRollbackIntent";

describe("detectRollbackIntent", () => {
  describe("rejects non-rollback input", () => {
    it("returns null for empty string", () => {
      expect(detectRollbackIntent("")).toBe(null);
    });
    it("returns null for whitespace-only", () => {
      expect(detectRollbackIntent("   ")).toBe(null);
    });
    it("returns null for unrelated questions", () => {
      expect(detectRollbackIntent("what's the weather like")).toBe(null);
      expect(detectRollbackIntent("compare these two reports")).toBe(null);
    });
    it("returns null for long inputs that mention undo", () => {
      const long =
        "I've been thinking about whether I should undo the changes we made earlier today";
      expect(long.length).toBeGreaterThan(60);
      expect(detectRollbackIntent(long)).toBe(null);
    });
  });

  describe("canonical /rollback slash form", () => {
    it("/rollback → stepsBack: 1", () => {
      expect(detectRollbackIntent("/rollback")).toEqual({
        kind: "stepsBack",
        stepsBack: 1,
      });
    });
    it("/rollback 3 → stepsBack: 3", () => {
      expect(detectRollbackIntent("/rollback 3")).toEqual({
        kind: "stepsBack",
        stepsBack: 3,
      });
    });
    it("/rollback to 42 → turnId: 42", () => {
      expect(detectRollbackIntent("/rollback to 42")).toEqual({
        kind: "turnId",
        turnId: 42,
      });
    });
    it("/rollback turn 42 → turnId: 42", () => {
      expect(detectRollbackIntent("/rollback turn 42")).toEqual({
        kind: "turnId",
        turnId: 42,
      });
    });
    it("clamps slash-form stepsBack to MAX_STEPS_BACK=50", () => {
      const r = detectRollbackIntent("/rollback 9999");
      expect(r).toEqual({ kind: "stepsBack", stepsBack: 50 });
    });
    it("rejects /rollback 0", () => {
      expect(detectRollbackIntent("/rollback 0")).toBe(null);
    });
    it("ignores trailing whitespace", () => {
      expect(detectRollbackIntent("/rollback 2   ")).toEqual({
        kind: "stepsBack",
        stepsBack: 2,
      });
    });
    it("is case-insensitive on /rollback", () => {
      expect(detectRollbackIntent("/RollBack 4")).toEqual({
        kind: "stepsBack",
        stepsBack: 4,
      });
    });
  });

  describe("natural-language forms", () => {
    it("'undo last 3' → stepsBack: 3", () => {
      expect(detectRollbackIntent("undo last 3")).toEqual({
        kind: "stepsBack",
        stepsBack: 3,
      });
    });
    it("'rollback the last 2' → stepsBack: 2", () => {
      expect(detectRollbackIntent("rollback the last 2")).toEqual({
        kind: "stepsBack",
        stepsBack: 2,
      });
    });
    it("'revert last 5' → stepsBack: 5", () => {
      expect(detectRollbackIntent("revert last 5")).toEqual({
        kind: "stepsBack",
        stepsBack: 5,
      });
    });
    it("clamps natural-language stepsBack to 50", () => {
      const r = detectRollbackIntent("undo last 9999");
      expect(r).toEqual({ kind: "stepsBack", stepsBack: 50 });
    });
    it("'undo that' → stepsBack: 1", () => {
      expect(detectRollbackIntent("undo that")).toEqual({
        kind: "stepsBack",
        stepsBack: 1,
      });
    });
    it("'rollback' alone (no slash) → stepsBack: 1", () => {
      expect(detectRollbackIntent("rollback")).toEqual({
        kind: "stepsBack",
        stepsBack: 1,
      });
    });
    it("'undo this' → stepsBack: 1", () => {
      expect(detectRollbackIntent("undo this")).toEqual({
        kind: "stepsBack",
        stepsBack: 1,
      });
    });
    it("rejects 'undo last 0'", () => {
      expect(detectRollbackIntent("undo last 0")).toBe(null);
    });
    it("rejects long-form sentence with 'undo' embedded mid-text", () => {
      // Has 'undo last 3' but exceeds 60 chars.
      const text =
        "Hey assistant, could you maybe just undo last 3 things we did, thanks!";
      expect(text.length).toBeGreaterThan(60);
      expect(detectRollbackIntent(text)).toBe(null);
    });
  });

  describe("edge cases", () => {
    it("'undo' followed by a non-matching suffix returns null", () => {
      expect(detectRollbackIntent("undo nuclear launch")).toBe(null);
    });
    it("'/rollbackish' is not /rollback", () => {
      expect(detectRollbackIntent("/rollbackish")).toBe(null);
    });
    it("does not crash on unicode + emoji", () => {
      expect(() => detectRollbackIntent("/rollback 🚀")).not.toThrow();
      expect(detectRollbackIntent("/rollback 🚀")).toBe(null);
    });
  });
});
