import { describe, expect, it } from "vitest";

import { structureScratchpadCheckpoint } from "./diligenceCheckpointStructuring";

const baseArgs = {
  entitySlug: "loop",
  entityName: "Loop",
  scratchpadMarkdown: "# Diligence scratchpad\n\n## [1] What it is\nLoop just raised a $95M Series C round.",
  checkpointNumber: 1,
  checkpointStep: "checkpoint:funding",
  draft: {
    entitySlug: "loop",
    blockType: "funding" as const,
    scratchpadRunId: "scratchpad:loop:1700000000000:all:what-it-is",
    scratchpadBaseRunId: "scratchpad:loop:1700000000000:all",
    checkpointNumber: 1,
    version: 1_700_000_000_000,
    overallTier: "single-source" as const,
    headerText: "What it is",
    bodyProse: "Loop just raised a $95M Series C round for its supply chain AI platform.",
    sourceRefIds: ["src_1", "src_2"],
    sourceCount: 2,
    sourceLabel: "reuters.com · loop.example.com",
    sourceTokens: ["[s1]", "[s2]"],
    sourceSectionId: "what-it-is",
    payload: {
      kind: "scratchpad-checkpoint",
    },
  },
  reportSources: [
    {
      id: "src_1",
      label: "Reuters",
      href: "https://www.reuters.com/world/us/example-story",
      domain: "reuters.com",
    },
    {
      id: "src_2",
      label: "Loop Blog",
      href: "https://loop.example.com/blog/series-c",
      domain: "loop.example.com",
    },
  ],
};

describe("structureScratchpadCheckpoint", () => {
  it("returns a structured checkpoint draft with audit metadata on primary success", async () => {
    const result = await structureScratchpadCheckpoint(baseArgs, {
      generateStructuredObject: async () => ({
        modelUsed: "qwen3-coder-free",
        usage: { inputTokens: 120, outputTokens: 55 },
        object: {
          title: "Funding snapshot",
          summary: "Loop raised a $95M Series C round to expand its supply chain AI platform.",
          claims: [
            "Loop announced a $95M Series C round.",
            "The company positions the raise around supply chain AI expansion.",
          ],
          evidenceRefs: ["src_1", "src_2"],
          confidenceTier: "corroborated",
          openQuestions: ["What customer segments are driving the expansion?"],
          sourceSectionIds: ["what-it-is"],
        },
      }),
    });

    expect(result.audit).toMatchObject({
      model: "qwen3-coder-free",
      status: "structured",
      validation: "passed",
      attemptCount: 1,
    });
    expect(result.telemetry).toMatchObject({
      toolCalls: 1,
      tokensIn: 120,
      tokensOut: 55,
      sourceCount: 2,
    });
    expect(result.draft).toMatchObject({
      headerText: "Funding snapshot",
      sourceRefIds: ["src_1", "src_2"],
      sourceTokens: ["[s1]", "[s2]"],
      sourceSectionId: "what-it-is",
      overallTier: "single-source",
    });
    expect(result.draft.bodyProse).toContain("Loop raised a $95M Series C round");
    expect(result.draft.bodyProse).toContain("Open questions:");
    expect(result.draft.payload).toMatchObject({
      kind: "structured-checkpoint",
      structuringAudit: {
        status: "structured",
      },
      structured: {
        title: "Funding snapshot",
        evidenceRefs: ["src_1", "src_2"],
      },
    });
  });

  it("runs a repair attempt when the primary output fails semantic validation", async () => {
    let callCount = 0;
    const result = await structureScratchpadCheckpoint(baseArgs, {
      generateStructuredObject: async (_prompt, mode) => {
        callCount += 1;
        if (mode === "primary") {
          return {
            modelUsed: "qwen3-coder-free",
            usage: { inputTokens: 80, outputTokens: 10 },
            object: {
              title: "Funding snapshot",
              summary: "Too short",
              claims: [],
              evidenceRefs: ["src_1"],
              confidenceTier: "single-source",
              openQuestions: [],
              sourceSectionIds: ["what-it-is"],
            },
          };
        }
        return {
          modelUsed: "gemini-3-flash-preview",
          usage: { inputTokens: 60, outputTokens: 30 },
          object: {
            title: "Funding snapshot",
            summary: "Loop disclosed a $95M Series C round tied to expansion of its supply chain AI platform.",
            claims: ["Loop disclosed a $95M Series C round."],
            evidenceRefs: ["src_1"],
            confidenceTier: "single-source",
            openQuestions: [],
            sourceSectionIds: ["what-it-is"],
          },
        };
      },
    });

    expect(callCount).toBe(2);
    expect(result.audit).toMatchObject({
      model: "gemini-3-flash-preview",
      status: "repaired",
      validation: "repaired",
      attemptCount: 2,
    });
    expect(result.telemetry.tokensIn).toBe(140);
    expect(result.telemetry.tokensOut).toBe(40);
    expect(result.draft.sourceRefIds).toEqual(["src_1"]);
  });

  it("falls back deterministically when both primary and repair attempts fail", async () => {
    const result = await structureScratchpadCheckpoint(baseArgs, {
      generateStructuredObject: async () => {
        throw new Error("provider unavailable");
      },
    });

    expect(result.audit).toMatchObject({
      status: "fallback",
      validation: "fallback",
      attemptCount: 2,
    });
    expect(result.audit.fallbackReason).toContain("provider unavailable");
    expect(result.structured).toMatchObject({
      title: "What it is",
      confidenceTier: "single-source",
      evidenceRefs: ["src_1", "src_2"],
    });
    expect(result.draft.payload).toMatchObject({
      kind: "structured-checkpoint",
      structuringAudit: {
        status: "fallback",
      },
    });
  });
});
