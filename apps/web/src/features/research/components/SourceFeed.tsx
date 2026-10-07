import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Github, ArrowUpRight, MessageSquare } from "lucide-react";
import clsx from "clsx";
import type { FeedItem } from "./FeedCard";
import { normalizeSourceLabel, sanitizeReadableText } from "@/lib/displayText";
import { useMotionConfig } from '@/lib/motion';

type SourceFilter = { id: string; label: string; icon?: React.ElementType };

interface SourceFeedProps {
  items: FeedItem[];
  sources: SourceFilter[];
  activeSource: string;
  onSelectSource: (id: string) => void;
}

const defaultIcons: Record<string, React.ElementType> = {
  github: Github,
  ycombinator: ArrowUpRight,
  hackernews: ArrowUpRight,
  techcrunch: ExternalLink,
  reddit: MessageSquare,
};

export const SourceFeed: React.FC<SourceFeedProps> = ({ items, sources, activeSource, onSelectSource }) => {
  const filteredItems = useMemo(() => {
    if (activeSource === "all") return items;
    const target = normalizeSourceLabel(activeSource, activeSource).toLowerCase();
    return items.filter((item) => normalizeSourceLabel(item.source || "", "").toLowerCase() === target);
  }, [items, activeSource]);

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2 mb-6 border-b border-edge pb-4">
        {sources.map((source) => {
          const Icon = source.icon || defaultIcons[source.id];
          const isActive = activeSource === source.id;
          return (
            <button
              key={source.id}
              onClick={() => onSelectSource(source.id)}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                isActive
                  ? "bg-content text-surface shadow-sm"
                  : "bg-surface text-content-secondary border border-edge hover:border-primary/20 hover:bg-surface-hover hover:shadow-sm"
              )}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {source.label}
            </button>
          );
        })}
      </div>

      <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredItems.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </AnimatePresence>
      </motion.div>

      {filteredItems.length === 0 && (
        <div className="py-10 text-center text-content-muted text-sm">No updates found for this source.</div>
      )}
    </div>
  );
};

const FeedCard = ({ item }: { item: FeedItem }) => {
  const { instant, transition } = useMotionConfig();
  const normalizedSource = normalizeSourceLabel(item.source || "News", "News");
  const normalizedTitle = sanitizeReadableText(item.title);
  const normalizedSubtitle = sanitizeReadableText(item.subtitle || item.type);
  const normalizedTimestamp = sanitizeReadableText(item.timestamp);
  const normalizedTags = (item.tags || []).map((tag) => sanitizeReadableText(tag));
  const badgeColor =
    normalizedSource.toLowerCase() === "github"
      ? "bg-surface-secondary text-content-secondary"
      : normalizedSource.toLowerCase() === "hacker news"
        ? "bg-orange-50 text-orange-700"
        : normalizedSource.toLowerCase() === "techcrunch"
          ? "bg-green-50 text-green-700"
          : normalizedSource.toLowerCase().startsWith("reddit")
            ? "bg-red-50 text-red-600"
            : "bg-surface-secondary text-content";

  return (
    <motion.div
      layout
      initial={{ opacity: instant ? 1 : 0, scale: instant ? 1 : 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: instant ? 1 : 0, scale: instant ? 1 : 0.97 }}
      transition={transition(0.15)}
      className="group relative flex flex-col justify-between rounded-lg border border-edge bg-surface p-4 hover:border-indigo-200 transition-all"
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={clsx("text-xs font-bold px-1.5 py-0.5 rounded", badgeColor)}>
            {normalizedSource}
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400" />
        </div>
        <h4 className="text-sm font-semibold text-content leading-snug mb-2 line-clamp-2">{normalizedTitle}</h4>
        <p className="text-xs text-content-secondary line-clamp-2 mb-3">{normalizedSubtitle}</p>
      </div>
      <div className="flex items-center gap-3 border-t border-gray-50 pt-3 text-xs text-content-secondary">
        {item.timestamp && <span>{normalizedTimestamp}</span>}
        {normalizedTags.length ? <span className="truncate">#{normalizedTags.slice(0, 2).join(" #")}</span> : null}
        {typeof item.relevanceScore === "number" && (
          <span className="ml-auto font-mono text-xs text-content-secondary">Relevance {item.relevanceScore}</span>
        )}
      </div>
    </motion.div>
  );
};

export default SourceFeed;
