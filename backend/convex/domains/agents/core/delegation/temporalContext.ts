export type TemporalContext = {
  label: string;
  startDate: string;
  endDate: string;
};

const toIso = (date: Date): string => date.toISOString();

const windowFromNow = (days: number, label: string, now: Date): TemporalContext => {
  const end = now;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { label, startDate: toIso(start), endDate: toIso(end) };
};

const startOfCurrentWeek = (now: Date): Date => {
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // convert Sunday(0) -> 6, Monday(1) -> 0
  const start = new Date(now.getTime() - diff * 24 * 60 * 60 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  return start;
};

/**
 * Try to normalize relative temporal expressions ("last week", "past 24 hours") into
 * a concrete ISO date window. The goal is to give subagents a clear timeframe to filter
 * searches and rank results for freshness.
 */
export function extractTemporalContext(query: string, now: Date = new Date()): TemporalContext | null {
  const text = query.toLowerCase();

  if (/\b(last|past|previous)\s+(24\s*hours|day)\b/.test(text) || /\byesterday\b/.test(text)) {
    return windowFromNow(1, "past 24 hours", now);
  }

  if (/\b(today)\b/.test(text)) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return { label: "today", startDate: toIso(start), endDate: toIso(now) };
  }

  if (/\b(this\s+week)\b/.test(text)) {
    const start = startOfCurrentWeek(now);
    return { label: "this week", startDate: toIso(start), endDate: toIso(now) };
  }

  if (/\b(last|past|previous)\s+week\b/.test(text)) {
    return windowFromNow(7, "past week", now);
  }

  if (/\b(last|past|previous)\s+month\b/.test(text) || /\brecent\b/.test(text)) {
    return windowFromNow(30, "past month", now);
  }

  if (/\b(last|past|previous)\s+quarter\b/.test(text)) {
    return windowFromNow(90, "past quarter", now);
  }

  return null;
}

/**
 * Build a prompt that explicitly calls out the inferred time window so the downstream
 * agent can set date filters and prioritize up-to-date sources.
 */
export function buildPromptWithTemporalContext(query: string): {
  prompt: string;
  temporalContext?: TemporalContext;
} {
  const temporalContext = extractTemporalContext(query);

  if (!temporalContext) {
    return { prompt: query };
  }

  const prompt = `${query}\n\nTimeframe: ${temporalContext.label} (from ${temporalContext.startDate} to ${temporalContext.endDate}).` +
    " Apply date filters in your tools to stay within this range and prioritize the most recent results.";

  return { prompt, temporalContext };
}
