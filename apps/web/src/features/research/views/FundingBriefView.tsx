/**
 * FundingBriefView - Display all funding events with filters
 *
 * Public page for viewing the complete funding brief referenced in LinkedIn posts.
 * URL: #funding or /funding-brief
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  DollarSign,
  TrendingUp,
  Building2,
  Calendar,
  ExternalLink,
  Filter,
  ChevronDown,
  Briefcase,
  MapPin,
  Users,
  CheckCircle,
  AlertCircle,
  Clock,
  FileDown,
  Loader2,
  FolderPlus,
  Check,
  Sparkles,
} from "lucide-react";
import { usePDFGenerator } from "../../../lib/pdf/usePDFGenerator";
import type { FundingDealRow } from "../../../lib/pdf/types";

// Round type display names
const ROUND_TYPE_LABELS: Record<string, string> = {
  "pre-seed": "Pre-Seed",
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
  "series-c": "Series C",
  "series-d-plus": "Series D+",
  growth: "Growth",
  debt: "Debt",
  unknown: "Round undisclosed",
};

// Sector category colors — subtle left-border accent + neutral surface
const SECTOR_COLORS: Record<string, { bg: string; text: string; border?: string }> = {
  healthcare: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-red-400/60" },
  fintech: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-green-400/60" },
  ai_ml: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-purple-400/60" },
  enterprise: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-blue-400/60" },
  consumer: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-orange-400/60" },
  deeptech: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-indigo-400/60" },
  climate: { bg: "bg-surface-secondary", text: "text-content-secondary", border: "border-l-2 border-l-teal-400/60" },
  technology: { bg: "bg-surface-secondary", text: "text-content-secondary" },
  other: { bg: "bg-surface-secondary", text: "text-content-secondary" },
};

const GENERIC_VALUE_RE = /^(unknown(\s+company)?|undisclosed|n\/a|na|null|none|tbd)$/i;
const UNKNOWN_PREFIX_RE = /^unknown(\s+company)?\b/i;

function isGenericPlaceholder(value?: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const normalized = trimmed.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  return GENERIC_VALUE_RE.test(normalized) || UNKNOWN_PREFIX_RE.test(normalized);
}

function toDisplayLabel(value: string | undefined | null, fallback = "Undisclosed"): string {
  if (isGenericPlaceholder(value)) return fallback;
  return value!.trim();
}

function sanitizeNameList(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && !isGenericPlaceholder(value));
}

// Verification status badges
function VerificationBadge({
  status,
}: {
  status: string;
}) {
  const config = {
    verified: {
      icon: CheckCircle,
      color: "text-content-secondary",
      bg: "bg-surface-secondary",
      label: "Verified",
    },
    pending: {
      icon: Clock,
      color: "text-content-secondary",
      bg: "bg-surface-secondary",
      label: "Pending",
    },
    unverified: {
      icon: AlertCircle,
      color: "text-content-secondary",
      bg: "bg-surface-secondary",
      label: "Unverified",
    },
  }[status] || {
    icon: AlertCircle,
    color: "text-content-secondary",
    bg: "bg-surface-secondary",
    label: status,
  };

  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${config.bg} ${config.color}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

// Individual funding card
function FundingCard({
  event,
}: {
  event: {
    id: string;
    companyName: string;
    roundType: string;
    amountRaw?: string;
    amountUsd?: number;
    leadInvestors?: string[];
    coInvestors?: string[];
    sector?: string;
    location?: string;
    description?: string;
    confidence?: number;
    verificationStatus?: string;
    sourceUrls?: string[];
    sourceNames?: string[];
    announcedAt?: number;
    entityData?: {
      name: string;
      type: string;
      sector?: string;
    } | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const displayCompanyName = toDisplayLabel(event.companyName, "Undisclosed company");
  const displayRoundLabel = ROUND_TYPE_LABELS[event.roundType] || toDisplayLabel(event.roundType, "Round undisclosed");
  const displaySector = isGenericPlaceholder(event.sector) ? null : event.sector;
  const displayLocation = isGenericPlaceholder(event.location) ? null : event.location;
  const displayLeadInvestors = sanitizeNameList(event.leadInvestors);
  const displayCoInvestors = sanitizeNameList(event.coInvestors);

  const sectorKey = displaySector?.toLowerCase().includes("health")
    ? "healthcare"
    : displaySector?.toLowerCase().includes("fintech")
      ? "fintech"
      : displaySector?.toLowerCase().includes("ai")
        ? "ai_ml"
        : displaySector?.toLowerCase().includes("enterprise")
          ? "enterprise"
          : displaySector?.toLowerCase().includes("consumer")
            ? "consumer"
            : displaySector?.toLowerCase().includes("deep")
              ? "deeptech"
              : displaySector?.toLowerCase().includes("climate")
                ? "climate"
                : "technology";

  const sectorColor = SECTOR_COLORS[sectorKey] || SECTOR_COLORS.other;

  return (
    <div className="border border-edge rounded-lg p-4 bg-surface transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-content truncate">
              {displayCompanyName}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
              {displayRoundLabel}
            </span>
            {event.verificationStatus && (
              <VerificationBadge status={event.verificationStatus} />
            )}
          </div>

          {/* Amount */}
          {event.amountRaw && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <DollarSign className="w-4 h-4 text-content-secondary" />
              <span className="font-bold text-content text-lg">
                {event.amountRaw}
              </span>
            </div>
          )}
        </div>

        {/* Confidence Score */}
        {event.confidence !== undefined && (
          <div className="text-right">
            <div className="text-xs text-content-secondary">Confidence</div>
            <div
              className={`text-sm font-semibold ${
                event.confidence >= 0.8
                  ? "text-content"
                  : event.confidence >= 0.6
                    ? "text-content-secondary"
                    : "text-content-muted"
              }`}
            >
              {Math.round(event.confidence * 100)}%
            </div>
          </div>
        )}
      </div>

      {/* Metadata Row */}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-content-secondary">
        {displaySector && (
          <span className={`px-2 py-0.5 rounded-full text-xs ${sectorColor.bg} ${sectorColor.text} ${sectorColor.border || ""}`}>
            {displaySector}
          </span>
        )}
        {displayLocation && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {displayLocation}
          </span>
        )}
        {event.announcedAt && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(event.announcedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
      </div>

      {/* Lead Investors */}
      {displayLeadInvestors.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-xs text-content-secondary mb-1">
            <Users className="w-3.5 h-3.5" />
            Lead Investors
          </div>
          <div className="flex flex-wrap gap-1.5">
            {displayLeadInvestors.map((investor, idx) => (
              <span
                key={idx}
                className="text-xs px-2 py-0.5 rounded bg-surface-secondary text-content"
              >
                {investor}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Expandable Details */}
      {(event.description || displayCoInvestors.length > 0 || (event.sourceUrls && event.sourceUrls.length > 0)) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-xs text-accent hover:text-accent/80"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-edge space-y-3">
          {/* Description */}
          {event.description && (
            <p className="text-sm text-content-secondary">{event.description}</p>
          )}

          {/* Co-Investors */}
          {displayCoInvestors.length > 0 && (
            <div>
              <div className="text-xs text-content-secondary mb-1">Co-Investors</div>
              <div className="flex flex-wrap gap-1.5">
                {displayCoInvestors.map((investor, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 rounded bg-surface-secondary text-content-secondary"
                  >
                    {investor}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {event.sourceUrls && event.sourceUrls.length > 0 && (
            <div>
              <div className="text-xs text-content-secondary mb-1">
                Sources ({event.sourceUrls.length})
              </div>
              <div className="flex flex-col gap-1">
                {event.sourceUrls.slice(0, 3).map((url, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline truncate flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {event.sourceNames?.[idx] || url}
                  </a>
                ))}
                {event.sourceUrls.length > 3 && (
                  <span className="text-xs text-content-secondary">
                    +{event.sourceUrls.length - 3} more sources
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Stats summary card
function StatsSummary({
  stats,
}: {
  stats: {
    total: number;
    totalAmountUsd: number;
    byRoundType: Record<string, number>;
    lookbackDays: number;
  };
}) {
  const formatCurrency = (amount: number) => {
    if (amount >= 1_000_000_000) {
      return `$${(amount / 1_000_000_000).toFixed(1)}B`;
    }
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(1)}M`;
    }
    if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(0)}K`;
    }
    return `$${amount}`;
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div className="bg-surface-secondary rounded-lg p-4">
        <div className="flex items-center gap-2 text-content-secondary text-sm mb-1">
          <Building2 className="w-4 h-4" />
          Total Deals
        </div>
        <div className="text-2xl font-bold text-content">{stats.total.toLocaleString()}</div>
        <div className="text-xs text-content-secondary">Last {stats.lookbackDays.toLocaleString()} days</div>
      </div>

      <div className="bg-surface-secondary rounded-lg p-4">
        <div className="flex items-center gap-2 text-content-secondary text-sm mb-1">
          <DollarSign className="w-4 h-4" />
          Total Raised
        </div>
        <div className="text-2xl font-bold text-content">
          {formatCurrency(stats.totalAmountUsd)}
        </div>
        <div className="text-xs text-content-secondary">Disclosed amounts</div>
      </div>

      <div className="bg-surface-secondary rounded-lg p-4">
        <div className="flex items-center gap-2 text-content-secondary text-sm mb-1">
          <TrendingUp className="w-4 h-4" />
          Seed/Pre-Seed
        </div>
        <div className="text-2xl font-bold text-content">
          {((stats.byRoundType["seed"] || 0) + (stats.byRoundType["pre-seed"] || 0)).toLocaleString()}
        </div>
        <div className="text-xs text-content-secondary">Early stage deals</div>
      </div>

      <div className="bg-surface-secondary rounded-lg p-4">
        <div className="flex items-center gap-2 text-content-secondary text-sm mb-1">
          <Briefcase className="w-4 h-4" />
          Series A+
        </div>
        <div className="text-2xl font-bold text-content">
          {((stats.byRoundType["series-a"] || 0) +
            (stats.byRoundType["series-b"] || 0) +
            (stats.byRoundType["series-c"] || 0) +
            (stats.byRoundType["series-d-plus"] || 0)).toLocaleString()}
        </div>
        <div className="text-xs text-content-secondary">Later stage deals</div>
      </div>
    </div>
  );
}

export function FundingBriefView() {
  const [lookbackDays, setLookbackDays] = useState(730); // Default to ~2 years to include Q4 2025 data
  const [roundTypeFilter, setRoundTypeFilter] = useState<string>("");
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // PDF Generator hook
  const { isGenerating, isSaving, error: pdfError, generateFromFundingEvents, generateAndSave, clearError } = usePDFGenerator();

  // AI Insights generator action
  const generateInsights = useAction(api.domains.documents.pdfInsights.generatePDFInsights);

  // Fetch funding data
  const data = useQuery(api.domains.enrichment.fundingQueries.getAllFundingForBrief, {
    lookbackDays,
    limit: 100,
    roundTypeFilter: roundTypeFilter || undefined,
    sectorFilter: sectorFilter || undefined,
  });

  // Transform API events to FundingDealRow format for PDF generation
  const transformToFundingDealRows = useCallback((events: typeof data.events): FundingDealRow[] => {
    if (!events) return [];
    return events.map((event) => ({
      companyName: toDisplayLabel(event.companyName, "Undisclosed company"),
      roundType: isGenericPlaceholder(event.roundType) ? "unknown" : event.roundType,
      amountRaw: event.amountRaw || "",
      amountUsd: event.amountUsd,
      leadInvestors: sanitizeNameList(event.leadInvestors),
      sector: isGenericPlaceholder(event.sector) ? undefined : event.sector,
      location: isGenericPlaceholder(event.location) ? undefined : event.location,
      announcedAt: event.announcedAt || Date.now(),
      confidence: event.confidence || 0.5,
      verificationStatus: event.verificationStatus || "unverified",
    }));
  }, []);

  // Handle PDF export (download only) - with AI insights
  const handleExportPDF = useCallback(async () => {
    if (!data?.events) return;

    const fundingRows = transformToFundingDealRows(data.events);
    const quarterLabel = lookbackDays <= 90
      ? `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`
      : `${lookbackDays} Day Summary`;

    try {
      setIsGeneratingInsights(true);

      // Generate AI insights using FREE-FIRST model strategy
      const insightsResult = await generateInsights({
        deals: fundingRows.map((d) => ({
          companyName: d.companyName,
          roundType: d.roundType,
          amountRaw: d.amountRaw,
          amountUsd: d.amountUsd,
          leadInvestors: d.leadInvestors,
          sector: d.sector,
          location: d.location,
          announcedAt: d.announcedAt,
        })),
        quarterLabel,
      });

      setIsGeneratingInsights(false);

      // Use AI insights if successful, otherwise use placeholder
      const insights = insightsResult.success && insightsResult.insights
        ? insightsResult.insights
        : undefined;

      if (insightsResult.success) {
      }

      await generateFromFundingEvents(fundingRows, quarterLabel, insights, true);
    } catch (err) {
      setIsGeneratingInsights(false);
      console.error("PDF generation failed:", err);
    }
  }, [data?.events, lookbackDays, transformToFundingDealRows, generateFromFundingEvents, generateInsights]);

  // Handle Save to Documents (generates and saves to Documents Hub) - with AI insights
  const handleSaveToDocuments = useCallback(async () => {
    if (!data?.events) return;

    const fundingRows = transformToFundingDealRows(data.events);
    const quarterLabel = lookbackDays <= 90
      ? `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`
      : `${lookbackDays} Day Summary`;

    try {
      setIsGeneratingInsights(true);

      // Generate AI insights using FREE-FIRST model strategy
      const insightsResult = await generateInsights({
        deals: fundingRows.map((d) => ({
          companyName: d.companyName,
          roundType: d.roundType,
          amountRaw: d.amountRaw,
          amountUsd: d.amountUsd,
          leadInvestors: d.leadInvestors,
          sector: d.sector,
          location: d.location,
          announcedAt: d.announcedAt,
        })),
        quarterLabel,
      });

      setIsGeneratingInsights(false);

      const insights = insightsResult.success && insightsResult.insights
        ? insightsResult.insights
        : undefined;

      await generateAndSave(fundingRows, quarterLabel, insights, {
        tags: ["funding-brief", "ai-insights"],
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setIsGeneratingInsights(false);
      console.error("Save to documents failed:", err);
    }
  }, [data?.events, lookbackDays, transformToFundingDealRows, generateAndSave, generateInsights]);

  // Sorted events by amount (highest first)
  const sortedEvents = useMemo(() => {
    if (!data?.events) return [];
    return [...data.events].sort((a, b) => (b.amountUsd || 0) - (a.amountUsd || 0));
  }, [data?.events]);

  // Get unique round types for filter dropdown
  const roundTypes = useMemo(() => {
    if (!data?.stats?.byRoundType) return [];
    return Object.keys(data.stats.byRoundType).sort();
  }, [data?.stats?.byRoundType]);

  return (
    <div className="nb-page-shell editorial-layout view-atmosphere-funding">
      <div className="nb-page-inner">
        <div className="nb-page-frame-narrow stagger [&>*]:animate-[fade-slide-in_0.5s_var(--ease-out-expo)_both]">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="type-page-title text-content mb-1">
              Startup Funding Brief
            </h1>
            <p className="text-content-secondary">
              Real-time funding insights from verified sources
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Save to Documents Button */}
            <button
              type="button"
              onClick={handleSaveToDocuments}
              disabled={isGenerating || isSaving || isGeneratingInsights || !data?.events?.length}
              className="btn-primary-sm flex items-center gap-2"
            >
              {isGeneratingInsights && !isGenerating && !isSaving ? (
                <>
                  <Sparkles className="w-4 h-4 motion-safe:animate-pulse" />
                  Analyzing...
                </>
              ) : isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                  Saving...
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved!
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  Save to Documents
                </>
              )}
            </button>

            {/* PDF Export Button */}
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={isGenerating || isSaving || isGeneratingInsights || !data?.events?.length}
              className="btn-outline-sm flex items-center gap-2"
            >
              {isGeneratingInsights ? (
                <>
                  <Sparkles className="w-4 h-4 motion-safe:animate-pulse" />
                  AI Analyzing...
                </>
              ) : isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        {/* PDF Error Toast */}
        {pdfError && (
          <div className="mb-4 p-3 bg-surface-secondary border border-edge rounded-lg flex items-center justify-between">
            <span className="text-sm text-content-secondary">
              PDF generation failed: {pdfError.message}
            </span>
            <button
              type="button"
              onClick={clearError}
              className="text-content-secondary hover:text-content text-sm font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="nb-surface-card mb-6 p-4 flex flex-wrap items-start gap-3 overflow-visible relative z-10">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-content-secondary" />
            <span className="text-sm font-medium text-content">Filters:</span>
          </div>

          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="w-full sm:w-auto sm:min-w-[11rem] max-w-full text-sm border border-edge rounded-md px-3 py-1.5 bg-surface text-content hover:border-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors relative z-20"
            aria-label="Time range"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
            <option value={730}>All Time</option>
          </select>

          <select
            value={roundTypeFilter}
            onChange={(e) => setRoundTypeFilter(e.target.value)}
            className="w-full sm:w-auto sm:min-w-[11rem] max-w-full text-sm border border-edge rounded-md px-3 py-1.5 bg-surface text-content hover:border-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors relative z-20"
            aria-label="Round type"
          >
            <option value="">All Rounds</option>
            {roundTypes.map((rt) => (
              <option key={rt} value={rt}>
                {ROUND_TYPE_LABELS[rt] || rt}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Filter by sector..."
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="w-full sm:w-56 text-sm border border-edge rounded-md px-3 py-1.5 bg-surface text-content placeholder:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by sector"
          />
        </div>

        {/* Stats Summary */}
        {data?.stats && <StatsSummary stats={data.stats} />}

        {/* Loading State */}
        {!data && (
          <div className="text-center py-12">
            <div className="motion-safe:animate-pulse">
              <div className="h-8 bg-surface-secondary rounded w-48 mx-auto mb-4"></div>
              <div className="h-4 bg-surface-secondary rounded w-64 mx-auto"></div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {data && sortedEvents.length === 0 && (
          <div className="nb-surface-card text-center py-12">
            <Building2 className="w-12 h-12 mx-auto text-content-secondary mb-3" />
            <h3 className="text-lg font-medium text-content mb-1">
              No funding events found
            </h3>
            <p className="text-sm text-content-secondary">
              Try adjusting your filters or lookback period
            </p>
          </div>
        )}

        {/* Funding Cards Grid */}
        {sortedEvents.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {sortedEvents.map((event) => (
              <FundingCard key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-content-secondary">
          <p>
            Data sourced from verified news outlets and official announcements.
          </p>
          <p className="mt-1">
            Updated continuously. Follow us on LinkedIn for daily briefs.
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
