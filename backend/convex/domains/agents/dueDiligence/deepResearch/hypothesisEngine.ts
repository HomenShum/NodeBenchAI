/**
 * Hypothesis Engine
 *
 * Extracts claims from hypotheses, gathers evidence for/against,
 * and evaluates whether hypotheses are supported, contradicted, or unverified.
 *
 * Implements the adversarial verification pattern where we actively
 * search for both supporting AND contradicting evidence.
 *
 * @module deepResearch/hypothesisEngine
 */

import type {
  Hypothesis,
  Claim,
  Evidence,
  HypothesisVerdict,
  ClaimStatus,
  EvidenceStrength,
  ResearchSource,
  VerifiedClaim,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// HYPOTHESIS EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

export interface HypothesisEvaluationConfig {
  hypothesis: string;
  priorEvidence: Evidence[];
  verifiedClaims: VerifiedClaim[];
  generateTextFn?: (prompt: string) => Promise<string>;
  webSearchFn?: (query: string) => Promise<SearchResult[]>;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Evaluate a hypothesis against available evidence
 */
export async function evaluateHypothesis(
  config: HypothesisEvaluationConfig
): Promise<Hypothesis> {
  console.log(`[HypothesisEngine] Evaluating: ${config.hypothesis.slice(0, 80)}...`);

  // 1. Decompose hypothesis into verifiable claims
  const claims = await decomposeToClaims(config.hypothesis, config.generateTextFn);

  // 2. Gather evidence for each claim
  const evidenceMap = new Map<string, Evidence[]>();

  for (const claim of claims) {
    // Match prior evidence to claims
    const matchingEvidence = findMatchingEvidence(claim, config.priorEvidence);
    evidenceMap.set(claim.id, matchingEvidence);

    // Search for additional evidence if web search available
    if (config.webSearchFn) {
      const searchEvidence = await searchForEvidence(claim, config.webSearchFn);
      const existing = evidenceMap.get(claim.id) || [];
      evidenceMap.set(claim.id, [...existing, ...searchEvidence]);
    }

    // Match verified claims
    const verifiedMatches = findMatchingVerifiedClaims(claim, config.verifiedClaims);
    for (const verified of verifiedMatches) {
      const existing = evidenceMap.get(claim.id) || [];
      existing.push({
        id: `ev-verified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: verified.claim,
        source: verified.sources[0] || {
          id: `src-${Date.now()}`,
          type: "llm_inference",
          title: "Prior Verification",
          accessedAt: Date.now(),
          reliability: "reliable",
        },
        strength: verified.confidence > 0.8 ? "strong" : "moderate",
        supportsClaimId: claim.id,
        extractedAt: Date.now(),
        isDirectEvidence: true,
      });
      evidenceMap.set(claim.id, existing);
    }
  }

  // 3. Evaluate each claim
  const evaluatedClaims = evaluateClaims(claims, evidenceMap);

  // 4. Aggregate to hypothesis-level verdict
  const { verdict, confidence, reasoning } = aggregateVerdict(evaluatedClaims);

  // 5. Identify gaps and follow-up
  const gaps = identifyGaps(evaluatedClaims);
  const suggestedFollowUp = generateFollowUpSuggestions(evaluatedClaims, gaps);

  // 6. Separate supporting vs counter evidence
  const allEvidence = Array.from(evidenceMap.values()).flat();
  const supportingEvidence = allEvidence.filter(e => !e.contradictsClaimId);
  const counterEvidence = allEvidence.filter(e => e.contradictsClaimId);

  return {
    id: `hyp-${Date.now()}`,
    statement: config.hypothesis,
    decomposedClaims: evaluatedClaims,
    supportingEvidence,
    counterEvidence,
    verdict,
    confidenceScore: confidence,
    reasoning,
    gaps,
    suggestedFollowUp,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

async function decomposeToClaims(
  hypothesis: string,
  generateTextFn?: (prompt: string) => Promise<string>
): Promise<Claim[]> {
  // If LLM available, use it for better decomposition
  if (generateTextFn) {
    return await decomposeWithLLM(hypothesis, generateTextFn);
  }

  // Fallback to rule-based decomposition
  return decomposeWithRules(hypothesis);
}

async function decomposeWithLLM(
  hypothesis: string,
  generateTextFn: (prompt: string) => Promise<string>
): Promise<Claim[]> {
  const prompt = `Decompose this hypothesis into specific, verifiable claims.

HYPOTHESIS:
${hypothesis}

Return ONLY valid JSON:
{
  "claims": [
    {
      "statement": "A specific, verifiable factual claim",
      "category": "factual|causal|predictive|relational",
      "verificationPath": "How this claim can be verified (e.g., 'Check SEC filings', 'Search news')"
    }
  ]
}

Rules:
- Extract 3-7 distinct claims
- "factual" = something that is or was true
- "causal" = X caused Y, X leads to Y
- "predictive" = X will/might/could happen
- "relational" = X is connected to Y
- Be specific - "Company X acquired Company Y" not "acquisition happened"`;

  try {
    const response = await generateTextFn(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.claims)) {
        return parsed.claims.map((c: Record<string, unknown>, i: number) => ({
          id: `claim-${i + 1}`,
          statement: String(c.statement || ""),
          category: (c.category as Claim["category"]) || "factual",
          status: "needs_investigation" as ClaimStatus,
          evidence: [],
          confidence: 0,
          verificationPath: String(c.verificationPath || ""),
        }));
      }
    }
  } catch (error) {
    console.error("[HypothesisEngine] LLM decomposition failed:", error);
  }

  return decomposeWithRules(hypothesis);
}

function decomposeWithRules(hypothesis: string): Claim[] {
  const claims: Claim[] = [];
  const sentences = hypothesis.split(/[.!?]+/).filter(s => s.trim().length > 10);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();

    // Determine category
    let category: Claim["category"] = "factual";
    const sentenceLower = sentence.toLowerCase();

    if (sentenceLower.includes("because") || sentenceLower.includes("leads to") ||
        sentenceLower.includes("caused") || sentenceLower.includes("result")) {
      category = "causal";
    } else if (sentenceLower.includes("will") || sentenceLower.includes("would") ||
               sentenceLower.includes("could") || sentenceLower.includes("might") ||
               sentenceLower.includes("can") || sentenceLower.includes("benefit")) {
      category = "predictive";
    } else if (sentenceLower.includes("connect") || sentenceLower.includes("relate") ||
               sentenceLower.includes("align") || sentenceLower.includes("with")) {
      category = "relational";
    }

    // Extract sub-claims from compound sentences
    const subClaims = extractSubClaims(sentence);

    for (let j = 0; j < subClaims.length; j++) {
      claims.push({
        id: `claim-${i + 1}-${j + 1}`,
        statement: subClaims[j],
        category,
        status: "needs_investigation",
        evidence: [],
        confidence: 0,
        verificationPath: inferVerificationPath(subClaims[j]),
      });
    }
  }

  return claims.slice(0, 10); // Max 10 claims
}

function extractSubClaims(sentence: string): string[] {
  const subClaims: string[] = [];

  // Split on "and", "also", commas with subsequent clauses
  const parts = sentence.split(/(?:,\s*and\s+|,\s+and\s+|\s+and\s+also\s+|\s+and\s+)/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 15) {
      subClaims.push(trimmed);
    }
  }

  if (subClaims.length === 0) {
    subClaims.push(sentence);
  }

  return subClaims;
}

function inferVerificationPath(claim: string): string {
  const claimLower = claim.toLowerCase();

  if (claimLower.includes("acqui") || claimLower.includes("bought")) {
    return "Check news sources and official press releases";
  }
  if (claimLower.includes("ceo") || claimLower.includes("founder") || claimLower.includes("vp")) {
    return "Check LinkedIn profile and company website";
  }
  if (claimLower.includes("filed") || claimLower.includes("sec") || claimLower.includes("filing")) {
    return "Check SEC EDGAR filings";
  }
  if (claimLower.includes("patent") || claimLower.includes("invention")) {
    return "Check USPTO patent database";
  }
  if (claimLower.includes("trains") || claimLower.includes("model") || claimLower.includes("ai")) {
    return "Check company blog, technical papers, and news";
  }

  return "Search news and official sources";
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE MATCHING
// ═══════════════════════════════════════════════════════════════════════════

function findMatchingEvidence(claim: Claim, evidence: Evidence[]): Evidence[] {
  const matching: Evidence[] = [];
  const claimKeywords = extractKeywords(claim.statement);

  for (const ev of evidence) {
    const evKeywords = extractKeywords(ev.content);

    // Calculate keyword overlap
    const overlap = claimKeywords.filter(k => evKeywords.includes(k));
    const overlapRatio = overlap.length / Math.max(claimKeywords.length, 1);

    if (overlapRatio > 0.3) {
      // Check if it supports or contradicts
      const isContradiction = detectContradiction(claim.statement, ev.content);

      matching.push({
        ...ev,
        supportsClaimId: isContradiction ? "" : claim.id,
        contradictsClaimId: isContradiction ? claim.id : undefined,
      });
    }
  }

  return matching;
}

function findMatchingVerifiedClaims(claim: Claim, verified: VerifiedClaim[]): VerifiedClaim[] {
  const claimKeywords = extractKeywords(claim.statement);

  return verified.filter(v => {
    const vKeywords = extractKeywords(v.claim);
    const overlap = claimKeywords.filter(k => vKeywords.includes(k));
    return overlap.length / Math.max(claimKeywords.length, 1) > 0.3;
  });
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "can", "for", "and", "nor", "but",
    "or", "yet", "so", "in", "on", "at", "to", "of", "by", "with", "from",
    "about", "into", "through", "that", "this", "these", "those",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

function detectContradiction(claim: string, evidence: string): boolean {
  const evidenceLower = evidence.toLowerCase();
  const claimLower = claim.toLowerCase();

  // Negation patterns
  const negations = ["not ", "no ", "never ", "false", "incorrect", "deny", "untrue", "wrong"];

  // Check if evidence negates key terms from claim
  for (const neg of negations) {
    if (evidenceLower.includes(neg)) {
      // Check if it's negating a key term from the claim
      const claimKeywords = extractKeywords(claim);
      for (const keyword of claimKeywords) {
        if (evidenceLower.includes(neg + keyword) ||
            evidenceLower.includes(keyword + " " + neg.trim())) {
          return true;
        }
      }
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE SEARCH
// ═══════════════════════════════════════════════════════════════════════════

async function searchForEvidence(
  claim: Claim,
  webSearchFn: (query: string) => Promise<SearchResult[]>
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];

  // Search for supporting evidence
  const supportQuery = claim.statement;
  const supportResults = await webSearchFn(supportQuery);

  for (const result of supportResults.slice(0, 3)) {
    evidence.push({
      id: `ev-support-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: result.snippet,
      source: {
        id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "news_article",
        url: result.url,
        title: result.title,
        accessedAt: Date.now(),
        reliability: inferReliability(result.url),
      },
      strength: inferEvidenceStrength(result.url, result.snippet, claim.statement),
      supportsClaimId: claim.id,
      extractedAt: Date.now(),
      isDirectEvidence: result.snippet.toLowerCase().includes(
        extractKeywords(claim.statement).slice(0, 3).join(" ").toLowerCase()
      ),
    });
  }

  // Search for contradicting evidence (adversarial)
  const contradictQuery = `${claim.statement} false OR incorrect OR denied OR not true`;
  const contradictResults = await webSearchFn(contradictQuery);

  for (const result of contradictResults.slice(0, 2)) {
    if (detectContradiction(claim.statement, result.snippet)) {
      evidence.push({
        id: `ev-contra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: result.snippet,
        source: {
          id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "news_article",
          url: result.url,
          title: result.title,
          accessedAt: Date.now(),
          reliability: inferReliability(result.url),
        },
        strength: inferEvidenceStrength(result.url, result.snippet, claim.statement),
        supportsClaimId: "",
        contradictsClaimId: claim.id,
        extractedAt: Date.now(),
        isDirectEvidence: true,
      });
    }
  }

  return evidence;
}

function inferReliability(url: string): ResearchSource["reliability"] {
  const urlLower = url.toLowerCase();

  if (urlLower.includes(".gov") || urlLower.includes("sec.gov")) return "authoritative";
  if (urlLower.includes("reuters") || urlLower.includes("bloomberg") ||
      urlLower.includes("wsj") || urlLower.includes("nytimes")) return "reliable";
  if (urlLower.includes("techcrunch") || urlLower.includes("forbes") ||
      urlLower.includes("linkedin")) return "reliable";

  return "secondary";
}

function inferEvidenceStrength(url: string, snippet: string, claim: string): EvidenceStrength {
  const reliability = inferReliability(url);
  const claimKeywords = extractKeywords(claim);
  const snippetKeywords = extractKeywords(snippet);

  // Check keyword overlap
  const overlap = claimKeywords.filter(k => snippetKeywords.includes(k));
  const overlapRatio = overlap.length / Math.max(claimKeywords.length, 1);

  if (reliability === "authoritative" && overlapRatio > 0.5) return "authoritative";
  if (reliability === "reliable" && overlapRatio > 0.4) return "strong";
  if (overlapRatio > 0.3) return "moderate";

  return "weak";
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

function evaluateClaims(
  claims: Claim[],
  evidenceMap: Map<string, Evidence[]>
): Claim[] {
  return claims.map(claim => {
    const evidence = evidenceMap.get(claim.id) || [];

    // Separate supporting vs contradicting
    const supporting = evidence.filter(e => e.supportsClaimId === claim.id);
    const contradicting = evidence.filter(e => e.contradictsClaimId === claim.id);

    // Calculate status and confidence
    let status: ClaimStatus;
    let confidence: number;

    if (evidence.length === 0) {
      status = "unverified";
      confidence = 0;
    } else if (contradicting.length > supporting.length) {
      status = "contradicted";
      confidence = Math.min(
        0.9,
        contradicting.reduce((sum, e) => sum + strengthToScore(e.strength), 0) / contradicting.length
      );
    } else if (supporting.length >= 2 && supporting.some(e => e.strength === "authoritative" || e.strength === "strong")) {
      status = "verified";
      confidence = Math.min(
        0.95,
        supporting.reduce((sum, e) => sum + strengthToScore(e.strength), 0) / supporting.length
      );
    } else if (supporting.length >= 1) {
      status = "partially_verified";
      confidence = Math.min(
        0.7,
        supporting.reduce((sum, e) => sum + strengthToScore(e.strength), 0) / supporting.length
      );
    } else {
      status = "needs_investigation";
      confidence = 0.3;
    }

    return {
      ...claim,
      status,
      confidence,
      evidence,
    };
  });
}

function strengthToScore(strength: EvidenceStrength): number {
  switch (strength) {
    case "authoritative": return 0.95;
    case "strong": return 0.8;
    case "moderate": return 0.6;
    case "weak": return 0.4;
    case "speculative": return 0.2;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERDICT AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

function aggregateVerdict(claims: Claim[]): {
  verdict: HypothesisVerdict;
  confidence: number;
  reasoning: string;
} {
  if (claims.length === 0) {
    return {
      verdict: "UNVERIFIED",
      confidence: 0,
      reasoning: "No verifiable claims could be extracted from the hypothesis",
    };
  }

  // Count claim statuses
  const statusCounts = {
    verified: 0,
    partially_verified: 0,
    unverified: 0,
    contradicted: 0,
    needs_investigation: 0,
  };

  let totalConfidence = 0;

  for (const claim of claims) {
    statusCounts[claim.status]++;
    totalConfidence += claim.confidence;
  }

  const avgConfidence = totalConfidence / claims.length;

  // Determine verdict
  let verdict: HypothesisVerdict;
  let reasoning: string;

  if (statusCounts.contradicted > claims.length / 2) {
    verdict = "CONTRADICTED";
    reasoning = `More than half of the claims (${statusCounts.contradicted}/${claims.length}) are contradicted by evidence`;
  } else if (statusCounts.contradicted > 0 && statusCounts.verified === 0) {
    verdict = "FALSIFIED";
    reasoning = `Key claims are contradicted with no verified supporting evidence`;
  } else if (statusCounts.verified >= claims.length / 2) {
    verdict = "VERIFIED";
    reasoning = `Majority of claims (${statusCounts.verified}/${claims.length}) are verified with strong evidence`;
  } else if (statusCounts.verified + statusCounts.partially_verified >= claims.length / 2) {
    verdict = "PARTIALLY_SUPPORTED";
    reasoning = `Some claims are verified but gaps remain (${statusCounts.verified} verified, ${statusCounts.partially_verified} partially verified, ${statusCounts.unverified} unverified)`;
  } else {
    verdict = "UNVERIFIED";
    reasoning = `Insufficient evidence to verify the hypothesis (${statusCounts.unverified}/${claims.length} claims lack evidence)`;
  }

  return { verdict, confidence: avgConfidence, reasoning };
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

function identifyGaps(claims: Claim[]): string[] {
  const gaps: string[] = [];

  for (const claim of claims) {
    if (claim.status === "unverified") {
      gaps.push(`No evidence found for: "${claim.statement}"`);
    } else if (claim.status === "needs_investigation") {
      gaps.push(`Needs further investigation: "${claim.statement}"`);
    } else if (claim.status === "partially_verified" && claim.confidence < 0.6) {
      gaps.push(`Weak evidence for: "${claim.statement}"`);
    }
  }

  // Add category-specific gaps
  const categories = claims.map(c => c.category);
  if (!categories.includes("factual")) {
    gaps.push("No factual claims to anchor the hypothesis");
  }
  if (categories.filter(c => c === "causal").length > 2) {
    gaps.push("Multiple causal claims may indicate speculative chain of reasoning");
  }

  return gaps;
}

function generateFollowUpSuggestions(claims: Claim[], gaps: string[]): string[] {
  const suggestions: string[] = [];

  // Based on unverified claims
  for (const claim of claims.filter(c => c.status === "unverified" || c.status === "needs_investigation")) {
    suggestions.push(`Search for: ${claim.verificationPath}`);
  }

  // Based on claim categories
  const causalClaims = claims.filter(c => c.category === "causal");
  if (causalClaims.length > 0) {
    suggestions.push("Verify causal relationships with expert analysis or academic sources");
  }

  const predictiveClaims = claims.filter(c => c.category === "predictive");
  if (predictiveClaims.length > 0) {
    suggestions.push("Note: Predictive claims cannot be fully verified until events occur");
  }

  // General suggestions based on gaps
  if (gaps.length > 3) {
    suggestions.push("Consider narrowing the hypothesis to verifiable components");
  }

  return [...new Set(suggestions)].slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  decomposeToClaims,
  evaluateClaims,
  findMatchingEvidence,
  aggregateVerdict,
};
