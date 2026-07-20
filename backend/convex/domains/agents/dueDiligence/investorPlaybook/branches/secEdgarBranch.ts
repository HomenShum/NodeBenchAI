/**
 * SEC EDGAR Verification Branch
 *
 * Verifies securities offerings via SEC EDGAR database:
 * - Form C filings (Reg CF crowdfunding)
 * - Form D filings (Reg D private placements)
 * - Company facts and CIK lookup
 * - Filing history and compliance
 *
 * Uses SEC's free EDGAR API:
 * - Company search: https://www.sec.gov/cgi-bin/browse-edgar
 * - Full text search: https://efts.sec.gov/LATEST/search-index
 * - Company facts: https://data.sec.gov/submissions/CIK{cik}.json
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  SecEdgarFindings,
  SecEdgarAPIResponse,
  FormCFiling,
  FormDFiling,
  SecuritiesRegime,
} from "../types";

// SEC EDGAR API endpoints
const SEC_EDGAR_BASE = "https://data.sec.gov";
const SEC_SEARCH_BASE = "https://efts.sec.gov/LATEST/search-index";
const SEC_BROWSE_BASE = "https://www.sec.gov/cgi-bin/browse-edgar";

interface SecEdgarBranchResult {
  findings: SecEdgarFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeSecEdgarBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedRegime?: SecuritiesRegime
): Promise<SecEdgarBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Search for company CIK via SEC EDGAR
    const cikResult = await searchCompanyCIK(ctx, entityName);

    if (cikResult.cik) {
      sources.push({
        sourceType: "sec_filing",
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikResult.cik}`,
        title: "SEC EDGAR Company Search",
        accessedAt: now,
        reliability: "authoritative",
        section: "sec_verification",
      });
      confidence += 0.2;
    }

    // Step 2: Fetch company submissions/filings
    const filings = cikResult.cik
      ? await fetchCompanyFilings(ctx, cikResult.cik, entityName)
      : await searchFilingsByName(ctx, entityName);

    // Step 3: Parse Form C filings (Reg CF)
    let formCFilings = parseFormCFilings(filings, entityName);

    // Step 3b: Enrich Form C filings with actual financial data from SEC EDGAR
    if (cikResult.cik && formCFilings.length > 0) {
      const enrichedFilings: FormCFiling[] = [];
      for (const filing of formCFilings) {
        // Try to fetch actual financial data for the most recent filing
        if (filing.accessionNumber && !filing.accessionNumber.startsWith("UNKNOWN")) {
          const financialData = await fetchFormCFinancials(ctx, cikResult.cik, filing.accessionNumber);
          if (financialData) {
            enrichedFilings.push({
              ...filing,
              intermediaryName: financialData.intermediaryName || filing.intermediaryName,
              financials: {
                totalRevenue: financialData.totalRevenue,
                totalAssets: financialData.totalAssets,
                totalLiabilities: financialData.totalLiabilities,
                netIncome: financialData.netIncome,
                employeeCount: financialData.employeeCount,
              },
            });
            continue;
          }
        }
        enrichedFilings.push(filing);
      }
      formCFilings = enrichedFilings;
    }

    // Step 4: Parse Form D filings (Reg D)
    const formDFilings = parseFormDFilings(filings, entityName);

    // Step 5: Determine securities regime
    const { regime, regimeConfidence } = determineSecuritiesRegime(
      formCFilings,
      formDFilings,
      claimedRegime
    );

    // Step 6: Build findings
    const findings: SecEdgarFindings = {
      company: {
        ciks: cikResult.cik ? [cikResult.cik] : [],
        legalName: cikResult.companyName,
        stateOfIncorporation: cikResult.stateOfIncorporation,
        sicDescription: cikResult.sicDescription,
      },
      securitiesRegime: regime,
      regimeConfidence,
      formCFilings,
      formDFilings,
      otherFilings: parseOtherFilings(filings),
      activeOffering: findActiveOffering(formCFilings, formDFilings),
      verification: {
        filingFound: formCFilings.length > 0 || formDFilings.length > 0,
        termsMatchPitch: claimedRegime ? regime === claimedRegime : true,
        intermediaryListed: formCFilings.some(f => f.intermediaryName),
        offeringActive: hasActiveOffering(formCFilings, formDFilings),
        financialsIncluded: hasFinancialStatements(filings),
      },
      redFlags: generateRedFlags(
        formCFilings,
        formDFilings,
        claimedRegime,
        regime,
        cikResult.cik
      ),
      overallConfidence: calculateOverallConfidence(
        cikResult.cik,
        formCFilings,
        formDFilings,
        confidence
      ),
    };

    // Add filing sources
    for (const filing of [...formCFilings, ...formDFilings].slice(0, 5)) {
      sources.push({
        sourceType: "sec_filing",
        url: filing.filingUrl,
        title: `${filing.formType} - ${filing.filingDate}`,
        accessedAt: now,
        reliability: "authoritative",
        section: "sec_filings",
      });
    }

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[SEC-EDGAR] Error for ${entityName}:`, error);
    return {
      findings: createEmptyFindings(),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// SEC EDGAR API CALLS
// ============================================================================

async function searchCompanyCIK(
  ctx: any,
  companyName: string
): Promise<{
  cik?: string;
  companyName?: string;
  stateOfIncorporation?: string;
  sicDescription?: string;
}> {
  try {
    // Use fusion search to find SEC EDGAR pages
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:sec.gov "${companyName}" CIK`,
        mode: "balanced",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = fusionResult?.payload?.results ?? [];

    // Try to extract CIK from results
    for (const result of results) {
      const content = result.snippet || result.title || "";
      const cikMatch = content.match(/CIK[:\s]*(\d{10}|\d{7})/i);
      if (cikMatch) {
        const cik = cikMatch[1].padStart(10, "0");

        // Fetch full company info from SEC
        const companyInfo = await fetchCompanyInfo(ctx, cik);
        return {
          cik,
          companyName: companyInfo?.name,
          stateOfIncorporation: companyInfo?.stateOfIncorporation,
          sicDescription: companyInfo?.sicDescription,
        };
      }
    }

    // Try direct company search if web search didn't work
    return await directCompanySearch(ctx, companyName);

  } catch (error) {
    console.error(`[SEC-EDGAR] CIK search error:`, error);
    return {};
  }
}

async function directCompanySearch(
  ctx: any,
  companyName: string
): Promise<{
  cik?: string;
  companyName?: string;
  stateOfIncorporation?: string;
  sicDescription?: string;
}> {
  try {
    // SEC company search JSON endpoint
    const searchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=&dateb=&owner=include&count=10&output=json`;

    // Use web fetch to query
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `SEC EDGAR "${companyName}" company filings`,
        mode: "fast",
        maxTotal: 3,
        skipRateLimit: true,
      }
    );

    // Parse results for CIK
    const content = result?.payload?.results?.[0]?.snippet ?? "";
    const cikMatch = content.match(/CIK[:\s#]*(\d{7,10})/i);

    if (cikMatch) {
      return { cik: cikMatch[1].padStart(10, "0") };
    }

    return {};
  } catch (error) {
    return {};
  }
}

async function fetchCompanyInfo(
  ctx: any,
  cik: string
): Promise<{
  name?: string;
  stateOfIncorporation?: string;
  sicDescription?: string;
} | null> {
  try {
    // SEC submissions endpoint - direct fetch
    const paddedCik = cik.padStart(10, "0");
    const submissionsUrl = `${SEC_EDGAR_BASE}/submissions/CIK${paddedCik}.json`;

    console.log(`[SEC EDGAR] Fetching company info from: ${submissionsUrl}`);

    const response = await fetch(submissionsUrl, {
      headers: {
        "User-Agent": "NodeBench InvestorPlaybook/1.0 (contact@example.com)",
        "Accept": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json() as any;
      return {
        name: data.name,
        stateOfIncorporation: data.stateOfIncorporation,
        sicDescription: data.sicDescription,
      };
    }

    return null;
  } catch (error) {
    console.error("[SEC EDGAR] Error fetching company info:", error);
    return null;
  }
}

/**
 * Fetch Form C financial data directly from SEC EDGAR
 * This extracts revenue, assets, and other financial metrics from Form C filings
 */
async function fetchFormCFinancials(
  ctx: any,
  cik: string,
  accessionNumber: string
): Promise<{
  totalRevenue?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  netIncome?: number;
  fiscalYearEnd?: string;
  employeeCount?: number;
  intermediaryName?: string;
} | null> {
  try {
    // Form C data is in XML format at:
    // https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml
    const cleanAccession = accessionNumber.replace(/-/g, "");
    const paddedCik = cik.replace(/^0+/, ""); // Remove leading zeros for path
    const filingUrl = `${SEC_EDGAR_BASE}/Archives/edgar/data/${paddedCik}/${cleanAccession}/primary_doc.xml`;

    console.log(`[SEC EDGAR] Fetching Form C data from: ${filingUrl}`);

    const response = await fetch(filingUrl, {
      headers: {
        "User-Agent": "NodeBench InvestorPlaybook/1.0 (contact@example.com)",
        "Accept": "application/xml, text/xml",
      },
    });

    if (response.ok) {
      const xmlText = await response.text();

      // Parse financial data from XML
      // Form C XML structure includes: revenueRange, totalAssetRange, etc.
      const financials: any = {};

      // Extract revenue (look for various patterns)
      const revenueMatch = xmlText.match(/<totalRevenue>(\d+)<\/totalRevenue>/i) ||
                          xmlText.match(/<revenueRange>([^<]+)<\/revenueRange>/i) ||
                          xmlText.match(/total\s*revenue[:\s]*\$?([\d,]+)/i);
      if (revenueMatch) {
        const value = revenueMatch[1].replace(/[$,]/g, "");
        financials.totalRevenue = parseFloat(value) || 0;
      }

      // Extract assets
      const assetsMatch = xmlText.match(/<totalAssets>(\d+)<\/totalAssets>/i) ||
                         xmlText.match(/<totalAssetRange>([^<]+)<\/totalAssetRange>/i) ||
                         xmlText.match(/total\s*assets[:\s]*\$?([\d,]+)/i);
      if (assetsMatch) {
        const value = assetsMatch[1].replace(/[$,]/g, "");
        financials.totalAssets = parseFloat(value) || 0;
      }

      // Extract liabilities
      const liabilitiesMatch = xmlText.match(/<totalLiabilities>(\d+)<\/totalLiabilities>/i);
      if (liabilitiesMatch) {
        financials.totalLiabilities = parseFloat(liabilitiesMatch[1]) || 0;
      }

      // Extract net income
      const netIncomeMatch = xmlText.match(/<netIncome>(-?\d+)<\/netIncome>/i) ||
                            xmlText.match(/net\s*income[:\s]*\$?([-\d,]+)/i);
      if (netIncomeMatch) {
        financials.netIncome = parseFloat(netIncomeMatch[1].replace(/[$,]/g, "")) || 0;
      }

      // Extract intermediary (funding portal)
      const intermediaryMatch = xmlText.match(/<intermediaryName>([^<]+)<\/intermediaryName>/i) ||
                               xmlText.match(/<fundingPortalName>([^<]+)<\/fundingPortalName>/i);
      if (intermediaryMatch) {
        financials.intermediaryName = intermediaryMatch[1].trim();
      }

      // Extract employee count
      const employeeMatch = xmlText.match(/<numberOfEmployees>(\d+)<\/numberOfEmployees>/i);
      if (employeeMatch) {
        financials.employeeCount = parseInt(employeeMatch[1]);
      }

      console.log(`[SEC EDGAR] Extracted financials:`, financials);
      return financials;
    }

    return null;
  } catch (error) {
    console.error("[SEC EDGAR] Error fetching Form C financials:", error);
    return null;
  }
}

async function fetchCompanyFilings(
  ctx: any,
  cik: string,
  companyName: string
): Promise<any[]> {
  try {
    // Search for specific filings
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:sec.gov CIK ${cik} (Form C OR Form D OR "Regulation Crowdfunding" OR "Regulation D")`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    return result?.payload?.results ?? [];
  } catch (error) {
    return [];
  }
}

async function searchFilingsByName(
  ctx: any,
  companyName: string
): Promise<any[]> {
  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `site:sec.gov "${companyName}" (Form C OR Form D OR filing)`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    return result?.payload?.results ?? [];
  } catch (error) {
    return [];
  }
}

// ============================================================================
// FILING PARSERS
// ============================================================================

function parseFormCFilings(searchResults: any[], companyName: string): FormCFiling[] {
  const filings: FormCFiling[] = [];
  const companyLower = companyName.toLowerCase();

  for (const result of searchResults) {
    const content = (result.snippet || "") + " " + (result.title || "");
    const contentLower = content.toLowerCase();
    const url = result.url || "";

    // Check if this is a Form C related result
    if (
      contentLower.includes("form c") ||
      contentLower.includes("regulation crowdfunding") ||
      contentLower.includes("reg cf") ||
      url.includes("form-c")
    ) {
      // Extract filing details
      const dateMatch = content.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
      const amountMatch = content.match(/\$?([\d,]+(?:\.\d{2})?)\s*(?:million|M)?/i);

      // Determine form type
      let formType: FormCFiling["formType"] = "C";
      if (contentLower.includes("c/a") || contentLower.includes("amendment")) {
        formType = "C/A";
      } else if (contentLower.includes("c-u") || contentLower.includes("progress")) {
        formType = "C-U";
      } else if (contentLower.includes("c-ar") || contentLower.includes("annual")) {
        formType = "C-AR";
      }

      // Extract accession number from URL
      const accessionMatch = url.match(/(\d{10}-\d{2}-\d{6})/);

      // Extract intermediary (funding portal) from content
      // Common patterns: "through [Portal Name]", "via [Portal Name]", "intermediary: [Portal Name]"
      let intermediaryName: string | undefined;
      const portalPatterns = [
        /(?:through|via|intermediary[:\s]+|portal[:\s]+)\s*([A-Z][A-Za-z\s]+(?:LLC|Inc\.?|Portal|Crowdfunding)?)/i,
        /(?:wefunder|republic|startengine|netcapital|picmii|fundable|seedinvest|mainvest|honeycomb|dealmaker|microventures|equifund|trucrowd|dalmore)/i,
      ];
      for (const pattern of portalPatterns) {
        const match = content.match(pattern);
        if (match) {
          intermediaryName = match[1] || match[0];
          // Normalize portal names
          const normalized = intermediaryName.toLowerCase();
          if (normalized.includes("picmii")) intermediaryName = "PicMii Crowdfunding LLC";
          else if (normalized.includes("wefunder")) intermediaryName = "Wefunder Portal LLC";
          else if (normalized.includes("republic")) intermediaryName = "OpenDeal Portal LLC";
          else if (normalized.includes("startengine")) intermediaryName = "StartEngine Capital LLC";
          break;
        }
      }

      filings.push({
        accessionNumber: accessionMatch?.[1] || `UNKNOWN-${Date.now()}`,
        filingDate: dateMatch?.[1] || "Unknown",
        formType,
        companyName,
        cik: "",
        offeringAmount: amountMatch ? parseAmount(amountMatch[1]) : undefined,
        intermediaryName,
        filingUrl: url || `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=C`,
      });
    }
  }

  // Deduplicate by accession number
  const seen = new Set<string>();
  return filings.filter(f => {
    if (seen.has(f.accessionNumber)) return false;
    seen.add(f.accessionNumber);
    return true;
  });
}

function parseFormDFilings(searchResults: any[], companyName: string): FormDFiling[] {
  const filings: FormDFiling[] = [];

  for (const result of searchResults) {
    const content = (result.snippet || "") + " " + (result.title || "");
    const contentLower = content.toLowerCase();
    const url = result.url || "";

    // Check if this is a Form D related result
    if (
      contentLower.includes("form d") ||
      contentLower.includes("regulation d") ||
      contentLower.includes("rule 506") ||
      url.includes("form-d")
    ) {
      const dateMatch = content.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
      const amountMatch = content.match(/\$?([\d,]+(?:\.\d{2})?)\s*(?:million|M)?/i);
      const accessionMatch = url.match(/(\d{10}-\d{2}-\d{6})/);

      // Determine exemption type
      let exemption: FormDFiling["exemption"] = "Rule 506(b)";
      if (contentLower.includes("506(c)")) {
        exemption = "Rule 506(c)";
      } else if (contentLower.includes("504")) {
        exemption = "Rule 504";
      }

      filings.push({
        accessionNumber: accessionMatch?.[1] || `UNKNOWN-${Date.now()}`,
        filingDate: dateMatch?.[1] || "Unknown",
        formType: contentLower.includes("/a") ? "D/A" : "D",
        companyName,
        exemption,
        totalOfferingAmount: amountMatch ? parseAmount(amountMatch[1]) : undefined,
        issuers: [{
          name: companyName,
          entityType: "Corporation",
          stateOfIncorporation: "Unknown",
        }],
        filingUrl: url || `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=D`,
      });
    }
  }

  const seen = new Set<string>();
  return filings.filter(f => {
    if (seen.has(f.accessionNumber)) return false;
    seen.add(f.accessionNumber);
    return true;
  });
}

function parseOtherFilings(searchResults: any[]): Array<{
  form: string;
  date: string;
  description: string;
  url: string;
}> {
  const filings: Array<{ form: string; date: string; description: string; url: string }> = [];
  const formTypes = ["10-K", "10-Q", "8-K", "S-1", "S-3", "DEF 14A"];

  for (const result of searchResults) {
    const content = (result.snippet || "") + " " + (result.title || "");

    for (const form of formTypes) {
      if (content.includes(form)) {
        const dateMatch = content.match(/(\d{4}-\d{2}-\d{2})/);
        filings.push({
          form,
          date: dateMatch?.[1] || "Unknown",
          description: result.title || form,
          url: result.url || "",
        });
        break;
      }
    }
  }

  return filings.slice(0, 5);
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

function determineSecuritiesRegime(
  formCFilings: FormCFiling[],
  formDFilings: FormDFiling[],
  claimedRegime?: SecuritiesRegime
): { regime: SecuritiesRegime; regimeConfidence: number } {
  // If we found Form C filings, it's Reg CF
  if (formCFilings.length > 0) {
    return { regime: "Reg CF", regimeConfidence: 0.9 };
  }

  // If we found Form D filings, determine specific exemption
  if (formDFilings.length > 0) {
    const latestFiling = formDFilings[0];
    if (latestFiling.exemption === "Rule 506(c)") {
      return { regime: "Reg D 506(c)", regimeConfidence: 0.9 };
    }
    return { regime: "Reg D 506(b)", regimeConfidence: 0.85 };
  }

  // No filings found - use claimed or unknown
  if (claimedRegime) {
    return { regime: claimedRegime, regimeConfidence: 0.3 };
  }

  return { regime: "Unknown", regimeConfidence: 0.1 };
}

function findActiveOffering(
  formCFilings: FormCFiling[],
  formDFilings: FormDFiling[]
): SecEdgarFindings["activeOffering"] | undefined {
  // Check Form C for active offering
  for (const filing of formCFilings) {
    if (filing.deadline) {
      const deadlineDate = new Date(filing.deadline);
      if (deadlineDate > new Date()) {
        return {
          amount: filing.offeringAmount || 0,
          deadline: filing.deadline,
          intermediary: filing.intermediaryName || "Unknown",
          status: "active",
        };
      }
    }
  }

  return undefined;
}

function hasActiveOffering(
  formCFilings: FormCFiling[],
  formDFilings: FormDFiling[]
): boolean {
  // Form C offerings have explicit deadlines
  for (const filing of formCFilings) {
    if (filing.deadline) {
      const deadline = new Date(filing.deadline);
      if (deadline > new Date()) return true;
    }
  }

  // Form D filings within last 12 months may indicate active offering
  for (const filing of formDFilings) {
    if (filing.filingDate && filing.filingDate !== "Unknown") {
      const filingDate = new Date(filing.filingDate);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (filingDate > oneYearAgo) return true;
    }
  }

  return false;
}

function hasFinancialStatements(searchResults: any[]): boolean {
  for (const result of searchResults) {
    const content = (result.snippet || "").toLowerCase();
    if (
      content.includes("financial statement") ||
      content.includes("balance sheet") ||
      content.includes("income statement") ||
      content.includes("audited") ||
      content.includes("reviewed financial")
    ) {
      return true;
    }
  }
  return false;
}

function generateRedFlags(
  formCFilings: FormCFiling[],
  formDFilings: FormDFiling[],
  claimedRegime: SecuritiesRegime | undefined,
  actualRegime: SecuritiesRegime,
  cik: string | undefined
): SecEdgarFindings["redFlags"] {
  const redFlags: SecEdgarFindings["redFlags"] = [];

  // No filings found
  if (formCFilings.length === 0 && formDFilings.length === 0) {
    redFlags.push({
      type: "no_filing",
      severity: claimedRegime ? "high" : "medium",
      description: "No SEC filings found for this company. If they claim a regulated offering, this is a significant concern.",
    });
  }

  // Terms mismatch
  if (claimedRegime && claimedRegime !== actualRegime && actualRegime !== "Unknown") {
    redFlags.push({
      type: "terms_mismatch",
      severity: "high",
      description: `Company claims ${claimedRegime} but SEC filings indicate ${actualRegime}.`,
    });
  }

  // No intermediary for Reg CF
  if (actualRegime === "Reg CF") {
    const hasIntermediary = formCFilings.some(f => f.intermediaryName);
    if (!hasIntermediary) {
      redFlags.push({
        type: "no_intermediary",
        severity: "high",
        description: "Reg CF offering requires a registered funding portal/intermediary, but none is listed in filings.",
      });
    }
  }

  // Offering may be expired
  if (formCFilings.length > 0) {
    const latestFiling = formCFilings[0];
    if (latestFiling.deadline) {
      const deadline = new Date(latestFiling.deadline);
      if (deadline < new Date()) {
        redFlags.push({
          type: "offering_expired",
          severity: "medium",
          description: `The offering deadline (${latestFiling.deadline}) has passed.`,
        });
      }
    }
  }

  return redFlags;
}

function calculateOverallConfidence(
  cik: string | undefined,
  formCFilings: FormCFiling[],
  formDFilings: FormDFiling[],
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (cik) confidence += 0.2;
  if (formCFilings.length > 0) confidence += 0.25;
  if (formDFilings.length > 0) confidence += 0.2;
  if (formCFilings.length > 1 || formDFilings.length > 1) confidence += 0.1;

  return Math.min(0.95, confidence);
}

function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);

  if (amountStr.toLowerCase().includes("million") || amountStr.includes("M")) {
    return num * 1_000_000;
  }
  if (amountStr.toLowerCase().includes("billion") || amountStr.includes("B")) {
    return num * 1_000_000_000;
  }

  return num;
}

function createEmptyFindings(): SecEdgarFindings {
  return {
    company: { ciks: [] },
    securitiesRegime: "Unknown",
    regimeConfidence: 0,
    formCFilings: [],
    formDFilings: [],
    otherFilings: [],
    verification: {
      filingFound: false,
      termsMatchPitch: true,
      intermediaryListed: false,
      offeringActive: false,
      financialsIncluded: false,
    },
    redFlags: [{
      type: "no_filing",
      severity: "medium",
      description: "Unable to verify SEC filings for this entity.",
    }],
    overallConfidence: 0.1,
  };
}
