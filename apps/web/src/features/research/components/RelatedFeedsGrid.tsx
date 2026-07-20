/**
 * RelatedFeedsGrid - Google Image Search-style related items grid
 *
 * Displays feed items that are similar to the currently viewed item.
 * Uses visual cards with match indicators to show why items are related.
 *
 * Design inspired by Google Image Search's "Related Images" feature.
 */

import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import {
  ExternalLink,
  Tag,
  Zap,
  TrendingUp,
  Clock,
  Sparkles,
  ChevronRight,
  Loader2
} from 'lucide-react';
import type { FeedItem } from './FeedCard';

interface RelatedFeedsGridProps {
  /** The source feed item to find related items for */
  sourceItem: FeedItem;
  /** Called when a related item is clicked */
  onItemClick?: (item: RelatedFeedItem) => void;
  /** Maximum number of items to show */
  maxItems?: number;
  /** Optional className for styling */
  className?: string;
}

export interface RelatedFeedItem {
  itemId: string;
  itemType: string;
  source: string;
  title: string;
  snippet: string;
  metadata: Record<string, any>;
  timestamp: number;
  dateString?: string;
  phoenixScore: number;
  relevanceReason: string;
  matchScore?: number;
  matchReasons?: string[];
}

// Match type icons and colors
const MATCH_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  'Tags': { icon: Tag, color: 'text-purple-600 bg-purple-50' },
  'Keywords': { icon: Sparkles, color: 'text-blue-600 bg-blue-50' },
  'Same source': { icon: Zap, color: 'text-amber-600 bg-amber-50' },
  'Same type': { icon: TrendingUp, color: 'text-green-600 bg-green-50' },
  'Recent': { icon: Clock, color: 'text-content-secondary bg-surface-secondary' },
  'High relevance': { icon: TrendingUp, color: 'text-indigo-600 bg-indigo-50' },
};

function getMatchIcon(reason: string) {
  for (const [key, config] of Object.entries(MATCH_ICONS)) {
    if (reason.startsWith(key)) {
      return config;
    }
  }
  return { icon: Sparkles, color: 'text-content-secondary bg-surface-secondary' };
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const RelatedFeedsGrid: React.FC<RelatedFeedsGridProps> = ({
  sourceItem,
  onItemClick,
  maxItems = 8,
  className = '',
}) => {
  // Query for related items
  const relatedData = useQuery(api.domains.research.forYouFeed.getRelatedFeedItems, {
    sourceItemId: sourceItem.id,
    sourceType: sourceItem.type,
    sourceTags: sourceItem.tags,
    sourceTitle: sourceItem.title,
    sourceProvider: sourceItem.source,
    sourceTimestamp: Date.now(), // Use current time as reference
    limit: maxItems,
  });

  const isLoading = relatedData === undefined;
  const items = relatedData?.items || [];
  const hasItems = items.length > 0;

  if (isLoading) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Loader2 className="w-4 h-4 motion-safe:animate-spin text-content-muted" />
          <span className="text-sm text-content-secondary">Finding related content...</span>
        </div>
      </div>
    );
  }

  if (!hasItems) {
    return null; // Don't show section if no related items
  }

  return (
    <div className={`${className}`}>
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-content">
            Related Content
          </span>
          <span className="text-xs text-content-muted bg-surface-secondary px-2 py-0.5 rounded-full">
            {items.length} items
          </span>
        </div>
      </div>

      {/* Grid of Related Items */}
      <div className="grid grid-cols-2 gap-3">
        {items.map((item, idx) => {
          const matchConfig = getMatchIcon(item.matchReasons?.[0] || '');
          const MatchIcon = matchConfig.icon;

          return (
            <button
              key={`${item.itemId}-${idx}`}
              onClick={() => onItemClick?.(item)}
              className="group text-left p-3 bg-surface rounded-lg border border-edge hover:border-indigo-300 transition-all duration-200"
            >
              {/* Match Indicator */}
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1 rounded ${matchConfig.color}`}>
                  <MatchIcon className="w-3 h-3" />
                </div>
                <span className="text-xs font-medium text-content-secondary truncate flex-1">
                  {item.matchReasons?.[0] || 'Related'}
                </span>
                {item.matchScore && item.matchScore >= 30 && (
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                    {Math.min(99, item.matchScore)}%
                  </span>
                )}
              </div>

              {/* Title */}
              <h4 className="text-xs font-medium text-content line-clamp-2 mb-1.5 group-hover:text-indigo-700 transition-colors">
                {item.title}
              </h4>

              {/* Snippet */}
              <p className="text-xs text-content-secondary line-clamp-2 mb-2">
                {item.snippet || 'No preview available'}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-content-muted">
                  {formatTimestamp(item.timestamp)}
                </span>
                <div className="flex items-center gap-1 text-xs text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>View</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>

              {/* Source Badge */}
              {item.metadata?.source && (
                <div className="mt-2 pt-2 border-t border-edge">
                  <span className="text-xs text-content-muted flex items-center gap-1">
                    <ExternalLink className="w-2.5 h-2.5" />
                    {item.metadata.source}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* "See More" hint if there are more items */}
      {relatedData?.totalCandidates && relatedData.totalCandidates > maxItems && (
        <div className="mt-3 text-center">
          <span className="text-xs text-content-muted">
            +{relatedData.totalCandidates - maxItems} more related items
          </span>
        </div>
      )}
    </div>
  );
};

export default RelatedFeedsGrid;
