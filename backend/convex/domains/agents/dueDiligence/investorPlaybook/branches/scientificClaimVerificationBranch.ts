/**
 * Scientific Claim Verification Branch
 *
 * Verifies scientific/research claims by searching academic sources:
 * - arXiv (preprints)
 * - PubMed (peer-reviewed)
 * - Retraction Watch (retractions/corrections)
 * - Science/Nature news (scientific consensus)
 *
 * CRITICAL: Scientific claims require extraordinary evidence.
 * This branch specifically looks for:
 * - Peer review status
 * - Replication studies
 * - Retractions/debunkings
 * - Scientific consensus
 *
 * Examples of scientific claims:
 * - "LK-99 is a room-temperature superconductor"
 * - "Company X achieved cold fusion"
 * - "Drug Y cures cancer" (without clinical trials)
 * - "Quantum computing breakthrough at room temperature"
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  ScientificClaimVerificationFindings,
  ScientificClaimStatus,
  ScientificClaim,
  ReplicationStudy,
  RetractionRecord,
  PeerReviewStatus,
} from "../types";

interface ScientificClaimVerificationResult {
  findings: ScientificClaimVerificationFindings;
  sources: DDSource[];
  confidence: number;
}

/**
 * Execute scientific claim verification branch
 */
export async function executeScientificClaimVerificationBranch(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string,
  researchArea?: string
): Promise<ScientificClaimVerificationResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Extract scientific claims from the query context
    const claims: ScientificClaim[] = [];

    // Step 2: Search for preprints on arXiv
    const arxivResults = await searchArxiv(ctx, entityName, claimedDiscovery);
    if (arxivResults.papers.length > 0) {
      sources.push({
        sourceType: "news_article", // Using closest type
        url: "https://arxiv.org",
        title: "arXiv Preprint Server",
        accessedAt: now,
        reliability: "secondary",
        section: "preprints",
      });
    }

    // Step 3: Search for peer-reviewed papers on PubMed
    const pubmedResults = await searchPubMed(ctx, entityName, claimedDiscovery);
    if (pubmedResults.papers.length > 0) {
      sources.push({
        sourceType: "news_article",
        url: "https://pubmed.ncbi.nlm.nih.gov",
        title: "PubMed - NIH National Library of Medicine",
        accessedAt: now,
        reliability: "authoritative",
        section: "peer_reviewed",
      });
      confidence += 0.2;
    }

    // Step 4: Search for retractions
    const retractions = await searchRetractions(ctx, entityName, claimedDiscovery);
    if (retractions.length > 0) {
      sources.push({
        sourceType: "news_article",
        url: "https://retractionwatch.com",
        title: "Retraction Watch Database",
        accessedAt: now,
        reliability: "reliable",
        section: "retractions",
      });
    }

    // Step 5: Search for replication studies
    const replications = await searchReplicationStudies(ctx, entityName, claimedDiscovery);

    // Step 6: Search for scientific consensus / debunking
    const consensusSearch = await searchScientificConsensus(ctx, entityName, claimedDiscovery);

    // Step 7: Determine overall status
    const overallStatus = determineScientificClaimStatus(
      arxivResults,
      pubmedResults,
      retractions,
      replications,
      consensusSearch
    );

    // Step 8: Build scientific claim object
    if (claimedDiscovery) {
      claims.push({
        claim: claimedDiscovery,
        claimType: detectClaimType(claimedDiscovery),
        status: overallStatus,
        peerReviewStatus: determinePeerReviewStatus(arxivResults, pubmedResults),
        replicationStatus: determineReplicationStatus(replications),
        hasBeenRetracted: retractions.length > 0,
        hasBeenDebunked: consensusSearch.isDebunked,
        evidence: {
          supporting: consensusSearch.supportingEvidence,
          contradicting: consensusSearch.contradictingEvidence,
        },
        scientificConsensus: consensusSearch.consensusStatement,
        sources: sources
          .filter(s => s.title) // Filter out sources without titles
          .map(s => ({
            title: s.title as string,
            url: s.url,
            type: s.section as "arxiv" | "pubmed" | "journal" | "news" | "retraction_watch",
            date: new Date(s.accessedAt).toISOString().split("T")[0],
          })),
      });
    }

    // Step 9: Generate red flags
    const redFlags = generateScientificRedFlags(
      claims,
      retractions,
      replications,
      consensusSearch,
      arxivResults,
      pubmedResults
    );

    // Adjust confidence based on findings
    if (retractions.length > 0) {
      confidence = Math.min(confidence, 0.3);
    }
    if (consensusSearch.isDebunked) {
      confidence = Math.min(confidence, 0.2);
    }
    if (replications.some(r => r.result === "failure")) {
      confidence = Math.min(confidence, 0.25);
    }

    const findings: ScientificClaimVerificationFindings = {
      claims,
      overallStatus,
      peerReviewedPapers: pubmedResults.papers.length,
      preprints: arxivResults.papers.length,
      replicationStudies: replications,
      retractions,
      scientificConsensus: consensusSearch.consensusStatement,
      redFlags,
      overallConfidence: confidence,
    };

    return {
      findings,
      sources,
      confidence,
    };
  } catch (error) {
    console.error(`[Scientific-Verification] Error for ${entityName}:`, error);
    return {
      findings: createEmptyScientificFindings(claimedDiscovery),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

interface ArxivSearchResult {
  papers: Array<{
    title: string;
    authors: string[];
    abstract: string;
    arxivId: string;
    publishedDate: string;
    categories: string[];
  }>;
}

async function searchArxiv(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string
): Promise<ArxivSearchResult> {
  const papers: ArxivSearchResult["papers"] = [];

  try {
    const searchQuery = claimedDiscovery
      ? `site:arxiv.org "${claimedDiscovery}" OR "${entityName}"`
      : `site:arxiv.org "${entityName}"`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const arxivMatch = content.match(/arxiv[:\s]*(\d{4}\.\d{4,5})/i);

      if (arxivMatch || r.url?.includes("arxiv.org")) {
        papers.push({
          title: r.title || "Unknown",
          authors: extractAuthors(content),
          abstract: r.snippet || "",
          arxivId: arxivMatch?.[1] || "Unknown",
          publishedDate: extractDate(content) || "Unknown",
          categories: extractCategories(content),
        });
      }
    }

    return { papers };
  } catch (error) {
    console.error(`[Scientific-arXiv] Search error:`, error);
    return { papers: [] };
  }
}

interface PubMedSearchResult {
  papers: Array<{
    title: string;
    authors: string[];
    journal: string;
    pmid: string;
    publishedDate: string;
    isPeerReviewed: boolean;
  }>;
}

async function searchPubMed(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string
): Promise<PubMedSearchResult> {
  const papers: PubMedSearchResult["papers"] = [];

  try {
    const searchQuery = claimedDiscovery
      ? `site:pubmed.ncbi.nlm.nih.gov OR site:ncbi.nlm.nih.gov "${claimedDiscovery}" OR "${entityName}"`
      : `site:pubmed.ncbi.nlm.nih.gov "${entityName}"`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const pmidMatch = content.match(/PMID[:\s]*(\d+)/i) ||
        r.url?.match(/pubmed[\/\.].*?(\d{7,8})/);

      if (pmidMatch || r.url?.includes("pubmed") || r.url?.includes("ncbi.nlm.nih.gov")) {
        papers.push({
          title: r.title || "Unknown",
          authors: extractAuthors(content),
          journal: extractJournal(content) || "Unknown Journal",
          pmid: pmidMatch?.[1] || "Unknown",
          publishedDate: extractDate(content) || "Unknown",
          isPeerReviewed: true, // PubMed papers are peer-reviewed
        });
      }
    }

    return { papers };
  } catch (error) {
    console.error(`[Scientific-PubMed] Search error:`, error);
    return { papers: [] };
  }
}

async function searchRetractions(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string
): Promise<RetractionRecord[]> {
  const retractions: RetractionRecord[] = [];

  try {
    // Search Retraction Watch and general retraction news
    const searchQuery = claimedDiscovery
      ? `"${claimedDiscovery}" OR "${entityName}" retraction OR retracted OR withdrawn paper`
      : `"${entityName}" retraction OR retracted paper`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      // Check for retraction indicators
      if (
        contentLower.includes("retract") ||
        contentLower.includes("withdrawn") ||
        contentLower.includes("correction") ||
        contentLower.includes("erratum")
      ) {
        const isRetraction = contentLower.includes("retract");
        const isWithdrawn = contentLower.includes("withdrawn");

        retractions.push({
          paperTitle: extractPaperTitle(content) || "Unknown Paper",
          journal: extractJournal(content),
          retractionDate: extractDate(content),
          reason: extractRetractionReason(content),
          type: isRetraction ? "retraction" : isWithdrawn ? "withdrawal" : "correction",
          sourceUrl: r.url,
        });
      }
    }

    return retractions;
  } catch (error) {
    console.error(`[Scientific-Retractions] Search error:`, error);
    return [];
  }
}

async function searchReplicationStudies(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string
): Promise<ReplicationStudy[]> {
  const replications: ReplicationStudy[] = [];

  try {
    const searchQuery = claimedDiscovery
      ? `"${claimedDiscovery}" replication OR replicate OR reproduce OR "failed to replicate" OR "could not replicate"`
      : `"${entityName}" replication study`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      // Check for replication study indicators
      if (
        contentLower.includes("replic") ||
        contentLower.includes("reproduc")
      ) {
        // Determine if success or failure
        const isFailure =
          contentLower.includes("failed to replic") ||
          contentLower.includes("could not replic") ||
          contentLower.includes("unable to replic") ||
          contentLower.includes("fail") ||
          contentLower.includes("not reproduc") ||
          contentLower.includes("cannot reproduc");

        const isSuccess =
          contentLower.includes("successfully replic") ||
          contentLower.includes("confirmed") ||
          contentLower.includes("verified");

        replications.push({
          studyTitle: r.title || "Unknown Study",
          authors: extractAuthors(content),
          institution: extractInstitution(content),
          date: extractDate(content),
          result: isFailure ? "failure" : isSuccess ? "success" : "partial",
          summary: r.snippet?.slice(0, 300) || "",
          sourceUrl: r.url,
        });
      }
    }

    return replications;
  } catch (error) {
    console.error(`[Scientific-Replication] Search error:`, error);
    return [];
  }
}

interface ConsensusSearchResult {
  isDebunked: boolean;
  consensusStatement?: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
}

async function searchScientificConsensus(
  ctx: any,
  entityName: string,
  claimedDiscovery?: string
): Promise<ConsensusSearchResult> {
  const result: ConsensusSearchResult = {
    isDebunked: false,
    supportingEvidence: [],
    contradictingEvidence: [],
  };

  try {
    // Search for debunking/skepticism
    const debunkQuery = claimedDiscovery
      ? `"${claimedDiscovery}" debunked OR debunk OR disproven OR "turned out to be" false OR fake OR fraud`
      : `"${entityName}" scientific fraud OR debunked`;

    const debunkResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: debunkQuery,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const debunkResults = debunkResult?.payload?.results ?? [];

    // Analyze for debunking signals
    for (const r of debunkResults) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      // Strong debunking indicators
      const debunkingPatterns = [
        /debunk(?:ed|ing)?/i,
        /disproven|disproved/i,
        /turned\s+out\s+to\s+be\s+(?:false|wrong|incorrect)/i,
        /not\s+(?:a\s+)?superconductor/i,
        /fail(?:ed|ure)?\s+(?:to\s+)?replicate/i,
        /scientific\s+fraud/i,
        /data\s+fabricat/i,
        /retract(?:ed|ion)/i,
        /could\s+not\s+(?:be\s+)?(?:verified|confirmed|replicated)/i,
        /no\s+evidence\s+(?:of|for)/i,
        /hoax/i,
        /pseudoscien(?:ce|tific)/i,
      ];

      for (const pattern of debunkingPatterns) {
        if (pattern.test(contentLower)) {
          result.isDebunked = true;
          result.contradictingEvidence.push(content.slice(0, 200));

          // Extract consensus statement if found
          const consensusMatch = content.match(
            /(?:scientists|researchers|experts)\s+(?:say|agree|confirm|conclude)\s+([^.]+)/i
          );
          if (consensusMatch) {
            result.consensusStatement = consensusMatch[1].trim();
          }
          break;
        }
      }
    }

    // Search for positive consensus/verification
    const verifyQuery = claimedDiscovery
      ? `"${claimedDiscovery}" verified OR confirmed OR "peer reviewed" OR "breakthrough confirmed"`
      : `"${entityName}" verified scientific`;

    const verifyResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: verifyQuery,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const verifyResults = verifyResult?.payload?.results ?? [];

    for (const r of verifyResults) {
      const content = (r.snippet || "") + " " + (r.title || "");
      result.supportingEvidence.push(content.slice(0, 200));
    }

    return result;
  } catch (error) {
    console.error(`[Scientific-Consensus] Search error:`, error);
    return result;
  }
}

// ============================================================================
// STATUS DETERMINATION
// ============================================================================

function determineScientificClaimStatus(
  arxivResults: ArxivSearchResult,
  pubmedResults: PubMedSearchResult,
  retractions: RetractionRecord[],
  replications: ReplicationStudy[],
  consensus: ConsensusSearchResult
): ScientificClaimStatus {
  // CRITICAL: Check for debunking first
  if (consensus.isDebunked) {
    return "debunked";
  }

  // Check for retractions
  if (retractions.some(r => r.type === "retraction")) {
    return "retracted";
  }

  // Check for replication failures
  const failedReplications = replications.filter(r => r.result === "failure");
  const successfulReplications = replications.filter(r => r.result === "success");

  if (failedReplications.length > successfulReplications.length) {
    return "replication_failed";
  }

  // Check for peer review status
  if (pubmedResults.papers.length > 0 && successfulReplications.length > 0) {
    return "peer_reviewed_verified";
  }

  if (pubmedResults.papers.length > 0) {
    return "peer_reviewed";
  }

  // Only preprints available
  if (arxivResults.papers.length > 0 && pubmedResults.papers.length === 0) {
    return "preprint_only";
  }

  // No scientific evidence found
  return "unverified";
}

function determinePeerReviewStatus(
  arxivResults: ArxivSearchResult,
  pubmedResults: PubMedSearchResult
): PeerReviewStatus {
  if (pubmedResults.papers.length > 0) {
    return "peer_reviewed";
  }
  if (arxivResults.papers.length > 0) {
    return "preprint";
  }
  return "not_submitted";
}

function determineReplicationStatus(
  replications: ReplicationStudy[]
): "replicated" | "failed" | "partial" | "not_attempted" {
  if (replications.length === 0) {
    return "not_attempted";
  }

  const successes = replications.filter(r => r.result === "success").length;
  const failures = replications.filter(r => r.result === "failure").length;

  if (failures > successes) return "failed";
  if (successes > failures && successes > 0) return "replicated";
  return "partial";
}

function detectClaimType(
  claim: string
): "breakthrough" | "discovery" | "treatment" | "technology" | "material" | "other" {
  const claimLower = claim.toLowerCase();

  if (claimLower.includes("superconductor") || claimLower.includes("material")) {
    return "material";
  }
  if (claimLower.includes("cure") || claimLower.includes("treatment") || claimLower.includes("therapy")) {
    return "treatment";
  }
  if (claimLower.includes("quantum") || claimLower.includes("technology") || claimLower.includes("device")) {
    return "technology";
  }
  if (claimLower.includes("discover")) {
    return "discovery";
  }
  if (claimLower.includes("breakthrough") || claimLower.includes("first")) {
    return "breakthrough";
  }
  return "other";
}

// ============================================================================
// RED FLAG GENERATION
// ============================================================================

function generateScientificRedFlags(
  claims: ScientificClaim[],
  retractions: RetractionRecord[],
  replications: ReplicationStudy[],
  consensus: ConsensusSearchResult,
  arxivResults: ArxivSearchResult,
  pubmedResults: PubMedSearchResult
): ScientificClaimVerificationFindings["redFlags"] {
  const redFlags: ScientificClaimVerificationFindings["redFlags"] = [];

  // CRITICAL: Debunked claim
  if (consensus.isDebunked) {
    redFlags.push({
      type: "claim_debunked",
      severity: "critical",
      description: `Scientific claim has been debunked by the research community. ${consensus.consensusStatement || "Multiple sources indicate the claim is false."}`,
    });
  }

  // CRITICAL: Retracted papers
  if (retractions.length > 0) {
    const retractionTypes = retractions.map(r => r.type).join(", ");
    redFlags.push({
      type: "paper_retracted",
      severity: "critical",
      description: `${retractions.length} paper(s) have been retracted or withdrawn. Retraction types: ${retractionTypes}`,
    });
  }

  // HIGH: Replication failures
  const failedReplications = replications.filter(r => r.result === "failure");
  if (failedReplications.length > 0) {
    redFlags.push({
      type: "replication_failure",
      severity: "high",
      description: `${failedReplications.length} independent replication attempt(s) have FAILED. This is a major red flag for scientific validity.`,
    });
  }

  // HIGH: Only preprints, no peer review
  if (arxivResults.papers.length > 0 && pubmedResults.papers.length === 0) {
    redFlags.push({
      type: "no_peer_review",
      severity: "high",
      description: `Research exists only as preprints (arXiv) with NO peer-reviewed publications. Extraordinary claims require peer review.`,
    });
  }

  // MEDIUM: No replication attempts
  if (replications.length === 0 && arxivResults.papers.length > 0) {
    redFlags.push({
      type: "no_replication",
      severity: "medium",
      description: `No independent replication studies found. Scientific claims should be independently verified.`,
    });
  }

  // MEDIUM: Conflicting evidence
  if (consensus.supportingEvidence.length > 0 && consensus.contradictingEvidence.length > 0) {
    redFlags.push({
      type: "conflicting_evidence",
      severity: "medium",
      description: `Both supporting and contradicting evidence found. Scientific consensus is not established.`,
    });
  }

  return redFlags;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractAuthors(content: string): string[] {
  // Try to extract author names from content
  const authorMatch = content.match(/(?:by|authors?)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,?\s+(?:and\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)*)/i);
  if (authorMatch) {
    return authorMatch[1].split(/,\s*(?:and\s+)?/).map(a => a.trim());
  }
  return [];
}

function extractDate(content: string): string | undefined {
  const dateMatch = content.match(/(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i);
  return dateMatch?.[1];
}

function extractCategories(content: string): string[] {
  const categories: string[] = [];
  const categoryPatterns = [
    /cond-mat|condensed matter/i,
    /physics|phys\./i,
    /chemistry|chem/i,
    /biology|bio/i,
    /computer science|cs\./i,
    /quantum/i,
    /materials?/i,
  ];

  for (const pattern of categoryPatterns) {
    if (pattern.test(content)) {
      categories.push(pattern.source.replace(/\|.*/, ""));
    }
  }

  return categories;
}

function extractJournal(content: string): string | undefined {
  const journalPatterns = [
    /(?:published in|journal)[:\s]+([A-Z][A-Za-z\s&]+?)(?:\.|,|\d|$)/i,
    /(Nature|Science|Cell|PNAS|Physical Review|Journal of|Proceedings of)[A-Za-z\s]*/i,
  ];

  for (const pattern of journalPatterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractPaperTitle(content: string): string | undefined {
  const titleMatch = content.match(/(?:paper|article|study)[:\s]+"([^"]+)"/i) ||
    content.match(/"([^"]{20,100})"/);
  return titleMatch?.[1];
}

function extractRetractionReason(content: string): string | undefined {
  const reasonMatch = content.match(/(?:reason|due to|because of)[:\s]+([^.]+)/i);
  return reasonMatch?.[1]?.trim();
}

function extractInstitution(content: string): string | undefined {
  const institutionPatterns = [
    /(?:from|at)\s+(University of [A-Z][a-z]+|[A-Z][a-z]+\s+University|MIT|Stanford|Harvard|Caltech|Berkeley)/i,
    /((?:[A-Z][a-z]+\s+)+(?:Institute|Laboratory|Lab|Center|Centre))/i,
  ];

  for (const pattern of institutionPatterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function createEmptyScientificFindings(
  claimedDiscovery?: string
): ScientificClaimVerificationFindings {
  return {
    claims: claimedDiscovery ? [{
      claim: claimedDiscovery,
      claimType: "other",
      status: "unverified",
      peerReviewStatus: "not_submitted",
      replicationStatus: "not_attempted",
      hasBeenRetracted: false,
      hasBeenDebunked: false,
      evidence: {
        supporting: [],
        contradicting: [],
      },
      sources: [],
    }] : [],
    overallStatus: "unverified",
    peerReviewedPapers: 0,
    preprints: 0,
    replicationStudies: [],
    retractions: [],
    redFlags: [{
      type: "no_evidence",
      severity: "high",
      description: "No scientific evidence found for this claim. Unable to verify.",
    }],
    overallConfidence: 0.1,
  };
}

/**
 * Detect if a query contains scientific claims that need verification
 */
export function detectScientificClaims(query: string): {
  hasScientificClaims: boolean;
  claimedDiscovery?: string;
  researchArea?: string;
} {
  const queryLower = query.toLowerCase();

  // Scientific breakthrough indicators
  const breakthroughPatterns = [
    /room[- ]?temperature\s+superconductor/i,
    /cold\s+fusion/i,
    /perpetual\s+motion/i,
    /free\s+energy/i,
    /quantum\s+(?:computer|computing)\s+(?:at\s+)?room\s+temp/i,
    /cure(?:s|d)?\s+(?:for\s+)?(?:cancer|alzheimer|diabetes)/i,
    /anti[- ]?aging\s+(?:breakthrough|discovery)/i,
    /revolutionary\s+(?:discovery|breakthrough|finding)/i,
    /world[- ]?first\s+(?:discovery|achievement)/i,
    /defies?\s+(?:physics|thermodynamics|science)/i,
    /100%\s+(?:efficient|effective)/i,
  ];

  // Check for breakthrough claims
  for (const pattern of breakthroughPatterns) {
    const match = query.match(pattern);
    if (match) {
      return {
        hasScientificClaims: true,
        claimedDiscovery: match[0],
        researchArea: extractResearchArea(query),
      };
    }
  }

  // Check for specific scientific terms that suggest claims
  const scientificTerms = [
    /LK-?99/i,
    /superconductor/i,
    /fusion\s+(?:energy|reactor)/i,
    /quantum\s+(?:supremacy|advantage)/i,
    /gene\s+therapy\s+cures/i,
    /stem\s+cell\s+breakthrough/i,
    /nanotechnology\s+breakthrough/i,
  ];

  for (const pattern of scientificTerms) {
    if (pattern.test(query)) {
      const match = query.match(pattern);
      return {
        hasScientificClaims: true,
        claimedDiscovery: match?.[0],
        researchArea: extractResearchArea(query),
      };
    }
  }

  return { hasScientificClaims: false };
}

function extractResearchArea(query: string): string | undefined {
  const areas = [
    { pattern: /superconductor|superconductivity/i, area: "Condensed Matter Physics" },
    { pattern: /fusion/i, area: "Nuclear Physics" },
    { pattern: /quantum/i, area: "Quantum Physics" },
    { pattern: /gene|genetic|crispr/i, area: "Genetics" },
    { pattern: /cancer|tumor/i, area: "Oncology" },
    { pattern: /drug|pharmaceutical/i, area: "Pharmacology" },
    { pattern: /nano/i, area: "Nanotechnology" },
    { pattern: /ai|artificial intelligence|machine learning/i, area: "AI/ML" },
  ];

  for (const { pattern, area } of areas) {
    if (pattern.test(query)) {
      return area;
    }
  }
  return undefined;
}
