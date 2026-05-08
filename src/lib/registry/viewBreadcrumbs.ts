import { VIEW_MAP, type MainView, type ResearchTab } from "@/lib/registry/viewRegistry";

export interface ViewBreadcrumbItem {
  id: string;
  label: string;
  view?: MainView;
  path?: string;
  isCurrent: boolean;
}

const RESEARCH_TAB_LABELS: Record<ResearchTab, string> = {
  overview: "Overview",
  signals: "Signals",
  briefing: "Briefing",
  deals: "Deals",
  changes: "Changes",
  changelog: "Changelog",
};

const LABEL_OVERRIDES: Partial<Record<MainView, string>> = {};

function breadcrumbLabel(view: MainView) {
  return LABEL_OVERRIDES[view] ?? VIEW_MAP[view]?.title ?? view;
}

export function buildViewBreadcrumbs(params: {
  currentView: MainView;
  researchHubInitialTab: ResearchTab;
}): ViewBreadcrumbItem[] {
  const { currentView, researchHubInitialTab } = params;

  if (currentView === "control-plane") return [];

  if (currentView === "research" && researchHubInitialTab !== "overview") {
    return [
      {
        id: "research",
        label: breadcrumbLabel("research"),
        view: "research",
        path: "/research",
        isCurrent: false,
      },
      {
        id: `research-${researchHubInitialTab}`,
        label: RESEARCH_TAB_LABELS[researchHubInitialTab],
        path: `/research/${researchHubInitialTab}`,
        isCurrent: true,
      },
    ];
  }

  const current = VIEW_MAP[currentView];
  if (!current?.parentId) return [];

  const parent = VIEW_MAP[current.parentId];
  if (!parent) return [];

  return [
    {
      id: parent.id,
      label: breadcrumbLabel(parent.id),
      view: parent.id,
      path: parent.path,
      isCurrent: false,
    },
    {
      id: current.id,
      label: breadcrumbLabel(current.id),
      view: current.id,
      path: current.path,
      isCurrent: true,
    },
  ];
}
