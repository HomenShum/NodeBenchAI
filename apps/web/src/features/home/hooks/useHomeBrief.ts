/**
 * useHomeBrief — primary data hook for the Home daily brief surface.
 *
 * Composes existing Convex queries + SWR hooks into the canonical
 * `HomeBriefData` shape expected by the Home v3 components.
 *
 * Pattern: Adapter composition — bridges existing backend tables
 * (dailyBriefSnapshots, signals, entityStates, actionDrafts) to the
 * `AgentDigestOutput` contract.
 *
 * Prior art:
 *   - Anthropic "Building Effective Agents" (2024) — typed contracts
 *   - Claude Code scratchpad-first — derive from stored state
 *
 * Existing data sources composed:
 *   - `useTodayPulseSwr()` → entity pulse entries → carousel cards
 *   - `useLatestDailyBriefSnapshotSwr()` → snapshot metadata + metrics
 *   - `useActiveHypothesesSwr()` → competing explanations
 *   - `useTopForecastsSwr()` → catalyst events (What to Watch)
 *
 * See: docs/architecture/HOME_DAILY_BRIEF_LIVE_WIRING.md §3.1
 */

import { useMemo } from "react";
import { useTodayPulseSwr } from "../../redesign/hooks/useTodayPulseSwr";
import { useLatestDailyBriefSnapshotSwr } from "../../redesign/hooks/useLatestDailyBriefSnapshotSwr";
import { deriveConfidence, significanceRank } from "../lib/evidenceScoring";
import { findUserPosition } from "../lib/positionAnnotation";
import type {
  HomeBriefData,
  AgentDigestOutput,
  BriefSignal,
  BlufItem,
  MiniReportCard,
  UserEntityPosition,
  CatalystEvent,
} from "../lib/briefTypes";
import type { TodayPulseEntry } from "../../redesign/hooks/useTodayPulse";

// ─── Adapter: TodayPulseEntry → MiniReportCard ─────────────────────────

/**
 * Maps a TodayPulseEntry (existing backend shape) to a MiniReportCard
 * (Home v3 carousel shape).
 *
 * The pulse entry tracks entity-level changes; the report card presents
 * them as mini intelligence cards with status indicators.
 */
function pulseToReportCard(pulse: TodayPulseEntry): MiniReportCard {
  return {
    _id: pulse._id,
    entityName: formatEntityName(pulse.entitySlug),
    entitySlug: pulse.entitySlug,
    kind: "Entity Report",
    status: mapPulseStatus(pulse.status),
    headline: pulse.summaryMarkdown
      ? extractHeadline(pulse.summaryMarkdown)
      : "Generating report...",
    sourceCount: pulse.changeCount,
    claimCount: pulse.materialChangeCount,
    updatedAt: pulse.generatedAt,
    lensLabel: undefined, // Derived from user's active lens, not from pulse
  };
}

/**
 * Maps pulse status → report card status.
 * HONEST_STATUS: "generating" shows as "drafting", never as "verified".
 */
function mapPulseStatus(
  status: TodayPulseEntry["status"],
): MiniReportCard["status"] {
  switch (status) {
    case "ready":
      return "watching";
    case "generating":
      return "drafting";
    case "failed":
      return "stale";
    default:
      return "review";
  }
}

// ─── Adapter: DailyBriefSnapshot → AgentDigestOutput ───────────────────

/**
 * Maps the existing dailyBriefSnapshots shape to AgentDigestOutput.
 *
 * Current snapshot has `dashboardMetrics` (charts, keyStats, capabilities).
 * AgentDigestOutput expects `signals`, `actionItems`, `entitySpotlight`.
 *
 * Strategy: derive signals from keyStats + topTrending;
 * fill action items from an empty array (populated when action_drafts
 * table is wired); competing explanations from hypotheses hook.
 *
 * This adapter will shrink as the backend migrates toward the canonical
 * AgentDigestOutput shape per the wiring doc's Phase 1 plan.
 */
function snapshotToDigest(
  snapshot: {
    dateString: string;
    generatedAt: number;
    dashboardMetrics?: {
      keyStats?: Array<{ label?: string; name?: string; value?: string | number; delta?: string | number }>;
      meta?: { currentDate: string };
    };
    sourceSummary?: { totalItems: number; topTrending: string[] };
  } | null,
): AgentDigestOutput | null {
  if (!snapshot) return null;

  const keyStats = snapshot.dashboardMetrics?.keyStats ?? [];
  const topTrending = snapshot.sourceSummary?.topTrending ?? [];

  // Derive signals from keyStats (each stat becomes a BLUF-style signal)
  const signals: BriefSignal[] = keyStats
    .filter((s) => (s.label ?? s.name))
    .slice(0, 4)
    .map((stat) => ({
      title: String(stat.label ?? stat.name ?? ""),
      summary: stat.delta
        ? `Changed by ${stat.delta} from prior period.`
        : `Current value: ${stat.value ?? "N/A"}.`,
      hardNumbers: stat.value != null ? String(stat.value) : undefined,
      reflection: {
        what: String(stat.label ?? stat.name ?? "Metric"),
        soWhat: stat.delta ? `Delta: ${stat.delta}` : "Stable",
        nowWhat: "Monitor for further changes",
      },
    }));

  return {
    dateString: snapshot.dateString,
    narrativeThesis: topTrending.length > 0
      ? `Today's dominant themes: ${topTrending.slice(0, 3).join(", ")}`
      : "Daily intelligence brief",
    signals,
    actionItems: [], // Populated when action_drafts adapter is wired
    storyCount: snapshot.sourceSummary?.totalItems ?? 0,
    topSources: topTrending.slice(0, 5),
    topCategories: [],
    processingTimeMs: 0,
  };
}

// ─── String Helpers ────────────────────────────────────────────────────

/**
 * Converts entity slug to display name.
 * "anthropic" → "Anthropic"  |  "open-ai" → "Open AI"
 */
function formatEntityName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Extracts first sentence from markdown as a headline.
 * Strips markdown formatting (**, *, #, etc.)
 */
function extractHeadline(markdown: string): string {
  const stripped = markdown
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .trim();

  // First sentence or first 120 chars
  const firstSentence = stripped.split(/[.!?]\s/)[0];
  if (firstSentence && firstSentence.length <= 120) {
    return firstSentence;
  }
  return stripped.slice(0, 117) + "...";
}

/**
 * Gets today's date string in user's local timezone.
 * "2026-05-17" format.
 */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─── Main Hook ─────────────────────────────────────────────────────────

/**
 * Primary data hook for the Home daily brief surface.
 *
 * Returns a unified data object matching the `HomeBriefData` contract.
 * Components consume this shape directly — no additional queries needed.
 *
 * Loading strategy:
 *   - `isLoading: true` when primary data (snapshot) hasn't arrived
 *   - Partial data renders immediately (carousel from pulses, even if
 *     snapshot hasn't loaded yet) — partial failures don't block UI
 */
export function useHomeBrief(): HomeBriefData {
  const today = toLocalDateString(new Date());

  // ── Compose existing SWR hooks ──
  const { data: pulseData } = useTodayPulseSwr(12);
  const { data: snapshotData } = useLatestDailyBriefSnapshotSwr();

  // ── Adapt snapshot → AgentDigestOutput ──
  const brief = useMemo(
    () => snapshotToDigest(snapshotData ?? null),
    [snapshotData],
  );

  // ── Adapt pulses → MiniReportCards ──
  const reports: MiniReportCard[] = useMemo(() => {
    if (!pulseData?.pulses) return [];
    return pulseData.pulses.map(pulseToReportCard);
  }, [pulseData]);

  // ── Positions: empty until userEntityPositions table exists ──
  // TODO: Wire to real positions query when table is created
  const positions: UserEntityPosition[] = [];

  // ── Events: empty until catalyst events are wired ──
  // TODO: Wire to real calendar events query
  const events: CatalystEvent[] = [];

  // ── Derive BLUF items with confidence + position annotations ──
  const blufItems: BlufItem[] = useMemo(() => {
    if (!brief?.signals) return [];
    return brief.signals
      .sort((a, b) => significanceRank(b) - significanceRank(a))
      .slice(0, 4)
      .map((signal) => ({
        ...signal,
        confidence: deriveConfidence(signal),
        position: findUserPosition(positions, signal),
      }));
  }, [brief, positions]);

  return {
    isLoading: snapshotData === undefined,
    brief,
    blufItems,
    reports,
    positions,
    events,
    dateString: brief?.dateString ?? today,
    cutoffTime: "06:00 UTC",
  };
}
