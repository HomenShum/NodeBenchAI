export function isFastAgentRuntimeOwnerReady({
  isAuthenticated,
  isLoading,
  sessionId,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionId: string | null;
}): boolean {
  if (isLoading) return false;
  return isAuthenticated || Boolean(sessionId);
}

export function selectAnonymousRecoveryThreadId({
  activeThreadId,
  isAnonymous,
  runtimeOwnerReady,
  sessionId,
  threads,
}: {
  activeThreadId: string | null;
  isAnonymous: boolean;
  runtimeOwnerReady: boolean;
  sessionId: string | null;
  threads: Array<{ _id?: string; anonymousSessionId?: string }>;
}): string | null {
  if (!isAnonymous || !runtimeOwnerReady || !sessionId || activeThreadId) {
    return null;
  }

  const ownedThread = threads.find(
    (thread) => thread.anonymousSessionId === sessionId && thread._id,
  );
  return ownedThread?._id ?? null;
}

export type FastAgentPanelTab =
  | "chat"
  | "scratchpad"
  | "flow"
  | "sources"
  | "trace";

export function getFastAgentViewTabs({
  isCompactSidebar,
  showsNotebookWorkspaceTabs,
}: {
  isCompactSidebar: boolean;
  showsNotebookWorkspaceTabs: boolean;
}): ReadonlyArray<{ id: FastAgentPanelTab; label: string }> {
  if (showsNotebookWorkspaceTabs) {
    return [
      { id: "chat", label: "Chat" },
      { id: "scratchpad", label: "Scratchpad" },
      { id: "flow", label: "Flow" },
    ];
  }

  const primary: Array<{ id: FastAgentPanelTab; label: string }> = [
    { id: "chat", label: "Answer" },
    { id: "sources", label: "Sources" },
  ];
  if (!isCompactSidebar) {
    primary.push({ id: "trace", label: "Activity" });
  }
  return primary;
}
