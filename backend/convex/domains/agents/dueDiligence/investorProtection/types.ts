/**
 * Investor Protection Due Diligence Types
 *
 * Type definitions for the investor protection verification workflow.
 * Validates claims made by startups raising money through Reg CF/Reg D.
 */

import { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS & STATUS TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type InvestorProtectionJobStatus =
  | "pending"
  | "extracting_claims"
  | "verifying_entity"
  | "verifying_securities"
  | "validating_claims"
  | "checking_money_flow"
  | "synthesizing"
  | "completed"
  | "failed";

export type InvestorProtectionVerdict =
  | "VERIFIED"              // All major claims check out
  | "MINOR_CONCERNS"        // Small discrepancies only
  | "SIGNIFICANT_CONCERNS"  // Multiple moderate issues
  | "RED_FLAGS"             // Severe discrepancies present
  | "FRAUD_RISK";           // Critical indicators or pattern of deception

export type DiscrepancySeverity = "minor" | "moderate" | "severe" | "critical";

export type DiscrepancyCategory =
  | "entity"
  | "securities"
  | "fda"
  | "patent"
  | "money_flow"
  | "other";

export type SecFilingType =
  | "Reg CF"         // Form C - Crowdfunding
  | "Reg D 506(b)"   // Private placement
  | "Reg D 506(c)"   // General solicitation allowed
  | "Other"
  | "Unknown";

export type FDAClaimType =
  | "510(k) Cleared"
  | "PMA Approved"
  | "De Novo"
  | "Registered/Listed"
  | "Unknown";

export type PatentClaimStatus =
  | "Granted"
  | "Pending"
  | "Licensed"
  | "Unknown";

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE & VERIFICATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type InvestorProtectionSourceType =
  | "state_registry"
  | "sec_edgar"
  | "finra"
  | "fda_510k"
  | "fda_registration"
  | "uspto"
  | "pitch_deck"
  | "offering_page"
  | "llm_extraction";

export interface VerificationSource {
  type: InvestorProtectionSourceType;
  url?: string;
  title?: string;
  accessedAt: number;
  verified: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTED CLAIMS (Phase 0)
// ═══════════════════════════════════════════════════════════════════════════

export interface FDAClaim {
  description: string;
  claimedType: FDAClaimType;
  clearanceNumber?: string;  // e.g., K123456
  productName?: string;
}

export interface PatentClaim {
  description: string;
  patentNumber?: string;
  status: PatentClaimStatus;
  inventorNames?: string[];
}

export interface FundingClaim {
  targetRaise?: string;
  previousRaises?: string[];
  valuation?: string;
}

export interface ExtractedClaims {
  // Entity claims
  companyName: string;
  companyNameVariants?: string[];
  incorporationState?: string;
  incorporationDate?: string;

  // Securities claims
  secFilingType: SecFilingType;
  fundingPortal?: string;

  // Product/regulatory claims
  fdaClaims: FDAClaim[];
  patentClaims: PatentClaim[];

  // Funding claims
  fundingClaims?: FundingClaim;

  // Other verifiable claims
  otherClaims: Array<{
    category: string;
    claim: string;
    evidence?: string;
  }>;

  // Extraction metadata
  extractedAt: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: ENTITY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface StateRegistryRecord {
  state: string;
  stateFullName?: string;
  entityName: string;
  fileNumber: string;
  formationDate?: string;
  registeredAgent?: string;
  registeredAgentAddress?: string;
  status: "Active" | "Inactive" | "Dissolved" | "Merged" | "Suspended" | "Unknown";
  entityType?: string;  // "Corporation", "LLC", etc.
  jurisdictionOfFormation?: string;
  sourceUrl?: string;
  verifiedAt?: number;
}

export interface EntityVerificationResult {
  verified: boolean;
  stateRegistry?: string;
  record?: StateRegistryRecord;
  discrepancies: string[];
  redFlags: string[];
  sources: VerificationSource[];
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: SECURITIES PATH VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface SECFilingRecord {
  formType: string;        // "Form C", "Form D"
  filingDate: string;
  cik: string;
  accessionNumber: string;
  issuerName: string;
  offeringAmount?: string;
  amountSold?: string;
  url: string;
}

export interface FINRAPortalRecord {
  portalName: string;
  finraId?: string;
  registrationDate?: string;
  isRegistered: boolean;
  disciplinaryHistory?: string[];
}

export interface SecuritiesVerificationResult {
  verified: boolean;
  filingType?: SecFilingType;
  filing?: SECFilingRecord;
  filingFound: boolean;
  fundingPortal?: FINRAPortalRecord;
  portalVerified: boolean;
  discrepancies: string[];
  redFlags: string[];
  sources: VerificationSource[];
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: CLAIMS VALIDATION (FDA + USPTO)
// ═══════════════════════════════════════════════════════════════════════════

export interface FDA510kRecord {
  kNumber: string;
  deviceName: string;
  applicant: string;
  productCode: string;
  decisionDate: string;
  decisionDescription: string;
  regulationNumber?: string;
  deviceClassification?: string;
}

export interface FDARegistrationRecord {
  establishmentType: string;
  firmName: string;
  registrationNumber: string;
  status: string;
}

export interface FDAVerificationItem {
  claim: FDAClaim;
  verified: boolean;
  record?: FDA510kRecord | FDARegistrationRecord;
  discrepancy?: string;
  explanation?: string;
  source?: VerificationSource;
}

export interface USPTOPatentRecord {
  patentNumber: string;
  title: string;
  assignee: string;
  grantDate: string;
  expirationDate?: string;
  inventors: string[];
  applicationNumber?: string;
  filingDate?: string;
}

export interface PatentVerificationItem {
  claim: PatentClaim;
  verified: boolean;
  record?: USPTOPatentRecord;
  assigneeMatches: boolean;
  discrepancy?: string;
  explanation?: string;
  source?: VerificationSource;
}

export interface ClaimsValidationResult {
  fdaVerifications: FDAVerificationItem[];
  patentVerifications: PatentVerificationItem[];
  otherVerifications: Array<{
    claim: string;
    verified: boolean;
    evidence?: string;
    discrepancy?: string;
  }>;
  allFDAClaimed: number;
  allFDAVerified: number;
  allPatentsClaimed: number;
  allPatentsVerified: number;
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: MONEY-FLOW INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

export type MoneyFlowRedFlagType =
  | "direct_wire_request"
  | "crypto_payment_request"
  | "unverified_escrow"
  | "missing_escrow_docs"
  | "unregistered_portal"
  | "bypassing_portal"
  | "personal_account"
  | "offshore_account"
  | "urgency_pressure";

export interface MoneyFlowRedFlag {
  flag: string;
  description: string;
  severity: DiscrepancySeverity;
}

export interface MoneyFlowVerificationResult {
  verified: boolean;
  expectedFlow: string;  // Description of how funds should flow
  escrowAgent?: string;
  escrowVerified: boolean;
  redFlags: MoneyFlowRedFlag[];
  redFlagDetails: MoneyFlowRedFlag[];
  sources: VerificationSource[];
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: DISCREPANCY SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════

export interface Discrepancy {
  id: string;
  category: DiscrepancyCategory;
  pitchClaim: string;
  verifiedFact: string;
  severity: DiscrepancySeverity;
  explanation: string;
  source?: VerificationSource;
}

export interface VerificationSummary {
  entityVerified: boolean;
  securitiesVerified: boolean;
  fdaClaimsVerified: boolean;
  patentClaimsVerified: boolean;
  moneyFlowVerified: boolean;
  totalClaims: number;
  verifiedClaims: number;
  unverifiableClaims: number;
  discrepantClaims: number;
}

export interface FraudScoring {
  score: number;  // 0-100
  indicators: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

// ═══════════════════════════════════════════════════════════════════════════
// INVESTOR PROTECTION REPORT (Final Output)
// ═══════════════════════════════════════════════════════════════════════════

export interface InvestorProtectionReport {
  jobId: string;
  offeringName: string;

  // Executive summary
  executiveSummary: string;

  // Verdict
  verdict: InvestorProtectionVerdict;
  verdictRationale: string;

  // Discrepancy analysis
  discrepancies: Discrepancy[];

  // Risk scoring
  fraudRiskScore: number;
  fraudIndicators: string[];

  // Verification summary
  verificationSummary: VerificationSummary;

  // All sources used
  sources: VerificationSource[];

  // Recommendations
  recommendations: string[];

  // Timing
  createdAt: number;
  updatedAt: number;
  version: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB CONFIGURATION & PROGRESS
// ═══════════════════════════════════════════════════════════════════════════

export interface InvestorProtectionJobConfig {
  offeringName: string;
  offeringUrl?: string;
  fundingPortal?: string;
  pitchDocumentId?: Id<"documents">;
  pitchText?: string;
  userId: Id<"users">;
}

export interface InvestorProtectionJobProgress {
  status: InvestorProtectionJobStatus;
  currentPhase: string;
  completedPhases: string[];
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEVERITY WEIGHTS FOR FRAUD SCORING
// ═══════════════════════════════════════════════════════════════════════════

export const SEVERITY_WEIGHTS: Record<DiscrepancySeverity, number> = {
  minor: 5,
  moderate: 15,
  severe: 30,
  critical: 50,
};

export const FRAUD_INDICATOR_WEIGHTS: Record<string, number> = {
  "no_sec_filing": 25,
  "unregistered_portal": 20,
  "direct_wire_request": 30,
  "entity_not_found": 20,
  "fda_claim_false": 25,
  "patent_claim_false": 20,
  "crypto_payment": 25,
  "personal_account": 30,
};

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════

export const VERDICT_THRESHOLDS = {
  VERIFIED: { maxScore: 10, maxSevereDiscrepancies: 0 },
  MINOR_CONCERNS: { maxScore: 25, maxSevereDiscrepancies: 0 },
  SIGNIFICANT_CONCERNS: { maxScore: 50, maxCriticalDiscrepancies: 0 },
  RED_FLAGS: { maxScore: 75 },
  // Anything above 75 or with multiple critical issues = FRAUD_RISK
};
