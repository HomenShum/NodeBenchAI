import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type LineSelections = Record<string, Record<number, boolean>>; // blockId -> lineIdx -> checked

type ProposalContextValue = {
  selections: LineSelections;
  setSelections: React.Dispatch<React.SetStateAction<LineSelections>>;
  toggleLine: (blockId: string, idx: number) => void;
  setBlockDefaults: (blockId: string, defaults: Record<number, boolean>) => void;
  selectAllAcrossBlocks: () => void;
  clearAllSelections: () => void;
};

const ProposalContext = createContext<ProposalContextValue | undefined>(undefined);

export function useProposal() {
  const ctx = useContext(ProposalContext);
  if (!ctx) throw new Error("useProposal must be used within a ProposalProvider");
  return ctx;
}

export function ProposalProvider({ children }: { children: React.ReactNode }) {
  const [selections, setSelections] = useState<LineSelections>({});

  const toggleLine = useCallback((blockId: string, idx: number) => {
    setSelections((prev) => {
      const byBlock = prev[blockId] ? { ...prev[blockId] } : {};
      byBlock[idx] = !byBlock[idx];
      return { ...prev, [blockId]: byBlock };
    });
  }, []);

  const setBlockDefaults = useCallback((blockId: string, defaults: Record<number, boolean>) => {
    setSelections((prev) => ({ ...prev, [blockId]: { ...(prev[blockId] || {}), ...defaults } }));
  }, []);

  const selectAllAcrossBlocks = useCallback(() => {
    setSelections((prev) => {
      const next: LineSelections = {};
      for (const [bid, map] of Object.entries(prev)) {
        const updated: Record<number, boolean> = {};
        for (const [k] of Object.entries(map)) updated[Number(k)] = true;
        next[bid] = updated;
      }
      return next;
    });
  }, []);

  const clearAllSelections = useCallback(() => {
    setSelections({});
  }, []);

  const value = useMemo(
    () => ({ selections, setSelections, toggleLine, setBlockDefaults, selectAllAcrossBlocks, clearAllSelections }),
    [selections, toggleLine, setBlockDefaults, selectAllAcrossBlocks]
  );

  return <ProposalContext.Provider value={value}>{children}</ProposalContext.Provider>;
}

