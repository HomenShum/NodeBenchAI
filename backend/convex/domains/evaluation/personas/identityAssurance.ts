/**
 * identityAssurance.ts
 *
 * Identity Assurance Levels (IAL) for DD verification.
 *
 * Based on NIST SP 800-63A Digital Identity Guidelines, adapted for
 * startup/company due diligence context.
 *
 * IAL determines how confident we are that an entity (company, founder)
 * is who they claim to be. Higher risk requires higher assurance.
 *
 * Levels:
 * - IAL1: Weak signals (OSINT presence, basic consistency)
 * - IAL2: Stronger corroboration (registry + cross-source match)
 * - IAL3: High assurance (verified docs, rare for early-stage)
 *
 * Reference: https://digitalgovernmenthub.org/library/nist-digital-identity-guidelines/
 */

// ============================================================================
// IDENTITY ASSURANCE TYPES
// ============================================================================

/**
 * Identity Assurance Level
 */
export type IdentityAssuranceLevel = "IAL1" | "IAL2" | "IAL3" | "IAL0";

/**
 * Evidence types that contribute to identity assurance
 */
export type IdentityEvidenceType =
  | "osint_presence"           // Found in web search
  | "linkedin_profile"         // LinkedIn profile exists
  | "social_consistency"       // Consistent across social platforms
  | "registry_mention"         // Mentioned in business registry
  | "registry_match"           // Direct match in business registry
  | "sec_filing"               // Found in SEC filings
  | "patent_authorship"        // Named on patents
  | "domain_whois"             // WHOIS matches claimed info
  | "press_coverage"           // Named in credible press
  | "conference_speaker"       // Conference/event presence
  | "academic_publication"     // Published papers
  | "verified_document";       // Government/notarized document

/**
 * Single piece of identity evidence
 */
export interface IdentityEvidence {
  type: IdentityEvidenceType;
  source: string;            // Where we found this
  url?: string;
  matchedFields: string[];   // What matched (name, title, company, etc.)
  matchQuality: "exact" | "partial" | "fuzzy";
  timestamp: number;
  expiresAt?: number;        // Some evidence goes stale
  rawData?: string;          // Original snippet/data
}

/**
 * Identity verification result for an entity
 */
export interface IdentityVerificationResult {
  entityName: string;
  entityType: "company" | "person";

  // Final assurance level
  assuranceLevel: IdentityAssuranceLevel;
  assuranceReason: string;

  // Evidence collected
  evidence: IdentityEvidence[];
  evidenceScore: number;     // 0-100

  // Consistency checks
  consistencyScore: number;  // 0-100, how consistent across sources
  contradictionsFound: string[];

  // For persons
  linkedinVerified?: boolean;
  titleConsistent?: boolean;
  employmentHistoryVerified?: boolean;

  // For companies
  registryVerified?: boolean;
  domainVerified?: boolean;
  incorporationDateVerified?: boolean;

  // Warnings
  warnings: string[];
  requiresManualReview: boolean;
}

// ============================================================================
// ASSURANCE LEVEL REQUIREMENTS
// ============================================================================

/**
 * Requirements for each assurance level
 */
export const IAL_REQUIREMENTS: Record<IdentityAssuranceLevel, {
  description: string;
  minEvidenceScore: number;
  requiredEvidenceTypes: IdentityEvidenceType[][];  // OR groups
  minSources: number;
  consistencyRequired: boolean;
}> = {
  IAL0: {
    description: "No identity assurance - entity unverified",
    minEvidenceScore: 0,
    requiredEvidenceTypes: [],
    minSources: 0,
    consistencyRequired: false,
  },
  IAL1: {
    description: "Basic assurance - OSINT presence, weak corroboration",
    minEvidenceScore: 20,
    requiredEvidenceTypes: [
      ["osint_presence", "linkedin_profile", "social_consistency"],
    ],
    minSources: 1,
    consistencyRequired: false,
  },
  IAL2: {
    description: "Moderate assurance - Registry match OR multiple corroborating sources",
    minEvidenceScore: 50,
    requiredEvidenceTypes: [
      ["registry_match", "sec_filing"],
      ["linkedin_profile", "press_coverage", "social_consistency"],
    ],
    minSources: 2,
    consistencyRequired: true,
  },
  IAL3: {
    description: "High assurance - Verified documents or official filings",
    minEvidenceScore: 80,
    requiredEvidenceTypes: [
      ["verified_document", "sec_filing"],
      ["registry_match", "linkedin_profile", "press_coverage"],
    ],
    minSources: 3,
    consistencyRequired: true,
  },
};

/**
 * Risk tier to minimum IAL mapping
 * Higher risk tiers require higher identity assurance
 */
export const TIER_IAL_REQUIREMENTS: Record<string, IdentityAssuranceLevel> = {
  FAST_VERIFY: "IAL1",   // Basic presence is enough
  LIGHT_DD: "IAL1",      // Basic presence is enough
  STANDARD_DD: "IAL2",   // Need registry or cross-source
  FULL_PLAYBOOK: "IAL2", // Need registry or cross-source (IAL3 ideal but rare)
};

// ============================================================================
// EVIDENCE SCORING
// ============================================================================

/**
 * Points awarded for each evidence type
 */
const EVIDENCE_SCORES: Record<IdentityEvidenceType, number> = {
  osint_presence: 5,
  linkedin_profile: 15,
  social_consistency: 10,
  registry_mention: 20,
  registry_match: 35,
  sec_filing: 40,
  patent_authorship: 25,
  domain_whois: 15,
  press_coverage: 20,
  conference_speaker: 10,
  academic_publication: 15,
  verified_document: 50,
};

/**
 * Match quality multipliers
 */
const MATCH_QUALITY_MULTIPLIERS: Record<IdentityEvidence["matchQuality"], number> = {
  exact: 1.0,
  partial: 0.7,
  fuzzy: 0.4,
};

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Calculate identity assurance level from evidence
 */
export function calculateAssuranceLevel(
  evidence: IdentityEvidence[]
): {
  level: IdentityAssuranceLevel;
  score: number;
  reason: string;
} {
  if (evidence.length === 0) {
    return {
      level: "IAL0",
      score: 0,
      reason: "No identity evidence collected",
    };
  }

  // Calculate total evidence score
  let score = 0;
  for (const e of evidence) {
    const baseScore = EVIDENCE_SCORES[e.type] ?? 0;
    const multiplier = MATCH_QUALITY_MULTIPLIERS[e.matchQuality];
    score += baseScore * multiplier;
  }

  // Cap at 100
  score = Math.min(100, score);

  // Count unique sources
  const uniqueSources = new Set(evidence.map(e => e.source)).size;

  // Check evidence type coverage
  const evidenceTypes = new Set(evidence.map(e => e.type));

  // Determine level
  let level: IdentityAssuranceLevel = "IAL0";
  let reason = "";

  // Check IAL3 first
  if (score >= IAL_REQUIREMENTS.IAL3.minEvidenceScore &&
      uniqueSources >= IAL_REQUIREMENTS.IAL3.minSources &&
      checkEvidenceRequirements(evidenceTypes, IAL_REQUIREMENTS.IAL3.requiredEvidenceTypes)) {
    level = "IAL3";
    reason = "High assurance: verified documents or multiple official sources";
  }
  // Check IAL2
  else if (score >= IAL_REQUIREMENTS.IAL2.minEvidenceScore &&
           uniqueSources >= IAL_REQUIREMENTS.IAL2.minSources &&
           checkEvidenceRequirements(evidenceTypes, IAL_REQUIREMENTS.IAL2.requiredEvidenceTypes)) {
    level = "IAL2";
    reason = "Moderate assurance: registry match or cross-source corroboration";
  }
  // Check IAL1
  else if (score >= IAL_REQUIREMENTS.IAL1.minEvidenceScore &&
           uniqueSources >= IAL_REQUIREMENTS.IAL1.minSources) {
    level = "IAL1";
    reason = "Basic assurance: OSINT presence confirmed";
  }
  // Default IAL0
  else {
    reason = `Insufficient evidence (score: ${score}, sources: ${uniqueSources})`;
  }

  return { level, score, reason };
}

/**
 * Check if evidence types meet requirements (any OR group matches)
 */
function checkEvidenceRequirements(
  evidenceTypes: Set<IdentityEvidenceType>,
  requirements: IdentityEvidenceType[][]
): boolean {
  if (requirements.length === 0) return true;

  // Check if any requirement group is satisfied
  return requirements.some(group =>
    group.some(required => evidenceTypes.has(required))
  );
}

/**
 * Full identity verification for a person
 */
export function verifyPersonIdentity(
  name: string,
  evidence: IdentityEvidence[],
  microBranchResults?: any
): IdentityVerificationResult {
  const warnings: string[] = [];
  const contradictions: string[] = [];

  // Calculate assurance level
  const { level, score, reason } = calculateAssuranceLevel(evidence);

  // Check LinkedIn
  const linkedinEvidence = evidence.find(e => e.type === "linkedin_profile");
  const linkedinVerified = linkedinEvidence?.matchQuality === "exact";

  if (!linkedinVerified) {
    warnings.push("LinkedIn profile not verified or not found");
  }

  // Check title consistency
  const titleSources = evidence.filter(e =>
    e.matchedFields.some(f => f.toLowerCase().includes("title"))
  );
  const titles = new Set(titleSources.flatMap(e => e.matchedFields));
  const titleConsistent = titles.size <= 3; // Allow some variation

  if (!titleConsistent) {
    warnings.push(`Multiple different titles found (${titles.size})`);
    contradictions.push(`Title inconsistency: ${[...titles].join(", ")}`);
  }

  // Check employment history (if available from micro-branches)
  let employmentHistoryVerified = false;
  if (microBranchResults?.founder_footprint?.status === "pass") {
    employmentHistoryVerified = true;
  }

  // Consistency score
  const consistencyScore = calculateConsistencyScore(evidence, contradictions);

  // Determine if manual review needed
  const requiresManualReview =
    level === "IAL0" ||
    contradictions.length > 0 ||
    warnings.length > 2;

  return {
    entityName: name,
    entityType: "person",
    assuranceLevel: level,
    assuranceReason: reason,
    evidence,
    evidenceScore: score,
    consistencyScore,
    contradictionsFound: contradictions,
    linkedinVerified,
    titleConsistent,
    employmentHistoryVerified,
    warnings,
    requiresManualReview,
  };
}

/**
 * Full identity verification for a company
 */
export function verifyCompanyIdentity(
  companyName: string,
  evidence: IdentityEvidence[],
  microBranchResults?: any
): IdentityVerificationResult {
  const warnings: string[] = [];
  const contradictions: string[] = [];

  // Calculate assurance level
  const { level, score, reason } = calculateAssuranceLevel(evidence);

  // Check registry
  const registryEvidence = evidence.find(e =>
    e.type === "registry_match" || e.type === "registry_mention"
  );
  const registryVerified = registryEvidence?.matchQuality === "exact";

  if (!registryVerified) {
    warnings.push("Company not verified in business registry");
  }

  // Check domain
  const domainEvidence = evidence.find(e => e.type === "domain_whois");
  const domainVerified = domainEvidence?.matchQuality !== undefined;

  if (!domainVerified) {
    warnings.push("Domain ownership not verified");
  }

  // Check micro-branch results
  let incorporationDateVerified = false;
  if (microBranchResults?.identity_registry?.status === "pass") {
    incorporationDateVerified = true;
  }

  // Consistency score
  const consistencyScore = calculateConsistencyScore(evidence, contradictions);

  // Determine if manual review needed
  const requiresManualReview =
    level === "IAL0" ||
    !registryVerified ||
    contradictions.length > 0;

  return {
    entityName: companyName,
    entityType: "company",
    assuranceLevel: level,
    assuranceReason: reason,
    evidence,
    evidenceScore: score,
    consistencyScore,
    contradictionsFound: contradictions,
    registryVerified,
    domainVerified,
    incorporationDateVerified,
    warnings,
    requiresManualReview,
  };
}

/**
 * Calculate consistency score from evidence
 */
function calculateConsistencyScore(
  evidence: IdentityEvidence[],
  contradictions: string[]
): number {
  if (evidence.length === 0) return 0;

  // Start at 100, deduct for issues
  let score = 100;

  // Deduct for contradictions
  score -= contradictions.length * 20;

  // Deduct for fuzzy matches
  const fuzzyMatches = evidence.filter(e => e.matchQuality === "fuzzy").length;
  score -= fuzzyMatches * 5;

  // Deduct for low diversity of sources
  const uniqueSources = new Set(evidence.map(e => e.source)).size;
  if (uniqueSources < 2) score -= 20;

  return Math.max(0, Math.min(100, score));
}

/**
 * Check if identity meets tier requirements
 */
export function meetsIdentityRequirement(
  verification: IdentityVerificationResult,
  tier: string
): {
  meets: boolean;
  required: IdentityAssuranceLevel;
  actual: IdentityAssuranceLevel;
  gap: string;
} {
  const required = TIER_IAL_REQUIREMENTS[tier] ?? "IAL1";
  const actual = verification.assuranceLevel;

  const levelOrder: IdentityAssuranceLevel[] = ["IAL0", "IAL1", "IAL2", "IAL3"];
  const requiredIndex = levelOrder.indexOf(required);
  const actualIndex = levelOrder.indexOf(actual);

  const meets = actualIndex >= requiredIndex;

  return {
    meets,
    required,
    actual,
    gap: meets
      ? "Identity assurance meets requirements"
      : `Need ${required} but only have ${actual}. ${verification.assuranceReason}`,
  };
}
