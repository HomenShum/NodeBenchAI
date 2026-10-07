// convex/domains/verification/index.ts
// Re-exports for verification domain

// Facts (claim storage)
export * from "./facts";

// Claim verifications (LLM-as-judge verdicts)
export * from "./claimVerifications";

// Internal queries/mutations (used by actions)
export * from "./claimVerificationQueries";

// Calibration infrastructure (FP/FN tracking, threshold tuning)
export * from "./calibration";

// Note: Action files are not re-exported here since they use "use node"
// Import directly from claimVerificationAction.ts or citationScrubberAction.ts
