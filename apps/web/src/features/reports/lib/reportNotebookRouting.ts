export function buildReportNotebookPath(reportId: string) {
  const id = reportId.trim() || "new";
  return `/reports/${encodeURIComponent(id)}/notebook`;
}

export function getReportNotebookIdFromPath(pathname: string) {
  const match = pathname.match(/^\/reports\/([^/]+)\/notebook\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export type ReportWorkspaceTab = "brief" | "cards" | "map" | "sources";

export interface ReportWorkspaceRoute {
  reportId: string;
  tab: ReportWorkspaceTab;
}

export function getReportWorkspaceRouteFromPath(
  pathname: string,
): ReportWorkspaceRoute | null {
  const match = pathname.match(
    /^\/reports\/([^/]+)(?:\/(brief|cards|map|sources|graph))?\/?$/,
  );
  if (!match?.[1]) return null;

  const segment = match[2];
  const tab: ReportWorkspaceTab =
    segment === "cards" || segment === "sources"
      ? segment
      : segment === "map" || segment === "graph"
        ? "map"
        : "brief";

  return {
    reportId: decodeURIComponent(match[1]),
    tab,
  };
}
