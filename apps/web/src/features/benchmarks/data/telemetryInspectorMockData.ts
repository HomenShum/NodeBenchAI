export type InspectorRunStatus = "success" | "warning" | "error" | "running";
export type InspectorStepStatus = "success" | "warning" | "error" | "pending";
export type InspectorStepType =
  | "llm_inference"
  | "tool_call"
  | "anomaly_detection"
  | "human_gate"
  | "proof_pack"
  | "replay";

export interface InspectorEvidenceFrame {
  id: string;
  stepId: string;
  label: string;
  caption: string;
  timestampMs: number;
  imageUrl: string;
}

export interface InspectorTraceStep {
  id: string;
  type: InspectorStepType;
  status: InspectorStepStatus;
  title: string;
  subtitle: string;
  rationale: string;
  startedAt: string;
  durationMs: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
  toolName?: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  warnings?: string[];
  evidenceFrameIds: string[];
}

export interface InspectorRun {
  id: string;
  title: string;
  goal: string;
  dataset: string;
  status: InspectorRunStatus;
  verdict: string;
  startedAt: string;
  totalLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  confidence: number;
  tags: string[];
  summary: string;
  videoUrl?: string;
  steps: InspectorTraceStep[];
  evidenceFrames: InspectorEvidenceFrame[];
}

function svgDataUrl(title: string, subtitle: string, accent: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0A0A0A" />
          <stop offset="100%" stop-color="#101827" />
        </linearGradient>
      </defs>
      <rect width="900" height="540" rx="28" fill="url(#bg)" />
      <rect x="28" y="28" width="844" height="484" rx="22" fill="#111827" stroke="rgba(255,255,255,0.12)" />
      <rect x="58" y="58" width="300" height="20" rx="10" fill="rgba(255,255,255,0.08)" />
      <rect x="58" y="102" width="784" height="120" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="58" y="246" width="370" height="210" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="458" y="246" width="384" height="210" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="74" y="118" width="124" height="12" rx="6" fill="${accent}" opacity="0.95" />
      <rect x="74" y="146" width="344" height="14" rx="7" fill="rgba(255,255,255,0.10)" />
      <rect x="74" y="174" width="522" height="14" rx="7" fill="rgba(255,255,255,0.08)" />
      <rect x="74" y="202" width="284" height="14" rx="7" fill="rgba(255,255,255,0.06)" />
      <text x="58" y="492" fill="#E5E7EB" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700">${title}</text>
      <text x="58" y="520" fill="rgba(229,231,235,0.76)" font-family="Inter, Arial, sans-serif" font-size="18">${subtitle}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createEvidenceFrames(
  runId: string,
  stepIds: string[],
  labelPrefix: string,
  accent: string,
): InspectorEvidenceFrame[] {
  return stepIds.map((stepId, index) => ({
    id: `${runId}-frame-${index + 1}`,
    stepId,
    label: `${labelPrefix} frame ${index + 1}`,
    caption: index === 0
      ? "Planner state captured before the run widened scope."
      : index === stepIds.length - 1
      ? "Final operator evidence showing the verdict-ready screen."
      : "Intermediate UI evidence aligned to the trace step.",
    timestampMs: (index + 1) * 1_250,
    imageUrl: svgDataUrl(
      `${labelPrefix} · ${index + 1}`,
      stepId.replaceAll("-", " "),
      accent,
    ),
  }));
}

function sum<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function buildRun(input: {
  id: string;
  title: string;
  goal: string;
  dataset: string;
  status: InspectorRunStatus;
  verdict: string;
  startedAt: string;
  confidence: number;
  tags: string[];
  summary: string;
  videoUrl?: string;
  accent: string;
  steps: Array<Omit<InspectorTraceStep, "evidenceFrameIds">>;
}): InspectorRun {
  const evidenceFrames = createEvidenceFrames(
    input.id,
    input.steps.map((step) => step.id),
    input.title,
    input.accent,
  );

  const frameIdsByStep = new Map<string, string[]>();
  for (const frame of evidenceFrames) {
    const existing = frameIdsByStep.get(frame.stepId) ?? [];
    existing.push(frame.id);
    frameIdsByStep.set(frame.stepId, existing);
  }

  const steps: InspectorTraceStep[] = input.steps.map((step) => ({
    ...step,
    evidenceFrameIds: frameIdsByStep.get(step.id) ?? [],
  }));

  return {
    id: input.id,
    title: input.title,
    goal: input.goal,
    dataset: input.dataset,
    status: input.status,
    verdict: input.verdict,
    startedAt: input.startedAt,
    totalLatencyMs: sum(steps, (step) => step.durationMs),
    totalTokens: sum(steps, (step) => step.tokenUsage.total),
    totalCostUsd: sum(steps, (step) => step.costUsd),
    confidence: input.confidence,
    tags: input.tags,
    summary: input.summary,
    videoUrl: input.videoUrl,
    steps,
    evidenceFrames,
  };
}

export function generateTelemetryInspectorMockRuns(now = Date.now()): InspectorRun[] {
  const publishedVideo = "/benchmarks/videos/enterprise-investigation-eval-stream-latest.webm";

  return [
    buildRun({
      id: "run_payment_timeout_20260304",
      title: "Payment timeout enterprise investigation",
      goal: "Trace the eight-month causal chain that led to the March 4 payment gateway timeout failure.",
      dataset: "GitHub + Slack + Jira + latency series",
      status: "error",
      verdict: "Bug found · rollout blocked until timeout ceiling is restored",
      startedAt: new Date(now - 18 * 60 * 1000).toISOString(),
      confidence: 0.96,
      tags: ["enterpriseInvestigation", "temporal", "proof-pack", "payments"],
      summary:
        "This run reconstructs the causal timeline across code, team chat, and incident tickets. The failure came from unbounded retries introduced during a rush release, then amplified by a later database upgrade.",
      videoUrl: publishedVideo,
      accent: "#F43F5E",
      steps: [
        {
          id: "payment-step-planner",
          type: "llm_inference",
          status: "success",
          title: "Planner agent scopes the investigation",
          subtitle: "Builds the evidence plan before any retrieval begins",
          rationale:
            "The run starts by naming the exact outcome, the likely source systems, and the date boundaries so retrieval stays chronological instead of drifting toward the newest snippets.",
          startedAt: new Date(now - 18 * 60 * 1000).toISOString(),
          durationMs: 1240,
          tokenUsage: { input: 1412, output: 422, total: 1834 },
          costUsd: 0.00038,
          request: {
            query: "Trace the temporal causal chain and architectural decisions leading to the Payment Gateway timeout vulnerability detected on March 4, 2026.",
            requestedOutput: "enterpriseInvestigation",
            horizon: "8 months",
          },
          response: {
            plan: [
              "retrieve historical code diffs",
              "scan chat pressure signals",
              "compare numeric latency regimes",
              "draft operator-ready mitigation",
            ],
          },
        },
        {
          id: "payment-step-fetch",
          type: "tool_call",
          status: "success",
          title: "Grounded retrieval fetches blame, tickets, and chat history",
          subtitle: "Thin public search/fetch layer with immutable source hashes",
          rationale:
            "The retrieval phase favors exact-source records and snapshot hashes so the causal chain can survive edited tickets or changed dashboards.",
          startedAt: new Date(now - 17 * 60 * 1000).toISOString(),
          durationMs: 2680,
          tokenUsage: { input: 520, output: 0, total: 520 },
          costUsd: 0.00009,
          toolName: "search.fetch_evidence_bundle",
          request: {
            sources: ["github_pr", "slack_transcript", "jira_ticket", "signal_series"],
            since: "2025-08-01",
            until: "2026-03-04",
          },
          response: {
            sourcesQueried: 4,
            citations: 11,
            snapshotHashes: ["sha256:pr-2044", "sha256:slack-098f6bcd", "sha256:jira-eng4092"],
          },
        },
        {
          id: "payment-step-anomaly",
          type: "anomaly_detection",
          status: "warning",
          title: "TSFM lane detects the structural break",
          subtitle: "P95 latency diverges from the historical payment envelope",
          rationale:
            "The math layer flags the exact week the retry wrapper stopped respecting the 200ms ceiling. The narrative lane should explain the break, not invent it.",
          startedAt: new Date(now - 16 * 60 * 1000).toISOString(),
          durationMs: 910,
          tokenUsage: { input: 0, output: 0, total: 0 },
          costUsd: 0,
          toolName: "temporal.detect_regime_shift",
          request: {
            signalKey: "payment_api_latency_p95",
            detector: "timesfm-1.0",
            lookbackDays: 240,
          },
          response: {
            anomalyType: "variance_shift",
            startedAt: "2025-11-14T00:00:00Z",
            severity: 0.88,
          },
          warnings: ["Variance shifted 4.2x above stable baseline."],
        },
        {
          id: "payment-step-synthesis",
          type: "llm_inference",
          status: "success",
          title: "Synthesis lane builds the causal narrative",
          subtitle: "Explains why the structural break happened in plain English",
          rationale:
            "This step links pressure from the growth team to the merge-conflict shortcut that removed timeout bounds, then carries that decision forward to the later database saturation.",
          startedAt: new Date(now - 14 * 60 * 1000).toISOString(),
          durationMs: 3510,
          tokenUsage: { input: 2480, output: 1198, total: 3678 },
          costUsd: 0.00079,
          request: {
            evidenceBundleIds: ["pr-2044", "slack-098f6bcd", "eng-4092"],
            requiredSections: ["causal_chain", "game_theory_analysis", "zero_friction_execution"],
          },
          response: {
            causalChainLength: 3,
            orgFriction:
              "Growth velocity KPIs overrode platform stability constraints, and the architecture allowed local optimizations to bypass the global timeout guardrail.",
            proposedAction: "Re-implement strict upper-bound timeouts on the retry wrapper and reinstate CI timeout checks.",
          },
        },
        {
          id: "payment-step-proof",
          type: "proof_pack",
          status: "success",
          title: "Proof pack and replay bundle emitted",
          subtitle: "Trace, replay URL, and operator-ready artifact recorded",
          rationale:
            "The run ends by packaging the investigation into a replayable artifact so the VP or QA lead can inspect the actual steps instead of trusting a static post-mortem.",
          startedAt: new Date(now - 12 * 60 * 1000).toISOString(),
          durationMs: 1660,
          tokenUsage: { input: 132, output: 206, total: 338 },
          costUsd: 0.00006,
          toolName: "replay.register_manifest",
          request: {
            traceId: "trace_882910fa",
            outputType: "enterpriseInvestigation",
          },
          response: {
            replayUrl: "/v1/replay/trace_882910fa",
            complianceStatus: "SOC2_READY",
          },
        },
      ],
    }),
    buildRun({
      id: "run_xz_backdoor_20260303",
      title: "XZ backdoor trust-shift diagnosis",
      goal: "Reconstruct the social and technical sequence that enabled the XZ backdoor over multiple maintenance cycles.",
      dataset: "Mailing list + git + release metadata",
      status: "warning",
      verdict: "Risk surfaced · trust-transfer pattern detected",
      startedAt: new Date(now - 71 * 60 * 1000).toISOString(),
      confidence: 0.9,
      tags: ["supply-chain", "game-theory", "open-source"],
      summary:
        "The investigation shows how repeated helper behavior, social pressure, and maintainer fatigue gradually shifted trust before the malicious release landed.",
      videoUrl: publishedVideo,
      accent: "#F59E0B",
      steps: [
        {
          id: "xz-step-retrieve",
          type: "tool_call",
          status: "success",
          title: "Historical retrieval gathers mailing-list and commit evidence",
          subtitle: "Collects temporal slices instead of only the latest revision",
          rationale: "The key question is not what shipped last, but how the contributor trust graph changed over time.",
          startedAt: new Date(now - 70 * 60 * 1000).toISOString(),
          durationMs: 2120,
          tokenUsage: { input: 420, output: 0, total: 420 },
          costUsd: 0.00007,
          toolName: "search.fetch_temporal_bundle",
          request: { query: "xz maintainer trust transfer timeline", depth: "temporal" },
          response: { citations: 9, snapshotHashes: ["sha256:mail-1", "sha256:git-3"] },
        },
        {
          id: "xz-step-anomaly",
          type: "anomaly_detection",
          status: "warning",
          title: "Pressure-email velocity spike detected",
          subtitle: "Communication pace diverges from historical maintainer norms",
          rationale: "The volume shift matters because it suggests a social engineering pattern, not just code churn.",
          startedAt: new Date(now - 67 * 60 * 1000).toISOString(),
          durationMs: 870,
          tokenUsage: { input: 0, output: 0, total: 0 },
          costUsd: 0,
          toolName: "temporal.forecast_signal",
          request: { signalKey: "xz_pressure_email_velocity" },
          response: { anomalyType: "acceleration", severity: 0.74 },
          warnings: ["Trust-transfer risk exceeded baseline by 2.9x."],
        },
        {
          id: "xz-step-narrative",
          type: "llm_inference",
          status: "success",
          title: "Narrative lane explains the trust-transfer pattern",
          subtitle: "Game-theory framing of local helpfulness versus global risk",
          rationale: "The explanation highlights how repeated small wins can accumulate into maintainer dependency and blind spots.",
          startedAt: new Date(now - 65 * 60 * 1000).toISOString(),
          durationMs: 2980,
          tokenUsage: { input: 2301, output: 1004, total: 3305 },
          costUsd: 0.00069,
          request: { requiredSections: ["causal_chain", "game_theory_analysis"] },
          response: {
            causalChainLength: 4,
            organizationalFriction:
              "Volunteer fatigue and social proof rewarded responsiveness, while no single actor optimized for ecosystem-wide safety.",
          },
        },
      ],
    }),
    buildRun({
      id: "run_checkout_ui_20260302",
      title: "Checkout evidence-chain walkthrough",
      goal: "Validate a checkout interaction with synced screenshots, tool calls, and Gemini QA evidence.",
      dataset: "WebMCP + Gemini QA + screenshots",
      status: "running",
      verdict: "Still executing · waiting on final video QA verdict",
      startedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      confidence: 0.78,
      tags: ["ui-qa", "playwright", "visual-evidence"],
      summary:
        "This run is deliberately left mid-flight so the inspector can exercise pending states, partial metrics, and evidence sync before final judgment lands.",
      videoUrl: publishedVideo,
      accent: "#2563EB",
      steps: [
        {
          id: "checkout-step-plan",
          type: "llm_inference",
          status: "success",
          title: "Planner drafts browser route and assertions",
          subtitle: "Maps out the browser interaction sequence",
          rationale: "The UI loop needs a crisp plan before the browser begins mutating state.",
          startedAt: new Date(now - 5 * 60 * 1000).toISOString(),
          durationMs: 840,
          tokenUsage: { input: 782, output: 244, total: 1026 },
          costUsd: 0.00021,
          request: { route: "/checkout", assertions: ["cart total visible", "submit button enabled"] },
          response: { plannedSteps: 4 },
        },
        {
          id: "checkout-step-click",
          type: "tool_call",
          status: "success",
          title: "Browser tool clicks the checkout CTA",
          subtitle: "Bounded WebMCP action with DOM evidence capture",
          rationale: "The click is paired with the screenshot so the final evidence chain is human-inspectable.",
          startedAt: new Date(now - 4 * 60 * 1000).toISOString(),
          durationMs: 1290,
          tokenUsage: { input: 84, output: 0, total: 84 },
          costUsd: 0.00001,
          toolName: "web_mcp.click_element",
          request: { selector: "#checkout-button", viewport: "1440x900" },
          response: { clicked: true, snapshotHash: "sha256:checkout-click" },
        },
        {
          id: "checkout-step-judge",
          type: "human_gate",
          status: "pending",
          title: "Gemini video QA is scoring motion fidelity",
          subtitle: "Pending verdict with full telemetry still streaming",
          rationale: "The final leg waits on video QA so the operator can see how the system behaves before a score arrives.",
          startedAt: new Date(now - 2 * 60 * 1000).toISOString(),
          durationMs: 4200,
          tokenUsage: { input: 930, output: 0, total: 930 },
          costUsd: 0.00018,
          request: { model: "gemini-3-flash-preview", task: "score checkout motion quality" },
          response: { status: "running" },
        },
      ],
    }),
    buildRun({
      id: "run_specdoc_release_20260301",
      title: "SpecDoc release replay and proof export",
      goal: "Verify a clean release run with replay registration, approval handoff, and no unresolved risk.",
      dataset: "SpecDoc + replay bundle + approval queue",
      status: "success",
      verdict: "Success · proof pack published",
      startedAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
      confidence: 0.93,
      tags: ["specdoc", "release", "proof-pack"],
      summary:
        "A clean success case that demonstrates how the inspector looks when the run completes without unresolved warnings.",
      videoUrl: publishedVideo,
      accent: "#10B981",
      steps: [
        {
          id: "release-step-plan",
          type: "llm_inference",
          status: "success",
          title: "SpecDoc execution plan locked",
          subtitle: "Success criteria and rollback scope finalized",
          rationale: "This gives the release lane deterministic boundaries before it touches production evidence.",
          startedAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
          durationMs: 1110,
          tokenUsage: { input: 960, output: 310, total: 1270 },
          costUsd: 0.00025,
          request: { specId: "spec_release_4093" },
          response: { successCriteria: 5, rollbackPlan: "defined" },
        },
        {
          id: "release-step-replay",
          type: "replay",
          status: "success",
          title: "Deterministic replay validates the same chain",
          subtitle: "Replays stored tool outputs instead of re-hitting live APIs",
          rationale: "The replay is what makes the proof pack trustworthy for audit review.",
          startedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
          durationMs: 1740,
          tokenUsage: { input: 340, output: 90, total: 430 },
          costUsd: 0.00008,
          toolName: "replay.execute_manifest",
          request: { traceId: "trace_release_4093" },
          response: { matchedStoredOutputs: true },
        },
        {
          id: "release-step-export",
          type: "proof_pack",
          status: "success",
          title: "Audit bundle exported for operator sign-off",
          subtitle: "All evidence, screenshots, and verdict metadata attached",
          rationale: "The release closes only after the operator-ready artifact exists.",
          startedAt: new Date(now - 25 * 60 * 60 * 1000 + 4 * 60 * 1000).toISOString(),
          durationMs: 1360,
          tokenUsage: { input: 120, output: 204, total: 324 },
          costUsd: 0.00005,
          toolName: "proof_pack.export_bundle",
          request: { traceId: "trace_release_4093", includeReplay: true },
          response: { exported: true, complianceStatus: "SOC2_READY" },
        },
      ],
    }),
  ];
}
