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

async function loadTickers(): Promise<Map<string, { cik: string; ticker: string; name: string }>> {
  if (tickerCache) return tickerCache;

  try {
    const resp = await fetch(TICKER_URL, {
      headers: { "User-Agent": EDGAR_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Tickers ${resp.status}`);

    const data = (await resp.json()) as Record<string, { cik_str: string; ticker: string; title: string }>;
    tickerCache = new Map();

    for (const entry of Object.values(data)) {
      const key = entry.title.toLowerCase();
      const cik = String(entry.cik_str).padStart(10, "0");
      tickerCache.set(key, { cik, ticker: entry.ticker, name: entry.title });
      // Also index by ticker
      tickerCache.set(entry.ticker.toLowerCase(), { cik, ticker: entry.ticker, name: entry.title });
    }

    return tickerCache;
  } catch {
    tickerCache = new Map();
    return tickerCache;
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
export async function fetchEdgarFinancials(entityName: string): Promise<EdgarFinancials | null> {
  try {
    const tickers = await loadTickers();
    const company = findCompanyCIK(entityName, tickers);
    if (!company) return null;

    const resp = await fetch(`${FACTS_URL}${company.cik}.json`, {
      headers: { "User-Agent": EDGAR_UA },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return null;
    const facts = await resp.json();

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
  } catch {
    return null;
  }
}
