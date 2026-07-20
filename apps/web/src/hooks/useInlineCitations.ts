// src/hooks/useInlineCitations.ts
// React hook for stable inline citation numbering during streaming
// Maintains consistent [1][2] numbering even as content updates

import { useMemo, useRef } from "react";
import {
  buildStableCitationIndex,
  injectInlineCitationSupers,
  type FactToArtifacts,
} from "../../shared/citations/injectInlineCitations";
import { useArtifactStore } from "./useArtifactStore";

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: useInlineCitations
// ═══════════════════════════════════════════════════════════════════════════

interface UseInlineCitationsResult {
  /** Markdown with {{fact:...}} replaced by <sup> citation links */
  injectedMarkdown: string;
  /** Ordered list of artifact IDs by citation number */
  numToArtifactId: string[];
  /** Map of artifactId -> citation number */
  artifactIdToNum: Map<string, number>;
}

/**
 * Hook to transform fact anchors into inline superscript citations.
 * Maintains stable numbering across streaming updates.
 * 
 * @param markdown - Content with {{fact:...}} anchors
 * @param factToArtifacts - Optional override for fact->artifact mapping
 */
export function useInlineCitations(
  markdown: string,
  factToArtifacts?: FactToArtifacts
): UseInlineCitationsResult {
  const { state } = useArtifactStore();
  
  // Use store's evidenceLinks if no override provided
  const resolvedFactMap = factToArtifacts ?? state.evidenceLinks;
  
  // Keep stable map across renders to prevent citation number churn during streaming
  const stableMapRef = useRef<Map<string, number>>(new Map());

  const { injected, numToArtifactId, artifactIdToNum } = useMemo(() => {
    const idx = buildStableCitationIndex(
      markdown,
      resolvedFactMap,
      stableMapRef.current
    );
    
    // Update stable ref for next render
    stableMapRef.current = idx.artifactIdToNum;

    const injected = injectInlineCitationSupers(
      markdown,
      resolvedFactMap,
      idx.artifactIdToNum
    );
    
    return {
      injected,
      numToArtifactId: idx.numToArtifactId,
      artifactIdToNum: idx.artifactIdToNum,
    };
  }, [markdown, resolvedFactMap]);

  return {
    injectedMarkdown: injected,
    numToArtifactId,
    artifactIdToNum,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: useSourcesList
// ═══════════════════════════════════════════════════════════════════════════

interface SourceItem {
  num: number;
  artifactId: string;
  title: string;
  domain: string;
  url?: string;
  kind?: string;
}

/**
 * Hook to get formatted sources list for footnotes.
 * Returns sources ordered by citation number.
 */
export function useSourcesList(numToArtifactId: string[]): SourceItem[] {
  const { state } = useArtifactStore();
  const { byId } = state;

  return useMemo(() => {
    return numToArtifactId.map((artifactId, idx) => {
      const artifact = byId[artifactId];
      
      return {
        num: idx + 1,
        artifactId,
        title: artifact?.title ?? "Untitled",
        domain: artifact?.host ?? "unknown",
        url: artifact?.canonicalUrl,
        kind: artifact?.kind,
      };
    });
  }, [numToArtifactId, byId]);
}
