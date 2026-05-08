/**
 * cockpitModes.ts - maps live MainView routes into five focal modes.
 *
 * Within a mode, individual views are accessible via CommandBar tabs or Cmd+K.
 */

import type { MainView } from "@/lib/registry/viewRegistry";
export { VIEW_TITLES, VIEW_PATH_MAP } from "@/lib/registry/viewRegistry";
import type { LucideIcon } from "lucide-react";
import { Bot, Code, Radar, Settings, Target } from "lucide-react";

export type CockpitMode = "mission" | "intel" | "build" | "agents" | "system";

export interface ModeConfig {
  id: CockpitMode;
  label: string;
  /** One-line operator description shown in tooltips and StatusStrip ticker */
  description: string;
  /** Lucide icon name */
  icon: string;
  /** Views belonging to this mode */
  views: MainView[];
  /** Default view when switching to this mode */
  defaultView: MainView;
  /** HUD accent CSS variable */
  color: string;
}

export const MODES: ModeConfig[] = [
  {
    id: "mission",
    label: "Mission",
    description: "Locked product surfaces: Home, Reports, Chat, Inbox, and Me",
    icon: "Target",
    views: ["control-plane", "reports-home", "chat-home", "nudges-home", "me-home", "pulse-home"],
    defaultView: "control-plane",
    color: "var(--accent-primary, #d97757)",
  },
  {
    id: "intel",
    label: "Intel",
    description: "Research, report details, entity context, and comparison work",
    icon: "Radar",
    views: [
      "research",
      "product-direction",
      "world-monitor",
      "watchlists",
      "entity",
      "entity-pulse",
      "report-detail",
      "report-detail-workspace",
      "role-lens-output",
      "entity-compare",
      "conference-capture",
      "homes-hub-session",
    ],
    defaultView: "research",
    color: "var(--accent-primary, #d97757)",
  },
  {
    id: "build",
    label: "Build",
    description: "Developer, pricing, legal, and platform-facing utility surfaces",
    icon: "Code",
    views: ["developers", "financial-operator", "pricing", "changelog", "legal", "about"],
    defaultView: "developers",
    color: "var(--accent-primary, #d97757)",
  },
  {
    id: "agents",
    label: "Agents",
    description: "Agent orchestration, receipts, delegation, execution trace, and tool activity",
    icon: "Bot",
    views: ["agents", "receipts", "delegation", "execution-trace", "mcp-ledger"],
    defaultView: "agents",
    color: "var(--accent-primary, #d97757)",
  },
  {
    id: "system",
    label: "System",
    description: "Internal quality, benchmark, and personal wiki surfaces",
    icon: "Settings",
    views: ["dogfood", "benchmark-comparison", "me-wiki-landing", "me-wiki-page-detail"],
    defaultView: "dogfood",
    color: "var(--accent-primary, #d97757)",
  },
];

/** Reverse map: MainView -> CockpitMode */
export const VIEW_TO_MODE: Record<MainView, CockpitMode> = Object.fromEntries(
  MODES.flatMap((mode) => mode.views.map((view) => [view, mode.id])),
) as Record<MainView, CockpitMode>;

/** Shared icon map for mode buttons - single source of truth for ModeRail and CommandBar */
export const ICON_MAP: Record<string, LucideIcon> = {
  Target,
  Radar,
  Code,
  Bot,
  Settings,
};

export function getModeForView(view: MainView): ModeConfig {
  const modeId = VIEW_TO_MODE[view];
  return MODES.find((mode) => mode.id === modeId) ?? MODES[0];
}
