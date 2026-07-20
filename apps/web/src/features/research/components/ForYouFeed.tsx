/**
 * For You Feed Component
 * Editorial newspaper-style design with clean typography
 */

import React, { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { SignatureOrb } from "../../../shared/ui/SignatureOrb";
import { api } from "../../../../convex/_generated/api";
import {
  Bookmark,
  ExternalLink,
  ChevronRight,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { PageHeroHeader } from "@/shared/ui/PageHeroHeader";
import { sanitizeReadableText } from "@/lib/displayText";
import { useMotionConfig } from '@/lib/motion';

const staggerContainer = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } },
};

interface DateGroup {
  dateString: string;
  displayLabel: string;
  items: any[];
}

export function ForYouFeed() {
  const { instant, transition } = useMotionConfig();
  const authFeed = useQuery(api.domains.research.forYouFeed.getForYouFeed, { limit: 50 });
  const publicFeed = useQuery(api.domains.research.forYouFeed.getPublicForYouFeed, { limit: 50 });
  const recordEngagement = useMutation(api.domains.research.forYouFeed.recordEngagement);

  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const isPublicMode = !authFeed?.items?.length && publicFeed?.items?.length;
  const displayFeed = authFeed?.items?.length ? authFeed : publicFeed;

  // Use dateGroups from feed
  const dateGroups = useMemo(() => {
    if (displayFeed?.dateGroups?.length) {
      return displayFeed.dateGroups;
    }
    if (!displayFeed?.items?.length) return [];

    const groups = new Map<string, any[]>();
    for (const item of displayFeed.items) {
      const dateStr = item.dateString || new Date(item.timestamp).toISOString().split("T")[0];
      if (!groups.has(dateStr)) {
        groups.set(dateStr, []);
      }
      groups.get(dateStr)!.push(item);
    }

    const sortedDates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
    return sortedDates.map(dateStr => ({
      dateString: dateStr,
      displayLabel: formatDateLabel(dateStr),
      items: groups.get(dateStr)!,
    }));
  }, [displayFeed]);

  const handleEngagement = async (
    itemId: string | undefined,
    action: "view" | "click" | "save" | "share",
  ) => {
    if (!itemId) return;
    try {
      await recordEngagement({ itemId, action });
    } catch (error) {
      console.debug("Engagement tracking requires authentication");
    }
  };

  const toggleDateCollapse = (dateString: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateString)) {
        next.delete(dateString);
      } else {
        next.add(dateString);
      }
      return next;
    });
  };

  if (!displayFeed) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame-narrow space-y-4 no-skeleton-animation" aria-busy="true" aria-live="polite">
          {/* Header skeleton */}
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <div className="h-6 bg-surface-secondary rounded w-40" />
              <div className="h-3 bg-surface-secondary/80 rounded w-56" />
            </div>
            <div className="h-9 bg-surface-secondary rounded-lg w-24" />
          </div>
          {/* Card grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="nb-surface-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-surface-secondary rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-secondary rounded w-3/4" />
                    <div className="h-3 bg-surface-secondary/80 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-surface-secondary/80 rounded w-full" />
                  <div className="h-3 bg-surface-secondary/80 rounded w-5/6" />
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      </div>
    );
  }

  if (!displayFeed.items?.length) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame-narrow">
            <div className="text-center max-w-md mx-auto px-6 py-12">
              <SignatureOrb variant="empty" message="Nothing to show yet — check back soon for the latest updates." />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="nb-page-shell text-content">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-4">
          <PageHeroHeader
            icon={<Sparkles className="w-5 h-5" />}
            title={isPublicMode ? "The Daily Brief" : "For You"}
            subtitle={`${formatMastheadDate()} · ${displayFeed.items.length} ${displayFeed.items.length === 1 ? "story" : "stories"}`}
            date={isPublicMode ? "Preview" : "Personalized"}
          />

          {/* Content */}
          {/* NOTE(coworker): Keep this feed in the shared surface language used across Workbench, Activity, and Analytics. */}
          <div className="nb-surface-card overflow-hidden">
            <main className="px-6 py-6 sm:px-8 sm:py-7">
              {dateGroups.map((group: DateGroup, groupIndex: number) => {
          const isCollapsed = collapsedDates.has(group.dateString);
          const heroItem = group.items[0];
          const restItems = group.items.slice(1);

          return (
            <section key={group.dateString} className={groupIndex > 0 ? "mt-12" : ""}>
              {/* Date Section Header */}
              <button
                type="button"
                onClick={() => toggleDateCollapse(group.dateString)}
                aria-label={isCollapsed ? `Expand ${group.displayLabel} section` : `Collapse ${group.displayLabel} section`}
                className="w-full group"
                data-agent-id={`view:feed:date:${group.dateString}`}
                data-agent-action="toggle"
                data-agent-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.displayLabel}`}
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex items-center gap-2 text-content-muted hover:text-content-secondary transition-colors">
                    {isCollapsed ? (
                      <Plus className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                  </div>
                  <h2 className="text-xs font-semibold text-content-muted">
                    {group.displayLabel}
                  </h2>
                  <div className="flex-1 h-px bg-edge" />
                  <span className="text-xs text-content-muted font-normal">
                    {group.items.length} {group.items.length === 1 ? 'story' : 'stories'}
                  </span>
                </div>
              </button>

              {!isCollapsed && (
                <div className="space-y-8">
                  {/* Hero Story */}
                  {heroItem && (
                    <motion.div
                      initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={transition({ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] })}
                    >
                      <HeroCard item={heroItem} onEngagement={handleEngagement} />
                    </motion.div>
                  )}

                  {/* Secondary Stories */}
                  {restItems.length > 0 && (
                    <motion.div
                      className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-edge"
                      variants={instant ? undefined : staggerContainer}
                      initial={instant ? undefined : "hidden"}
                      animate={instant ? undefined : "visible"}
                    >
                      {restItems.map((item: any, idx: number) => (
                        <motion.div key={item.itemId ?? item.metadata?.url ?? `${group.dateString}-${idx}`} variants={instant ? undefined : staggerItem}>
                          <StoryCard
                            item={item}
                            onEngagement={handleEngagement}
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </div>
              )}
            </section>
          );
        })}

              {/* Footer */}
              <footer className="mt-16 pt-8 border-t border-edge text-center">
                <p className="text-sm text-content-muted font-normal">
                  End of feed · {displayFeed.totalCandidates} {displayFeed.totalCandidates === 1 ? "source" : "sources"} analyzed
                </p>
              </footer>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

// Format date for section headers
function formatDateLabel(dateString: string): string {
  const date = new Date(dateString + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return "Yesterday";
  } else {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
}

// Format masthead date
function formatMastheadDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

interface CardProps {
  item: any;
  onEngagement: (itemId: string, action: "view" | "click" | "save" | "share") => void;
}

// Hero story card - large, prominent display
const HeroCard = React.memo(function HeroCard({ item, onEngagement }: CardProps) {
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaved(!saved);
    onEngagement(item.itemId, "save");
  };

  const handleOpen = () => {
    onEngagement(item.itemId, "view");
    if (item.metadata?.url) {
      window.open(item.metadata.url, '_blank');
    }
  };

  const sourceLabel = getSourceLabel(item);
  const domain = getDomain(item.metadata?.url);

  return (
    <article
      onClick={handleOpen}
      className="group cursor-pointer nb-surface-card p-6 hover:border-content-muted/30 transition-colors"
      data-agent-id={`view:feed:item:${item.itemId}`}
      data-agent-action="navigate"
      data-agent-label={item.title}
    >
      <div className="flex flex-col md:flex-row gap-6">
        {/* Text Content */}
        <div className="flex-1 space-y-3">
          {/* Category Tag */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-content-muted">
              {sourceLabel}
            </span>
            {item.metadata?.sector && (
              <>
                <span className="text-content-muted/60">·</span>
                <span className="text-xs text-content-muted">{item.metadata.sector}</span>
              </>
            )}
          </div>

          {/* Headline */}
          <h3 className="text-2xl md:text-[1.75rem] font-semibold text-content leading-tight group-hover:text-content-secondary transition-colors">
            {sanitizeReadableText(decodeHtmlEntities(item.title))}
          </h3>

          {/* Excerpt */}
          {item.snippet && (
            <p className="text-content-muted leading-relaxed text-base font-normal line-clamp-3">
              {cleanSnippet(item.snippet)}
            </p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-4 pt-2">
            {domain && (
              <span className="text-sm text-content-muted flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                {domain}
              </span>
            )}
            <span className="text-sm text-content-muted/80">
              {formatTimeAgo(item.timestamp)}
            </span>
            <button
              type="button"
              onClick={handleSave}
              className={`ml-auto p-2 rounded-full transition-colors ${saved ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10' : 'text-content-muted hover:text-content-secondary hover:bg-surface-secondary'
                }`}
              title={saved ? "Saved" : "Save for later"}
              aria-label={saved ? "Saved" : "Save for later"}
              data-agent-id={`view:feed:save:${item.itemId}`}
              data-agent-action="toggle"
              data-agent-label={saved ? "Unsave item" : "Save for later"}
            >
              <Bookmark className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>

        {/* Visual Element */}
        <div className="w-full md:w-64 h-40 md:h-auto bg-surface-secondary rounded-lg flex items-center justify-center flex-shrink-0 border border-edge/70">
          <span className="text-5xl opacity-60">{getSourceIcon(item)}</span>
        </div>
      </div>
    </article>
  );
}, (prevProps, nextProps) => prevProps.item.itemId === nextProps.item.itemId);

// Secondary story card - compact display
const StoryCard = React.memo(function StoryCard({ item, onEngagement }: CardProps) {
  const handleOpen = () => {
    onEngagement(item.itemId, "view");
    if (item.metadata?.url) {
      window.open(item.metadata.url, '_blank');
    }
  };

  const sourceLabel = getSourceLabel(item);
  const domain = getDomain(item.metadata?.url);

  return (
    <article
      onClick={handleOpen}
      className="group cursor-pointer nb-surface-card p-4 hover:border-content-muted/30 transition-colors"
      data-agent-id={`view:feed:item:${item.itemId}`}
      data-agent-action="navigate"
      data-agent-label={item.title}
    >
      <div className="space-y-2">
        {/* Category */}
        <span className="text-[11px] font-medium text-content-muted">
          {sourceLabel}
        </span>

        {/* Headline */}
        <h4 className="text-lg font-semibold text-content leading-snug group-hover:text-content-secondary transition-colors line-clamp-2">
          {sanitizeReadableText(decodeHtmlEntities(item.title))}
        </h4>

        {/* Excerpt */}
        {item.snippet && (
          <p className="text-sm text-content-muted leading-relaxed line-clamp-2 font-normal">
            {cleanSnippet(item.snippet)}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-content-muted/80 pt-1">
          {domain && <span>{domain}</span>}
          <span>{formatTimeAgo(item.timestamp)}</span>
          <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </article>
  );
}, (prevProps, nextProps) => prevProps.item.itemId === nextProps.item.itemId);

// Helper functions
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function decodeHtmlEntities(text: string): string {
  if (!text) return "";
  
  if (typeof window !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(text, "text/html");
      return doc.documentElement.textContent || text;
    } catch {
      // fallback
    }
  }

  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanSnippet(snippet: string): string {
  if (snippet.startsWith('{') || snippet.startsWith('[')) {
    return 'Read more →';
  }
  // Strip markdown bold/italic syntax that leaks into preview text
  let clean = sanitizeReadableText(decodeHtmlEntities(snippet));
  // NOTE(coworker): Keep number formatting in presentation layer so data stays raw.
  clean = clean.replace(
    /\b(\d{4,})\b(?=\s+(?:points?|comments?|upvotes?|likes?|views?|items?|stories?|sources?|stars?|forks?)\b)/gi,
    (_full, digits) => Number(digits).toLocaleString("en-US"),
  );
  // Fix common singular/plural glitches that leak from upstream sources (keeps UI polished).
  clean = clean.replace(/\b1\s+comments\b/gi, "1 comment");
  clean = clean.replace(/\b1\s+points\b/gi, "1 point");
  clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1'); // **bold** → bold
  clean = clean.replace(/\*([^*]+)\*/g, '$1');       // *italic* → italic
  clean = clean.replace(/__([^_]+)__/g, '$1');       // __bold__ → bold
  clean = clean.replace(/_([^_]+)_/g, '$1');         // _italic_ → italic
  clean = clean.replace(/#{1,6}\s+/g, '');           // ## headings → remove
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
  return clean;
}

function getDomain(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return null;
  }
}

function getSourceLabel(item: any): string {
  const kind = item.metadata?.kind;
  if (kind === 'linkedin_funding') return 'Funding';
  if (kind === 'daily_brief' || kind === 'daily_snapshot') return 'AI Brief';

  const source = item.metadata?.source;
  // Sanitize internal system identifiers — never show cron/job names to users
  if (source && !/CRON|_JOB|SYSTEM_|INTERNAL_/i.test(source)) return source;
  if (source && /DAILY_BRIEF|BRIEF/i.test(source)) return 'AI Brief';
  if (source && /CRON|_JOB|SYSTEM_|INTERNAL_/i.test(source)) return 'Automated';

  if (item.source === 'trending') return 'Trending';
  if (item.source === 'in_network') return 'Following';
  return 'Discover';
}

function getSourceIcon(item: any): string {
  const kind = item.metadata?.kind;
  if (kind === 'linkedin_funding') return '📊';
  if (kind === 'daily_brief' || kind === 'daily_snapshot') return '📰';

  const source = item.metadata?.source;
  const iconMap: Record<string, string> = {
    'YCombinator': '🚀',
    'TechCrunch': '📱',
    'Hugging Face': '🤖',
    'ArXiv': '📄',
    'GitHub': '💻',
    'Reddit': '💬',
    'LinkedIn': '💼',
  };
  return iconMap[source || ''] || '📰';
}
