/**
 * Home Daily Brief — canonical type definitions.
 *
 * These types represent the shape of data consumed by the Home v3 surface
 * (`public/proto/home-v3.html` → React port).  They bridge the existing
 * Convex backend tables (`dailyBriefSnapshots`, `dailyBriefMemories`,
 * `signals`, `entityStates`) to the frontend's expected shape.
 *
 * Pattern: Adapter layer (existing backend) → canonical types → UI
 * Prior art: Anthropic "Building Effective Agents" (2024) — typed contracts
 *
 * See: docs/architecture/HOME_DAILY_BRIEF_LIVE_WIRING.md §2
 */

// ─── Evidence Checklist (6 deterministic boolean checks) ───────────────

export interface EvidenceChecklist {
  /** Tier 1/2 domain present among sources (sec.gov, reuters.com, etc.) */
  hasPrimarySource: boolean;
  /** 2+ distinct source domains corroborate the claim */
  hasCorroboration: boolean;
  /** Testable falsification criteria exist (LLM-derived at generation, stored as boolean) */
  hasFalsifiableClaim: boolean;
  /** Hard numbers present ($X, Y%, Nx) */
  hasQuantitativeData: boolean;
  /** Named person or entity cited by name */
  hasNamedAttribution: boolean;
  /** At least one followable, non-paywalled URL */
  isReproducible: boolean;
}

export type ConfidenceLevel = "verified" | "estimated" | "speculative";

// ─── Signal (BLUF item) ────────────────────────────────────────────────

export interface SignalSource {
  label: string;
  url: string;
  tier: 1 | 2 | 3 | 4;
}

export interface SignalReflection {
  what: string;
  soWhat: string;
  nowWhat: string;
}

export interface BriefSignal {
  title: string;
  url?: string;
  summary: string;
  hardNumbers?: string;
  directQuote?: string;
  sources?: SignalSource[];
  reflection: SignalReflection;
  evidenceChecklist?: EvidenceChecklist;
  falsificationCriteria?: string;
}

// ─── Action Item ───────────────────────────────────────────────────────

export type ActionPersona = "You" | "Agent" | "You + Agent";
export type ActionPriority = "P0" | "P1" | "P2";
export type ActionStatus = "pending" | "in_progress" | "done" | "review";

export interface BriefAction {
  _id?: string;
  persona: ActionPersona;
  action: string;
  priority?: ActionPriority;
  deadline?: string;
  status: ActionStatus;
  linkedEntityId?: string;
  linkedEventId?: string;
  requiresHumanJudgment?: boolean;
  canBeFullyAutomated?: boolean;
  agentRunId?: string;
  completedAt?: number;
}

// ─── Entity Spotlight (What Changed) ───────────────────────────────────

export interface MetricDelta {
  metric: string;
  currentValue: string;
  priorValue: string;
  changePercent: string;
}

export interface EntitySpotlight {
  name: string;
  type: "company" | "person" | "market" | "product";
  keyInsight: string;
  fundingStage?: string;
  keyFacts: string[];
  sources: Array<{ label: string; url: string }>;
  metricDelta?: MetricDelta;
}

// ─── Competing Explanations (Why Now?) ─────────────────────────────────

export type EvidenceLevel = "grounded" | "mixed" | "speculative";

export interface CompetingExplanation {
  title: string;
  explanation: string;
  evidenceLevel: EvidenceLevel;
  evidenceChecklist: EvidenceChecklist;
  checksPassing: number;
  checksTotal: number;
  falsificationCriteria: string;
  measurementApproach: string;
}

// ─── Narrative Framing ─────────────────────────────────────────────────

export interface NarrativeFraming {
  dominantStory: string;
  attentionShare: number;
  underReportedAngle: string;
}

// ─── Fact Check ────────────────────────────────────────────────────────

export type FactCheckStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "false";

export interface FactCheckFinding {
  claim: string;
  status: FactCheckStatus;
  explanation: string;
  confidence: number;
}

// ─── Catalyst Event (What to Watch) ────────────────────────────────────

export interface CatalystEvent {
  _id: string;
  event: string;
  date: string;
  decisionTrigger: string;
  linkedActionIds: string[];
}

// ─── User Entity Position ──────────────────────────────────────────────

export interface UserEntityPosition {
  entityId: string;
  entitySlug: string;
  entityName: string;
  relationship: string;
  annualValue?: number;
  exposureType?: string;
  activeContext?: string;
}

// ─── Position Annotation (derived from matching signal → position) ─────

export interface PositionAnnotation {
  relationship: string;
  exposure: string;
  context: string;
}

// ─── Mini Report Card (carousel) ───────────────────────────────────────

export type ReportStatus =
  | "verified"
  | "watching"
  | "review"
  | "drafting"
  | "live"
  | "stale";

export interface MiniReportCard {
  _id: string;
  entityName: string;
  entitySlug: string;
  kind: string;
  status: ReportStatus;
  headline: string;
  sourceCount: number;
  claimCount: number;
  updatedAt: number;
  lensLabel?: string;
}

// ─── AgentDigestOutput (canonical payload) ─────────────────────────────

/**
 * The single source of truth for the Home daily brief surface.
 * Every section derives from this object — no section queries raw feeds.
 *
 * Generated by `convex/workflows/dailyMorningBrief.ts` (6 AM UTC cron).
 * Stored in `dailyBriefSnapshots.digestOutput`.
 */
export interface AgentDigestOutput {
  dateString: string;
  narrativeThesis: string;

  signals: BriefSignal[];
  actionItems: BriefAction[];

  entitySpotlight?: EntitySpotlight[];
  competingExplanations?: CompetingExplanation[];
  factCheckFindings?: FactCheckFinding[];
  narrativeFraming?: NarrativeFraming;

  storyCount: number;
  topSources: string[];
  topCategories: string[];
  processingTimeMs: number;
}

// ─── BLUF Item (signal + derived confidence + position) ────────────────

export interface BlufItem extends BriefSignal {
  confidence: ConfidenceLevel;
  position: PositionAnnotation | null;
}

// ─── useHomeBrief return shape ─────────────────────────────────────────

export interface HomeBriefData {
  isLoading: boolean;
  brief: AgentDigestOutput | null;
  blufItems: BlufItem[];
  reports: MiniReportCard[];
  positions: UserEntityPosition[];
  events: CatalystEvent[];
  dateString: string;
  cutoffTime: string;
}
