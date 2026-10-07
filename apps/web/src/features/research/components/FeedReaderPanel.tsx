/**
 * FeedReaderPanel - Deep Dive Reader with integrated Agent Chat
 * 
 * Combines a clean reading experience with AI analysis capabilities.
 * Opens as a slide-over panel from the right side.
 * 
 * Structure:
 * - Top: Header with source info and actions
 * - Middle: Article content in clean reader view
 * - Bottom: AI Analyst prompt block with quick actions
 */

import React, { useMemo, useState, useCallback } from 'react';
import { X, Sparkles, ExternalLink, Bookmark, Share2, Clock, Globe } from 'lucide-react';
import type { FeedItem } from './FeedCard';
import { useFastAgent } from '@/features/agents/context/FastAgentContext';
import { useReaderContent } from '@/features/research/hooks/useReaderContent';
import { RelatedFeedsGrid, type RelatedFeedItem } from './RelatedFeedsGrid';

interface FeedReaderPanelProps {
  /** The feed item to display */
  item: FeedItem;
  /** Called when the panel should close */
  onClose: () => void;
}

export const FeedReaderPanel: React.FC<FeedReaderPanelProps> = ({ item, onClose }) => {
  const { openWithContext } = useFastAgent();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [selectedRelatedItem, setSelectedRelatedItem] = useState<FeedItem | null>(null);
  const readerState = useReaderContent(item.url, item.title);

  // Handle clicking a related feed item - convert to FeedItem format
  const handleRelatedItemClick = useCallback((relatedItem: RelatedFeedItem) => {
    // Convert RelatedFeedItem to FeedItem format for viewing
    const feedItem: FeedItem = {
      id: relatedItem.itemId,
      type: (relatedItem.itemType as FeedItem['type']) || 'news',
      title: relatedItem.title,
      subtitle: relatedItem.snippet,
      timestamp: new Date(relatedItem.timestamp).toLocaleString(),
      url: relatedItem.metadata?.url,
      tags: relatedItem.metadata?.tags || [],
      source: relatedItem.metadata?.source,
    };
    // Update the panel to show this item (or open in new panel)
    setSelectedRelatedItem(feedItem);
    // Scroll to top when viewing related item
    const contentArea = document.querySelector('[data-reader-content]');
    contentArea?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Use selected related item if one is chosen, otherwise use original
  const displayItem = selectedRelatedItem || item;

  // Get source domain from URL
  const sourceDomain = displayItem.url ? (() => {
    try {
      return new URL(displayItem.url).hostname.replace('www.', '');
    } catch {
      return null;
    }
  })() : null;

  // Quick action handlers
  const handleSummarize = () => {
    openWithContext({
      initialMessage: `Summarize this article: "${displayItem.title}"\n\n${displayItem.subtitle || ''}`,
      contextWebUrls: displayItem.url ? [displayItem.url] : undefined,
      contextTitle: displayItem.title,
    });
  };

  const handleMarketImpact = () => {
    openWithContext({
      initialMessage: `What is the market impact of this news? Analyze: "${displayItem.title}"\n\n${displayItem.subtitle || ''}`,
      contextWebUrls: displayItem.url ? [displayItem.url] : undefined,
      contextTitle: displayItem.title,
    });
  };

  const handleCompetitiveAnalysis = () => {
    openWithContext({
      initialMessage: `Provide a competitive analysis based on this update: "${displayItem.title}"\n\n${displayItem.subtitle || ''}`,
      contextWebUrls: displayItem.url ? [displayItem.url] : undefined,
      contextTitle: displayItem.title,
    });
  };

  const handleAskCustom = () => {
    openWithContext({
      initialMessage: '',
      contextWebUrls: displayItem.url ? [displayItem.url] : undefined,
      contextTitle: displayItem.title,
    });
  };

  // Handle going back to original item
  const handleBackToOriginal = () => {
    setSelectedRelatedItem(null);
  };

  // Type badge styling
  const getTypeBadge = () => {
    switch (displayItem.type) {
      case 'signal':
        return { bg: 'bg-green-500', text: 'text-white', label: 'Signal' };
      case 'dossier':
        return { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Report' };
      case 'repo':
        return { bg: 'bg-gray-800', text: 'text-white', label: 'GitHub' };
      case 'product':
        return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Product' };
      default:
        return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'News' };
    }
  };

  const badge = getTypeBadge();
  const readerData = readerState.status === "ready" ? readerState.data : null;
  const readerExcerpt = readerData?.excerpt || displayItem.subtitle || 'No preview available for this item.';
  const readerContent = readerData?.content || readerExcerpt;
  const sourceMatrix = readerData?.sourceMatrix ?? [];
  const showLoading = readerState.status === "loading";
  const showError = readerState.status === "error";
  const errorMessage = readerState.status === "error" ? readerState.error : null;

  const sourceMatrixItems = useMemo(() => sourceMatrix.slice(0, 6), [sourceMatrix]);

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20  z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[520px] bg-surface shadow-2xl z-50 flex flex-col border-l border-edge animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <header className="px-6 py-4 border-b border-edge flex items-center justify-between bg-surface-secondary/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Back button when viewing related item */}
            {selectedRelatedItem && (
              <button
                type="button"
                onClick={handleBackToOriginal}
                className="p-1.5 -ml-1 mr-1 text-content-secondary hover:text-content hover:bg-surface-secondary rounded-lg transition-colors"
                title="Back to original"
                aria-label="Back to original item"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {/* Source Icon */}
            <div className={`p-1.5 rounded-lg ${badge.bg}`}>
              <Globe className={`w-4 h-4 ${badge.text}`} />
            </div>
            
            {/* Source Badge & Title */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${badge.text} ${badge.bg} px-2 py-0.5 rounded-full`}>
                  {badge.label}
                </span>
                {sourceDomain && (
                  <span className="text-xs text-content-secondary">{sourceDomain}</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Bookmark */}
            <button
              type="button"
              onClick={() => setIsBookmarked(!isBookmarked)}
              className={`p-2 rounded-lg transition-colors ${isBookmarked ? 'text-yellow-500 bg-yellow-50' : 'text-content-secondary hover:text-content hover:bg-surface-secondary'}`}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this item'}
            >
              <Bookmark className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>
            
            {/* Share */}
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(displayItem.url || displayItem.title)}
              className="p-2 text-content-secondary hover:text-content hover:bg-surface-secondary rounded-lg transition-colors"
              aria-label="Copy link"
            >
              <Share2 className="w-4 h-4" />
            </button>

            {/* External Link */}
            {displayItem.url && (
              <button
                type="button"
                onClick={() => window.open(displayItem.url, '_blank', 'noopener,noreferrer')}
                className="p-2 text-content-secondary hover:text-content hover:bg-surface-secondary rounded-lg transition-colors"
                aria-label="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-content-secondary hover:text-content hover:bg-surface-secondary rounded-lg transition-colors ml-1"
              aria-label="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Area (The "Reader") */}
        <div className="flex-1 overflow-y-auto" data-reader-content>
          <article className="p-6 space-y-6">
            {/* Title */}
            <h1 className="text-2xl font-medium text-content leading-tight">
              {displayItem.title}
            </h1>

            {/* Metadata */}
            <div className="flex items-center gap-4 text-xs text-content-secondary border-b border-edge pb-6">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>{displayItem.timestamp}</span>
              </div>
              {displayItem.tags && displayItem.tags.length > 0 && (
                <>
                  <span className="text-[color:var(--border-color)]">•</span>
                  <div className="flex items-center gap-1.5">
                    {displayItem.tags.slice(0, 3).map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-surface-secondary text-content-secondary rounded-full text-xs"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Metrics (if available) */}
            {displayItem.metrics && displayItem.metrics.length > 0 && (
              <div className="grid grid-cols-3 gap-4 p-4 bg-surface-secondary rounded-lg border border-edge">
                {displayItem.metrics.map((metric, i) => (
                  <div key={i} className="text-center">
                    <div className="text-xs text-content-secondary font-medium">{metric.label}</div>
                    <div className="text-lg font-mono font-bold text-content">{metric.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Content / Summary */}
            <div className="prose prose-sm prose-gray max-w-none">
              <p className="text-content leading-relaxed text-base">
                {readerExcerpt}
              </p>

              {showLoading && (
                <div className="mt-6 p-4 bg-surface-secondary rounded-lg border border-dashed border-edge text-center">
                  <p className="text-sm text-content-secondary">Loading full article content...</p>
                </div>
              )}

              {showError && (
                <div className="mt-6 p-4 bg-red-50 rounded-lg border border-red-200 text-center">
                  <p className="text-sm text-red-600">{errorMessage}</p>
                </div>
              )}

              {readerState.status === "ready" && (
                <div className="mt-6 space-y-4 text-content">
                  <p className="text-base leading-relaxed">
                    {readerContent}
                  </p>
                  {readerData?.isTruncated && displayItem.url && (
                    <div className="text-xs text-content-secondary">
                      Full text trimmed for size.{" "}
                      <button
                        type="button"
                        onClick={() => window.open(displayItem.url, '_blank', 'noopener,noreferrer')}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Open original
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Source Matrix */}
            {readerState.status === "ready" && (
              <div className="mt-8 pt-6 border-t border-edge">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-content-secondary">
                    Source Matrix
                  </span>
                  <span className="text-xs text-content-secondary">
                    {sourceMatrix.length} sources
                  </span>
                </div>
                {sourceMatrixItems.length > 0 ? (
                  <div className="space-y-3">
                    {sourceMatrixItems.map((source, idx) => (
                      <a
                        key={`${source.url}-${idx}`}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg border border-edge bg-surface-secondary px-4 py-3 hover:border-blue-200 hover:bg-surface transition-colors"
                      >
                        <div className="text-sm font-semibold text-content">{source.title}</div>
                        <div className="text-xs text-content-secondary mt-1">
                          {source.domain || 'Source'}
                        </div>
                        {source.snippet && (
                          <div className="text-xs text-content-secondary mt-2 line-clamp-2">
                            {source.snippet}
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-content-secondary">No additional sources available.</div>
                )}
              </div>
            )}

            {/* Related Feeds Grid - Google Image Search style */}
            <div className="mt-8 pt-6 border-t border-edge">
              <RelatedFeedsGrid
                sourceItem={displayItem}
                onItemClick={handleRelatedItemClick}
                maxItems={6}
              />
            </div>

          </article>

          {/* AI Analyst Block */}
          <div className="p-6 border-t border-edge bg-gradient-to-b from-surface to-purple-50/30">
            <div className="p-5 bg-surface rounded-lg border border-purple-100 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg shadow-md">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-content">AI Analyst</h4>
                  <p className="text-xs text-content-secondary mt-1 leading-relaxed">
                    I've read this update. How would you like me to help?
                  </p>
                  
                  {/* Quick Action Buttons */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      type="button"
                      onClick={handleSummarize}
                      className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-medium rounded-lg transition-colors"
                    >
                      📝 Summarize
                    </button>
                    <button
                      type="button"
                      onClick={handleMarketImpact}
                      className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-medium rounded-lg transition-colors"
                    >
                      📈 Market Impact
                    </button>
                    <button
                      type="button"
                      onClick={handleCompetitiveAnalysis}
                      className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-medium rounded-lg transition-colors"
                    >
                      🏢 Competitive Analysis
                    </button>
                  </div>
                  
                  {/* Custom Ask */}
                  <button
                    type="button"
                    onClick={handleAskCustom}
                    className="mt-3 w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-medium rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Ask Custom Question
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default FeedReaderPanel;
