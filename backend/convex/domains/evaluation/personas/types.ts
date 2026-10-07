/**
 * Persona Evaluation Types
 *
 * Shared type definitions for persona-specific evaluations.
 * Supports Financial, Industry, and Strategic persona groups.
 */

import type { PersonaId } from "../../../config/autonomousConfig";

// ═══════════════════════════════════════════════════════════════════════════
// CORE EVALUATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard evaluation result structure for all persona evaluations
 */
export interface PersonaEvalResult {
  personaId: PersonaId;
  caseName: string;
  passed: boolean;
  score: number;
  maxScore: number;
  normalizedScore: number; // 0-100 normalized
  passThreshold?: number; // Threshold for passing
  categoryScores: CategoryScore[];
  criticalFailures: string[];
  failedCriticals?: string[]; // IDs of failed critical categories
  criticalsPassed?: boolean; // Whether all critical categories passed
  executionTimeMs: number;
  report: string;
  rawOutput: Record<string, unknown>;
}

/**
 * Category score within an evaluation
 */
export interface CategoryScore {
  category: string;
  weight: number; // Percentage weight (0-100)
  rawScore: number; // Raw points earned
  maxPoints: number; // Maximum points possible
  normalizedScore: number; // 0-100 normalized
  isCritical: boolean;
  passed: boolean;
  findings: CategoryFinding[];
}

/**
 * Individual finding within a category
 */
export interface CategoryFinding {
  field: string;
  expected: string;
  actual: string;
  match: boolean;
  confidence?: number;
  source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUND TRUTH TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base ground truth structure
 */
export interface BaseGroundTruth {
  entityName: string;
  entityType: EntityType;
  description: string;
  expectedOutcome: "pass" | "fail" | "flag";
}

/**
 * Entity types for ground truth cases
 */
export type EntityType =
  | "company"
  | "fund"
  | "person"
  | "research_signal"
  | "event"
  | "deal"
  | "strategy";

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL PERSONA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ground truth for banker/VC company evaluations
 */
export interface FinancialCompanyGroundTruth extends BaseGroundTruth {
  entityType: "company";
  funding: {
    stage: string;
    amount: number;
    currency: string;
    date?: string;
    leadInvestor?: string;
    coInvestors?: string[];
  };
  hq: {
    city: string;
    state: string;
    country: string;
  };
  contact: {
    irEmail?: string;
    phone?: string;
    linkedIn?: string;
  };
  thesis: string;
  verdict: "PASS" | "FAIL" | "FLAG";
  sector?: string;
  employees?: number;
}

/**
 * Ground truth for LP fund evaluations
 */
export interface FundGroundTruth extends BaseGroundTruth {
  entityType: "fund";
  trackRecord: {
    fundName: string;
    vintage: number;
    tvpiNet: number;
    dpiNet: number;
    irrNet?: number;
  }[];
  team: {
    name: string;
    role: string;
    yearsExperience: number;
  }[];
  strategy: {
    focus: string;
    stagePreference: string;
    sectorFocus: string[];
    geographyFocus: string[];
  };
  terms: {
    managementFee: number;
    carriedInterest: number;
    preferredReturn?: number;
    gpCommitment?: number;
  };
  fit: {
    sectorMatch: boolean;
    stageMatch: boolean;
    geoMatch: boolean;
    sizeMatch: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INDUSTRY PERSONA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ground truth for Pharma BD evaluations
 */
export interface PharmaGroundTruth extends BaseGroundTruth {
  entityType: "company";
  exposure: {
    targetIndication: string;
    mechanismOfAction: string;
    phase: "Preclinical" | "Phase 1" | "Phase 2" | "Phase 3" | "Approved";
    competitiveLandscape: string[];
  };
  impact: {
    marketSize: string;
    differentiatedMOA: boolean;
    patentProtection: string;
    firstInClass: boolean;
  };
  mitigations: {
    clinicalRisk: string;
    regulatoryPath: string;
    manufacturingReady: boolean;
    supplyChainRisk: string;
  };
  timeline: {
    currentPhaseComplete?: string;
    nextPhaseStart?: string;
    potentialApproval?: string;
    commercialLaunch?: string;
  };
  clinicalData: {
    nctNumber?: string;
    primaryEndpoint?: string;
    primaryEndpointMet?: boolean;
    overallResponseRate?: number;
    safetySignals?: string[];
  };
}

/**
 * Ground truth for Academic R&D evaluations
 */
export interface AcademicGroundTruth extends BaseGroundTruth {
  entityType: "research_signal";
  methodology: {
    technique: string;
    validationLevel: string;
    replicationStatus: string;
    replicationCount: number;
  };
  findings: {
    primaryResult: string;
    effectSize?: number;
    statisticalSignificance?: string;
    therapeuticRelevance?: string;
  };
  citations: {
    totalCitations: number;
    h5Index?: number;
    keyPapers: string[];
    recentCitationVelocity?: number;
  };
  gaps: {
    challenge: string;
    description: string;
  }[];
  implications: {
    clinicalTranslation?: string;
    commercializationPath?: string;
    regulatoryConsiderations?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIC PERSONA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ground truth for Corp Dev M&A evaluations
 */
export interface MADealGroundTruth extends BaseGroundTruth {
  entityType: "event";
  deal: {
    acquirer: string;
    target: string;
    dealValue: string;
    dealType: "All-cash" | "All-stock" | "Cash+Stock" | "Asset purchase";
    announcementDate: string;
    expectedClose: string;
    dealStatus: "Announced" | "Pending" | "Closed" | "Terminated";
  };
  strategicRationale: {
    synergies: string;
    revenueSynergies?: string;
    costSynergies?: string;
    marketPositionImpact: string;
    technologyAcquisition?: boolean;
    talentAcquisition?: boolean;
  };
  risks: {
    regulatoryRisk: string;
    integrationRisk: string;
    culturalRisk: string;
    financingRisk?: string;
    customerChurnRisk?: string;
  };
  valuation: {
    evRevenue?: number;
    evEbitda?: number;
    premium?: number;
    comparableDeals?: string[];
  };
}

/**
 * Ground truth for Macro Strategist evaluations
 */
export interface MacroEventGroundTruth extends BaseGroundTruth {
  entityType: "event";
  thesis: {
    event: string;
    currentLevel: string;
    expectedMove: string;
    confidence: number;
    rationale: string;
    timeframe: string;
  };
  indicators: {
    name: string;
    value: number;
    unit: string;
    trend: "rising" | "falling" | "stable";
    source: string;
  }[];
  risks: {
    upside: string;
    downside: string;
    tail: string;
  };
  positioning: {
    asset: string;
    direction: "long" | "short" | "neutral";
    rationale: string;
  }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Claim verification scenario for persona testing
 */
export interface ClaimVerificationScenario {
  id: string;
  personaId: PersonaId;
  name: string;
  query: string;
  claims: ClaimExpectation[];
  expectedSources: string[];
  passingThreshold: number;
}

/**
 * Expected claim outcome
 */
export interface ClaimExpectation {
  claim: string;
  category: ClaimCategory;
  expectedVerdict: "verified" | "contradicted" | "unverified";
  expectedConfidence?: number;
  verificationSource?: string;
}

/**
 * Claim categories by persona group
 */
export type ClaimCategory =
  // Financial
  | "financial"
  | "funding"
  | "valuation"
  | "performance"
  | "contact"
  | "risk"
  // Industry
  | "clinical"
  | "scientific"
  | "regulatory"
  | "citation"
  | "methodology"
  // Strategic
  | "event"
  | "deal"
  | "economic"
  | "policy"
  | "strategic"
  | "market"
  | "competition"
  // Media/Corporate/Technical
  | "corporate"
  | "technical"
  | "legal"
  | "verification"
  | "compliance"
  | "operational";

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA INFERENCE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persona inference test scenario
 */
export interface PersonaInferenceScenario {
  id: string;
  name: string;
  query: string;
  expectedPersona: PersonaId;
  alternativePersonas?: PersonaId[];
  keywordSignals: string[];
  outputPatterns: RegExp[];
}

/**
 * Persona inference result
 */
export interface PersonaInferenceResult {
  scenarioId: string;
  inferredPersona: PersonaId;
  confidence: number;
  expectedPersona: PersonaId;
  passed: boolean;
  matchedKeywords: string[];
  outputValidation: {
    pattern: string;
    matched: boolean;
  }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION HARNESS TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Multi-persona evaluation suite result
 */
export interface PersonaEvalSuiteResult {
  timestamp: number;
  totalPersonas: number;
  passedPersonas: number;
  failedPersonas: number;
  overallScore: number;
  personaResults: PersonaEvalResult[];
  inferenceResults?: PersonaInferenceResult[];
  totalExecutionTimeMs: number;
}

/**
 * Evaluation configuration
 */
export interface PersonaEvalConfig {
  personaIds: PersonaId[];
  runGroundTruth: boolean;
  runClaimVerification: boolean;
  runPersonaInference: boolean;
  timeoutMs: number;
  parallelExecution: boolean;
}
