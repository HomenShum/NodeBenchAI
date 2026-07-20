"use client";

import React, { useState, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import {
  ThumbsUp,
  ThumbsDown,
  Eye,
  EyeOff,
  AlertTriangle,
  TrendingUp,
  Clock,
  BarChart3,
  PieChart,
  Activity,
  Compass,
  Mic,
  Sparkles,
  Bot,
  CheckCircle2,
} from 'lucide-react';
import { SignatureOrb } from '../../../shared/ui/SignatureOrb';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
  color?: 'green' | 'red' | 'blue' | 'yellow' | 'gray';
}

function MetricCard({ title, value, subtitle, icon, trend, color = 'blue' }: MetricCardProps) {
  const dotColor = {
    green: 'bg-green-500',
    red: 'bg-red-500',
    blue: 'bg-[var(--accent-primary)]',
    yellow: 'bg-yellow-500',
    gray: 'bg-content-muted',
  };

  return (
    <div className="bg-surface border border-edge rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor[color]}`} />
          <span className="text-sm font-medium text-content-secondary">{title}</span>
        </div>
        <div className="text-content-muted">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-content mb-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {subtitle && <div className="text-xs text-content-muted">{subtitle}</div>}
      {trend && (
        <div className={`flex items-center gap-1 text-xs mt-2 ${trend.direction === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
          <TrendingUp size={12} className={trend.direction === 'down' ? 'rotate-180' : ''} />
          <span>{Math.abs(trend.value)}%</span>
        </div>
      )}
    </div>
  );
}

interface RejectionReasonBarProps {
  reason: string;
  count: number;
  maxCount: number;
}

function RejectionReasonBar({ reason, count, maxCount }: RejectionReasonBarProps) {
  const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div className="py-2 border-b border-edge last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm text-content-secondary truncate flex-1">
          {reason || 'No reason given'}
        </div>
        <div className="text-xs text-content-secondary font-mono ml-2">
          {count} {count === 1 ? 'rejection' : 'rejections'}
        </div>
      </div>
      <div className="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-red-500/60 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface IntentSignalRowProps {
  label: string;
  attempts: number;
  rateLabel: string;
  rateValue: number;
  tone: 'blue' | 'yellow' | 'red';
  subtitle?: string | null;
}

type IntentHotspotCard = {
  id: string;
  title: string;
  status: string;
  startedAt: number;
  updatedAt?: number;
  signature: string;
  column: string;
  intentKey: string;
  action: string;
  attempts: number;
  handledRate: number;
  fallbackRate: number;
  failureRate: number;
  hotnessScore: number;
  frictionScore: number;
  lastSeenAt: number;
  sampleInput?: string;
  sources: string[];
  targetViews: string[];
  investigationArtifactId?: string;
  investigationTitle?: string;
  investigationPreview?: string;
  investigationModelUsed?: string;
  investigationRanAt?: number;
};

function formatRelativeHours(timestamp: number) {
  const deltaHours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
  if (deltaHours < 1) return '<1h ago';
  if (deltaHours < 24) return `${deltaHours.toFixed(1)}h ago`;
  return `${(deltaHours / 24).toFixed(1)}d ago`;
}

function IntentSignalRow({ label, attempts, rateLabel, rateValue, tone, subtitle }: IntentSignalRowProps) {
  const toneClass = {
    blue: 'bg-[var(--accent-primary)]/70',
    yellow: 'bg-yellow-500/70',
    red: 'bg-red-500/70',
  }[tone];

  const width = Math.max(8, Math.min(100, rateValue));

  return (
    <div className="py-2 border-b border-edge last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-content truncate">{label}</div>
          {subtitle ? <div className="text-xs text-content-muted truncate">{subtitle}</div> : null}
        </div>
        <div className="text-right text-xs text-content-secondary shrink-0">
          <div>{attempts} attempts</div>
          <div>{rateLabel}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${toneClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function RecommendationAnalyticsDashboard() {
  const [dateRange, setDateRange] = useState<{ start?: number; end?: number }>({});
  const [hotspotActionId, setHotspotActionId] = useState<string | null>(null);

  // Get acceptance rate data
  const acceptanceData = useQuery(
    api.domains.recomm.feedback.getRecommendationAcceptanceRate,
    dateRange
  );

  // Get top rejection reasons
  const rejectionReasons = useQuery(
    api.domains.recomm.feedback.getTopRejectionReasons,
    {
      startDate: dateRange.start,
      endDate: dateRange.end,
      limit: 10,
    }
  );

  // Get average time to action
  const avgTimeData = useQuery(
    api.domains.recomm.feedback.getAverageTimeToAction,
    {}
  );

  const intentRadar = useQuery(
    api.domains.analytics.intentSignals.getIntentRadar,
    {
      startMs: dateRange.start,
      endMs: dateRange.end,
      limit: 6,
    }
  );

  const intentHotspotCards = useQuery(
    api.domains.analytics.intentSignals.listIntentHotspotCards,
    {
      limit: 6,
    },
  ) as IntentHotspotCard[] | undefined;

  const moveIntentHotspotCard = useMutation(
    api.domains.analytics.intentSignals.moveIntentHotspotCard,
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!acceptanceData) return null;

    const {
      total,
      accepted,
      rejected,
      ignored,
      dismissed,
      snoozed,
      acceptanceRate,
      rejectionRate,
      avgValue,
    } = acceptanceData;

    const engagementRate = total > 0 ? (accepted + rejected) / total : 0;
    const ignoreRate = total > 0 ? ignored / total : 0;

    return {
      total,
      accepted,
      rejected,
      ignored,
      dismissed,
      snoozed,
      acceptanceRate,
      rejectionRate,
      engagementRate,
      ignoreRate,
      avgValue,
    };
  }, [acceptanceData]);

  const maxReasonCount = rejectionReasons && rejectionReasons.length > 0
    ? Math.max(...rejectionReasons.map(r => r.count))
    : 0;

  const intentSummary = intentRadar?.summary;
  const isLoading =
    acceptanceData === undefined ||
    rejectionReasons === undefined ||
    intentRadar === undefined ||
    intentHotspotCards === undefined;

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="type-page-title text-content flex items-center gap-2">
              <BarChart3 size={32} />
              Recommendation Analytics
            </h1>
            <p className="text-content-secondary mt-1">
              User feedback and engagement metrics for recommendations
            </p>
          </div>

          {/* Date Range Selector */}
          <div className="flex items-center gap-3">
            <select
              value={dateRange.start ? 'custom' : 'all'}
              onChange={(e) => {
                if (e.target.value === 'all') {
                  setDateRange({});
                } else if (e.target.value === '7d') {
                  setDateRange({
                    start: Date.now() - 7 * 24 * 60 * 60 * 1000,
                    end: Date.now(),
                  });
                } else if (e.target.value === '30d') {
                  setDateRange({
                    start: Date.now() - 30 * 24 * 60 * 60 * 1000,
                    end: Date.now(),
                  });
                }
              }}
              className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-content focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Time</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 no-skeleton-animation" aria-busy="true" aria-live="polite">
            <SignatureOrb variant="loading" />
          </div>
        )}

        {/* Metrics Content */}
        {!isLoading && metrics && (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="Total Recommendations"
                value={metrics.total}
                subtitle="Shown to users"
                icon={<Eye size={20} />}
                color="blue"
              />

              <MetricCard
                title="Acceptance Rate"
                value={`${parseFloat((metrics.acceptanceRate * 100).toFixed(1))}%`}
                subtitle={`${metrics.accepted} accepted`}
                icon={<ThumbsUp size={20} />}
                color="green"
              />

              <MetricCard
                title="Rejection Rate"
                value={`${parseFloat((metrics.rejectionRate * 100).toFixed(1))}%`}
                subtitle={`${metrics.rejected} rejected`}
                icon={<ThumbsDown size={20} />}
                color="red"
              />

              <MetricCard
                title="Ignore Rate"
                value={`${parseFloat((metrics.ignoreRate * 100).toFixed(1))}%`}
                subtitle={`${metrics.ignored} ignored`}
                icon={<EyeOff size={20} />}
                color="yellow"
              />
            </div>

            {/* Second Row Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard
                title="Engagement Rate"
                value={`${parseFloat((metrics.engagementRate * 100).toFixed(1))}%`}
                subtitle="Accepted or rejected"
                icon={<Activity size={20} />}
                color="blue"
              />

              <MetricCard
                title="Average Rating"
                value={metrics.avgValue !== null ? `${(metrics.avgValue * 5).toFixed(1)}/5.0` : 'No ratings yet'}
                subtitle={metrics.avgValue !== null ? 'From accepted recommendations' : 'Users haven\'t rated yet'}
                icon={<ThumbsUp size={20} />}
                color={metrics.avgValue !== null ? 'green' : 'gray'}
              />

              <MetricCard
                title="Avg Time to Action"
                value={avgTimeData?.avgTimeMs ? `${avgTimeData.avgTimeSeconds.toFixed(1)}s` : 'No data yet'}
                subtitle={avgTimeData?.count ? `${avgTimeData.count} actions tracked` : 'No actions yet'}
                icon={<Clock size={20} />}
                color="blue"
              />
            </div>

            <div className="bg-surface border border-edge rounded-lg p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-content flex items-center gap-2">
                    <Compass size={18} />
                    Intent Loop
                  </h2>
                  <p className="text-sm text-content-secondary mt-1">
                    What users are trying to do, what is getting handled, and where the UI still leaks to fallback.
                  </p>
                </div>
                <div className="text-xs text-content-muted text-right">
                  {intentSummary?.lastSignalAgeHours !== null && intentSummary?.lastSignalAgeHours !== undefined
                    ? `Last signal ${intentSummary.lastSignalAgeHours.toFixed(1)}h ago`
                    : 'No recent intent data'}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard
                  title="Intent Signals"
                  value={intentSummary?.totalSignals ?? 0}
                  subtitle="Tracked voice, text, and navigation attempts"
                  icon={<Activity size={20} />}
                  color="blue"
                />
                <MetricCard
                  title="Handled Rate"
                  value={`${intentSummary?.handledRate?.toFixed?.(1) ?? '0.0'}%`}
                  subtitle={`${intentSummary?.handled ?? 0} commands completed directly`}
                  icon={<TrendingUp size={20} />}
                  color="green"
                />
                <MetricCard
                  title="Fallback Rate"
                  value={`${intentSummary?.fallbackRate?.toFixed?.(1) ?? '0.0'}%`}
                  subtitle={`${intentSummary?.fallback ?? 0} requests spilled into agent chat`}
                  icon={<Mic size={20} />}
                  color="yellow"
                />
                <MetricCard
                  title="Unique Intents"
                  value={intentSummary?.uniqueIntents ?? 0}
                  subtitle={`${intentSummary?.daysCovered ?? 0} day coverage`}
                  icon={<BarChart3 size={20} />}
                  color="blue"
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
                <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content">Hot Now</h3>
                    <span className="text-xs text-content-muted">{intentRadar?.hottest?.length ?? 0} intents</span>
                  </div>
                  {!intentRadar?.hottest?.length ? (
                    <div className="text-sm text-content-secondary py-6">No ranked intents yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {intentRadar.hottest.map((item: any) => (
                        <IntentSignalRow
                          key={item.intentKey}
                          label={item.label}
                          attempts={item.attempts}
                          rateLabel={`Hotness ${item.hotnessScore.toFixed(1)}`}
                          rateValue={Math.min(100, item.hotnessScore * 4)}
                          tone="blue"
                          subtitle={item.sampleInput ? `Example: "${item.sampleInput}"` : null}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content flex items-center gap-2">
                      <AlertTriangle size={16} />
                      Friction Radar
                    </h3>
                    <span className="text-xs text-content-muted">{intentRadar?.friction?.length ?? 0} hotspots</span>
                  </div>
                  {!intentRadar?.friction?.length ? (
                    <div className="text-sm text-content-secondary py-6">No fallback or failure hotspots in range.</div>
                  ) : (
                    <div className="space-y-1">
                      {intentRadar.friction.map((item: any) => (
                        <IntentSignalRow
                          key={item.intentKey}
                          label={item.label}
                          attempts={item.attempts}
                          rateLabel={`${item.fallbackRate.toFixed(1)}% fallback, ${item.failureRate.toFixed(1)}% failed`}
                          rateValue={Math.min(100, item.frictionScore * 8)}
                          tone={item.failed > 0 ? 'red' : 'yellow'}
                          subtitle={item.sources?.length ? `Sources: ${item.sources.join(', ')}` : null}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content flex items-center gap-2">
                      <Sparkles size={16} />
                      Simplify Next
                    </h3>
                    <span className="text-xs text-content-muted">{intentRadar?.opportunities?.length ?? 0} ideas</span>
                  </div>
                  {!intentRadar?.opportunities?.length ? (
                    <div className="text-sm text-content-secondary py-6">
                      No automatic simplification prompts yet. More usage data will populate this.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {intentRadar.opportunities.map((item: any, index: number) => (
                        <div key={`${item.title}-${index}`} className="rounded-lg border border-edge bg-surface px-3 py-3">
                          <div className="text-sm font-medium text-content">{item.title}</div>
                          <div className="text-xs text-content-secondary mt-1">{item.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content">Channel Mix</h3>
                    <span className="text-xs text-content-muted">{intentRadar?.sourceBreakdown?.length ?? 0} sources</span>
                  </div>
                  {!intentRadar?.sourceBreakdown?.length ? (
                    <div className="text-sm text-content-secondary py-6">No channel breakdown yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {intentRadar.sourceBreakdown.map((item: any) => (
                        <IntentSignalRow
                          key={item.source}
                          label={item.source}
                          attempts={item.attempts}
                          rateLabel={`${item.handledRate.toFixed(1)}% handled`}
                          rateValue={item.handledRate}
                          tone="blue"
                          subtitle={`${item.fallbackRate.toFixed(1)}% fallback, ${item.failureRate.toFixed(1)}% failed`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-content">Recent Signals</h3>
                    <span className="text-xs text-content-muted">{intentRadar?.recentSignals?.length ?? 0} events</span>
                  </div>
                  {!intentRadar?.recentSignals?.length ? (
                    <div className="text-sm text-content-secondary py-6">No recent intent events yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {intentRadar.recentSignals.map((item: any, index: number) => (
                        <div key={`${item.intentKey}-${item.occurredAt}-${index}`} className="rounded-lg border border-edge bg-surface px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-content truncate">{item.label}</div>
                              <div className="text-xs text-content-secondary truncate">
                                {item.source} · {item.status} · {item.route || 'unknown route'}
                              </div>
                            </div>
                            <div className="text-[11px] text-content-muted shrink-0">
                              {new Date(item.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </div>
                          </div>
                          {item.inputText ? (
                            <div className="mt-2 text-xs text-content-muted truncate">
                              "{item.inputText}"
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-surface-secondary/60 border border-edge rounded-lg p-4 mt-4">
                <div className="flex items-center justify-between mb-3 gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-content flex items-center gap-2">
                      <Bot size={16} />
                      Escalated Hotspots
                    </h3>
                    <p className="text-xs text-content-secondary mt-1">
                      Severe friction cards promoted from telemetry into the operator loop.
                    </p>
                  </div>
                  <span className="text-xs text-content-muted">{intentHotspotCards?.length ?? 0} cards</span>
                </div>
                {!intentHotspotCards?.length ? (
                  <div className="text-sm text-content-secondary py-6">No escalated hotspot cards yet.</div>
                ) : (
                  <div className="space-y-3">
                    {intentHotspotCards.map((card) => {
                      const isBusy = hotspotActionId === card.id;
                      const canInvestigate = card.column === 'inbox';
                      const canComplete = card.column === 'human_review';
                      return (
                        <div key={card.id} className="rounded-lg border border-edge bg-surface px-4 py-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-content truncate">{card.title}</div>
                              <div className="text-xs text-content-secondary mt-1">
                                {card.column} / {card.status} / last seen {formatRelativeHours(card.lastSeenAt)}
                              </div>
                            </div>
                            <div className="text-right text-xs text-content-muted shrink-0">
                              <div>{card.attempts} attempts</div>
                              <div>{card.fallbackRate.toFixed(1)}% fallback</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-xs text-content-secondary">
                            <div className="rounded-md bg-surface-secondary px-3 py-2 border border-edge">
                              Hotness {card.hotnessScore.toFixed(1)}
                            </div>
                            <div className="rounded-md bg-surface-secondary px-3 py-2 border border-edge">
                              Friction {card.frictionScore.toFixed(1)}
                            </div>
                            <div className="rounded-md bg-surface-secondary px-3 py-2 border border-edge">
                              Failure {card.failureRate.toFixed(1)}%
                            </div>
                          </div>

                          {card.sampleInput ? (
                            <div className="mt-3 text-xs text-content-muted">
                              Example: "{card.sampleInput}"
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-content-muted">
                            <span>Sources: {card.sources.length ? card.sources.join(', ') : 'n/a'}</span>
                            <span>Views: {card.targetViews.length ? card.targetViews.join(', ') : 'n/a'}</span>
                            {card.investigationRanAt ? (
                              <span>Investigation {formatRelativeHours(card.investigationRanAt)}</span>
                            ) : null}
                          </div>

                          {card.investigationPreview ? (
                            <div className="mt-3 rounded-md border border-edge bg-surface-secondary px-3 py-3">
                              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-content-muted">
                                {card.investigationTitle || 'Investigation Brief'}
                              </div>
                              <div className="mt-2 text-xs leading-5 text-content-secondary whitespace-pre-wrap">
                                {card.investigationPreview}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            {canInvestigate ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={async () => {
                                  try {
                                    setHotspotActionId(card.id);
                                    await moveIntentHotspotCard({
                                      sessionId: card.id as any,
                                      toColumn: 'ralph_investigate',
                                    });
                                  } finally {
                                    setHotspotActionId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-2 rounded-md border border-edge bg-[var(--accent-primary)] px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Bot size={14} />
                                {isBusy ? 'Investigating...' : 'Investigate'}
                              </button>
                            ) : null}
                            {canComplete ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={async () => {
                                  try {
                                    setHotspotActionId(card.id);
                                    await moveIntentHotspotCard({
                                      sessionId: card.id as any,
                                      toColumn: 'done',
                                    });
                                  } finally {
                                    setHotspotActionId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-2 rounded-md border border-edge bg-green-600 px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <CheckCircle2 size={14} />
                                {isBusy ? 'Saving...' : 'Mark Done'}
                              </button>
                            ) : null}
                            {!canInvestigate && !canComplete ? (
                              <div className="text-xs text-content-muted">
                                {card.column === 'ralph_investigate'
                                  ? 'Investigation is queued.'
                                  : card.investigationPreview
                                    ? 'Investigation brief is attached below.'
                                    : card.investigationArtifactId
                                      ? `Investigation artifact ${card.investigationArtifactId}`
                                    : 'Awaiting next operator action.'}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Action Breakdown */}
            <div className="bg-surface border border-edge rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-content">
                  Action Breakdown
                </h2>
                <span className="text-sm text-content-secondary">
                  {metrics.total} total actions
                </span>
              </div>

              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: 'Accepted', value: metrics.accepted, dot: 'bg-green-500' },
                  { label: 'Rejected', value: metrics.rejected, dot: 'bg-red-500' },
                  { label: 'Ignored', value: metrics.ignored, dot: 'bg-yellow-500' },
                  { label: 'Dismissed', value: metrics.dismissed, dot: 'bg-content-muted' },
                  { label: 'Snoozed', value: metrics.snoozed, dot: 'bg-[var(--accent-primary)]' },
                ].map(({ label, value: v, dot }) => (
                  <div key={label} className="text-center p-3 bg-surface-secondary rounded-lg border border-edge">
                    <div className="text-2xl font-bold text-content">{v}</div>
                    <div className="flex items-center justify-center gap-1.5 mt-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className="text-xs text-content-muted">{label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Rejection Reasons */}
            <div className="bg-surface border border-edge rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-content">
                  Top Rejection Reasons
                </h2>
                <span className="text-sm text-content-secondary">
                  {rejectionReasons?.length || 0} unique reasons
                </span>
              </div>

              {!rejectionReasons || rejectionReasons.length === 0 ? (
                <div className="text-center py-8 text-content-secondary">
                  No rejection reasons recorded yet
                </div>
              ) : (
                <div className="space-y-1">
                  {rejectionReasons.map((reason, index) => (
                    <RejectionReasonBar
                      key={index}
                      reason={reason.reason}
                      count={reason.count}
                      maxCount={maxReasonCount}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Insights */}
            {metrics.total > 0 && (
              <div className="bg-indigo-500/10 border border-indigo-500/30/25 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <PieChart className="text-indigo-600 dark:text-indigo-400 mt-0.5" size={20} />
                  <div>
                    <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1">
                      Insights
                    </h3>
                    <ul className="text-sm text-content-secondary space-y-1">
                      {metrics.acceptanceRate > 0.5 && (
                        <li>✓ High acceptance rate ({(metrics.acceptanceRate * 100).toFixed(0)}%) - recommendations are valuable</li>
                      )}
                      {metrics.acceptanceRate < 0.2 && metrics.total > 10 && (
                        <li>⚠ Low acceptance rate ({(metrics.acceptanceRate * 100).toFixed(0)}%) - consider improving recommendation quality</li>
                      )}
                      {metrics.ignoreRate > 0.5 && (
                        <li>⚠ High ignore rate ({(metrics.ignoreRate * 100).toFixed(0)}%) - recommendations may not be relevant or timely</li>
                      )}
                      {metrics.avgValue && metrics.avgValue > 0.8 && (
                        <li>✓ High average rating ({(metrics.avgValue * 5).toFixed(1)}/5) - users find recommendations very helpful</li>
                      )}
                      {avgTimeData?.avgTimeSeconds && avgTimeData.avgTimeSeconds < 5 && (
                        <li>✓ Quick decision time ({avgTimeData.avgTimeSeconds.toFixed(1)}s) - recommendations are clear and actionable</li>
                      )}
                      {avgTimeData?.avgTimeSeconds && avgTimeData.avgTimeSeconds > 30 && (
                        <li>⚠ Slow decision time ({avgTimeData.avgTimeSeconds.toFixed(1)}s) - recommendations may be unclear or complex</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {metrics.total === 0 && (
              <div className="bg-surface border border-edge rounded-lg p-12 text-center">
                <SignatureOrb variant="empty" message="No recommendation data yet — feedback will appear here once users interact with suggestions." />
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
