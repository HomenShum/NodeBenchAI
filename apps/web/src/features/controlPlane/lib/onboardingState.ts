import type { MainView, ResearchTab } from "@/lib/registry/viewRegistry";

export const CONTROL_PLANE_PREFERRED_PATH_KEY = "nodebench:control-plane:preferred-path";
export const CONTROL_PLANE_CHECKLIST_KEY = "nodebench:control-plane:first-run-checklist";
export const AGENTS_VIEW_MODE_KEY = "nodebench:agents:view-mode";

export type BuyerPreferredPath =
  | "receipts"
  | "delegation"
  | "investigation"
  | "mcp-ledger";

export type BuyerChecklistId =
  | "receipt"
  | "delegation"
  | "investigation"
  | "tool-activity";

export type BuyerChecklistState = Partial<Record<BuyerChecklistId, boolean>>;

export interface ControlPlaneRouteSnapshot {
  currentView: MainView;
  researchHubInitialTab: ResearchTab;
}

const LEGACY_PREFERRED_PATH = "research-briefing";
const LEGACY_CHECKLIST_ID = "brief";

function normalizeBuyerPreferredPath(raw: string | null): BuyerPreferredPath | null {
  if (raw === LEGACY_PREFERRED_PATH) return "mcp-ledger";
  if (raw === "receipts" || raw === "delegation" || raw === "investigation" || raw === "mcp-ledger") {
    return raw;
  }
  return null;
}

function normalizeBuyerChecklistState(state: unknown): BuyerChecklistState {
  if (!state || typeof state !== "object") return {};

  const parsed = state as Record<string, unknown>;
  const next: BuyerChecklistState = {};

  if (parsed.receipt === true) next.receipt = true;
  if (parsed.delegation === true) next.delegation = true;
  if (parsed.investigation === true) next.investigation = true;
  if (parsed[LEGACY_CHECKLIST_ID] === true || parsed["tool-activity"] === true) {
    next["tool-activity"] = true;
  }

  return next;
}

export function loadBuyerPreferredPath(): BuyerPreferredPath | null {
  try {
    const raw = localStorage.getItem(CONTROL_PLANE_PREFERRED_PATH_KEY);
    const normalized = normalizeBuyerPreferredPath(raw);
    if (normalized) {
      if (raw !== normalized) {
        localStorage.setItem(CONTROL_PLANE_PREFERRED_PATH_KEY, normalized);
      }
      return normalized;
    }
  } catch {
    // noop
  }
  return null;
}

export function saveBuyerPreferredPath(path: BuyerPreferredPath): void {
  try {
    localStorage.setItem(CONTROL_PLANE_PREFERRED_PATH_KEY, path);
  } catch {
    // noop
  }
}

export function orderByBuyerPreference<T extends { preferredPath: BuyerPreferredPath }>(
  items: readonly T[],
  preferredPath: BuyerPreferredPath | null,
): T[] {
  if (!preferredPath) return [...items];
  return [...items].sort((a, b) => {
    if (a.preferredPath === preferredPath) return -1;
    if (b.preferredPath === preferredPath) return 1;
    return 0;
  });
}

export function loadBuyerChecklistState(): BuyerChecklistState | "dismissed" {
  try {
    const raw = localStorage.getItem(CONTROL_PLANE_CHECKLIST_KEY);
    if (raw === "dismissed") return "dismissed";
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeBuyerChecklistState(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      localStorage.setItem(CONTROL_PLANE_CHECKLIST_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return {};
  }
}

export function saveBuyerChecklistState(state: BuyerChecklistState | "dismissed"): void {
  try {
    if (state === "dismissed") {
      localStorage.setItem(CONTROL_PLANE_CHECKLIST_KEY, "dismissed");
      return;
    }
    localStorage.setItem(CONTROL_PLANE_CHECKLIST_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export function deriveChecklistCompletionsFromRoute(
  route: ControlPlaneRouteSnapshot,
): BuyerChecklistId[] {
  if (route.currentView === "receipts") return ["receipt"];
  if (route.currentView === "delegation") return ["delegation"];
  if ((route.currentView as string) === "investigation") return ["investigation"];
  if (route.currentView === "mcp-ledger") return ["tool-activity"];
  return [];
}

export function mergeChecklistCompletions(
  state: BuyerChecklistState | "dismissed",
  completions: BuyerChecklistId[],
): BuyerChecklistState | "dismissed" {
  if (state === "dismissed" || completions.length === 0) return state;
  const next: BuyerChecklistState = { ...state };
  for (const id of completions) next[id] = true;
  return next;
}

export function loadAgentsViewMode(): "basic" | "advanced" {
  try {
    return localStorage.getItem(AGENTS_VIEW_MODE_KEY) === "advanced" ? "advanced" : "basic";
  } catch {
    return "basic";
  }
}

export function saveAgentsViewMode(mode: "basic" | "advanced"): void {
  try {
    localStorage.setItem(AGENTS_VIEW_MODE_KEY, mode);
  } catch {
    // noop
  }
}
