import React, { useState, useMemo, useCallback } from "react";
import { api } from "../../../../../convex/_generated/api";
import { useStableQuery } from "@/hooks/useStableQuery";
import { LinkedInPostCard } from "./LinkedInPostCard";
import { EntityFindingsPanel } from "./EntityFindingsPanel";
import {
  Linkedin,
  Filter,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

const INITIAL_DATE_GROUPS = 3;
const LOAD_MORE_INCREMENT = 3;

const POST_TYPE_FILTERS = [
  { key: "all", label: "All Posts" },
  { key: "daily_digest", label: "Daily Digest" },
  { key: "funding_tracker", label: "Funding Tracker" },
  { key: "funding_brief", label: "Funding Brief" },
  { key: "fda", label: "FDA Updates" },
  { key: "clinical", label: "Clinical Trials" },
  { key: "research", label: "Research" },
  { key: "ma", label: "Deals" },
];

export const LinkedInPostArchiveView: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState("all");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [visibleGroups, setVisibleGroups] = useState(INITIAL_DATE_GROUPS);

  const archiveData = useStableQuery(
    api.domains.social.linkedinArchiveQueries.getArchivedPosts,
    activeFilter === "all"
      ? { limit: 200, dedupe: true }
      : { postType: activeFilter, limit: 200, dedupe: true }
  );

  const stats = useStableQuery(api.domains.social.linkedinArchiveQueries.getArchiveStats, { dedupe: true });

  const isFirstLoad = archiveData === undefined;

  // Group posts by date
  const dateGroups = useMemo(() => {
    if (!archiveData?.posts) return [];

    const groups = new Map<string, typeof archiveData.posts>();
    for (const post of archiveData.posts) {
      const existing = groups.get(post.dateString) || [];
      existing.push(post);
      groups.set(post.dateString, existing);
    }

    return Array.from(groups.entries())
      .sort(([a]: [string, unknown], [b]: [string, unknown]) => b.localeCompare(a))
      .map(([date, posts]) => ({ date, posts }));
  }, [archiveData?.posts]);

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const loadMore = useCallback(() => {
    setVisibleGroups((prev) => prev + LOAD_MORE_INCREMENT);
  }, []);

  // Reset visible groups when filter changes
  const handleFilterChange = useCallback((filter: string) => {
    setActiveFilter(filter);
    setVisibleGroups(INITIAL_DATE_GROUPS);
  }, []);

  const visibleDateGroups = useMemo(() => {
    return dateGroups.slice(0, visibleGroups);
  }, [dateGroups, visibleGroups]);

  const hasMore = dateGroups.length > visibleGroups;

  const formatDateHeader = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00");
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = today.toISOString().split("T")[0];
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    if (dateString === todayStr) return "Today";
    if (dateString === yesterdayStr) return "Yesterday";

    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame-narrow">
      {/* Header - always visible */}
      <div className="sticky top-0 z-10 nb-surface-card border-edge/70">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Linkedin className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="type-page-title text-content">LinkedIn Posts</h1>
                <p className="text-xs text-content-muted">
                  {stats
                    ? `${stats.totalPosts} ${stats.totalPosts === 1 ? 'post' : 'posts'} across ${stats.recentDates.length} ${stats.recentDates.length === 1 ? 'day' : 'days'}`
                    : "\u00A0"}
                </p>
              </div>
            </div>

            {stats && (
              <div className="hidden sm:flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-content-muted">
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>{stats.byType.length} post types</span>
                </div>
              </div>
            )}
          </div>

          {/* Filter chips - always visible */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Filter className="w-3.5 h-3.5 text-content-muted flex-shrink-0" />
            {POST_TYPE_FILTERS.map((filter) => {
              const count = stats
                ? filter.key === "all"
                  ? stats.totalPosts
                  : stats.byType.find((t: any) => t.postType === filter.key)?.count || 0
                : 0;

              return (
                <button
                  key={filter.key}
                  onClick={() => handleFilterChange(filter.key)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeFilter === filter.key
                        ? "bg-indigo-600 text-white"
                        : "bg-surface text-content-muted hover:bg-surface-hover border border-edge"
                      }`}
                  >
                  {filter.label}
                  {count > 0 && (
                    <span className={`ml-1.5 ${activeFilter === filter.key ? "text-white/80" : "text-content-muted"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Findings by entity (cheap retrieval substrate for chat) */}
      <div className="px-4 pt-6">
        <EntityFindingsPanel />
      </div>

      {/* Content */}
      <div className="px-4 py-6">
        {dateGroups.length === 0 && !isFirstLoad ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-indigo-500/10 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Linkedin className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No posts found</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {activeFilter === "all"
                ? "Posts will appear here once the archive starts collecting them."
                : `No ${POST_TYPE_FILTERS.find((f) => f.key === activeFilter)?.label || activeFilter} posts found. Try a different filter.`}
            </p>
          </div>
        ) : dateGroups.length === 0 && isFirstLoad ? (
          // First load only - minimal placeholder
          <div className="space-y-4 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-4 bg-muted/40 rounded w-48 mb-3" />
                <div className="nb-surface-card p-4 space-y-2">
                  <div className="h-3 bg-muted/30 rounded w-24" />
                  <div className="h-3 bg-muted/30 rounded w-full" />
                  <div className="h-3 bg-muted/30 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {visibleDateGroups.map(({ date, posts }) => {
              const isCollapsed = collapsedDates.has(date);

              return (
                <div key={date}>
                  {/* Date header */}
                  <button
                    onClick={() => toggleDate(date)}
                    className="flex items-center gap-2 mb-3 group w-full text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                    <h2 className="text-sm font-semibold text-foreground tracking-wide">
                      {formatDateHeader(date)}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {posts.length} {posts.length === 1 ? "post" : "posts"}
                    </span>
                    <div className="flex-1 border-t border-border/60 ml-2" />
                  </button>

                  {/* Posts */}
                  {!isCollapsed && (
                    <div className="space-y-3 ml-6">
                      {posts.map((post: any) => (
                        <LinkedInPostCard
                          key={post._id}
                          content={post.content}
                          postType={post.postType}
                          persona={post.persona}
                          dateString={post.dateString}
                          postedAt={post.postedAt}
                          postUrl={post.postUrl ?? undefined}
                          factCheckCount={post.factCheckCount ?? undefined}
                          metadata={post.metadata as Record<string, unknown> | undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center pt-4 pb-8">
                <button
                  onClick={loadMore}
                  className="flex items-center gap-2 px-6 py-2.5 bg-surface border border-edge rounded-lg text-sm font-medium text-content hover:bg-surface-hover transition-colors shadow-sm"
                >
                  <Loader2 className="w-4 h-4 text-muted-foreground" />
                  Load {Math.min(LOAD_MORE_INCREMENT, dateGroups.length - visibleGroups)} more days
                  <span className="text-xs text-muted-foreground">
                    ({dateGroups.length - visibleGroups} remaining)
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
};

export default LinkedInPostArchiveView;
