export interface TooltipPayload {
  title: string;
  body: string;
  kicker?: string;
  /** Evidence IDs linked to this tooltip - shown on hover */
  linkedEvidenceIds?: string[];
}

export interface ChartPoint {
  value: number;
  tooltip?: TooltipPayload;
  /** Evidence IDs that back this data point - enables scroll-to-highlight on click */
  linkedEvidenceIds?: string[];
}

export interface ChartSeries {
  id: string;
  label: string;
  type: "solid" | "ghost";
  color?: string;
  data: ChartPoint[];
}

export interface TrendLineConfig {
  title: string;
  xAxisLabels: string[];
  series: ChartSeries[];
  visibleEndIndex: number;
  /** Index of "today"/present point (solid history ends here; projections begin after) */
  presentIndex?: number;
  focusIndex?: number;
  gridScale?: { min: number; max: number };
  /** Optional annotations pinned to specific data points */
  annotations?: Annotation[];
  /** Y-axis unit label (e.g., "%", "pts", "items") */
  yAxisUnit?: string;
  /** Time window description (e.g., "last 7 days", "24h") */
  timeWindow?: string;
  /** Baseline value for reference (e.g., target, previous period average) */
  baseline?: { value: number; label: string };
  /** Delta from baseline or previous period */
  delta?: { value: number; label: string; direction: "up" | "down" | "flat" };
  /** Last updated timestamp */
  lastUpdated?: string;
}

export interface Annotation {
  id: string;
  title: string;
  description: string;
  // Position as percentage (0-100) on the chart canvas
  position?: { x: number; y: number };
  // Optional index of the data point on the primary series to anchor the annotation
  targetIndex?: number;
  sentiment?: "positive" | "negative" | "neutral";
  associatedDataIndex?: number;
}

// Delta indicator for animated value changes
export interface DeltaValue {
  value: string;
  change: string;
  direction: "up" | "down" | "flat";
}

// Key stat with optional context and trend
export interface KeyStat {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "flat";
  context?: string; // e.g., "Critical Risk", "In Production"
}

// Capability bar entry
export interface CapabilityEntry {
  label: string;
  score: number; // 0-100
  icon: string; // lucide icon name: "brain" | "activity" | "shield" | etc.
}

// Market share segment for donut chart
export interface MarketShareSegment {
  label: string;
  value: number;
  color: string; // "black" | "gray" | "accent" or hex
  icon?: string; // emoji or icon name
}

export interface GraphNode {
  id: string;
  label: string;
  type?: "company" | "person" | "concept" | "product";
  importance?: number;
  /** 1 = direct impact, 2 = second-order */
  tier?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship?: string;
  context?: string;
  impact?: string;
  order?: "primary" | "secondary";
}

export interface EntityGraph {
  focusNodeId?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Skill toggle for AI 2027-style capability grid
 * Displays as a progress bar with icon and label (matching AI 2027 visual style)
 * Hover shows capability scale: Amateur → Human Pro → Superhuman → Superhuman+
 */
export interface SkillToggle {
  id: string;
  label: string; // e.g., "Hacking", "Coding", "Robotics"
  icon: string; // lucide icon name or emoji
  enabled: boolean; // whether capability is active/unlocked
  score?: number; // 0-1 capability level (0=Amateur, 0.33=Human Pro, 0.66=Superhuman, 0.9+=Superhuman+)
  description?: string; // optional tooltip description
}

/**
 * Status banner for displaying animated counters with context
 * e.g., "33,000 Unreliable Agent copies thinking at 20x human speed"
 */
export interface StatusBanner {
  count: number; // animated number value
  label: string; // e.g., "Unreliable Agent copies"
  context: string; // e.g., "thinking at 20x human speed"
  variant?: "default" | "warning" | "success"; // styling variant
}

/**
 * Milestone label for visible text markers on the dashboard
 * Shows important events or achievements as visible labels
 */
export interface MilestoneLabel {
  id: string;
  text: string; // e.g., "Hamlets", "Autonomously replicating..."
  icon?: string; // optional icon or emoji
  position?: "bottom" | "overlay"; // where to display
  sentiment?: "positive" | "negative" | "neutral";
}

export interface DashboardState {
  meta: {
    currentDate: string;
    timelineProgress: number; // 0.0 to 1.0
  };
  charts: {
    trendLine: TrendLineConfig;
    marketShare: MarketShareSegment[];
  };
  techReadiness: {
    existing: number; // 0-10
    emerging: number; // 0-10
    sciFi: number; // 0-10
  };
  keyStats: KeyStat[];
  capabilities: CapabilityEntry[];
  annotations?: Annotation[];
  // Delta indicators for change tracking (optional)
  deltas?: Record<string, DeltaValue>;
  // AI 2027-style skill toggles grid
  skillToggles?: SkillToggle[];
  // Status banner with animated counter
  statusBanner?: StatusBanner;
  // Visible milestone labels
  milestoneLabels?: MilestoneLabel[];
  // Agent count footer (AI 2027 style)
  agentCount?: {
    count: number;
    label: string;
    speed: number;
  };
  // Optional GraphRAG-style entity relationship map
  entityGraph?: EntityGraph;
}

// Agent-facing contract to ensure incoming dashboard updates match the UI slots
export interface AgentDashboardUpdate {
  timelineId?: string;
  summary?: string;
  meta: { currentDate: string; timelineProgress: number };
  charts: {
    mainTrend?: { data: number[]; label: string };
    trendLine?: {
      series: number[];
      ghostSeries?: number[];
      gridScale?: { min: number; max: number };
      label?: string;
      xAxisLabels?: string[];
    };
    marketShare: MarketShareSegment[];
  };
  techReadiness: { existing: number; emerging: number; sciFi: number };
  keyStats: KeyStat[];
  capabilities: CapabilityEntry[];
  annotations?: Array<{
    targetIndex?: number;
    position?: { x: number; y: number };
    title: string;
    description: string;
    sentiment?: "positive" | "negative" | "neutral";
  }>;
  deltas?: Record<
    string,
    { value: string; change: string; direction: "up" | "down" | "flat" }
  >;
  // AI 2027-style features
  skillToggles?: Array<{
    id: string;
    label: string;
    icon: string;
    enabled: boolean;
    score?: number; // 0-1 capability level
    description?: string;
  }>;
  statusBanner?: {
    count: number;
    label: string;
    context: string;
    variant?: "default" | "warning" | "success";
  };
  milestoneLabels?: Array<{
    id: string;
    text: string;
    icon?: string;
    position?: "bottom" | "overlay";
    sentiment?: "positive" | "negative" | "neutral";
  }>;
}

export interface StorySection {
  sectionId: string;
  narrative: {
    title: string;
    date_display: string;
    summary: string;
    body: string; // HTML/Markdown string
  };
  dashboard_state: DashboardState;
}

// ------------------------------------------------------------------
// BRIEFING & SIGNAL TYPES
// ------------------------------------------------------------------

export interface Evidence {
  id?: string;
  url?: string;
  source: string;
  title?: string;
  publishedAt?: string;
  relevance?: string;
  score?: number;
  favicon?: string;
  summary?: string;
}

export interface Signal {
  id?: string;
  headline: string;
  synthesis?: string;
  summary?: string;
  evidence?: Evidence[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  impact?: 'high' | 'medium' | 'low';
}

export interface Action {
  id?: string;
  priority: 'high' | 'medium' | 'low';
  headline?: string;
  title?: string;
  description?: string;
  rationale?: string;
  deadline?: string;
  linkedSignalIds?: string[];
}

export interface ActData {
  headline?: string;
  synthesis?: string;
  summary?: string;
  stats?: Record<string, string | number>;
  topSources?: Array<string | { name: string }>;
  signals?: Signal[];
  actions?: Action[];
}

export interface ExecutiveBriefRecord {
  status: 'valid' | 'invalid';
  brief?: DailyBriefPayload;
  evidence?: Evidence[];
}

export interface DailyBriefPayload {
  date: string;
  actI?: ActData;
  actII?: ActData;
  actIII?: ActData;
}

export interface SourceSummary {
  totalItems: number;
  breakdown: Array<{
    source: string;
    count: number;
  }>;
}
