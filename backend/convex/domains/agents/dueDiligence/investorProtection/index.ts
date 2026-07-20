/**
 * Investor Protection Due Diligence Module
 *
 * Provides verification workflows for protecting retail investors
 * from fraudulent or misleading startup offerings.
 *
 * @module dueDiligence/investorProtection
 */

// Types
export * from "./types";

// Phase handlers
export { extractClaims, extractClaimsWithRegex } from "./phases/claimsExtraction";
