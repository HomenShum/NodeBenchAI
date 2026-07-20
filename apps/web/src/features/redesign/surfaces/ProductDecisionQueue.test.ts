import { describe, expect, it } from "vitest";
import type { ReportCardData } from "../fixtures";
import type { EditionHypothesis } from "../hooks/useActiveHypotheses";
import type { EditionForecast } from "../hooks/useTopForecasts";
import {
  buildHomeDecisionQueue,
  buildReportsDecisionQueue,
  buildWorkspaceDecision,
} from "./ProductDecisionQueue";

const reports: ReportCardData[] = [
  {
    id: "rep_verified",
    entity: "VerifiedCo",
    kind: "Coverage",
    status: "verified",
    description: "Already reviewed.",
    sources: 12,
    claims: 5,
    followUps: 0,
    updatedAt: "today",
  },
  {
    id: "rep_review",
    entity: "ReviewCo",
    kind: "Diligence",
    status: "review",
    description: "Needs source support before export.",
    sources: 3,
    claims: 2,
    followUps: 1,
    updatedAt: "1h ago",
  },
];

function hypothesis(): EditionHypothesis {
  return {
    _id: "hyp_1",
    hypothesisId: "hyp_1",
    threadId: "thread_1",
    threadName: "Enterprise agents",
    label: "Review queue",
    title: "Raw title should not lead",
    claimForm: "Raw speculative claim should not render.",
    measurementApproach: "Check sources.",
    falsificationCriteria: "Contradicting source appears.",
    status: "active",
    confidence: 0.7,
    speculativeRisk: "mixed",
    supportingEvidenceCount: 2,
    contradictingEvidenceCount: 1,
    evidenceArtifactIds: ["src_1"],
    competingHypothesisIds: [],
    updatedAt: Date.now(),
    evidenceChecklist: {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: false,
      hasQuantitativeData: false,
      hasNamedAttribution: true,
      isReproducible: false,
    },
    evidenceChecksPassing: 3,
    evidenceChecksTotal: 6,
    evidenceLevel: "mixed",
  };
}

function forecast(): EditionForecast {
  return {
    _id: "forecast_1",
    question: "Will this raw predictive question render?",
    forecastType: "binary",
    probability: 0.58,
    previousProbability: 0.52,
    confidenceInterval: null,
    resolutionDate: "2026-06-30",
    resolutionCriteria: "Resolve from source ledger.",
    topDrivers: [],
    topCounterarguments: [],
    updateCount: 4,
    lastRefreshedAt: Date.now(),
    status: "active",
  };
}

describe("ProductDecisionQueue builders", () => {
  it("turns Home signals into a ranked queue without raw predictive copy", () => {
    const items = buildHomeDecisionQueue({
      pulses: {
        provenance: "public-trending",
        pulses: [
          {
            _id: "pulse_1",
            entitySlug: "orbital-labs",
            changeCount: 2,
            materialChangeCount: 1,
          },
        ],
      },
      hypotheses: [hypothesis()],
      forecasts: [forecast()],
      reports,
      sourceRows: [
        {
          id: "source_1",
          type: "web",
          title: "Primary source",
          refreshed: "today",
          reused: 2,
          excerpt: "Source support excerpt.",
          href: "https://example.com",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      lane: "Now",
      title: "Review orbital labs",
    });
    expect(items.some((item) => item.title === "Enterprise agents evidence review")).toBe(true);
    expect(items.map((item) => `${item.title} ${item.context}`).join(" ")).not.toMatch(
      /\b(will|So what|Raw speculative)\b/,
    );
  });

  it("ranks report review state ahead of verified reports", () => {
    const items = buildReportsDecisionQueue(reports);

    expect(items[0]).toMatchObject({
      lane: "Now",
      title: "ReviewCo",
      reportId: "rep_review",
    });
  });

  it("neutralizes inherited So What framing in report queue copy", () => {
    const items = buildReportsDecisionQueue([
      {
        ...reports[0],
        description: "What: A source changed. So What: This could reshape the market. Churn shifted (So What), review it now (Now What).",
        status: "review",
      },
    ]);

    expect(items[0].context).toContain("Review note:");
    expect(items[0].context).not.toContain("So What:");
    expect(items[0].context).not.toContain("(So What)");
    expect(items[0].context).not.toContain("(Now What)");
  });

  it("uses Workspace follow-ups before source checks or save prompts", () => {
    const item = buildWorkspaceDecision({
      title: "Workspace report",
      sourceCount: 10,
      claimCount: 4,
      followUps: 2,
      canVerifySources: true,
    });

    expect(item).toMatchObject({
      id: "workspace-followups",
      lane: "Now",
      title: "Clear linked follow-ups",
    });
  });
});
