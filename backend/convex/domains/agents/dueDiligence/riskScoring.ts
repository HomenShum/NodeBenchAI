/**
 * riskScoring.ts
 *
 * Risk-based DD tier selection system (v3).
 *
 * KEY INSIGHT: Deal size alone is NOT a reliable proxy for diligence depth.
 * Lower-funding companies often have HIGHER information asymmetry and risk.
 *
 * This module implements:
 * 1. Risk signal detection across multiple categories
 * 2. Risk score calculation (0-100)
 * 3. Escalation triggers (hard-fail conditions that force tier upgrade)
 * 4. Risk-based tier selection that can override funding-based defaults
 *
 * Based on:
 * - FATF risk-based approach (fatf-gafi.org)
 * - SEC Investor Protection guidance (investor.gov)
 * - BEC pattern recognition (FBI IC3 reports)
 */

import {
  DDTier,
  DDRiskCategory,
  DDRiskSignal,
  DDRiskScore,
  EscalationTrigger,
  ESCALATION_TRIGGERS,
  DD_RISK_THRESHOLDS,
  DD_TIER_THRESHOLDS,
  MICRO_BRANCHES,
  MicroBranchType,
  SECTOR_BRANCH_PACKS,
  RISK_BASED_BRANCHES,
} from "./types";

// ============================================================================
// RISK SIGNAL WEIGHTS
// ============================================================================

/**
 * Severity multipliers for risk calculation
 */
const SEVERITY_WEIGHTS = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

/**
 * Category base weights (some categories are inherently higher risk)
 */
const CATEGORY_WEIGHTS: Record<DDRiskCategory, number> = {
  identity_provenance: 15,      // High - identity fraud is fundamental
  claims_verification: 12,      // High - unverified claims are common fraud vector
  transaction_integrity: 18,    // Highest - direct financial risk (BEC)
  sector_regulatory: 10,        // Medium - compliance surface varies
  entity_authenticity: 14,      // High - shell company / fraud indicators
  document_consistency: 8,      // Lower - inconsistencies may be innocent
};

// ============================================================================
// RISK SIGNAL DETECTION
// ============================================================================

export interface RiskAssessmentInput {
  // Entity info
  companyName: string;
  websiteUrl?: string;
  domainAge?: number;          // days since domain registration
  whoisPrivate?: boolean;

  // Founder/team info
  founders?: Array<{
    name: string;
    linkedinUrl?: string;
    bio?: string;
    titleVariations?: string[];   // Inconsistent titles across sources
    employmentGaps?: number;      // Years of unexplained gaps
  }>;

  // Claims from deck/materials
  claims?: Array<{
    claim: string;
    hasSourceUrl?: boolean;
    sourceReliability?: "high" | "medium" | "low";
    isExtraordinary?: boolean;   // e.g., "FDA approved", "$10M ARR", "Fortune 500 customer"
  }>;

  // Funding info
  amountUsd?: number;
  roundType?: string;

  // Sector
  sectors?: string[];

  // Source/channel info
  sourceUrl?: string;
  emailDomain?: string;
  hasUrgencyLanguage?: boolean;  // "Act now", "Limited time", etc.
  paymentInstructionChanges?: boolean;

  // Entity registration
  foundInRegistry?: boolean;
  registryMatches?: number;

  // Fast verify results (if available)
  fastVerifyResult?: {
    entityFound: boolean | null; // null = inconclusive (don't penalize)
    websiteLive: boolean | null; // null = inconclusive (don't penalize)
    websiteStatus?: number;
    websiteError?: string;
    sourceCredibility: "high" | "medium" | "low" | "unknown";
  };
}

/**
 * Detect risk signals from assessment input
 */
export function detectRiskSignals(input: RiskAssessmentInput): DDRiskSignal[] {
  const signals: DDRiskSignal[] = [];
  const now = Date.now();

  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY PROVENANCE SIGNALS
  // ─────────────────────────────────────────────────────────────────────────

  if (input.founders) {
    for (const founder of input.founders) {
      // No LinkedIn presence
      if (!founder.linkedinUrl) {
        signals.push({
          category: "identity_provenance",
          severity: "medium",
          signal: `Founder "${founder.name}" has no LinkedIn profile`,
          source: "identity_check",
          detectedAt: now,
        });
      }

      // Title inconsistencies
      if (founder.titleVariations && founder.titleVariations.length > 2) {
        signals.push({
          category: "identity_provenance",
          severity: "high",
          signal: `Founder "${founder.name}" has ${founder.titleVariations.length} different titles across sources`,
          source: "cross_reference",
          detectedAt: now,
        });
      }

      // Employment gaps
      if (founder.employmentGaps && founder.employmentGaps > 3) {
        signals.push({
          category: "identity_provenance",
          severity: "low",
          signal: `Founder "${founder.name}" has ${founder.employmentGaps}+ year employment gap`,
          source: "background_check",
          detectedAt: now,
        });
      }
    }

    // No founders found at all
    if (input.founders.length === 0) {
      signals.push({
        category: "identity_provenance",
        severity: "high",
        signal: "No founders identified for company",
        source: "identity_check",
        detectedAt: now,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLAIMS VERIFICATION SIGNALS
  // ─────────────────────────────────────────────────────────────────────────

  if (input.claims) {
    const extraordinaryClaims = input.claims.filter(c => c.isExtraordinary);
    const unverifiableClaims = input.claims.filter(
      c => c.isExtraordinary && (!c.hasSourceUrl || c.sourceReliability === "low")
    );

    if (unverifiableClaims.length > 0) {
      signals.push({
        category: "claims_verification",
        severity: unverifiableClaims.length > 2 ? "critical" : "high",
        signal: `${unverifiableClaims.length} extraordinary claims without credible sources`,
        source: "claim_analysis",
        detectedAt: now,
      });
    }

    // Low source reliability overall
    const lowReliabilityClaims = input.claims.filter(c => c.sourceReliability === "low");
    if (lowReliabilityClaims.length > input.claims.length * 0.5) {
      signals.push({
        category: "claims_verification",
        severity: "medium",
        signal: "Majority of claims from low-reliability sources",
        source: "source_analysis",
        detectedAt: now,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSACTION INTEGRITY SIGNALS (BEC / Fraud patterns)
  // ─────────────────────────────────────────────────────────────────────────

  if (input.hasUrgencyLanguage) {
    signals.push({
      category: "transaction_integrity",
      severity: "high",
      signal: "Urgency language detected in communications",
      source: "content_analysis",
      detectedAt: now,
    });
  }

  if (input.paymentInstructionChanges) {
    signals.push({
      category: "transaction_integrity",
      severity: "critical",
      signal: "Payment instruction changes detected - BEC indicator",
      source: "transaction_monitoring",
      detectedAt: now,
    });
  }

  // Email domain mismatch
  if (input.emailDomain && input.websiteUrl) {
    const websiteDomain = extractDomain(input.websiteUrl);
    if (websiteDomain && input.emailDomain !== websiteDomain) {
      signals.push({
        category: "transaction_integrity",
        severity: "medium",
        signal: `Email domain (${input.emailDomain}) doesn't match website (${websiteDomain})`,
        source: "domain_check",
        detectedAt: now,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTOR REGULATORY SIGNALS
  // ─────────────────────────────────────────────────────────────────────────

  const highRiskSectors = ["fintech", "healthcare", "govtech", "crypto", "insurance"];
  if (input.sectors) {
    const matchedHighRisk = input.sectors.filter(s =>
      highRiskSectors.some(hr => s.toLowerCase().includes(hr))
    );

    if (matchedHighRisk.length > 0) {
      signals.push({
        category: "sector_regulatory",
        severity: "medium",
        signal: `High-compliance sector: ${matchedHighRisk.join(", ")}`,
        source: "sector_analysis",
        detectedAt: now,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENTITY AUTHENTICITY SIGNALS
  // ─────────────────────────────────────────────────────────────────────────

  // Domain age check
  if (input.domainAge !== undefined && input.domainAge < 90) {
    signals.push({
      category: "entity_authenticity",
      severity: input.domainAge < 30 ? "high" : "medium",
      signal: `Domain is only ${input.domainAge} days old`,
      source: "domain_check",
      detectedAt: now,
    });
  }

  // Hidden WHOIS
  if (input.whoisPrivate) {
    signals.push({
      category: "entity_authenticity",
      severity: "low",
      signal: "WHOIS information is private/hidden",
      source: "domain_check",
      detectedAt: now,
    });
  }

  // Not found in registry
  if (input.foundInRegistry === false) {
    signals.push({
      category: "entity_authenticity",
      severity: "high",
      signal: "Company not found in business registries",
      source: "registry_check",
      detectedAt: now,
    });
  }

  // Fast verify failures - only penalize on EXPLICIT failures, not inconclusive (null)
  if (input.fastVerifyResult) {
    // entityFound: only create signal on explicit false (not null/inconclusive)
    if (input.fastVerifyResult.entityFound === false) {
      signals.push({
        category: "entity_authenticity",
        severity: "high",
        signal: "Entity not found in verification search",
        source: "fast_verify",
        detectedAt: now,
      });
    }

    // websiteLive: only create signal on explicit false (DNS failure = site doesn't exist)
    // null means timeout/network issue - don't penalize
    if (input.fastVerifyResult.websiteLive === false) {
      signals.push({
        category: "entity_authenticity",
        severity: "medium",
        signal: input.fastVerifyResult.websiteError
          ? `Company website appears unreachable (${input.fastVerifyResult.websiteError})`
          : "Company website appears unreachable",
        source: "fast_verify",
        detectedAt: now,
      });
    }

    // sourceCredibility: low credibility still creates a signal
    if (input.fastVerifyResult.sourceCredibility === "low") {
      signals.push({
        category: "document_consistency",
        severity: "medium",
        signal: "Source has low credibility rating",
        source: "fast_verify",
        detectedAt: now,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENT CONSISTENCY SIGNALS
  // ─────────────────────────────────────────────────────────────────────────

  // (These would typically come from deck/document analysis)
  // Placeholder for future implementation

  return signals;
}

// ============================================================================
// RISK SCORE CALCULATION
// ============================================================================

/**
 * Calculate overall risk score (0-100) from signals
 */
export function calculateRiskScore(signals: DDRiskSignal[]): DDRiskScore {
  // Group signals by category
  const byCategory: Record<DDRiskCategory, DDRiskSignal[]> = {
    identity_provenance: [],
    claims_verification: [],
    transaction_integrity: [],
    sector_regulatory: [],
    entity_authenticity: [],
    document_consistency: [],
  };

  for (const signal of signals) {
    byCategory[signal.category].push(signal);
  }

  // Calculate per-category scores
  const breakdown: Record<DDRiskCategory, number> = {
    identity_provenance: 0,
    claims_verification: 0,
    transaction_integrity: 0,
    sector_regulatory: 0,
    entity_authenticity: 0,
    document_consistency: 0,
  };

  for (const category of Object.keys(byCategory) as DDRiskCategory[]) {
    const categorySignals = byCategory[category];
    if (categorySignals.length === 0) continue;

    // Sum weighted severities
    let categoryScore = 0;
    for (const signal of categorySignals) {
      categoryScore += SEVERITY_WEIGHTS[signal.severity] * CATEGORY_WEIGHTS[category];
    }

    // Cap at 100 per category
    breakdown[category] = Math.min(100, categoryScore);
  }

  // Calculate overall score (weighted average)
  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  let weightedSum = 0;

  for (const category of Object.keys(breakdown) as DDRiskCategory[]) {
    weightedSum += breakdown[category] * (CATEGORY_WEIGHTS[category] / totalWeight);
  }

  const overall = Math.round(weightedSum);

  // Check for escalation triggers
  const escalationTriggers = detectEscalationTriggers(signals);

  // Determine recommended tier based on risk
  let recommendedTier: DDTier;
  let tierOverride = false;

  if (escalationTriggers.length > 0) {
    // Any escalation trigger forces FULL_PLAYBOOK
    recommendedTier = "FULL_PLAYBOOK";
    tierOverride = true;
  } else if (overall >= DD_RISK_THRESHOLDS.FULL_PLAYBOOK.min) {
    recommendedTier = "FULL_PLAYBOOK";
  } else if (overall >= DD_RISK_THRESHOLDS.STANDARD_DD.min) {
    recommendedTier = "STANDARD_DD";
  } else if (overall >= DD_RISK_THRESHOLDS.LIGHT_DD.min) {
    recommendedTier = "LIGHT_DD";
  } else {
    recommendedTier = "FAST_VERIFY";
  }

  return {
    overall,
    breakdown,
    signals,
    escalationTriggers,
    recommendedTier,
    tierOverride,
  };
}

/**
 * Detect hard-fail escalation triggers from signals
 */
function detectEscalationTriggers(signals: DDRiskSignal[]): string[] {
  const triggers: string[] = [];

  // Check for critical signals that map to escalation triggers
  for (const signal of signals) {
    if (signal.severity === "critical") {
      // Payment/BEC indicators
      if (signal.category === "transaction_integrity" &&
          signal.signal.toLowerCase().includes("payment")) {
        triggers.push(ESCALATION_TRIGGERS.PAYMENT_ANOMALY);
      }

      // Extraordinary claims without sources
      if (signal.category === "claims_verification" &&
          signal.signal.includes("extraordinary")) {
        triggers.push(ESCALATION_TRIGGERS.EXTRAORDINARY_CLAIMS);
      }
    }

    // Identity mismatch
    if (signal.category === "identity_provenance" &&
        signal.severity === "high" &&
        signal.signal.includes("different titles")) {
      triggers.push(ESCALATION_TRIGGERS.IDENTITY_MISMATCH);
    }

    // Entity not found
    if (signal.category === "entity_authenticity" &&
        signal.signal.includes("not found in business registries")) {
      triggers.push(ESCALATION_TRIGGERS.ENTITY_NOT_FOUND);
    }

    // Domain spoofing pattern
    if (signal.category === "entity_authenticity" &&
        signal.signal.includes("Domain is only") &&
        signals.some(s => s.signal.includes("WHOIS"))) {
      triggers.push(ESCALATION_TRIGGERS.DOMAIN_SPOOFING);
    }
  }

  // Deduplicate
  return [...new Set(triggers)];
}

// ============================================================================
// TIER SELECTION (Risk-Aware)
// ============================================================================

/**
 * Select DD tier based on BOTH funding amount AND risk assessment
 *
 * The key insight: small deals with high risk should get MORE scrutiny,
 * not less. A $500K seed round with identity issues is higher risk than
 * a $50M Series B from known institutional investors.
 */
export function selectDDTierWithRisk(
  amountUsd: number | null | undefined,
  roundType: string,
  riskScore?: DDRiskScore
): {
  tier: DDTier;
  fundingBasedTier: DDTier;
  riskBasedTier: DDTier | null;
  wasOverridden: boolean;
  reason: string;
  microBranches: MicroBranchType[];
} {
  const amount = amountUsd ?? 0;
  const round = roundType?.toLowerCase() ?? "unknown";

  // Step 1: Determine funding-based tier (original logic)
  let fundingBasedTier: DDTier;

  if (
    amount >= DD_TIER_THRESHOLDS.FULL_PLAYBOOK.minAmountUsd ||
    DD_TIER_THRESHOLDS.FULL_PLAYBOOK.roundTypes.includes(round)
  ) {
    fundingBasedTier = "FULL_PLAYBOOK";
  } else if (
    amount >= DD_TIER_THRESHOLDS.STANDARD_DD.minAmountUsd ||
    DD_TIER_THRESHOLDS.STANDARD_DD.roundTypes.includes(round)
  ) {
    fundingBasedTier = "STANDARD_DD";
  } else if (
    amount >= DD_TIER_THRESHOLDS.LIGHT_DD.minAmountUsd ||
    DD_TIER_THRESHOLDS.LIGHT_DD.roundTypes.includes(round)
  ) {
    fundingBasedTier = "LIGHT_DD";
  } else {
    fundingBasedTier = "FAST_VERIFY";
  }

  // Step 2: If no risk score, use funding-based tier
  if (!riskScore) {
    return {
      tier: fundingBasedTier,
      fundingBasedTier,
      riskBasedTier: null,
      wasOverridden: false,
      reason: `Funding-based tier: $${(amount / 1_000_000).toFixed(1)}M ${roundType}`,
      microBranches: RISK_BASED_BRANCHES[fundingBasedTier],
    };
  }

  // Step 3: Compare risk-based tier with funding-based tier
  const riskBasedTier = riskScore.recommendedTier;

  // Always use the HIGHER (more thorough) tier
  const tierRanking: DDTier[] = ["FAST_VERIFY", "LIGHT_DD", "STANDARD_DD", "FULL_PLAYBOOK"];
  const fundingRank = tierRanking.indexOf(fundingBasedTier);
  const riskRank = tierRanking.indexOf(riskBasedTier);

  const finalTier = riskRank > fundingRank ? riskBasedTier : fundingBasedTier;
  const wasOverridden = riskRank > fundingRank;

  // Build reason
  let reason: string;
  if (wasOverridden) {
    reason = `Risk override: score ${riskScore.overall}/100`;
    if (riskScore.escalationTriggers.length > 0) {
      reason += ` + ${riskScore.escalationTriggers.length} escalation trigger(s)`;
    }
  } else {
    reason = `Funding-based tier: $${(amount / 1_000_000).toFixed(1)}M ${roundType}`;
    if (riskScore.overall > 30) {
      reason += ` (risk score: ${riskScore.overall})`;
    }
  }

  return {
    tier: finalTier,
    fundingBasedTier,
    riskBasedTier,
    wasOverridden,
    reason,
    microBranches: RISK_BASED_BRANCHES[finalTier],
  };
}

/**
 * Get sector-specific micro-branches to add
 */
export function getSectorBranches(sectors: string[]): MicroBranchType[] {
  const branches: Set<MicroBranchType> = new Set();

  for (const sector of sectors) {
    const sectorKey = sector.toLowerCase().replace(/[^a-z]/g, "_");
    const pack = SECTOR_BRANCH_PACKS[sectorKey];
    if (pack) {
      for (const branch of pack) {
        branches.add(branch);
      }
    }
  }

  return [...branches];
}

// ============================================================================
// UTILITIES
// ============================================================================

function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

/**
 * Format risk score for display
 */
export function formatRiskScore(score: DDRiskScore): string {
  const lines: string[] = [];

  lines.push(`Risk Score: ${score.overall}/100`);
  lines.push(`Recommended Tier: ${score.recommendedTier}`);

  if (score.tierOverride) {
    lines.push(`⚠️ Tier Override: YES`);
  }

  if (score.escalationTriggers.length > 0) {
    lines.push(`🚨 Escalation Triggers:`);
    for (const trigger of score.escalationTriggers) {
      lines.push(`  - ${trigger}`);
    }
  }

  // Category breakdown
  lines.push(`\nCategory Breakdown:`);
  for (const [category, value] of Object.entries(score.breakdown)) {
    if (value > 0) {
      lines.push(`  ${category}: ${value}`);
    }
  }

  // Signals
  if (score.signals.length > 0) {
    lines.push(`\nSignals (${score.signals.length}):`);
    for (const signal of score.signals.slice(0, 10)) {
      lines.push(`  [${signal.severity}] ${signal.signal}`);
    }
    if (score.signals.length > 10) {
      lines.push(`  ... and ${score.signals.length - 10} more`);
    }
  }

  return lines.join("\n");
}
