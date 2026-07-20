import { describe, expect, it } from "vitest";
import {
  reviewAgentResponse,
  summarizeResponseReviews,
  type AgentResponseReviewAggregateRow,
} from "../../shared/agentResponseFlywheel";

describe("agentResponseFlywheel", () => {
  it("flags freshness-sensitive responses that lack sources and absolute dates", () => {
    const review = reviewAgentResponse({
      prompt: "Look up the latest Chrome DevTools MCP release and verify it with sources.",
      response: "The latest release is probably recent. You should update it soon.",
    });

    expect(review.status).not.toBe("pass");
    expect(review.issueFlags).toContain("evidence_gap");
    expect(review.issueFlags).toContain("temporal_awareness_gap");
  });

  it("rewards implementation answers with code refs, dates, and next actions", () => {
    const review = reviewAgentResponse({
      prompt: "Implement the response flywheel in this repo and verify with sources.",
      response: [
        "Implemented the review hook in [responseFlywheel.ts](/abs/responseFlywheel.ts) and [fastAgentPanelStreaming.ts](/abs/fastAgentPanelStreaming.ts:10).",
        "As of March 19, 2026, the verification run is green.",
        "Next step: run `npx tsc --noEmit` and `npm run build`, then re-judge the last 40 replies.",
        "Sources: https://developer.chrome.com/blog/chrome-devtools-mcp",
      ].join("\n"),
    });

    expect(review.status).toBe("pass");
    expect(review.dimensions.evidenceGrounding).toBeGreaterThan(0.75);
    expect(review.dimensions.actionability).toBeGreaterThan(0.75);
  });

  it("summarizes review aggregates into a dashboard snapshot", () => {
    const rows: AgentResponseReviewAggregateRow[] = [
      {
        reviewKey: "r1",
        messageId: "m1",
        promptSummary: "How is the trajectory compounding?",
        status: "watch",
        overallScore: 0.64,
        matchedCategoryKeys: ["trajectory_compounding", "time_compounding_meta"],
        outputQualityScore: 0.7,
        evidenceGroundingScore: 0.55,
        actionabilityScore: 0.6,
        temporalAwarenessScore: 0.75,
        trustPostureScore: 0.62,
        compoundingFitScore: 0.8,
        routingFitScore: 0.78,
        weaknesses: ["Missing grounded sources."],
        recommendations: ["Add sources."],
        reviewedAt: Date.now(),
      },
      {
        reviewKey: "r2",
        messageId: "m2",
        promptSummary: "Implement the loop and verify it.",
        status: "pass",
        overallScore: 0.84,
        matchedCategoryKeys: ["judgment_layer", "operator_throughput"],
        outputQualityScore: 0.86,
        evidenceGroundingScore: 0.82,
        actionabilityScore: 0.9,
        temporalAwarenessScore: 0.8,
        trustPostureScore: 0.84,
        compoundingFitScore: 0.75,
        routingFitScore: 0.88,
        weaknesses: [],
        recommendations: [],
        reviewedAt: Date.now() - 10_000,
      },
    ];

    const snapshot = summarizeResponseReviews(rows);
    expect(snapshot.summary.totalReviews).toBe(2);
    expect(snapshot.summary.passCount).toBe(1);
    expect(snapshot.summary.hottestQuestionCategory?.count).toBeGreaterThan(0);
    expect(snapshot.dimensions.length).toBe(7);
  });
});
