import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Id } from "../../convex/_generated/dataModel";

// Types
export type ViewingDoc = { id: Id<"documents">; title?: string };
export type FocusContext = {
  documentId: Id<"documents">;
  blockId?: string;
  beforeIds?: string[];
  afterIds?: string[];
  preview?: string;
};

export type ToolsAndMcp = {
  mcpServerName?: string;
  toolCount?: number;
};

export type UIInfo = {
  summary: string;
};

interface ContextPillsState {
  focused: FocusContext | null;
  viewingDocs: ViewingDoc[]; // current on-screen docs (grid or single)
  previousDocs: ViewingDoc[]; // history, most recent first, unique by id
  contextDocs: ViewingDoc[]; // explicitly added context docs (e.g., via AI)
  toolsMcp: ToolsAndMcp;
  uiInfo: UIInfo | null;

  // setters
  setFocused: (f: FocusContext | null) => void;
  setViewingDocs: (docs: ViewingDoc[]) => void;
  addPreviouslyViewed: (doc: ViewingDoc) => void;
  setContextDocs: (docs: ViewingDoc[]) => void;
  setToolsMcp: (info: ToolsAndMcp) => void;
  setUiInfo: (info: UIInfo | null) => void;
}

const ContextPillsCtx = createContext<ContextPillsState | null>(null);

export function ContextPillsProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocusedState] = useState<FocusContext | null>(null);
  const [viewingDocs, setViewingDocsState] = useState<ViewingDoc[]>([]);
  const [previousDocs, setPreviousDocs] = useState<ViewingDoc[]>([]);
  const [contextDocs, setContextDocsState] = useState<ViewingDoc[]>([]);
  const [toolsMcp, setToolsMcpState] = useState<ToolsAndMcp>({});
  const [uiInfo, setUiInfoState] = useState<UIInfo | null>(null);

  // Helpers for equality checks to avoid redundant state updates
  const eqArrays = useCallback((a?: string[], b?: string[]) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }, []);
  const eqFocus = useCallback((a: FocusContext | null, b: FocusContext | null) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.documentId === b.documentId &&
      a.blockId === b.blockId &&
      a.preview === b.preview &&
      eqArrays(a.beforeIds, b.beforeIds) &&
      eqArrays(a.afterIds, b.afterIds)
    );
  }, [eqArrays]);
  const eqViewingDocs = useCallback((a: ViewingDoc[], b: ViewingDoc[]) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || a[i].title !== b[i].title) return false;
    }
    return true;
  }, []);
  const eqTools = useCallback((a: ToolsAndMcp, b: ToolsAndMcp) => {
    return a.mcpServerName === b.mcpServerName && a.toolCount === b.toolCount;
  }, []);
  const eqUiInfo = useCallback((a: UIInfo | null, b: UIInfo | null) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.summary === b.summary;
  }, []);

  const setFocused = useCallback((f: FocusContext | null) => {
    setFocusedState((prev) => (eqFocus(prev, f) ? prev : f));
  }, [eqFocus]);

  const setViewingDocs = useCallback((docs: ViewingDoc[]) => {
    setViewingDocsState((prev) => (eqViewingDocs(prev, docs) ? prev : docs));
  }, [eqViewingDocs]);

  const addPreviouslyViewed = useCallback((doc: ViewingDoc) => {
    setPreviousDocs((prev) => {
      // If it's already the first with same title, no update
      if (prev.length > 0 && prev[0].id === doc.id && prev[0].title === doc.title) return prev;
      const filtered = prev.filter((d) => d.id !== doc.id);
      const updated = [doc, ...filtered];
      return updated.slice(0, 10); // cap history
    });
  }, []);

  const setContextDocs = useCallback((docs: ViewingDoc[]) => {
    setContextDocsState((prev) => (eqViewingDocs(prev, docs) ? prev : docs));
  }, [eqViewingDocs]);

  const setToolsMcp = useCallback((info: ToolsAndMcp) => {
    setToolsMcpState((prev) => (eqTools(prev, info) ? prev : info));
  }, [eqTools]);
  const setUiInfo = useCallback((info: UIInfo | null) => {
    setUiInfoState((prev) => (eqUiInfo(prev, info) ? prev : info));
  }, [eqUiInfo]);

  const value = useMemo<ContextPillsState>(() => ({
    focused,
    viewingDocs,
    previousDocs,
    contextDocs,
    toolsMcp,
    uiInfo,
    setFocused,
    setViewingDocs,
    addPreviouslyViewed,
    setContextDocs: setContextDocs,
    setToolsMcp,
    setUiInfo,
  }), [focused, viewingDocs, previousDocs, contextDocs, toolsMcp, uiInfo, setFocused, setViewingDocs, addPreviouslyViewed, setContextDocs, setToolsMcp, setUiInfo]);

  return (
    <ContextPillsCtx.Provider value={value}>{children}</ContextPillsCtx.Provider>
  );
}

export function useContextPills() {
  const ctx = useContext(ContextPillsCtx);
  if (!ctx) throw new Error("useContextPills must be used within ContextPillsProvider");
  return ctx;
}
