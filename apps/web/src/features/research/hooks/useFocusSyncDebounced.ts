/**
 * useFocusSyncDebounced - Optimized focus sync hook with debouncing and optimistic updates
 *
 * Solves the performance problem of firing Convex mutations on every hover event.
 * Instead:
 * 1. Updates local state immediately (optimistic)
 * 2. Debounces the mutation to Convex (100ms)
 * 3. Syncs back from Convex subscription for cross-client updates
 *
 * Usage:
 * const { focusState, onChartHover, onTextHover, onActChange } = useFocusSyncDebounced(briefId);
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';

export type Act = 'actI' | 'actII' | 'actIII';
export type FocusSource = 'chart_hover' | 'text_hover' | 'agent_tool' | 'panel_action';

export interface FocusState {
  currentAct: Act;
  focusedDataIndex: number | null;
  hoveredSpanId: string | null;
  activeSectionId: string | null;
  focusedSeriesId: string | null;
  focusSource: FocusSource | null;
}

const defaultFocusState: FocusState = {
  currentAct: 'actI',
  focusedDataIndex: null,
  hoveredSpanId: null,
  activeSectionId: null,
  focusedSeriesId: null,
  focusSource: null,
};

const DEBOUNCE_MS = 100;

export function useFocusSyncDebounced(briefId: string | null) {
  // Subscribe to Convex focus state for cross-client sync
  const convexFocusState = useQuery(
    api.domains.dossier.focusState.getFocusState,
    briefId ? { briefId } : 'skip'
  );

  // Mutations
  const updateFocusMutation = useMutation(api.domains.dossier.focusState.updateFocus);
  const clearFocusMutation = useMutation(api.domains.dossier.focusState.clearFocus);

  // Optimistic local state
  const [localFocus, setLocalFocus] = useState<FocusState>(defaultFocusState);

  // Track if local state is "dirty" (ahead of server)
  const isDirtyRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdateRef = useRef<Partial<FocusState> | null>(null);

  // Sync from Convex when not dirty
  useEffect(() => {
    if (!isDirtyRef.current && convexFocusState) {
      setLocalFocus({
        currentAct: convexFocusState.currentAct ?? 'actI',
        focusedDataIndex: convexFocusState.focusedDataIndex ?? null,
        hoveredSpanId: convexFocusState.hoveredSpanId ?? null,
        activeSectionId: convexFocusState.activeSectionId ?? null,
        focusedSeriesId: convexFocusState.focusedSeriesId ?? null,
        focusSource: convexFocusState.focusSource ?? null,
      });
    }
  }, [convexFocusState]);

  // Flush pending update to Convex
  const flushToConvex = useCallback(() => {
    if (!briefId || !pendingUpdateRef.current) return;

    const update = pendingUpdateRef.current;
    pendingUpdateRef.current = null;

    updateFocusMutation({
      briefId,
      ...(update.currentAct !== undefined && { currentAct: update.currentAct }),
      ...(update.focusedDataIndex !== undefined && { focusedDataIndex: update.focusedDataIndex ?? undefined }),
      ...(update.hoveredSpanId !== undefined && { hoveredSpanId: update.hoveredSpanId ?? undefined }),
      ...(update.activeSectionId !== undefined && { activeSectionId: update.activeSectionId ?? undefined }),
      ...(update.focusedSeriesId !== undefined && { focusedSeriesId: update.focusedSeriesId ?? undefined }),
      ...(update.focusSource !== undefined && { focusSource: update.focusSource ?? undefined }),
    })
      .catch(console.error)
      .finally(() => {
        isDirtyRef.current = false;
      });
  }, [briefId, updateFocusMutation]);

  // Debounced update helper
  const scheduleUpdate = useCallback((update: Partial<FocusState>) => {
    isDirtyRef.current = true;
    pendingUpdateRef.current = { ...pendingUpdateRef.current, ...update };

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      flushToConvex();
      debounceTimerRef.current = null;
    }, DEBOUNCE_MS);
  }, [flushToConvex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        // Flush any pending update immediately
        flushToConvex();
      }
    };
  }, [flushToConvex]);

  // Handler: Chart hover
  const onChartHover = useCallback((dataIndex: number | null, seriesId?: string) => {
    // Optimistic local update
    setLocalFocus(prev => ({
      ...prev,
      focusedDataIndex: dataIndex,
      focusedSeriesId: seriesId ?? prev.focusedSeriesId,
      focusSource: 'chart_hover',
    }));

    // Schedule debounced mutation
    scheduleUpdate({
      focusedDataIndex: dataIndex,
      focusedSeriesId: seriesId,
      focusSource: 'chart_hover',
    });
  }, [scheduleUpdate]);

  // Handler: Text hover
  const onTextHover = useCallback((spanId: string | null, dataIndex?: number) => {
    setLocalFocus(prev => ({
      ...prev,
      hoveredSpanId: spanId,
      focusedDataIndex: dataIndex ?? prev.focusedDataIndex,
      focusSource: 'text_hover',
    }));

    scheduleUpdate({
      hoveredSpanId: spanId,
      focusedDataIndex: dataIndex,
      focusSource: 'text_hover',
    });
  }, [scheduleUpdate]);

  // Handler: Act change (immediate, no debounce needed)
  const onActChange = useCallback((act: Act) => {
    setLocalFocus(prev => ({
      ...prev,
      currentAct: act,
    }));

    if (briefId) {
      updateFocusMutation({ briefId, currentAct: act }).catch(console.error);
    }
  }, [briefId, updateFocusMutation]);

  // Handler: Section change
  const onSectionChange = useCallback((sectionId: string | null) => {
    setLocalFocus(prev => ({
      ...prev,
      activeSectionId: sectionId,
    }));

    scheduleUpdate({ activeSectionId: sectionId });
  }, [scheduleUpdate]);

  // Handler: Clear focus
  const clearFocus = useCallback(() => {
    setLocalFocus(defaultFocusState);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingUpdateRef.current = null;
    isDirtyRef.current = false;

    if (briefId) {
      clearFocusMutation({ briefId }).catch(console.error);
    }
  }, [briefId, clearFocusMutation]);

  return {
    focusState: localFocus,
    isConnected: !!briefId && convexFocusState !== undefined,
    briefId,
    onChartHover,
    onTextHover,
    onActChange,
    onSectionChange,
    clearFocus,
  };
}

/**
 * Lightweight hook to check if a specific data point is focused
 */
export function useIsDataPointFocused(briefId: string | null, dataIndex: number): boolean {
  const convexFocusState = useQuery(
    api.domains.dossier.focusState.getFocusState,
    briefId ? { briefId } : 'skip'
  );
  return convexFocusState?.focusedDataIndex === dataIndex;
}

/**
 * Lightweight hook to check if a specific span is hovered
 */
export function useIsSpanHovered(briefId: string | null, spanId: string): boolean {
  const convexFocusState = useQuery(
    api.domains.dossier.focusState.getFocusState,
    briefId ? { briefId } : 'skip'
  );
  return convexFocusState?.hoveredSpanId === spanId;
}

export default useFocusSyncDebounced;
