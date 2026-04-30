export type CompactReportSourceKind = "live_convex" | "starter";

export type CompactReportsReadModel<TReport> = {
  sourceKind: CompactReportSourceKind;
  sourceLabel: string;
  allReports: TReport[];
  filteredReports: TReport[];
  visibleReports: TReport[];
  hiddenCount: number;
  hasMore: boolean;
};

export function buildCompactReportsReadModel<TReport extends { state: string }>({
  liveReports,
  fallbackReports,
  filter,
  visibleCount,
}: {
  liveReports: TReport[] | null;
  fallbackReports: readonly TReport[];
  filter: string;
  visibleCount: number;
}): CompactReportsReadModel<TReport> {
  const allReports = liveReports && liveReports.length > 0 ? liveReports : [...fallbackReports];
  const sourceKind: CompactReportSourceKind =
    liveReports && liveReports.length > 0 ? "live_convex" : "starter";
  const filteredReports =
    filter === "all" ? allReports : allReports.filter((report) => report.state.includes(filter));
  const safeVisibleCount = Math.max(0, Math.min(filteredReports.length, visibleCount));
  const visibleReports = filteredReports.slice(0, safeVisibleCount);
  const hiddenCount = Math.max(0, filteredReports.length - visibleReports.length);

  return {
    sourceKind,
    sourceLabel: sourceKind === "live_convex" ? "live memory" : "starter memory",
    allReports,
    filteredReports,
    visibleReports,
    hiddenCount,
    hasMore: hiddenCount > 0,
  };
}
