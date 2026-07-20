"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCw, Building2, MapPin, Calendar, Globe, Users, DollarSign, ArrowUpRight } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { AUDIT_MOCKS } from "../data/audit_mocks";
import { RepoStatsPanel } from "./RepoStatsPanel";
import { EntityRadar } from "./EntityRadar";
import { StrategyMetricsPanel } from "./StrategyMetricsPanel";
import { ModelComparisonTable } from "./ModelComparisonTable";
import { CostCrossoverCalculator } from "./CostCrossoverCalculator";

const BLANK_VALUES = new Set(["", "n/a", "na", "unknown", "null", "undefined", "pending"]);
const LOW_SIGNAL_SUMMARY_PATTERNS = [
  /no reliable public information/i,
  /no public information/i,
  /no confirmed/i,
  /could not find/i,
  /not found/i,
  /insufficient data/i,
  /insufficient information/i,
  /unable to verify/i,
  /unclear/i,
];
const LOW_SIGNAL_FACT_PATTERNS = [
  /no confirmed/i,
  /no reliable/i,
  /no corroborated/i,
  /no available/i,
  /no funding/i,
  /no data/i,
  /no evidence/i,
  /no known/i,
  /no publicly/i,
  /not found/i,
  /insufficient/i,
  /public presence/i,
  /no corroborating/i,
  /not verified/i,
  /likely related/i,
  /recent activity/i,
  /github repository/i,
  /project\/repository/i,
  /only clear reference/i,
  /closely related mention/i,
  /other provided links/i,
  /unrelated entities/i,
  /similar names/i,
  /only closely related/i,
];
const ENTITY_TOKEN_STOP = new Set([
  "open",
  "group",
  "corp",
  "inc",
  "labs",
  "lab",
  "systems",
  "company",
  "ai",
  "global",
  "platform",
  "the",
]);

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length === 0 || BLANK_VALUES.has(trimmed);
  }
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeEntityKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function pickAuditMock(entityName: string | null) {
  if (!entityName) return null;
  const upper = entityName.trim().toUpperCase();
  if (AUDIT_MOCKS[upper]) return AUDIT_MOCKS[upper];
  const normalized = normalizeEntityKey(entityName);
  if (AUDIT_MOCKS[normalized]) return AUDIT_MOCKS[normalized];
  const entry = Object.entries(AUDIT_MOCKS).find(([key]) => normalizeEntityKey(key) === normalized);
  return entry?.[1] ?? null;
}

function tokenizeEntity(entityName?: string | null): string[] {
  if (!entityName) return [];
  return entityName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !ENTITY_TOKEN_STOP.has(token));
}

function isLowSignalSummary(summary?: string | null): boolean {
  if (!summary) return true;
  return LOW_SIGNAL_SUMMARY_PATTERNS.some((pattern) => pattern.test(summary));
}

function coerceUserFacingSummary(summary?: unknown): string {
  const raw = typeof summary === "string" ? summary : summary == null ? "" : String(summary);
  const s = raw.trim();
  if (!s) return "Summary pending.";

  // If the backend returns structured JSON as a string, extract a human-readable field.
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const parsed: any = JSON.parse(s);

      if (typeof parsed === "string") return parsed.trim() || "Summary pending.";

      if (Array.isArray(parsed)) {
        const firstStr = parsed.find((v) => typeof v === "string" && v.trim());
        if (typeof firstStr === "string") return firstStr.trim();

        const firstObj = parsed.find((v) => v && typeof v === "object");
        if (firstObj && typeof firstObj === "object") {
          const preferred = ["summary", "overview", "description", "text", "oneLiner", "brief"];
          for (const k of preferred) {
            const v = (firstObj as any)[k];
            if (typeof v === "string" && v.trim()) return v.trim();
          }
        }

        return "Summary pending.";
      }

      if (parsed && typeof parsed === "object") {
        const preferred = ["summary", "overview", "description", "text", "executiveSummary", "companySummary", "whatTheyDo", "oneLiner", "brief"];
        for (const k of preferred) {
          const v = (parsed as any)[k];
          if (typeof v === "string" && v.trim()) return v.trim();
          if (v && typeof v === "object") {
            const inner = (v as any).text ?? (v as any).summary ?? (v as any).overview ?? null;
            if (typeof inner === "string" && inner.trim()) return inner.trim();
          }
        }

        const firstString = Object.values(parsed).find((v) => typeof v === "string" && v.trim());
        if (typeof firstString === "string") return firstString.trim();
      }
    } catch {
      // Not valid JSON; fall through to raw rendering.
    }
  }

  return s;
}

function filterLowSignalFacts(facts: string[]) {
  return facts.filter((fact) => !LOW_SIGNAL_FACT_PATTERNS.some((pattern) => pattern.test(fact)));
}

function scoreSourceRelevance(source: { name?: string; url?: string; snippet?: string }, tokens: string[]): number {
  if (!tokens.length) return 0;
  const haystack = `${source.name ?? ""} ${source.url ?? ""} ${source.snippet ?? ""}`.toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

function mergeArrays<T>(live?: T[], fallback?: T[]): T[] {
  const combined = [...(live ?? []), ...(fallback ?? [])];
  const seen = new Set<string>();
  return combined.filter((item) => {
    const key = typeof item === "string" ? item.toLowerCase() : JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeSources(
  live?: Array<{ name?: string; url?: string; snippet?: string }>,
  fallback?: Array<{ name?: string; url?: string; snippet?: string }>,
) {
  const combined = [...(live ?? []), ...(fallback ?? [])];
  const seen = new Set<string>();
  return combined.filter((item) => {
    const key = (item.url || item.name || "").toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeInsight(live: any | null, fallback: any | null, entityName?: string | null) {
  if (!fallback) return live;
  if (!live) return fallback;

  const completenessScore = live?.crmFields?.completenessScore;
  const preferFallback =
    isLowSignalSummary(live.summary) ||
    (typeof completenessScore === "number" && completenessScore < 55);

  const mergedCrm: Record<string, any> = { ...(fallback.crmFields ?? {}) };
  const liveCrm = live.crmFields ?? {};
  Object.entries(liveCrm).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      mergedCrm[key] = mergeArrays(value, mergedCrm[key]);
      return;
    }
    if (preferFallback && !isBlank(mergedCrm[key])) {
      return;
    }
    if (!isBlank(value)) {
      mergedCrm[key] = value;
    }
  });

  const mergedKeyFacts = filterLowSignalFacts(
    mergeArrays(live.keyFacts, fallback.keyFacts),
  ).slice(0, 8);
  const mergedSources = mergeSources(
    preferFallback ? fallback.sources : live.sources,
    preferFallback ? live.sources : fallback.sources,
  );
  const entityTokens = tokenizeEntity(entityName);
  const scoredSources = entityTokens.length
    ? mergedSources.map((source) => ({
      source,
      score: scoreSourceRelevance(source, entityTokens),
    }))
    : mergedSources.map((source) => ({ source, score: 0 }));
  const relevantSources = entityTokens.length
    ? scoredSources.filter((item) => item.score > 0)
    : scoredSources;
  const rankedSources = (relevantSources.length ? relevantSources : scoredSources)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.source);

  return {
    ...fallback,
    ...live,
    summary: preferFallback ? fallback.summary : !isBlank(live.summary) ? live.summary : fallback.summary,
    crmFields: mergedCrm,
    keyFacts: mergedKeyFacts,
    sources: rankedSources.slice(0, 8),
    recentNews: mergeArrays(live.recentNews, fallback.recentNews).slice(0, 8),
    stockPrice:
      preferFallback && !isBlank(fallback.stockPrice)
        ? fallback.stockPrice
        : !isBlank(live.stockPrice)
          ? live.stockPrice
          : fallback.stockPrice,
    // Banker-Grade Pass-through
    performanceMetrics: live.performanceMetrics ?? fallback.performanceMetrics,
    financials: live.financials ?? fallback.financials,
    academicData: live.academicData ?? fallback.academicData,
    ecosystem: live.ecosystem ?? fallback.ecosystem,
    technicalSpecs: live.technicalSpecs ?? fallback.technicalSpecs,
  };
}

interface EntityContextDrawerProps {
  isOpen: boolean;
  entityName: string | null;
  entityType?: "company" | "person";
  trackedHashtags?: string[];
  techStack?: string[];
  onClose: () => void;
  onOpenReader?: (item: {
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    publishedAt?: string;
  }) => void;
}

export const EntityContextDrawer: React.FC<EntityContextDrawerProps> = ({
  isOpen,
  entityName,
  entityType = "company",
  trackedHashtags = [],
  techStack = [],
  onClose,
  onOpenReader,
}) => {
  const { openWithContext } = useFastAgent();
  const fetchInsights = useAction(api.domains.knowledge.entityInsights.getEntityInsights);
  const fetchInsightsRef = useRef(fetchInsights);
  const [insight, setInsight] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequestRef = useRef<string | null>(null);

  useEffect(() => {
    fetchInsightsRef.current = fetchInsights;
  }, [fetchInsights]);

  const requestKey = useMemo(() => {
    if (!isOpen || !entityName) return null;
    return `${entityType}:${entityName}`;
  }, [entityName, entityType, isOpen]);

  useEffect(() => {
    if (!requestKey || !entityName) return;
    if (lastRequestRef.current === requestKey) return;
    lastRequestRef.current = requestKey;
    setIsLoading(true);
    setError(null);

    const fallbackMock = pickAuditMock(entityName);

    fetchInsightsRef
      .current({ entityName, entityType })
      .then((result: any) => {
        const hasLiveData =
          !!result &&
          (typeof result.summary === "string" ||
            (Array.isArray(result.keyFacts) && result.keyFacts.length > 0) ||
            (result.crmFields && Object.keys(result.crmFields).length > 0));
        if (hasLiveData) {
          setInsight(mergeInsight(result, fallbackMock, entityName));
          return;
        }
        if (fallbackMock) {
          setInsight(fallbackMock);
          return;
        }
        setError("No entity data available.");
      })
      .catch((err: any) => {
        if (fallbackMock) {
          setInsight(fallbackMock);
          return;
        }
        setError(err?.message ?? "Failed to load entity context.");
      })
      .finally(() => setIsLoading(false));
  }, [entityName, entityType, requestKey]);

  useEffect(() => {
    if (!isOpen) {
      setInsight(null);
      setError(null);
      setIsLoading(false);
      lastRequestRef.current = null;
    }
  }, [isOpen]);

  const summary = coerceUserFacingSummary(insight?.summary);
  const crm = insight?.crmFields ?? {};
  const keyFacts: string[] = filterLowSignalFacts(insight?.keyFacts ?? []);
  const sources: Array<{ name?: string; url?: string; snippet?: string }> = insight?.sources ?? [];
  const recentNews: Array<{ date?: string; headline?: string; source?: string; url?: string }> =
    insight?.recentNews ?? [];
  const stockPrice = insight?.stockPrice ?? null;

  const contextMatches = useMemo(() => {
    const name = (entityName ?? "").toLowerCase();
    const summaryText = (summary ?? "").toLowerCase();
    const factText = keyFacts.join(" ").toLowerCase();
    const watchlistMatches = trackedHashtags.filter((tag) => {
      const t = tag.toLowerCase();
      return name.includes(t) || summaryText.includes(t) || factText.includes(t);
    });
    const stackMatches = techStack.filter((stack) => {
      const s = stack.toLowerCase();
      return summaryText.includes(s) || factText.includes(s);
    });
    return { watchlistMatches, stackMatches };
  }, [entityName, keyFacts, summary, techStack, trackedHashtags]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
        aria-label="Close entity drawer"
      />
      <div className="ml-auto w-full max-w-md h-full bg-surface shadow-2xl border-l border-edge flex flex-col relative">
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-content text-white flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-content">{entityName ?? "Entity"}</div>
              <div className="text-xs text-content-muted">{entityType}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!entityName) return;
                const fallbackMock = pickAuditMock(entityName);
                setIsLoading(true);
                fetchInsightsRef
                  .current({ entityName, entityType, forceRefresh: true })
                  .then((result: any) => {
                    const hasLiveData =
                      !!result &&
                      (typeof result.summary === "string" ||
                        (Array.isArray(result.keyFacts) && result.keyFacts.length > 0) ||
                        (result.crmFields && Object.keys(result.crmFields).length > 0));
                    if (hasLiveData) {
                      setInsight(mergeInsight(result, fallbackMock, entityName));
                      setError(null);
                      return;
                    }
                    if (fallbackMock) {
                      setInsight(fallbackMock);
                      setError(null);
                      return;
                    }
                    setError("No entity data available.");
                  })
                  .catch((err: any) => {
                    if (fallbackMock) {
                      setInsight(fallbackMock);
                      setError(null);
                      return;
                    }
                    setError(err?.message ?? "Failed to refresh.");
                  })
                  .finally(() => setIsLoading(false));
              }}
              className="p-2 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
              aria-label="Refresh entity"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {!error && (
            <>
              <div className="space-y-2">
                <div className="text-xs font-medium text-content-muted">Summary</div>
                <p className="text-sm text-content-secondary leading-relaxed">{summary}</p>

                {/* Freshness Badge */}
                {insight?.freshness && (
                  <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${insight.freshness.withinBankerWindow
                    ? "bg-indigo-100 text-content"
                    : "bg-amber-100 text-amber-800"
                    }`}>
                    <span>{insight.freshness.withinBankerWindow ? "✓" : "⚠"}</span>
                    <span>
                      {insight.freshness.newsAgeDays !== null
                        ? `${insight.freshness.newsAgeDays}d ago`
                        : "No recent news"}
                    </span>
                    {insight.freshness.withinBankerWindow && (
                      <span className="ml-1 opacity-75">• Banker Ready</span>
                    )}
                  </div>
                )}
              </div>

              {/* Funding Details */}
              {insight?.funding?.lastRound && (
                <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 space-y-2">
                  <div className="text-xs font-medium text-content-secondary">Latest Round</div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{insight.funding.lastRound.roundType}</span>
                    {insight.funding.lastRound.amount && (
                      <span className="font-bold">
                        {insight.funding.lastRound.amount.currency === "EUR" ? "€" : "$"}
                        {insight.funding.lastRound.amount.amount}{insight.funding.lastRound.amount.unit}
                      </span>
                    )}
                  </div>
                  {insight.funding.lastRound.coLeads && insight.funding.lastRound.coLeads.length > 0 && (
                    <div className="text-xs">
                      <span className="text-blue-600 font-semibold">Co-Leads:</span>{" "}
                      {insight.funding.lastRound.coLeads.join(", ")}
                    </div>
                  )}
                  {insight.funding.bankerTakeaway && (
                    <div className="text-xs italic border-t border-blue-200 pt-2 mt-2">
                      💡 {insight.funding.bankerTakeaway}
                    </div>
                  )}
                </div>
              )}

              {/* Persona Specific: Strategy Metrics (Founder) */}
              {insight?.strategyMetrics && (
                <StrategyMetricsPanel
                  title={entityName || "Strategy"}
                  summary={insight.summary}
                  initialData={insight.strategyMetrics}
                />
              )}

              {/* Persona Specific: Model Comparison (Enterprise Exec) */}
              {insight?.modelComparison && (
                <ModelComparisonTable
                  modelKey={insight.modelComparison.modelKey || entityName || "Model"}
                  initialData={insight.modelComparison}
                />
              )}

              {/* Persona Specific: Cost Calculator (Sales Engineer) */}
              {insight?.costCalculator && (
                <CostCrossoverCalculator />
              )}

              {/* Persona Status */}
              {insight?.personaHooks?.JPM_STARTUP_BANKER && (
                <div className={`rounded-md border p-3 text-xs ${insight.personaHooks.JPM_STARTUP_BANKER.failTriggers?.length === 0
                  ? "border-indigo-200 bg-indigo-50 text-content"
                  : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      Banker Readiness
                    </span>
                    <span className={`font-semibold ${insight.personaHooks.JPM_STARTUP_BANKER.failTriggers?.length === 0
                      ? "text-content-secondary"
                      : "text-amber-700"
                      }`}>
                      {insight.personaHooks.JPM_STARTUP_BANKER.failTriggers?.length === 0 ? "✓ PASS" : "⚠ GAPS"}
                    </span>
                  </div>
                  {insight.personaHooks.JPM_STARTUP_BANKER.failTriggers?.length > 0 && (
                    <ul className="mt-2 text-xs space-y-0.5">
                      {insight.personaHooks.JPM_STARTUP_BANKER.failTriggers.slice(0, 3).map((trigger: string, i: number) => (
                        <li key={i} className="text-amber-700">• {trigger}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Banker-Grade: Financials */}
              {insight?.financials && (
                <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-content space-y-2">
                  <div className="text-xs font-medium text-content-secondary flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Financials
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {insight.financials.burnRate && (
                      <div>
                        <span className="text-xs text-indigo-600">Burn Rate</span>
                        <div className="font-semibold">${insight.financials.burnRate.toLocaleString()} / mo</div>
                      </div>
                    )}
                    {insight.financials.revenue && (
                      <div>
                        <span className="text-xs text-indigo-600">Revenue</span>
                        <div className="font-semibold">${insight.financials.revenue.toLocaleString()} / yr</div>
                      </div>
                    )}
                    {insight.financials.costToServe && (
                      <div>
                        <span className="text-xs text-indigo-600">Cost to Serve</span>
                        <div className="font-semibold">${insight.financials.costToServe} unit</div>
                      </div>
                    )}
                  </div>
                  {insight.financials.unitEconomics && (
                    <div className="pt-2 border-t border-indigo-200">
                      <span className="text-xs text-indigo-600">Unit Economics</span>
                      <div className="text-sm">{insight.financials.unitEconomics}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Banker-Grade: Academic Data */}
              {insight?.academicData && (
                <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-900 space-y-2">
                  <div className="text-xs font-medium text-content-secondary flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Academic Rigor
                  </div>
                  {insight.academicData.methodology && (
                    <div>
                      <span className="text-xs text-indigo-600">Methodology</span>
                      <div className="font-medium">{insight.academicData.methodology}</div>
                    </div>
                  )}
                  <div className="flex gap-4 pt-1">
                    {insight.academicData.citations && (
                      <div className="flex flex-col">
                        <span className="text-xs text-indigo-600">Citations</span>
                        <span className="font-bold text-lg">{insight.academicData.citations}</span>
                      </div>
                    )}
                    {insight.academicData.pValue !== null && (
                      <div className="flex flex-col">
                        <span className="text-xs text-indigo-600">P-Value</span>
                        <span className="font-bold text-lg">{insight.academicData.pValue}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Banker-Grade: Technical Specs */}
              {insight?.technicalSpecs && (
                <div className="rounded-md border border-edge bg-surface-secondary p-3 text-xs text-content space-y-2">
                  <div className="text-xs font-medium text-content-secondary">Technical Specs</div>

                  {insight.technicalSpecs.repoStats && (
                    <div className="pb-2 border-b border-edge">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <div className="text-xs font-bold">{insight.technicalSpecs.repoStats.stars}</div>
                          <div className="text-xs text-content-secondary">Stars</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-bold">{insight.technicalSpecs.repoStats.forks}</div>
                          <div className="text-xs text-content-secondary">Forks</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-bold text-indigo-600">+{insight.technicalSpecs.repoStats.starVelocity}</div>
                          <div className="text-xs text-content-secondary">Velocity</div>
                        </div>
                      </div>
                      {/* Deep Dive Repo Panel */}
                      <div className="mt-3 pt-2 border-t border-edge/50">
                        <RepoStatsPanel
                          repoUrl={insight.technicalSpecs.repoStats.url || "https://github.com/example/repo"}
                          initialData={insight.technicalSpecs}
                        />
                      </div>
                    </div>
                  )}

                  {insight.technicalSpecs.cveIds && insight.technicalSpecs.cveIds.length > 0 && (
                    <div className="pt-1">
                      <span className="text-xs text-rose-600 font-bold">Security Constraints (CVEs)</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {insight.technicalSpecs.cveIds.map((cve: string) => (
                          <span key={cve} className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-xs rounded border border-rose-200">{cve}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Banker-Grade: Ecosystem */}
              {insight?.ecosystem && (
                <div className="rounded-md border border-amber-100 bg-amber-50/30 p-3 text-xs text-amber-900 space-y-2">
                  <div className="text-xs font-medium text-content-secondary">Ecosystem Impact</div>

                  {insight.ecosystem.graph && (
                    <div className="mb-3">
                      <EntityRadar graph={insight.ecosystem.graph} />
                    </div>
                  )}

                  {insight.ecosystem.dependencies && insight.ecosystem.dependencies.length > 0 && (
                    <div>
                      <span className="text-xs text-amber-600">Dependencies</span>
                      <div className="text-content-secondary">{insight.ecosystem.dependencies.join(", ")}</div>
                    </div>
                  )}
                  {insight.ecosystem.downstreamImpact && insight.ecosystem.downstreamImpact.length > 0 && (
                    <div>
                      <span className="text-xs text-amber-600">Downstream Impact</span>
                      <div className="text-content-secondary">{insight.ecosystem.downstreamImpact.join(", ")}</div>
                    </div>
                  )}
                </div>
              )}


              <div className="grid grid-cols-2 gap-3 text-xs text-content-secondary">
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <MapPin className="w-3 h-3" /> HQ
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.hqLocation || "n/a"}</div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <Calendar className="w-3 h-3" /> Founded
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.foundingYear || "n/a"}</div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <Users className="w-3 h-3" /> Founders
                  </div>
                  <div className="mt-1 font-semibold text-content">
                    {(crm.founders ?? []).slice(0, 2).join(", ") || "n/a"}
                  </div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <Globe className="w-3 h-3" /> Website
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.website || "n/a"}</div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <DollarSign className="w-3 h-3" /> Funding
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.totalFunding || "n/a"}</div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <Building2 className="w-3 h-3" /> Stage
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.fundingStage || "n/a"}</div>
                </div>
                <div className="rounded-md border border-edge bg-surface-secondary p-3">
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <Calendar className="w-3 h-3" /> Last round
                  </div>
                  <div className="mt-1 font-semibold text-content">{crm.lastFundingDate || "n/a"}</div>
                </div>
              </div>

              {crm.foundersBackground && (
                <div className="rounded-md border border-edge bg-surface p-3 text-xs text-content-secondary">
                  <div className="text-xs font-medium text-content-muted">Founder background</div>
                  <div className="mt-1 text-sm text-content">{crm.foundersBackground}</div>
                </div>
              )}

              {crm.keyPeople?.length > 0 && (
                <div className="rounded-md border border-edge bg-surface p-3 text-xs text-content-secondary space-y-2">
                  <div className="text-xs font-medium text-content-muted">Key people</div>
                  <ul className="space-y-1">
                    {crm.keyPeople.slice(0, 3).map((person: any, idx: number) => (
                      <li key={`${person.name}-${idx}`} className="text-sm text-content">
                        <span className="font-semibold">{person.name}</span> - {person.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {crm.investors?.length > 0 && (
                <div className="rounded-md border border-edge bg-surface p-3 text-xs text-content-secondary">
                  <div className="text-xs font-medium text-content-muted">Investors</div>
                  <div className="mt-1 text-sm text-content">{crm.investors.slice(0, 4).join(", ")}</div>
                </div>
              )}

              {crm.competitors?.length > 0 && (
                <div className="rounded-md border border-edge bg-surface p-3 text-xs text-content-secondary">
                  <div className="text-xs font-medium text-content-muted">Competitors</div>
                  <div className="mt-1 text-sm text-content">{crm.competitors.slice(0, 4).join(", ")}</div>
                </div>
              )}

              {stockPrice?.price && (
                <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-xs text-content">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Stock</span>
                    <span className="font-semibold">${stockPrice.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  {stockPrice.asOf && (
                    <div className="text-xs text-content-secondary mt-1">As of {stockPrice.asOf}</div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-medium text-content-muted">Key facts</div>
                {keyFacts.length > 0 ? (
                  <ul className="list-disc list-inside text-xs text-content-secondary space-y-1">
                    {keyFacts.slice(0, 6).map((fact, idx) => (
                      <li key={`${fact}-${idx}`}>{fact}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-content-muted">No key facts captured yet.</div>
                )}
              </div>

              {(contextMatches.watchlistMatches.length > 0 || contextMatches.stackMatches.length > 0) && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-content-muted">Your context</div>
                  {contextMatches.watchlistMatches.length > 0 && (
                    <div className="text-xs text-content-secondary">
                      Watchlist matches: {contextMatches.watchlistMatches.join(", ")}
                    </div>
                  )}
                  {contextMatches.stackMatches.length > 0 && (
                    <div className="text-xs text-content-secondary">
                      Stack matches: {contextMatches.stackMatches.join(", ")}
                    </div>
                  )}
                </div>
              )}

              {recentNews.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-content-muted">Recent news</div>
                  <div className="space-y-2">
                    {recentNews.slice(0, 5).map((item, idx) => (
                      <button
                        key={`${item.url ?? item.headline}-${idx}`}
                        type="button"
                        onClick={() => {
                          if (onOpenReader && item.url) {
                            onOpenReader({
                              title: item.headline,
                              url: item.url,
                              source: item.source,
                              summary: item.headline,
                              publishedAt: item.date,
                            });
                            return;
                          }
                          if (item.url) {
                            window.open(item.url, "_blank", "noopener,noreferrer");
                          }
                        }}
                        className="w-full text-left rounded-md border border-edge bg-surface-secondary px-3 py-2 hover:bg-surface transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs text-content-muted">
                          <span>{item.source || "Source"}</span>
                          {item.date && <span>{item.date}</span>}
                        </div>
                        <div className="text-xs text-content-secondary mt-1">{item.headline}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sources.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-content-muted">Sources</div>
                  <div className="space-y-2">
                    {sources.slice(0, 5).map((source, idx) => (
                      <button
                        key={`${source.url ?? source.name}-${idx}`}
                        type="button"
                        onClick={() => {
                          if (onOpenReader && source.url) {
                            onOpenReader({
                              title: source.name,
                              url: source.url,
                              summary: source.snippet,
                            });
                            return;
                          }
                          if (source.url) {
                            window.open(source.url, "_blank", "noopener,noreferrer");
                          }
                        }}
                        className="w-full text-left rounded-md border border-edge bg-surface px-3 py-2 hover:border-content transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-content-secondary">
                          <span>{source.name || "Source"}</span>
                          <ArrowUpRight className="w-3 h-3 text-content-muted" />
                        </div>
                        {source.snippet && (
                          <div className="text-xs text-content-secondary mt-1 line-clamp-2">{source.snippet}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-edge px-5 py-4">
          <button
            type="button"
            onClick={() => {
              if (!entityName) return;
              openWithContext({
                contextTitle: `Entity brief: ${entityName}`,
                initialMessage: `Provide a decision brief on ${entityName}. Include catalysts, risks, and next actions.`,
                contextWebUrls: (sources || []).map((s) => s.url).filter((u): u is string => Boolean(u)),
              });
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-content hover:bg-black transition-colors"
          >
            Ask agent
          </button>
        </div>
      </div>
    </div>
  );
};

export default EntityContextDrawer;
