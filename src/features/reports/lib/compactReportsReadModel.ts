export type CompactReportSourceKind = "loading" | "empty" | "live_convex";

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
  filter,
  visibleCount,
}: {
  liveReports: TReport[] | undefined;
  filter: string;
  visibleCount: number;
}): CompactReportsReadModel<TReport> {
  const allReports = liveReports ?? [];
  const sourceKind: CompactReportSourceKind =
    liveReports === undefined ? "loading" : liveReports.length > 0 ? "live_convex" : "empty";
  const filteredReports =
    filter === "all" ? allReports : allReports.filter((report) => report.state.includes(filter));
  const safeVisibleCount = Math.max(0, Math.min(filteredReports.length, visibleCount));
  const visibleReports = filteredReports.slice(0, safeVisibleCount);
  const hiddenCount = Math.max(0, filteredReports.length - visibleReports.length);

  return {
    sourceKind,
    sourceLabel:
      sourceKind === "live_convex" ? "saved reports" : sourceKind === "loading" ? "loading reports" : "no saved reports",
    allReports,
    filteredReports,
    visibleReports,
    hiddenCount,
    hasMore: hiddenCount > 0,
  };
}
