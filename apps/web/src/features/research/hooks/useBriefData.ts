/**
 * useBriefData - Centralized morning brief data fetching
 *
 * Provides:
 * - Latest brief memory from Convex
 * - Executive brief record (3-Act structure)
 * - Dashboard metrics
 * - Historical snapshots
 * - Trustworthy suppression when the brief is stale or too sparse
 */

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { normalizeBriefDateString } from '@/lib/briefDate';
// Source-of-truth types live in `dailyBriefSchema.ts`; the duplicates in
// `../types.ts` are a legacy minimal shape that predates the full schema.
// Importing from the canonical module unblocks `BriefingSection` consumers
// that access `meta`, `quality`, `totalItems`, `sourcesCount`, etc.
import type { DailyBriefPayload, ExecutiveBriefRecord } from '../types/dailyBriefSchema';

const BRIEF_MAX_AGE_HOURS = 18;
const BRIEF_MIN_ITEMS = 3;

export function resolveBriefLatestTimestamp(brief: DailyBriefPayload | null | undefined): string | null {
  if (!brief) return null;
  return (
    brief.actI?.latestItemAt ??
    brief.quality?.freshness?.newestAt ??
    (brief.meta?.date ? `${brief.meta.date}T23:59:59.000Z` : null)
  );
}

export function resolveBriefItemCount(brief: DailyBriefPayload | null | undefined): number {
  if (!brief) return 0;
  return Math.max(
    Number(brief.quality?.coverage?.itemsScanned ?? 0),
    Number(brief.actI?.totalItems ?? 0),
    Array.isArray(brief.actII?.signals) ? brief.actII.signals.length : 0,
  );
}

export function shouldSuppressBrief(
  brief: DailyBriefPayload | null | undefined,
  now = Date.now(),
): boolean {
  if (!brief) return true;
  if (resolveBriefItemCount(brief) < BRIEF_MIN_ITEMS) return true;

  const latestTimestamp = resolveBriefLatestTimestamp(brief);
  if (!latestTimestamp) return false;

  const latestMs = new Date(latestTimestamp).getTime();
  if (!Number.isFinite(latestMs)) return false;

  return (now - latestMs) / (1000 * 60 * 60) > BRIEF_MAX_AGE_HOURS;
}

interface UseBriefDataOptions {
  /** Number of historical days to fetch */
  historyDays?: number;
  /** Specific date to fetch (YYYY-MM-DD) */
  dateString?: string;
}

export function useBriefData(options: UseBriefDataOptions = {}) {
  const { historyDays = 7, dateString } = options;
  const normalizedDateString = normalizeBriefDateString(dateString ?? null);

  // Fetch target brief memory (either by date or latest)
  const latestBriefMemory = useQuery(
    normalizedDateString
      ? api.domains.research.dailyBriefMemoryQueries.getMemoryByDateString
      : api.domains.research.dailyBriefMemoryQueries.getLatestMemory,
    normalizedDateString ? { dateString: normalizedDateString } : {}
  );

  // Fetch task results for the latest memory
  const latestBriefTaskResults = useQuery(
    api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
    latestBriefMemory ? { memoryId: latestBriefMemory._id } : 'skip'
  );

  // Fetch historical snapshots
  const dashboardHistory = useQuery(
    api.domains.research.dashboardQueries.getHistoricalSnapshots,
    { days: historyDays }
  );

  // Loading states
  const isLoading = latestBriefMemory === undefined;
  const isHistoryLoading = dashboardHistory === undefined;

  // Extract executive brief from memory context, suppressing stale or sparse data.
  const { executiveBrief, isUsingFallback } = useMemo<{ executiveBrief: DailyBriefPayload | null; isUsingFallback: boolean }>(() => {
    const memory = latestBriefMemory as any;
    const now = Date.now();

    if (memory?.context) {
      const record = memory.context.executiveBriefRecord as ExecutiveBriefRecord | undefined;
      if (record?.status === 'valid' && record.brief && !shouldSuppressBrief(record.brief, now)) {
        return { executiveBrief: record.brief, isUsingFallback: false };
      }

      const legacy = memory.context.executiveBrief ?? memory.context.generatedBrief;
      if (legacy && !shouldSuppressBrief(legacy, now)) {
        return { executiveBrief: legacy, isUsingFallback: false };
      }
    }

    return { executiveBrief: null, isUsingFallback: false };
  }, [latestBriefMemory]);

  // Available brief dates
  const availableDates = useMemo(() => {
    const snapshots = Array.isArray(dashboardHistory) ? dashboardHistory : [];
    // NOTE(coworker): Normalize any timestamp-like values to YYYY-MM-DD to keep
    // selectors/query params stable and avoid downstream date-format crashes.
    const unique = [
      ...new Set(
        snapshots
          .map((s: any) => normalizeBriefDateString(s?.dateString ?? null))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    return unique.sort().reverse();
  }, [dashboardHistory]);

  // Current briefing date
  const briefingDateString = useMemo(() => {
    const memoryDate = normalizeBriefDateString((latestBriefMemory as any)?.dateString ?? null);
    if (memoryDate && availableDates.includes(memoryDate)) {
      return memoryDate;
    }
    return availableDates[0] ?? memoryDate ?? null;
  }, [latestBriefMemory, availableDates]);

  // Extract evidence from brief
  const evidence = useMemo(() => {
    const memory = latestBriefMemory as any;
    const record = memory?.context?.executiveBriefRecord as ExecutiveBriefRecord | undefined;

    const dedupeEvidence = (items: any[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = (item?.id || item?.url || item?.title || "").toLowerCase();
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    if (Array.isArray(record?.evidence) && record.evidence.length > 0) {
      return dedupeEvidence(record.evidence);
    }

    if (!executiveBrief?.actII?.signals?.length) return [];
    const rawEvidence = executiveBrief.actII.signals.flatMap(signal =>
      Array.isArray(signal.evidence) ? signal.evidence : []
    );
    return dedupeEvidence(rawEvidence);
  }, [latestBriefMemory, executiveBrief]);

  // Dashboard metrics
  const dashboardMetrics = useMemo(() => {
    const memory = latestBriefMemory as any;
    return memory?.context?.dashboardMetrics ?? null;
  }, [latestBriefMemory]);

  // Source summary
  const sourceSummary = useMemo(() => {
    const memory = latestBriefMemory as any;
    return memory?.context?.sourceSummary ?? null;
  }, [latestBriefMemory]);

  const coverageSummaries = useMemo(() => {
    const memory = latestBriefMemory as any;
    return memory?.context?.coverageSummaries ?? null;
  }, [latestBriefMemory]);

  const coverageRollup = useMemo(() => {
    const memory = latestBriefMemory as any;
    return memory?.context?.coverageRollup ?? null;
  }, [latestBriefMemory]);

  // Temporal deltas (today vs. yesterday)
  const deltas = useMemo(() => {
    if (!dashboardMetrics || !dashboardHistory || dashboardHistory.length < 2) {
      return null;
    }

    const today = dashboardMetrics;
    const yesterday = (dashboardHistory[1] as any)?.dashboardMetrics;

    if (!yesterday) return null;

    const coerceMetricNumber = (value: unknown): number => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const calcDelta = (todayVal: number | undefined, yesterdayVal: number | undefined) => {
      if (todayVal === undefined || yesterdayVal === undefined) return null;
      return todayVal - yesterdayVal;
    };

    return {
      keyStats: today.keyStats?.map((stat: any, i: number) => {
        const yesterdayStat = yesterday.keyStats?.[i];
        const todayValue = coerceMetricNumber(stat?.value);
        const yesterdayValue = coerceMetricNumber(yesterdayStat?.value);
        return {
          label: stat.label,
          delta: todayValue - yesterdayValue
        };
      }) ?? [],
      techReadiness: {
        existing: calcDelta(today.techReadiness?.existing, yesterday.techReadiness?.existing),
        emerging: calcDelta(today.techReadiness?.emerging, yesterday.techReadiness?.emerging),
        sciFi: calcDelta(today.techReadiness?.sciFi, yesterday.techReadiness?.sciFi),
      },
      capabilities: today.capabilities?.map((cap: any, i: number) => {
        const yesterdayCap = yesterday.capabilities?.[i];
        const todayScore = coerceMetricNumber(cap?.score);
        const yesterdayScore = coerceMetricNumber(yesterdayCap?.score);
        return {
          label: cap.label,
          delta: calcDelta(todayScore, yesterdayScore)
        };
      }) ?? []
    };
  }, [dashboardMetrics, dashboardHistory]);

  return {
    // Data
    briefMemory: latestBriefMemory,
    executiveBrief,
    evidence,
    dashboardMetrics,
    sourceSummary,
    coverageSummaries,
    coverageRollup,
    deltas,
    taskResults: latestBriefTaskResults,

    // Dates
    briefingDateString,
    availableDates,
    historySnapshots: dashboardHistory,

    // Loading & Fallback
    isLoading,
    isHistoryLoading,
    isUsingFallback,
  };
}

export default useBriefData;
