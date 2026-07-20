/**
 * FDA Verification Branch
 *
 * Verifies FDA regulatory status for medical devices and products:
 * - 510(k) clearance verification (actual approval)
 * - Establishment registration & device listing (NOT the same as clearance!)
 * - PMA (Pre-Market Approval) for Class III devices
 * - Adverse events (MAUDE database)
 * - Recalls
 *
 * CRITICAL: "FDA Cleared" ≠ "FDA Registered"
 * Many companies misrepresent "registered/listed" as "cleared"
 *
 * Uses FDA's free APIs:
 * - 510(k) database: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm
 * - Registration & Listing: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfrl/textsearch.cfm
 * - MAUDE (adverse events): https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/search.CFM
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  FdaVerificationFindings,
  FDAStatus,
  FDA510kClearance,
  FDAPMAApproval,
  FDABLAApproval,
  FDANDAApproval,
  FDARegistration,
  FDADeviceListing,
  FDAAdverseEvent,
  FDARecall,
} from "../types";

interface FdaVerificationBranchResult {
  findings: FdaVerificationFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeFdaVerificationBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedStatus?: string,
  deviceName?: string
): Promise<FdaVerificationBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Search for 510(k) clearances
    const clearances = await search510kClearances(ctx, entityName, deviceName);

    // Step 2: Search for establishment registration & device listing
    const { registrations, listings } = await searchRegistrationAndListing(
      ctx,
      entityName,
      deviceName
    );

    // Step 3: Search for PMA approvals (Class III devices)
    const pmaApprovals = await searchPMAApprovals(ctx, entityName, deviceName);

    // Step 3.5: Search for BLA approvals (biologics: vaccines, gene therapy)
    const blaApprovals = await searchBLAApprovals(ctx, entityName, deviceName);

    // Step 3.6: Search for NDA approvals (pharmaceutical drugs)
    const ndaApprovals = await searchNDAApprovals(ctx, entityName, deviceName);

    // Step 4: Check for adverse events
    const adverseEvents = await searchAdverseEvents(ctx, entityName, deviceName);

    // Step 5: Check for recalls
    const recalls = await searchRecalls(ctx, entityName, deviceName);

    // Step 5.5: Filter FDA results to only include verified company matches
    // This prevents false positives from generic web search results
    // Filter all FDA results to only include verified company name matches
    // CRITICAL: Pass companyName as the search query to exclude from matching
    const verifiedClearances = filterVerifiedMatches(clearances, entityName, "applicant", entityName);
    const verifiedRegistrations = filterVerifiedMatches(registrations, entityName, "firmName", entityName);
    const verifiedListings = filterVerifiedMatches(listings, entityName, "deviceName", entityName);
    const verifiedPMAs = filterVerifiedMatches(pmaApprovals, entityName, "applicant", entityName);

    const verifiedBLAs = filterVerifiedMatches(blaApprovals, entityName, "applicant", entityName);
    const verifiedNDAs = filterVerifiedMatches(ndaApprovals, entityName, "applicant", entityName);

    // CRITICAL: If company name is a unique/made-up name, no FDA records should match
    // For names like "MyDentalWig" - there should be NO verified clearances unless
    // the EXACT company (or close variant) appears in FDA records
    console.error(`[FDA-Verification] Company: ${entityName}`);
    console.error(`[FDA-Verification] Raw clearances found: ${clearances.length}, Verified: ${verifiedClearances.length}`);
    console.error(`[FDA-Verification] Raw registrations found: ${registrations.length}, Verified: ${verifiedRegistrations.length}`);
    console.error(`[FDA-Verification] Raw BLAs found: ${blaApprovals.length}, Verified: ${verifiedBLAs.length}`);
    console.error(`[FDA-Verification] Raw NDAs found: ${ndaApprovals.length}, Verified: ${verifiedNDAs.length}`);
    console.error(`[FDA-Verification] Claimed Status: ${claimedStatus}`);

    // DEBUG: Log first clearance applicant if any
    if (clearances.length > 0) {
      console.error(`[FDA-Verification] First raw clearance applicant: "${clearances[0].applicant}"`);
    }
    if (verifiedClearances.length > 0) {
      console.error(`[FDA-Verification] First verified clearance applicant: "${verifiedClearances[0].applicant}"`);
    }

    // Step 5.6: ONLY boost confidence and add sources if VERIFIED matches found
    if (verifiedClearances.length > 0) {
      sources.push({
        sourceType: "sec_filing", // Using closest available type
        url: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm",
        title: "FDA 510(k) Premarket Notification Database",
        accessedAt: now,
        reliability: "authoritative",
        section: "fda_verification",
      });
      confidence += 0.3;
    }

    if (verifiedRegistrations.length > 0 || verifiedListings.length > 0) {
      sources.push({
        sourceType: "sec_filing",
        url: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfrl/textsearch.cfm",
        title: "FDA Establishment Registration & Device Listing",
        accessedAt: now,
        reliability: "authoritative",
        section: "fda_registration",
      });
      confidence += 0.15;
    }

    // Add BLA source if found
    if (verifiedBLAs.length > 0) {
      sources.push({
        sourceType: "sec_filing",
        url: "https://www.accessdata.fda.gov/scripts/cder/daf/",
        title: "FDA Drugs@FDA - Biologics License Applications",
        accessedAt: now,
        reliability: "authoritative",
        section: "fda_bla",
      });
      confidence += 0.3;
    }

    // Add NDA source if found
    if (verifiedNDAs.length > 0) {
      sources.push({
        sourceType: "sec_filing",
        url: "https://www.accessdata.fda.gov/scripts/cder/daf/",
        title: "FDA Drugs@FDA - New Drug Applications",
        accessedAt: now,
        reliability: "authoritative",
        section: "fda_nda",
      });
      confidence += 0.3;
    }

    // Step 6: Determine actual FDA status (using VERIFIED matches only)
    const actualStatus = determineFDAStatus(
      verifiedClearances,
      verifiedPMAs,
      verifiedBLAs,
      verifiedNDAs,
      verifiedRegistrations,
      verifiedListings
    );

    console.log(`[FDA-Verification] Actual Status: ${actualStatus}`);

    // Step 7: Build findings (using VERIFIED matches)
    const findings: FdaVerificationFindings = {
      claimedStatus,
      actualStatus,
      statusMatchesClaims: checkStatusMatch(claimedStatus, actualStatus),
      clearances: verifiedClearances, // Use verified matches
      hasClearance: verifiedClearances.length > 0,
      pmaApprovals: verifiedPMAs,
      hasPMA: verifiedPMAs.length > 0,
      blaApprovals: verifiedBLAs,
      hasBLA: verifiedBLAs.length > 0,
      ndaApprovals: verifiedNDAs,
      hasNDA: verifiedNDAs.length > 0,
      registrations: verifiedRegistrations,
      deviceListings: verifiedListings,
      isRegistered: verifiedRegistrations.length > 0,
      isListed: verifiedListings.length > 0,
      adverseEvents: adverseEvents.slice(0, 10),
      recalls,
      hasAdverseEvents: adverseEvents.length > 0,
      hasRecalls: recalls.length > 0,
      verification: {
        statusVerified: actualStatus !== "Not Found",
        clearanceMatchesClaims: checkClearanceMatchesClaims(
          claimedStatus,
          verifiedClearances,
          verifiedRegistrations,
          verifiedBLAs,
          verifiedNDAs
        ),
        noActiveRecalls: !recalls.some(r => r.recallStatus === "Ongoing"),
        noSeriousAdverseEvents: !adverseEvents.some(e =>
          e.patientOutcome?.toLowerCase().includes("death") ||
          e.patientOutcome?.toLowerCase().includes("life-threatening")
        ),
        facilityInGoodStanding: verifiedRegistrations.every(r => r.status === "Active"),
      },
      redFlags: generateFDARedFlags(
        claimedStatus,
        actualStatus,
        verifiedClearances,
        verifiedRegistrations,
        verifiedBLAs,
        verifiedNDAs,
        recalls,
        adverseEvents
      ),
      overallConfidence: calculateFDAConfidence(
        verifiedClearances,
        verifiedRegistrations,
        verifiedListings,
        verifiedBLAs,
        verifiedNDAs,
        confidence
      ),
    };

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[FDA-Verification] Error for ${entityName}:`, error);
    return {
      findings: createEmptyFDAFindings(claimedStatus),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// FDA DATABASE SEARCHES
// ============================================================================

async function search510kClearances(
  ctx: any,
  companyName: string,
  deviceName?: string
): Promise<FDA510kClearance[]> {
  const clearances: FDA510kClearance[] = [];

  try {
    // Search FDA 510(k) database via web search
    const searchQuery = deviceName
      ? `site:accessdata.fda.gov 510(k) "${companyName}" "${deviceName}"`
      : `site:accessdata.fda.gov 510(k) "${companyName}"`;

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

      // Look for K-numbers (510(k) identifiers)
      const kNumberMatch = content.match(/K(\d{6})/i);
      if (kNumberMatch) {
        const kNumber = `K${kNumberMatch[1]}`;

        // Extract decision date
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);

        // Check decision
        const isCleared = content.toLowerCase().includes("substantially equivalent") ||
          content.toLowerCase().includes("se decision") ||
          !content.toLowerCase().includes("not substantially equivalent");

        // Extract actual applicant name from content (NOT the search query company name)
        const extractedApplicant = extractApplicantName(content) || "Unknown Applicant";

        clearances.push({
          kNumber,
          deviceName: deviceName || extractDeviceName(content),
          applicant: extractedApplicant,  // Use extracted name, not search query
          dateReceived: "See FDA database",
          decisionDate: dateMatch?.[1] || "Unknown",
          decision: isCleared ? "Substantially Equivalent" : "Not Substantially Equivalent",
          productCode: extractProductCode(content),
        });

        console.log(`[FDA-510k] Found clearance ${kNumber}, applicant: ${extractedApplicant}`);
      }
    }

    // Deduplicate by K-number
    const seen = new Set<string>();
    return clearances.filter(c => {
      if (seen.has(c.kNumber)) return false;
      seen.add(c.kNumber);
      return true;
    });

  } catch (error) {
    console.error(`[FDA-510k] Search error:`, error);
    return [];
  }
}

async function searchRegistrationAndListing(
  ctx: any,
  companyName: string,
  deviceName?: string
): Promise<{
  registrations: FDARegistration[];
  listings: FDADeviceListing[];
}> {
  const registrations: FDARegistration[] = [];
  const listings: FDADeviceListing[] = [];

  try {
    const searchQuery = `site:accessdata.fda.gov "establishment registration" OR "device listing" "${companyName}"`;

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

      // Check for registration
      if (contentLower.includes("registration") || contentLower.includes("establishment")) {
        const regNumMatch = content.match(/(\d{7,10})/);
        if (regNumMatch) {
          // Extract actual firm name from content (NOT the search query)
          const extractedFirmName = extractFirmName(content) || "Unknown Firm";
          registrations.push({
            registrationNumber: regNumMatch[1],
            firmName: extractedFirmName,  // Use extracted name, not search query
            facilityType: extractFacilityType(content),
            address: "See FDA database",
            status: contentLower.includes("active") ? "Active" : "Inactive",
          });
          console.log(`[FDA-Reg] Found registration ${regNumMatch[1]}, firm: ${extractedFirmName}`);
        }
      }

      // Check for device listing
      if (contentLower.includes("listing") || contentLower.includes("device")) {
        const listingMatch = content.match(/listing[:\s#]*(\d+)/i);
        if (listingMatch) {
          listings.push({
            listingNumber: listingMatch[1],
            deviceName: deviceName || extractDeviceName(content),
            productCode: extractProductCode(content),
            regulationNumber: extractRegulationNumber(content),
            deviceClass: extractDeviceClass(content),
          });
        }
      }
    }

    return { registrations, listings };

  } catch (error) {
    console.error(`[FDA-Registration] Search error:`, error);
    return { registrations: [], listings: [] };
  }
}

async function searchPMAApprovals(
  ctx: any,
  companyName: string,
  deviceName?: string
): Promise<FDAPMAApproval[]> {
  const approvals: FDAPMAApproval[] = [];

  try {
    const searchQuery = `site:accessdata.fda.gov PMA "premarket approval" "${companyName}"`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");

      // Look for PMA numbers
      const pmaMatch = content.match(/P(\d{6})/i);
      if (pmaMatch) {
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);

        // Extract actual applicant from content
        const extractedApplicant = extractApplicantName(content) || "Unknown Applicant";
        approvals.push({
          pmaNumber: `P${pmaMatch[1]}`,
          deviceName: deviceName || extractDeviceName(content),
          applicant: extractedApplicant,  // Use extracted name, not search query
          approvalDate: dateMatch?.[1] || "Unknown",
          productCode: extractProductCode(content),
        });
        console.log(`[FDA-PMA] Found PMA P${pmaMatch[1]}, applicant: ${extractedApplicant}`);
      }
    }

    return approvals;

  } catch (error) {
    console.error(`[FDA-PMA] Search error:`, error);
    return [];
  }
}

/**
 * Search for BLA (Biologics License Application) approvals
 * Used for vaccines, gene therapy, blood products, etc.
 * Searches Drugs@FDA and Purple Book databases
 */
async function searchBLAApprovals(
  ctx: any,
  companyName: string,
  productName?: string
): Promise<FDABLAApproval[]> {
  const approvals: FDABLAApproval[] = [];

  try {
    // Search FDA Drugs@FDA database for BLA approvals
    const searchQuery = productName
      ? `site:accessdata.fda.gov "BLA" OR "biologics license" "${companyName}" "${productName}"`
      : `site:accessdata.fda.gov "BLA" OR "biologics license" "${companyName}"`;

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

      // Look for BLA numbers (e.g., BLA 125742)
      const blaMatch = content.match(/BLA\s*(\d{6})/i);
      if (blaMatch) {
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        const extractedApplicant = extractApplicantName(content) || "Unknown Applicant";

        approvals.push({
          blaNumber: `BLA ${blaMatch[1]}`,
          productName: productName || extractProductName(content),
          applicant: extractedApplicant,
          approvalDate: dateMatch?.[1] || "Unknown",
          activeIngredient: extractActiveIngredient(content),
          indication: extractIndication(content),
          isOriginalApproval: !content.toLowerCase().includes("supplement"),
        });
        console.log(`[FDA-BLA] Found BLA ${blaMatch[1]}, applicant: ${extractedApplicant}`);
      }
    }

    // Also search for company name + vaccine/biologic keywords
    const bioSearchQuery = `site:fda.gov "${companyName}" vaccine OR biologic approved BLA`;
    const bioResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: bioSearchQuery,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const bioResults = bioResult?.payload?.results ?? [];
    for (const r of bioResults) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const blaMatch = content.match(/BLA\s*(\d{6})/i);
      if (blaMatch && !approvals.some(a => a.blaNumber === `BLA ${blaMatch[1]}`)) {
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        const extractedApplicant = extractApplicantName(content) || "Unknown Applicant";

        approvals.push({
          blaNumber: `BLA ${blaMatch[1]}`,
          productName: productName || extractProductName(content),
          applicant: extractedApplicant,
          approvalDate: dateMatch?.[1] || "Unknown",
          activeIngredient: extractActiveIngredient(content),
          indication: extractIndication(content),
          isOriginalApproval: !content.toLowerCase().includes("supplement"),
        });
        console.log(`[FDA-BLA-Bio] Found BLA ${blaMatch[1]}, applicant: ${extractedApplicant}`);
      }
    }

    return approvals;

  } catch (error) {
    console.error(`[FDA-BLA] Search error:`, error);
    return [];
  }
}

/**
 * Search for NDA (New Drug Application) approvals
 * Used for pharmaceutical drugs
 */
async function searchNDAApprovals(
  ctx: any,
  companyName: string,
  productName?: string
): Promise<FDANDAApproval[]> {
  const approvals: FDANDAApproval[] = [];

  try {
    // Search FDA Drugs@FDA database for NDA approvals
    const searchQuery = productName
      ? `site:accessdata.fda.gov "NDA" OR "new drug application" "${companyName}" "${productName}"`
      : `site:accessdata.fda.gov "NDA" OR "new drug application" "${companyName}"`;

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

      // Look for NDA numbers (e.g., NDA 215510)
      const ndaMatch = content.match(/NDA\s*(\d{6})/i);
      if (ndaMatch) {
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        const extractedApplicant = extractApplicantName(content) || "Unknown Applicant";

        approvals.push({
          ndaNumber: `NDA ${ndaMatch[1]}`,
          productName: productName || extractProductName(content),
          applicant: extractedApplicant,
          approvalDate: dateMatch?.[1] || "Unknown",
          activeIngredient: extractActiveIngredient(content),
          indication: extractIndication(content),
          isOriginalApproval: !content.toLowerCase().includes("supplement"),
        });
        console.log(`[FDA-NDA] Found NDA ${ndaMatch[1]}, applicant: ${extractedApplicant}`);
      }
    }

    return approvals;

  } catch (error) {
    console.error(`[FDA-NDA] Search error:`, error);
    return [];
  }
}

/**
 * Extract product name from FDA content
 */
function extractProductName(content: string): string {
  const patterns = [
    /(?:product|drug|vaccine|biologic)[:\s]+([A-Za-z][A-Za-z0-9\s-]+?)(?:\s+(?:BLA|NDA|by|from)|$)/i,
    /([A-Z][a-z]+(?:-[A-Z][a-z]+)?)(?:\s+(?:vaccine|injection|solution))/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1] && match[1].length > 2) {
      return match[1].trim();
    }
  }

  return "Unknown Product";
}

/**
 * Extract active ingredient from FDA content
 */
function extractActiveIngredient(content: string): string | undefined {
  const match = content.match(/(?:active ingredient|contains)[:\s]+([A-Za-z0-9\s-]+?)(?:\s+(?:mg|mcg|is|for)|$)/i);
  return match?.[1]?.trim();
}

/**
 * Extract indication (approved use) from FDA content
 */
function extractIndication(content: string): string | undefined {
  const match = content.match(/(?:indicated for|approved for|treatment of)[:\s]+([^.]+)/i);
  return match?.[1]?.trim();
}

async function searchAdverseEvents(
  ctx: any,
  companyName: string,
  deviceName?: string
): Promise<FDAAdverseEvent[]> {
  const events: FDAAdverseEvent[] = [];

  try {
    const searchQuery = deviceName
      ? `site:accessdata.fda.gov MAUDE "adverse event" "${deviceName}"`
      : `site:accessdata.fda.gov MAUDE "adverse event" "${companyName}"`;

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

      if (content.toLowerCase().includes("adverse") || content.toLowerCase().includes("maude")) {
        const reportMatch = content.match(/MDR-?(\d+)/i);
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4})/);

        events.push({
          reportNumber: reportMatch?.[1] || `UNKNOWN-${Date.now()}`,
          eventDate: dateMatch?.[1] || "Unknown",
          eventType: extractEventType(content),
          deviceName: deviceName || companyName,
          manufacturer: companyName,
          patientOutcome: extractPatientOutcome(content),
        });
      }
    }

    return events;

  } catch (error) {
    console.error(`[FDA-MAUDE] Search error:`, error);
    return [];
  }
}

async function searchRecalls(
  ctx: any,
  companyName: string,
  deviceName?: string
): Promise<FDARecall[]> {
  const recalls: FDARecall[] = [];

  try {
    const searchQuery = `site:fda.gov recall "${companyName}"`;

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
      const contentLower = content.toLowerCase();

      if (contentLower.includes("recall")) {
        const recallNumMatch = content.match(/Z-?(\d{4}-\d+)/i);
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4})/);

        // Determine recall class
        let recallClass: FDARecall["recallClass"] = "II";
        if (contentLower.includes("class i") || contentLower.includes("class 1")) {
          recallClass = "I";
        } else if (contentLower.includes("class iii") || contentLower.includes("class 3")) {
          recallClass = "III";
        }

        recalls.push({
          recallNumber: recallNumMatch?.[1] || `RECALL-${Date.now()}`,
          recallClass,
          recallStatus: contentLower.includes("ongoing") ? "Ongoing" : "Completed",
          productDescription: deviceName || extractDeviceName(content),
          reasonForRecall: extractRecallReason(content),
          initiationDate: dateMatch?.[1] || "Unknown",
          firmName: companyName,
        });
      }
    }

    return recalls;

  } catch (error) {
    console.error(`[FDA-Recalls] Search error:`, error);
    return [];
  }
}

// ============================================================================
// STATUS DETERMINATION
// ============================================================================

function determineFDAStatus(
  clearances: FDA510kClearance[],
  pmaApprovals: FDAPMAApproval[],
  blaApprovals: FDABLAApproval[],
  ndaApprovals: FDANDAApproval[],
  registrations: FDARegistration[],
  listings: FDADeviceListing[]
): FDAStatus {
  // BLA is highest level for biologics (vaccines, gene therapy)
  if (blaApprovals.length > 0) {
    return "BLA Approved";
  }

  // NDA for pharmaceutical drugs
  if (ndaApprovals.length > 0) {
    return "NDA Approved";
  }

  // PMA for Class III medical devices
  if (pmaApprovals.length > 0) {
    return "PMA Approved";
  }

  // 510(k) clearance for Class II devices
  if (clearances.length > 0) {
    const hasClearance = clearances.some(c => c.decision === "Substantially Equivalent");
    if (hasClearance) {
      return "510(k) Cleared";
    }
  }

  // Only registered/listed (NOT cleared/approved)
  if (registrations.length > 0 || listings.length > 0) {
    return "Registered/Listed Only";
  }

  return "Not Found";
}

function checkStatusMatch(
  claimedStatus: string | undefined,
  actualStatus: FDAStatus
): boolean {
  if (!claimedStatus) return true;

  const claimedLower = claimedStatus.toLowerCase();
  const actualLower = actualStatus.toLowerCase();

  // Direct match
  if (actualLower.includes(claimedLower) || claimedLower.includes(actualLower)) {
    return true;
  }

  // "Cleared" claim should match actual clearance
  if (claimedLower.includes("cleared") || claimedLower.includes("510(k)")) {
    return actualStatus === "510(k) Cleared";
  }

  // "Approved" or "FDA Approved" could match BLA, NDA, PMA, or 510(k) cleared
  if (claimedLower.includes("approved") || claimedLower.includes("fda approved")) {
    return (
      actualStatus === "BLA Approved" ||
      actualStatus === "NDA Approved" ||
      actualStatus === "PMA Approved" ||
      actualStatus === "510(k) Cleared"
    );
  }

  // "Licensed" matches BLA
  if (claimedLower.includes("licensed") || claimedLower.includes("bla")) {
    return actualStatus === "BLA Approved";
  }

  // "NDA" matches NDA
  if (claimedLower.includes("nda") || claimedLower.includes("new drug")) {
    return actualStatus === "NDA Approved";
  }

  // "Registered" is different from cleared
  if (claimedLower.includes("registered")) {
    return actualStatus.includes("Registered");
  }

  return false;
}

function checkClearanceMatchesClaims(
  claimedStatus: string | undefined,
  clearances: FDA510kClearance[],
  registrations: FDARegistration[],
  blaApprovals: FDABLAApproval[],
  ndaApprovals: FDANDAApproval[]
): boolean {
  if (!claimedStatus) return true;

  const claimedLower = claimedStatus.toLowerCase();

  // If they claim "cleared" but only have registration, that's a mismatch
  if (
    (claimedLower.includes("cleared") || claimedLower.includes("510(k)")) &&
    clearances.length === 0 &&
    registrations.length > 0
  ) {
    return false; // Misrepresentation: registered ≠ cleared
  }

  // If they claim "approved" and have BLA/NDA, that's valid
  if (claimedLower.includes("approved")) {
    return (
      clearances.length > 0 ||
      blaApprovals.length > 0 ||
      ndaApprovals.length > 0
    );
  }

  return true;
}

// ============================================================================
// RED FLAG GENERATION
// ============================================================================

function generateFDARedFlags(
  claimedStatus: string | undefined,
  actualStatus: FDAStatus,
  clearances: FDA510kClearance[],
  registrations: FDARegistration[],
  blaApprovals: FDABLAApproval[],
  ndaApprovals: FDANDAApproval[],
  recalls: FDARecall[],
  adverseEvents: FDAAdverseEvent[]
): FdaVerificationFindings["redFlags"] {
  const redFlags: FdaVerificationFindings["redFlags"] = [];

  // Check if any approval exists
  const hasAnyApproval =
    clearances.length > 0 ||
    blaApprovals.length > 0 ||
    ndaApprovals.length > 0;

  // Status misrepresentation (CRITICAL)
  if (claimedStatus) {
    const claimedLower = claimedStatus.toLowerCase();

    // Claiming "cleared" when only registered (and no BLA/NDA)
    if (
      (claimedLower.includes("cleared") || claimedLower.includes("510(k)")) &&
      actualStatus === "Registered/Listed Only" &&
      !hasAnyApproval
    ) {
      redFlags.push({
        type: "status_misrepresentation",
        severity: "critical",
        description: `Company claims "FDA Cleared" but is only registered/listed. Registration is NOT the same as clearance. This is a common misrepresentation.`,
      });
    }

    // Claiming approval when not found - but only if no BLA/NDA either
    if (
      (claimedLower.includes("cleared") || claimedLower.includes("approved")) &&
      actualStatus === "Not Found" &&
      !hasAnyApproval
    ) {
      redFlags.push({
        type: "status_misrepresentation",
        severity: "critical",
        description: `Company claims "FDA ${claimedLower.includes("cleared") ? "Cleared" : "Approved"}" but NO FDA records found. This is a potential misrepresentation. Request documentation.`,
      });
    }
  }

  // Active recalls
  const activeRecalls = recalls.filter(r => r.recallStatus === "Ongoing");
  if (activeRecalls.length > 0) {
    const classI = activeRecalls.filter(r => r.recallClass === "I");
    redFlags.push({
      type: "active_recall",
      severity: classI.length > 0 ? "critical" : "high",
      description: `${activeRecalls.length} active recall(s) found. ${classI.length > 0 ? "Class I recall indicates serious safety risk." : ""}`,
    });
  }

  // Serious adverse events
  const seriousEvents = adverseEvents.filter(e =>
    e.patientOutcome?.toLowerCase().includes("death") ||
    e.patientOutcome?.toLowerCase().includes("life-threatening")
  );
  if (seriousEvents.length > 0) {
    redFlags.push({
      type: "adverse_events",
      severity: "high",
      description: `${seriousEvents.length} serious adverse event(s) reported, including potential deaths or life-threatening outcomes.`,
    });
  }

  // Facility issues
  const inactiveRegistrations = registrations.filter(r => r.status === "Inactive");
  if (inactiveRegistrations.length > 0) {
    redFlags.push({
      type: "facility_issue",
      severity: "medium",
      description: `${inactiveRegistrations.length} inactive facility registration(s). Company should have active registration to manufacture/distribute devices.`,
    });
  }

  return redFlags;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractDeviceName(content: string): string {
  // Try to extract device name from content
  const nameMatch = content.match(/device[:\s]+([A-Z][A-Za-z0-9\s]+)/i);
  return nameMatch?.[1]?.trim() || "Unknown Device";
}

function extractProductCode(content: string): string {
  const codeMatch = content.match(/product code[:\s]*([A-Z]{3})/i);
  return codeMatch?.[1] || "";
}

function extractRegulationNumber(content: string): string {
  const regMatch = content.match(/(\d{3}\.\d+)/);
  return regMatch?.[1] || "";
}

function extractDeviceClass(content: string): "I" | "II" | "III" {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("class iii") || contentLower.includes("class 3")) return "III";
  if (contentLower.includes("class i") || contentLower.includes("class 1")) return "I";
  return "II";
}

function extractFacilityType(content: string): string {
  if (content.toLowerCase().includes("manufacturer")) return "Manufacturer";
  if (content.toLowerCase().includes("distributor")) return "Distributor";
  if (content.toLowerCase().includes("importer")) return "Importer";
  return "Unknown";
}

function extractEventType(content: string): string {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("malfunction")) return "Malfunction";
  if (contentLower.includes("injury")) return "Injury";
  if (contentLower.includes("death")) return "Death";
  return "Other";
}

function extractPatientOutcome(content: string): string | undefined {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("death")) return "Death";
  if (contentLower.includes("life-threatening")) return "Life-Threatening";
  if (contentLower.includes("hospitalization")) return "Hospitalization";
  if (contentLower.includes("injury")) return "Injury";
  return undefined;
}

function extractRecallReason(content: string): string {
  // Extract reason if present
  const reasonMatch = content.match(/reason[:\s]+([^.]+)/i);
  return reasonMatch?.[1]?.trim() || "See FDA database for details";
}

/**
 * Extract applicant name from FDA search result content.
 * FDA 510(k) records typically have patterns like "Applicant: Company Name" or "Company Inc."
 */
function extractApplicantName(content: string): string | null {
  // Try common FDA patterns
  const patterns = [
    // "Applicant: Company Name" pattern
    /applicant[:\s]+([A-Z][A-Za-z0-9,.\s&-]+?)(?:\s+(?:K\d|Date|Decision|Device|Product|Type|SE)|$)/i,
    // "Company Inc." or "Company LLC" pattern (ends with corp suffix)
    /\b([A-Z][A-Za-z0-9\s&-]*(?:Inc|LLC|Corp|Ltd|Company|Co|PLC|GmbH|AG)\.?)\b/i,
    // Title case company name pattern (2-4 words)
    /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s+(?:K\d|Date|Inc|LLC|Corp)|\s*$)/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1] && match[1].length > 3 && match[1].length < 100) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract firm name from FDA registration/listing search result content.
 */
function extractFirmName(content: string): string | null {
  // Try common FDA patterns for firm names
  const patterns = [
    // "Firm Name: Company" pattern
    /firm\s*name[:\s]+([A-Z][A-Za-z0-9,.\s&-]+?)(?:\s+(?:FEI|Registration|Address|Type)|$)/i,
    // "Establishment Name: Company" pattern
    /establishment\s*name[:\s]+([A-Z][A-Za-z0-9,.\s&-]+?)(?:\s+(?:FEI|Registration|Address|Type)|$)/i,
    // Company pattern ending with corp suffix
    /\b([A-Z][A-Za-z0-9\s&-]*(?:Inc|LLC|Corp|Ltd|Company|Co|PLC|GmbH|AG)\.?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1] && match[1].length > 3 && match[1].length < 100) {
      return match[1].trim();
    }
  }

  return null;
}

function calculateFDAConfidence(
  clearances: FDA510kClearance[],
  registrations: FDARegistration[],
  listings: FDADeviceListing[],
  blaApprovals: FDABLAApproval[],
  ndaApprovals: FDANDAApproval[],
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (clearances.length > 0) confidence += 0.3;
  if (registrations.length > 0) confidence += 0.15;
  if (listings.length > 0) confidence += 0.1;
  if (blaApprovals.length > 0) confidence += 0.35;
  if (ndaApprovals.length > 0) confidence += 0.35;

  return Math.min(0.95, confidence);
}

function createEmptyFDAFindings(claimedStatus?: string): FdaVerificationFindings {
  return {
    claimedStatus,
    actualStatus: "Not Found",
    statusMatchesClaims: !claimedStatus,
    clearances: [],
    hasClearance: false,
    pmaApprovals: [],
    hasPMA: false,
    blaApprovals: [],
    hasBLA: false,
    ndaApprovals: [],
    hasNDA: false,
    registrations: [],
    deviceListings: [],
    isRegistered: false,
    isListed: false,
    adverseEvents: [],
    recalls: [],
    hasAdverseEvents: false,
    hasRecalls: false,
    verification: {
      statusVerified: false,
      clearanceMatchesClaims: !claimedStatus,
      noActiveRecalls: true,
      noSeriousAdverseEvents: true,
      facilityInGoodStanding: false,
    },
    redFlags: claimedStatus ? [{
      type: "status_misrepresentation",
      severity: "critical",
      description: `Company claims "${claimedStatus}" but no FDA records could be verified. This is a potential misrepresentation.`,
    }] : [],
    overallConfidence: 0.1,
  };
}

/**
 * Filter FDA search results to only include records that actually match the company name.
 * This prevents false positives from generic web search results.
 *
 * @param records - Array of FDA records (clearances, registrations, PMAs)
 * @param companyName - The company name we're verifying
 * @param fieldName - The field to check for company name match (e.g., "applicant", "firmName")
 * @param searchQuery - The original search query (to exclude records that just echo the query)
 * @returns Filtered array with only verified matches
 */
function filterVerifiedMatches<T extends Record<string, any>>(
  records: T[],
  companyName: string,
  fieldName: keyof T,
  searchQuery?: string
): T[] {
  // AGGRESSIVE FILTERING: For FDA verification, we should only match if the
  // EXACT company name (or very close variant) appears in FDA records.
  // Since we're searching for a specific company's FDA status, any record
  // that doesn't have that company's name is a false positive from web search.

  if (records.length === 0) return records;

  const companyLower = companyName.toLowerCase();
  // Remove common suffixes for matching (Inc, LLC, Corp, etc.)
  const companyBaseName = companyLower
    .replace(/\s*(inc\.?|llc\.?|corp\.?|ltd\.?|company|co\.?)\s*$/i, "")
    .trim();

  console.error(`[FDA-Filter] Company: ${companyName}, BaseName: ${companyBaseName}`);
  console.error(`[FDA-Filter] Filtering ${records.length} records by field: ${String(fieldName)}`);

  const filtered = records.filter(record => {
    const fieldValue = record[fieldName];
    if (typeof fieldValue !== "string") return false;

    const recordLower = fieldValue.toLowerCase();
    // Also clean up the record value
    const recordBaseName = recordLower
      .replace(/\s*(inc\.?|llc\.?|corp\.?|ltd\.?|company|co\.?)\s*$/i, "")
      .trim();

    // Skip "Unknown" placeholders
    if (recordLower.startsWith("unknown")) {
      console.error(`[FDA-Filter] SKIP (unknown): ${fieldValue}`);
      return false;
    }

    // ONLY match if the base names are substantially similar
    // (contains each other OR have very high similarity)
    const isExactMatch = recordBaseName === companyBaseName;
    const containsCompany = recordBaseName.includes(companyBaseName);
    const companyContainsRecord = companyBaseName.includes(recordBaseName) && recordBaseName.length > 5;

    const shouldMatch = isExactMatch || containsCompany || companyContainsRecord;

    if (shouldMatch) {
      console.error(`[FDA-Filter] MATCH: ${fieldValue} (exact=${isExactMatch}, contains=${containsCompany}, reverse=${companyContainsRecord})`);
    } else {
      console.error(`[FDA-Filter] NO MATCH: ${fieldValue} (looking for "${companyBaseName}" in "${recordBaseName}")`);
    }

    return shouldMatch;
  });

  console.error(`[FDA-Filter] Result: ${filtered.length}/${records.length} records matched`);
  return filtered;
}
