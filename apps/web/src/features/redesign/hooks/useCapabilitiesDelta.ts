/**
 * useCapabilitiesDelta — Phase 9a §5.
 *
 * Wraps `domains.research.editionQueries.getCapabilitiesDelta` so the
 * §5 Capabilities map can render `+1`, `-2`, `→` indicators next to
 * each readiness bucket count.  Honest: returns `null` per-bucket if
 * there is no prior snapshot to compare against; component must
 * render NOTHING (not "→") when delta is null.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export interface CapabilitiesDelta {
  windowDays: number;
  today: { existing: number; emerging: number; sciFi: number } | null;
  prior: { existing: number; emerging: number; sciFi: number } | null;
  priorDateString: string | null;
  deltas: {
    existing: number | null;
    emerging: number | null;
    sciFi: number | null;
  } | null;
}

export function useCapabilitiesDelta(
  windowDays: number = 1,
): CapabilitiesDelta | undefined {
  const data = useQuery(
    api.domains.research.editionQueries.getCapabilitiesDelta,
    { windowDays },
  );
  return data as CapabilitiesDelta | undefined;
}
