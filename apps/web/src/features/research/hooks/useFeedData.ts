/**
 * useFeedData - Centralized feed data fetching with caching
 *
 * Provides:
 * - Feed items from Convex (live newsstand)
 * - User documents (dossiers)
 * - Merged feed items with AI enrichment
 * - Filtering by category/search
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { FeedItem, SentimentType } from '../components/FeedCard';

// Category configuration with keyword patterns
export const FEED_CATEGORIES = [
  { id: null, label: 'All', icon: '📰', keywords: [] },
  { id: 'ai_ml', label: 'AI & ML', icon: '🤖', keywords: ['ai', 'ml', 'llm', 'gpt', 'model', 'neural', 'transformer', 'agent', 'machine learning', 'deep learning', 'openai', 'anthropic', 'langchain'] },
  { id: 'startups', label: 'Startups', icon: '🚀', keywords: ['startup', 'funding', 'series', 'seed', 'vc', 'venture', 'raise', 'valuation', 'ycombinator', 'techcrunch'] },
  { id: 'products', label: 'Products', icon: '📦', keywords: ['launch', 'product', 'producthunt', 'release', 'announce', 'beta', 'app'] },
  { id: 'opensource', label: 'Open Source', icon: '💻', keywords: ['github', 'opensource', 'open-source', 'repo', 'repository', 'star', 'fork', 'mit', 'apache'] },
  { id: 'research', label: 'Research', icon: '📚', keywords: ['arxiv', 'paper', 'research', 'study', 'academic', 'journal', 'ieee', 'acm'] },
  { id: 'tech', label: 'Tech News', icon: '📱', keywords: ['tech', 'google', 'apple', 'microsoft', 'amazon', 'meta', 'cloud', 'devops', 'kubernetes', 'docker'] },
] as const;

export type FeedCategory = typeof FEED_CATEGORIES[number]['id'];

interface UseFeedDataOptions {
  limit?: number;
  category?: FeedCategory;
}

// Simple heuristic sentiment detection (replace with AI in production)
function detectSentiment(text: string): SentimentType {
  const lower = text.toLowerCase();
  if (lower.match(/growth|surge|boost|gain|bullish|up|raise|expand|record|success/)) {
    return 'bullish';
  }
  if (lower.match(/decline|drop|fall|bearish|down|cut|loss|concern|risk/)) {
    return 'bearish';
  }
  return 'neutral';
}

// Relevance scoring based on watchlist keywords
function calculateRelevance(text: string): number {
  const watchlistKeywords = ['aapl', 'apple', 'nvda', 'nvidia', 'ai', 'openai', 'msft', 'microsoft', 'tech', 'semiconductor'];
  let score = Math.floor(Math.random() * 40) + 20; // Base 20-60
  watchlistKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword)) score += 15;
  });
  return Math.min(99, score);
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return 'Just now';
}

function extractTags(title: string): string[] {
  const keywords = ['AI', 'SEC', 'Funding', 'FinTech', 'Healthcare', 'Biotech', 'Series', 'Seed', 'Research'];
  return keywords.filter(kw => title.toLowerCase().includes(kw.toLowerCase())).slice(0, 3);
}

export function useFeedData(options: UseFeedDataOptions = {}) {
  const { limit = 24, category = null } = options;

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FeedCategory>(category);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const queryLimit = searchQuery.trim() ? Math.max(limit, 120) : limit;

  // Fetch live feed from Convex
  const liveFeed = useQuery(api.feed.get, {
    limit: queryLimit,
    ...(selectedCategory ? { category: selectedCategory as any } : {})
  });

  // Fetch user documents
  const documents = useQuery(api.domains.documents.documents.getSidebar);

  // Loading state
  const isLoading = liveFeed === undefined;

  // Transform and merge feed items
  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    // Add live feed items
    if (liveFeed?.length) {
      liveFeed.forEach((item) => {
        const publishedTime = new Date(item.publishedAt).getTime();
        const allText = `${item.title} ${item.tags.join(' ')}`;

        items.push({
          id: `feed-${item._id}`,
          type: item.type as FeedItem['type'],
          title: item.title,
          subtitle: item.summary,
          timestamp: formatRelativeTime(publishedTime),
          tags: item.tags,
          metrics: item.metrics?.map(m => ({
            label: m.label,
            value: m.value,
            trend: m.trend as 'up' | 'down' | undefined
          })),
          url: item.url,
          sentiment: detectSentiment(allText),
          relevanceScore: calculateRelevance(allText),
          source: item.source || 'News',
        });
      });
    }

    // Add user dossiers
    if (documents?.length) {
      const dossiers = documents
        .filter((doc: any) => {
          const docType = doc.documentType?.toLowerCase() || doc.type?.toLowerCase() || '';
          return docType === 'dossier' && docType !== 'nbdoc';
        })
        .slice(0, 8);

      dossiers.forEach((doc: any) => {
        const updatedAt = doc.lastModified || doc._creationTime;
        items.push({
          id: doc._id,
          type: 'dossier',
          title: doc.title || 'Untitled Report',
          subtitle: doc.summary || 'AI-powered research report with comprehensive analysis.',
          timestamp: updatedAt ? formatRelativeTime(updatedAt) : 'Recently',
          tags: extractTags(doc.title || ''),
          source: 'Workspace',
        });
      });
    }

    return items;
  }, [liveFeed, documents]);

  // Available source filters
  const sourceFilters = useMemo(() => {
    const unique = new Map<string, string>();
    feedItems.forEach((item) => {
      if (item.source) {
        unique.set(item.source.toLowerCase(), item.source);
      }
    });
    return [
      { id: 'all', label: 'All Sources' },
      ...Array.from(unique.entries()).map(([id, label]) => ({ id, label })),
    ];
  }, [feedItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let filtered = feedItems;

    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.subtitle?.toLowerCase().includes(query) ||
        item.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Category filter (client-side fallback)
    if (selectedCategory) {
      const categoryConfig = FEED_CATEGORIES.find(c => c.id === selectedCategory);
      if (categoryConfig && categoryConfig.keywords.length > 0) {
        filtered = filtered.filter(item => {
          const searchText = `${item.title} ${item.subtitle || ''} ${item.tags?.join(' ') || ''}`.toLowerCase();
          return categoryConfig.keywords.some(kw => searchText.includes(kw.toLowerCase()));
        });
      }
    }

    // Source filter
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(item =>
        (item.source || '').toLowerCase() === sourceFilter.toLowerCase()
      );
    }

    return filtered;
  }, [feedItems, searchQuery, selectedCategory, sourceFilter]);

  // Load more handler
  const loadMore = useCallback(() => {
    // In a real implementation, this would update the limit and trigger a new query
  }, []);

  return {
    // Data
    feedItems: filteredItems,
    allItems: feedItems,
    isLoading,

    // Filters
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sourceFilter,
    setSourceFilter,
    sourceFilters,
    categories: FEED_CATEGORIES,

    // Actions
    loadMore,
  };
}

export default useFeedData;
