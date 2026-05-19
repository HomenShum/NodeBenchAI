import { describe, expect, it } from "vitest";
import { decideLiveGrounding } from "./contextRuntimePolicy";

describe("decideLiveGrounding", () => {
  it("keeps memory-first recall off live search when selected context is sufficient", () => {
    const decision = decideLiveGrounding({
      prompt: "Have I seen Orbital Labs before?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(false);
    expect(decision.memorySufficient).toBe(true);
    expect(decision.reason).toMatch(/Memory-first/i);
  });

  it("enables live grounding for freshness requests even when memory exists", () => {
    const decision = decideLiveGrounding({
      prompt: "What happened with OpenAI today?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.freshnessIntent).toBe(true);
  });

  it("enables live grounding when no selected context is attached", () => {
    const decision = decideLiveGrounding({
      prompt: "Research Noho Labs for a founder call",
      hasContext: false,
      memoryHit: false,
      sourceCacheHit: false,
      selectedContextCount: 0,
      sourceRefCount: 0,
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.signals).toContain("no_context");
  });
});
