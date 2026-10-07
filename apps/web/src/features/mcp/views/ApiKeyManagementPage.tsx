/**
 * ApiKeyManagementPage — Create, view, and revoke API keys for the MCP WebSocket gateway.
 *
 * Glass card DNA, terracotta accent, Convex-ready hooks.
 * Once convex/domains/mcp/apiKeys.ts is deployed, swap the demo state
 * for useQuery(api.domains.mcp.apiKeys.listApiKeys) / useMutation.
 */

import { memo, useCallback, useState } from "react";
import {
  Activity,
  ClipboardCopy,
  Key,
  Link2,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";

/* ------------------------------------------------------------------ */
/*  Design tokens — glass card DNA                                     */
/* ------------------------------------------------------------------ */

const CARD_BASE = "rounded-xl border border-white/[0.06] bg-white/[0.02] p-4";
const CARD_HIGHLIGHT =
  "rounded-xl border border-[#d97757]/40 bg-[#d97757]/[0.06] p-4";
const SECTION_TITLE =
  "mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApiKeyRecord {
  _id: string;
  keyHashPrefix: string;
  label: string;
  permissions: string[];
  rateLimits: { perMinute: number; perDay: number };
  createdAt: number;
  lastUsedAt: number;
  revokedAt?: number;
  isActive: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function maskKey(prefix: string): string {
  return `${prefix}${"*".repeat(20)}`;
}

function generateDemoKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "nb_key_";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        active
          ? "bg-emerald-500/10 text-emerald-400"
          : "bg-rose-500/10 text-rose-400",
      )}
    >
      {active ? (
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ShieldOff className="h-3 w-3" aria-hidden="true" />
      )}
      {active ? "Active" : "Revoked"}
    </span>
  );
}

function NewKeyBanner({
  rawKey,
  onDismiss,
}: {
  rawKey: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [rawKey]);

  return (
    <div className={CARD_HIGHLIGHT} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#d97757]">
            <Key className="h-4 w-4" aria-hidden="true" />
            New API key created
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
            Copy this key now. It will not be shown again.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-xs text-content">
            {rawKey}
          </code>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              copied
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-[#d97757] text-white hover:bg-[#c96a4d]",
            )}
          >
            <ClipboardCopy className="h-3 w-3" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-content-muted transition-colors hover:bg-white/[0.04]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyCard({
  record,
  onRevoke,
}: {
  record: ApiKeyRecord;
  onRevoke: (id: string) => void;
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  return (
    <div className={CARD_BASE} data-agent-id={record._id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Key
              className="h-3.5 w-3.5 shrink-0 text-content-muted/70"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-content">
              {record.label}
            </span>
            <StatusBadge active={record.isActive} />
          </div>
          <code className="mt-1.5 block font-mono text-[11px] text-content-muted/70">
            {maskKey(record.keyHashPrefix)}
          </code>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-content-muted/70">
            <span>Created {timeAgo(record.createdAt)}</span>
            <span>
              Last used:{" "}
              {record.lastUsedAt === record.createdAt
                ? "Never used"
                : timeAgo(record.lastUsedAt)}
            </span>
            <span>
              {record.rateLimits.perMinute}/min, {record.rateLimits.perDay}/day
            </span>
          </div>
          {record.permissions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {record.permissions.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-content-muted/70"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        {record.isActive && (
          <div className="shrink-0">
            {confirmRevoke ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-rose-400">Revoke?</span>
                <button
                  type="button"
                  onClick={() => {
                    onRevoke(record._id);
                    setConfirmRevoke(false);
                  }}
                  className="rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-400 transition-colors hover:bg-rose-500/30"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(false)}
                  className="rounded-lg border border-white/[0.06] px-2.5 py-1 text-[11px] text-content-muted transition-colors hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRevoke(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-[11px] font-medium text-content-muted transition-colors hover:border-rose-500/30 hover:text-rose-400"
                aria-label={`Revoke key ${record.label}`}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Revoke
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Usage dashboard — demo data                                        */
/* ------------------------------------------------------------------ */

interface DailyVolume {
  label: string;
  calls: number;
}

interface KeyUsageRow {
  keyLabel: string;
  keyPrefix: string;
  callsToday: number;
  callsThisWeek: number;
  avgLatencyMs: number;
  errorRate: number; // 0-1
}

const DEMO_DAILY_VOLUME: DailyVolume[] = [
  { label: "Mar 14", calls: 4_320 },
  { label: "Mar 15", calls: 6_810 },
  { label: "Mar 16", calls: 3_150 },
  { label: "Mar 17", calls: 8_920 },
  { label: "Mar 18", calls: 9_640 },
  { label: "Mar 19", calls: 7_450 },
  { label: "Mar 20", calls: 5_280 },
];

const DEMO_KEY_USAGE: KeyUsageRow[] = [
  {
    keyLabel: "cursor-dev",
    keyPrefix: "nb_key_a3f1",
    callsToday: 3_142,
    callsThisWeek: 18_740,
    avgLatencyMs: 142,
    errorRate: 0.012,
  },
  {
    keyLabel: "claude-prod",
    keyPrefix: "nb_key_7b2e",
    callsToday: 1_890,
    callsThisWeek: 14_220,
    avgLatencyMs: 98,
    errorRate: 0.003,
  },
  {
    keyLabel: "ci-pipeline",
    keyPrefix: "nb_key_e9c4",
    callsToday: 248,
    callsThisWeek: 1_680,
    avgLatencyMs: 210,
    errorRate: 0.045,
  },
];

const DEMO_RATE_LIMITS = {
  currentMinute: 37,
  limitMinute: 100,
  currentDay: 5_280,
  limitDay: 10_000,
};

/* ------------------------------------------------------------------ */
/*  Usage sub-components                                               */
/* ------------------------------------------------------------------ */

function barColor(ratio: number): string {
  if (ratio > 0.95) return "bg-rose-500";
  if (ratio > 0.8) return "bg-amber-500";
  return "bg-emerald-500";
}

function DailyVolumeChart({
  data,
  dayLimit,
}: {
  data: DailyVolume[];
  dayLimit: number;
}) {
  const maxCalls = Math.max(...data.map((d) => d.calls));
  return (
    <div className={CARD_BASE} data-agent-section="daily-volume-chart">
      <div className={SECTION_TITLE}>Daily call volume — last 7 days</div>
      <div className="flex items-end gap-2" style={{ height: 120 }}>
        {data.map((day) => {
          const ratio = day.calls / dayLimit;
          const heightPct = Math.max((day.calls / maxCalls) * 100, 4);
          return (
            <div
              key={day.label}
              className="flex flex-1 flex-col items-center gap-1"
              data-agent-bar={day.label}
            >
              <span className="text-[10px] tabular-nums text-content-muted/70">
                {day.calls >= 1000
                  ? `${(day.calls / 1000).toFixed(1)}k`
                  : day.calls}
              </span>
              <div className="relative w-full" style={{ height: 80 }}>
                <div
                  className={cn(
                    "absolute bottom-0 w-full rounded-t-md transition-all duration-500",
                    barColor(ratio),
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="text-[9px] text-content-muted/50">
                {day.label.replace("Mar ", "3/")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyBreakdownTable({ rows }: { rows: KeyUsageRow[] }) {
  return (
    <div className={CARD_BASE} data-agent-section="key-breakdown-table">
      <div className={SECTION_TITLE}>Per-key breakdown</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/[0.06] text-content-muted/60">
              <th className="pb-2 pr-4 font-medium">Key</th>
              <th className="pb-2 pr-4 text-right font-medium">Today</th>
              <th className="pb-2 pr-4 text-right font-medium">This week</th>
              <th className="pb-2 pr-4 text-right font-medium">Avg latency</th>
              <th className="pb-2 text-right font-medium">Error rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.keyPrefix}
                className="border-b border-white/[0.04] last:border-0"
                data-agent-row={row.keyLabel}
              >
                <td className="py-2 pr-4">
                  <div className="font-medium text-content">{row.keyLabel}</div>
                  <code className="text-[10px] text-content-muted/50">
                    {row.keyPrefix}...
                  </code>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-content-secondary">
                  {row.callsToday.toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-content-secondary">
                  {row.callsThisWeek.toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-content-secondary">
                  {row.avgLatencyMs}ms
                </td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      "tabular-nums",
                      row.errorRate > 0.03
                        ? "text-amber-400"
                        : "text-content-secondary",
                    )}
                  >
                    {(row.errorRate * 100).toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateLimitGauge({
  label,
  current,
  limit,
  unit,
}: {
  label: string;
  current: number;
  limit: number;
  unit: string;
}) {
  const ratio = current / limit;
  const pct = Math.min(ratio * 100, 100);
  return (
    <div className="flex-1" data-agent-gauge={label}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-content-secondary">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-content-muted/70">
          {current.toLocaleString()} / {limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barColor(ratio),
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RateLimitStatus({
  rateData,
}: {
  rateData: typeof DEMO_RATE_LIMITS;
}) {
  return (
    <div className={CARD_BASE} data-agent-section="rate-limit-status">
      <div className={SECTION_TITLE}>Rate limit status</div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <RateLimitGauge
          label="Current minute"
          current={rateData.currentMinute}
          limit={rateData.limitMinute}
          unit="calls"
        />
        <RateLimitGauge
          label="Current day"
          current={rateData.currentDay}
          limit={rateData.limitDay}
          unit="calls"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

function ApiKeyManagementPageInner() {
  const { ref, isVisible, instant } = useRevealOnMount();

  // ── Local state (swap for Convex hooks when deployed) ────────────
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  // ── Handlers ─────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    if (!labelInput.trim()) return;

    const rawKey = generateDemoKey();
    const prefix = rawKey.slice(0, 12);
    const now = Date.now();

    const record: ApiKeyRecord = {
      _id: `key_${now}`,
      keyHashPrefix: prefix,
      label: labelInput.trim(),
      permissions: ["tools:read", "tools:execute"],
      rateLimits: { perMinute: 100, perDay: 10_000 },
      createdAt: now,
      lastUsedAt: now,
      revokedAt: undefined,
      isActive: true,
    };

    setKeys((prev) => [record, ...prev]);
    setNewRawKey(rawKey);
    setLabelInput("");
    setShowForm(false);
  }, [labelInput]);

  const handleRevoke = useCallback((id: string) => {
    setKeys((prev) =>
      prev.map((k) =>
        k._id === id
          ? { ...k, revokedAt: Date.now(), isActive: false }
          : k,
      ),
    );
  }, []);

  // ── Stagger animation ───────────────────────────────────────────

  const stagger = useCallback(
    (delay: string): React.CSSProperties => ({
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "none" : "translateY(16px)",
      transition: instant ? "none" : "opacity 0.6s ease, transform 0.6s ease",
      transitionDelay: instant ? "0s" : delay,
    }),
    [isVisible, instant],
  );

  const activeKeys = keys.filter((k) => k.isActive);
  const revokedKeys = keys.filter((k) => !k.isActive);

  return (
    <div className="h-full overflow-y-auto">
      <div
        ref={ref}
        className="mx-auto max-w-3xl px-6 py-8"
        data-agent-surface="api-keys"
      >
        {/* Hero header */}
        <div style={stagger("0s")}>
          <h1 className="text-2xl font-bold tracking-tight text-content">
            API Keys
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-secondary">
            Manage access to NodeBench via MCP, REST API, or WebSocket gateway.
            Each key is scoped with permissions and rate limits.
          </p>
        </div>

        {/* Rate limit info */}
        <div
          style={stagger("0.05s")}
          className="mt-4 flex items-center gap-2 text-[11px] text-content-muted/70"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Default limits: 100 calls/min, 10,000 calls/day per key</span>
        </div>

        <div
          style={stagger("0.08s")}
          className="mt-6 rounded-xl border border-[#d97757]/30 bg-[#d97757]/[0.06] p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-content">
                <Link2 className="h-4 w-4 text-[#d97757]" aria-hidden="true" />
                Public research starts without a key
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-secondary">
                External apps can call the hosted `public-research` and `gmail-research`
                MCP profiles anonymously for the first sourced dossier. Create a key when
                the user links NodeBench for saved history, higher limits, team usage,
                webhooks, and billing controls.
              </p>
            </div>
            <code className="shrink-0 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-content">
              ?profile=gmail-research
            </code>
          </div>
        </div>

        {/* New key banner */}
        {newRawKey && (
          <div style={stagger("0.1s")} className="mt-6">
            <NewKeyBanner
              rawKey={newRawKey}
              onDismiss={() => setNewRawKey(null)}
            />
          </div>
        )}

        {/* Create key section */}
        <div style={stagger("0.15s")} className="mt-8">
          {showForm ? (
            <div className={CARD_BASE}>
              <div className={SECTION_TITLE}>Create new key</div>
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="key-label"
                    className="block text-[11px] font-medium text-content-muted/70"
                  >
                    Label
                  </label>
                  <input
                    id="key-label"
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setShowForm(false);
                        setLabelInput("");
                      }
                    }}
                    placeholder="e.g. cursor-dev, claude-prod, ci-pipeline"
                    className="mt-1 w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-content placeholder:text-content-muted/40 focus:border-[#d97757]/50 focus:outline-none focus:ring-1 focus:ring-[#d97757]/30"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!labelInput.trim()}
                  className="shrink-0 rounded-xl bg-[#d97757] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[#d97757]/20 transition-colors hover:bg-[#c96a4d] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create key
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setLabelInput("");
                  }}
                  className="shrink-0 rounded-xl border border-white/[0.06] px-4 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#d97757] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#d97757]/20 transition-colors hover:bg-[#c96a4d]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create new key
            </button>
          )}
        </div>

        {/* Active keys */}
        <div style={stagger("0.2s")} className="mt-8">
          <div className={SECTION_TITLE}>
            Active keys ({activeKeys.length})
          </div>
          {activeKeys.length === 0 && revokedKeys.length === 0 ? (
            <div className={CARD_BASE}>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Key
                  className="h-8 w-8 text-content-muted/30"
                  aria-hidden="true"
                />
                <p className="mt-3 text-sm text-content-muted">
                  No API keys yet.
                </p>
                <p className="mt-1 text-[11px] text-content-muted/70">
                  Create one to connect external agents to NodeBench.
                </p>
              </div>
            </div>
          ) : activeKeys.length === 0 ? (
            <p className="text-sm text-content-muted/70">
              No active keys. Create a new one above.
            </p>
          ) : (
            <div className="space-y-3">
              {activeKeys.map((k) => (
                <KeyCard key={k._id} record={k} onRevoke={handleRevoke} />
              ))}
            </div>
          )}
        </div>

        {/* Revoked keys */}
        {revokedKeys.length > 0 && (
          <div style={stagger("0.25s")} className="mt-8">
            <div className={SECTION_TITLE}>
              Revoked keys ({revokedKeys.length})
            </div>
            <div className="space-y-3 opacity-60">
              {revokedKeys.map((k) => (
                <KeyCard key={k._id} record={k} onRevoke={handleRevoke} />
              ))}
            </div>
          </div>
        )}

        {/* ── Usage dashboard ─────────────────────────────────── */}
        <div style={stagger("0.3s")} className="mt-10" data-agent-surface="api-key-usage">
          <div className="mb-5 flex items-center gap-2">
            <Activity className="h-4 w-4 text-content-muted/70" aria-hidden="true" />
            <h2 className="text-lg font-semibold tracking-tight text-content">
              Usage
            </h2>
          </div>

          <div className="space-y-4">
            <div style={stagger("0.35s")}>
              <DailyVolumeChart
                data={DEMO_DAILY_VOLUME}
                dayLimit={DEMO_RATE_LIMITS.limitDay}
              />
            </div>

            <div style={stagger("0.4s")}>
              <KeyBreakdownTable rows={DEMO_KEY_USAGE} />
            </div>

            <div style={stagger("0.45s")}>
              <RateLimitStatus rateData={DEMO_RATE_LIMITS} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ApiKeyManagementPage = memo(ApiKeyManagementPageInner);
export default ApiKeyManagementPage;
