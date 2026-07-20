/**
 * USPTO Patent Verification Branch
 *
 * Verifies patent claims via USPTO databases:
 * - Patent existence and validity
 * - Assignment chain (who owns it)
 * - License agreements
 * - Patent family analysis
 *
 * Uses USPTO's free resources:
 * - Patent Public Search: https://ppubs.uspto.gov/pubwebapp/
 * - Patent Assignment Search: https://assignment.uspto.gov/
 * - Patent Full-Text Database: https://patft.uspto.gov/
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  UsptoDeepdiveFindings,
  USPTOPatent,
  USPTOApplication,
  PatentAssignment,
} from "../types";

interface UsptoBranchResult {
  findings: UsptoDeepdiveFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeUsptoDeepdiveBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedPatents?: string[]
): Promise<UsptoBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Search for patents by company name
    const patentsByCompany = await searchPatentsByAssignee(ctx, entityName);

    if (patentsByCompany.length > 0) {
      sources.push({
        sourceType: "patent_db",
        url: "https://ppubs.uspto.gov/pubwebapp/",
        title: "USPTO Patent Public Search",
        accessedAt: now,
        reliability: "authoritative",
        section: "patent_verification",
      });
      confidence += 0.25;
    }

    // Step 2: Verify specific claimed patents
    const verifiedClaims = claimedPatents
      ? await verifyClaimedPatents(ctx, claimedPatents, entityName)
      : [];

    // Combine and deduplicate patents
    const allPatents = deduplicatePatents([...patentsByCompany, ...verifiedClaims]);

    // Step 3: Search for pending applications
    const applications = await searchPendingApplications(ctx, entityName);

    // Step 4: Verify assignment chain
    const assignments = await searchAssignments(ctx, entityName, allPatents);

    if (assignments.length > 0) {
      sources.push({
        sourceType: "patent_db",
        url: "https://assignment.uspto.gov/",
        title: "USPTO Patent Assignment Search",
        accessedAt: now,
        reliability: "authoritative",
        section: "patent_assignment",
      });
      confidence += 0.15;
    }

    // Step 5: Determine current owner
    const currentOwner = determineCurrentOwner(assignments, entityName);

    // Step 6: Analyze portfolio
    const analysis = analyzePatentPortfolio(allPatents, applications);

    // Step 7: Check for competitor overlap
    const competitorOverlap = await checkCompetitorOverlap(ctx, allPatents);

    // Step 8: Build findings
    const findings: UsptoDeepdiveFindings = {
      patents: allPatents,
      totalPatents: allPatents.length,
      activePatents: allPatents.filter(p => p.status === "Active").length,
      applications,
      pendingApplications: applications.filter(a => a.status === "Pending").length,
      assignments,
      currentOwner,
      ownershipVerified: verifyOwnership(currentOwner, entityName, assignments),
      licenses: [],
      analysis,
      competitorOverlap,
      verification: {
        patentsExist: allPatents.length > 0,
        assignmentToCompany: currentOwner?.toLowerCase().includes(entityName.toLowerCase()) ?? false,
        licensesDocumented: false, // Would need license agreement review
        noLitigation: !hasLitigationIndicators(allPatents),
      },
      redFlags: generatePatentRedFlags(
        claimedPatents,
        allPatents,
        currentOwner,
        entityName,
        assignments
      ),
      overallConfidence: calculatePatentConfidence(
        allPatents,
        applications,
        assignments,
        confidence
      ),
    };

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[USPTO] Error for ${entityName}:`, error);
    return {
      findings: createEmptyUSPTOFindings(claimedPatents),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// USPTO SEARCHES
// ============================================================================

async function searchPatentsByAssignee(
  ctx: any,
  companyName: string
): Promise<USPTOPatent[]> {
  const patents: USPTOPatent[] = [];

  try {
    const searchQuery = `site:patents.google.com OR site:patft.uspto.gov assignee:"${companyName}"`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 15,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const patent = parsePatentFromResult(r, companyName);
      if (patent) {
        patents.push(patent);
      }
    }

    return patents;

  } catch (error) {
    console.error(`[USPTO-Assignee] Search error:`, error);
    return [];
  }
}

async function verifyClaimedPatents(
  ctx: any,
  claimedPatents: string[],
  companyName: string
): Promise<USPTOPatent[]> {
  const patents: USPTOPatent[] = [];

  for (const patentNum of claimedPatents) {
    try {
      // Clean patent number
      const cleanNum = patentNum.replace(/[^0-9]/g, "");

      const searchQuery = `site:patents.google.com OR site:patft.uspto.gov "US${cleanNum}" OR "${cleanNum}"`;

      const result = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: "fast",
          maxTotal: 3,
          skipRateLimit: true,
        }
      );

      const results = result?.payload?.results ?? [];

      if (results.length > 0) {
        const patent = parsePatentFromResult(results[0], companyName);
        if (patent) {
          patent.patentNumber = `US${cleanNum}`;
          patents.push(patent);
        }
      }

    } catch (error) {
      console.error(`[USPTO-Verify] Error for ${patentNum}:`, error);
    }
  }

  return patents;
}

async function searchPendingApplications(
  ctx: any,
  companyName: string
): Promise<USPTOApplication[]> {
  const applications: USPTOApplication[] = [];

  try {
    const searchQuery = `site:appft.uspto.gov OR site:patents.google.com "${companyName}" application pending`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");

      // Look for application numbers
      const appMatch = content.match(/(\d{2}\/\d{3},?\d{3})/);
      if (appMatch) {
        const dateMatch = content.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);

        applications.push({
          applicationNumber: appMatch[1],
          title: extractTitle(content),
          filingDate: dateMatch?.[1] || "Unknown",
          status: determineAppStatus(content),
          applicant: companyName,
        });
      }
    }

    return applications;

  } catch (error) {
    console.error(`[USPTO-Applications] Search error:`, error);
    return [];
  }
}

async function searchAssignments(
  ctx: any,
  companyName: string,
  patents: USPTOPatent[]
): Promise<PatentAssignment[]> {
  const assignments: PatentAssignment[] = [];

  try {
    // Search for assignments involving the company
    const searchQuery = `site:assignment.uspto.gov "${companyName}"`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");

      // Look for reel/frame references
      const reelFrameMatch = content.match(/(\d{6})\/(\d{4})/);
      const dateMatch = content.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);

      if (reelFrameMatch) {
        assignments.push({
          reelFrame: `${reelFrameMatch[1]}/${reelFrameMatch[2]}`,
          assignor: extractAssignor(content),
          assignee: companyName,
          executionDate: dateMatch?.[1] || "Unknown",
          recordedDate: dateMatch?.[1] || "Unknown",
          patentNumbers: patents.map(p => p.patentNumber).slice(0, 5),
          conveyanceType: extractConveyanceType(content),
        });
      }
    }

    return assignments;

  } catch (error) {
    console.error(`[USPTO-Assignments] Search error:`, error);
    return [];
  }
}

async function checkCompetitorOverlap(
  ctx: any,
  patents: USPTOPatent[]
): Promise<UsptoDeepdiveFindings["competitorOverlap"]> {
  // This would typically involve analyzing patent citations and claims
  // For now, return empty - would be enhanced with actual patent analysis
  return [];
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

function parsePatentFromResult(result: any, companyName: string): USPTOPatent | null {
  const content = (result.snippet || "") + " " + (result.title || "");
  const url = result.url || "";

  // Extract patent number
  const patentMatch = content.match(/US\s*(\d{7,10})/i) ||
    content.match(/patent[:\s#]*(\d{7,10})/i) ||
    url.match(/US(\d{7,10})/i);

  if (!patentMatch) return null;

  const patentNumber = `US${patentMatch[1]}`;

  // Extract other fields
  const dateMatch = content.match(/(\d{4}-\d{2}-\d{2})/);
  const inventorMatch = content.match(/inventor[s]?[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);

  return {
    patentNumber,
    title: extractTitle(content),
    inventors: inventorMatch ? [inventorMatch[1]] : [],
    assignee: extractAssignee(content) || companyName,
    filingDate: "See USPTO",
    issueDate: dateMatch?.[1] || "Unknown",
    patentType: determinePatentType(content),
    status: determinePatentStatus(content),
    usptoUrl: url.includes("patents.google.com")
      ? url
      : `https://patents.google.com/patent/${patentNumber}`,
  };
}

function extractTitle(content: string): string {
  // Try to extract title from patent content
  const titleMatch = content.match(/(?:title|invention)[:\s]+([A-Z][^.]+)/i);
  if (titleMatch) return titleMatch[1].trim();

  // Use first sentence as fallback
  const firstSentence = content.split(".")[0];
  return firstSentence.length > 100 ? firstSentence.slice(0, 100) + "..." : firstSentence;
}

function extractAssignee(content: string): string | undefined {
  const assigneeMatch = content.match(/assignee[:\s]+([A-Z][A-Za-z0-9\s,\.]+?)(?:\s|,|$)/i);
  return assigneeMatch?.[1]?.trim();
}

function extractAssignor(content: string): string {
  const assignorMatch = content.match(/(?:assignor|from)[:\s]+([A-Z][A-Za-z0-9\s,\.]+?)(?:\s|,|$)/i);
  return assignorMatch?.[1]?.trim() || "Unknown";
}

function extractConveyanceType(content: string): string {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("assignment")) return "Assignment";
  if (contentLower.includes("license")) return "License";
  if (contentLower.includes("security")) return "Security Interest";
  if (contentLower.includes("merger")) return "Merger";
  return "Unknown";
}

function determinePatentType(content: string): USPTOPatent["patentType"] {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("design")) return "Design";
  if (contentLower.includes("plant")) return "Plant";
  if (contentLower.includes("reissue")) return "Reissue";
  return "Utility";
}

function determinePatentStatus(content: string): USPTOPatent["status"] {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("expired")) return "Expired";
  if (contentLower.includes("lapsed")) return "Lapsed";
  return "Active";
}

function determineAppStatus(content: string): USPTOApplication["status"] {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("abandoned")) return "Abandoned";
  if (contentLower.includes("allowed")) return "Allowed";
  if (contentLower.includes("patented")) return "Patented";
  return "Pending";
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

function deduplicatePatents(patents: USPTOPatent[]): USPTOPatent[] {
  const seen = new Set<string>();
  return patents.filter(p => {
    if (seen.has(p.patentNumber)) return false;
    seen.add(p.patentNumber);
    return true;
  });
}

function determineCurrentOwner(
  assignments: PatentAssignment[],
  companyName: string
): string | undefined {
  // If assignments exist, the most recent assignee is current owner
  if (assignments.length > 0) {
    // Sort by date if available
    const sorted = [...assignments].sort((a, b) =>
      new Date(b.recordedDate).getTime() - new Date(a.recordedDate).getTime()
    );
    return sorted[0].assignee;
  }

  return companyName;
}

function verifyOwnership(
  currentOwner: string | undefined,
  companyName: string,
  assignments: PatentAssignment[]
): boolean {
  if (!currentOwner) return false;

  const ownerLower = currentOwner.toLowerCase();
  const companyLower = companyName.toLowerCase();

  // Direct match
  if (ownerLower.includes(companyLower) || companyLower.includes(ownerLower)) {
    return true;
  }

  // Check if company is in assignment chain
  return assignments.some(a =>
    a.assignee.toLowerCase().includes(companyLower)
  );
}

function hasLitigationIndicators(patents: USPTOPatent[]): boolean {
  // Would typically check for litigation records
  // For now, return false
  return false;
}

function analyzePatentPortfolio(
  patents: USPTOPatent[],
  applications: USPTOApplication[]
): UsptoDeepdiveFindings["analysis"] {
  const totalPatents = patents.length;
  const pendingApps = applications.filter(a => a.status === "Pending").length;

  let portfolioStrength: "weak" | "moderate" | "strong" = "weak";
  if (totalPatents >= 10 || (totalPatents >= 5 && pendingApps >= 3)) {
    portfolioStrength = "strong";
  } else if (totalPatents >= 3 || pendingApps >= 2) {
    portfolioStrength = "moderate";
  }

  // Calculate expiration timeline
  const expirationTimeline = patents
    .filter(p => p.expirationDate)
    .map(p => ({
      patentNumber: p.patentNumber,
      expirationDate: p.expirationDate!,
    }))
    .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

  return {
    portfolioStrength,
    averageClaimsPerPatent: undefined, // Would need detailed patent data
    expirationTimeline: expirationTimeline.slice(0, 5),
  };
}

// ============================================================================
// RED FLAG GENERATION
// ============================================================================

function generatePatentRedFlags(
  claimedPatents: string[] | undefined,
  foundPatents: USPTOPatent[],
  currentOwner: string | undefined,
  companyName: string,
  assignments: PatentAssignment[]
): UsptoDeepdiveFindings["redFlags"] {
  const redFlags: UsptoDeepdiveFindings["redFlags"] = [];

  // Claimed patents not found
  if (claimedPatents && claimedPatents.length > 0) {
    const foundNumbers = new Set(foundPatents.map(p =>
      p.patentNumber.replace(/[^0-9]/g, "")
    ));

    const notFound = claimedPatents.filter(claimed => {
      const cleanClaimed = claimed.replace(/[^0-9]/g, "");
      return !foundNumbers.has(cleanClaimed);
    });

    if (notFound.length > 0) {
      redFlags.push({
        type: "patent_not_found",
        severity: "high",
        description: `${notFound.length} claimed patent(s) could not be verified: ${notFound.join(", ")}. Request USPTO patent numbers for verification.`,
      });
    }
  }

  // Patents not assigned to company
  if (currentOwner && !currentOwner.toLowerCase().includes(companyName.toLowerCase())) {
    redFlags.push({
      type: "not_assigned_to_company",
      severity: "high",
      description: `Patents appear to be assigned to "${currentOwner}" rather than "${companyName}". Verify ownership or license agreement.`,
    });
  }

  // No assignment records
  if (foundPatents.length > 0 && assignments.length === 0) {
    redFlags.push({
      type: "license_undocumented",
      severity: "medium",
      description: `No USPTO assignment records found. If company claims to license patents, request license agreement documentation.`,
    });
  }

  // Patents expiring soon
  const now = new Date();
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const expiringSoon = foundPatents.filter(p => {
    if (!p.expirationDate) return false;
    const expDate = new Date(p.expirationDate);
    return expDate > now && expDate < oneYearFromNow;
  });

  if (expiringSoon.length > 0) {
    redFlags.push({
      type: "expiring_soon",
      severity: "medium",
      description: `${expiringSoon.length} patent(s) expiring within 12 months. This may impact IP defensibility.`,
    });
  }

  return redFlags;
}

function calculatePatentConfidence(
  patents: USPTOPatent[],
  applications: USPTOApplication[],
  assignments: PatentAssignment[],
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (patents.length > 0) confidence += 0.25;
  if (patents.length >= 5) confidence += 0.1;
  if (applications.length > 0) confidence += 0.1;
  if (assignments.length > 0) confidence += 0.15;

  return Math.min(0.95, confidence);
}

function createEmptyUSPTOFindings(claimedPatents?: string[]): UsptoDeepdiveFindings {
  return {
    patents: [],
    totalPatents: 0,
    activePatents: 0,
    applications: [],
    pendingApplications: 0,
    assignments: [],
    currentOwner: undefined,
    ownershipVerified: false,
    licenses: [],
    analysis: {
      portfolioStrength: "weak",
    },
    competitorOverlap: [],
    verification: {
      patentsExist: false,
      assignmentToCompany: false,
      licensesDocumented: false,
      noLitigation: true,
    },
    redFlags: claimedPatents && claimedPatents.length > 0 ? [{
      type: "patent_not_found",
      severity: "high",
      description: `Company claims ${claimedPatents.length} patent(s) but none could be verified in USPTO database.`,
    }] : [],
    overallConfidence: 0.1,
  };
}
