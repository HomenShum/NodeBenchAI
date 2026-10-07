/**
 * Investor Due Diligence Playbook - Types
 *
 * Comprehensive type definitions for the investor protection verification framework.
 * Based on a standard investor-protection diligence workflow:
 *
 * 1. Entity Verification (State Registries)
 * 2. Securities Path Verification (SEC EDGAR)
 * 3. Funding Portal Validation (FINRA)
 * 4. FDA Status Verification (510k vs Registration)
 * 5. Patent Verification (USPTO)
 * 6. Money Flow Integrity Checks
 */

import { DDSource, SourceReliability, SourceType } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK BRANCH TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const INVESTOR_PLAYBOOK_BRANCHES = [
  // Core verification branches
  "entity_verification",
  "sec_edgar",
  "finra_validation",
  "fda_verification",
  "uspto_deepdive",
  "money_flow_integrity",
  "claim_verification",     // Verifies specific claims from complex queries
  "person_verification",    // Verifies person identity and professional background
  "news_verification",      // Verifies news/acquisition events
  "scientific_claim_verification", // Verifies scientific/research claims (LK-99, cold fusion, etc.)

  // Financial persona branches (Banker, VC, LP)
  "deal_memo_synthesis",           // Generates deal memos for bankers/VCs
  "fund_performance_verification", // Verifies fund TVPI/DPI/IRR for LP due diligence

  // Industry persona branches (Pharma BD, Academic R&D)
  "clinical_trial_verification",   // Verifies ClinicalTrials.gov data
  "literature_triangulation",      // Cross-references academic literature

  // Strategic persona branches (Corp Dev, Macro Strategist)
  "ma_activity_verification",      // Verifies M&A deal facts
  "economic_indicator_verification", // Validates macro indicators vs FRED/BLS
] as const;

export type InvestorPlaybookBranchType = typeof INVESTOR_PLAYBOOK_BRANCHES[number];

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK SOURCE TYPES (extends base SourceType)
// ═══════════════════════════════════════════════════════════════════════════

export type PlaybookSourceType =
  | SourceType
  | "state_registry"
  | "sec_edgar"
  | "finra_iapd"
  | "fda_510k"
  | "fda_registration"
  | "fda_maude"
  | "uspto_patents"
  | "uspto_assignments"
  | "funding_portal"
  | "escrow_agent";

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: ENTITY VERIFICATION (State Registries)
// ═══════════════════════════════════════════════════════════════════════════

export interface StateRegistryRecord {
  entityName: string;
  fileNumber: string;
  state: string;
  formationDate: string;
  entityType: "Corporation" | "LLC" | "LP" | "LLP" | "Other";
  status: "Active" | "Inactive" | "Dissolved" | "Merged" | "Suspended" | "Unknown";
  registeredAgent: {
    name: string;
    address: string;
  };
  jurisdiction: string;
  lastFilingDate?: string;
  goodStanding?: boolean;
  verifiedAt: number;
  sourceUrl?: string;
}

export interface EntityVerificationFindings {
  // Primary entity
  primaryEntity?: StateRegistryRecord;

  // Alternative names/DBAs
  alternativeNames: string[];
  dbaRegistrations: Array<{
    name: string;
    state: string;
    status: string;
  }>;

  // Multi-state presence
  stateRegistrations: StateRegistryRecord[];

  // Verification results
  verification: {
    nameMatchesOffering: boolean;
    entityExists: boolean;
    isGoodStanding: boolean;
    registeredAgentValid: boolean;
    formationDateConsistent: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "name_mismatch" | "entity_not_found" | "bad_standing" | "recent_formation" | "agent_issue";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  // Confidence
  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: SEC EDGAR VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export type SecuritiesRegime =
  | "Reg CF"       // Regulation Crowdfunding
  | "Reg D 506(b)" // Private placement (accredited + 35 non-accredited)
  | "Reg D 506(c)" // Private placement (accredited only, general solicitation OK)
  | "Reg A"        // Mini-IPO ($75M max)
  | "Reg A+"       // Tier 2 Mini-IPO
  | "S-1"          // Full IPO
  | "Friends & Family"
  | "Unknown";

export interface FormCFiling {
  accessionNumber: string;
  filingDate: string;
  formType: "C" | "C/A" | "C-U" | "C-AR" | "C-TR";
  companyName: string;
  cik: string;
  offeringAmount?: number;
  maxOfferingAmount?: number;
  minInvestmentAmount?: number;
  securityType?: string;
  oversubscriptionAccepted?: boolean;
  deadline?: string;
  intermediaryName?: string;
  intermediaryCik?: string;
  filingUrl: string;
  // Financial data from Form C (for ground truth comparison)
  financials?: {
    totalRevenue?: number;        // From issuer's most recent fiscal year
    totalAssets?: number;         // Total assets
    totalLiabilities?: number;    // Total liabilities
    netIncome?: number;           // Net income/loss
    fiscalYearEnd?: string;       // Fiscal year end date
    taxableIncome?: number;       // Taxable income
    employeeCount?: number;       // Number of employees
  };
}

export interface FormDFiling {
  accessionNumber: string;
  filingDate: string;
  formType: "D" | "D/A";
  companyName: string;
  cik?: string;
  exemption: "Rule 504" | "Rule 505" | "Rule 506(b)" | "Rule 506(c)";
  totalOfferingAmount?: number;
  totalAmountSold?: number;
  totalRemaining?: number;
  investors?: {
    accreditedCount?: number;
    nonAccreditedCount?: number;
    totalCount?: number;
  };
  salesCommissions?: number;
  findersFeesExpenses?: number;
  issuers: Array<{
    name: string;
    cik?: string;
    entityType: string;
    stateOfIncorporation: string;
    yearOfIncorporation?: number;
  }>;
  filingUrl: string;
}

export interface SecEdgarFindings {
  // Company identification
  company: {
    ciks: string[];
    legalName?: string;
    formerNames?: string[];
    sic?: string;
    sicDescription?: string;
    stateOfIncorporation?: string;
    fiscalYearEnd?: string;
  };

  // Securities regime determination
  securitiesRegime: SecuritiesRegime;
  regimeConfidence: number;

  // Form C filings (Reg CF)
  formCFilings: FormCFiling[];
  activeOffering?: {
    amount: number;
    deadline: string;
    intermediary: string;
    status: "active" | "completed" | "withdrawn";
  };

  // Form D filings (Reg D)
  formDFilings: FormDFiling[];

  // Other SEC filings
  otherFilings: Array<{
    form: string;
    date: string;
    description: string;
    url: string;
  }>;

  // Verification results
  verification: {
    filingFound: boolean;
    termsMatchPitch: boolean;
    intermediaryListed: boolean;
    offeringActive: boolean;
    financialsIncluded: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "no_filing" | "terms_mismatch" | "no_intermediary" | "offering_expired" | "missing_financials";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: FINRA PORTAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

export interface FundingPortal {
  name: string;
  crd: string;  // Central Registration Depository number
  secFileNumber?: string;
  registrationDate?: string;
  status: "Active" | "Inactive" | "Suspended" | "Withdrawn";
  website?: string;
  address?: string;
  verifiedAt: number;
}

export interface BrokerDealerRecord {
  firmName: string;
  crd: string;
  secNumber?: string;
  status: "Active" | "Inactive" | "Suspended";
  disclosureEvents: number;
  registrationDate?: string;
}

export interface FinraValidationFindings {
  // Portal verification
  claimedPortal?: {
    name: string;
    url?: string;
  };
  verifiedPortal?: FundingPortal;
  portalIsRegistered: boolean;

  // Broker-dealer verification (if applicable)
  brokerDealer?: BrokerDealerRecord;

  // Offering verification
  offeringOnPortal: boolean;
  offeringDetails?: {
    campaignUrl: string;
    targetAmount: number;
    amountRaised: number;
    investorCount: number;
    deadline: string;
    status: "live" | "successful" | "failed" | "withdrawn";
  };

  // Disclosure events
  disclosureEvents: Array<{
    type: string;
    date: string;
    description: string;
    severity: "minor" | "moderate" | "serious";
  }>;

  // Verification results
  verification: {
    portalRegistered: boolean;
    offeringLive: boolean;
    noSeriousDisclosures: boolean;
    fundsFlowThroughPortal: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "unregistered_portal" | "no_campaign" | "direct_wire_request" | "disclosure_events" | "portal_suspended";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: FDA VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export type FDAStatus =
  | "510(k) Cleared"
  | "PMA Approved"
  | "De Novo Granted"
  | "BLA Approved"           // Biologics License Application (vaccines, gene therapy, blood products)
  | "NDA Approved"           // New Drug Application (pharmaceutical drugs)
  | "ANDA Approved"          // Abbreviated New Drug Application (generics)
  | "Registered/Listed Only"
  | "Pending Review"
  | "Not Found"
  | "Exempt";

export interface FDA510kClearance {
  kNumber: string;  // e.g., "K123456"
  deviceName: string;
  applicant: string;
  dateReceived: string;
  decisionDate: string;
  decision: "Substantially Equivalent" | "Not Substantially Equivalent" | "Withdrawn";
  productCode: string;
  reviewPanel?: string;
  statementUrl?: string;
  predicateDevices?: string[];
}

export interface FDAPMAApproval {
  pmaNumber: string;
  deviceName: string;
  applicant: string;
  approvalDate: string;
  productCode: string;
  supplementHistory?: Array<{
    supplementNumber: string;
    approvalDate: string;
    type: string;
  }>;
}

/**
 * BLA (Biologics License Application) Approval
 * Used for vaccines, gene therapies, blood products, allergenics, etc.
 * Approved via Drugs@FDA and Purple Book databases
 */
export interface FDABLAApproval {
  blaNumber: string;            // e.g., "BLA 125742"
  productName: string;          // e.g., "mRESVIA"
  applicant: string;            // e.g., "Moderna"
  approvalDate: string;
  activeIngredient?: string;
  dosageForm?: string;
  routeOfAdministration?: string;
  indication?: string;          // What it's approved to treat
  therapeuticArea?: string;
  isOriginalApproval: boolean;  // vs. supplemental approval
}

/**
 * NDA (New Drug Application) Approval
 * Used for new pharmaceutical drugs
 */
export interface FDANDAApproval {
  ndaNumber: string;            // e.g., "NDA 215510"
  productName: string;
  applicant: string;
  approvalDate: string;
  activeIngredient?: string;
  dosageForm?: string;
  routeOfAdministration?: string;
  indication?: string;
  therapeuticEquivalenceCode?: string;
  isOriginalApproval: boolean;
}

export interface FDARegistration {
  registrationNumber: string;
  firmName: string;
  facilityType: string;
  address: string;
  status: "Active" | "Inactive";
  expirationDate?: string;
}

export interface FDADeviceListing {
  listingNumber: string;
  deviceName: string;
  productCode: string;
  regulationNumber: string;
  deviceClass: "I" | "II" | "III";
  submissionType?: string;
}

export interface FDAAdverseEvent {
  reportNumber: string;
  eventDate: string;
  eventType: string;
  productProblem?: string;
  patientOutcome?: string;
  deviceName: string;
  manufacturer: string;
}

export interface FDARecall {
  recallNumber: string;
  recallClass: "I" | "II" | "III";
  recallStatus: "Ongoing" | "Completed" | "Terminated";
  productDescription: string;
  reasonForRecall: string;
  initiationDate: string;
  firmName: string;
}

export interface FdaVerificationFindings {
  // Claimed vs actual status
  claimedStatus?: string;
  actualStatus: FDAStatus;
  statusMatchesClaims: boolean;

  // 510(k) clearances (medical devices)
  clearances: FDA510kClearance[];
  hasClearance: boolean;

  // PMA approvals (Class III devices)
  pmaApprovals: FDAPMAApproval[];
  hasPMA: boolean;

  // BLA approvals (biologics: vaccines, gene therapy, blood products)
  blaApprovals: FDABLAApproval[];
  hasBLA: boolean;

  // NDA approvals (pharmaceutical drugs)
  ndaApprovals: FDANDAApproval[];
  hasNDA: boolean;

  // Registration & Listing (different from clearance!)
  registrations: FDARegistration[];
  deviceListings: FDADeviceListing[];
  isRegistered: boolean;
  isListed: boolean;

  // Safety signals
  adverseEvents: FDAAdverseEvent[];
  recalls: FDARecall[];
  hasAdverseEvents: boolean;
  hasRecalls: boolean;

  // Verification results
  verification: {
    statusVerified: boolean;
    clearanceMatchesClaims: boolean;
    noActiveRecalls: boolean;
    noSeriousAdverseEvents: boolean;
    facilityInGoodStanding: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "clearance_not_found" | "status_misrepresentation" | "active_recall" | "adverse_events" | "facility_issue";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: USPTO PATENT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface USPTOPatent {
  patentNumber: string;
  applicationNumber?: string;
  title: string;
  abstract?: string;
  inventors: string[];
  assignee: string;
  currentAssignee?: string;
  filingDate: string;
  issueDate: string;
  expirationDate?: string;
  patentType: "Utility" | "Design" | "Plant" | "Reissue";
  status: "Active" | "Expired" | "Lapsed";
  claimsCount?: number;
  independentClaimsCount?: number;
  citations?: number;
  citedBy?: number;
  patentFamily?: string[];
  usptoUrl: string;
}

export interface USPTOApplication {
  applicationNumber: string;
  title: string;
  filingDate: string;
  status: "Pending" | "Allowed" | "Abandoned" | "Patented";
  applicant: string;
  publishedAs?: string;
  expectedIssueDate?: string;
}

export interface PatentAssignment {
  reelFrame: string;
  assignor: string;
  assignee: string;
  executionDate: string;
  recordedDate: string;
  patentNumbers: string[];
  conveyanceType: string;
}

export interface USPTOLicenseInfo {
  patentNumber: string;
  licenseType: "Exclusive" | "Non-Exclusive" | "Unknown";
  licensee?: string;
  licensor?: string;
  documentedInAssignments: boolean;
}

export interface UsptoDeepdiveFindings {
  // Patent portfolio
  patents: USPTOPatent[];
  totalPatents: number;
  activePatents: number;

  // Pending applications
  applications: USPTOApplication[];
  pendingApplications: number;

  // Assignment chain (ownership verification)
  assignments: PatentAssignment[];
  currentOwner?: string;
  ownershipVerified: boolean;

  // License information
  licenses: USPTOLicenseInfo[];

  // Patent analysis
  analysis: {
    portfolioStrength: "weak" | "moderate" | "strong";
    averageClaimsPerPatent?: number;
    citationImpact?: number;
    geographicCoverage?: string[];
    expirationTimeline?: Array<{
      patentNumber: string;
      expirationDate: string;
    }>;
  };

  // Competitor overlap
  competitorOverlap: Array<{
    competitor: string;
    overlappingPatents: number;
    riskLevel: "low" | "medium" | "high";
  }>;

  // Verification results
  verification: {
    patentsExist: boolean;
    assignmentToCompany: boolean;
    licensesDocumented: boolean;
    noLitigation: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "patent_not_found" | "not_assigned_to_company" | "license_undocumented" | "litigation_risk" | "expiring_soon";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: MONEY FLOW INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

export type FundsDestination =
  | "escrow_via_portal"
  | "escrow_agent"
  | "company_bank_account"
  | "personal_account"
  | "crypto_wallet"
  | "wire_transfer"
  | "unknown";

export interface InvestorVerification {
  investorName: string;
  investorType: "VC Fund" | "Angel" | "Family Office" | "Corporate" | "Individual" | "Unknown";
  verified: boolean;
  verificationSource?: string;
  knownInvestments?: string[];
  redFlags?: string[];
}

export interface FundFlowStep {
  step: number;
  from: string;
  to: string;
  method: FundsDestination;
  amount?: number;
  date?: string;
  verified: boolean;
  redFlags?: string[];
}

export interface CapTableAnalysis {
  foundersEquity?: number;
  investorEquity?: number;
  optionPool?: number;
  totalShares?: number;
  recentChanges?: Array<{
    type: string;
    date: string;
    impact: string;
  }>;
  concerningPatterns?: string[];
}

export interface MoneyFlowIntegrityFindings {
  // How they want funds sent
  requestedMethod: FundsDestination;
  appropriateForRegime: boolean;

  // Escrow verification
  escrowAgent?: {
    name: string;
    verified: boolean;
    regulatedEntity: boolean;
  };

  // Fund flow analysis
  fundFlow: FundFlowStep[];
  flowMatchesRegime: boolean;

  // Investor verification
  claimedInvestors: string[];
  verifiedInvestors: InvestorVerification[];
  investorVerificationRate: number;

  // Cap table analysis (if available)
  capTable?: CapTableAnalysis;

  // Revenue authenticity signals
  revenueSignals?: {
    claimed?: string;
    verificationLevel: "unverified" | "partially_verified" | "verified";
    sources?: string[];
    concerns?: string[];
  };

  // Wire fraud indicators
  wireFraudIndicators: Array<{
    indicator: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  // Verification results
  verification: {
    fundsMethodAppropriate: boolean;
    escrowVerified: boolean;
    investorsVerified: boolean;
    noWireFraudIndicators: boolean;
    flowMatchesDocuments: boolean;
  };

  // Red flags
  redFlags: Array<{
    type: "personal_account" | "crypto_request" | "no_escrow" | "unverified_investors" | "flow_mismatch" | "wire_fraud_risk";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════

export interface PlaybookDiscrepancy {
  field: string;
  claimedValue: string;
  verifiedValue: string;
  source: string;
  severity: "minor" | "moderate" | "major" | "critical";
  category: "entity" | "securities" | "regulatory" | "ip" | "financial";
}

export interface PlaybookVerificationScore {
  entity: number;        // 0-1
  securities: number;    // 0-1
  finra: number;         // 0-1
  fda: number;           // 0-1
  patents: number;       // 0-1
  moneyFlow: number;     // 0-1
  overall: number;       // 0-1 weighted average
}

export interface PlaybookStopRule {
  triggered: boolean;
  rule: string;
  description: string;
  recommendation: "proceed_with_caution" | "require_resolution" | "disengage";
}

export interface InvestorPlaybookSynthesis {
  // Entity being evaluated
  entityName: string;
  evaluationDate: number;
  executiveSummary?: string; // For persona evaluation scoring

  // Branch findings
  entityVerification?: EntityVerificationFindings;
  secEdgar?: SecEdgarFindings;
  finraValidation?: FinraValidationFindings;
  fdaVerification?: FdaVerificationFindings;
  usptoDeepdive?: UsptoDeepdiveFindings;
  moneyFlowIntegrity?: MoneyFlowIntegrityFindings;

  // Aggregated analysis
  discrepancies: PlaybookDiscrepancy[];
  verificationScores: PlaybookVerificationScore;

  // Stop rules evaluation
  stopRules: PlaybookStopRule[];
  shouldDisengage: boolean;

  // Final assessment
  overallRisk: "low" | "moderate" | "elevated" | "high" | "critical";
  recommendation: "proceed" | "proceed_with_conditions" | "require_resolution" | "pass";
  conditions?: string[];
  requiredResolutions?: string[];

  // Sources
  sources: DDSource[];

  // Metadata
  branchesExecuted: InvestorPlaybookBranchType[];
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES (for external API calls)
// ═══════════════════════════════════════════════════════════════════════════

export interface StateRegistryAPIResponse {
  success: boolean;
  state: string;
  entities: StateRegistryRecord[];
  error?: string;
}

export interface SecEdgarAPIResponse {
  success: boolean;
  cik?: string;
  company?: {
    name: string;
    sic?: string;
    stateOfIncorporation?: string;
  };
  filings: Array<{
    accessionNumber: string;
    form: string;
    filingDate: string;
    primaryDocument?: string;
    documentUrl?: string;
  }>;
  error?: string;
}

export interface FinraPortalAPIResponse {
  success: boolean;
  portals: FundingPortal[];
  error?: string;
}

export interface FDA510kAPIResponse {
  success: boolean;
  results: FDA510kClearance[];
  totalCount: number;
  error?: string;
}

export interface FDARegistrationAPIResponse {
  success: boolean;
  registrations: FDARegistration[];
  listings: FDADeviceListing[];
  error?: string;
}

export interface USPTOPatentAPIResponse {
  success: boolean;
  patents: USPTOPatent[];
  totalCount: number;
  error?: string;
}

export interface USPTOAssignmentAPIResponse {
  success: boolean;
  assignments: PatentAssignment[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: CLAIM VERIFICATION (Strategic Hypothesis Validation)
// ═══════════════════════════════════════════════════════════════════════════

export type ClaimConfidence = "high" | "medium" | "low" | "unverified" | "contradicted";

export interface VerifiedClaim {
  claim: string;                      // The original claim text
  confidence: ClaimConfidence;        // Confidence level
  status: "verified" | "unverified" | "contradicted" | "partially_verified";
  evidence: string[];                 // Supporting evidence
  sources: Array<{
    title: string;
    url?: string;
    reliability: "authoritative" | "reputable" | "unknown";
  }>;
  notes?: string;                     // Additional context
}

export interface ClaimVerificationFindings {
  verifiedClaims: VerifiedClaim[];
  unverifiedClaims: VerifiedClaim[];
  contradictedClaims: VerifiedClaim[];
  overallAssessment: string;
  confidenceScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: PERSON VERIFICATION (Professional Background)
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonVerificationFindings {
  name: string;
  linkedInUrl?: string;
  currentRole?: string;
  currentCompany?: string;
  verified: boolean;
  professionalBackground: Array<{
    role: string;
    company: string;
    period?: string;
    verified: boolean;
    source?: string;
  }>;
  publicStatements?: Array<{
    topic: string;
    source: string;
    url?: string;
  }>;
  redFlags: Array<{
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;
  confidenceScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: NEWS/ACQUISITION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface AcquisitionDetails {
  acquirer: string;
  target: string;
  announcementDate?: string;
  closingDate?: string;
  dealValue?: string;
  dealType: "acquisition" | "merger" | "investment" | "partnership" | "rumored";
  status: "announced" | "completed" | "pending" | "rumored" | "denied";
  sources: Array<{
    outlet: string;
    title: string;
    url: string;
    date?: string;
    reliability: "authoritative" | "reputable" | "tabloid" | "unknown";
  }>;
}

export interface NewsVerificationFindings {
  eventVerified: boolean;
  eventType: "acquisition" | "funding" | "partnership" | "product_launch" | "other";
  acquisitionDetails?: AcquisitionDetails;
  keyFacts: Array<{
    fact: string;
    verified: boolean;
    source?: string;
    confidence: ClaimConfidence;
  }>;
  relatedNews: Array<{
    title: string;
    outlet: string;
    url: string;
    date?: string;
    relevance: "direct" | "related" | "background";
  }>;
  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 10: SCIENTIFIC CLAIM VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Status of a scientific claim after verification
 */
export type ScientificClaimStatus =
  | "peer_reviewed_verified"  // Published in peer-reviewed journal AND independently replicated
  | "peer_reviewed"           // Published in peer-reviewed journal, not yet replicated
  | "preprint_only"           // Only exists as preprint (arXiv, etc.)
  | "replication_failed"      // Independent replication attempts have FAILED
  | "retracted"               // Paper has been retracted
  | "debunked"                // Scientific community consensus is that claim is false
  | "unverified";             // No scientific evidence found

/**
 * Peer review status of research
 */
export type PeerReviewStatus =
  | "peer_reviewed"           // Published in peer-reviewed journal
  | "preprint"                // Only available as preprint
  | "not_submitted";          // No papers found

/**
 * A scientific claim to verify
 */
export interface ScientificClaim {
  claim: string;
  claimType: "breakthrough" | "discovery" | "treatment" | "technology" | "material" | "other";
  status: ScientificClaimStatus;
  peerReviewStatus: PeerReviewStatus;
  replicationStatus: "replicated" | "failed" | "partial" | "not_attempted";
  hasBeenRetracted: boolean;
  hasBeenDebunked: boolean;
  evidence: {
    supporting: string[];
    contradicting: string[];
  };
  scientificConsensus?: string;
  sources: Array<{
    title: string;
    url?: string;
    type: "arxiv" | "pubmed" | "journal" | "news" | "retraction_watch";
    date?: string;
  }>;
}

/**
 * Record of a replication study
 */
export interface ReplicationStudy {
  studyTitle: string;
  authors: string[];
  institution?: string;
  date?: string;
  result: "success" | "failure" | "partial";
  summary: string;
  sourceUrl?: string;
}

/**
 * Record of a paper retraction
 */
export interface RetractionRecord {
  paperTitle: string;
  journal?: string;
  retractionDate?: string;
  reason?: string;
  type: "retraction" | "correction" | "withdrawal" | "expression_of_concern";
  sourceUrl?: string;
}

/**
 * Findings from scientific claim verification
 */
export interface ScientificClaimVerificationFindings {
  claims: ScientificClaim[];
  overallStatus: ScientificClaimStatus;
  peerReviewedPapers: number;
  preprints: number;
  replicationStudies: ReplicationStudy[];
  retractions: RetractionRecord[];
  scientificConsensus?: string;
  redFlags: Array<{
    type: "claim_debunked" | "paper_retracted" | "replication_failure" | "no_peer_review" | "no_replication" | "conflicting_evidence" | "no_evidence";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;
  overallConfidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRANCH TRIGGER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

import { ComplexitySignals } from "../types";

export interface PlaybookComplexitySignals extends ComplexitySignals {
  // Additional signals for playbook branches
  isRequestingFunding?: boolean;
  claimedFDAStatus?: string;
  claimedPatents?: string[];
  claimedSecuritiesRegime?: SecuritiesRegime;
  fundingPortalMentioned?: string;
  wireInstructionsProvided?: boolean;
  cryptoPaymentRequested?: boolean;

  // Claim verification signals
  isClaimVerification?: boolean;      // Query asks to verify specific claims
  hasSpecificClaims?: boolean;        // Query contains falsifiable claims

  // Person verification signals
  personMentioned?: string;           // Name of person to verify
  linkedInUrl?: string;               // LinkedIn URL for person

  // News/acquisition verification signals
  acquisitionMentioned?: boolean;     // Query mentions acquisition
  newsEventMentioned?: boolean;       // Query mentions news event to verify
  companiesInvolved?: string[];       // Companies involved in acquisition/news

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONA-SPECIFIC SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // Current persona (from inference)
  persona?: string;
  entityType?: "company" | "fund" | "person" | "event" | "research_signal";

  // Financial persona signals (Banker, VC, LP)
  dealMemoRequested?: boolean;           // Request for deal memo generation
  fundPerformanceRequested?: boolean;    // Request for fund performance verification
  claimedTVPI?: number;                  // Claimed TVPI to verify
  claimedDPI?: number;                   // Claimed DPI to verify
  claimedIRR?: number;                   // Claimed IRR to verify

  // Industry persona signals (Pharma BD, Academic R&D)
  clinicalTrialMentioned?: boolean;      // Clinical trial verification needed
  nctIdMentioned?: string;               // ClinicalTrials.gov NCT ID
  academicResearchMentioned?: boolean;   // Academic research verification needed
  literatureReviewRequested?: boolean;   // Cross-reference literature needed

  // Strategic persona signals (Corp Dev, Macro Strategist)
  maActivityRequested?: boolean;         // M&A activity verification needed
  economicThesisRequested?: boolean;     // Economic thesis validation needed
  macroIndicatorsMentioned?: boolean;    // Macro indicators verification needed

  // Scientific claim verification signals
  hasScientificClaims?: boolean;         // Query contains scientific/research claims
  claimedScientificDiscovery?: string;   // Specific scientific claim (e.g., "room-temperature superconductor")
  researchArea?: string;                 // Area of research (physics, biology, etc.)
}

export const PLAYBOOK_BRANCH_TRIGGERS: Record<
  InvestorPlaybookBranchType,
  (signals: PlaybookComplexitySignals) => boolean
> = {
  // Entity verification: ALWAYS run for funding requests
  entity_verification: (signals) =>
    Boolean(signals.isRequestingFunding) || true,

  // SEC EDGAR: Run for any significant funding or securities claims
  sec_edgar: (signals) =>
    Boolean(signals.isRequestingFunding) ||
    (signals.fundingSize ?? 0) > 100_000 ||
    signals.claimedSecuritiesRegime !== undefined ||
    Boolean(signals.hasPublicSecurities),

  // FINRA validation: Run if funding portal mentioned or Reg CF
  finra_validation: (signals) =>
    signals.fundingPortalMentioned !== undefined ||
    signals.claimedSecuritiesRegime === "Reg CF" ||
    signals.sectors?.some(s =>
      ["Fintech", "Crypto", "Banking", "Insurance"].includes(s)
    ) || false,

  // FDA verification: Run if FDA status claimed or HealthTech/Biotech
  fda_verification: (signals) =>
    signals.claimedFDAStatus !== undefined ||
    signals.sectors?.some(s =>
      ["HealthTech", "Biotech", "MedTech", "Pharma", "Medical Devices"].includes(s)
    ) || false,

  // USPTO deep dive: Run if patents claimed or DeepTech
  uspto_deepdive: (signals) =>
    (signals.claimedPatents?.length ?? 0) > 0 ||
    Boolean(signals.hasPatentMentions) ||
    signals.sectors?.some(s =>
      ["DeepTech", "Biotech", "Hardware", "Semiconductors", "Pharma"].includes(s)
    ) || false,

  // Money flow integrity: ALWAYS run for funding requests
  money_flow_integrity: (signals) =>
    Boolean(signals.isRequestingFunding) ||
    Boolean(signals.wireInstructionsProvided) ||
    Boolean(signals.cryptoPaymentRequested) ||
    (signals.fundingSize ?? 0) > 50_000,

  // Claim verification: Run when query contains specific claims to verify
  claim_verification: (signals) =>
    Boolean(signals.isClaimVerification) ||
    Boolean(signals.hasSpecificClaims),

  // Person verification: Run when query mentions specific people
  person_verification: (signals) =>
    Boolean(signals.personMentioned) ||
    Boolean(signals.linkedInUrl),

  // News verification: Run when query mentions acquisitions, news events
  news_verification: (signals) =>
    Boolean(signals.acquisitionMentioned) ||
    Boolean(signals.newsEventMentioned),

  // Scientific claim verification: Run when query contains scientific/research claims
  // CRITICAL for detecting debunked claims like LK-99 superconductor
  scientific_claim_verification: (signals) =>
    Boolean(signals.hasScientificClaims) ||
    Boolean(signals.claimedScientificDiscovery) ||
    Boolean(signals.academicResearchMentioned) ||
    signals.sectors?.some(s =>
      ["DeepTech", "Biotech", "Pharma", "Physics", "Materials Science", "Quantum"].includes(s)
    ) || false,

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONA-SPECIFIC BRANCH TRIGGERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Deal memo synthesis: Run for banker/VC personas or funding analysis
  deal_memo_synthesis: (signals) =>
    signals.persona === "JPM_STARTUP_BANKER" ||
    signals.persona === "EARLY_STAGE_VC" ||
    Boolean(signals.dealMemoRequested),

  // Fund performance verification: Run for LP allocator persona
  fund_performance_verification: (signals) =>
    signals.persona === "LP_ALLOCATOR" ||
    Boolean(signals.fundPerformanceRequested) ||
    signals.entityType === "fund",

  // Clinical trial verification: Run for pharma BD persona
  clinical_trial_verification: (signals) =>
    signals.persona === "PHARMA_BD" ||
    Boolean(signals.clinicalTrialMentioned) ||
    signals.sectors?.some(s =>
      ["Pharma", "Biotech", "Clinical"].includes(s)
    ) || false,

  // Literature triangulation: Run for academic R&D persona
  literature_triangulation: (signals) =>
    signals.persona === "ACADEMIC_RD" ||
    Boolean(signals.academicResearchMentioned) ||
    Boolean(signals.literatureReviewRequested),

  // M&A activity verification: Run for corp dev persona
  ma_activity_verification: (signals) =>
    signals.persona === "CORP_DEV" ||
    Boolean(signals.acquisitionMentioned) ||
    Boolean(signals.maActivityRequested),

  // Economic indicator verification: Run for macro strategist persona
  economic_indicator_verification: (signals) =>
    signals.persona === "MACRO_STRATEGIST" ||
    Boolean(signals.macroIndicatorsMentioned) ||
    Boolean(signals.economicThesisRequested),
};
