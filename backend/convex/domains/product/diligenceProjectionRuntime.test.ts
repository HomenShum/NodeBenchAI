import { describe, expect, it } from "vitest";

import {
  buildGenericDiligenceProjectionDrafts,
  buildScratchpadMarkdownForDrafts,
  buildScratchpadStructuredProjectionDrafts,
} from "./diligenceProjectionRuntime";

describe("buildGenericDiligenceProjectionDrafts", () => {
  it("builds generic overlays with inferred block types and source metadata", () => {
    const drafts = buildGenericDiligenceProjectionDrafts({
      entitySlug: "loop",
      title: "Loop",
      primaryEntity: "Loop",
      updatedAt: 1_700_000_000_000,
      revision: 3,
      sections: [
        {
          id: "what-it-is",
          title: "What it is",
          body: "Loop just raised a $95M Series C round for its supply chain AI platform.",
          sourceRefIds: ["src_1", "src_2"],
        },
        {
          id: "what-to-do-next",
          title: "What to do next",
          body: "Watch for new enterprise launches and leadership hiring.",
          sourceRefIds: ["src_2"],
        },
      ],
      sources: [
        {
          id: "src_1",
          label: "Reuters",
          href: "https://www.reuters.com/world/us/example-story",
          domain: "reuters.com",
        },
        {
          id: "src_2",
          label: "Company Blog",
          href: "https://loop.example.com/blog/series-c",
          domain: "loop.example.com",
        },
      ],
    });

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      entitySlug: "loop",
      blockType: "funding",
      scratchpadRunId: "projection:loop:1700000000000:what-it-is",
      sourceTokens: ["[s1]", "[s2]"],
      sourceLabel: "reuters.com · loop.example.com",
      sourceCount: 2,
    });
    expect(drafts[0]?.overallTier).toBe("single-source");
    expect(drafts[1]).toMatchObject({
      blockType: "hiring",
      scratchpadRunId: "projection:loop:1700000000000:what-to-do-next",
      overallTier: "unverified",
    });
  });

  it("fails closed to unverified when sources are missing or unknown", () => {
    const drafts = buildGenericDiligenceProjectionDrafts({
      entitySlug: "mystery-co",
      title: "Mystery Co",
      updatedAt: 123,
      sections: [
        {
          id: "unknowns",
          title: "What is missing",
          body: "We still do not know who the founders are.",
          sourceRefIds: [],
        },
      ],
      sources: [],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.overallTier).toBe("unverified");
    expect(drafts[0]?.sourceTokens).toEqual([]);
  });

  it("builds scratchpad-backed drafts with a shared base run id and per-checkpoint ids", () => {
    const drafts = buildScratchpadStructuredProjectionDrafts(
      {
        entitySlug: "loop",
        title: "Loop",
        primaryEntity: "Loop",
        updatedAt: 1_700_000_000_000,
        revision: 3,
        sections: [
          {
            id: "what-it-is",
            title: "What it is",
            body: "Loop just raised a $95M Series C round for its supply chain AI platform.",
            sourceRefIds: ["src_1", "src_2"],
          },
          {
            id: "what-to-do-next",
            title: "What to do next",
            body: "Watch for new enterprise launches and leadership hiring.",
            sourceRefIds: ["src_2"],
          },
        ],
        sources: [
          {
            id: "src_1",
            label: "Reuters",
            href: "https://www.reuters.com/world/us/example-story",
            domain: "reuters.com",
          },
          {
            id: "src_2",
            label: "Company Blog",
            href: "https://loop.example.com/blog/series-c",
            domain: "loop.example.com",
          },
        ],
      },
      "scratchpad:loop:1700000000000:all",
    );

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      scratchpadBaseRunId: "scratchpad:loop:1700000000000:all",
      scratchpadRunId: "scratchpad:loop:1700000000000:all:what-it-is",
      checkpointNumber: 1,
    });
    expect(drafts[1]).toMatchObject({
      scratchpadRunId: "scratchpad:loop:1700000000000:all:what-to-do-next",
      checkpointNumber: 2,
    });
  });

  it("renders a readable raw markdown scratchpad from streamed drafts", () => {
    const markdown = buildScratchpadMarkdownForDrafts({
      entitySlug: "loop",
      entityName: "Loop",
      scratchpadBaseRunId: "scratchpad:loop:1700000000000:all",
      status: "streaming",
      currentStep: "checkpoint:funding",
      drafts: [
        {
          blockType: "funding",
          headerText: "What it is",
          bodyProse: "Loop just raised a $95M Series C round.",
          sourceTokens: ["[s1]", "[s2]"],
          overallTier: "single-source",
          sourceSectionId: "what-it-is",
          checkpointNumber: 1,
        },
      ],
    });

    expect(markdown).toContain("# Diligence scratchpad");
    expect(markdown).toContain("- Current step: checkpoint:funding");
    expect(markdown).toContain("## [1] What it is");
    expect(markdown).toContain("Loop just raised a $95M Series C round.");
    expect(markdown).toContain("- Sources: [s1] [s2]");
  });
});
