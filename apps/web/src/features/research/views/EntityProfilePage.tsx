/**
 * EntityProfilePage - Landing page for entity hyperlinks from ntfy/digest
 *
 * Route: /entity/:entityName (via #entity/EntityName hash)
 *
 * Features:
 * - Displays full entity context from entityContexts
 * - Shows deep information: funding, people, news, competitors
 * - Falls back to basic info if no enrichment exists
 * - Triggers enrichment job if entity is unknown
 * - Links to dossier if one exists
 */
"use client";

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Building2,
  User,
  Package,
  Cpu,
  Hash,
  Globe,
  Calendar,
  TrendingUp,
  FileText,
  DollarSign,
  ShieldCheck,
  BookOpen,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Users,
  Briefcase,
  MapPin,
  Mail,
  Phone,
  Link as LinkIcon,
  Clock,
  Award,
  Target,
  Newspaper,
  ChevronDown,
  ChevronUp,
  Banknote,
  AlertTriangle,
  CheckCircle,
  Circle,
} from "lucide-react";
import { TrajectorySummaryBand } from "@/features/trajectory/components/TrajectorySummaryBand";
import { TrajectoryTimelinePanel } from "@/features/trajectory/components/TrajectoryTimelinePanel";
import type { TrajectorySummaryData, TrajectoryTimelineItem } from "@/features/trajectory/types";
import { mapEntityProfileTypeToTrajectoryType } from "@/features/trajectory/lib/trajectoryEntity";

interface EntityProfilePageProps {
  entityName: string;
  onBack?: () => void;
}

type EntityType =
  | "company"
  | "person"
  | "product"
  | "technology"
  | "topic"
  | "region"
  | "event"
  | "metric"
  | "document"
  | "fda_approval"
  | "funding_event"
  | "research_paper";

type EntityProfileTab =
  | "overview"
  | "relationships"
  | "ownership"
  | "people"
  | "competitors"
  | "supply-chain"
  | "trace";

const ENTITY_PROFILE_TABS: Array<{
  id: EntityProfileTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "relationships", label: "Relationships", icon: Users },
  { id: "ownership", label: "Ownership", icon: Banknote },
  { id: "people", label: "People", icon: User },
  { id: "competitors", label: "Competitors", icon: Target },
  { id: "supply-chain", label: "Supply Chain", icon: Package },
  { id: "trace", label: "Trace", icon: FileText },
];

const getEntityIcon = (type: EntityType) => {
  switch (type) {
    case "company":
      return Building2;
    case "person":
      return User;
    case "product":
      return Package;
    case "technology":
      return Cpu;
    case "topic":
      return Hash;
    case "region":
      return Globe;
    case "event":
      return Calendar;
    case "metric":
      return TrendingUp;
    case "document":
      return FileText;
    case "fda_approval":
      return ShieldCheck;
    case "funding_event":
      return DollarSign;
    case "research_paper":
      return BookOpen;
    default:
      return Hash;
  }
};

const getEntityColors = (type: EntityType) => {
  switch (type) {
    case "company":
      return {
        bg: "bg-[var(--accent-primary-bg)]",
        text: "text-[var(--accent-primary)]",
        border: "border-[var(--accent-primary)]/25",
        icon: "text-[var(--accent-primary)]",
        accent: "emerald",
      };
    case "person":
      return {
        bg: "bg-[var(--accent-primary-bg)]",
        text: "text-[var(--accent-primary)]",
        border: "border-[var(--accent-primary)]/25",
        icon: "text-[var(--accent-primary)]",
        accent: "indigo",
      };
    case "funding_event":
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        icon: "text-amber-500",
        accent: "amber",
      };
    case "fda_approval":
      return {
        bg: "bg-green-50",
        text: "text-green-700",
        border: "border-green-200",
        icon: "text-green-500",
        accent: "green",
      };
    case "research_paper":
      return {
        bg: "bg-purple-50",
        text: "text-purple-700",
        border: "border-purple-200",
        icon: "text-purple-500",
        accent: "purple",
      };
    default:
      return {
        bg: "bg-surface-secondary",
        text: "text-content",
        border: "border-edge",
        icon: "text-content-secondary",
        accent: "gray",
      };
  }
};

// Collapsible section component
const CollapsibleSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string;
}> = ({ title, icon, defaultOpen = true, children, badge }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-surface rounded-lg border border-edge overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-hover transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <span className="text-content-muted">{icon}</span>
          <h3 className="text-xs font-bold text-content-secondary">
            {title}
          </h3>
          {badge && (
            <span className="px-2 py-0.5 bg-surface-secondary text-content-secondary text-xs font-bold rounded">
              {badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-content-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-content-muted" />
        )}
      </button>
      {isOpen && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
};

// Stat card component
const StatCard: React.FC<{
  label: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
}> = ({ label, value, subValue, icon }) => (
  <div className="rounded-lg border border-edge bg-background p-4">
    <div className="flex items-center gap-2 mb-1">
      {icon && <span className="text-content-muted">{icon}</span>}
      <span className="text-xs font-bold text-content-muted">
        {label}
      </span>
    </div>
    <div className="text-xl font-semibold text-content">{value}</div>
    {subValue && <div className="text-xs text-content-secondary mt-1">{subValue}</div>}
  </div>
);

function deriveEntityKey(entityName: string, entityType: EntityType, canonicalKey?: string | null) {
  if (canonicalKey) return canonicalKey;
  const slug = decodeURIComponent(entityName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${entityType}:${slug}`;
}

export const EntityProfilePage: React.FC<EntityProfilePageProps> = ({
  entityName,
  onBack,
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<EntityProfileTab>("overview");

  // Fetch adaptive profile (LLM-enriched with timeline, relationships, etc.)
  const adaptiveProfile = useQuery(
    api.domains.knowledge.adaptiveEntityQueries.getAdaptiveProfile,
    { entityName }
  );

  // Fetch entity context from the database - try company first
  const companyContext = useQuery(
    api.domains.knowledge.entityContexts.getEntityContext,
    { entityName, entityType: "company" }
  );

  // If not found as company, try person
  const personContext = useQuery(
    api.domains.knowledge.entityContexts.getEntityContext,
    companyContext === null ? { entityName, entityType: "person" } : "skip"
  );

  // Use whichever one we found
  const entityContext = companyContext ?? personContext;

  // Determine entity type from context or heuristics
  const entityType: EntityType = useMemo(() => {
    if (entityContext?.entityType) {
      return entityContext.entityType as EntityType;
    }
    const name = entityName.toLowerCase();
    if (name.includes("fda") || name.includes("approval")) return "fda_approval";
    if (name.includes("series") || name.includes("funding") || name.includes("raised"))
      return "funding_event";
    if (name.includes("paper") || name.includes("arxiv") || name.includes("research"))
      return "research_paper";
    return "company";
  }, [entityName, entityContext?.entityType]);

  const Icon = getEntityIcon(entityType);
  const colors = getEntityColors(entityType);
  const decodedEntityName = decodeURIComponent(entityName);
  const entityKey = deriveEntityKey(entityName, entityType, entityContext?.canonicalKey);

  // Extract nested data
  const crm = entityContext?.crmFields;
  const funding = entityContext?.funding;
  const people = entityContext?.people;
  const freshness = entityContext?.freshness;
  const recentNews = entityContext?.recentNewsItems;
  const personaHooks = entityContext?.personaHooks;

  const relationshipGraph = useQuery(
    api.domains.knowledge.relationshipGraph.getEntityGraph,
    { entityKey, entityName: decodedEntityName, limit: 30 }
  );

  const ownershipSnapshot = useQuery(
    api.domains.knowledge.relationshipGraph.getOwnershipSnapshot,
    { entityKey, entityName: decodedEntityName }
  );

  const supplyChainView = useQuery(
    api.domains.knowledge.relationshipGraph.getSupplyChainView,
    { entityKey, entityName: decodedEntityName }
  );

  const relationshipTimeline = useQuery(
    api.domains.knowledge.relationshipGraph.getRelationshipTimeline,
    { entityKey, entityName: decodedEntityName, limit: 20 }
  );

  const temporalSignals = useQuery(
    api.domains.temporal.queries.getSignalsByEntity,
    { entityKey, limit: 8 }
  );

  const causalChains = useQuery(
    api.domains.temporal.queries.getCausalChainsByEntity,
    { entityKey, limit: 6 }
  );
  const trajectoryEntityType = mapEntityProfileTypeToTrajectoryType(entityType);
  const trajectorySummary = useQuery(api.domains.trajectory.queries.getTrajectorySummary, {
    entityKey,
    entityType: trajectoryEntityType,
    windowDays: 90,
  }) as TrajectorySummaryData | undefined;
  const trajectoryTimeline = useQuery(api.domains.trajectory.queries.getTrajectoryTimeline, {
    entityKey,
    entityType: trajectoryEntityType,
    windowDays: 90,
  }) as { items: TrajectoryTimelineItem[] } | undefined;
  const trajectoryBenchmarks = useQuery(api.domains.trajectory.queries.getBenchmarkTrajectory, {
    entityKey,
    entityType: trajectoryEntityType,
    windowDays: 90,
  }) as
    | Array<{
        benchmarkKey: string;
        benchmarkLabel: string;
        verdict: string;
        summary: string;
      }>
    | undefined;
  const trajectoryInterventions = useQuery(api.domains.trajectory.queries.getInterventionAttribution, {
    entityKey,
    entityType: trajectoryEntityType,
    windowDays: 90,
  }) as
    | Array<{
        _id: string;
        title: string;
        status: string;
        actor: string;
        summary: string;
        observedScoreDelta?: number;
      }>
    | undefined;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate("/");
    }
  };

  const handleViewDossier = (dossierId: string) => {
    navigate(`/documents/${dossierId}`);
  };

  const isLoading =
    companyContext === undefined ||
    (companyContext === null && personContext === undefined);

  // Format funding amount
  const formatFundingAmount = (amount: any): string => {
    if (!amount) return "Undisclosed";
    if (typeof amount === "string") return amount;
    if (typeof amount === "object" && amount.amount) {
      return `$${amount.amount}${amount.unit || "M"}`;
    }
    return `$${amount}`;
  };

  // Calculate data freshness
  const getFreshnessLabel = () => {
    if (!entityContext?.researchedAt) return null;
    const age = Date.now() - entityContext.researchedAt;
    const days = Math.floor(age / (1000 * 60 * 60 * 24));
    if (days === 0) return { label: "Today", color: "text-green-600" };
    if (days === 1) return { label: "Yesterday", color: "text-green-600" };
    if (days < 7) return { label: `${days} days ago`, color: "text-yellow-600" };
    return { label: `${days} days ago`, color: "text-red-600" };
  };

  const freshnessInfo = getFreshnessLabel();

  return (
    <div className="nb-page-shell">
      {/* Header */}
      <header className="bg-surface/90 border-b border-edge sticky top-0 z-10">
        <div className="nb-page-frame-narrow px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleBack}
              className="p-2 rounded-lg text-content-secondary hover:text-content hover:bg-surface-hover transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className="text-xs font-bold text-content-muted">
                Topic Profile
              </p>
              <h1 className="text-xl font-bold text-content">
                {decodeURIComponent(entityName)}
              </h1>
            </div>
          </div>
          {freshnessInfo && (
            <div className="flex items-center gap-2 text-xs">
              <Clock className="w-3.5 h-3.5 text-content-muted" />
              <span className={freshnessInfo.color}>
                Updated {freshnessInfo.label}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="nb-page-inner">
        <main className="nb-page-frame-narrow px-6 py-8">
        {isLoading ? (
          <div className="bg-surface rounded-lg border border-edge p-8">
            <div className="flex items-center gap-4">
              <div className="motion-safe:animate-spin">
                <RefreshCw className="w-6 h-6 text-content-muted" />
              </div>
              <p className="text-content-secondary">Loading profile information...</p>
            </div>
          </div>
        ) : entityContext ? (
          <div className="space-y-6">
            {/* Hero Card */}
            <div className={`bg-surface rounded-lg border ${colors.border} p-8`}>
              <div className="flex items-start gap-6">
                <div
                  className={`w-20 h-20 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}
                >
                  <Icon className={`w-10 h-10 ${colors.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <h2 className="text-3xl font-bold text-content">
                      {decodeURIComponent(entityName)}
                    </h2>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${colors.bg} ${colors.text}`}
                    >
                      {entityType.replace("_", " ")}
                    </span>
                    {crm?.dataQuality && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${crm.dataQuality === "verified"
                            ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                            : crm.dataQuality === "partial"
                              ? "bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400"
                              : "bg-surface-secondary text-content"
                          }`}
                      >
                        {crm.dataQuality}
                      </span>
                    )}
                  </div>

                  {entityContext.summary ? (
                    <p className="text-content leading-relaxed text-lg">
                      {entityContext.summary}
                    </p>
                  ) : (
                    <p className="text-content-muted italic">
                      No summary available yet. Enrichment may be in progress.
                    </p>
                  )}

                  {/* Quick contact info */}
                  {(crm?.website || crm?.hqLocation) && (
                    <div className="flex flex-wrap gap-4 mt-4 text-sm text-content-secondary">
                      {crm?.website && (
                        <a
                          href={crm.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 hover:text-[var(--accent-primary)] transition-colors"
                        >
                          <LinkIcon className="w-4 h-4" />
                          {crm.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                      {crm?.hqLocation && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-4 h-4" />
                          {crm.hqLocation}
                        </span>
                      )}
                      {crm?.foundingYear && (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" />
                          Founded {crm.foundingYear}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Stats Row */}
            {(funding || crm?.totalFunding) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Funding Stage"
                  value={funding?.stage || crm?.fundingStage || "Unknown"}
                  icon={<TrendingUp className="w-4 h-4" />}
                />
                <StatCard
                  label="Total Raised"
                  value={formatFundingAmount(funding?.totalRaised || crm?.totalFunding)}
                  subValue={funding?.latestRound?.date}
                  icon={<Banknote className="w-4 h-4" />}
                />
                {crm?.industry && (
                  <StatCard
                    label="Industry"
                    value={crm.industry}
                    icon={<Building2 className="w-4 h-4" />}
                  />
                )}
                {crm?.companyType && (
                  <StatCard
                    label="Company Type"
                    value={crm.companyType}
                    icon={<Briefcase className="w-4 h-4" />}
                  />
                )}
              </div>
            )}

            <div className="rounded-2xl border border-edge bg-surface p-3">
              <div className="flex flex-wrap gap-2">
                {ENTITY_PROFILE_TABS.map((tab) => {
                  const TabIcon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                        isActive
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                          : "border-edge bg-background text-content-secondary hover:bg-surface-hover"
                      }`}
                    >
                      <TabIcon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Key Facts */}
            <div className={activeTab === "overview" ? "space-y-6" : "hidden"}>
            {entityContext.keyFacts && entityContext.keyFacts.length > 0 && (
              <CollapsibleSection
                title="Key Facts"
                icon={<Target className="w-4 h-4" />}
                badge={`${entityContext.keyFacts.length} facts`}
              >
                <ul className="space-y-3">
                  {entityContext.keyFacts.map((fact: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-3">
                      <CheckCircle className={`mt-0.5 w-4 h-4 flex-shrink-0 ${colors.icon}`} />
                      <span className="text-content">{fact}</span>
                    </li>
                  ))}
                </ul>
              </CollapsibleSection>
            )}

            {/* Adaptive Profile: Executive Summary */}
            {adaptiveProfile?.executiveSummary && (
              <CollapsibleSection
                title="Executive Summary"
                icon={<Sparkles className="w-4 h-4" />}
                badge="AI Enriched"
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-surface-secondary rounded-lg">
                      <p className="text-xs font-bold text-content-muted mb-2">
                        Known For
                      </p>
                      <p className="text-content">{adaptiveProfile.executiveSummary.whatTheyreKnownFor}</p>
                    </div>
                    <div className="p-4 bg-surface-secondary rounded-lg">
                      <p className="text-xs font-bold text-content-muted mb-2">
                        Current Focus
                      </p>
                      <p className="text-content">{adaptiveProfile.executiveSummary.currentFocus}</p>
                    </div>
                  </div>
                  {adaptiveProfile.executiveSummary.keyInsight && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs font-bold text-amber-700 mb-2">
                        Key Insight
                      </p>
                      <p className="text-amber-900 leading-relaxed">
                        {adaptiveProfile.executiveSummary.keyInsight}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Adaptive Profile: Timeline */}
            {adaptiveProfile?.timeline && adaptiveProfile.timeline.length > 0 && (
              <CollapsibleSection
                title="Timeline"
                icon={<Clock className="w-4 h-4" />}
                badge={`${adaptiveProfile.timeline.length} events`}
              >
                <div className="relative pl-4 border-l-2 border-edge space-y-4">
                  {adaptiveProfile.timeline.map((event: any, idx: number) => (
                    <div key={event.id || idx} className="relative">
                      <div className="absolute -left-[21px] w-4 h-4 rounded-full bg-surface border-2 border-edge" />
                      <div className="pl-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-content-secondary">{event.date}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${event.significance === "high"
                              ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                              : event.significance === "medium"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-surface-secondary text-content"
                            }`}>
                            {event.category}
                          </span>
                        </div>
                        <p className="font-medium text-content">{event.title}</p>
                        {event.description && (
                          <p className="text-sm text-content-secondary mt-1">{event.description}</p>
                        )}
                        {event.relatedEntities && event.relatedEntities.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {event.relatedEntities.map((e: any, eIdx: number) => (
                              <span key={eIdx} className="px-2 py-0.5 bg-surface-secondary text-content-secondary text-xs rounded">
                                {e.name} ({e.role})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Adaptive Profile: Relationships */}
            {adaptiveProfile?.relationships && adaptiveProfile.relationships.length > 0 && (
              <CollapsibleSection
                title="Network & Relationships"
                icon={<Users className="w-4 h-4" />}
                badge={`${adaptiveProfile.relationships.length} connections`}
              >
                <div className="space-y-4">
                  {/* Circle of Influence */}
                  {adaptiveProfile.circleOfInfluence && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="p-4 bg-[var(--accent-primary-bg)] rounded-lg">
                        <p className="text-xs font-bold text-[var(--accent-primary)] mb-2">
                          Inner Circle
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(adaptiveProfile.circleOfInfluence.tier1 || []).slice(0, 5).map((name: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-surface text-[var(--accent-primary)] text-xs rounded border border-[var(--accent-primary)]/20">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="p-4 bg-surface-secondary rounded-lg border border-[var(--accent-primary)]/15">
                        <p className="text-xs font-bold text-content-secondary mb-2">
                          Extended Network
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(adaptiveProfile.circleOfInfluence.tier2 || []).slice(0, 5).map((name: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] text-xs rounded">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="p-4 bg-surface-secondary rounded-lg">
                        <p className="text-xs font-bold text-content-secondary mb-2">
                          Broader Ecosystem
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(adaptiveProfile.circleOfInfluence.tier3 || []).slice(0, 5).map((name: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-surface-secondary text-content-secondary text-xs rounded">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Relationships List */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {adaptiveProfile.relationships.slice(0, 8).map((rel: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-lg border border-edge bg-background"
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${rel.strength === "strong"
                            ? "bg-[var(--accent-primary-bg)]"
                            : rel.strength === "moderate"
                              ? "bg-surface-secondary"
                              : "bg-surface-secondary"
                          }`}>
                          <Users className={`w-5 h-5 ${rel.strength === "strong"
                              ? "text-[var(--accent-primary)]"
                              : rel.strength === "moderate"
                                ? "text-content-secondary"
                                : "text-content-secondary"
                            }`} />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-content">{rel.entityName}</p>
                          <p className="text-xs text-content-secondary">
                            {rel.relationshipType} ({rel.entityType})
                          </p>
                          {rel.context && (
                            <p className="text-xs text-content-secondary mt-1 line-clamp-2">{rel.context}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Adaptive Profile: Dynamic Sections */}
            {adaptiveProfile?.sections && adaptiveProfile.sections.length > 0 && (
              <>
                {adaptiveProfile.sections.map((section: any) => (
                  <CollapsibleSection
                    key={section.id}
                    title={section.title}
                    icon={<Sparkles className="w-4 h-4" />}
                    defaultOpen={section.priority <= 2}
                  >
                    <div className="text-content">
                      {section.content?.type === "narrative" && section.content.data?.text && (
                        <p className="leading-relaxed">{section.content.data.text}</p>
                      )}
                      {section.content?.type === "list" && section.content.data?.items && (
                        <ul className="space-y-2">
                          {section.content.data.items.map((item: any, idx: number) => (
                            <li key={idx} className="flex items-start gap-3">
                              <Circle className="mt-1.5 w-2 h-2 text-content-muted fill-current flex-shrink-0" />
                              <div>
                                <p className="font-medium">{item.title}</p>
                                {item.description && (
                                  <p className="text-sm text-content-secondary">{item.description}</p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {section.content?.keyTakeaway && (
                        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-sm text-amber-900">{section.content.keyTakeaway}</p>
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>
                ))}
              </>
            )}

            {/* Funding Details */}
            {funding && (
              <CollapsibleSection
                title="Funding Details"
                icon={<DollarSign className="w-4 h-4" />}
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {funding.stage && (
                      <StatCard label="Stage" value={funding.stage} />
                    )}
                    {funding.totalRaised && (
                      <StatCard
                        label="Total Raised"
                        value={formatFundingAmount(funding.totalRaised)}
                      />
                    )}
                    {funding.latestRound && (
                      <StatCard
                        label="Latest Round"
                        value={formatFundingAmount(funding.latestRound.amount)}
                        subValue={funding.latestRound.date}
                      />
                    )}
                  </div>

                  {/* Investors */}
                  {(funding.investors || crm?.investors) && (
                    <div>
                      <p className="text-xs font-bold text-content-muted mb-2">
                        Investors
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(funding.investors || crm?.investors || []).map(
                          (investor: string, idx: number) => (
                            <span
                              key={idx}
                              className="px-3 py-1.5 bg-surface-secondary text-content-secondary text-sm rounded-full"
                            >
                              {investor}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Banker Takeaway */}
                  {funding.bankerTakeaway && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs font-bold text-amber-700 mb-2">
                        Banker Takeaway
                      </p>
                      <p className="text-amber-900 leading-relaxed">
                        {funding.bankerTakeaway}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Key People */}
            {(people || crm?.keyPeople) && (
              <CollapsibleSection
                title="Key People"
                icon={<Users className="w-4 h-4" />}
                badge={`${(people?.length || crm?.keyPeople?.length || 0)} people`}
              >
                <div className="space-y-4">
                  {/* Founders */}
                  {crm?.founders && crm.founders.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-content-muted mb-2">
                        Founders
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {crm.founders.map((founder: string, idx: number) => (
                          <span
                            key={idx}
                            className="px-3 py-1.5 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] text-sm rounded-full font-medium"
                          >
                            {founder}
                          </span>
                        ))}
                      </div>
                      {crm.foundersBackground && (
                        <p className="mt-2 text-sm text-content-secondary">
                          {crm.foundersBackground}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Key People List */}
                  {(crm?.keyPeople || people) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(crm?.keyPeople || people || []).map(
                        (person: { name: string; title: string }, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 p-3 rounded-lg border border-edge bg-background"
                          >
                            <div className="w-10 h-10 rounded-full bg-[var(--accent-primary-bg)] flex items-center justify-center">
                              <User className="w-5 h-5 text-[var(--accent-primary)]" />
                            </div>
                            <div>
                              <p className="font-medium text-content">{person.name}</p>
                              <p className="text-xs text-content-secondary">{person.title}</p>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Competitors */}
            {crm?.competitors && crm.competitors.length > 0 && (
              <CollapsibleSection
                title="Competitive Landscape"
                icon={<Target className="w-4 h-4" />}
                defaultOpen={false}
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {crm.competitors.map((competitor: string, idx: number) => (
                      <span
                        key={idx}
                        className="px-3 py-1.5 bg-red-50 text-red-700 text-sm rounded-full"
                      >
                        {competitor}
                      </span>
                    ))}
                  </div>
                  {crm.competitorAnalysis && (
                    <p className="text-sm text-content-secondary leading-relaxed">
                      {crm.competitorAnalysis}
                    </p>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* News Timeline */}
            {(recentNews || crm?.newsTimeline) && (
              <CollapsibleSection
                title="Recent News"
                icon={<Newspaper className="w-4 h-4" />}
                badge={`${(recentNews?.length || crm?.newsTimeline?.length || 0)} item${(recentNews?.length || crm?.newsTimeline?.length || 0) !== 1 ? 's' : ''}`}
                defaultOpen={false}
              >
                <div className="space-y-3">
                  {(recentNews || crm?.newsTimeline || []).map(
                    (
                      item: { date?: string; headline: string; source?: string; title?: string },
                      idx: number
                    ) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-lg border border-edge hover:bg-surface-hover transition-colors"
                      >
                        <div className="mt-1">
                          <Circle className="w-2 h-2 text-gray-300 fill-current" />
                        </div>
                        <div className="flex-1">
                          <p className="text-content">{item.headline || item.title}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-content-secondary">
                            {item.date && <span>{item.date}</span>}
                            {item.source && (
                              <>
                                <span>•</span>
                                <span>{item.source}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* FDA Approval Status (if applicable) */}
            {crm?.fdaApprovalStatus && (
              <CollapsibleSection
                title="FDA Status"
                icon={<ShieldCheck className="w-4 h-4" />}
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1.5 rounded-full text-sm font-medium ${crm.fdaApprovalStatus.toLowerCase().includes("approved")
                          ? "bg-green-100 text-green-700"
                          : crm.fdaApprovalStatus.toLowerCase().includes("pending")
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-surface-secondary text-content"
                        }`}
                    >
                      {crm.fdaApprovalStatus}
                    </span>
                  </div>
                  {crm.fdaTimeline && (
                    <p className="text-sm text-content-secondary">{crm.fdaTimeline}</p>
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Persona Hooks (for advanced users) */}
            {personaHooks && Object.keys(personaHooks).length > 0 && (
              <CollapsibleSection
                title="Persona Insights"
                icon={<Briefcase className="w-4 h-4" />}
                defaultOpen={false}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(personaHooks).map(([persona, hook]: [string, any]) => (
                    <div
                      key={persona}
                      className="p-3 rounded-lg border border-edge bg-background"
                    >
                      <p className="text-xs font-bold text-content-muted mb-1">
                        {persona.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm text-content">{hook}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Sources */}
            {entityContext.sources && entityContext.sources.length > 0 && (
              <CollapsibleSection
                title="Sources"
                icon={<ExternalLink className="w-4 h-4" />}
                badge={`${entityContext.sources.length} sources`}
                defaultOpen={false}
              >
                <div className="space-y-2">
                  {entityContext.sources.map((source: any, idx: number) => (
                    <a
                      key={idx}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 p-3 rounded-lg border border-edge bg-background hover:bg-surface transition-colors group"
                    >
                      <ExternalLink className="w-4 h-4 text-content-muted mt-0.5 flex-shrink-0 group-hover:text-[var(--accent-primary)]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-content group-hover:text-content-secondary transition-colors">
                          {source.name}
                        </p>
                        {source.snippet && (
                          <p className="text-xs text-content-secondary mt-1 line-clamp-2">
                            {source.snippet}
                          </p>
                        )}
                      </div>
                      {source.credibility && (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold flex-shrink-0 ${source.credibility === "high"
                              ? "bg-green-100 text-green-700"
                              : source.credibility === "medium"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-surface-secondary text-content"
                            }`}
                        >
                          {source.credibility}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Actions */}
            </div>
            {activeTab === "relationships" && (
              <div className="space-y-6">
                <CollapsibleSection
                  title="Relationship Graph"
                  icon={<Users className="w-4 h-4" />}
                  badge={`${relationshipGraph?.edges?.length ?? 0} edges`}
                >
                  <div className="space-y-3">
                    {(relationshipGraph?.edges ?? []).length > 0 ? (
                      (relationshipGraph?.edges ?? []).map((edge: any) => (
                        <div
                          key={edge.edgeKey}
                          className="rounded-lg border border-edge bg-background p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-content">{edge.relatedEntityName}</span>
                            <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-content-secondary">
                              {edge.relationshipType.replace(/_/g, " ")}
                            </span>
                            <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-content-secondary">
                              {Math.round((edge.confidence ?? 0) * 100)}% confidence
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/execution-trace?entity=${encodeURIComponent(entityKey)}&edge=${encodeURIComponent(edge.edgeKey)}`)}
                              className="rounded-full border border-edge px-3 py-1 text-xs text-content-secondary transition hover:bg-surface-hover"
                            >
                              Open trace context
                            </button>
                            {edge.sourceRefs?.[0]?.href ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/execution-trace?entity=${encodeURIComponent(entityKey)}&edge=${encodeURIComponent(edge.edgeKey)}&evidence=${encodeURIComponent(edge.sourceRefs[0].href)}`)}
                                className="rounded-full border border-edge px-3 py-1 text-xs text-content-secondary transition hover:bg-surface-hover"
                              >
                                Evidence deep-link
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">
                        No relationship edges stored yet for this entity.
                      </p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {activeTab === "ownership" && (
              <div className="grid gap-6 lg:grid-cols-2">
                <CollapsibleSection
                  title="Investors & Holders"
                  icon={<Banknote className="w-4 h-4" />}
                  badge={`${(ownershipSnapshot?.investors?.length ?? 0) + (ownershipSnapshot?.holders?.length ?? 0)} entries`}
                >
                  <div className="space-y-3">
                    {[...(ownershipSnapshot?.investors ?? []), ...(ownershipSnapshot?.holders ?? [])].length > 0 ? (
                      [...(ownershipSnapshot?.investors ?? []), ...(ownershipSnapshot?.holders ?? [])].map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-1 text-xs text-content-secondary">
                            {edge.relationshipType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No holders or investors surfaced yet.</p>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Board & Leadership"
                  icon={<Briefcase className="w-4 h-4" />}
                  badge={`${(ownershipSnapshot?.board?.length ?? 0) + (ownershipSnapshot?.executives?.length ?? 0) + (ownershipSnapshot?.founders?.length ?? 0)} people`}
                >
                  <div className="space-y-3">
                    {[
                      ...(ownershipSnapshot?.board ?? []),
                      ...(ownershipSnapshot?.executives ?? []),
                      ...(ownershipSnapshot?.founders ?? []),
                    ].length > 0 ? (
                      [
                        ...(ownershipSnapshot?.board ?? []),
                        ...(ownershipSnapshot?.executives ?? []),
                        ...(ownershipSnapshot?.founders ?? []),
                      ].map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-1 text-xs text-content-secondary">
                            {edge.relationshipType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No board or executive links surfaced yet.</p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {activeTab === "people" && (
              <div className="space-y-6">
                <CollapsibleSection
                  title="People Network"
                  icon={<Users className="w-4 h-4" />}
                  badge={`${(ownershipSnapshot?.board?.length ?? 0) + (ownershipSnapshot?.executives?.length ?? 0) + (ownershipSnapshot?.founders?.length ?? 0)} connections`}
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {[
                      ...(ownershipSnapshot?.board ?? []),
                      ...(ownershipSnapshot?.executives ?? []),
                      ...(ownershipSnapshot?.founders ?? []),
                    ].length > 0 ? (
                      [
                        ...(ownershipSnapshot?.board ?? []),
                        ...(ownershipSnapshot?.executives ?? []),
                        ...(ownershipSnapshot?.founders ?? []),
                      ].map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-1 text-xs text-content-secondary">
                            {edge.relationshipType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No structured people graph yet.</p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {activeTab === "competitors" && (
              <div className="space-y-6">
                <CollapsibleSection
                  title="Competitive Graph"
                  icon={<Target className="w-4 h-4" />}
                  badge={`${supplyChainView?.competitors?.length ?? crm?.competitors?.length ?? 0} competitors`}
                >
                  <div className="space-y-3">
                    {(supplyChainView?.competitors ?? []).length > 0 ? (
                      (supplyChainView?.competitors ?? []).map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : crm?.competitors?.length > 0 ? (
                      crm.competitors.map((competitor: string, idx: number) => (
                        <div key={`${competitor}-${idx}`} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{competitor}</div>
                          {crm.competitorAnalysis && (
                            <p className="mt-2 text-sm text-content-secondary">{crm.competitorAnalysis}</p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No competitor graph surfaced yet.</p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {activeTab === "supply-chain" && (
              <div className="grid gap-6 lg:grid-cols-2">
                <CollapsibleSection
                  title="Suppliers & Customers"
                  icon={<Package className="w-4 h-4" />}
                  badge={`${(supplyChainView?.suppliers?.length ?? 0) + (supplyChainView?.customers?.length ?? 0)} links`}
                >
                  <div className="space-y-3">
                    {[...(supplyChainView?.suppliers ?? []), ...(supplyChainView?.customers ?? [])].length > 0 ? (
                      [...(supplyChainView?.suppliers ?? []), ...(supplyChainView?.customers ?? [])].map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-1 text-xs text-content-secondary">
                            {edge.relationshipType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No supplier or customer links surfaced yet.</p>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Partners & Subsidiaries"
                  icon={<Globe className="w-4 h-4" />}
                  badge={`${(supplyChainView?.partners?.length ?? 0) + (supplyChainView?.subsidiaries?.length ?? 0)} links`}
                >
                  <div className="space-y-3">
                    {[...(supplyChainView?.partners ?? []), ...(supplyChainView?.subsidiaries ?? [])].length > 0 ? (
                      [...(supplyChainView?.partners ?? []), ...(supplyChainView?.subsidiaries ?? [])].map((edge: any) => (
                        <div key={edge.edgeKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="font-medium text-content">{edge.relatedEntityName}</div>
                          <p className="mt-1 text-xs text-content-secondary">
                            {edge.relationshipType.replace(/_/g, " ")}
                          </p>
                          <p className="mt-2 text-sm text-content-secondary">{edge.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No partner or subsidiary links surfaced yet.</p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            )}

            {activeTab === "trace" && (
              <div className="space-y-6">
                <TrajectorySummaryBand
                  summary={trajectorySummary ?? null}
                  loading={trajectorySummary === undefined}
                  emptyLabel="No trajectory summary exists yet for this entity. Temporal signals and causal chains can still be explored below."
                />

                <CollapsibleSection
                  title="Relationship Timeline"
                  icon={<Clock className="w-4 h-4" />}
                  badge={`${relationshipTimeline?.items?.length ?? 0} items`}
                >
                  <div className="space-y-3">
                    {(relationshipTimeline?.items ?? []).length > 0 ? (
                      (relationshipTimeline?.items ?? []).map((item: any) => (
                        <div key={item.timelineKey} className="rounded-lg border border-edge bg-background p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-content">{item.title}</div>
                            <div className="text-xs text-content-secondary">
                              {item.time ? new Date(item.time).toLocaleDateString() : "Undated"}
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-content-secondary">{item.summary}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-content-secondary">No relationship timeline yet.</p>
                    )}
                  </div>
                </CollapsibleSection>

                <div className="grid gap-6 lg:grid-cols-2">
                  <TrajectoryTimelinePanel
                    items={trajectoryTimeline?.items ?? []}
                    emptyLabel="No trajectory chronology exists yet for this entity."
                  />

                  <CollapsibleSection
                    title="Temporal Signals"
                    icon={<TrendingUp className="w-4 h-4" />}
                    badge={`${temporalSignals?.length ?? 0} signals`}
                  >
                    <div className="space-y-3">
                      {(temporalSignals ?? []).length > 0 ? (
                        temporalSignals?.map((signal: any) => (
                          <div key={signal._id} className="rounded-lg border border-edge bg-background p-4">
                            <div className="font-medium text-content">{signal.summary}</div>
                            <p className="mt-1 text-xs text-content-secondary">
                              {signal.signalType} · {signal.status}
                            </p>
                            <p className="mt-2 text-sm text-content-secondary">{signal.plainEnglish}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-content-secondary">No temporal signals linked to this entity yet.</p>
                      )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Causal Chains"
                    icon={<AlertTriangle className="w-4 h-4" />}
                    badge={`${causalChains?.length ?? 0} chains`}
                  >
                    <div className="space-y-3">
                      {(causalChains ?? []).length > 0 ? (
                        causalChains?.map((chain: any) => (
                          <div key={chain._id} className="rounded-lg border border-edge bg-background p-4">
                            <div className="font-medium text-content">{chain.title}</div>
                            <p className="mt-1 text-xs text-content-secondary">{chain.status}</p>
                            <p className="mt-2 text-sm text-content-secondary">{chain.summary}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-content-secondary">No causal chains linked to this entity yet.</p>
                      )}
                    </div>
                  </CollapsibleSection>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <CollapsibleSection
                    title="Intervention Attribution"
                    icon={<Sparkles className="w-4 h-4" />}
                    badge={`${trajectoryInterventions?.length ?? 0} interventions`}
                  >
                    <div className="space-y-3">
                      {(trajectoryInterventions ?? []).length > 0 ? (
                        trajectoryInterventions?.map((intervention) => (
                          <div key={intervention._id} className="rounded-lg border border-edge bg-background p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-medium text-content">{intervention.title}</div>
                              <div className="text-xs text-content-secondary">{intervention.status}</div>
                            </div>
                            <p className="mt-2 text-sm text-content-secondary">{intervention.summary}</p>
                            <div className="mt-2 text-xs text-content-muted">
                              {intervention.actor}
                              {typeof intervention.observedScoreDelta === "number"
                                ? ` · uplift ${Math.round(intervention.observedScoreDelta * 100)}%`
                                : ""}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-content-secondary">No interventions have been logged for this entity yet.</p>
                      )}
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Benchmark Trajectory"
                    icon={<Award className="w-4 h-4" />}
                    badge={`${trajectoryBenchmarks?.length ?? 0} runs`}
                  >
                    <div className="space-y-3">
                      {(trajectoryBenchmarks ?? []).length > 0 ? (
                        trajectoryBenchmarks?.map((benchmark) => (
                          <div key={benchmark.benchmarkKey} className="rounded-lg border border-edge bg-background p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-medium text-content">{benchmark.benchmarkLabel}</div>
                              <div className="text-xs text-content-secondary">{benchmark.verdict}</div>
                            </div>
                            <p className="mt-2 text-sm text-content-secondary">{benchmark.summary}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-content-secondary">No benchmark-linked trajectory rows exist for this entity yet.</p>
                      )}
                    </div>
                  </CollapsibleSection>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/execution-trace?entity=${encodeURIComponent(entityKey)}`)}
                    className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-primary-hover)]"
                  >
                    Open Execution Trace
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/research/world-monitor")}
                    className="rounded-lg border border-edge bg-background px-4 py-2 text-sm font-semibold text-content-secondary transition-colors hover:bg-surface-hover"
                  >
                    Open World Monitor
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-4">
              {entityContext.dossierId ? (
                <button
                  type="button"
                  onClick={() => handleViewDossier(entityContext.dossierId)}
                  className="flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-white rounded-lg font-semibold hover:bg-[var(--accent-primary-hover)] transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  View Full Report
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("entity:createDossier", {
                        detail: {
                          entity: {
                            name: entityName,
                            type: entityType,
                          },
                        },
                      })
                    );
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-white rounded-lg font-semibold hover:bg-[var(--accent-primary-hover)] transition-colors"
                >
                  <Sparkles className="w-5 h-5" />
                  Create Report
                </button>
              )}

              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-2 px-6 py-3 bg-surface border border-edge text-content-secondary rounded-lg font-semibold hover:bg-surface-hover transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Digest
              </button>
            </div>
          </div>
        ) : (
          /* No Data State */
          <div className="bg-surface rounded-lg border border-edge p-12 text-center">
            <Sparkles className="w-16 h-16 text-content-muted mx-auto mb-6" />
            <h3 className="text-2xl font-bold text-content mb-3">
              Not Yet Researched
            </h3>
            <p className="text-content-secondary mb-8 max-w-md mx-auto">
              We don't have detailed information about "{decodeURIComponent(entityName)}" yet.
              Create a report to start researching this topic.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("entity:createDossier", {
                      detail: {
                        entity: {
                          name: entityName,
                          type: entityType,
                        },
                      },
                    })
                  );
                }}
                className="flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-white rounded-lg font-semibold hover:bg-[var(--accent-primary-hover)] transition-colors"
              >
                <Sparkles className="w-5 h-5" />
                Create Report
              </button>
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-2 px-6 py-3 bg-surface border border-edge text-content-secondary rounded-lg font-semibold hover:bg-surface-hover transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Digest
              </button>
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
};

export default EntityProfilePage;
