/**
 * SEC EDGAR Search Adapter
 * 
 * Adapts SEC EDGAR API responses to unified SearchResult format.
 * 
 * @module search/fusion/adapters/secAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// SEC RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SecFiling {
  formType: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  companyName?: string;
  cik?: string;
}

interface SecSubmissionsResponse {
  name: string;
  cik: string;
  filings: {
    recent: {
      form: string[];
      filingDate: string[];
      accessionNumber: string[];
      primaryDocument: string[];
    };
  };
}

// Form C (Reg CF) filing structure
export interface FormCFiling {
  cik: string;
  companyName: string;
  accessionNumber: string;
  filingDate: string;
  formType: string;  // "C", "C/A", "C-U", "C-AR"
  offeringAmount?: number;
  amountSold?: number;
  intermediaryName?: string;
  intermediaryCik?: string;
  url: string;
}

// Form D (Reg D) filing structure
export interface FormDFiling {
  cik: string;
  companyName: string;
  accessionNumber: string;
  filingDate: string;
  formType: string;  // "D", "D/A"
  totalOfferingAmount?: number;
  totalAmountSold?: number;
  exemptions?: string[];  // "506(b)", "506(c)", etc.
  firstSaleDate?: string;
  url: string;
}

// EDGAR full-text search response
interface EdgarFullTextHit {
  _id: string;
  _source: {
    ciks: string[];
    display_names: string[];
    form: string;
    file_date: string;
    accession_number: string;
    file_num: string;
  };
}

interface EdgarFullTextResponse {
  hits: {
    total: { value: number };
    hits: EdgarFullTextHit[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class SecAdapter implements SearchSourceAdapter {
  source = "sec" as const;
  
  private userAgent = "NodeBench AI contact@nodebench.ai";
  
  isAvailable(): boolean {
    // SEC EDGAR is always available (no API key required)
    return true;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Extract potential ticker or company name from query
      const ticker = this.extractTicker(query);
      
      if (!ticker) {
        console.log("[SecAdapter] No ticker found in query, skipping SEC search");
        return [];
      }
      
      // Look up CIK from ticker
      const cik = await this.lookupCik(ticker);
      if (!cik) {
        console.log(`[SecAdapter] Could not find CIK for ticker: ${ticker}`);
        return [];
      }
      
      // Fetch company submissions
      const paddedCik = cik.padStart(10, "0");
      const response = await fetch(
        `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
        { headers: { "User-Agent": this.userAgent } }
      );
      
      if (!response.ok) {
        console.error(`[SecAdapter] Failed to fetch submissions: ${response.status}`);
        return [];
      }
      
      const data: SecSubmissionsResponse = await response.json();
      const elapsed = Date.now() - startTime;
      console.log(`[SecAdapter] Search completed in ${elapsed}ms for ${data.name}`);
      
      return this.normalizeResults(data, paddedCik, options.maxResults);
    } catch (error) {
      console.error("[SecAdapter] Search failed:", error);
      return [];
    }
  }
  
  private extractTicker(query: string): string | null {
    // Look for common patterns: "AAPL", "$AAPL", "ticker:AAPL"
    const patterns = [
      /\$([A-Z]{1,5})\b/,           // $AAPL
      /\bticker[:\s]+([A-Z]{1,5})\b/i, // ticker:AAPL
      /\b([A-Z]{1,5})\s+(?:stock|shares|filings?|10-?[KQ]|8-?K)/i, // AAPL stock
      /\b([A-Z]{2,5})\b/,           // Standalone uppercase (last resort)
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return match[1].toUpperCase();
    }
    
    return null;
  }
  
  private async lookupCik(ticker: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${ticker}&output=json`,
        { headers: { "User-Agent": this.userAgent } }
      );
      
      if (!response.ok) return null;
      
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return null;
      
      const data = await response.json();
      return data?.cik || null;
    } catch {
      return null;
    }
  }
  
  private normalizeResults(data: SecSubmissionsResponse, paddedCik: string, maxResults: number): SearchResult[] {
    const { recent } = data.filings;
    const results: SearchResult[] = [];

    for (let i = 0; i < Math.min(recent.form.length, maxResults); i++) {
      const accession = recent.accessionNumber[i].replace(/-/g, "");

      results.push({
        id: `sec-${paddedCik}-${recent.accessionNumber[i]}`,
        source: "sec" as const,
        title: `${data.name} - ${recent.form[i]} (${recent.filingDate[i]})`,
        snippet: `SEC ${recent.form[i]} filing for ${data.name}`,
        url: `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik)}/${accession}/${recent.primaryDocument[i]}`,
        score: 1 - (i / recent.form.length),
        originalRank: i + 1,
        contentType: "filing" as const,
        publishedAt: recent.filingDate[i],
        author: data.name,
        metadata: {
          formType: recent.form[i],
          cik: paddedCik,
          accessionNumber: recent.accessionNumber[i],
        },
      });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM C (REG CF) SEARCH - Crowdfunding offerings
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search for Form C filings by company name
   * Form C is used for Regulation Crowdfunding (Reg CF) offerings
   */
  async searchFormC(companyName: string, maxResults: number = 10): Promise<FormCFiling[]> {
    console.log(`[SecAdapter] Searching Form C filings for: ${companyName}`);

    try {
      // Use EDGAR full-text search API
      const results = await this.searchEdgarFullText(companyName, ["C", "C/A", "C-U", "C-AR"], maxResults);

      return results.map((hit) => ({
        cik: hit._source.ciks[0] || "",
        companyName: hit._source.display_names[0] || companyName,
        accessionNumber: hit._source.accession_number,
        filingDate: hit._source.file_date,
        formType: hit._source.form,
        url: this.buildFilingUrl(hit._source.ciks[0], hit._source.accession_number),
      }));
    } catch (error) {
      console.error("[SecAdapter] Form C search failed:", error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM D (REG D) SEARCH - Private placement offerings
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search for Form D filings by company name
   * Form D is used for Regulation D private placement offerings
   */
  async searchFormD(companyName: string, maxResults: number = 10): Promise<FormDFiling[]> {
    console.log(`[SecAdapter] Searching Form D filings for: ${companyName}`);

    try {
      // Use EDGAR full-text search API
      const results = await this.searchEdgarFullText(companyName, ["D", "D/A"], maxResults);

      return results.map((hit) => ({
        cik: hit._source.ciks[0] || "",
        companyName: hit._source.display_names[0] || companyName,
        accessionNumber: hit._source.accession_number,
        filingDate: hit._source.file_date,
        formType: hit._source.form,
        url: this.buildFilingUrl(hit._source.ciks[0], hit._source.accession_number),
      }));
    } catch (error) {
      console.error("[SecAdapter] Form D search failed:", error);
      return [];
    }
  }

  /**
   * Search for any SEC filings by company name (Form C, D, or both)
   */
  async searchByCompanyName(
    companyName: string,
    formTypes: string[] = ["C", "C/A", "C-U", "C-AR", "D", "D/A"],
    maxResults: number = 20
  ): Promise<Array<FormCFiling | FormDFiling>> {
    console.log(`[SecAdapter] Searching filings for company: ${companyName}`);

    try {
      const results = await this.searchEdgarFullText(companyName, formTypes, maxResults);

      return results.map((hit) => {
        const isFormC = hit._source.form.startsWith("C");

        return {
          cik: hit._source.ciks[0] || "",
          companyName: hit._source.display_names[0] || companyName,
          accessionNumber: hit._source.accession_number,
          filingDate: hit._source.file_date,
          formType: hit._source.form,
          url: this.buildFilingUrl(hit._source.ciks[0], hit._source.accession_number),
        };
      });
    } catch (error) {
      console.error("[SecAdapter] Company search failed:", error);
      return [];
    }
  }

  /**
   * Verify if a specific company has SEC filings
   */
  async verifyCompanyHasFilings(
    companyName: string,
    expectedFormTypes: string[] = ["C", "D"]
  ): Promise<{
    hasFilings: boolean;
    filings: Array<FormCFiling | FormDFiling>;
    foundFormTypes: string[];
  }> {
    const filings = await this.searchByCompanyName(companyName, expectedFormTypes, 10);

    const foundFormTypes = [...new Set(filings.map(f => f.formType.replace("/A", "")))];

    return {
      hasFilings: filings.length > 0,
      filings,
      foundFormTypes,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search EDGAR using the full-text search API
   */
  private async searchEdgarFullText(
    query: string,
    formTypes: string[],
    maxResults: number
  ): Promise<EdgarFullTextHit[]> {
    // Build the query for EDGAR full-text search
    const formFilter = formTypes.map(f => `"${f}"`).join(" OR ");
    const searchQuery = {
      q: query,
      dateRange: "custom",
      forms: formTypes,
      startdt: "2010-01-01",
      enddt: new Date().toISOString().split("T")[0],
    };

    // EDGAR full-text search endpoint
    const url = new URL("https://efts.sec.gov/LATEST/search-index");
    url.searchParams.set("q", query);
    url.searchParams.set("forms", formTypes.join(","));
    url.searchParams.set("dateRange", "custom");
    url.searchParams.set("startdt", "2010-01-01");
    url.searchParams.set("enddt", new Date().toISOString().split("T")[0]);

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": this.userAgent },
    });

    if (!response.ok) {
      // Fall back to company search if full-text fails
      console.log("[SecAdapter] Full-text search unavailable, trying company lookup");
      return this.fallbackCompanySearch(query, formTypes, maxResults);
    }

    const data: EdgarFullTextResponse = await response.json();
    return data.hits.hits.slice(0, maxResults);
  }

  /**
   * Fallback: Search by looking up company CIK and filtering filings
   */
  private async fallbackCompanySearch(
    companyName: string,
    formTypes: string[],
    maxResults: number
  ): Promise<EdgarFullTextHit[]> {
    try {
      // Try to find company by name in SEC company search
      const response = await fetch(
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=&dateb=&owner=include&count=40&output=json`,
        { headers: { "User-Agent": this.userAgent } }
      );

      if (!response.ok) return [];

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return [];

      const data = await response.json();
      const companies = data?.results || [];

      // For each company, get their filings
      const results: EdgarFullTextHit[] = [];

      for (const company of companies.slice(0, 3)) {
        if (!company.cik) continue;

        const paddedCik = company.cik.toString().padStart(10, "0");
        const submissionsResponse = await fetch(
          `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
          { headers: { "User-Agent": this.userAgent } }
        );

        if (!submissionsResponse.ok) continue;

        const submissions: SecSubmissionsResponse = await submissionsResponse.json();
        const { recent } = submissions.filings;

        for (let i = 0; i < recent.form.length && results.length < maxResults; i++) {
          const formType = recent.form[i];
          if (formTypes.some(ft => formType === ft || formType.startsWith(ft))) {
            results.push({
              _id: `${paddedCik}-${recent.accessionNumber[i]}`,
              _source: {
                ciks: [paddedCik],
                display_names: [submissions.name],
                form: formType,
                file_date: recent.filingDate[i],
                accession_number: recent.accessionNumber[i],
                file_num: "",
              },
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.error("[SecAdapter] Fallback search failed:", error);
      return [];
    }
  }

  /**
   * Build URL to filing on SEC.gov
   */
  private buildFilingUrl(cik: string, accessionNumber: string): string {
    const paddedCik = cik.padStart(10, "0");
    const accessionClean = accessionNumber.replace(/-/g, "");
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=&dateb=&owner=include&count=40&search_text=`;
  }
}

export const secAdapter = new SecAdapter();

