/**
 * RecentPulseStrip — compact "new updates since yesterday" row for
 * the Reports landing.
 *
 * Pulls from `pulseReports.listRecentPulsesForOwner`. Each card is
 * an entity's latest pulse with change-count + material badges.
 * Silent when zero pulses exist (cold start or long-idle account).
 *
 * Click-through: `/entity/<slug>/pulse` for the full daily digest.
 *
 * Pulled from the Phase-4 redesign spec's "Updates" section — this
 * is the push-to-attention surface that surfaces pulse activity on
 * the Reports home so users never miss "what changed" across the
 * entities they're watching.
 */

import { memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPulsePath } from "@/features/entities/lib/entityExport";
import { cn } from "@/lib/utils";

interface PulseRow {
  _id: string;
  entitySlug: string;
  dateKey: string;
  changeCount: number;
  materialChangeCount: number;
  readAt?: number;
  generatedAt: number;
}

function formatRelative(tsMs: number): string {
  const delta = Math.max(0, Date.now() - tsMs);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export interface RecentPulseStripProps {
  className?: string;
}

export const RecentPulseStrip = memo(function RecentPulseStrip({
  className,
}: RecentPulseStripProps) {
  const navigate = useNavigate();
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();

  const pulses = useQuery(
    api?.domains?.product?.pulseReports?.listRecentPulsesForOwner ??
      ("skip" as any),
    api?.domains?.product?.pulseReports?.listRecentPulsesForOwner
      ? { anonymousSessionId, limit: 12 }
      : "skip",
  ) as PulseRow[] | undefined;

  const handleOpen = useCallback(
    (slug: string) => {
      navigate(buildEntityPulsePath(slug));
    },
    [navigate],
  );

  // Silent-when-idle: nothing to show → render nothing.
  if (!pulses || pulses.length === 0) return null;

  const unreadCount = pulses.filter((p) => !p.readAt && p.changeCount > 0).length;

  return (
    <section
      className={cn(
        "rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4",
        className,
      )}
      aria-label="Recent pulse activity"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent-primary)]" />
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-content-muted">
            New updates
          </h2>
          {unreadCount > 0 ? (
            <span className="rounded-full bg-[color:var(--accent-primary)]/20 px-2 py-0.5 text-[10px] font-medium text-[color:var(--accent-primary)]">
              {unreadCount} unread
            </span>
          ) : null}
        </div>
      </div>
      <ul className="flex flex-wrap gap-2">
        {pulses.map((p) => {
          const isUnread = !p.readAt && p.changeCount > 0;
          return (
            <li key={p._id}>
              <button
                type="button"
                onClick={() => handleOpen(p.entitySlug)}
                className={cn(
                  "group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
                  isUnread
                    ? "border-[color:var(--accent-primary)]/30 bg-[color:var(--accent-primary)]/5 hover:border-[color:var(--accent-primary)]/60"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]",
                )}
                aria-label={`Open pulse for ${p.entitySlug}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-content">
                    {p.entitySlug}
                    {isUnread ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-primary)]" aria-hidden="true" />
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-content-muted tabular-nums">
                    <span>{p.changeCount} change{p.changeCount === 1 ? "" : "s"}</span>
                    {p.materialChangeCount > 0 ? (
                      <>
                        <span>·</span>
                        <span className="text-amber-300">{p.materialChangeCount} material</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span>{formatRelative(p.generatedAt)}</span>
                  </div>
                </div>
                <ArrowUpRight className="h-3 w-3 text-content-muted transition group-hover:text-content" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

RecentPulseStrip.displayName = "RecentPulseStrip";
