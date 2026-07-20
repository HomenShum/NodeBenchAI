// convex/tools/secFilingTools.ts
// SEC EDGAR filing download and analysis tools for Convex Agent
// Enables voice-controlled SEC document operations

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";

/**
 * Search for SEC filings by company ticker or CIK
 * Voice: "Find SEC filings for Apple" or "Get 10-K for AAPL"
 */
export const searchSecFilings = createTool({
  description: "Search for SEC EDGAR filings by company ticker symbol, CIK number, or company name. Returns recent filings including 10-K, 10-Q, 8-K, and other forms. Use this when the user wants to find SEC documents, annual reports, quarterly reports, or other regulatory filings. If the user provides a company name (not a ticker), this tool will search for matching companies and may prompt for disambiguation if multiple matches are found.",

  args: z.object({
    ticker: z.string().optional().describe("Company ticker symbol (e.g., 'AAPL', 'TSLA')"),
    cik: z.string().optional().describe("SEC CIK number (10-digit identifier)"),
    companyName: z.string().optional().describe("Company name to search for (e.g., 'Apple', 'Tesla', 'Dasher')"),
    formType: z.enum(["10-K", "10-Q", "8-K", "DEF 14A", "S-1", "ALL"]).default("ALL").describe("Type of SEC form to search for"),
    limit: z.number().min(1).max(20).default(10).describe("Maximum number of filings to return"),
    threadId: z.string().optional().describe("Thread ID for company confirmation persistence"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[searchSecFilings] Searching SEC filings:`, args);

    if (!args.ticker && !args.cik && !args.companyName) {
      return "Please provide either a ticker symbol, CIK number, or company name to search for SEC filings.";
    }

    try {
      // SEC EDGAR API endpoint
      const userAgent = "NodeBench AI contact@nodebench.ai"; // Required by SEC

      let cik = args.cik;
      let companyName = "";

      // If company name provided, search for matches and check for disambiguation
      if (args.companyName && !cik && !args.ticker) {
        console.log(`[searchSecFilings] Searching by company name: ${args.companyName}`);

        // Check if company has been confirmed for this thread
        if (args.threadId) {
          const confirmed = await ctx.runQuery(internal.tools.sec.secCompanySearch.getConfirmedCompany, {
            threadId: args.threadId,
            companyName: args.companyName,
          });

          if (confirmed) {
            console.log(`[searchSecFilings] Using confirmed company: ${confirmed.name} (CIK: ${confirmed.cik})`);
            cik = confirmed.cik;
            companyName = confirmed.name;
          }
        }

        // If not confirmed, search for companies
        if (!cik) {
          const companies = await ctx.runAction(internal.tools.sec.secCompanySearch.searchCompanies, {
            companyName: args.companyName,
          });

          if (companies.length === 0) {
            return `Could not find any companies matching "${args.companyName}". Please verify the company name or try using a ticker symbol.`;
          }

          // If multiple companies found, validate with LLM
          if (companies.length > 1) {
            const validated = await ctx.runAction(internal.tools.sec.secCompanySearch.validateCompanyMatches, {
              userQuery: args.companyName,
              companies,
            });

            const passedCompanies = validated.filter((c: any) => c.validationResult === "PASS");

            if (passedCompanies.length === 0) {
              return `I found companies matching "${args.companyName}", but none seem to be a good match. Please provide more details or use a ticker symbol.`;
            }

            if (passedCompanies.length === 1) {
              // Only one company passed validation, use it automatically
              cik = passedCompanies[0].cik;
              companyName = passedCompanies[0].name;
              console.log(`[searchSecFilings] Auto-selected company: ${companyName} (CIK: ${cik})`);
            } else {
              // Multiple companies passed validation, prompt user for selection
              console.log(`[searchSecFilings] Multiple companies passed validation, prompting user`);

              const companyOptions = passedCompanies.map((c: any) => ({
                id: c.cik,
                name: c.name,
                ticker: c.ticker,
                description: `CIK: ${c.cik}${c.ticker ? ` | Ticker: ${c.ticker}` : ''}`,
              }));

              // Return structured output for company selection
              const structuredOutput = {
                kind: 'company_selection' as const,
                version: 1,
                summary: `I found multiple companies matching "${args.companyName}". Please select the company you're looking for.`,
                data: {
                  prompt: `I found multiple companies matching '${args.companyName}'. Which one did you mean?`,
                  companies: companyOptions,
                },
              };

              return JSON.stringify(structuredOutput);
            }
          } else {
            // Only one company found, use it
            cik = companies[0].cik;
            companyName = companies[0].name;
            console.log(`[searchSecFilings] Single company found: ${companyName} (CIK: ${cik})`);
          }
        }
      }

      // If ticker provided, look up CIK first
      if (args.ticker && !cik) {
        const tickerUpper = args.ticker.toUpperCase();
        const tickerResponse = await fetch(
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${tickerUpper}&output=json`,
          { headers: { "User-Agent": userAgent } }
        );

        if (!tickerResponse.ok) {
          return `Failed to look up ticker ${args.ticker}. Please verify the ticker symbol is correct.`;
        }

        // Check content type to ensure we got JSON, not HTML
        const contentType = tickerResponse.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.error(`[searchSecFilings] Expected JSON but got ${contentType}`);
          return `SEC API returned unexpected content type. The ticker lookup service may be temporarily unavailable. Please try again in a moment.`;
        }

        let tickerData;
        try {
          tickerData = await tickerResponse.json();
        } catch (parseError) {
          console.error(`[searchSecFilings] Failed to parse ticker response:`, parseError);
          return `Failed to parse SEC API response for ticker ${args.ticker}. The service may be temporarily unavailable.`;
        }

        cik = tickerData?.cik || null;

        if (!cik) {
          return `Could not find CIK for ticker ${args.ticker}. Please verify the ticker symbol.`;
        }
      }

      // Pad CIK to 10 digits
      const paddedCik = cik!.padStart(10, '0');

      // Fetch company submissions
      const submissionsUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
      const response = await fetch(submissionsUrl, {
        headers: { "User-Agent": userAgent }
      });

      if (!response.ok) {
        return `Failed to fetch SEC filings for CIK ${paddedCik}. Status: ${response.status}`;
      }

      // Check content type to ensure we got JSON, not HTML
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error(`[searchSecFilings] Expected JSON but got ${contentType}`);
        return `SEC API returned unexpected content type. The service may be temporarily unavailable. Please try again in a moment.`;
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error(`[searchSecFilings] Failed to parse SEC response:`, parseError);
        return `Failed to parse SEC API response. The service may be temporarily unavailable.`;
      }
      if (!companyName) {
        companyName = data.name || "Unknown Company";
      }
      
      // Filter filings by form type if specified
      const recentFilings = data.filings?.recent || {};
      const forms = recentFilings.form || [];
      const filingDates = recentFilings.filingDate || [];
      const accessionNumbers = recentFilings.accessionNumber || [];
      const primaryDocuments = recentFilings.primaryDocument || [];

      const filings: Array<{
        formType: any;
        filingDate: any;
        accessionNumber: any;
        primaryDocument: any;
        url: string;
        documentUrl: string;
      }> = [];
      for (let i = 0; i < Math.min(forms.length, args.limit * 3); i++) {
        const formType = forms[i];
        
        // Filter by form type if not ALL
        if (args.formType !== "ALL" && formType !== args.formType) {
          continue;
        }

        filings.push({
          formType,
          filingDate: filingDates[i],
          accessionNumber: accessionNumbers[i],
          primaryDocument: primaryDocuments[i],
          url: `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${paddedCik}&accession_number=${accessionNumbers[i].replace(/-/g, '')}&xbrl_type=v`,
          documentUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik)}/${accessionNumbers[i].replace(/-/g, '')}/${primaryDocuments[i]}`
        });

        if (filings.length >= args.limit) break;
      }

      if (filings.length === 0) {
        return `No ${args.formType === "ALL" ? "" : args.formType + " "}filings found for ${companyName} (${args.ticker || paddedCik}).`;
      }

      // Prepare structured data for gallery rendering
      const secDocuments = filings.map((filing) => ({
        title: `${companyName} ${filing.formType}`,
        formType: filing.formType,
        filingDate: filing.filingDate,
        accessionNumber: filing.accessionNumber,
        documentUrl: filing.documentUrl,
        viewerUrl: filing.url,
        ticker: args.ticker?.toUpperCase(),
        companyName,
      }));

      // Create human-readable summary for LLM (concise)
      const filingSummaries = filings.slice(0, 3).map((f, i) =>
        `${i + 1}. ${f.formType} - Filed: ${f.filingDate}`
      ).join('\n');
      const summary = `Found ${filings.length} SEC filings for ${companyName} (CIK: ${paddedCik})${args.ticker ? ` [${args.ticker.toUpperCase()}]` : ''}:\n${filingSummaries}${filings.length > 3 ? `\n...and ${filings.length - 3} more` : ''}`;

      // Return structured output (frontend parses this directly, no regex needed)
      const structuredOutput = {
        kind: 'sec_filing_results' as const,
        version: 1,
        summary,
        data: {
          documents: secDocuments,
          query: args.companyName || args.ticker || paddedCik,
          totalResults: filings.length,
        },
      };

      return JSON.stringify(structuredOutput);

    } catch (error) {
      console.error("[searchSecFilings] Error:", error);
      return `Error searching SEC filings: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Download and save an SEC filing document
 * Voice: "Download the latest 10-K for Apple" or "Save that SEC filing"
 */
export const downloadSecFiling = createTool({
  description: "Download an SEC filing document from EDGAR and save it to your documents. Supports HTML, TXT, and PDF formats. Use this after searching for filings to download and save specific documents.",
  
  args: z.object({
    documentUrl: z.string().describe("The SEC document URL (from searchSecFilings results)"),
    title: z.string().optional().describe("Custom title for the saved document (auto-generated if not provided)"),
    saveAsDocument: z.boolean().default(true).describe("Whether to save the filing as a document in the system"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[downloadSecFiling] Downloading SEC filing:`, args.documentUrl);

    try {
      const userAgent = "NodeBench AI contact@nodebench.ai";
      
      // Fetch the document
      const response = await fetch(args.documentUrl, {
        headers: { "User-Agent": userAgent }
      });

      if (!response.ok) {
        return `Failed to download SEC filing. Status: ${response.status}`;
      }

      const contentType = response.headers.get("content-type") || "";
      let content = await response.text();

      // Extract title from URL if not provided
      const urlParts = args.documentUrl.split('/');
      const fileName = urlParts[urlParts.length - 1] || "sec-filing";
      const defaultTitle = args.title || `SEC Filing - ${fileName}`;

      // Clean HTML content if needed
      if (contentType.includes("html")) {
        // Remove scripts and styles
        content = content
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<style[^>]*>.*?<\/style>/gis, '');
      }

      // Truncate if too large (Convex has size limits)
      const maxLength = 100000; // ~100KB of text
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + "\n\n[Document truncated due to size...]";
      }

      if (args.saveAsDocument) {
        // Save as a document
        const documentId = await ctx.runMutation(api.domains.documents.documents.create, {
          title: defaultTitle,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Source: ${args.documentUrl}\n\n` }]
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: content }]
            }
          ],
        });

        return `SEC filing downloaded and saved successfully!

Title: "${defaultTitle}"
Document ID: ${documentId}
Source: ${args.documentUrl}
Size: ${content.length.toLocaleString()} characters

The document is ready to view and analyze.`;
      } else {
        // Just return the content
        return `SEC Filing Content:\n\nSource: ${args.documentUrl}\n\n${content.substring(0, 5000)}${content.length > 5000 ? '\n\n[Content truncated for display...]' : ''}`;
      }

    } catch (error) {
      console.error("[downloadSecFiling] Error:", error);
      return `Error downloading SEC filing: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Get company information from SEC EDGAR
 * Voice: "Get company info for Tesla" or "What's the CIK for Microsoft?"
 */
export const getCompanyInfo = createTool({
  description: "Get company information from SEC EDGAR including CIK, SIC code, business address, and fiscal year end. Use this to look up company details or verify ticker symbols.",
  
  args: z.object({
    ticker: z.string().optional().describe("Company ticker symbol"),
    cik: z.string().optional().describe("SEC CIK number"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[getCompanyInfo] Looking up company:`, args);

    if (!args.ticker && !args.cik) {
      return "Please provide either a ticker symbol or CIK number.";
    }

    try {
      const userAgent = "NodeBench AI contact@nodebench.ai";
      
      let cik = args.cik;
      
      // Look up CIK from ticker if needed
      if (args.ticker && !cik) {
        const tickerUpper = args.ticker.toUpperCase();
        const tickerResponse = await fetch(
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${tickerUpper}&output=json`,
          { headers: { "User-Agent": userAgent } }
        );

        if (!tickerResponse.ok) {
          return `Failed to look up ticker ${args.ticker}.`;
        }

        // Check content type
        const contentType = tickerResponse.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.error(`[getCompanyInfo] Expected JSON but got ${contentType}`);
          return `SEC API returned unexpected content type. Please try again in a moment.`;
        }

        let tickerData;
        try {
          tickerData = await tickerResponse.json();
        } catch (parseError) {
          console.error(`[getCompanyInfo] Failed to parse ticker response:`, parseError);
          return `Failed to parse SEC API response for ticker ${args.ticker}.`;
        }

        cik = tickerData?.cik || null;
      }

      if (!cik) {
        return `Could not find company information for ${args.ticker || args.cik}.`;
      }

      const paddedCik = cik.padStart(10, '0');

      // Fetch company data
      const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent }
      });

      if (!response.ok) {
        return `Failed to fetch company information. Status: ${response.status}`;
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error(`[getCompanyInfo] Expected JSON but got ${contentType}`);
        return `SEC API returned unexpected content type. Please try again in a moment.`;
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error(`[getCompanyInfo] Failed to parse response:`, parseError);
        return `Failed to parse SEC API response.`;
      }

      const result = `Company Information:

Name: ${data.name || "N/A"}
CIK: ${paddedCik}
Ticker: ${data.tickers?.join(", ") || args.ticker?.toUpperCase() || "N/A"}
SIC: ${data.sic || "N/A"} - ${data.sicDescription || "N/A"}
Fiscal Year End: ${data.fiscalYearEnd || "N/A"}

Business Address:
${data.addresses?.business?.street1 || ""}
${data.addresses?.business?.street2 || ""}
${data.addresses?.business?.city || ""}, ${data.addresses?.business?.stateOrCountry || ""} ${data.addresses?.business?.zipCode || ""}

Mailing Address:
${data.addresses?.mailing?.street1 || ""}
${data.addresses?.mailing?.street2 || ""}
${data.addresses?.mailing?.city || ""}, ${data.addresses?.mailing?.stateOrCountry || ""} ${data.addresses?.mailing?.zipCode || ""}

Former Names: ${data.formerNames?.map((fn: any) => `${fn.name} (until ${fn.to})`).join(", ") || "None"}

Category: ${data.category || "N/A"}
Entity Type: ${data.entityType || "N/A"}`;

      return result;

    } catch (error) {
      console.error("[getCompanyInfo] Error:", error);
      return `Error fetching company information: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
