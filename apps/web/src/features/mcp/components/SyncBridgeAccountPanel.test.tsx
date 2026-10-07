import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseConvexAuth = vi.fn();
const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => mockUseConvexAuth(),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/lib/syncBridgeApi", () => ({
  getSyncBridgeHealthUrl: () => "/api/sync-bridge/health",
  getSyncBridgeAccountUrl: (userId: string) =>
    `/api/sync-bridge/accounts/${userId}`,
  getSyncBridgePairingUrl: () => "/api/sync-bridge/dev/pairings",
  getSyncBridgeWebSocketUrl: () => "ws://127.0.0.1:3100/sync-bridge",
}));

import { SyncBridgeAccountPanel } from "./SyncBridgeAccountPanel";

describe("SyncBridgeAccountPanel", () => {
  beforeEach(() => {
    mockUseConvexAuth.mockReset();
    mockUseQuery.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders offline-safe empty states without an account snapshot", async () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mockUseQuery.mockReturnValue(undefined);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/health")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "sync-bridge",
            pairingGrantCount: 0,
            pairedDeviceCount: 0,
            activeConnectionCount: 0,
            accountCount: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch ${String(input)}`);
    });

    render(<SyncBridgeAccountPanel />);

    await waitFor(() =>
      expect(screen.getByText("No paired devices yet. Generate a pairing code from this account, then let local MCP dial out.")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Approval events have not been synced yet. When approval decisions are emitted through the outbound bridge, they will land here alongside shared history.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Pairing Code" }),
    ).toBeDisabled();
  });

  it("renders paired devices and shared history for the signed-in account", async () => {
    mockUseConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mockUseQuery.mockReturnValue({ _id: "user_sync_1" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/health")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "sync-bridge",
            pairingGrantCount: 1,
            pairedDeviceCount: 1,
            activeConnectionCount: 1,
            accountCount: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/accounts/user_sync_1")) {
        return new Response(
          JSON.stringify({
            userId: "user_sync_1",
            workspaceId: "workspace_alpha",
            connectedDevices: [
              {
                deviceId: "device_local_1",
                deviceName: "Founder Laptop",
                platform: "win32",
                pairedAt: "2026-03-26T22:00:00.000Z",
                lastSeenAt: "2026-03-26T22:05:00.000Z",
                scopesGranted: ["metadata_only", "receipts_and_traces"],
              },
            ],
            recentOperations: [
              {
                id: "sync_op_1",
                deviceId: "device_local_1",
                objectId: "run:auto_123",
                objectKind: "run",
                opType: "upsert_object",
                acceptedAt: "2026-03-26T22:06:00.000Z",
              },
              {
                id: "sync_op_2",
                deviceId: "device_local_1",
                objectId: "approval:req_123",
                objectKind: "approval",
                opType: "approval_event",
                acceptedAt: "2026-03-26T22:07:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    render(<SyncBridgeAccountPanel />);

    await waitFor(() =>
      expect(screen.getByText("Founder Laptop")).toBeInTheDocument(),
    );
    expect(screen.getByText("upsert_object")).toBeInTheDocument();
    expect(screen.getByText("approval_event | approval:req_123")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Pairing Code" }),
    ).toBeEnabled();
  });
});
