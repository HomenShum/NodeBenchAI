/**
 * ArtifactContext — State management for the artifact system.
 *
 * Provides centralized state for:
 * - Current artifact ID and type
 * - Active tab selection
 * - Mode (Quick vs Deep)
 * - Sync status
 * - Artifact actions
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ArtifactTab } from "../components/ArtifactTabs";

export type ArtifactType = "report" | "notebook" | "entity" | "draft";
export type ArtifactMode = "quick" | "deep";
export type ArtifactState = "draft" | "saved" | "synced" | "syncing" | "error";

interface ReportSection {
  id: string;
  title: string;
  content: string;
  confidence?: "high" | "medium" | "low";
  sourceCount?: number;
}

interface Source {
  id: string;
  title: string;
  url?: string;
  domain: string;
  confidence: number;
  date?: string;
}

interface ActivityEvent {
  id: string;
  type: "created" | "updated" | "synced" | "exported";
  description: string;
  timestamp: Date;
  user?: string;
}

interface ArtifactFile {
  id: string;
  name: string;
  type: string;
  size: string;
  url?: string;
}

interface Artifact {
  id: string;
  title: string;
  type: ArtifactType;
  state: ArtifactState;
  mode: ArtifactMode;
  sections?: ReportSection[];
  sources?: Source[];
  activity?: ActivityEvent[];
  files?: ArtifactFile[];
  lastUpdated?: Date;
  confidenceScore?: number;
  isTracked: boolean;
  sourceCount: number;
  syncStatus?: string;
}

interface ArtifactContextValue {
  // Current artifact
  artifact: Artifact | null;
  // Active tab
  activeTab: ArtifactTab;
  // Loading states
  isLoading: boolean;
  isEmpty: boolean;
  // Actions
  setActiveTab: (tab: ArtifactTab) => void;
  setMode: (mode: ArtifactMode) => void;
  trackArtifact: () => void;
  shareArtifact: () => void;
  exportArtifact: (format: "pdf" | "csv" | "notion") => void;
  // Computed
  objectName: string;
  objectState: ArtifactState;
  mode: ArtifactMode;
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

interface ArtifactProviderProps {
  children: React.ReactNode;
  /** Optional initial artifact data */
  initialArtifact?: Partial<Artifact>;
}

export function ArtifactProvider({ children, initialArtifact }: ArtifactProviderProps) {
  // Artifact state
  const [artifact, setArtifact] = useState<Artifact | null>(
    initialArtifact
      ? {
          id: initialArtifact.id || crypto.randomUUID(),
          title: initialArtifact.title || "Untitled",
          type: initialArtifact.type || "draft",
          state: initialArtifact.state || "draft",
          mode: initialArtifact.mode || "quick",
          sections: initialArtifact.sections || [],
          sources: initialArtifact.sources || [],
          activity: initialArtifact.activity || [],
          files: initialArtifact.files || [],
          lastUpdated: initialArtifact.lastUpdated,
          confidenceScore: initialArtifact.confidenceScore,
          isTracked: initialArtifact.isTracked ?? false,
          sourceCount: initialArtifact.sourceCount ?? 0,
          syncStatus: initialArtifact.syncStatus,
        }
      : null
  );

  // UI state
  const [activeTab, setActiveTab] = useState<ArtifactTab>("brief");
  const [isLoading, setIsLoading] = useState(false);

  // Derived values
  const isEmpty = useMemo(() => !artifact || !artifact.sections || artifact.sections.length === 0, [artifact]);

  const objectName = useMemo(() => artifact?.title || "New Research", [artifact?.title]);

  const objectState = useMemo(() => artifact?.state || "draft", [artifact?.state]);

  const mode = useMemo(() => artifact?.mode || "quick", [artifact?.mode]);

  // Actions
  const handleSetActiveTab = useCallback((tab: ArtifactTab) => {
    setActiveTab(tab);
  }, []);

  const setMode = useCallback((newMode: ArtifactMode) => {
    setArtifact((prev) =>
      prev
        ? {
            ...prev,
            mode: newMode,
          }
        : null
    );
  }, []);

  const trackArtifact = useCallback(() => {
    setArtifact((prev) =>
      prev
        ? {
            ...prev,
            isTracked: !prev.isTracked,
          }
        : null
    );
  }, []);

  const shareArtifact = useCallback(() => {
    // Copy shareable link to clipboard
    const url = window.location.href;
    navigator.clipboard.writeText(url).catch(() => {});
    // TODO: Show toast notification
  }, []);

  const exportArtifact = useCallback((format: "pdf" | "csv" | "notion") => {
    // TODO: Implement export functionality
    console.log(`Exporting artifact as ${format}`);
    setIsLoading(true);
    // Simulate export
    setTimeout(() => {
      setIsLoading(false);
    }, 1500);
  }, []);

  const value = useMemo(
    () => ({
      artifact,
      activeTab,
      isLoading,
      isEmpty,
      setActiveTab: handleSetActiveTab,
      setMode,
      trackArtifact,
      shareArtifact,
      exportArtifact,
      objectName,
      objectState,
      mode,
    }),
    [
      artifact,
      activeTab,
      isLoading,
      isEmpty,
      handleSetActiveTab,
      setMode,
      trackArtifact,
      shareArtifact,
      exportArtifact,
      objectName,
      objectState,
      mode,
    ]
  );

  return (
    <ArtifactContext.Provider value={value}>
      {children}
    </ArtifactContext.Provider>
  );
}

export function useArtifact() {
  const context = useContext(ArtifactContext);
  if (!context) {
    throw new Error("useArtifact must be used within an ArtifactProvider");
  }
  return context;
}

// Hook for components that want optional artifact context
export function useArtifactOptional() {
  return useContext(ArtifactContext);
}
