/**
 * useTopForecasts — wraps the public Convex query
 * `domains.research.editionQueries.getTopForecasts` for §3.  The
 * underlying internalQuery `getTopForecastsForLinkedIn` is the
 * source — we expose a public-friendly variant from the edition
 * queries module.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export interface EditionForecast {
  _id: string;
  question: string;
  forecastType: string;
  probability: number | null;
  previousProbability: number | null;
  confidenceInterval: { low: number; high: number } | null;
  resolutionDate: string;
  resolutionCriteria: string;
  topDrivers: string[];
  topCounterarguments: string[];
  updateCount: number;
  lastRefreshedAt: number;
  status: string;
}

export function useTopForecasts(limit = 5): EditionForecast[] | undefined {
  const data = useQuery(
    api.domains.research.editionQueries.getTopForecasts,
    { limit },
  );
  return data as EditionForecast[] | undefined;
}
