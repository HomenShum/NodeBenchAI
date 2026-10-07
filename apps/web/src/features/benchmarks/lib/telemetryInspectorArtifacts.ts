import type {
  InspectorEvidenceFrame,
  InspectorRun,
  InspectorRunStatus,
  InspectorStepStatus,
  InspectorStepType,
  InspectorTraceStep,
} from "../data/telemetryInspectorMockData";

export interface EnterpriseEvalStreamEvent {
  at: string;
  type: string;
  lane?: number;
  caseId?: string;
  detail: string;
  request?: string;
  response?: string;
  telemetry?: Record<string, string | number | boolean | null>;
}

export interface EnterpriseInvestigationPayload {
  meta?: {
    query?: string;
    confidence_score?: number;
    overall_confidence?: number;
    [key: string]: unknown;
  };
  temporal_intelligence?: {
    anomalies_detected?: Array<Record<string, unknown>>;
    forecast?: {
      prediction?: string;
      summary?: string;
      confidence?: number;
      [key: string]: unknown;
    } | null;
  };
  causal_chain?: Array<Record<string, unknown>>;
  game_theory_analysis?: {
    organizational_friction?: string;
    [key: string]: unknown;
  } | null;
  zero_friction_execution?: {
    proposed_action?: string;
    [key: string]: unknown;
  } | null;
  audit_proof_pack?: {
    replay_url?: string | null;
    source_snapshot_hashes?: string[];
    [key: string]: unknown;
  } | null;
  observed_facts?: Array<{
    statement?: string;
    evidence_refs?: string[];
    [key: string]: unknown;
  }>;
  derived_signals?: {
    anomalies?: Array<Record<string, unknown>>;
    forecast?: {
      summary?: string;
      confidence?: number;
      evidence_refs?: string[];
      [key: string]: unknown;
    } | null;
  };
  hypotheses?: Array<{
    statement?: string;
    status?: string;
    confidence?: number;
    [key: string]: unknown;
  }>;
  counter_analysis?: {
    result?: string;
    questions_tested?: string[];
    [key: string]: unknown;
  };
  recommended_actions?: Array<{
    action?: string;
    priority?: string;
    human_gate?: string;
    [key: string]: unknown;
  }>;
  evidence_catalog?: Array<{
    content_hash?: string;
    source_uri?: string;
    [key: string]: unknown;
  }>;
  traceability?: {
    trace_id?: string;
    tool_calls?: number;
    replay_url?: string | null;
    otel_spans_recorded?: boolean;
    artifact_integrity?: string;
    [key: string]: unknown;
  };
  limitations?: string[];
}

export interface EnterpriseEvalArtifact {
  generatedAt: string;
  summary: {
    totalCases: number;
    passedCases: number;
    deterministicAverage: number;
    llmJudgeAverage: number;
    totalEstimatedTokens: number;
  };
  cases: Array<{
    caseId: string;
    title: string;
    dataset: string;
    query: string;
    deterministic: {
      overall: number;
      passed: boolean;
      dimensions?: Record<string, unknown>;
      failures?: string[];
    };
    llmJudge: {
      score: number;
      passed: boolean;
      reasoning?: string;
      evidence?: string[];
      model?: string;
      estimatedInputTokens?: number;
      estimatedOutputTokens?: number;
      estimatedTotalTokens?: number;
      estimatedJudgeCostUsd?: number;
      [key: string]: unknown;
    };
    telemetry: {
      totalDurationMs: number;
      anomalyCount: number;
      causalChainLength: number;
      sourceHashCount: number;
      proposedAction: string;
    };
    investigation?: EnterpriseInvestigationPayload;
  }>;
  stream: {
    object: string;
    events: EnterpriseEvalStreamEvent[];
    finalVerdict: string;
    telemetry: {
      totalEstimatedTokens: number;
      averageJudgeScore: number;
      averageDeterministicScore: number;
      totalWallClockMs?: number;
      estimatedJudgeCostUsd?: number | null;
    };
    video?: {
      status: string;
      url: string | null;
      note?: string;
    };
  };
  failures: string[];
}

export interface ReplayTracePayload {
  object?: string;
  runId?: string;
  traceId?: string;
  trace?: Array<{
    name: string;
    start_time_unix_nano: number;
    end_time_unix_nano: number;
    status?: { code?: number; message?: string };
    attributes?: Record<string, string | number | boolean | undefined>;
    events?: Array<{
      name: string;
      attributes?: {
        "payload.json"?: string;
      };
    }>;
  }>;
  responseSnapshotHash?: string;
  notes?: string[];
}

function svgDataUrl(title: string, subtitle: string, accent: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#050505" />
          <stop offset="100%" stop-color="#0F172A" />
        </linearGradient>
      </defs>
      <rect width="900" height="540" rx="28" fill="url(#bg)" />
      <rect x="28" y="28" width="844" height="484" rx="22" fill="#111827" stroke="rgba(255,255,255,0.12)" />
      <rect x="58" y="58" width="240" height="18" rx="9" fill="${accent}" opacity="0.95" />
      <rect x="58" y="94" width="784" height="132" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="58" y="252" width="330" height="204" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="418" y="252" width="424" height="204" rx="18" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <rect x="74" y="112" width="168" height="12" rx="6" fill="rgba(255,255,255,0.12)" />
      <rect x="74" y="142" width="558" height="14" rx="7" fill="rgba(255,255,255,0.08)" />
      <rect x="74" y="170" width="402" height="14" rx="7" fill="rgba(255,255,255,0.06)" />
      <text x="58" y="488" fill="#E5E7EB" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700">${title}</text>
      <text x="58" y="516" fill="rgba(229,231,235,0.76)" font-family="Inter, Arial, sans-serif" font-size="18">${subtitle}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function statusAccent(status: InspectorRunStatus | InspectorStepStatus) {
  if (status === "success") return "#10B981";
  if (status === "warning") return "#F59E0B";
  if (status === "error") return "#F43F5E";
  return "#60A5FA";
}

function safeJsonParse(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function wrapPayload(text: string | undefined, extra?: Record<string, unknown>) {
  const parsed = safeJsonParse(text);
  if (parsed) {
    return extra ? { ...parsed, ...extra } : parsed;
  }
  return {
    text: text ?? "",
    ...(extra ?? {}),
  };
}

function getInvestigationConfidence(investigation?: EnterpriseInvestigationPayload) {
  const confidence = investigation?.meta?.overall_confidence ?? investigation?.meta?.confidence_score;
  return typeof confidence === "number" ? confidence : 0.9;
}

function getInvestigationAnomalyCount(investigation?: EnterpriseInvestigationPayload) {
  return investigation?.derived_signals?.anomalies?.length ?? investigation?.temporal_intelligence?.anomalies_detected?.length ?? 0;
}

function getInvestigationSummary(investigation?: EnterpriseInvestigationPayload) {
  return (
    investigation?.counter_analysis?.result ??
    investigation?.game_theory_analysis?.organizational_friction ??
    investigation?.hypotheses?.[0]?.statement ??
    investigation?.derived_signals?.forecast?.summary ??
    investigation?.temporal_intelligence?.forecast?.summary ??
    investigation?.temporal_intelligence?.forecast?.prediction ??
    investigation?.observed_facts?.[0]?.statement ??
    null
  );
}

function getInvestigationReplayUrl(investigation?: EnterpriseInvestigationPayload) {
  const replayUrl = investigation?.traceability?.replay_url ?? investigation?.audit_proof_pack?.replay_url;
  return typeof replayUrl === "string" && replayUrl.length > 0 ? replayUrl : null;
}

function getInvestigationSourceHashCount(investigation?: EnterpriseInvestigationPayload) {
  return (
    investigation?.evidence_catalog?.filter(
      (item) => typeof item.content_hash === "string" && item.content_hash.length > 0,
    ).length ?? investigation?.audit_proof_pack?.source_snapshot_hashes?.length ?? 0
  );
}

function getInvestigationAuditProofPack(investigation?: EnterpriseInvestigationPayload) {
  if (!investigation) return null;

  const replay_url = getInvestigationReplayUrl(investigation);
  const source_snapshot_hashes =
    investigation.audit_proof_pack?.source_snapshot_hashes ??
    investigation.evidence_catalog
      ?.map((item) => item.content_hash)
      .filter((hash): hash is string => typeof hash === "string" && hash.length > 0) ??
    [];

  if (!replay_url && source_snapshot_hashes.length === 0 && !investigation.traceability) {
    return null;
  }

  return {
    replay_url,
    source_snapshot_hashes,
    traceability: investigation.traceability ?? null,
  };
}

function coerceStepType(type: string): InspectorStepType {
  if (type.includes("judge")) return "human_gate";
  if (type.includes("investigation")) return "llm_inference";
  if (type.includes("started")) return "tool_call";
  if (type.includes("completed")) return "proof_pack";
  if (type.includes("replay")) return "replay";
  return "llm_inference";
}

function coerceStepStatus(
  eventType: string,
  telemetry?: Record<string, string | number | boolean | null>,
): InspectorStepStatus {
  if (eventType.includes("judge_requested")) return "pending";
  if (telemetry?.judgePassed === false || telemetry?.deterministicPassed === false) return "error";
  if (eventType.includes("investigation_built")) return "warning";
  if (eventType.includes("completed") || eventType.includes("judged")) return "success";
  return "success";
}

function coerceRunStatus(
  deterministicPassed: boolean,
  judgePassed: boolean,
  streamEvents: EnterpriseEvalStreamEvent[],
): InspectorRunStatus {
  if (!deterministicPassed || !judgePassed) return "error";
  if (streamEvents.some((event) => event.type.includes("judge_requested"))) return "warning";
  return "success";
}

function toEvidenceFrames(runId: string, steps: InspectorTraceStep[], accent: string): InspectorEvidenceFrame[] {
  return steps.map((step, index) => ({
    id: `${runId}-frame-${index + 1}`,
    stepId: step.id,
    label: `Step ${index + 1}`,
    caption: step.subtitle,
    timestampMs: step.durationMs * (index + 1),
    imageUrl: svgDataUrl(step.title, step.subtitle, accent),
  }));
}

function buildStepFromStreamEvent(
  runId: string,
  caseRecord: EnterpriseEvalArtifact["cases"][number],
  event: EnterpriseEvalStreamEvent,
  index: number,
  allEvents: EnterpriseEvalStreamEvent[],
): InspectorTraceStep {
  const stepType = coerceStepType(event.type);
  const stepStatus = coerceStepStatus(event.type, event.telemetry);
  const telemetry = event.telemetry ?? {};
  const durationMs =
    typeof telemetry.totalDurationMs === "number"
      ? telemetry.totalDurationMs
      : typeof telemetry.judgeDurationMs === "number"
      ? telemetry.judgeDurationMs
      : typeof telemetry.buildDurationMs === "number"
      ? telemetry.buildDurationMs
      : 250 + index * 50;

  const inputTokens =
    typeof caseRecord.llmJudge.estimatedInputTokens === "number" && event.type.includes("judge")
      ? caseRecord.llmJudge.estimatedInputTokens
      : 0;
  const outputTokens =
    typeof caseRecord.llmJudge.estimatedOutputTokens === "number" && event.type.includes("judged")
      ? caseRecord.llmJudge.estimatedOutputTokens
      : 0;
  const totalTokens =
    typeof telemetry.estimatedTotalTokens === "number"
      ? telemetry.estimatedTotalTokens
      : typeof caseRecord.llmJudge.estimatedTotalTokens === "number" && event.type.includes("judge")
      ? caseRecord.llmJudge.estimatedTotalTokens
      : inputTokens + outputTokens;

  const costUsd =
    typeof telemetry.estimatedJudgeCostUsd === "number"
      ? telemetry.estimatedJudgeCostUsd
      : typeof caseRecord.llmJudge.estimatedJudgeCostUsd === "number" && event.type.includes("judge")
      ? caseRecord.llmJudge.estimatedJudgeCostUsd
      : 0;

  const title =
    event.type === "case.started"
      ? "Grounded case kickoff"
      : event.type === "case.investigation_built"
      ? "Enterprise investigation synthesized"
      : event.type === "case.llm_judge_requested"
      ? "LLM judge requested"
      : event.type === "case.judged"
      ? "Required LLM judge verdict"
      : event.type === "case.completed"
      ? "Proof pack and final telemetry"
      : event.type;

  const rationale =
    event.type === "case.started"
      ? "The run starts with the exact query, source bundle, and temporal boundaries so the chain stays anchored to real evidence."
      : event.type === "case.investigation_built"
      ? getInvestigationSummary(caseRecord.investigation) ??
        "This is the synthesis step where temporal signals and evidence become an operator-readable diagnosis."
      : event.type === "case.llm_judge_requested"
      ? "A required low-cost LLM judge checks whether the investigation matches the known human postmortem instead of only sounding plausible."
      : event.type === "case.judged"
      ? caseRecord.llmJudge.reasoning ?? "The judge returned a verdict and rationale for the run."
      : "The run closes with replay/proof-pack metadata so the verdict stays auditable.";

  const extraResponse =
    event.type === "case.investigation_built"
      ? { investigation: caseRecord.investigation }
      : event.type === "case.judged"
      ? { llmJudge: caseRecord.llmJudge }
      : event.type === "case.completed"
      ? {
          telemetry: caseRecord.telemetry,
          auditProofPack: getInvestigationAuditProofPack(caseRecord.investigation),
          replayUrl: getInvestigationReplayUrl(caseRecord.investigation),
        }
      : {};

  const warningMessages = [
    ...(typeof telemetry.confidenceScore === "number" && telemetry.confidenceScore < 0.92
      ? [`Confidence trimmed to ${telemetry.confidenceScore}.`]
      : []),
    ...(event.type === "case.investigation_built" && getInvestigationAnomalyCount(caseRecord.investigation) > 0
      ? [
          `${getInvestigationAnomalyCount(caseRecord.investigation)} anomaly signal(s) detected before synthesis.`,
        ]
      : []),
  ];

  return {
    id: `${runId}-${event.type.replaceAll(".", "-")}-${index + 1}`,
    type: stepType,
    status: stepStatus,
    title,
    subtitle: event.detail,
    rationale,
    startedAt: event.at,
    durationMs,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
    },
    costUsd,
    toolName:
      event.type === "case.started"
        ? "public_fixture_loader"
        : event.type === "case.investigation_built"
        ? "enterpriseInvestigation"
        : event.type === "case.llm_judge_requested" || event.type === "case.judged"
        ? String(caseRecord.llmJudge.model ?? "llm_judge")
        : "proof_pack",
    request: wrapPayload(event.request, {
      caseId: caseRecord.caseId,
      lane: event.lane ?? null,
      deterministic: caseRecord.deterministic,
    }),
    response: wrapPayload(event.response, {
      telemetry,
      ...extraResponse,
      eventType: event.type,
      streamIndex: index,
      totalCaseEvents: allEvents.length,
    }),
    warnings: warningMessages.length > 0 ? warningMessages : undefined,
    evidenceFrameIds: [],
  };
}

function buildReplaySteps(runId: string, trace: ReplayTracePayload | null): InspectorTraceStep[] {
  if (!trace?.trace?.length) return [];

  return trace.trace.slice(0, 6).map((span, index) => {
    const inputEvent = span.events?.find((event) => event.name === "tool.input");
    const outputEvent = span.events?.find((event) => event.name === "tool.output");
    const monologueEvent = span.events?.find((event) => event.name === "agent.monologue");
    const durationMs = Math.max(
      1,
      Math.round((span.end_time_unix_nano - span.start_time_unix_nano) / 1_000_000),
    );

    return {
      id: `${runId}-replay-${index + 1}`,
      type: span.name.includes("fetch") ? "tool_call" : span.name.includes("search") ? "tool_call" : "replay",
      status: span.status?.code === 2 ? "error" : "success",
      title: span.name,
      subtitle: "Deterministic replay span reconstructed from stored tool outputs",
      rationale:
        monologueEvent?.attributes?.["payload.json"] ??
        "Replay shows the exact tool span emitted during the original run.",
      startedAt: new Date(Math.round(span.start_time_unix_nano / 1_000_000)).toISOString(),
      durationMs,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
      },
      costUsd: 0,
      toolName: String(span.attributes?.["mcp.tool.name"] ?? span.name),
      request: wrapPayload(inputEvent?.attributes?.["payload.json"], {
        replayTraceId: trace.traceId ?? trace.runId ?? null,
      }),
      response: wrapPayload(outputEvent?.attributes?.["payload.json"], {
        responseSnapshotHash: trace.responseSnapshotHash ?? null,
      }),
      evidenceFrameIds: [],
    };
  });
}

export function buildTelemetryInspectorRunsFromEvalArtifact(
  artifact: EnterpriseEvalArtifact,
): InspectorRun[] {
  const videoUrl = artifact.stream.video?.url ?? undefined;

  return artifact.cases.map((caseRecord) => {
    const caseEvents = artifact.stream.events.filter((event) => event.caseId === caseRecord.caseId);
    const runStatus = coerceRunStatus(caseRecord.deterministic.passed, caseRecord.llmJudge.passed, caseEvents);
    const steps = caseEvents.map((event, index) =>
      buildStepFromStreamEvent(caseRecord.caseId, caseRecord, event, index, caseEvents),
    );
    const evidenceFrames = toEvidenceFrames(caseRecord.caseId, steps, statusAccent(runStatus));

    const frameIdsByStep = new Map<string, string[]>();
    for (const frame of evidenceFrames) {
      const existing = frameIdsByStep.get(frame.stepId) ?? [];
      existing.push(frame.id);
      frameIdsByStep.set(frame.stepId, existing);
    }

    const hydratedSteps = steps.map((step) => ({
      ...step,
      evidenceFrameIds: frameIdsByStep.get(step.id) ?? [],
    }));

    const confidence = getInvestigationConfidence(caseRecord.investigation);

    return {
      id: caseRecord.caseId,
      title: caseRecord.title,
      goal: caseRecord.query,
      dataset: caseRecord.dataset,
      status: runStatus,
      verdict:
        runStatus === "success"
          ? `Passed · deterministic ${caseRecord.deterministic.overall}, judge ${caseRecord.llmJudge.score}`
          : runStatus === "warning"
          ? `Attention needed · deterministic ${caseRecord.deterministic.overall}, judge ${caseRecord.llmJudge.score}`
          : `Failed · deterministic ${caseRecord.deterministic.overall}, judge ${caseRecord.llmJudge.score}`,
      startedAt: caseEvents[0]?.at ?? artifact.generatedAt,
      totalLatencyMs: caseRecord.telemetry.totalDurationMs,
      totalTokens: caseRecord.llmJudge.estimatedTotalTokens ?? 0,
      totalCostUsd: caseRecord.llmJudge.estimatedJudgeCostUsd ?? 0,
      confidence,
      tags: [
        "enterpriseInvestigation",
        "public-fixture",
        caseRecord.caseId,
        ...(getInvestigationSourceHashCount(caseRecord.investigation) > 0 ? ["traceable"] : []),
      ],
      summary:
        getInvestigationSummary(caseRecord.investigation) ??
        caseRecord.llmJudge.reasoning ??
        "Temporal investigation completed from the public eval artifact.",
      videoUrl,
      steps: hydratedSteps,
      evidenceFrames,
    };
  });
}

export async function hydrateTelemetryInspectorRunsWithReplay(
  runs: InspectorRun[],
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<InspectorRun[]> {
  const hydrated = await Promise.all(
    runs.map(async (run) => {
      const proofPackStep = [...run.steps].reverse().find((step) => {
        const replayUrl = step.response?.replayUrl;
        return typeof replayUrl === "string" && replayUrl.length > 0;
      });
      const replayUrl = proofPackStep?.response?.replayUrl;
      if (typeof replayUrl !== "string" || replayUrl.length === 0) {
        return run;
      }

      try {
        const normalized = replayUrl.endsWith("/trace") ? replayUrl : `${replayUrl}/trace`;
        const response = await fetchImpl(normalized, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return run;
        const json = (await response.json()) as ReplayTracePayload;
        const replaySteps = buildReplaySteps(run.id, json);
        if (replaySteps.length === 0) return run;

        const allSteps = [...run.steps, ...replaySteps];
        const evidenceFrames = toEvidenceFrames(run.id, allSteps, statusAccent(run.status));
        const frameIdsByStep = new Map<string, string[]>();
        for (const frame of evidenceFrames) {
          const existing = frameIdsByStep.get(frame.stepId) ?? [];
          existing.push(frame.id);
          frameIdsByStep.set(frame.stepId, existing);
        }

        return {
          ...run,
          steps: allSteps.map((step) => ({
            ...step,
            evidenceFrameIds: frameIdsByStep.get(step.id) ?? [],
          })),
          evidenceFrames,
        };
      } catch {
        return run;
      }
    }),
  );

  return hydrated;
}
