/**
 * WorkflowEnvelope — Canonical workflow-asset model for NodeBench.
 *
 * Unifies PipelineState, ResultPacket, SharedContextPacket, FounderEpisodeRecord,
 * and WorkflowTemplate into ONE envelope that every surface can produce/consume.
 *
 * Design: wraps existing types in `payload` — does NOT replace them.
 */

import { createHash } from "node:crypto";
import type { PipelineState } from "../pipeline/searchPipeline.js";

// ── Transport layer ──────────────────────────────────────────────────

export type WorkflowEnvelopeType =
  | "search_result"
  | "context_handoff"
  | "episode_trace"
  | "workflow_replay"
  | "retention_sync";

export interface WorkflowEnvelopeTransport {
  envelopeId: string;
  envelopeType: WorkflowEnvelopeType;
  version: number;
  createdAt: string;
  expiresAt?: string;
}

// ── Content layer ────────────────────────────────────────────────────

export interface WorkflowEnvelopeContent {
  subject: string;
  entityName?: string;
  summary: string;
  confidence: number;
  classification?: string;
  lens?: string;
}

// ── Proof chain ──────────────────────────────────────────────────────

export interface EnvelopeSourceRef {
  id: string;
  label: string;
  href?: string;
  type: "web" | "local" | "doc" | "trace" | "mcp_tool";
  confidence?: number;
  domain?: string;
  siteName?: string;
  faviconUrl?: string;
  thumbnailUrl?: string;
  imageCandidates?: string[];
  publishedAt?: string;
}

export interface WorkflowEnvelopeProof {
  sourceRefs: EnvelopeSourceRef[];
  claims: string[];
  evidenceRefs: string[];
  verificationRate?: number;
}

// ── Trace ────────────────────────────────────────────────────────────

export interface EnvelopeTraceStep {
  step: string;
  tool?: string;
  status: string;
  detail?: string;
  durationMs?: number;
  stateHashBefore?: string;
  stateHashAfter?: string;
}

export interface WorkflowEnvelopeTrace {
  steps: EnvelopeTraceStep[];
  totalDurationMs: number;
  toolsInvoked: string[];
}

// ── Lineage ──────────────────────────────────────────────────────────

export interface WorkflowEnvelopeLineage {
  parentIds: string[];
  sourceRunId?: string;
  sourceEpisodeId?: string;
  sourceContextId?: string;
  supersedes?: string;
  correlationId?: string;
}

// ── Scope ────────────────────────────────────────────────────────────

export interface WorkflowEnvelopeScope {
  tenantId?: string;
  workspaceId?: string;
  visibility: "internal" | "workspace" | "tenant";
  surface?: string;
}

// ── The envelope ─────────────────────────────────────────────────────

export interface WorkflowEnvelope {
  transport: WorkflowEnvelopeTransport;
  content: WorkflowEnvelopeContent;
  proof: WorkflowEnvelopeProof;
  trace: WorkflowEnvelopeTrace;
  lineage: WorkflowEnvelopeLineage;
  scope: WorkflowEnvelopeScope;
  payload: Record<string, unknown>;
}

export interface WorkflowAssetRecord {
  assetId: string;
  assetType: "research_packet" | "issue_packet" | "workflow_template" | "delegation_packet";
  state: "generated" | "published" | "delegated";
  canonicalPacketId: string;
  canonicalPacketType: string;
  canonicalEntity: string;
  generatedAt: string;
  stages: string[];
  replayReady: boolean;
  delegationReady: boolean;
  currentContextId?: string;
  lastTaskId?: string;
  targetAgents?: string[];
  envelopeId?: string;
  envelopeType?: WorkflowEnvelopeType;
  lineage?: {
    sourceRunId?: string;
    sourceContextId?: string;
    parentAssetId?: string;
  };
}

export interface ResultPacketLike {
  query?: string;
  entityName?: string;
  canonicalEntity?: string | { name?: string; canonicalMission?: string; identityConfidence?: number };
  answer?: string;
  confidence?: number;
  packetId?: string;
  packetType?: string;
  classification?: string;
  lens?: string;
  sourceRefs?: Array<{
    id?: string;
    label?: string;
    title?: string;
    href?: string;
    type?: "web" | "local" | "doc" | "trace" | "mcp_tool";
    confidence?: number;
    domain?: string;
    siteName?: string;
    faviconUrl?: string;
    thumbnailUrl?: string;
    imageCandidates?: string[];
    publishedAt?: string;
  }>;
  claimRefs?: Array<{ text?: string }>;
  answerBlocks?: Array<{ text?: string; title?: string }>;
  trace?: Array<{ step?: string; tool?: string; status?: string; detail?: string; durationMs?: number }>;
  nextQuestions?: string[];
  recommendedNextAction?: string;
  workflowAsset?: Partial<WorkflowAssetRecord>;
}

// ── ID generation ────────────────────────────────────────────────────

let _counter = 0;

export function createEnvelopeId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  _counter = (_counter + 1) % 10000;
  return `env_${ts}_${rand}_${_counter.toString(36)}`;
}

// ── Stable stringify (deterministic hashing) ─────────────────────────

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sorted.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(",")}}`;
}

export function hashContent(content: unknown): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 16);
}

function slugifyEnvelopeValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resolvePacketCanonicalEntity(packet: ResultPacketLike): string {
  if (typeof packet.canonicalEntity === "string" && packet.canonicalEntity.trim()) {
    return packet.canonicalEntity.trim();
  }
  if (packet.canonicalEntity && typeof packet.canonicalEntity === "object" && typeof packet.canonicalEntity.name === "string" && packet.canonicalEntity.name.trim()) {
    return packet.canonicalEntity.name.trim();
  }
  if (typeof packet.entityName === "string" && packet.entityName.trim()) {
    return packet.entityName.trim();
  }
  return "NodeBench";
}

function resolvePacketId(packet: ResultPacketLike): string {
  if (typeof packet.packetId === "string" && packet.packetId.trim()) {
    return packet.packetId.trim();
  }
  const canonicalEntity = resolvePacketCanonicalEntity(packet);
  const query = typeof packet.query === "string" ? packet.query : canonicalEntity;
  return `pkt-${slugifyEnvelopeValue(canonicalEntity)}-${hashContent({ query, answer: packet.answer ?? "", entity: canonicalEntity })}`;
}

export function createEnvelopeFromResultPacket(packet: ResultPacketLike): WorkflowEnvelope {
  const now = new Date().toISOString();
  const canonicalEntity = resolvePacketCanonicalEntity(packet);
  const canonicalPacketId = resolvePacketId(packet);
  const packetType = typeof packet.packetType === "string" && packet.packetType.trim() ? packet.packetType : "entity_packet";
  const sourceRefs: EnvelopeSourceRef[] = (packet.sourceRefs ?? []).map((source, index) => ({
    id: source.id ?? `src_${index + 1}`,
    label: source.label ?? source.title ?? source.href ?? `source-${index + 1}`,
    href: source.href,
    type: source.type ?? (source.href ? "web" : "doc"),
    confidence: source.confidence,
    domain: source.domain,
    siteName: source.siteName,
    faviconUrl: source.faviconUrl,
    thumbnailUrl: source.thumbnailUrl,
    imageCandidates: source.imageCandidates,
    publishedAt: source.publishedAt,
  }));
  const claims = (packet.claimRefs ?? [])
    .map((claim) => (typeof claim.text === "string" ? claim.text.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);
  const answerDerivedClaims = claims.length > 0
    ? claims
    : (packet.answerBlocks ?? [])
        .map((block) => (typeof block.text === "string" ? block.text.trim() : ""))
        .filter(Boolean)
        .slice(0, 12);
  const traceSteps = (packet.trace ?? []).map((step, index) => ({
    step: step.step ?? `packet_step_${index + 1}`,
    tool: step.tool,
    status: step.status ?? "ok",
    detail: step.detail,
    durationMs: step.durationMs,
  }));

  return {
    transport: {
      envelopeId: packet.workflowAsset?.envelopeId ?? createEnvelopeId(),
      envelopeType: "search_result",
      version: 1,
      createdAt: packet.workflowAsset?.generatedAt ?? now,
    },
    content: {
      subject: typeof packet.query === "string" && packet.query.trim() ? packet.query.trim() : canonicalEntity,
      entityName: canonicalEntity,
      summary: typeof packet.answer === "string" && packet.answer.trim() ? packet.answer.trim().slice(0, 500) : canonicalEntity,
      confidence: typeof packet.confidence === "number" ? packet.confidence : 0,
      classification: packet.classification,
      lens: packet.lens,
    },
    proof: {
      sourceRefs,
      claims: answerDerivedClaims,
      evidenceRefs: sourceRefs.map((source) => source.id),
      verificationRate: sourceRefs.length > 0
        ? sourceRefs.filter((source) => (source.confidence ?? 0) >= 65).length / sourceRefs.length
        : 0,
    },
    trace: {
      steps: traceSteps,
      totalDurationMs: traceSteps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0),
      toolsInvoked: Array.from(new Set(traceSteps.map((step) => step.tool).filter((tool): tool is string => Boolean(tool)))),
    },
    lineage: {
      parentIds: [],
      sourceRunId: packet.workflowAsset?.lineage?.sourceRunId ?? canonicalPacketId,
      sourceContextId: packet.workflowAsset?.lineage?.sourceContextId,
    },
    scope: {
      visibility: "internal",
      surface: "packet_engine",
    },
    payload: {
      packetId: canonicalPacketId,
      packetType,
      canonicalEntity,
      recommendedNextAction: packet.recommendedNextAction,
      nextQuestionCount: Array.isArray(packet.nextQuestions) ? packet.nextQuestions.length : 0,
    },
  };
}

export function buildWorkflowAssetFromEnvelope(
  packet: ResultPacketLike,
  envelope: WorkflowEnvelope,
  overrides: Partial<WorkflowAssetRecord> = {},
): WorkflowAssetRecord {
  const canonicalEntity = resolvePacketCanonicalEntity(packet);
  const canonicalPacketId = resolvePacketId(packet);
  const canonicalPacketType =
    typeof packet.packetType === "string" && packet.packetType.trim()
      ? packet.packetType
      : "entity_packet";
  const existing = packet.workflowAsset ?? {};
  const lineage = {
    sourceRunId: existing.lineage?.sourceRunId ?? envelope.lineage.sourceRunId ?? canonicalPacketId,
    sourceContextId: existing.lineage?.sourceContextId ?? envelope.lineage.sourceContextId,
    parentAssetId: existing.lineage?.parentAssetId,
    ...(overrides.lineage ?? {}),
  };

  return {
    assetId: existing.assetId ?? `asset:${slugifyEnvelopeValue(canonicalEntity)}:${canonicalPacketId}`,
    assetType: existing.assetType ?? "research_packet",
    state: existing.state ?? "generated",
    canonicalPacketId,
    canonicalPacketType,
    canonicalEntity,
    generatedAt: existing.generatedAt ?? envelope.transport.createdAt,
    stages: existing.stages?.length ? existing.stages : ["packetized_truth"],
    replayReady: existing.replayReady ?? envelope.trace.steps.length > 0,
    delegationReady:
      existing.delegationReady
      ?? Boolean(packet.recommendedNextAction || (Array.isArray(packet.nextQuestions) && packet.nextQuestions.length > 0)),
    currentContextId: existing.currentContextId,
    lastTaskId: existing.lastTaskId,
    targetAgents: existing.targetAgents?.length ? existing.targetAgents : ["claude_code", "openclaw"],
    envelopeId: existing.envelopeId ?? envelope.transport.envelopeId,
    envelopeType: existing.envelopeType ?? envelope.transport.envelopeType,
    ...overrides,
    lineage,
  };
}

// ── Factory: PipelineState → WorkflowEnvelope ────────────────────────

export function createEnvelopeFromPipelineState(
  state: PipelineState,
  packetId: string,
): WorkflowEnvelope {
  const now = new Date().toISOString();
  const sourceRefs: EnvelopeSourceRef[] = (state.searchSources ?? []).slice(0, 30).map((src, i) => ({
    id: `src_${i}`,
    label: src.name ?? src.url ?? `source-${i}`,
    href: src.url,
    type: "web" as const,
    confidence: src.relevanceScore,
    domain: src.domain,
    siteName: src.siteName,
    faviconUrl: src.faviconUrl,
    thumbnailUrl: src.thumbnailUrl,
    imageCandidates: src.imageCandidates,
  }));

  const claims: string[] = [];
  for (const sig of state.signals ?? []) {
    if (sig.name) claims.push(sig.name);
  }
  for (const metric of state.keyMetrics ?? []) {
    if (metric.label && metric.value) claims.push(`${metric.label}: ${metric.value}`);
  }

  const tools = new Set<string>();
  for (const t of state.trace ?? []) {
    if (t.tool) tools.add(t.tool);
  }

  const verified = sourceRefs.filter((s) => (s.confidence ?? 0) > 0.5).length;
  const total = sourceRefs.length;

  return {
    transport: {
      envelopeId: createEnvelopeId(),
      envelopeType: "search_result",
      version: 1,
      createdAt: now,
    },
    content: {
      subject: state.query,
      entityName: state.entityName || state.entity || undefined,
      summary: (state.answer ?? "").slice(0, 500),
      confidence: state.confidence ?? 0,
      classification: state.classification,
      lens: state.lens,
    },
    proof: {
      sourceRefs,
      claims: claims.slice(0, 20),
      evidenceRefs: sourceRefs.map((s) => s.id),
      verificationRate: total > 0 ? verified / total : 0,
    },
    trace: {
      steps: (state.trace ?? []).map((t) => ({
        step: t.step,
        tool: t.tool,
        status: t.status,
        detail: t.detail,
        durationMs: t.durationMs,
      })),
      totalDurationMs: state.totalDurationMs ?? 0,
      toolsInvoked: [...tools],
    },
    lineage: {
      parentIds: [],
      sourceRunId: packetId,
    },
    scope: {
      visibility: "internal",
    },
    payload: {
      packetId,
      pipelineType: "search_v2",
      entityName: state.entityName,
      confidence: state.confidence,
      signalCount: (state.signals ?? []).length,
      riskCount: (state.risks ?? []).length,
      hasDCF: !!state.dcf,
    },
  };
}

// ── Factory: SharedContextPacket shape → WorkflowEnvelope ────────────

export interface SharedContextPacketLike {
  contextId: string;
  contextType: string;
  producerPeerId: string;
  tenantId?: string | null;
  workspaceId?: string | null;
  subject: string;
  summary: string;
  claims?: string[];
  evidenceRefs?: string[];
  confidence?: number;
  lineage?: { parentContextIds?: string[]; sourceRunId?: string; sourceTraceId?: string; supersedes?: string };
  scope?: string[];
  permissions?: { visibility?: string };
  stateSnapshot?: Record<string, unknown>;
}

export function createEnvelopeFromSharedContext(packet: SharedContextPacketLike): WorkflowEnvelope {
  const now = new Date().toISOString();
  return {
    transport: {
      envelopeId: createEnvelopeId(),
      envelopeType: "context_handoff",
      version: 1,
      createdAt: now,
    },
    content: {
      subject: packet.subject,
      summary: packet.summary,
      confidence: packet.confidence ?? 0,
    },
    proof: {
      sourceRefs: [],
      claims: packet.claims ?? [],
      evidenceRefs: packet.evidenceRefs ?? [],
    },
    trace: {
      steps: [],
      totalDurationMs: 0,
      toolsInvoked: [],
    },
    lineage: {
      parentIds: packet.lineage?.parentContextIds ?? [],
      sourceRunId: packet.lineage?.sourceRunId,
      sourceContextId: packet.contextId,
      supersedes: packet.lineage?.supersedes,
    },
    scope: {
      tenantId: packet.tenantId ?? undefined,
      workspaceId: packet.workspaceId ?? undefined,
      visibility: (packet.permissions?.visibility as "internal" | "workspace" | "tenant") ?? "internal",
      surface: undefined,
    },
    payload: {
      contextId: packet.contextId,
      contextType: packet.contextType,
      producerPeerId: packet.producerPeerId,
      stateSnapshot: packet.stateSnapshot,
    },
  };
}

// ── Factory: FounderEpisode shape → WorkflowEnvelope ─────────────────

export interface FounderEpisodeLike {
  episodeId: string;
  correlationId: string;
  query?: string | null;
  lens?: string | null;
  entityName?: string | null;
  surface: string;
  status: string;
  packetId?: string | null;
  packetType?: string | null;
  contextId?: string | null;
  taskId?: string | null;
  stateBeforeHash?: string | null;
  stateAfterHash?: string | null;
  spans: Array<Record<string, unknown>>;
  traceStepCount?: number | null;
  toolsInvoked: string[];
  artifactsProduced: string[];
  summary?: string | null;
  workspaceId?: string | null;
  startedAt: string;
  completedAt?: string | null;
}

export function createEnvelopeFromEpisode(episode: FounderEpisodeLike): WorkflowEnvelope {
  const now = new Date().toISOString();
  const durationMs = episode.completedAt
    ? new Date(episode.completedAt).getTime() - new Date(episode.startedAt).getTime()
    : 0;

  const steps: EnvelopeTraceStep[] = episode.spans.map((span, i) => ({
    step: (span.toolName as string) ?? `span_${i}`,
    tool: (span.toolName as string) ?? undefined,
    status: (span.success as boolean) ? "ok" : "error",
    detail: (span.output as string)?.slice(0, 200),
    durationMs: (span.durationMs as number) ?? undefined,
    stateHashBefore: i === 0 ? (episode.stateBeforeHash ?? undefined) : undefined,
    stateHashAfter: i === episode.spans.length - 1 ? (episode.stateAfterHash ?? undefined) : undefined,
  }));

  return {
    transport: {
      envelopeId: createEnvelopeId(),
      envelopeType: "episode_trace",
      version: 1,
      createdAt: now,
    },
    content: {
      subject: episode.query ?? "unknown query",
      entityName: episode.entityName ?? undefined,
      summary: episode.summary ?? `Episode ${episode.episodeId}`,
      confidence: 0,
      lens: episode.lens ?? undefined,
    },
    proof: {
      sourceRefs: [],
      claims: [],
      evidenceRefs: episode.artifactsProduced,
    },
    trace: {
      steps,
      totalDurationMs: durationMs,
      toolsInvoked: episode.toolsInvoked,
    },
    lineage: {
      parentIds: [],
      sourceEpisodeId: episode.episodeId,
      sourceContextId: episode.contextId ?? undefined,
      correlationId: episode.correlationId,
    },
    scope: {
      workspaceId: episode.workspaceId ?? undefined,
      visibility: "internal",
      surface: episode.surface,
    },
    payload: {
      episodeId: episode.episodeId,
      status: episode.status,
      packetId: episode.packetId,
      packetType: episode.packetType,
      spanCount: episode.spans.length,
    },
  };
}

// ── Backward-compatible conversion to retention push-packet ──────────

export function envelopeToRetentionPacket(envelope: WorkflowEnvelope): {
  type: string;
  subject: string;
  summary: string;
  persona?: string;
  confidence: number;
  payload: unknown;
} {
  return {
    type: `delta.${envelope.transport.envelopeType}`,
    subject: envelope.content.subject,
    summary: envelope.content.summary,
    persona: envelope.content.lens,
    confidence: envelope.content.confidence,
    payload: {
      envelopeId: envelope.transport.envelopeId,
      entityName: envelope.content.entityName,
      sourceCount: envelope.proof.sourceRefs.length,
      claimCount: envelope.proof.claims.length,
      toolCount: envelope.trace.toolsInvoked.length,
      durationMs: envelope.trace.totalDurationMs,
    },
  };
}
