/**
 * Unit tests for buildSystemPromptPrefix + injectLessonsIntoSystemPrompt.
 *
 * Pure functions — no Convex / I/O. Tests the contract surfaced in
 * systemPromptBuilder.ts:
 *  1. Empty input → empty string (no fake "no lessons" placeholder)
 *  2. Type ordering: SEMANTIC → INFRASTRUCTURE → SPIRAL → BUDGET
 *  3. Pinned lessons sort to the top within their type
 *  4. Per-type section headings + lesson formatters
 *  5. Byte-budget cap (MAX_PROMPT_PREFIX_BYTES = 8192) drops non-pinned
 *     overflow lessons; pinned always survive
 *  6. injectLessonsIntoSystemPrompt concatenates prefix + original prompt
 *     with double-newline; returns original unchanged on empty lessons
 *  7. Unknown lesson type → silently dropped
 */
import { describe, expect, it } from "vitest";
import {
  buildSystemPromptPrefix,
  injectLessonsIntoSystemPrompt,
  LESSONS_HEADER,
  LESSONS_FOOTER,
  MAX_PROMPT_PREFIX_BYTES,
} from "./systemPromptBuilder";
import type { AgentLesson } from "./captureLesson";

// Helper: fabricate an AgentLesson without all the Convex Doc bookkeeping.
// Cast through `unknown` because the test only exercises the fields the
// formatters actually read.
function lesson(partial: Partial<AgentLesson>): AgentLesson {
  return {
    _id: "fake-id" as never,
    _creationTime: 0,
    threadId: "test-thread",
    turnId: 0,
    type: "semantic",
    pinned: false,
    deprecated: false,
    capturedAt: 0,
    ...partial,
  } as unknown as AgentLesson;
}

describe("buildSystemPromptPrefix", () => {
  it("returns empty string when lessons list is empty (no fake placeholder)", () => {
    expect(buildSystemPromptPrefix([])).toBe("");
  });

  describe("formatters", () => {
    it("semantic lesson renders Don't / Do bullets", () => {
      const result = buildSystemPromptPrefix([
        lesson({
          type: "semantic",
          mistakePattern: "wrote to a stale block",
          correctPattern: "always re-read before patching",
          toolName: "patch_notebook",
          capturedAt: 1,
        }),
      ]);
      expect(result).toContain(LESSONS_HEADER);
      expect(result).toContain("**Don't:** wrote to a stale block");
      expect(result).toContain("**Do:** always re-read before patching");
      expect(result).toContain("`patch_notebook`");
    });

    it("spiral lesson renders Loop / Break by bullets", () => {
      const result = buildSystemPromptPrefix([
        lesson({
          type: "spiral",
          mistakePattern: "kept retrying with the same diff",
          correctPattern: "abort after 3 same-signature turns",
          toolName: "patch_notebook",
          capturedAt: 1,
        }),
      ]);
      expect(result).toContain("**Loop:** kept retrying with the same diff");
      expect(result).toContain("**Break by:** abort after 3 same-signature turns");
      expect(result).toContain("via `patch_notebook`");
    });

    it("infrastructure lesson renders fromModel → toModel pattern", () => {
      const result = buildSystemPromptPrefix([
        lesson({
          type: "infrastructure",
          fromModel: "claude-3-5-sonnet",
          toModel: "claude-haiku-4-5",
          failedWith: 429,
          succeeded: true,
          count: 3,
          capturedAt: 1,
        }),
      ]);
      expect(result).toContain("`claude-3-5-sonnet`");
      expect(result).toContain("`claude-haiku-4-5`");
      expect(result).toContain("HTTP 429");
      expect(result).toContain("succeeded");
      expect(result).toContain("(×3)");
    });

    it("infrastructure lesson without fromModel/toModel renders nothing", () => {
      const result = buildSystemPromptPrefix([
        lesson({ type: "infrastructure", capturedAt: 1 }),
      ]);
      // Header still rendered (always include section even if items dropped),
      // but the lesson body itself should be absent.
      expect(result).not.toContain("undefined");
      expect(result).not.toContain("→");
    });

    it("budget lesson surfaces task category + estimated tokens", () => {
      const result = buildSystemPromptPrefix([
        lesson({
          type: "budget",
          taskCategory: "deep-research",
          estimatedTokensRemaining: 250_000,
          capturedAt: 1,
        }),
      ]);
      expect(result).toContain("deep-research");
      // Number rendered with locale grouping ("250,000")
      expect(result).toMatch(/250[,\s]000/);
    });
  });

  describe("ordering + pinning", () => {
    it("groups by TYPE_PRIORITY order: semantic → spiral → infrastructure → budget", () => {
      // Mirrors TYPE_PRIORITY in systemPromptBuilder.ts:
      //   semantic: 0, spiral: 1, infrastructure: 2, budget: 3
      const result = buildSystemPromptPrefix([
        lesson({ type: "budget", taskCategory: "x", estimatedTokensRemaining: 1, capturedAt: 4 }),
        lesson({ type: "spiral", mistakePattern: "loop", correctPattern: "break", capturedAt: 3 }),
        lesson({ type: "infrastructure", fromModel: "a", toModel: "b", succeeded: true, capturedAt: 2 }),
        lesson({ type: "semantic", mistakePattern: "m", correctPattern: "c", capturedAt: 1 }),
      ]);
      const semIdx = result.indexOf("Don't:");
      const spiralIdx = result.indexOf("Loop:");
      const infraIdx = result.indexOf("`a`");
      const budgetIdx = result.indexOf("hit budget cap");
      expect(semIdx).toBeGreaterThan(0);
      expect(spiralIdx).toBeGreaterThan(semIdx);
      expect(infraIdx).toBeGreaterThan(spiralIdx);
      expect(budgetIdx).toBeGreaterThan(infraIdx);
    });

    it("pinned lessons sort to the top with 📌 marker", () => {
      const result = buildSystemPromptPrefix([
        lesson({
          type: "semantic",
          mistakePattern: "regular",
          correctPattern: "regular_fix",
          capturedAt: 2,
        }),
        lesson({
          type: "semantic",
          pinned: true,
          mistakePattern: "PINNED_FIRST",
          correctPattern: "pinned_fix",
          capturedAt: 1,
        }),
      ]);
      const pinnedIdx = result.indexOf("PINNED_FIRST");
      const regularIdx = result.indexOf("regular");
      expect(pinnedIdx).toBeGreaterThan(0);
      expect(regularIdx).toBeGreaterThan(pinnedIdx);
      expect(result).toContain("📌");
    });

    it("within same type+pinned, more-recent capturedAt sorts first", () => {
      const result = buildSystemPromptPrefix([
        lesson({ type: "semantic", mistakePattern: "OLDER", correctPattern: "x", capturedAt: 100 }),
        lesson({ type: "semantic", mistakePattern: "NEWER", correctPattern: "x", capturedAt: 200 }),
      ]);
      const newerIdx = result.indexOf("NEWER");
      const olderIdx = result.indexOf("OLDER");
      expect(newerIdx).toBeGreaterThan(0);
      expect(olderIdx).toBeGreaterThan(newerIdx);
    });
  });

  describe("byte budget", () => {
    it("respects custom maxBytes — drops non-pinned overflow", () => {
      const longBody = "x".repeat(500);
      const lessons = Array.from({ length: 20 }, (_, i) =>
        lesson({
          type: "semantic",
          mistakePattern: `m_${i}_${longBody}`,
          correctPattern: `c_${i}_${longBody}`,
          capturedAt: i,
        }),
      );
      const result = buildSystemPromptPrefix(lessons, { maxBytes: 1500 });
      const bytes = new TextEncoder().encode(result).length;
      // Should respect the budget within reasonable slack (heading + first lesson allowed even if it overruns once).
      expect(bytes).toBeLessThan(3000);
    });

    it("pinned lessons survive even when they overflow the budget", () => {
      const longBody = "y".repeat(2000);
      const result = buildSystemPromptPrefix(
        [
          lesson({
            type: "semantic",
            pinned: true,
            mistakePattern: `PINNED_${longBody}`,
            correctPattern: "fix",
            capturedAt: 1,
          }),
          lesson({
            type: "semantic",
            mistakePattern: "REGULAR",
            correctPattern: "fix",
            capturedAt: 2,
          }),
        ],
        { maxBytes: 200 },
      );
      // Pinned lesson must be present even though its size exceeds the cap.
      expect(result).toContain("PINNED_");
    });

    it("default cap is MAX_PROMPT_PREFIX_BYTES", () => {
      expect(MAX_PROMPT_PREFIX_BYTES).toBe(8_192);
    });
  });

  describe("HONEST_STATUS", () => {
    it("unknown lesson type doesn't crash and produces no formatted body line", () => {
      const result = buildSystemPromptPrefix([
        lesson({ type: "future_unknown" as never, capturedAt: 1 }),
      ]);
      // The function must not throw on an unknown type even though the
      // schema forbids it — defensive switch in formatLesson() returns "".
      expect(typeof result).toBe("string");
      // No actual lesson body bullet line — formatLesson returns ""
      // for unknown types, so no `**Don't:**` / `**Loop:**` / `→` appears.
      expect(result).not.toContain("**Don't:**");
      expect(result).not.toContain("**Loop:**");
      expect(result).not.toContain("→");
      expect(result).not.toContain("hit budget cap");
    });
  });

  describe("introLine option", () => {
    it("intro line precedes the lessons header when supplied", () => {
      const result = buildSystemPromptPrefix(
        [lesson({ type: "semantic", mistakePattern: "x", correctPattern: "y", capturedAt: 1 })],
        { introLine: "User: alice@example.com" },
      );
      const introIdx = result.indexOf("User: alice");
      const headerIdx = result.indexOf(LESSONS_HEADER);
      expect(introIdx).toBeGreaterThanOrEqual(0);
      expect(headerIdx).toBeGreaterThan(introIdx);
    });
  });

  describe("LESSONS_FOOTER export", () => {
    it("is a non-empty stable string for downstream tooling", () => {
      expect(typeof LESSONS_FOOTER).toBe("string");
      expect(LESSONS_FOOTER.length).toBeGreaterThan(0);
    });
  });
});

describe("injectLessonsIntoSystemPrompt", () => {
  it("returns original prompt unchanged when lessons array is empty", () => {
    const original = "You are a helpful assistant.";
    expect(injectLessonsIntoSystemPrompt(original, [])).toBe(original);
  });

  it("prepends prefix with double-newline separator", () => {
    const result = injectLessonsIntoSystemPrompt(
      "ORIGINAL PROMPT",
      [lesson({ type: "semantic", mistakePattern: "m", correctPattern: "c", capturedAt: 1 })],
    );
    // Order: prefix → \n\n → ORIGINAL PROMPT
    expect(result).toMatch(/Don't:.*\n\n.*ORIGINAL PROMPT/s);
    expect(result.endsWith("ORIGINAL PROMPT")).toBe(true);
  });
});
