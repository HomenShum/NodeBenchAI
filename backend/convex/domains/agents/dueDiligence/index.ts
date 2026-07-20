/**
 * Due Diligence Framework Index
 *
 * Parallelized multi-front research with traditional IC memo output.
 * Re-exports pure helpers and types from the DD framework. Convex server
 * functions are referenced through their defining module so internal authority
 * cannot be confused with a public barrel API.
 */

// Types
export * from "./types";

// Context Engineering (Manus/Anthropic patterns)
export {
  // Types
  type DDScratchpad,
  type BranchFindingSummary,
  type FailedApproach,
  type EntityMemoryEntry,
  type VerifiedFact,
  type BranchExecutionContext,
  // Functions
  generateGoalRecitation,
  summarizeBranchFindings,
  createFailedApproach,
  generateErrorContext,
  extractVerifiedFacts,
  buildDDBranchSystemPrompt,
  // Guardrails
  validateDDInput,
  validateDDOutput,
  checkRateLimit,
  RATE_LIMITS,
  // Action space masking
  BRANCH_ALLOWED_TOOLS,
  isToolAllowed,
  // Mutations/Queries
  createDDScratchpad,
  updateDDScratchpad,
  getDDScratchpad,
  recordFailedApproach,
  recordBranchSummary,
  getEntityMemory,
  updateEntityMemory,
} from "./ddContextEngine";

// Branch Handoffs (OpenAI Agents SDK pattern)
export {
  // Types
  type BranchHandoff,
  type HandoffContext,
  type HandoffQueue,
  type HandoffTrigger,
  // Functions
  detectHandoffs,
  processHandoffQueue,
  buildSignalsFromHandoff,
  formatHandoffContextForPrompt,
  HANDOFF_TRIGGERS,
  // Mutations/Queries
  createHandoffQueue,
  getHandoffQueue,
  addHandoffsToQueue,
  processHandoffs,
  markHandoffCompleted,
} from "./ddBranchHandoff";

// Cross-checker
export {
  crossCheckAllBranches,
  crossCheckBranchPair,
  attemptResolution,
  getSourceReliabilityScore,
} from "./crossChecker";

// Memo synthesizer
export {
  synthesizeDDMemo,
  calculateVerdict,
  generateExecutiveSummary,
} from "./memoSynthesizer";

// Branch handlers (for direct imports if needed)
export { executeCompanyProfileBranch } from "./branches/companyProfile";
export { executeTeamFoundersBranch } from "./branches/teamDeepResearch";
export { executeMarketCompetitiveBranch } from "./branches/marketCompetitive";
export {
  executeTechnicalDDBranch,
  executeIPPatentsBranch,
  executeRegulatoryBranch,
  executeFinancialDeepBranch,
  executeNetworkMappingBranch,
} from "./branches/conditionalBranches";

// ============================================================================
// INVESTOR PLAYBOOK (Verification Framework)
// ============================================================================

// Playbook types and orchestrator (namespaced to avoid conflicts with main types)
export type { InvestorPlaybookBranchType as PlaybookBranchType } from "./investorPlaybook/types";
export { INVESTOR_PLAYBOOK_BRANCHES as PLAYBOOK_BRANCHES } from "./investorPlaybook/types";
export {
  runInvestorPlaybook,
  generatePlaybookReport,
} from "./investorPlaybook/playbookOrchestrator";

// ============================================================================
// INVESTOR PROTECTION (Fraud Detection Verification)
// ============================================================================

// Investor protection types
export type {
  InvestorProtectionJobStatus,
  InvestorProtectionVerdict,
  ExtractedClaims,
  FDAClaim,
  PatentClaim,
  EntityVerificationResult,
  SecuritiesVerificationResult,
  ClaimsValidationResult,
  MoneyFlowVerificationResult,
  Discrepancy,
  InvestorProtectionReport,
} from "./investorProtection/types";

// Claims extraction
export {
  extractClaims,
  extractClaimsWithRegex,
} from "./investorProtection/phases/claimsExtraction";

// ============================================================================
// DEEP RESEARCH (Multi-Agent Research System)
// ============================================================================

// Deep research types
export type {
  DeepResearchJobStatus,
  DeepResearchJobConfig,
  DeepResearchReport,
  DecomposedQuery,
  QueryIntent,
  SubQuestion,
  Hypothesis,
  HypothesisVerdict,
  PersonProfile,
  CompanyProfile,
  NewsEvent,
  NewsVerificationResult,
  RelationshipGraph,
  VerifiedClaim,
  Evidence,
  Claim,
  // Methodology & Reasoning (Ground Truth Requirements)
  MethodologyStep,
  InferenceStep,
  CriticalEvaluation,
  CriticalPoint,
  // Actionable Sections (Ground Truth Requirements)
  VerificationStep,
  Recommendation,
  // Inline Citations (Ground Truth Format)
  FormattedReference,
  // Enhanced Claim Verification (Ground Truth Enhancements)
  ClaimType,
  SpeculationLevel,
  VerifiabilityLevel,
  EnhancedClaim,
  WeightedContradiction,
  PersonVerificationResult,
  RankedAlternativeInterpretation,
  TemporalConsistencyResult,
} from "./deepResearch/types";

// Deep research formatting helpers
export { formatWithCitation, formatReferenceList } from "./deepResearch/deepResearchOrchestrator";

// Query decomposition
export {
  decomposeQuery,
  decomposeQuerySync,
} from "./deepResearch/queryDecomposer";

// Agents
export { executePersonResearch } from "./deepResearch/agents/personResearchAgent";
export { executeNewsVerification, verifyEvent } from "./deepResearch/agents/newsVerificationAgent";

// Hypothesis engine
export { evaluateHypothesis } from "./deepResearch/hypothesisEngine";

// Claim classifier (enhanced verification)
export {
  classifyClaimType,
  classifySpeculationLevel,
  classifyVerifiability,
  createEnhancedClaim,
  calculateSourceReliability,
  detectWeightedContradiction,
  verifyPersonDepth,
  rankAlternativeInterpretations,
  checkTemporalConsistency,
} from "./deepResearch/claimClassifier";
