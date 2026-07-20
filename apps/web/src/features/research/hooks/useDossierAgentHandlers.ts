"use client";

/**
 * useDossierAgentHandlers - Handlers for opening Fast Agent with dossier context
 * 
 * Provides callbacks for:
 * - Chart point clicks (opens agent with data point context)
 * - Section "Ask AI" buttons (opens agent with section context)
 * - General dossier analysis (opens agent with full dossier context)
 */

import { useCallback } from "react";
import { useFastAgent, type DossierContext } from "@/features/agents/context/FastAgentContext";
import type { Act } from "../contexts/FocusSyncContext";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ChartPointContext {
  seriesId: string;
  dataIndex: number;
  dataLabel: string;
  value: number;
  unit?: string;
}

export interface SectionContext {
  sectionId: string;
  sectionTitle: string;
  act: Act;
}

export interface UseDossierAgentHandlersOptions {
  /** Brief/dossier ID */
  briefId: string;
  /** Current act */
  currentAct?: Act;
  /** Document title for context */
  documentTitle?: string;
}

export interface DossierAgentHandlers {
  /** Open agent when user clicks a chart data point */
  handleChartPointClick: (point: ChartPointContext) => void;
  /** Open agent when user clicks "Ask AI" in a section */
  handleSectionAskAI: (section: SectionContext, question?: string) => void;
  /** Open agent for general dossier analysis */
  handleDossierAnalysis: (question?: string) => void;
  /** Open agent with custom dossier context */
  openWithDossierContext: (context: Partial<DossierContext>, message?: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

export function useDossierAgentHandlers(
  options: UseDossierAgentHandlersOptions
): DossierAgentHandlers {
  const { briefId, currentAct = "actI", documentTitle } = options;
  const { openWithContext } = useFastAgent();

  /**
   * Open agent when user clicks a chart data point
   */
  const handleChartPointClick = useCallback(
    (point: ChartPointContext) => {
      const dossierContext: DossierContext = {
        briefId,
        currentAct,
        focusedDataIndex: point.dataIndex,
        chartContext: {
          seriesId: point.seriesId,
          dataLabel: point.dataLabel,
          value: point.value,
          unit: point.unit,
        },
      };

      const message = `Tell me more about this data point: ${point.dataLabel} = ${point.value}${point.unit ?? ""}`;

      openWithContext({
        initialMessage: message,
        contextTitle: documentTitle ?? "Dossier Analysis",
        dossierContext,
      });
    },
    [briefId, currentAct, documentTitle, openWithContext]
  );

  /**
   * Open agent when user clicks "Ask AI" in a section
   */
  const handleSectionAskAI = useCallback(
    (section: SectionContext, question?: string) => {
      const dossierContext: DossierContext = {
        briefId,
        currentAct: section.act,
        activeSectionId: section.sectionId,
      };

      const defaultQuestion = `Analyze the "${section.sectionTitle}" section and provide insights.`;

      openWithContext({
        initialMessage: question ?? defaultQuestion,
        contextTitle: documentTitle ?? "Dossier Analysis",
        dossierContext,
      });
    },
    [briefId, documentTitle, openWithContext]
  );

  /**
   * Open agent for general dossier analysis
   */
  const handleDossierAnalysis = useCallback(
    (question?: string) => {
      const dossierContext: DossierContext = {
        briefId,
        currentAct,
      };

      const defaultQuestion = "Analyze this dossier and highlight the key insights.";

      openWithContext({
        initialMessage: question ?? defaultQuestion,
        contextTitle: documentTitle ?? "Dossier Analysis",
        dossierContext,
      });
    },
    [briefId, currentAct, documentTitle, openWithContext]
  );

  /**
   * Open agent with custom dossier context
   */
  const openWithDossierContext = useCallback(
    (context: Partial<DossierContext>, message?: string) => {
      const dossierContext: DossierContext = {
        briefId,
        currentAct,
        ...context,
      };

      openWithContext({
        initialMessage: message,
        contextTitle: documentTitle ?? "Dossier Analysis",
        dossierContext,
      });
    },
    [briefId, currentAct, documentTitle, openWithContext]
  );

  return {
    handleChartPointClick,
    handleSectionAskAI,
    handleDossierAnalysis,
    openWithDossierContext,
  };
}

export default useDossierAgentHandlers;

