/**
 * EditionSelector — temporal chip group above the §1 header.
 *
 * Renders five affordances:
 *   Today | Yesterday | This week | This month | Archive (date picker)
 *
 * Mobile (< 480px) collapses to: Today | 7d | 30d | →
 *
 * Selection writes the URL via useNavigate({replace:true}) so the
 * back button does not stack the user's clicks within a single
 * editorial session.
 *
 * URL contract (see HOME_EDITORIAL_REDESIGN.md P0 #3):
 *   no flag                  → today (default)
 *   ?edition=1               → today (back-compat)
 *   ?edition=2026-05-08      → daily edition for that date
 *   ?edition=week:2026-W19   → weekly digest
 *   ?edition=month:2026-05   → monthly retrospective
 *
 * The component is purely cosmetic — it does NOT fetch.  The surface
 * does the fetch based on the parsed URL param.
 *
 * a11y: chips are <button> elements with aria-pressed reflecting the
 * active selection.  Date input is a native <input type="date"> with
 * a label for screen-reader association.
 */

import { useId, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type EditionSelection =
  | { kind: "today" }
  | { kind: "day"; dateKey: string }
  | { kind: "week"; weekKey: string }
  | { kind: "month"; monthKey: string };

interface Props {
  /** The currently-active selection, parsed by the surface. */
  selection: EditionSelection;
  /**
   * The earliest dateString known to the system (from
   * dailyBriefSnapshots).  Used as the min= constraint on the
   * archive date picker so users can't tab into the void.
   */
  earliestDateKey?: string | null;
}

/* ─── Date helpers (local UTC, matches the queries) ──────────────── */

function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const t = todayUtc().getTime() - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Compute the ISO-week containing `now` as YYYY-Www. */
function currentWeekKey(): string {
  const now = todayUtc();
  const year = now.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay() || 7;
  const week1Mon = jan4 - (jan4Day - 1) * 86_400_000;
  const week = Math.floor((now.getTime() - week1Mon) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const now = todayUtc();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ─── Chip styles ────────────────────────────────────────────────── */

const baseChipStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 12,
  lineHeight: "20px",
  padding: "2px 10px",
  borderRadius: 999,
  border: "1px solid var(--rd-edition-rule, rgba(255,255,255,0.08))",
  background: "transparent",
  color: "var(--rd-ink-mute)",
  cursor: "pointer",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  fontWeight: 500,
};

const activeChipStyle: React.CSSProperties = {
  ...baseChipStyle,
  borderColor: "var(--rd-accent, #d97757)",
  color: "var(--rd-accent, #d97757)",
  fontWeight: 600,
};

/* ─── Component ──────────────────────────────────────────────────── */

export function EditionSelector({ selection, earliestDateKey }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const datePickerId = useId();

  const setEdition = useCallback(
    (paramValue: string | null) => {
      const params = new URLSearchParams(location.search);
      if (paramValue === null) {
        params.delete("edition");
      } else {
        params.set("edition", paramValue);
      }
      const qs = params.toString();
      navigate(qs ? `${location.pathname}?${qs}` : location.pathname, {
        replace: true,
      });
    },
    [navigate, location.pathname, location.search],
  );

  const isToday = selection.kind === "today";
  const isDay = selection.kind === "day";
  const isWeek = selection.kind === "week";
  const isMonth = selection.kind === "month";
  const yKey = yesterdayKey();
  const isYesterday = isDay && selection.dateKey === yKey;
  const isThisWeek = isWeek && selection.weekKey === currentWeekKey();
  const isThisMonth = isMonth && selection.monthKey === currentMonthKey();

  const onPickDate = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      // If the user picks today, write the canonical no-flag form.
      if (v === dateKey(todayUtc())) {
        setEdition(null);
      } else {
        setEdition(v);
      }
      setPickerOpen(false);
    },
    [setEdition],
  );

  return (
    <div
      data-edition-selector
      role="group"
      aria-label="Edition timeframe selector"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        margin: "0 0 12px",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        data-edition-chip="today"
        aria-pressed={isToday}
        style={isToday ? activeChipStyle : baseChipStyle}
        onClick={() => setEdition(null)}
      >
        Today
      </button>
      <button
        type="button"
        data-edition-chip="yesterday"
        aria-pressed={isYesterday}
        style={isYesterday ? activeChipStyle : baseChipStyle}
        onClick={() => setEdition(yKey)}
      >
        <span className="rd-edition-chip__full">Yesterday</span>
        <span className="rd-edition-chip__short">1d</span>
      </button>
      <button
        type="button"
        data-edition-chip="week"
        aria-pressed={isThisWeek}
        style={isThisWeek ? activeChipStyle : baseChipStyle}
        onClick={() => setEdition(`week:${currentWeekKey()}`)}
      >
        <span className="rd-edition-chip__full">This week</span>
        <span className="rd-edition-chip__short">7d</span>
      </button>
      <button
        type="button"
        data-edition-chip="month"
        aria-pressed={isThisMonth}
        style={isThisMonth ? activeChipStyle : baseChipStyle}
        onClick={() => setEdition(`month:${currentMonthKey()}`)}
      >
        <span className="rd-edition-chip__full">This month</span>
        <span className="rd-edition-chip__short">30d</span>
      </button>
      <button
        type="button"
        data-edition-chip="archive"
        aria-pressed={
          (isDay && !isYesterday) ||
          (isMonth && !isThisMonth) ||
          (isWeek && !isThisWeek)
        }
        aria-expanded={pickerOpen}
        style={baseChipStyle}
        onClick={() => setPickerOpen((v) => !v)}
        title="Pick an archive date"
      >
        Archive →
      </button>
      {pickerOpen && (
        <span
          data-edition-archive-picker
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 4,
          }}
        >
          <label
            htmlFor={datePickerId}
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--rd-ink-mute)",
            }}
          >
            Pick a day
          </label>
          <input
            id={datePickerId}
            type="date"
            data-edition-archive-input
            min={earliestDateKey ?? undefined}
            max={dateKey(todayUtc())}
            defaultValue={isDay ? selection.dateKey : ""}
            onChange={onPickDate}
            style={{
              font: "inherit",
              fontSize: 12,
              padding: "2px 6px",
              border: "1px solid var(--rd-edition-rule, rgba(255,255,255,0.08))",
              borderRadius: 4,
              background: "transparent",
              color: "var(--rd-ink-strong)",
            }}
          />
        </span>
      )}
    </div>
  );
}
