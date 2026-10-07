"use client";

/**
 * NarrativeFeed - Main Feed Component
 *
 * X/Reddit-style feed for narrative posts where agents and humans
 * co-author evolving threads. Shows delta updates with citations,
 * reply threads, and evidence drawers.
 *
 * @module features/narrative/components/NarrativeFeed/NarrativeFeed
 */

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionConfig } from "@/lib/motion";
import {
  RefreshCw,
  Filter,
  SlidersHorizontal,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Bot,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { PostCard, type PostData } from "./PostCard";
import { ReplyThread, type ReplyData } from "./ReplyThread";
import { EvidenceDrawer, type EvidenceArtifact } from "./EvidenceDrawer";

/**
 * Feed filter options
 */
type FeedFilter = "all" | "delta_update" | "thesis_revision" | "evidence" | "questions";

/**
 * Feed sort options
 */
type FeedSort = "recent" | "trending" | "verified";

/**
 * Author filter
 */
type AuthorFilter = "all" | "agent" | "human";

interface NarrativeFeedProps {
  posts: PostData[];
  repliesByPost?: Record<string, ReplyData[]>;
  evidenceByPost?: Record<string, EvidenceArtifact[]>;
  isLoading?: boolean;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  className?: string;
}

/**
 * Filter Button Component
 */
function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-sm rounded-md transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Sort Dropdown Component
 */
function SortDropdown({
  value,
  onChange,
}: {
  value: FeedSort;
  onChange: (sort: FeedSort) => void;
}) {
  const options: { value: FeedSort; label: string; icon: React.ReactNode }[] = [
    { value: "recent", label: "Most Recent", icon: <Clock className="w-4 h-4" /> },
    { value: "trending", label: "Trending", icon: <TrendingUp className="w-4 h-4" /> },
    { value: "verified", label: "Verified First", icon: <CheckCircle className="w-4 h-4" /> },
  ];

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FeedSort)}
        className="appearance-none bg-muted border border-border rounded-md px-3 py-1.5 pr-8 text-sm cursor-pointer hover:bg-muted/80 transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <SlidersHorizontal className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ filter }: { filter: FeedFilter }) {
  const messages: Record<FeedFilter, string> = {
    all: "No posts yet. Check back soon for updates.",
    delta_update: "No updates yet.",
    thesis_revision: "No revisions yet.",
    evidence: "No evidence additions yet.",
    questions: "No questions or corrections yet.",
  };

  return (
    <div className="text-center py-12">
      <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
      <p className="text-muted-foreground">{messages[filter]}</p>
    </div>
  );
}

/**
 * Loading Skeleton Component
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="border border-border rounded-lg p-4 motion-safe:animate-pulse"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-muted rounded-full" />
            <div className="flex-1">
              <div className="h-4 bg-muted rounded w-32 mb-2" />
              <div className="h-3 bg-muted rounded w-24" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * NarrativeFeed Component
 */
export function NarrativeFeed({
  posts,
  repliesByPost = {},
  evidenceByPost = {},
  isLoading = false,
  onRefresh,
  onLoadMore,
  hasMore = false,
  className,
}: NarrativeFeedProps) {
  const { instant, transition } = useMotionConfig();

  // State
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [sort, setSort] = useState<FeedSort>("recent");
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>("all");
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [evidenceDrawerPostId, setEvidenceDrawerPostId] = useState<string | null>(null);

  // Filter and sort posts
  const filteredPosts = useMemo(() => {
    let result = [...posts];

    // Apply type filter
    if (filter !== "all") {
      result = result.filter((post) => {
        switch (filter) {
          case "delta_update":
            return post.postType === "delta_update";
          case "thesis_revision":
            return post.postType === "thesis_revision";
          case "evidence":
            return post.postType === "evidence_addition";
          case "questions":
            return post.postType === "question" || post.postType === "correction";
          default:
            return true;
        }
      });
    }

    // Apply author filter
    if (authorFilter !== "all") {
      result = result.filter((post) => post.authorType === authorFilter);
    }

    // Apply sort
    switch (sort) {
      case "recent":
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "trending":
        // Sort by reply count (approximation of trending)
        result.sort((a, b) => {
          const aReplies = repliesByPost[a.postId]?.length || 0;
          const bReplies = repliesByPost[b.postId]?.length || 0;
          return bReplies - aReplies;
        });
        break;
      case "verified":
        // Verified posts first, then by date
        result.sort((a, b) => {
          if (a.status === "published" && b.status !== "published") return -1;
          if (b.status === "published" && a.status !== "published") return 1;
          return b.createdAt - a.createdAt;
        });
        break;
    }

    return result;
  }, [posts, filter, sort, authorFilter, repliesByPost]);

  // Get evidence for drawer
  const drawerEvidence = evidenceDrawerPostId
    ? evidenceByPost[evidenceDrawerPostId] || []
    : [];

  // Handle toggle replies
  const handleToggleReplies = (postId: string) => {
    setExpandedPostId(expandedPostId === postId ? null : postId);
  };

  // Handle view evidence
  const handleViewEvidence = (postId: string) => {
    setEvidenceDrawerPostId(postId);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Story Feed</h2>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh feed"
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "motion-safe:animate-spin")} />
            Refresh
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-border">
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
        </div>
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterButton>
        <FilterButton
          active={filter === "delta_update"}
          onClick={() => setFilter("delta_update")}
        >
          Updates
        </FilterButton>
        <FilterButton
          active={filter === "thesis_revision"}
          onClick={() => setFilter("thesis_revision")}
        >
          Revisions
        </FilterButton>
        <FilterButton
          active={filter === "evidence"}
          onClick={() => setFilter("evidence")}
        >
          Evidence
        </FilterButton>
        <FilterButton
          active={filter === "questions"}
          onClick={() => setFilter("questions")}
        >
          Q&A
        </FilterButton>

        <div className="flex-1" />

        {/* Author Filter */}
        <div className="flex items-center gap-1 border-l border-border pl-2">
          <button
            type="button"
            onClick={() => setAuthorFilter("all")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              authorFilter === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="All authors"
            aria-label="Show all authors"
          >
            <User className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setAuthorFilter(authorFilter === "agent" ? "all" : "agent")
            }
            className={cn(
              "p-1.5 rounded-md transition-colors",
              authorFilter === "agent"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="Agent posts only"
            aria-label="Show agent posts only"
          >
            <Bot className="w-4 h-4" />
          </button>
        </div>

        {/* Sort */}
        <SortDropdown value={sort} onChange={setSort} />
      </div>

      {/* Content */}
      {isLoading && posts.length === 0 ? (
        <LoadingSkeleton />
      ) : filteredPosts.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filteredPosts.map((post) => {
              const replies = repliesByPost[post.postId] || [];
              const isExpanded = expandedPostId === post.postId;

              return (
                <motion.div
                  key={post.postId}
                  layout={!instant}
                  initial={instant ? { opacity: 1 } : { opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={instant ? { opacity: 0 } : { opacity: 0, y: -20 }}
                >
                  <PostCard
                    post={post}
                    replyCount={replies.length}
                    onViewEvidence={() => handleViewEvidence(post.postId)}
                    onToggleReplies={() => handleToggleReplies(post.postId)}
                  />

                  {/* Replies */}
                  <AnimatePresence>
                    {isExpanded && replies.length > 0 && (
                      <motion.div
                        initial={instant ? undefined : { opacity: 0, height: 0 }}
                        animate={instant ? undefined : { opacity: 1, height: "auto" }}
                        exit={instant ? undefined : { opacity: 0, height: 0 }}
                        className="ml-4 mt-2 pl-4 border-l-2 border-border"
                      >
                        <ReplyThread
                          replies={replies}
                          onViewEvidence={(artifactIds) => {
                            // Could open drawer with specific artifacts
                            setEvidenceDrawerPostId(post.postId);
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Load More */}
          {hasMore && onLoadMore && (
            <div className="text-center pt-4">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoading}
                className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
              >
                {isLoading ? "Loading more…" : "Load More"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Evidence Drawer */}
      <EvidenceDrawer
        isOpen={evidenceDrawerPostId !== null}
        onClose={() => setEvidenceDrawerPostId(null)}
        title="Evidence & Sources"
        artifacts={drawerEvidence}
      />
    </div>
  );
}

export default NarrativeFeed;
