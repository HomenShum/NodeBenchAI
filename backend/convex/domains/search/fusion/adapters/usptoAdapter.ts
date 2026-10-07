/**
 * USPTO PatentsView Search Adapter
 *
 * Adapts PatentsView API responses for patent verification.
 * Used for investor protection due diligence to verify patent claims.
 *
 * @module search/fusion/adapters/usptoAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// USPTO RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface USPTOPatentResult {
  patent_id: string;
  patent_number: string;
  patent_title: string;
  patent_date: string;
  patent_abstract?: string;
  patent_type: string;
  patent_kind: string;
  patent_num_claims: number;
  assignees?: Array<{
    assignee_id: string;
    assignee_organization?: string;
    assignee_first_name?: string;
    assignee_last_name?: string;
    assignee_type: string;
  }>;
  inventors?: Array<{
    inventor_id: string;
    inventor_first_name: string;
    inventor_last_name: string;
    inventor_city?: string;
    inventor_state?: string;
    inventor_country?: string;
  }>;
  applications?: Array<{
    app_number: string;
    app_date: string;
    app_type: string;
  }>;
}

interface PatentsViewResponse {
  patents: USPTOPatentResult[];
  count: number;
  total_patent_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class UsptoAdapter implements SearchSourceAdapter {
  source = "uspto" as const;

  private baseUrl = "https://api.patentsview.org/patents/query";

  isAvailable(): boolean {
    // PatentsView API is always available (no API key required)
    return true;
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    console.log(`[UsptoAdapter] Searching for: ${query}`);

    try {
      // Search by assignee organization or patent title
      const results = await this.searchByAssignee(query, options.maxResults || 10);

      return results.map((result, index) => ({
        id: `uspto-${result.patent_number}`,
        source: "uspto" as const,
        title: `${result.patent_title} (US${result.patent_number})`,
        snippet: result.patent_abstract?.slice(0, 200) || `Patent granted ${result.patent_date}`,
        url: `https://patents.google.com/patent/US${result.patent_number}`,
        score: 1 - (index / results.length),
        originalRank: index + 1,
        contentType: "patent" as const,
        publishedAt: result.patent_date,
        author: result.assignees?.[0]?.assignee_organization || "Unknown",
        metadata: {
          patentNumber: result.patent_number,
          patentType: result.patent_type,
          numClaims: result.patent_num_claims,
          assignee: result.assignees?.[0]?.assignee_organization,
        },
      }));
    } catch (error) {
      console.error("[UsptoAdapter] Search failed:", error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATENT SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search patents by assignee organization name
   */
  async searchByAssignee(companyName: string, limit: number = 10): Promise<USPTOPatentResult[]> {
    console.log(`[UsptoAdapter] Searching patents for assignee: ${companyName}`);

    try {
      const query = {
        q: { _text_any: { assignee_organization: companyName } },
        f: [
          "patent_id",
          "patent_number",
          "patent_title",
          "patent_date",
          "patent_abstract",
          "patent_type",
          "patent_kind",
          "patent_num_claims",
          "assignees",
          "inventors",
          "applications",
        ],
        o: {
          per_page: limit,
          page: 1,
        },
        s: [{ patent_date: "desc" }],
      };

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });

      if (!response.ok) {
        console.error(`[UsptoAdapter] Assignee search failed: ${response.status}`);
        return [];
      }

      const data: PatentsViewResponse = await response.json();
      return data.patents || [];
    } catch (error) {
      console.error("[UsptoAdapter] Assignee search error:", error);
      return [];
    }
  }

  /**
   * Search patents by inventor name
   */
  async searchByInventor(inventorName: string, limit: number = 10): Promise<USPTOPatentResult[]> {
    console.log(`[UsptoAdapter] Searching patents for inventor: ${inventorName}`);

    try {
      // Split name into first and last
      const nameParts = inventorName.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

      const query = {
        q: {
          _and: [
            { _text_any: { inventor_first_name: firstName } },
            ...(lastName ? [{ _text_any: { inventor_last_name: lastName } }] : []),
          ],
        },
        f: [
          "patent_id",
          "patent_number",
          "patent_title",
          "patent_date",
          "patent_abstract",
          "patent_type",
          "patent_kind",
          "patent_num_claims",
          "assignees",
          "inventors",
        ],
        o: {
          per_page: limit,
          page: 1,
        },
        s: [{ patent_date: "desc" }],
      };

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });

      if (!response.ok) {
        console.error(`[UsptoAdapter] Inventor search failed: ${response.status}`);
        return [];
      }

      const data: PatentsViewResponse = await response.json();
      return data.patents || [];
    } catch (error) {
      console.error("[UsptoAdapter] Inventor search error:", error);
      return [];
    }
  }

  /**
   * Verify a specific patent by patent number
   */
  async verifyPatentByNumber(patentNumber: string): Promise<USPTOPatentResult | null> {
    console.log(`[UsptoAdapter] Verifying patent number: ${patentNumber}`);

    try {
      // Normalize patent number (remove "US", spaces, commas)
      const normalizedNumber = patentNumber
        .toUpperCase()
        .replace(/^US/, "")
        .replace(/[,\s]/g, "");

      const query = {
        q: { patent_number: normalizedNumber },
        f: [
          "patent_id",
          "patent_number",
          "patent_title",
          "patent_date",
          "patent_abstract",
          "patent_type",
          "patent_kind",
          "patent_num_claims",
          "assignees",
          "inventors",
          "applications",
        ],
      };

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });

      if (!response.ok) {
        console.error(`[UsptoAdapter] Patent verification failed: ${response.status}`);
        return null;
      }

      const data: PatentsViewResponse = await response.json();
      return data.patents?.[0] || null;
    } catch (error) {
      console.error("[UsptoAdapter] Patent verification error:", error);
      return null;
    }
  }

  /**
   * Verify if a company owns specific patents
   */
  async verifyCompanyOwnPatents(companyName: string): Promise<{
    hasPatents: boolean;
    patents: USPTOPatentResult[];
    count: number;
  }> {
    console.log(`[UsptoAdapter] Checking patents for company: ${companyName}`);

    const results = await this.searchByAssignee(companyName, 50);

    // Filter to ensure company name actually matches assignee
    const matchingResults = results.filter((r) =>
      r.assignees?.some((a) =>
        a.assignee_organization?.toLowerCase().includes(companyName.toLowerCase())
      )
    );

    return {
      hasPatents: matchingResults.length > 0,
      patents: matchingResults,
      count: matchingResults.length,
    };
  }

  /**
   * Verify a patent claim: check if the patent exists and matches the company
   */
  async verifyPatentClaim(
    patentNumber: string,
    claimedCompanyName: string
  ): Promise<{
    verified: boolean;
    record: USPTOPatentResult | null;
    assigneeMatches: boolean;
    discrepancy: string | null;
    explanation: string;
  }> {
    console.log(`[UsptoAdapter] Verifying patent claim: ${patentNumber} for ${claimedCompanyName}`);

    const record = await this.verifyPatentByNumber(patentNumber);

    if (!record) {
      return {
        verified: false,
        record: null,
        assigneeMatches: false,
        discrepancy: `Patent number ${patentNumber} not found in USPTO database`,
        explanation: "The claimed patent number does not exist in the USPTO database.",
      };
    }

    // Check if company name matches any assignee
    const assigneeOrgs = record.assignees
      ?.map((a) => a.assignee_organization)
      .filter(Boolean) || [];

    const claimedNameLower = claimedCompanyName.toLowerCase();
    const assigneeMatches = assigneeOrgs.some(
      (org) =>
        org?.toLowerCase().includes(claimedNameLower) ||
        claimedNameLower.includes(org?.toLowerCase() || "") ||
        this.fuzzyNameMatch(org?.toLowerCase() || "", claimedNameLower)
    );

    if (!assigneeMatches) {
      const actualAssignee = assigneeOrgs[0] || "Unknown";
      return {
        verified: false,
        record,
        assigneeMatches: false,
        discrepancy: `Patent US${record.patent_number} is assigned to "${actualAssignee}", not "${claimedCompanyName}"`,
        explanation: `The patent exists but is owned by a different company. The company may have a license, or this could be a misrepresentation.`,
      };
    }

    // Check if patent is still active (rough check based on grant date)
    const grantDate = new Date(record.patent_date);
    const expirationDate = new Date(grantDate);
    expirationDate.setFullYear(expirationDate.getFullYear() + 20);
    const isExpired = new Date() > expirationDate;

    if (isExpired) {
      return {
        verified: true,
        record,
        assigneeMatches: true,
        discrepancy: `Patent US${record.patent_number} has expired (granted ${record.patent_date})`,
        explanation: `The patent exists and was assigned to the claimed company, but it has likely expired.`,
      };
    }

    return {
      verified: true,
      record,
      assigneeMatches: true,
      discrepancy: null,
      explanation: `Patent US${record.patent_number} verified: "${record.patent_title}" assigned to ${assigneeOrgs[0]}`,
    };
  }

  /**
   * Calculate patent expiration date (approximate)
   */
  calculateExpirationDate(grantDate: string, patentType: string): Date {
    const grant = new Date(grantDate);
    const expiration = new Date(grant);

    // Most utility patents last 20 years from filing date
    // Design patents last 15 years from grant date (post-2015)
    if (patentType.toLowerCase().includes("design")) {
      expiration.setFullYear(expiration.getFullYear() + 15);
    } else {
      expiration.setFullYear(expiration.getFullYear() + 20);
    }

    return expiration;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Simple fuzzy name matching for company names
   */
  private fuzzyNameMatch(name1: string, name2: string): boolean {
    // Remove common suffixes
    const clean = (s: string) =>
      s
        .replace(/\b(inc|llc|corp|corporation|company|co|ltd|lp|llp)\b/gi, "")
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

export const usptoAdapter = new UsptoAdapter();
