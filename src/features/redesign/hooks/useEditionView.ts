/**
 * useEditionView — parse the `?edition=...` URL param into a
 * temporal selection, with HONEST_STATUS fallback to "today" on any
 * malformed input.
 *
 * Contract (HOME_EDITORIAL_REDESIGN.md P0 #3):
 *   no flag                  → today
 *   ?edition=1               → today (back-compat)
 *   ?edition=YYYY-MM-DD      → day
 *   ?edition=week:YYYY-Www   → week
 *   ?edition=month:YYYY-MM   → month
 *
 * Anything else (e.g. ?edition=banana) parses to today and is
 * intentionally not surfaced as an error — the surface still renders.
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { EditionSelection } from "../components/edition/EditionSelector";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_WEEK_RE = /^week:(\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3]))$/;
const ISO_MONTH_RE = /^month:(\d{4}-(?:0[1-9]|1[0-2]))$/;

function isValidDateKey(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

export function parseEditionParam(value: string | null): EditionSelection {
  if (value === null || value === "" || value === "1") {
    return { kind: "today" };
  }
  if (isValidDateKey(value)) {
    return { kind: "day", dateKey: value };
  }
  const wMatch = value.match(ISO_WEEK_RE);
  if (wMatch) {
    return { kind: "week", weekKey: wMatch[1] };
  }
  const mMatch = value.match(ISO_MONTH_RE);
  if (mMatch) {
    return { kind: "month", monthKey: mMatch[1] };
  }
  // ERROR_BOUNDARY: malformed → fall back to today; never throw.
  return { kind: "today" };
}

export function useEditionView(): EditionSelection {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return parseEditionParam(params.get("edition"));
  }, [location.search]);
}
