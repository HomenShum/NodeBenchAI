/**
 * CapabilitiesMap — three readiness rows + capability icon grid.
 * Source: `dailyBriefSnapshots.dashboardMetrics.techReadiness` and
 * `dashboardMetrics.capabilities`.  THIS IS THE VISUAL SIGNATURE of
 * the editorial home (matches ai-2027 "Currently Exists / Emerging /
 * Science Fiction" indicator).
 *
 * Phase 9a: optional `deltas` prop renders week-over-week (or
 * day-over-day) movement next to each bucket count.  Honest —
 * if a delta is null (no prior snapshot to compare), NOTHING is
 * rendered (NOT "→") so the user isn't misled about whether a
 * comparison happened.  Per agentic_reliability HONEST_STATUS.
 */

import type { CSSProperties } from "react";
import { DotGrid } from "./DotGrid";

interface TechReadiness {
  existing: number;
  emerging: number;
  sciFi: number;
}

interface CapabilityEntry {
  name?: string;
  label?: string;
  level?: string; // e.g. "current", "emerging", "future"
  description?: string;
}

export interface CapabilityDeltas {
  existing: number | null;
  emerging: number | null;
  sciFi: number | null;
}

interface Props {
  techReadiness: TechReadiness | null;
  capabilities: CapabilityEntry[] | null;
  /** Optional deltas vs prior snapshot (Phase 9a). */
  deltas?: CapabilityDeltas | null;
  /** When provided, the badge tooltip references the comparison window. */
  windowDays?: number;
  /** Date string of the prior snapshot for hover context. */
  priorDateString?: string | null;
}

const READINESS_ROWS: Array<{
  key: keyof TechReadiness;
  label: string;
  total: number;
}> = [
  { key: "existing", label: "Currently Exists", total: 6 },
  { key: "emerging", label: "Emerging Tech", total: 6 },
  { key: "sciFi", label: "Science Fiction", total: 6 },
];

/**
 * Format a delta number for the visible badge.  Returns null when
 * the delta itself is null (no comparison data) — caller renders
 * nothing in that case.  `0` renders as "→" (no change), positive as
 * `+N`, negative as `-N`.
 */
function formatDeltaBadge(
  delta: number | null,
): { text: string; tone: "up" | "down" | "flat" } | null {
  if (delta === null) return null;
  if (!Number.isFinite(delta)) return null;
  if (delta === 0) return { text: "→", tone: "flat" };
  return {
    text: delta > 0 ? `+${delta}` : `${delta}`,
    tone: delta > 0 ? "up" : "down",
  };
}

function deltaBadgeStyle(tone: "up" | "down" | "flat"): CSSProperties {
  const base: CSSProperties = {
    marginLeft: 8,
    fontFamily: "var(--rd-mono, monospace)",
    fontSize: 11,
    letterSpacing: "0.04em",
    padding: "1px 6px",
    borderRadius: 4,
    border: "1px solid currentColor",
    opacity: 0.85,
  };
  if (tone === "up") {
    return { ...base, color: "var(--rd-accent, #d97757)" };
  }
  if (tone === "down") {
    return { ...base, color: "rgb(120, 160, 220)" };
  }
  return { ...base, color: "var(--rd-ink-mute, #888)" };
}

export function CapabilitiesMap({
  techReadiness,
  capabilities,
  deltas,
  windowDays,
  priorDateString,
}: Props) {
  const hasReadiness =
    techReadiness &&
    (techReadiness.existing > 0 ||
      techReadiness.emerging > 0 ||
      techReadiness.sciFi > 0);
  const hasCaps = capabilities && capabilities.length > 0;

  if (!hasReadiness && !hasCaps) {
    return (
      <div className="rd-edition-empty">
        Capabilities map not generated for today's edition.
      </div>
    );
  }

  const windowLabel =
    windowDays === 7
      ? "vs 7 days ago"
      : windowDays && windowDays > 1
        ? `vs ${windowDays} days ago`
        : "vs yesterday";

  return (
    <div>
      {hasReadiness && (
        <div role="list" aria-label="Technology readiness">
          {READINESS_ROWS.map((row) => {
            const filled = Math.max(
              0,
              Math.min(row.total, techReadiness![row.key] ?? 0),
            );
            const delta = deltas ? formatDeltaBadge(deltas[row.key]) : null;
            const tooltipText = delta
              ? priorDateString
                ? `${windowLabel} (${priorDateString}): ${delta.text}`
                : `${windowLabel}: ${delta.text}`
              : undefined;
            return (
              <div
                key={row.key}
                className="rd-edition-capability-row"
                role="listitem"
                data-capability-row={row.key}
              >
                <span className="rd-edition-capability-row__label">
                  {row.label}
                </span>
                <DotGrid
                  filled={filled}
                  total={row.total}
                  caption={`${filled}/${row.total}`}
                  ariaLabel={`${row.label}: ${filled} of ${row.total}`}
                />
                {delta && (
                  <span
                    style={deltaBadgeStyle(delta.tone)}
                    title={tooltipText}
                    aria-label={
                      delta.tone === "flat"
                        ? `No change ${windowLabel}`
                        : `Change ${delta.text} ${windowLabel}`
                    }
                    data-capability-delta={row.key}
                    data-delta-tone={delta.tone}
                  >
                    {delta.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasCaps && (
        <div className="rd-edition-capability-grid" role="list" aria-label="AI capabilities">
          {capabilities!.map((c, i) => {
            const name = c.name ?? c.label ?? `Capability ${i + 1}`;
            const level = c.level ?? "tracked";
            return (
              <div className="rd-edition-capability-card" role="listitem" key={`${name}-${i}`}>
                <span className="rd-edition-capability-card__name">{name}</span>
                <span className="rd-edition-capability-card__level">{level}</span>
                {c.description && (
                  <span style={{ fontSize: 12, color: "var(--rd-ink-mute)", lineHeight: 1.45 }}>
                    {c.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
