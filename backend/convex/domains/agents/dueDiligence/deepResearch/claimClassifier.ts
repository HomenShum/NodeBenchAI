/**
 * Claim Classifier Module
 *
 * Implements enhanced claim verification including:
 * - Claim type classification (factual/causal/attribution/speculative)
 * - Speculation level assessment
 * - Verifiability classification
 * - Contradiction detection with source weighting
 * - Person verification depth
 * - Alternative interpretation ranking
 * - Temporal consistency checking
 *
 * @module deepResearch/claimClassifier
 */

import type {
  Claim,
  ClaimType,
  SpeculationLevel,
  VerifiabilityLevel,
  EnhancedClaim,
  WeightedContradiction,
  PersonVerificationResult,
  RankedAlternativeInterpretation,
  TemporalConsistencyResult,
  ResearchSource,
  Evidence,
} from "./types";

// =============================================================================
// CLAIM TYPE CLASSIFICATION
// =============================================================================

/**
 * Patterns for detecting claim types
 */
const CLAIM_TYPE_PATTERNS = {
  causal: [
    /\binitiated\b/i,
    /\bcaused\b/i,
    /\bled to\b/i,
    /\bresulted in\b/i,
    /\bdue to\b/i,
    /\bbecause\b/i,
    /\bscaled\b/i,
    /\bdrove\b/i,
    /\benabled\b/i,
    /\btriggered\b/i,
    /\bresponsible for\b/i,
    /\bcontributed to\b/i,
  ],
  attribution: [
    /\b(he|she|they)\s+(did|built|created|invented|developed|initiated)\b/i,
    /\bwas responsible for\b/i,
    /\b\w+('s|'s) effort\b/i,
    /\battributed to\b/i,
    /\bcredited with\b/i,
    /\bspearheaded by\b/i,
    /\bled by\b/i,
  ],
  speculative: [
    /\bwill\b/i,
    /\bwould\b/i,
    /\bcould\b/i,
    /\bmight\b/i,
    /\bmay\b/i,
    /\bcan benefit\b/i,
    /\bshould\b/i,
    /\blikely to\b/i,
    /\bexpected to\b/i,
    /\bpotentially\b/i,
    /\bin the future\b/i,
    /\bnext few years\b/i,
    /\bprojected\b/i,
    /\banticipated\b/i,
  ],
  relational: [
    /\bintegrated with\b/i,
    /\bpartner(ed|ship)\b/i,
    /\bconnect(ed|ion)\b/i,
    /\baffiliat(ed|ion)\b/i,
    /\baligns with\b/i,
    /\bworked with\b/i,
    /\bcollaborat(ed|ion)\b/i,
  ],
};

/**
 * Classify a claim by its type
 */
export function classifyClaimType(statement: string): ClaimType {
  // Check for speculative first (most important for verification)
  for (const pattern of CLAIM_TYPE_PATTERNS.speculative) {
    if (pattern.test(statement)) {
      return "speculative";
    }
  }

  // Check for causal claims
  for (const pattern of CLAIM_TYPE_PATTERNS.causal) {
    if (pattern.test(statement)) {
      return "causal";
    }
  }

  // Check for attribution claims
  for (const pattern of CLAIM_TYPE_PATTERNS.attribution) {
    if (pattern.test(statement)) {
      return "attribution";
    }
  }

  // Check for relational claims
  for (const pattern of CLAIM_TYPE_PATTERNS.relational) {
    if (pattern.test(statement)) {
      return "relational";
    }
  }

  // Default to factual
  return "factual";
}

// =============================================================================
// SPECULATION LEVEL CLASSIFICATION
// =============================================================================

/**
 * Keywords and patterns indicating speculation levels
 */
const SPECULATION_INDICATORS = {
  high: [
    /\bi can be (very )?wrong\b/i,
    /\bhighly speculative\b/i,
    /\bpure speculation\b/i,
    /\bjust a guess\b/i,
    /\bno evidence\b/i,
    /\bunsubstantiated\b/i,
    /\bnext few years\b/i,
    /\bdramatically\b/i,
    /\bsuper quickly\b/i,
  ],
  moderate: [
    /\bmight\b/i,
    /\bcould\b/i,
    /\bpossibly\b/i,
    /\bperhaps\b/i,
    /\blikely\b/i,
    /\bprobably\b/i,
    /\bseems to\b/i,
    /\bappears to\b/i,
    /\bcan benefit\b/i,
  ],
  low: [
    /\bsuggests\b/i,
    /\bindicates\b/i,
    /\bimplies\b/i,
    /\bbased on\b/i,
    /\baccording to\b/i,
  ],
};

/**
 * Classify the speculation level of a claim
 */
export function classifySpeculationLevel(
  statement: string,
  hasEvidence: boolean,
  evidenceStrength?: string
): SpeculationLevel {
  // Check for extreme speculation patterns
  let speculationScore = 0;

  for (const pattern of SPECULATION_INDICATORS.high) {
    if (pattern.test(statement)) {
      speculationScore += 3;
    }
  }

  for (const pattern of SPECULATION_INDICATORS.moderate) {
    if (pattern.test(statement)) {
      speculationScore += 2;
    }
  }

  for (const pattern of SPECULATION_INDICATORS.low) {
    if (pattern.test(statement)) {
      speculationScore += 1;
    }
  }

  // Adjust based on evidence
  if (!hasEvidence) {
    speculationScore += 2;
  } else if (evidenceStrength === "authoritative") {
    speculationScore = Math.max(0, speculationScore - 3);
  } else if (evidenceStrength === "strong") {
    speculationScore = Math.max(0, speculationScore - 2);
  }

  // Determine level
  if (speculationScore >= 6) return "extreme";
  if (speculationScore >= 4) return "high";
  if (speculationScore >= 2) return "moderate";
  if (speculationScore >= 1) return "low";
  return "none";
}

// =============================================================================
// VERIFIABILITY CLASSIFICATION
// =============================================================================

/**
 * Patterns indicating unverifiable claims
 */
const UNVERIFIABLE_PATTERNS = [
  /\binitiated the effort\b/i,
  /\binternal\b/i,
  /\bprivate(ly)?\b/i,
  /\bconfidential\b/i,
  /\bbehind (the )?scenes\b/i,
  /\bunannounced\b/i,
  /\bunpublished\b/i,
  /\bproprietary\b/i,
];

const INSIDER_KNOWLEDGE_PATTERNS = [
  /\binternal meeting\b/i,
  /\bprivate conversation\b/i,
  /\bsources say\b/i,
  /\baccording to insiders\b/i,
  /\bunnamed sources\b/i,
  /\binternally\b/i,
];

/**
 * Classify whether a claim is publicly verifiable
 */
export function classifyVerifiability(
  statement: string,
  hasContradiction: boolean
): { level: VerifiabilityLevel; reason: string } {
  if (hasContradiction) {
    return {
      level: "contradicted",
      reason: "Evidence found that contradicts this claim",
    };
  }

  for (const pattern of INSIDER_KNOWLEDGE_PATTERNS) {
    if (pattern.test(statement)) {
      return {
        level: "requires_insider_knowledge",
        reason: "This claim involves internal information not available to public sources",
      };
    }
  }

  for (const pattern of UNVERIFIABLE_PATTERNS) {
    if (pattern.test(statement)) {
      return {
        level: "not_publicly_verifiable",
        reason: "This claim involves private or internal actions that cannot be verified through public sources",
      };
    }
  }

  return {
    level: "publicly_verifiable",
    reason: "This claim can be verified through public sources",
  };
}

// =============================================================================
// ENHANCED CLAIM CREATION
// =============================================================================

/**
 * Create an enhanced claim with full verification metadata
 */
export function createEnhancedClaim(
  baseClaim: Claim,
  contradiction?: {
    source: ResearchSource;
    statement: string;
    strength: "weak" | "moderate" | "strong";
  }
): EnhancedClaim {
  const claimType = classifyClaimType(baseClaim.statement);
  const hasEvidence = baseClaim.evidence.length > 0;
  const evidenceStrength = hasEvidence
    ? baseClaim.evidence[0]?.strength
    : undefined;

  const speculationLevel = classifySpeculationLevel(
    baseClaim.statement,
    hasEvidence,
    evidenceStrength
  );

  const { level: verifiability, reason: verifiabilityReason } =
    classifyVerifiability(baseClaim.statement, !!contradiction);

  const enhanced: EnhancedClaim = {
    ...baseClaim,
    claimType,
    speculationLevel,
    verifiability,
    verifiabilityReason,
  };

  // Add contradiction info if present
  if (contradiction) {
    enhanced.contradictedBy = {
      source: contradiction.source,
      contradictingStatement: contradiction.statement,
      contradictionStrength: contradiction.strength,
    };
  }

  // Extract attribution for causal/attribution claims
  if (claimType === "causal" || claimType === "attribution") {
    const personMatch = baseClaim.statement.match(
      /^([A-Z][a-z]+ [A-Z][a-z]+)/
    );
    if (personMatch) {
      enhanced.attributedTo = personMatch[1];
    }
  }

  // Extract temporal reference
  const futureMatch = baseClaim.statement.match(
    /\b(will|would|next|future|coming)\b/i
  );
  const pastMatch = baseClaim.statement.match(
    /\b(did|was|were|had|initiated|acquired)\b/i
  );

  if (futureMatch) {
    enhanced.temporalReference = {
      type: "future",
      isVerifiable: false,
    };
  } else if (pastMatch) {
    enhanced.temporalReference = {
      type: "past",
      isVerifiable: true,
    };
  } else {
    enhanced.temporalReference = {
      type: "present",
      isVerifiable: true,
    };
  }

  return enhanced;
}

// =============================================================================
// CONTRADICTION DETECTION WITH SOURCE WEIGHTING
// =============================================================================

/**
 * Source reliability weights
 */
const SOURCE_RELIABILITY_WEIGHTS: Record<string, number> = {
  authoritative: 1.0,
  reliable: 0.75,
  secondary: 0.5,
  unverified: 0.25,
};

const SOURCE_TYPE_WEIGHTS: Record<string, number> = {
  government_registry: 1.0,
  sec_filing: 1.0,
  patent_filing: 0.95,
  academic_paper: 0.9,
  press_release: 0.8,
  company_website: 0.7,
  news_article: 0.65,
  linkedin: 0.6,
  crunchbase: 0.6,
  pitchbook: 0.6,
  interview: 0.5,
  social_media: 0.3,
  llm_inference: 0.1,
};

/**
 * Calculate source reliability score
 */
export function calculateSourceReliability(source: ResearchSource): number {
  const reliabilityWeight = SOURCE_RELIABILITY_WEIGHTS[source.reliability] ?? 0.5;
  const typeWeight = SOURCE_TYPE_WEIGHTS[source.type] ?? 0.5;
  return (reliabilityWeight + typeWeight) / 2;
}

/**
 * Detect contradiction between claim and potential contradiction with source weighting
 */
export function detectWeightedContradiction(
  claim: string,
  claimSource: ResearchSource,
  contradiction: string,
  contradictionSource: ResearchSource
): WeightedContradiction {
  const claimReliability = calculateSourceReliability(claimSource);
  const contradictionReliability = calculateSourceReliability(contradictionSource);
  const reliabilityDelta = contradictionReliability - claimReliability;

  // Determine weighted strength
  let weightedStrength: WeightedContradiction["weightedStrength"];
  if (Math.abs(reliabilityDelta) >= 0.4) {
    weightedStrength = "definitive";
  } else if (Math.abs(reliabilityDelta) >= 0.2) {
    weightedStrength = "strong";
  } else if (Math.abs(reliabilityDelta) >= 0.1) {
    weightedStrength = "moderate";
  } else {
    weightedStrength = "weak";
  }

  // Determine verdict
  let verdict: WeightedContradiction["verdict"];
  if (reliabilityDelta > 0.15) {
    verdict = "contradiction_likely_correct";
  } else if (reliabilityDelta < -0.15) {
    verdict = "original_likely_correct";
  } else {
    verdict = "insufficient_evidence";
  }

  // Generate explanation
  const explanation = generateContradictionExplanation(
    claim,
    contradiction,
    claimSource,
    contradictionSource,
    reliabilityDelta
  );

  return {
    claim,
    contradiction,
    claimSource,
    contradictionSource,
    reliabilityDelta,
    weightedStrength,
    verdict,
    explanation,
  };
}

function generateContradictionExplanation(
  claim: string,
  contradiction: string,
  claimSource: ResearchSource,
  contradictionSource: ResearchSource,
  reliabilityDelta: number
): string {
  const claimSourceDesc = `${claimSource.type} (${claimSource.reliability})`;
  const contradictSourceDesc = `${contradictionSource.type} (${contradictionSource.reliability})`;

  if (reliabilityDelta > 0.15) {
    return `The contradicting source (${contradictSourceDesc}) is more reliable than the original claim source (${claimSourceDesc}). The contradiction is likely correct.`;
  } else if (reliabilityDelta < -0.15) {
    return `The original claim source (${claimSourceDesc}) is more reliable than the contradicting source (${contradictSourceDesc}). The original claim is likely correct.`;
  } else {
    return `Both sources have similar reliability levels (claim: ${claimSourceDesc}, contradiction: ${contradictSourceDesc}). Further investigation is needed to determine which is correct.`;
  }
}

// =============================================================================
// PERSON VERIFICATION DEPTH
// =============================================================================

/**
 * Verify a person with depth levels
 */
export function verifyPersonDepth(
  name: string,
  linkedInUrl: string | undefined,
  claimsAboutPerson: string[],
  sources: ResearchSource[]
): PersonVerificationResult {
  const result: PersonVerificationResult = {
    name,
    linkedInUrl: linkedInUrl,
    verificationDepth: {
      titleVerified: false,
      companyVerified: false,
      publicWorkVerified: false,
      publicWorkSources: [],
      internalContributionsVerifiable: false,
      internalContributionsNote:
        "Internal contributions (specific projects, initiatives) typically cannot be verified through public sources",
    },
    verifiedClaims: [],
    unverifiableClaims: [],
    contradictedClaims: [],
  };

  // Find sources that verify title/role
  const titleSources = sources.filter(
    (s) =>
      s.type === "linkedin" ||
      s.type === "company_website" ||
      s.type === "press_release"
  );
  if (titleSources.length > 0) {
    result.verificationDepth.titleVerified = true;
    result.verificationDepth.titleSource = titleSources[0];
  }

  // Find sources that verify company affiliation
  const companySources = sources.filter(
    (s) =>
      s.type === "linkedin" ||
      s.type === "company_website" ||
      s.type === "news_article" ||
      s.type === "press_release"
  );
  if (companySources.length > 0) {
    result.verificationDepth.companyVerified = true;
    result.verificationDepth.companySource = companySources[0];
  }

  // Find public work sources (talks, papers, blog posts)
  const publicWorkSources = sources.filter(
    (s) =>
      s.type === "academic_paper" ||
      s.type === "patent_filing" ||
      s.type === "interview" ||
      s.snippet?.toLowerCase().includes("talk") ||
      s.snippet?.toLowerCase().includes("presentation") ||
      s.snippet?.toLowerCase().includes("blog")
  );
  if (publicWorkSources.length > 0) {
    result.verificationDepth.publicWorkVerified = true;
    result.verificationDepth.publicWorkSources = publicWorkSources;
  }

  // Categorize claims
  for (const claim of claimsAboutPerson) {
    const { level } = classifyVerifiability(claim, false);

    if (level === "publicly_verifiable" && sources.length > 0) {
      result.verifiedClaims.push(claim);
    } else if (
      level === "requires_insider_knowledge" ||
      level === "not_publicly_verifiable"
    ) {
      result.unverifiableClaims.push(claim);
    }
  }

  return result;
}

// =============================================================================
// ALTERNATIVE INTERPRETATION RANKING
// =============================================================================

/**
 * Rank alternative interpretations by likelihood
 */
export function rankAlternativeInterpretations(
  interpretations: string[],
  supportingEvidenceByInterpretation: Map<string, string[]>,
  counterEvidenceByInterpretation: Map<string, string[]>
): RankedAlternativeInterpretation[] {
  const ranked: RankedAlternativeInterpretation[] = [];

  for (const interpretation of interpretations) {
    const supporting = supportingEvidenceByInterpretation.get(interpretation) || [];
    const counter = counterEvidenceByInterpretation.get(interpretation) || [];

    // Calculate likelihood score
    const supportScore = supporting.length * 0.2;
    const counterScore = counter.length * 0.15;
    let likelihoodScore = Math.min(1, Math.max(0, 0.5 + supportScore - counterScore));

    // Adjust for common alternative explanations (more realistic = higher score)
    if (
      interpretation.toLowerCase().includes("due diligence") ||
      interpretation.toLowerCase().includes("evaluation") ||
      interpretation.toLowerCase().includes("vendor") ||
      interpretation.toLowerCase().includes("planning")
    ) {
      likelihoodScore = Math.min(1, likelihoodScore + 0.1);
    }

    // Determine likelihood category
    let likelihood: RankedAlternativeInterpretation["likelihood"];
    if (likelihoodScore >= 0.75) {
      likelihood = "most_likely";
    } else if (likelihoodScore >= 0.55) {
      likelihood = "likely";
    } else if (likelihoodScore >= 0.35) {
      likelihood = "possible";
    } else if (likelihoodScore >= 0.2) {
      likelihood = "less_likely";
    } else {
      likelihood = "unlikely";
    }

    ranked.push({
      interpretation,
      likelihood,
      likelihoodScore,
      supportingEvidence: supporting,
      counterEvidence: counter,
      rationale: generateInterpretationRationale(
        interpretation,
        likelihood,
        supporting.length,
        counter.length
      ),
    });
  }

  // Sort by likelihood score descending
  ranked.sort((a, b) => b.likelihoodScore - a.likelihoodScore);

  return ranked;
}

function generateInterpretationRationale(
  interpretation: string,
  likelihood: string,
  supportCount: number,
  counterCount: number
): string {
  if (likelihood === "most_likely" || likelihood === "likely") {
    return `This interpretation is ${likelihood} because it is supported by ${supportCount} piece(s) of evidence and aligns with known patterns.`;
  } else if (likelihood === "possible") {
    return `This interpretation is possible but requires more evidence. Currently supported by ${supportCount} piece(s) of evidence with ${counterCount} piece(s) of counter-evidence.`;
  } else {
    return `This interpretation is ${likelihood} due to limited supporting evidence (${supportCount}) and/or significant counter-evidence (${counterCount}).`;
  }
}

// =============================================================================
// TEMPORAL CONSISTENCY CHECKING
// =============================================================================

/**
 * Check temporal consistency of claims
 */
export function checkTemporalConsistency(
  claims: Array<{ claim: string; date?: string; approximateDate?: string; source: string }>
): TemporalConsistencyResult {
  const timeline: TemporalConsistencyResult["timeline"] = [];
  const inconsistencies: TemporalConsistencyResult["inconsistencies"] = [];

  // Build timeline
  for (const claim of claims) {
    timeline.push({
      event: claim.claim,
      date: claim.date,
      approximateDate: claim.approximateDate,
      source: claim.source,
    });
  }

  // Sort by date (known dates first)
  timeline.sort((a, b) => {
    const dateA = a.date || a.approximateDate || "";
    const dateB = b.date || b.approximateDate || "";
    return dateA.localeCompare(dateB);
  });

  // Check for inconsistencies
  for (let i = 0; i < timeline.length; i++) {
    for (let j = i + 1; j < timeline.length; j++) {
      const event1 = timeline[i];
      const event2 = timeline[j];

      // Check for logical inconsistencies
      const inconsistency = detectTemporalInconsistency(event1, event2);
      if (inconsistency) {
        inconsistencies.push({
          event1: event1.event,
          event2: event2.event,
          issue: inconsistency.issue,
          severity: inconsistency.severity,
        });
      }
    }
  }

  // Calculate confidence
  const confidence = inconsistencies.length === 0
    ? 0.9
    : Math.max(0.1, 0.9 - inconsistencies.length * 0.15);

  return {
    isConsistent: inconsistencies.length === 0,
    timeline,
    inconsistencies,
    confidence,
  };
}

function detectTemporalInconsistency(
  event1: { event: string; date?: string; approximateDate?: string },
  event2: { event: string; date?: string; approximateDate?: string }
): { issue: string; severity: "minor" | "moderate" | "major" } | null {
  // Check for events that should logically precede each other
  const acquisitionPattern = /\bacquir(ed|ition)\b/i;
  const announcementPattern = /\bannounce(d|ment)\b/i;
  const launchPattern = /\blaunch(ed)?\b/i;
  const founderPattern = /\bfound(ed|er)\b/i;

  // Announcement should come before acquisition completes
  if (
    announcementPattern.test(event2.event) &&
    acquisitionPattern.test(event1.event) &&
    event1.event.includes(event2.event.match(/\w+ acquired/)?.[0] || "")
  ) {
    return {
      issue: "Acquisition appears to precede its announcement",
      severity: "major",
    };
  }

  // Launch should come after founding
  if (
    founderPattern.test(event1.event) &&
    launchPattern.test(event2.event) &&
    event1.date &&
    event2.date &&
    new Date(event1.date) > new Date(event2.date)
  ) {
    return {
      issue: "Product launch appears to precede company founding",
      severity: "major",
    };
  }

  return null;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  CLAIM_TYPE_PATTERNS,
  SPECULATION_INDICATORS,
  SOURCE_RELIABILITY_WEIGHTS,
  SOURCE_TYPE_WEIGHTS,
};
