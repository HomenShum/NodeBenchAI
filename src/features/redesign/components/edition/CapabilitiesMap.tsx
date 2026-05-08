/**
 * CapabilitiesMap — three readiness rows + capability icon grid.
 * Source: `dailyBriefSnapshots.dashboardMetrics.techReadiness` and
 * `dashboardMetrics.capabilities`.  THIS IS THE VISUAL SIGNATURE of
 * the editorial home (matches ai-2027 "Currently Exists / Emerging /
 * Science Fiction" indicator).
 */

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

interface Props {
  techReadiness: TechReadiness | null;
  capabilities: CapabilityEntry[] | null;
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

export function CapabilitiesMap({ techReadiness, capabilities }: Props) {
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

  return (
    <div>
      {hasReadiness && (
        <div role="list" aria-label="Technology readiness">
          {READINESS_ROWS.map((row) => {
            const filled = Math.max(
              0,
              Math.min(row.total, techReadiness![row.key] ?? 0),
            );
            return (
              <div
                key={row.key}
                className="rd-edition-capability-row"
                role="listitem"
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
