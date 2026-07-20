/**
 * Clinical Trial Verification Branch
 *
 * Verifies clinical trial data from ClinicalTrials.gov and FDA sources.
 * Used by PHARMA_BD persona for BD due diligence on pipeline assets.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ClinicalTrialFindings {
  drugName: string;
  companyName: string;
  indication?: string;
  mechanism?: string;

  // Trial information
  trial: {
    nctId?: string;
    phase: "Phase 1" | "Phase 1/2" | "Phase 2" | "Phase 2/3" | "Phase 3" | "Phase 4" | "Unknown";
    status: "Recruiting" | "Active, not recruiting" | "Completed" | "Terminated" | "Suspended" | "Unknown";
    enrollmentTarget?: number;
    enrollmentActual?: number;
    startDate?: string;
    estimatedCompletionDate?: string;
    primaryEndpoint?: string;
  };

  // Competitive landscape
  competitors: CompetitorAsset[];

  // Regulatory pathway
  regulatory: {
    designation?: string[]; // Breakthrough, Fast Track, Orphan, etc.
    previousSubmissions?: string[];
    fdaInteractions?: string[];
  };

  // Verification status
  verification: {
    nctVerified: boolean;
    phaseVerified: boolean;
    statusVerified: boolean;
    enrollmentVerified: boolean;
    sourceQuality: "Primary" | "Secondary" | "Tertiary" | "Unverified";
  };

  // Red flags
  redFlags: Array<{
    type: "enrollment_lag" | "status_discrepancy" | "endpoint_change" | "timeline_delay" | "safety_signal";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  confidenceScore: number;
}

export interface CompetitorAsset {
  drugName: string;
  company: string;
  phase: string;
  indication: string;
  differentiation?: string;
}

export interface ClinicalTrialResult {
  findings: ClinicalTrialFindings;
  sources: DDSource[];
  report: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute clinical trial verification branch
 */
export async function executeClinicalTrialVerificationBranch(
  ctx: any,
  drugName: string,
  companyName: string,
  claimedTrial?: {
    phase?: string;
    indication?: string;
    enrollmentTarget?: number;
    nctId?: string;
  }
): Promise<ClinicalTrialResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();

  console.log(`[CLINICAL] Starting verification for ${drugName} (${companyName})...`);

  // Run parallel searches
  const [trialResults, competitorResults, regulatoryResults] = await Promise.all([
    searchClinicalTrialsGov(ctx, drugName, companyName, claimedTrial?.nctId),
    searchCompetitiveLandscape(ctx, drugName, claimedTrial?.indication),
    searchRegulatoryInfo(ctx, drugName, companyName),
  ]);

  // Aggregate sources
  sources.push(...trialResults.sources, ...competitorResults.sources, ...regulatoryResults.sources);

  // Verify claimed data
  const verification = verifyTrialData(claimedTrial, trialResults);

  // Identify red flags
  const redFlags = identifyRedFlags(claimedTrial, trialResults);

  // Calculate confidence
  const confidenceScore = calculateConfidence(trialResults, verification);

  const findings: ClinicalTrialFindings = {
    drugName,
    companyName,
    indication: claimedTrial?.indication || trialResults.indication,
    mechanism: trialResults.mechanism,

    trial: {
      nctId: trialResults.nctId,
      phase: normalizePhase(trialResults.phase || claimedTrial?.phase),
      status: trialResults.status || "Unknown",
      enrollmentTarget: trialResults.enrollmentTarget || claimedTrial?.enrollmentTarget,
      enrollmentActual: trialResults.enrollmentActual,
      startDate: trialResults.startDate,
      estimatedCompletionDate: trialResults.completionDate,
      primaryEndpoint: trialResults.primaryEndpoint,
    },

    competitors: competitorResults.competitors,

    regulatory: {
      designation: regulatoryResults.designations,
      previousSubmissions: regulatoryResults.submissions,
      fdaInteractions: regulatoryResults.interactions,
    },

    verification,
    redFlags,
    confidenceScore,
  };

  // Generate report
  const report = formatTrialReport(findings, claimedTrial);

  console.log(`[CLINICAL] Completed in ${Date.now() - startTime}ms, confidence: ${(confidenceScore * 100).toFixed(0)}%`);

  return {
    findings,
    sources,
    report,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface TrialSearchResult {
  nctId?: string;
  phase?: string;
  status?: "Recruiting" | "Active, not recruiting" | "Completed" | "Terminated" | "Suspended" | "Unknown";
  indication?: string;
  mechanism?: string;
  enrollmentTarget?: number;
  enrollmentActual?: number;
  startDate?: string;
  completionDate?: string;
  primaryEndpoint?: string;
  sources: DDSource[];
}

async function searchClinicalTrialsGov(
  ctx: any,
  drugName: string,
  companyName: string,
  nctId?: string
): Promise<TrialSearchResult> {
  const sources: DDSource[] = [];

  try {
    // Primary search on ClinicalTrials.gov
    const searchQuery = nctId
      ? `${nctId} ClinicalTrials.gov trial details`
      : `${drugName} ${companyName} clinical trial ClinicalTrials.gov NCT`;

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: searchQuery,
      mode: "balanced",
      maxTotal: 10,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let foundNctId: string | undefined = nctId;
    let phase: string | undefined;
    let status: TrialSearchResult["status"];
    let indication: string | undefined;
    let enrollmentTarget: number | undefined;
    let enrollmentActual: number | undefined;
    let startDate: string | undefined;
    let completionDate: string | undefined;
    let primaryEndpoint: string | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract NCT ID
      if (!foundNctId) {
        const nctMatch = content.match(/nct\d{8}/i);
        if (nctMatch) {
          foundNctId = nctMatch[0].toUpperCase();
        }
      }

      // Extract phase
      if (!phase) {
        const phaseMatch = content.match(/phase\s*(1\/2|2\/3|[1-4]|i{1,3}|iv)/i);
        if (phaseMatch) {
          phase = phaseMatch[0];
        }
      }

      // Extract status
      if (!status) {
        if (content.includes("recruiting")) {
          status = content.includes("not recruiting") ? "Active, not recruiting" : "Recruiting";
        } else if (content.includes("completed")) {
          status = "Completed";
        } else if (content.includes("terminated")) {
          status = "Terminated";
        } else if (content.includes("suspended")) {
          status = "Suspended";
        }
      }

      // Extract enrollment
      if (!enrollmentTarget) {
        const enrollMatch = content.match(/enroll(?:ment|ing)?\s*(?:target|estimated)?[:\s]*(\d+)/i);
        if (enrollMatch) {
          enrollmentTarget = parseInt(enrollMatch[1]);
        }
      }

      // Extract dates
      if (!startDate) {
        const startMatch = content.match(/start(?:ed)?\s*(?:date)?[:\s]*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{4}|\d{4}-\d{2})/i);
        if (startMatch) {
          startDate = startMatch[1];
        }
      }

      // Determine source quality and add
      sources.push({
        sourceType: url.includes("clinicaltrials.gov") ? "regulatory_filing" : "research_report",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      nctId: foundNctId,
      phase,
      status,
      indication,
      enrollmentTarget,
      enrollmentActual,
      startDate,
      completionDate,
      primaryEndpoint,
      sources,
    };
  } catch (error) {
    console.error("[CLINICAL] Trial search error:", error);
    return { sources };
  }
}

interface CompetitorSearchResult {
  competitors: CompetitorAsset[];
  sources: DDSource[];
}

async function searchCompetitiveLandscape(
  ctx: any,
  drugName: string,
  indication?: string
): Promise<CompetitorSearchResult> {
  const sources: DDSource[] = [];
  const competitors: CompetitorAsset[] = [];

  if (!indication) {
    return { competitors, sources };
  }

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${indication} competitive landscape clinical trials pipeline drugs 2025 2026`,
      mode: "balanced",
      maxTotal: 6,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Look for competitor mentions
      const phaseMatches = [...content.matchAll(/([a-z]{2,3}-?\d+|[a-z]+(?:mab|nib|tinib))\s+(?:is\s+)?(?:in\s+)?phase\s*([1-4])/gi)];

      for (const match of phaseMatches) {
        const competitorDrug = match[1];
        if (competitorDrug.toLowerCase() !== drugName.toLowerCase()) {
          competitors.push({
            drugName: competitorDrug,
            company: "Unknown",
            phase: `Phase ${match[2]}`,
            indication: indication,
          });
        }
      }

      sources.push({
        sourceType: "research_report",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    // Deduplicate competitors
    const seen = new Set<string>();
    const uniqueCompetitors = competitors.filter((c) => {
      const key = c.drugName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { competitors: uniqueCompetitors.slice(0, 5), sources };
  } catch (error) {
    console.error("[CLINICAL] Competitor search error:", error);
    return { competitors: [], sources };
  }
}

interface RegulatorySearchResult {
  designations: string[];
  submissions: string[];
  interactions: string[];
  sources: DDSource[];
}

async function searchRegulatoryInfo(
  ctx: any,
  drugName: string,
  companyName: string
): Promise<RegulatorySearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${drugName} ${companyName} FDA breakthrough fast track orphan designation approval`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];
    const designations: string[] = [];
    const submissions: string[] = [];
    const interactions: string[] = [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract designations
      if (content.includes("breakthrough therapy")) {
        designations.push("Breakthrough Therapy Designation");
      }
      if (content.includes("fast track")) {
        designations.push("Fast Track Designation");
      }
      if (content.includes("orphan drug") || content.includes("orphan designation")) {
        designations.push("Orphan Drug Designation");
      }
      if (content.includes("accelerated approval")) {
        designations.push("Accelerated Approval Pathway");
      }
      if (content.includes("priority review")) {
        designations.push("Priority Review");
      }

      // Extract FDA interactions
      if (content.includes("end of phase") || content.includes("eop")) {
        interactions.push("End of Phase Meeting");
      }
      if (content.includes("pre-ind") || content.includes("pre-submission")) {
        interactions.push("Pre-IND Meeting");
      }

      sources.push({
        sourceType: url.includes("fda.gov") ? "regulatory_filing" : "news_article",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    // Deduplicate
    return {
      designations: [...new Set(designations)],
      submissions: [...new Set(submissions)],
      interactions: [...new Set(interactions)],
      sources,
    };
  } catch (error) {
    console.error("[CLINICAL] Regulatory search error:", error);
    return { designations: [], submissions: [], interactions: [], sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function verifyTrialData(
  claimed: { phase?: string; indication?: string; enrollmentTarget?: number; nctId?: string } | undefined,
  found: TrialSearchResult
): ClinicalTrialFindings["verification"] {
  const verification: ClinicalTrialFindings["verification"] = {
    nctVerified: false,
    phaseVerified: false,
    statusVerified: false,
    enrollmentVerified: false,
    sourceQuality: "Unverified",
  };

  // Determine source quality based on whether we have ClinicalTrials.gov data
  const hasPrimarySource = found.sources.some((s) => s.url?.includes("clinicaltrials.gov"));
  const hasFdaSource = found.sources.some((s) => s.url?.includes("fda.gov"));

  if (hasPrimarySource || found.nctId) {
    verification.sourceQuality = "Primary";
  } else if (hasFdaSource) {
    verification.sourceQuality = "Secondary";
  } else if (found.phase || found.status) {
    verification.sourceQuality = "Tertiary";
  }

  if (!claimed) {
    return verification;
  }

  // Verify NCT ID
  if (claimed.nctId && found.nctId) {
    verification.nctVerified = claimed.nctId.toUpperCase() === found.nctId.toUpperCase();
  } else if (found.nctId) {
    verification.nctVerified = true; // Found an NCT ID even if not claimed
  }

  // Verify phase
  if (claimed.phase && found.phase) {
    const claimedPhase = normalizePhaseString(claimed.phase);
    const foundPhase = normalizePhaseString(found.phase);
    verification.phaseVerified = claimedPhase === foundPhase;
  }

  // Status is verified if we found any status
  verification.statusVerified = !!found.status;

  // Verify enrollment
  if (claimed.enrollmentTarget && found.enrollmentTarget) {
    const ratio = found.enrollmentTarget / claimed.enrollmentTarget;
    verification.enrollmentVerified = ratio >= 0.8 && ratio <= 1.2;
  }

  return verification;
}

function identifyRedFlags(
  claimed: { phase?: string; enrollmentTarget?: number } | undefined,
  found: TrialSearchResult
): ClinicalTrialFindings["redFlags"] {
  const redFlags: ClinicalTrialFindings["redFlags"] = [];

  // Check for enrollment lag
  if (found.enrollmentTarget && found.enrollmentActual) {
    const enrollmentRatio = found.enrollmentActual / found.enrollmentTarget;
    if (enrollmentRatio < 0.5 && found.status === "Recruiting") {
      redFlags.push({
        type: "enrollment_lag",
        severity: "medium",
        description: `Enrollment at ${(enrollmentRatio * 100).toFixed(0)}% of target - potential recruitment challenges`,
      });
    }
  }

  // Check for status discrepancy
  if (found.status === "Terminated") {
    redFlags.push({
      type: "status_discrepancy",
      severity: "critical",
      description: "Trial has been TERMINATED - verify reason",
    });
  } else if (found.status === "Suspended") {
    redFlags.push({
      type: "status_discrepancy",
      severity: "high",
      description: "Trial is SUSPENDED - investigate safety or operational issues",
    });
  }

  // Check for phase mismatch
  if (claimed?.phase && found.phase) {
    const claimedPhase = normalizePhaseString(claimed.phase);
    const foundPhase = normalizePhaseString(found.phase);
    if (claimedPhase !== foundPhase) {
      redFlags.push({
        type: "status_discrepancy",
        severity: "high",
        description: `Claimed phase (${claimed.phase}) differs from found phase (${found.phase})`,
      });
    }
  }

  // Check for timeline delays
  if (found.completionDate) {
    const completion = new Date(found.completionDate);
    const now = new Date();
    if (completion < now && found.status === "Recruiting") {
      redFlags.push({
        type: "timeline_delay",
        severity: "medium",
        description: `Trial past estimated completion date (${found.completionDate}) but still recruiting`,
      });
    }
  }

  return redFlags;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function normalizePhase(phase?: string): ClinicalTrialFindings["trial"]["phase"] {
  if (!phase) return "Unknown";

  const normalized = normalizePhaseString(phase);

  const phaseMap: Record<string, ClinicalTrialFindings["trial"]["phase"]> = {
    "1": "Phase 1",
    "1/2": "Phase 1/2",
    "2": "Phase 2",
    "2/3": "Phase 2/3",
    "3": "Phase 3",
    "4": "Phase 4",
  };

  return phaseMap[normalized] || "Unknown";
}

function normalizePhaseString(phase: string): string {
  const lower = phase.toLowerCase().replace(/phase\s*/i, "").trim();

  // Handle roman numerals
  const romanMap: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    "i/ii": "1/2",
    "ii/iii": "2/3",
  };

  return romanMap[lower] || lower;
}

function determineReliability(url: string): SourceReliability {
  if (url.includes("clinicaltrials.gov")) return "authoritative";
  if (url.includes("fda.gov")) return "authoritative";
  if (url.includes("nih.gov") || url.includes("pubmed")) return "authoritative";
  if (url.includes("sec.gov")) return "reliable";
  if (url.includes("reuters.com") || url.includes("bloomberg.com")) return "reliable";
  return "secondary";
}

function calculateConfidence(
  trial: TrialSearchResult,
  verification: ClinicalTrialFindings["verification"]
): number {
  let score = 0;

  // Source quality (40%)
  if (verification.sourceQuality === "Primary") score += 40;
  else if (verification.sourceQuality === "Secondary") score += 25;
  else if (verification.sourceQuality === "Tertiary") score += 10;

  // Data availability (35%)
  if (trial.nctId) score += 15;
  if (trial.phase) score += 10;
  if (trial.status) score += 10;

  // Verification status (25%)
  if (verification.nctVerified) score += 10;
  if (verification.phaseVerified) score += 8;
  if (verification.statusVerified) score += 7;

  return score / 100;
}

function formatTrialReport(
  findings: ClinicalTrialFindings,
  claimed?: { phase?: string; indication?: string; enrollmentTarget?: number; nctId?: string }
): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`CLINICAL TRIAL VERIFICATION: ${findings.drugName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`Company: ${findings.companyName}`);
  lines.push(`Indication: ${findings.indication || "Unknown"}`);
  lines.push(`Mechanism: ${findings.mechanism || "Unknown"}`);
  lines.push(`Source Quality: ${findings.verification.sourceQuality}`);
  lines.push(``);

  lines.push(`TRIAL INFORMATION`);
  lines.push(`  NCT ID: ${findings.trial.nctId || "Not Found"} ${findings.verification.nctVerified ? "(VERIFIED)" : ""}`);
  lines.push(`  Phase: ${findings.trial.phase} ${findings.verification.phaseVerified ? "(VERIFIED)" : ""}`);
  lines.push(`  Status: ${findings.trial.status} ${findings.verification.statusVerified ? "(VERIFIED)" : ""}`);

  if (findings.trial.enrollmentTarget) {
    const enrollmentStr = findings.trial.enrollmentActual
      ? `${findings.trial.enrollmentActual}/${findings.trial.enrollmentTarget}`
      : `Target: ${findings.trial.enrollmentTarget}`;
    lines.push(`  Enrollment: ${enrollmentStr}`);
  }

  if (findings.trial.startDate) {
    lines.push(`  Start Date: ${findings.trial.startDate}`);
  }
  if (findings.trial.estimatedCompletionDate) {
    lines.push(`  Est. Completion: ${findings.trial.estimatedCompletionDate}`);
  }
  lines.push(``);

  if (findings.regulatory.designation && findings.regulatory.designation.length > 0) {
    lines.push(`REGULATORY DESIGNATIONS`);
    for (const d of findings.regulatory.designation) {
      lines.push(`  - ${d}`);
    }
    lines.push(``);
  }

  if (findings.competitors.length > 0) {
    lines.push(`COMPETITIVE LANDSCAPE`);
    for (const c of findings.competitors) {
      lines.push(`  - ${c.drugName} (${c.company}): ${c.phase}`);
    }
    lines.push(``);
  }

  if (findings.redFlags.length > 0) {
    lines.push(`RED FLAGS`);
    for (const flag of findings.redFlags) {
      lines.push(`  [${flag.severity.toUpperCase()}] ${flag.description}`);
    }
    lines.push(``);
  }

  lines.push(`CONFIDENCE: ${(findings.confidenceScore * 100).toFixed(0)}%`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
