/**
 * useTemporalEdition — wrappers around the three temporal queries
 * added in P0 #3.  Each hook returns `undefined` while loading and
 * a discriminated-union shape when resolved.
 */

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { getStoredAnonymousSessionId } from "./editionSession";

/* ─── Daily edition (specific past day) ──────────────────────────── */

export type DailyEditionResult =
  | {
      available: true;
      dateKey: string;
      earliestDateKey: string | null;
      snapshot: {
        _id: string;
        dateString: string;
        generatedAt: number;
        version: number;
        dashboardMetrics: any;
        sourceSummary: any;
      } | null;
      pulses: Array<{
        _id: string;
        entitySlug: string;
        dateKey: string;
        status: "generating" | "ready" | "failed";
        summaryMarkdown: string | null;
        changeCount: number;
        materialChangeCount: number;
        generatedAt: number;
      }>;
      hypothesisCount: number;
      forecastCount: number;
    }
  | {
      available: false;
      reason: "invalid_date" | "no_edition";
      dateKey: string;
      earliestDateKey: string | null;
    };

export function useDailyEdition(
  dateKey: string | null,
): DailyEditionResult | undefined {
  const sessionId = getStoredAnonymousSessionId();
  const data = useQuery(
    api.domains.research.editionQueries.getDailyEdition,
    dateKey ? { dateKey, anonymousSessionId: sessionId } : "skip",
  );
  return data as DailyEditionResult | undefined;
}

/* ─── Weekly digest ──────────────────────────────────────────────── */

export type WeeklyDigestResult =
  | {
      available: true;
      weekKey: string;
      startDateKey: string;
      endDateKey: string;
      totals: { pulseCount: number; materialChanges: number; changes: number };
      topPulses: Array<{
        _id: string;
        entitySlug: string;
        dateKey: string;
        summaryMarkdown: string | null;
        changeCount: number;
        materialChangeCount: number;
      }>;
      topForecasts: Array<{
        _id: string;
        question: string;
        probability: number;
        previousProbability: number;
        probabilityDelta: number;
        resolutionDate: string;
      }>;
      topHypotheses: Array<{
        _id: string;
        label: string;
        title: string;
        claimForm: string;
        status: string;
        updatedAt: number;
        supportingEvidenceCount: number;
        contradictingEvidenceCount: number;
      }>;
    }
  | {
      available: false;
      reason: "invalid_week" | "no_edition";
      weekKey: string;
      startDateKey: string | null;
      endDateKey: string | null;
    };

export function useWeeklyDigest(
  weekKey: string | null,
): WeeklyDigestResult | undefined {
  const sessionId = getStoredAnonymousSessionId();
  const data = useQuery(
    api.domains.research.editionQueries.getWeeklyDigest,
    weekKey ? { weekKey, anonymousSessionId: sessionId } : "skip",
  );
  return data as WeeklyDigestResult | undefined;
}

/* ─── Monthly retrospective ──────────────────────────────────────── */

export type MonthlyRetrospectiveResult =
  | {
      available: true;
      monthKey: string;
      topPerWeek: Array<{
        weekKey: string;
        dateString: string;
        keyStatCount: number;
      }>;
      resolvedForecastCount: number;
      meanBrier: number | null;
      topResolved?: Array<{
        _id: string;
        forecastId: string;
        question: string | null;
        outcome: "yes" | "no" | "ambiguous";
        finalProbability: number | null;
        brierScore: number | null;
        resolvedAt: number;
      }>;
      weeklyPulseTotals?: Array<{ weekKey: string; materialChanges: number }>;
      dailyHistogram?: number[];
      dayKeys?: string[];
      pulseSource?: "user" | "public-trending" | "none";
    }
  | {
      available: false;
      reason: "invalid_month" | "no_edition";
      monthKey: string;
    };

export function useMonthlyRetrospective(
  monthKey: string | null,
): MonthlyRetrospectiveResult | undefined {
  const sessionId = getStoredAnonymousSessionId();
  const data = useQuery(
    api.domains.research.editionQueries.getMonthlyRetrospective,
    monthKey ? { monthKey, anonymousSessionId: sessionId } : "skip",
  );
  return data as MonthlyRetrospectiveResult | undefined;
}

/* --- Quarter / year retrospective --------------------------------------- */

export type LongHorizonRetrospectiveResult =
  | {
      available: true;
      kind: "quarter" | "year";
      periodKey: string;
      startDateKey: string;
      endDateKey: string;
      snapshotCount: number;
      latestSnapshotDate: string | null;
      totalKeyStats: number;
      sourceItemCount: number;
      resolvedForecastCount: number;
      meanBrier: number | null;
      topSnapshots: Array<{
        dateString: string;
        keyStatCount: number;
        sourceItemCount: number;
      }>;
      topResolved: Array<{
        _id: string;
        forecastId: string;
        question: string | null;
        outcome: "yes" | "no" | "ambiguous";
        finalProbability: number | null;
        brierScore: number | null;
        resolvedAt: number;
      }>;
    }
  | {
      available: false;
      reason: "invalid_period" | "no_edition";
      kind: "quarter" | "year";
      periodKey: string;
      startDateKey: string | null;
      endDateKey: string | null;
    };

export function useLongHorizonRetrospective(
  kind: "quarter" | "year" | null,
  periodKey: string | null,
): LongHorizonRetrospectiveResult | undefined {
  const data = useQuery(
    api.domains.research.editionQueries.getLongHorizonRetrospective,
    kind && periodKey ? { kind, periodKey } : "skip",
  );
  return data as LongHorizonRetrospectiveResult | undefined;
}
