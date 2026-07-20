/**
 * DelegationShowcase - scoped permissions, approval gates, and trust boundaries.
 */

import { memo, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowRight, Database, KeyRound, Lock, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { ReceiptApprovalQueue } from "../components/ReceiptApprovalQueue";
import { ReceiptCard } from "../components/ReceiptCard";
import { DEMO_PASSPORT, DEMO_RECEIPTS } from "../data/receiptFixtures";
import { toActionReceipt } from "../lib/receiptPresentation";
import type { ActionReceipt } from "../types/actionReceipt";
import type { TrustTier } from "../types/agentPassport";

const TIER_STYLES: Record<TrustTier, { label: string; className: string }> = {
  sandbox: { label: "Sandbox", className: "border-edge bg-surface-secondary/50 text-content-muted" },
  supervised: { label: "Supervised", className: "border-amber-500/20 bg-amber-500/10 text-amber-400" },
  autonomous: { label: "Autonomous", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" },
};

const PERMISSION_STYLES = {
  allowed: {
    label: "Allowed",
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    marker: <ShieldCheck className="h-3.5 w-3.5" />,
  },
  escalated: {
    label: "Require approval",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    marker: <ShieldAlert className="h-3.5 w-3.5" />,
  },
  denied: {
    label: "Deny",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
    marker: <ShieldX className="h-3.5 w-3.5" />,
  },
} as const;

const GRAPH_NODE_STYLES = {
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  indigo: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300",
  red: "border-red-500/20 bg-red-500/10 text-red-300",
} as const;

function GraphNodeCard({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: keyof typeof GRAPH_NODE_STYLES;
}) {
  return (
    <div className={cn("rounded-xl border px-3 py-3 text-center", GRAPH_NODE_STYLES[tone])}>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-[11px] text-inherit/80">{detail}</div>
    </div>
  );
}

export const DelegationShowcase = memo(function DelegationShowcase() {
  const passport = DEMO_PASSPORT;
  const tier = TIER_STYLES[passport.trustTier];
  const liveEscalated = useQuery(api.domains.agents.receipts.actionReceipts.list, {
    policyAction: "escalated",
    limit: 20,
  });

  const escalatedReceipts = useMemo(() => {
    if (!liveEscalated || liveEscalated.length === 0) {
      return DEMO_RECEIPTS.filter((receipt) => receipt.policyRef.action === "escalated");
    }
    return liveEscalated.map((row) => toActionReceipt(row as Record<string, unknown>)) as ActionReceipt[];
  }, [liveEscalated]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const permissionRows = useMemo(
    () => [
      ...passport.allowedTools.map((tool) => ({ tool, permission: "allowed" as const })),
      ...passport.escalatedTools.map((tool) => ({ tool, permission: "escalated" as const })),
      ...passport.deniedTools.map((tool) => ({ tool, permission: "denied" as const })),
    ],
    [passport.allowedTools, passport.deniedTools, passport.escalatedTools],
  );
  const scopeToken = useMemo(
    () => ({
      passport_id: passport.passportId,
      subject_type: "agent",
      subject_id: "financial-analyst-02",
      agent_id: "financial-analyst-02",
      created_at: passport.createdAt,
      revoked_at: passport.revokedAt,
      scopes: [
        ...passport.dataScope.map((scope) => ({ resource: scope, action: "read" })),
        ...passport.allowedTools.map((tool) => ({ resource: `tool:${tool}`, action: "execute" })),
      ],
      approval_policy: {
        mode: passport.trustTier,
        requires_human_approval: passport.escalatedTools.length > 0,
        max_spend_usd: passport.spendLimit,
      },
    }),
    [passport],
  );
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-400" />
          <h1 className="text-xl font-semibold tracking-tight text-content">Passport &amp; Delegation</h1>
        </div>
        <p className="text-sm text-content-muted">
          Scope tools, approvals, and authority before an agent acts. This passport can read public filings
          and create briefs, but it cannot execute trades and must request approval before external sharing.
        </p>
      </div>

      <section aria-labelledby="passport-heading" className="space-y-3">
        <h2 id="passport-heading" className="text-sm font-medium text-content-secondary">
          Agent Passport
        </h2>
        <div className="space-y-4 rounded-xl border border-edge bg-surface-secondary/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium text-content">{passport.displayName}</div>
              <div className="mt-0.5 font-mono text-xs text-content-muted">{passport.passportId}</div>
            </div>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", tier.className)}>
              {tier.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-edge bg-surface-secondary/50 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1 text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="text-lg font-semibold">{passport.allowedTools.length}</span>
              </div>
              <div className="text-[11px] font-medium text-content-muted">Allowed</div>
            </div>
            <div className="rounded-lg border border-edge bg-surface-secondary/50 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1 text-red-400">
                <ShieldX className="h-3.5 w-3.5" />
                <span className="text-lg font-semibold">{passport.deniedTools.length}</span>
              </div>
              <div className="text-[11px] font-medium text-content-muted">Denied</div>
            </div>
            <div className="rounded-lg border border-edge bg-surface-secondary/50 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1 text-amber-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span className="text-lg font-semibold">{passport.escalatedTools.length}</span>
              </div>
              <div className="text-[11px] font-medium text-content-muted">Needs approval</div>
            </div>
            <div className="rounded-lg border border-edge bg-surface-secondary/50 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1 text-content-muted">
                <Lock className="h-3.5 w-3.5" />
                <span className="text-lg font-semibold">${passport.spendLimit}</span>
              </div>
              <div className="text-[11px] font-medium text-content-muted">Spend Limit</div>
            </div>
          </div>

          <div className="text-xs">
            <div className="mb-1.5 flex items-center gap-1 font-medium text-content-muted">
              <Database className="h-3 w-3" />
              Data Scope
            </div>
            <div className="flex flex-wrap gap-1.5">
              {passport.dataScope.map((scope) => (
                <span
                  key={scope}
                  className="inline-flex rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] text-indigo-400"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="passport-scope-matrix-heading" className="space-y-3">
        <div>
          <h2 id="passport-scope-matrix-heading" className="text-sm font-medium text-content-secondary">
            Passport scope matrix
          </h2>
          <p className="mt-1 text-xs text-content-muted">
            Tool-level delegation policy for this passport. Approval-gated actions inherit the same subject but narrow execution behind a human checkpoint.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-edge bg-surface-secondary/50">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-edge/60 bg-black/10 text-content-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Allowed</th>
                <th className="px-4 py-3 font-medium">Require Approval</th>
                <th className="px-4 py-3 font-medium">Deny</th>
              </tr>
            </thead>
            <tbody>
              {permissionRows.map((row) => (
                <tr key={row.tool} className="border-b border-edge/40 last:border-b-0">
                  <td className="px-4 py-3 font-mono text-[11px] text-content-secondary">{row.tool}</td>
                  {(["allowed", "escalated", "denied"] as const).map((permission) => {
                    const selected = row.permission === permission;
                    const style = PERMISSION_STYLES[permission];
                    return (
                      <td key={permission} className="px-4 py-3">
                        {selected ? (
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 font-medium", style.className)}>
                            {style.marker}
                            {style.label}
                          </span>
                        ) : (
                          <span className="text-content-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="scope-token-heading" className="space-y-3">
        <div>
          <h2 id="scope-token-heading" className="text-sm font-medium text-content-secondary">
            Scope token object
          </h2>
          <p className="mt-1 text-xs text-content-muted">
            Demo token aligned to the headless <code className="font-mono text-[11px]">V2Passport</code> shape so the UI mirrors the current API contract.
          </p>
        </div>
        <div className="rounded-xl border border-edge bg-black/20 p-4">
          <pre className="overflow-x-auto text-[11px] leading-5 text-content-secondary">{JSON.stringify(scopeToken, null, 2)}</pre>
        </div>
      </section>

      <section aria-labelledby="delegation-graph-heading" className="space-y-3">
        <div>
          <h2 id="delegation-graph-heading" className="text-sm font-medium text-content-secondary">
            Delegation graph v0
          </h2>
          <p className="mt-1 text-xs text-content-muted">
            Visualizes how the supervisor issues a scoped passport and where authority narrows into allowed, approval-gated, and denied paths.
          </p>
        </div>
        <div className="rounded-xl border border-edge bg-surface-secondary/50 p-4">
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-center">
              <GraphNodeCard title="Human supervisor" detail="Issues and audits the passport" tone="amber" />
              <div className="hidden items-center justify-center md:flex text-content-muted">
                <ArrowRight className="h-4 w-4" />
              </div>
              <GraphNodeCard
                title="Financial Analyst Passport"
                detail="Supervised tier · spend limit $0 · public research only"
                tone="emerald"
              />
            </div>

            <div className="hidden md:block">
              <div className="mx-auto h-6 w-px bg-edge" />
              <div className="mx-auto h-px w-2/3 bg-edge" />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <div className="hidden md:block mx-auto h-4 w-px bg-edge" />
                <GraphNodeCard
                  title="Public data scope"
                  detail="web_search, fetch_url, analyze_data · read public_filings/news_articles/market_data"
                  tone="indigo"
                />
              </div>
              <div className="space-y-2">
                <div className="hidden md:block mx-auto h-4 w-px bg-edge" />
                <GraphNodeCard
                  title="Approval gate"
                  detail="send_email, publish_report, share_externally require human sign-off"
                  tone="amber"
                />
              </div>
              <div className="space-y-2">
                <div className="hidden md:block mx-auto h-4 w-px bg-edge" />
                <GraphNodeCard
                  title="Denied sink"
                  detail="execute_trade, transfer_funds, delete_data never inherit authority"
                  tone="red"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="approvals-heading" className="space-y-3">
        <h2 id="approvals-heading" className="text-sm font-medium text-content-secondary">
          Pending Approvals
        </h2>
        <p className="text-xs text-content-muted">
          Receipt-backed OpenClaw actions held for human review before execution.
        </p>
        <ReceiptApprovalQueue compact maxItems={5} />
      </section>

      <section aria-labelledby="escalation-heading" className="space-y-3">
        <h2 id="escalation-heading" className="text-sm font-medium text-content-secondary">
          Needs Approval Log
        </h2>
        <p className="text-xs text-content-muted">
          Recent actions that required approval, were held for review, or crossed delegation boundaries.
        </p>
        <div className="space-y-2">
          {escalatedReceipts.map((receipt) => (
            <ReceiptCard
              key={receipt.receiptId}
              receipt={receipt}
              isExpanded={expandedIds.has(receipt.receiptId)}
              onToggle={() => toggleExpand(receipt.receiptId)}
            />
          ))}
          {escalatedReceipts.length === 0 && (
            <div className="py-8 text-center text-sm text-content-muted">No approval-gated actions in the current dataset.</div>
          )}
        </div>
      </section>

      <div className="border-t border-edge/30 pt-4 text-center text-[11px] text-content-muted">
        Demo mode. Showing the golden dataset passport and approval log.
      </div>
    </div>
  );
});

export default DelegationShowcase;
