/**
 * Deep Research Types
 *
 * Type definitions for the multi-agent deep research system.
 * Implements patterns from Anthropic's multi-agent research system,
 * OpenAI Deep Research, and Manus architecture.
 *
 * @module deepResearch/types
 */

import { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CORE ENUMS & STATUS
// ═══════════════════════════════════════════════════════════════════════════

export type DeepResearchJobStatus =
  | "pending"
  | "decomposing_query"
  | "spawning_agents"
  | "executing_research"
  | "cross_verifying"
  | "evaluating_hypotheses"
  | "synthesizing"
  | "completed"
  | "failed";

export type SubAgentType =
  | "person"
  | "company"
  | "news"
  | "relationship"
  | "hypothesis"
  | "verification";

export type SubAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export type EvidenceStrength =
  | "authoritative"  // Government/official source
  | "strong"         // Multiple reliable sources agree
  | "moderate"       // Single reliable source
  | "weak"           // Inference or secondary source
  | "speculative";   // No direct evidence

export type HypothesisVerdict =
  | "VERIFIED"            // Strong evidence confirms
  | "PARTIALLY_SUPPORTED" // Some evidence, gaps remain
  | "UNVERIFIED"          // Insufficient evidence
  | "CONTRADICTED"        // Evidence contradicts
  | "FALSIFIED";          // Strong evidence disproves

export type ClaimStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "contradicted"
  | "needs_investigation";

// ═══════════════════════════════════════════════════════════════════════════
// QUERY DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

export interface DecomposedQuery {
  originalQuery: string;
  intent: QueryIntent;
  subQuestions: SubQuestion[];
  hypotheses: ExtractedHypothesis[];
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  timeConstraints?: TimeConstraint;
  verificationRequests: string[];
}

export interface QueryIntent {
  primaryGoal: "research" | "verification" | "hypothesis_testing" | "relationship_mapping";
  requiresVerification: boolean;
  requiresSkepticism: boolean;
  timelinessRequired: boolean;
  depth: "quick" | "standard" | "comprehensive" | "exhaustive";
}

export interface SubQuestion {
  id: string;
  question: string;
  type: "who" | "what" | "when" | "where" | "why" | "how" | "verify" | "relationship";
  targetEntity?: string;
  targetEntityType?: "person" | "company" | "event" | "concept";
  priority: number;
  dependencies: string[]; // IDs of questions this depends on
  assignedAgent?: SubAgentType;
}

export interface ExtractedHypothesis {
  id: string;
  statement: string;
  confidence: number;
  claimsToVerify: string[];
  impliedRelationships: string[];
}

export interface ExtractedEntity {
  name: string;
  type: "person" | "company" | "product" | "event" | "concept";
  identifiers: Record<string, string>; // e.g., { linkedinUrl: "...", website: "..." }
  mentionedClaims: string[];
}

export interface ExtractedRelationship {
  entity1: string;
  entity2: string;
  relationshipType: string;
  confidence: number;
  isHypothetical: boolean;
}

export interface TimeConstraint {
  recentNewsRequired: boolean;
  dateRange?: { start: string; end: string };
  eventDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSON RESEARCH
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonProfile {
  id: string;
  name: string;
  linkedinUrl?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  summary?: string;

  // Career data
  careerTimeline: CareerEntry[];
  education: EducationEntry[];
  skills: string[];

  // Expertise & influence
  expertiseAreas: string[];
  publicationsCount?: number;
  patentsCount?: number;
  mediaAppearances: MediaAppearance[];

  // Network
  knownConnections: KnownConnection[];
  companyAffiliations: CompanyAffiliation[];

  // Verification
  sources: ResearchSource[];
  verifiedClaims: VerifiedClaim[];
  unverifiedClaims: string[];
  lastUpdated: number;
}

export interface CareerEntry {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  description?: string;
  source?: string;
}

export interface EducationEntry {
  institution: string;
  degree?: string;
  field?: string;
  year?: string;
  source?: string;
}

export interface MediaAppearance {
  title: string;
  source: string;
  url?: string;
  date?: string;
  type: "interview" | "article" | "podcast" | "conference" | "other";
}

export interface KnownConnection {
  name: string;
  relationship: string;
  company?: string;
  confidence: number;
}

export interface CompanyAffiliation {
  company: string;
  role: string;
  type: "employee" | "founder" | "advisor" | "board" | "investor";
  isCurrent: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWS & EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsEvent {
  id: string;
  headline: string;
  summary: string;
  date: string;
  sources: NewsSource[];
  entities: string[];
  eventType: "acquisition" | "funding" | "launch" | "partnership" | "legal" | "executive_change" | "other";
  verificationStatus: "verified" | "reported" | "rumor" | "unverified";
  confidence: number;
}

export interface NewsSource {
  name: string;
  url: string;
  publishedAt: string;
  reliability: "tier1" | "tier2" | "tier3" | "unknown";
  snippet?: string;
}

export interface NewsVerificationResult {
  event: string;
  verified: boolean;
  confidence: number;
  supportingSources: NewsSource[];
  contradictingSources: NewsSource[];
  timelineConsistent: boolean;
  officialConfirmation: boolean;
  verdict: string;
  consensus: "strong" | "moderate" | "weak" | "contradicted" | "none";
}

// ═══════════════════════════════════════════════════════════════════════════
// HYPOTHESIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export interface Hypothesis {
  id: string;
  statement: string;
  decomposedClaims: Claim[];
  supportingEvidence: Evidence[];
  counterEvidence: Evidence[];
  verdict: HypothesisVerdict;
  confidenceScore: number;
  reasoning: string;
  gaps: string[];
  suggestedFollowUp: string[];
}

export interface Claim {
  id: string;
  statement: string;
  category: "factual" | "causal" | "predictive" | "relational";
  status: ClaimStatus;
  evidence: Evidence[];
  confidence: number;
  verificationPath: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED CLAIM VERIFICATION (Ground Truth Enhancements)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detailed claim type for verification thresholds
 * - factual: Concrete facts that can be verified (e.g., "Meta acquired Manus")
 * - causal: Claims about causation (e.g., "Vijay initiated the effort")
 * - attribution: Claims attributing actions to people (e.g., "X was responsible for Y")
 * - speculative: Future predictions or business speculation
 * - relational: Claims about relationships between entities
 */
export type ClaimType = "factual" | "causal" | "attribution" | "speculative" | "relational";

/**
 * Speculation level for claim classification
 * - none: Verifiable fact with evidence
 * - low: Minor inference from evidence
 * - moderate: Reasonable extrapolation
 * - high: Significant speculation
 * - extreme: Pure speculation with no evidence base
 */
export type SpeculationLevel = "none" | "low" | "moderate" | "high" | "extreme";

/**
 * Verifiability classification for claims
 */
export type VerifiabilityLevel = "publicly_verifiable" | "requires_insider_knowledge" | "not_publicly_verifiable" | "contradicted";

/**
 * Enhanced claim with full verification metadata
 */
export interface EnhancedClaim extends Claim {
  /** Detailed claim type for verification threshold */
  claimType: ClaimType;

  /** Level of speculation in the claim */
  speculationLevel: SpeculationLevel;

  /** Whether this claim can be publicly verified */
  verifiability: VerifiabilityLevel;

  /** Reason for verifiability classification */
  verifiabilityReason: string;

  /** Source that contradicts this claim, if any */
  contradictedBy?: {
    source: ResearchSource;
    contradictingStatement: string;
    contradictionStrength: "weak" | "moderate" | "strong";
  };

  /** For causal/attribution claims: the actor being attributed */
  attributedTo?: string;

  /** For causal claims: the effect being claimed */
  claimedEffect?: string;

  /** Temporal aspect: when this claim refers to */
  temporalReference?: {
    type: "past" | "present" | "future";
    date?: string;
    isVerifiable: boolean;
  };
}

/**
 * Contradiction with source quality weighting
 */
export interface WeightedContradiction {
  /** The original claim */
  claim: string;

  /** The contradicting information */
  contradiction: string;

  /** Source making the original claim */
  claimSource: ResearchSource;

  /** Source providing the contradiction */
  contradictionSource: ResearchSource;

  /** Reliability weight difference (positive = contradiction more reliable) */
  reliabilityDelta: number;

  /** Overall contradiction strength based on source quality */
  weightedStrength: "weak" | "moderate" | "strong" | "definitive";

  /** Verdict on which to believe */
  verdict: "original_likely_correct" | "contradiction_likely_correct" | "insufficient_evidence" | "both_partially_true";

  /** Explanation of the contradiction */
  explanation: string;
}

/**
 * Person verification with depth levels
 */
export interface PersonVerificationResult {
  /** Person name */
  name: string;

  /** LinkedIn URL if provided */
  linkedInUrl?: string;

  /** Verification depth achieved */
  verificationDepth: {
    /** Title/role verified from official sources */
    titleVerified: boolean;
    titleSource?: ResearchSource;

    /** Company affiliation verified */
    companyVerified: boolean;
    companySource?: ResearchSource;

    /** Public work verified (talks, papers, blog posts) */
    publicWorkVerified: boolean;
    publicWorkSources: ResearchSource[];

    /** Internal contributions - typically not publicly verifiable */
    internalContributionsVerifiable: boolean;
    internalContributionsNote: string;
  };

  /** Claims about this person that are verified */
  verifiedClaims: string[];

  /** Claims about this person that cannot be publicly verified */
  unverifiableClaims: string[];

  /** Claims about this person that are contradicted */
  contradictedClaims: string[];
}

/**
 * Alternative interpretation with likelihood ranking
 */
export interface RankedAlternativeInterpretation {
  /** The alternative explanation */
  interpretation: string;

  /** Likelihood ranking */
  likelihood: "most_likely" | "likely" | "possible" | "less_likely" | "unlikely";

  /** Numeric likelihood score (0-1) */
  likelihoodScore: number;

  /** Evidence supporting this interpretation */
  supportingEvidence: string[];

  /** Evidence against this interpretation */
  counterEvidence: string[];

  /** Why this interpretation is plausible */
  rationale: string;
}

/**
 * Temporal consistency check result
 */
export interface TemporalConsistencyResult {
  /** Whether the timeline is consistent */
  isConsistent: boolean;

  /** Timeline events extracted from claims */
  timeline: {
    event: string;
    date?: string;
    approximateDate?: string;
    source: string;
  }[];

  /** Inconsistencies found */
  inconsistencies: {
    event1: string;
    event2: string;
    issue: string;
    severity: "minor" | "moderate" | "major";
  }[];

  /** Overall confidence in timeline */
  confidence: number;
}

export interface Evidence {
  id: string;
  content: string;
  source: ResearchSource;
  strength: EvidenceStrength;
  supportsClaimId: string;
  contradictsClaimId?: string;
  extractedAt: number;
  isDirectEvidence: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONSHIP MAPPING
// ═══════════════════════════════════════════════════════════════════════════

export interface RelationshipGraph {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  clusters: EntityCluster[];
}

export interface EntityNode {
  id: string;
  name: string;
  type: "person" | "company" | "product" | "event";
  attributes: Record<string, unknown>;
  centrality: number;
}

export interface RelationshipEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
  evidence: string[];
  isVerified: boolean;
  isInferred: boolean;
}

export interface EntityCluster {
  id: string;
  name: string;
  entities: string[];
  theme: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-AGENT TASKS
// ═══════════════════════════════════════════════════════════════════════════

export interface SubAgentTask {
  id: string;
  type: SubAgentType;
  target: string;
  focus: string[];
  questions: string[];
  priority: number;
  timeout: number;
  dependencies: string[];
}

export interface SubAgentResult {
  taskId: string;
  type: SubAgentType;
  status: SubAgentStatus;
  findings: unknown;
  sources: ResearchSource[];
  claims: VerifiedClaim[];
  executionTimeMs: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-SOURCE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export interface CrossVerificationResult {
  claim: string;
  sourcesChecked: number;
  sourcesConfirming: ResearchSource[];
  sourcesContradicting: ResearchSource[];
  sourcesNeutral: ResearchSource[];
  consensus: "strong" | "moderate" | "weak" | "none" | "contradicted";
  confidence: number;
  finalVerdict: ClaimStatus;
  reasoning: string;
}

export interface VerifiedClaim {
  claim: string;
  verified: boolean;
  confidence: number;
  sources: ResearchSource[];
  verificationMethod: "direct" | "triangulated" | "inferred" | "authoritative";
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH SOURCES
// ═══════════════════════════════════════════════════════════════════════════

export type ResearchSourceType =
  | "linkedin"
  | "company_website"
  | "news_article"
  | "press_release"
  | "sec_filing"
  | "academic_paper"
  | "patent_filing"
  | "government_registry"
  | "social_media"
  | "interview"
  | "crunchbase"
  | "pitchbook"
  | "llm_inference";

export interface ResearchSource {
  id: string;
  type: ResearchSourceType;
  url?: string;
  title: string;
  author?: string;
  publishedAt?: string;
  accessedAt: number;
  reliability: "authoritative" | "reliable" | "secondary" | "unverified";
  snippet?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHESIS & REPORT
// ═══════════════════════════════════════════════════════════════════════════

export interface DeepResearchReport {
  jobId: string;
  originalQuery: string;

  // Executive summary
  executiveSummary: string;
  keyFindings: string[];
  confidence: number;

  // Detailed findings
  personProfiles: PersonProfile[];
  companyProfiles: CompanyProfile[];
  newsEvents: NewsEvent[];
  relationships: RelationshipGraph;

  // Hypothesis evaluation
  hypothesesEvaluated: Hypothesis[];
  overallVerdict: HypothesisVerdict;
  verdictReasoning: string;

  // Verification summary
  verifiedClaims: VerifiedClaim[];
  unverifiedClaims: string[];
  contradictions: Contradiction[];

  // ═══════════════════════════════════════════════════════════════════════════
  // METHODOLOGY & REASONING (Ground Truth Requirements)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Step-by-step methodology explaining how conclusions were reached */
  methodology: MethodologyStep[];

  /** Inference chain showing how facts led to conclusions */
  inferenceChain: InferenceStep[];

  /** Critical evaluation with counter-arguments and skeptical analysis */
  criticalEvaluation: CriticalEvaluation;

  /** Human-readable step-by-step guide for reproducing the research */
  stepByStepGuide: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONABLE SECTIONS (Ground Truth Requirements)
  // ═══════════════════════════════════════════════════════════════════════════

  /** How to verify - actionable steps for the user */
  verificationSteps: VerificationStep[];

  /** What you should prepare - recommendations for the user */
  recommendations: Recommendation[];

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE CITATIONS (Ground Truth Format: ([Source][1]))
  // ═══════════════════════════════════════════════════════════════════════════

  /** Formatted references with numbered citations for bottom of report */
  formattedReferences: FormattedReference[];

  // Metadata
  sources: ResearchSource[];
  subAgentsSummary: SubAgentSummary[];
  executionTimeMs: number;
  totalTokensUsed?: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// METHODOLOGY & INFERENCE CHAIN (for "how did you come up with this")
// ═══════════════════════════════════════════════════════════════════════════

export interface MethodologyStep {
  stepNumber: number;
  phase: "decomposition" | "research" | "verification" | "synthesis" | "evaluation";
  action: string;
  rationale: string;
  inputs: string[];
  outputs: string[];
  sourcesUsed: string[];
  timeSpentMs: number;
}

export interface InferenceStep {
  stepNumber: number;
  premise: string;
  premiseSource: string;
  inference: string;
  inferenceType: "direct" | "deductive" | "inductive" | "abductive" | "analogical";
  confidence: number;
  counterArgument?: string;
}

export interface CriticalEvaluation {
  /** What we are confident about */
  strongPoints: CriticalPoint[];

  /** Where evidence is weak or missing */
  weakPoints: CriticalPoint[];

  /** Alternative explanations for the same facts (simple list for backwards compatibility) */
  alternativeInterpretations: string[];

  /** Ranked alternative interpretations with likelihood scores */
  rankedAlternatives?: RankedAlternativeInterpretation[];

  /** What could disprove the conclusions */
  falsificationCriteria: string[];

  /** Specific gaps that need more research */
  researchGaps: string[];

  /** Overall skepticism score (0 = very confident, 1 = highly skeptical) */
  skepticismLevel: number;

  /** Brutally honest assessment */
  brutallyHonestAssessment: string;
}

export interface CriticalPoint {
  point: string;
  evidence: string;
  confidence: number;
  sourceCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONABLE VERIFICATION & RECOMMENDATIONS (Ground Truth Requirements)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actionable step for the user to verify findings themselves
 * Addresses: "How to verify" section in ground truth output
 */
export interface VerificationStep {
  stepNumber: number;
  action: string;
  target: string;
  method: "direct_contact" | "document_request" | "public_source" | "third_party" | "interview";
  expectedOutcome: string;
  priority: "critical" | "important" | "nice_to_have";
  suggestedQuestions?: string[];
  timeframe?: string;
}

/**
 * Strategic recommendation for the user
 * Addresses: "What you should prepare" section in ground truth output
 */
export interface Recommendation {
  category: string;
  recommendation: string;
  rationale: string;
  priority: "critical" | "high" | "medium" | "low";
  actionItems: string[];
}

/**
 * Formatted reference for citation at bottom of report
 * Addresses: Ground truth format with numbered references like [1]: URL "Title"
 */
export interface FormattedReference {
  /** Citation number (e.g., 1, 2, 3) */
  index: number;
  /** Short name for inline citation (e.g., "Reuters", "Business Insider") */
  shortName: string;
  /** Full URL */
  url: string;
  /** Full title/description */
  title: string;
  /** Source type for categorization */
  sourceType: ResearchSourceType;
  /** When this source was accessed */
  accessedAt: number;
}

export interface CompanyProfile {
  name: string;
  website?: string;
  description?: string;
  industry?: string;
  founded?: string;
  headquarters?: string;
  employees?: string;
  funding?: FundingInfo;
  leadership: { name: string; role: string }[];
  recentNews: NewsEvent[];
  sources: ResearchSource[];
}

export interface FundingInfo {
  totalRaised?: string;
  lastRound?: string;
  lastRoundDate?: string;
  valuation?: string;
  investors?: string[];
}

export interface Contradiction {
  claim1: string;
  claim2: string;
  source1: ResearchSource;
  source2: ResearchSource;
  severity: "minor" | "moderate" | "major";
  resolution?: string;
}

export interface SubAgentSummary {
  type: SubAgentType;
  target: string;
  status: SubAgentStatus;
  findingsCount: number;
  sourcesCount: number;
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface DeepResearchJobConfig {
  query: string;
  userId: Id<"users">;
  depth: "quick" | "standard" | "comprehensive" | "exhaustive";
  maxSubAgents: number;
  maxTokenBudget?: number;
  timeoutMs: number;
  requireVerification: boolean;
  includeSources: boolean;
}

export interface DeepResearchJobProgress {
  status: DeepResearchJobStatus;
  currentPhase: string;
  subAgentsTotal: number;
  subAgentsCompleted: number;
  subAgentsFailed: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OODA LOOP STATE
// ═══════════════════════════════════════════════════════════════════════════

export interface OODAState {
  cycle: number;
  phase: "observe" | "orient" | "decide" | "act";

  // Observe: What do we know?
  observedFacts: string[];
  observedGaps: string[];
  observedContradictions: string[];

  // Orient: What does it mean?
  currentUnderstanding: string;
  confidenceLevel: number;
  alternativeInterpretations: string[];

  // Decide: What should we do next?
  nextActions: PlannedAction[];
  prioritizedQuestions: string[];

  // Act: What tools/searches to run?
  pendingTools: ToolInvocation[];
  completedTools: ToolInvocation[];
}

export interface PlannedAction {
  id: string;
  description: string;
  rationale: string;
  expectedOutcome: string;
  priority: number;
}

export interface ToolInvocation {
  id: string;
  tool: string;
  parameters: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED THINKING
// ═══════════════════════════════════════════════════════════════════════════

export interface ThinkingStep {
  stepNumber: number;
  phase: "planning" | "analysis" | "verification" | "synthesis";
  thought: string;
  decision?: string;
  confidenceChange?: number;
}

export interface ResearchPlan {
  objective: string;
  approach: string;
  subQuestions: SubQuestion[];
  expectedSources: string[];
  riskFactors: string[];
  successCriteria: string[];
  thinkingSteps: ThinkingStep[];
}
