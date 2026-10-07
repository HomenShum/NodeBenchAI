/**
 * FeedSection - Isolated feed display component
 *
 * Handles:
 * - Feed data fetching via useFeedData hook
 * - Category/search filtering
 * - Loading states with skeletons
 * - Click handlers for feed items
 */

import React, { useMemo, useCallback } from 'react';
import { Search, Filter, ChevronDown } from 'lucide-react';
import { useFeedData, FEED_CATEGORIES } from '../hooks/useFeedData';
import { FeedCard, type FeedItem } from '../components/FeedCard';
import { FeedGridSkeleton } from '@/components/skeletons';
import { ErrorBoundary, FeedErrorFallback } from "@/shared/components/ErrorBoundary";

interface FeedSectionProps {
  /** Called when a feed item is clicked */
  onItemClick?: (item: FeedItem) => void;
  /** Called when user wants to open item with agent */
  onOpenWithAgent?: (item: FeedItem) => void;
  /** Initial category filter */
  initialCategory?: string | null;
  /** Maximum items to display initially */
  initialLimit?: number;
  /** Active tab filter */
  activeTab?: 'briefing' | 'signals' | 'watchlist' | 'saved';
  /** Class name for container */
  className?: string;
}

function FeedSectionInner({
  onItemClick,
  onOpenWithAgent,
  initialCategory = null,
  initialLimit = 24,
  activeTab = 'briefing',
  className = '',
}: FeedSectionProps) {
  const {
    feedItems,
    isLoading,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sourceFilter,
    setSourceFilter,
    sourceFilters,
  } = useFeedData({ limit: initialLimit, category: initialCategory as any });

  // Filter by active tab
  const tabFilteredItems = useMemo(() => {
    if (activeTab === 'signals') {
      return feedItems.filter(item => item.type === 'signal');
    }
    if (activeTab === 'watchlist') {
      return feedItems.filter(item => {
        const tickers = extractTickersFromText(item.title || '');
        return tickers.length > 0;
      });
    }
    if (activeTab === 'saved') {
      return feedItems.filter(item => (item as any).isBookmarked);
    }
    return feedItems;
  }, [feedItems, activeTab]);

  const handleItemClick = useCallback((item: FeedItem) => {
    onItemClick?.(item);
  }, [onItemClick]);

  const handleAskAI = useCallback((item: FeedItem) => {
    onOpenWithAgent?.(item);
  }, [onOpenWithAgent]);

  if (isLoading) {
    return (
      <div className={className}>
        <FeedGridSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-secondary" />
          <input
            type="text"
            placeholder="Search feed..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-edge rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-ring focus:border-indigo-500/30"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {FEED_CATEGORIES.slice(0, 5).map((cat) => (
            <button
              key={cat.id ?? 'all'}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-surface-secondary text-content hover:bg-surface-hover'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Source Filter Dropdown */}
        <div className="relative">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-xs font-medium border border-edge rounded-lg bg-surface text-content focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {sourceFilters.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-content-secondary pointer-events-none" />
        </div>
      </div>

      {/* Feed Grid */}
      {tabFilteredItems.length === 0 ? (
        <div className="text-center py-12 text-content-secondary">
          <Filter className="w-8 h-8 mx-auto mb-3 text-content-secondary" />
          <p className="text-sm">No items match your filters</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory(null);
              setSourceFilter('all');
            }}
            className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 hover:underline"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tabFilteredItems.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              onClick={() => handleItemClick(item)}
              onAnalyze={() => handleAskAI(item)}
            />
          ))}
        </div>
      )}

      {/* Item count */}
      <div className="mt-4 text-center">
        <p className="text-xs text-content-secondary">
          Showing {tabFilteredItems.length} of {feedItems.length} items
        </p>
      </div>
    </div>
  );
}

// Helper function for ticker extraction
function extractTickersFromText(text: string): string[] {
  const ignore = new Set(['NEWS', 'TECH', 'CLOUD', 'LLM', 'AI', 'OPENAI', 'GITHUB']);
  const matches = text.toUpperCase().match(/\b[A-Z]{2,5}\b/g) || [];
  return matches.filter((t) => !ignore.has(t)).slice(0, 3);
}

// Wrap with ErrorBoundary
export function FeedSection(props: FeedSectionProps) {
  return (
    <ErrorBoundary
      section="Feed"
      fallback={<FeedErrorFallback onRetry={() => window.location.reload()} />}
    >
      <FeedSectionInner {...props} />
    </ErrorBoundary>
  );
}

export default FeedSection;

