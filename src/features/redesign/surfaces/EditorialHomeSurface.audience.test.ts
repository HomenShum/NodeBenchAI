import { describe, expect, it } from "vitest";
import {
  getForecastReviewSummary,
  getHypothesisReviewSummary,
  getHypothesisReviewTitle,
  HOME_AUDIENCE_RELEVANCE_SECTION,
  HOME_EVIDENCE_WATCHLIST_SECTION,
} from "./EditorialHomeAudienceRelevance";
import type { EditionHypothesis } from "../hooks/useActiveHypotheses";

function makeHypothesis(
  overrides: Partial<EditionHypothesis> = {},
): EditionHypothesis {
  return {
    _id: "hyp_1",
    hypothesisId: "hyp_1",
    threadId: "thread_1",
    threadName: "Enterprise agents",
    label: "Review queue",
    title: "Sierra source review",
    claimForm: "Sierra will reshape enterprise AI workflows.",
    measurementApproach: "Track primary sources and customer evidence.",
    falsificationCriteria: "Primary sources contradict the funding or adoption claim.",
    status: "active",
    confidence: 0.67,
    speculativeRisk: "mixed",
    supportingEvidenceCount: 3,
    contradictingEvidenceCount: 1,
    evidenceArtifactIds: ["src_1"],
    competingHypothesisIds: [],
    updatedAt: Date.parse("2026-05-11T12:00:00.000Z"),
    evidenceChecklist: {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: false,
      hasQuantitativeData: true,
      hasNamedAttribution: false,
      isReproducible: true,
    },
    evidenceChecksPassing: 4,
    evidenceChecksTotal: 6,
    evidenceLevel: "grounded",
    ...overrides,
  };
}

describe("EditorialHomeSurface audience relevance framing", () => {
  it("uses workflow relevance labels instead of speculative So what copy", () => {
    expect(HOME_AUDIENCE_RELEVANCE_SECTION).toEqual({
      kicker: "Audience relevance",
      tocLabel: "Useful",
      heading: "Why this is useful",
    });
    expect(HOME_EVIDENCE_WATCHLIST_SECTION).toEqual({
      kicker: "Evidence watchlist",
      tocLabel: "Check",
      heading: "What to check next",
    });
  });

  it("summarizes hypothesis rows as evidence review state", () => {
    const hypothesis = makeHypothesis();
    const title = getHypothesisReviewTitle(hypothesis);
    const summary = getHypothesisReviewSummary(hypothesis);

    expect(title).toBe("Enterprise agents evidence review");
    expect(summary).toBe(
      "3 supporting refs | 1 contradicting refs | 4/6 evidence checks passing | Enterprise agents review queue",
    );
    expect(title).not.toContain("Sierra source review");
    expect(summary).not.toContain("will reshape");
    expect(summary).not.toContain("So what");
  });

  it("summarizes forecasts as a ledger watchlist, not raw predictive questions", () => {
    const summary = getForecastReviewSummary({
      probability: 0.58,
      previousProbability: 0.52,
      resolutionDate: "2026-06-30",
      updateCount: 4,
      status: "active",
    });

    expect(summary).toBe(
      "58% current ledger | 52% previous ledger | 4 updates logged | resolution 2026-06-30 | active status",
    );
    expect(summary).not.toMatch(/\b(will|likely|could|should)\b/i);
    expect(summary).not.toContain("So what");
  });
});
