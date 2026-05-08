/**
 * Scoreboard — flush two-column inline table for
 * `dailyBriefSnapshots.dashboardMetrics.keyStats`.  Mirrors ai-2027's
 * right-rail scoreboard format but inline / no card chrome (per
 * docs/architecture/HOME_EDITORIAL_REDESIGN.md §5).
 */

interface KeyStat {
  label?: string;
  name?: string;
  value?: string | number;
  delta?: string | number;
  trend?: "up" | "down" | "flat";
}

interface Props {
  stats: KeyStat[];
}

function fmtValue(v: KeyStat["value"]): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function fmtDelta(d: KeyStat["delta"]): { text: string; tone: "up" | "down" | "flat" } | null {
  if (d === undefined || d === null) return null;
  const text = typeof d === "number" ? (d > 0 ? `+${d}` : `${d}`) : String(d);
  const trimmed = text.trim();
  if (!trimmed) return null;
  const numericLead = trimmed.match(/^([+-])/);
  const tone: "up" | "down" | "flat" =
    numericLead?.[1] === "+" ? "up" : numericLead?.[1] === "-" ? "down" : "flat";
  return { text: trimmed, tone };
}

export function Scoreboard({ stats }: Props) {
  if (!stats || stats.length === 0) {
    return (
      <div className="rd-edition-empty">
        Scoreboard data not generated for today.
      </div>
    );
  }
  return (
    <div className="rd-edition-scoreboard" role="table" aria-label="Today's scoreboard">
      {stats.map((s, i) => {
        const label = s.label ?? s.name ?? `Stat ${i + 1}`;
        const value = fmtValue(s.value);
        const delta = fmtDelta(s.delta);
        return (
          <div className="rd-edition-scoreboard__row" role="row" key={`${label}-${i}`}>
            <span className="rd-edition-scoreboard__label" role="cell">
              {label}
            </span>
            <span className="rd-edition-scoreboard__value" role="cell">
              {value}
            </span>
            <span
              className={
                "rd-edition-scoreboard__delta" +
                (delta
                  ? ` rd-edition-scoreboard__delta--${delta.tone}`
                  : "")
              }
              role="cell"
              aria-label={delta ? `Delta ${delta.text}` : "No change recorded"}
            >
              {delta ? (
                <>
                  {delta.tone === "up" && "↑ "}
                  {delta.tone === "down" && "↓ "}
                  {delta.text}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
