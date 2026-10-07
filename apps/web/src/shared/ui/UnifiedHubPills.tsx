import React from "react";
import { ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

type Hub = "documents" | "calendar" | "agents" | "roadmap" | "workspace";

const HUB_LABELS: Record<Hub, string> = {
  agents: "Agents",
  workspace: "Workspace",
  documents: "Documents",
  calendar: "Schedule",
  roadmap: "Roadmap",
};

export function UnifiedHubPills({
  active,
  showRoadmap = false,
  roadmapDisabled = true,
  className,
}: {
  active: Hub;
  showRoadmap?: boolean;
  roadmapDisabled?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();

  const container = [
    "items-center gap-0.5 p-1 rounded-lg bg-surface-secondary/80 backdrop-blur-sm border border-edge/60 shadow-sm",
    className ?? "",
  ]
    .join(" ")
    .trim();

  const btnCls = (name: Hub, disabled?: boolean) => {
    const isActive = active === name;
    return [
      "relative inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      isActive
        ? "border-primary/30 bg-primary/[0.08] text-content font-semibold shadow-sm ring-1 ring-primary/30 dark:ring-primary/40"
        : "border-transparent text-content-secondary hover:text-content hover:border-edge hover:bg-surface/70",
      disabled ? "opacity-40 cursor-not-allowed" : "",
    ].join(" ");
  };

  const goDocs = () => { try { navigate(buildCockpitPath({ surfaceId: "workspace" as any })); } catch {} };
  const goCalendar = () => { try { navigate(buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "calendar" } })); } catch {} };
  const goAgents = () => { try { navigate(buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "agents" } })); } catch {} };
  const goRoadmap = () => { try { navigate(buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "roadmap" } })); } catch {} };
  const goWorkspace = () => { try { navigate(buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "workspace" } })); } catch {} };

  const hubs: Array<{
    id: Hub;
    label: string;
    disabled?: boolean;
    onSelect: () => void;
  }> = [
    { id: "agents", label: HUB_LABELS.agents, onSelect: goAgents },
    { id: "workspace", label: HUB_LABELS.workspace, onSelect: goWorkspace },
    { id: "documents", label: HUB_LABELS.documents, onSelect: goDocs },
    { id: "calendar", label: HUB_LABELS.calendar, onSelect: goCalendar },
    ...(showRoadmap
      ? [{ id: "roadmap" as const, label: HUB_LABELS.roadmap, disabled: roadmapDisabled, onSelect: goRoadmap }]
      : []),
  ];

  return (
    <>
      <div className={["relative sm:hidden", className ?? ""].join(" ").trim()}>
        <select
          value={active}
          aria-label={`Choose hub. Current hub: ${HUB_LABELS[active]}`}
          className="h-10 min-w-40 appearance-none rounded-lg border border-edge/60 bg-surface-secondary/80 py-2 pl-3 pr-9 text-xs font-semibold text-content shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onChange={(event) => {
            const selected = hubs.find((hub) => hub.id === event.target.value);
            if (!selected || selected.disabled) return;
            selected.onSelect();
          }}
        >
          {hubs.map((hub) => (
            <option key={hub.id} value={hub.id} disabled={hub.disabled}>
              {hub.label}{hub.disabled ? " — unavailable" : ""}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
          aria-hidden="true"
        />
      </div>

    <nav className={["hidden sm:inline-flex", container].join(" ")} role="tablist" aria-label="Primary hubs">
      <button className={btnCls("agents")} onClick={goAgents} role="tab" aria-selected={active === "agents"} aria-current={active === "agents" ? "page" : undefined}>
        {active === "agents" ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
        Agents
      </button>
      <button className={btnCls("workspace")} onClick={goWorkspace} role="tab" aria-selected={active === "workspace"} aria-current={active === "workspace" ? "page" : undefined}>
        {active === "workspace" ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
        Workspace
      </button>
      <button className={btnCls("documents")} onClick={goDocs} role="tab" aria-selected={active === "documents"} aria-current={active === "documents" ? "page" : undefined}>
        {active === "documents" ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
        Documents
      </button>
      <button className={btnCls("calendar")} onClick={goCalendar} role="tab" aria-selected={active === "calendar"} aria-current={active === "calendar" ? "page" : undefined}>
        {active === "calendar" ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
        Schedule
      </button>
      {showRoadmap && (
        <button
          className={btnCls("roadmap", roadmapDisabled)}
          onClick={roadmapDisabled ? undefined : goRoadmap}
          role="tab"
          aria-selected={active === "roadmap"}
          aria-current={active === "roadmap" ? "page" : undefined}
          aria-disabled={roadmapDisabled}
          title={roadmapDisabled ? "Roadmap not available" : "Open roadmap hub"}
          disabled={roadmapDisabled}
        >
          {active === "roadmap" ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
          Roadmap
        </button>
      )}
    </nav>
    </>
  );
}
