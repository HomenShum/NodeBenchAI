import React, { memo, useState } from 'react';
import {
  TrendingUp,
  FileText,
  MessageSquare,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  GitBranch,
  Package,
  Bookmark,
  BookmarkCheck,
  Zap,
} from 'lucide-react';
import { sanitizeReadableText } from '@/lib/displayText';

export type FeedItemType = 'dossier' | 'signal' | 'news' | 'repo' | 'product';

export type SentimentType = 'bullish' | 'bearish' | 'neutral';

export type SourceQualityTier = 'excellent' | 'good' | 'fair' | 'poor';

export interface FeedItem {
  id: string;
  type: FeedItemType;
  title: string;
  subtitle?: string;
  timestamp: string;
  metrics?: { label: string; value: string; trend?: 'up' | 'down' }[];
  sourceIcon?: React.ReactNode;
  source?: string;
  tags: string[];
  url?: string;  // External URL for live feed items (opens in new tab)
  sentiment?: SentimentType;  // AI-detected sentiment
  relevanceScore?: number;    // 0-100 relevance to watchlist
  isBookmarked?: boolean;     // User bookmark state
  sourceQuality?: SourceQualityTier; // Source quality from arbitrage ranking
  verified?: boolean;         // Whether facts have been verified
}

interface FeedCardProps {
  item: FeedItem;
  onClick: () => void;
  /** Handler for "Analyze with AI" action - opens global agent with context */
  onAnalyze?: () => void;
  /** Handler for bookmark action */
  onBookmark?: () => void;
  /** Whether this card is currently selected (for keyboard nav) */
  isSelected?: boolean;
  variant?: "default" | "minimal" | "signal";
}

function formatReadableCounts(input: string): string {
  const text = sanitizeReadableText(input).trim();
  if (!text) return "";
  if (/^-?\d{4,}$/.test(text)) return Number(text).toLocaleString("en-US");
  return text.replace(
    /\b(\d{4,})\b(?=\s+(?:points?|comments?|upvotes?|likes?|views?|stars?|forks?|items?|sources?)\b)/gi,
    (_full, digits) => Number(digits).toLocaleString("en-US"),
  );
}

export const FeedCard: React.FC<FeedCardProps> = memo(({ item, onClick, onAnalyze, onBookmark, isSelected, variant = "default" }) => {
  const [isBookmarked, setIsBookmarked] = useState(item.isBookmarked ?? false);
  const isSignal = item.type === 'signal' || variant === "signal";
  const isDossier = item.type === 'dossier';
  const isRepo = item.type === 'repo';
  const isProduct = item.type === 'product';
  const safeTitle = sanitizeReadableText(item.title);
  const safeSubtitle = item.subtitle ? formatReadableCounts(item.subtitle) : "";
  const safeTimestamp = sanitizeReadableText(item.timestamp);
  const safeTags = (item.tags || []).map((tag) => sanitizeReadableText(tag));

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBookmarked(!isBookmarked);
    onBookmark?.();
  };

  const getSentimentBadge = () => {
    if (!item.sentiment) return null;
    const badges = {
      bullish: { icon: '🐂', label: 'Bullish', color: 'bg-surface-secondary text-content-secondary border-edge' },
      bearish: { icon: '🐻', label: 'Bearish', color: 'bg-surface-secondary text-content-secondary border-edge' },
      neutral: { icon: '⚖️', label: 'Neutral', color: 'bg-surface-secondary text-content-secondary border-edge' },
    };
    const badge = badges[item.sentiment];
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${badge.color}`}>
        {badge.icon} {badge.label}
      </span>
    );
  };

  const getSourceQualityBadge = () => {
    if (!item.sourceQuality) return null;
    const badges: Record<SourceQualityTier, { icon: string; label: string; color: string }> = {
      excellent: { icon: '✓', label: 'Excellent', color: 'bg-surface-secondary text-content-secondary border-edge' },
      good: { icon: '●', label: 'Good', color: 'bg-surface-secondary text-content-secondary border-edge' },
      fair: { icon: '◐', label: 'Fair', color: 'bg-surface-secondary text-content-secondary border-edge' },
      poor: { icon: '○', label: 'Poor', color: 'bg-surface-secondary text-content-muted border-edge' },
    };
    const badge = badges[item.sourceQuality];
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${badge.color}`} title={`Source quality: ${badge.label}`}>
        {badge.icon} {badge.label}
      </span>
    );
  };

  const getVerifiedBadge = () => {
    if (!item.verified) return null;
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border bg-surface-secondary text-content-secondary border-edge" title="Facts verified">
        ✓ Verified
      </span>
    );
  };

  const handleAnalyzeClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card onClick
    onAnalyze?.();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const renderMinimal = () => {
    return (
      <div
        onClick={onClick}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
        className={`
          group relative p-5 rounded-lg transition-all duration-150 cursor-pointer
          bg-surface border border-edge focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none
          hover:border-primary/30 hover:bg-surface-hover/40 hover:shadow-sm active:scale-[0.99]
          ${isSignal ? 'bg-slate-900 border-slate-800 text-white hover:border-slate-700 hover:bg-slate-900/95' : ''}
        `}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-xs font-bold ${isSignal ? 'text-blue-300' : 'text-blue-600'}`}>
            {item.sourceIcon ? 'Source' : 'News'}
          </span>
          <span className="text-[color:var(--border-color)] text-xs">•</span>
          <span className={`text-xs ${isSignal ? 'text-slate-400' : 'text-content-secondary'}`}>{safeTimestamp}</span>
        </div>
        <h3 className={`text-base font-semibold leading-snug mb-2 ${isSignal ? 'text-white' : 'text-content'}`}>
          {safeTitle}
        </h3>
        {item.subtitle && (
          <p className={`text-sm leading-relaxed ${isSignal ? 'text-slate-400' : 'text-content'}`}>
            {safeSubtitle}
          </p>
        )}
        {safeTags.length > 0 && (
          <div className="flex gap-2 mt-4">
            {safeTags.slice(0, 3).map(tag => (
              <span key={tag} className={`text-xs px-2 py-1 rounded-md ${isSignal ? 'bg-slate-800 text-slate-300' : 'bg-surface-secondary text-content-secondary'}`}>
                #{tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (variant === "minimal" || variant === "signal") {
    return renderMinimal();
  }

  return (
    <div
      onClick={onClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      className={`
        group relative break-inside-avoid cursor-pointer overflow-hidden rounded-lg border transition-all duration-150 bg-surface text-content
        border-edge focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none
        hover:border-primary/35 hover:bg-surface-hover/35 hover:shadow-sm motion-safe:hover:-translate-y-[1px] active:scale-[0.99]
        ${isSelected ? 'ring-2 ring-ring ring-offset-1' : ''}
      `}
    >
      {item.relevanceScore && item.relevanceScore > 70 && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--accent-primary)]" />
      )}

      <div className="p-5">
        {/* Header: Type badge + Sentiment + Timestamp */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isDossier && <div className="p-1.5 bg-surface-secondary rounded-md text-content-secondary border border-edge"><FileText size={12} /></div>}
            {isSignal && <div className="p-1.5 bg-surface-secondary rounded-md text-content-secondary border border-edge"><TrendingUp size={12} /></div>}
            {item.type === 'news' && <div className="p-1.5 bg-surface-secondary rounded-md text-content-secondary border border-edge"><MessageSquare size={12} /></div>}
            {isRepo && <div className="p-1.5 bg-surface-secondary rounded-md text-content-secondary border border-edge"><GitBranch size={12} /></div>}
            {isProduct && <div className="p-1.5 bg-surface-secondary rounded-md text-content-secondary border border-edge"><Package size={12} /></div>}
            <span className="text-xs font-medium text-content-secondary">
              {item.type === 'repo' ? 'GitHub' : item.type === 'product' ? 'Product' : item.type}
            </span>
            {getSentimentBadge()}
          </div>
          <div className="flex items-center gap-2">
            {/* Relevance Score */}
            {item.relevanceScore && item.relevanceScore > 50 && (
              <span
                className="text-xs text-content-muted font-medium inline-flex items-center gap-1"
                title={`Relevance match: ${item.relevanceScore}%`}
              >
                <Zap className="w-3 h-3 text-content-secondary" />
                <span className="text-[10px] tracking-wide">Match</span>
                <span>{item.relevanceScore}%</span>
              </span>
            )}
            <span className={`text-xs ${isSignal ? 'text-slate-500' : 'text-content-secondary'}`}>{safeTimestamp}</span>
          </div>
        </div>

        {/* Title: Serif for dossiers (newsletter feel), Sans for data */}
        <h3 className={`text-lg font-semibold leading-tight mb-2 ${'font-sans'} text-content`}>
          {safeTitle}
        </h3>

        {item.subtitle && (
          <p className="text-sm line-clamp-3 mb-4 text-content">
            {safeSubtitle}
          </p>
        )}

        {/* Data Metrics Row (Pitchbook/Bloomberg Style) */}
        {item.metrics && item.metrics.length > 0 && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-dashed border-edge">
            {/* NOTE(coworker): Keep numeric formatting at render-time to avoid mutating source payloads. */}
            {item.metrics.map((m, i) => (
              <div key={i} className="flex flex-col">
                <span className="text-xs text-content-secondary">{m.label}</span>
                <span className="text-sm font-mono font-bold flex items-center gap-1 text-content">
                  {formatReadableCounts(m.value)}
                  {m.trend === 'up' && <ArrowUpRight className="w-3 h-3 text-green-500" />}
                  {m.trend === 'down' && <ArrowDownRight className="w-3 h-3 text-red-500" />}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Tags (LinkedIn/Twitter Style) */}
        {safeTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {safeTags.map((tag, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full border bg-surface-secondary border-edge text-content-secondary"
              >
                #{tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pb-4 flex items-center justify-between gap-3">
        <div className="text-xs text-content-secondary flex items-center gap-1 transition-colors group-hover:text-content">
          <ArrowUpRight className="w-3 h-3 text-content-secondary transition-colors group-hover:text-primary" />
          {isSignal ? "View Signal" : isDossier ? "Read Report" : "Open"}
        </div>
        <div className="flex items-center gap-2">
          {onAnalyze && (
            <button
              type="button"
              onClick={handleAnalyzeClick}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-edge text-content hover:border-edge hover:bg-surface-hover"
            >
              <Sparkles size={12} />
              Analyze
            </button>
          )}
          <button
            type="button"
            onClick={handleBookmark}
            className={`p-2 rounded-lg border text-content-secondary hover:text-content hover:border-edge ${isBookmarked ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-edge bg-surface'}`}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this item'}
          >
            {isBookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
});
