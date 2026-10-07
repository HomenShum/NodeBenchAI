/**
 * Workbench scenario definitions — extracted from ScenarioCatalog.tsx
 * so that imports of this data don't defeat the lazy-load boundary
 * of the ScenarioCatalog component (which caused a TDZ crash in
 * headless Chrome via the bench-scenarios chunk).
 */

import { type LucideIcon, Paintbrush2, Workflow, Timer, Building2 } from "lucide-react";

export interface WorkbenchScenario {
  id: string;
  name: string;
  description: string;
  subtasks: number;
  estimatedMin: number;
  icon: LucideIcon;
  rubricAxes: string[];
}

export const WORKBENCH_SCENARIOS: WorkbenchScenario[] = [
  {
    id: "ui-transform",
    name: "UI Transformation",
    description:
      "Transform a frozen app UI from incomplete to polished. Layout, typography, accessibility, visual regression.",
    subtasks: 4,
    estimatedMin: 30,
    icon: Paintbrush2,
    rubricAxes: ["design_compliance", "layout", "accessibility", "visual_qa"],
  },
  {
    id: "agent-integration",
    name: "Agent Integration",
    description:
      "Add a new agent workflow end-to-end: tool to orchestrator to persistence to UI render with citations.",
    subtasks: 5,
    estimatedMin: 45,
    icon: Workflow,
    rubricAxes: ["tool_correctness", "artifact_integrity", "citations", "replay_determinism"],
  },
  {
    id: "long-run-reliability",
    name: "Long-Run Reliability",
    description:
      "Sustain a research to verify to publish loop under chaos: 429s, fetch failures, partial outages.",
    subtasks: 3,
    estimatedMin: 120,
    icon: Timer,
    rubricAxes: ["completion_probability", "graceful_degradation", "slo_adherence", "cost_efficiency"],
  },
  {
    id: "architect-mode",
    name: "Architect Mode",
    description:
      "Plan review to tradeoff doc to implementation to tests. Measures systems thinking and execution.",
    subtasks: 4,
    estimatedMin: 45,
    icon: Building2,
    rubricAxes: ["plan_quality", "unforced_errors", "test_additions", "refactor_quality"],
  },
];
