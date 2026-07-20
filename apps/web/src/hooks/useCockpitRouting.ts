import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Id } from "../../convex/_generated/dataModel";
import {
  buildCockpitPath,
  parseCockpitSurfaceParam,
  resolvePathToCockpitState,
  type MainView,
  type ResearchTab,
  type CockpitSurfaceId,
} from "@/lib/registry/viewRegistry";

export type { MainView, ResearchTab, CockpitSurfaceId };

interface UseCockpitRoutingReturn {
  currentView: MainView;
  currentSurface: CockpitSurfaceId;
  setCurrentView: (view: MainView) => void;
  setCurrentSurface: (surface: CockpitSurfaceId) => void;
  entityName: string | null;
  setEntityName: (name: string | null) => void;
  selectedSpreadsheetId: Id<"spreadsheets"> | null;
  setSelectedSpreadsheetId: (id: Id<"spreadsheets"> | null) => void;
  researchHubInitialTab: ResearchTab;
  setResearchHubInitialTab: (tab: ResearchTab) => void;
  isTransitioning: boolean;
  setIsTransitioning: (transitioning: boolean) => void;
  panel: string | null;
  runId: string | null;
  documentParam: string | null;
  workspaceParam: string | null;
  canonicalPath: string;
  isLegacyRedirect: boolean;
  isUnknownRoute: boolean;
}

export function useCockpitRouting(): UseCockpitRoutingReturn {
  const location = useLocation();

  const parseLocation = (pathname: string, search: string) => {
    const resolved = resolvePathToCockpitState(pathname, search);
    return {
      view: resolved.view,
      surface: resolved.surfaceId,
      entityName: resolved.entityName,
      spreadsheetId: resolved.spreadsheetId,
      researchTab: resolved.researchTab,
      panel: resolved.panel,
      runId: resolved.runId,
      documentParam: resolved.docId,
      workspaceParam: resolved.workspace,
      canonicalPath: resolved.canonicalPath,
      isLegacyRedirect: resolved.isLegacyRedirect,
      isUnknownRoute: resolved.isUnknownRoute,
    };
  };

  const initialRoute = (() => {
    if (typeof window === "undefined") {
      return {
        view: "control-plane" as MainView,
        surface: "ask" as CockpitSurfaceId,
        entityName: null,
        spreadsheetId: null,
        researchTab: "overview" as ResearchTab,
        panel: null,
        runId: null,
        documentParam: null,
        workspaceParam: null,
        canonicalPath: buildCockpitPath({ surfaceId: "ask" }),
        isLegacyRedirect: false,
        isUnknownRoute: false,
      };
    }
    return parseLocation(location.pathname || "/", location.search || "");
  })();

  const [currentView, setCurrentView] = useState<MainView>(initialRoute.view);
  const [currentSurface, setCurrentSurface] = useState<CockpitSurfaceId>(initialRoute.surface);
  const [entityName, setEntityName] = useState<string | null>(initialRoute.entityName);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState<Id<"spreadsheets"> | null>(
    initialRoute.spreadsheetId ? (initialRoute.spreadsheetId as Id<"spreadsheets">) : null,
  );
  const [researchHubInitialTab, setResearchHubInitialTab] = useState<ResearchTab>(initialRoute.researchTab);
  const [panel, setPanel] = useState<string | null>(initialRoute.panel);
  const [runId, setRunId] = useState<string | null>(initialRoute.runId);
  const [documentParam, setDocumentParam] = useState<string | null>(initialRoute.documentParam);
  const [workspaceParam, setWorkspaceParam] = useState<string | null>(initialRoute.workspaceParam);
  const [canonicalPath, setCanonicalPath] = useState<string>(initialRoute.canonicalPath);
  const [isLegacyRedirect, setIsLegacyRedirect] = useState<boolean>(initialRoute.isLegacyRedirect);
  const [isUnknownRoute, setIsUnknownRoute] = useState<boolean>(initialRoute.isUnknownRoute);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const next = parseLocation(location.pathname || "/", location.search || "");
    // React 18 automatically batches these setState calls within effects.
    // The legacy redirect effect in CockpitLayout is guarded with RAF to ensure
    // all state is settled before it fires.
    setEntityName(next.entityName);
    setSelectedSpreadsheetId(next.spreadsheetId ? (next.spreadsheetId as Id<"spreadsheets">) : null);
    setResearchHubInitialTab(next.researchTab);
    setCurrentView(next.view);
    setCurrentSurface(next.surface);
    setPanel(next.panel);
    setRunId(next.runId);
    setDocumentParam(next.documentParam);
    setWorkspaceParam(next.workspaceParam);
    setCanonicalPath(next.canonicalPath);
    setIsLegacyRedirect(next.isLegacyRedirect);
    setIsUnknownRoute(next.isUnknownRoute);
  }, [location.pathname, location.search]);

  return {
    currentView,
    currentSurface,
    setCurrentView,
    setCurrentSurface,
    entityName,
    setEntityName,
    selectedSpreadsheetId,
    setSelectedSpreadsheetId,
    researchHubInitialTab,
    setResearchHubInitialTab,
    isTransitioning,
    setIsTransitioning,
    panel,
    runId,
    documentParam,
    workspaceParam,
    canonicalPath,
    isLegacyRedirect,
    isUnknownRoute,
  };
}

interface CockpitSurfaceFromUrl {
  surfaceId: CockpitSurfaceId;
  entityName: string | null;
  documentId: string | null;
  runId: string | null;
}

export function useCockpitSurfaceFromUrl(): CockpitSurfaceFromUrl {
  const location = useLocation();

  const [state, setState] = useState<CockpitSurfaceFromUrl>(() => {
    const params = new URLSearchParams(location.search);
    return {
      surfaceId: parseCockpitSurfaceParam(params.get("surface")) ?? "ask",
      entityName: params.get("entity"),
      documentId: params.get("doc"),
      runId: params.get("run"),
    };
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setState({
      surfaceId: parseCockpitSurfaceParam(params.get("surface")) ?? "ask",
      entityName: params.get("entity"),
      documentId: params.get("doc"),
      runId: params.get("run"),
    });
  }, [location.search]);

  return state;
}
