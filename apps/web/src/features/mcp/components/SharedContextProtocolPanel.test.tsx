import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/syncBridgeApi", () => ({
  getSharedContextSnapshotUrl: (options?: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 8));
    if (options?.peerId) params.set("peerId", options.peerId);
    if (options?.workspaceId) params.set("workspaceId", options.workspaceId);
    if (options?.contextType) params.set("contextType", options.contextType);
    if (options?.subjectIncludes) params.set("subjectIncludes", options.subjectIncludes);
    if (options?.taskType) params.set("taskType", options.taskType);
    if (options?.messageClass) params.set("messageClass", options.messageClass);
    return `/api/shared-context/snapshot?${params.toString()}`;
  },
  getSharedContextPeerSnapshotUrl: (peerId: string, options?: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 8));
    if (options?.workspaceId) params.set("workspaceId", options.workspaceId);
    if (options?.contextType) params.set("contextType", options.contextType);
    if (options?.subjectIncludes) params.set("subjectIncludes", options.subjectIncludes);
    if (options?.taskType) params.set("taskType", options.taskType);
    if (options?.messageClass) params.set("messageClass", options.messageClass);
    return `/api/shared-context/peers/${encodeURIComponent(peerId)}/snapshot?${params.toString()}`;
  },
  getSharedContextSubscriptionManifestUrl: (options?: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 8));
    if (options?.peerId) params.set("peerId", options.peerId);
    if (options?.workspaceId) params.set("workspaceId", options.workspaceId);
    if (options?.contextType) params.set("contextType", options.contextType);
    if (options?.subjectIncludes) params.set("subjectIncludes", options.subjectIncludes);
    if (options?.taskType) params.set("taskType", options.taskType);
    if (options?.messageClass) params.set("messageClass", options.messageClass);
    return `/api/shared-context/subscriptions/manifest?${params.toString()}`;
  },
  getSharedContextEventsUrl: () => "/api/shared-context/events?limit=8",
  getSharedContextPacketUrl: (contextId: string, peerId?: string) =>
    `/api/shared-context/packets/${encodeURIComponent(contextId)}${peerId ? `?peerId=${encodeURIComponent(peerId)}` : ""}`,
}));

import { SharedContextProtocolPanel } from "./SharedContextProtocolPanel";

const EMPTY_SNAPSHOT = {
  success: true,
  snapshot: {
    peers: [],
    recentPackets: [],
    recentTasks: [],
    recentMessages: [],
    counts: {
      activePeers: 0,
      activePackets: 0,
      invalidatedPackets: 0,
      openTasks: 0,
      unreadMessages: 0,
    },
  },
};

const EMPTY_MANIFEST = {
  success: true,
  manifest: {
    snapshotQuery: { limit: 8 },
    pullQuery: { limit: 8 },
    subscriptionQuery: { eventTypes: ["packet_published"] },
    packetResources: [],
  },
};

function mockFetchWith(body: unknown = EMPTY_SNAPSHOT) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const responseBody = url.includes("/subscriptions/manifest") ? EMPTY_MANIFEST : body;
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function mockFetchRoutes(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    const body = match
      ? match[1]
      : url.includes("/subscriptions/manifest")
        ? EMPTY_MANIFEST
        : EMPTY_SNAPSHOT;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("SharedContextProtocolPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("scp-panel-filters");
    vi.stubGlobal("EventSource", class {
      close() {}
      addEventListener() {}
      onerror: ((event: Event) => void) | null = null;
      constructor(_url: string) {}
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem("scp-panel-filters");
  });

  it("renders the empty state when no peers or packets are registered", async () => {
    mockFetchWith();

    render(<SharedContextProtocolPanel />);

    await waitFor(() =>
      expect(screen.getByText("No peers have registered yet. Once local runtimes or role-specific workers announce themselves, they will show up here.")).toBeInTheDocument(),
    );
    expect(screen.getByText("No shared packets yet. Publish structured packets here instead of passing free-form text between peers.")).toBeInTheDocument();
  });

  it("renders peers, packets, tasks, and messages from the snapshot", async () => {
    mockFetchRoutes({
      "/api/shared-context/snapshot": {
        success: true,
        snapshot: {
          peers: [
            {
              peerId: "peer:researcher:1",
              product: "nodebench",
              workspaceId: "workspace_alpha",
              surface: "local_runtime",
              role: "researcher",
              capabilities: ["can-search", "can-publish-packet"],
              contextScopes: ["workspace"],
              status: "active",
              summary: {
                currentTask: "Compile founder packet for Stripe",
              },
              lastHeartbeatAt: "2026-03-27T12:00:00.000Z",
            },
          ],
          recentPackets: [
            {
              contextId: "context:1",
              contextType: "entity_packet",
              producerPeerId: "peer:researcher:1",
              subject: "Stripe entity packet",
              summary: "Canonical packet for Stripe with fresh billing evidence.",
              status: "active",
              confidence: 0.93,
              scope: ["workspace", "entity:stripe"],
              nextActions: [],
            },
          ],
          recentTasks: [
            {
              taskId: "task:1",
              taskType: "judge_packet",
              proposerPeerId: "peer:researcher:1",
              assigneePeerId: "peer:judge:1",
              status: "accepted",
              outputContextId: null,
            },
          ],
          recentMessages: [
            {
              messageId: "message:1",
              fromPeerId: "peer:researcher:1",
              toPeerId: "peer:judge:1",
              messageClass: "context_offer",
              status: "unread",
            },
          ],
          counts: {
            activePeers: 1,
            activePackets: 1,
            invalidatedPackets: 0,
            openTasks: 1,
            unreadMessages: 1,
          },
        },
      },
      "/api/shared-context/subscriptions/manifest": {
        success: true,
        manifest: {
          snapshotQuery: {
            peerId: "peer:researcher:1",
            workspaceId: "workspace_alpha",
            contextType: "entity_packet",
          },
          pullQuery: {
            requestingPeerId: "peer:researcher:1",
            workspaceId: "workspace_alpha",
            contextType: "entity_packet",
            subjectIncludes: "Stripe entity packet",
          },
          subscriptionQuery: {
            peerId: "peer:researcher:1",
            workspaceId: "workspace_alpha",
            contextType: "entity_packet",
            subjectIncludes: "Stripe entity packet",
            eventTypes: ["packet_published", "task_status_changed"],
          },
          packetResources: [
            {
              contextId: "context:1",
              contextType: "entity_packet",
              subject: "Stripe entity packet",
              resourceUri: "shared-context://packet/context%3A1",
            },
          ],
        },
      },
      "/api/shared-context/packets/": {
        success: true,
        packet: {
          contextId: "context:1",
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          subject: "Stripe entity packet",
          summary: "Canonical packet for Stripe with fresh billing evidence.",
          status: "active",
          claims: ["Stripe expanded billing automation."],
          evidenceRefs: ["https://stripe.com"],
          nextActions: ["Judge the packet."],
          scope: ["workspace", "entity:stripe"],
        },
        resourceUri: "shared-context://packet/context%3A1",
        pullQuery: {
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          workspaceId: "workspace_alpha",
          scopeIncludes: "entity:stripe",
          subjectIncludes: "Stripe entity packet",
        },
        subscriptionQuery: {
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          workspaceId: "workspace_alpha",
          scopeIncludes: "entity:stripe",
          subjectIncludes: "Stripe entity packet",
          eventTypes: ["packet_published", "task_status_changed"],
        },
      },
    });

    render(<SharedContextProtocolPanel />);

    await waitFor(() =>
      expect(screen.getByText("Compile founder packet for Stripe")).toBeInTheDocument(),
    );
    expect(screen.getByText("Stripe entity packet")).toBeInTheDocument();
    expect(screen.getAllByText("judge_packet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("context_offer").length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(screen.getByText("Stripe expanded billing automation.")).toBeInTheDocument();
    });
    expect(screen.getByText("shared-context://packet/context%3A1")).toBeInTheDocument();
    expect(screen.getByText("Subscription Manifest")).toBeInTheDocument();
  });

  it("re-queries with the selected workspace, peer, packet, and task filters", async () => {
    const fetchMock = mockFetchWith();

    render(<SharedContextProtocolPanel />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.change(screen.getByPlaceholderText("workspace:nodebench..."), {
      target: { value: "workspace_alpha" },
    });
    fireEvent.change(screen.getByPlaceholderText("peer:web:control_plane"), {
      target: { value: "peer:researcher:1" },
    });
    fireEvent.change(screen.getByDisplayValue("All packet types"), {
      target: { value: "judge_packet" },
    });
    fireEvent.change(screen.getByDisplayValue("All tasks"), {
      target: { value: "agent_handoff" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("workspaceId=workspace_alpha"),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/shared-context/peers/peer%3Aresearcher%3A1/snapshot"),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("contextType=judge_packet"),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("taskType=agent_handoff"),
      );
    });
  });

  it("passes subjectIncludes to the snapshot URL when the subject search has a value", async () => {
    const fetchMock = mockFetchWith();

    render(<SharedContextProtocolPanel />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.change(screen.getByPlaceholderText("Search by keyword..."), {
      target: { value: "Stripe" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("subjectIncludes=Stripe"),
      );
    });
  });

  it("loads a scoped packet resource when a packet is selected", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/shared-context/snapshot": {
        success: true,
        snapshot: {
          peers: [],
          recentPackets: [
            {
              contextId: "context:stripe",
              contextType: "entity_packet",
              producerPeerId: "peer:researcher:1",
              subject: "Stripe entity packet",
              summary: "Canonical packet for Stripe.",
              status: "active",
              confidence: 0.91,
              scope: ["workspace"],
              nextActions: [],
            },
          ],
          recentTasks: [],
          recentMessages: [],
          counts: {
            activePeers: 0,
            activePackets: 1,
            invalidatedPackets: 0,
            openTasks: 0,
            unreadMessages: 0,
          },
        },
      },
      "/api/shared-context/subscriptions/manifest": {
        success: true,
        manifest: {
          snapshotQuery: {
            contextType: "entity_packet",
            subjectIncludes: "Stripe entity packet",
          },
          pullQuery: {
            contextType: "entity_packet",
            subjectIncludes: "Stripe entity packet",
          },
          subscriptionQuery: {
            contextType: "entity_packet",
            subjectIncludes: "Stripe entity packet",
            eventTypes: ["packet_published"],
          },
          packetResources: [
            {
              contextId: "context:stripe",
              contextType: "entity_packet",
              subject: "Stripe entity packet",
              resourceUri: "shared-context://packet/context%3Astripe",
            },
          ],
        },
      },
      "/api/shared-context/packets/": {
        success: true,
        packet: {
          contextId: "context:stripe",
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          subject: "Stripe entity packet",
          summary: "Canonical packet for Stripe.",
          status: "active",
          claims: ["Stripe is pushing deeper into billing automation."],
          evidenceRefs: ["https://stripe.com"],
          nextActions: ["Compare against Adyen."],
          scope: ["workspace"],
        },
        resourceUri: "shared-context://packet/context%3Astripe",
        pullQuery: {
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          workspaceId: "workspace",
          subjectIncludes: "Stripe entity packet",
        },
        subscriptionQuery: {
          contextType: "entity_packet",
          producerPeerId: "peer:researcher:1",
          workspaceId: "workspace",
          subjectIncludes: "Stripe entity packet",
          eventTypes: ["packet_published"],
        },
      },
    });

    render(<SharedContextProtocolPanel />);

    await waitFor(() => {
      expect(screen.getByText("Stripe entity packet")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Stripe is pushing deeper into billing automation.")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/"subjectIncludes": "Stripe entity packet"/).length).toBeGreaterThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/shared-context/packets/context%3Astripe"),
    );
  });

  it("clears all filters when the Reset filters button is clicked", async () => {
    const fetchMock = mockFetchWith();

    render(<SharedContextProtocolPanel />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    // Set some filters first
    fireEvent.change(screen.getByPlaceholderText("workspace:nodebench..."), {
      target: { value: "ws1" },
    });
    fireEvent.change(screen.getByPlaceholderText("peer:web:control_plane"), {
      target: { value: "peer:a" },
    });
    fireEvent.change(screen.getByPlaceholderText("Search by keyword..."), {
      target: { value: "test" },
    });

    // Reset button should now appear
    await waitFor(() => expect(screen.getByText("Reset filters")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Reset filters"));

    // All inputs should be empty
    await waitFor(() => {
      expect((screen.getByPlaceholderText("workspace:nodebench...") as HTMLInputElement).value).toBe("");
      expect((screen.getByPlaceholderText("peer:web:control_plane") as HTMLInputElement).value).toBe("");
      expect((screen.getByPlaceholderText("Search by keyword...") as HTMLInputElement).value).toBe("");
    });
  });

  it("persists filter state to localStorage and restores on remount", async () => {
    const fetchMock = mockFetchWith();

    const { unmount } = render(<SharedContextProtocolPanel />);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.change(screen.getByPlaceholderText("workspace:nodebench..."), {
      target: { value: "saved_ws" },
    });

    // Wait for the persistence effect to run
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("scp-panel-filters") ?? "{}");
      expect(stored.workspace).toBe("saved_ws");
    });

    unmount();

    // Remount — filter should be restored from localStorage
    render(<SharedContextProtocolPanel />);

    expect((screen.getByPlaceholderText("workspace:nodebench...") as HTMLInputElement).value).toBe("saved_ws");
  });

  it("does not show Reset filters button when no filters are active", async () => {
    mockFetchWith();

    render(<SharedContextProtocolPanel />);

    await waitFor(() =>
      expect(screen.getByText("No peers have registered yet. Once local runtimes or role-specific workers announce themselves, they will show up here.")).toBeInTheDocument(),
    );

    expect(screen.queryByText("Reset filters")).not.toBeInTheDocument();
  });

  it("ignores stale fetch responses after rapid filter changes (generation guard)", async () => {
    // Scenario: user types "a" then quickly "ab". The first fetch for "a" resolves
    // AFTER the second fetch for "ab". The stale "a" response must be discarded.

    let fetchCallCount = 0;
    const resolvers: Array<(value: Response) => void> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          fetchCallCount++;
          resolvers.push(resolve);
        }),
    );

    render(<SharedContextProtocolPanel />);

    // Wait for initial fetch
    await waitFor(() => expect(fetchCallCount).toBeGreaterThanOrEqual(1));

    // Resolve initial fetch
    resolvers[0]!(new Response(JSON.stringify(EMPTY_SNAPSHOT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await waitFor(() => expect(screen.getByText(/No peers have registered/)).toBeInTheDocument());

    const prevCount = fetchCallCount;

    // Type "a" — triggers new effect + fetch
    fireEvent.change(screen.getByPlaceholderText("Search by keyword..."), {
      target: { value: "a" },
    });

    await waitFor(() => expect(fetchCallCount).toBeGreaterThan(prevCount));
    const staleIndex = fetchCallCount - 1;

    // Type "ab" — triggers another new effect + fetch before "a" resolves
    fireEvent.change(screen.getByPlaceholderText("Search by keyword..."), {
      target: { value: "ab" },
    });

    await waitFor(() => expect(fetchCallCount).toBeGreaterThan(staleIndex + 1));
    const currentIndex = fetchCallCount - 1;

    // Resolve the STALE fetch ("a") with a distinctive snapshot
    const staleSnapshot = {
      success: true,
      snapshot: {
        ...EMPTY_SNAPSHOT.snapshot,
        counts: { ...EMPTY_SNAPSHOT.snapshot.counts, activePeers: 999 },
      },
    };
    resolvers[staleIndex]!(new Response(JSON.stringify(staleSnapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    // Resolve the CURRENT fetch ("ab") with correct data
    const currentSnapshot = {
      success: true,
      snapshot: {
        ...EMPTY_SNAPSHOT.snapshot,
        counts: { ...EMPTY_SNAPSHOT.snapshot.counts, activePeers: 42 },
      },
    };
    resolvers[currentIndex]!(new Response(JSON.stringify(currentSnapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    // The displayed count should be 42 (current), not 999 (stale)
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.queryByText("999")).not.toBeInTheDocument();
  });
});
