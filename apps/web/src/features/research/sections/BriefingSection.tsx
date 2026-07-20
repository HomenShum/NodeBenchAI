/**
 * BriefingSection - Executive Brief / Acts display
 *
 * Handles:
 * - Brief data fetching via useBriefData hook
 * - 3-Act scrollytelling layout
 * - Loading states with skeletons
 * - Act navigation
 * - Empty-state generation trigger when real brief data is unavailable
 */

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import { ChevronRight, Clock, BarChart2, Zap, ExternalLink, RefreshCw } from 'lucide-react';
import { useBriefData } from '../hooks/useBriefData';
import { CrossLinkedText } from '../components/CrossLinkedText';
import SignalMomentumMini from '../components/SignalMomentumMini';
import { BriefingSkeleton } from '@/components/skeletons';
import { ErrorBoundary, BriefingErrorFallback } from "@/shared/components/ErrorBoundary";
import { formatBriefDate, isBriefDateToday } from '@/lib/briefDate';

type ActiveAct = 'actI' | 'actII' | 'actIII';

interface BriefingSectionProps {
  /** Called when act changes */
  onActChange?: (act: ActiveAct) => void;
  /** Called when "Ask AI" is clicked for an item */
  onAskAI?: (prompt: string) => void;
  /** Open a source in the internal reader */
  onOpenReader?: (item: {
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    publishedAt?: string;
    category?: string;
    relevance?: string;
  }) => void;
  /** Class name for container */
  className?: string;
}

const resolveSourceName = (source: unknown): string | null => {
  if (source === null || source === undefined) return null;
  if (typeof source === 'string' || typeof source === 'number') return String(source);
  if (typeof source === 'object') {
    const candidate = (source as any).name ?? (source as any).source ?? (source as any).label ?? (source as any).id;
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return null;
};

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const formatMetricDisplay = (value: string | number): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return NUMBER_FORMATTER.format(value);
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return NUMBER_FORMATTER.format(parsed);
  }
  return String(value);
};

const resolveMetricValue = (value: unknown, fallback: string | number = 'N/A'): string | number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const count = (value as any).count;
    if (typeof count === 'number' && Number.isFinite(count)) return count;
    const label = resolveSourceName(value);
    if (label) return label;
  }
  return fallback;
};

const normalizeSourceEntry = (entry: unknown): { name: string; count: string | number | null } | null => {
  const name = resolveSourceName(entry);
  if (!name) return null;
  const rawCount =
    entry && typeof entry === 'object'
      ? ((entry as any).count ?? (entry as any).value)
      : null;
  const count = rawCount !== null && rawCount !== undefined
    ? resolveMetricValue(rawCount, '-')
    : null;
  return { name, count };
};

const normalizeTag = (tag: unknown): string | null => {
  if (tag === null || tag === undefined) return null;
  if (typeof tag === 'string' || typeof tag === 'number') return String(tag);
  if (typeof tag === 'object') {
    const candidate = (tag as any).tag ?? (tag as any).label ?? (tag as any).name;
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return null;
};

function BriefingSectionInner({
  onActChange,
  onAskAI,
  onOpenReader,
  className = '',
}: BriefingSectionProps) {
  const {
    executiveBrief,
    briefingDateString,
    sourceSummary,
    coverageSummaries,
    coverageRollup,
    isLoading,
    briefMemory,
  } = useBriefData();

  const { instant } = useMotionConfig();
  const [activeAct, setActiveAct] = useState<ActiveAct>('actI');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCoverageExpanded, setIsCoverageExpanded] = useState(false);
  const isBriefToday = isBriefDateToday(briefingDateString);
  const briefingTitle = isBriefToday ? "Today's Briefing" : "Latest Briefing";

  const handleActChange = useCallback((act: ActiveAct) => {
    setActiveAct(act);
    onActChange?.(act);
  }, [onActChange]);

  // Trigger brief generation manually
  const handleGenerateBrief = useCallback(async () => {
    if (!briefMemory?._id || isGenerating) return;
    setIsGenerating(true);
    try {
      // Call the public action to generate the brief
      const response = await fetch('/api/generate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryId: briefMemory._id }),
      });
      if (!response.ok) {
        console.warn('Brief generation failed:', await response.text());
      }
    } catch (err) {
      console.warn('Brief generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [briefMemory?._id, isGenerating]);

  const coverageItems = useMemo(() => {
    if (!Array.isArray(coverageSummaries)) return [];
    return coverageSummaries
      .map((item: any) => ({
        title: typeof item?.title === 'string' ? item.title : 'Untitled',
        summary: typeof item?.summary === 'string' ? item.summary : '',
        url: typeof item?.url === 'string' ? item.url : undefined,
        source: typeof item?.source === 'string' ? item.source : undefined,
        category: typeof item?.category === 'string' ? item.category : undefined,
      }))
      .filter((item) => item.summary);
  }, [coverageSummaries]);

  const coverageSourceSummaries = useMemo(() => {
    if (!coverageRollup || !Array.isArray((coverageRollup as any).sourceSummaries)) return [];
    return (coverageRollup as any).sourceSummaries
      .map((entry: any) => ({
        source: typeof entry?.source === 'string' ? entry.source : 'Unknown',
        summary: typeof entry?.summary === 'string' ? entry.summary : '',
        count: typeof entry?.count === 'number' ? entry.count : null,
      }))
      .filter((entry: any) => entry.summary);
  }, [coverageRollup]);

  const actI = executiveBrief?.actI;
  const actII = executiveBrief?.actII;
  const actIII = executiveBrief?.actIII;

  const briefingStats = useMemo(() => {
    const signalCount = actII?.signals?.length ?? 0;
    const actionCount = actIII?.actions?.length ?? 0;
    const sourceCount = sourceSummary?.totalItems ?? actI?.totalItems ?? 0;
    const confidence = executiveBrief?.meta?.confidence ?? null;
    return [
      { label: 'Signals', value: resolveMetricValue(signalCount), hint: 'Analysis' },
      { label: 'Actions', value: resolveMetricValue(actionCount), hint: 'Deep Dive' },
      { label: 'Sources', value: resolveMetricValue(sourceCount), hint: 'coverage' },
      { label: 'Confidence', value: confidence !== null ? `${confidence}%` : 'N/A', hint: 'source reliability' },
    ];
  }, [actI?.totalItems, actII?.signals?.length, actIII?.actions?.length, executiveBrief?.meta?.confidence, sourceSummary?.totalItems]);

  const topSources = useMemo<{ name: string; count: string | number | null }[]>(() => {
    if (sourceSummary?.bySource) {
      return Object.entries(sourceSummary.bySource)
        .map(([name, count]) => normalizeSourceEntry({ name, count }))
        .filter((entry): entry is { name: string; count: string | number | null } => Boolean(entry))
        .sort((a, b) => (Number(b?.count ?? 0) - Number(a?.count ?? 0)))
        .slice(0, 5);
    }
    if (Array.isArray(actI?.topSources)) {
      return actI.topSources
        .map((source: any) => normalizeSourceEntry(source))
        .filter((entry): entry is { name: string; count: string | number | null } => Boolean(entry))
        .slice(0, 5);
    }
    return [];
  }, [actI?.topSources, sourceSummary?.bySource]);

  const signalLedger = useMemo(() => {
    const actions = actIII?.actions ?? [];
    return (actII?.signals ?? []).slice(0, 6).map((signal: any, index: number) => {
      const evidenceCount = Array.isArray(signal.evidence) ? signal.evidence.length : 0;
      const linkedActions = actions.filter((action: any) => (action.linkedSignalIds ?? []).includes(signal.id)).length;
      return {
        id: signal.id || `signal-${index}`,
        headline: signal.headline,
        label: signal.label,
        deltaSummary: signal.deltaSummary,
        evidenceCount,
        linkedActions,
      };
    });
  }, [actII?.signals, actIII?.actions]);

  const actionMix = useMemo(() => {
    const actions = actIII?.actions ?? [];
    const counts = { high: 0, medium: 0, low: 0, other: 0 };
    actions.forEach((action: any) => {
      if (action.priority === 'high') counts.high += 1;
      else if (action.priority === 'medium') counts.medium += 1;
      else if (action.priority === 'low') counts.low += 1;
      else counts.other += 1;
    });
    return counts;
  }, [actIII?.actions]);

  const coverageStats = useMemo(() => {
    const qualityCoverage = executiveBrief?.quality?.coverage;
    const totalItems = qualityCoverage?.itemsScanned ?? actI?.totalItems ?? sourceSummary?.totalItems ?? 0;
    const sourcesCount = qualityCoverage?.sourcesCount ?? actI?.sourcesCount ?? topSources.length ?? 0;
    const topicsCoveredPercent = qualityCoverage?.topicsCoveredPercent ?? null;
    const perSource = sourcesCount ? Math.round((totalItems / sourcesCount) * 10) / 10 : null;
    return { totalItems, sourcesCount, topicsCoveredPercent, perSource };
  }, [actI?.sourcesCount, actI?.totalItems, executiveBrief?.quality?.coverage, sourceSummary?.totalItems, topSources.length]);

  const freshnessStats = useMemo(() => {
    const qualityFreshness = executiveBrief?.quality?.freshness;
    const newestAt = qualityFreshness?.newestAt ?? actI?.latestItemAt ?? null;
    const oldestAt = qualityFreshness?.oldestAt ?? null;
    const newestAge = newestAt ? Math.max(1, Math.round((Date.now() - Date.parse(newestAt)) / 3600000)) : null;
    const windowLabel = qualityFreshness?.windowLabel ?? (
      newestAt && oldestAt
        ? `${Math.max(1, Math.round((Date.parse(newestAt) - Date.parse(oldestAt)) / 3600000))}h`
        : null
    );
    const medianAgeHours = qualityFreshness?.medianAgeHours ?? null;
    return { newestAge, windowLabel, medianAgeHours };
  }, [actI?.latestItemAt, executiveBrief?.quality?.freshness]);

  const evidenceStats = useMemo(() => {
    const signals = actII?.signals ?? [];
    const actions = actIII?.actions ?? [];
    const evidenceCount = signals.reduce((sum: number, signal: any) => sum + (signal.evidence?.length ?? 0), 0);
    const evidencePerSignal = signals.length ? Math.round((evidenceCount / signals.length) * 10) / 10 : 0;
    const actionsPerSignal = signals.length ? Math.round((actions.length / signals.length) * 10) / 10 : 0;
    return { evidenceCount, evidencePerSignal, actionsPerSignal };
  }, [actII?.signals, actIII?.actions]);

  const qualityStats = useMemo(() => {
    const confidenceScore = executiveBrief?.quality?.confidence?.score ?? executiveBrief?.meta?.confidence ?? null;
    const freshnessValue = freshnessStats.medianAgeHours !== null
      ? `${freshnessStats.medianAgeHours}h`
      : freshnessStats.newestAge !== null
        ? `${freshnessStats.newestAge}h`
        : 'N/A';
    const freshnessHint = freshnessStats.medianAgeHours !== null ? 'median age' : 'latest item';
    return [
      { label: 'Items', value: coverageStats.totalItems, hint: 'scanned' },
      { label: 'Sources', value: coverageStats.sourcesCount, hint: 'unique' },
      { label: 'Freshness', value: freshnessValue, hint: freshnessHint },
      { label: 'Confidence', value: confidenceScore !== null ? `${confidenceScore}%` : 'N/A', hint: 'evidence' },
    ];
  }, [coverageStats.totalItems, coverageStats.sourcesCount, executiveBrief?.meta?.confidence, executiveBrief?.quality?.confidence?.score, freshnessStats.medianAgeHours, freshnessStats.newestAge]);

  const trendTags = useMemo(() => {
    const tags = Array.isArray(executiveBrief?.dashboard?.trendingTags)
      ? executiveBrief?.dashboard?.trendingTags
      : [];
    const normalized = tags.map(normalizeTag).filter(Boolean) as string[];
    if (normalized.length > 0) {
      return Array.from(new Set(normalized)).slice(0, 8);
    }
    const fallback = (actII?.signals ?? [])
      .map((signal: any) => normalizeTag(signal.label))
      .filter(Boolean) as string[];
    return Array.from(new Set(fallback)).slice(0, 8);
  }, [actII?.signals, executiveBrief?.dashboard?.trendingTags]);

  const provenanceLog = useMemo(() => {
    return executiveBrief?.provenance?.retrievalLog?.slice(0, 4) ?? [];
  }, [executiveBrief?.provenance]);

  const generationMeta = executiveBrief?.provenance?.generation ?? null;

  const agentLaunchpad = [
    {
      label: 'Deep agent: act I synthesis',
      prompt: 'Summarize Act I into a 5-bullet executive synthesis.',
    },
    {
      label: 'Deep agent: signal ranking',
      prompt: 'Rank Act II signals by impact and explain why.',
    },
    {
      label: 'Deep agent: action playbook',
      prompt: 'Turn Act III actions into a step-by-step playbook.',
    },
    {
      label: 'Deep agent: diligence checklist',
      prompt: 'Build a diligence checklist based on today\'s signals.',
    },
  ];

  if (isLoading) {
    return (
      <div className={className}>
        <BriefingSkeleton />
      </div>
    );
  }

  if (!executiveBrief || !actI || !actII || !actIII) {
    return (
      <div className={`${className} p-8 text-center text-content-secondary border border-edge rounded-lg bg-surface`}>
        <Clock className="w-8 h-8 mx-auto mb-3 text-content-secondary" />
        <p className="text-sm font-medium">No briefing available yet</p>
        <p className="text-xs text-content-secondary mt-1 mb-3">
          Search for a company above to generate your first intelligence briefing.
        </p>
        <code className="inline-block rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-content-muted font-mono">
          Try: &quot;What changed in AI this week?&quot;
        </code>
        {briefMemory?._id ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleGenerateBrief}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'motion-safe:animate-spin' : ''}`} />
              {isGenerating ? 'Generating...' : 'Generate Now'}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-content italic tracking-tight">{briefingTitle}</h2>
          <p className="text-sm font-medium text-content-secondary mt-1">
            {briefingDateString
              ? `${formatBriefDate(briefingDateString)}${isBriefToday ? "" : " (latest available)"}`
              : "Latest Synthesis"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sourceSummary?.totalItems && (
            <span className="px-3 py-1 bg-content text-white text-xs font-bold rounded-full tracking-tighter">
              {formatMetricDisplay(sourceSummary.totalItems)} Intelligence Nodes
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">
        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-content-muted">Briefing Snapshot</p>
            <p className="text-base font-bold text-content">Act coverage</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {briefingStats.map((stat) => (
              <div key={stat.label} className="rounded-md border border-edge bg-background p-3">
                <div className="text-xs font-bold text-content-muted">{stat.label}</div>
                <div className="text-2xl font-semibold text-content">{formatMetricDisplay(stat.value)}</div>
                <div className="text-xs text-content-muted">{stat.hint}</div>
              </div>
            ))}
          </div>
          {executiveBrief.meta?.headline && (
            <div className="text-xs text-content-secondary">
              <span className="text-xs font-bold text-content-muted">Headline</span>
              <div className="mt-1 text-sm text-content-secondary">{executiveBrief.meta.headline}</div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-content-muted">Primary Sources</p>
            <p className="text-base font-bold text-content">Recent Signals</p>
          </div>
          <div className="space-y-3">
            {topSources.length > 0 ? (
              topSources.map((source, idx) => (
                <div key={`${source.name}-${idx}`} className="flex items-center justify-between text-xs text-content-secondary border-b border-edge pb-2">
                  <span className="font-medium">{source.name}</span>
                  <span className="text-content-muted">{source.count === null ? '-' : formatMetricDisplay(source.count)}</span>
                </div>
              ))
            ) : (
              <div className="text-xs text-content-muted">No sources available yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-content-muted">Brief Structure</p>
            <p className="text-base font-bold text-content">Outline</p>
          </div>
          <div className="space-y-3 text-xs text-content-secondary">
            <div className="rounded-md border border-edge bg-background p-3">
              <div className="text-xs font-bold text-content-muted">Coverage</div>
              <div className="mt-1 text-sm text-content-secondary">
                {formatBriefSectionTitle((actI as { headline?: string } | undefined)?.headline || actI?.title, "Coverage & Freshness")}
              </div>
            </div>
            <div className="rounded-md border border-edge bg-background p-3">
              <div className="text-xs font-bold text-content-muted">Signals</div>
              <div className="mt-1 text-sm text-content-secondary">
                {formatBriefSectionTitle(actII?.title, "Signals")}
              </div>
            </div>
            <div className="rounded-md border border-edge bg-background p-3">
              <div className="text-xs font-bold text-content-muted">Actions</div>
              <div className="mt-1 text-sm text-content-secondary">
                {formatBriefSectionTitle(actIII?.title, "Actions")}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-12">
        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-content-muted">Quality Metrics</p>
              <p className="text-base font-bold text-content">Coverage integrity</p>
            </div>
            {onAskAI && (
              <button
                type="button"
                onClick={() => onAskAI('Assess briefing quality, coverage gaps, and confidence drivers.')}
                className="px-3 py-1 text-xs font-bold border border-edge text-content-secondary hover:text-content hover:border-content transition-colors"
              >
                Ask agent
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {qualityStats.map((stat) => (
              <div key={stat.label} className="rounded-md border border-edge bg-background p-3">
                <div className="text-xs font-bold text-content-muted">{stat.label}</div>
                <div className="text-2xl font-semibold text-content">{stat.value}</div>
                <div className="text-xs text-content-muted">{stat.hint}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-content-secondary">
            <div className="flex items-center justify-between">
              <span>Coverage/source</span>
              <span className="font-semibold">{coverageStats.perSource ?? 'N/A'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Evidence/signal</span>
              <span className="font-semibold">{evidenceStats.evidencePerSignal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Actions/signal</span>
              <span className="font-semibold">{evidenceStats.actionsPerSignal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Topics covered</span>
              <span className="font-semibold">{coverageStats.topicsCoveredPercent !== null ? `${coverageStats.topicsCoveredPercent}%` : 'N/A'}</span>
            </div>
          </div>
          <div className="text-xs text-content-muted">
            Window {freshnessStats.windowLabel ?? 'N/A'}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-content-muted">Trend Tags</p>
              <p className="text-base font-bold text-content">Active focus</p>
            </div>
            {onAskAI && (
              <button
                type="button"
                onClick={() => onAskAI('Summarize trend tags and highlight emerging themes.')}
                className="px-3 py-1 text-xs font-bold border border-edge text-content-secondary hover:text-content hover:border-content transition-colors"
              >
                Ask agent
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {trendTags.length > 0 ? (
              trendTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onAskAI?.(`Track "${tag}" and surface the latest signals and actions.`)}
                  className="px-3 py-1 text-xs font-bold tracking-tight border border-edge bg-background text-content-secondary hover:text-content hover:border-content transition-colors"
                >
                  {tag}
                </button>
              ))
            ) : (
              <span className="text-xs text-content-muted">No tags available yet.</span>
            )}
          </div>
          {actI?.filteredOutNote && (
            <div className="rounded-md border border-edge bg-background p-3 text-xs text-content-secondary">
              <div className="text-xs font-bold text-content-muted">Filtered</div>
              <div className="mt-1">{actI.filteredOutNote}</div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-content-muted">Source log</p>
              <p className="text-base font-bold text-content">How sources were retrieved</p>
            </div>
            {onAskAI && (
              <button
                type="button"
                onClick={() => onAskAI('Audit provenance sources and highlight any retrieval gaps.')}
                className="px-3 py-1 text-xs font-bold border border-edge text-content-secondary hover:text-content hover:border-content transition-colors"
              >
                Ask agent
              </button>
            )}
          </div>
          <div className="space-y-3">
            {provenanceLog.length > 0 ? (
              provenanceLog.map((entry: any, idx: number) => (
                <div key={`${entry.connector}-${idx}`} className="rounded-md border border-edge bg-background p-3 space-y-1">
                  <div className="text-xs font-bold text-content-muted">
                    {entry.connector || 'Source'} - {entry.resultCount ?? 0} hits
                  </div>
                  <div className="text-xs text-content-secondary">{entry.query}</div>
                  {entry.retrievedAt && (
                    <div className="text-xs text-content-muted">Retrieved {new Date(entry.retrievedAt).toLocaleTimeString()}</div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-xs text-content-muted">No provenance log attached.</div>
            )}
          </div>
          {generationMeta && (
            <div className="rounded-md border border-edge bg-background p-3 space-y-2">
              <div className="text-xs font-bold text-content-muted">Generation</div>
              <div className="grid grid-cols-2 gap-2 text-xs text-content-secondary">
                <div className="flex items-center justify-between">
                  <span>Model</span>
                  <span className="font-semibold">{generationMeta.model ?? 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status</span>
                  <span className="font-semibold">{generationMeta.validationStatus ?? 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Retries</span>
                  <span className="font-semibold">{generationMeta.retryCount ?? 0}</span>
                </div>
                {generationMeta.tokenUsage && (
                  <div className="flex items-center justify-between">
                    <span>Tokens</span>
                    <span className="font-semibold">{generationMeta.tokenUsage.total}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-12">
        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-content-muted">Signal Overview</p>
              <p className="text-base font-bold text-content">Active Signals</p>
            </div>
            {onAskAI && (
              <button
                type="button"
                onClick={() => onAskAI('Summarize the signal ledger and surface outliers.')}
                className="px-3 py-1 text-xs font-bold border border-edge text-content-secondary hover:text-content hover:border-content transition-colors"
              >
                Ask agent
              </button>
            )}
          </div>
          <div className="space-y-2">
            {signalLedger.length > 0 ? (
              signalLedger.map((signal, index) => (
                <div key={signal.id} className="rounded-md border border-edge bg-background px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-bold text-content-muted">Signal {index + 1}</div>
                      {signal.label && (
                        <span className="text-xs font-bold text-content border border-edge px-2 py-0.5">
                          {signal.label}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-content">{signal.headline}</div>
                    {signal.deltaSummary && (
                      <div className="text-xs text-content-secondary mt-1">{signal.deltaSummary}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-content-secondary">
                    <span>Evidence {signal.evidenceCount}</span>
                    <span>Actions {signal.linkedActions}</span>
                    {onAskAI && (
                      <button
                        type="button"
                        onClick={() => onAskAI(`Deep dive on signal: ${signal.headline}`)}
                        className="px-2 py-0.5 border border-edge text-content-secondary hover:text-content hover:border-content transition-colors"
                      >
                        Analyze
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-content-muted">No signals available yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-content-muted">Deep Agent Launchpad</p>
            <p className="text-base font-bold text-content">Runbook shortcuts</p>
          </div>
          <div className="space-y-2">
            {agentLaunchpad.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onAskAI?.(item.prompt)}
                className="w-full text-left rounded-md border border-edge bg-background px-4 py-3 text-xs font-semibold text-content-secondary hover:text-content hover:border-content transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-edge bg-background px-4 py-3 space-y-2">
            <div className="text-xs font-bold text-content-muted">Action mix</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-content-secondary">
              <div className="flex items-center justify-between">
                <span>High</span>
                <span className="font-semibold">{actionMix.high}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Medium</span>
                <span className="font-semibold">{actionMix.medium}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Low</span>
                <span className="font-semibold">{actionMix.low}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Other</span>
                <span className="font-semibold">{actionMix.other}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(coverageItems.length > 0 || coverageRollup?.overallSummary) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-12">
          <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
            <div>
              <p className="text-xs font-bold text-content-muted">Coverage Rollup</p>
              <p className="text-base font-bold text-content">Map-reduced synthesis</p>
            </div>
            <div className="text-sm text-content-secondary leading-relaxed">
              {coverageRollup?.overallSummary
                ? coverageRollup.overallSummary
                : `Coverage spans ${coverageItems.length} summarized items across the feed.`}
            </div>
            {coverageSourceSummaries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-content-muted">By source</p>
                {coverageSourceSummaries.slice(0, 6).map((entry: { source: string; count: number | null; summary: string }, idx: number) => (
                  <div key={`${entry.source}-${idx}`} className="text-xs text-content-secondary">
                    <span className="font-semibold text-content-secondary">{entry.source}</span>
                    {entry.count !== null && <span className="text-content-muted"> ({entry.count})</span>}
                    <span className="text-content-secondary line-clamp-1"> — {entry.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-edge bg-surface p-5 space-y-4 xl:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-content-muted">Full Coverage</p>
                <p className="text-base font-bold text-content">All article summaries</p>
              </div>
              {coverageItems.length > 12 && (
                <button
                  type="button"
                  onClick={() => setIsCoverageExpanded((prev) => !prev)}
                  className="text-xs font-bold text-content-secondary border border-edge px-3 py-1 hover:text-content hover:border-content transition-colors"
                >
                  {isCoverageExpanded ? 'Show fewer' : `Show all ${coverageItems.length}`}
                </button>
              )}
            </div>
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
              {(isCoverageExpanded ? coverageItems : coverageItems.slice(0, 12)).map((item, idx) => (
                <div key={`${item.title}-${idx}`} className="rounded-md border border-edge bg-background px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-content-muted">
                    <span>{item.source ?? 'Source'}</span>
                    {item.category && <span className="text-content-muted">• {item.category}</span>}
                  </div>
                  {item.url ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenReader) {
                          onOpenReader({
                            title: item.title,
                            url: item.url,
                            source: item.source,
                            summary: item.summary,
                            category: item.category,
                          });
                          return;
                        }
                        window.open(item.url, "_blank", "noopener,noreferrer");
                      }}
                      className="text-sm font-semibold text-content hover:text-content transition-colors text-left"
                    >
                      {item.title}
                    </button>
                  ) : (
                    <div className="text-sm font-semibold text-content">{item.title}</div>
                  )}
                  <div className="text-xs text-content-secondary mt-1 line-clamp-2">{item.summary}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Act Navigation */}
      <div className="flex items-center gap-4 mb-12 overflow-x-auto pb-6 scrollbar-hide">
        {[
          { id: 'actI', label: 'Overview', subtitle: 'Coverage', icon: BarChart2 },
          { id: 'actII', label: 'Signals', subtitle: 'What changed', icon: Zap },
          { id: 'actIII', label: 'Actions', subtitle: 'Next steps', icon: ExternalLink },
        ].map((act, idx) => (
          <React.Fragment key={act.id}>
            <button
              onClick={() => handleActChange(act.id as ActiveAct)}
              className={`group flex flex-col items-start gap-1.5 min-w-[160px] p-0 transition-opacity duration-300 ${activeAct === act.id
                ? 'opacity-100'
                : 'opacity-60 hover:opacity-80'
                }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${activeAct === act.id ? 'bg-content' : 'bg-surface-hover'}`} />
                <span className="text-xs font-bold text-content">{act.label}</span>
              </div>
              <span className="text-2xl font-medium text-content leading-none italic">{act.subtitle}</span>

              {activeAct === act.id && (
                instant ? (
                  <div className="h-0.5 w-full bg-content mt-3" />
                ) : (
                  <motion.div
                    layoutId="act-underline"
                    className="h-0.5 w-full bg-content mt-3"
                  />
                )
              )}
            </button>
            {idx < 2 && (
              <div className="w-12 h-[1px] bg-surface-secondary shrink-0 mx-4" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Act Content */}
      <div className="space-y-6 animate-in fade-in duration-500">
        {activeAct === 'actI' && actI && (
          <ActIContent
            data={actI}
            onAskAI={onAskAI}
          />
        )}
        {activeAct === 'actII' && actII && (
          <ActIIContent
            data={actII}
            onAskAI={onAskAI}
            onOpenReader={onOpenReader}
          />
        )}
        {activeAct === 'actIII' && actIII && (
          <ActIIIContent
            data={actIII}
            onAskAI={onAskAI}
          />
        )}
      </div>
    </div>
  );
}

function formatBriefSectionTitle(rawTitle: unknown, fallback: string) {
  const raw = String(rawTitle ?? "").trim();
  if (!raw) return fallback;

  let t = raw;
  // Remove narrative prefixes like "Act I — Setup:" to avoid internal/judgy phrasing in the UI.
  t = t.replace(/^act\s*[ivx0-9]+\s*[\u2014\u2013:-]\s*/i, "");
  t = t.replace(/^(setup|rising action|deep dives)\s*[\u2014\u2013:-]\s*/i, "");
  // If a colon remains, prefer the most specific suffix.
  if (t.includes(":")) t = t.split(":").slice(-1)[0].trim();
  t = t.replace(/\s+/g, " ").trim();
  return t || fallback;
}

// Act I: Setup / Coverage
function ActIContent({ data, onAskAI }: { data: any; onAskAI?: (prompt: string) => void }) {
  const actTopSources = Array.isArray(data.topSources)
    ? data.topSources
      .map((source: any) => normalizeSourceEntry(source))
      .filter((entry: unknown): entry is { name: string; count: string | number | null } => Boolean(entry))
      .slice(0, 5)
    : [];

  return (
    <div className="p-10 border-y border-edge bg-transparent transition-all duration-500 group">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-1.5 h-12 bg-content" />
        <h3 className="text-4xl font-medium text-content tracking-tight">{data.headline || 'Market Foundation'}</h3>
      </div>
      <p className="text-xl font-medium text-content mb-12 leading-relaxed italic border-l-2 border-edge pl-8">
        "<CrossLinkedText text={data.synthesis || data.summary || 'Establishing the baseline for today\'s market movements...'} onAskAI={onAskAI} />"
      </p>

      {/* Stats */}
      {data.stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border-y border-edge mb-10 divide-y sm:divide-y-0 sm:divide-x divide-edge">
          {Object.entries(data.stats).slice(0, 3).map(([key, value]) => (
            <div key={key} className="p-6 flex flex-col items-center text-center group hover:bg-surface-hover transition-colors">
              <p className="text-xs font-medium text-content-muted mb-3">{key.replace(/_/g, ' ')}</p>
              <p className="text-4xl font-medium text-content">{String(value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top Sources */}
      {actTopSources.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs font-bold text-content-muted">Primary Signal Sources</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {actTopSources.map((source: { name: string; count: string | number | null }, idx: number) => (
              <span
                key={`${source.name}-${idx}`}
                className="px-0 py-1 text-[13px] font-medium text-content-secondary border-b border-edge hover:border-content hover:text-content transition-all cursor-default"
              >
                {source.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Act II: Signals
function ActIIContent({
  data,
  onAskAI,
  onOpenReader,
}: {
  data: any;
  onAskAI?: (prompt: string) => void;
  onOpenReader?: (item: {
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    publishedAt?: string;
    relevance?: string;
  }) => void;
}) {
  const signals = data.signals || [];

  return (
    <div className="space-y-4">
      {signals.length === 0 ? (
        <div className="p-12 text-center text-content-secondary border border-edge rounded-lg bg-surface italic">
          <p className="text-sm">No distinct signals detected in this cycle.</p>
        </div>
      ) : (
        signals.map((signal: any, idx: number) => (
          <div key={idx} className="group p-10 border border-edge bg-background hover:shadow-xl transition-all duration-500">
            <div className="flex items-start justify-between gap-12">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-xs font-bold text-content border border-edge px-3 py-1">Signal {idx + 1}</span>
                  {signal.label && (
                    <span className="text-xs font-bold text-content-secondary border border-edge px-3 py-1">
                      {signal.label}
                    </span>
                  )}
                </div>
                <h4 className="text-3xl font-medium text-content mb-6 tracking-tight group-hover:text-content transition-colors italic">{signal.headline}</h4>
                {signal.deltaSummary && (
                  <div className="mb-4 text-sm text-content-secondary">
                    <span className="text-xs font-bold text-content-muted">Delta</span>
                    <span className="ml-2">{signal.deltaSummary}</span>
                  </div>
                )}
                <div className="text-xl text-content-secondary leading-relaxed">
                  <CrossLinkedText text={signal.synthesis || signal.summary} onAskAI={onAskAI} />
                </div>
                <SignalMomentumMini keyword={signal.label || signal.headline} />
              </div>
              {onAskAI && (
                <button
                  onClick={() => onAskAI(`Tell me more about: ${signal.headline}`)}
                  className="shrink-0 px-6 py-3 text-xs font-bold text-content border border-content hover:bg-content hover:text-background transition-all"
                >
                  Analyze
                </button>
              )}
            </div>

            {/* Evidence links */}
            {signal.evidence && signal.evidence.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-4 items-center pt-8 border-t border-edge/60">
                <span className="text-xs font-bold text-content-muted">Citations</span>
                {signal.evidence.slice(0, 4).map((ev: any, evIdx: number) => (
                  <button
                    key={evIdx}
                    type="button"
                    onClick={() => {
                      if (onOpenReader) {
                        onOpenReader({
                          title: ev.title,
                          url: ev.url,
                          source: ev.source,
                          summary: ev.relevance,
                          publishedAt: ev.publishedAt,
                          relevance: ev.relevance,
                        });
                        return;
                      }
                      if (ev.url) {
                        window.open(ev.url, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="flex items-center gap-2 group/link"
                  >
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-surface-secondary text-xs font-bold text-content-secondary group-hover/link:bg-content group-hover/link:text-white transition-colors">{evIdx + 1}</span>
                    <span className="text-xs font-medium text-content-secondary hover:text-content border-b border-transparent hover:border-content transition-all font-mono">
                      {ev.source || ev.title?.slice(0, 20) || `Node ${evIdx + 1}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// Act III: Actions
function ActIIIContent({ data, onAskAI }: { data: any; onAskAI?: (prompt: string) => void }) {
  const actions = data.actions || [];

  return (
    <div className="space-y-4">
      {actions.length === 0 ? (
        <div className="p-12 text-center text-content-secondary border border-edge rounded-lg bg-surface italic">
          <p className="text-sm">Strategic landscape is currently stable.</p>
        </div>
      ) : (
        actions.map((action: any, idx: number) => (
          <div key={idx} className="p-8 border border-edge rounded-lg bg-surface hover:shadow-xl transition-all border-l-4 border-l-content">
            <div className="flex items-start gap-6">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 shadow-lg ${action.priority === 'high' ? 'bg-red-600 text-white' :
                action.priority === 'medium' ? 'bg-amber-500 text-white' :
                  'bg-content text-white'
                }`}>
                <span className="text-lg font-bold">{idx + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold ${action.priority === 'high' ? 'text-red-500' : 'text-content-secondary'
                    }`}>
                    {action.priority || 'Standard'} Priority
                  </span>
                  {action.deadline && <span className="text-xs font-medium text-content-secondary">- {action.deadline}</span>}
                </div>
                <h4 className="text-3xl font-bold text-content mb-4 tracking-tight italic leading-tight">
                  <CrossLinkedText text={action.title || action.headline} onAskAI={onAskAI} />
                </h4>
                <div className="text-base text-content font-medium leading-relaxed mb-6">
                  <CrossLinkedText text={action.description || action.rationale} onAskAI={onAskAI} />
                </div>
                <SignalMomentumMini keyword={action.title || action.headline || "signal"} />
                {(action.status || action.deliverable || action.expectedOutcome || action.risks) && (
                  <div className="rounded-md border border-edge bg-background p-4 text-xs text-content-secondary space-y-2">
                    <div className="text-xs font-bold text-content-muted">Action Specs</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {action.status && (
                        <div className="flex items-center justify-between">
                          <span>Status</span>
                          <span className="font-semibold">{action.status}</span>
                        </div>
                      )}
                      {action.deliverable && (
                        <div className="flex items-center justify-between">
                          <span>Deliverable</span>
                          <span className="font-semibold">{action.deliverable}</span>
                        </div>
                      )}
                      {action.expectedOutcome && (
                        <div className="flex items-center justify-between">
                          <span>Outcome</span>
                          <span className="font-semibold">{action.expectedOutcome}</span>
                        </div>
                      )}
                      {action.risks && (
                        <div className="flex items-center justify-between">
                          <span>Risks</span>
                          <span className="font-semibold">{action.risks}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Attribution UI */}
                {(action.linkedSignalIds && action.linkedSignalIds.length > 0) && (
                  <div className="mt-8 pt-6 border-t border-edge flex flex-col gap-3">
                    <span className="text-xs font-bold text-content-muted">Triggered By Signals</span>
                    <div className="flex flex-wrap gap-2">
                      {action.linkedSignalIds.map((sigId: string) => (
                        <div key={sigId} className="px-2 py-1 bg-indigo-500/10 text-content text-xs font-bold border border-indigo-500/20 flex items-center gap-2">
                          <Zap className="w-3 h-3" />
                          <span>SIGNAL_{sigId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {onAskAI && (
                <button
                  onClick={() => onAskAI(`Implementation strategy for: ${action.title || action.headline}`)}
                  className="shrink-0 px-8 py-4 text-xs font-bold text-background bg-content hover:bg-black transition-all shadow-xl"
                >
                  Execute
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Wrap with ErrorBoundary
export function BriefingSection(props: BriefingSectionProps) {
  return (
    <ErrorBoundary
      section="Briefing"
      fallback={<BriefingErrorFallback onRetry={() => window.location.reload()} />}
    >
      <BriefingSectionInner {...props} />
    </ErrorBoundary>
  );
}

export default BriefingSection;
