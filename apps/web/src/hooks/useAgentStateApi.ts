/**
 * useAgentStateApi — Exposes current app state to agents via a stable interface.
 *
 * Agents (browser-based via WebMCP or server-side via Convex) use this to
 * understand where the user is, what data is available, and what actions
 * they can take — before they attempt any navigation or interaction.
 *
 * Pattern follows useMainLayoutRouting.ts — pure React hook, no side effects.
 */

import { useMemo } from "react";
import type { MainView } from "@/lib/registry/viewRegistry";
import {
  type ViewCapability,
  getViewCapability,
  getAllViewCapabilities,
} from "@/lib/registry/viewCapabilityRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentAppState {
  /** Current active view */
  currentView: MainView;
  /** Current URL path */
  currentPath: string;
  /** Full capability manifest for the current view */
  viewCapabilities: ViewCapability;
  /** Is the user authenticated? */
  isAuthenticated: boolean;
  /** All views the agent can navigate to */
  availableViews: ViewCapability[];
  /** Is the agent panel open? */
  agentPanelOpen: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentStateApi(
  currentView: MainView,
  currentPath: string,
  isAuthenticated: boolean,
  agentPanelOpen: boolean,
): AgentAppState {
  const viewCapabilities = useMemo(
    () => getViewCapability(currentView),
    [currentView],
  );

  const availableViews = useMemo(() => {
    const all = getAllViewCapabilities();
    // If not authenticated, only show views that don't require auth
    if (!isAuthenticated) {
      return all.filter((v) => !v.requiresAuth);
    }
    return all;
  }, [isAuthenticated]);

  return useMemo(
    () => ({
      currentView,
      currentPath,
      viewCapabilities,
      isAuthenticated,
      availableViews,
      agentPanelOpen,
    }),
    [currentView, currentPath, viewCapabilities, isAuthenticated, availableViews, agentPanelOpen],
  );
}

// ---------------------------------------------------------------------------
// Serialization helpers (for WebMCP tool responses)
// ---------------------------------------------------------------------------

/** Serialize the full agent state as a JSON-friendly object */
export function serializeAgentState(state: AgentAppState) {
  return {
    currentView: state.currentView,
    currentPath: state.currentPath,
    isAuthenticated: state.isAuthenticated,
    agentPanelOpen: state.agentPanelOpen,
    currentViewCapabilities: {
      title: state.viewCapabilities.title,
      description: state.viewCapabilities.description,
      dataEndpoints: state.viewCapabilities.dataEndpoints,
      actions: state.viewCapabilities.actions,
      relatedToolCategories: state.viewCapabilities.relatedToolCategories,
      tags: state.viewCapabilities.tags,
    },
    availableViewCount: state.availableViews.length,
  };
}

/** Serialize the view manifest (all views) for agents */
export function serializeViewManifest(state: AgentAppState) {
  return state.availableViews.map((v) => ({
    viewId: v.viewId,
    title: v.title,
    description: v.description,
    paths: v.paths,
    actionCount: v.actions.length,
    dataEndpointCount: v.dataEndpoints.length,
    tags: v.tags,
    requiresAuth: v.requiresAuth,
  }));
}
