import { v } from "convex/values";
import { query } from "../../_generated/server";

type SignalEvent = { title: string; url?: string; source?: string };

function buildDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parsePublishedAt(publishedAt: string | undefined): Date | null {
  if (!publishedAt) return null;
  const parsed = new Date(publishedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveSearchTerm(keyword?: string, signalType?: string): string | null {
  const candidate = (keyword ?? signalType)?.trim();
  return candidate ? candidate.toLowerCase() : null;
}

function buildEmptySeries(start: Date, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: buildDateKey(d), count: 0, events: [] as SignalEvent[] };
  });
}

export const getSignalTimeseries = query({
  args: {
    keyword: v.optional(v.string()),
    signalType: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = Math.max(3, Math.min(args.days ?? 14, 30));
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - (days - 1));

    const from = buildDateKey(start);
    const to = buildDateKey(now);
    const seed = buildEmptySeries(start, days);
    const term = resolveSearchTerm(args.keyword, args.signalType);

    if (!term) {
      return seed;
    }

    const items = await ctx.db
      .query("feedItems")
      .withIndex("by_published", (q) => q.gte("publishedAt", from).lte("publishedAt", `${to}T23:59:59.999Z`))
      .collect();

    const counts = new Map<string, number>();
    const events = new Map<string, SignalEvent[]>();
    seed.forEach((point) => {
      counts.set(point.date, point.count);
      events.set(point.date, [...point.events]);
    });

    items.forEach((item) => {
      const haystack = `${item.title ?? ""} ${item.summary ?? ""} ${(item.tags ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(term)) return;
      const publishedAt = parsePublishedAt(item.publishedAt);
      if (!publishedAt) return;
      const dayKey = buildDateKey(publishedAt);
      if (counts.has(dayKey)) {
        counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
      }
      if (events.has(dayKey)) {
        const list = events.get(dayKey) ?? [];
        if (list.length < 3) {
          list.push({
            title: item.title ?? "Signal",
            url: item.url ?? undefined,
            source: item.source ?? undefined,
          });
        }
        events.set(dayKey, list);
      }
    });

    return seed.map(({ date }) => ({ date, count: counts.get(date) ?? 0, events: events.get(date) ?? [] }));
  },
});
