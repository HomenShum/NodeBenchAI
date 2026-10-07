import { create } from "zustand";
import type { InspectorRun, InspectorRunStatus } from "../data/telemetryInspectorMockData";

export type InspectorTab = "overview" | "trace" | "metrics" | "evidence";

interface TelemetryInspectorState {
  selectedRunId: string | null;
  selectedStepId: string | null;
  activeTab: InspectorTab;
  searchQuery: string;
  statusFilter: InspectorRunStatus | "all";
  feedbackOpen: boolean;
  feedbackDraft: string;
  hydrateSelection: (runs: InspectorRun[]) => void;
  selectRun: (runId: string, stepId?: string | null) => void;
  selectStep: (stepId: string | null) => void;
  setActiveTab: (tab: InspectorTab) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: InspectorRunStatus | "all") => void;
  openFeedback: () => void;
  closeFeedback: () => void;
  setFeedbackDraft: (value: string) => void;
  resetFeedback: () => void;
}

export const useTelemetryInspectorStore = create<TelemetryInspectorState>((set, get) => ({
  selectedRunId: null,
  selectedStepId: null,
  activeTab: "trace",
  searchQuery: "",
  statusFilter: "all",
  feedbackOpen: false,
  feedbackDraft: "",
  hydrateSelection: (runs) => {
    const state = get();
    if (runs.length === 0) {
      if (state.selectedRunId || state.selectedStepId) {
        set({ selectedRunId: null, selectedStepId: null });
      }
      return;
    }

    const currentRun = runs.find((run) => run.id === state.selectedRunId);
    if (currentRun) {
      const currentStep = currentRun.steps.find((step) => step.id === state.selectedStepId);
      if (!currentStep) {
        set({ selectedStepId: currentRun.steps[0]?.id ?? null });
      }
      return;
    }

    set({
      selectedRunId: runs[0].id,
      selectedStepId: runs[0].steps[0]?.id ?? null,
    });
  },
  selectRun: (runId, stepId = null) => set({ selectedRunId: runId, selectedStepId: stepId }),
  selectStep: (stepId) => set({ selectedStepId: stepId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),
  setFeedbackDraft: (value) => set({ feedbackDraft: value }),
  resetFeedback: () => set({ feedbackDraft: "", feedbackOpen: false }),
}));
