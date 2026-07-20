export type WorkspaceTab = "brief" | "cards" | "notebook" | "sources" | "chat" | "map";

export const WORKSPACE_CANONICAL_HOST = "workspace.nodebenchai.com";

export const WORKSPACE_HOSTNAMES = [
  WORKSPACE_CANONICAL_HOST,
  "nodebench.workspace",
  "nodebench-workspace.vercel.app",
] as const;

export function isWorkspaceHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return WORKSPACE_HOSTNAMES.includes(normalized as (typeof WORKSPACE_HOSTNAMES)[number]);
}

export function buildWorkspacePath({
  workspaceId,
  tab = "brief",
}: {
  workspaceId: string;
  tab?: WorkspaceTab;
}) {
  const id = workspaceId.trim() || "new";
  return `/w/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
}

export function buildLocalWorkspacePath(args: {
  workspaceId: string;
  tab?: WorkspaceTab;
}) {
  return `/workspace${buildWorkspacePath(args)}`;
}

export function buildWorkspaceRouteForHost({
  workspaceId,
  tab = "brief",
  hostname,
}: {
  workspaceId: string;
  tab?: WorkspaceTab;
  hostname?: string;
}) {
  const currentHostname =
    hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  if (isWorkspaceHostname(currentHostname)) {
    return buildWorkspacePath({ workspaceId, tab });
  }
  return buildLocalWorkspacePath({ workspaceId, tab });
}

export function buildWorkspaceUrl({
  workspaceId,
  tab = "brief",
  hostname,
  protocol,
  origin,
}: {
  workspaceId: string;
  tab?: WorkspaceTab;
  hostname?: string;
  protocol?: string;
  origin?: string;
}) {
  const currentHostname =
    hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  const currentProtocol =
    protocol ?? (typeof window !== "undefined" ? window.location.protocol : "https:");
  const currentOrigin =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");

  if (isWorkspaceHostname(currentHostname)) {
    const workspacePath = buildWorkspacePath({ workspaceId, tab });
    return currentOrigin ? `${currentOrigin}${workspacePath}` : workspacePath;
  }

  if (
    currentHostname === "localhost" ||
    currentHostname === "127.0.0.1" ||
    currentHostname === "::1"
  ) {
    const localPath = buildLocalWorkspacePath({ workspaceId, tab });
    return currentOrigin ? `${currentOrigin}${localPath}` : localPath;
  }

  return `${currentProtocol === "http:" ? "http" : "https"}://${WORKSPACE_CANONICAL_HOST}${buildWorkspacePath({
    workspaceId,
    tab,
  })}`;
}
