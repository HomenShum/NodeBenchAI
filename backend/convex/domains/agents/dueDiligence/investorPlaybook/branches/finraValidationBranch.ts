/**
 * FINRA Portal Validation Branch
 *
 * Verifies funding portals and broker-dealers via FINRA:
 * - Funding portal registration status
 * - Broker-dealer registration
 * - Disclosure events and regulatory actions
 * - Campaign verification
 *
 * Uses FINRA's public resources:
 * - Funding Portals List: https://www.finra.org/about/entities-we-regulate/funding-portals-we-regulate
 * - BrokerCheck: https://brokercheck.finra.org/
 * - IAPD: https://adviserinfo.sec.gov/
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  FinraValidationFindings,
  FundingPortal,
  BrokerDealerRecord,
} from "../types";

interface FinraValidationBranchResult {
  findings: FinraValidationFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeFinraValidationBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedPortal?: string,
  claimedBrokerDealer?: string
): Promise<FinraValidationBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Check if claimed portal is on FINRA's registered list
    let verifiedPortal: FundingPortal | undefined;
    if (claimedPortal) {
      verifiedPortal = await verifyFundingPortal(ctx, claimedPortal);

      if (verifiedPortal) {
        sources.push({
          sourceType: "sec_filing",
          url: "https://www.finra.org/about/entities-we-regulate/funding-portals-we-regulate",
          title: "FINRA Registered Funding Portals",
          accessedAt: now,
          reliability: "authoritative",
          section: "finra_portal_verification",
        });
        confidence += 0.25;
      }
    }

    // Step 2: Check broker-dealer registration
    let brokerDealer: BrokerDealerRecord | undefined;
    if (claimedBrokerDealer) {
      brokerDealer = await verifyBrokerDealer(ctx, claimedBrokerDealer);

      if (brokerDealer) {
        sources.push({
          sourceType: "sec_filing",
          url: "https://brokercheck.finra.org/",
          title: "FINRA BrokerCheck",
          accessedAt: now,
          reliability: "authoritative",
          section: "broker_dealer_verification",
        });
        confidence += 0.2;
      }
    }

    // Step 3: Search for company offerings on crowdfunding platforms
    const offeringDetails = await searchForOffering(ctx, entityName, claimedPortal);

    // Step 4: Check for disclosure events
    const disclosureEvents = await searchDisclosureEvents(
      ctx,
      claimedPortal,
      claimedBrokerDealer
    );

    // Step 5: Build findings
    const findings: FinraValidationFindings = {
      claimedPortal: claimedPortal ? { name: claimedPortal } : undefined,
      verifiedPortal,
      portalIsRegistered: Boolean(verifiedPortal),
      brokerDealer,
      offeringOnPortal: Boolean(offeringDetails),
      offeringDetails,
      disclosureEvents,
      verification: {
        portalRegistered: Boolean(verifiedPortal),
        offeringLive: offeringDetails?.status === "live",
        noSeriousDisclosures: !disclosureEvents.some(e => e.severity === "serious"),
        fundsFlowThroughPortal: Boolean(verifiedPortal) && Boolean(offeringDetails),
      },
      redFlags: generateFinraRedFlags(
        claimedPortal,
        verifiedPortal,
        offeringDetails,
        disclosureEvents
      ),
      overallConfidence: calculateFinraConfidence(
        verifiedPortal,
        brokerDealer,
        offeringDetails,
        confidence
      ),
    };

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[FINRA] Error for ${entityName}:`, error);
    return {
      findings: createEmptyFinraFindings(claimedPortal),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// FINRA VERIFICATION
// ============================================================================

// Known registered funding portals (as of FINRA's public list)
// Source: https://www.finra.org/about/entities-we-regulate/funding-portals-we-regulate
const KNOWN_REGISTERED_PORTALS: Record<string, Partial<FundingPortal>> = {
  "wefunder": { name: "Wefunder Portal LLC", crd: "283503", status: "Active" },
  "republic": { name: "OpenDeal Portal LLC", crd: "283941", status: "Active" },
  "startengine": { name: "StartEngine Capital LLC", crd: "283644", status: "Active" },
  "seedinvest": { name: "SI Securities, LLC", crd: "170937", status: "Active" },
  "netcapital": { name: "Netcapital Funding Portal Inc.", crd: "290129", status: "Active" },
  "mainvest": { name: "MainVest, Inc.", crd: "295498", status: "Active" },
  "honeycomb credit": { name: "Honeycomb Credit Inc.", crd: "298262", status: "Active" },
  "dealmaker": { name: "DealMaker Securities LLC", crd: "298436", status: "Active" },
  // Additional verified portals
  "picmii": { name: "PicMii Crowdfunding LLC", crd: "312054", status: "Active" },
  "fundable": { name: "Fundable, LLC", crd: "157368", status: "Active" },
  "crowdfunder": { name: "Crowdfunder Inc.", crd: "295183", status: "Active" },
  "microventures": { name: "MicroVentures Marketplace Inc.", crd: "152513", status: "Active" },
  "equifund": { name: "Equifund CFP, LLC", crd: "300668", status: "Active" },
  "trucrowd": { name: "TruCrowd, Inc.", crd: "289563", status: "Active" },
  "dalmore": { name: "Dalmore Group, LLC", crd: "286409", status: "Active" },
};

async function verifyFundingPortal(
  ctx: any,
  portalName: string
): Promise<FundingPortal | undefined> {
  const now = Date.now();
  const portalLower = portalName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Check against known registered portals first
  for (const [key, portal] of Object.entries(KNOWN_REGISTERED_PORTALS)) {
    if (portalLower.includes(key) || key.includes(portalLower)) {
      return {
        name: portal.name!,
        crd: portal.crd!,
        status: portal.status as FundingPortal["status"],
        verifiedAt: now,
      };
    }
  }

  // Search FINRA's list via web search
  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:finra.org "funding portal" "${portalName}"`,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      // Check if portal is mentioned as registered
      if (
        contentLower.includes("registered") &&
        contentLower.includes(portalLower)
      ) {
        // Try to extract CRD
        const crdMatch = content.match(/CRD[#:\s]*(\d+)/i);

        return {
          name: portalName,
          crd: crdMatch?.[1] || "Unknown",
          status: "Active",
          verifiedAt: now,
        };
      }
    }

    return undefined;

  } catch (error) {
    console.error(`[FINRA-Portal] Search error:`, error);
    return undefined;
  }
}

async function verifyBrokerDealer(
  ctx: any,
  bdName: string
): Promise<BrokerDealerRecord | undefined> {
  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:brokercheck.finra.org OR site:finra.org "${bdName}" broker dealer`,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      if (contentLower.includes(bdName.toLowerCase())) {
        const crdMatch = content.match(/CRD[#:\s]*(\d+)/i);
        const disclosureMatch = content.match(/(\d+)\s*disclosure/i);

        return {
          firmName: bdName,
          crd: crdMatch?.[1] || "Unknown",
          status: contentLower.includes("active") ? "Active" : "Inactive",
          disclosureEvents: disclosureMatch ? parseInt(disclosureMatch[1]) : 0,
        };
      }
    }

    return undefined;

  } catch (error) {
    console.error(`[FINRA-BD] Search error:`, error);
    return undefined;
  }
}

async function searchForOffering(
  ctx: any,
  companyName: string,
  portalName?: string
): Promise<FinraValidationFindings["offeringDetails"] | undefined> {
  try {
    // Search for active crowdfunding campaigns
    const searchQuery = portalName
      ? `"${companyName}" site:${portalName.toLowerCase()}.com OR "${companyName}" crowdfunding campaign`
      : `"${companyName}" crowdfunding campaign wefunder OR republic OR startengine`;

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
      const url = r.url || "";
      const contentLower = content.toLowerCase();

      // Check if this looks like an offering page
      if (
        (url.includes("wefunder.com") ||
          url.includes("republic.com") ||
          url.includes("startengine.com") ||
          url.includes("netcapital.com")) &&
        contentLower.includes(companyName.toLowerCase())
      ) {
        // Extract offering details
        const targetMatch = content.match(/\$?([\d,]+(?:\.\d{2})?)\s*(?:goal|target|raise)/i);
        const raisedMatch = content.match(/\$?([\d,]+(?:\.\d{2})?)\s*(?:raised|invested)/i);
        const investorMatch = content.match(/(\d+)\s*(?:investor|backer)/i);

        return {
          campaignUrl: url,
          targetAmount: targetMatch ? parseAmount(targetMatch[1]) : 0,
          amountRaised: raisedMatch ? parseAmount(raisedMatch[1]) : 0,
          investorCount: investorMatch ? parseInt(investorMatch[1]) : 0,
          deadline: "See campaign page",
          status: determineCampaignStatus(content),
        };
      }
    }

    return undefined;

  } catch (error) {
    console.error(`[FINRA-Offering] Search error:`, error);
    return undefined;
  }
}

async function searchDisclosureEvents(
  ctx: any,
  portalName?: string,
  bdName?: string
): Promise<FinraValidationFindings["disclosureEvents"]> {
  const events: FinraValidationFindings["disclosureEvents"] = [];

  if (!portalName && !bdName) return events;

  try {
    const searchTerm = portalName || bdName;
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:finra.org "${searchTerm}" disclosure OR regulatory action OR disciplinary`,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();

      if (
        contentLower.includes("disclosure") ||
        contentLower.includes("disciplinary") ||
        contentLower.includes("regulatory action")
      ) {
        const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/);

        events.push({
          type: extractDisclosureType(content),
          date: dateMatch?.[1] || "Unknown",
          description: content.slice(0, 200),
          severity: determineDisclosureSeverity(content),
        });
      }
    }

    return events;

  } catch (error) {
    console.error(`[FINRA-Disclosure] Search error:`, error);
    return [];
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function extractDisclosureType(content: string): string {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("customer complaint")) return "Customer Complaint";
  if (contentLower.includes("regulatory action")) return "Regulatory Action";
  if (contentLower.includes("disciplinary")) return "Disciplinary Action";
  if (contentLower.includes("fine")) return "Fine";
  if (contentLower.includes("suspension")) return "Suspension";
  return "Disclosure";
}

function determineDisclosureSeverity(
  content: string
): "minor" | "moderate" | "serious" {
  const contentLower = content.toLowerCase();
  if (
    contentLower.includes("fraud") ||
    contentLower.includes("criminal") ||
    contentLower.includes("suspension") ||
    contentLower.includes("revocation")
  ) {
    return "serious";
  }
  if (
    contentLower.includes("fine") ||
    contentLower.includes("censure") ||
    contentLower.includes("regulatory action")
  ) {
    return "moderate";
  }
  return "minor";
}

function determineCampaignStatus(
  content: string
): "live" | "successful" | "failed" | "withdrawn" {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("closed") || contentLower.includes("ended")) {
    if (contentLower.includes("successful") || contentLower.includes("funded")) {
      return "successful";
    }
    return "failed";
  }
  if (contentLower.includes("withdrawn") || contentLower.includes("cancelled")) {
    return "withdrawn";
  }
  return "live";
}

function parseAmount(amountStr: string): number {
  return parseInt(amountStr.replace(/[,\s]/g, ""), 10) || 0;
}

function generateFinraRedFlags(
  claimedPortal: string | undefined,
  verifiedPortal: FundingPortal | undefined,
  offeringDetails: FinraValidationFindings["offeringDetails"] | undefined,
  disclosureEvents: FinraValidationFindings["disclosureEvents"]
): FinraValidationFindings["redFlags"] {
  const redFlags: FinraValidationFindings["redFlags"] = [];

  // Claimed portal not registered
  if (claimedPortal && !verifiedPortal) {
    redFlags.push({
      type: "unregistered_portal",
      severity: "critical",
      description: `"${claimedPortal}" is not found on FINRA's registered funding portal list. Verify the platform's registration or reconsider the investment.`,
    });
  }

  // Portal suspended
  if (verifiedPortal?.status === "Suspended") {
    redFlags.push({
      type: "portal_suspended",
      severity: "critical",
      description: `The funding portal "${verifiedPortal.name}" is currently suspended by FINRA.`,
    });
  }

  // No campaign found when portal claimed
  if (claimedPortal && verifiedPortal && !offeringDetails) {
    redFlags.push({
      type: "no_campaign",
      severity: "high",
      description: `Company claims to be raising via ${claimedPortal} but no active campaign was found on the platform.`,
    });
  }

  // Serious disclosure events
  const seriousDisclosures = disclosureEvents.filter(e => e.severity === "serious");
  if (seriousDisclosures.length > 0) {
    redFlags.push({
      type: "disclosure_events",
      severity: "high",
      description: `${seriousDisclosures.length} serious disclosure event(s) found. Review FINRA BrokerCheck for details.`,
    });
  }

  return redFlags;
}

function calculateFinraConfidence(
  verifiedPortal: FundingPortal | undefined,
  brokerDealer: BrokerDealerRecord | undefined,
  offeringDetails: FinraValidationFindings["offeringDetails"] | undefined,
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (verifiedPortal) confidence += 0.25;
  if (brokerDealer) confidence += 0.15;
  if (offeringDetails) confidence += 0.2;

  return Math.min(0.95, confidence);
}

function createEmptyFinraFindings(
  claimedPortal?: string
): FinraValidationFindings {
  return {
    claimedPortal: claimedPortal ? { name: claimedPortal } : undefined,
    verifiedPortal: undefined,
    portalIsRegistered: false,
    brokerDealer: undefined,
    offeringOnPortal: false,
    offeringDetails: undefined,
    disclosureEvents: [],
    verification: {
      portalRegistered: false,
      offeringLive: false,
      noSeriousDisclosures: true,
      fundsFlowThroughPortal: false,
    },
    redFlags: claimedPortal ? [{
      type: "unregistered_portal",
      severity: "high",
      description: `Could not verify "${claimedPortal}" as a registered funding portal.`,
    }] : [],
    overallConfidence: 0.1,
  };
}
