/**
 * SEC EDGAR API Wrapper for Tool Router
 * 
 * Internal action wrappers for SEC filing tools to enable
 * health-aware routing via toolRouter.
 */

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// SEC Filing Search Wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search SEC EDGAR filings - routable through toolRouter.
 * Wraps the SEC EDGAR API with proper types for health-aware routing.
 */
export const searchFilings = internalAction({
    args: {
        ticker: v.optional(v.string()),
        cik: v.optional(v.string()),
        companyName: v.optional(v.string()),
        formType: v.optional(v.union(
            v.literal("10-K"),
            v.literal("10-Q"),
            v.literal("8-K"),
            v.literal("DEF 14A"),
            v.literal("S-1"),
            v.literal("ALL")
        )),
        limit: v.optional(v.number()),
    },
    returns: v.object({
        success: v.boolean(),
        filings: v.array(v.object({
            accessionNumber: v.string(),
            filingType: v.string(),
            filedAt: v.string(),
            documentUrl: v.string(),
            company: v.optional(v.string()),
        })),
        artifactIds: v.array(v.id("sourceArtifacts")),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        console.log(`[secEdgarWrapper] Searching SEC filings:`, args);

        if (!args.ticker && !args.cik && !args.companyName) {
            return {
                success: false,
                filings: [],
                artifactIds: [],
                error: "Please provide ticker, cik, or companyName",
            };
        }

        try {
            const userAgent = "NodeBench AI contact@nodebench.ai"; // Required by SEC
            let cik = args.cik;
            let companyName = "";

            // If ticker provided, look up CIK from SEC's company tickers JSON
            if (args.ticker && !cik) {
                const tickerUpper = args.ticker.toUpperCase();

                // Use SEC's company tickers JSON file for lookup
                const tickersResponse = await fetch(
                    "https://www.sec.gov/files/company_tickers.json",
                    { headers: { "User-Agent": userAgent } }
                );

                if (tickersResponse.ok) {
                    const tickersData = await tickersResponse.json();
                    // The response is an object with numeric keys, each containing { cik_str, ticker, title }
                    for (const key of Object.keys(tickersData)) {
                        const company = tickersData[key];
                        if (company.ticker === tickerUpper) {
                            cik = String(company.cik_str);
                            break;
                        }
                    }
                }

                if (!cik) {
                    return {
                        success: false,
                        filings: [],
                        artifactIds: [],
                        error: `Could not find CIK for ticker ${args.ticker}`,
                    };
                }
            }

            if (!cik) {
                return {
                    success: false,
                    filings: [],
                    artifactIds: [],
                    error: "No CIK available for search",
                };
            }

            // Pad CIK to 10 digits
            const paddedCik = cik.padStart(10, "0");

            // Fetch company submissions
            const submissionsUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
            const response = await fetch(submissionsUrl, {
                headers: { "User-Agent": userAgent },
            });

            if (!response.ok) {
                return {
                    success: false,
                    filings: [],
                    artifactIds: [],
                    error: `Failed to fetch SEC filings. Status: ${response.status}`,
                };
            }

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                return {
                    success: false,
                    filings: [],
                    artifactIds: [],
                    error: "SEC API returned unexpected content type",
                };
            }

            const data = await response.json();
            companyName = data.name || "Unknown Company";

            // Filter filings by form type if specified
            const recentFilings = data.filings?.recent || {};
            const forms = recentFilings.form || [];
            const filingDates = recentFilings.filingDate || [];
            const accessionNumbers = recentFilings.accessionNumber || [];
            const primaryDocuments = recentFilings.primaryDocument || [];

            const limit = args.limit ?? 10;
            const formType = args.formType ?? "ALL";
            const filings: Array<{
                accessionNumber: string;
                filingType: string;
                filedAt: string;
                documentUrl: string;
                company?: string;
            }> = [];

            // Search through more filings when filtering by form type (10-Ks are less frequent)
            const searchLimit = formType !== "ALL" ? Math.min(forms.length, 500) : Math.min(forms.length, limit * 3);
            for (let i = 0; i < searchLimit; i++) {
                const form = forms[i];

                // Filter by form type if not ALL
                if (formType !== "ALL" && form !== formType) {
                    continue;
                }

                filings.push({
                    accessionNumber: accessionNumbers[i],
                    filingType: form,
                    filedAt: filingDates[i],
                    documentUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik)}/${accessionNumbers[i].replace(/-/g, "")}/${primaryDocuments[i]}`,
                    company: companyName,
                });

                if (filings.length >= limit) break;
            }

            // Create sourceArtifacts for each filing
            const artifactIds: any[] = [];
            for (const filing of filings) {
                const artifactResult = await ctx.runMutation(
                    internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
                    {
                        sourceType: "api_response",
                        sourceUrl: filing.documentUrl,
                        rawContent: JSON.stringify({
                            accessionNumber: filing.accessionNumber,
                            filingType: filing.filingType,
                            filedAt: filing.filedAt,
                            company: filing.company,
                        }),
                        extractedData: {
                            source: "sec_edgar",
                            filingType: filing.filingType,
                            accessionNumber: filing.accessionNumber,
                            filedAt: filing.filedAt,
                            company: companyName,
                            ticker: args.ticker?.toUpperCase(),
                            cik: paddedCik,
                        },
                    }
                );
                artifactIds.push(artifactResult.id);

                await ctx.scheduler.runAfter(0, internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
                    artifactId: artifactResult.id,
                });
            }

            return {
                success: true,
                filings,
                artifactIds,
            };
        } catch (error) {
            console.error("[secEdgarWrapper] Error:", error);
            return {
                success: false,
                filings: [],
                artifactIds: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Company Info Wrapper
// ═══════════════════════════════════════════════════════════════════════════

export const getCompanyInfo = internalAction({
    args: {
        ticker: v.optional(v.string()),
        cik: v.optional(v.string()),
    },
    returns: v.object({
        success: v.boolean(),
        company: v.optional(v.object({
            name: v.string(),
            cik: v.string(),
            ticker: v.optional(v.string()),
            sic: v.optional(v.string()),
            sicDescription: v.optional(v.string()),
            fiscalYearEnd: v.optional(v.string()),
        })),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        console.log(`[secEdgarWrapper] Getting company info:`, args);

        if (!args.ticker && !args.cik) {
            return {
                success: false,
                error: "Please provide ticker or cik",
            };
        }

        try {
            const userAgent = "NodeBench AI contact@nodebench.ai";
            let cik = args.cik;

            // Look up CIK from ticker if needed using SEC's company tickers JSON
            if (args.ticker && !cik) {
                const tickerUpper = args.ticker.toUpperCase();
                const tickersResponse = await fetch(
                    "https://www.sec.gov/files/company_tickers.json",
                    { headers: { "User-Agent": userAgent } }
                );

                if (tickersResponse.ok) {
                    const tickersData = await tickersResponse.json();
                    for (const key of Object.keys(tickersData)) {
                        const company = tickersData[key];
                        if (company.ticker === tickerUpper) {
                            cik = String(company.cik_str);
                            break;
                        }
                    }
                }
            }

            if (!cik) {
                return {
                    success: false,
                    error: `Could not find CIK for ${args.ticker || args.cik}`,
                };
            }

            const paddedCik = cik.padStart(10, "0");

            // Fetch company data
            const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
            const response = await fetch(url, {
                headers: { "User-Agent": userAgent },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `Failed to fetch company info. Status: ${response.status}`,
                };
            }

            const data = await response.json();

            return {
                success: true,
                company: {
                    name: data.name || "Unknown",
                    cik: paddedCik,
                    ticker: data.tickers?.[0] || args.ticker?.toUpperCase(),
                    sic: data.sic,
                    sicDescription: data.sicDescription,
                    fiscalYearEnd: data.fiscalYearEnd,
                },
            };
        } catch (error) {
            console.error("[secEdgarWrapper] Error:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC BENCHMARK ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Public wrapper for SEC filing search - used by benchmark runner.
 * Delegates to internal searchFilings action.
 */
export const benchmarkSearchFilings = action({
    args: {
        ticker: v.optional(v.string()),
        cik: v.optional(v.string()),
        companyName: v.optional(v.string()),
        formType: v.optional(v.union(
            v.literal("10-K"),
            v.literal("10-Q"),
            v.literal("8-K"),
            v.literal("DEF 14A"),
            v.literal("S-1"),
            v.literal("ALL")
        )),
        limit: v.optional(v.number()),
    },
    returns: v.object({
        success: v.boolean(),
        filings: v.array(v.object({
            accessionNumber: v.string(),
            filingType: v.string(),
            filedAt: v.string(),
            documentUrl: v.string(),
            company: v.optional(v.string()),
        })),
        artifactIds: v.array(v.id("sourceArtifacts")),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        // Delegate to internal action
        return await ctx.runAction(internal.domains.agents.orchestrator.secEdgarWrapper.searchFilings, args);
    },
});
