/**
 * Convex-backed shared context adapter for Vercel serverless.
 *
 * When CONVEX_URL is set, route handlers call Convex mutations/queries instead
 * of local SQLite so packets, peers, and tasks survive across function invocations.
 *
 * The adapter exposes the same function signatures as the local store so the
 * sharedContext route can swap transparently.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import {
  appendFounderEpisodeSpanConvex as appendFounderEpisodeSpanConvexImpl,
  finalizeFounderEpisodeConvex as finalizeFounderEpisodeConvexImpl,
  getFounderEpisodeConvex as getFounderEpisodeConvexImpl,
  listFounderEpisodesConvex as listFounderEpisodesConvexImpl,
  startFounderEpisodeConvex as startFounderEpisodeConvexImpl,
} from "./founderEpisodeConvex.js";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  if (_client) return _client;
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL not set — cannot use Convex adapter");
  _client = new ConvexHttpClient(url);
  return _client;
}

export function isConvexAvailable(): boolean {
  return !!(process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL);
}

// ---------------------------------------------------------------------------
// Peers
// ---------------------------------------------------------------------------

export async function registerPeerConvex(input: {
  peerId: string;
  product?: string;
  workspaceId?: string;
  surface?: string;
  role?: string;
  capabilities?: string[];
  contextScopes?: string[];
  summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<{ peerId: string }> {
  const client = getConvexClient();
  await client.mutation(api.domains.founder.sharedContextOps.registerPeer, {
    peerId: input.peerId,
    product: (input.product as "nodebench" | "ta_studio") ?? "nodebench",
    workspaceId: input.workspaceId,
    surface: (input.surface as "web" | "api" | "browser" | "runner" | "evaluator" | "packet_engine" | "qa_runner" | "monitor" | "local_runtime") ?? "web",
    role: (input.role as "researcher" | "compiler" | "judge" | "explorer" | "replay" | "environment_builder" | "runner" | "observer" | "monitor" | "router") ?? "router",
    capabilities: input.capabilities,
    contextScopes: input.contextScopes,
    summary: input.summary as any,
  });
  return { peerId: input.peerId };
}

// ---------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------

export async function publishPacketConvex(input: {
  contextId: string;
  contextType: string;
  producerPeerId: string;
  workspaceId?: string;
  scope?: string[];
  subject: string;
  summary: string;
  claims?: string[];
  evidenceRefs?: string[];
  confidence?: number;
  lineage?: Record<string, unknown>;
  freshness?: Record<string, unknown>;
  nextActions?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ contextId: string }> {
  const client = getConvexClient();
  await client.mutation(api.domains.founder.sharedContextOps.publishPacket, {
    contextId: input.contextId,
    contextType: input.contextType as any,
    producerPeerId: input.producerPeerId,
    workspaceId: input.workspaceId,
    scope: input.scope,
    subject: input.subject,
    summary: input.summary,
    claims: input.claims,
    evidenceRefs: input.evidenceRefs,
    confidence: input.confidence,
    lineage: input.lineage as any,
    freshness: input.freshness as any,
  });
  return { contextId: input.contextId };
}

export async function getPacketConvex(contextId: string): Promise<Record<string, unknown> | null> {
  const client = getConvexClient();
  return client.query(api.domains.founder.sharedContextOps.getPacket, { contextId });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function proposeTaskConvex(input: {
  taskId: string;
  taskType?: string;
  proposerPeerId: string;
  assigneePeerId: string;
  taskSpec?: Record<string, unknown>;
  inputContextIds?: string[];
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ taskId: string }> {
  const client = getConvexClient();
  await client.mutation(api.domains.founder.sharedContextOps.proposeTask, {
    taskId: input.taskId,
    taskType: input.taskType ?? "agent_handoff",
    proposerPeerId: input.proposerPeerId,
    assigneePeerId: input.assigneePeerId,
    taskSpec: input.taskSpec,
    inputContextIds: input.inputContextIds,
    description: input.reason,
  });
  return { taskId: input.taskId };
}

// ---------------------------------------------------------------------------
// Snapshot (composite query)
// ---------------------------------------------------------------------------

export async function getSnapshotConvex(
  limit = 10,
  _requestingPeerId?: string,
): Promise<{
  peers: Array<Record<string, unknown>>;
  recentPackets: Array<Record<string, unknown>>;
  recentTasks: Array<Record<string, unknown>>;
  recentMessages: Array<Record<string, unknown>>;
}> {
  const client = getConvexClient();

  const [peers, packets, tasks, messages] = await Promise.all([
    client.query(api.domains.founder.sharedContextOps.listPeers, { limit }),
    client.query(api.domains.founder.sharedContextOps.listPackets, { limit }),
    client.query(api.domains.founder.sharedContextOps.listTasks, { limit }),
    client.query(api.domains.founder.sharedContextOps.listMessages, { limit }),
  ]);

  return {
    peers: peers as Array<Record<string, unknown>>,
    recentPackets: packets as Array<Record<string, unknown>>,
    recentTasks: tasks as Array<Record<string, unknown>>,
    recentMessages: messages as Array<Record<string, unknown>>,
  };
}

// ── Founder Episode stubs (Convex persistence not yet wired) ─────────────

export const startFounderEpisodeConvex = startFounderEpisodeConvexImpl;

export const appendFounderEpisodeSpanConvex = appendFounderEpisodeSpanConvexImpl;

export const finalizeFounderEpisodeConvex = finalizeFounderEpisodeConvexImpl;

export const getFounderEpisodeConvex = getFounderEpisodeConvexImpl;

export const listFounderEpisodesConvex = listFounderEpisodesConvexImpl;
