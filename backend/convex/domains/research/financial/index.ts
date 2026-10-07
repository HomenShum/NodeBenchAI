// convex/domains/financial/index.ts
// Financial Domain - SEC XBRL data ingestion and fundamentals management
//
// Components:
// - secEdgarClient: SEC EDGAR API client with rate limiting
// - xbrlParser: XBRL tag normalization and extraction
// - fundamentals: Financial fundamentals storage and queries

export * from "./secEdgarClient";
export * from "./fundamentals";
export { extractFundamentals, listAvailableFiscalYears, listAvailableQuarters } from "./xbrlParser";
