/**
 * Standard date formatting for Daily Brief surfaces.
 *
 * Canonical UI format:
 * - DateTime: "Dec 11, 2025, 1:38 PM"
 * - Date only: "Dec 11, 2025"
 * - Month/Year: "Dec 2025"
 */

const BRIEF_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatBriefDateTime(
  ms: number,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(ms);
}

export function normalizeBriefDateString(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (BRIEF_DATE_ONLY_RE.test(trimmed)) return trimmed;

  const datePrefixMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefixMatch && BRIEF_DATE_ONLY_RE.test(datePrefixMatch[1])) {
    return datePrefixMatch[1];
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function formatBriefDate(dateString: string): string {
  // NOTE(coworker): Be defensive here to prevent route-level crashes from malformed date strings.
  const normalized = normalizeBriefDateString(dateString);
  if (!normalized) return dateString;
  const d = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return normalized;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatBriefMonthYear(input: string | number): string {
  const d =
    typeof input === "number"
      ? new Date(input)
      : new Date(`1 ${input} 00:00:00Z`);
  if (isNaN(d.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isBriefDateToday(dateString?: string | null): boolean {
  if (!dateString) return false;
  const normalized = normalizeBriefDateString(dateString);
  return Boolean(normalized && normalized === getTodayDateString());
}
