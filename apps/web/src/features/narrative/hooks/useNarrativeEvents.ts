/**
 * useNarrativeEvents Hook
 *
 * Fetches and manages narrative events for threads.
 *
 * @module features/narrative/hooks/useNarrativeEvents
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { NarrativeEvent, WeekColumn } from "../types";

export interface UseNarrativeEventsOptions {
  /** Thread ID to fetch events for */
  threadId?: Id<"narrativeThreads">;
  /** Week number to filter by */
  weekNumber?: string;
  /** Number of weeks to fetch */
  weekCount?: number;
  /** Limit number of events */
  limit?: number;
}

export interface UseNarrativeEventsResult {
  events: NarrativeEvent[];
  eventsByWeek: Map<string, NarrativeEvent[]>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Generate week columns for the timeline
 */
export function generateWeekColumns(weekCount: number = 12): WeekColumn[] {
  const columns: WeekColumn[] = [];
  const now = new Date();

  for (let i = weekCount - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i * 7);

    // Get ISO week number
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const weekNumber = `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;

    // Calculate week start/end
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - startDate.getDay() + 1); // Monday
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6); // Sunday

    // Format label
    const label = i === 0
      ? "This Week"
      : i === 1
        ? "Last Week"
        : startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    columns.push({
      weekNumber,
      label,
      startDate,
      endDate,
      isCurrent: i === 0,
    });
  }

  return columns;
}

/**
 * Hook to fetch events for a thread
 */
export function useNarrativeEvents(
  options: UseNarrativeEventsOptions = {}
): UseNarrativeEventsResult {
  const { threadId, weekNumber, weekCount = 12, limit = 100 } = options;

  // Fetch events for specific thread
  const threadEvents = useQuery(
    api.domains.narrative.queries.events.getEventsByThread,
    threadId ? { threadId, limit } : "skip"
  );

  // Fetch events for specific week
  const weekEvents = useQuery(
    api.domains.narrative.queries.events.getEventsByWeek,
    weekNumber ? { weekNumber, limit } : "skip"
  );

  // Determine which events to use
  let events: NarrativeEvent[] = [];
  let isLoading = false;

  if (threadId) {
    events = (threadEvents || []) as NarrativeEvent[];
    isLoading = threadEvents === undefined;
  } else if (weekNumber) {
    events = (weekEvents || []) as NarrativeEvent[];
    isLoading = weekEvents === undefined;
  }

  // Group events by week
  const eventsByWeek = new Map<string, NarrativeEvent[]>();
  for (const event of events) {
    const week = event.weekNumber;
    if (!eventsByWeek.has(week)) {
      eventsByWeek.set(week, []);
    }
    eventsByWeek.get(week)!.push(event);
  }

  return {
    events,
    eventsByWeek,
    isLoading,
    error: null,
  };
}

/**
 * Hook to fetch timeline events across multiple threads
 */
export function useTimelineEvents(
  threadIds: Id<"narrativeThreads">[],
  weekCount: number = 12
): {
  eventsByThreadAndWeek: Map<string, Map<string, NarrativeEvent[]>>;
  weekColumns: WeekColumn[];
  isLoading: boolean;
} {
  // Generate week columns
  const weekColumns = generateWeekColumns(weekCount);

  // Fetch events for timeline (recent events across threads)
  const recentEvents = useQuery(
    api.domains.narrative.queries.events.getRecentEvents,
    { limit: 200 }
  );

  const isLoading = recentEvents === undefined;

  // Group by thread and week
  const eventsByThreadAndWeek = new Map<string, Map<string, NarrativeEvent[]>>();

  if (recentEvents) {
    for (const event of recentEvents as NarrativeEvent[]) {
      const threadKey = event.threadId as string;
      const weekKey = event.weekNumber;

      if (!eventsByThreadAndWeek.has(threadKey)) {
        eventsByThreadAndWeek.set(threadKey, new Map());
      }

      const threadMap = eventsByThreadAndWeek.get(threadKey)!;
      if (!threadMap.has(weekKey)) {
        threadMap.set(weekKey, []);
      }

      threadMap.get(weekKey)!.push(event);
    }
  }

  return {
    eventsByThreadAndWeek,
    weekColumns,
    isLoading,
  };
}

export default useNarrativeEvents;
