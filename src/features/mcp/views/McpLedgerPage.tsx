import { memo, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock3,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { SharedContextProtocolPanel } from "@/features/mcp/components/SharedContextProtocolPanel";
import { SyncBridgeAccountPanel } from "@/features/mcp/components/SyncBridgeAccountPanel";
import { cn } from "@/lib/utils";

type LedgerCall = {
  _id: string;
  toolName: string;
  toolType: string;
  riskTier: string;
  allowed: boolean;
  policy?: unknown;
  argsHash: string;
  argsKeys: string[];
  argsPreview?: string;
  idempotencyKey?: string;
  requestMeta?: unknown;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
  resultPreview?: string;
  resultBytes?: number;
};

type LedgerPayload = {
  calls: LedgerCall[];
  hasMore: boolean;
  nextCursor?: string;
};

type PolicyPayload = {
  dateKey: string;
  config: {
    name: string;
    enforce: boolean;
    notes?: string;
  };
  usageByTier: Array<{
    tier: string;
    count: number;
    limit?: number;
  }>;
};

function formatTimestamp(value?: number) {
  if (!value) return "Pending";
  return new Date(value).toLocaleString();
}

function formatDuration(value?: number) {
  if (!value || value < 0) return "Pending";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(1)}s`;
}

function StatusPill({
  allowed,
  success,
}: {
  allowed: boolean;
  success?: boolean;
}) {
  if (!allowed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-300">
        <ShieldX className="h-3 w-3" />
        Blocked
      </span>
    );
  }

  if (success === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
        <ShieldAlert className="h-3 w-3" />
        Failed
      </span>
    );
  }

  if (success === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="h-3 w-3" />
        Allowed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
      <Clock3 className="h-3 w-3" />
      Running
    </span>
  );
}

export const McpLedgerPage = memo(function McpLedgerPage() {
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const ledger = useQuery(
    (api as any)?.domains?.mcp?.mcpToolLedger?.listToolCalls ?? ("skip" as never),
    (api as any)?.domains?.mcp?.mcpToolLedger?.listToolCalls
      ? ({ limit: 50 } as never)
      : ("skip" as never),
  ) as LedgerPayload | undefined;

  const policy = useQuery(
    (api as any)?.domains?.mcp?.mcpToolLedger?.getPolicyAndUsage ?? ("skip" as never),
    (api as any)?.domains?.mcp?.mcpToolLedger?.getPolicyAndUsage
      ? ({} as never)
      : ("skip" as never),
  ) as PolicyPayload | undefined;

  const calls = ledger?.calls ?? [];
  const operatorLocked = policy?.config.name === "operator-only";
  const stats = useMemo(() => {
    const blocked = calls.filter((call) => !call.allowed).length;
    const failed = calls.filter((call) => call.allowed && call.success === false).length;
    const running = calls.filter((call) => call.allowed && typeof call.success !== "boolean").length;
    return {
      total: calls.length,
      blocked,
      failed,
      running,
    };
  }, [calls]);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-6 py-8" data-testid="mcp-ledger-view">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-content-muted">
          <Activity className="h-3.5 w-3.5" />
          Tool Activity
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-content">MCP Ledger</h1>
        <p className="max-w-3xl text-sm leading-6 text-content-secondary">
          Review tool calls, policy decisions, paired-device state, and shared-context traffic without leaving the audit surface.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Recent calls", value: stats.total },
          { label: "Blocked", value: stats.blocked },
          { label: "Failed", value: stats.failed },
          { label: "Running", value: stats.running },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-edge bg-surface p-4">
            <div className="text-xs text-content-muted">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-content">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr,0.7fr]">
        <div className="rounded-2xl border border-edge bg-surface">
          <div className="border-b border-edge px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-content">Ledger stream</h2>
                <p className="mt-1 text-xs text-content-muted">
                  Expand a row to inspect policy, request metadata, and redacted previews.
                </p>
              </div>
              {policy ? (
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    policy.config.enforce
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  Policy {policy.config.enforce ? "enforced" : "observe-only"}
                </span>
              ) : null}
            </div>
          </div>

          <div className="divide-y divide-edge">
            {ledger === undefined ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="space-y-2 px-4 py-4">
                  <div className="h-4 w-48 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-3 w-72 animate-pulse rounded bg-white/[0.04]" />
                </div>
              ))
            ) : calls.length === 0 ? (
              <div className="px-4 py-10 text-sm text-content-muted">
                {operatorLocked
                  ? "MCP tool-call previews are operator-only. Sign in as an admin to inspect request metadata, results, account keys, and cost rows."
                  : "No MCP tool calls have been recorded yet."}
              </div>
            ) : (
              calls.map((call) => {
                const isExpanded = expandedCallId === call._id;
                return (
                  <div key={call._id}>
                    <button
                      type="button"
                      onClick={() => setExpandedCallId(isExpanded ? null : call._id)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-content">{call.toolName}</span>
                          <StatusPill allowed={call.allowed} success={call.success} />
                          <span className="rounded-full border border-edge bg-background/50 px-2 py-0.5 text-[11px] text-content-muted">
                            {call.riskTier}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-content-muted">
                          <span>{call.toolType || "unknown"}</span>
                          <span>•</span>
                          <span>{formatTimestamp(call.startedAt)}</span>
                          <span>•</span>
                          <span>{formatDuration(call.durationMs)}</span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />
                      ) : (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />
                      )}
                    </button>

                    {isExpanded ? (
                      <div className="grid gap-3 border-t border-edge bg-background/40 px-4 py-4 md:grid-cols-2">
                        <div className="space-y-3">
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-content-muted">
                              Request
                            </div>
                            <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-surface px-3 py-2 text-[11px] leading-5 text-content-secondary">
                              {call.argsPreview ?? "No request preview"}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-content-muted">
                              Result
                            </div>
                            <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-surface px-3 py-2 text-[11px] leading-5 text-content-secondary">
                              {call.resultPreview ?? call.errorMessage ?? "Pending result"}
                            </pre>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-lg border border-edge bg-surface px-3 py-2 text-[11px] leading-5 text-content-secondary">
                            <div><span className="font-medium text-content">Args hash:</span> {call.argsHash}</div>
                            <div><span className="font-medium text-content">Finished:</span> {formatTimestamp(call.finishedAt)}</div>
                            <div><span className="font-medium text-content">Idempotency:</span> {call.idempotencyKey ?? "—"}</div>
                            <div><span className="font-medium text-content">Result bytes:</span> {call.resultBytes ?? "—"}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-content-muted">
                              Policy / metadata
                            </div>
                            <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-surface px-3 py-2 text-[11px] leading-5 text-content-secondary">
                              {JSON.stringify(
                                {
                                  argsKeys: call.argsKeys,
                                  policy: call.policy,
                                  requestMeta: call.requestMeta,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-edge bg-surface p-4">
            <h2 className="text-sm font-semibold text-content">Policy snapshot</h2>
            {policy === undefined ? (
              <div className="mt-3 space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-4 w-full animate-pulse rounded bg-white/[0.04]" />
              </div>
            ) : (
              <>
                <div className="mt-3 text-xs text-content-muted">
                  {policy.config.name} • {policy.dateKey}
                </div>
                <p className="mt-2 text-sm leading-6 text-content-secondary">
                  {policy.config.notes ?? "No policy note attached."}
                </p>
                <div className="mt-4 space-y-2">
                  {policy.usageByTier.length === 0 ? (
                    <div className="text-xs text-content-muted">No tier usage recorded for this UTC day yet.</div>
                  ) : (
                    policy.usageByTier.map((item) => (
                      <div key={item.tier} className="flex items-center justify-between rounded-lg border border-edge bg-background/40 px-3 py-2 text-xs">
                        <span className="font-medium text-content">{item.tier}</span>
                        <span className="text-content-secondary">
                          {item.count}
                          {typeof item.limit === "number" ? ` / ${item.limit}` : ""}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <SyncBridgeAccountPanel />
          <SharedContextProtocolPanel />
        </div>
      </section>
    </div>
  );
});

export default McpLedgerPage;
