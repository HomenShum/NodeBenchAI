/**
 * useReportsLive - durable reports from live artifacts.
 *
 * Reports should be a vault view, not a fragile dashboard. The stable
 * Convex-backed artifact path is the source of truth here; batch-autopilot
 * telemetry can be reintroduced later as a non-blocking supplement once the
 * deployed auth-safe query is available.
 */

import type { ReportCardData } from "../fixtures";
import { useLiveArtifacts, type LiveArtifactDetail } from "./useLiveArtifacts";

export interface UseReportsLiveResult {
  reports: ReportCardData[];
  details: LiveArtifactDetail[];
  isLive: boolean;
  isLoading: boolean;
  sourceLabel: string;
  liveCount: number;
}

export function useReportsLive(): UseReportsLiveResult {
  const liveArtifacts = useLiveArtifacts(30);
  return {
    reports: liveArtifacts.reports,
    details: liveArtifacts.details,
    isLive: liveArtifacts.isLive,
    isLoading: liveArtifacts.isLoading,
    sourceLabel: liveArtifacts.sourceLabel,
    liveCount: liveArtifacts.reports.length,
  };
}
