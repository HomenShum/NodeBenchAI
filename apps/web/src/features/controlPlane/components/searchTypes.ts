/**
 * searchTypes.ts — Shared types for the search-first intelligence workspace.
 *
 * Lens system: same entity + different user context = different packet shape.
 * ResultPacket: canonical structure for entity intelligence results.
 */

/* ─── Lens System ────────────────────────────────────────────────────────── */

export type LensId = "founder" | "investor" | "banker" | "ceo" | "legal" | "student";

export interface LensConfig {
  id: LensId;
  label: string;
  description: string;
  /** Section ordering priority for this lens (higher = shown first) */
  sectionPriority: Record<string, number>;
}

export const LENSES: LensConfig[] = [
  {
    id: "founder",
    label: "Founder",
    description: "Competitive timing, market positioning, build-vs-buy",
    sectionPriority: { signals: 10, changes: 9, comparables: 8, risks: 7, truth: 6 },
  },
  {
    id: "investor",
    label: "Investor",
    description: "Growth signals, momentum, comparables, funding timing",
    sectionPriority: { truth: 10, signals: 9, comparables: 8, risks: 7, changes: 6 },
  },
  {
    id: "banker",
    label: "Banker",
    description: "Deal relevance, financial implications, relationship angles",
    sectionPriority: { truth: 10, risks: 9, comparables: 8, signals: 7, changes: 6 },
  },
  {
    id: "ceo",
    label: "CEO",
    description: "Strategic positioning, resource allocation, board narrative",
    sectionPriority: { changes: 10, signals: 9, truth: 8, risks: 7, comparables: 6 },
  },
  {
    id: "legal",
    label: "Legal",
    description: "Regulatory exposure, disputes, data handling, governance",
    sectionPriority: { risks: 10, truth: 9, changes: 8, signals: 7, comparables: 6 },
  },
  {
    id: "student",
    label: "Student",
    description: "Simplified timeline, concept explanations, source-backed summaries",
    sectionPriority: { truth: 10, changes: 9, signals: 8, comparables: 7, risks: 6 },
  },
];

/* ─── Result Packet ──────────────────────────────────────────────────────── */

export interface ResultVariable {
  rank: number;
  name: string;
  direction: "up" | "down" | "neutral";
  impact: "high" | "medium" | "low";
  /** Index into sourceRefs[] for citation linkage */
  sourceIdx?: number;
  sourceRefIds?: string[];
}

export interface ResultChange {
  description: string;
  date?: string;
  /** Index into sourceRefs[] for citation linkage */
  sourceIdx?: number;
  sourceRefIds?: string[];
}

export interface ResultRisk {
  title: string;
  description: string;
  falsification?: string;
  /** Index into sourceRefs[] for citation linkage */
  sourceIdx?: number;
  sourceRefIds?: string[];
}

export interface ResultComparable {
  name: string;
  relevance: "high" | "medium" | "low";
  note: string;
}

export interface ResultMetric {
  label: string;
  value: string;
}

export interface ResultScenario {
  label: string;
  probability: number;
  outcome: string;
}

export interface ResultIntervention {
  action: string;
  impact: "high" | "medium" | "low";
  sourceRefIds?: string[];
}

export type ProofStatus =
  | "loading"
  | "provisional"
  | "verified"
  | "drifting"
  | "incomplete";

export interface ResultSourceRef {
  id: string;
  label: string;
  href?: string;
  type?: "web" | "local" | "doc" | "trace";
  status?: "explored" | "cited" | "discarded";
  title?: string;
  domain?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  excerpt?: string;
  confidence?: number;
}

export interface ResultClaimRef {
  id: string;
  text: string;
  sourceRefIds: string[];
  answerBlockIds: string[];
  status: "retained" | "contradicted" | "discarded";
}

export interface ResultAnswerBlock {
  id: string;
  title: string;
  text: string;
  sourceRefIds: string[];
  claimIds: string[];
  status: "cited" | "uncertain" | "draft";
}

export interface ResultExplorationMemory {
  exploredSourceCount: number;
  citedSourceCount: number;
  discardedSourceCount: number;
  entityCount: number;
  claimCount: number;
  contradictionCount: number;
}

export interface ResultGraphSummary {
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  primaryPath: string[];
}

export type ResultGraphNodeKind =
  | "query"
  | "lens"
  | "persona"
  | "context_bundle"
  | "source"
  | "entity"
  | "claim"
  | "contradiction"
  | "answer_block"
  | "artifact"
  | "follow_up";

export type ResultGraphEdgeKind =
  | "selected"
  | "explored"
  | "mentions"
  | "supports"
  | "conflicts_with"
  | "used_in"
  | "about"
  | "suggests";

export interface ResultGraphNode {
  id: string;
  kind: ResultGraphNodeKind;
  label: string;
  status?: ProofStatus;
  confidence?: number;
}

export interface ResultGraphEdge {
  fromId: string;
  toId: string;
  kind: ResultGraphEdgeKind;
}

export type ResultStrategicAngleStatus = "strong" | "watch" | "unknown";

export interface ResultStrategicAngle {
  id: string;
  title: string;
  status: ResultStrategicAngleStatus;
  summary: string;
  whyItMatters: string;
  evidenceRefIds: string[];
  nextQuestion?: string;
}

export type FounderPacketVisibility = "internal" | "workspace" | "public";

export interface ResultUnlockCriteria {
  id: string;
  title: string;
  status: "ready" | "watch" | "missing";
  requiredSignals: string[];
}

export interface ResultProgressionTierDefinition {
  id: "clarity" | "foundation" | "readiness" | "leverage" | "scale";
  label: string;
  priceLabel: string;
  unlocks: string[];
  services: string[];
}

export interface ResultFounderScorecard {
  id: "two_week" | "three_month";
  label: string;
  status: "on_track" | "watch" | "off_track";
  summary: string;
  mustHappen: string[];
}

export interface ResultFounderProgressionProfile {
  currentStage: "clarity" | "foundation" | "readiness" | "leverage" | "scale";
  currentStageLabel: string;
  readinessScore: number;
  missingFoundations: string[];
  hiddenRisks: string[];
  nextUnlocks: ResultUnlockCriteria[];
  delegableWork: string[];
  founderOnlyWork: string[];
  onTrackStatus: "on_track" | "watch" | "off_track";
  recommendedNextAction: string;
}

export interface ResultEvidenceClass {
  id: string;
  label: string;
  description: string;
  required: boolean;
}

export interface ResultReadinessRequirement {
  id: string;
  title: string;
  status: "ready" | "watch" | "missing";
  whyItMatters: string;
  evidenceClassIds: string[];
}

export interface ResultDiligencePackDefinition {
  id: string;
  label: string;
  summary: string;
  externalEvaluators: string[];
  evidenceClasses: ResultEvidenceClass[];
  requirements: ResultReadinessRequirement[];
  highRiskClaims: string[];
  materials: string[];
  readyDefinition: string;
}

export interface ResultMaterialsChecklistItem {
  id: string;
  label: string;
  status: "ready" | "watch" | "missing";
  audience: string;
  whyItMatters: string;
}

export interface ResultDistributionSurfaceStatus {
  surfaceId: string;
  label: string;
  status: "ready" | "partial" | "missing";
  whyItMatters: string;
}

export interface ResultAutonomyBenchmarkRun {
  benchmarkId: string;
  lane:
    | "weekly_founder_reset"
    | "competitor_signal_response"
    | "packet_to_implementation"
    | "cheapest_valid_workflow"
    | "browserstack_lane";
  objective: string;
  packetRef: string;
  agentsInvolved: string[];
  actionsTaken: string[];
  beforeState: string;
  afterState: string;
  artifactsProduced: string[];
  validationPasses: string[];
  validationFailures: string[];
  timeMs: number;
  estimatedCostUsd: number;
  humanInterventions: string[];
  reuseScore: number;
  summary: string;
}

export interface ResultShareableArtifact {
  id: string;
  type:
    | "slack_onepage"
    | "investor_memo"
    | "banker_readiness"
    | "pitchbook_like"
    | "crunchbase_like"
    | "yc_context"
    | "generic_json";
  title: string;
  visibility: FounderPacketVisibility;
  summary: string;
  payload: Record<string, unknown>;
  href?: string;
}

export interface ResultCompanyStarterProfile {
  companyName: string;
  oneLineDescription: string;
  categories: string[];
  stage: string;
  initialCustomers: string[];
  wedge: string;
}

export interface ResultCompanyNamingPack {
  suggestedNames: string[];
  recommendedName: string;
  starterProfile: ResultCompanyStarterProfile;
}

export interface ResultCompanyReadinessPacket {
  packetId: string;
  visibility: FounderPacketVisibility;
  identity: {
    companyName: string;
    vertical: string;
    subvertical: string;
    stage: string;
    mission: string;
    wedge: string;
  };
  founderTeamCredibility: string[];
  productAndWedge: string[];
  marketAndGtm: string[];
  financialReadiness: string[];
  operatingReadiness: string[];
  diligenceEvidence: string[];
  contradictionsAndHiddenRisks: string[];
  nextUnlocks: string[];
  pricingStage: {
    stageId: "clarity" | "foundation" | "readiness" | "leverage" | "scale";
    label: string;
    priceLabel: string;
  };
  distributionSurfaceStatus: ResultDistributionSurfaceStatus[];
  provenance: {
    sourceRefIds: string[];
    confidence: number;
    freshness: string;
  };
  allowedDestinations: string[];
  sensitivity: "internal" | "workspace";
}

export interface ResultWorkflowPathComparison {
  objective: string;
  currentPath: string[];
  optimizedPath: string[];
  rationale: string;
  validationChecks: string[];
  estimatedSavings: {
    timePercent: number;
    costPercent: number;
  };
  verdict: "valid" | "invalid" | "needs_review";
}

export interface ResultFounderExecutionStep {
  id: string;
  label: string;
  description: string;
}

export interface ResultFounderQueueDefinition {
  id: string;
  label: string;
  purpose: string;
  upstream: string[];
  outputs: string[];
}

export interface ResultFounderSourcePolicy {
  sourceType:
    | "slack"
    | "codebase"
    | "local_files"
    | "uploads"
    | "docs"
    | "web_research"
    | "agent_outputs"
    | "third_party";
  canRead: boolean;
  canStore: boolean;
  canSummarize: boolean;
  exportPolicy: "allow" | "redact" | "reference_only";
  notes: string;
}

export interface ResultFounderRolePacketDefault {
  role: LensId | "generic";
  defaultPacketType: string;
  defaultArtifactType: string;
  shouldMonitorByDefault: boolean;
  shouldDelegateByDefault: boolean;
}

export interface ResultFounderPacketRouterDecision {
  role: LensId | "generic";
  companyMode: "own_company" | "external_company" | "mixed_comparison";
  packetType: string;
  artifactType: string;
  shouldMonitor: boolean;
  shouldExport: boolean;
  shouldDelegate: boolean;
  needsMoreEvidence: boolean;
  requiredEvidence: string[];
  visibility: FounderPacketVisibility;
  rationale: string;
}

export interface ResultFounderProgressionRubricEvaluation {
  currentStage: "clarity" | "foundation" | "readiness" | "leverage" | "scale";
  onTrack: boolean;
  mandatorySatisfied: string[];
  mandatoryMissing: string[];
  optionalStrengths: string[];
  rationale: string;
}

export interface ResultBenchmarkOracleDefinition {
  lane:
    | "weekly_founder_reset"
    | "competitor_signal_response"
    | "packet_to_implementation"
    | "cheapest_valid_workflow"
    | "browserstack_lane";
  deterministicChecks: string[];
  probabilisticJudges: string[];
  baseline: string;
  heldOutScenarios: string[];
}

export interface ResultFounderOperatingModel {
  executionOrder: ResultFounderExecutionStep[];
  queueTopology: ResultFounderQueueDefinition[];
  sourcePolicies: ResultFounderSourcePolicy[];
  roleDefault: ResultFounderRolePacketDefault;
  packetRouter: ResultFounderPacketRouterDecision;
  progressionRubric: ResultFounderProgressionRubricEvaluation;
  benchmarkOracles: ResultBenchmarkOracleDefinition[];
}

export interface ResultWorkflowAsset {
  assetId: string;
  assetType: "research_packet" | "issue_packet" | "workflow_template" | "delegation_packet";
  state: "generated" | "published" | "delegated";
  canonicalPacketId: string;
  canonicalPacketType: string;
  canonicalEntity: string;
  generatedAt: string;
  stages: string[];
  replayReady: boolean;
  delegationReady: boolean;
  currentContextId?: string;
  lastTaskId?: string;
  targetAgents?: string[];
  envelopeId?: string;
  envelopeType?: "search_result" | "context_handoff" | "episode_trace" | "workflow_replay" | "retention_sync";
  lineage?: {
    sourceRunId?: string;
    sourceContextId?: string;
    parentAssetId?: string;
  };
}

export type ForecastTrendDirection =
  | "improving"
  | "stable"
  | "declining"
  | "volatile"
  | "insufficient_data";

export type ForecastRecommendedAction =
  | "suppress"
  | "refresh_packet"
  | "deepen_diligence"
  | "escalate"
  | "delegate"
  | "observe";

export interface ResultForecastGate {
  streamKey: string;
  valuesCount: number;
  modelUsed: string;
  trendDirection: ForecastTrendDirection;
  latestOutsideInterval: boolean;
  confidenceBandWidth: number | null;
  recommendedAction: ForecastRecommendedAction;
  explanation: string;
  evidenceRefs: string[];
}

export interface ResultTemporalTrajectory {
  kind: string;
  streamKey: string;
  valuesCount: number;
  modelUsed: string;
}

export interface ResultPacket {
  /** The user's original query */
  query: string;
  /** Resolved entity name */
  entityName: string;
  /** Executive summary / answer */
  answer: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** Number of sources consulted */
  sourceCount: number;
  /** Top ranked variables */
  variables: ResultVariable[];
  /** Key metrics inline */
  keyMetrics?: ResultMetric[];
  /** Material changes */
  changes?: ResultChange[];
  /** Risks and contradictions */
  risks?: ResultRisk[];
  /** Comparable entities */
  comparables?: ResultComparable[];
  /** Why This Team — founder/credibility/trust layer */
  whyThisTeam?: {
    founderCredibility: string;
    trustSignals: string[];
    visionMagnitude: string;
    reinventionCapacity: string;
    hiddenRequirements: string[];
  } | null;
  /** Scenario branches */
  scenarios?: ResultScenario[];
  /** Recommended next actions */
  interventions?: ResultIntervention[];
  /** Follow-up questions */
  nextQuestions?: string[];
  /** Durable result packet id */
  packetId?: string;
  /** Packet type for downstream export/use */
  packetType?: string;
  /** Canonical entity label for trace + sync */
  canonicalEntity?: string;
  /** Source references used or explored */
  sourceRefs?: ResultSourceRef[];
  /** Structured claim lineage */
  claimRefs?: ResultClaimRef[];
  /** Final answer blocks with source and claim linkage */
  answerBlocks?: ResultAnswerBlock[];
  /** Exploration memory counters */
  explorationMemory?: ResultExplorationMemory;
  /** Compact graph summary for rendering */
  graphSummary?: ResultGraphSummary;
  /** Display-safe proof status */
  proofStatus?: ProofStatus;
  /** Explicit uncertainty boundary for the answer */
  uncertaintyBoundary?: string;
  /** Most important recommended next action */
  recommendedNextAction?: string;
  /** Compact graph nodes for proof rendering */
  graphNodes?: ResultGraphNode[];
  /** Compact graph edges for proof rendering */
  graphEdges?: ResultGraphEdge[];
  /** Proactive founder/operator pressure-test angles */
  strategicAngles?: ResultStrategicAngle[];
  /** Founder progression layer */
  progressionProfile?: ResultFounderProgressionProfile;
  progressionTiers?: ResultProgressionTierDefinition[];
  diligencePack?: ResultDiligencePackDefinition;
  readinessScore?: number;
  unlocks?: ResultUnlockCriteria[];
  materialsChecklist?: ResultMaterialsChecklistItem[];
  scorecards?: ResultFounderScorecard[];
  shareableArtifacts?: ResultShareableArtifact[];
  visibility?: FounderPacketVisibility;
  benchmarkEvidence?: ResultAutonomyBenchmarkRun[];
  workflowComparison?: ResultWorkflowPathComparison;
  operatingModel?: ResultFounderOperatingModel;
  workflowAsset?: ResultWorkflowAsset;
  distributionSurfaceStatus?: ResultDistributionSurfaceStatus[];
  companyReadinessPacket?: ResultCompanyReadinessPacket;
  companyNamingPack?: ResultCompanyNamingPack;
  /** Forecast-aware orchestration gate derived from repeated numeric observations */
  forecastGate?: ResultForecastGate;
  /** Compact trajectory metadata for founder surfaces */
  temporalTrajectory?: ResultTemporalTrajectory;
  /** Raw packet from backend (plan proposals, artifact packets, etc.) */
  rawPacket?: unknown;
}

export const PUBLIC_LENS_PERSONA_MAP: Record<LensId, string> = {
  founder: "FOUNDER_STRATEGY",
  investor: "EARLY_STAGE_VC",
  banker: "JPM_STARTUP_BANKER",
  ceo: "CORP_DEV",
  legal: "LEGAL_COMPLIANCE",
  student: "SIMPLIFIED_RESEARCH",
};

/* ─── Example Prompts ────────────────────────────────────────────────────── */

export interface ExamplePrompt {
  text: string;
  lens: LensId;
  category: "search" | "analyze" | "monitor" | "delegate";
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    text: "Analyze Anthropic's competitive position",
    lens: "investor",
    category: "search",
  },
  {
    text: "What would Y Combinator look for in my startup?",
    lens: "founder",
    category: "analyze",
  },
  {
    text: "Compare Stripe vs Square in payments",
    lens: "ceo",
    category: "search",
  },
  {
    text: "What are the biggest risks for OpenAI right now?",
    lens: "investor",
    category: "search",
  },
];

/* ─── Demo Result Packets ────────────────────────────────────────────────── */

export const DEMO_PACKETS: Record<string, ResultPacket> = {
  anthropic: {
    query: "Analyze Anthropic's competitive position in the foundation model market",
    entityName: "Anthropic",
    answer:
      "Anthropic holds a strong #2 position in the foundation model market behind OpenAI, with differentiated safety research creating a defensible moat. Their enterprise-first approach via Amazon Bedrock gives them distribution advantages that Meta (open-source) and Google (integration-heavy) lack. The key risk is a potential price war as inference costs drop 10x/year.",
    confidence: 82,
    sourceCount: 23,
    variables: [
      { rank: 1, name: "Enterprise distribution via AWS Bedrock", direction: "up", impact: "high", sourceIdx: 0 },
      { rank: 2, name: "Safety research moat depth", direction: "up", impact: "high", sourceIdx: 1 },
      { rank: 3, name: "Developer mindshare vs OpenAI", direction: "up", impact: "medium", sourceIdx: 2 },
      { rank: 4, name: "Inference cost trajectory", direction: "down", impact: "medium", sourceIdx: 0 },
      { rank: 5, name: "Open-source competitive pressure", direction: "down", impact: "low", sourceIdx: 3 },
    ],
    keyMetrics: [
      { label: "Valuation", value: "$61.5B" },
      { label: "ARR est.", value: "$2B+" },
      { label: "Model family", value: "Claude 4.x" },
      { label: "Enterprise clients", value: "10K+" },
    ],
    changes: [
      { description: "Claude 4.5 Sonnet launched with state-of-the-art coding benchmarks", date: "Feb 2025", sourceIdx: 1 },
      { description: "Amazon investment expanded to $8B total, deepening Bedrock integration", date: "Jan 2025", sourceIdx: 0 },
      { description: "MCP protocol gaining ecosystem adoption — 50K+ GitHub stars", date: "Mar 2025", sourceIdx: 2 },
    ],
    risks: [
      {
        title: "OpenAI pricing pressure",
        description: "GPT-4o mini at $0.15/1M tokens is 10x cheaper than Claude equivalents. If Anthropic can't match on price, enterprise migration accelerates.",
        falsification: "Track enterprise contract renewals Q2-Q3. If churn > 5%, pricing thesis fails.",
        sourceIdx: 0,
      },
      {
        title: "Open-source catch-up",
        description: "Meta's Llama 4 and Mistral's latest models are narrowing the capability gap. If open-source reaches 90% parity, the premium model business faces compression.",
        falsification: "Monitor LMSYS leaderboard rankings monthly. If open-source enters top-3 consistently, the moat weakens.",
        sourceIdx: 3,
      },
    ],
    comparables: [
      { name: "OpenAI", relevance: "high", note: "Market leader, consumer + enterprise, $157B valuation" },
      { name: "Google DeepMind", relevance: "high", note: "Deepest research bench, integrated into Google Cloud" },
      { name: "Meta AI", relevance: "medium", note: "Open-source strategy, massive compute budget, no direct revenue" },
      { name: "Mistral", relevance: "medium", note: "European champion, efficient models, growing enterprise traction" },
    ],
    scenarios: [
      { label: "Base", probability: 50, outcome: "Maintains #2 position, $4B+ ARR by 2026, strong enterprise lock-in" },
      { label: "Bull", probability: 25, outcome: "Safety regulation advantages create moat, IPO at $100B+" },
      { label: "Bear", probability: 25, outcome: "Price war compresses margins, open-source closes gap, valuation corrects" },
    ],
    interventions: [
      { action: "Track Q2 enterprise renewal rates for pricing signal", impact: "high" },
      { action: "Monitor MCP ecosystem adoption as distribution moat indicator", impact: "medium" },
      { action: "Watch Llama 4 benchmark results for open-source parity signal", impact: "medium" },
    ],
    nextQuestions: [
      "How does Anthropic's MCP protocol compare to OpenAI's function calling ecosystem?",
      "What's the enterprise switching cost from OpenAI to Anthropic via Bedrock?",
      "Which verticals show strongest Anthropic adoption vs OpenAI?",
      "How does the safety regulatory landscape benefit Anthropic specifically?",
    ],
  },
  shopify: {
    query: "What changed in AI commerce strategy for Shopify, Amazon, and Google this quarter?",
    entityName: "Shopify",
    answer:
      "Shopify is accelerating its AI commerce strategy by embedding AI across the merchant stack — from product generation to customer support to fulfillment optimization. Their 2025 full-year revenue grew 30% with 17% free cash flow margin, proving the builder-first model scales. Amazon is integrating AI into search and advertising, while Google is pushing Shopping Graph + Gemini for product discovery.",
    confidence: 76,
    sourceCount: 18,
    variables: [
      { rank: 1, name: "Shopify AI product suite expansion", direction: "up", impact: "high" },
      { rank: 2, name: "Merchant developer ecosystem health", direction: "up", impact: "high" },
      { rank: 3, name: "Amazon AI advertising integration", direction: "up", impact: "medium" },
      { rank: 4, name: "Google Shopping Graph + Gemini", direction: "up", impact: "medium" },
      { rank: 5, name: "Regulatory pressure on AI-generated product content", direction: "neutral", impact: "low" },
    ],
    keyMetrics: [
      { label: "Revenue growth", value: "30% YoY" },
      { label: "FCF margin", value: "17%" },
      { label: "GMV", value: "$270B+" },
      { label: "Merchants", value: "4.6M+" },
    ],
    changes: [
      { description: "Shopify launched Sidekick AI assistant for merchants across all plan tiers", date: "Q1 2025" },
      { description: "Amazon embedded AI-generated product listings in Seller Central", date: "Q4 2024" },
      { description: "Google unified Shopping Graph with Gemini for conversational product discovery", date: "Q1 2025" },
    ],
    risks: [
      {
        title: "AI-generated content quality and trust",
        description: "Merchants using AI to generate product descriptions at scale may erode buyer trust if quality control is insufficient.",
        falsification: "Track buyer return rates on AI-generated listings vs human-written. If returns increase > 10%, the automation thesis weakens.",
      },
      {
        title: "Platform lock-in through AI dependency",
        description: "As merchants rely more on platform-native AI tools, switching costs increase — which benefits incumbents but may trigger regulatory scrutiny.",
        falsification: "Monitor EU Digital Markets Act enforcement actions against AI-driven lock-in patterns.",
      },
    ],
    comparables: [
      { name: "Amazon", relevance: "high", note: "Largest marketplace, AI in ads + fulfillment + listing generation" },
      { name: "Google", relevance: "high", note: "Shopping Graph + Gemini, discovery layer, no direct commerce" },
      { name: "BigCommerce", relevance: "medium", note: "Enterprise-focused alternative, slower AI adoption" },
    ],
    nextQuestions: [
      "How does Shopify's AI merchant toolkit compare to Amazon's Seller Central AI?",
      "What percentage of Shopify merchants actively use AI features?",
      "How is Google's Shopping Graph changing product discovery away from search?",
      "What AI governance frameworks apply to automated product content at scale?",
    ],
  },
  nodebench: {
    query: "Use everything from my recent NodeBench work this week to generate my founder weekly reset",
    entityName: "NodeBench",
    answer:
      "NodeBench is the local-first operating-memory and entity-context layer for agent-native businesses. This week: shipped search-first AI app redesign (8-section result workspace with 6 role lenses), completed Phase 14 tool decoupling (338 tools, lazy-loading, 10 focused modules), and defined the canonical dogfood runbook. The strongest contradiction: product implementation is racing ahead across many surfaces, but the first three habits (weekly reset, pre-delegation packet, important-change review) still need to be the crystal-clear prove-first loop.",
    confidence: 91,
    sourceCount: 42,
    variables: [
      { rank: 1, name: "Search-first app redesign shipped", direction: "up", impact: "high" },
      { rank: 2, name: "Public narrative lags internal thesis", direction: "down", impact: "high" },
      { rank: 3, name: "350 tools with lazy-loading and persona presets", direction: "up", impact: "medium" },
      { rank: 4, name: "Dogfood runbook codified (13 scenarios)", direction: "up", impact: "medium" },
      { rank: 5, name: "Supermemory competitor signal in memory/context space", direction: "down", impact: "low" },
    ],
    keyMetrics: [
      { label: "MCP tools", value: "350" },
      { label: "Role lenses", value: "6" },
      { label: "Dogfood scenarios", value: "13" },
      { label: "Tests passing", value: "1,510+" },
    ],
    changes: [
      { description: "AI App redesigned to search-first canvas with inline 8-section result workspace", date: "Mar 23" },
      { description: "Phase 14: tool decoupling with dynamic imports, localFileTools split into 10 modules", date: "Mar 23" },
      { description: "Canonical dogfood runbook v1 codified with 13 scenarios and telemetry schema", date: "Mar 23" },
      { description: "Public homepage OG tags updated to entity intelligence positioning", date: "Mar 23" },
    ],
    risks: [
      {
        title: "Surface proliferation before habit proof",
        description: "13 founder surfaces, 350 tools, 6 lenses — but the 3 core habits (weekly reset, pre-delegation, important-change review) are not yet proven in production use.",
        falsification: "Run 3 complete dogfood cycles. If packet reuse rate < 30% or repeat-question rate > 40%, the habit loop is not working.",
      },
      {
        title: "Public narrative drift",
        description: "Internal thesis is sharp (local-first operating memory + entity context + artifact restructuring) but public surfaces still lag. Homepage, package docs, and onboarding do not yet tell this story.",
        falsification: "Run MCP-06 public-doc drift detection. If > 3 mismatches found, narrative unification is P0.",
      },
    ],
    comparables: [
      { name: "Supermemory", relevance: "high", note: "Universal memory / context infrastructure, MCP distribution, MemoryBench" },
      { name: "Perplexity", relevance: "medium", note: "Artifact-first search, citation model — UX reference for result pages" },
      { name: "PitchBook", relevance: "medium", note: "Entity intelligence for finance — simplicity and search-first reference" },
      { name: "Linear", relevance: "low", note: "Speed-as-feature, opinionated defaults — interaction quality reference" },
    ],
    nextQuestions: [
      "What's the packet reuse rate after 3 founder weekly resets?",
      "Does the public-doc drift detection scenario catch all known mismatches?",
      "What's the repeat-question rate across the first 13 dogfood scenarios?",
      "Is the banker Anthropic search producing live data or falling back to demo?",
    ],
  },
  legal_openai: {
    query: "What legal and data-governance risks matter most for OpenAI enterprise adoption this quarter?",
    entityName: "OpenAI Enterprise Risk Review",
    answer:
      "The legal lens is now about control and traceability, not just model accuracy. Enterprise buyers want to know where sensitive data flows, what gets retained, when human approval is required, and whether every agent action can be replayed during procurement, audit, or incident review.",
    confidence: 73,
    sourceCount: 14,
    variables: [
      { rank: 1, name: "Enterprise data retention boundaries", direction: "up", impact: "high" },
      { rank: 2, name: "Indemnity scope for generated output", direction: "up", impact: "high" },
      { rank: 3, name: "Auditability of tool-using agents", direction: "up", impact: "high" },
      { rank: 4, name: "EU/US AI governance convergence", direction: "up", impact: "medium" },
      { rank: 5, name: "Shadow AI usage outside approved workflows", direction: "up", impact: "medium" },
    ],
    keyMetrics: [
      { label: "Priority", value: "High" },
      { label: "Risk type", value: "Governance" },
      { label: "Control gap", value: "Traceability" },
      { label: "Review mode", value: "Quarterly" },
    ],
    changes: [
      { description: "Enterprise buyers are now asking for agent-action traceability, not just model security whitepapers", date: "This quarter" },
      { description: "Data-governance review expanded from prompts and outputs to tool calls and downstream writes", date: "This quarter" },
    ],
    risks: [
      {
        title: "Insufficient action audit trail",
        description: "If the system cannot explain what an agent did across tools and approvals, legal review shifts from manageable to blocking.",
        falsification: "Sample five real workflows. If each has a replayable action trail with approvals and evidence, the concern drops.",
      },
      {
        title: "Retention and training ambiguity",
        description: "Procurement friction rises when customers cannot quickly determine whether data is retained, cached, or repurposed across product surfaces.",
        falsification: "Contract review yields explicit retention and isolation language for the deployed path.",
      },
    ],
    comparables: [
      { name: "Anthropic", relevance: "high", note: "Competes on safety posture and enterprise protocol clarity" },
      { name: "Microsoft Copilot", relevance: "medium", note: "Wins where governance is bundled into incumbent controls" },
      { name: "Google Gemini", relevance: "medium", note: "Benefits from cloud-native policy integration" },
    ],
    nextQuestions: [
      "Which workflows require human approval before an external write or send?",
      "Can the customer export a complete execution trace for internal audit?",
      "Where do retention defaults differ across chat, API, and agent surfaces?",
    ],
  },
  student_shopify: {
    query: "Explain Shopify's AI commerce strategy in plain language and give me a study brief.",
    entityName: "Shopify",
    answer:
      "Shopify is using AI to make running an online store easier. Instead of only selling software, it is building AI helpers for writing product copy, answering merchant questions, improving search, and helping stores convert more shoppers. That matters because the more daily work Shopify handles, the harder it is for merchants to leave.",
    confidence: 78,
    sourceCount: 16,
    variables: [
      { rank: 1, name: "Merchant workflow automation", direction: "up", impact: "high" },
      { rank: 2, name: "Product discovery via AI", direction: "up", impact: "medium" },
      { rank: 3, name: "Merchant switching costs", direction: "up", impact: "medium" },
      { rank: 4, name: "AI content trust", direction: "neutral", impact: "medium" },
      { rank: 5, name: "Platform competition", direction: "up", impact: "low" },
    ],
    keyMetrics: [
      { label: "Summary", value: "Builder-first AI" },
      { label: "Core benefit", value: "Merchant productivity" },
      { label: "Main risk", value: "Quality control" },
      { label: "Study mode", value: "Plain language" },
    ],
    changes: [
      { description: "AI helper features moved closer to daily merchant workflows", date: "Recent" },
      { description: "Commerce platforms are competing on who owns AI-assisted discovery and operations", date: "Recent" },
    ],
    comparables: [
      { name: "Amazon", relevance: "high", note: "AI in seller tools and marketplace search" },
      { name: "Google", relevance: "medium", note: "AI-driven product discovery layer" },
      { name: "BigCommerce", relevance: "medium", note: "Smaller platform alternative" },
    ],
    nextQuestions: [
      "Why does AI make merchants more likely to stay on Shopify?",
      "How is Shopify different from Amazon in AI commerce?",
      "What governance risks appear when AI creates product content?",
    ],
  },
  banker_series_b: {
    query: "Build a diligence memo on this Series B startup from these meeting notes",
    entityName: "Series B Startup Diligence",
    answer:
      "From a banker lens, the first pass is whether the company is financable now, not whether the story is interesting. The memo should reduce uncertainty around quality of revenue, customer concentration, pace of growth, and whether the financing narrative supports a credible next round or strategic process.",
    confidence: 69,
    sourceCount: 9,
    variables: [
      { rank: 1, name: "Revenue quality", direction: "up", impact: "high" },
      { rank: 2, name: "Customer concentration", direction: "neutral", impact: "high" },
      { rank: 3, name: "Growth durability", direction: "up", impact: "high" },
      { rank: 4, name: "Capital efficiency", direction: "up", impact: "medium" },
      { rank: 5, name: "Management credibility", direction: "up", impact: "medium" },
    ],
    keyMetrics: [
      { label: "Lens", value: "Banker" },
      { label: "Primary output", value: "Memo" },
      { label: "Focus", value: "Deal readiness" },
      { label: "Stage", value: "Series B" },
    ],
    changes: [{ description: "Meeting-note ingestion now converts unstructured context into memo-ready diligence points", date: "Current" }],
    risks: [
      {
        title: "Narrative outruns evidence",
        description: "If product enthusiasm is not supported by durable growth and clean customer data, the story will not hold in diligence.",
        falsification: "Revenue retention, expansion, and concentration checks all pass against source data.",
      },
    ],
    nextQuestions: [
      "What percentage of ARR comes from the top 10 customers?",
      "Is growth driven by new logos, expansion, or pricing?",
      "What diligence gaps would block a banker process today?",
    ],
  },
  plan: {
    query: "Plan a real-time notification system",
    entityName: "Feature Plan: Real-Time Notification System",
    answer:
      "Phased implementation plan for a real-time notification system, conditioned on current founder context. " +
      "5 phases, 4 identified risks, wedge alignment: 55%.",
    confidence: 55,
    sourceCount: 5,
    packetType: "plan_proposal",
    variables: [
      { rank: 1, name: "Phase p1: Research & Design", direction: "neutral", impact: "high" },
      { rank: 2, name: "Phase p2: Backend Implementation", direction: "neutral", impact: "high" },
      { rank: 3, name: "Phase p3: Frontend Implementation", direction: "neutral", impact: "medium" },
      { rank: 4, name: "Phase p4: Testing & QA", direction: "neutral", impact: "medium" },
      { rank: 5, name: "Phase p5: Deploy & Verify", direction: "neutral", impact: "low" },
    ],
    rawPacket: {
      planId: "plan_demo_notification",
      planType: "feature_plan",
      title: "Feature Plan: Real-Time Notification System",
      summary:
        "Phased implementation plan for a real-time notification system, conditioned on current founder context. " +
        "5 phases, 4 identified risks, wedge alignment: 55%.",
      strategicFit: {
        wedgeAlignment: 0.55,
        whyNow: "Expands capability surface. Ensure alignment with current wedge before committing resources.",
        initiativeLinks: ["init_2"],
        contradictionRisks: ["Demo data vs live data"],
      },
      phases: [
        { id: "p1", title: "Research & Design", description: "Research approaches for real-time notification system, design data model and API contract", dependencies: [], estimatedEffort: "days", affectedSurfaces: ["docs"], acceptanceCriteria: ["Design doc reviewed", "Data model defined"] },
        { id: "p2", title: "Backend Implementation", description: "Build server routes, Convex schema, and MCP tools for notification dispatch and preferences", dependencies: ["p1"], estimatedEffort: "days", affectedSurfaces: ["server", "convex", "packages/mcp-local"], acceptanceCriteria: ["API endpoints respond", "Schema deployed"] },
        { id: "p3", title: "Frontend Implementation", description: "Build React components, hooks, and notification center UI with real-time WebSocket updates", dependencies: ["p2"], estimatedEffort: "days", affectedSurfaces: ["src/features", "src/layouts"], acceptanceCriteria: ["UI renders with live data", "Navigation works"] },
        { id: "p4", title: "Testing & QA", description: "Write scenario-based tests, run visual dogfood, fix regressions", dependencies: ["p3"], estimatedEffort: "days", affectedSurfaces: ["tests"], acceptanceCriteria: ["Tests pass", "Dogfood screenshots clean"] },
        { id: "p5", title: "Deploy & Verify", description: "Deploy to production, verify all surfaces, monitor for errors", dependencies: ["p4"], estimatedEffort: "hours", affectedSurfaces: ["vercel", "convex"], acceptanceCriteria: ["Production loads clean", "No console errors"] },
      ],
      competitorContext: [],
      codebaseReadiness: [
        { capability: "Search route classification", status: "ready", files: ["server/routes/search.ts"], notes: "Extensible switch/case pattern" },
        { capability: "WebSocket infrastructure", status: "ready", files: ["server/mcpGateway.ts", "server/commandBridge.ts"], notes: "Existing WS server with auth and heartbeat" },
        { capability: "MCP tool registration", status: "ready", files: ["packages/mcp-local/src/toolsetRegistry.ts"], notes: "Lazy-loading domain registry" },
        { capability: "Notification preferences UI", status: "missing", files: [], notes: "No existing notification preferences component" },
      ],
      risks: [
        { title: "Demo data vs live data", severity: "high", mitigation: "Resolve this contradiction before or during implementation to avoid compounding technical debt", linkedContradiction: "Demo data vs live data" },
        { title: "Tool count drift", severity: "medium", mitigation: "Resolve this contradiction before or during implementation to avoid compounding technical debt", linkedContradiction: "Tool count drift" },
        { title: "Scope creep beyond initial feature", severity: "medium", mitigation: "Define strict phase 1 scope and defer enhancements" },
        { title: "Missing context from incomplete data", severity: "medium", mitigation: "Use available context, flag gaps explicitly, iterate after launch" },
      ],
      delegationPacket: {
        scope: "Implement real-time notification system end-to-end: backend routes, schema, MCP tools, frontend views",
        constraints: [
          "Must pass npx tsc --noEmit with 0 errors",
          "Must pass npx vite build clean",
          "Follow existing patterns (glass card DNA, terracotta accent)",
          "All interactive elements need aria-label and keyboard support",
        ],
        affectedFiles: ["docs", "server", "convex", "packages/mcp-local", "src/features", "src/layouts", "tests", "vercel"],
        desiredBehavior: "User can receive and manage real-time notifications via the cockpit UI with full search integration",
        acceptanceCriteria: ["Design doc reviewed", "API endpoints respond", "UI renders with live data", "Tests pass", "Production loads clean"],
        contextNotToLose: [
          "Founder mission: Operating intelligence for founders",
          "Wedge: local-first entity-context layer for agent-native businesses",
          "Active contradictions: Demo data vs live data, Tool count drift",
        ],
      },
      provenance: {
        generatedAt: new Date().toISOString(),
        sourceCount: 5,
        contextSources: ["founder_profile", "active_initiatives", "active_contradictions", "codebase_patterns"],
        triggerQuery: "Plan a real-time notification system",
      },
    },
    nextQuestions: [
      "What constraints should the plan respect?",
      "Which phase should we start with?",
      "Should we delegate this to an agent?",
      "What competitors are building something similar?",
    ],
  },
};
