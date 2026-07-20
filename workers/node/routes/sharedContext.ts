import { Router } from "express";

import {
  buildSharedContextSubscriptionManifest,
  getSharedContextEventBus,
  getSharedContextPacket,
  getSharedContextPacketResource,
  getSharedContextScopedSnapshot,
  getSharedContextSnapshot,
  proposeSharedContextTask,
  publishSharedContextPacket,
  registerSharedContextPeer,
} from "../../packages/mcp-local/src/sync/store.js";
import {
  appendFounderEpisodeSpan,
  finalizeFounderEpisode,
  getFounderEpisode,
  listFounderEpisodes,
  startFounderEpisode,
} from "../../packages/mcp-local/src/sync/founderEpisodeStore.js";

import {
  appendFounderEpisodeSpanConvex,
  finalizeFounderEpisodeConvex,
  getFounderEpisodeConvex,
  getPacketConvex,
  listFounderEpisodesConvex,
  getSnapshotConvex,
  isConvexAvailable,
  proposeTaskConvex,
  publishPacketConvex,
  registerPeerConvex,
  startFounderEpisodeConvex,
} from "./sharedContextConvex.js";

/**
 * When running on Vercel with CONVEX_URL set, use Convex for durable persistence.
 * On local dev, continue using the fast SQLite path.
 */
const useConvex = (): boolean => !!(process.env.VERCEL && isConvexAvailable());

type SharedContextDelegateTarget = "claude_code" | "openclaw";

type IncomingResultPacket = {
  query?: string;
  entityName?: string;
  canonicalEntity?: string;
  answer?: string;
  confidence?: number;
  proofStatus?: string;
  packetId?: string;
  packetType?: string;
  sourceRefs?: Array<{
    id?: string;
    href?: string;
    label?: string;
    title?: string;
  }>;
  answerBlocks?: Array<{
    id?: string;
    text?: string;
    title?: string;
  }>;
  changes?: Array<{ description?: string }>;
  risks?: Array<{ title?: string; description?: string }>;
  interventions?: Array<{ action?: string }>;
  nextQuestions?: string[];
  recommendedNextAction?: string;
  strategicAngles?: Array<{
    id?: string;
    title?: string;
    status?: string;
    summary?: string;
    whyItMatters?: string;
    evidenceRefIds?: string[];
    nextQuestion?: string;
  }>;
  workflowAsset?: {
    assetId?: string;
    assetType?: string;
    state?: string;
    canonicalPacketId?: string;
    canonicalPacketType?: string;
    canonicalEntity?: string;
    generatedAt?: string;
    stages?: string[];
    replayReady?: boolean;
    delegationReady?: boolean;
    currentContextId?: string;
    lastTaskId?: string;
    targetAgents?: string[];
    envelopeId?: string;
    envelopeType?: string;
    lineage?: {
      sourceRunId?: string;
      sourceContextId?: string;
      parentAssetId?: string;
    };
  };
};

const WEB_PRODUCER_PEER_ID = "peer:web:control_plane";
const DELEGATE_TARGETS: Record<
  SharedContextDelegateTarget,
  { peerId: string; label: string; installCommand: string }
> = {
  claude_code: {
    peerId: "peer:delegate:claude_code",
    label: "Claude Code",
    installCommand: "claude mcp add nodebench -- npx -y nodebench-mcp",
  },
  openclaw: {
    peerId: "peer:delegate:openclaw",
    label: "OpenClaw",
    installCommand: "npx -y nodebench-mcp",
  },
};

type SnapshotFilters = {
  peerId?: string;
  workspaceId?: string;
  contextType?: string;
  producerPeerId?: string;
  scopeIncludes?: string;
  subjectIncludes?: string;
  taskType?: string;
  messageClass?: string;
  eventTypes?: string[];
};

type StrategicAngle = NonNullable<IncomingResultPacket["strategicAngles"]>[number];

type FounderEpisodeSurface = "web" | "api" | "browser" | "claude_code" | "openclaw" | "local_runtime";
type FounderEpisodeStatus = "active" | "completed" | "error" | "aborted";

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function parseSnapshotFilters(query: Record<string, unknown>): SnapshotFilters {
  const peerId = firstQueryValue(query.peerId);
  const workspaceId = firstQueryValue(query.workspaceId);
  const contextType = firstQueryValue(query.contextType);
  const producerPeerId = firstQueryValue(query.producerPeerId);
  const scopeIncludes = firstQueryValue(query.scopeIncludes);
  const subjectIncludes = firstQueryValue(query.subjectIncludes);
  const taskType = firstQueryValue(query.taskType);
  const messageClass = firstQueryValue(query.messageClass);
  const eventTypesRaw = firstQueryValue(query.eventTypes);
  return {
    peerId,
    workspaceId,
    contextType,
    producerPeerId,
    scopeIncludes,
    subjectIncludes,
    taskType,
    messageClass,
    eventTypes: eventTypesRaw
      ? eventTypesRaw.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined,
  };
}

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(firstQueryValue(value) ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), 50);
}

function normalizeEpisodeSurface(value: unknown): FounderEpisodeSurface {
  if (
    value === "web" ||
    value === "api" ||
    value === "browser" ||
    value === "claude_code" ||
    value === "openclaw" ||
    value === "local_runtime"
  ) {
    return value;
  }
  return "web";
}

function normalizeEpisodeStatus(value: unknown): FounderEpisodeStatus | undefined {
  if (value === "active" || value === "completed" || value === "error" || value === "aborted") {
    return value;
  }
  return undefined;
}

function filterSnapshot(snapshot: ReturnType<typeof getSharedContextSnapshot>, filters: SnapshotFilters) {
  const peers = filters.workspaceId
    ? snapshot.peers.filter((peer) => peer.workspaceId === filters.workspaceId)
    : snapshot.peers;
  const recentPackets = snapshot.recentPackets.filter((packet) => {
    if (filters.workspaceId && packet.workspaceId !== filters.workspaceId) return false;
    if (filters.contextType && packet.contextType !== filters.contextType) return false;
    if (filters.producerPeerId && packet.producerPeerId !== filters.producerPeerId) return false;
    if (filters.scopeIncludes && !packet.scope.includes(filters.scopeIncludes)) return false;
    if (filters.subjectIncludes && !packet.subject.toLowerCase().includes(filters.subjectIncludes.toLowerCase())) return false;
    return true;
  });
  const recentTasks = snapshot.recentTasks.filter((task) => {
    if (filters.taskType && task.taskType !== filters.taskType) return false;
    if (!filters.workspaceId) return true;
    return recentPackets.some((packet) => packet.contextId === task.outputContextId)
      || snapshot.peers.some((peer) => peer.peerId === task.proposerPeerId && peer.workspaceId === filters.workspaceId)
      || snapshot.peers.some((peer) => peer.peerId === task.assigneePeerId && peer.workspaceId === filters.workspaceId);
  });
  const recentMessages = snapshot.recentMessages.filter((message) => {
    if (filters.messageClass && message.messageClass !== filters.messageClass) return false;
    if (!filters.workspaceId) return true;
    return peers.some((peer) => peer.peerId === message.fromPeerId || peer.peerId === message.toPeerId);
  });

  return {
    peers,
    recentPackets,
    recentTasks,
    recentMessages,
    counts: {
      activePeers: peers.filter((peer) => peer.status === "active").length,
      activePackets: recentPackets.filter((packet) => packet.status === "active").length,
      invalidatedPackets: recentPackets.filter((packet) => packet.status === "invalidated").length,
      openTasks: recentTasks.filter((task) => task.status === "proposed" || task.status === "accepted").length,
      unreadMessages: recentMessages.filter((message) => message.status === "unread").length,
    },
  };
}

function eventMatchesFilters(event: Record<string, unknown>, filters: SnapshotFilters): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  if (filters.eventTypes && filters.eventTypes.length > 0 && !filters.eventTypes.includes(type)) {
    return false;
  }

  const payload = typeof event.payload === "object" && event.payload ? event.payload as Record<string, unknown> : {};
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : undefined;
  const contextType = typeof payload.contextType === "string" ? payload.contextType : undefined;
  const contextId = typeof payload.contextId === "string" ? payload.contextId : undefined;
  const producerPeerId = typeof payload.producerPeerId === "string" ? payload.producerPeerId : undefined;
  const taskType = typeof payload.taskType === "string" ? payload.taskType : undefined;
  const messageClass = typeof payload.messageClass === "string" ? payload.messageClass : undefined;

  if (filters.workspaceId && workspaceId && workspaceId !== filters.workspaceId) {
    return false;
  }
  if (filters.contextType && contextType && contextType !== filters.contextType) {
    return false;
  }
  if (filters.producerPeerId && producerPeerId && producerPeerId !== filters.producerPeerId) {
    return false;
  }
  if (filters.taskType && taskType && taskType !== filters.taskType) {
    return false;
  }
  if (filters.messageClass && messageClass && messageClass !== filters.messageClass) {
    return false;
  }
  if (filters.subjectIncludes && contextId && filters.peerId) {
    let packet = null;
    try {
      packet = getSharedContextPacket(contextId, filters.peerId);
    } catch {
      return false;
    }
    if (!packet || !packet.subject.toLowerCase().includes(filters.subjectIncludes.toLowerCase())) {
      return false;
    }
  } else if (filters.subjectIncludes && typeof payload.subject === "string") {
    if (!payload.subject.toLowerCase().includes(filters.subjectIncludes.toLowerCase())) return false;
  }

  if (filters.peerId && contextId) {
    let packet = null;
    try {
      packet = getSharedContextPacket(contextId, filters.peerId);
    } catch {
      return false;
    }
    if (!packet) return false;
    if (filters.scopeIncludes && !packet.scope.includes(filters.scopeIncludes)) {
      return false;
    }
  }

  return true;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function summarizePacket(packet: IncomingResultPacket): string {
  const answer = typeof packet.answer === "string" ? packet.answer.trim() : "";
  const change = packet.changes?.[0]?.description?.trim();
  const risk = packet.risks?.[0]?.title?.trim();
  const lines = [answer, change ? `Change: ${change}` : "", risk ? `Contradiction: ${risk}` : ""].filter(Boolean);
  return lines.join(" ").slice(0, 600);
}

function collectClaims(packet: IncomingResultPacket): string[] {
  const claims = [
    ...(packet.answerBlocks ?? []).map((block) => block.text ?? block.title ?? "").filter(Boolean),
    ...(packet.changes ?? []).map((change) => change.description ?? "").filter(Boolean),
    ...(packet.risks ?? []).map((risk) => risk.title ?? risk.description ?? "").filter(Boolean),
  ];
  return claims.slice(0, 12);
}

function collectEvidenceRefs(packet: IncomingResultPacket): string[] {
  const refs = (packet.sourceRefs ?? []).map((source) => source.href ?? source.id ?? source.label ?? source.title ?? "").filter(Boolean);
  return Array.from(new Set(refs)).slice(0, 12);
}

function getWorkspaceId(packet: IncomingResultPacket): string {
  const base = packet.canonicalEntity ?? packet.entityName ?? "nodebench";
  return `workspace:${slugify(base) || "nodebench"}`;
}

function getContextId(packet: IncomingResultPacket): string {
  return `context:${packet.packetId ?? slugify(`${packet.canonicalEntity ?? packet.entityName ?? "nodebench"}-${packet.query ?? "query"}`)}`;
}

function getTaskId(packet: IncomingResultPacket, target: SharedContextDelegateTarget): string {
  return `task:${target}:${packet.packetId ?? slugify(`${packet.canonicalEntity ?? packet.entityName ?? "nodebench"}-${packet.query ?? "query"}`)}`;
}

function getWorkflowAsset(packet: IncomingResultPacket) {
  const packetId = packet.packetId ?? slugify(`${packet.canonicalEntity ?? packet.entityName ?? "nodebench"}-${packet.query ?? "query"}`);
  const packetType = packet.packetType ?? "founder_packet";
  const canonicalEntity = packet.canonicalEntity ?? packet.entityName ?? "NodeBench";
  return {
    assetId: packet.workflowAsset?.assetId ?? `asset:${slugify(canonicalEntity)}:${packetId}`,
    assetType: packet.workflowAsset?.assetType ?? "research_packet",
    state: packet.workflowAsset?.state ?? "generated",
    canonicalPacketId: packet.workflowAsset?.canonicalPacketId ?? packetId,
    canonicalPacketType: packet.workflowAsset?.canonicalPacketType ?? packetType,
    canonicalEntity: packet.workflowAsset?.canonicalEntity ?? canonicalEntity,
    generatedAt: packet.workflowAsset?.generatedAt ?? new Date().toISOString(),
    stages: packet.workflowAsset?.stages?.length
      ? packet.workflowAsset.stages
      : ["ask_surface", "shared_context_ready"],
    replayReady: packet.workflowAsset?.replayReady ?? true,
    delegationReady: packet.workflowAsset?.delegationReady ?? Boolean(packet.recommendedNextAction),
    currentContextId: packet.workflowAsset?.currentContextId,
    lastTaskId: packet.workflowAsset?.lastTaskId,
    targetAgents: packet.workflowAsset?.targetAgents?.length
      ? packet.workflowAsset.targetAgents
      : ["claude_code", "openclaw"],
    envelopeId: packet.workflowAsset?.envelopeId,
    envelopeType: packet.workflowAsset?.envelopeType,
    lineage: {
      sourceRunId: packet.workflowAsset?.lineage?.sourceRunId ?? (typeof packet.packetId === "string" ? packet.packetId : undefined),
      sourceContextId: packet.workflowAsset?.lineage?.sourceContextId,
      parentAssetId: packet.workflowAsset?.lineage?.parentAssetId,
    },
  };
}

function withWorkflowAsset(
  packet: IncomingResultPacket,
  updates?: Partial<ReturnType<typeof getWorkflowAsset>>,
): IncomingResultPacket {
  const workflowAsset = {
    ...getWorkflowAsset(packet),
    ...updates,
    lineage: {
      ...getWorkflowAsset(packet).lineage,
      ...(updates?.lineage ?? {}),
    },
  };
  return {
    ...packet,
    packetId: packet.packetId ?? workflowAsset.canonicalPacketId,
    packetType: packet.packetType ?? workflowAsset.canonicalPacketType,
    canonicalEntity: packet.canonicalEntity ?? workflowAsset.canonicalEntity,
    workflowAsset,
  };
}

function getStrategicTaskId(
  packet: IncomingResultPacket,
  target: SharedContextDelegateTarget,
  angle: StrategicAngle,
): string {
  return `${getTaskId(packet, target)}:${slugify(angle.id ?? angle.title ?? "issue")}`;
}

function getSubject(packet: IncomingResultPacket): string {
  const entity = packet.canonicalEntity ?? packet.entityName ?? "NodeBench";
  return `${entity} shared context packet`;
}

function normalizeStrategicAngles(packet: IncomingResultPacket): StrategicAngle[] {
  return Array.isArray(packet.strategicAngles) ? packet.strategicAngles.filter(Boolean) : [];
}

function findStrategicAngle(packet: IncomingResultPacket, strategicAngleId?: string): StrategicAngle | null {
  if (!strategicAngleId) return null;
  return normalizeStrategicAngles(packet).find((angle) => angle.id === strategicAngleId) ?? null;
}

function getStrategicContextId(packet: IncomingResultPacket, angle: StrategicAngle): string {
  return `${getContextId(packet)}:issue:${slugify(angle.id ?? angle.title ?? "issue")}`;
}

function getStrategicSubject(packet: IncomingResultPacket, angle: StrategicAngle): string {
  const entity = packet.canonicalEntity ?? packet.entityName ?? "NodeBench";
  return `${entity} · ${angle.title ?? "Strategic issue"}`;
}

function getFreshness(packet: IncomingResultPacket) {
  const proofStatus = packet.proofStatus ?? "provisional";
  const trustTier =
    proofStatus === "verified" ? "verified" : proofStatus === "drifting" ? "directional" : "internal";
  return {
    status: proofStatus === "drifting" ? "warming" : "fresh",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    trustTier,
  };
}

function buildHandoffPrompt(args: {
  packet: IncomingResultPacket;
  contextId: string;
  taskId: string;
  target: SharedContextDelegateTarget;
  goal: string;
  subject?: string;
  parentContextId?: string | null;
}): string {
  const target = DELEGATE_TARGETS[args.target];
  const entity = args.packet.canonicalEntity ?? args.packet.entityName ?? "the company";
  const workspaceId = getWorkspaceId(args.packet);
  const subject = args.subject ?? getSubject(args.packet);
  const workflowAsset = getWorkflowAsset(args.packet);
  return [
    `Use NodeBench MCP as the truth layer for this task. You are the ${target.label} worker.`,
    "",
    `Goal: ${args.goal}`,
    `Workspace: ${workspaceId}`,
    `Shared context packet: ${args.contextId}`,
    `Workflow asset: ${workflowAsset.assetId}`,
    ...(args.parentContextId ? [`Parent packet: ${args.parentContextId}`] : []),
    `Shared task: ${args.taskId}`,
    "",
    "Workflow:",
    `1. Ensure NodeBench MCP is installed: ${target.installCommand}`,
    `2. Pull the packet with pull_shared_context using {"workspaceId":"${workspaceId}","subjectIncludes":"${subject}","limit":1}.`,
    "3. Use get_shared_context_snapshot if you need to inspect recent packets and task handoffs.",
    `4. Treat ${entity} as the canonical subject. Do not restate or re-infer the company from scratch unless the packet is contradicted.`,
    `5. Treat the workflow stages as the durable spine: ${workflowAsset.stages.join(" -> ")}.`,
    "6. Execute the requested implementation, keeping changes tied to the packet's next action and contradictions.",
    "7. When done, publish any updated packet or verdict back through NodeBench MCP so the shared truth stays current.",
  ].join("\n");
}

function registerWebPeer(packet: IncomingResultPacket) {
  const workflowAsset = getWorkflowAsset(packet);
  registerSharedContextPeer({
    peerId: WEB_PRODUCER_PEER_ID,
    product: "nodebench",
    workspaceId: getWorkspaceId(packet),
    surface: "web",
    role: "router",
    capabilities: ["can-publish-packet", "can-propose-task", "can-package-truth"],
    contextScopes: ["workspace", "entity", "packet"],
    summary: {
      currentTask: `Packaging ${packet.canonicalEntity ?? packet.entityName ?? "NodeBench"} for delegation`,
      focusEntity: packet.canonicalEntity ?? packet.entityName ?? "NodeBench",
      currentState: "packet_ready",
      confidence: typeof packet.confidence === "number" ? packet.confidence / 100 : undefined,
    },
    metadata: {
      packetId: packet.packetId ?? null,
      packetType: packet.packetType ?? null,
      workflowAssetId: workflowAsset.assetId,
      workflowAssetType: workflowAsset.assetType,
    },
    queueForSync: false,
  });
}

function registerDelegatePeer(packet: IncomingResultPacket, target: SharedContextDelegateTarget) {
  const mapping = DELEGATE_TARGETS[target];
  registerSharedContextPeer({
    peerId: mapping.peerId,
    product: "nodebench",
    workspaceId: getWorkspaceId(packet),
    surface: "api",
    role: "compiler",
    capabilities: ["can-build", "can-execute", "can-complete-task"],
    contextScopes: ["workspace", "entity", "packet"],
    status: "idle",
    summary: {
      currentTask: `Awaiting ${mapping.label} handoff`,
      focusEntity: packet.canonicalEntity ?? packet.entityName ?? "NodeBench",
      currentState: "waiting_for_packet",
    },
    metadata: {
      targetAgent: target,
      targetLabel: mapping.label,
    },
    queueForSync: false,
  });
}

function buildPacketResourceHints(contextId: string, packet: IncomingResultPacket, peerId?: string) {
  const resource = getSharedContextPacketResource(contextId, peerId);
  if (resource) {
    return {
      resourceUri: resource.resourceUri,
      pullQuery: resource.pullQuery,
      subscriptionQuery: resource.subscriptionQuery,
    };
  }
  return {
    resourceUri: `shared-context://packet/${encodeURIComponent(contextId)}`,
    pullQuery: {
      contextType: "entity_packet",
      producerPeerId: WEB_PRODUCER_PEER_ID,
      workspaceId: getWorkspaceId(packet),
      subjectIncludes: getSubject(packet),
    },
    subscriptionQuery: {
      peerId: peerId ?? undefined,
      workspaceId: getWorkspaceId(packet),
      contextType: "entity_packet",
      producerPeerId: WEB_PRODUCER_PEER_ID,
      subjectIncludes: getSubject(packet),
      eventTypes: ["packet_published", "packet_invalidated", "task_proposed", "task_status_changed"],
    },
  };
}

function buildSubscriptionManifestUrls(
  req: Request,
  filters: SnapshotFilters,
): {
  snapshotUrl: string;
  eventsUrl: string;
} {
  const params = new URLSearchParams();
  if (filters.peerId) params.set("peerId", filters.peerId);
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.contextType) params.set("contextType", filters.contextType);
  if (filters.producerPeerId) params.set("producerPeerId", filters.producerPeerId);
  if (filters.scopeIncludes) params.set("scopeIncludes", filters.scopeIncludes);
  if (filters.subjectIncludes) params.set("subjectIncludes", filters.subjectIncludes);
  if (filters.taskType) params.set("taskType", filters.taskType);
  if (filters.messageClass) params.set("messageClass", filters.messageClass);
  if (filters.eventTypes?.length) params.set("eventTypes", filters.eventTypes.join(","));
  params.set("limit", "10");
  const query = params.toString();
  const base = `${req.protocol}://${req.get("host")}/api/shared-context`;
  return {
    snapshotUrl: `${base}/snapshot?${query}`,
    eventsUrl: `${base}/events?${query}`,
  };
}

function buildStrategicIssuePayload(args: {
  packet: IncomingResultPacket;
  angle: StrategicAngle;
  target?: SharedContextDelegateTarget;
}): Parameters<typeof publishSharedContextPacket>[0] {
  const { packet, angle, target } = args;
  const entitySlug = slugify(packet.canonicalEntity ?? packet.entityName ?? "nodebench");
  const workspaceId = getWorkspaceId(packet);
  const parentContextId = getContextId(packet);
  const workflowAsset = getWorkflowAsset(packet);
  const matchedSourceRefs = (packet.sourceRefs ?? [])
    .filter((source) => (angle.evidenceRefIds ?? []).includes(String(source.id ?? "")))
    .map((source) => source.href ?? source.label ?? source.title ?? source.id ?? "")
    .filter(Boolean);

  return {
    contextId: getStrategicContextId(packet, angle),
    contextType: "issue_packet",
    producerPeerId: WEB_PRODUCER_PEER_ID,
    workspaceId,
    scope: [
      "workspace",
      `entity:${entitySlug}`,
      "pressure_test",
      `issue:${slugify(angle.id ?? angle.title ?? "issue")}`,
      ...(target ? [`delegate:${target}`] : []),
    ],
    subject: getStrategicSubject(packet, angle),
    summary: angle.summary ?? packet.recommendedNextAction ?? summarizePacket(packet),
    claims: [
      angle.summary ?? "",
      angle.whyItMatters ?? "",
      angle.nextQuestion ?? "",
    ].filter(Boolean),
    evidenceRefs: matchedSourceRefs.length > 0 ? matchedSourceRefs : collectEvidenceRefs(packet),
    stateSnapshot: {
      angle,
      parentPacketId: packet.packetId ?? null,
      parentContextId,
      packet,
    },
    freshness: getFreshness(packet),
    permissions: {
      visibility: "workspace",
      allowedRoles: ["researcher", "compiler", "judge", "router", "monitor"],
    },
    confidence:
      typeof packet.confidence === "number"
        ? Math.max(0, Math.min(1, packet.confidence / 100))
        : undefined,
    lineage: {
      parentContextIds: [parentContextId],
      sourceRunId: typeof packet.packetId === "string" ? packet.packetId : undefined,
    },
    nextActions: [
      angle.nextQuestion ?? "",
      packet.recommendedNextAction ?? "",
      ...(packet.nextQuestions ?? []).slice(0, 2),
    ].filter(Boolean).slice(0, 4),
    metadata: {
      packetId: packet.packetId ?? null,
      packetType: packet.packetType ?? null,
      workflowAssetId: workflowAsset.assetId,
      workflowAssetParentId: workflowAsset.assetId,
      proofStatus: packet.proofStatus ?? null,
      strategicAngleId: angle.id ?? null,
      strategicAngleStatus: angle.status ?? null,
      strategicAngleTitle: angle.title ?? null,
      targetAgent: target ?? null,
    },
    queueForSync: false,
  };
}

export function createSharedContextRouter(): Router {
  const router = Router();

  router.get("/episodes", async (req, res) => {
    const sessionKey = firstQueryValue(req.query.sessionKey);
    const workspaceId = firstQueryValue(req.query.workspaceId);
    const status = normalizeEpisodeStatus(firstQueryValue(req.query.status));
    const limit = positiveLimit(req.query.limit, 10);

    try {
      const episodes = useConvex()
        ? await listFounderEpisodesConvex({ sessionKey, workspaceId, status, limit })
        : listFounderEpisodes({ sessionKey, workspaceId, status, limit });

      return res.json({
        success: true,
        episodes,
        filters: { sessionKey, workspaceId, status: status ?? null, limit },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/episodes/:episodeId", async (req, res) => {
    try {
      const episode = useConvex()
        ? await getFounderEpisodeConvex(req.params.episodeId)
        : getFounderEpisode(req.params.episodeId);
      if (!episode) {
        return res.status(404).json({
          success: false,
          message: `Founder harness episode not found: ${req.params.episodeId}`,
        });
      }
      return res.json({ success: true, episode });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/episodes/start", async (req, res) => {
    const body = (req.body as {
      episodeId?: string;
      correlationId?: string;
      sessionKey?: string;
      workspaceId?: string;
      companyKey?: string;
      surface?: FounderEpisodeSurface;
      episodeType?: string;
      query?: string;
      lens?: string;
      entityName?: string;
      stateBefore?: Record<string, unknown>;
      stateBeforeHash?: string;
      metadata?: Record<string, unknown>;
      initialSpan?: Record<string, unknown>;
    }) ?? {};

    if (!body.query?.trim() && !body.entityName?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Founder harness episodes require a query or entityName.",
      });
    }

    try {
      const episode = useConvex()
        ? await startFounderEpisodeConvex({
            episodeId: body.episodeId ?? `episode:${Date.now()}`,
            correlationId: body.correlationId ?? `corr:${Date.now()}`,
            sessionKey: body.sessionKey,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            surface: normalizeEpisodeSurface(body.surface),
            episodeType: body.episodeType ?? "entity_search",
            query: body.query?.trim(),
            lens: body.lens?.trim(),
            entityName: body.entityName?.trim(),
            stateBefore: body.stateBefore,
            stateBeforeHash: body.stateBeforeHash,
            metadata: body.metadata,
            initialSpan: body.initialSpan,
          })
        : startFounderEpisode({
            episodeId: body.episodeId,
            correlationId: body.correlationId,
            sessionKey: body.sessionKey,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            surface: normalizeEpisodeSurface(body.surface),
            episodeType: body.episodeType ?? "entity_search",
            query: body.query?.trim(),
            lens: body.lens?.trim(),
            entityName: body.entityName?.trim(),
            stateBefore: body.stateBefore,
            stateBeforeHash: body.stateBeforeHash,
            metadata: body.metadata,
            initialSpan: body.initialSpan,
          });

      return res.json({ success: true, episode });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/episodes/:episodeId/span", async (req, res) => {
    const body = (req.body as {
      span?: Record<string, unknown>;
      contextId?: string;
      taskId?: string;
      entityName?: string;
      packetId?: string;
      packetType?: string;
      workspaceId?: string;
      companyKey?: string;
      metadata?: Record<string, unknown>;
    }) ?? {};

    if (!body.span) {
      return res.status(400).json({
        success: false,
        message: "Founder harness span payload is required.",
      });
    }

    try {
      const episode = useConvex()
        ? await appendFounderEpisodeSpanConvex({
            episodeId: req.params.episodeId,
            span: body.span,
            contextId: body.contextId,
            taskId: body.taskId,
            entityName: body.entityName,
            packetId: body.packetId,
            packetType: body.packetType,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            metadata: body.metadata,
          })
        : appendFounderEpisodeSpan({
            episodeId: req.params.episodeId,
            span: body.span,
            contextId: body.contextId,
            taskId: body.taskId,
            entityName: body.entityName,
            packetId: body.packetId,
            packetType: body.packetType,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            metadata: body.metadata,
          });

      return res.json({ success: true, episode });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/episodes/:episodeId/finalize", async (req, res) => {
    const body = (req.body as {
      status?: FounderEpisodeStatus;
      stateAfter?: Record<string, unknown>;
      stateAfterHash?: string;
      summary?: string;
      toolsInvoked?: string[];
      artifactsProduced?: string[];
      traceStepCount?: number;
      importantChangesDetected?: number;
      contradictionsDetected?: number;
      contextId?: string;
      taskId?: string;
      entityName?: string;
      packetId?: string;
      packetType?: string;
      workspaceId?: string;
      companyKey?: string;
      finalSpan?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }) ?? {};

    try {
      const episode = useConvex()
        ? await finalizeFounderEpisodeConvex({
            episodeId: req.params.episodeId,
            status: normalizeEpisodeStatus(body.status),
            stateAfter: body.stateAfter,
            stateAfterHash: body.stateAfterHash,
            summary: body.summary,
            toolsInvoked: body.toolsInvoked,
            artifactsProduced: body.artifactsProduced,
            traceStepCount: typeof body.traceStepCount === "number" ? body.traceStepCount : undefined,
            importantChangesDetected: typeof body.importantChangesDetected === "number" ? body.importantChangesDetected : undefined,
            contradictionsDetected: typeof body.contradictionsDetected === "number" ? body.contradictionsDetected : undefined,
            contextId: body.contextId,
            taskId: body.taskId,
            entityName: body.entityName,
            packetId: body.packetId,
            packetType: body.packetType,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            finalSpan: body.finalSpan,
            metadata: body.metadata,
          })
        : finalizeFounderEpisode({
            episodeId: req.params.episodeId,
            status: normalizeEpisodeStatus(body.status),
            stateAfter: body.stateAfter,
            stateAfterHash: body.stateAfterHash,
            summary: body.summary,
            toolsInvoked: body.toolsInvoked,
            artifactsProduced: body.artifactsProduced,
            traceStepCount: typeof body.traceStepCount === "number" ? body.traceStepCount : undefined,
            importantChangesDetected: typeof body.importantChangesDetected === "number" ? body.importantChangesDetected : undefined,
            contradictionsDetected: typeof body.contradictionsDetected === "number" ? body.contradictionsDetected : undefined,
            contextId: body.contextId,
            taskId: body.taskId,
            entityName: body.entityName,
            packetId: body.packetId,
            packetType: body.packetType,
            workspaceId: body.workspaceId,
            companyKey: body.companyKey,
            finalSpan: body.finalSpan,
            metadata: body.metadata,
          });

      return res.json({ success: true, episode });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/snapshot", async (req, res) => {
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : 10;
    const safeLim = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const filters = parseSnapshotFilters(req.query as Record<string, unknown>);

    if (useConvex()) {
      try {
        const snapshot = await getSnapshotConvex(safeLim, filters.peerId);
        return res.json({ success: true, snapshot, peerId: filters.peerId ?? null, filters });
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      return res.json({
        success: true,
        snapshot: getSharedContextScopedSnapshot({
          peerId: filters.peerId,
          workspaceId: filters.workspaceId,
          contextType: filters.contextType as any,
          producerPeerId: filters.producerPeerId,
          scopeIncludes: filters.scopeIncludes,
          subjectIncludes: filters.subjectIncludes,
          taskType: filters.taskType,
          messageClass: filters.messageClass as any,
          limit: safeLim,
        }),
        peerId: filters.peerId ?? null,
        filters,
      });
    } catch (error) {
      return res.status(403).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/peers/:peerId/snapshot", async (req, res) => {
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : 10;
    const safeLim = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const filters = parseSnapshotFilters(req.query as Record<string, unknown>);
    const peerId = req.params.peerId;

    try {
      if (useConvex()) {
        const snapshot = await getSnapshotConvex(safeLim, peerId);
        return res.json({
          success: true,
          snapshot: filterSnapshot(snapshot as ReturnType<typeof getSharedContextSnapshot>, {
            ...filters,
            peerId,
          }),
          peerId,
          filters: { ...filters, peerId },
        });
      }

      return res.json({
        success: true,
        snapshot: getSharedContextScopedSnapshot({
          peerId,
          workspaceId: filters.workspaceId,
          contextType: filters.contextType as any,
          producerPeerId: filters.producerPeerId,
          scopeIncludes: filters.scopeIncludes,
          subjectIncludes: filters.subjectIncludes,
          taskType: filters.taskType,
          messageClass: filters.messageClass as any,
          limit: safeLim,
        }),
        peerId,
        filters: { ...filters, peerId },
      });
    } catch (error) {
      return res.status(403).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/subscriptions/manifest", async (req, res) => {
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : 10;
    const safeLim = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const filters = parseSnapshotFilters(req.query as Record<string, unknown>);

    try {
      if (useConvex()) {
        const snapshot = filterSnapshot(
          await getSnapshotConvex(safeLim, filters.peerId),
          filters,
        );
        return res.json({
          success: true,
          manifest: {
            peerId: filters.peerId ?? null,
            snapshotQuery: {
              limit: safeLim,
              peerId: filters.peerId,
              workspaceId: filters.workspaceId,
              contextType: filters.contextType,
              producerPeerId: filters.producerPeerId,
              scopeIncludes: filters.scopeIncludes,
              subjectIncludes: filters.subjectIncludes,
              taskType: filters.taskType,
              messageClass: filters.messageClass,
            },
            pullQuery: {
              contextType: filters.contextType,
              producerPeerId: filters.producerPeerId,
              requestingPeerId: filters.peerId,
              workspaceId: filters.workspaceId,
              scopeIncludes: filters.scopeIncludes,
              subjectIncludes: filters.subjectIncludes,
              limit: safeLim,
            },
            subscriptionQuery: {
              peerId: filters.peerId,
              workspaceId: filters.workspaceId,
              contextType: filters.contextType,
              producerPeerId: filters.producerPeerId,
              scopeIncludes: filters.scopeIncludes,
              subjectIncludes: filters.subjectIncludes,
              taskType: filters.taskType,
              messageClass: filters.messageClass,
              eventTypes: filters.eventTypes ?? [
                "packet_published",
                "packet_invalidated",
                "packet_acknowledged",
                "task_proposed",
                "task_status_changed",
                "message_sent",
              ],
            },
            packetResources: snapshot.recentPackets.map((packet) => ({
              contextId: String(packet.contextId),
              contextType: String(packet.contextType),
              subject: String(packet.subject),
              resourceUri: `shared-context://packet/${encodeURIComponent(String(packet.contextId))}`,
            })),
          },
          urls: buildSubscriptionManifestUrls(req, filters),
        });
      }

      const manifest = buildSharedContextSubscriptionManifest({
        peerId: filters.peerId,
        workspaceId: filters.workspaceId,
        contextType: filters.contextType as any,
        producerPeerId: filters.producerPeerId,
        scopeIncludes: filters.scopeIncludes,
        subjectIncludes: filters.subjectIncludes,
        taskType: filters.taskType,
        messageClass: filters.messageClass as any,
        eventTypes: filters.eventTypes,
        limit: safeLim,
      });

      return res.json({
        success: true,
        manifest,
        urls: buildSubscriptionManifestUrls(req, filters),
      });
    } catch (error) {
      return res.status(403).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/packets/:contextId", async (req, res) => {
    const peerId = firstQueryValue(req.query.peerId);
    try {
      const packet = useConvex()
        ? await getPacketConvex(req.params.contextId)
        : getSharedContextPacket(req.params.contextId, peerId);
      if (!packet) {
        return res.status(404).json({
          success: false,
          message: "Shared context packet not found or not visible in the requested scope.",
        });
      }
      return res.json({
        success: true,
        packet,
        resourceUri: `shared-context://packet/${encodeURIComponent(packet.contextId)}`,
        pullQuery: {
          contextType: packet.contextType,
          producerPeerId: packet.producerPeerId,
          workspaceId: packet.workspaceId ?? undefined,
          tenantId: packet.tenantId ?? undefined,
          scopeIncludes: packet.scope.find((scope) => scope !== "workspace"),
          subjectIncludes: packet.subject,
        },
        subscriptionQuery: {
          peerId: peerId ?? undefined,
          workspaceId: packet.workspaceId ?? undefined,
          contextType: packet.contextType,
          producerPeerId: packet.producerPeerId,
          scopeIncludes: packet.scope.find((scope) => scope !== "workspace"),
          subjectIncludes: packet.subject,
          eventTypes: ["packet_published", "packet_invalidated", "packet_acknowledged", "task_proposed", "task_status_changed"],
        },
        peerId: peerId ?? null,
      });
    } catch (error) {
      return res.status(403).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/events", (req, res) => {
    const filters = parseSnapshotFilters(req.query as Record<string, unknown>);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeEvent = (event: Record<string, unknown>) => {
      res.write(`event: shared_context\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    writeEvent({
      type: "connected",
      timestamp: new Date().toISOString(),
      filters,
    });

    const heartbeat = setInterval(() => {
      writeEvent({
        type: "heartbeat",
        timestamp: new Date().toISOString(),
      });
    }, 15000);

    const bus = getSharedContextEventBus();
    const handler = (event: Record<string, unknown>) => {
      if (!eventMatchesFilters(event, filters)) return;
      writeEvent(event);
    };
    bus.on("shared_context", handler);

    res.on("close", () => {
      clearInterval(heartbeat);
      bus.off("shared_context", handler);
      res.end();
    });
  });

  router.post("/publish", async (req, res) => {
    const body = (req.body as { packet?: IncomingResultPacket; strategicAngleId?: string; episodeId?: string }) ?? {};
    const packet = body.packet ? withWorkflowAsset(body.packet) : undefined;

    if (!packet?.answer || !(packet.canonicalEntity ?? packet.entityName)) {
      return res.status(400).json({
        success: false,
        message: "A result packet with entityName/canonicalEntity and answer is required.",
      });
    }

    const contextId = getContextId(packet);
    const workspaceId = getWorkspaceId(packet);
    const strategicAngle = findStrategicAngle(packet, body.strategicAngleId);
    const publishedPacket = withWorkflowAsset(packet, {
      state: "published",
      currentContextId: contextId,
      stages: Array.from(new Set([...getWorkflowAsset(packet).stages, "shared_context_published"])),
      lineage: {
        sourceContextId: contextId,
      },
    });
    const packetPayload = {
      contextId,
      contextType: "entity_packet" as const,
      producerPeerId: WEB_PRODUCER_PEER_ID,
      workspaceId,
      scope: [
        "workspace",
        `entity:${slugify(packet.canonicalEntity ?? packet.entityName ?? "nodebench")}`,
        `packet:${packet.packetType ?? "founder_packet"}`,
      ],
      subject: getSubject(packet),
      summary: summarizePacket(publishedPacket),
      claims: collectClaims(publishedPacket),
      evidenceRefs: collectEvidenceRefs(publishedPacket),
      confidence:
        typeof publishedPacket.confidence === "number"
          ? Math.max(0, Math.min(1, publishedPacket.confidence / 100))
          : undefined,
      lineage: {
        sourceRunId: typeof publishedPacket.packetId === "string" ? publishedPacket.packetId : undefined,
      },
      freshness: getFreshness(publishedPacket),
    };

    try {
      if (useConvex()) {
        await registerPeerConvex({
          peerId: WEB_PRODUCER_PEER_ID,
          product: "nodebench",
          workspaceId,
          surface: "web",
          role: "router",
          capabilities: ["can-publish-packet", "can-propose-task", "can-package-truth"],
          contextScopes: ["workspace", "entity", "packet"],
        });
        await publishPacketConvex(packetPayload);
        let issueContextId: string | null = null;
        if (strategicAngle) {
          const issuePayload = buildStrategicIssuePayload({ packet: publishedPacket, angle: strategicAngle });
          issueContextId = issuePayload.contextId ?? null;
          await publishPacketConvex(issuePayload);
        }
        const snapshot = await getSnapshotConvex(6);
        if (body.episodeId) {
          await appendFounderEpisodeSpanConvex({
            episodeId: body.episodeId,
            span: {
              stage: "after",
              type: strategicAngle ? "strategic_issue_published" : "packet_published",
              status: "ok",
              label: strategicAngle ? "Published strategic issue packet" : "Published founder packet",
              detail: strategicAngle?.title ?? getSubject(publishedPacket),
              timestamp: new Date().toISOString(),
              contextId: strategicAngle ? issueContextId ?? contextId : contextId,
            },
            contextId: strategicAngle ? issueContextId ?? contextId : contextId,
            entityName: publishedPacket.canonicalEntity ?? publishedPacket.entityName,
            packetId: publishedPacket.packetId,
            packetType: publishedPacket.packetType,
            workspaceId,
            metadata: {
              publishedVia: "shared_context",
              strategicAngleId: strategicAngle?.id ?? null,
            },
          });
        }
        return res.json({
          success: true,
          contextId: strategicAngle ? issueContextId ?? contextId : contextId,
          parentContextId: strategicAngle ? contextId : null,
          workspaceId,
          strategicAngleId: strategicAngle?.id ?? null,
          workflowAsset: withWorkflowAsset(publishedPacket, {
            currentContextId: strategicAngle ? issueContextId ?? contextId : contextId,
            lineage: { sourceContextId: strategicAngle ? issueContextId ?? contextId : contextId },
          }).workflowAsset,
          resource: buildPacketResourceHints(strategicAngle ? issueContextId ?? contextId : contextId, publishedPacket),
          snapshot,
        });
      }

      registerWebPeer(publishedPacket);
      publishSharedContextPacket({
        ...packetPayload,
        stateSnapshot: publishedPacket as Record<string, unknown>,
        permissions: {
          visibility: "workspace",
          allowedRoles: ["researcher", "compiler", "judge", "router"],
        },
        nextActions: [
          ...(publishedPacket.interventions ?? []).map((item) => item.action ?? "").filter(Boolean),
          ...(publishedPacket.nextQuestions ?? []).slice(0, 3),
        ].slice(0, 6),
        metadata: {
          query: publishedPacket.query ?? null,
          packetId: publishedPacket.packetId ?? null,
          packetType: publishedPacket.packetType ?? null,
          proofStatus: publishedPacket.proofStatus ?? null,
          recommendedNextAction: publishedPacket.recommendedNextAction ?? null,
          workflowAssetId: publishedPacket.workflowAsset?.assetId ?? null,
          workflowAssetState: publishedPacket.workflowAsset?.state ?? null,
        },
        queueForSync: false,
      });
      let responseContextId = contextId;
      if (strategicAngle) {
        const issuePayload = buildStrategicIssuePayload({ packet: publishedPacket, angle: strategicAngle });
        publishSharedContextPacket(issuePayload);
        responseContextId = issuePayload.contextId ?? contextId;
      }

      if (body.episodeId) {
        appendFounderEpisodeSpan({
          episodeId: body.episodeId,
          span: {
            stage: "after",
            type: strategicAngle ? "strategic_issue_published" : "packet_published",
            status: "ok",
            label: strategicAngle ? "Published strategic issue packet" : "Published founder packet",
            detail: strategicAngle?.title ?? getSubject(publishedPacket),
            timestamp: new Date().toISOString(),
            contextId: responseContextId,
          },
          contextId: responseContextId,
          entityName: publishedPacket.canonicalEntity ?? publishedPacket.entityName,
          packetId: publishedPacket.packetId,
          packetType: publishedPacket.packetType,
          workspaceId,
          metadata: {
            publishedVia: "shared_context",
            strategicAngleId: strategicAngle?.id ?? null,
          },
        });
      }
      return res.json({
        success: true,
        contextId: responseContextId,
        parentContextId: strategicAngle ? contextId : null,
        workspaceId,
        strategicAngleId: strategicAngle?.id ?? null,
        workflowAsset: withWorkflowAsset(publishedPacket, {
          currentContextId: responseContextId,
          lineage: { sourceContextId: responseContextId },
        }).workflowAsset,
        resource: buildPacketResourceHints(responseContextId, publishedPacket),
        snapshot: getSharedContextSnapshot(6),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/delegate", async (req, res) => {
    const body = (req.body as {
      packet?: IncomingResultPacket;
      targetAgent?: SharedContextDelegateTarget;
      goal?: string;
      strategicAngleId?: string;
      episodeId?: string;
    }) ?? {};
    const packet = body.packet ? withWorkflowAsset(body.packet) : undefined;
    const target = body.targetAgent ?? "claude_code";

    if (!packet?.answer || !(packet.canonicalEntity ?? packet.entityName)) {
      return res.status(400).json({
        success: false,
        message: "A result packet with entityName/canonicalEntity and answer is required.",
      });
    }

    if (!(target in DELEGATE_TARGETS)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported targetAgent: ${String(target)}`,
      });
    }

    const contextId = getContextId(packet);
    const workspaceId = getWorkspaceId(packet);
    const strategicAngle = findStrategicAngle(packet, body.strategicAngleId);
    const delegateContextId = strategicAngle ? getStrategicContextId(packet, strategicAngle) : contextId;

    try {
      const delegatedPacket = withWorkflowAsset(packet, {
        state: "delegated",
        currentContextId: delegateContextId,
        stages: Array.from(new Set([...getWorkflowAsset(packet).stages, "shared_context_published", "delegation_prepared"])),
        targetAgents: Array.from(new Set([...(getWorkflowAsset(packet).targetAgents ?? []), target])),
        lineage: {
          sourceContextId: delegateContextId,
        },
      });
      if (useConvex()) {
        await registerPeerConvex({
          peerId: WEB_PRODUCER_PEER_ID,
          product: "nodebench",
          workspaceId,
          surface: "web",
          role: "router",
          capabilities: ["can-publish-packet", "can-propose-task", "can-package-truth"],
        });
        await registerPeerConvex({
          peerId: DELEGATE_TARGETS[target].peerId,
          product: "nodebench",
          workspaceId,
          surface: "api",
          role: "compiler",
          capabilities: ["can-build", "can-execute", "can-complete-task"],
        });
        await publishPacketConvex({
          contextId,
          contextType: "entity_packet",
          producerPeerId: WEB_PRODUCER_PEER_ID,
          workspaceId,
          scope: [
            "workspace",
            `entity:${slugify(delegatedPacket.canonicalEntity ?? delegatedPacket.entityName ?? "nodebench")}`,
            `delegate:${target}`,
          ],
          subject: getSubject(delegatedPacket),
          summary: summarizePacket(delegatedPacket),
          claims: collectClaims(delegatedPacket),
          evidenceRefs: collectEvidenceRefs(delegatedPacket),
          confidence:
            typeof delegatedPacket.confidence === "number"
              ? Math.max(0, Math.min(1, delegatedPacket.confidence / 100))
              : undefined,
          lineage: {
            sourceRunId: typeof delegatedPacket.packetId === "string" ? delegatedPacket.packetId : undefined,
          },
          freshness: getFreshness(delegatedPacket),
        });
        if (strategicAngle) {
          await publishPacketConvex(buildStrategicIssuePayload({ packet: delegatedPacket, angle: strategicAngle, target }));
        }
      } else {
        registerWebPeer(delegatedPacket);
        registerDelegatePeer(delegatedPacket, target);
        publishSharedContextPacket({
          contextId,
          contextType: "entity_packet",
          producerPeerId: WEB_PRODUCER_PEER_ID,
          workspaceId,
          scope: [
            "workspace",
            `entity:${slugify(delegatedPacket.canonicalEntity ?? delegatedPacket.entityName ?? "nodebench")}`,
            `packet:${delegatedPacket.packetType ?? "founder_packet"}`,
            `delegate:${target}`,
          ],
          subject: getSubject(delegatedPacket),
          summary: summarizePacket(delegatedPacket),
          claims: collectClaims(delegatedPacket),
          evidenceRefs: collectEvidenceRefs(delegatedPacket),
          stateSnapshot: delegatedPacket as Record<string, unknown>,
          freshness: getFreshness(delegatedPacket),
          permissions: {
            visibility: "workspace",
            allowedRoles: ["researcher", "compiler", "judge", "router"],
          },
          confidence:
            typeof delegatedPacket.confidence === "number"
              ? Math.max(0, Math.min(1, delegatedPacket.confidence / 100))
              : undefined,
          lineage: {
            sourceRunId: typeof delegatedPacket.packetId === "string" ? delegatedPacket.packetId : undefined,
          },
          nextActions: [
            ...(delegatedPacket.interventions ?? []).map((item) => item.action ?? "").filter(Boolean),
            ...(delegatedPacket.nextQuestions ?? []).slice(0, 3),
          ].slice(0, 6),
          metadata: {
            query: delegatedPacket.query ?? null,
            packetId: delegatedPacket.packetId ?? null,
            packetType: delegatedPacket.packetType ?? null,
            proofStatus: delegatedPacket.proofStatus ?? null,
            recommendedNextAction: delegatedPacket.recommendedNextAction ?? null,
            targetAgent: target,
            workflowAssetId: delegatedPacket.workflowAsset?.assetId ?? null,
            workflowAssetState: delegatedPacket.workflowAsset?.state ?? null,
          },
          queueForSync: false,
        });
        if (strategicAngle) {
          publishSharedContextPacket(buildStrategicIssuePayload({ packet: delegatedPacket, angle: strategicAngle, target }));
        }
      }

      const goal =
        body.goal?.trim() ||
        strategicAngle?.nextQuestion?.trim() ||
        strategicAngle?.summary?.trim() ||
        delegatedPacket.recommendedNextAction?.trim() ||
        delegatedPacket.nextQuestions?.[0]?.trim() ||
        "Continue implementation from the published NodeBench packet.";

      const taskId = strategicAngle ? getStrategicTaskId(delegatedPacket, target, strategicAngle) : getTaskId(delegatedPacket, target);
      const delegatedWorkflowAsset = withWorkflowAsset(delegatedPacket, {
        lastTaskId: taskId,
        currentContextId: delegateContextId,
        targetAgents: Array.from(new Set([...(delegatedPacket.workflowAsset?.targetAgents ?? []), target])),
        stages: Array.from(new Set([...(delegatedPacket.workflowAsset?.stages ?? []), "delegation_handoff_created"])),
      }).workflowAsset;

      if (useConvex()) {
        await proposeTaskConvex({
          taskId,
          taskType: strategicAngle ? "strategic_angle_handoff" : "agent_handoff",
          proposerPeerId: WEB_PRODUCER_PEER_ID,
          assigneePeerId: DELEGATE_TARGETS[target].peerId,
          taskSpec: {
            targetAgent: target,
            targetLabel: DELEGATE_TARGETS[target].label,
            goal,
            installCommand: DELEGATE_TARGETS[target].installCommand,
            proofStatus: delegatedPacket.proofStatus ?? null,
            strategicAngleId: strategicAngle?.id ?? null,
            strategicAngleTitle: strategicAngle?.title ?? null,
            workflowAssetId: delegatedWorkflowAsset.assetId,
          },
          inputContextIds: strategicAngle ? [contextId, delegateContextId] : [contextId],
          reason: goal,
        });
        const snapshot = await getSnapshotConvex(6);
        if (body.episodeId) {
          await appendFounderEpisodeSpanConvex({
            episodeId: body.episodeId,
            span: {
              stage: "after",
              type: strategicAngle ? "strategic_issue_delegated" : "agent_delegated",
              status: "ok",
              label: strategicAngle ? `Delegated issue to ${DELEGATE_TARGETS[target].label}` : `Delegated to ${DELEGATE_TARGETS[target].label}`,
              detail: goal,
              timestamp: new Date().toISOString(),
              contextId: delegateContextId,
              taskId,
            },
            contextId: delegateContextId,
            taskId,
            entityName: delegatedPacket.canonicalEntity ?? delegatedPacket.entityName,
            packetId: delegatedPacket.packetId,
            packetType: delegatedPacket.packetType,
            workspaceId,
            metadata: {
              targetAgent: target,
              strategicAngleId: strategicAngle?.id ?? null,
              workflowAssetId: delegatedWorkflowAsset.assetId,
            },
          });
        }
        return res.json({
          success: true,
          contextId: delegateContextId,
          parentContextId: strategicAngle ? contextId : null,
          taskId,
          workspaceId,
          strategicAngleId: strategicAngle?.id ?? null,
          targetAgent: target,
          targetLabel: DELEGATE_TARGETS[target].label,
          installCommand: DELEGATE_TARGETS[target].installCommand,
          workflowAsset: delegatedWorkflowAsset,
          handoffPrompt: buildHandoffPrompt({
            packet: { ...delegatedPacket, workflowAsset: delegatedWorkflowAsset },
            contextId: delegateContextId,
            parentContextId: strategicAngle ? contextId : null,
            taskId,
            target,
            goal,
            subject: strategicAngle ? getStrategicSubject(delegatedPacket, strategicAngle) : getSubject(delegatedPacket),
          }),
          resource: buildPacketResourceHints(delegateContextId, delegatedPacket),
          snapshot,
        });
      }

      const proposed = proposeSharedContextTask({
        taskId,
        taskType: strategicAngle ? "strategic_angle_handoff" : "agent_handoff",
        proposerPeerId: WEB_PRODUCER_PEER_ID,
        assigneePeerId: DELEGATE_TARGETS[target].peerId,
        taskSpec: {
          targetAgent: target,
          targetLabel: DELEGATE_TARGETS[target].label,
          goal,
          installCommand: DELEGATE_TARGETS[target].installCommand,
          proofStatus: delegatedPacket.proofStatus ?? null,
          strategicAngleId: strategicAngle?.id ?? null,
          strategicAngleTitle: strategicAngle?.title ?? null,
          workflowAssetId: delegatedWorkflowAsset.assetId,
        },
        inputContextIds: strategicAngle ? [contextId, delegateContextId] : [contextId],
        reason: goal,
        metadata: {
          entityName: delegatedPacket.canonicalEntity ?? delegatedPacket.entityName ?? "NodeBench",
          query: delegatedPacket.query ?? null,
          strategicAngleId: strategicAngle?.id ?? null,
          strategicAngleTitle: strategicAngle?.title ?? null,
          workflowAssetId: delegatedWorkflowAsset.assetId,
        },
        queueForSync: false,
      });

      if (body.episodeId) {
        appendFounderEpisodeSpan({
          episodeId: body.episodeId,
          span: {
            stage: "after",
            type: strategicAngle ? "strategic_issue_delegated" : "agent_delegated",
            status: "ok",
            label: strategicAngle ? `Delegated issue to ${DELEGATE_TARGETS[target].label}` : `Delegated to ${DELEGATE_TARGETS[target].label}`,
            detail: goal,
            timestamp: new Date().toISOString(),
            contextId: delegateContextId,
            taskId: proposed.taskId,
          },
          contextId: delegateContextId,
          taskId: proposed.taskId,
          entityName: delegatedPacket.canonicalEntity ?? delegatedPacket.entityName,
          packetId: delegatedPacket.packetId,
          packetType: delegatedPacket.packetType,
          workspaceId,
          metadata: {
            targetAgent: target,
            strategicAngleId: strategicAngle?.id ?? null,
            workflowAssetId: delegatedWorkflowAsset.assetId,
          },
        });
      }
      return res.json({
        success: true,
        contextId: delegateContextId,
        parentContextId: strategicAngle ? contextId : null,
        taskId: proposed.taskId,
        workspaceId,
        strategicAngleId: strategicAngle?.id ?? null,
        targetAgent: target,
        targetLabel: DELEGATE_TARGETS[target].label,
        installCommand: DELEGATE_TARGETS[target].installCommand,
        workflowAsset: delegatedWorkflowAsset,
        handoffPrompt: buildHandoffPrompt({
          packet: { ...delegatedPacket, workflowAsset: delegatedWorkflowAsset },
          contextId: delegateContextId,
          parentContextId: strategicAngle ? contextId : null,
          taskId: proposed.taskId,
          target,
          goal,
          subject: strategicAngle ? getStrategicSubject(delegatedPacket, strategicAngle) : getSubject(delegatedPacket),
        }),
        resource: buildPacketResourceHints(delegateContextId, delegatedPacket),
        snapshot: getSharedContextSnapshot(6),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ── Room-scoped peer + message registry (in-memory, bounded) ──────
  // Peers and messages are stored per room code. Max 50 peers, 200 messages per room.
  // Rooms auto-expire after 24 hours of inactivity.
  const MAX_PEERS_PER_ROOM = 50;
  const MAX_MESSAGES_PER_ROOM = 200;
  const MAX_ROOMS = 100;
  const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

  type RoomPeer = { peerId: string; name: string; roles: string[]; lastSeen: string; room: string };
  type RoomMessage = { id: string; fromPeerId: string; toPeerId: string; content: string; timestamp: string; messageType: string; room: string };
  type Room = { code: string; peers: Map<string, RoomPeer>; messages: RoomMessage[]; lastActivity: number };

  const rooms = new Map<string, Room>();

  function getOrCreateRoom(code: string): Room {
    // Evict oldest room if at capacity
    if (!rooms.has(code) && rooms.size >= MAX_ROOMS) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [k, r] of rooms) {
        if (r.lastActivity < oldestTime) { oldest = k; oldestTime = r.lastActivity; }
      }
      if (oldest) rooms.delete(oldest);
    }
    if (!rooms.has(code)) {
      rooms.set(code, { code, peers: new Map(), messages: [], lastActivity: Date.now() });
    }
    const room = rooms.get(code)!;
    room.lastActivity = Date.now();
    return room;
  }

  // Clean expired rooms periodically
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
    }
  }, 60_000);

  // ── GET /room/:code — get peers + messages for a room ────────────
  router.get("/room/:code", (req, res) => {
    const code = (req.params.code ?? "").toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "Room code required." });

    const room = rooms.get(code);
    if (!room) {
      return res.json({
        success: true,
        room: code,
        peers: [],
        messages: [],
      });
    }

    return res.json({
      success: true,
      room: code,
      peers: Array.from(room.peers.values()),
      messages: room.messages.slice(-100), // Last 100 messages
    });
  });

  // ── POST /message — peer-to-peer messaging with room registration ──
  router.post("/message", async (req, res) => {
    try {
      const { fromPeerId, toPeerId, content, messageType, room: roomCode, fromName, fromRoles } = req.body ?? {};
      if (!fromPeerId || !toPeerId || !content) {
        return res.status(400).json({
          success: false,
          message: "fromPeerId, toPeerId, and content are required.",
        });
      }

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      // Register sender peer in room (if room code provided)
      if (roomCode) {
        const room = getOrCreateRoom(String(roomCode).toUpperCase());

        // Register/update sender peer
        if (room.peers.size < MAX_PEERS_PER_ROOM || room.peers.has(fromPeerId)) {
          room.peers.set(fromPeerId, {
            peerId: fromPeerId,
            name: fromName ?? fromPeerId.split(":").pop()?.replaceAll("_", " ") ?? fromPeerId,
            roles: fromRoles ?? ["builder"],
            lastSeen: now,
            room: room.code,
          });
        }

        // Store message in room (bounded)
        room.messages.push({
          id: messageId,
          fromPeerId,
          toPeerId,
          content,
          timestamp: now,
          messageType: messageType ?? "request",
          room: room.code,
        });
        if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
          room.messages.splice(0, room.messages.length - MAX_MESSAGES_PER_ROOM);
        }
      }

      // Also register in shared context store
      registerSharedContextPeer({
        peerId: fromPeerId,
        product: "nodebench",
        surface: "local_runtime",
        role: "runner",
        capabilities: ["send-message"],
        summary: {},
      });

      // Emit SSE event
      const bus = getSharedContextEventBus();
      bus.emit("shared_context", {
        type: "message_sent",
        timestamp: now,
        payload: { messageId, fromPeerId, toPeerId, room: roomCode, subject: content.slice(0, 80) },
      });

      return res.json({
        success: true,
        messageId,
        fromPeerId,
        toPeerId,
        timestamp: now,
      });
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  return router;
}
