"use client";

import React from "react";
import { motion } from "framer-motion";
import { useMotionConfig } from "../../../lib/motion";
import {
  Mail,
  Clock,
  Hash,
  ExternalLink,
  ChevronRight,
  Newspaper,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Calendar,
  Send,
  Loader2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DigestTopic {
  /** Topic hashtag (e.g., "#ai", "#biotech") */
  hashtag: string;
  /** Number of items found for this topic */
  itemCount: number;
  /** Top headline for this topic */
  topHeadline?: string;
  /** Sentiment indicator */
  sentiment?: "positive" | "neutral" | "negative";
}

export interface DigestItem {
  /** Item ID */
  id: string;
  /** Item title */
  title: string;
  /** Brief summary */
  summary: string;
  /** Source name */
  source: string;
  /** Source URL */
  url?: string;
  /** Related topics */
  topics: string[];
  /** Published timestamp */
  publishedAt: string;
  /** Item type */
  type: "news" | "analysis" | "alert" | "update";
}

export interface EmailDigest {
  /** Digest ID */
  id: string;
  /** Digest date */
  date: string;
  /** User's tracked topics */
  topics: DigestTopic[];
  /** Digest items */
  items: DigestItem[];
  /** Executive summary */
  executiveSummary: string;
  /** Key metrics */
  metrics?: {
    totalItems: number;
    newAlerts: number;
    topMovers: number;
  };
  /** Scheduled send time */
  scheduledAt?: string;
  /** Actual send time */
  sentAt?: string;
  /** Status */
  status: "draft" | "scheduled" | "sent" | "failed";
}

interface EmailDigestPreviewProps {
  /** Digest data */
  digest: EmailDigest;
  /** Callback when an item is clicked */
  onItemClick?: (item: DigestItem) => void;
  /** Callback when a topic is clicked */
  onTopicClick?: (hashtag: string) => void;
  /** Callback when send button is clicked */
  onSend?: () => Promise<void>;
  /** Whether send is in progress */
  isSending?: boolean;
  /** Custom class name */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const getItemIcon = (type: DigestItem["type"]) => {
  switch (type) {
    case "news":
      return Newspaper;
    case "analysis":
      return TrendingUp;
    case "alert":
      return AlertCircle;
    case "update":
      return CheckCircle;
    default:
      return Newspaper;
  }
};

const getItemColors = (type: DigestItem["type"]) => {
  switch (type) {
    case "news":
      return "bg-blue-50 text-blue-600";
    case "analysis":
      return "bg-purple-50 text-purple-600";
    case "alert":
      return "bg-red-50 text-red-600";
    case "update":
      return "bg-green-50 text-green-600";
    default:
      return "bg-surface-secondary text-content";
  }
};

const getSentimentColor = (sentiment?: DigestTopic["sentiment"]) => {
  switch (sentiment) {
    case "positive":
      return "text-green-600";
    case "negative":
      return "text-red-600";
    default:
      return "text-content";
  }
};

const getStatusBadge = (status: EmailDigest["status"]) => {
  switch (status) {
    case "sent":
      return { icon: CheckCircle, text: "Sent", color: "bg-green-50 text-green-600" };
    case "scheduled":
      return { icon: Clock, text: "Scheduled", color: "bg-amber-50 text-amber-600" };
    case "failed":
      return { icon: AlertCircle, text: "Failed", color: "bg-red-50 text-red-600" };
    case "draft":
    default:
      return { icon: Mail, text: "Draft", color: "bg-surface-secondary text-content" };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TOPIC CHIP COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface TopicChipProps {
  topic: DigestTopic;
  onClick?: () => void;
}

const TopicChip: React.FC<TopicChipProps> = ({ topic, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-secondary hover:bg-surface-secondary transition-colors"
  >
    <Hash className="w-3 h-3 text-content-secondary" />
    <span className="text-sm font-medium text-content">{topic.hashtag.replace("#", "")}</span>
    <span className={`text-xs ${getSentimentColor(topic.sentiment)}`}>
      {topic.itemCount}
    </span>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════
// DIGEST ITEM COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface DigestItemCardProps {
  item: DigestItem;
  onClick?: () => void;
}

const DigestItemCard: React.FC<DigestItemCardProps> = ({ item, onClick }) => {
  const { instant } = useMotionConfig();
  const Icon = getItemIcon(item.type);
  const colors = getItemColors(item.type);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={!instant ? { scale: 1.01 } : undefined}
      className="w-full text-left p-4 rounded-lg border border-edge hover:shadow-md hover:border-primary/20 transition-all duration-200"
    >
      <div className="flex items-start gap-3">
        <span className={`p-2 rounded-lg ${colors}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-content line-clamp-1">{item.title}</h4>
          <p className="text-sm text-content line-clamp-2 mt-1">{item.summary}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary">
            <span>{item.source}</span>
            <span>•</span>
            <span>{new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {item.url && (
              <>
                <span>•</span>
                <ExternalLink className="w-3 h-3" />
              </>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[color:var(--border-color)] flex-shrink-0" />
      </div>
    </motion.button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * EmailDigestPreview - Preview component for daily email digests
 *
 * Displays a preview of the personalized daily digest with:
 * - Executive summary
 * - Tracked topics with item counts
 * - Digest items organized by type
 * - Send status and scheduling info
 */
export const EmailDigestPreview: React.FC<EmailDigestPreviewProps> = ({
  digest,
  onItemClick,
  onTopicClick,
  onSend,
  isSending = false,
  className = "",
}) => {
  const statusBadge = getStatusBadge(digest.status);
  const StatusIcon = statusBadge.icon;

  return (
    <div className={`bg-surface rounded-lg border border-edge shadow-sm ${className}`}>
      {/* Header */}
      <div className="p-6 border-b border-edge">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-content">Daily Digest</h2>
              <div className="flex items-center gap-2 text-sm text-content-secondary">
                <Calendar className="w-3.5 h-3.5" />
                <span>{new Date(digest.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${statusBadge.color}`}>
              <StatusIcon className="w-3 h-3" />
              {statusBadge.text}
            </span>
            {onSend && digest.status !== "sent" && (
              <button
                type="button"
                onClick={onSend}
                disabled={isSending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-3 h-3" />
                    Send Now
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Metrics */}
        {digest.metrics && (
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-edge">
            <div className="text-center">
              <div className="text-2xl font-bold text-content">{digest.metrics.totalItems}</div>
              <div className="text-xs text-content-secondary">Items</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{digest.metrics.newAlerts}</div>
              <div className="text-xs text-content-secondary">Alerts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{digest.metrics.topMovers}</div>
              <div className="text-xs text-content-secondary">Movers</div>
            </div>
          </div>
        )}
      </div>

      {/* Executive Summary */}
      <div className="p-6 border-b border-edge bg-surface-secondary">
        <h3 className="text-sm font-medium text-content mb-2">Executive Summary</h3>
        <p className="text-sm text-content leading-relaxed">{digest.executiveSummary}</p>
      </div>

      {/* Topics */}
      <div className="p-6 border-b border-edge">
        <h3 className="text-sm font-medium text-content mb-3">Your Topics</h3>
        <div className="flex flex-wrap gap-2">
          {digest.topics.map((topic) => (
            <TopicChip
              key={topic.hashtag}
              topic={topic}
              onClick={() => onTopicClick?.(topic.hashtag)}
            />
          ))}
        </div>
      </div>

      {/* Items */}
      <div className="p-6">
        <h3 className="text-sm font-medium text-content mb-3">
          Today's Items ({digest.items.length})
        </h3>
        <div className="space-y-2">
          {digest.items.slice(0, 5).map((item) => (
            <DigestItemCard
              key={item.id}
              item={item}
              onClick={() => onItemClick?.(item)}
            />
          ))}
          {digest.items.length > 5 && (
            <div className="text-center py-2">
              <span className="text-sm text-content-secondary">
                +{digest.items.length - 5} more items
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {(digest.scheduledAt || digest.sentAt) && (
        <div className="px-6 py-3 border-t border-edge bg-surface-secondary text-xs text-content-secondary">
          {digest.sentAt ? (
            <span>Sent at {new Date(digest.sentAt).toLocaleString()}</span>
          ) : digest.scheduledAt ? (
            <span>Scheduled for {new Date(digest.scheduledAt).toLocaleString()}</span>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default EmailDigestPreview;
