/**
 * useTodayPulse — wraps the public Convex query
 * `domains.research.editionQueries.getTodayPulse` for §1 of the
 * editorial home.  Returns `undefined` while loading, then
 * `{ provenance, pulses, dateKey, lastDateKey }`.
 *
 * Identity is the same anonymous-session contract used by Fast Agent.
 *
 * P0 #2 (2026-05-09): the query now returns a `provenance` field that
 * distinguishes between "user" (the caller's own pulse), "public-
 * trending" (industryUpdates fallback for guests + cold-start users),
 * and "empty" (HONEST_STATUS — no fallback available).
 */

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { getStoredAnonymousSessionId } from "./editionSession";

export type TodayPulseProvenance = "user" | "public-trending" | "empty";

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
  /**
   * Where the items came from.  Surfaces use this to label the
   * section honestly ("Public · trending" vs "Your pulse").
   */
  provenance: TodayPulseProvenance;
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
