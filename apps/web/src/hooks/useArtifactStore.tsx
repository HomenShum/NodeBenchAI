// src/hooks/useArtifactStore.ts
// Artifact store with append-only + dedupe reducer
// Uses React's useReducer + Context for scoped state management

import { 
  createContext, 
  useContext, 
  useReducer, 
  useCallback,
  useMemo,
  type ReactNode,
  type Dispatch,
} from "react";
import type { ArtifactCard } from "../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// STORE STATE TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ArtifactStoreState {
  /** Current run ID (agentThreadId) */
  runId: string | null;
  
  /** Artifacts by ID for O(1) lookup */
  byId: Record<string, ArtifactCard>;
  
  /** Ordered list of artifact IDs (insertion order) */
  order: string[];
  
  /** Artifacts grouped by section ID */
  bySection: Record<string, string[]>; // sectionId -> artifactId[]
  
  /** Unassigned artifacts (not linked to any section) */
  unassigned: string[];
  
  /** Evidence links: factId -> artifactIds */
  evidenceLinks: Record<string, string[]>;
  
  /** Processing state */
  isProcessing: boolean;
  
  /** Last processed sequence number (for ordering) */
  lastSeq: number;
  
  /** FIX 5: Last seen rev per artifact ID (for skip optimization) */
  lastSeenRevById: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS (Simplified - DB-driven, no stream events)
// ═══════════════════════════════════════════════════════════════════════════

type ArtifactAction =
  | { type: "SET_RUN"; runId: string }  // Atomic reset for new run
  | { type: "RESET" }
  | { type: "UPSERT_FROM_QUERY"; runId: string; artifacts: ArtifactCard[] }  // From Convex query
  | { type: "SET_ARTIFACT_PINNED"; artifactId: string; isPinned: boolean }
  | { type: "SET_ARTIFACT_SECTION"; artifactId: string; sectionId: string };

// ═══════════════════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════════

const initialState: ArtifactStoreState = {
  runId: null,
  byId: {},
  order: [],
  bySection: {},
  unassigned: [],
  evidenceLinks: {},
  isProcessing: false,
  lastSeq: 0,
  lastSeenRevById: {},
};

// ═══════════════════════════════════════════════════════════════════════════
// REDUCER (Simplified - DB-driven, no stream events)
// ═══════════════════════════════════════════════════════════════════════════

function artifactReducer(
  state: ArtifactStoreState,
  action: ArtifactAction
): ArtifactStoreState {
  switch (action.type) {
    case "SET_RUN":
      // Atomic reset for new run - returns fresh state with new runId
      return { ...initialState, runId: action.runId };

    case "RESET":
      return initialState;

    case "UPSERT_FROM_QUERY": {
      // CRITICAL: Ignore updates for wrong run (prevents late-arriving stale data)
      if (action.runId !== state.runId) {
        return state;
      }

      const newById = { ...state.byId };
      const newOrder = [...state.order];
      const newUnassigned = [...state.unassigned];
      const newLastSeenRevById = { ...state.lastSeenRevById };
      
      let hasChanges = false;

      for (const artifact of action.artifacts) {
        const lastSeenRev = newLastSeenRevById[artifact.id] ?? 0;
        
        // FIX 5: Skip if rev hasn't changed (reduces UI churn)
        if (artifact.rev <= lastSeenRev) {
          continue;
        }
        
        const existing = newById[artifact.id];
        
        // Only update if new or rev is higher (monotonic merge)
        if (!existing || artifact.rev > existing.rev) {
          newById[artifact.id] = artifact;
          newLastSeenRevById[artifact.id] = artifact.rev;
          hasChanges = true;
          
          // Add to order if new
          if (!existing) {
            newOrder.push(artifact.id);
            newUnassigned.push(artifact.id);
          }
        }
      }
      
      // Only return new state if there were actual changes
      if (!hasChanges) {
        return state;
      }

      return {
        ...state,
        byId: newById,
        order: newOrder,
        unassigned: newUnassigned,
        lastSeenRevById: newLastSeenRevById,
      };
    }

    case "SET_ARTIFACT_PINNED": {
      const existing = state.byId[action.artifactId];
      if (!existing) return state;

      return {
        ...state,
        byId: {
          ...state.byId,
          [action.artifactId]: {
            ...existing,
            flags: { ...existing.flags, isPinned: action.isPinned },
          },
        },
      };
    }

    case "SET_ARTIFACT_SECTION": {
      const { artifactId, sectionId } = action;
      
      // Remove from unassigned
      const newUnassigned = state.unassigned.filter(id => id !== artifactId);
      
      // Remove from any existing section
      const newBySection = { ...state.bySection };
      for (const [secId, ids] of Object.entries(newBySection)) {
        if (ids.includes(artifactId)) {
          newBySection[secId] = ids.filter(id => id !== artifactId);
        }
      }
      
      // Add to target section
      if (!newBySection[sectionId]) {
        newBySection[sectionId] = [];
      }
      if (!newBySection[sectionId].includes(artifactId)) {
        newBySection[sectionId] = [...newBySection[sectionId], artifactId];
      }

      return {
        ...state,
        unassigned: newUnassigned,
        bySection: newBySection,
      };
    }

    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

interface ArtifactStoreContextValue {
  state: ArtifactStoreState;
  dispatch: Dispatch<ArtifactAction>;
  
  // Helper methods (simplified for DB-driven architecture)
  setRunId: (runId: string) => void;
  reset: () => void;
  upsertFromQuery: (runId: string, artifacts: ArtifactCard[]) => void;
  
  // Selectors
  getArtifact: (id: string) => ArtifactCard | undefined;
  getArtifactsBySection: (sectionId: string) => ArtifactCard[];
  getUnassignedArtifacts: () => ArtifactCard[];
  getAllArtifacts: () => ArtifactCard[];
  getPinnedArtifacts: () => ArtifactCard[];
  getCitedArtifacts: () => ArtifactCard[];
}

const ArtifactStoreContext = createContext<ArtifactStoreContextValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

interface ArtifactStoreProviderProps {
  children: ReactNode;
  initialRunId?: string;
}

export function ArtifactStoreProvider({ 
  children, 
  initialRunId 
}: ArtifactStoreProviderProps) {
  const [state, dispatch] = useReducer(
    artifactReducer,
    initialRunId 
      ? { ...initialState, runId: initialRunId }
      : initialState
  );

  // Helper methods (simplified for DB-driven architecture)
  const setRunId = useCallback((runId: string) => {
    dispatch({ type: "SET_RUN", runId });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const upsertFromQuery = useCallback((runId: string, artifacts: ArtifactCard[]) => {
    dispatch({ type: "UPSERT_FROM_QUERY", runId, artifacts });
  }, []);

  // Selectors
  const getArtifact = useCallback((id: string) => {
    return state.byId[id];
  }, [state.byId]);

  const getArtifactsBySection = useCallback((sectionId: string) => {
    const ids = state.bySection[sectionId] || [];
    return ids.map(id => state.byId[id]).filter(Boolean) as ArtifactCard[];
  }, [state.bySection, state.byId]);

  const getUnassignedArtifacts = useCallback(() => {
    return state.unassigned.map(id => state.byId[id]).filter(Boolean) as ArtifactCard[];
  }, [state.unassigned, state.byId]);

  const getAllArtifacts = useCallback(() => {
    return state.order.map(id => state.byId[id]).filter(Boolean) as ArtifactCard[];
  }, [state.order, state.byId]);

  const getPinnedArtifacts = useCallback(() => {
    return state.order
      .map(id => state.byId[id])
      .filter((a): a is ArtifactCard => Boolean(a) && a.flags.isPinned);
  }, [state.order, state.byId]);

  const getCitedArtifacts = useCallback(() => {
    return state.order
      .map(id => state.byId[id])
      .filter((a): a is ArtifactCard => Boolean(a) && a.flags.isCited);
  }, [state.order, state.byId]);

  const value = useMemo<ArtifactStoreContextValue>(() => ({
    state,
    dispatch,
    setRunId,
    reset,
    upsertFromQuery,
    getArtifact,
    getArtifactsBySection,
    getUnassignedArtifacts,
    getAllArtifacts,
    getPinnedArtifacts,
    getCitedArtifacts,
  }), [
    state,
    setRunId,
    reset,
    upsertFromQuery,
    getArtifact,
    getArtifactsBySection,
    getUnassignedArtifacts,
    getAllArtifacts,
    getPinnedArtifacts,
    getCitedArtifacts,
  ]);

  return (
    <ArtifactStoreContext.Provider value={value}>
      {children}
    </ArtifactStoreContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook to access the artifact store
 * Must be used within an ArtifactStoreProvider
 */
export function useArtifactStore(): ArtifactStoreContextValue {
  const context = useContext(ArtifactStoreContext);
  if (!context) {
    throw new Error("useArtifactStore must be used within an ArtifactStoreProvider");
  }
  return context;
}

/**
 * Hook to get artifacts for a specific section
 */
export function useSectionArtifacts(sectionId: string): ArtifactCard[] {
  const { getArtifactsBySection } = useArtifactStore();
  return useMemo(() => getArtifactsBySection(sectionId), [getArtifactsBySection, sectionId]);
}

/**
 * Hook to get all unassigned artifacts (for Sources Library)
 */
export function useUnassignedArtifacts(): ArtifactCard[] {
  const { getUnassignedArtifacts } = useArtifactStore();
  return useMemo(() => getUnassignedArtifacts(), [getUnassignedArtifacts]);
}

/**
 * Hook to get all artifacts in insertion order
 */
export function useAllArtifacts(): ArtifactCard[] {
  const { getAllArtifacts } = useArtifactStore();
  return useMemo(() => getAllArtifacts(), [getAllArtifacts]);
}
