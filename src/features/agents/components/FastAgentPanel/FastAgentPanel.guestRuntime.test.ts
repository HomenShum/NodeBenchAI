import { describe, expect, it } from "vitest";

import {
  getFastAgentViewTabs,
  isFastAgentRuntimeOwnerReady,
  selectAnonymousRecoveryThreadId,
} from "./FastAgentPanel.guestRuntime";

describe("FastAgent guest runtime ownership", () => {
  it("blocks sends until authentication or an anonymous session owner is ready", () => {
    expect(isFastAgentRuntimeOwnerReady({
      isAuthenticated: false,
      isLoading: true,
      sessionId: null,
    })).toBe(false);
    expect(isFastAgentRuntimeOwnerReady({
      isAuthenticated: false,
      isLoading: false,
      sessionId: null,
    })).toBe(false);
    expect(isFastAgentRuntimeOwnerReady({
      isAuthenticated: false,
      isLoading: false,
      sessionId: "anon-a",
    })).toBe(true);
    expect(isFastAgentRuntimeOwnerReady({
      isAuthenticated: true,
      isLoading: false,
      sessionId: null,
    })).toBe(true);
  });

  it("recovers only a thread bound to the current anonymous session", () => {
    const threads = [
      { _id: "thread-b", anonymousSessionId: "anon-b" },
      { _id: "thread-a-latest", anonymousSessionId: "anon-a" },
      { _id: "thread-a-old", anonymousSessionId: "anon-a" },
    ];

    expect(selectAnonymousRecoveryThreadId({
      activeThreadId: null,
      isAnonymous: true,
      runtimeOwnerReady: true,
      sessionId: "anon-a",
      threads,
    })).toBe("thread-a-latest");
    expect(selectAnonymousRecoveryThreadId({
      activeThreadId: null,
      isAnonymous: true,
      runtimeOwnerReady: true,
      sessionId: "anon-c",
      threads,
    })).toBeNull();
    expect(selectAnonymousRecoveryThreadId({
      activeThreadId: "new-thread",
      isAnonymous: true,
      runtimeOwnerReady: true,
      sessionId: "anon-a",
      threads,
    })).toBeNull();
  });

  it("keeps only thread-scoped runtime views directly reachable on desktop", () => {
    expect(getFastAgentViewTabs({
      isCompactSidebar: false,
      showsNotebookWorkspaceTabs: false,
    })).toEqual([
      { id: "chat", label: "Answer" },
      { id: "sources", label: "Sources" },
      { id: "trace", label: "Activity" },
    ]);
    expect(getFastAgentViewTabs({
      isCompactSidebar: true,
      showsNotebookWorkspaceTabs: false,
    })).toEqual([
      { id: "chat", label: "Answer" },
      { id: "sources", label: "Sources" },
    ]);
  });
});
