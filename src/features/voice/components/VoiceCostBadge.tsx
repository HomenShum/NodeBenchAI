/**
 * VoiceCostBadge — daily voice spend indicator.
 *
 * Pattern: Read-only spend summary; subscribes to
 * `voice/costLedger:checkCap` (landed in PR #274). Shows totalUsd vs capUsd
 * with a horizontal progress bar + warning state at 80% + capped state at
 * 100%. HONEST_SCORES — totalUsd is server-computed from sum(byTier).
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (voiceCostLedger)
 *
 * Visual states:
 *   - Healthy   (< 80%): muted text + slim accent bar
 *   - Warning   (>=80%): amber accent + warning copy
 *   - Cap hit  (>=100%): rose accent + "capture-only mode" copy
 *
 * Glass card DNA, terracotta accent for the bar fill.
 */

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

interface VoiceCostBadgeProps {
  userId: string; // user's Convex id
  className?: string;
}

interface CapSnapshot {
  userId: string;
  dayUtc: string;
  totalUsd: number;
  capUsd: number;
  remaining: number;
  hit: boolean;
  warning80pct: boolean;
}

function fmtUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export function VoiceCostBadge({ userId, className }: VoiceCostBadgeProps): JSX.Element {
  // Type-erased lookup — `api.domains.integrations.voice.costLedger.checkCap`
  // resolves at runtime once codegen has consumed PR #274's mutation files.
  const queryRef = (api as unknown as {
    domains: { integrations: { voice: { costLedger: { checkCap: unknown } } } };
  }).domains.integrations.voice.costLedger.checkCap;

  const snap = useQuery(
    queryRef as Parameters<typeof useQuery>[0],
    { userId } as Parameters<typeof useQuery>[1],
  ) as CapSnapshot | undefined;

  const isLoading = snap === undefined;

  // Tone selection — matches CLAUDE.md design DNA + accessibility (color paired with text)
  const tone = !snap
    ? "muted"
    : snap.hit
      ? "rose"
      : snap.warning80pct
        ? "amber"
        : "accent";

  const toneClasses: Record<string, string> = {
    muted: "border-edge/30 bg-content/[0.02]",
    accent: "border-edge/30 bg-content/[0.02]",
    amber: "border-amber-300/40 bg-amber-500/10",
    rose: "border-rose-300/40 bg-rose-500/10",
  };

  const fillClasses: Record<string, string> = {
    muted: "bg-content/20",
    accent: "bg-[#d97757]",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
  };

  const pct = snap ? Math.min(100, Math.round((snap.totalUsd / Math.max(snap.capUsd, 0.01)) * 100)) : 0;

  return (
    <section
      role="region"
      aria-label="Daily voice spend"
      className={[
        "rounded-2xl border bg-surface/80 backdrop-blur-md",
        "p-4 sm:p-5",
        toneClasses[tone],
        className ?? "",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-content-muted">
          Voice spend today
        </h3>
        {!isLoading && (
          <span className="text-[11px] text-content-muted/80 font-mono">
            {snap?.dayUtc}
          </span>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-6 w-32 rounded bg-content/[0.06] animate-pulse" />
          <div className="h-1.5 w-full rounded-full bg-content/[0.05] animate-pulse" />
        </div>
      ) : snap ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums text-content">
              {fmtUsd(snap.totalUsd)}
              <span className="ml-2 text-sm font-normal text-content-muted">
                / {fmtUsd(snap.capUsd)}
              </span>
            </p>
            <span
              className={[
                "text-xs font-medium tabular-nums",
                tone === "rose"
                  ? "text-rose-300"
                  : tone === "amber"
                    ? "text-amber-300"
                    : "text-content-muted",
              ].join(" ")}
            >
              {pct}%
            </span>
          </div>

          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-content/[0.05]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% of daily voice cap used`}
          >
            <div
              className={[
                "h-full rounded-full transition-all duration-300",
                fillClasses[tone],
              ].join(" ")}
              style={{ width: `${pct}%` }}
            />
          </div>

          {snap.hit && (
            <p className="mt-2 text-xs text-rose-300">
              Daily cap reached. Capture-only mode until midnight UTC. Agent + translation tiers blocked.
            </p>
          )}
          {!snap.hit && snap.warning80pct && (
            <p className="mt-2 text-xs text-amber-300">
              Approaching daily voice cap. {fmtUsd(snap.remaining)} remaining.
            </p>
          )}
          {!snap.hit && !snap.warning80pct && snap.totalUsd > 0 && (
            <p className="mt-2 text-xs text-content-muted">
              {fmtUsd(snap.remaining)} remaining today.
            </p>
          )}
          {snap.totalUsd === 0 && (
            <p className="mt-2 text-xs text-content-muted">
              No voice activity today.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
