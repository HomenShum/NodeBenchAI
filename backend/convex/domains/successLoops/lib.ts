export type SuccessLoopType =
  | "problem_selection"
  | "activation"
  | "retained_value"
  | "outcome_attribution"
  | "distribution_proof"
  | "revenue_expansion"
  | "market_sensing"
  | "organization_learning";

export type SuccessLoopHealth = "strengthening" | "mixed" | "weakening" | "missing";
export type MetricDirection = "higher" | "lower" | "balanced";
export type MetricSource = "observed" | "proxy" | "manual" | "missing";

export type SuccessLoopMetricDefinition = {
  key: string;
  label: string;
  description?: string;
  unit?: string;
  targetDirection: MetricDirection;
};

export type SuccessLoopMetricValue = SuccessLoopMetricDefinition & {
  value: number;
  displayValue: string;
  score: number;
  source: MetricSource;
  note?: string;
};

export type SuccessLoopDefinition = {
  loopType: SuccessLoopType;
  title: string;
  goal: string;
  owner: string;
  reviewCadence: string;
  interventionTypes: string[];
  leadingMetrics: SuccessLoopMetricDefinition[];
  laggingMetrics: SuccessLoopMetricDefinition[];
};

export type SuccessLoopCard = {
  loopId: string;
  loopType: SuccessLoopType;
  title: string;
  goal: string;
  owner: string;
  reviewCadence: string;
  currentState: string;
  status: SuccessLoopHealth;
  score: number;
  leadingMetrics: SuccessLoopMetricValue[];
  laggingMetrics: SuccessLoopMetricValue[];
  interventionTypes: string[];
  lastReviewAt?: number;
  nextReviewAt: number;
  gaps: string[];
};

export type SuccessLoopTopExperiment = {
  experimentKey: string;
  loopType: SuccessLoopType;
  title: string;
  status: string;
  owner: string;
  expectedEffect: string;
  outcomeSummary?: string;
  observedDelta?: number;
  observationWindowDays?: number;
};

export type SuccessLoopDecisionCard = {
  decisionKey: string;
  title: string;
  decisionType: string;
  owner: string;
  confidence: number;
  status: string;
  createdAt: number;
  latestOutcomeVerdict?: string;
  expectedOutcomeSummary?: string;
  observationWindowDays?: number;
};

export type SuccessLoopProofNode = {
  nodeKey: string;
  label: string;
  kind: "benchmark" | "dogfood" | "case_study" | "social_post" | "pipeline";
  score: number;
  value: string;
  detail: string;
};

export type SuccessLoopProofEdge = {
  source: string;
  target: string;
  label: string;
  strength: number;
};

export type SuccessLoopAccountNode = {
  accountKey: string;
  label: string;
  activationState: SuccessLoopHealth;
  retentionState: SuccessLoopHealth;
  expansionState: SuccessLoopHealth;
  workflowRuns30d: number;
  timeToFirstValueMinutes?: number;
  integrationsConnected: number;
};

export type SuccessLoopsDashboardSnapshot = {
  generatedAt?: number;
  entityKey?: string;
  entityType?: string;
  summary: {
    totalLoops: number;
    strengtheningCount: number;
    mixedCount: number;
    weakeningCount: number;
    missingCount: number;
    strongestLoop?: { loopType: SuccessLoopType; title: string; score: number } | null;
    weakestLoop?: { loopType: SuccessLoopType; title: string; score: number } | null;
  };
  loops: SuccessLoopCard[];
  topExperiments: SuccessLoopTopExperiment[];
  frozenDecisions: SuccessLoopDecisionCard[];
  proofGraph: {
    nodes: SuccessLoopProofNode[];
    edges: SuccessLoopProofEdge[];
  };
  accountValueGraph: {
    nodes: SuccessLoopAccountNode[];
  };
  nextRecommendedAction: string;
};

export const SUCCESS_LOOP_DEFINITIONS: SuccessLoopDefinition[] = [
  {
    loopType: "problem_selection",
    title: "Problem Selection",
    goal: "Pick workflow wedges with expensive, repeated pain and credible willingness to pay.",
    owner: "Product Strategy",
    reviewCadence: "weekly",
    interventionTypes: ["pain_interview", "workflow_ranking", "ICP_shift"],
    leadingMetrics: [
      { key: "repeated_task_frequency", label: "Repeated task frequency", targetDirection: "higher" },
      { key: "manual_hours_burn", label: "Manual-hours burn", unit: "hours", targetDirection: "higher" },
      { key: "failure_cost_signal", label: "Failure cost signal", targetDirection: "higher" },
      { key: "inbound_workflow_asks", label: "Inbound asks by workflow", targetDirection: "higher" },
    ],
    laggingMetrics: [
      { key: "pilots_started", label: "Pilots started", targetDirection: "higher" },
      { key: "workflows_adopted", label: "Workflows adopted", targetDirection: "higher" },
      { key: "willingness_to_pay_signal", label: "Willingness to pay signal", targetDirection: "higher" },
    ],
  },
  {
    loopType: "activation",
    title: "Activation",
    goal: "Get a new workspace to first proven value quickly and with bounded setup friction.",
    owner: "Product Growth",
    reviewCadence: "daily",
    interventionTypes: ["onboarding_change", "default_workflow", "setup_reduction"],
    leadingMetrics: [
      { key: "time_to_first_run", label: "Time to first run", unit: "minutes", targetDirection: "lower" },
      { key: "time_to_first_value", label: "Time to first value", unit: "minutes", targetDirection: "lower" },
      { key: "first_week_dogfood_completion", label: "First-week dogfood completion", targetDirection: "higher" },
      { key: "setup_friction", label: "Setup friction", targetDirection: "lower" },
    ],
    laggingMetrics: [
      { key: "activated_accounts", label: "Activated accounts", targetDirection: "higher" },
      { key: "second_session_rate", label: "Second-session rate", unit: "%", targetDirection: "higher" },
      { key: "team_invite_signal", label: "Team invite signal", targetDirection: "higher" },
    ],
  },
  {
    loopType: "retained_value",
    title: "Retained Value",
    goal: "Ensure users come back because outputs are reusable and workflows save time.",
    owner: "Product",
    reviewCadence: "weekly",
    interventionTypes: ["workflow_polish", "artifact_reuse", "quality_gate_tuning"],
    leadingMetrics: [
      { key: "weekly_active_workflows", label: "Weekly active workflows", targetDirection: "higher" },
      { key: "repeated_benchmark_runs", label: "Repeated benchmark runs", targetDirection: "higher" },
      { key: "accepted_output_rate", label: "Accepted output rate", unit: "%", targetDirection: "higher" },
      { key: "reuse_export_rate", label: "Reuse/export rate", unit: "%", targetDirection: "higher" },
    ],
    laggingMetrics: [
      { key: "four_week_retention", label: "4-week retention", unit: "%", targetDirection: "higher" },
      { key: "expansion_signal", label: "Expansion signal", targetDirection: "higher" },
      { key: "churn_risk", label: "Churn risk", targetDirection: "lower" },
    ],
  },
  {
    loopType: "outcome_attribution",
    title: "Outcome Attribution",
    goal: "Prove whether recommendations and automations improved the real-world result.",
    owner: "Operations",
    reviewCadence: "weekly",
    interventionTypes: ["frozen_decision", "outcome_review", "kpi_linkage"],
    leadingMetrics: [
      { key: "operator_acceptance", label: "Operator acceptance", unit: "%", targetDirection: "higher" },
      { key: "edit_distance_proxy", label: "Edit distance proxy", targetDirection: "lower" },
      { key: "reopen_rate", label: "Reopen rate", unit: "%", targetDirection: "lower" },
      { key: "escalation_rate", label: "Escalation rate", unit: "%", targetDirection: "lower" },
    ],
    laggingMetrics: [
      { key: "validated_outcomes", label: "Validated outcomes", targetDirection: "higher" },
      { key: "kpi_uplift", label: "KPI uplift", unit: "%", targetDirection: "higher" },
      { key: "throughput_gain", label: "Throughput gain", unit: "%", targetDirection: "higher" },
    ],
  },
  {
    loopType: "distribution_proof",
    title: "Distribution and Proof",
    goal: "Turn benchmark, dogfood, and case-study proof into trust, inbound demand, and pilot creation.",
    owner: "Growth",
    reviewCadence: "weekly",
    interventionTypes: ["proof_publish", "case_study", "channel_shift"],
    leadingMetrics: [
      { key: "benchmark_views", label: "Benchmark views", targetDirection: "higher" },
      { key: "dogfood_artifacts", label: "Dogfood artifacts", targetDirection: "higher" },
      { key: "case_study_reads", label: "Case-study reads", targetDirection: "higher" },
      { key: "qualified_inbound", label: "Qualified inbound", targetDirection: "higher" },
    ],
    laggingMetrics: [
      { key: "pipeline_created", label: "Pipeline created", targetDirection: "higher" },
      { key: "referral_rate", label: "Referral rate", unit: "%", targetDirection: "higher" },
      { key: "proof_to_pilot_conversion", label: "Proof-to-pilot conversion", unit: "%", targetDirection: "higher" },
    ],
  },
  {
    loopType: "revenue_expansion",
    title: "Revenue and Expansion",
    goal: "Convert proven value into more seats, workflows, integrations, and spend.",
    owner: "Revenue",
    reviewCadence: "weekly",
    interventionTypes: ["account_plan", "integration_push", "seat_expansion"],
    leadingMetrics: [
      { key: "workflows_per_account", label: "Workflows per account", targetDirection: "higher" },
      { key: "departments_touched", label: "Departments touched", targetDirection: "higher" },
      { key: "integrations_connected", label: "Integrations connected", targetDirection: "higher" },
    ],
    laggingMetrics: [
      { key: "expansion_signal", label: "Expansion signal", targetDirection: "higher" },
      { key: "multi_team_adoption", label: "Multi-team adoption", targetDirection: "higher" },
      { key: "renewal_signal", label: "Renewal signal", targetDirection: "higher" },
    ],
  },
  {
    loopType: "market_sensing",
    title: "Market Sensing",
    goal: "Sense whether the feedback field is shifting faster than the product and GTM motion.",
    owner: "Strategy",
    reviewCadence: "weekly",
    interventionTypes: ["competitive_review", "pricing_review", "messaging_shift"],
    leadingMetrics: [
      { key: "competitor_release_cadence", label: "Competitor release cadence", targetDirection: "higher" },
      { key: "feature_parity_drift", label: "Feature parity drift", targetDirection: "lower" },
      { key: "buyer_language_changes", label: "Buyer-language changes", targetDirection: "higher" },
      { key: "channel_saturation", label: "Channel saturation", targetDirection: "lower" },
    ],
    laggingMetrics: [
      { key: "lost_deal_signal", label: "Lost-deal signal", targetDirection: "lower" },
      { key: "category_compression", label: "Category compression", targetDirection: "lower" },
      { key: "market_response_quality", label: "Market response quality", targetDirection: "higher" },
    ],
  },
  {
    loopType: "organization_learning",
    title: "Organization Learning",
    goal: "Learn faster than the environment changes and convert failures into improved future state.",
    owner: "Founding Team",
    reviewCadence: "weekly",
    interventionTypes: ["postmortem", "policy_update", "experiment_loop"],
    leadingMetrics: [
      { key: "time_from_issue_to_fix", label: "Time from issue to fix", unit: "hours", targetDirection: "lower" },
      { key: "benchmark_to_policy_update", label: "Benchmark-to-policy update", unit: "hours", targetDirection: "lower" },
      { key: "experiment_throughput", label: "Experiment throughput", targetDirection: "higher" },
    ],
    laggingMetrics: [
      { key: "product_trajectory", label: "Product trajectory", unit: "%", targetDirection: "higher" },
      { key: "workflow_trajectory", label: "Workflow trajectory", unit: "%", targetDirection: "higher" },
      { key: "decision_calibration", label: "Decision calibration", unit: "%", targetDirection: "higher" },
    ],
  },
];

export function clampLoopScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatCount(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

export function formatDurationMinutes(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function buildLoopId(loopType: SuccessLoopType, entityType: string, entityKey: string) {
  return `${entityType}:${entityKey}:${loopType}`;
}

export function getLoopDefinition(loopType: SuccessLoopType) {
  return SUCCESS_LOOP_DEFINITIONS.find((definition) => definition.loopType === loopType);
}

export function buildMetricValue(input: {
  key: string;
  label: string;
  value: number;
  displayValue?: string;
  score: number;
  unit?: string;
  source?: MetricSource;
  targetDirection: MetricDirection;
  description?: string;
  note?: string;
}): SuccessLoopMetricValue {
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    displayValue: input.displayValue ?? String(input.value),
    score: clampLoopScore(input.score),
    unit: input.unit,
    source: input.source ?? "observed",
    targetDirection: input.targetDirection,
    description: input.description,
    note: input.note,
  };
}

export function computeLoopHealth(input: {
  leadingMetrics: SuccessLoopMetricValue[];
  laggingMetrics: SuccessLoopMetricValue[];
  gaps?: string[];
}): { score: number; status: SuccessLoopHealth } {
  const metrics = [...input.leadingMetrics, ...input.laggingMetrics];
  if (!metrics.length) {
    return { score: 0, status: "missing" };
  }
  const baseScore = mean(metrics.map((metric) => metric.score));
  const missingPenalty = Math.min(0.24, (input.gaps?.length ?? 0) * 0.04);
  const score = clampLoopScore(baseScore - missingPenalty);
  if (score >= 0.68) return { score, status: "strengthening" };
  if (score >= 0.42) return { score, status: "mixed" };
  return { score, status: "weakening" };
}

export function buildCurrentState(input: {
  title: string;
  leadingMetrics: SuccessLoopMetricValue[];
  laggingMetrics: SuccessLoopMetricValue[];
  gaps?: string[];
  status: SuccessLoopHealth;
}) {
  const metrics = [...input.leadingMetrics, ...input.laggingMetrics].sort((a, b) => b.score - a.score);
  const best = metrics[0];
  const weakest = metrics[metrics.length - 1];
  if (!best || !weakest) {
    return `${input.title} still lacks enough instrumentation to judge whether the loop is strengthening or weakening.`;
  }
  const gapText =
    input.gaps && input.gaps.length > 0
      ? ` Missing: ${input.gaps.slice(0, 2).join(", ")}.`
      : "";
  if (input.status === "strengthening") {
    return `${input.title} is strengthening through ${best.label.toLowerCase()}, while ${weakest.label.toLowerCase()} remains the weakest dimension.${gapText}`;
  }
  if (input.status === "mixed") {
    return `${input.title} is mixed: ${best.label.toLowerCase()} is improving, but ${weakest.label.toLowerCase()} still limits compounding.${gapText}`;
  }
  if (input.status === "missing") {
    return `${input.title} is not instrumented enough yet. ${best.label} is the best available proxy, but the loop still needs explicit outcome signals.${gapText}`;
  }
  return `${input.title} is weakening because ${weakest.label.toLowerCase()} is underperforming despite ${best.label.toLowerCase()} showing some signal.${gapText}`;
}

export function defaultNextRecommendedAction(snapshot: Pick<SuccessLoopsDashboardSnapshot, "loops" | "summary">) {
  const weakestLoop = snapshot.loops
    .slice()
    .sort((a, b) => a.score - b.score)[0];
  if (!weakestLoop) {
    return "Define the first outer loop with named owner, cadence, and measurable intervention types.";
  }
  if (weakestLoop.loopType === "activation") {
    return "Instrument first-value and accepted-output events so activation stops relying on proxies and starts measuring real product pull.";
  }
  if (weakestLoop.loopType === "retained_value") {
    return "Close the reuse loop by recording accepted outputs, exports, and repeated workflow usage at the artifact level.";
  }
  if (weakestLoop.loopType === "outcome_attribution") {
    return "Freeze more product and GTM decisions before execution, then link them to real outcomes so the app can learn from reality instead of narrative alone.";
  }
  if (weakestLoop.loopType === "distribution_proof") {
    return "Attach benchmark, dogfood, and publishing artifacts to inbound and pipeline events so proof quality can be distinguished from raw visibility.";
  }
  if (weakestLoop.loopType === "revenue_expansion") {
    return "Map integrations and workflows per account so expansion risk is driven by product usage, not guesswork.";
  }
  if (weakestLoop.loopType === "market_sensing") {
    return "Create a structured market-change review that turns competitor drift and buyer-language changes into explicit interventions.";
  }
  if (weakestLoop.loopType === "organization_learning") {
    return "Tighten the experiment loop so every major issue, benchmark regression, and policy change has a measured time-to-fix and post-change review.";
  }
  return "Raise the problem-selection bar by ranking pains, inbound asks, and failure cost before expanding into more workflow surfaces.";
}
