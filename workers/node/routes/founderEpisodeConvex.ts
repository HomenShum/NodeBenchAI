import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";

let _client: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  if (_client) return _client;
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL not set — cannot use Convex founder harness adapter");
  _client = new ConvexHttpClient(url);
  return _client;
}

export async function startFounderEpisodeConvex(input: {
  episodeId: string;
  correlationId: string;
  sessionKey?: string;
  workspaceId?: string;
  companyKey?: string;
  surface: "web" | "api" | "browser" | "claude_code" | "openclaw" | "local_runtime";
  episodeType: string;
  query?: string;
  lens?: string;
  entityName?: string;
  stateBefore?: unknown;
  stateBeforeHash?: string;
  metadata?: Record<string, unknown>;
  initialSpan?: Record<string, unknown>;
}) {
  return getConvexClient().mutation(api.domains.founder.founderHarnessOps.startEpisode, input as any);
}

export async function appendFounderEpisodeSpanConvex(input: {
  episodeId: string;
  span: Record<string, unknown>;
  contextId?: string;
  taskId?: string;
  entityName?: string;
  packetId?: string;
  packetType?: string;
  workspaceId?: string;
  companyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  return getConvexClient().mutation(api.domains.founder.founderHarnessOps.appendEpisodeSpan, input as any);
}

export async function finalizeFounderEpisodeConvex(input: {
  episodeId: string;
  status?: "completed" | "error" | "aborted";
  stateAfter?: unknown;
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
}) {
  return getConvexClient().mutation(api.domains.founder.founderHarnessOps.finalizeEpisode, input as any);
}

export async function getFounderEpisodeConvex(episodeId: string) {
  return getConvexClient().query(api.domains.founder.founderHarnessOps.getEpisode, { episodeId });
}

export async function listFounderEpisodesConvex(input: {
  sessionKey?: string;
  workspaceId?: string;
  status?: "active" | "completed" | "error" | "aborted";
  limit?: number;
}) {
  return getConvexClient().query(api.domains.founder.founderHarnessOps.listEpisodes, input);
}
