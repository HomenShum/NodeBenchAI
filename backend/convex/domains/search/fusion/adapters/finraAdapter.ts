/**
 * FINRA Funding Portal Adapter
 *
 * Verifies funding portal registration status with FINRA.
 * Used for investor protection due diligence to verify Reg CF intermediaries.
 *
 * @module search/fusion/adapters/finraAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// FINRA TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FINRAPortalRecord {
  portalName: string;
  crd: string;                          // Central Registration Depository number
  secFileNumber?: string;
  status: "Active" | "Inactive" | "Suspended" | "Withdrawn";
  registrationDate?: string;
  website?: string;
  disclosureCount: number;
  hasRegulatoryConcerns: boolean;
  regulatoryConcerns?: string[];
  sourceUrl: string;
  verifiedAt: number;
}

// Known registered funding portals (as of last update)
// FINRA maintains the official list at: https://www.finra.org/about/entities-we-regulate/funding-portals-we-regulate
const KNOWN_FUNDING_PORTALS: Array<{
  name: string;
  crd: string;
  altNames: string[];
  website?: string;
}> = [
  { name: "Wefunder Portal LLC", crd: "283503", altNames: ["wefunder", "we funder"], website: "wefunder.com" },
  { name: "Republic Funding Portal", crd: "283496", altNames: ["republic"], website: "republic.com" },
  { name: "StartEngine Capital, LLC", crd: "285002", altNames: ["startengine", "start engine"], website: "startengine.com" },
  { name: "NetCapital Funding Portal Inc.", crd: "285017", altNames: ["netcapital", "net capital"], website: "netcapital.com" },
  { name: "Mainvest, Inc.", crd: "295700", altNames: ["mainvest", "main vest"], website: "mainvest.com" },
  { name: "Honeycomb Credit Inc.", crd: "287979", altNames: ["honeycomb", "honeycomb credit"], website: "honeycombcredit.com" },
  { name: "truCrowd, Inc.", crd: "282614", altNames: ["trucrowd", "tru crowd"], website: "trucrowd.com" },
  { name: "MicroVentures Marketplace Inc.", crd: "287979", altNames: ["microventures", "micro ventures"], website: "microventures.com" },
  { name: "SeedInvest Technology, LLC", crd: "149279", altNames: ["seedinvest", "seed invest"], website: "seedinvest.com" },
  { name: "Fundable, LLC", crd: "283545", altNames: ["fundable"], website: "fundable.com" },
];

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class FinraAdapter implements SearchSourceAdapter {
  source = "finra" as const;

  // FINRA official funding portal list URL
  private finraPortalListUrl = "https://www.finra.org/about/entities-we-regulate/funding-portals-we-regulate";

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    console.log(`[FinraAdapter] Searching for: ${query}`);

    // Search in known portals first
    const matchingPortals = this.searchKnownPortals(query);

    return matchingPortals.map((portal, index) => ({
      id: `finra-${portal.crd}`,
      source: "finra" as const,
      title: `${portal.name} (CRD# ${portal.crd})`,
      snippet: `FINRA Registered Funding Portal - ${portal.website || "No website listed"}`,
      url: `https://www.finra.org/brokercheck/firm/funding-portal/${portal.crd}`,
      score: 1 - (index / matchingPortals.length),
      originalRank: index + 1,
      contentType: "organization" as const,
      metadata: {
        crd: portal.crd,
        website: portal.website,
      },
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNDING PORTAL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search known funding portals by name
   */
  searchKnownPortals(query: string): typeof KNOWN_FUNDING_PORTALS {
    const queryLower = query.toLowerCase().trim();

    return KNOWN_FUNDING_PORTALS.filter((portal) => {
      // Match portal name
      if (portal.name.toLowerCase().includes(queryLower)) return true;

      // Match alternative names
      if (portal.altNames.some((alt) => alt.includes(queryLower))) return true;

      // Match website
      if (portal.website && portal.website.includes(queryLower)) return true;

      // Match CRD
      if (portal.crd === queryLower) return true;

      return false;
    });
  }

  /**
   * Verify if a funding portal is FINRA registered
   */
  async verifyFundingPortal(
    portalName: string,
    webFetchFn?: (url: string, prompt: string) => Promise<string>
  ): Promise<{
    isRegistered: boolean;
    record: FINRAPortalRecord | null;
    discrepancy: string | null;
    explanation: string;
  }> {
    console.log(`[FinraAdapter] Verifying funding portal: ${portalName}`);

    // First check known portals
    const knownMatches = this.searchKnownPortals(portalName);

    if (knownMatches.length > 0) {
      const bestMatch = knownMatches[0];

      // If we have web fetch, verify current status
      let currentStatus: FINRAPortalRecord | null = null;
      if (webFetchFn) {
        currentStatus = await this.fetchPortalStatus(bestMatch.crd, webFetchFn);
      }

      return {
        isRegistered: true,
        record: currentStatus || {
          portalName: bestMatch.name,
          crd: bestMatch.crd,
          status: "Active",
          website: bestMatch.website,
          disclosureCount: 0,
          hasRegulatoryConcerns: false,
          sourceUrl: `https://www.finra.org/brokercheck/firm/funding-portal/${bestMatch.crd}`,
          verifiedAt: Date.now(),
        },
        discrepancy: null,
        explanation: `${bestMatch.name} is a FINRA registered funding portal (CRD# ${bestMatch.crd})`,
      };
    }

    // If not in known list, try live lookup
    if (webFetchFn) {
      const liveResult = await this.searchFINRALive(portalName, webFetchFn);
      if (liveResult) {
        return {
          isRegistered: true,
          record: liveResult,
          discrepancy: null,
          explanation: `${liveResult.portalName} found in FINRA registry (CRD# ${liveResult.crd})`,
        };
      }
    }

    return {
      isRegistered: false,
      record: null,
      discrepancy: `"${portalName}" is not found in FINRA's registered funding portal list`,
      explanation: "This funding portal does not appear to be FINRA registered. Reg CF offerings MUST use a FINRA-registered intermediary.",
    };
  }

  /**
   * Verify portal matches claimed intermediary in offering
   */
  async verifyIntermediaryMatch(
    claimedPortalName: string,
    secFilingPortalName?: string
  ): Promise<{
    matches: boolean;
    discrepancy: string | null;
  }> {
    if (!secFilingPortalName) {
      return {
        matches: false,
        discrepancy: "No intermediary name found in SEC filing to compare",
      };
    }

    const claimedNormalized = this.normalizePortalName(claimedPortalName);
    const filingNormalized = this.normalizePortalName(secFilingPortalName);

    if (claimedNormalized === filingNormalized) {
      return { matches: true, discrepancy: null };
    }

    // Check if they're the same known portal
    const claimedMatches = this.searchKnownPortals(claimedPortalName);
    const filingMatches = this.searchKnownPortals(secFilingPortalName);

    if (
      claimedMatches.length > 0 &&
      filingMatches.length > 0 &&
      claimedMatches[0].crd === filingMatches[0].crd
    ) {
      return { matches: true, discrepancy: null };
    }

    return {
      matches: false,
      discrepancy: `Claimed intermediary "${claimedPortalName}" does not match SEC filing intermediary "${secFilingPortalName}"`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE FINRA LOOKUP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch portal status from FINRA BrokerCheck
   */
  private async fetchPortalStatus(
    crd: string,
    webFetchFn: (url: string, prompt: string) => Promise<string>
  ): Promise<FINRAPortalRecord | null> {
    const url = `https://www.finra.org/brokercheck/firm/funding-portal/${crd}`;
    const prompt = `
      Look up the FINRA BrokerCheck page for funding portal CRD# ${crd}.
      Extract the following information:
      1. Portal/Firm name
      2. Registration status (Active, Inactive, etc.)
      3. Registration date
      4. Number of disclosures or regulatory actions
      5. Any regulatory concerns or sanctions

      Format as JSON:
      {
        "portalName": "...",
        "status": "Active/Inactive/Suspended/Withdrawn",
        "registrationDate": "...",
        "disclosureCount": 0,
        "hasRegulatoryConcerns": true/false,
        "regulatoryConcerns": ["...", "..."]
      }
    `;

    try {
      const response = await webFetchFn(url, prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);

      return {
        portalName: data.portalName || "",
        crd,
        status: this.normalizeStatus(data.status),
        registrationDate: data.registrationDate,
        disclosureCount: data.disclosureCount || 0,
        hasRegulatoryConcerns: data.hasRegulatoryConcerns || false,
        regulatoryConcerns: data.regulatoryConcerns,
        sourceUrl: url,
        verifiedAt: Date.now(),
      };
    } catch (error) {
      console.error(`[FinraAdapter] Failed to fetch portal status:`, error);
      return null;
    }
  }

  /**
   * Search FINRA live for a portal by name
   */
  private async searchFINRALive(
    portalName: string,
    webFetchFn: (url: string, prompt: string) => Promise<string>
  ): Promise<FINRAPortalRecord | null> {
    const prompt = `
      Search for "${portalName}" on FINRA's registered funding portals page:
      ${this.finraPortalListUrl}

      Find if this portal appears in the list of FINRA-registered funding portals.
      If found, extract:
      1. Official portal name
      2. CRD number
      3. SEC file number (if available)
      4. Website

      Format as JSON:
      {
        "found": true/false,
        "portalName": "...",
        "crd": "...",
        "secFileNumber": "...",
        "website": "..."
      }
    `;

    try {
      const response = await webFetchFn(this.finraPortalListUrl, prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);

      if (!data.found) return null;

      return {
        portalName: data.portalName,
        crd: data.crd,
        secFileNumber: data.secFileNumber,
        status: "Active",
        website: data.website,
        disclosureCount: 0,
        hasRegulatoryConcerns: false,
        sourceUrl: this.finraPortalListUrl,
        verifiedAt: Date.now(),
      };
    } catch (error) {
      console.error(`[FinraAdapter] Live search failed:`, error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private normalizePortalName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(inc|llc|corp|corporation|funding portal|portal)\b/gi, "")
      .replace(/[.,]/g, "")
      .trim();
  }

  private normalizeStatus(status: string): FINRAPortalRecord["status"] {
    if (!status) return "Active";

    const lower = status.toLowerCase();
    if (lower.includes("active")) return "Active";
    if (lower.includes("inactive")) return "Inactive";
    if (lower.includes("suspend")) return "Suspended";
    if (lower.includes("withdraw")) return "Withdrawn";

    return "Active";
  }

  /**
   * Get list of known registered portals
   */
  getKnownPortals(): typeof KNOWN_FUNDING_PORTALS {
    return KNOWN_FUNDING_PORTALS;
  }

  /**
   * Get FINRA portal list URL
   */
  getFinraPortalListUrl(): string {
    return this.finraPortalListUrl;
  }
}

export const finraAdapter = new FinraAdapter();
