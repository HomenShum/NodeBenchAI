/**
 * Freshness tier visual. Icon + text — never color alone (color-blind safe per
 * .claude/rules/reexamine_a11y.md).
 */
import { CheckCircle2, Clock, AlertTriangle, HelpCircle } from "lucide-react";

export type FreshnessState = "fresh" | "recent" | "stale" | "very_stale" | "unknown";

const LABEL: Record<FreshnessState, string> = {
  fresh: "Fresh",
  recent: "Recent",
  stale: "Stale",
  very_stale: "Very stale",
  unknown: "Unknown",
};

const STYLE: Record<FreshnessState, string> = {
  fresh:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  recent:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
  stale:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  very_stale:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  unknown:
    "bg-gray-50 text-gray-600 border-gray-200 dark:bg-white/[0.04] dark:text-gray-300 dark:border-white/10",
};

function FreshnessIcon({ state }: { state: FreshnessState }) {
  if (state === "fresh") return <CheckCircle2 className="h-3 w-3" aria-hidden="true" />;
  if (state === "recent") return <Clock className="h-3 w-3" aria-hidden="true" />;
  if (state === "stale" || state === "very_stale")
    return <AlertTriangle className="h-3 w-3" aria-hidden="true" />;
  return <HelpCircle className="h-3 w-3" aria-hidden="true" />;
}

export function WikiFreshnessBadge({ state }: { state: FreshnessState }) {
  return (
    <span
      data-testid="wiki-freshness-badge"
      data-freshness={state}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STYLE[state]}`}
      aria-label={`Page freshness: ${LABEL[state]}`}
    >
      <FreshnessIcon state={state} />
      {LABEL[state]}
    </span>
  );
}
