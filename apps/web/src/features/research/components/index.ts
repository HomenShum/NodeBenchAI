/**
 * Research Components Index
 * 
 * Exports all research-related components including:
 * - Phase All: Citation, Entity, Timeline, Supplement, and Digest components
 * - Existing: Charts, Dashboards, Feed, etc.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PHASE ALL: AI-2027.com-like Components
// ═══════════════════════════════════════════════════════════════════════════

// Phase 1: Citation & Provenance
export { FootnoteMarker } from "./FootnoteMarker";
export { FootnotesSection } from "./FootnotesSection";

// Phase 2: Timeline Strip
export { TimelineStrip, type TimelineEvent, type TemporalPhase } from "./TimelineStrip";

// Phase 3: Entity Linking
export { EntityLink } from "./EntityLink";

// Phase 4: Multi-Source Research (components are in convex/domains/agents)
// Agent tools are used via Convex actions

// Phase 5: Research Supplements
export { 
  ResearchSupplementView, 
  type SupplementType,
  type SupplementSection,
  type ResearchSupplement 
} from "./ResearchSupplement";

// Phase 6: Email Digest
export { 
  EmailDigestPreview,
  type DigestTopic,
  type DigestItem,
  type EmailDigest 
} from "./EmailDigestPreview";

// ═══════════════════════════════════════════════════════════════════════════
// PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export { InteractiveSpanParser } from "./InteractiveSpanParser";
export { InteractiveSpan } from "./InteractiveSpan";
export { SmartLink } from "./SmartLink";
export { CrossLinkedText } from "./CrossLinkedText";

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING RESEARCH COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

export { ActAwareDashboard } from "./ActAwareDashboard";
export { MorningDigest } from "./MorningDigest";
export { PersonalPulse } from "./PersonalPulse";
export { FeedCard, type FeedItem } from "./FeedCard";
export { DashboardPanel } from "./DashboardPanel";
export { SignalCard } from "./SignalCard";
export { ActionCard } from "./ActionCard";
export { RelatedFeedsGrid, type RelatedFeedItem } from "./RelatedFeedsGrid";

// ═══════════════════════════════════════════════════════════════════════════
// MODEL EVALUATION & BENCHMARKS
// ═══════════════════════════════════════════════════════════════════════════

export {
  ModelEvalDashboard,
  LATEST_EVAL_DATA,
  LATEST_SCENARIO_DATA,
  type ModelEvalResult,
  type ScenarioResult,
  type EvalDashboardProps,
} from "./ModelEvalDashboard";

