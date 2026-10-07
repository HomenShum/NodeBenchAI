import { describe, expect, it } from "vitest";

import {
  acceptDecorationIntoNotebook,
  buildAcceptedNotebookDrafts,
} from "./acceptDecorationIntoNotebook";
import type { DiligenceDecorationData } from "./DiligenceDecorationPlugin";

function makeDecoration(
  overrides: Partial<DiligenceDecorationData> = {},
): DiligenceDecorationData {
  return {
    blockType: "projection",
    overallTier: "corroborated",
    headerText: "Why it matters",
    bodyProse: "The workflow is already live.\n\n- Keep the notebook calm.",
    scratchpadRunId: "projection:loop:100:why-it-matters",
    version: 1,
    updatedAt: 100,
    sourceSectionId: "why-it-matters",
    sourceRefIds: ["src_1"],
    sourceCount: 1,
    sourceTokens: ["[s1]"],
    ...overrides,
  };
}

describe("buildAcceptedNotebookDrafts", () => {
  it("creates a frozen marker, heading, and prose blocks", () => {
    const drafts = buildAcceptedNotebookDrafts(makeDecoration(), 1_000);

    expect(drafts).toHaveLength(4);
    expect(drafts[0]?.kind).toBe("generated_marker");
    expect(drafts[1]?.kind).toBe("heading_3");
    expect(drafts[2]?.kind).toBe("text");
    expect(drafts[3]?.kind).toBe("bullet");
    expect(drafts[2]?.sourceRefIds).toEqual(["src_1"]);
    expect(drafts[2]?.attributes).toEqual(
      expect.objectContaining({
        acceptedFromLive: expect.objectContaining({
          sourceScratchpadRunId: "projection:loop:100:why-it-matters",
          blockType: "projection",
          frozenAt: 1_000,
        }),
      }),
    );
  });
});

describe("acceptDecorationIntoNotebook", () => {
  it("returns a successful materialization plan for a non-empty overlay", () => {
    const result = acceptDecorationIntoNotebook({
      decoration: makeDecoration(),
      frozenAt: 2_000,
    });

    expect(result).toEqual(
      expect.objectContaining({
        succeeded: true,
        frozenAt: 2_000,
      }),
    );
    expect(result.drafts?.length).toBeGreaterThan(0);
  });

  it("fails honestly when the overlay has no header or prose", () => {
    const result = acceptDecorationIntoNotebook({
      decoration: makeDecoration({ headerText: "", bodyProse: "" }),
      frozenAt: 2_000,
    });

    expect(result).toEqual({
      succeeded: false,
      failureReason: "Live decoration had no content to materialize.",
    });
  });
});
