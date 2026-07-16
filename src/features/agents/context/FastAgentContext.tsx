/**
 * FastAgentContext - Global context for controlling Fast Agent panel
 *
 * Allows any component to open/close the Fast Agent panel and
 * inject content for analysis. Supports contextual opening with:
 * - Initial message (pre-filled prompt)
 * - Context document IDs (documents to analyze)
 * - Context web URLs (external articles to analyze)
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode, useEffect } from 'react';
import { matchesAskShortcut } from "@/features/agents/lib/askShortcut";

/** Dossier context for bidirectional sync */
export interface DossierContext {
  /** Brief/dossier ID for focus state sync */
  briefId: string;
  /** Current act (scrolly section) */
  currentAct?: "actI" | "actII" | "actIII";
  /** Currently focused data point index */
  focusedDataIndex?: number;
  /** Focused chart series ID (when available) */
  focusedSeriesId?: string;
  /** Chart context for agent awareness */
  chartContext?: {
    seriesId: string;
    dataLabel: string;
    value: number;
    unit?: string;
  };
  /** Active section ID in scrolly layout */
  activeSectionId?: string;
}

/** Options for opening the agent with context */
export interface AgentOpenOptions {
  /** Unique identifier for this open request (used to prevent duplicate auto-sends) */
  requestId?: string;
  /** Preferred tab when the drawer opens. */
  initialTab?: "chat" | "scratchpad" | "flow" | "sources" | "trace";
  /** Pre-filled initial message/prompt */
  initialMessage?: string;
  /** Document IDs to load as context */
  contextDocumentIds?: string[];
  /** External URLs to analyze (for news feed items) */
  contextWebUrls?: string[];
  /** Title of the content being analyzed (for display) */
  contextTitle?: string;
  /**
   * Entity slug the user is currently viewing. When set, the panel agent
   * knows which entity notebook is "active" and can offer a "Save to
   * notebook" CTA on responses. Required for cross-surface unification:
   * Chat / Panel / Inline all target the same productBlocks table when an
   * entitySlug is present.
   */
  contextEntitySlug?: string;
  /** Dossier context for bidirectional sync */
  dossierContext?: DossierContext;
}

interface FastAgentContextValue {
  /** Whether the Fast Agent panel should be open */
  isOpen: boolean;
  /** Current context options (if opened with context) */
  options: AgentOpenOptions | null;
  /**
   * Entity slug for the route the user is currently viewing. Tracked
   * independently of whether the panel is open — so when the user opens
   * the panel on an entity page, the panel already knows which entity's
   * notebook to target. Set by the entity page on mount / cleared on
   * unmount via `useActiveEntity`.
   */
  activeEntitySlug: string | null;
  /** Whether an external panel handler is registered (e.g., MainLayout) */
  hasExternalHandler: boolean;
  /** Open the Fast Agent panel (optionally with context) */
  open: (opts?: AgentOpenOptions) => void;
  /** Open with specific context (convenience method) */
  openWithContext: (opts: AgentOpenOptions) => void;
  /** Close the Fast Agent panel */
  close: () => void;
  /** Toggle the Fast Agent panel */
  toggle: () => void;
  /** Set the open state directly */
  setIsOpen: (open: boolean) => void;
  /** Clear the current context options */
  clearOptions: () => void;
  /** Register an external state setter (from MainLayout) */
  registerExternalState: (setter: (open: boolean) => void, getter: () => boolean) => void;
  /**
   * Set the active entity slug. Called by the entity page on mount;
   * passed `null` on unmount. The panel subscribes to this so agent
   * responses can offer "Save to notebook" CTAs against the right entity.
   */
  setActiveEntitySlug: (slug: string | null) => void;
}

const FastAgentContext = createContext<FastAgentContextValue | null>(null);

export function FastAgentProvider({ children }: { children: ReactNode }) {
  // Internal state as fallback
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  // Context options for the agent
  const [options, setOptions] = useState<AgentOpenOptions | null>(null);

  // Active entity — tracked independently of open/close so the panel
  // always knows which notebook to target when the user is on an entity
  // page. Cleared when user leaves the entity page.
  const [activeEntitySlug, setActiveEntitySlug] = useState<string | null>(null);

  // External state from MainLayout (when registered)
  const [externalSetter, setExternalSetter] = useState<((open: boolean) => void) | null>(null);
  const [externalGetter, setExternalGetter] = useState<(() => boolean) | null>(null);

  const registerExternalState = useCallback((
    setter: (open: boolean) => void,
    getter: () => boolean
  ) => {
    setExternalSetter(() => setter);
    setExternalGetter(() => getter);
  }, []);

  const isOpen = externalGetter ? externalGetter() : internalIsOpen;

  const withRequestId = useCallback((opts: AgentOpenOptions): AgentOpenOptions => {
    if (opts.requestId) return opts;
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return { ...opts, requestId };
  }, []);

  const setIsOpen = useCallback((open: boolean) => {
    if (externalSetter) {
      externalSetter(open);
    } else {
      setInternalIsOpen(open);
    }
  }, [externalSetter]);

  const open = useCallback((opts?: AgentOpenOptions) => {
    if (opts) {
      setOptions(withRequestId(opts));
    }
    setIsOpen(true);
  }, [setIsOpen, withRequestId]);

  const openWithContext = useCallback((opts: AgentOpenOptions) => {
    setOptions(withRequestId(opts));
    setIsOpen(true);
  }, [setIsOpen, withRequestId]);

  const close = useCallback(() => setIsOpen(false), [setIsOpen]);
  const toggle = useCallback(() => setIsOpen(!isOpen), [setIsOpen, isOpen]);
  const clearOptions = useCallback(() => setOptions(null), []);

  // Global "Ask NodeBench" keyboard shortcut — Cmd+J (Mac) / Ctrl+J (Win/Linux).
  // Pure matcher in lib/askShortcut.ts guards IME composition, key-repeat,
  // text-editing targets (textarea/input/contenteditable) and modifier
  // combos. We just wire it up here.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (matchesAskShortcut(event)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  const hasExternalHandler = !!externalSetter;

  const value = useMemo<FastAgentContextValue>(() => ({
    isOpen,
    options,
    activeEntitySlug,
    hasExternalHandler,
    open,
    openWithContext,
    close,
    toggle,
    setIsOpen,
    clearOptions,
    registerExternalState,
    setActiveEntitySlug,
  }), [isOpen, options, activeEntitySlug, hasExternalHandler, open, openWithContext, close, toggle, setIsOpen, clearOptions, registerExternalState]);

  return (
    <FastAgentContext.Provider value={value}>
      {children}
    </FastAgentContext.Provider>
  );
}

export function useFastAgent() {
  const context = useContext(FastAgentContext);
  if (!context) {
    // Return a no-op version if not within provider (for safety)
    return {
      isOpen: false,
      options: null,
      activeEntitySlug: null,
      hasExternalHandler: false,
      open: () => console.warn('FastAgentProvider not found'),
      openWithContext: () => console.warn('FastAgentProvider not found'),
      close: () => {},
      toggle: () => {},
      setIsOpen: () => {},
      clearOptions: () => {},
      registerExternalState: () => {},
      setActiveEntitySlug: () => {},
    };
  }
  return context;
}

/**
 * Hook used by the entity page to register the currently-viewed entity
 * slug with the global FastAgentContext. Keeps the panel + agent aware
 * of context even when the panel is closed. Clears on unmount so
 * navigation away from the entity page resets the context.
 */
export function useActiveEntity(slug: string | null | undefined) {
  const { setActiveEntitySlug } = useFastAgent();
  useEffect(() => {
    setActiveEntitySlug(slug ?? null);
    return () => setActiveEntitySlug(null);
  }, [slug, setActiveEntitySlug]);
}

/**
 * Hook to sync MainLayout's showFastAgent state with FastAgentContext
 */
export function useFastAgentSync(
  showFastAgent: boolean,
  setShowFastAgent: (open: boolean) => void
) {
  const { registerExternalState } = useFastAgent();

  useEffect(() => {
    registerExternalState(setShowFastAgent, () => showFastAgent);
  }, [registerExternalState, setShowFastAgent, showFastAgent]);
}

/**
 * Hook to check if agent is in dossier mode and get dossier context
 */
export function useFastAgentDossierMode() {
  const { options, isOpen } = useFastAgent();

  const isDossierMode = !!(isOpen && options?.dossierContext?.briefId);
  const dossierContext = options?.dossierContext ?? null;

  return {
    isDossierMode,
    dossierContext,
    briefId: dossierContext?.briefId ?? null,
    currentAct: dossierContext?.currentAct ?? "actI",
    focusedDataIndex: dossierContext?.focusedDataIndex ?? null,
    focusedSeriesId: dossierContext?.focusedSeriesId ?? null,
    chartContext: dossierContext?.chartContext ?? null,
    activeSectionId: dossierContext?.activeSectionId ?? null,
  };
}

/**
 * Helper to build context prefix for agent messages when in dossier mode
 */
export function buildDossierContextPrefix(dossierContext: DossierContext | null): string {
  if (!dossierContext) return "";

  const parts: string[] = [];

  if (dossierContext.currentAct) {
    const actLabels = {
      actI: "Act I (Overview)",
      actII: "Act II (Deep Dive)",
      actIII: "Act III (Implications)",
    };
    parts.push(`Current section: ${actLabels[dossierContext.currentAct]}`);
  }

  if (dossierContext.chartContext) {
    const { seriesId, dataLabel, value, unit } = dossierContext.chartContext;
    parts.push(`Focused data point: ${dataLabel} = ${value}${unit ?? ""} (${seriesId})`);
  }

  if (typeof dossierContext.focusedDataIndex === "number") {
    const series = dossierContext.focusedSeriesId ? ` (${dossierContext.focusedSeriesId})` : "";
    parts.push(`Focused data index: ${dossierContext.focusedDataIndex}${series}`);
  }

  if (dossierContext.activeSectionId) {
    parts.push(`Active section: ${dossierContext.activeSectionId}`);
  }

  if (parts.length === 0) return "";

  return `[Dossier Context]\n${parts.join("\n")}\n\n`;
}

export default FastAgentContext;
