/**
 * Due Diligence Types
 *
 * Comprehensive type definitions for the parallelized DD framework.
 * Follows Traditional VC/Banking Memo Structure per IC expectations.
 */

import { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CORE ENUMS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const CORE_BRANCHES = [
  "company_profile",
  "team_founders",
  "market_competitive",
] as const;

export const CONDITIONAL_BRANCHES = [
  "technical_dd",
  "ip_patents",
  "regulatory",
  "financial_deep",
  "network_mapping",
] as const;

// Investor Playbook branches (additional verification for funding requests)
export const INVESTOR_PLAYBOOK_BRANCHES = [
  "entity_verification",
  "sec_edgar",
  "finra_validation",
  "fda_verification",
  "uspto_deepdive",
  "money_flow_integrity",
] as const;

export type InvestorPlaybookBranchType = typeof INVESTOR_PLAYBOOK_BRANCHES[number];

export const ALL_BRANCH_TYPES = [...CORE_BRANCHES, ...CONDITIONAL_BRANCHES] as const;

export type BranchType = typeof ALL_BRANCH_TYPES[number];
export type CoreBranchType = typeof CORE_BRANCHES[number];
export type ConditionalBranchType = typeof CONDITIONAL_BRANCHES[number];

// ═══════════════════════════════════════════════════════════════════════════
// DD TIER SYSTEM (determines depth of due diligence based on deal size/stage)
// ═══════════════════════════════════════════════════════════════════════════

export type DDTier = "FULL_PLAYBOOK" | "STANDARD_DD" | "LIGHT_DD" | "FAST_VERIFY";

/**
 * Branch presets for each DD tier
 *
 * FULL_PLAYBOOK ($50M+ or Series C+): All core + all conditional + investor playbook
 * STANDARD_DD ($5M-$50M or Series A/B): Core + technical + financial
 * LIGHT_DD ($1M-$5M or Seed): Core branches only
 * FAST_VERIFY (<$1M or Pre-seed): No DD branches, fast verify only
 */
export const DD_TIER_BRANCHES: Record<DDTier, BranchType[]> = {
  FULL_PLAYBOOK: [
    ...CORE_BRANCHES,
    ...CONDITIONAL_BRANCHES,
  ],
  STANDARD_DD: [
    ...CORE_BRANCHES,
    "technical_dd",
    "financial_deep",
  ],
  LIGHT_DD: [...CORE_BRANCHES],
  FAST_VERIFY: [], // No DD branches, handled by fast verification
};

/**
 * Tier thresholds for automatic selection
 */
export const DD_TIER_THRESHOLDS = {
  FULL_PLAYBOOK: {
    minAmountUsd: 50_000_000, // $50M
    roundTypes: ["series-c", "series-d-plus", "growth"],
  },
  STANDARD_DD: {
    minAmountUsd: 5_000_000, // $5M
    roundTypes: ["series-a", "series-b"],
  },
  LIGHT_DD: {
    minAmountUsd: 1_000_000, // $1M
    roundTypes: ["seed"],
  },
  FAST_VERIFY: {
    minAmountUsd: 0,
    roundTypes: ["pre-seed", "angel", "unknown"],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// RISK-BASED DD SYSTEM (v3) - Expands funding-based tiers with risk scoring
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Risk categories that can trigger tier escalation
 * Based on FATF risk-based approach and investor protection guidance
 */
export type DDRiskCategory =
  | "identity_provenance"    // Unverifiable founders, mismatched bios
  | "claims_verification"    // Big claims with no primary anchors
  | "transaction_integrity"  // BEC patterns, urgency, payment anomalies
  | "sector_regulatory"      // Fintech/health/govtech higher compliance surface
  | "entity_authenticity"    // New domain, hidden WHOIS, no registry footprint
  | "document_consistency";  // Deck changes, claim inconsistencies

/**
 * Risk signal with severity and source
 */
export interface DDRiskSignal {
  category: DDRiskCategory;
  severity: "low" | "medium" | "high" | "critical";
  signal: string;
  source: string;
  detectedAt: number;
}

/**
 * Risk score result (0-100) with breakdown
 */
export interface DDRiskScore {
  overall: number;  // 0-100
  breakdown: Record<DDRiskCategory, number>;  // Per-category scores
  signals: DDRiskSignal[];
  escalationTriggers: string[];  // Hard-fail triggers that force escalation
  recommendedTier: DDTier;
  tierOverride: boolean;  // True if risk score overrode funding-based tier
}

/**
 * Risk score thresholds for tier selection
 * Higher risk = deeper DD, regardless of funding amount
 */
export const DD_RISK_THRESHOLDS = {
  FAST_VERIFY: { max: 20 },      // Only truly low-risk deals stay here
  LIGHT_DD: { min: 21, max: 45 },
  STANDARD_DD: { min: 46, max: 70 },
  FULL_PLAYBOOK: { min: 71 },    // High risk = full playbook
};

/**
 * Hard-fail escalation triggers (instant tier bump)
 * These always escalate regardless of funding or score
 */
export const ESCALATION_TRIGGERS = {
  IDENTITY_MISMATCH: "Founder name/title inconsistency across credible sources",
  PAYMENT_ANOMALY: "Payment instruction changes or impersonation indicators",
  EXTRAORDINARY_CLAIMS: "Extraordinary claims with no primary/credible sources",
  REGULATORY_CLAIMS_UNVERIFIED: "Regulated domain claims (FDA, SEC, etc.) without primary sources",
  BEC_INDICATORS: "Business email compromise patterns detected",
  ENTITY_NOT_FOUND: "Company not found in any business registry",
  DOMAIN_SPOOFING: "Domain age <90 days with hidden WHOIS + impersonation patterns",
} as const;

export type EscalationTrigger = keyof typeof ESCALATION_TRIGGERS;

// ═══════════════════════════════════════════════════════════════════════════
// MICRO-BRANCHES (lightweight, fast, composable)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Micro-branches are fast, targeted checks that run even for small deals.
 * They're designed to be high-signal, low-cost, and parallelizable.
 */
export const MICRO_BRANCHES = [
  "identity_registry",        // Corporate registry + founder identity verification
  "founder_footprint",        // Cross-source founder consistency
  "claim_ledger",            // Claims with evidence grading
  "traction_sanity",         // Customer/usage/pricing plausibility
  "security_posture",        // SOC2/HIPAA/compliance claims check
  "controversy_scan",        // Litigation/controversy basic scan
  "channel_integrity",       // Email/domain authenticity (anti-BEC)
  "beneficial_ownership",    // UBO verification (FinCEN CTA compliance)
] as const;

export type MicroBranchType = typeof MICRO_BRANCHES[number];

/**
 * Sector-specific branch packs (triggered by sector detection)
 */
export const SECTOR_BRANCH_PACKS: Record<string, MicroBranchType[]> = {
  fintech: ["identity_registry", "claim_ledger", "security_posture"],
  healthcare: ["claim_ledger", "traction_sanity"],  // + regulatory_clinical
  govtech: ["claim_ledger", "security_posture"],    // + contract_verification
  ai_ml: ["claim_ledger", "traction_sanity"],       // + ip_provenance
  enterprise: ["security_posture", "traction_sanity"],
};

/**
 * Risk-based branch selection (overrides funding-based)
 */
export const RISK_BASED_BRANCHES: Record<DDTier, MicroBranchType[]> = {
  FAST_VERIFY: ["identity_registry", "claim_ledger", "channel_integrity"],  // Minimum even for small deals
  LIGHT_DD: [...MICRO_BRANCHES.slice(0, 5)],  // All micro except channel (already in fast)
  STANDARD_DD: [...MICRO_BRANCHES],
  FULL_PLAYBOOK: [...MICRO_BRANCHES],  // Plus full DD branches from CORE_BRANCHES + CONDITIONAL_BRANCHES
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM LEDGER (central diligence artifact)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single verifiable claim extracted from source materials
 */
export interface DDClaim {
  id: string;
  claimText: string;              // 5-20 word headline of what it means
  claimType: "revenue" | "customer" | "partnership" | "regulatory" | "technical" | "team" | "funding" | "other";
  extractedFrom: {
    source: string;               // e.g., "pitch deck page 7", "press release"
    timestamp?: number;
    quoteSpan?: string;           // Exact quote if available
  };
  verdict: "verified" | "disputed" | "unverifiable" | "context_needed";
  confidence: number;             // 0-1
  freshness: "current" | "stale" | "historical";  // <30d, 30-180d, >180d
  citations: string[];            // sourceArtifactIds
  contradictions?: string[];      // Other claims that contradict this one
  verificationMethod?: string;    // How we verified (e.g., "SEC filing", "registry lookup")
}

/**
 * The claim ledger for an entity - central DD artifact
 */
export interface ClaimLedger {
  entityName: string;
  entityType: "company" | "fund" | "person";
  claims: DDClaim[];
  overallIntegrity: "high" | "medium" | "low" | "unassessable";
  contradictionCount: number;
  unverifiableCount: number;
  lastUpdated: number;
}

export type DDJobStatus =
  | "pending"
  | "analyzing"
  | "executing"
  | "cross_checking"
  | "synthesizing"
  | "completed"
  | "failed";

export type BranchStatus =
  | "pending"
  | "running"
  | "awaiting_verification"
  | "completed"
  | "failed"
  | "skipped";

export type Verdict =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "PASS"
  | "INSUFFICIENT_DATA";

export type RiskCategory =
  | "Market"
  | "Execution"
  | "Regulatory"
  | "Team"
  | "Technical"
  | "Financial"
  | "Competitive"
  | "Legal";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type SourceReliability = "authoritative" | "reliable" | "secondary" | "inferred";

export type SourceType =
  | "sec_filing"
  | "news_article"
  | "company_website"
  | "linkedin"
  | "patent_db"
  | "crunchbase"
  | "pitchbook"
  | "llm_inference"
  | "social_media"
  | "research_report"
  | "academic_paper"
  | "regulatory_filing";

// ═══════════════════════════════════════════════════════════════════════════
// COMPLEXITY SIGNALS (determines conditional branches)
// ═══════════════════════════════════════════════════════════════════════════

export interface ComplexitySignals {
  fundingSize?: number;           // USD amount
  teamSize?: number;              // Key people count
  hasPatentMentions?: boolean;
  hasRegulatoryMentions?: boolean;
  hasPublicSecurities?: boolean;
  hasSerialFounders?: boolean;
  hasVCBackedFounders?: boolean;
  hasRepoMentions?: boolean;
  industryRisk?: "low" | "medium" | "high";
  sectors?: string[];
  fundingStage?: string;
}

/**
 * Branch trigger configuration
 * Maps conditional branches to their activation criteria
 */
export const BRANCH_TRIGGERS: Record<
  ConditionalBranchType,
  (signals: ComplexitySignals) => boolean
> = {
  technical_dd: (signals) =>
    Boolean(signals.hasRepoMentions) ||
    signals.industryRisk === "high" ||
    signals.sectors?.some(s =>
      ["AI/ML", "Cybersecurity", "DevTools", "Infrastructure"].includes(s)
    ) || false,

  ip_patents: (signals) =>
    Boolean(signals.hasPatentMentions) ||
    signals.sectors?.some(s =>
      ["Biotech", "Pharma", "DeepTech", "Hardware", "Semiconductors"].includes(s)
    ) || false,

  regulatory: (signals) =>
    Boolean(signals.hasRegulatoryMentions) ||
    signals.sectors?.some(s =>
      ["HealthTech", "Fintech", "Crypto", "Insurance", "Banking"].includes(s)
    ) || false,

  financial_deep: (signals) =>
    (signals.fundingSize ?? 0) > 50_000_000 ||
    Boolean(signals.hasPublicSecurities) ||
    signals.fundingStage?.includes("Series C") ||
    signals.fundingStage?.includes("Series D") ||
    signals.fundingStage?.includes("Growth") || false,

  network_mapping: (signals) =>
    (signals.teamSize ?? 0) > 5 ||
    Boolean(signals.hasSerialFounders) ||
    Boolean(signals.hasVCBackedFounders),
};

// ═══════════════════════════════════════════════════════════════════════════
// TEAM MEMBER PROFILE (Deep founder/team DD)
// ═══════════════════════════════════════════════════════════════════════════

export interface CareerTimelineEntry {
  organization: string;
  role: string;
  startYear: number;
  endYear?: number;
  type: "education" | "employment" | "board" | "advisory" | "founding";
  highlights?: string[];
  verified?: boolean;
  source?: string;
}

export interface BoardSeat {
  company: string;
  role: string;           // "Board Member", "Observer", "Chairman"
  isActive: boolean;
  startYear?: number;
  endYear?: number;
}

export interface AdvisoryRole {
  organization: string;
  role: string;
  isActive: boolean;
  domain?: string;
}

export interface PatentAuthorship {
  patentId: string;
  title: string;
  filingDate: string;
  grantDate?: string;
  coInventors: string[];
  assignee?: string;
  usptoUrl?: string;
  verified?: boolean;
}

export interface ConflictFlag {
  type: "competitive" | "investor_overlap" | "litigation" | "regulatory" | "reputation";
  description: string;
  severity: "low" | "medium" | "high";
  source?: string;
  dateIdentified?: string;
}

export interface NetworkConnections {
  coFounders: Array<{
    name: string;
    company: string;
    relationship: string;
    outcome?: "success" | "failure" | "ongoing" | "unknown";
  }>;
  investorRelationships: Array<{
    investorName: string;
    companies: string[];
    relationshipType?: "founder" | "executive" | "board";
  }>;
  boardNetworkOverlap: Array<{
    person: string;
    sharedBoards: string[];
  }>;
  references: Array<{
    name: string;
    relationship: string;
    contactAvailable: boolean;
    company?: string;
  }>;
}

export interface TrackRecord {
  successfulExits: number;
  failedVentures: number;
  pivots: number;
  yearsExperience: number;
  domainExpertise: string[];
  largestExitValue?: string;
  exitTypes?: Array<{ type: string; count: number }>;
}

export interface TeamMemberProfile {
  id: string;
  name: string;
  currentRole: string;
  currentCompany?: string;
  linkedinUrl?: string;
  email?: string;
  photo?: string;

  // Career Timeline
  careerTimeline: CareerTimelineEntry[];

  // Board & Advisory
  boardSeats: BoardSeat[];
  advisoryRoles: AdvisoryRole[];

  // Patent Authorship
  patents: PatentAuthorship[];

  // Education
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    graduationYear?: number;
    honors?: string[];
  }>;

  // Conflict Checks
  conflictFlags: ConflictFlag[];

  // Network Mapping
  networkConnections: NetworkConnections;

  // Track Record
  trackRecord: TrackRecord;

  // Red flags & Highlights
  redFlags: string[];
  highlights: string[];

  // Sources
  sources: Array<{
    type: SourceType;
    url?: string;
    accessedAt: number;
    reliability: SourceReliability;
  }>;

  // Verification
  verificationStatus: "unverified" | "partial" | "verified";
  lastVerified?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRANCH FINDINGS (type-specific outputs)
// ═══════════════════════════════════════════════════════════════════════════

export interface CompanyProfileFindings {
  description: string;
  hqLocation?: string;
  foundedYear?: number;
  employeeCount?: number;
  employeeGrowth?: string;
  website?: string;
  sectors: string[];
  stage?: string;
  businessModel?: string;
  keyProducts: string[];
  recentMilestones: string[];
  socialPresence?: {
    twitter?: string;
    linkedin?: string;
    github?: string;
  };
}

export interface TeamFoundersFindings {
  founders: TeamMemberProfile[];
  executives: TeamMemberProfile[];
  boardMembers: TeamMemberProfile[];
  advisors?: TeamMemberProfile[];
  teamSize: number;
  averageExperience: number;
  hasSerialFounders: boolean;
  hasVCBackedFounders: boolean;
  founderMarketFit?: string;
  trackRecordSummary?: string;
  teamStrengths: string[];
  teamGaps: string[];
  keyPersonRisk: string[];
}

export interface MarketCompetitiveFindings {
  marketSize?: {
    tam?: string;
    sam?: string;
    som?: string;
  };
  marketGrowth?: string;
  competitors: Array<{
    name: string;
    description?: string;
    fundingStage?: string;
    fundingTotal?: string;
    differentiator?: string;
    threat: "low" | "medium" | "high";
  }>;
  differentiators: string[];
  whyNow?: string;
  tailwinds: string[];
  headwinds: string[];
  marketRisks: string[];
}

export interface TechnicalDDFindings {
  techStack: string[];
  architecture?: string;
  scalability?: string;
  securityPosture?: {
    cveCount?: number;
    lastAudit?: string;
    certifications?: string[];
  };
  repoStats?: {
    stars: number;
    forks: number;
    contributors: number;
    commitFrequency?: string;
  };
  technicalDebt?: string;
  infrastructureCosts?: string;
}

export interface IPPatentsFindings {
  patents: PatentAuthorship[];
  patentPortfolioValue?: string;
  pendingApplications: number;
  trademarks: string[];
  defensibility?: string;
  ipRisks: string[];
  competitorIPOverlap?: string[];
}

export interface RegulatoryFindings {
  regulatoryBody?: string;           // FDA, SEC, etc.
  currentStatus?: string;
  filings: Array<{
    type: string;
    date: string;
    url?: string;
    status: string;
  }>;
  approvals: string[];
  pendingApprovals: string[];
  complianceRisks: string[];
  timeToApproval?: string;
}

export interface FinancialDeepFindings {
  fundingHistory: Array<{
    roundType: string;
    date?: string;
    amount?: string;
    leadInvestors?: string[];
    valuation?: string;
    verified?: boolean;
    source?: string;
  }>;
  totalRaised?: {
    amount: number;
    currency: string;
    unit: string;
  };
  burnRate?: string;
  runway?: string;
  revenue?: string;
  revenueGrowth?: string;
  unitEconomics?: string;
  valuationComps?: Array<{
    company: string;
    valuation: string;
    multiple?: number;
  }>;
}

export interface NetworkMappingFindings {
  networkGraph: {
    nodes: Array<{
      id: string;
      name: string;
      type: "person" | "company" | "investor";
      metadata?: Record<string, unknown>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      relationship: string;
      strength?: number;
    }>;
  };
  keyConnections: string[];
  investorNetwork: string[];
  advisorNetwork: string[];
  potentialConflicts: string[];
  referenceability: number; // 0-1 how easy to get references
}

export type BranchFindings =
  | CompanyProfileFindings
  | TeamFoundersFindings
  | MarketCompetitiveFindings
  | TechnicalDDFindings
  | IPPatentsFindings
  | RegulatoryFindings
  | FinancialDeepFindings
  | NetworkMappingFindings;

// ═══════════════════════════════════════════════════════════════════════════
// CONTRADICTION & CROSS-CHECK
// ═══════════════════════════════════════════════════════════════════════════

export interface Contradiction {
  field: string;
  sourceA: string;
  valueA: string;
  sourceB: string;
  valueB: string;
  resolution?: "resolved_to_a" | "resolved_to_b" | "unresolved" | "both_valid";
  resolutionReason?: string;
  confidenceA?: number;
  confidenceB?: number;
}

export interface CrossCheckResult {
  branchA: BranchType;
  branchB: BranchType;
  agreements: string[];
  disagreements: Contradiction[];
  overallAgreement: number; // 0-1
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export interface DDSource {
  sourceType: SourceType;
  url?: string;
  title?: string;
  accessedAt: number;
  reliability: SourceReliability;
  branchType?: BranchType;
  section?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMO STRUCTURE (Traditional IC Format)
// ═══════════════════════════════════════════════════════════════════════════

export interface MemoCompanyOverview {
  description: string;
  hqLocation?: string;
  foundedYear?: number;
  employeeCount?: number;
  employeeGrowth?: string;
  sectors: string[];
  stage?: string;
  businessModel?: string;
  keyProducts?: string[];
}

export interface MemoMarketAnalysis {
  marketSize?: string;
  marketGrowth?: string;
  competitors: Array<{
    name: string;
    description?: string;
    fundingStage?: string;
    differentiator?: string;
  }>;
  differentiators: string[];
  whyNow?: string;
  tailwinds?: string[];
  headwinds?: string[];
}

export interface MemoTeamAnalysis {
  founders: TeamMemberProfile[];
  executives: TeamMemberProfile[];
  boardMembers: TeamMemberProfile[];
  advisors?: TeamMemberProfile[];
  networkGraph?: NetworkMappingFindings["networkGraph"];
  trackRecordSummary?: string;
  teamStrengths?: string[];
  teamGaps?: string[];
  founderMarketFit?: string;
}

export interface MemoFundingHistory {
  totalRaised?: {
    amount: number;
    currency: string;
    unit: string;
  };
  rounds: Array<{
    roundType: string;
    date?: string;
    amount?: string;
    leadInvestors?: string[];
    valuation?: string;
    verified?: boolean;
    source?: string;
  }>;
  valuationComps?: {
    currentValuation?: string;
    revenueMultiple?: number;
    comparables?: Array<{
      company: string;
      valuation: string;
      multiple?: number;
    }>;
  };
  burnRate?: string;
  runway?: string;
}

export interface MemoRisk {
  category: RiskCategory;
  description: string;
  severity: RiskSeverity;
  likelihood?: "low" | "medium" | "high";
  mitigation?: string;
  timeframe?: string;
}

export interface MemoInvestmentThesis {
  thesisSummary: string;
  keyDrivers: string[];
  keyMilestones?: Array<{
    milestone: string;
    timeframe?: string;
    importance?: string;
  }>;
  exitScenarios?: Array<{
    scenario: string;
    probability?: string;
    potentialReturn?: string;
    acquirers?: string[];
  }>;
  comparableExits?: Array<{
    company: string;
    exitType: string;
    exitValue: string;
    year?: number;
  }>;
}

export interface MemoVerificationSummary {
  contradictionsFound: number;
  contradictionsResolved: number;
  overallConfidence: number;
  dataCompleteness: number;
  sourceQuality: "high" | "medium" | "low";
}

export interface DDMemo {
  jobId: string;
  entityName: string;
  entityType: "company" | "fund" | "person";

  // I. Executive Summary
  executiveSummary: string;
  verdict: Verdict;
  verdictRationale?: string;

  // II. Company Overview
  companyOverview: MemoCompanyOverview;

  // III. Market Analysis
  marketAnalysis: MemoMarketAnalysis;

  // IV. Team Assessment
  teamAnalysis: MemoTeamAnalysis;

  // V. Financials / Funding History
  fundingHistory: MemoFundingHistory;

  // VI. Risks
  risks: MemoRisk[];

  // VII. Investment Thesis
  investmentThesis: MemoInvestmentThesis;

  // Verification & Sources
  verificationSummary: MemoVerificationSummary;
  sources: DDSource[];

  // Persona Readiness
  personaReadiness?: Record<string, {
    ready: boolean;
    missingFields?: string[];
    relevanceScore?: number;
  }>;

  // Metadata
  createdAt: number;
  updatedAt: number;
  version: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DD JOB & ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

export interface DDJobConfig {
  entityName: string;
  entityType: "company" | "fund" | "person";
  triggerSource: "funding_detection" | "deals_feed" | "manual" | "scheduled_refresh";
  triggerEventId?: string;
  entityId?: Id<"entityContexts">;
  userId: Id<"users">;
  priority?: "high" | "normal" | "low";
  forceRefresh?: boolean;
}

export interface DDJobProgress {
  status: DDJobStatus;
  phase: string;
  activeBranches: BranchType[];
  completedBranches: BranchType[];
  failedBranches: BranchType[];
  currentBranch?: BranchType;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════

export interface DDBooleanFactors {
  // Core factors
  hasCompanyProfile: boolean;
  hasTeamData: boolean;
  hasMarketAnalysis: boolean;
  hasRiskAssessment: boolean;
  hasInvestmentThesis: boolean;

  // Verification factors
  fundingVerifiedViaSEC: boolean;
  teamVerifiedViaLinkedIn: boolean;
  patentsVerifiedViaUSPTO: boolean;

  // Cross-check factors
  noCriticalContradictions: boolean;
  allContradictionsResolved: boolean;

  // Completeness
  allCoreBranchesCompleted: boolean;
  conditionalBranchesAppropriate: boolean;

  // Traditional memo structure
  hasExecutiveSummary: boolean;
  hasVerdict: boolean;

  // Quality thresholds
  confidenceAboveThreshold: boolean;
  dataCompletenessAboveThreshold: boolean;
}

export interface DDEvaluationResult {
  entityName: string;
  passed: boolean;
  booleanFactors: DDBooleanFactors;
  failedFactors: string[];
  warnings: string[];
  executionTimeMs: number;
}
