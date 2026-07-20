/**
 * Narrative Guards - Production-Grade Defensibility Layer
 *
 * Phase 8 implementation providing:
 * 1. Content Rights Policy Enforcement (GDPR/ToS compliance)
 * 2. Claim Classification (fact/inference/sentiment separation)
 * 3. Truth-Maintenance System (JTMS-style state management)
 * 4. Trust Scoring (reputation-based rate limiting)
 * 5. Prompt Injection Containment (detection + sanitization)
 * 6. Quarantine-to-Canon Promotion (quality gate enforcement)
 * 7. Self-Citation Guard (prevents feedback loops)
 *
 * Industry standard patterns:
 * - GDPR Article 6 (lawful basis) + Article 17 (right to erasure)
 * - CCPA Section 1798.105 (right to deletion)
 * - JTMS (Justification-based Truth Maintenance System)
 * - OWASP LLM Top 10 (injection prevention)
 *
 * @module domains/narrative/guards
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export type {
  StorageMode,
  RenderingMode,
  AIUsageMode,
  PolicyEnforcementResult,
  PolicyViolation,
  SanitizedContent,
  RequiredAction,
} from "./contentRights";

export type {
  ClaimType,
  ClassifiedSentence,
  ClassificationResult,
  PublicationGateConfig,
} from "./claimClassificationGate";

export type {
  ValidationResult,
  InvalidCitation,
} from "./selfCitationGuard";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export { DEFAULT_POLICIES } from "./contentRights";

// ═══════════════════════════════════════════════════════════════════════════
// GUARD MODULE REFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Note: Convex functions cannot be re-exported directly.
 * Import guards individually from their modules:
 *
 * Content Rights:
 *   import { getPolicyForDomain, enforceStoragePolicy, ... } from "./guards/contentRights"
 *
 * Claim Classification:
 *   import { classifyPostContent, checkPublicationEligibility } from "./guards/claimClassificationGate"
 *   import { storeClassification, getPostClassifications } from "./guards/claimClassificationGateQueries"
 *
 * Claim Classifier (pattern-based):
 *   import { classifyPostClaims, storeClaimClassifications } from "./guards/claimClassifier"
 *
 * Truth Maintenance:
 *   import { initializeTruthState, markAsContested, resolveContestation } from "./guards/truthMaintenance"
 *
 * Trust Scoring:
 *   import { initializeTrustProfile, updateTrustScore, canAuthorPost } from "./guards/trustScoring"
 *
 * Injection Containment:
 *   import { sanitizeForAgent, checkForInjections, batchSanitize } from "./guards/injectionContainment"
 *
 * Quarantine:
 *   import { quarantineContent, approveQuarantined, shouldQuarantine } from "./guards/quarantine"
 *
 * Self-Citation:
 *   import { validateCitations, checkPostAuthor } from "./guards/selfCitationGuard"
 */

// ═══════════════════════════════════════════════════════════════════════════
// GUARD ORCHESTRATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-publication checklist for narrative posts.
 * Use this to ensure all guards pass before publishing.
 *
 * @example
 * ```typescript
 * // In your publication workflow:
 * const checks = await Promise.all([
 *   ctx.runAction(internal.domains.narrative.guards.contentRights.checkAIUsageAllowed, { ... }),
 *   ctx.runAction(internal.domains.narrative.guards.claimClassificationGate.checkPublicationEligibility, { ... }),
 *   ctx.runAction(internal.domains.narrative.guards.trustScoring.canAuthorPost, { ... }),
 *   ctx.runAction(internal.domains.narrative.guards.injectionContainment.checkForInjections, { ... }),
 *   ctx.runAction(internal.domains.narrative.guards.quarantine.shouldQuarantine, { ... }),
 * ]);
 *
 * const allPassed = checks.every(c => c.allowed);
 * if (!allPassed) {
 *   // Block publication or quarantine
 * }
 * ```
 */
export const GUARD_CHECKLIST = {
  contentRights: {
    module: "guards/contentRights",
    checks: [
      "enforceStoragePolicy",
      "enforceRenderingPolicy",
      "checkAIUsageAllowed",
    ],
  },
  claimClassification: {
    module: "guards/claimClassificationGate",
    checks: [
      "classifyPostContent",
      "checkPublicationEligibility",
    ],
  },
  trustScoring: {
    module: "guards/trustScoring",
    checks: [
      "canAuthorPost",
      "checkRateLimit",
    ],
  },
  injectionContainment: {
    module: "guards/injectionContainment",
    checks: [
      "checkForInjections",
      "sanitizeForAgent",
    ],
  },
  quarantine: {
    module: "guards/quarantine",
    checks: [
      "shouldQuarantine",
      "checkPromotionEligibility",
    ],
  },
  selfCitation: {
    module: "guards/selfCitationGuard",
    checks: [
      "validateCitations",
    ],
  },
};

/**
 * Severity levels for guard violations
 */
export const VIOLATION_SEVERITY = {
  CRITICAL: "critical",   // Block immediately, alert ops
  HIGH: "high",           // Block, quarantine content
  MEDIUM: "medium",       // Allow with warning, flag for review
  LOW: "low",             // Log only, no blocking
} as const;

/**
 * Default thresholds for guard policies
 */
export const DEFAULT_THRESHOLDS = {
  // Claim classification
  minFactClaimCoverage: 0.3,           // 30% of content must be fact claims
  maxUnverifiedFactClaims: 5,

  // Trust scoring
  newAuthorPostLimit: 5,               // Posts per day for new authors
  quarantineThreshold: 0.3,            // Trust score below this = quarantined
  banThreshold: 0.1,                   // Trust score below this = banned

  // Injection detection
  highThreatBlockThreshold: 0.7,       // Block at this threat level
  criticalThreatAlertThreshold: 0.9,   // Alert ops at this level

  // Content rights
  defaultExcerptMaxChars: 500,         // Default excerpt length
  defaultTTLDays: 90,                  // Default content TTL

  // Quarantine
  minCorroborationSources: 2,          // tier3 needs this many tier1/2 sources
  maxQuarantineDays: 30,               // Auto-reject after this
} as const;

/**
 * Error codes for guard violations
 */
export const GUARD_ERROR_CODES = {
  // Content rights
  CR_STORAGE_PROHIBITED: "CR001",
  CR_RENDERING_RESTRICTED: "CR002",
  CR_AI_USAGE_BLOCKED: "CR003",
  CR_TTL_EXPIRED: "CR004",

  // Claim classification
  CC_LOW_FACT_COVERAGE: "CC001",
  CC_UNVERIFIED_FACTS: "CC002",
  CC_CONTESTED_WITHOUT_CONTEXT: "CC003",

  // Trust scoring
  TS_RATE_LIMITED: "TS001",
  TS_QUARANTINED_AUTHOR: "TS002",
  TS_BANNED_AUTHOR: "TS003",
  TS_NEW_AUTHOR_LIMIT: "TS004",

  // Injection
  INJ_CRITICAL_THREAT: "INJ001",
  INJ_HIGH_THREAT: "INJ002",
  INJ_MEDIUM_THREAT: "INJ003",

  // Quarantine
  QR_NEEDS_CORROBORATION: "QR001",
  QR_FAILED_REVIEW: "QR002",
  QR_TTL_EXCEEDED: "QR003",

  // Self-citation
  SC_SELF_CITATION: "SC001",
  SC_INTERNAL_CONTENT: "SC002",
  SC_MISSING_SOURCE: "SC003",
} as const;
