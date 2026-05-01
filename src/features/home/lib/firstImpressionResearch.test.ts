import { describe, expect, it } from "vitest";

import {
  createBackgroundResearchRequest,
  getFirstImpressionCards,
} from "./firstImpressionResearch";

describe("first impression research", () => {
  it("surfaces audience-specific cards by horizon", () => {
    expect(getFirstImpressionCards("today").map((card) => card.audience)).toEqual([
      "Teacher",
      "Banker",
    ]);
    expect(getFirstImpressionCards("month")).toHaveLength(1);
  });

  it("builds a durable research workflow request from query text", () => {
    const request = createBackgroundResearchRequest({
      query: "Research Northstar Bio before my meeting",
      fallbackPrompt: "fallback",
      ownerKey: "session:abc",
    });
    expect(request).toMatchObject({
      pipelineKind: "research",
      spec: "Research Northstar Bio before my meeting",
      title: "Research Northstar Bio before my meeting",
      modelId: "gpt-4o-mini",
      ownerKey: "session:abc",
      forceFresh: true,
      linkupDepth: "standard",
    });
  });

  it("uses the suggested card prompt when the query is blank", () => {
    const request = createBackgroundResearchRequest({
      query: "   ",
      fallbackPrompt: "Research scattered salary and culture signals.",
    });
    expect(request.spec).toBe("Research scattered salary and culture signals.");
  });
});
