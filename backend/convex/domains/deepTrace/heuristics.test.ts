import { describe, expect, it } from "vitest";

import type { DDSource } from "../agents/dueDiligence/types";
import type { ExtractionResult } from "../temporal/langExtract";
import {
  buildCausalChainSeedFromWorldEvent,
  buildEntityContextObservationSeeds,
  buildEntityContextWorldEventSeeds,
  buildObservationSeedsFromDueDiligence,
  buildRelationshipObservationSeedsFromExtraction,
  buildWorldEventSeedsFromDueDiligence,
  buildWorldEventSeedsFromExtraction,
} from "./heuristics";

const observedAt = Date.parse("2026-03-13T12:00:00.000Z");

const extractionFixture: ExtractionResult = {
  entities: [
    {
      name: "ByteDance",
      type: "company",
      confidence: 0.97,
      mentions: [{ lineStart: 1, lineEnd: 1, excerpt: "ByteDance", context: "ByteDance context" }],
    },
    {
      name: "Meta Platforms",
      type: "company",
      confidence: 0.93,
      mentions: [{ lineStart: 2, lineEnd: 2, excerpt: "Meta Platforms", context: "Meta context" }],
    },
    {
      name: "NVIDIA",
      type: "company",
      confidence: 0.94,
      mentions: [{ lineStart: 3, lineEnd: 3, excerpt: "NVIDIA", context: "NVIDIA context" }],
    },
    {
      name: "General Atlantic",
      type: "company",
      confidence: 0.88,
      mentions: [{ lineStart: 4, lineEnd: 4, excerpt: "General Atlantic", context: "GA context" }],
    },
    {
      name: "TikTok Shop",
      type: "product",
      confidence: 0.81,
      mentions: [{ lineStart: 5, lineEnd: 5, excerpt: "TikTok Shop", context: "Product context" }],
    },
  ],
  claims: [
    {
      claimText: "ByteDance competes with Meta Platforms in short-form video advertising.",
      claimType: "factual",
      entities: ["ByteDance", "Meta Platforms"],
      confidence: 0.8,
      sourceSpan: { lineStart: 2, lineEnd: 2, excerpt: "ByteDance competes with Meta Platforms." },
    },
    {
      claimText: "NVIDIA supplies ByteDance with AI accelerators for training clusters.",
      claimType: "factual",
      entities: ["ByteDance", "NVIDIA"],
      confidence: 0.77,
      sourceSpan: { lineStart: 3, lineEnd: 3, excerpt: "NVIDIA supplies ByteDance with AI accelerators." },
    },
    {
      claimText: "ByteDance is backed by General Atlantic and other investors.",
      claimType: "factual",
      entities: ["ByteDance", "General Atlantic"],
      confidence: 0.74,
      sourceSpan: { lineStart: 4, lineEnd: 4, excerpt: "ByteDance is backed by General Atlantic." },
    },
    {
      claimText: "The EU restricted ByteDance after a policy investigation, which could affect distribution in Europe.",
      claimType: "causal",
      entities: ["ByteDance"],
      confidence: 0.86,
      sourceSpan: { lineStart: 5, lineEnd: 5, excerpt: "The EU restricted ByteDance after a policy investigation." },
    },
    {
      claimText: "ByteDance launched TikTok Shop in a new market, changing competitive pressure for local commerce players.",
      claimType: "causal",
      entities: ["ByteDance", "TikTok Shop"],
      confidence: 0.83,
      sourceSpan: { lineStart: 6, lineEnd: 6, excerpt: "ByteDance launched TikTok Shop in a new market." },
    },
  ],
  temporalMarkers: [{ text: "2026", resolvedDate: observedAt, lineNumber: 1 }],
  numericFacts: [{ metric: "market_share", value: 24, units: "%", context: "Example metric", lineNumber: 2 }],
  sourceMetadata: {
    totalLines: 6,
    totalChars: 420,
    extractionDurationMs: 1100,
  },
};

const ddSources: DDSource[] = [
  {
    sourceType: "company_website",
    title: "Company leadership page",
    url: "https://example.com/leadership",
    accessedAt: observedAt,
    reliability: "authoritative",
    branchType: "team_founders",
    section: "leadership",
  },
  {
    sourceType: "news_article",
    title: "Funding round coverage",
    url: "https://example.com/funding",
    accessedAt: observedAt,
    reliability: "reliable",
    branchType: "financial_deep",
    section: "funding",
  },
];

describe("deepTrace heuristics", () => {
  it("builds relationship observations from entity context and dedupes repeated investors", () => {
    const seeds = buildEntityContextObservationSeeds({
      entityName: "ByteDance",
      entityType: "company",
      researchedAt: observedAt,
      summary: "Short-form video and commerce platform.",
      people: {
        founders: [{ name: "Zhang Yiming", title: "Founder" }],
        executives: [{ name: "Shou Zi Chew", title: "CEO" }],
        boardMembers: [{ name: "Bill Ford", title: "Board Director" }],
      },
      crmFields: {
        investors: ["General Atlantic"],
        competitors: ["Meta Platforms"],
        partnerships: ["AWS supplier", "Walmart customer", "CapCut subsidiary"],
      },
      funding: {
        investors: ["General Atlantic"],
        lastRound: {
          coLeads: ["SoftBank Vision Fund"],
          participants: ["General Atlantic"],
        },
      },
      sources: [{ name: "Entity memo", url: "https://example.com/memo", snippet: "Analyst summary" }],
    });

    expect(seeds.filter((seed) => seed.relationshipType === "investor" && seed.relatedEntityName === "General Atlantic")).toHaveLength(1);
    expect(seeds.some((seed) => seed.relationshipType === "founder" && seed.relatedEntityName === "Zhang Yiming")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "executive" && seed.relatedEntityName === "Shou Zi Chew")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "board_member" && seed.relatedEntityName === "Bill Ford")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "competitor" && seed.relatedEntityName === "Meta Platforms")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "supplier" && seed.relatedEntityName === "AWS supplier")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "customer" && seed.relatedEntityName === "Walmart customer")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "subsidiary" && seed.relatedEntityName === "CapCut subsidiary")).toBe(true);
  });

  it("builds entity-context world events with topic detection and dedupe", () => {
    const seeds = buildEntityContextWorldEventSeeds({
      entityName: "ByteDance",
      recentNewsItems: [
        {
          headline: "EU restricted ByteDance distribution in one market",
          summary: "Regulators restricted the app after a policy review.",
          source: "Policy desk",
          url: "https://example.com/policy",
          publishedAt: observedAt,
        },
        {
          headline: "EU restricted ByteDance distribution in one market",
          summary: "Regulators restricted the app after a policy review.",
          source: "Policy desk",
          url: "https://example.com/policy",
          publishedAt: observedAt,
        },
      ],
    });

    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.topic).toBe("policy restriction");
    expect(seeds[0]?.severity).toBe("high");
    expect(seeds[0]?.primaryEntityKey).toBe("company:bytedance");
  });

  it("maps structured extraction claims into relationship observations for competitors, suppliers, and investors", () => {
    const seeds = buildRelationshipObservationSeedsFromExtraction({
      entityKey: "company:bytedance",
      entityName: "ByteDance",
      extraction: extractionFixture,
      observedAt,
      sourceRefs: [{ label: "Extraction artifact", href: "https://example.com/extract", kind: "artifact" }],
    });

    expect(seeds.some((seed) => seed.relationshipType === "competitor" && seed.relatedEntityName === "Meta Platforms")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "supplier" && seed.relatedEntityName === "NVIDIA")).toBe(true);
    expect(seeds.some((seed) => seed.relationshipType === "investor" && seed.relatedEntityName === "General Atlantic")).toBe(true);
    expect(seeds.every((seed) => seed.subjectEntityKey === "company:bytedance")).toBe(true);
    expect(seeds.every((seed) => (seed.sourceRefs ?? []).some((ref) => ref.kind === "structured_extraction"))).toBe(true);
  });

  it("maps structured extraction claims into world events and preserves causal summaries", () => {
    const seeds = buildWorldEventSeedsFromExtraction({
      entityKey: "company:bytedance",
      entityName: "ByteDance",
      extraction: extractionFixture,
      observedAt,
      sourceRefs: [{ label: "Extraction artifact", href: "https://example.com/extract", kind: "artifact" }],
    });

    expect(seeds.some((seed) => seed.topic === "policy restriction" && seed.severity === "high")).toBe(true);
    expect(seeds.some((seed) => seed.topic === "product launch" && seed.severity === "medium")).toBe(true);
    expect(seeds.some((seed) => typeof seed.causalSummary === "string" && seed.causalSummary.includes("affect"))).toBe(true);
  });

  it("builds due-diligence observations for people, investors, competitors, and network edges", () => {
    const teamSeeds = buildObservationSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "team_founders",
      findings: {
        founders: [{ name: "Zhang Yiming", title: "Founder" }],
        executives: [{ name: "Shou Zi Chew", title: "CEO" }],
        boardMembers: [{ name: "Bill Ford", title: "Board Director" }],
        advisors: [{ name: "Mary Meeker", title: "Advisor" }],
        trackRecordSummary: "Strong team",
        teamStrengths: [],
        teamGaps: [],
        keyPersonRisk: [],
      },
      sources: ddSources,
      confidence: 0.71,
      observedAt,
    });
    const marketSeeds = buildObservationSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "market_competitive",
      findings: {
        competitors: [{ name: "Meta Platforms", threat: "high", differentiator: "Global ad stack" }],
        differentiators: ["Recommendation engine"],
        tailwinds: [],
        headwinds: [],
        marketRisks: [],
      },
      sources: ddSources,
      observedAt,
    });
    const financialSeeds = buildObservationSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "financial_deep",
      findings: {
        fundingHistory: [{ roundType: "Series D", amount: "$2B", leadInvestors: ["General Atlantic"] }],
      },
      sources: ddSources,
      observedAt,
    });
    const networkSeeds = buildObservationSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "network_mapping",
      findings: {
        networkGraph: {
          nodes: [
            { id: "company:bytedance", name: "ByteDance", type: "company" },
            { id: "person:zhang-yiming", name: "Zhang Yiming", type: "person" },
            { id: "company:sequoia-capital", name: "Sequoia Capital", type: "investor" },
          ],
          edges: [
            { source: "person:zhang-yiming", target: "company:bytedance", relationship: "founder network" },
            { source: "company:sequoia-capital", target: "company:bytedance", relationship: "investor overlap" },
          ],
        },
        keyConnections: [],
        investorNetwork: ["General Atlantic"],
        advisorNetwork: ["Mary Meeker"],
        potentialConflicts: [],
        referenceability: 0.83,
      },
      sources: ddSources,
      observedAt,
    });

    const allSeeds = [...teamSeeds, ...marketSeeds, ...financialSeeds, ...networkSeeds];

    expect(allSeeds.some((seed) => seed.relationshipType === "founder" && seed.relatedEntityName === "Zhang Yiming")).toBe(true);
    expect(allSeeds.some((seed) => seed.relationshipType === "advisor" && seed.relatedEntityName === "Mary Meeker")).toBe(true);
    expect(allSeeds.some((seed) => seed.relationshipType === "competitor" && seed.relatedEntityName === "Meta Platforms")).toBe(true);
    expect(allSeeds.some((seed) => seed.relationshipType === "investor" && seed.relatedEntityName === "General Atlantic")).toBe(true);
    expect(allSeeds.some((seed) => seed.relationshipType === "founder_network" && seed.relatedEntityName === "Zhang Yiming")).toBe(true);
    expect(allSeeds.some((seed) => seed.relationshipType === "investor_overlap" && seed.relatedEntityName === "Sequoia Capital")).toBe(true);
  });

  it("builds due-diligence world events for regulatory and funding branches", () => {
    const regulatorySeeds = buildWorldEventSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "regulatory",
      findings: {
        regulatoryBody: "European Commission",
        currentStatus: "Under review for distribution changes",
        filings: [],
        approvals: ["Data transfer approval"],
        pendingApprovals: ["Commerce license"],
        complianceRisks: ["Export control investigation could constrain model deployment"],
      },
      sources: ddSources,
      observedAt,
    });
    const financialSeeds = buildWorldEventSeedsFromDueDiligence({
      entityName: "ByteDance",
      entityType: "company",
      branchType: "financial_deep",
      findings: {
        fundingHistory: [{ roundType: "Series D", amount: "$2B", valuation: "$180B" }],
      },
      sources: ddSources,
      observedAt,
    });

    expect(regulatorySeeds.some((seed) => seed.topic === "regulatory approval")).toBe(true);
    expect(regulatorySeeds.some((seed) => seed.topic === "regulatory risk" && seed.severity === "high")).toBe(true);
    expect(financialSeeds).toHaveLength(1);
    expect(financialSeeds[0]?.topic).toBe("funding");
    expect(financialSeeds[0]?.summary).toContain("$2B");
  });

  it("builds causal chains only for events with impact-bearing summaries", () => {
    const chain = buildCausalChainSeedFromWorldEvent({
      title: "EU restricted ByteDance distribution",
      summary: "This change may affect distribution, revenue pressure, and strategic response timing.",
      topic: "policy restriction",
      severity: "high",
      happenedAt: observedAt,
      primaryEntityKey: "company:bytedance",
      sourceRefs: [{ label: "Policy desk", href: "https://example.com/policy" }],
      causalSummary: "Restriction may affect distribution and competitive response in Europe.",
    });
    const noChain = buildCausalChainSeedFromWorldEvent({
      title: "ByteDance update",
      summary: "A factual status update with no explicit downstream implication.",
      topic: "entity development",
      severity: "low",
      happenedAt: observedAt,
      sourceRefs: [{ label: "Status note" }],
    });

    expect(chain).not.toBeNull();
    expect(chain?.nodes).toHaveLength(2);
    expect(chain?.entityKey).toBe("company:bytedance");
    expect(noChain).toBeNull();
  });
});
