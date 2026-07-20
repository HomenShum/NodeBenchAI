import { useMemo, useState, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  TrendingUp,
  Activity,
  FileText,
  CheckSquare,
  Calendar as CalendarIcon,
  Zap,
  Database,
  Users,
  Layers,
  LayoutGrid,
  ShieldCheck,
  Target,
  AlertTriangle,
  Radio,
  Bot,
  Flag,
  Wrench,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { TopDividerBar } from "@shared/ui/TopDividerBar";
import { UnifiedHubPills } from "@shared/ui/UnifiedHubPills";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";
import { PresetChip } from "@shared/ui/PresetChip";
import { SidebarMiniCalendar } from "@shared/ui/SidebarMiniCalendar";
import { SidebarUpcoming } from "@shared/ui/SidebarUpcoming";
import { usePlannerState } from "@/hooks/usePlannerState";

export type RoadmapSlice = {
  period: "week" | "month" | "quarter" | "year";
  label: string; // e.g. "This Week", "September 2025"
  totalTasks: number;
  completed: number;
  inProgress: number;
  blocked: number;
  domains: Array<{ name: string; count: number }>;
};

type PersonaProfile = {
  name: string;
  focus: string;
  cadence: string;
  primaryDeliverables: string[];
  signalFocus: string[];
  needs: string[];
  agents: string[];
};

type AgentBackbone = {
  name: string;
  detail: string;
};

type AgentCoverage = {
  agent: string;
  personas: string[];
  count: number;
};

type PriorityItem = {
  title: string;
  summary: string;
  personas: string[];
  agents: string[];
};

type PriorityGroup = {
  priority: "P0" | "P1" | "P2";
  label: string;
  items: PriorityItem[];
};

type RoadmapStat = {
  label: string;
  value: number;
  detail: string;
};

type PersonaSegment = {
  title: string;
  description: string;
  personas: string[];
  outcomes: string[];
};

type Deliverable = {
  title: string;
  cadence: string;
  outputs: string[];
  personas: string[];
  agents: string[];
};

type SourceCoverage = {
  label: string;
  status: "Live" | "Planned";
  description: string;
  sources: string[];
};

type QualityPrinciple = {
  title: string;
  detail: string;
  checks: string[];
};

type SectionTone = "slate" | "sky" | "indigo" | "emerald" | "teal" | "violet" | "amber" | "rose";

type ActivationPath = {
  segment: string;
  entryPoints: string[];
  triggers: string[];
  outputs: string[];
  agents: string[];
};

type CoverageLevel = "Primary" | "Secondary" | "Support";

type CoverageMatrixRow = {
  deliverable: string;
  coverage: Record<string, CoverageLevel>;
};

type SuccessMetric = {
  name: string;
  definition: string;
  target: string;
  personas: string[];
};

type RiskDependency = {
  title: string;
  impact: string;
  mitigation: string;
};

type PhaseTimeline = {
  phase: string;
  window: string;
  focus: string;
  deliverables: string[];
};

type OrchestrationStage = {
  stage: string;
  description: string;
  agents: string[];
};

type RoadmapPulse = {
  title: string;
  description: string;
  metric: string;
  tone: SectionTone;
  icon: React.ComponentType<{ className?: string }>;
};

type RoadmapFlowStep = {
  stage: string;
  description: string;
  tone: SectionTone;
  icon: React.ComponentType<{ className?: string }>;
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function useMockRoadmap(): Array<RoadmapSlice> {
  return useMemo(
    () => [
      {
        period: "week",
        label: "This Week",
        totalTasks: 18,
        completed: 9,
        inProgress: 6,
        blocked: 3,
        domains: [
          { name: "Health", count: 5 },
          { name: "Work:Docs", count: 4 },
          { name: "Home", count: 3 },
          { name: "Finance", count: 2 },
          { name: "Learning", count: 4 },
        ],
      },
      {
        period: "month",
        label: "September 2025",
        totalTasks: 73,
        completed: 40,
        inProgress: 26,
        blocked: 7,
        domains: [
          { name: "Work:Docs", count: 22 },
          { name: "Health", count: 15 },
          { name: "Home", count: 12 },
          { name: "Relationships", count: 9 },
          { name: "Learning", count: 15 },
        ],
      },
      {
        period: "quarter",
        label: "Q3 2025",
        totalTasks: 210,
        completed: 129,
        inProgress: 58,
        blocked: 23,
        domains: [
          { name: "Work:Projects", count: 86 },
          { name: "Health", count: 41 },
          { name: "Learning", count: 36 },
          { name: "Home", count: 27 },
          { name: "Finance", count: 20 },
        ],
      },
      {
        period: "year",
        label: "2025",
        totalTasks: 820,
        completed: 530,
        inProgress: 210,
        blocked: 80,
        domains: [
          { name: "Work:Projects", count: 300 },
          { name: "Health", count: 150 },
          { name: "Learning", count: 140 },
          { name: "Home", count: 120 },
          { name: "Finance", count: 110 },
        ],
      },
    ],
    [],
  );
}

const personaProfiles: PersonaProfile[] = [
  {
    name: "Venture Capitalists",
    focus: "Deal sourcing and diligence",
    cadence: "Daily brief plus real-time deal alerts",
    primaryDeliverables: ["Deal and Dossier Pack", "Executive Daily Brief"],
    signalFocus: ["Funding rounds", "Founder credibility", "Market comps"],
    needs: [
      "Deal flow alerts with auto-generated company dossiers",
      "Founder credibility signals and competitor comparisons",
      "Funding, IPO, and exit timing context",
    ],
    agents: ["Entity Research", "SEC Agent", "Arbitrage"],
  },
  {
    name: "JPM Startup Banking",
    focus: "Healthcare, life sciences, technology",
    cadence: "Daily regulatory brief plus event alerts",
    primaryDeliverables: ["Regulatory and Risk Radar", "Deal and Dossier Pack"],
    signalFocus: ["FDA decisions", "IPO filings", "M&A comps"],
    needs: [
      "Regulatory dashboards with FDA and clinical timelines",
      "IPO and M&A comps with valuation context",
      "Sector deep dives with financial tables",
    ],
    agents: ["SEC Agent", "Research Agent", "Arbitrage"],
  },
  {
    name: "Mercury Bankers",
    focus: "Startup ecosystem banking",
    cadence: "Weekly ecosystem digest plus daily signals",
    primaryDeliverables: ["Executive Daily Brief", "Research and Dev Radar"],
    signalFocus: ["YC batches", "Funding velocity", "Sector rotation"],
    needs: [
      "YC batch tracking and funding velocity charts",
      "Ecosystem health metrics with sector rotation signals",
      "Weekly digests with daily signal alerts",
    ],
    agents: ["Research Agent", "Media Agent", "Entity Research"],
  },
  {
    name: "Investment Bankers",
    focus: "Deal execution and comps",
    cadence: "Real-time deal alerts plus weekly comps",
    primaryDeliverables: ["Deal and Dossier Pack", "Export and Reporting Kit"],
    signalFocus: ["M&A rumors", "Valuation comps", "Buyer-seller shifts"],
    needs: [
      "Comparable transaction tables and market timing windows",
      "Relationship graphs for buyers and sellers",
      "Real-time deal intelligence alerts",
    ],
    agents: ["SEC Agent", "Entity Research", "Arbitrage"],
  },
  {
    name: "Technology Leaders",
    focus: "Technical strategy and team building",
    cadence: "Daily research radar plus weekly deep dives",
    primaryDeliverables: ["Research and Dev Radar", "Executive Daily Brief"],
    signalFocus: ["Model releases", "Benchmark moves", "Talent shifts"],
    needs: [
      "Paper summaries with benchmark tracking",
      "Model release timelines and capability shifts",
      "Talent movement and open-source momentum",
    ],
    agents: ["Research Agent", "Media Agent", "Arbitrage"],
  },
  {
    name: "Startup Founders",
    focus: "Timing, competition, and fundraising",
    cadence: "Weekly strategy brief plus competitive alerts",
    primaryDeliverables: ["Research and Dev Radar", "Executive Daily Brief"],
    signalFocus: ["Competitor launches", "Fundraising timing", "Hiring signals"],
    needs: [
      "Competitor watchlists with launch and funding alerts",
      "Market timing signals with action guidance",
      "PRD and pitch scaffolds for fundraising",
    ],
    agents: ["Entity Research", "Research Agent", "Arbitrage"],
  },
  {
    name: "Developers",
    focus: "Tooling, security, and velocity",
    cadence: "Daily tool updates plus vulnerability alerts",
    primaryDeliverables: ["Research and Dev Radar"],
    signalFocus: ["Repo momentum", "Security advisories", "Framework shifts"],
    needs: [
      "TL;DR summaries with code-first examples",
      "Vulnerability alerts and framework comparisons",
      "Search across papers and repos",
    ],
    agents: ["Research Agent", "Media Agent", "Arbitrage"],
  },
  {
    name: "Biotech Professionals",
    focus: "Trials, regulation, and pipeline shifts",
    cadence: "Daily regulatory brief plus trial alerts",
    primaryDeliverables: ["Regulatory and Risk Radar", "Executive Daily Brief"],
    signalFocus: ["Clinical trials", "FDA calendars", "Pipeline shifts"],
    needs: [
      "Clinical trial tracking with phase changes",
      "FDA decision calendars and alerts",
      "Pipeline tables with research highlights",
    ],
    agents: ["Research Agent", "SEC Agent", "Arbitrage"],
  },
  {
    name: "Fintech Professionals",
    focus: "Regulatory and competitive intelligence",
    cadence: "Daily regulatory alerts plus market impact",
    primaryDeliverables: ["Regulatory and Risk Radar", "Executive Daily Brief"],
    signalFocus: ["Federal Register updates", "Compliance changes", "Partnership launches"],
    needs: [
      "Regulatory alerts with market impact analysis",
      "Compliance calendars and partnership tracking",
      "Competitive launch monitoring",
    ],
    agents: ["Research Agent", "Arbitrage", "Entity Research"],
  },
  {
    name: "PitchBook Analysts",
    focus: "Reports with provenance",
    cadence: "On-demand exports plus weekly reporting",
    primaryDeliverables: ["Export and Reporting Kit", "Deal and Dossier Pack"],
    signalFocus: ["Deal comps", "Funding rounds", "Citation chains"],
    needs: [
      "Citation-ready exports and source chains",
      "Confidence scoring and conflict detection",
      "Structured datasets for reporting",
    ],
    agents: ["Arbitrage", "Entity Research", "Research Agent"],
  },
];

const deepAgentBackbone: AgentBackbone[] = [
  {
    name: "Coordinator Router",
    detail: "Routes fast vs deep research workflows by intent.",
  },
  {
    name: "Arbitrage Agent",
    detail: "Verifies claims, highlights conflicts, and tracks deltas.",
  },
  {
    name: "Entity Research Agent",
    detail: "Builds dossiers across companies, people, and markets.",
  },
  {
    name: "SEC Agent",
    detail: "Ingests filings and ties regulatory data to insights.",
  },
  {
    name: "Media Agent",
    detail: "Finds credible media, transcripts, and context links.",
  },
  {
    name: "Email Intelligence",
    detail: "Turns inbox signals into briefs, dossiers, and alerts.",
  },
];

const priorityRoadmap: PriorityGroup[] = [
  {
    priority: "P0",
    label: "Now",
    items: [
      {
        title: "Editorial front page + must-reads rail",
        summary: "Hero story, trending rail, and scannable headlines tied to live feeds.",
        personas: ["Venture Capitalists", "JPM Startup Banking", "Mercury Bankers", "Investment Bankers"],
        agents: ["Research Agent", "Arbitrage"],
      },
      {
        title: "Scenario branching in narrative briefs",
        summary: "Slowdown vs base vs acceleration paths with Act-level navigation.",
        personas: ["Startup Founders", "Technology Leaders", "Venture Capitalists"],
        agents: ["Coordinator Router", "Research Agent"],
      },
      {
        title: "Citations and provenance everywhere",
        summary: "Footnotes, source badges, and methodology surfaced in briefs and cards.",
        personas: ["PitchBook Analysts", "JPM Startup Banking", "Investment Bankers", "Biotech Professionals"],
        agents: ["Arbitrage"],
      },
    ],
  },
  {
    priority: "P1",
    label: "Next",
    items: [
      {
        title: "Topic taxonomy with follow + saved filters",
        summary: "Persistent topic tracking with followable sectors and alerts.",
        personas: ["Technology Leaders", "Developers", "Startup Founders"],
        agents: ["Research Agent", "Entity Research"],
      },
      {
        title: "Persona-adaptive briefs",
        summary: "Presets shape feed filters, KPIs, and newsletter emphasis by role.",
        personas: ["Venture Capitalists", "JPM Startup Banking", "Mercury Bankers", "Investment Bankers"],
        agents: ["Coordinator Router", "Email Intelligence"],
      },
      {
        title: "Search, share, and subscribe in the hub header",
        summary: "Global search, share actions, and newsletter signup made prominent.",
        personas: ["All Personas"],
        agents: ["Research Agent", "Email Intelligence"],
      },
      {
        title: "Professional publishing layer",
        summary: "Bylines, publish cadence, and social sharing for credibility.",
        personas: ["JPM Startup Banking", "Biotech Professionals", "Fintech Professionals"],
        agents: ["Arbitrage", "Media Agent"],
      },
    ],
  },
  {
    priority: "P2",
    label: "Later",
    items: [
      {
        title: "Reading modes and density controls",
        summary: "Executive summary vs full brief, with focus mode and font controls.",
        personas: ["All Personas"],
        agents: ["Coordinator Router"],
      },
      {
        title: "Media and data-viz expansion",
        summary: "Richer charts, embedded media, and narrative blocks for depth.",
        personas: ["Technology Leaders", "Developers", "Startup Founders"],
        agents: ["Media Agent", "Research Agent"],
      },
      {
        title: "Accessibility and IA polish",
        summary: "Improved landmarks, skip links, and navigation clarity.",
        personas: ["All Personas"],
        agents: ["Research Agent"],
      },
    ],
  },
];

const personaSegments: PersonaSegment[] = [
  {
    title: "Capital Markets",
    description: "Finance and banking roles that need deal intelligence and valuation context.",
    personas: ["Venture Capitalists", "JPM Startup Banking", "Investment Bankers", "Mercury Bankers", "PitchBook Analysts"],
    outcomes: [
      "Deal flow alerts with comps and timing windows",
      "Executive synthesis with market and sector context",
      "Exportable tables and citation-ready reporting",
    ],
  },
  {
    title: "Technology Operators",
    description: "Builders and leaders who need technical depth and execution signals.",
    personas: ["Technology Leaders", "Developers", "Startup Founders"],
    outcomes: [
      "Research and repo radar with benchmarks",
      "Launch, hiring, and competitor signals",
      "What changed, why it matters, what to do next",
    ],
  },
  {
    title: "Regulated Verticals",
    description: "Healthcare and fintech roles where compliance and approvals drive outcomes.",
    personas: ["Biotech Professionals", "Fintech Professionals"],
    outcomes: [
      "Regulatory calendars with decision alerts",
      "Trial, policy, and compliance risk tracking",
      "Industry briefs aligned to key agencies",
    ],
  },
];

const coreDeliverables: Deliverable[] = [
  {
    title: "Executive Daily Brief",
    cadence: "Daily plus on-demand refresh",
    outputs: [
      "Executive synthesis with clear risk framing",
      "Act-based narrative with key signals",
      "Source-linked metrics and pulse indicators",
    ],
    personas: ["Venture Capitalists", "JPM Startup Banking", "Technology Leaders", "Biotech Professionals"],
    agents: ["Coordinator Router", "Research Agent", "Arbitrage"],
  },
  {
    title: "Deal and Dossier Pack",
    cadence: "Real-time alerts plus weekly rollups",
    outputs: [
      "Company dossiers with founder credibility",
      "Comparable deal tables and timing context",
      "Competitive landscape snapshots",
    ],
    personas: ["Venture Capitalists", "Investment Bankers", "JPM Startup Banking", "PitchBook Analysts"],
    agents: ["Entity Research", "SEC Agent", "Arbitrage"],
  },
  {
    title: "Regulatory and Risk Radar",
    cadence: "Daily monitoring with event alerts",
    outputs: [
      "Regulatory calendar and trial milestones",
      "Policy impacts and compliance summaries",
      "Escalation alerts for high-risk changes",
    ],
    personas: ["Biotech Professionals", "Fintech Professionals", "JPM Startup Banking"],
    agents: ["Research Agent", "SEC Agent", "Arbitrage"],
  },
  {
    title: "Research and Dev Radar",
    cadence: "Daily signals plus weekly deep dives",
    outputs: [
      "Paper summaries with benchmark movement",
      "Repo momentum with code-first highlights",
      "Model release timelines and capability shifts",
    ],
    personas: ["Technology Leaders", "Developers", "Startup Founders"],
    agents: ["Research Agent", "Media Agent", "Arbitrage"],
  },
  {
    title: "Export and Reporting Kit",
    cadence: "On-demand exports",
    outputs: [
      "CSV or Excel exports for reporting",
      "Citation chains with confidence scores",
      "Source conflict and delta tracking",
    ],
    personas: ["PitchBook Analysts", "Investment Bankers", "JPM Startup Banking"],
    agents: ["Arbitrage", "Entity Research"],
  },
];

const signalCoverage: SourceCoverage[] = [
  {
    label: "Live core signals",
    status: "Live",
    description: "High-velocity sources feeding daily briefs and real-time alerts.",
    sources: ["Hacker News", "GitHub", "Dev.to", "ArXiv", "Reddit", "Product Hunt", "RSS feeds"],
  },
  {
    label: "Live premium signals",
    status: "Live",
    description: "Paid or specialized sources for deeper market and media coverage.",
    sources: ["LinkUp", "SEC filings", "YouTube", "Perplexity"],
  },
  {
    label: "Planned regulated signals",
    status: "Planned",
    description: "Critical gaps to unlock biotech and fintech coverage.",
    sources: ["FDA databases", "ClinicalTrials.gov", "Federal Register"],
  },
];

const activationPaths: ActivationPath[] = [
  {
    segment: "Capital Markets",
    entryPoints: ["Executive Daily Brief", "Deal and Dossier Pack", "Export and Reporting Kit"],
    triggers: ["Funding round > $10M", "IPO filing or S-1", "M&A rumor", "Sector rotation shift"],
    outputs: ["Deal memo with comps", "Dossier pack with founder credibility", "Exportable tables"],
    agents: ["Coordinator Router", "Entity Research", "SEC Agent", "Arbitrage"],
  },
  {
    segment: "Technology Operators",
    entryPoints: ["Research and Dev Radar", "Fast Agent Panel", "Live Signal Stream"],
    triggers: ["Model release", "Repo momentum surge", "Talent move", "Competitive launch"],
    outputs: ["Benchmark summary", "Code-first brief", "Actionable build roadmap"],
    agents: ["Research Agent", "Media Agent", "Arbitrage"],
  },
  {
    segment: "Regulated Verticals",
    entryPoints: ["Regulatory and Risk Radar", "Executive Daily Brief", "Signal Coverage"],
    triggers: ["FDA decision", "Clinical trial phase change", "Federal Register update"],
    outputs: ["Regulatory calendar update", "Risk escalation alert", "Compliance summary"],
    agents: ["Research Agent", "SEC Agent", "Arbitrage"],
  },
];

const coverageSegments = ["Capital Markets", "Technology Operators", "Regulated Verticals"];

const coverageMatrix: CoverageMatrixRow[] = [
  {
    deliverable: "Executive Daily Brief",
    coverage: {
      "Capital Markets": "Primary",
      "Technology Operators": "Secondary",
      "Regulated Verticals": "Secondary",
    },
  },
  {
    deliverable: "Deal and Dossier Pack",
    coverage: {
      "Capital Markets": "Primary",
      "Technology Operators": "Support",
      "Regulated Verticals": "Secondary",
    },
  },
  {
    deliverable: "Regulatory and Risk Radar",
    coverage: {
      "Capital Markets": "Support",
      "Technology Operators": "Support",
      "Regulated Verticals": "Primary",
    },
  },
  {
    deliverable: "Research and Dev Radar",
    coverage: {
      "Capital Markets": "Support",
      "Technology Operators": "Primary",
      "Regulated Verticals": "Support",
    },
  },
  {
    deliverable: "Export and Reporting Kit",
    coverage: {
      "Capital Markets": "Secondary",
      "Technology Operators": "Support",
      "Regulated Verticals": "Secondary",
    },
  },
];

const successMetrics: SuccessMetric[] = [
  {
    name: "Time to insight",
    definition: "Median time from opening the hub to a decision-ready summary.",
    target: "< 10 min",
    personas: ["All Personas"],
  },
  {
    name: "Brief adoption",
    definition: "Percent of users opening the daily brief within 24 hours.",
    target: "> 60%",
    personas: ["Venture Capitalists", "JPM Startup Banking", "Technology Leaders"],
  },
  {
    name: "Alert responsiveness",
    definition: "Median time to open high-signal alerts.",
    target: "< 30 min",
    personas: ["Capital Markets", "Regulated Verticals"],
  },
  {
    name: "Citation coverage",
    definition: "Share of briefs and dossiers with full provenance.",
    target: "100%",
    personas: ["PitchBook Analysts", "Investment Bankers"],
  },
  {
    name: "Export usage",
    definition: "Weekly export actions per active analyst team.",
    target: "> 3 / week",
    personas: ["PitchBook Analysts", "Investment Bankers"],
  },
];

const riskDependencies: RiskDependency[] = [
  {
    title: "Regulated data access",
    impact: "Biotech and fintech briefs lack full coverage.",
    mitigation: "Prioritize FDA, ClinicalTrials.gov, and Federal Register ingestion.",
  },
  {
    title: "Signal overload",
    impact: "Key alerts get buried in high-volume feeds.",
    mitigation: "Persona filters, alert thresholds, and summary tiering.",
  },
  {
    title: "Quality drift",
    impact: "Summaries lose accuracy as sources diversify.",
    mitigation: "Arbitrage verification and confidence scoring on every claim.",
  },
  {
    title: "Latency at scale",
    impact: "Long briefs slow down decision cycles.",
    mitigation: "Workpool orchestration, caching, and summary-first delivery.",
  },
];

const phaseTimeline: PhaseTimeline[] = [
  {
    phase: "Now",
    window: "0-2 weeks",
    focus: "Editorial front page, citations, and must-read signals.",
    deliverables: [
      "Editorial front page + must-reads rail",
      "Citations and provenance everywhere",
      "Search, share, and subscribe in the hub header",
    ],
  },
  {
    phase: "Next",
    window: "3-6 weeks",
    focus: "Persona personalization and professional publishing layer.",
    deliverables: [
      "Topic taxonomy with follow + saved filters",
      "Persona-adaptive briefs",
      "Professional publishing layer",
    ],
  },
  {
    phase: "Later",
    window: "6-10 weeks",
    focus: "Narrative depth, accessibility, and readability upgrades.",
    deliverables: [
      "Scenario branching in narrative briefs",
      "Reading modes and density controls",
      "Accessibility and IA polish",
    ],
  },
];

const orchestrationStages: OrchestrationStage[] = [
  {
    stage: "Ingest",
    description: "Collect live signals, filings, and media from all sources.",
    agents: ["Research Agent", "Media Agent", "SEC Agent"],
  },
  {
    stage: "Rank",
    description: "Score for novelty, relevance, and urgency by persona.",
    agents: ["Coordinator Router", "Arbitrage"],
  },
  {
    stage: "Synthesize",
    description: "Generate briefs, dossiers, and narrative summaries.",
    agents: ["Research Agent"],
  },
  {
    stage: "Verify",
    description: "Attach citations, conflicts, and confidence markers.",
    agents: ["Arbitrage"],
  },
  {
    stage: "Deliver",
    description: "Publish to hub, alerts, and email workflows.",
    agents: ["Email Intelligence", "Fast Agent Panel"],
  },
  {
    stage: "Learn",
    description: "Persist preferences and tune prompts by persona.",
    agents: ["Coordinator Router"],
  },
];

const qualityBar: QualityPrinciple[] = [
  {
    title: "Credibility",
    detail: "Every insight is sourced, conflict-checked, and ranked.",
    checks: [
      "Citations on every brief and dossier",
      "Conflict detection and delta tracking",
      "Source quality badges always visible",
    ],
  },
  {
    title: "Actionability",
    detail: "Each brief ends with clear actions and watchlist triggers.",
    checks: [
      "What changed, why it matters, what to do next",
      "Alert thresholds tied to role priorities",
      "Decision-ready summaries for handoff",
    ],
  },
  {
    title: "Timeliness",
    detail: "Daily cadence with real-time alert coverage.",
    checks: [
      "Daily brief delivered by 6:00 UTC",
      "Alert SLA for high-signal events",
      "Freshness stamps on all feeds",
    ],
  },
  {
    title: "Comparability",
    detail: "Standardized metrics make signals easy to compare.",
    checks: [
      "Benchmark and comps tables in every dossier",
      "Normalized KPIs for fast scanning",
      "Segmented views by persona",
    ],
  },
  {
    title: "Exportability",
    detail: "Everything ships with exports and share-ready formats.",
    checks: [
      "CSV or Excel exports for tables",
      "Shareable brief summaries",
      "Evidence packs with citations",
    ],
  },
];

const roadmapStats: RoadmapStat[] = [
  {
    label: "Personas",
    value: personaProfiles.length,
    detail: "served",
  },
  {
    label: "Segments",
    value: personaSegments.length,
    detail: "focus groups",
  },
  {
    label: "Activation paths",
    value: activationPaths.length,
    detail: "entry flows",
  },
  {
    label: "Deliverables",
    value: coreDeliverables.length,
    detail: "programs",
  },
  {
    label: "Priority tiers",
    value: priorityRoadmap.length,
    detail: "now to later",
  },
  {
    label: "Improvements",
    value: priorityRoadmap.reduce((sum, group) => sum + group.items.length, 0),
    detail: "roadmap items",
  },
  {
    label: "Signal lanes",
    value: signalCoverage.length,
    detail: "coverage bands",
  },
  {
    label: "Quality checks",
    value: qualityBar.length,
    detail: "principles",
  },
];

const roadmapPulse: RoadmapPulse[] = [
  {
    title: "Speed to insight",
    description: "Executive summaries with decision-ready cues.",
    metric: "< 10 min",
    tone: "emerald",
    icon: Zap,
  },
  {
    title: "Verified evidence",
    description: "Citations, conflicts, and confidence signals.",
    metric: "100% sourced",
    tone: "sky",
    icon: ShieldCheck,
  },
  {
    title: "Persona alignment",
    description: "Every brief tuned to a decision role.",
    metric: "10 personas",
    tone: "indigo",
    icon: Users,
  },
  {
    title: "Delivery cadence",
    description: "Daily briefs plus real-time alerts.",
    metric: "Daily + live",
    tone: "violet",
    icon: Radio,
  },
];

const roadmapFlow: RoadmapFlowStep[] = [
  {
    stage: "Ingest",
    description: "Normalize signals",
    tone: "teal",
    icon: Database,
  },
  {
    stage: "Rank",
    description: "Prioritize by persona",
    tone: "sky",
    icon: TrendingUp,
  },
  {
    stage: "Synthesize",
    description: "Briefs and dossiers",
    tone: "violet",
    icon: FileText,
  },
  {
    stage: "Verify",
    description: "Citations and conflicts",
    tone: "emerald",
    icon: ShieldCheck,
  },
  {
    stage: "Deliver",
    description: "Alerts and exports",
    tone: "amber",
    icon: Zap,
  },
  {
    stage: "Learn",
    description: "Persona tuning",
    tone: "rose",
    icon: Target,
  },
];

const agentCoverageMap: AgentCoverage[] = Array.from(
  new Set(personaProfiles.flatMap((persona) => persona.agents)),
)
  .map((agent) => {
    const personas = personaProfiles
      .filter((persona) => persona.agents.includes(agent))
      .map((persona) => persona.name);
    return {
      agent,
      personas,
      count: personas.length,
    };
  })
  .sort((a: any, b: any) => b.count - a.count);

const roadmapNav = [
  { label: "Overview", target: "roadmap-overview" },
  { label: "Personas", target: "roadmap-personas" },
  { label: "Segments", target: "roadmap-segments" },
  { label: "Activation", target: "roadmap-activation" },
  { label: "Coverage", target: "roadmap-matrix" },
  { label: "Deliverables", target: "roadmap-deliverables" },
  { label: "Quality bar", target: "roadmap-quality" },
  { label: "Metrics", target: "roadmap-metrics" },
  { label: "Risks", target: "roadmap-risks" },
  { label: "Signals", target: "roadmap-coverage" },
  { label: "Workflow", target: "roadmap-workflow" },
  { label: "Agents", target: "roadmap-agents" },
  { label: "Priorities", target: "roadmap-priorities" },
  { label: "Timeline", target: "roadmap-timeline" },
];

export function TimelineRoadmapView({ slices }: { slices?: Array<RoadmapSlice> }) {
  // Always call the hook unconditionally to satisfy React's rules of hooks
  const mockData = useMockRoadmap();
  // Then use slices if provided, otherwise fall back to mock data
  const data = slices ?? mockData;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const suppressObserverUntilRef = useRef(0);
  const manualNavLockUntilRef = useRef(0);
  const [activeSection, setActiveSection] = useState<string>(roadmapNav[0]?.target ?? "roadmap-overview");
  const [manualActiveSection, setManualActiveSection] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState<number>(0);

  // Fetch analytics data
  const analytics = useQuery(api.domains.analytics.analytics.getRoadmapAnalytics, {});

  // Shared planner state for sidebar
  const { handleViewDay, handleViewWeek, upcoming } = usePlannerState();

  // Unified sidebar open/collapsed state (shared key with CalendarHomeHub and DocumentsHomeHub)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem("unifiedSidebar.open") || "true");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("unifiedSidebar.open", JSON.stringify(sidebarOpen));
    } catch {
      // noop
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const total = scrollHeight - clientHeight;
      const progress = total > 0 ? Math.min(100, Math.max(0, (scrollTop / total) * 100)) : 0;
      setScrollProgress(progress);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const now = Date.now();
        if (now < suppressObserverUntilRef.current) {
          return;
        }

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            if (a.intersectionRatio !== b.intersectionRatio) {
              return b.intersectionRatio - a.intersectionRatio;
            }
            const rootTop = a.rootBounds?.top ?? 0;
            const aDistanceToTop = Math.abs(a.boundingClientRect.top - rootTop);
            const bDistanceToTop = Math.abs(b.boundingClientRect.top - rootTop);
            return aDistanceToTop - bDistanceToTop;
          });

        if (visible.length === 0) {
          return;
        }

        if (manualActiveSection) {
          const manualInView = visible.some((entry) => entry.target.id === manualActiveSection);
          if (manualInView) {
            setActiveSection(manualActiveSection);
            setManualActiveSection(null);
            manualNavLockUntilRef.current = 0;
            return;
          }
          if (now < manualNavLockUntilRef.current) {
            return;
          }
          setManualActiveSection(null);
        }

        setActiveSection(visible[0].target.id);
      },
      {
        root: container,
        rootMargin: "0px 0px -55% 0px",
        threshold: [0.2, 0.4, 0.6],
      },
    );

    roadmapNav.forEach(({ target }) => {
      const element = document.getElementById(target);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [manualActiveSection]);

  const navActiveSection = manualActiveSection ?? activeSection;

  const activeIndex = Math.max(
    0,
    roadmapNav.findIndex((item) => item.target === navActiveSection),
  );

  return (
    <div ref={scrollRef} className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame flex flex-col 2xl:flex-row gap-6">
          <div className="flex-1 min-w-0 space-y-6">
            {/* Top Divider Bar and Header */}
            <div id="floating-main-dock" className="">
              <TopDividerBar
                left={
                  <UnifiedHubPills active="roadmap" showRoadmap roadmapDisabled={false} />
                }
              />

              <PageHeroHeader
                icon={"🗺️"}
                title={"Agent Roadmap"}
                date={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                accent
                className="mb-6"
                presets={
                  <>
                    <span className="text-xs text-content-secondary mr-2">
                      Presets:
                    </span>

                    <PresetChip>Q4 Goals</PresetChip>

                    <PresetChip>Product Launch</PresetChip>

                    <PresetChip>Team OKRs</PresetChip>
                  </>
                }
              />
            </div>

            <section className="sticky top-4 z-sticky">
              <div className="nb-surface-card bg-surface/95 backdrop-blur p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs tracking-wide text-content-secondary">Roadmap Navigator</div>
                    <div className="text-xs font-semibold text-content">
                      Section {activeIndex + 1} of {roadmapNav.length}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
                    className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-secondary px-2 py-1 text-xs text-content-secondary transition-all duration-200 hover:bg-surface-hover hover:text-content active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronUp className="h-3 w-3" />
                    Back to top
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {roadmapNav.map((item) => (
                    <RoadmapNavButton
                      key={item.target}
                      item={item}
                      isActive={navActiveSection === item.target}
                      scrollContainerRef={scrollRef}
                      onActivate={(target) => {
                        // NOTE(coworker): Keep clicked tab visibly active while smooth-scroll catches up.
                        setManualActiveSection(target);
                        manualNavLockUntilRef.current = Date.now() + 2400;
                        setActiveSection(target);
                        suppressObserverUntilRef.current = Date.now() + 900;
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-surface-secondary overflow-hidden">
                  <div className="h-full bg-[var(--accent-primary)] transition-all" style={{ width: `${scrollProgress}%` }} />
                </div>
              </div>
            </section>

            {/* Analytics Overview */}
            {analytics === undefined && (
              <div className="flex items-center justify-center py-12">
                <div className="text-sm text-content-secondary">Loading analytics...</div>
              </div>
            )}
            {analytics && (
              <div className="space-y-6">
                {/* Total Counts Grid */}
                <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard
                    icon={<FileText className="w-4 h-4" />}
                    label="Documents"
                    value={analytics.totals.documents}
                    color="blue"
                  />
                  <StatCard
                    icon={<CheckSquare className="w-4 h-4" />}
                    label="Tasks"
                    value={analytics.totals.tasks}
                    color="purple"
                  />
                  <StatCard
                    icon={<CalendarIcon className="w-4 h-4" />}
                    label="Events"
                    value={analytics.totals.events}
                    color="green"
                  />
                  <StatCard
                    icon={<Zap className="w-4 h-4" />}
                    label="Agent Runs"
                    value={analytics.totals.chatThreads}
                    color="orange"
                  />
                  <StatCard
                    icon={<Activity className="w-4 h-4" />}
                    label="Agent Tasks"
                    value={analytics.totals.agentTasks}
                    color="indigo"
                  />
                  <StatCard
                    icon={<Database className="w-4 h-4" />}
                    label="Files"
                    value={analytics.totals.files}
                    color="teal"
                  />
                  <StatCard
                    icon={<TrendingUp className="w-4 h-4" />}
                    label="Nodes"
                    value={analytics.totals.nodes}
                    color="rose"
                  />
                  <StatCard
                    icon={<Activity className="w-4 h-4" />}
                    label="Timelines"
                    value={analytics.totals.agentTimelines}
                    color="amber"
                  />
                </section>

                {/* Activity Heatmap */}
                <section className="nb-surface-card p-4">
                  <h3 className="type-section-title text-content mb-3">Activity Heatmap (Last 90 Days)</h3>
                  <div className="flex flex-wrap gap-1">
                    {analytics.heatmap.map((day: any) => {
                      const intensity = Math.min(day.totalActivity / 10, 1); // normalize to 0-1
                      const bgOpacity = Math.max(0.1, intensity);
                      return (
                        <div
                          key={day.date}
                          className="w-3 h-3 rounded-sm border border-edge"
                          style={{
                            backgroundColor: `color-mix(in srgb, rgb(79, 70, 229) ${Math.round(bgOpacity * 100)}%, transparent)`,
                          }}
                          title={`${day.date}: ${day.totalActivity} activities`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-content-secondary">
                    <span>Less</span>
                    <div className="flex gap-1">
                      {[0.1, 0.3, 0.5, 0.7, 1].map((opacity) => (
                        <div
                          key={opacity}
                          className="w-3 h-3 rounded-sm border border-edge"
                          style={{
                            backgroundColor: `color-mix(in srgb, rgb(79, 70, 229) ${Math.round(opacity * 100)}%, transparent)`,
                          }}
                        />
                      ))}
                    </div>
                    <span>More</span>
                  </div>
                </section>

                {/* Status Breakdowns */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatusBreakdown
                    title="Tasks by Status"
                    data={[
                      { label: "To Do", value: analytics.byStatus.tasks.todo, color: "bg-gray-500" },
                      { label: "In Progress", value: analytics.byStatus.tasks.in_progress, color: "bg-[var(--accent-primary)]" },
                      { label: "Done", value: analytics.byStatus.tasks.done, color: "bg-green-500" },
                      { label: "Blocked", value: analytics.byStatus.tasks.blocked, color: "bg-red-500" },
                    ]}
                  />
                  <StatusBreakdown
                    title="Events by Status"
                    data={[
                      { label: "Confirmed", value: analytics.byStatus.events.confirmed, color: "bg-green-500" },
                      { label: "Tentative", value: analytics.byStatus.events.tentative, color: "bg-yellow-500" },
                      { label: "Cancelled", value: analytics.byStatus.events.cancelled, color: "bg-red-500" },
                    ]}
                  />
                  <StatusBreakdown
                    title="Agent Tasks by Status"
                    data={[
                      { label: "Pending", value: analytics.byStatus.agentTasks.pending, color: "bg-gray-500" },
                      { label: "Running", value: analytics.byStatus.agentTasks.running, color: "bg-[var(--accent-primary)]" },
                      { label: "Complete", value: analytics.byStatus.agentTasks.complete, color: "bg-green-500" },
                      { label: "Paused", value: analytics.byStatus.agentTasks.paused, color: "bg-yellow-500" },
                      { label: "Error", value: analytics.byStatus.agentTasks.error, color: "bg-red-500" },
                    ]}
                  />
                </section>

                {/* Top Tags */}
                {analytics.topTags.length > 0 && (
                  <section className="rounded-lg border border-edge bg-surface-secondary p-4">
                    <h3 className="text-sm font-semibold text-content mb-3">Top Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {analytics.topTags.map((tag: any) => (
                        <span
                          key={tag.name}
                          className="px-2 py-1 text-xs rounded-md border bg-surface text-content-secondary border-edge"
                        >
                          {tag.name} {"\u00b7"} {tag.count}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            <section id="roadmap-overview" className="relative rounded-lg border border-edge bg-surface-secondary p-5 overflow-hidden">
              <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-[var(--accent-primary)]/10 blur-3xl" />
              <div className="pointer-events-none absolute -left-24 bottom-0 h-40 w-40 rounded-full bg-[var(--accent-primary)]/10 blur-3xl" />
              <div className="relative space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-content">
                    Product Roadmap: People, Needs, and UI/UX Priorities
                  </h2>
                  <p className="text-sm text-content-secondary">
                    Roadmap coverage ties every persona to clear needs and the UI/UX work powered by the existing deep agent stack.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  {roadmapStats.map((stat, index) => (
                    <SummaryStat key={stat.label} stat={stat} index={index} />
                  ))}
                </div>

                <div className="rounded-md border border-edge bg-surface p-3">
                  <div className="text-xs tracking-wide text-content-secondary">Jump to</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {roadmapNav.map((item) => (
                      <RoadmapNavButton
                        key={item.target}
                        item={item}
                        isActive={navActiveSection === item.target}
                        scrollContainerRef={scrollRef}
                        onActivate={(target) => {
                          setManualActiveSection(target);
                          manualNavLockUntilRef.current = Date.now() + 2400;
                          setActiveSection(target);
                          suppressObserverUntilRef.current = Date.now() + 900;
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {roadmapPulse.map((item) => (
                    <RoadmapPulseCard key={item.title} item={item} />
                  ))}
                </div>

                <RoadmapFlowStrip steps={roadmapFlow} />

                <div id="roadmap-personas" className="space-y-3">
                  <SectionHeader
                    title="People We Serve and What They Need"
                    description="Every persona maps to explicit outcomes and the agent backbone that delivers them."
                    icon={<Users className="h-4 w-4" />}
                    tone="sky"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {personaProfiles.map((persona) => (
                      <PersonaCard key={persona.name} persona={persona} />
                    ))}
                  </div>
                  <PersonaMatrix personas={personaProfiles} />
                </div>
              </div>
            </section>

            <section id="roadmap-segments" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Persona Segments and Outcomes"
                description="Grouped views help align deliverables with real decision contexts."
                icon={<Layers className="h-4 w-4" />}
                tone="indigo"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {personaSegments.map((segment) => (
                  <PersonaSegmentCard key={segment.title} segment={segment} />
                ))}
              </div>
            </section>

            <section id="roadmap-activation" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Activation Paths"
                description="Entry points, triggers, and outputs that keep each segment decision-ready."
                icon={<Zap className="h-4 w-4" />}
                tone="emerald"
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {activationPaths.map((path) => (
                  <ActivationPathCard key={path.segment} path={path} />
                ))}
              </div>
            </section>

            <section id="roadmap-matrix" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Coverage Matrix"
                description="Every deliverable maps to clear segment demand."
                icon={<LayoutGrid className="h-4 w-4" />}
                tone="teal"
                right={<CoverageLegend />}
              />
              <CoverageMatrix rows={coverageMatrix} segments={coverageSegments} />
            </section>

            <section id="roadmap-deliverables" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Core Deliverables and Cadence"
                description="Cadenced outputs that turn signals into decisions."
                icon={<FileText className="h-4 w-4" />}
                tone="violet"
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {coreDeliverables.map((deliverable) => (
                  <DeliverableCard key={deliverable.title} deliverable={deliverable} />
                ))}
              </div>
            </section>

            <section id="roadmap-quality" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Quality Bar"
                description="Non-negotiables for credibility, actionability, and export value."
                icon={<ShieldCheck className="h-4 w-4" />}
                tone="emerald"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {qualityBar.map((principle) => (
                  <QualityBarCard key={principle.title} principle={principle} />
                ))}
              </div>
            </section>

            <section id="roadmap-metrics" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Success Metrics"
                description="The scorecard that proves the roadmap is working for every audience."
                icon={<Target className="h-4 w-4" />}
                tone="sky"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {successMetrics.map((metric) => (
                  <MetricCard key={metric.name} metric={metric} />
                ))}
              </div>
            </section>

            <section id="roadmap-risks" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Risks and Dependencies"
                description="Constraints to manage while scaling coverage and depth."
                icon={<AlertTriangle className="h-4 w-4" />}
                tone="amber"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {riskDependencies.map((risk) => (
                  <RiskCard key={risk.title} risk={risk} />
                ))}
              </div>
            </section>

            <section id="roadmap-coverage" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Signal Coverage and Gaps"
                description="The live feed stack today plus the regulated gaps to close."
                icon={<Radio className="h-4 w-4" />}
                tone="teal"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {signalCoverage.map((coverage) => (
                  <SourceCoverageCard key={coverage.label} coverage={coverage} />
                ))}
              </div>
            </section>

            <section id="roadmap-workflow" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Orchestration Loop"
                description="The deep agent workflow that keeps briefs fast, verified, and relevant."
                icon={<Wrench className="h-4 w-4" />}
                tone="indigo"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {orchestrationStages.map((stage) => (
                  <OrchestrationCard key={stage.stage} stage={stage} />
                ))}
              </div>
            </section>

            <section id="roadmap-agents" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Deep Agent Backbone (Already in Place)"
                description="Core agents already powering every persona workflow."
                icon={<Bot className="h-4 w-4" />}
                tone="slate"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {deepAgentBackbone.map((agent) => (
                  <div
                    key={agent.name}
                    className="rounded-md border border-edge bg-surface p-3"
                  >
                    <div className="text-xs font-semibold text-content">{agent.name}</div>
                    <div className="text-xs text-content-secondary mt-1">{agent.detail}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-edge bg-surface p-3">
                <div className="text-xs tracking-wide text-content-secondary">Agent coverage map</div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {agentCoverageMap.map((item) => (
                    <AgentCoverageCard key={item.agent} item={item} />
                  ))}
                </div>
              </div>
            </section>

            <section id="roadmap-priorities" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Priority UI/UX Improvements"
                description="Sequenced UI upgrades that unlock persona value quickly."
                icon={<Flag className="h-4 w-4" />}
                tone="rose"
              />
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {priorityRoadmap.map((group) => (
                  <PriorityColumn key={group.priority} group={group} />
                ))}
              </div>
            </section>

            <section id="roadmap-timeline" className="rounded-lg border border-edge bg-surface-secondary p-5 space-y-3">
              <SectionHeader
                title="Phase Timeline"
                description="Sequenced delivery to keep near-term wins moving while deeper UX ships."
                icon={<CalendarIcon className="h-4 w-4" />}
                tone="violet"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {phaseTimeline.map((phase) => (
                  <PhaseTimelineCard key={phase.phase} phase={phase} />
                ))}
              </div>
            </section>

            {/* Roadmap Content */}
            <div className="space-y-6">
              {data.map((s, i) => (
                <section
                  key={`${s.period}:${i}`}
                  className="rounded-lg border border-edge bg-surface-secondary p-4"
                >
                  <header className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content">
                      {s.label}
                    </h3>
                    <span className="text-xs text-content-secondary">
                      {s.totalTasks} tasks
                    </span>
                  </header>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <SliceStat label="Completed" value={s.completed} total={s.totalTasks} color="emerald" />
                    <SliceStat label="In progress" value={s.inProgress} total={s.totalTasks} color="indigo" />
                    <SliceStat label="Blocked" value={s.blocked} total={s.totalTasks} color="rose" />
                    <div className="rounded-md border border-edge bg-surface p-3">
                      <div className="text-xs font-medium mb-2 text-content">Top domains</div>
                      <div className="flex flex-wrap gap-1">
                        {s.domains.map((d) => (
                          <span
                            key={d.name}
                            className="text-xs px-1.5 py-0.5 rounded-md border bg-surface-secondary text-content-secondary border-edge"
                          >
                            {d.name} {"\u00b7"} {d.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* Sidebar column */}
          <aside className={`${sidebarOpen ? "w-full 2xl:w-[320px] 2xl:md:w-[360px] p-3" : "w-full h-[18px] 2xl:w-[18px] 2xl:h-auto p-0"} shrink-0 border-t 2xl:border-t-0 2xl:border-l border-edge bg-surface relative z-20`}>
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="absolute left-3 -top-2 2xl:left-auto 2xl:-left-2 2xl:top-3 w-6 h-4 2xl:w-4 2xl:h-6 rounded-sm border border-edge bg-surface text-content-secondary transition-all duration-200 hover:bg-surface-hover hover:text-content active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center shadow-sm"
            >
              {sidebarOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
            {sidebarOpen && (
              <div className="space-y-4">
                <SidebarMiniCalendar
                  onSelectDate={(ms) => handleViewWeek(ms)}
                  onViewDay={(ms) => handleViewDay(ms)}
                  onViewWeek={(ms) => handleViewWeek(ms)}
                  showViewFullCalendarLink
                />
                <SidebarUpcoming upcoming={upcoming} />
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function SliceStat({ label, value, total, color }: { label: string; value: number; total: number; color: "emerald" | "indigo" | "rose" }) {
  const percent = pct(value, total);
  const bar = color === "emerald" ? "bg-green-500" : color === "indigo" ? "bg-[var(--accent-primary)]" : "bg-rose-500";
  const tint = color === "emerald" ? "bg-green-500/10" : color === "indigo" ? "bg-[var(--accent-primary)]/10" : "bg-rose-500/10";
  const text = color === "emerald" ? "text-green-600" : color === "indigo" ? "text-[var(--accent-primary)]" : "text-rose-600";

  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <div className="text-xs font-medium mb-1 text-content">{label}</div>
      <div className={`h-1.5 w-full rounded ${tint} overflow-hidden mb-1`}>
        <div className={`h-full ${bar}`} style={{ width: `${percent}%` }} />
      </div>
      <div className={`text-xs ${text}`}>{value} {"\u00b7"} {percent}%</div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colorClasses = {
    blue: "text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
    purple: "text-purple-600 bg-purple-500/10",
    green: "text-green-600 bg-green-500/10",
    orange: "text-orange-600 bg-orange-500/10",
    indigo: "text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
    teal: "text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
    rose: "text-rose-600 bg-rose-500/10",
    amber: "text-amber-600 bg-amber-500/10",
  };

  const colorClass = colorClasses[color as keyof typeof colorClasses] || colorClasses.indigo;

  return (
    <div className="rounded-lg border border-edge bg-surface-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-md ${colorClass}`}>
          {icon}
        </div>
        <span className="text-xs text-content-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold text-content">{value.toLocaleString()}</div>
    </div>
  );
}

function StatusBreakdown({ title, data }: { title: string; data: Array<{ label: string; value: number; color: string }> }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="rounded-lg border border-edge bg-surface-secondary p-4">
      <h3 className="text-sm font-semibold text-content mb-3">{title}</h3>
      <div className="space-y-2">
        {data.map((item) => {
          const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
          return (
            <div key={item.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-content-secondary">{item.label}</span>
                <span className="text-content font-medium">{item.value} ({percent}%)</span>
              </div>
              <div className="h-1.5 w-full rounded bg-surface overflow-hidden">
                <div className={`h-full ${item.color}`} style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sectionToneClasses: Record<SectionTone, string> = {
  slate: "border-edge bg-surface text-content-secondary",
  sky: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
  indigo: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
  emerald: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
  teal: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
  violet: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-600",
  rose: "border-rose-500/20 bg-rose-500/10 text-rose-600",
};

function SectionHeader({
  title,
  description,
  icon,
  tone = "slate",
  right,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  tone?: SectionTone;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md border ${sectionToneClasses[tone]}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">{title}</h3>
          {description && <p className="text-xs text-content-secondary">{description}</p>}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

const summaryAccents = [
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
  "bg-[var(--accent-primary)]",
];

function SummaryStat({ stat, index }: { stat: RoadmapStat; index: number }) {
  const accent = summaryAccents[index % summaryAccents.length];
  return (
    <div className="rounded-lg border border-edge bg-surface overflow-hidden transition-shadow">
      <div className={`h-0.5 w-full ${accent}`} />
      <div className="p-3">
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
          <span>{stat.label}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold text-content">{stat.value}</div>
        <div className="text-xs text-content-secondary">{stat.detail}</div>
      </div>
    </div>
  );
}

function RoadmapPulseCard({ item }: { item: RoadmapPulse }) {
  const Icon = item.icon;
  return (
    <div className="rounded-lg border border-edge bg-surface p-3 transition-shadow">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md border ${sectionToneClasses[item.tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-semibold text-content-secondary">{item.metric}</span>
      </div>
      <div className="mt-2 text-xs font-semibold text-content">{item.title}</div>
      <div className="text-xs text-content-secondary">{item.description}</div>
    </div>
  );
}

function RoadmapFlowStrip({ steps }: { steps: RoadmapFlowStep[] }) {
  return (
    <div className="rounded-md border border-edge bg-surface p-3">
      <div className="text-xs tracking-wide text-content-secondary">Workflow at a glance</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.stage} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-secondary px-2 py-1">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md border ${sectionToneClasses[step.tone]}`}>
                  <Icon className="h-3 w-3" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-content">{step.stage}</div>
                  <div className="text-xs text-content-secondary">{step.description}</div>
                </div>
              </div>
              {index < steps.length - 1 && <ChevronRight className="h-3 w-3 text-content-secondary" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TagPill({ label, tone = "default" }: { label: string; tone?: "default" | "success" | "warning" | "info" }) {
  const toneClasses = {
    default: "border-edge bg-surface-secondary text-content-secondary",
    success: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
    info: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  };
  return (
    <span className={`px-2 py-0.5 text-xs rounded-md border max-w-full whitespace-normal break-words ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

function RoadmapNavButton({
  item,
  isActive,
  scrollContainerRef,
  onActivate,
}: {
  item: { label: string; target: string };
  isActive?: boolean;
  scrollContainerRef: { current: HTMLDivElement | null };
  onActivate: (target: string) => void;
}) {
  const activeClasses = isActive
    ? "border-primary/55 bg-primary text-primary-foreground font-semibold shadow-sm ring-2 ring-primary/25"
    : "border-edge bg-surface-secondary text-content-secondary";
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      aria-pressed={Boolean(isActive)}
      className={`px-2.5 py-1 text-xs rounded-md border transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? "" : "hover:bg-surface-hover hover:border-primary/30 hover:text-content "}${activeClasses}`}
      onClick={() => {
        onActivate(item.target);
        const element = document.getElementById(item.target);
        const container = scrollContainerRef.current;
        if (element && container) {
          const containerRect = container.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const stickyCompensation = 132;
          const nextTop = container.scrollTop + (elementRect.top - containerRect.top) - stickyCompensation;
          container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
          return;
        }
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/90" />}
        {item.label}
      </span>
    </button>
  );
}

function PersonaCard({ persona }: { persona: PersonaProfile }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-content">{persona.name}</div>
          <div className="text-xs text-content-secondary">{persona.focus}</div>
        </div>
        <span className="text-xs px-2 py-1 rounded-md border border-edge bg-surface-secondary text-content-secondary">
          {persona.cadence}
        </span>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Primary deliverables</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {persona.primaryDeliverables.map((deliverable) => (
            <TagPill key={deliverable} label={deliverable} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Signal focus</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {persona.signalFocus.map((signal) => (
            <TagPill key={signal} label={signal} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Needs</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {persona.needs.map((need) => (
            <li key={need}>{need}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Deep agent backbone</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {persona.agents.map((agent) => (
            <TagPill key={agent} label={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonaMatrix({ personas }: { personas: PersonaProfile[] }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div>
        <div className="text-xs font-semibold text-content">Persona Matrix</div>
        <div className="text-xs text-content-secondary">
          Dense view of cadence, deliverables, and signal focus.
        </div>
      </div>
      <div className="hidden lg:block">
        <div className="grid grid-cols-[minmax(160px,1fr)_minmax(180px,1.2fr)_minmax(200px,1.2fr)_minmax(220px,1.4fr)] gap-3 text-xs tracking-wide text-content-secondary">
          <div>Persona</div>
          <div>Cadence</div>
          <div>Primary deliverables</div>
          <div>Signal focus</div>
        </div>
        <div className="mt-3 space-y-2">
          {personas.map((persona) => (
            <div
              key={persona.name}
              className="grid grid-cols-[minmax(160px,1fr)_minmax(180px,1.2fr)_minmax(200px,1.2fr)_minmax(220px,1.4fr)] gap-3 rounded-md border border-edge bg-surface-secondary p-3"
            >
              <div className="text-xs font-semibold text-content">{persona.name}</div>
              <div className="text-xs text-content-secondary">{persona.cadence}</div>
              <div className="flex flex-wrap gap-1">
                {persona.primaryDeliverables.map((deliverable) => (
                  <TagPill key={`${persona.name}-${deliverable}`} label={deliverable} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {persona.signalFocus.map((signal) => (
                  <TagPill key={`${persona.name}-${signal}`} label={signal} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:hidden">
        {personas.map((persona) => (
          <div key={persona.name} className="rounded-md border border-edge bg-surface-secondary p-3 space-y-2">
            <div className="text-xs font-semibold text-content">{persona.name}</div>
            <div className="text-xs text-content-secondary">{persona.cadence}</div>
            <div>
              <div className="text-xs tracking-wide text-content-secondary">Primary deliverables</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {persona.primaryDeliverables.map((deliverable) => (
                  <TagPill key={`${persona.name}-${deliverable}-mobile`} label={deliverable} />
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs tracking-wide text-content-secondary">Signal focus</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {persona.signalFocus.map((signal) => (
                  <TagPill key={`${persona.name}-${signal}-mobile`} label={signal} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriorityColumn({ group }: { group: PriorityGroup }) {
  const priorityTone = group.priority === "P0" ? "rose" : group.priority === "P1" ? "amber" : "emerald";
  const priorityStyles: Record<"rose" | "amber" | "emerald", { bar: string; pill: string }> = {
    rose: { bar: "bg-rose-500", pill: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
    amber: { bar: "bg-amber-500", pill: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
    emerald: {
      bar: "bg-[var(--accent-primary)]",
      pill: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]",
    },
  };
  const tone = priorityStyles[priorityTone];
  return (
    <div className="relative min-w-0 rounded-lg border border-edge bg-surface p-4 space-y-3 overflow-hidden transition-shadow">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} />
      <div className="flex items-center justify-between">
        <span className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${tone.pill}`}>
          {group.priority}
        </span>
        <div className="text-xs text-content-secondary">{group.label}</div>
      </div>
      <div className="space-y-3 min-w-0">
        {group.items.map((item) => (
          <div key={item.title} className="min-w-0 rounded-md border border-edge bg-surface-secondary p-3 space-y-2 transition-shadow">
            <div>
              <div className="text-xs font-semibold text-content break-words">{item.title}</div>
              <div className="text-xs text-content-secondary mt-1 break-words">{item.summary}</div>
            </div>
            <div>
              <div className="text-xs tracking-wide text-content-secondary">Personas</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.personas.map((persona) => (
                  <TagPill key={persona} label={persona} />
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs tracking-wide text-content-secondary">Agent backbone</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.agents.map((agent) => (
                  <TagPill key={agent} label={agent} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityBarCard({ principle }: { principle: QualityPrinciple }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{principle.title}</div>
        <div className="text-xs text-content-secondary mt-1">{principle.detail}</div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Checks</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {principle.checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PersonaSegmentCard({ segment }: { segment: PersonaSegment }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{segment.title}</div>
        <div className="text-xs text-content-secondary mt-1">{segment.description}</div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Personas</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {segment.personas.map((persona) => (
            <TagPill key={persona} label={persona} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Outcomes</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {segment.outcomes.map((outcome) => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DeliverableCard({ deliverable }: { deliverable: Deliverable }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{deliverable.title}</div>
        <div className="text-xs text-content-secondary mt-1">Cadence: {deliverable.cadence}</div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Outputs</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {deliverable.outputs.map((output) => (
            <li key={output}>{output}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Personas</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {deliverable.personas.map((persona) => (
            <TagPill key={persona} label={persona} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Agent backbone</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {deliverable.agents.map((agent) => (
            <TagPill key={agent} label={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceCoverageCard({ coverage }: { coverage: SourceCoverage }) {
  const tone = coverage.status === "Live" ? "success" : "warning";
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-content">{coverage.label}</div>
        <TagPill label={coverage.status} tone={tone} />
      </div>
      <div className="text-xs text-content-secondary">{coverage.description}</div>
      <div className="flex flex-wrap gap-1">
        {coverage.sources.map((source) => (
          <TagPill key={source} label={source} />
        ))}
      </div>
    </div>
  );
}

function ActivationPathCard({ path }: { path: ActivationPath }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{path.segment}</div>
        <div className="text-xs tracking-wide text-content-secondary mt-2">Entry points</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {path.entryPoints.map((entry) => (
            <TagPill key={entry} label={entry} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Triggers</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {path.triggers.map((trigger) => (
            <li key={trigger}>{trigger}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Outputs</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {path.outputs.map((output) => (
            <li key={output}>{output}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Agent backbone</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {path.agents.map((agent) => (
            <TagPill key={agent} label={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CoverageLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-content-secondary">
      <div className="flex items-center gap-1">
        <TagPill label="Primary" tone="success" />
        <span>Core audience</span>
      </div>
      <div className="flex items-center gap-1">
        <TagPill label="Secondary" tone="info" />
        <span>Regular demand</span>
      </div>
      <div className="flex items-center gap-1">
        <TagPill label="Support" tone="warning" />
        <span>Supplemental</span>
      </div>
    </div>
  );
}

function CoveragePill({ level }: { level: CoverageLevel }) {
  const tone = level === "Primary" ? "success" : level === "Secondary" ? "info" : "warning";
  return <TagPill label={level} tone={tone} />;
}

function CoverageMatrix({ rows, segments }: { rows: CoverageMatrixRow[]; segments: string[] }) {
  return (
    <div className="space-y-3">
      <div className="hidden md:block">
        <div className="grid grid-cols-[minmax(180px,1.2fr)_repeat(3,minmax(120px,1fr))] gap-2 text-xs">
          <div className="text-xs tracking-wide text-content-secondary">Deliverable</div>
          {segments.map((segment) => (
            <div key={segment} className="text-xs tracking-wide text-content-secondary">
              {segment}
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((row) => (
            <div
              key={row.deliverable}
              className="rounded-md border border-edge bg-surface px-3 py-2"
            >
              <div className="grid grid-cols-[minmax(180px,1.2fr)_repeat(3,minmax(120px,1fr))] gap-2 text-xs items-center">
                <div className="text-xs font-semibold text-content">{row.deliverable}</div>
                {segments.map((segment) => (
                  <div key={`${row.deliverable}-${segment}`} className="flex items-center">
                    <CoveragePill level={row.coverage[segment]} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:hidden">
        {rows.map((row) => (
          <div key={row.deliverable} className="rounded-md border border-edge bg-surface p-3">
            <div className="text-xs font-semibold text-content">{row.deliverable}</div>
            <div className="mt-2 space-y-2">
              {segments.map((segment) => (
                <div key={`${row.deliverable}-${segment}`} className="flex items-center justify-between text-xs">
                  <span className="text-xs text-content-secondary">{segment}</span>
                  <CoveragePill level={row.coverage[segment]} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ metric }: { metric: SuccessMetric }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{metric.name}</div>
        <div className="text-xs text-content-secondary mt-1">{metric.definition}</div>
      </div>
      <div className="rounded-md border border-edge bg-surface-secondary px-2 py-1 text-xs text-content">
        Target: {metric.target}
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Applies to</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {metric.personas.map((persona) => (
            <TagPill key={persona} label={persona} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskCard({ risk }: { risk: RiskDependency }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div className="text-xs font-semibold text-content">{risk.title}</div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Impact</div>
        <div className="text-xs text-content-secondary mt-1">{risk.impact}</div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Mitigation</div>
        <div className="text-xs text-content-secondary mt-1">{risk.mitigation}</div>
      </div>
    </div>
  );
}

function PhaseTimelineCard({ phase }: { phase: PhaseTimeline }) {
  const phaseTone = phase.phase === "Now" ? "emerald" : phase.phase === "Next" ? "amber" : "violet";
  const phaseBar =
    phaseTone === "emerald"
      ? "bg-[var(--accent-primary)]"
      : phaseTone === "amber"
        ? "bg-amber-500"
        : "bg-[var(--accent-primary)]";
  return (
    <div className="relative rounded-lg border border-edge bg-surface p-4 space-y-3 overflow-hidden transition-shadow">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${phaseBar}`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold text-content">{phase.phase}</div>
          <div className="text-xs text-content-secondary">{phase.window}</div>
        </div>
      </div>
      <div className="text-xs text-content-secondary">{phase.focus}</div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Deliverables</div>
        <ul className="mt-1 space-y-1 text-xs text-content-secondary list-disc pl-4">
          {phase.deliverables.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OrchestrationCard({ stage }: { stage: OrchestrationStage }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3 transition-shadow">
      <div>
        <div className="text-xs font-semibold text-content">{stage.stage}</div>
        <div className="text-xs text-content-secondary mt-1">{stage.description}</div>
      </div>
      <div>
        <div className="text-xs tracking-wide text-content-secondary">Agents</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {stage.agents.map((agent) => (
            <TagPill key={agent} label={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentCoverageCard({ item }: { item: AgentCoverage }) {
  return (
    <div className="rounded-md border border-edge bg-surface-secondary p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-content">{item.agent}</div>
        <span className="text-xs text-content-secondary">{item.count} personas</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {item.personas.map((persona) => (
          <TagPill key={`${item.agent}-${persona}`} label={persona} />
        ))}
      </div>
    </div>
  );
}
