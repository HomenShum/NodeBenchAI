export function offsetMinutesForZone(timeZone: string | undefined, date: Date): number {
  if (!timeZone) {
    return -date.getTimezoneOffset();
  }
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get("year");
    const m = (get("month") || 1) - 1;
    const d = get("day") || 1;
    const h = get("hour") || 0;
    const min = get("minute") || 0;
    const s = get("second") || 0;
    const asUTC = Date.UTC(y, m, d, h, min, s);
    const diffMin = (asUTC - date.getTime()) / 60000;
    return diffMin;
  } catch {
    return -date.getTimezoneOffset();
  }
}

export function localDateKeyFromInternalDayStart(dayStartInternalMs: number, offsetMinutes: number): string {
  const d = new Date(dayStartInternalMs + offsetMinutes * 60000);
  // toISOString is UTC; here we already applied the offset so the UTC representation matches local wall date.
  return d.toISOString().slice(0, 10);
}
