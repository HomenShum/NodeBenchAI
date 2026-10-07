"use client";

/**
 * PostCard - Social Substrate Post Display
 *
 * Displays a narrative post (delta update, thesis revision, etc.)
 * in an X/Reddit-style card format with citations and reactions.
 *
 * @module features/narrative/components/NarrativeFeed/PostCard
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  User,
  Bot,
  BookOpen,
  Zap,
  AlertTriangle,
  HelpCircle,
  Edit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMotionConfig } from "@/lib/motion";

/**
 * Post type for display
 */
type PostType =
  | "delta_update"
  | "thesis_revision"
  | "evidence_addition"
  | "counterpoint"
  | "question"
  | "correction";

/**
 * Author type
 */
type AuthorType = "agent" | "human";

/**
 * Citation structure
 */
interface Citation {
  citationKey: string;
  url?: string;
  title?: string;
  pageIndex?: number;
  publishedAt?: number;
}

/**
 * Post data structure
 */
export interface PostData {
  id: string;
  postId: string;
  threadId: string;
  threadName?: string;
  postType: PostType;
  title?: string;
  content: string;
  changeSummary?: string[];
  citations: Citation[];
  authorType: AuthorType;
  authorId: string;
  authorConfidence?: number;
  isVerified: boolean;
  hasContradictions: boolean;
  requiresAdjudication: boolean;
  replyCount: number;
  createdAt: number;
  status?: string;
}

interface PostCardProps {
  post: PostData;
  onReply?: () => void;
  onViewEvidence?: ((citations: Citation[]) => void) | (() => void);
  onViewThread?: () => void;
  onToggleReplies?: () => void;
  replyCount?: number;
  className?: string;
}

/**
 * Get post type icon and label
 */
function getPostTypeDisplay(type: PostType): { icon: React.ReactNode; label: string; color: string } {
  switch (type) {
    case "delta_update":
      return {
        icon: <Clock className="w-4 h-4" />,
        label: "Update",
        color: "text-blue-500 bg-blue-500/10",
      };
    case "thesis_revision":
      return {
        icon: <Zap className="w-4 h-4" />,
        label: "Revised Prediction",
        color: "text-amber-500 bg-amber-500/10",
      };
    case "evidence_addition":
      return {
        icon: <BookOpen className="w-4 h-4" />,
        label: "Evidence",
        color: "text-green-500 bg-green-500/10",
      };
    case "counterpoint":
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        label: "Counterpoint",
        color: "text-red-500 bg-red-500/10",
      };
    case "question":
      return {
        icon: <HelpCircle className="w-4 h-4" />,
        label: "Question",
        color: "text-purple-500 bg-purple-500/10",
      };
    case "correction":
      return {
        icon: <Edit className="w-4 h-4" />,
        label: "Correction",
        color: "text-orange-500 bg-orange-500/10",
      };
  }
}

/**
 * Format relative time
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * PostCard Component
 */
export function PostCard({
  post,
  onReply,
  onViewEvidence,
  onViewThread,
  className,
}: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { instant, transition } = useMotionConfig();
  const typeDisplay = getPostTypeDisplay(post.postType);

  return (
    <motion.article
      initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition(0.3)}
      className={cn(
        "bg-card border border-border rounded-lg p-4 hover:border-muted-foreground/30 transition-colors",
        post.requiresAdjudication && "border-amber-500/50",
        post.hasContradictions && "border-red-500/50",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Post type badge */}
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              typeDisplay.color
            )}
          >
            {typeDisplay.icon}
            {typeDisplay.label}
          </span>

          {/* Thread name */}
          {post.threadName && (
            <button
              type="button"
              onClick={onViewThread}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              in {post.threadName}
            </button>
          )}
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-1">
          {post.isVerified && (
            <span className="text-green-500" title="Verified">
              <CheckCircle className="w-4 h-4" />
            </span>
          )}
          {post.hasContradictions && (
            <span className="text-red-500" title="Has contradictions">
              <AlertCircle className="w-4 h-4" />
            </span>
          )}
          {post.requiresAdjudication && (
            <span className="text-amber-500" title="Needs review">
              <AlertTriangle className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      {post.title && (
        <h3 className="font-semibold text-foreground mb-2">{post.title}</h3>
      )}

      {/* Change Summary (for delta updates) */}
      {post.changeSummary && post.changeSummary.length > 0 && (
        <ul className="text-sm text-muted-foreground mb-3 space-y-1">
          {post.changeSummary.slice(0, expanded ? undefined : 3).map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              <span>{item}</span>
            </li>
          ))}
          {!expanded && post.changeSummary.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs text-primary hover:underline mt-1"
            >
              +{post.changeSummary.length - 3} more changes
            </button>
          )}
        </ul>
      )}

      {/* Content */}
      <div className="text-sm text-foreground/90 mb-3">
        <p className={cn(!expanded && "line-clamp-3")}>{post.content}</p>
        {post.content.length > 200 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Read more
              </>
            )}
          </button>
        )}
      </div>

      {/* Citations */}
      {post.citations.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground">Sources:</span>
          <div className="flex flex-wrap gap-1">
            {post.citations.slice(0, 3).map((citation, idx) => (
              <a
                key={idx}
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline px-1.5 py-0.5 bg-primary/5 rounded"
              >
                {citation.citationKey}
                {citation.pageIndex != null && (
                  <span className="text-xs px-1 py-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded">
                    p.{citation.pageIndex}
                  </span>
                )}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
            {post.citations.length > 3 && (
              <button
                type="button"
                onClick={() => onViewEvidence?.(post.citations)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                +{post.citations.length - 3} more
              </button>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
        {/* Author */}
        <div className="flex items-center gap-2">
          {post.authorType === "agent" ? (
            <Bot className="w-3.5 h-3.5" />
          ) : (
            <User className="w-3.5 h-3.5" />
          )}
          <span>{post.authorId}</span>
          {post.authorConfidence && (
            <span className="text-muted-foreground/60">
              ({(post.authorConfidence * 100).toFixed(0)}% confidence)
            </span>
          )}
          <span>•</span>
          <span>{formatTimeAgo(post.createdAt)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReply}
            aria-label="Reply to post"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {post.replyCount > 0 && <span>{post.replyCount}</span>}
          </button>
        </div>
      </div>
    </motion.article>
  );
}

export default PostCard;
