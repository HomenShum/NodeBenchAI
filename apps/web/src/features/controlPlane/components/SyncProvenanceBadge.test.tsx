import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  user: null as null | { _id: string },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
  }),
  useQuery: () => authState.user,
}));

import { SyncProvenanceBadge } from "./SyncProvenanceBadge";

describe("SyncProvenanceBadge", () => {
  afterEach(() => {
    authState.isAuthenticated = false;
    authState.isLoading = false;
    authState.user = null;
    vi.restoreAllMocks();
  });

  it("shows local only when no sync bridge devices are present", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("search-sync-status") || url.includes("/sync-status")) {
        return {
          ok: true,
          json: async () => ({ success: true, sync: { mode: "offline", pendingCount: 0 } }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          pairedDeviceCount: 0,
          activeConnectionCount: 0,
        }),
      } as Response;
    });

    render(<SyncProvenanceBadge />);

    await waitFor(() => {
      expect(screen.getByText("Local only")).toBeInTheDocument();
    });
    expect(screen.getByText(/offline-first/i)).toBeInTheDocument();
  });

  it("shows connected status for the public guest surface when the sync bridge is paired", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("search-sync-status") || url.includes("/sync-status")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            sync: { mode: "connected", pendingCount: 12 },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          pairedDeviceCount: 1,
          activeConnectionCount: 0,
        }),
      } as Response;
    });

    render(<SyncProvenanceBadge />);

    await waitFor(() => {
      expect(screen.getByText("Syncing to account")).toBeInTheDocument();
    });
    expect(screen.getByText(/12 pending sync/i)).toBeInTheDocument();
  });

  it("shows syncing to account when paired devices are present", async () => {
    authState.isAuthenticated = true;
    authState.user = { _id: "user_123" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("search-sync-status") || url.includes("/sync-status")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            sync: { mode: "connected", pendingCount: 4 },
          }),
        } as Response;
      }
      if (url.includes("/health")) {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            pairedDeviceCount: 1,
            activeConnectionCount: 1,
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          userId: "user_123",
          workspaceId: "ws_1",
          connectedDevices: [{ deviceId: "dev_1", deviceName: "MacBook", lastSeenAt: "2026-03-27T07:00:00Z" }],
          recentOperations: [{ id: "op_1", opType: "sync", acceptedAt: "2026-03-27T07:01:00Z" }],
        }),
      } as Response;
    });

    render(<SyncProvenanceBadge />);

    await waitFor(() => {
      expect(screen.getByText("Syncing to account")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 device/i)).toBeInTheDocument();
  });
});
