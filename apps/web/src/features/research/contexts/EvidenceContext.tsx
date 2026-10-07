"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import type { Evidence } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceStore {
  /** All evidence items indexed by ID for O(1) lookup */
  evidenceById: Map<string, Evidence>;
  /** Currently highlighted evidence ID (for animation) */
  highlightedId: string | null;
  /** IDs to show in tooltip preview */
  hoveredIds: string[];
}

export interface EvidenceContextValue {
  store: EvidenceStore;
  /** Register evidence items (call once when signals load) */
  registerEvidence: (evidence: Evidence[]) => void;
  /** Get evidence by ID */
  getEvidence: (id: string) => Evidence | undefined;
  /** Get multiple evidence items by IDs */
  getEvidenceList: (ids?: string[]) => Evidence[];
  /** Highlight an evidence card (triggers CSS animation) */
  highlightEvidence: (id: string) => void;
  /** Clear highlight */
  clearHighlight: () => void;
  /** Scroll to an evidence card and highlight it */
  scrollToEvidence: (id: string) => void;
  /** Set hovered IDs for tooltip preview */
  setHoveredIds: (ids: string[]) => void;
  /** Clear hovered IDs */
  clearHoveredIds: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

const EvidenceContext = createContext<EvidenceContextValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [evidenceById, setEvidenceById] = useState<Map<string, Evidence>>(new Map());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredIds, setHoveredIdsState] = useState<string[]>([]);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const registerEvidence = useCallback((evidence: Evidence[]) => {
    setEvidenceById((prev) => {
      const next = new Map(prev);
      evidence.forEach((e) => {
        if (e.id) next.set(e.id, e);
      });
      return next;
    });
  }, []);

  const getEvidence = useCallback(
    (id: string) => evidenceById.get(id),
    [evidenceById]
  );

  const getEvidenceList = useCallback(
    (ids?: string[]) => {
      if (!ids) return Array.from(evidenceById.values());
      return ids.map((id) => evidenceById.get(id)).filter(Boolean) as Evidence[];
    },
    [evidenceById]
  );

  const highlightEvidence = useCallback((id: string) => {
    // Clear any existing timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    
    setHighlightedId(id);
    
    // Auto-clear highlight after animation
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedId(null);
    }, 2000);
  }, []);

  const clearHighlight = useCallback(() => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    setHighlightedId(null);
  }, []);

  const scrollToEvidence = useCallback((id: string) => {
    const element = document.querySelector(`[data-evidence-id="${id}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightEvidence(id);
    }
  }, [highlightEvidence]);

  const setHoveredIds = useCallback((ids: string[]) => {
    setHoveredIdsState(ids);
  }, []);

  const clearHoveredIds = useCallback(() => {
    setHoveredIdsState([]);
  }, []);

  const store = useMemo<EvidenceStore>(
    () => ({
      evidenceById,
      highlightedId,
      hoveredIds,
    }),
    [evidenceById, highlightedId, hoveredIds]
  );

  const value = useMemo<EvidenceContextValue>(
    () => ({
      store,
      registerEvidence,
      getEvidence,
      getEvidenceList,
      highlightEvidence,
      clearHighlight,
      scrollToEvidence,
      setHoveredIds,
      clearHoveredIds,
    }),
    [
      store,
      registerEvidence,
      getEvidence,
      getEvidenceList,
      highlightEvidence,
      clearHighlight,
      scrollToEvidence,
      setHoveredIds,
      clearHoveredIds,
    ]
  );

  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

export function useEvidence(): EvidenceContextValue {
  const context = useContext(EvidenceContext);
  if (!context) {
    throw new Error("useEvidence must be used within an EvidenceProvider");
  }
  return context;
}

/**
 * Lightweight hook for components that only need to check if they are highlighted
 */
export function useEvidenceHighlight(evidenceId: string): boolean {
  const context = useContext(EvidenceContext);
  return context?.store.highlightedId === evidenceId;
}
