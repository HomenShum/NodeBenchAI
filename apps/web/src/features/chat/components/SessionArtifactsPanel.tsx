/**
 * SessionArtifactsPanel — the ambient right-rail that accumulates agent-
 * generated candidates during a chat session. User reviews at wrap-up.
 *
 * Pattern: batched end-of-session review (Claude Code "files changed" +
 *          Perplexity Lab artifacts rail).
 *
 * Prior art:
 *   - Claude Code — post-task summary of files changed
 *   - Perplexity Lab — live generated-artifacts right-rail
 *   - Cursor Composer — review edits before commit
 *
 * See: .claude/rules/scratchpad_first.md
 *      .claude/rules/async_reliability.md
 *      docs/architecture/AGENT_PIPELINE.md
 *      convex/domains/product/sessionArtifacts.ts
 *
 * UX invariants:
 *  - Ambient during active chat — collapsible, never steals focus
 *  - Empty state never says "nothing here" — always actionable copy
 *  - Every artifact carries its EvidenceChip so confidence is scannable
 *  - "Verified" tier defaults to pre-checked; other tiers start unchecked
 *  - Single keep/dismiss click is reversible via undoDecision mutation
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { useConvexApi } from "@/lib/convexApi";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import {
  EvidenceChip,
  type EvidenceTier,
} from "@/features/entities/components/EvidenceChip";

type ArtifactKind =
  | "company"
  | "founder"
  | "product"
  | "funding"
  | "news"
  | "hiring"
  | "patent"
  | "publicOpinion"
  | "competitor"
  | "regulatory"
  | "memo";

type ArtifactStatus = "pending" | "kept" | "dismissed" | "auto";

type SessionArtifactRow = {
  _id: string;
  artifactKind: ArtifactKind;
  displayName: string;
  summary?: string;
  confidenceTier?: EvidenceTier;
  sourceCount?: number;
  sourceLabel?: string;
  status: ArtifactStatus;
};

export type SessionArtifactsPanelProps = {
  sessionId: string;
  /** Collapsible; starts expanded by default. */
  defaultCollapsed?: boolean;
  className?: string;
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  company: "Companies",
  founder: "Founders",
  product: "Products",
  funding: "Funding",
  news: "News",
  hiring: "Hiring",
  patent: "Patents",
  publicOpinion: "Public opinion",
  competitor: "Competitors",
  regulatory: "Regulatory",
  memo: "Memos",
};

/** Order the kinds so related items cluster visually. */
const KIND_ORDER: ArtifactKind[] = [
  "company",
  "founder",
  "product",
  "funding",
  "news",
  "hiring",
  "patent",
  "publicOpinion",
  "competitor",
  "regulatory",
  "memo",
];

export function SessionArtifactsPanel({
  sessionId,
  defaultCollapsed = false,
  className,
}: SessionArtifactsPanelProps) {
  const api = useConvexApi();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Live query — updates as the agent emits new candidates.
  const result = useQuery(
    api.domains.product.sessionArtifacts.listForSession as never,
    (sessionId ? { sessionId } : "skip") as any,
  ) as
    | {
        pending: SessionArtifactRow[];
        kept: SessionArtifactRow[];
        auto: SessionArtifactRow[];
        dismissed: SessionArtifactRow[];
        pendingCount: number;
      }
    | undefined;

  const keepArtifact = useMutation(
    api.domains.product.sessionArtifacts.keepArtifact as never,
  );
  const dismissArtifact = useMutation(
    api.domains.product.sessionArtifacts.dismissArtifact as never,
  );
  const keepAllVerified = useMutation(
    api.domains.product.sessionArtifacts.keepAllVerified as never,
  );
  const dismissAllPending = useMutation(
    api.domains.product.sessionArtifacts.dismissAllPending as never,
  );

  // Group pending by kind for clean rendering.
  const pendingByKind = useMemo(() => {
    const map = new Map<ArtifactKind, SessionArtifactRow[]>();
    for (const row of result?.pending ?? []) {
      const list = map.get(row.artifactKind) ?? [];
      list.push(row);
      map.set(row.artifactKind, list);
    }
    return map;
  }, [result?.pending]);

  const hasAny =
    (result?.pending?.length ?? 0) > 0 ||
    (result?.kept?.length ?? 0) > 0 ||
    (result?.auto?.length ?? 0) > 0;

  const pendingCount = result?.pendingCount ?? 0;

  return (
    <aside
      className={cn(
        "flex flex-col rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]",
        className,
      )}
      aria-labelledby="session-artifacts-heading"
    >
      {/* Header — collapsible */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="session-artifacts-body"
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757] dark:hover:bg-white/[0.04]"
      >
        <span className="flex items-center gap-2 min-w-0">
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          )}
          <h3
            id="session-artifacts-heading"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate"
          >
            This session
          </h3>
          {pendingCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-[#d97757]/10 px-2 py-0.5 text-[10px] font-medium text-[#d97757] dark:bg-[#d97757]/15">
              {pendingCount} {pendingCount === 1 ? "pending" : "pending"}
            </span>
          ) : null}
        </span>
      </button>

      {/* Body */}
      {!collapsed ? (
        <div
          id="session-artifacts-body"
          className="border-t border-gray-100 px-3 py-3 dark:border-white/[0.06]"
        >
          {/* Loading state — honest, not decorative */}
          {result === undefined ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400">
              Loading session artifacts…
            </div>
          ) : !hasAny ? (
            <div
              role="status"
              className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400"
            >
              Start a run to populate this panel. As the agent identifies companies, founders, products, and other artifacts, they'll appear here for you to keep or dismiss.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Pending — grouped by kind, with checkbox per item */}
              {pendingCount > 0 ? (
                <div className="flex flex-col gap-2">
                  {KIND_ORDER.filter((k) => pendingByKind.has(k)).map((kind) => {
                    const rows = pendingByKind.get(kind)!;
                    return (
                      <div key={kind} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                            {KIND_LABEL[kind]} ({rows.length})
                          </span>
                        </div>
                        <ul className="flex flex-col gap-1.5">
                          {rows.map((row) => (
                            <li
                              key={row._id}
                              className="flex items-start gap-2 rounded-md border border-gray-100 bg-white px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                                    {row.displayName}
                                  </span>
                                  {row.confidenceTier ? (
                                    <EvidenceChip
                                      tier={row.confidenceTier}
                                      sourceCount={row.sourceCount}
                                      sourceLabel={row.sourceLabel}
                                      compact
                                    />
                                  ) : null}
                                </div>
                                {row.summary ? (
                                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                    {row.summary}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void keepArtifact({ artifactId: row._id as never });
                                  }}
                                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                                  aria-label={`Keep ${row.displayName}`}
                                >
                                  Keep
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void dismissArtifact({ artifactId: row._id as never });
                                  }}
                                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
                                  aria-label={`Dismiss ${row.displayName}`}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}

                  {/* Bulk actions */}
                  <div className="mt-1.5 flex gap-1.5 border-t border-gray-100 pt-2 dark:border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => {
                        void keepAllVerified({ sessionId } as any);
                      }}
                      className="flex-1 rounded-md bg-[#d97757] px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#c4663d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
                    >
                      Keep verified
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void dismissAllPending({ sessionId } as any);
                      }}
                      className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
                    >
                      Dismiss all
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Kept summary — click to jump to the associated Reports */}
              {(result?.kept?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set("surface", "research");
                    params.set("session", sessionId);
                    navigate(`/?${params.toString()}`);
                  }}
                  className="group flex w-full items-center justify-between gap-2 rounded-md border border-emerald-100 bg-emerald-50/50 px-2.5 py-1.5 text-[11px] text-emerald-900 transition-colors hover:bg-emerald-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                  aria-label={`Open ${result!.kept.length} kept ${result!.kept.length === 1 ? "report" : "reports"}`}
                >
                  <span>
                    {result!.kept.length} kept as {result!.kept.length === 1 ? "a Report" : "Reports"}
                  </span>
                  <ExternalLink className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </button>
              ) : null}

              {/* Dismissed summary — muted */}
              {(result?.dismissed?.length ?? 0) > 0 ? (
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  {result!.dismissed.length} dismissed
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}

export default SessionArtifactsPanel;
