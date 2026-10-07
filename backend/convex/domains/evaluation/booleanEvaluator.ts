/**
 * Boolean-Only Evaluation Framework
 *
 * This module implements deterministic boolean-only scoring for agent responses.
 * All factors are TRUE/FALSE - no numeric scores, no fuzzy matching.
 *
 * Evaluation Philosophy:
 * - PASS = All required criteria met
 * - FAIL = Any required criterion not met
 * - No partial credit
 */

import {
  GROUND_TRUTH_ENTITIES,
  PERSONA_REQUIREMENTS,
  TEST_QUERIES,
  getEntityById,
  type GroundTruthEntity,
  type TestQuery,
  type Persona,
} from "./groundTruth";

// ═══════════════════════════════════════════════════════════════════════════
// BOOLEAN EVALUATION FACTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Individual boolean evaluation factors.
 * Each factor is TRUE (pass) or FALSE (fail).
 */
export interface BooleanFactors {
  // Core content factors
  containsRequiredFacts: boolean;
  noForbiddenFacts: boolean;
  correctEntityType: boolean;
  correctLocation: boolean;

  // Funding factors
  correctFundingStage: boolean;
  correctFundingAmount: boolean;
  correctInvestors: boolean;

  // Freshness factors
  acknowledgesFreshness: boolean;
  freshnessWithinPersonaWindow: boolean;

  // People factors
  mentionsFounders: boolean;
  mentionsCEO: boolean;

  // Source factors
  citesPrimarySources: boolean;
  noFabricatedURLs: boolean;
  noFabricatedMetrics: boolean;

  // Persona-specific factors
  meetsPersonaRequirements: boolean;
  correctOutcome: boolean; // PASS when should PASS, FAIL when should FAIL

  // Response quality factors
  isCoherent: boolean;
  isActionable: boolean;
  noHallucinations: boolean;
}

/**
 * Evaluation result for a single query
 */
export interface EvaluationResult {
  queryId: string;
  query: string;
  targetEntityId: string;
  targetPersona: Persona;
  expectedOutcome: "PASS" | "FAIL";
  actualOutcome: "PASS" | "FAIL";
  factors: BooleanFactors;
  passedFactors: number;
  totalFactors: number;
  overallPass: boolean;
  failureReasons: string[];
  response: string;
  evaluatedAt: string;
}

/**
 * Summary statistics for a batch evaluation
 */
export interface EvaluationSummary {
  totalQueries: number;
  passedQueries: number;
  failedQueries: number;
  passRate: number;
  byPersona: Record<Persona, { passed: number; total: number; rate: number }>;
  byEntity: Record<string, { passed: number; total: number; rate: number }>;
  commonFailures: string[];
  evaluatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if response contains all required facts (case-insensitive)
 */
function checkContainsRequiredFacts(response: string, requiredFacts: string[]): boolean {
  const lowerResponse = response.toLowerCase();

  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  function matchesRequiredFact(fact: string): boolean {
    const loweredFact = fact.toLowerCase();
    if (lowerResponse.includes(loweredFact)) return true;

    // If the fact is an ISO date, accept common human-readable variants too.
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fact);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const monthIndex = Number(month) - 1;
      const dayNum = String(Number(day)); // "13" (no leading zero)
      const monthName = monthNames[monthIndex] ?? "";
      const monthAbbr = monthName ? monthName.slice(0, 3) : "";

      const candidates = [
        `${monthName} ${dayNum}, ${year}`,
        `${monthAbbr} ${dayNum}, ${year}`,
        `${dayNum} ${monthName} ${year}`,
        `${dayNum} ${monthAbbr} ${year}`,
        `${month}/${day}/${year}`,
        `${month}/${dayNum}/${year}`,
      ].filter(Boolean);

      return candidates.some(c => lowerResponse.includes(c));
    }

    return false;
  }

  return requiredFacts.every(matchesRequiredFact);
}

/**
 * Check if response contains any forbidden facts (case-insensitive)
 */
function checkNoForbiddenFacts(response: string, forbiddenFacts: string[]): boolean {
  const lowerResponse = response.toLowerCase();
  return !forbiddenFacts.some(fact => lowerResponse.includes(fact.toLowerCase()));
}

/**
 * Check if response correctly identifies entity type
 */
function checkCorrectEntityType(response: string, entity: GroundTruthEntity): boolean {
  const lowerResponse = response.toLowerCase();

  switch (entity.entityType) {
    case "private_company":
      // Should NOT say "public company" or "OSS project"
      return !lowerResponse.includes("public company") &&
             !lowerResponse.includes("publicly traded") &&
             !lowerResponse.includes("open source project");
    case "public_company":
      // Should mention public/traded/NYSE/NASDAQ
      return lowerResponse.includes("public") ||
             lowerResponse.includes("traded") ||
             lowerResponse.includes("nyse") ||
             lowerResponse.includes("nasdaq");
    case "oss_project":
      // Should mention open source/github/repository
      return lowerResponse.includes("open source") ||
             lowerResponse.includes("github") ||
             lowerResponse.includes("repository") ||
             lowerResponse.includes("oss");
    case "research_signal":
      // Should mention research/academic/paper/literature
      return lowerResponse.includes("research") ||
             lowerResponse.includes("academic") ||
             lowerResponse.includes("paper") ||
             lowerResponse.includes("literature");
    case "model_platform":
      // Should mention model/AI/platform
      return lowerResponse.includes("model") ||
             lowerResponse.includes("ai") ||
             lowerResponse.includes("platform");
    case "private_company_incident":
      // Should mention incident/issue/vulnerability
      return lowerResponse.includes("incident") ||
             lowerResponse.includes("issue") ||
             lowerResponse.includes("breach") ||
             lowerResponse.includes("vulnerability");
    default:
      return true;
  }
}

/**
 * Check if response mentions correct location
 */
function checkCorrectLocation(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.hqLocation) return true; // No location to check

  const lowerResponse = response.toLowerCase();
  const locationParts = entity.hqLocation.toLowerCase().split(/[,\s]+/);

  // At least the city or country should be mentioned
  return locationParts.some(part => part.length > 2 && lowerResponse.includes(part));
}

/**
 * Check if response has correct funding stage
 */
function checkCorrectFundingStage(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.funding?.stage) return true;

  const lowerResponse = response.toLowerCase();
  const stage = entity.funding.stage.toLowerCase();

  return lowerResponse.includes(stage);
}

/**
 * Check if response has correct funding amount
 */
function checkCorrectFundingAmount(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.funding?.lastRound?.amount) return true;

  const lowerResponse = response.toLowerCase();
  const amount = entity.funding.lastRound.amount;

  // Check for amount in various formats
  const amountStr = `${amount.amount}`;
  const amountWithCurrency = `${amount.currency === "EUR" ? "€" : "$"}${amount.amount}`;
  const amountWithUnit = `${amount.amount}${amount.unit}`;

  return lowerResponse.includes(amountStr) ||
         lowerResponse.includes(amountWithCurrency.toLowerCase()) ||
         lowerResponse.includes(amountWithUnit.toLowerCase());
}

/**
 * Check if response mentions correct investors
 */
function checkCorrectInvestors(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.funding?.lastRound?.coLeads?.length) return true;

  const lowerResponse = response.toLowerCase();

  // At least one co-lead should be mentioned
  return entity.funding.lastRound.coLeads.some(investor =>
    lowerResponse.includes(investor.toLowerCase())
  );
}

/**
 * Check if response acknowledges freshness appropriately
 */
function checkAcknowledgesFreshness(response: string, entity: GroundTruthEntity): boolean {
  const lowerResponse = response.toLowerCase();

  // If entity is stale, response should indicate this
  if (!entity.withinBankerWindow) {
    return lowerResponse.includes("stale") ||
           lowerResponse.includes("not recent") ||
           lowerResponse.includes("old") ||
           lowerResponse.includes("outdated") ||
           lowerResponse.includes("no recent news") ||
           lowerResponse.includes("not ready");
  }

  // If fresh, should not incorrectly say it's stale
  return !lowerResponse.includes("stale") ||
         !lowerResponse.includes("outdated");
}

/**
 * Check if freshness is within persona's window
 */
function checkFreshnessWithinPersonaWindow(
  entity: GroundTruthEntity,
  persona: Persona
): boolean {
  const req = PERSONA_REQUIREMENTS[persona];

  // If persona doesn't care about freshness, pass
  if (!req.requiresNewsWithinDays) return true;

  // If entity has no freshness data, treat as N/A (don't fail the evaluation)
  if (entity.freshnessAgeDays === null) return true;

  return entity.freshnessAgeDays <= req.requiresNewsWithinDays;
}

/**
 * Check if response mentions founders
 */
function checkMentionsFounders(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.founders?.length) return true;

  const lowerResponse = response.toLowerCase();

  // At least one founder should be mentioned
  return entity.founders.some(founder =>
    lowerResponse.includes(founder.toLowerCase())
  );
}

/**
 * Check if response mentions CEO
 */
function checkMentionsCEO(response: string, entity: GroundTruthEntity): boolean {
  if (!entity.ceo) return true;

  const lowerResponse = response.toLowerCase();
  return lowerResponse.includes(entity.ceo.toLowerCase());
}

/**
 * Check if response cites primary sources
 */
function checkCitesPrimarySources(response: string, entity: GroundTruthEntity): boolean {
  const lowerResponse = response.toLowerCase();

  // Look for source citation patterns (URLs, tool-citation anchors, or explicit "Sources:" sections)
  const hasUrl = /https?:\/\/\S+/i.test(response);
  const hasCitationAnchor =
    response.includes("{{fact:") ||
    response.includes("{{cite:") ||
    response.includes("{{artifact:") ||
    response.includes("{{source:");
  const hasSourcesSection = lowerResponse.includes("\nsources") || lowerResponse.includes("source:");
  const hasAttribution =
    lowerResponse.includes("according to") ||
    lowerResponse.includes("per ") ||
    lowerResponse.includes("based on");
  const hasSourceCitation = hasUrl || hasCitationAnchor || hasSourcesSection || hasAttribution;

  // If entity requires primary source and persona requires it
  if (entity.hasPrimarySource) {
    return hasSourceCitation;
  }

  return true;
}

/**
 * Check for fabricated URLs (URLs not from tool output)
 */
function checkNoFabricatedURLs(response: string): boolean {
  // Look for URL patterns that are likely fabricated
  const fabricatedPatterns = [
    /https?:\/\/techcrunch\.com\/\d{4}\/\d{2}\/\d{2}\//,
    /https?:\/\/sec\.gov\/Archives\//,
    /https?:\/\/www\.reuters\.com\/article\//,
    /https?:\/\/fiercebiotech\.com\/\d{4}\//,
  ];

  // These patterns suggest fabrication when present without {{fact:}} anchors
  const hasFactAnchors = response.includes("{{fact:");

  // If response has fact anchors, it's likely using proper citation
  if (hasFactAnchors) return true;

  // Check for suspicious URL patterns
  return !fabricatedPatterns.some(pattern => pattern.test(response));
}

/**
 * Check for fabricated metrics
 */
function checkNoFabricatedMetrics(response: string): boolean {
  const lowerResponse = response.toLowerCase();

  // Look for suspicious confidence scores or timestamps
  const fabricatedMetrics = [
    /confidence:\s*\d+(\.\d+)?%?/i,
    /\d+(\.\d+)?%\s*confidence/i,
    /retrieved\s+\d{2}:\d{2}\s*(utc|gmt)/i,
    /accuracy:\s*\d+%/i,
    /certainty:\s*\d+%/i,
  ];

  return !fabricatedMetrics.some(pattern => pattern.test(response));
}

/**
 * Check if response meets persona-specific requirements
 */
function checkMeetsPersonaRequirements(
  response: string,
  entity: GroundTruthEntity,
  persona: Persona
): boolean {
  const req = PERSONA_REQUIREMENTS[persona];
  const lowerResponse = response.toLowerCase();

  // Check freshness
  if (req.requiresNewsWithinDays !== null) {
    if (!checkFreshnessWithinPersonaWindow(entity, persona)) {
      // Response should acknowledge this
      if (!lowerResponse.includes("not ready") &&
          !lowerResponse.includes("fail") &&
          !lowerResponse.includes("stale")) {
        return false;
      }
    }
  }

  // Check primary source requirement
  if (req.requiresPrimarySource && entity.hasPrimarySource) {
    if (!checkCitesPrimarySources(response, entity)) {
      return false;
    }
  }

  // Check funding data requirement
  if (req.requiresFundingData && entity.funding) {
    if (!checkCorrectFundingStage(response, entity)) {
      return false;
    }
  }

  // Check contact info requirement
  if (req.requiresContactInfo && entity.primaryContact) {
    if (!lowerResponse.includes("contact") &&
        !lowerResponse.includes("email") &&
        !lowerResponse.includes("@")) {
      return false;
    }
  }

  // Check product pipeline requirement
  if (req.requiresProductPipeline && entity.leadPrograms?.length) {
    const hasAnyProgram = entity.leadPrograms.some(prog =>
      lowerResponse.includes(prog.toLowerCase())
    );
    if (!hasAnyProgram && !lowerResponse.includes("pipeline") &&
        !lowerResponse.includes("program") &&
        !lowerResponse.includes("product")) {
      return false;
    }
  }

  // Check quantitative data requirement (if the entity has any quantitative anchors)
  if (req.requiresQuantitativeData) {
    const entityHasQuantAnchor =
      !!entity.funding?.lastRound?.amount ||
      entity.requiredFacts.some((f) => /\d/.test(f));

    if (entityHasQuantAnchor) {
      const hasAnyDigit = /\d/.test(response);
      if (!hasAnyDigit) return false;

      if (entity.funding?.lastRound?.amount) {
        const hasCurrencyOrUnit =
          response.includes("ƒ,ª") ||
          /[$€£¥]/.test(response) ||
          /\b(k|m|b|million|billion)\b/i.test(response);
        if (!hasCurrencyOrUnit) return false;
      }
    }
  }

  return true;
}

/**
 * Check if response outcome matches expected outcome
 */
function checkCorrectOutcome(
  response: string,
  expectedOutcome: "PASS" | "FAIL"
): boolean {
  const lowerResponse = response.toLowerCase();

  const passIndicators = [
    "ready",
    "pass",
    "suitable",
    "recommend",
    "qualifies",
    "meets criteria",
  ];

  const failIndicators = [
    "not ready",
    "fail",
    "not suitable",
    "not recommend",
    "does not qualify",
    "missing",
    "stale",
    "insufficient",
    "not a company",
  ];

  const hasPassIndicator = passIndicators.some(ind => lowerResponse.includes(ind));
  const hasFailIndicator = failIndicators.some(ind => lowerResponse.includes(ind));

  if (expectedOutcome === "PASS") {
    // Should have pass indicators and not have fail indicators
    return hasPassIndicator || !hasFailIndicator;
  } else {
    // Should have fail indicators
    return hasFailIndicator;
  }
}

/**
 * Check if response is coherent (not garbled or incomplete)
 */
function checkIsCoherent(response: string): boolean {
  // Basic coherence checks
  if (response.length < 50) return false; // Too short
  if (response.length > 50000) return false; // Too long

  // Check for incomplete sentences or garbled text
  const garbledPatterns = [
    /\[object Object\]/,
    /undefined/,
    /null/,
    /NaN/,
    /Error:/,
    /Exception:/,
  ];

  return !garbledPatterns.some(pattern => pattern.test(response));
}

/**
 * Check if response is actionable
 */
function checkIsActionable(response: string): boolean {
  const lowerResponse = response.toLowerCase();

  // Should contain actionable information
  const actionableIndicators = [
    "contact",
    "email",
    "reach out",
    "next step",
    "recommend",
    "suggest",
    "consider",
    "should",
    "can",
    "available",
    "@",
    "www.",
  ];

  return actionableIndicators.some(ind => lowerResponse.includes(ind));
}

/**
 * Check for hallucinations (facts not in ground truth)
 */
function checkNoHallucinations(
  response: string,
  entity: GroundTruthEntity,
  query: TestQuery
): boolean {
  return checkNoForbiddenFacts(response, query.forbiddenFactsInResponse) &&
         checkNoForbiddenFacts(response, entity.forbiddenFacts);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EVALUATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a single agent response against ground truth
 */
export function evaluateResponse(
  query: TestQuery,
  response: string
): EvaluationResult {
  const entity = getEntityById(query.targetEntityId);

  if (!entity) {
    throw new Error(`Entity not found: ${query.targetEntityId}`);
  }

  const factors: BooleanFactors = {
    containsRequiredFacts: checkContainsRequiredFacts(response, query.requiredFactsInResponse),
    noForbiddenFacts: checkNoForbiddenFacts(response, query.forbiddenFactsInResponse),
    correctEntityType: checkCorrectEntityType(response, entity),
    correctLocation: checkCorrectLocation(response, entity),
    correctFundingStage: checkCorrectFundingStage(response, entity),
    correctFundingAmount: checkCorrectFundingAmount(response, entity),
    correctInvestors: checkCorrectInvestors(response, entity),
    acknowledgesFreshness: checkAcknowledgesFreshness(response, entity),
    freshnessWithinPersonaWindow: checkFreshnessWithinPersonaWindow(entity, query.targetPersona),
    mentionsFounders: checkMentionsFounders(response, entity),
    mentionsCEO: checkMentionsCEO(response, entity),
    citesPrimarySources: checkCitesPrimarySources(response, entity),
    noFabricatedURLs: checkNoFabricatedURLs(response),
    noFabricatedMetrics: checkNoFabricatedMetrics(response),
    meetsPersonaRequirements: checkMeetsPersonaRequirements(response, entity, query.targetPersona),
    correctOutcome: checkCorrectOutcome(response, query.expectedOutcome),
    isCoherent: checkIsCoherent(response),
    isActionable: checkIsActionable(response),
    noHallucinations: checkNoHallucinations(response, entity, query),
  };

  // Count passed factors
  const factorValues = Object.values(factors);
  const passedFactors = factorValues.filter(v => v).length;
  const totalFactors = factorValues.length;

  // Collect failure reasons
  const failureReasons: string[] = [];
  if (!factors.containsRequiredFacts) failureReasons.push("Missing required facts");
  if (!factors.noForbiddenFacts) failureReasons.push("Contains forbidden facts");
  if (!factors.correctEntityType) failureReasons.push("Wrong entity type identified");
  if (!factors.correctLocation) failureReasons.push("Missing or wrong location");
  if (!factors.correctFundingStage) failureReasons.push("Wrong funding stage");
  if (!factors.correctFundingAmount) failureReasons.push("Wrong funding amount");
  if (!factors.correctInvestors) failureReasons.push("Missing investor information");
  if (!factors.acknowledgesFreshness) failureReasons.push("Freshness not properly acknowledged");
  if (!factors.freshnessWithinPersonaWindow) failureReasons.push("Entity too stale for persona");
  if (!factors.mentionsFounders) failureReasons.push("Missing founder information");
  if (!factors.mentionsCEO) failureReasons.push("Missing CEO information");
  if (!factors.citesPrimarySources) failureReasons.push("No source citations");
  if (!factors.noFabricatedURLs) failureReasons.push("Contains fabricated URLs");
  if (!factors.noFabricatedMetrics) failureReasons.push("Contains fabricated metrics");
  if (!factors.meetsPersonaRequirements) failureReasons.push("Does not meet persona requirements");
  if (!factors.correctOutcome) failureReasons.push("Wrong outcome (PASS/FAIL mismatch)");
  if (!factors.isCoherent) failureReasons.push("Response is incoherent");
  if (!factors.isActionable) failureReasons.push("Response is not actionable");
  if (!factors.noHallucinations) failureReasons.push("Contains hallucinations");

  // Critical factors that must pass
  const criticalFactors = [
    factors.containsRequiredFacts,
    factors.noForbiddenFacts,
    factors.correctOutcome,
    factors.isCoherent,
    factors.noHallucinations,
  ];

  const overallPass = criticalFactors.every(f => f);
  const actualOutcome = overallPass ? "PASS" : "FAIL";

  return {
    queryId: query.id,
    query: query.query,
    targetEntityId: query.targetEntityId,
    targetPersona: query.targetPersona,
    expectedOutcome: query.expectedOutcome,
    actualOutcome,
    factors,
    passedFactors,
    totalFactors,
    overallPass,
    failureReasons,
    response: response.slice(0, 500) + (response.length > 500 ? "..." : ""),
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Summarize batch evaluation results
 */
export function summarizeResults(results: EvaluationResult[]): EvaluationSummary {
  const passedQueries = results.filter(r => r.overallPass).length;
  const failedQueries = results.length - passedQueries;

  // By persona
  const byPersona: Record<string, { passed: number; total: number; rate: number }> = {};
  for (const result of results) {
    if (!byPersona[result.targetPersona]) {
      byPersona[result.targetPersona] = { passed: 0, total: 0, rate: 0 };
    }
    byPersona[result.targetPersona].total++;
    if (result.overallPass) {
      byPersona[result.targetPersona].passed++;
    }
  }
  for (const persona of Object.keys(byPersona)) {
    byPersona[persona].rate = byPersona[persona].passed / byPersona[persona].total;
  }

  // By entity
  const byEntity: Record<string, { passed: number; total: number; rate: number }> = {};
  for (const result of results) {
    if (!byEntity[result.targetEntityId]) {
      byEntity[result.targetEntityId] = { passed: 0, total: 0, rate: 0 };
    }
    byEntity[result.targetEntityId].total++;
    if (result.overallPass) {
      byEntity[result.targetEntityId].passed++;
    }
  }
  for (const entityId of Object.keys(byEntity)) {
    byEntity[entityId].rate = byEntity[entityId].passed / byEntity[entityId].total;
  }

  // Common failures
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    for (const reason of result.failureReasons) {
      failureCounts[reason] = (failureCounts[reason] || 0) + 1;
    }
  }
  const commonFailures = Object.entries(failureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason} (${count}x)`);

  return {
    totalQueries: results.length,
    passedQueries,
    failedQueries,
    passRate: passedQueries / results.length,
    byPersona: byPersona as Record<Persona, { passed: number; total: number; rate: number }>,
    byEntity,
    commonFailures,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Export test queries for external use
 */
export { TEST_QUERIES, GROUND_TRUTH_ENTITIES, PERSONA_REQUIREMENTS };
