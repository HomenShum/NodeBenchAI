/**
 * VoiceAuditFeed — list of recent realtime voice gate decisions for a user.
 *
 * Pattern: Read-only telemetry surface; subscribes to
 * `voice/realtimeAudit:listForUser` (landed in PR #274). Renders the gate +
 * decision + rationale + timestamp for each event so users can see why a
 * voice capture was redacted, queued for async, or persisted.
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (RealtimeAuditEvent)
 *
 * Glass card DNA: bg-surface/80 backdrop-blur-md border border-edge/40
 * Section header: text-[11px] uppercase tracking-[0.12em] text-content-muted
 * Terracotta accent: #d97757 for active/CTA states (rendered via tailwind tokens)
 */

import { useQuery } from "convex/react";
import { useMemo } from "react";
// The api object has the new realtimeAudit module after PR #274's codegen.
// Until codegen runs in CI, fall back to a relaxed lookup so tsc passes.
import { api } from "@/convex/_generated/api";

type AuditGate =
  | "anonymous_no_persist"
  | "anonymous_to_linked"
  | "budget_cap_hit"
  | "budget_warning_80pct"
  | "pii_redacted"
  | "idempotent_replay"
  | "escalation_to_async"
  | "approval_required"
  | "approval_granted"
  | "approval_rejected"
  | "model_routing"
  | "session_terminated_pii"
  | "session_terminated_cap";

type AuditDecision =
  | "allowed"
  | "denied"
  | "needs_consent"
  | "needs_approval"
  | "downgraded";

interface AuditEvent {
  _id: string;
  userId?: string;
  anonId?: string;
  sessionId?: string;
  gate: AuditGate;
  decision: AuditDecision;
  rationale?: string;
  metadata?: {
    modelTier?: string;
    capUsd?: number;
    spentUsd?: number;
    idempotencyKey?: string;
    redactedSpanCount?: number;
    temporalJobId?: string;
  };
  createdAt: number;
}

interface VoiceAuditFeedProps {
  userId: string; // user's Convex id, passed in by parent surface
  limit?: number; // default 20 — bounded query caps at 200 server-side
  className?: string;
}

const GATE_LABELS: Record<AuditGate, string> = {
  anonymous_no_persist: "Anonymous · no private memory",
  anonymous_to_linked: "Linked to account",
  budget_cap_hit: "Daily voice cap hit",
  budget_warning_80pct: "80% of voice cap",
  pii_redacted: "PII redacted",
  idempotent_replay: "Duplicate · returned cached",
  escalation_to_async: "Queued for deep research",
  approval_required: "Awaiting approval",
  approval_granted: "Approved",
  approval_rejected: "Rejected",
  model_routing: "Routed to model tier",
  session_terminated_pii: "Session ended · PII",
  session_terminated_cap: "Session ended · cap",
};

const DECISION_TONES: Record<AuditDecision, string> = {
  allowed: "text-emerald-300/90 border-emerald-300/40 bg-emerald-500/10",
  denied: "text-rose-300/90 border-rose-300/40 bg-rose-500/10",
  needs_consent: "text-amber-300/90 border-amber-300/40 bg-amber-500/10",
  needs_approval: "text-amber-300/90 border-amber-300/40 bg-amber-500/10",
  downgraded: "text-orange-300/90 border-orange-300/40 bg-orange-500/10",
};

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function VoiceAuditFeed({ userId, limit = 20, className }: VoiceAuditFeedProps): JSX.Element {
  // Type-erased lookup — `api.domains.integrations.voice.realtimeAudit.listForUser`
  // lands when codegen runs against PR #274. Until then, the runtime path is
  // valid; tsc tolerates the cast.
  const queryRef = (api as unknown as {
    domains: { integrations: { voice: { realtimeAudit: { listForUser: unknown } } } };
  }).domains.integrations.voice.realtimeAudit.listForUser;

  const events = useQuery(
    queryRef as Parameters<typeof useQuery>[0],
    { userId, limit } as Parameters<typeof useQuery>[1],
  ) as AuditEvent[] | undefined;

  const isLoading = events === undefined;
  const isEmpty = events !== undefined && events.length === 0;

  const sorted = useMemo(() => {
    if (!events) return [];
    return [...events].sort((a, b) => b.createdAt - a.createdAt);
  }, [events]);

  return (
    <section
      role="region"
      aria-label="Voice audit feed"
      className={[
        "rounded-2xl border border-edge/40 bg-surface/80 backdrop-blur-md",
        "p-4 sm:p-5",
        className ?? "",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-3 pb-3">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-content-muted">
          Voice gate decisions
        </h3>
        {!isLoading && !isEmpty && (
          <span className="text-[11px] text-content-muted/80">
            {sorted.length} event{sorted.length === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {isLoading && (
        <ul className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="h-12 rounded-lg border border-edge/20 bg-content/[0.03] animate-pulse"
            />
          ))}
        </ul>
      )}

      {isEmpty && (
        <p className="text-sm text-content-muted">
          No voice gate decisions yet. Capture a voice note to populate this
          feed — or check that <code className="px-1 rounded bg-content/[0.05]">CONVEX_URL</code> is configured on the gateway.
        </p>
      )}

      {!isLoading && !isEmpty && (
        <ol className="space-y-2">
          {sorted.map((evt) => (
            <li
              key={evt._id}
              className="flex flex-col gap-1.5 rounded-lg border border-edge/20 bg-content/[0.02] p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-content">
                    {GATE_LABELS[evt.gate] ?? evt.gate}
                  </span>
                  <span
                    className={[
                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                      DECISION_TONES[evt.decision] ?? "text-content border-edge/40 bg-content/[0.05]",
                    ].join(" ")}
                  >
                    {evt.decision.replace(/_/g, " ")}
                  </span>
                </div>
                {evt.rationale && (
                  <p className="mt-1 line-clamp-2 text-xs text-content-muted">
                    {evt.rationale}
                  </p>
                )}
                {evt.metadata && (
                  <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-content-muted/80 font-mono">
                    {evt.metadata.modelTier && (
                      <div>
                        <dt className="inline">tier:</dt>{" "}
                        <dd className="inline">{evt.metadata.modelTier}</dd>
                      </div>
                    )}
                    {typeof evt.metadata.spentUsd === "number" && (
                      <div>
                        <dt className="inline">spent:</dt>{" "}
                        <dd className="inline">${evt.metadata.spentUsd.toFixed(3)}</dd>
                      </div>
                    )}
                    {typeof evt.metadata.redactedSpanCount === "number" &&
                      evt.metadata.redactedSpanCount > 0 && (
                        <div>
                          <dt className="inline">redactions:</dt>{" "}
                          <dd className="inline">{evt.metadata.redactedSpanCount}</dd>
                        </div>
                      )}
                  </dl>
                )}
              </div>
              <time
                dateTime={new Date(evt.createdAt).toISOString()}
                className="shrink-0 text-[11px] text-content-muted/80 font-mono"
              >
                {formatRelativeTime(evt.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
