/**
 * FDA OpenFDA Search Adapter
 *
 * Adapts OpenFDA API responses for device 510(k) clearances and registrations.
 * Used for investor protection due diligence to verify FDA claims.
 *
 * @module search/fusion/adapters/fdaAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// FDA RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FDA510kResult {
  k_number: string;
  applicant: string;
  contact: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  country_code: string;
  zip_code: string;
  postal_code: string;
  date_received: string;
  decision_date: string;
  decision_description: string;
  clearance_type: string;
  product_code: string;
  statement_or_summary: string;
  device_name: string;
  review_advisory_committee: string;
  third_party_flag: string;
  expedited_review_flag: string;
}

interface OpenFDA510kResponse {
  meta: {
    disclaimer: string;
    terms: string;
    license: string;
    last_updated: string;
    results: {
      skip: number;
      limit: number;
      total: number;
    };
  };
  results: FDA510kResult[];
}

export interface FDARegistrationResult {
  registration: {
    registration_number: string;
    fei_number: string;
    status_code: string;
    initial_importer_flag: string;
    reg_expiry_date_year: string;
    name: string;
    address_line_1: string;
    city: string;
    state_code: string;
    iso_country_code: string;
    zip_code: string;
  };
  products: Array<{
    product_code: string;
    created_date: string;
  }>;
  proprietary_name: string[];
  establishment_type: string[];
}

interface OpenFDARegistrationResponse {
  meta: {
    results: {
      total: number;
    };
  };
  results: FDARegistrationResult[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class FdaAdapter implements SearchSourceAdapter {
  source = "fda" as const;

  private baseUrl = "https://api.fda.gov/device";
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.OPENFDA_API_KEY;
  }

  isAvailable(): boolean {
    // OpenFDA is always available (API key optional, increases rate limit)
    return true;
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    console.log(`[FdaAdapter] Searching for: ${query}`);

    try {
      // Search 510(k) clearances
      const results = await this.search510k(query, options.maxResults || 10);

      return results.map((result, index) => ({
        id: `fda-510k-${result.k_number}`,
        source: "fda" as const,
        title: `${result.device_name} - 510(k) ${result.k_number}`,
        snippet: `${result.applicant} - ${result.decision_description} (${result.decision_date})`,
        url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${result.k_number}`,
        score: 1 - (index / results.length),
        originalRank: index + 1,
        contentType: "filing" as const,
        publishedAt: result.decision_date,
        author: result.applicant,
        metadata: {
          kNumber: result.k_number,
          productCode: result.product_code,
          decisionDescription: result.decision_description,
          clearanceType: result.clearance_type,
        },
      }));
    } catch (error) {
      console.error("[FdaAdapter] Search failed:", error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 510(k) CLEARANCE SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search 510(k) clearances by company name or device name
   */
  async search510k(query: string, limit: number = 10): Promise<FDA510kResult[]> {
    console.log(`[FdaAdapter] Searching 510(k) for: ${query}`);

    try {
      // Search in applicant name and device name
      const searchQuery = `(applicant:"${query}"+OR+device_name:"${query}")`;
      const url = this.buildUrl("/510k.json", searchQuery, limit);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[FdaAdapter] No 510(k) results found for: ${query}`);
          return [];
        }
        console.error(`[FdaAdapter] 510(k) search failed: ${response.status}`);
        return [];
      }

      const data: OpenFDA510kResponse = await response.json();
      return data.results || [];
    } catch (error) {
      console.error("[FdaAdapter] 510(k) search error:", error);
      return [];
    }
  }

  /**
   * Verify a specific 510(k) clearance by K-number
   */
  async verify510kByNumber(kNumber: string): Promise<FDA510kResult | null> {
    console.log(`[FdaAdapter] Verifying 510(k) number: ${kNumber}`);

    try {
      // Normalize K-number format (e.g., K123456 or 123456)
      const normalizedK = kNumber.toUpperCase().replace(/^K/, "");
      const searchQuery = `k_number:"K${normalizedK}"`;
      const url = this.buildUrl("/510k.json", searchQuery, 1);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[FdaAdapter] 510(k) not found: ${kNumber}`);
          return null;
        }
        console.error(`[FdaAdapter] 510(k) verification failed: ${response.status}`);
        return null;
      }

      const data: OpenFDA510kResponse = await response.json();
      return data.results?.[0] || null;
    } catch (error) {
      console.error("[FdaAdapter] 510(k) verification error:", error);
      return null;
    }
  }

  /**
   * Verify if a company has any 510(k) clearances
   */
  async verifyCompanyHas510k(companyName: string): Promise<{
    hasClearances: boolean;
    clearances: FDA510kResult[];
    count: number;
  }> {
    console.log(`[FdaAdapter] Checking 510(k) clearances for company: ${companyName}`);

    const results = await this.search510k(companyName, 20);

    // Filter to ensure company name actually matches
    const matchingResults = results.filter((r) =>
      r.applicant.toLowerCase().includes(companyName.toLowerCase())
    );

    return {
      hasClearances: matchingResults.length > 0,
      clearances: matchingResults,
      count: matchingResults.length,
    };
  }

  /**
   * Verify a 510(k) claim: check if the K-number exists and matches the company
   */
  async verify510kClaim(
    kNumber: string,
    claimedCompanyName: string
  ): Promise<{
    verified: boolean;
    record: FDA510kResult | null;
    discrepancy: string | null;
    explanation: string;
  }> {
    console.log(`[FdaAdapter] Verifying 510(k) claim: ${kNumber} for ${claimedCompanyName}`);

    const record = await this.verify510kByNumber(kNumber);

    if (!record) {
      return {
        verified: false,
        record: null,
        discrepancy: `510(k) number ${kNumber} not found in FDA database`,
        explanation: "The claimed FDA 510(k) clearance number does not exist in the FDA's public database.",
      };
    }

    // Check if company name matches (fuzzy)
    const recordApplicant = record.applicant.toLowerCase();
    const claimedName = claimedCompanyName.toLowerCase();

    const nameMatches =
      recordApplicant.includes(claimedName) ||
      claimedName.includes(recordApplicant) ||
      this.fuzzyNameMatch(recordApplicant, claimedName);

    if (!nameMatches) {
      return {
        verified: false,
        record,
        discrepancy: `510(k) ${kNumber} belongs to "${record.applicant}", not "${claimedCompanyName}"`,
        explanation: `The 510(k) clearance exists but was issued to a different company. This could indicate a licensing arrangement, acquisition, or misrepresentation.`,
      };
    }

    return {
      verified: true,
      record,
      discrepancy: null,
      explanation: `510(k) ${kNumber} verified: ${record.device_name} cleared on ${record.decision_date}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGISTRATION & LISTING SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search device registrations by company name
   * Note: Registration/listing is different from clearance - it means the company
   * has registered as a device manufacturer, not that their devices are cleared.
   */
  async searchRegistrations(companyName: string, limit: number = 10): Promise<FDARegistrationResult[]> {
    console.log(`[FdaAdapter] Searching registrations for: ${companyName}`);

    try {
      const searchQuery = `registration.name:"${companyName}"`;
      const url = this.buildUrl("/registrationlisting.json", searchQuery, limit);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[FdaAdapter] No registrations found for: ${companyName}`);
          return [];
        }
        console.error(`[FdaAdapter] Registration search failed: ${response.status}`);
        return [];
      }

      const data: OpenFDARegistrationResponse = await response.json();
      return data.results || [];
    } catch (error) {
      console.error("[FdaAdapter] Registration search error:", error);
      return [];
    }
  }

  /**
   * Distinguish between "FDA registered" vs "FDA cleared"
   * This is a common source of misrepresentation in pitch materials
   */
  async analyzeCompanyFDAStatus(companyName: string): Promise<{
    isRegistered: boolean;
    registrationCount: number;
    is510kCleared: boolean;
    clearanceCount: number;
    devices: string[];
    warning: string | null;
  }> {
    console.log(`[FdaAdapter] Analyzing FDA status for: ${companyName}`);

    // Check registrations
    const registrations = await this.searchRegistrations(companyName, 10);
    const isRegistered = registrations.length > 0;

    // Check 510(k) clearances
    const clearances = await this.search510k(companyName, 20);
    const matchingClearances = clearances.filter((c) =>
      c.applicant.toLowerCase().includes(companyName.toLowerCase())
    );
    const is510kCleared = matchingClearances.length > 0;

    const devices = matchingClearances.map((c) => c.device_name);

    // Generate warning if only registered but not cleared
    let warning: string | null = null;
    if (isRegistered && !is510kCleared) {
      warning = `${companyName} is FDA registered but has no 510(k) clearances. "FDA registered" is NOT the same as "FDA cleared."`;
    }

    return {
      isRegistered,
      registrationCount: registrations.length,
      is510kCleared,
      clearanceCount: matchingClearances.length,
      devices,
      warning,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private buildUrl(endpoint: string, searchQuery: string, limit: number): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("search", searchQuery);
    url.searchParams.set("limit", limit.toString());

    if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    }

    return url.toString();
  }

  /**
   * Simple fuzzy name matching for company names
   */
  private fuzzyNameMatch(name1: string, name2: string): boolean {
    // Remove common suffixes
    const clean = (s: string) =>
      s
        .replace(/\b(inc|llc|corp|corporation|company|co|ltd)\b/gi, "")
        .replace(/[.,]/g, "")
        .trim();

    const cleaned1 = clean(name1);
    const cleaned2 = clean(name2);

    // Check if one contains the other
    if (cleaned1.includes(cleaned2) || cleaned2.includes(cleaned1)) {
      return true;
    }

    // Calculate word overlap
    const words1 = cleaned1.split(/\s+/).filter((w) => w.length > 2);
    const words2 = cleaned2.split(/\s+/).filter((w) => w.length > 2);

    const overlap = words1.filter((w) => words2.includes(w)).length;
    const minWords = Math.min(words1.length, words2.length);

    return minWords > 0 && overlap / minWords >= 0.5;
  }
}

export const fdaAdapter = new FdaAdapter();
