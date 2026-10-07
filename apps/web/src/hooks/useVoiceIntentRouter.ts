import { useCallback, useRef } from "react";

import type { MainView } from "@/lib/registry/viewRegistry";
import type { CockpitMode } from "../layouts/cockpitModes";

export interface VoiceIntentActions {
  navigateToView: (viewId: MainView) => void;
  openSettings: () => void;
  openCommandPalette: () => void;
  setCockpitMode: (mode: CockpitMode) => void;
  setThemeMode: (mode: "light" | "dark") => void;
  toggleTheme: () => void;
  selectThread: (index: number) => void;
  triggerSearch: (query: string) => void;
  scrollTo: (position: "top" | "bottom") => void;
  goBack: () => void;
  refresh: () => void;
}

export interface VoiceIntentResult {
  matched: true;
  intent: string;
  label: string;
}

export interface ParsedVoiceIntent {
  intent: string;
  action:
    | "navigateToView"
    | "openSettings"
    | "openCommandPalette"
    | "setCockpitMode"
    | "setThemeMode"
    | "toggleTheme"
    | "selectThread"
    | "triggerSearch"
    | "scrollTo"
    | "goBack"
    | "refresh";
  params: Record<string, string | number>;
}

// Voice-friendly spoken phrases mapped to live view ids. Legacy product names
// are intentionally remapped onto the current five-tab IA instead of navigating
// to removed routes.
const VIEW_ALIASES: Record<string, MainView> = {
  activity: "mcp-ledger",
  agents: "agents",
  assistants: "agents",
  benchmarks: "benchmark-comparison",
  calendar: "nudges-home",
  costs: "mcp-ledger",
  "cost dashboard": "mcp-ledger",
  documents: "chat-home",
  docs: "chat-home",
  dogfood: "dogfood",
  engine: "developers",
  "engine demo": "developers",
  entity: "entity",
  feedback: "dogfood",
  footnotes: "reports-home",
  "for you": "control-plane",
  "for you feed": "control-plane",
  funding: "research",
  github: "developers",
  "github explorer": "developers",
  home: "control-plane",
  industry: "research",
  "industry updates": "research",
  inbox: "nudges-home",
  linkedin: "reports-home",
  "linkedin posts": "reports-home",
  marketplace: "agents",
  me: "me-home",
  mcp: "mcp-ledger",
  "mcp ledger": "mcp-ledger",
  "mcp log": "mcp-ledger",
  performance: "benchmark-comparison",
  "pr suggestions": "developers",
  "pull request": "developers",
  "pull requests": "developers",
  public: "reports-home",
  qa: "dogfood",
  recommendations: "control-plane",
  reports: "reports-home",
  research: "research",
  review: "dogfood",
  roadmap: "product-direction",
  shared: "reports-home",
  showcase: "control-plane",
  signals: "research",
  sources: "reports-home",
  spreadsheets: "chat-home",
  suggestions: "control-plane",
  timeline: "pulse-home",
  workspace: "chat-home",
  observability: "agents",
  health: "agents",
  "system health": "agents",
  "self healing": "agents",
  slo: "agents",
  monitoring: "agents",
  // Voice-friendly phrases
  "denied actions": "receipts",
  "agent actions": "receipts",
  diligence: "deep-sim",
  "run diligence": "deep-sim",
  "daily brief": "research",
  "daily briefing": "research",
  brief: "research",
  briefing: "research",
  receipts: "receipts",
  delegation: "delegation",
  investigation: "execution-trace",
  trace: "execution-trace",
  "deep sim": "research",
};

const MODE_ALIASES: Record<string, CockpitMode> = {
  admin: "system",
  agent: "agents",
  agents: "agents",
  build: "build",
  intel: "intel",
  intelligence: "intel",
  mission: "mission",
  system: "system",
  workspace: "build",
};

const INTERIM_VOICE_STATES = new Set(["listening", "transcribing"]);

function normalizeVoiceText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ");
}

export function isIgnoredVoiceTranscript(raw: string): boolean {
  const normalized = normalizeVoiceText(raw).replace(/\.+$/, "");
  return INTERIM_VOICE_STATES.has(normalized);
}

function resolveViewAlias(spoken: string): MainView | null {
  const normalized = normalizeVoiceText(spoken);
  if (!normalized) return null;

  const exact = VIEW_ALIASES[normalized];
  if (exact) return exact;

  const candidates = Object.keys(VIEW_ALIASES).filter(
    (alias) => alias.startsWith(normalized) || normalized.startsWith(alias),
  );
  const uniqueViews = [...new Set(candidates.map((alias) => VIEW_ALIASES[alias]))];
  return uniqueViews.length === 1 ? uniqueViews[0] : null;
}

function resolveModeAlias(spoken: string): CockpitMode | null {
  return MODE_ALIASES[normalizeVoiceText(spoken)] ?? null;
}

export function parseVoiceIntent(raw: string): ParsedVoiceIntent | null {
  const text = normalizeVoiceText(raw);
  if (!text || isIgnoredVoiceTranscript(text)) return null;
  if (text.length > 120 || text.split(/\s+/).length > 18) return null;

  if (/^(?:open\s+)?(?:settings|preferences)$/.test(text)) {
    return { intent: "system", action: "openSettings", params: {} };
  }

  if (/^(?:command\s+palette|commands|open\s+commands)$/.test(text)) {
    return { intent: "system", action: "openCommandPalette", params: {} };
  }

  const modeMatch = text.match(/^(?:(?:go|switch)\s+to\s+)?(mission|intel|build|agents|system|admin|workspace|intelligence)(?:\s+mode)?$/);
  if (modeMatch) {
    const mode = resolveModeAlias(modeMatch[1]);
    if (mode) {
      return {
        intent: "mode",
        action: "setCockpitMode",
        params: { mode },
      };
    }
  }

  if (/^(?:dark\s+mode|toggle\s+dark)$/.test(text)) {
    return { intent: "theme", action: "setThemeMode", params: { mode: "dark" } };
  }

  if (/^(?:light\s+mode|toggle\s+light)$/.test(text)) {
    return { intent: "theme", action: "setThemeMode", params: { mode: "light" } };
  }

  if (/^toggle\s+theme$/.test(text)) {
    return { intent: "theme", action: "toggleTheme", params: {} };
  }

  const searchMatch = text.match(/^(?:search\s+for|search|find|look\s+up)\s+(.+)$/);
  if (searchMatch?.[1]) {
    return {
      intent: "search",
      action: "triggerSearch",
      params: { query: searchMatch[1].trim() },
    };
  }

  const threadMatch = text.match(/^(?:(?:switch\s+to\s+)?thread|tab)\s+(\d+)$/);
  if (threadMatch) {
    return {
      intent: "thread",
      action: "selectThread",
      params: { index: parseInt(threadMatch[1], 10) },
    };
  }

  if (/^(?:go\s+back|back|previous)$/.test(text)) {
    return { intent: "utility", action: "goBack", params: {} };
  }

  if (/^(?:scroll\s+to\s+top|scroll\s+up|top)$/.test(text)) {
    return { intent: "utility", action: "scrollTo", params: { position: "top" } };
  }

  if (/^(?:scroll\s+to\s+bottom|scroll\s+down|bottom)$/.test(text)) {
    return {
      intent: "utility",
      action: "scrollTo",
      params: { position: "bottom" },
    };
  }

  if (/^(?:refresh|reload)$/.test(text)) {
    return { intent: "utility", action: "refresh", params: {} };
  }

  const bareView = resolveViewAlias(text);
  if (bareView) {
    return {
      intent: "navigate",
      action: "navigateToView",
      params: { view: bareView },
    };
  }

  const navMatch = text.match(/^(?:go\s+to|open|show|show\s+me|navigate\s+to|switch\s+to|run|what(?:'s|s|\s+is)\s+the)\s+(.+)$/);
  if (navMatch?.[1]) {
    const view = resolveViewAlias(navMatch[1]);
    if (view) {
      return {
        intent: "navigate",
        action: "navigateToView",
        params: { view },
      };
    }
  }

  return null;
}

function hasAction(
  action: ParsedVoiceIntent["action"],
  actions: Partial<VoiceIntentActions>,
): boolean {
  switch (action) {
    case "navigateToView":
      return typeof actions.navigateToView === "function";
    case "openSettings":
      return typeof actions.openSettings === "function";
    case "openCommandPalette":
      return typeof actions.openCommandPalette === "function";
    case "setCockpitMode":
      return typeof actions.setCockpitMode === "function";
    case "setThemeMode":
      return typeof actions.setThemeMode === "function";
    case "toggleTheme":
      return typeof actions.toggleTheme === "function";
    case "selectThread":
      return typeof actions.selectThread === "function";
    case "triggerSearch":
      return typeof actions.triggerSearch === "function";
    case "scrollTo":
      return typeof actions.scrollTo === "function";
    case "goBack":
      return typeof actions.goBack === "function";
    case "refresh":
      return typeof actions.refresh === "function";
  }
}

export function useVoiceIntentRouter(actions: Partial<VoiceIntentActions>): {
  handleIntent: (text: string) => boolean;
  lastResult: VoiceIntentResult | null;
} {
  const lastResultRef = useRef<VoiceIntentResult | null>(null);

  const handleIntent = useCallback(
    (text: string): boolean => {
      const parsed = parseVoiceIntent(text);
      if (!parsed || !hasAction(parsed.action, actions)) {
        lastResultRef.current = null;
        return false;
      }

      switch (parsed.action) {
        case "navigateToView":
          actions.navigateToView?.(parsed.params.view as MainView);
          break;
        case "openSettings":
          actions.openSettings?.();
          break;
        case "openCommandPalette":
          actions.openCommandPalette?.();
          break;
        case "setCockpitMode":
          actions.setCockpitMode?.(parsed.params.mode as CockpitMode);
          break;
        case "setThemeMode":
          actions.setThemeMode?.(parsed.params.mode as "light" | "dark");
          break;
        case "toggleTheme":
          actions.toggleTheme?.();
          break;
        case "selectThread":
          actions.selectThread?.(parsed.params.index as number);
          break;
        case "triggerSearch":
          actions.triggerSearch?.(parsed.params.query as string);
          break;
        case "scrollTo":
          actions.scrollTo?.(parsed.params.position as "top" | "bottom");
          break;
        case "goBack":
          actions.goBack?.();
          break;
        case "refresh":
          actions.refresh?.();
          break;
      }

      lastResultRef.current = {
        matched: true,
        intent: parsed.intent,
        label: text.trim(),
      };
      return true;
    },
    [actions],
  );

  return { handleIntent, lastResult: lastResultRef.current };
}
