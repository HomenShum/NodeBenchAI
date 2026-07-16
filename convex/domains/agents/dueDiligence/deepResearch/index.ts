/**
 * Deep Research Module
 *
 * Multi-agent research system for complex queries.
 * Implements patterns from Anthropic, OpenAI Deep Research, and Manus.
 *
 * @module deepResearch
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  // Job & Status
  DeepResearchJobStatus,
  DeepResearchJobConfig,
  DeepResearchJobProgress,

  // Query Decomposition
  DecomposedQuery,
  QueryIntent,
  SubQuestion,
  ExtractedHypothesis,
  ExtractedEntity,
  ExtractedRelationship,
  TimeConstraint,

  // Sub-Agents
  SubAgentType,
  SubAgentStatus,
  SubAgentTask,
  SubAgentResult,

  // Person Research
  PersonProfile,
  CareerEntry,
  EducationEntry,
  MediaAppearance,
  KnownConnection,
  CompanyAffiliation,

  // News & Events
  NewsEvent,
  NewsSource,
  NewsVerificationResult,

  // Hypothesis Engine
  Hypothesis,
  Claim,
  Evidence,
  HypothesisVerdict,
  ClaimStatus,
  EvidenceStrength,

  // Relationships
  RelationshipGraph,
  EntityNode,
  RelationshipEdge,
  EntityCluster,

  // Verification
  CrossVerificationResult,
  VerifiedClaim,
  ResearchSource,
  ResearchSourceType,

  // Report
  DeepResearchReport,
  CompanyProfile,
  FundingInfo,
  Contradiction,
  SubAgentSummary,

  // OODA Loop
  OODAState,
  PlannedAction,
  ToolInvocation,
  ThinkingStep,
  ResearchPlan,

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
} from "./types";

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export { formatWithCitation, formatReferenceList } from "./deepResearchOrchestrator";

// ============================================================================
// QUERY DECOMPOSITION
// ============================================================================

export {
  decomposeQuery,
  decomposeQuerySync,
} from "./queryDecomposer";

// ============================================================================
// AGENTS
// ============================================================================

export {
  executePersonResearch,
  type PersonResearchConfig,
} from "./agents/personResearchAgent";

export {
  executeNewsVerification,
  verifyEvent,
  type NewsVerificationConfig,
} from "./agents/newsVerificationAgent";

// ============================================================================
// HYPOTHESIS ENGINE
// ============================================================================

export {
  evaluateHypothesis,
  decomposeToClaims,
  evaluateClaims,
  findMatchingEvidence,
  aggregateVerdict,
} from "./hypothesisEngine";

// ============================================================================
// CLAIM CLASSIFIER (Enhanced Verification)
// ============================================================================

export {
  // Claim type classification
  classifyClaimType,
  classifySpeculationLevel,
  classifyVerifiability,
  createEnhancedClaim,

  // Contradiction detection with source weighting
  calculateSourceReliability,
  detectWeightedContradiction,

  // Person verification depth
  verifyPersonDepth,

  // Alternative interpretation ranking
  rankAlternativeInterpretations,

  // Temporal consistency checking
  checkTemporalConsistency,

  // Constants
  CLAIM_TYPE_PATTERNS,
  SPECULATION_INDICATORS,
  SOURCE_RELIABILITY_WEIGHTS,
  SOURCE_TYPE_WEIGHTS,
} from "./claimClassifier";
