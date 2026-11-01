/**
 * secEdgar.ts — SEC EDGAR API for real financial data.
 *
 * Free, no API key required. Returns real revenue, net income, assets
 * from 10-K/10-Q filings for US public companies.
 *
 * EDGAR full-text search: https://efts.sec.gov/LATEST/search-index?q=COMPANY
 * Company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 * Company tickers: https://www.sec.gov/files/company_tickers.json
 */

import { fetchPipelineJson, PipelineHttpError } from "./pipelineHttp.js";

const EDGAR_UA = "NodeBench/1.0 (nodebench@nodebenchai.com)";
const TICKER_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK";

interface EdgarFinancials {
  cik: string;
  entityName: string;
  ticker: string;
  revenue: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  filingDate: string | null;
  fiscalYear: number | null;
  source: string;
}

// Cache ticker lookup (loaded once)
let tickerCache: Map<string, { cik: string; ticker: string; name: string }> | null = null;

async function loadTickers(signal?: AbortSignal): Promise<Map<string, { cik: string; ticker: string; name: string }>> {
  signal?.throwIfAborted();
  if (tickerCache) return tickerCache;

  try {
    const data = await fetchPipelineJson(TICKER_URL, {
      headers: { "User-Agent": EDGAR_UA },
    }, 2_097_152, signal, 10_000) as Record<string, { cik_str: string; ticker: string; title: string }>;
    const entries = Object.values(data);
    if (!entries.length || entries.length > 25_000) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
    const complete = new Map<string, { cik: string; ticker: string; name: string }>();
    for (const entry of entries) {
      if (!entry || typeof entry.title !== "string" || !entry.title.trim() || typeof entry.ticker !== "string" || !entry.ticker.trim() || !/^\d{1,10}$/.test(String(entry.cik_str))) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
      const key = entry.title.toLowerCase();
      const cik = String(entry.cik_str).padStart(10, "0");
      complete.set(key, { cik, ticker: entry.ticker, name: entry.title });
      // Also index by ticker
      complete.set(entry.ticker.toLowerCase(), { cik, ticker: entry.ticker, name: entry.title });
      if (complete.size > 25_000) throw new PipelineHttpError("INVALID_PROVIDER_RESPONSE");
    }
    signal?.throwIfAborted();
    tickerCache = complete;
    return tickerCache;
  } catch (error) {
    if (signal?.aborted) throw error;
    return new Map();
  }
}

function findCompanyCIK(entityName: string, tickers: Map<string, { cik: string; ticker: string; name: string }>): { cik: string; ticker: string; name: string } | null {
  const lower = entityName.toLowerCase().trim();

  // Exact match
  if (tickers.has(lower)) return tickers.get(lower)!;

  // Partial match — find first entry where name contains the search term
  for (const [key, val] of tickers) {
    if (key.includes(lower) || lower.includes(key.split(" ")[0])) {
      return val;
    }
  }

  return null;
}

function extractFact(facts: any, concepts: string[], unit = "USD"): { value: number; date: string; fy: number } | null {
  for (const concept of concepts) {
    const parts = concept.split(":");
    const namespace = parts[0]; // "us-gaap" or "dei"
    const name = parts[1];

    const conceptData = facts?.facts?.[namespace]?.[name];
    if (!conceptData) continue;

    const units = conceptData?.units?.[unit] ?? conceptData?.units?.["USD/shares"] ?? [];
    if (!Array.isArray(units) || units.length === 0) continue;

    // Get most recent annual filing (10-K, form "10-K")
    const annual = units
      .filter((u: any) => u.form === "10-K" || u.form === "10-K/A")
      .sort((a: any, b: any) => (b.end ?? "").localeCompare(a.end ?? ""));

    if (annual.length > 0) {
      return { value: annual[0].val, date: annual[0].end, fy: annual[0].fy ?? 0 };
    }

    // Fall back to most recent 10-Q
    const quarterly = units
      .filter((u: any) => u.form === "10-Q")
      .sort((a: any, b: any) => (b.end ?? "").localeCompare(a.end ?? ""));

    if (quarterly.length > 0) {
      return { value: quarterly[0].val * 4, date: quarterly[0].end, fy: quarterly[0].fy ?? 0 }; // Annualize
    }
  }

  return null;
}

/**
 * Fetch real financial data from SEC EDGAR for a public company.
 * Free API, no key required. Returns null for private companies.
 */
export async function fetchEdgarFinancials(entityName: string, signal?: AbortSignal): Promise<EdgarFinancials | null> {
  try {
    const tickers = await loadTickers(signal);
    const company = findCompanyCIK(entityName, tickers);
    if (!company) return null;

    const facts = await fetchPipelineJson(`${FACTS_URL}${company.cik}.json`, {
      headers: { "User-Agent": EDGAR_UA },
    }, 5_242_880, signal, 15_000);

    // Extract key financials
    const revenue = extractFact(facts, [
      "us-gaap:Revenues",
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:SalesRevenueNet",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
    ]);

    const netIncome = extractFact(facts, [
      "us-gaap:NetIncomeLoss",
      "us-gaap:ProfitLoss",
    ]);

    const totalAssets = extractFact(facts, [
      "us-gaap:Assets",
    ]);

    return {
      cik: company.cik,
      entityName: company.name,
      ticker: company.ticker,
      revenue: revenue?.value ?? null,
      netIncome: netIncome?.value ?? null,
      totalAssets: totalAssets?.value ?? null,
      filingDate: revenue?.date ?? netIncome?.date ?? null,
      fiscalYear: revenue?.fy ?? netIncome?.fy ?? null,
      source: `SEC EDGAR (CIK ${company.cik})`,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
