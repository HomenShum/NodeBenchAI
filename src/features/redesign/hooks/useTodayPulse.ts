/**
 * useTodayPulse — wraps the public Convex query
 * `domains.research.editionQueries.getTodayPulse` for §1 of the
 * editorial home.  Returns `undefined` while loading, then
 * `{ pulses, dateKey, lastDateKey }`.
 *
 * Identity is the same anonymous-session contract used by Fast Agent.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { getStoredAnonymousSessionId } from "./editionSession";

export interface TodayPulseEntry {
  _id: string;
  entitySlug: string;
  dateKey: string;
  status: "generating" | "ready" | "failed";
  summaryMarkdown: string | null;
  changeCount: number;
  materialChangeCount: number;
  generatedAt: number;
}

export interface TodayPulseResult {
  pulses: TodayPulseEntry[];
  dateKey: string;
  lastDateKey: string | null;
}

export function useTodayPulse(limit = 12): TodayPulseResult | undefined {
  const sessionId = getStoredAnonymousSessionId();
  const data = useQuery(
    api.domains.research.editionQueries.getTodayPulse,
    { anonymousSessionId: sessionId, limit },
  );
  return data as TodayPulseResult | undefined;
}
