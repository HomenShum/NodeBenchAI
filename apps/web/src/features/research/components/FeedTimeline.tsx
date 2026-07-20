import React, { useMemo } from "react";
import { Circle, Newspaper, TrendingUp, Hash, Sparkles } from "lucide-react";
import { FeedCard, type FeedItem } from "@/features/research/components/FeedCard";

interface FeedTimelineProps {
  items: FeedItem[];
  onItemClick: (item: FeedItem) => void;
  onAnalyze?: (item: FeedItem) => void;
}

type GroupConfig = {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  match: (item: FeedItem) => boolean;
  layout: "grid" | "list";
};

const GROUPS: GroupConfig[] = [
  {
    id: "briefing",
    title: "Morning Briefing",
    subtitle: "Market sentiment remains cautious; rotation into AI infra and developer tooling.",
    icon: Newspaper,
    color: "bg-surface-secondary text-content",
    match: () => true,
    layout: "grid",
  },
  {
    id: "signals",
    title: "Market Signals",
    subtitle: "High velocity movements detected across SaaS and DevTools tickers.",
    icon: TrendingUp,
    color: "bg-orange-50 text-orange-600",
    match: (item) => item.type === "signal",
    layout: "list",
  },
  {
    id: "infrastructure",
    title: "AI Infrastructure",
    subtitle: "Deep dive into SEC filings, GitHub velocity, and infra sentiment.",
    icon: Hash,
    color: "bg-blue-50 text-blue-600",
    match: (item) => (item.tags || []).some((t) => t.toLowerCase().includes("ai") || t.toLowerCase().includes("infra")),
    layout: "list",
  },
];

export const FeedTimeline: React.FC<FeedTimelineProps> = ({ items, onItemClick, onAnalyze }) => {
  const grouped = useMemo(() => {
    const primary = GROUPS.slice(1); // skip default
    const buckets: Record<string, FeedItem[]> = {};
    GROUPS.forEach((g) => (buckets[g.id] = []));
    items.forEach((it) => {
      const match = primary.find((g) => g.match(it)) ?? GROUPS[0];
      buckets[match.id].push(it);
    });
    const ordered: Array<{ group: GroupConfig; items: FeedItem[] }> = [];
    GROUPS.forEach((g) => {
      if (buckets[g.id].length > 0 || g.id === GROUPS[0].id) {
        ordered.push({ group: g, items: buckets[g.id] });
      }
    });
    return ordered;
  }, [items]);

  return (
    <div className="w-full pb-12">
      {grouped.map((entry, idx) => {
        const Icon = entry.group.icon;
        const last = idx === grouped.length - 1;
        const layoutClass = entry.group.layout === "grid" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4";
        return (
          <div key={entry.group.id} className="relative pl-10 pb-16 last:pb-0">
            {!last && <div className="absolute left-[19px] top-10 bottom-0 w-px bg-[color:var(--border-color)]/70" />}
            <div className="absolute left-0 top-0">
              <div className={`w-10 h-10 rounded-lg border-[3px] border-white shadow-sm flex items-center justify-center ${entry.group.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <div className="mb-8 pt-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-bold text-content tracking-tight">
                  {entry.group.title}
                </h2>
                <span className="text-xs font-bold text-content-secondary bg-surface-secondary px-2 py-0.5 rounded-full border border-edge">
                  {entry.items.length} UPDATES
                </span>
              </div>
              {entry.group.subtitle && (
                <div className="bg-gradient-to-r from-surface-secondary to-surface border-l-2 border-edge pl-4 py-2 pr-6 rounded-r-lg">
                  <p className="text-sm text-content leading-relaxed font-medium">
                    <Sparkles className="w-3 h-3 inline mr-2 text-purple-500" />
                    {entry.group.subtitle}
                  </p>
                </div>
              )}
            </div>
            <div className={layoutClass}>
              {entry.items.map((item) => (
                <div key={item.id} className="relative">
                  <div className="absolute -left-6 top-6 w-6 h-px bg-[color:var(--border-color)]" />
                  <FeedCard
                    item={item}
                    onClick={() => onItemClick(item)}
                    onAnalyze={onAnalyze ? () => onAnalyze(item) : undefined}
                    variant={entry.group.id === "signals" ? "signal" : "minimal"}
                  />
                </div>
              ))}
              {entry.items.length === 0 && (
                <div className="text-sm text-content-secondary">No items yet. Activity appears as you search and track entities.</div>
              )}
            </div>
            {!last && (
              <div className="absolute left-[18px] bottom-0 flex items-center gap-2 text-xs text-content-secondary">
                <Circle className="w-2 h-2" />
                Continue
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FeedTimeline;
