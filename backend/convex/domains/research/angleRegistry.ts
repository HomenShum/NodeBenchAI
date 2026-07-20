/**
 * Angle Registry
 *
 * Defines all available research angles with metadata.
 * This is the heart of the adaptive research system.
 *
 * Each angle has:
 * - supports: which subject types it works with
 * - good_for: which goals/scenarios it serves
 * - freshness_sensitivity: how stale data affects usefulness
 * - cost_tier: computational cost (low/medium/high)
 * - precompute_policy: when to precompute
 * - subgraph: which LangGraph subgraph implements this
 * - output_schema: expected structured output
 */

import { v } from "convex/values";
import type { AngleId } from "../../../shared/research/angleIds";

export type { AngleId } from "../../../shared/research/angleIds";

export const angleIdValidator = v.union(
  v.literal("entity_profile"),
  v.literal("public_signals"),
  v.literal("funding_intelligence"),
  v.literal("financial_health"),
  v.literal("narrative_tracking"),
  v.literal("document_discovery"),
  v.literal("competitive_intelligence"),
  v.literal("people_graph"),
  v.literal("market_dynamics"),
  v.literal("regulatory_monitoring"),
  v.literal("patent_intelligence"),
  v.literal("academic_research"),
  v.literal("github_ecosystem"),
  v.literal("executive_brief"),
  v.literal("world_monitor"),
  v.literal("daily_brief"),
  v.literal("deep_research")
);

export interface AngleMetadata {
  angleId: AngleId;
  displayName: string;
  description: string;
  supports: Array<"company" | "person" | "event" | "topic" | "product" | "repo" | "document">;
  goodFor: Array<"prep" | "monitoring" | "diligence" | "comparison" | "decision" | "alert">;
  freshnessSensitivity: "low" | "medium" | "high" | "critical";
  costTier: "low" | "medium" | "high";
  typicalLatencyMs: number;
  precomputePolicy: "always" | "watchlist_or_hot" | "on_demand";
  subgraph: string;
  outputSchema: string;
}

export const ANGLE_REGISTRY: Record<AngleId, AngleMetadata> = {
  entity_profile: {
    angleId: "entity_profile",
    displayName: "Entity Profile",
    description: "Core identity, description, and key facts about a subject",
    supports: ["company", "person", "product", "repo"],
    goodFor: ["prep", "diligence", "comparison"],
    freshnessSensitivity: "medium",
    costTier: "low",
    typicalLatencyMs: 500,
    precomputePolicy: "always",
    subgraph: "entity_resolver_v1",
    outputSchema: "EntityProfileArtifact",
  },

  public_signals: {
    angleId: "public_signals",
    displayName: "Public Signals",
    description: "Recent news, social media, press releases, and public mentions",
    supports: ["company", "person", "event", "topic"],
    goodFor: ["prep", "monitoring", "alert"],
    freshnessSensitivity: "high",
    costTier: "medium",
    typicalLatencyMs: 2000,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "signals_public_v2",
    outputSchema: "PublicSignalsArtifact",
  },

  funding_intelligence: {
    angleId: "funding_intelligence",
    displayName: "Funding Intelligence",
    description: "Funding history, investors, valuation, and financial rounds",
    supports: ["company"],
    goodFor: ["diligence", "decision", "prep"],
    freshnessSensitivity: "high",
    costTier: "low",
    typicalLatencyMs: 800,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "funding_graph_v1",
    outputSchema: "FundingIntelligenceArtifact",
  },

  financial_health: {
    angleId: "financial_health",
    displayName: "Financial Health",
    description: "Revenue, profitability, burn rate, and financial metrics",
    supports: ["company"],
    goodFor: ["diligence", "decision"],
    freshnessSensitivity: "critical",
    costTier: "medium",
    typicalLatencyMs: 1500,
    precomputePolicy: "on_demand",
    subgraph: "financial_analyzer_v1",
    outputSchema: "FinancialHealthArtifact",
  },

  narrative_tracking: {
    angleId: "narrative_tracking",
    displayName: "Narrative Tracking",
    description: "Story evolution, positioning changes, and messaging shifts",
    supports: ["company", "person", "topic"],
    goodFor: ["monitoring", "diligence", "prep"],
    freshnessSensitivity: "medium",
    costTier: "medium",
    typicalLatencyMs: 2500,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "narrative_analyzer_v2",
    outputSchema: "NarrativeTrackingArtifact",
  },

  document_discovery: {
    angleId: "document_discovery",
    displayName: "Document Discovery",
    description: "Find and analyze relevant documents, reports, and filings",
    supports: ["company", "person", "topic", "product"],
    goodFor: ["diligence", "prep", "decision"],
    freshnessSensitivity: "low",
    costTier: "high",
    typicalLatencyMs: 4000,
    precomputePolicy: "on_demand",
    subgraph: "doc_discovery_v1",
    outputSchema: "DocumentDiscoveryArtifact",
  },

  competitive_intelligence: {
    angleId: "competitive_intelligence",
    displayName: "Competitive Intelligence",
    description: "Competitor landscape, positioning, and comparative analysis",
    supports: ["company", "product"],
    goodFor: ["diligence", "comparison", "prep"],
    freshnessSensitivity: "medium",
    costTier: "medium",
    typicalLatencyMs: 3000,
    precomputePolicy: "on_demand",
    subgraph: "competitive_map_v1",
    outputSchema: "CompetitiveIntelligenceArtifact",
  },

  people_graph: {
    angleId: "people_graph",
    displayName: "People Graph",
    description: "Key people, their backgrounds, connections, and moves",
    supports: ["company", "person"],
    goodFor: ["prep", "diligence"],
    freshnessSensitivity: "high",
    costTier: "medium",
    typicalLatencyMs: 2000,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "people_graph_v1",
    outputSchema: "PeopleGraphArtifact",
  },

  market_dynamics: {
    angleId: "market_dynamics",
    displayName: "Market Dynamics",
    description: "Market size, trends, growth, and dynamics",
    supports: ["company", "topic", "product"],
    goodFor: ["diligence", "decision", "prep"],
    freshnessSensitivity: "medium",
    costTier: "medium",
    typicalLatencyMs: 2500,
    precomputePolicy: "on_demand",
    subgraph: "market_analyzer_v1",
    outputSchema: "MarketDynamicsArtifact",
  },

  regulatory_monitoring: {
    angleId: "regulatory_monitoring",
    displayName: "Regulatory Monitoring",
    description: "Regulations, compliance, filings, and legal landscape",
    supports: ["company", "topic", "product"],
    goodFor: ["diligence", "monitoring", "decision"],
    freshnessSensitivity: "high",
    costTier: "high",
    typicalLatencyMs: 3500,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "regulatory_tracker_v1",
    outputSchema: "RegulatoryMonitoringArtifact",
  },

  patent_intelligence: {
    angleId: "patent_intelligence",
    displayName: "Patent Intelligence",
    description: "Patent portfolio, filings, and IP landscape",
    supports: ["company", "person", "product"],
    goodFor: ["diligence", "comparison"],
    freshnessSensitivity: "medium",
    costTier: "high",
    typicalLatencyMs: 4000,
    precomputePolicy: "on_demand",
    subgraph: "patent_analyzer_v1",
    outputSchema: "PatentIntelligenceArtifact",
  },

  academic_research: {
    angleId: "academic_research",
    displayName: "Academic Research",
    description: "Research papers, citations, and academic connections",
    supports: ["person", "topic", "product"],
    goodFor: ["diligence", "prep", "comparison"],
    freshnessSensitivity: "low",
    costTier: "medium",
    typicalLatencyMs: 2500,
    precomputePolicy: "on_demand",
    subgraph: "academic_graph_v1",
    outputSchema: "AcademicResearchArtifact",
  },

  github_ecosystem: {
    angleId: "github_ecosystem",
    displayName: "GitHub Ecosystem",
    description: "Repositories, contributors, activity, and open source footprint",
    supports: ["company", "person", "repo", "product"],
    goodFor: ["diligence", "comparison", "prep"],
    freshnessSensitivity: "high",
    costTier: "low",
    typicalLatencyMs: 1500,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "github_analyzer_v1",
    outputSchema: "GitHubEcosystemArtifact",
  },

  executive_brief: {
    angleId: "executive_brief",
    displayName: "Executive Brief",
    description: "High-level synthesis for executive decision-making",
    supports: ["company", "person", "event", "topic"],
    goodFor: ["prep", "decision"],
    freshnessSensitivity: "high",
    costTier: "medium",
    typicalLatencyMs: 3000,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "exec_brief_compiler_v1",
    outputSchema: "ExecutiveBriefArtifact",
  },

  world_monitor: {
    angleId: "world_monitor",
    displayName: "World Monitor",
    description: "Broader context, trends, and external factors",
    supports: ["company", "person", "event", "topic"],
    goodFor: ["monitoring", "prep", "decision"],
    freshnessSensitivity: "high",
    costTier: "medium",
    typicalLatencyMs: 2500,
    precomputePolicy: "watchlist_or_hot",
    subgraph: "world_context_v1",
    outputSchema: "WorldMonitorArtifact",
  },

  daily_brief: {
    angleId: "daily_brief",
    displayName: "Daily Brief",
    description: "Aggregated daily intelligence across tracked subjects",
    supports: ["company", "person", "event", "topic"],
    goodFor: ["monitoring", "alert"],
    freshnessSensitivity: "critical",
    costTier: "low",
    typicalLatencyMs: 1000,
    precomputePolicy: "always",
    subgraph: "daily_brief_compiler_v1",
    outputSchema: "DailyBriefArtifact",
  },

  deep_research: {
    angleId: "deep_research",
    displayName: "Deep Research",
    description: "Multi-agent deep dive with hypothesis testing",
    supports: ["company", "person", "topic", "product"],
    goodFor: ["diligence", "decision"],
    freshnessSensitivity: "medium",
    costTier: "high",
    typicalLatencyMs: 15000,
    precomputePolicy: "on_demand",
    subgraph: "deep_research_orchestrator_v1",
    outputSchema: "DeepResearchArtifact",
  },
};

// Scenario profiles - presets of angles + defaults
export interface ScenarioProfile {
  profileId: string;
  displayName: string;
  description: string;
  defaultAngles: AngleId[];
  defaultDepth: "quick" | "standard" | "comprehensive" | "exhaustive";
  freshnessDays: number;
  latencyBudgetMs: number;
  evidenceStrictness: "relaxed" | "standard" | "strict";
  rendererDefaults: string[];
}

export const SCENARIO_PROFILES: Record<string, ScenarioProfile> = {
  job_inbound_v1: {
    profileId: "job_inbound_v1",
    displayName: "Job Inbound",
    description: "Prepare for job interviews and recruiter conversations",
    defaultAngles: [
      "entity_profile",
      "public_signals",
      "funding_intelligence",
      "people_graph",
      "narrative_tracking",
      "executive_brief",
    ],
    defaultDepth: "standard",
    freshnessDays: 30,
    latencyBudgetMs: 12000,
    evidenceStrictness: "standard",
    rendererDefaults: ["compact_alert", "notion_brief"],
  },

  founder_diligence_v1: {
    profileId: "founder_diligence_v1",
    displayName: "Founder Diligence",
    description: "Deep diligence on a startup and founding team",
    defaultAngles: [
      "entity_profile",
      "funding_intelligence",
      "financial_health",
      "people_graph",
      "competitive_intelligence",
      "market_dynamics",
      "narrative_tracking",
      "deep_research",
    ],
    defaultDepth: "comprehensive",
    freshnessDays: 45,
    latencyBudgetMs: 20000,
    evidenceStrictness: "strict",
    rendererDefaults: ["json_full", "notion_brief", "exec_summary"],
  },

  event_prep_v1: {
    profileId: "event_prep_v1",
    displayName: "Event Prep",
    description: "Prepare for demo days, conferences, and networking events",
    defaultAngles: [
      "entity_profile",
      "public_signals",
      "people_graph",
      "narrative_tracking",
      "world_monitor",
      "executive_brief",
    ],
    defaultDepth: "standard",
    freshnessDays: 14,
    latencyBudgetMs: 10000,
    evidenceStrictness: "standard",
    rendererDefaults: ["compact_alert", "notion_brief"],
  },

  sales_account_prep_v1: {
    profileId: "sales_account_prep_v1",
    displayName: "Sales Account Prep",
    description: "Research for enterprise sales conversations",
    defaultAngles: [
      "entity_profile",
      "public_signals",
      "funding_intelligence",
      "people_graph",
      "competitive_intelligence",
      "executive_brief",
    ],
    defaultDepth: "standard",
    freshnessDays: 30,
    latencyBudgetMs: 12000,
    evidenceStrictness: "standard",
    rendererDefaults: ["compact_alert", "notion_brief", "talking_points"],
  },

  investor_diligence_v1: {
    profileId: "investor_diligence_v1",
    displayName: "Investor Diligence",
    description: "Research on potential investors and VC firms",
    defaultAngles: [
      "entity_profile",
      "funding_intelligence",
      "people_graph",
      "narrative_tracking",
      "deep_research",
    ],
    defaultDepth: "comprehensive",
    freshnessDays: 60,
    latencyBudgetMs: 15000,
    evidenceStrictness: "strict",
    rendererDefaults: ["json_full", "exec_summary"],
  },

  market_map_v1: {
    profileId: "market_map_v1",
    displayName: "Market Map",
    description: "Map a market space with competitors and dynamics",
    defaultAngles: [
      "competitive_intelligence",
      "market_dynamics",
      "funding_intelligence",
      "narrative_tracking",
      "executive_brief",
    ],
    defaultDepth: "comprehensive",
    freshnessDays: 45,
    latencyBudgetMs: 18000,
    evidenceStrictness: "standard",
    rendererDefaults: ["json_full", "market_map_visual"],
  },

  vendor_eval_v1: {
    profileId: "vendor_eval_v1",
    displayName: "Vendor Evaluation",
    description: "Evaluate a vendor, tool, or service provider",
    defaultAngles: [
      "entity_profile",
      "public_signals",
      "github_ecosystem",
      "regulatory_monitoring",
      "competitive_intelligence",
      "people_graph",
    ],
    defaultDepth: "comprehensive",
    freshnessDays: 45,
    latencyBudgetMs: 15000,
    evidenceStrictness: "strict",
    rendererDefaults: ["json_full", "notion_brief"],
  },

  daily_monitor_v1: {
    profileId: "daily_monitor_v1",
    displayName: "Daily Monitor",
    description: "Daily intelligence across watchlist",
    defaultAngles: ["daily_brief", "public_signals", "world_monitor"],
    defaultDepth: "quick",
    freshnessDays: 1,
    latencyBudgetMs: 5000,
    evidenceStrictness: "relaxed",
    rendererDefaults: ["compact_alert"],
  },

  topic_deep_dive_v1: {
    profileId: "topic_deep_dive_v1",
    displayName: "Topic Deep Dive",
    description: "Deep research on a topic, trend, or technology",
    defaultAngles: [
      "narrative_tracking",
      "document_discovery",
      "academic_research",
      "github_ecosystem",
      "world_monitor",
      "deep_research",
    ],
    defaultDepth: "comprehensive",
    freshnessDays: 90,
    latencyBudgetMs: 20000,
    evidenceStrictness: "strict",
    rendererDefaults: ["json_full", "notion_brief", "bibliography"],
  },
};

// Helper: Select angles based on scenario facets
export function selectAngles(
  facets: string[],
  subjects: Array<{ type: string }>,
  angleStrategy: "auto" | "minimal" | "comprehensive" | AngleId[]
): AngleId[] {
  if (Array.isArray(angleStrategy)) {
    return angleStrategy;
  }

  const subjectTypes = new Set(subjects.map((s) => s.type));

  // Score each angle by relevance
  const scored: { angleId: AngleId; score: number }[] = Object.values(ANGLE_REGISTRY).map(
    (meta) => {
      let score = 0;

      // Facet match bonus
      for (const facet of facets) {
        const profile = SCENARIO_PROFILES[facet + "_v1"];
        if (profile?.defaultAngles.includes(meta.angleId)) {
          score += 10;
        }
      }

      // Subject type support
      const hasSupportedSubject = meta.supports.some((s) => subjectTypes.has(s));
      if (hasSupportedSubject) score += 5;

      // Cost tier adjustment
      if (angleStrategy === "minimal" && meta.costTier === "low") score += 3;
      if (angleStrategy === "comprehensive") score += meta.costTier === "high" ? 5 : 2;

      return { angleId: meta.angleId, score };
    }
  );

  scored.sort((a, b) => b.score - a.score);

  // Select based on strategy
  const maxAngles = angleStrategy === "minimal" ? 3 : angleStrategy === "comprehensive" ? 12 : 6;
  return scored.slice(0, maxAngles).map((s) => s.angleId);
}

// Helper: Get freshness threshold for angle
export function getFreshnessThreshold(angleId: AngleId, freshnessDays: number): Date {
  const meta = ANGLE_REGISTRY[angleId];
  if (!meta) {
    // Default to medium sensitivity if angle not found
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - Math.max(1, freshnessDays * 2));
    return threshold;
  }
  const multiplier = {
    low: 3,
    medium: 2,
    high: 1,
    critical: 0.5,
  }[meta.freshnessSensitivity] ?? 2;

  const days = Math.max(1, freshnessDays * multiplier);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  return threshold;
}
