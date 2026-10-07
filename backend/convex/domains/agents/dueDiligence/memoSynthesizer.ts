/**
 * memoSynthesizer.ts
 *
 * Synthesizes findings from all DD branches into a traditional IC/VC memo structure.
 * Generates:
 * - Executive Summary
 * - Investment Verdict (STRONG_BUY, BUY, HOLD, PASS)
 * - Seven-section memo per IC expectations
 * - Persona readiness evaluation
 */

import {
  DDMemo,
  Verdict,
  BranchType,
  Contradiction,
  DDSource,
  MemoCompanyOverview,
  MemoMarketAnalysis,
  MemoTeamAnalysis,
  MemoFundingHistory,
  MemoRisk,
  MemoInvestmentThesis,
  MemoVerificationSummary,
  RiskCategory,
  RiskSeverity,
  TeamMemberProfile,
  CompanyProfileFindings,
  TeamFoundersFindings,
  MarketCompetitiveFindings,
  FinancialDeepFindings,
  TechnicalDDFindings,
  RegulatoryFindings,
  IPPatentsFindings,
  NetworkMappingFindings,
} from "./types";

// ============================================================================
// Types
// ============================================================================

interface BranchResult {
  branchType: BranchType;
  findings: any;
  confidence?: number;
  sources: DDSource[];
}

interface SynthesisInput {
  jobId: string;
  entityName: string;
  entityType: "company" | "fund" | "person";
  branchResults: BranchResult[];
  contradictions: Contradiction[];
}

// ============================================================================
// Main Synthesis Function
// ============================================================================

/**
 * Synthesize all branch findings into a traditional DD memo
 */
export function synthesizeDDMemo(input: SynthesisInput): DDMemo {
  const {
    jobId,
    entityName,
    entityType,
    branchResults,
    contradictions,
  } = input;

  const now = Date.now();

  // Extract findings by branch type
  const getFindings = <T>(branchType: BranchType): T | undefined =>
    branchResults.find(r => r.branchType === branchType)?.findings as T | undefined;

  const companyProfile = getFindings<CompanyProfileFindings>("company_profile");
  const teamFounders = getFindings<TeamFoundersFindings>("team_founders");
  const marketCompetitive = getFindings<MarketCompetitiveFindings>("market_competitive");
  const financialDeep = getFindings<FinancialDeepFindings>("financial_deep");
  const technicalDD = getFindings<TechnicalDDFindings>("technical_dd");
  const ipPatents = getFindings<IPPatentsFindings>("ip_patents");
  const regulatory = getFindings<RegulatoryFindings>("regulatory");
  const networkMapping = getFindings<NetworkMappingFindings>("network_mapping");

  // Aggregate all sources
  const allSources = aggregateSources(branchResults);

  // Build each section
  const companyOverview = buildCompanyOverview(companyProfile, entityName);
  const marketAnalysis = buildMarketAnalysis(marketCompetitive);
  const teamAnalysis = buildTeamAnalysis(teamFounders, networkMapping);
  const fundingHistory = buildFundingHistory(financialDeep);
  const risks = buildRisks(
    companyProfile,
    teamFounders,
    marketCompetitive,
    regulatory,
    technicalDD
  );
  const investmentThesis = buildInvestmentThesis(
    companyProfile,
    teamFounders,
    marketCompetitive,
    risks
  );
  const verificationSummary = buildVerificationSummary(
    branchResults,
    contradictions,
    allSources
  );

  // Calculate verdict
  const verdict = calculateVerdict(
    verificationSummary.overallConfidence,
    verificationSummary.dataCompleteness,
    risks
  );

  // Generate executive summary
  const executiveSummary = generateExecutiveSummary(
    entityName,
    companyOverview,
    teamAnalysis,
    marketAnalysis,
    verdict
  );

  // Generate verdict rationale
  const verdictRationale = generateVerdictRationale(verdict, verificationSummary, risks);

  // Evaluate persona readiness
  const personaReadiness = evaluatePersonaReadiness(
    companyOverview,
    teamAnalysis,
    marketAnalysis,
    fundingHistory,
    allSources
  );

  return {
    jobId,
    entityName,
    entityType,
    executiveSummary,
    verdict,
    verdictRationale,
    companyOverview,
    marketAnalysis,
    teamAnalysis,
    fundingHistory,
    risks,
    investmentThesis,
    verificationSummary,
    sources: allSources,
    personaReadiness,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

// ============================================================================
// Section Builders
// ============================================================================

function buildCompanyOverview(
  profile: CompanyProfileFindings | undefined,
  entityName: string
): MemoCompanyOverview {
  return {
    description: profile?.description ?? `${entityName} - description pending`,
    hqLocation: profile?.hqLocation,
    foundedYear: profile?.foundedYear,
    employeeCount: profile?.employeeCount,
    employeeGrowth: profile?.employeeGrowth,
    sectors: profile?.sectors ?? [],
    stage: profile?.stage,
    businessModel: profile?.businessModel,
    keyProducts: profile?.keyProducts ?? [],
  };
}

function buildMarketAnalysis(
  market: MarketCompetitiveFindings | undefined
): MemoMarketAnalysis {
  return {
    marketSize: market?.marketSize?.tam,
    marketGrowth: market?.marketGrowth,
    competitors: (market?.competitors ?? []).map(c => ({
      name: c.name,
      description: c.description,
      fundingStage: c.fundingStage,
      differentiator: c.differentiator,
    })),
    differentiators: market?.differentiators ?? [],
    whyNow: market?.whyNow,
    tailwinds: market?.tailwinds ?? [],
    headwinds: market?.headwinds ?? [],
  };
}

function buildTeamAnalysis(
  team: TeamFoundersFindings | undefined,
  network: NetworkMappingFindings | undefined
): MemoTeamAnalysis {
  return {
    founders: team?.founders ?? [],
    executives: team?.executives ?? [],
    boardMembers: team?.boardMembers ?? [],
    advisors: team?.advisors,
    networkGraph: network?.networkGraph,
    trackRecordSummary: team?.trackRecordSummary,
    teamStrengths: team?.teamStrengths ?? [],
    teamGaps: team?.teamGaps ?? [],
    founderMarketFit: team?.founderMarketFit,
  };
}

function buildFundingHistory(
  financial: FinancialDeepFindings | undefined
): MemoFundingHistory {
  return {
    totalRaised: financial?.totalRaised,
    rounds: (financial?.fundingHistory ?? []).map(r => ({
      roundType: r.roundType,
      date: r.date,
      amount: r.amount,
      leadInvestors: r.leadInvestors,
      valuation: r.valuation,
      verified: r.verified,
      source: r.source,
    })),
    valuationComps: financial?.valuationComps
      ? { comparables: financial.valuationComps }
      : undefined,
    burnRate: financial?.burnRate,
    runway: financial?.runway,
  };
}

function buildRisks(
  company: CompanyProfileFindings | undefined,
  team: TeamFoundersFindings | undefined,
  market: MarketCompetitiveFindings | undefined,
  regulatory: RegulatoryFindings | undefined,
  technical: TechnicalDDFindings | undefined
): MemoRisk[] {
  const risks: MemoRisk[] = [];

  // Team risks
  if (team?.teamGaps && team.teamGaps.length > 0) {
    risks.push({
      category: "Team",
      description: `Team gaps: ${team.teamGaps.slice(0, 2).join("; ")}`,
      severity: "medium",
      likelihood: "medium",
    });
  }

  if (team?.keyPersonRisk && team.keyPersonRisk.length > 0) {
    risks.push({
      category: "Team",
      description: `Key person dependency: ${team.keyPersonRisk[0]}`,
      severity: "high",
      likelihood: "medium",
      mitigation: "Build team redundancy and succession planning",
    });
  }

  if (!team?.hasSerialFounders && !team?.hasVCBackedFounders) {
    risks.push({
      category: "Execution",
      description: "First-time founders without proven track record",
      severity: "medium",
      likelihood: "medium",
      mitigation: "Strong advisory board and experienced executives",
    });
  }

  // Market risks
  const highThreatCompetitors = market?.competitors?.filter(c => c.threat === "high") ?? [];
  if (highThreatCompetitors.length >= 2) {
    risks.push({
      category: "Competitive",
      description: `Facing ${highThreatCompetitors.length} well-funded competitors: ${highThreatCompetitors.map(c => c.name).slice(0, 3).join(", ")}`,
      severity: "high",
      likelihood: "high",
      mitigation: "Focus on differentiated value proposition",
    });
  }

  if (market?.headwinds && market.headwinds.length > 0) {
    for (const headwind of market.headwinds.slice(0, 2)) {
      risks.push({
        category: "Market",
        description: headwind,
        severity: "medium",
        likelihood: "medium",
      });
    }
  }

  // Regulatory risks
  if (regulatory?.complianceRisks && regulatory.complianceRisks.length > 0) {
    for (const risk of regulatory.complianceRisks.slice(0, 2)) {
      risks.push({
        category: "Regulatory",
        description: risk,
        severity: "high",
        likelihood: "medium",
        timeframe: "Near-term to medium-term",
      });
    }
  }

  // Technical risks
  if (technical?.technicalDebt?.includes("Legacy")) {
    risks.push({
      category: "Technical",
      description: "Legacy technology stack may require modernization",
      severity: "medium",
      likelihood: "medium",
      mitigation: "Technical debt reduction roadmap",
    });
  }

  // Financial risks
  if (!company?.stage || company.stage === "Seed") {
    risks.push({
      category: "Financial",
      description: "Early stage with unproven unit economics",
      severity: "medium",
      likelihood: "medium",
    });
  }

  return risks;
}

function buildInvestmentThesis(
  company: CompanyProfileFindings | undefined,
  team: TeamFoundersFindings | undefined,
  market: MarketCompetitiveFindings | undefined,
  risks: MemoRisk[]
): MemoInvestmentThesis {
  const keyDrivers: string[] = [];

  // Market tailwinds
  if (market?.tailwinds && market.tailwinds.length > 0) {
    keyDrivers.push(`Market tailwinds: ${market.tailwinds[0]}`);
  }

  // Differentiation
  if (market?.differentiators && market.differentiators.length > 0) {
    keyDrivers.push(`Differentiation: ${market.differentiators[0]}`);
  }

  // Team strength
  if (team?.hasSerialFounders) {
    keyDrivers.push("Serial founders with exit experience");
  }
  if (team?.hasVCBackedFounders) {
    keyDrivers.push("Founders with prior VC-backed company experience");
  }

  // Market timing
  if (market?.whyNow) {
    keyDrivers.push(`Market timing: ${market.whyNow}`);
  }

  // Build thesis summary
  const thesisSummary = keyDrivers.length > 0
    ? `Investment opportunity based on ${keyDrivers.slice(0, 2).join(" and ")}`
    : "Investment thesis requires further validation";

  // Key milestones
  const keyMilestones: Array<{ milestone: string; timeframe?: string }> = [
    { milestone: "Product-market fit validation", timeframe: "Near-term" },
    { milestone: "Revenue growth acceleration", timeframe: "Medium-term" },
    { milestone: "Team expansion in key roles", timeframe: "Near-term" },
  ];

  // Exit scenarios
  const exitScenarios: Array<{
    scenario: string;
    probability: string;
    potentialReturn?: string;
    acquirers?: string[];
  }> = [
    {
      scenario: "Strategic acquisition by industry leader",
      probability: "Medium",
      potentialReturn: "3-5x",
    },
    {
      scenario: "IPO / public listing",
      probability: "Low",
      potentialReturn: "5-10x",
    },
    {
      scenario: "Growth equity / continuation fund",
      probability: "High",
      potentialReturn: "2-3x",
    },
  ];

  return {
    thesisSummary,
    keyDrivers,
    keyMilestones,
    exitScenarios,
  };
}

function buildVerificationSummary(
  branchResults: BranchResult[],
  contradictions: Contradiction[],
  sources: DDSource[]
): MemoVerificationSummary {
  // Calculate confidence
  const branchConfidences = branchResults
    .map(b => b.confidence)
    .filter((c): c is number => c !== undefined);

  const avgConfidence = branchConfidences.length > 0
    ? branchConfidences.reduce((a, b) => a + b, 0) / branchConfidences.length
    : 0.5;

  // Penalty for unresolved contradictions
  const unresolvedCount = contradictions.filter(c => c.resolution === "unresolved").length;
  const resolvedCount = contradictions.length - unresolvedCount;
  const confidencePenalty = unresolvedCount * 0.05;
  const overallConfidence = Math.max(0, avgConfidence - confidencePenalty);

  // Calculate data completeness
  const requiredBranches = ["company_profile", "team_founders", "market_competitive"];
  const completedBranches = branchResults.filter(b =>
    b.findings !== null && requiredBranches.includes(b.branchType)
  ).length;
  const dataCompleteness = completedBranches / requiredBranches.length;

  // Assess source quality
  const authoritativeCount = sources.filter(s => s.reliability === "authoritative").length;
  const reliableCount = sources.filter(s => s.reliability === "reliable").length;

  const sourceQuality: "high" | "medium" | "low" =
    authoritativeCount >= 2 || (authoritativeCount >= 1 && reliableCount >= 3)
      ? "high"
      : reliableCount >= 2
        ? "medium"
        : "low";

  return {
    contradictionsFound: contradictions.length,
    contradictionsResolved: resolvedCount,
    overallConfidence,
    dataCompleteness,
    sourceQuality,
  };
}

// ============================================================================
// Verdict Calculation
// ============================================================================

function calculateVerdict(
  confidence: number,
  dataCompleteness: number,
  risks: MemoRisk[]
): Verdict {
  // Insufficient data check
  if (dataCompleteness < 0.4) {
    return "INSUFFICIENT_DATA";
  }

  // Count risks by severity
  const criticalRisks = risks.filter(r => r.severity === "critical").length;
  const highRisks = risks.filter(r => r.severity === "high").length;
  const mediumRisks = risks.filter(r => r.severity === "medium").length;

  // Critical risks = automatic PASS
  if (criticalRisks > 0) {
    return "PASS";
  }

  // Multiple high risks = PASS
  if (highRisks >= 3) {
    return "PASS";
  }

  // 2+ high risks = HOLD at best
  if (highRisks >= 2) {
    return "HOLD";
  }

  // High confidence + low risk = STRONG_BUY
  if (confidence >= 0.8 && highRisks === 0 && mediumRisks <= 2) {
    return "STRONG_BUY";
  }

  // Good confidence = BUY
  if (confidence >= 0.6 && highRisks <= 1) {
    return "BUY";
  }

  // Moderate confidence or some risks = HOLD
  if (confidence >= 0.4) {
    return "HOLD";
  }

  // Low confidence = PASS
  return "PASS";
}

// ============================================================================
// Executive Summary Generation
// ============================================================================

function generateExecutiveSummary(
  entityName: string,
  company: MemoCompanyOverview,
  team: MemoTeamAnalysis,
  market: MemoMarketAnalysis,
  verdict: Verdict
): string {
  const parts: string[] = [];

  // Company intro
  const sectors = company.sectors.length > 0
    ? company.sectors.slice(0, 2).join("/")
    : "technology";

  const location = company.hqLocation ? ` based in ${company.hqLocation}` : "";
  const founded = company.foundedYear ? `, founded in ${company.foundedYear}` : "";

  parts.push(
    `${entityName} is a ${company.stage ?? "early-stage"} ${sectors} company${location}${founded}.`
  );

  // Description
  if (company.description && company.description.length > 50) {
    parts.push(company.description);
  }

  // Team highlight
  const founderCount = team.founders.length;
  if (founderCount > 0) {
    const trackRecord = team.trackRecordSummary
      ? ` with ${team.trackRecordSummary}`
      : "";
    parts.push(`The company has ${founderCount} founder${founderCount > 1 ? "s" : ""}${trackRecord}.`);
  }

  // Market context
  if (market.marketSize) {
    parts.push(`Operating in a ${market.marketSize} market${market.marketGrowth ? ` growing at ${market.marketGrowth}` : ""}.`);
  }

  // Competitive position
  if (market.differentiators.length > 0) {
    parts.push(`Key differentiator: ${market.differentiators[0]}.`);
  }

  // Verdict
  const verdictText: Record<Verdict, string> = {
    STRONG_BUY: "Strong recommendation to proceed with investment diligence.",
    BUY: "Positive outlook - recommend continued evaluation.",
    HOLD: "Requires additional validation before proceeding.",
    PASS: "Significant concerns identified - not recommended at this time.",
    INSUFFICIENT_DATA: "Insufficient data to form investment recommendation.",
  };

  parts.push(`\n**Verdict: ${verdict}** - ${verdictText[verdict]}`);

  return parts.join(" ");
}

function generateVerdictRationale(
  verdict: Verdict,
  verification: MemoVerificationSummary,
  risks: MemoRisk[]
): string {
  const parts: string[] = [];

  parts.push(`Data completeness: ${(verification.dataCompleteness * 100).toFixed(0)}%`);
  parts.push(`Overall confidence: ${(verification.overallConfidence * 100).toFixed(0)}%`);
  parts.push(`Source quality: ${verification.sourceQuality}`);

  if (verification.contradictionsFound > 0) {
    const resolved = verification.contradictionsResolved;
    const unresolved = verification.contradictionsFound - resolved;
    parts.push(`Contradictions: ${resolved} resolved, ${unresolved} unresolved`);
  }

  const criticalRisks = risks.filter(r => r.severity === "critical").length;
  const highRisks = risks.filter(r => r.severity === "high").length;

  if (criticalRisks > 0) {
    parts.push(`Critical risks: ${criticalRisks}`);
  }
  if (highRisks > 0) {
    parts.push(`High risks: ${highRisks}`);
  }

  return parts.join("; ");
}

// ============================================================================
// Persona Readiness Evaluation
// ============================================================================

function evaluatePersonaReadiness(
  company: MemoCompanyOverview,
  team: MemoTeamAnalysis,
  market: MemoMarketAnalysis,
  funding: MemoFundingHistory,
  sources: DDSource[]
): Record<string, { ready: boolean; missingFields?: string[]; relevanceScore?: number }> {
  const readiness: Record<string, { ready: boolean; missingFields?: string[]; relevanceScore?: number }> = {};

  // JPM Startup Banker
  const bankerMissing: string[] = [];
  if (!company.hqLocation) bankerMissing.push("hqLocation");
  if (!funding.totalRaised) bankerMissing.push("totalRaised");
  if (!funding.rounds.length) bankerMissing.push("fundingRounds");

  readiness["JPM_STARTUP_BANKER"] = {
    ready: bankerMissing.length === 0,
    missingFields: bankerMissing.length > 0 ? bankerMissing : undefined,
    relevanceScore: funding.totalRaised ? 0.9 : 0.5,
  };

  // Early Stage VC
  const vcMissing: string[] = [];
  if (!team.founders.length) vcMissing.push("founders");
  if (!market.differentiators.length) vcMissing.push("differentiators");
  if (!market.marketSize) vcMissing.push("marketSize");

  readiness["EARLY_STAGE_VC"] = {
    ready: vcMissing.length === 0,
    missingFields: vcMissing.length > 0 ? vcMissing : undefined,
    relevanceScore: team.founders.some(f => f.trackRecord?.successfulExits > 0) ? 0.9 : 0.7,
  };

  // CTO Tech Lead
  const ctoMissing: string[] = [];
  if (!company.keyProducts?.length) ctoMissing.push("keyProducts");

  readiness["CTO_TECH_LEAD"] = {
    ready: ctoMissing.length === 0,
    missingFields: ctoMissing.length > 0 ? ctoMissing : undefined,
    relevanceScore: 0.7,
  };

  // Founder Strategy
  const founderMissing: string[] = [];
  if (!market.whyNow) founderMissing.push("whyNow");
  if (!market.competitors.length) founderMissing.push("competitors");

  readiness["FOUNDER_STRATEGY"] = {
    ready: founderMissing.length === 0,
    missingFields: founderMissing.length > 0 ? founderMissing : undefined,
    relevanceScore: 0.8,
  };

  return readiness;
}

// ============================================================================
// Helper Functions
// ============================================================================

function aggregateSources(branchResults: BranchResult[]): DDSource[] {
  const allSources: DDSource[] = [];
  const seenUrls = new Set<string>();

  for (const result of branchResults) {
    for (const source of result.sources ?? []) {
      const key = source.url ?? source.title ?? "unknown";
      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        allSources.push({
          ...source,
          section: source.section ?? result.branchType,
        });
      }
    }
  }

  return allSources;
}

// ============================================================================
// Exports
// ============================================================================

export { calculateVerdict, generateExecutiveSummary };
