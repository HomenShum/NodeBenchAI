"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Act = "actI" | "actII" | "actIII";
export type FocusSource = "chart_hover" | "text_hover" | "agent_tool" | "panel_action";

export interface FocusState {
  /** Current act (scrolly section) */
  currentAct: Act;
  /** Focused data point index on chart */
  focusedDataIndex: number | null;
  /** Hovered interactive span ID in text */
  hoveredSpanId: string | null;
  /** Active section ID in scrolly layout */
  activeSectionId: string | null;
  /** Chart series currently focused */
  focusedSeriesId: string | null;
  /** Source of last focus change */
  focusSource: FocusSource | null;
}

export interface FocusSyncContextValue {
  /** Current focus state (from Convex subscription) */
  focusState: FocusState;
  /** Whether we're connected to a brief */
  isConnected: boolean;
  /** Brief ID we're syncing with */
  briefId: string | null;
  /** Update focus from chart hover */
  onChartHover: (dataIndex: number | null, seriesId?: string) => void;
  /** Update focus from text span hover */
  onTextHover: (spanId: string | null, dataIndex?: number) => void;
  /** Update current act */
  onActChange: (act: Act) => void;
  /** Update active section */
  onSectionChange: (sectionId: string | null) => void;
  /** Clear all focus */
  clearFocus: () => void;
}

const defaultFocusState: FocusState = {
  currentAct: "actI",
  focusedDataIndex: null,
  hoveredSpanId: null,
  activeSectionId: null,
  focusedSeriesId: null,
  focusSource: null,
};

// Fallback context for components rendered outside of a FocusSyncProvider.
// This prevents runtime errors (e.g. on the ResearchHub scrolly view)
// while still exposing that focus sync is inactive via isConnected = false.
const noop = () => { };

const fallbackContext: FocusSyncContextValue = {
  focusState: defaultFocusState,
  isConnected: false,
  briefId: null,
  onChartHover: noop,
  onTextHover: noop,
  onActChange: noop,
  onSectionChange: noop,
  clearFocus: noop,
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

const FocusSyncContext = createContext<FocusSyncContextValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

interface FocusSyncProviderProps {
  children: React.ReactNode;
  briefId: string;
}

export function FocusSyncProvider({ children, briefId }: FocusSyncProviderProps) {
  // Subscribe to focus state from Convex
  const convexFocusState = useQuery(api.domains.dossier.focusState.getFocusState, { briefId });

  // Mutations for updating focus
  const updateFocusMutation = useMutation(api.domains.dossier.focusState.updateFocus);
  const clearFocusMutation = useMutation(api.domains.dossier.focusState.clearFocus);

  // Transform Convex state to our FocusState type
  const focusState = useMemo<FocusState>(() => {
    if (!convexFocusState) return defaultFocusState;
    return {
      currentAct: convexFocusState.currentAct ?? "actI",
      focusedDataIndex: convexFocusState.focusedDataIndex ?? null,
      hoveredSpanId: convexFocusState.hoveredSpanId ?? null,
      activeSectionId: convexFocusState.activeSectionId ?? null,
      focusedSeriesId: convexFocusState.focusedSeriesId ?? null,
      focusSource: convexFocusState.focusSource ?? null,
    };
  }, [convexFocusState]);

  const onChartHover = useCallback(
    (dataIndex: number | null, seriesId?: string) => {
      updateFocusMutation({
        briefId,
        focusedDataIndex: dataIndex ?? undefined,
        focusedSeriesId: seriesId,
        focusSource: "chart_hover",
      });
    },
    [briefId, updateFocusMutation]
  );

  const onTextHover = useCallback(
    (spanId: string | null, dataIndex?: number) => {
      updateFocusMutation({
        briefId,
        hoveredSpanId: spanId ?? undefined,
        focusedDataIndex: dataIndex,
        focusSource: "text_hover",
      });
    },
    [briefId, updateFocusMutation]
  );

  const onActChange = useCallback(
    (act: Act) => {
      updateFocusMutation({
        briefId,
        currentAct: act,
      });
    },
    [briefId, updateFocusMutation]
  );

  const onSectionChange = useCallback(
    (sectionId: string | null) => {
      updateFocusMutation({
        briefId,
        activeSectionId: sectionId ?? undefined,
      });
    },
    [briefId, updateFocusMutation]
  );

  const clearFocus = useCallback(() => {
    clearFocusMutation({ briefId });
  }, [briefId, clearFocusMutation]);

  const value = useMemo<FocusSyncContextValue>(
    () => ({
      focusState,
      isConnected: convexFocusState !== undefined,
      briefId,
      onChartHover,
      onTextHover,
      onActChange,
      onSectionChange,
      clearFocus,
    }),
    [focusState, convexFocusState, briefId, onChartHover, onTextHover, onActChange, onSectionChange, clearFocus]
  );

  return <FocusSyncContext.Provider value={value}>{children}</FocusSyncContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

export function useFocusSync(): FocusSyncContextValue {
  const context = useContext(FocusSyncContext);
  if (!context) {
    return fallbackContext;
  }
  return context;
}

/**
 * Lightweight hook for components that only need to check if a data point is focused
 */
export function useDataPointFocus(dataIndex: number): boolean {
  const context = useContext(FocusSyncContext);
  return context?.focusState.focusedDataIndex === dataIndex;
}

/**
 * Lightweight hook for components that only need to check if a span is hovered
 */
export function useSpanHover(spanId: string): boolean {
  const context = useContext(FocusSyncContext);
  return context?.focusState.hoveredSpanId === spanId;
}

/**
 * Hook to get current act
 */
export function useCurrentAct(): Act {
  const context = useContext(FocusSyncContext);
  return context?.focusState.currentAct ?? "actI";
}

/**
 * Hook for charts to sync with text focus
 *
 * Returns:
 * - focusedDataIndex: The currently focused data point index (from text hover)
 * - focusedSeriesId: The currently focused series ID
 * - onDataPointHover: Callback to emit when a chart data point is hovered
 * - isDataPointFocused: Helper to check if a specific data point is focused
 */
export function useChartFocusSync() {
  const context = useContext(FocusSyncContext);

  const focusedDataIndex = context?.focusState.focusedDataIndex ?? null;
  const focusedSeriesId = context?.focusState.focusedSeriesId ?? null;
  const focusSource = context?.focusState.focusSource ?? null;

  const onDataPointHover = useCallback(
    (dataIndex: number | null, seriesId?: string) => {
      context?.onChartHover(dataIndex, seriesId);
    },
    [context]
  );

  const isDataPointFocused = useCallback(
    (dataIndex: number) => focusedDataIndex === dataIndex,
    [focusedDataIndex]
  );

  // Check if focus came from text (so chart should highlight)
  const isFocusFromText = focusSource === "text_hover";

  return {
    focusedDataIndex,
    focusedSeriesId,
    focusSource,
    isFocusFromText,
    onDataPointHover,
    isDataPointFocused,
    isConnected: context?.isConnected ?? false,
  };
}

