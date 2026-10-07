/**
 * MemoryPulse — kit-aligned "Memory pulse" stats band for Home.
 *
 * Source of truth: ui_kits/nodebench-web/PulseStrip.jsx (card-grid layout).
 * Frames the homepage as proof of compounding intelligence: every chat makes
 * the next one faster.
 *
 * HONEST_SCORES: shows ONE metric (reports created) sourced from the caller's
 * already-resolved visibleReports prop.  No hardcoded floors, no fixture
 * numbers.  v1 ships a single stat; subsequent metrics (entities tracked,
 * relationships mapped, served-from-memory %, searches avoided) need their
 * own Convex telemetry queries and follow in dedicated PRs.
 *
 * Hidden when reportsCreated <= 0 — there is nothing meaningful to show
 * before the user has saved their first report.
 */

import { BookOpen } from "lucide-react";

interface MemoryPulseProps {
  reportsCreated: number;
  className?: string;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}

export function MemoryPulse({ reportsCreated, className }: MemoryPulseProps) {
  if (reportsCreated <= 0) return null;

  return (
    <section
      aria-label="Memory pulse"
      className={[
        "relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white/95 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.18)]",
        "px-5 py-5 sm:px-6 sm:py-6",
        "dark:border-white/[0.06] dark:bg-white/[0.03]",
        className ?? "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_200px_at_12%_-10%,rgba(217,119,87,0.08),transparent_70%)]"
      />
      <header className="relative flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
            Memory pulse
          </div>
          <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.01em] text-content sm:text-[22px]">
            Every chat makes the next one faster.
          </h2>
          <p className="mt-1 max-w-[58ch] text-[13px] leading-6 text-content-muted">
            Saved answers compound into reusable memory.  Open one and pick up exactly where you left off.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-content-muted dark:border-white/[0.08] dark:bg-white/[0.03]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" />
          Private notes excluded
        </span>
      </header>

      <div className="relative mt-5">
        <article
          data-hero="true"
          className="rounded-xl border border-[rgba(217,119,87,0.32)] bg-[rgba(217,119,87,0.06)] px-5 py-5"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[36px] font-semibold tracking-[-0.02em] text-[var(--accent-primary)]">
              {formatCount(reportsCreated)}
            </span>
          </div>
          <div className="mt-1 text-[13px] font-medium text-content">Reports created</div>
          <div className="mt-1 text-[12px] leading-5 text-content-muted">
            Chats become durable work products.  Each saved report skips the next round of search.
          </div>
        </article>
      </div>
    </section>
  );
}

export default MemoryPulse;
