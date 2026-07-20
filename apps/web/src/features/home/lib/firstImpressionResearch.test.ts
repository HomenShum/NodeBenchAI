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
    });
    expect(request).toMatchObject({
      pipelineKind: "research",
      spec: "Research Northstar Bio before my meeting",
      title: "Research Northstar Bio before my meeting",
      modelId: "nodebench:auto-balanced",
      forceFresh: true,
      linkupDepth: "standard",
    });
  });

  it("does not silently substitute a suggested prompt when the query is blank", () => {
    const request = createBackgroundResearchRequest({
      query: "   ",
    });
    expect(request.spec).toBe("");
    expect(request.title).toBe("");
  });
});
