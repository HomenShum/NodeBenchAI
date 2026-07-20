import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Cloud, CloudOff, Loader2 } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { getSyncBridgeAccountUrl, getSyncBridgeHealthUrl } from "@/lib/syncBridgeApi";
import { PUBLIC_SEARCH_SYNC_STATUS_API_ENDPOINT } from "@/lib/searchApi";

type SyncBridgeAccountSnapshot = {
  userId: string;
  workspaceId?: string;
  connectedDevices: Array<{
    deviceId: string;
    deviceName: string;
    lastSeenAt: string;
  }>;
  recentOperations: Array<{
    id: string;
    opType: string;
    acceptedAt: string;
  }>;
};

type SyncBridgeHealthSnapshot = {
  status: string;
  pairedDeviceCount?: number;
  activeConnectionCount?: number;
};

type SearchSyncStatusSnapshot = {
  success: boolean;
  sync?: {
    mode?: "offline" | "connected";
    pendingCount?: number;
    activeBinding?: {
      userId?: string;
      workspaceId?: string;
    };
  };
};

export function SyncProvenanceBadge({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.domains.auth.auth.loggedInUser);
  const [snapshot, setSnapshot] = useState<SyncBridgeAccountSnapshot | null>(null);
  const [health, setHealth] = useState<SyncBridgeHealthSnapshot | null>(null);
  const [searchSync, setSearchSync] = useState<SearchSyncStatusSnapshot["sync"] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch(getSyncBridgeHealthUrl())
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as SyncBridgeHealthSnapshot;
      })
      .then((json) => {
        if (!cancelled) {
          setHealth(json);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch(PUBLIC_SEARCH_SYNC_STATUS_API_ENDPOINT)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as SearchSyncStatusSnapshot;
      })
      .then((json) => {
        if (!cancelled) {
          setSearchSync(json.sync ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchSync(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?._id) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetch(getSyncBridgeAccountUrl(String(user._id)))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as SyncBridgeAccountSnapshot;
      })
      .then((json) => {
        if (!cancelled) {
          setSnapshot(json);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?._id]);

  const state = useMemo(() => {
    const connectedDevices = snapshot?.connectedDevices.length ?? 0;
    const activeConnections = health?.activeConnectionCount ?? 0;
    const pairedDevices = health?.pairedDeviceCount ?? connectedDevices;
    const localSyncConnected = searchSync?.mode === "connected";
    const localPendingCount = Number(searchSync?.pendingCount ?? 0);

    if (!isAuthenticated) {
      if (localSyncConnected) {
        return {
          label: "Syncing to account",
          detail:
            localPendingCount > 0
              ? `${localPendingCount} pending sync`
              : "account bridge warm",
          tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
          icon: Cloud,
        };
      }
      if (activeConnections > 0) {
        return {
          label: "Syncing to account",
          detail: `${activeConnections} live connection${activeConnections === 1 ? "" : "s"}`,
          tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
          icon: Cloud,
        };
      }
      if (pairedDevices > 0) {
        return {
          label: "Connected, not syncing",
          detail: `${pairedDevices} paired device${pairedDevices === 1 ? "" : "s"}`,
          tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
          icon: Cloud,
        };
      }
      return {
        label: "Local only",
        detail: "offline-first",
        tone: "border-white/[0.08] bg-white/[0.03] text-content-muted",
        icon: CloudOff,
      };
    }
    if (isLoading || loading) {
      return {
        label: "Checking sync",
        detail: "account link",
        tone: "border-[#d97757]/20 bg-[#d97757]/10 text-[#f2b49f]",
        icon: Loader2,
      };
    }
    if (connectedDevices > 0 || activeConnections > 0) {
      return {
        label: "Syncing to account",
        detail: `${Math.max(connectedDevices, activeConnections)} device${Math.max(connectedDevices, activeConnections) === 1 ? "" : "s"}`,
        tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
        icon: Cloud,
      };
    }
    if (pairedDevices > 0) {
      return {
        label: "Connected, not syncing",
        detail: `${pairedDevices} paired device${pairedDevices === 1 ? "" : "s"}`,
        tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
        icon: Cloud,
      };
    }
    return {
      label: "Connected, not syncing",
      detail: "account ready",
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-300",
      icon: Cloud,
    };
  }, [
    searchSync?.mode,
    searchSync?.pendingCount,
    health?.activeConnectionCount,
    health?.pairedDeviceCount,
    isAuthenticated,
    isLoading,
    loading,
    snapshot?.connectedDevices.length,
  ]);

  const Icon = state.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${state.tone}`}
      title={compact ? `${state.label} · ${state.detail}` : undefined}
    >
      <Icon className={`h-3.5 w-3.5 ${state.icon === Loader2 ? "animate-spin" : ""}`} />
      <span>{state.label}</span>
      {!compact ? <span className="opacity-80">· {state.detail}</span> : null}
    </span>
  );
}
