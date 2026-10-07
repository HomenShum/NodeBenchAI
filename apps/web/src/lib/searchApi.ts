function resolveHeadlessApiBase(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const { hostname, protocol, port } = window.location;
  const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost";
  const isFrontendPort = Boolean(port) && port !== "8020";

  if (isLocalHost && isFrontendPort) {
    return `${protocol}//${hostname}:8020`;
  }

  return null;
}

function resolvePublicSearchApiBase(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const explicitBase = import.meta.env.VITE_PUBLIC_SEARCH_API_BASE;
  if (typeof explicitBase === "string" && explicitBase.trim().length > 0) {
    return explicitBase.replace(/\/$/, "");
  }

  const { hostname, protocol, port } = window.location;
  const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost";
  const isFrontendPort = Boolean(port) && port !== "3100" && port !== "8020";

  if (isLocalHost && isFrontendPort) {
    return `${protocol}//${hostname}:3100/search`;
  }

  return null;
}

function resolvePipelineApiBase(): string | null {
  if (typeof window === "undefined") return null;
  const { hostname, protocol, port } = window.location;
  const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost";
  const isFrontendPort = Boolean(port) && port !== "3100" && port !== "8020";
  if (isLocalHost && isFrontendPort) {
    return `${protocol}//${hostname}:3100/pipeline`;
  }
  return null;
}

const HEADLESS_API_BASE = resolveHeadlessApiBase();
const PUBLIC_SEARCH_API_BASE = resolvePublicSearchApiBase();
const PIPELINE_API_BASE = resolvePipelineApiBase();

export const SEARCH_API_ENDPOINT = HEADLESS_API_BASE
  ? `${HEADLESS_API_BASE}/v1/search`
  : "/api/search";

export const SEARCH_UPLOAD_API_ENDPOINT = "/api/search-upload";

export const SEARCH_HEALTH_API_ENDPOINT = HEADLESS_API_BASE
  ? `${HEADLESS_API_BASE}/health`
  : "/api/search-health";

// Pipeline v2 is the primary search path; legacy /api/search is fallback
export const PUBLIC_PIPELINE_API_ENDPOINT = PIPELINE_API_BASE
  ? `${PIPELINE_API_BASE}/search`
  : "/api/pipeline/search";

export const PUBLIC_SEARCH_API_ENDPOINT = PUBLIC_SEARCH_API_BASE ?? "/api/search";

export const PUBLIC_SEARCH_STREAM_API_ENDPOINT = PUBLIC_SEARCH_API_BASE
  ? `${PUBLIC_SEARCH_API_BASE}/stream`
  : "/api/search/stream";

export const PUBLIC_SEARCH_UPLOAD_API_ENDPOINT = PUBLIC_SEARCH_API_BASE
  ? `${PUBLIC_SEARCH_API_BASE}/upload`
  : "/api/search-upload";

export const PUBLIC_SEARCH_HEALTH_API_ENDPOINT = PUBLIC_SEARCH_API_BASE
  ? `${PUBLIC_SEARCH_API_BASE}/health`
  : "/api/search-health";

export const PUBLIC_SEARCH_HISTORY_API_ENDPOINT = PUBLIC_SEARCH_API_BASE
  ? `${PUBLIC_SEARCH_API_BASE}/history`
  : "/api/search-history";

export const PUBLIC_SEARCH_SYNC_STATUS_API_ENDPOINT = PUBLIC_SEARCH_API_BASE
  ? `${PUBLIC_SEARCH_API_BASE}/sync-status`
  : "/api/search-sync-status";
