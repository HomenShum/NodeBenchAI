import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Activity,
  Copy,
  History,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import {
  getSyncBridgeAccountUrl,
  getSyncBridgeHealthUrl,
  getSyncBridgePairingUrl,
  getSyncBridgeWebSocketUrl,
} from "@/lib/syncBridgeApi";
import { cn } from "@/lib/utils";

type SyncBridgeHealth = {
  status: string;
  service: string;
  pairingGrantCount: number;
  pairedDeviceCount: number;
  activeConnectionCount: number;
  accountCount: number;
};

type SyncBridgeAccountSnapshot = {
  userId: string;
  workspaceId?: string;
  connectedDevices: Array<{
    deviceId: string;
    deviceName: string;
    platform?: string;
    pairedAt: string;
    lastSeenAt: string;
    scopesGranted: string[];
  }>;
  recentOperations: Array<{
    id: string;
    deviceId: string;
    objectId: string | null;
    objectKind: string;
    opType: string;
    acceptedAt: string;
  }>;
};

type PairingGrant = {
  pairingCode: string;
  userId: string;
  workspaceId?: string;
  scopes: string[];
  expiresAt: string;
};

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3",
        tone === "good"
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-edge bg-surface-secondary/50",
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-content-muted">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-content">{value}</div>
    </div>
  );
}

function formatTime(value?: string | null): string {
  if (!value) return "Not yet";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function SyncBridgeAccountPanel() {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.domains.auth.auth.loggedInUser);
  const [health, setHealth] = useState<SyncBridgeHealth | null>(null);
  const [snapshot, setSnapshot] = useState<SyncBridgeAccountSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingGrant, setPairingGrant] = useState<PairingGrant | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const approvalEvents = useMemo(
    () =>
      (snapshot?.recentOperations ?? []).filter(
        (operation) => operation.opType === "approval_event",
      ),
    [snapshot?.recentOperations],
  );
  const wsUrl = useMemo(() => getSyncBridgeWebSocketUrl(), []);

  const copyText = useCallback(async (value: string, field: string) => {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(
      () => setCopiedField((current) => (current === field ? null : current)),
      1600,
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [healthRes, snapshotRes] = await Promise.all([
        fetch(getSyncBridgeHealthUrl()),
        user?._id
          ? fetch(getSyncBridgeAccountUrl(String(user._id)))
          : Promise.resolve(null),
      ]);

      if (!healthRes.ok) {
        throw new Error(`Sync bridge health failed: HTTP ${healthRes.status}`);
      }
      const healthJson = (await healthRes.json()) as SyncBridgeHealth;
      setHealth(healthJson);

      if (snapshotRes) {
        if (!snapshotRes.ok) {
          throw new Error(
            `Sync bridge account snapshot failed: HTTP ${snapshotRes.status}`,
          );
        }
        setSnapshot((await snapshotRes.json()) as SyncBridgeAccountSnapshot);
      } else {
        setSnapshot(null);
      }
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : String(fetchError),
      );
    } finally {
      setLoading(false);
    }
  }, [user?._id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const createPairingGrant = useCallback(async () => {
    if (!user?._id) return;
    setPairingBusy(true);
    setError(null);
    try {
      const response = await fetch(getSyncBridgePairingUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(user._id),
          scopes: [
            "metadata_only",
            "receipts_and_traces",
            "memory_and_artifacts",
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Pairing grant failed: HTTP ${response.status}`);
      }
      setPairingGrant((await response.json()) as PairingGrant);
      void load();
    } catch (pairingError) {
      setError(
        pairingError instanceof Error
          ? pairingError.message
          : String(pairingError),
      );
    } finally {
      setPairingBusy(false);
    }
  }, [load, user?._id]);

  return (
    <section className="mb-6 nb-surface-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[var(--accent-primary)]" />
            <h2 className="text-base font-semibold text-content">
              Local Sync Bridge
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-content-secondary">
            Pair a local NodeBench MCP runtime to this account, inspect
            connected devices, and review shared history flowing out of the
            offline-first SQLite store.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-content-secondary transition hover:bg-surface-hover hover:text-content"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void createPairingGrant()}
            disabled={!isAuthenticated || !user?._id || pairingBusy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              !isAuthenticated || !user?._id || pairingBusy
                ? "cursor-not-allowed bg-surface-secondary text-content-muted"
                : "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]",
            )}
          >
            {pairingBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Generate Pairing Code
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <StatCard
          label="Bridge"
          value={health?.status ?? (loading ? "..." : "offline")}
          tone={health?.status === "ok" ? "good" : "default"}
        />
        <StatCard
          label="Paired devices"
          value={health?.pairedDeviceCount ?? 0}
        />
        <StatCard
          label="Live connections"
          value={health?.activeConnectionCount ?? 0}
        />
        <StatCard
          label="Shared ops"
          value={snapshot?.recentOperations?.length ?? 0}
        />
      </div>

      {pairingGrant && (
        <div className="mt-4 rounded-xl border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/5 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-content-muted">
                Pair this account to local MCP
              </div>
              <div className="mt-2 text-sm text-content-secondary">
                Use the code below from the local runtime. The outbound
                websocket remains the only live dependency.
              </div>
            </div>
            <div className="text-xs text-content-muted">
              Expires {formatTime(pairingGrant.expiresAt)}
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-edge bg-surface px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-muted">
                Pairing code
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-sm font-semibold text-content">
                  {pairingGrant.pairingCode}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(pairingGrant.pairingCode, "pairing")}
                  className="rounded-md p-1 text-content-muted transition hover:bg-surface-hover hover:text-content"
                  aria-label="Copy pairing code"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copiedField === "pairing" && (
                  <span className="text-xs text-emerald-500">Copied</span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-edge bg-surface px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-muted">
                WebSocket endpoint
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 truncate text-sm text-content">
                  {wsUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(wsUrl, "ws")}
                  className="rounded-md p-1 text-content-muted transition hover:bg-surface-hover hover:text-content"
                  aria-label="Copy WebSocket endpoint"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copiedField === "ws" && (
                  <span className="text-xs text-emerald-500">Copied</span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-edge bg-surface-secondary/40 px-3 py-3 text-xs text-content-secondary">
            Call <code>run_sync_bridge_flush</code> with this pairing code and
            endpoint from the local NodeBench MCP runtime.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-xl border border-edge bg-surface-secondary/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-content">
            <Smartphone className="h-4 w-4 text-[var(--accent-primary)]" />
            Connected devices
          </div>
          <div className="mt-4 space-y-3">
            {(snapshot?.connectedDevices ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge px-3 py-6 text-sm text-content-muted">
                No paired devices yet. Generate a pairing code from this
                account, then let local MCP dial out.
              </div>
            ) : (
              snapshot!.connectedDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className="rounded-lg border border-edge bg-surface px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-content">
                        {device.deviceName}
                      </div>
                      <div className="mt-1 text-xs text-content-muted">
                        {device.platform ?? "unknown platform"} | paired{" "}
                        {formatTime(device.pairedAt)}
                      </div>
                    </div>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-500">
                      {device.scopesGranted.length} scopes
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {device.scopesGranted.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-edge px-2 py-1 text-[11px] text-content-secondary"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-content-muted">
                    Last seen {formatTime(device.lastSeenAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-surface-secondary/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-content">
            <History className="h-4 w-4 text-[var(--accent-primary)]" />
            Shared history
          </div>
          <div className="mt-4 space-y-3">
            {(snapshot?.recentOperations ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge px-3 py-6 text-sm text-content-muted">
                No synced history yet. Once the local queue flushes, receipts,
                artifacts, and outcomes will appear here.
              </div>
            ) : (
              snapshot!.recentOperations.slice(0, 10).map((operation) => (
                <div
                  key={operation.id}
                  className="rounded-lg border border-edge bg-surface px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-content">
                        {operation.opType}
                      </div>
                      <div className="mt-1 text-xs text-content-muted">
                        {operation.objectKind}
                        {operation.objectId ? ` | ${operation.objectId}` : ""}
                      </div>
                    </div>
                    <span className="rounded-full border border-edge px-2 py-1 text-[11px] text-content-secondary">
                      {operation.deviceId}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-content-muted">
                    Accepted {formatTime(operation.acceptedAt)}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 border-t border-edge/60 pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-content">
              <Activity className="h-4 w-4 text-[var(--accent-primary)]" />
              Approval stream
            </div>
            <div className="mt-3 space-y-2">
              {approvalEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-edge px-3 py-4 text-sm text-content-muted">
                  Approval events have not been synced yet. When approval
                  decisions are emitted through the outbound bridge, they will
                  land here alongside shared history.
                </div>
              ) : (
                approvalEvents.map((operation) => (
                  <div
                    key={operation.id}
                    className="rounded-lg border border-edge bg-surface px-3 py-3 text-sm text-content"
                  >
                    {operation.opType} | {operation.objectId ?? operation.id}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
