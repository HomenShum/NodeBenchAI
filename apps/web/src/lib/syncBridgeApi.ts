function resolveSyncBridgeApiBase(): string {
  return "/api/sync-bridge";
}

export const SYNC_BRIDGE_API_BASE = resolveSyncBridgeApiBase();

export function getSyncBridgeHealthUrl(): string {
  return `${SYNC_BRIDGE_API_BASE}/health`;
}

export function getSyncBridgeAccountUrl(userId: string): string {
  return `${SYNC_BRIDGE_API_BASE}/accounts/${encodeURIComponent(userId)}`;
}

export function getSyncBridgePairingUrl(): string {
  return `${SYNC_BRIDGE_API_BASE}/dev/pairings`;
}

export function getSyncBridgeWebSocketUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/sync-bridge";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/sync-bridge`;
}

function resolveSharedContextApiBase(): string {
  return "/api/shared-context";
}

export const SHARED_CONTEXT_API_BASE = resolveSharedContextApiBase();

function resolveSubconsciousApiBase(): string {
  return "/api/subconscious";
}

export const SUBCONSCIOUS_API_BASE = resolveSubconsciousApiBase();

type SharedContextQueryOptions = {
  limit?: number;
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

function buildSharedContextQuery(options: SharedContextQueryOptions = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 10));
  if (options.peerId) params.set("peerId", options.peerId);
  if (options.workspaceId) params.set("workspaceId", options.workspaceId);
  if (options.contextType) params.set("contextType", options.contextType);
  if (options.producerPeerId) params.set("producerPeerId", options.producerPeerId);
  if (options.scopeIncludes) params.set("scopeIncludes", options.scopeIncludes);
  if (options.subjectIncludes) params.set("subjectIncludes", options.subjectIncludes);
  if (options.taskType) params.set("taskType", options.taskType);
  if (options.messageClass) params.set("messageClass", options.messageClass);
  if (options.eventTypes && options.eventTypes.length > 0) {
    params.set("eventTypes", options.eventTypes.join(","));
  }
  return params.toString();
}

export function getSharedContextSnapshotUrl(options: number | SharedContextQueryOptions = 10): string {
  const normalized = typeof options === "number" ? { limit: options } : options;
  return `${SHARED_CONTEXT_API_BASE}/snapshot?${buildSharedContextQuery(normalized)}`;
}

export function getSharedContextEventsUrl(options: SharedContextQueryOptions = {}): string {
  return `${SHARED_CONTEXT_API_BASE}/events?${buildSharedContextQuery(options)}`;
}

export function getSharedContextPacketUrl(contextId: string, peerId?: string): string {
  const params = new URLSearchParams();
  if (peerId) params.set("peerId", peerId);
  const suffix = params.toString();
  return `${SHARED_CONTEXT_API_BASE}/packets/${encodeURIComponent(contextId)}${suffix ? `?${suffix}` : ""}`;
}

export function getSharedContextPeerSnapshotUrl(peerId: string, options: SharedContextQueryOptions = {}): string {
  return `${SHARED_CONTEXT_API_BASE}/peers/${encodeURIComponent(peerId)}/snapshot?${buildSharedContextQuery(options)}`;
}

export function getSharedContextSubscriptionManifestUrl(options: SharedContextQueryOptions = {}): string {
  return `${SHARED_CONTEXT_API_BASE}/subscriptions/manifest?${buildSharedContextQuery(options)}`;
}

export function getSharedContextPublishUrl(): string {
  return `${SHARED_CONTEXT_API_BASE}/publish`;
}

export function getSharedContextDelegateUrl(): string {
  return `${SHARED_CONTEXT_API_BASE}/delegate`;
}

export function getSubconsciousWhisperUrl(): string {
  return `${SUBCONSCIOUS_API_BASE}/whisper`;
}

export function getFounderEpisodesUrl(options: { sessionKey?: string; workspaceId?: string; status?: string; limit?: number } = {}): string {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 10));
  if (options.sessionKey) params.set("sessionKey", options.sessionKey);
  if (options.workspaceId) params.set("workspaceId", options.workspaceId);
  if (options.status) params.set("status", options.status);
  return `${SHARED_CONTEXT_API_BASE}/episodes?${params.toString()}`;
}

export function getFounderEpisodeUrl(episodeId: string): string {
  return `${SHARED_CONTEXT_API_BASE}/episodes/${encodeURIComponent(episodeId)}`;
}

export function getFounderEpisodeStartUrl(): string {
  return `${SHARED_CONTEXT_API_BASE}/episodes/start`;
}

export function getFounderEpisodeSpanUrl(episodeId: string): string {
  return `${SHARED_CONTEXT_API_BASE}/episodes/${encodeURIComponent(episodeId)}/span`;
}

export function getFounderEpisodeFinalizeUrl(episodeId: string): string {
  return `${SHARED_CONTEXT_API_BASE}/episodes/${encodeURIComponent(episodeId)}/finalize`;
}
