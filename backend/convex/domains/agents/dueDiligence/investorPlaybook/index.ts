/**
 * Investor Due Diligence Playbook
 *
 * A comprehensive verification framework for investor protection.
 * Based on standard investor-protection diligence workflow:
 *
 * Phase 1: Entity Verification (State Registries)
 * Phase 2: Securities Path Verification (SEC EDGAR)
 * Phase 3: Funding Portal Validation (FINRA)
 * Phase 4: FDA Status Verification
 * Phase 5: Patent Verification (USPTO)
 * Phase 6: Money Flow Integrity
 * Phase 7: Claim Verification (Strategic Hypothesis Validation)
 * Phase 8: Person Verification (Professional Background)
 * Phase 9: News/Acquisition Verification
 *
 * Usage:
 * ```typescript
 * import { runInvestorPlaybook } from "./investorPlaybook";
 *
 * const result = await runInvestorPlaybook(ctx, {
 *   entityName: "MyDentalWig",
 *   entityType: "company",
 *   claimedState: "DE",
 *   claimedSecuritiesRegime: "Reg CF",
 *   claimedFundingPortal: "Wefunder",
 *   claimedFDAStatus: "FDA Cleared",
 *   wireInstructions: "Wire to our escrow at...",
 *   // New: Claim verification mode
 *   claimVerificationMode: {
 *     enabled: true,
 *     rawQuery: "Is John Smith VP of Sales at Acme Corp?",
 *     personToVerify: "John Smith",
 *     personClaimedRole: "VP of Sales",
 *     personClaimedCompany: "Acme Corp",
 *   },
 * });
 *
 * if (result.synthesis.shouldDisengage) {
 *   console.log("STOP - Critical issues detected");
 * }
 * ```
 */

// Main orchestrator
export {
  runInvestorPlaybook,
  generatePlaybookReport,
  type PlaybookConfig,
  type PlaybookResult,
} from "./playbookOrchestrator";

// Types
export * from "./types";

// Individual branches (for direct use if needed)
export {
  executeEntityVerificationBranch,
  executeSecEdgarBranch,
  executeFinraValidationBranch,
  executeFdaVerificationBranch,
  executeUsptoDeepdiveBranch,
  executeMoneyFlowBranch,
  // New verification branches
  executeClaimVerificationBranch,
  executePersonVerificationBranch,
  executeNewsVerificationBranch,
  extractClaimsFromQuery,
} from "./branches";
