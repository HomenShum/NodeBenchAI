import { useMemo } from "react";
import { useLocation, type Location } from "react-router-dom";

import "@/features/redesign/tokens.css";
import "@/features/redesign/primitives.css";
import { WorkspaceSurface } from "@/features/redesign/surfaces/WorkspaceSurface";
import { buildWorkspaceRouteForHost } from "../lib/workspaceRouting";

type WorkspaceTab = "brief" | "cards" | "notebook" | "sources" | "chat" | "map";

const VALID_TABS = new Set<WorkspaceTab>(["brief", "cards", "notebook", "sources", "chat", "map"]);

function parseStandaloneWorkspaceState(location: Location): {
  reportId?: string;
  tab: WorkspaceTab;
} {
  const params = new URLSearchParams(location.search);
  const requestedTab = params.get("tab");
  const tab = VALID_TABS.has(requestedTab as WorkspaceTab) ? (requestedTab as WorkspaceTab) : "brief";
  const reportFromQuery = params.get("report") || params.get("reportId") || params.get("entity");
  const reportFromPath =
    location.pathname.match(/^\/workspace\/w\/([^/?#]+)/)?.[1] ??
    location.pathname.match(/^\/w\/([^/?#]+)/)?.[1];
  const rawReportId = reportFromQuery || reportFromPath || undefined;
  const reportId = rawReportId ? decodeURIComponent(rawReportId) : undefined;

  return { reportId, tab };
}

export function UniversalWorkspacePage() {
  const location = useLocation();
  const workspace = useMemo(() => parseStandaloneWorkspaceState(location), [location]);

  return (
    <div
      data-redesign
      data-redesign-theme="light"
      className="rd-app rd-app--standalone-workspace"
      data-agent-contact="standalone-workspace-runtime"
      style={{ minHeight: "100vh", background: "var(--rd-paper-warm)", color: "var(--rd-ink)" }}
    >
      <main style={{ minHeight: "100vh" }}>
        <WorkspaceSurface
          reportId={workspace.reportId}
          initialTab={workspace.tab}
          buildRoute={({ reportId, tab }) =>
            buildWorkspaceRouteForHost({ workspaceId: reportId, tab })
          }
        />
      </main>
    </div>
  );
}

export default UniversalWorkspacePage;
