"use client";

/**
 * ReplyThread - Threaded Reply Display
 *
 * Displays nested replies to a narrative post in a tree structure.
 * Supports evidence, question, correction, and support reply types.
 *
 * @module features/narrative/components/NarrativeFeed/ReplyThread
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Bot,
  ChevronDown,
  ChevronUp,
  BookOpen,
  HelpCircle,
  Edit,
  ThumbsUp,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMotionConfig } from "@/lib/motion";

/**
 * Reply type
 */
type ReplyType = "evidence" | "question" | "correction" | "support";

/**
 * Reply data structure
 */
export interface ReplyData {
  id: string;
  replyId: string;
  postId: string;
  parentReplyId?: string;
  replyType: ReplyType;
  content: string;
  evidenceArtifactIds?: string[];
  authorType: "agent" | "human";
  authorId: string;
  createdAt: number;
  children?: ReplyData[];
}

interface ReplyThreadProps {
  replies: ReplyData[];
  depth?: number;
  maxDepth?: number;
  onViewEvidence?: (artifactIds: string[]) => void;
  className?: string;
}

/**
 * Get reply type display info
 */
function getReplyTypeDisplay(type: ReplyType): { icon: React.ReactNode; label: string; color: string } {
  switch (type) {
    case "evidence":
      return {
        icon: <BookOpen className="w-3 h-3" />,
        label: "Evidence",
        color: "text-green-500 border-green-500/30 bg-green-500/5",
      };
    case "question":
      return {
        icon: <HelpCircle className="w-3 h-3" />,
        label: "Question",
        color: "text-purple-500 border-purple-500/30 bg-purple-500/5",
      };
    case "correction":
      return {
        icon: <Edit className="w-3 h-3" />,
        label: "Correction",
        color: "text-orange-500 border-orange-500/30 bg-orange-500/5",
      };
    case "support":
      return {
        icon: <ThumbsUp className="w-3 h-3" />,
        label: "Support",
        color: "text-blue-500 border-blue-500/30 bg-blue-500/5",
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
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Single Reply Component
 */
function Reply({
  reply,
  depth,
  maxDepth,
  onViewEvidence,
}: {
  reply: ReplyData;
  depth: number;
  maxDepth: number;
  onViewEvidence?: (artifactIds: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { instant, transition } = useMotionConfig();
  const typeDisplay = getReplyTypeDisplay(reply.replyType);
  const hasChildren = reply.children && reply.children.length > 0;

  return (
    <div className={cn("relative", depth > 0 && "ml-4 pl-3 border-l border-border")}>
      <motion.div
        initial={{ opacity: instant ? 1 : 0, x: instant ? 0 : -5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={transition(0.2)}
        className={cn(
          "rounded-md p-2 mb-2 border",
          typeDisplay.color
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className="flex items-center gap-1">
            {typeDisplay.icon}
            <span className="font-medium">{typeDisplay.label}</span>
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {reply.authorType === "agent" ? (
              <Bot className="w-3 h-3" />
            ) : (
              <User className="w-3 h-3" />
            )}
            {reply.authorId}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">
            {formatTimeAgo(reply.createdAt)}
          </span>
        </div>

        {/* Content */}
        <p className="text-sm text-foreground/90">{reply.content}</p>

        {/* Evidence links */}
        {reply.evidenceArtifactIds && reply.evidenceArtifactIds.length > 0 && (
          <button
            type="button"
            onClick={() => onViewEvidence?.(reply.evidenceArtifactIds!)}
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
          >
            <ExternalLink className="w-3 h-3" />
            View {reply.evidenceArtifactIds.length} source(s)
          </button>
        )}
      </motion.div>

      {/* Children */}
      {hasChildren && (
        <>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-3 h-3" />
                Show {reply.children!.length} replies
              </>
            ) : (
              <>
                <ChevronUp className="w-3 h-3" />
                Hide replies
              </>
            )}
          </button>

          <AnimatePresence>
            {!collapsed && depth < maxDepth && (
              <motion.div
                initial={{ opacity: instant ? 1 : 0, height: instant ? "auto" : 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: instant ? 1 : 0, height: instant ? "auto" : 0 }}
                transition={transition(0.2)}
              >
                {reply.children!.map((child) => (
                  <Reply
                    key={child.id}
                    reply={child}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    onViewEvidence={onViewEvidence}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/**
 * ReplyThread Component
 */
export function ReplyThread({
  replies,
  depth = 0,
  maxDepth = 5,
  onViewEvidence,
  className,
}: ReplyThreadProps) {
  if (replies.length === 0) {
    return (
      <div className={cn("text-center text-sm text-muted-foreground py-4", className)}>
        No replies yet
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {replies.map((reply) => (
        <Reply
          key={reply.id}
          reply={reply}
          depth={depth}
          maxDepth={maxDepth}
          onViewEvidence={onViewEvidence}
        />
      ))}
    </div>
  );
}

export default ReplyThread;
