/**
 * Tests for `injectLessonsForThread`.
 *
 * The helper wires the lesson capture/recall system into LLM call sites
 * (FU-3). Tests cover:
 *   - missing threadId → unchanged prompt
 *   - empty lessons → unchanged prompt
 *   - lesson query throws → logs warning, returns unchanged prompt (HONEST_STATUS)
 *   - lessons present → augmented prompt with header + lessons + footer
 *   - threadId trimming behaviour
 *
 * The Convex internal API is mocked via a fake `ActionCtx` so we don't
 * need a Convex runtime in vitest.
 */

import { describe, expect, it, vi } from "vitest";

import { injectLessonsForThread } from "./lessonInjection";
import {
  LESSONS_FOOTER,
  LESSONS_HEADER,
} from "./systemPromptBuilder";

const ORIGINAL_PROMPT = "You are NodeBench Fast Lane.";

function makeLesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "lesson_x" as unknown as never,
    _creationTime: 1,
    threadId: "thread_a",
    turnId: 1,
    type: "semantic" as const,
    toolName: undefined,
    mistakePattern: "Answered from memory without searching.",
    correctPattern: "Always cite sources via web_search first.",
    capturedAt: 1700000000000,
    capturedBy: "system" as const,
    expiresAfterTurn: undefined,
    pinned: false,
    deprecated: false,
    sourceTurnId: 1,
    ...overrides,
  };
}

function makeFakeCtx(opts: {
  lessons?: ReturnType<typeof makeLesson>[];
  throws?: Error;
}) {
  const runQuery = vi.fn(async () => {
    if (opts.throws) throw opts.throws;
    return opts.lessons ?? [];
  });
  return {
    runQuery,
  } as unknown as Parameters<typeof injectLessonsForThread>[0];
}

describe("injectLessonsForThread", () => {
  it("returns the original prompt when threadId is undefined", async () => {
    const ctx = makeFakeCtx({ lessons: [] });
    const result = await injectLessonsForThread(ctx, undefined, ORIGINAL_PROMPT);
    expect(result).toBe(ORIGINAL_PROMPT);
    expect((ctx as any).runQuery).not.toHaveBeenCalled();
  });

  it("returns the original prompt when threadId is null", async () => {
    const ctx = makeFakeCtx({ lessons: [] });
    const result = await injectLessonsForThread(ctx, null, ORIGINAL_PROMPT);
    expect(result).toBe(ORIGINAL_PROMPT);
    expect((ctx as any).runQuery).not.toHaveBeenCalled();
  });

  it("returns the original prompt when threadId is the empty string", async () => {
    const ctx = makeFakeCtx({ lessons: [] });
    const result = await injectLessonsForThread(ctx, "", ORIGINAL_PROMPT);
    expect(result).toBe(ORIGINAL_PROMPT);
    expect((ctx as any).runQuery).not.toHaveBeenCalled();
  });

  it("returns the original prompt when there are no lessons", async () => {
    const ctx = makeFakeCtx({ lessons: [] });
    const result = await injectLessonsForThread(
      ctx,
      "thread_a",
      ORIGINAL_PROMPT,
    );
    expect(result).toBe(ORIGINAL_PROMPT);
    expect((ctx as any).runQuery).toHaveBeenCalledTimes(1);
  });

  it("augments the prompt with lessons when present", async () => {
    const ctx = makeFakeCtx({
      lessons: [
        makeLesson({
          mistakePattern: "Answered from memory.",
          correctPattern: "Always cite sources.",
        }),
      ],
    });
    const result = await injectLessonsForThread(
      ctx,
      "thread_a",
      ORIGINAL_PROMPT,
    );
    expect(result).not.toBe(ORIGINAL_PROMPT);
    expect(result).toContain(LESSONS_HEADER);
    expect(result).toContain("Always cite sources.");
    expect(result).toContain(LESSONS_FOOTER);
    expect(result).toContain(ORIGINAL_PROMPT);
    // Header must come before original prompt.
    expect(result.indexOf(LESSONS_HEADER)).toBeLessThan(
      result.indexOf(ORIGINAL_PROMPT),
    );
  });

  it("forwards turnId, currentToolName, and limit to the query", async () => {
    const ctx = makeFakeCtx({ lessons: [] });
    await injectLessonsForThread(ctx, "thread_a", ORIGINAL_PROMPT, {
      turnId: 42,
      currentToolName: "web_search",
      limit: 3,
    });
    expect((ctx as any).runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: "thread_a",
        currentTurnId: 42,
        currentToolName: "web_search",
        limit: 3,
      }),
    );
  });

  it("returns the original prompt when the lesson query throws (HONEST_STATUS)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeFakeCtx({ throws: new Error("convex transient") });
    const result = await injectLessonsForThread(
      ctx,
      "thread_a",
      ORIGINAL_PROMPT,
    );
    expect(result).toBe(ORIGINAL_PROMPT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[injectLessonsForThread]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
