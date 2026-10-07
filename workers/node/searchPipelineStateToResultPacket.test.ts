import { describe, expect, it } from "vitest";

import { stateToResultPacket, type PipelineState } from "./pipeline/searchPipeline.js";

function createState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    query: "What matters most about Stripe right now?",
    lens: "investor",
    contextHint: "investor | concise | citation heavy",
    classification: "company_search",
    entity: "Stripe",
    routingHints: [],
    searchAnswer: "Stripe search answer",
    searchSources: [
      {
        name: "Stripe investor update",
        url: "https://stripe.com/newsroom/investor-update",
        snippet: "Investor update on enterprise expansion.",
        domain: "stripe.com",
        siteName: "Stripe",
        qualityScore: 86,
      },
      {
        name: "CNBC on Stripe",
        url: "https://www.cnbc.com/stripe-growth",
        snippet: "Coverage of Stripe enterprise momentum.",
        domain: "cnbc.com",
        siteName: "CNBC",
        qualityScore: 77,
      },
    ],
    searchExploredSourceCount: 2,
    searchDiscardedSourceCount: 0,
    searchQueryVariants: [],
    entityName: "Stripe",
    answer:
      "Stripe is still deepening enterprise distribution.[S1] It also keeps expanding developer reach.[S2]",
    confidence: 82,
    signals: [
      { name: "Enterprise distribution", direction: "up", impact: "high", sourceIdx: 0 },
      { name: "Developer adoption", direction: "up", impact: "medium", sourceIdx: 1 },
    ],
    risks: [
      { title: "Margin opacity", description: "Operating leverage is still underexplained.", sourceIdx: 1 },
    ],
    comparables: [{ name: "Adyen", relevance: "high", note: "Payments peer." }],
    nextActions: [{ action: "Pressure-test monetization quality", impact: "high" }],
    nextQuestions: ["What evidence best supports durable margin expansion?"],
    keyMetrics: [{ label: "Enterprise share", value: "Growing" }],
    whyThisTeam: null,
    classifiedSignals: [
      {
        category: "GTM / Distribution",
        label: "Distribution Channel",
        rawName: "Enterprise distribution",
        direction: "up",
        impact: "high",
        confidence: 0.88,
        summary: "Enterprise distribution is strengthening.",
        evidenceRefs: ["src_0"],
        needsOntologyReview: false,
      },
      {
        category: "GTM / Distribution",
        label: "Developer Adoption",
        rawName: "Developer adoption",
        direction: "up",
        impact: "medium",
        confidence: 0.8,
        summary: "Developer adoption remains strong.",
        evidenceRefs: ["src_1"],
        needsOntologyReview: false,
      },
    ],
    evidence: {
      totalSpans: 2,
      verifiedCount: 2,
      contradictedCount: 0,
      unresolvedCount: 0,
      spans: [],
    },
    painResolutions: [],
    dcf: null,
    reverseDCF: null,
    trace: [],
    totalDurationMs: 1200,
    error: null,
    ...overrides,
  };
}

describe("stateToResultPacket", () => {
  it("emits canonical answer blocks with section-level source refs", () => {
    const packet = stateToResultPacket(createState()) as any;

    expect(packet.answerBlocks.map((block: any) => block.title)).toEqual([
      "What it is",
      "Why it matters",
      "What is missing",
      "What to do next",
    ]);
    expect(packet.answerBlocks[0]?.sourceRefIds).toEqual(["src_1", "src_2"]);
    expect(packet.answerBlocks[1]?.sourceRefIds).toEqual(["src_1", "src_2"]);
    expect(packet.answerBlocks[2]?.sourceRefIds).toEqual(["src_2"]);
    expect(packet.answerBlocks[3]?.text).toContain("Pressure-test monetization quality");
  });

  it("enriches variables, changes, risks, and interventions with sourceRefIds", () => {
    const packet = stateToResultPacket(createState()) as any;

    expect(packet.variables[0]?.sourceRefIds).toEqual(["src_1"]);
    expect(packet.changes[0]?.sourceRefIds).toEqual(["src_1"]);
    expect(packet.risks[0]?.sourceRefIds).toEqual(["src_2"]);
    expect(packet.interventions[0]?.sourceRefIds).toEqual(["src_1", "src_2"]);
    expect(packet.recommendedNextAction).toBe("Pressure-test monetization quality");
  });
});
