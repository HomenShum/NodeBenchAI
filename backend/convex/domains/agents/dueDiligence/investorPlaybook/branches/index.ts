/**
 * Investor Playbook Branch Exports
 *
 * Central export for all verification branches in the investor due diligence playbook.
 */

// Core verification branches
export { executeSecEdgarBranch } from "./secEdgarBranch";
export { executeFdaVerificationBranch } from "./fdaVerificationBranch";
export { executeUsptoDeepdiveBranch } from "./usptoBranch";
export { executeFinraValidationBranch } from "./finraValidationBranch";
export { executeEntityVerificationBranch } from "./entityVerificationBranch";
export { executeMoneyFlowBranch } from "./moneyFlowBranch";

// Complex query verification branches
export { executeClaimVerificationBranch, extractClaimsFromQuery } from "./claimVerificationBranch";
export { executePersonVerificationBranch } from "./personVerificationBranch";
export { executeNewsVerificationBranch } from "./newsVerificationBranch";
export { executeScientificClaimVerificationBranch, detectScientificClaims } from "./scientificClaimVerificationBranch";

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA-SPECIFIC BRANCHES
// ═══════════════════════════════════════════════════════════════════════════

// Financial persona branches (Banker, VC, LP)
export { executeDealMemoSynthesisBranch } from "./financial/dealMemoSynthesis";
export { executeFundPerformanceVerificationBranch } from "./financial/fundPerformanceVerification";

// Industry persona branches (Pharma BD, Academic R&D)
export { executeClinicalTrialVerificationBranch } from "./industry/clinicalTrialVerification";
export { executeLiteratureTriangulationBranch } from "./industry/literatureTriangulation";

// Strategic persona branches (Corp Dev, Macro Strategist)
export { executeMAActivityVerificationBranch } from "./strategic/maActivityVerification";
export { executeEconomicIndicatorVerificationBranch } from "./strategic/economicIndicatorVerification";
