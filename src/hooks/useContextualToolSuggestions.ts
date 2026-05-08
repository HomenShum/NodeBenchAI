/**
 * useContextualToolSuggestions - view-aware tool/action suggestions.
 *
 * Given the current view ID + optional buyer preference, returns a ranked
 * list of suggestion chips (label, description, action) that are contextually
 * relevant. Used by the Home intake surface for dynamic chips and by any view
 * that wants "you might also..." cards.
 */

import { useMemo } from "react";
import type { MainView } from "@/lib/registry/viewRegistry";
import type { BuyerPreferredPath } from "@/features/controlPlane/lib/onboardingState";

export interface ToolSuggestion {
  id: string;
  label: string;
  description: string;
  /** View to navigate to */
  target: MainView;
  /** Optional path override */
  path?: string;
  /** Relevance score 0-1 for ranking */
  score: number;
  /** Tags for filtering */
  tags: string[];
}

/**
 * Time-of-day context buckets.
 * Morning: review overnight agent runs -> receipts, execution trace
 * Afternoon: active work -> agents, chat, research
 * Evening: planning/reflection -> product direction, benchmarks, dogfood
 */
type DayPart = "morning" | "afternoon" | "evening";

function getDayPart(): DayPart {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/**
 * All possible suggestion entries with contextual scoring signals.
 */
const SUGGESTION_POOL: Array<
  ToolSuggestion & {
    /** Which day parts boost this suggestion */
    dayPartBoost?: DayPart[];
    /** Which buyer paths boost this suggestion */
    preferredPathBoost?: BuyerPreferredPath[];
  }
> = [
  {
    id: "review-receipts",
    label: "Review agent receipts",
    description: "See what agents did overnight and whether actions were allowed",
    target: "receipts",
    path: "/receipts",
    score: 0.7,
    tags: ["qa", "review", "trust", "agent"],
    dayPartBoost: ["morning"],
    preferredPathBoost: ["receipts"],
  },
  {
    id: "investigate-run",
    label: "Investigate a run",
    description: "Trace from action to evidence to approval for any agent session",
    target: "execution-trace",
    path: "/execution-trace",
    score: 0.65,
    tags: ["qa", "debug", "trace", "evidence"],
    dayPartBoost: ["morning"],
    preferredPathBoost: ["investigation"],
  },
  {
    id: "mcp-ledger",
    label: "Inspect tool activity",
    description: "Internal tool traces, blocked steps, and request history behind agent workflows",
    target: "mcp-ledger",
    path: "/internal/mcp-ledger",
    score: 0.6,
    tags: ["debug", "tools", "ledger", "operator"],
    dayPartBoost: ["morning", "evening"],
    preferredPathBoost: ["mcp-ledger"],
  },
  {
    id: "review-passport",
    label: "Review passport",
    description: "Check scoped tools, denied actions, and approval gates",
    target: "delegation",
    path: "/delegation",
    score: 0.55,
    tags: ["trust", "delegation", "approval", "security"],
    preferredPathBoost: ["delegation"],
  },
  {
    id: "launch-agent",
    label: "Launch an agent workflow",
    description: "Start a new task, monitor active threads, or clear blockers",
    target: "agents",
    path: "/agents",
    score: 0.5,
    tags: ["agent", "workflow", "execution"],
    dayPartBoost: ["afternoon"],
  },
  {
    id: "open-workspace",
    label: "Open workspace",
    description: "Chat with documents, evidence, and work in progress",
    target: "chat-home",
    path: "/?surface=chat",
    score: 0.45,
    tags: ["workspace", "documents", "productivity"],
    dayPartBoost: ["afternoon"],
  },
  {
    id: "check-benchmarks",
    label: "Check benchmark results",
    description: "Run evals, compare agent runs, and review quality scores",
    target: "benchmark-comparison",
    path: "/benchmarks",
    score: 0.4,
    tags: ["qa", "eval", "benchmark", "performance"],
    dayPartBoost: ["evening"],
  },
  {
    id: "product-direction",
    label: "Review product direction",
    description: "Public-evidence memo for what to build next",
    target: "product-direction",
    path: "/product-direction",
    score: 0.35,
    tags: ["strategy", "planning", "direction"],
    dayPartBoost: ["evening"],
  },
  {
    id: "world-monitor",
    label: "Scan world monitor",
    description: "Geopolitical, regulatory, and market events clustered for impact",
    target: "world-monitor",
    path: "/research/world-monitor",
    score: 0.35,
    tags: ["research", "monitoring", "signals", "geopolitical"],
    dayPartBoost: ["morning", "afternoon"],
  },
  {
    id: "execution-trace",
    label: "Open execution trace",
    description: "Search, verify, and export workflows as auditable receipts",
    target: "execution-trace",
    path: "/execution-trace",
    score: 0.4,
    tags: ["qa", "trace", "audit", "verification"],
    dayPartBoost: ["afternoon"],
    preferredPathBoost: ["investigation"],
  },
  {
    id: "research-overview",
    label: "Research overview",
    description: "Companies, deals, signals, and market landscape",
    target: "research",
    path: "/research/overview",
    score: 0.45,
    tags: ["research", "overview", "deals"],
    dayPartBoost: ["afternoon"],
  },
];

/**
 * Returns ranked, contextual suggestions for the current view + user state.
 *
 * @param currentView - The active view (used to filter out current page)
 * @param preferredPath - User's saved buyer preference (boosts matching suggestions)
 * @param limit - Max suggestions to return (default 4)
 */
export function useContextualToolSuggestions(
  currentView: MainView | null,
  preferredPath: BuyerPreferredPath | null,
  limit = 4,
): ToolSuggestion[] {
  return useMemo(() => {
    const dayPart = getDayPart();

    const scored = SUGGESTION_POOL
      // Filter out the current view's suggestion
      .filter((s) => s.target !== currentView)
      .map((s) => {
        let score = s.score;

        // Boost by time of day (+0.15)
        if (s.dayPartBoost?.includes(dayPart)) {
          score += 0.15;
        }

        // Boost by preferred buyer path (+0.2)
        if (preferredPath && s.preferredPathBoost?.includes(preferredPath)) {
          score += 0.2;
        }

        return { ...s, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }, [currentView, preferredPath, limit]);
}

/**
 * Get suggestions filtered by tags (e.g., "qa" to get all QA-related suggestions).
 */
export function useTagFilteredSuggestions(
  tags: string[],
  currentView: MainView | null,
  preferredPath: BuyerPreferredPath | null,
  limit = 6,
): ToolSuggestion[] {
  const all = useContextualToolSuggestions(currentView, preferredPath, 12);
  return useMemo(() => {
    if (tags.length === 0) return all.slice(0, limit);
    return all
      .filter((s) => tags.some((tag) => s.tags.includes(tag)))
      .slice(0, limit);
  }, [all, tags, limit]);
}
