/**
 * Enhanced Claim Verification Branch
 *
 * Implements deep agent best practices from:
 * - Anthropic: Multi-step reasoning with reflection
 * - OpenAI Deep Research: Source triangulation
 * - Manus: OODA loop for iterative refinement
 * - Industry: Confidence calibration based on evidence strength
 */

import { api } from "../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../types";
import { ClaimVerificationFindings, VerifiedClaim, ClaimConfidence } from "../types";

// =============================================================================
// TYPES
// =============================================================================

type InternalReliability = "authoritative" | "reputable" | "unknown";

interface ExtractedClaim {
  claim: string;
  searchQuery: string;
  category: "person" | "company" | "event" | "technical" | "financial" | "strategic";
  speculationLevel?: "none" | "low" | "moderate" | "high";
}

interface SourceEvidence {
  source: DDSource;
  snippet: string;
  relevanceScore: number;
  sentiment: "supporting" | "contradicting" | "neutral";
}

interface TriangulationResult {
  claim: string;
  sources: SourceEvidence[];
  triangulationScore: number;
  independentSourceCount: number;
  consensusLevel: "strong" | "moderate" | "weak" | "none" | "conflicting";
}

interface ReflectionResult {
  originalVerdict: string;
  challenges: string[];
  counterArguments: string[];
  finalVerdict: string;
  confidenceAdjustment: number;
}

interface OODAState {
  observe: string[];
  orient: string;
  decide: string;
  act: string;
  iteration: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SOURCE_TIERS: Record<string, { tier: 1 | 2 | 3; weight: number }> = {
  // Tier 1: Authoritative government/official sources
  "sec.gov": { tier: 1, weight: 1.0 },
  "fda.gov": { tier: 1, weight: 1.0 },
  "uspto.gov": { tier: 1, weight: 1.0 },
  "finra.org": { tier: 1, weight: 0.95 },
  "delaware.gov": { tier: 1, weight: 0.95 },

  // Tier 1: Major wire services
  "reuters.com": { tier: 1, weight: 0.95 },
  "apnews.com": { tier: 1, weight: 0.95 },
  "bloomberg.com": { tier: 1, weight: 0.9 },

  // Tier 2: Established news outlets
  "wsj.com": { tier: 2, weight: 0.85 },
  "nytimes.com": { tier: 2, weight: 0.85 },
  "businessinsider.com": { tier: 2, weight: 0.8 },
  "theverge.com": { tier: 2, weight: 0.8 },
  "techcrunch.com": { tier: 2, weight: 0.8 },
  "venturebeat.com": { tier: 2, weight: 0.8 },
  "wired.com": { tier: 2, weight: 0.8 },
  "forbes.com": { tier: 2, weight: 0.75 },

  // Tier 3: Professional/industry sources
  "linkedin.com": { tier: 3, weight: 0.7 },
  "crunchbase.com": { tier: 3, weight: 0.7 },
  "wikipedia.org": { tier: 3, weight: 0.6 },
  "medium.com": { tier: 3, weight: 0.5 },
  "substack.com": { tier: 3, weight: 0.5 },
};

const TRIANGULATION_THRESHOLDS = {
  strongConsensus: 0.8,    // 3+ independent tier 1-2 sources agreeing
  moderateConsensus: 0.6,  // 2+ sources agreeing
  weakConsensus: 0.4,      // 1 tier 1-2 source
  conflicting: 0.3,        // Mixed signals
};

// =============================================================================
// MAIN ENHANCED VERIFICATION FUNCTION
// =============================================================================

export async function executeEnhancedClaimVerification(
  ctx: any,
  claims: ExtractedClaim[],
  options: {
    enableReflection?: boolean;
    enableTriangulation?: boolean;
    maxIterations?: number;
    requireMultipleSources?: boolean;
  } = {}
): Promise<{
  findings: ClaimVerificationFindings;
  sources: DDSource[];
  confidence: number;
  methodology: string[];
}> {
  const {
    enableReflection = true,
    enableTriangulation = true,
    maxIterations = 2,
    requireMultipleSources = true,
  } = options;

  const allSources: DDSource[] = [];
  const verifiedClaims: VerifiedClaim[] = [];
  const unverifiedClaims: VerifiedClaim[] = [];
  const contradictedClaims: VerifiedClaim[] = [];
  const methodology: string[] = [];

  methodology.push("Phase 1: Initial claim extraction and categorization");

  // Phase 1: Parallel initial search for all claims
  const searchPromises = claims.map(claim => executeOODAVerification(ctx, claim, maxIterations));
  const searchResults = await Promise.all(searchPromises);

  methodology.push(`Phase 2: OODA-based verification for ${claims.length} claims`);

  // Phase 2: Triangulation - cross-verify claims against multiple sources
  let triangulationResults: TriangulationResult[] = [];
  if (enableTriangulation) {
    methodology.push("Phase 3: Source triangulation across independent outlets");
    triangulationResults = await Promise.all(
      searchResults.map((result, idx) =>
        triangulateEvidence(claims[idx].claim, result.sources)
      )
    );
  }

  // Phase 3: Reflection - challenge initial verdicts
  let reflectionResults: ReflectionResult[] = [];
  if (enableReflection) {
    methodology.push("Phase 4: Critical reflection and counter-argument analysis");
    reflectionResults = await Promise.all(
      searchResults.map((result, idx) =>
        reflectOnVerdict(
          claims[idx],
          result,
          triangulationResults[idx]
        )
      )
    );
  }

  // Phase 4: Final verdict synthesis
  methodology.push("Phase 5: Final verdict synthesis with calibrated confidence");

  for (let i = 0; i < claims.length; i++) {
    const searchResult = searchResults[i];
    const triangulation = triangulationResults[i];
    const reflection = reflectionResults[i];

    const finalResult = synthesizeFinalVerdict(
      claims[i],
      searchResult,
      triangulation,
      reflection,
      { requireMultipleSources }
    );

    allSources.push(...searchResult.sources);

    if (finalResult.status === "verified" || finalResult.status === "partially_verified") {
      verifiedClaims.push(finalResult);
    } else if (finalResult.status === "contradicted") {
      contradictedClaims.push(finalResult);
    } else {
      unverifiedClaims.push(finalResult);
    }
  }

  // Calculate overall confidence with calibration
  const overallConfidence = calculateCalibratedConfidence(
    verifiedClaims,
    unverifiedClaims,
    contradictedClaims,
    triangulationResults
  );

  return {
    findings: {
      verifiedClaims,
      unverifiedClaims,
      contradictedClaims,
      overallAssessment: generateEnhancedAssessment(
        verifiedClaims,
        unverifiedClaims,
        contradictedClaims,
        methodology
      ),
      confidenceScore: overallConfidence,
    },
    sources: deduplicateSources(allSources),
    confidence: overallConfidence,
    methodology,
  };
}

// =============================================================================
// OODA LOOP VERIFICATION (Manus Pattern)
// =============================================================================

async function executeOODAVerification(
  ctx: any,
  claim: ExtractedClaim,
  maxIterations: number
): Promise<{
  claim: VerifiedClaim;
  sources: DDSource[];
  oodaStates: OODAState[];
}> {
  const sources: DDSource[] = [];
  const oodaStates: OODAState[] = [];
  let currentEvidence: SourceEvidence[] = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    // OBSERVE: Gather evidence
    const searchQuery = iteration === 0
      ? claim.searchQuery
      : refineSearchQuery(claim, currentEvidence, iteration);

    const observe: string[] = [];

    try {
      const result = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: iteration === 0 ? "balanced" : "precision",
          maxTotal: iteration === 0 ? 8 : 5,
          skipRateLimit: true,
        }
      );

      const searchResults = result?.payload?.results ?? [];

      for (const r of searchResults) {
        const snippet = r.snippet || r.content || "";
        const url = r.url || "";
        const title = r.title || "Unknown";

        observe.push(`[${getSourceTier(url)}] ${title}: ${snippet.slice(0, 150)}`);

        const reliability = getSourceReliability(url);
        const source: DDSource = {
          sourceType: "news_article",
          title,
          url,
          accessedAt: Date.now(),
          reliability,
        };
        sources.push(source);

        currentEvidence.push({
          source,
          snippet,
          relevanceScore: calculateRelevanceScore(claim.claim, snippet),
          sentiment: analyzeSentiment(claim.claim, snippet),
        });
      }
    } catch (error) {
      observe.push(`Search error: ${error}`);
    }

    // ORIENT: Analyze the evidence landscape
    const supportingCount = currentEvidence.filter(e => e.sentiment === "supporting").length;
    const contradictingCount = currentEvidence.filter(e => e.sentiment === "contradicting").length;
    const totalRelevant = currentEvidence.filter(e => e.relevanceScore > 0.5).length;

    const orient = `Found ${currentEvidence.length} sources: ${supportingCount} supporting, ` +
      `${contradictingCount} contradicting, ${totalRelevant} highly relevant. ` +
      `Avg relevance: ${(currentEvidence.reduce((sum, e) => sum + e.relevanceScore, 0) / Math.max(currentEvidence.length, 1)).toFixed(2)}`;

    // DECIDE: Determine if more evidence is needed
    const hasStrongConsensus = supportingCount >= 3 || contradictingCount >= 3;
    const hasConflict = supportingCount > 0 && contradictingCount > 0;
    const needsMoreEvidence = !hasStrongConsensus && iteration < maxIterations - 1;

    const decide = hasStrongConsensus
      ? `Strong consensus reached (${supportingCount > contradictingCount ? "supporting" : "contradicting"})`
      : hasConflict
      ? `Conflicting evidence detected, ${needsMoreEvidence ? "gathering more" : "proceeding with synthesis"}`
      : needsMoreEvidence
      ? "Insufficient evidence, refining search"
      : "Proceeding with available evidence";

    // ACT: Take action based on decision
    const act = needsMoreEvidence ? "Refining search query for next iteration" : "Synthesizing final verdict";

    oodaStates.push({
      observe,
      orient,
      decide,
      act,
      iteration,
    });

    if (!needsMoreEvidence) break;
    iteration++;
  }

  // Final verdict based on OODA analysis
  const { status, confidence } = determineOODAVerdict(currentEvidence);

  return {
    claim: {
      claim: claim.claim,
      confidence,
      status,
      evidence: currentEvidence.map(e => e.snippet.slice(0, 200)),
      sources: currentEvidence.map(e => ({
        title: e.source.title || "Unknown Source",
        url: e.source.url || "",
        reliability: mapToClaimReliability(e.source.reliability),
      })),
    },
    sources,
    oodaStates,
  };
}

// =============================================================================
// SOURCE TRIANGULATION (OpenAI Deep Research Pattern)
// =============================================================================

async function triangulateEvidence(
  claim: string,
  sources: DDSource[]
): Promise<TriangulationResult> {
  const sourcesByDomain = new Map<string, DDSource[]>();

  // Group sources by domain (for independence check)
  for (const source of sources) {
    if (!source.url) continue;
    const domain = extractDomain(source.url);
    if (!sourcesByDomain.has(domain)) {
      sourcesByDomain.set(domain, []);
    }
    sourcesByDomain.get(domain)!.push(source);
  }

  const independentSourceCount = sourcesByDomain.size;

  // Calculate triangulation score based on source diversity and tier
  let triangulationScore = 0;
  let tier1Count = 0;
  let tier2Count = 0;

  for (const [domain, domainSources] of sourcesByDomain) {
    const tierInfo = SOURCE_TIERS[domain];
    if (tierInfo) {
      triangulationScore += tierInfo.weight;
      if (tierInfo.tier === 1) tier1Count++;
      else if (tierInfo.tier === 2) tier2Count++;
    } else {
      triangulationScore += 0.3; // Unknown source base weight
    }
  }

  // Normalize score
  triangulationScore = Math.min(1, triangulationScore / 3);

  // Determine consensus level
  let consensusLevel: TriangulationResult["consensusLevel"];
  if (tier1Count >= 2 || (tier1Count >= 1 && tier2Count >= 2)) {
    consensusLevel = "strong";
  } else if (tier1Count >= 1 || tier2Count >= 2) {
    consensusLevel = "moderate";
  } else if (tier2Count >= 1 || independentSourceCount >= 2) {
    consensusLevel = "weak";
  } else {
    consensusLevel = "none";
  }

  return {
    claim,
    sources: sources.map(s => ({
      source: s,
      snippet: "",
      relevanceScore: 0.5,
      sentiment: "neutral" as const,
    })),
    triangulationScore,
    independentSourceCount,
    consensusLevel,
  };
}

// =============================================================================
// REFLECTION (Anthropic Pattern)
// =============================================================================

async function reflectOnVerdict(
  claim: ExtractedClaim,
  searchResult: { claim: VerifiedClaim; sources: DDSource[] },
  triangulation?: TriangulationResult
): Promise<ReflectionResult> {
  const challenges: string[] = [];
  const counterArguments: string[] = [];
  let confidenceAdjustment = 0;

  // Challenge 1: Source diversity
  if (triangulation && triangulation.independentSourceCount < 2) {
    challenges.push("Limited source diversity - only one independent source");
    confidenceAdjustment -= 0.1;
  }

  // Challenge 2: Speculation level
  if (claim.speculationLevel === "high" || claim.speculationLevel === "moderate") {
    challenges.push(`Claim has ${claim.speculationLevel} speculation level - harder to verify`);
    confidenceAdjustment -= 0.15;
  }

  // Challenge 3: Recency
  const isTimelinessRequired = /acquisition|announcement|launch|recent/i.test(claim.claim);
  if (isTimelinessRequired) {
    challenges.push("Claim requires recent news verification - information may change");
  }

  // Challenge 4: Causal claims
  if (/initiated|caused|led to|responsible for/i.test(claim.claim)) {
    challenges.push("Claim involves causal attribution - typically not publicly verifiable");
    confidenceAdjustment -= 0.2;
    counterArguments.push("Causal claims about internal initiatives are rarely verifiable through public sources");
  }

  // Challenge 5: Internal knowledge
  if (/internally|internal|behind the scenes|private/i.test(claim.claim)) {
    challenges.push("Claim involves internal/private information");
    confidenceAdjustment -= 0.25;
    counterArguments.push("Internal company matters cannot be verified through external sources");
  }

  // Determine if verdict should change
  const originalVerdict = searchResult.claim.status;
  let finalVerdict = originalVerdict;

  // Downgrade if too many challenges
  if (challenges.length >= 3 && originalVerdict === "verified") {
    finalVerdict = "partially_verified";
    counterArguments.push("Multiple verification challenges suggest lower confidence is warranted");
  }

  return {
    originalVerdict,
    challenges,
    counterArguments,
    finalVerdict,
    confidenceAdjustment,
  };
}

// =============================================================================
// FINAL SYNTHESIS
// =============================================================================

function synthesizeFinalVerdict(
  claim: ExtractedClaim,
  searchResult: { claim: VerifiedClaim; sources: DDSource[] },
  triangulation?: TriangulationResult,
  reflection?: ReflectionResult,
  options: { requireMultipleSources: boolean } = { requireMultipleSources: true }
): VerifiedClaim {
  let status = searchResult.claim.status;
  let confidence = searchResult.claim.confidence;

  // Apply triangulation adjustments
  if (triangulation) {
    if (triangulation.consensusLevel === "strong" && status === "partially_verified") {
      status = "verified";
      confidence = "high";
    } else if (triangulation.consensusLevel === "none" && status === "verified") {
      status = "partially_verified";
      confidence = "medium";
    } else if (triangulation.consensusLevel === "conflicting") {
      if (status === "verified") status = "partially_verified";
      confidence = "low";
    }

    // Require multiple sources for full verification
    if (options.requireMultipleSources && triangulation.independentSourceCount < 2) {
      if (status === "verified") {
        status = "partially_verified";
        confidence = "medium";
      }
    }
  }

  // Apply reflection adjustments
  if (reflection) {
    if (reflection.finalVerdict !== reflection.originalVerdict) {
      status = reflection.finalVerdict as VerifiedClaim["status"];
    }

    // Adjust confidence label based on reflection
    if (reflection.confidenceAdjustment < -0.2 && confidence === "high") {
      confidence = "medium";
    } else if (reflection.confidenceAdjustment < -0.3) {
      confidence = "low";
    }
  }

  return {
    ...searchResult.claim,
    status,
    confidence,
    notes: reflection?.challenges.length
      ? `Verification challenges: ${reflection.challenges.join("; ")}`
      : searchResult.claim.notes,
  };
}

// =============================================================================
// CONFIDENCE CALIBRATION
// =============================================================================

function calculateCalibratedConfidence(
  verified: VerifiedClaim[],
  unverified: VerifiedClaim[],
  contradicted: VerifiedClaim[],
  triangulations: TriangulationResult[]
): number {
  const total = verified.length + unverified.length + contradicted.length;
  if (total === 0) return 0.5;

  // Base score from verification ratios
  let score = 0;

  const triangulationByClaim = new Map<string, TriangulationResult>();
  for (const t of triangulations) triangulationByClaim.set(t.claim, t);

  // Evidence-backed claims (verified OR contradicted) both increase confidence that the system can adjudicate.
  for (const claim of verified) {
    let claimScore = claim.confidence === "high" ? 1.0 :
                     claim.confidence === "medium" ? 0.7 :
                     claim.confidence === "low" ? 0.4 : 0.3;

    const tri = triangulationByClaim.get(claim.claim);
    if (tri?.consensusLevel === "strong") {
      claimScore = Math.min(1, claimScore + 0.15);
    } else if (tri?.consensusLevel === "moderate") {
      claimScore = Math.min(1, claimScore + 0.1);
    }

    score += claimScore;
  }

  for (const claim of contradicted) {
    let claimScore = 0.7;
    const tri = triangulationByClaim.get(claim.claim);
    if (tri?.consensusLevel === "strong") claimScore = 0.85;
    else if (tri?.consensusLevel === "moderate") claimScore = 0.8;
    score += claimScore;
  }

  // Unverified claims contribute less
  for (const claim of unverified) {
    score += 0.2; // Neutral - not negative
  }

  // Normalize
  const normalizedScore = score / total;

  // Apply calibration bounds
  return Math.max(0.1, Math.min(0.95, normalizedScore));
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function mapToSourceReliability(internal: InternalReliability): SourceReliability {
  switch (internal) {
    case "authoritative": return "authoritative";
    case "reputable": return "reliable";
    case "unknown": return "secondary";
  }
}

// Map SourceReliability to VerifiedClaim reliability
function mapToClaimReliability(reliability: SourceReliability): "authoritative" | "reputable" | "unknown" {
  switch (reliability) {
    case "authoritative": return "authoritative";
    case "reliable": return "reputable";
    case "secondary": return "unknown";
    case "inferred": return "unknown";
    default: return "unknown";
  }
}

function getSourceReliability(url: string): SourceReliability {
  const domain = extractDomain(url);
  const tierInfo = SOURCE_TIERS[domain];

  if (tierInfo) {
    if (tierInfo.tier === 1) return "authoritative";
    if (tierInfo.tier === 2) return "reliable";
  }
  return "secondary";
}

function getSourceTier(url: string): string {
  const domain = extractDomain(url);
  const tierInfo = SOURCE_TIERS[domain];
  return tierInfo ? `T${tierInfo.tier}` : "T3";
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    return parts.length >= 2
      ? parts.slice(-2).join(".")
      : hostname;
  } catch {
    return url;
  }
}

function calculateRelevanceScore(claim: string, snippet: string): number {
  const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const snippetWords = new Set(snippet.toLowerCase().split(/\s+/));

  let matchCount = 0;
  for (const word of claimWords) {
    if (snippetWords.has(word)) matchCount++;
  }

  return claimWords.size > 0 ? matchCount / claimWords.size : 0;
}

function analyzeSentiment(claim: string, snippet: string): "supporting" | "contradicting" | "neutral" {
  const snippetLower = snippet.toLowerCase();
  const claimLower = claim.toLowerCase();

  // Domain-specific contradiction heuristics (high-signal patterns)
  // Example: "X trains their own models" vs evidence that it uses third-party foundation models.
  const isOwnModelsClaim =
    /\btrain(s|ed|ing)?\b/.test(claimLower) &&
    /\b(own|their own)\b/.test(claimLower) &&
    /\bmodel(s)?\b/.test(claimLower);
  const evidenceSuggestsThirdPartyModels =
    /\b(third[- ]party|foundation model|hosted model|api model)\b/.test(snippetLower) ||
    /\b(anthropic|claude|qwen|openai|gpt-)\b/.test(snippetLower) ||
    /\buses?\s+(?:anthropic|claude|qwen|openai|gpt)\b/.test(snippetLower);

  if (isOwnModelsClaim && evidenceSuggestsThirdPartyModels) {
    return "contradicting";
  }

  // Check for contradiction patterns
  const contradictPatterns = [
    /not true|false|incorrect|wrong|myth|misleading|denied|refuted/i,
    /does not|doesn't|did not|didn't|won't|wouldn't/i,
    /contrary to|despite claims|actually/i,
  ];

  for (const pattern of contradictPatterns) {
    if (pattern.test(snippetLower)) {
      return "contradicting";
    }
  }

  // Check for supporting patterns
  const supportPatterns = [
    /confirmed|verified|announced|reported|according to/i,
    /indeed|in fact|actually did/i,
  ];

  for (const pattern of supportPatterns) {
    if (pattern.test(snippetLower)) {
      return "supporting";
    }
  }

  // Check keyword overlap for implicit support
  const relevance = calculateRelevanceScore(claim, snippet);
  if (relevance > 0.5) {
    return "supporting";
  }

  return "neutral";
}

function refineSearchQuery(claim: ExtractedClaim, evidence: SourceEvidence[], iteration: number): string {
  // Add specificity for subsequent searches
  const baseQuery = claim.searchQuery;

  if (iteration === 1) {
    // Add verification keywords
    return `${baseQuery} verified confirmed official`;
  }

  return baseQuery;
}

function determineOODAVerdict(evidence: SourceEvidence[]): {
  status: VerifiedClaim["status"];
  confidence: ClaimConfidence;
} {
  const supporting = evidence.filter(e => e.sentiment === "supporting");
  const contradicting = evidence.filter(e => e.sentiment === "contradicting");
  const highRelevance = evidence.filter(e => e.relevanceScore > 0.6);

  // Strong contradiction
  if (contradicting.length >= 2) {
    return { status: "contradicted", confidence: "contradicted" };
  }

  // Strong support
  if (supporting.length >= 3 && contradicting.length === 0) {
    return { status: "verified", confidence: "high" };
  }

  // Moderate support
  if (supporting.length >= 2 || (supporting.length >= 1 && highRelevance.length >= 2)) {
    return { status: "verified", confidence: "medium" };
  }

  // Weak support
  if (supporting.length >= 1) {
    return { status: "partially_verified", confidence: "low" };
  }

  // No support
  return { status: "unverified", confidence: "unverified" };
}

function deduplicateSources(sources: DDSource[]): DDSource[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = source.url || source.title || `${Date.now()}-${Math.random()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateEnhancedAssessment(
  verified: VerifiedClaim[],
  unverified: VerifiedClaim[],
  contradicted: VerifiedClaim[],
  methodology: string[]
): string {
  const total = verified.length + unverified.length + contradicted.length;

  let assessment = "";

  if (contradicted.length > 0) {
    assessment = `⚠️ CAUTION: ${contradicted.length} of ${total} claims are contradicted by evidence. `;
  }

  if (verified.length === total && total > 0) {
    assessment += `All ${total} claims verified through multi-source triangulation.`;
  } else if (verified.length > 0) {
    const highConfidence = verified.filter(v => v.confidence === "high").length;
    assessment += `${verified.length} claims verified (${highConfidence} high confidence), `;
    assessment += `${unverified.length} unverified.`;
  } else {
    assessment += `Unable to verify claims with available evidence.`;
  }

  assessment += ` Methodology: ${methodology.length}-phase verification with OODA loop, `;
  assessment += `source triangulation, and reflection.`;

  return assessment;
}

// =============================================================================
// EXPORT
// =============================================================================

export { extractClaimsFromQuery } from "./claimVerificationBranch";
