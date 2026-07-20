import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useAction, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import {
  Sparkles,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  TrendingUp,
  AlertTriangle,
  Newspaper,
  Building2,
  RefreshCw,
  Zap,
  Target,
  Activity,
  BarChart3,
  Globe2,
  ArrowUpRight,
  Clock,
  Shield,
} from 'lucide-react';
import { CrossLinkedText } from './CrossLinkedText';
import { InteractiveSpanParser } from './InteractiveSpanParser';
import { FootnotesSection } from './FootnotesSection';
import type { CitationLibrary } from '../types/citationSchema';
import type { EntityLibrary } from '../types/entitySchema';
import type { EntityHoverData } from './EntityHoverPreview';
import { sanitizeReadableText } from '@/lib/displayText';
import { getDemoSignalsForDate } from '../lib/demoSignals';

interface DigestSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: DigestItem[];
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

interface DigestItem {
  text: string;
  relevance?: 'high' | 'medium' | 'low';
  linkedEntity?: string;
}

// Minimal shape shared by the live Convex query and the demo-mode fallback.
// Useed to type-narrow `dataToUse` so the many mappers below compile cleanly
// under `noImplicitAny` without sprinkling `any` casts everywhere.
interface DigestFeedItem {
  title: string;
  source?: string;
  summary?: string;
  tags?: string[];
  url?: string;
}
interface DigestDataShape {
  marketMovers?: DigestFeedItem[];
  watchlistRelevant?: DigestFeedItem[];
  riskAlerts?: DigestFeedItem[];
  trackedHashtags?: Array<string | { hashtag?: string; tag?: string }>;
  lastUpdated?: number | string;
  _demo?: boolean;
}

interface MorningDigestProps {
  userName?: string;
  onItemClick?: (item: DigestItem) => void;
  onEntityClick?: (entityName: string, entityType?: "company" | "person") => void;
  onRefresh?: () => void;
}

// Helper to detect sentiment from text (client-side fallback)
function detectSentimentLocal(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase();
  const bullishWords = ['up', 'gain', 'surge', 'rise', 'growth', 'bullish', 'strong', 'positive', 'success', 'expand'];
  const bearishWords = ['down', 'fall', 'decline', 'drop', 'risk', 'concern', 'warning', 'bearish', 'weak', 'negative'];

  const bullishScore = bullishWords.filter(w => lower.includes(w)).length;
  const bearishScore = bearishWords.filter(w => lower.includes(w)).length;

  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

// Extract potential ticker/entity from text
function extractEntity(text: string): string | undefined {
  const cleaned = text.trim();
  if (!cleaned) return undefined;

  const stop = new Set([
    "The",
    "A",
    "An",
    "All",
    "New",
    "Today",
    "Breaking",
    "Report",
    "Study",
    "Research",
    "Analysis",
  ]);

  // Prefer known entities and audit-critical names
  const knownEntities = [
    "Clearspace",
    "SoundCloud",
    "Salesforce",
    "Open-AutoGLM",
    "OpenAI",
    "Anthropic",
    "Google",
    "NVIDIA",
    "Amazon",
    "Meta",
    "Tesla",
    "Microsoft",
    "Gemini",
  ];
  for (const entity of knownEntities) {
    if (cleaned.toLowerCase().includes(entity.toLowerCase())) return entity;
  }

  // Capture repo-style tokens like owner/repo (e.g., bellard/mquickjs)
  const repoMatch = cleaned.match(/\b([a-z0-9_.-]+)\/([a-z0-9_.-]+)\b/i);
  if (repoMatch?.[2] && /[a-z]/i.test(repoMatch[2])) return repoMatch[2];

  // Look for common ticker patterns (ignore generic terms)
  const tickerMatch = cleaned.match(/\b([A-Z]{2,5})\b/);
  if (tickerMatch && !stop.has(tickerMatch[1])) return tickerMatch[1];

  // Capture leading proper noun before parenthesis or dash
  const prefixMatch = cleaned.match(/^([A-Z][A-Za-z0-9-]+)(?:\s+\(|\s+-|\s+is\b)/);
  if (prefixMatch?.[1] && !stop.has(prefixMatch[1])) return prefixMatch[1];

  // Capture camel-cased names (e.g., SoundCloud)
  const camelMatch = cleaned.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/);
  if (camelMatch?.[1]) return camelMatch[1];

  // Capture hyphenated proper nouns (e.g., Open-AutoGLM)
  const hyphenMatch = cleaned.match(/\b([A-Z][A-Za-z0-9]+-[A-Za-z0-9-]+)\b/);
  if (hyphenMatch?.[1]) return hyphenMatch[1];

  return undefined;
}

export const MorningDigest: React.FC<MorningDigestProps> = ({
  userName = '',
  onItemClick,
  onEntityClick,
  onRefresh
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['markets', 'watchlist']));
  const [selectedDigestSection, setSelectedDigestSection] = useState<string | null>('markets');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState<string | null>(null);

  // Track if we've already attempted to generate
  const hasAttemptedGeneration = useRef(false);

  // Fetch real digest data from Convex
  // Query is in separate file (morningDigestQueries) due to Convex Node.js restrictions
  const digestData = useQuery(api.domains.ai.morningDigestQueries.getDigestData) as DigestDataShape | undefined;

  // Fetch live feed items for accurate source counts
  const liveFeed = useQuery(api.feed.get, { limit: 100 });

  // Check for cached summary first (avoids LLM call on every mount)
  const cachedSummary = useQuery(api.domains.ai.morningDigestQueries.getCachedDigestSummary);

  // Fetch agent-generated digest with entity enrichment
  const agentDigest = useQuery(api.domains.agents.digestAgent.getLatestDigestWithEntities, {});

  const generateSummary = useAction(api.domains.ai.morningDigest.generateDigestSummary);
  const cacheSummary = useMutation(api.domains.ai.morningDigestQueries.cacheDigestSummary);

  // Use cached summary if available
  useEffect(() => {
    if (cachedSummary?.summary && !generatedSummary) {
      setGeneratedSummary(sanitizeReadableText(cachedSummary.summary));
    }
  }, [cachedSummary, generatedSummary]);

  // Demo state — deterministic date-seeded signals so the digest feels fresh
  // every visit without requiring a live backend.
  const sampleDigestData = useMemo(() => {
    const demo = getDemoSignalsForDate(new Date());
    // Bucket demo signals into the shape MorningDigest expects
    const marketMovers = demo.signals
      .filter((s) => s.category === 'model-release' || s.category === 'enterprise')
      .map((s) => ({ title: s.title, source: s.source, summary: '', tags: [], url: '' }));
    const watchlistRelevant = demo.signals
      .filter((s) => s.category === 'funding' || s.category === 'open-source')
      .map((s) => ({ title: s.title, source: s.source, summary: '', tags: [], url: '' }));
    const riskAlerts = demo.signals
      .filter((s) => s.category === 'regulation')
      .map((s) => ({ title: s.title, source: s.source, summary: '', tags: [], url: '' }));
    return {
      marketMovers,
      watchlistRelevant,
      riskAlerts,
      trackedHashtags: [] as string[],
      _demo: true as const,
      lastUpdated: demo.lastUpdated,
    };
  }, []);

  // Track if using sample data
  const isUsingSampleData = !digestData || (
    !digestData.marketMovers?.length &&
    !digestData.watchlistRelevant?.length &&
    !digestData.riskAlerts?.length
  );

  // Transform feed items into digest sections
  const digestSections: DigestSection[] = useMemo(() => {
    const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
    if (!dataToUse) return [];

    const sections: DigestSection[] = [];

    // Safely access arrays with fallbacks
    const marketMovers = dataToUse.marketMovers ?? [];
    const watchlistRelevant = dataToUse.watchlistRelevant ?? [];
    const riskAlerts = dataToUse.riskAlerts ?? [];
    const trackedHashtags = dataToUse.trackedHashtags ?? [];

    // Market Movers section
    if (marketMovers.length > 0) {
      const items = marketMovers.map(item => ({
        text: sanitizeReadableText(item.title),
        relevance: 'high' as const,
        linkedEntity: extractEntity(sanitizeReadableText(item.title)),
      }));
      const overallSentiment = detectSentimentLocal(items.map(i => i.text).join(' '));
      sections.push({
        id: 'markets',
        title: 'Market Movers',
        icon: <TrendingUp className="w-4 h-4" />,
        sentiment: overallSentiment,
        items,
      });
    }

    // Watchlist Relevant section
    if (watchlistRelevant.length > 0) {
      const items = watchlistRelevant.map(item => ({
        text: sanitizeReadableText(item.title),
        relevance: 'high' as const,
        linkedEntity: extractEntity(sanitizeReadableText(item.title)),
      }));
      const overallSentiment = detectSentimentLocal(items.map(i => i.text).join(' '));
      sections.push({
        id: 'watchlist',
        title: `Your Topics (${trackedHashtags.length})`,
        icon: <Building2 className="w-4 h-4" />,
        sentiment: overallSentiment,
        items,
      });
    } else if (trackedHashtags.length === 0) {
      // Show hint to track topics
      sections.push({
        id: 'watchlist',
        title: 'Your Topics',
        icon: <Building2 className="w-4 h-4" />,
        sentiment: 'neutral',
        items: [{
          text: 'Start tracking topics to see personalized news here. Try "#ai" or "#openai".',
          relevance: 'medium',
        }],
      });
    }

    // Risk Alerts section
    if (riskAlerts.length > 0) {
      const items = riskAlerts.map(item => ({
        text: sanitizeReadableText(item.title),
        relevance: 'high' as const,
        linkedEntity: extractEntity(sanitizeReadableText(item.title)),
      }));
      sections.push({
        id: 'alerts',
        title: 'Risk Alerts',
        icon: <AlertTriangle className="w-4 h-4" />,
        sentiment: 'neutral',
        items,
      });
    }

    // Personal Overlay section (Institutional Priorities)
    const personalOverlay = (dataToUse as any).personalOverlay;
    if (personalOverlay && Array.isArray(personalOverlay.features)) {
      const passing = personalOverlay.features.filter((f: any) => f.status === 'passing');
      if (passing.length > 0) {
        sections.push({
          id: 'personal',
          title: 'Internal Priorities',
          icon: <Target className="w-4 h-4" />,
          sentiment: 'neutral',
          items: passing.map((f: any) => ({
            text: `${f.name}: ${f.resultMarkdown?.replace(/#+ /g, '').slice(0, 100)}...`,
            relevance: 'high' as const,
            linkedEntity: f.id
          }))
        });
      }
    }

    return sections;
  }, [digestData, isUsingSampleData, sampleDigestData]);

  // Generate AI summary only if not cached (avoids redundant LLM calls)
  useEffect(() => {
    // Skip if:
    // 1. No digest data yet
    // 2. Already have a summary (cached or generated)
    // 3. Already loading
    // 4. Already attempted generation this session
    // 5. Cache query still loading (undefined)
    if (!digestData || generatedSummary || isLoading || hasAttemptedGeneration.current) {
      return;
    }

    // Wait for cache query to complete
    if (cachedSummary === undefined) {
      return;
    }

    // If cache returned a summary, don't regenerate
    if (cachedSummary?.summary) {
      return;
    }

    // Mark as attempted to prevent multiple calls
    hasAttemptedGeneration.current = true;

    const marketMovers = digestData.marketMovers ?? [];
    const watchlistRelevant = digestData.watchlistRelevant ?? [];
    const riskAlerts = digestData.riskAlerts ?? [];
    const trackedHashtags = digestData.trackedHashtags ?? [];

    // Create a hash of the input data for cache invalidation
    const dataHash = JSON.stringify({
      m: marketMovers.map(m => m.title).slice(0, 3),
      w: watchlistRelevant.map(m => m.title).slice(0, 3),
      r: riskAlerts.map(m => m.title).slice(0, 2),
    });

    setIsLoading(true);

    generateSummary({
      marketMovers: marketMovers.map(m => ({
        title: m.title,
        summary: m.summary,
        tags: m.tags,
      })),
      watchlistRelevant: watchlistRelevant.map(m => ({
        title: m.title,
        summary: m.summary,
        tags: m.tags,
      })),
      riskAlerts: riskAlerts.map(m => ({
        title: m.title,
        summary: m.summary,
        tags: m.tags,
      })),
      trackedHashtags,
      userName,
    })
      .then(async (result: { summary: string }) => {
        const sanitizedSummary = sanitizeReadableText(result.summary);
        setGeneratedSummary(sanitizedSummary);
        // Cache the generated summary for future mounts
        try {
          await cacheSummary({
            summary: sanitizedSummary,
            dataHash,
          });
        } catch (cacheErr) {
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to generate summary:', err);
        setGeneratedSummary('Check the feed for the latest updates on markets and your tracked topics.');
      })
      .finally(() => setIsLoading(false));
  }, [digestData, generatedSummary, isLoading, cachedSummary, generateSummary, cacheSummary, userName]);

  // Fallback summary if AI generation fails
  const fullSummary = sanitizeReadableText(
    generatedSummary ||
      (digestData
        ? `${(digestData.marketMovers ?? []).length} market update${(digestData.marketMovers ?? []).length !== 1 ? 's' : ''} and ${(digestData.watchlistRelevant ?? []).length} item${(digestData.watchlistRelevant ?? []).length !== 1 ? 's' : ''} matching your tracked topics. ${(digestData.riskAlerts ?? []).length > 0 ? `${(digestData.riskAlerts ?? []).length} risk alert${(digestData.riskAlerts ?? []).length !== 1 ? 's' : ''} to monitor.` : ''}`
        : 'Loading your personalized morning briefing...'),
  );

  // Build citation library from digest data sources
  const citationLibrary: CitationLibrary = useMemo(() => {
    const citations: CitationLibrary['citations'] = {};
    const order: string[] = [];
    let citationNum = 1;

    // Add citations from market movers
    (digestData?.marketMovers ?? []).slice(0, 3).forEach((item, idx) => {
      const id = `market-${idx + 1}`;
      citations[id] = {
        id,
        number: citationNum++,
        type: 'source',
        label: item.source || 'Market Data',
        fullText: item.title,
        url: item.url,
        author: item.source,
        occurrences: [],
      };
      order.push(id);
    });

    // Add citations from watchlist items
    (digestData?.watchlistRelevant ?? []).slice(0, 2).forEach((item, idx) => {
      const id = `topic-${idx + 1}`;
      citations[id] = {
        id,
        number: citationNum++,
        type: 'source',
        label: item.source || 'Topic Update',
        fullText: item.title,
        url: item.url,
        author: item.source,
        occurrences: [],
      };
      order.push(id);
    });

    return { citations, order, updatedAt: new Date().toISOString() };
  }, [digestData]);

  // Build entity library from detected entities in digest
  const entityLibrary: EntityLibrary = useMemo(() => {
    const entities: EntityLibrary['entities'] = {};
    const nameIndex: EntityLibrary['nameIndex'] = {};

    // Extract entities from market movers
    (digestData?.marketMovers ?? []).forEach((item) => {
      const entity = extractEntity(item.title);
      if (entity && !entities[entity.toLowerCase()]) {
        const id = entity.toLowerCase();
        entities[id] = {
          id,
          name: entity,
          type: 'company',
          description: sanitizeReadableText(item.summary || item.title),
        };
        nameIndex[entity.toLowerCase()] = id;
      }
    });

    // Add common tech entities
    const commonEntities = [
      { id: 'openai', name: 'OpenAI', type: 'company' as const },
      { id: 'anthropic', name: 'Anthropic', type: 'company' as const },
      { id: 'google', name: 'Google', type: 'company' as const },
      { id: 'microsoft', name: 'Microsoft', type: 'company' as const },
      { id: 'nvidia', name: 'NVIDIA', type: 'company' as const },
    ];
    commonEntities.forEach((e) => {
      if (!entities[e.id]) {
        entities[e.id] = { ...e, description: `${e.name} - Technology company` };
        nameIndex[e.name.toLowerCase()] = e.id;
      }
    });

    return { entities, nameIndex, updatedAt: new Date().toISOString() };
  }, [digestData]);

  // Build entity enrichment map from agent digest for hover previews
  // Now includes adaptive enrichment fields (relationships, circle of influence, timeline, executive summary)
  const entityEnrichment = useMemo((): Record<string, EntityHoverData> | undefined => {
    if (!agentDigest?.entityEnrichment) return undefined;

    // Transform the agent's entity enrichment to EntityHoverData format
    const enrichmentMap: Record<string, EntityHoverData> = {};
    for (const [key, data] of Object.entries(agentDigest.entityEnrichment)) {
      const enrichmentData = data as any; // Type assertion for adaptive fields
      enrichmentMap[key] = {
        entityId: enrichmentData.entityId,
        name: enrichmentData.name,
        type: enrichmentData.type as EntityHoverData['type'],
        summary: enrichmentData.summary,
        keyFacts: enrichmentData.keyFacts ?? [],
        funding: enrichmentData.funding,
        sources: enrichmentData.sources as EntityHoverData['sources'],
        // Adaptive enrichment fields for medium-detail hover previews
        relationships: enrichmentData.relationships,
        circleOfInfluence: enrichmentData.circleOfInfluence,
        timelineHighlight: enrichmentData.timelineHighlight,
        executiveSummary: enrichmentData.executiveSummary,
      };
    }
    return enrichmentMap;
  }, [agentDigest?.entityEnrichment]);

  const handleRefresh = async () => {
    setIsLoading(true);
    setGeneratedSummary(null); // Reset to trigger regeneration
    hasAttemptedGeneration.current = false; // Allow regeneration
    try {
      await onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate last updated time
  const lastUpdatedText = useMemo(() => {
    const formatAge = (minsRaw: number) => {
      const mins = Math.max(0, Math.round(minsRaw));
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    if (cachedSummary?.generatedAt) {
      const mins = Math.round((Date.now() - cachedSummary.generatedAt) / 60000);
      const age = formatAge(mins);
      return `Summary updated ${age}`;
    }
    if (digestData?.lastUpdated) {
      // Clamp negative values to avoid showing "Updated -1 min ago" when clocks are slightly out of sync
      // (e.g., preview build timestamp jitter).
      const lastUpdatedMs = typeof digestData.lastUpdated === "number"
        ? digestData.lastUpdated
        : Date.parse(digestData.lastUpdated);
      const mins = Math.max(0, Math.round((Date.now() - lastUpdatedMs) / 60000));
      return `Updated ${formatAge(mins)}`;
    }
    return 'Fetching latest...';
  }, [digestData?.lastUpdated, cachedSummary?.generatedAt]);

  const digestStats = useMemo(() => {
    const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
    const marketCount = dataToUse?.marketMovers?.length ?? 0;
    const topicCount = dataToUse?.watchlistRelevant?.length ?? 0;
    const alertCount = dataToUse?.riskAlerts?.length ?? 0;

    return [
      { id: 'markets', label: 'Markets', value: marketCount, sentiment: digestSections.find(s => s.id === 'markets')?.sentiment },
      { id: 'watchlist', label: 'Topics', value: topicCount, sentiment: digestSections.find(s => s.id === 'watchlist')?.sentiment },
      { id: 'alerts', label: 'Alerts', value: alertCount, sentiment: 'neutral' as const },
      { id: 'personal', label: 'Priority', value: (digestSections.find(s => s.id === 'personal')?.items.length ?? 0), sentiment: 'neutral' as const },
    ].filter(stat => stat.value > 0);
  }, [digestData, digestSections, isUsingSampleData, sampleDigestData]);

  const primarySentiment = digestStats.find((stat) => stat.sentiment)?.sentiment || 'neutral';

  useEffect(() => {
    if (digestStats.length === 0) {
      setSelectedDigestSection(null);
      return;
    }
    if (!selectedDigestSection || !digestStats.some((stat) => stat.id === selectedDigestSection)) {
      setSelectedDigestSection(digestStats[0]?.id ?? null);
    }
  }, [digestStats, selectedDigestSection]);

  const digestTotals = useMemo(() => {
    const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
    const marketCount = dataToUse?.marketMovers?.length ?? 0;
    const topicCount = dataToUse?.watchlistRelevant?.length ?? 0;
    const alertCount = dataToUse?.riskAlerts?.length ?? 0;
    const priorityCount = digestSections.find((section) => section.id === 'personal')?.items.length ?? 0;
    const trackedCount = dataToUse?.trackedHashtags?.length ?? 0;
    const sourceCount = citationLibrary.order.length;
    const entityCount = Object.keys(entityLibrary.entities || {}).length;
    return {
      marketCount,
      topicCount,
      alertCount,
      priorityCount,
      trackedCount,
      sourceCount,
      entityCount,
      totalSignals: marketCount + topicCount + alertCount,
    };
  }, [citationLibrary.order.length, digestData, digestSections, entityLibrary.entities, isUsingSampleData, sampleDigestData]);

  const topEntities = useMemo(() => {
    return Object.values(entityLibrary.entities || {})
      .map((entity) => entity.name)
      .slice(0, 6);
  }, [entityLibrary.entities]);

  const signalHighlights = useMemo(() => {
    const highlights: Array<{ label: string; text: string; linkedEntity?: string }> = [];
    const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
    (dataToUse?.marketMovers ?? []).slice(0, 2).forEach((item) => {
      highlights.push({ label: 'Market', text: item.title, linkedEntity: extractEntity(item.title) });
    });
    (dataToUse?.watchlistRelevant ?? []).slice(0, 2).forEach((item) => {
      highlights.push({ label: 'Topic', text: item.title, linkedEntity: extractEntity(item.title) });
    });
    (dataToUse?.riskAlerts ?? []).slice(0, 1).forEach((item) => {
      highlights.push({ label: 'Risk', text: item.title, linkedEntity: extractEntity(item.title) });
    });
    return highlights;
  }, [digestData, isUsingSampleData, sampleDigestData]);

  const digestSectionRows = useMemo(() => {
    return digestSections.map((section) => {
      const counts = { high: 0, medium: 0, low: 0 };
      section.items.forEach((item) => {
        if (item.relevance === 'high') counts.high += 1;
        else if (item.relevance === 'medium') counts.medium += 1;
        else counts.low += 1;
      });
      return {
        id: section.id,
        title: section.title,
        sentiment: section.sentiment,
        total: section.items.length,
        ...counts,
      };
    });
  }, [digestSections]);

  const topSources = useMemo(() => {
    const counts = new Map<string, number>();
    const addSource = (source?: string) => {
      const key = source || 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    // Use live feed data for accurate source counts
    if (liveFeed?.length) {
      liveFeed.forEach((item: any) => addSource(item.source));
    } else {
      // Fallback to digest data if live feed not loaded
      const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
      (dataToUse?.marketMovers ?? []).forEach((item) => addSource(item.source));
      (dataToUse?.watchlistRelevant ?? []).forEach((item) => addSource(item.source));
      (dataToUse?.riskAlerts ?? []).forEach((item) => addSource(item.source));
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8); // Show more sources
  }, [liveFeed, digestData, isUsingSampleData, sampleDigestData]);

  const totalSourceCount = topSources.reduce((sum, s) => sum + s.count, 0);
  const maxSourceCount = topSources[0]?.count ?? 1;

  const digestItems = useMemo(() => {
    const dataToUse = isUsingSampleData ? sampleDigestData : digestData;
    return [
      ...(dataToUse?.marketMovers ?? []),
      ...(dataToUse?.watchlistRelevant ?? []),
      ...(dataToUse?.riskAlerts ?? []),
    ];
  }, [digestData, isUsingSampleData, sampleDigestData]);

  const signalMix = useMemo(() => {
    const mixTotal = digestTotals.totalSignals + digestTotals.priorityCount || 1;
    const mix = [
      { label: 'Markets', count: digestTotals.marketCount, tone: 'bg-gray-900' },
      { label: 'Topics', count: digestTotals.topicCount, tone: 'bg-indigo-600' },
      { label: 'Alerts', count: digestTotals.alertCount, tone: 'bg-amber-500' },
      { label: 'Priority', count: digestTotals.priorityCount, tone: 'bg-gray-500' },
    ];
    return mix
      .filter((entry) => entry.count > 0)
      .map((entry) => ({
        ...entry,
        pct: Math.round((entry.count / mixTotal) * 100),
      }));
  }, [digestTotals]);

  const tagRadar = useMemo(() => {
    const counts = new Map<string, number>();
    digestItems.forEach((item: any) => {
      (item.tags ?? []).forEach((tag: string) => {
        const normalized = tag.replace(/^#/, '').trim().toLowerCase();
        if (!normalized) return;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [digestItems]);

  const trackedHashtags = digestData?.trackedHashtags ?? [];
  const topicFocusTags = trackedHashtags.length > 0
    ? trackedHashtags.slice(0, 6)
    : tagRadar.slice(0, 6).map((tag) => `#${tag.tag}`);
  const isTopicFocusTrending = trackedHashtags.length === 0 && topicFocusTags.length > 0;

  const freshnessStats = useMemo(() => {
    const timestamps = digestItems
      .map((item: any) => Date.parse(item.publishedAt))
      .filter((value) => Number.isFinite(value));
    if (timestamps.length === 0) {
      return { newest: null as number | null, oldest: null as number | null, windowHours: null as number | null, avgScore: null as number | null };
    }
    const newest = Math.max(...timestamps);
    const oldest = Math.min(...timestamps);
    const windowHours = Math.max(1, Math.round((newest - oldest) / 3600000));
    const totalScore = digestItems.reduce((sum: number, item: any) => sum + (item.score ?? 0), 0);
    const avgScore = digestItems.length ? Math.round(totalScore / digestItems.length) : null;
    return { newest, oldest, windowHours, avgScore };
  }, [digestItems]);

  const avgHeatValue = freshnessStats.avgScore !== null
    ? Math.round(freshnessStats.avgScore)
    : null;

  const sourceConcentration = useMemo(() => {
    const total = topSources.reduce((sum, source) => sum + source.count, 0);
    if (!total || !topSources[0]) return null;
    return Math.round((topSources[0].count / total) * 100);
  }, [topSources]);

  const latestAgeHours = freshnessStats.newest
    ? Math.max(1, Math.round((Date.now() - freshnessStats.newest) / 3600000))
    : null;

  const agentLaunchpad = [
    {
      label: 'Summarize today\'s pulse',
      prompt: `Summarize today's pulse and list the top 3 actions.`,
    },
    {
      label: 'Map risk exposure',
      prompt: `Scan the alerts and highlight the top 3 risk exposures to monitor.`,
    },
    {
      label: 'Build report',
      prompt: `Build a concise report on the top signals and why they matter.`,
    },
    {
      label: 'Update topic watchlist',
      prompt: `Create a watchlist update from today's topics and market movers.`,
    },
  ];

  const toggleSection = (id: string) => {
    setSelectedDigestSection(id);
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const focusDigestSection = (id: string) => {
    setSelectedDigestSection(id);
    setExpandedSections((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-800';
      case 'bearish': return 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-800';
      default: return 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-800';
    }
  };

  const getRelevanceIndicator = (relevance?: string) => {
    switch (relevance) {
      case 'high': return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20';
      case 'medium': return 'bg-surface-secondary text-content border border-edge';
      default: return 'bg-surface-secondary text-content border border-edge';
    }
  };

  const formatCount = (value: number) => new Intl.NumberFormat().format(value);

  const densityStats = [
    { id: 'signals', label: 'Signals', value: digestTotals.totalSignals, hint: 'market + topics + alerts' },
    { id: 'sources', label: 'Sources', value: digestTotals.sourceCount, hint: 'linked citations' },
    { id: 'entities', label: 'Entities', value: digestTotals.entityCount, hint: 'mentioned by name' },
    { id: 'topics', label: 'Topics', value: digestTotals.trackedCount, hint: 'watchlist themes' },
    { id: 'alerts', label: 'Alerts', value: digestTotals.alertCount, hint: 'risk flags' },
    { id: 'priority', label: 'Priority', value: digestTotals.priorityCount, hint: 'internal focus' },
  ];

  return (
    <div className="relative rounded-lg border border-edge bg-surface  overflow-hidden">
      {/* Elegant gradient accent bar - warm black/amber */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-content via-[rgb(79, 70, 229)]/40 to-content opacity-90" />

      {/* Premium glass header */}
      <div className="relative flex items-center justify-between px-6 py-6 border-b border-edge/50 dark:border-gray-700/50 bg-gradient-to-r from-transparent via-surface-secondary/30 dark:via-gray-800/30 to-transparent">
        <div className="flex items-center gap-5">
          {/* Animated icon container - black/beige */}
          <div className="relative group">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-content-secondary to-content blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-500" />
            <div className="relative h-14 w-14 rounded-lg bg-content text-indigo-600 dark:text-indigo-400 flex items-center justify-center transform transition-all duration-300">
              <Sparkles className="w-6 h-6" />
            </div>
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-bold text-content-secondary">Executive Synthesis</p>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-secondary border border-edge">
                <Activity className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-400 motion-safe:animate-pulse" />
                <span className="text-[10px] font-bold text-content-secondary tracking-tight">Live Synthesis</span>
              </span>
            </div>
            <p className="text-2xl font-bold text-content leading-tight tracking-tight">
              Today&apos;s Brief
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <Clock className="w-3 h-3 text-content-muted" />
              <p className="text-xs font-medium text-content-secondary">{lastUpdatedText}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {digestStats.length > 0 && (
            <div className="hidden md:flex items-center gap-2">
              {digestStats.map((stat, idx) => (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => focusDigestSection(stat.id)}
                  aria-pressed={selectedDigestSection === stat.id}
                  className={`group relative flex items-center gap-2 rounded-lg px-4 py-2 text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selectedDigestSection === stat.id
                    ? 'border-primary/35 bg-primary/[0.08] text-content shadow-sm ring-1 ring-primary/25'
                    : stat.sentiment === 'bullish'
                      ? 'bg-gradient-to-r from-surface-secondary to-amber-50 border border-amber-300/50 hover:border-amber-400'
                      : stat.sentiment === 'bearish'
                        ? 'bg-gradient-to-r from-surface-secondary to-rose-50 border border-rose-300/50 hover:border-rose-400'
                        : 'bg-surface-secondary/50 border border-edge hover:border-surface-hover'
                    } dark:border-edge dark:hover:border-edge`}
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {selectedDigestSection === stat.id ? (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                  <span className={`text-lg font-bold ${stat.sentiment === 'bullish' ? 'text-indigo-600 dark:text-indigo-400'
                    : stat.sentiment === 'bearish' ? 'text-rose-600'
                      : 'text-content'
                    } ${stat.sentiment === 'bullish' ? 'dark:text-indigo-600 dark:text-indigo-400'
                      : stat.sentiment === 'bearish' ? 'dark:text-rose-400'
                        : 'dark:text-gray-100'
                    }`}>
                    {stat.value}
                  </span>
                  <span className="text-xs font-semibold tracking-wide text-content-secondary">
                    {stat.label}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 ml-3 pl-4 border-l border-edge/50 dark:border-gray-700/50">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-2.5 rounded-lg text-content-secondary hover:text-content dark:hover:text-gray-200 hover:bg-surface-hover/50 dark:hover:bg-gray-700/50 transition-all duration-200 active:scale-95"
              title="Refresh digest"
              aria-label="Refresh digest"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'motion-safe:animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2.5 rounded-lg text-content-secondary hover:text-content dark:hover:text-gray-200 hover:bg-surface-hover/50 dark:hover:bg-gray-700/50 transition-all duration-200 active:scale-95"
              title={isExpanded ? 'Collapse' : 'Expand'}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse digest' : 'Expand digest'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Executive Summary - Premium glassmorphism card */}
          <div className="relative mt-4 rounded-lg border border-edge bg-surface p-5 overflow-hidden">
            {/* Decorative gradient orb - warm beige/amber */}
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-gradient-to-br from-amber-200/30 to-gray-300/20 dark:from-amber-900/20 dark:to-gray-700/20 rounded-full blur-3xl pointer-events-none" />

            <div className="relative">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-surface-secondary border border-edge">
                    <BarChart3 className="w-4 h-4 text-content-secondary" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content-secondary">AI Research Brief</span>
                    <p className="text-xs text-content-secondary mt-0.5">Synthesized from {formatCount(digestTotals.sourceCount)} sources</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-secondary/50 dark:bg-gray-800/50 border border-edge">
                  <Shield className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-content-secondary">Verified</span>
                </div>
              </div>
              <div className="text-[15px] text-content leading-relaxed tracking-[-0.01em]">
                <InteractiveSpanParser
                  text={fullSummary}
                  citations={citationLibrary}
                  entities={entityLibrary}
                  entityEnrichment={entityEnrichment}
                  onCitationClick={(citation) => onItemClick?.({ text: `Tell me more about: ${citation.fullText}`, relevance: 'high' })}
                  onEntityClick={(entity) => onItemClick?.({ text: `Deep dive on ${entity.name}`, relevance: 'high', linkedEntity: entity.name })}
                />
              </div>
              {/* Quick action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onItemClick?.({ text: 'Deep dive this brief', relevance: 'high' })}
                  className="rounded-lg bg-[#d97757] px-4 py-2 text-xs font-semibold text-white hover:bg-[#c96a4d] transition-colors"
                >
                  Deep dive this brief
                </button>
                <button
                  type="button"
                  onClick={() => onItemClick?.({ text: 'Track these entities', relevance: 'medium' })}
                  className="rounded-lg border border-white/[0.06] px-4 py-2 text-xs font-medium text-content-secondary hover:bg-white/[0.04] transition-colors"
                >
                  Track these entities
                </button>
                <button
                  type="button"
                  onClick={() => onItemClick?.({ text: 'Set alert for changes', relevance: 'medium' })}
                  className="rounded-lg border border-white/[0.06] px-4 py-2 text-xs font-medium text-content-secondary hover:bg-white/[0.04] transition-colors"
                >
                  Set alert for changes
                </button>
              </div>
            </div>
          </div>

          {/* At-a-glance Stats - Enhanced with warm gradients */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {densityStats.slice(0, 4).map((stat, idx) => (
              <div
                key={stat.id}
                className="group relative rounded-lg border border-edge bg-background hover:bg-surface-hover hover:shadow-sm px-4 py-3 transition-all duration-300 cursor-pointer hover:border-white/[0.12]"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-content leading-none">{formatCount(stat.value)}</span>
                  {stat.value > 0 && (
                    <ArrowUpRight className="w-3 h-3 text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="mt-1.5 text-xs font-semibold text-content-secondary">{stat.label}</div>
                <div className="mt-0.5 text-xs text-content-secondary">{stat.hint}</div>
              </div>
            ))}
          </div>

          {/* Two-column compact layout - Enhanced */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Signals + Sources */}
            <div className="space-y-4">
              {/* Top Signals - Premium card */}
              <div className="rounded-lg border border-edge bg-background p-4 transition-colors duration-150">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-800/30">
                      <Zap className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    </div>
                    <span className="text-xs font-bold text-content-secondary">Top Signals</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-surface-secondary text-content-secondary">{signalHighlights.length} items</span>
                </div>
                <div className="space-y-2">
                  {signalHighlights.slice(0, 3).map((item, idx) => (
                    <div
                      key={`${item.label}-${idx}`}
                      className="group flex items-start gap-3 p-3 rounded-lg border border-transparent cursor-pointer hover:bg-white/[0.04] hover:border-edge dark:hover:border-edge transition-all duration-200"
                    >
                      <button
                        type="button"
                        onClick={() => onItemClick?.({ text: item.text, relevance: 'high', linkedEntity: item.linkedEntity })}
                        className="flex items-start gap-3 flex-1 text-left"
                      >
                        <span className={`shrink-0 px-2 py-1 text-xs font-bold tracking-wide rounded-md ${item.label === 'Market' ? 'bg-surface-secondary text-content-secondary border border-edge'
                          : item.label === 'Risk' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                            : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                          }`}>
                          {item.label}
                        </span>
                        <span className="text-sm text-content-secondary leading-snug line-clamp-2 group-hover:text-content transition-colors">{item.text || 'No description available'}</span>
                      </button>
                      {item.linkedEntity ? (() => {
                        const entityName = item.linkedEntity;
                        return (
                          <button
                            type="button"
                            onClick={() => onEntityClick?.(entityName, "company")}
                            className="shrink-0 px-2 py-1 text-xs font-mono font-medium text-content-secondary hover:text-content dark:hover:text-gray-200 bg-surface-secondary rounded-md border border-edge hover:border-edge dark:hover:border-edge transition-all"
                            title={`Open entity: ${entityName}`}
                          >
                            {entityName}
                          </button>
                        );
                      })() : null}
                    </div>
                  ))}
                </div>
              </div>

              {/* Sources - Enhanced with visual bars */}
              <div className="rounded-lg border border-edge bg-background p-4 transition-colors duration-150">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-surface-secondary border border-edge">
                      <Globe2 className="w-3.5 h-3.5 text-content-secondary" />
                    </div>
                    <span className="text-xs font-bold text-content-secondary">Sources</span>
                  </div>
                  <span className="text-xs text-content-secondary">{formatCount(totalSourceCount)} items</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {topSources.slice(0, 6).map((source, idx) => (
                    <div
                      key={source.name}
                      className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-secondary/50 border border-edge hover:border-edge dark:hover:border-edge transition-all duration-200"
                    >
                      {/* Visual bar indicator - warm amber */}
                      <div
                        className="absolute left-0 bottom-0 h-0.5 bg-gradient-to-r from-gray-600 to-amber-600 dark:from-gray-400 dark:to-amber-400 rounded-b-lg transition-all duration-300"
                        style={{ width: `${(source.count / maxSourceCount) * 100}%` }}
                      />
                      <span className="text-xs font-medium text-content-secondary">{source.name}</span>
                      <span className="text-xs font-bold text-content">{formatCount(source.count)}</span>
                    </div>
                  ))}
                  {topSources.length > 6 && (
                    <span className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-surface-secondary/30 text-xs text-content-secondary">
                      +{topSources.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Tags + Entities + Actions */}
            <div className="space-y-4">
              {/* Tags - Enhanced with hover effects */}
              <div className="rounded-lg border border-edge bg-background p-4 transition-colors duration-150">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-surface-secondary border border-edge">
                      <TrendingUp className="w-3.5 h-3.5 text-content-secondary" />
                    </div>
                    <span className="text-xs font-bold text-content-secondary">Trending</span>
                  </div>
                  <span className="text-xs text-content-secondary">{digestItems.length} signals</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tagRadar.slice(0, 6).map((tag, idx) => (
                    <button
                      key={tag.tag}
                      type="button"
                      onClick={() => onItemClick?.({ text: `Track #${tag.tag} and summarize the latest movement.`, relevance: 'medium', linkedEntity: tag.tag })}
                      className="group px-3 py-1.5 text-xs font-medium border border-edge bg-background text-content-secondary hover:text-content hover:border-edge dark:hover:border-edge hover:bg-surface-hover rounded-lg transition-all duration-200"
                    >
                      <span className="text-amber-700 dark:text-amber-400">#</span>{tag.tag}
                      <span className="ml-1.5 text-content-secondary group-hover:text-content-secondary dark:group-hover:text-gray-300">({tag.count})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Entities - Enhanced with better visual treatment */}
              <div className="rounded-lg border border-edge bg-background p-4 transition-colors duration-150">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-surface-secondary border border-edge">
                    <Building2 className="w-3.5 h-3.5 text-content-secondary" />
                  </div>
                  <span className="text-xs font-bold text-content-secondary">Key Topics</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {topEntities.slice(0, 6).map((entity, idx) => (
                    <button
                      key={entity}
                      type="button"
                      onClick={() => onEntityClick?.(entity, "company")}
                      className="group px-3 py-1.5 text-xs font-semibold border border-edge bg-surface text-content-secondary hover:border-edge dark:hover:border-edge hover:text-content rounded-lg transition-all duration-200"
                    >
                      {entity}
                      <ArrowUpRight className="inline-block ml-1 w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Agent Shortcuts - Premium CTA buttons */}
              <div className="rounded-lg border border-edge bg-gradient-to-br from-background to-amber-50/30 dark:to-amber-950/10 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-surface-secondary border border-edge">
                    <Zap className="w-3.5 h-3.5 text-content-secondary" />
                  </div>
                  <span className="text-xs font-bold text-content-secondary">Quick Actions</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {agentLaunchpad.slice(0, 3).map((item, idx) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => onItemClick?.({ text: item.prompt, relevance: 'high' })}
                      className="group flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-edge dark:border-edge bg-gradient-to-r from-surface-secondary dark:from-surface-secondary to-amber-50/50 dark:to-amber-950/20 text-content-secondary hover:from-surface-hover dark:hover:from-surface-hover hover:to-amber-100/50 hover:border-edge dark:hover:border-edge rounded-lg transition-all duration-200"
                    >
                      <Sparkles className="w-3 h-3" />
                      {item.label.replace('Deep agent: ', '')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sample Data Banner - Enhanced */}
          {isUsingSampleData && digestSections.length > 0 && (
            <div className="p-4 bg-gradient-to-r from-surface-secondary dark:from-white/[0.04] to-amber-50/50 dark:to-amber-950/10 border border-edge rounded-lg flex items-center gap-4">
              <div className="p-2 rounded-lg bg-surface-secondary">
                <Sparkles className="w-4 h-4 text-content-secondary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-content-secondary">
                  Today&apos;s AI Intelligence Brief
                  <span className="ml-2 text-[11px] font-normal text-content-muted">
                    Last updated: {sampleDigestData._demo ? sampleDigestData.lastUpdated : ''}
                  </span>
                </p>
                <p className="text-xs text-content-secondary mt-0.5">Curated signals from across the AI ecosystem. Connect your own sources for personalized tracking.</p>
              </div>
            </div>
          )}

          {/* Empty overview state */}
          {digestSections.length === 0 && !isUsingSampleData && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-lg bg-surface-secondary flex items-center justify-center mb-4">
                <Newspaper className="w-6 h-6 text-content-muted" />
              </div>
              <p className="text-base font-semibold text-content mb-1">Your daily summary is loading</p>
              <p className="text-sm text-content-secondary max-w-xs">Summaries are generated from your tracked sources. Check back shortly or add new sources to get started.</p>
            </div>
          )}

          {digestSections.length === 0 && isUsingSampleData && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="text-base font-semibold text-content mb-1">Preparing your brief</p>
              <p className="text-sm text-content-secondary max-w-xs">Loading today&apos;s AI intelligence signals. Connect your own data sources for personalized tracking.</p>
            </div>
          )}

          {/* Digest Sections Grid - Premium cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {digestSections.map((section, sectionIdx) => (
              <div
                key={section.id}
                className={`group overflow-hidden rounded-lg border bg-background transition-all duration-300 ${
                  selectedDigestSection === section.id
                    ? 'border-primary/30 shadow-[0_0_0_1px_rgba(99,102,241,0.12)]'
                    : 'border-edge'
                }`}
                style={{ animationDelay: `${sectionIdx * 100}ms` }}
              >
                {/* Section Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-edge/50 bg-gradient-to-r from-transparent via-surface-secondary/30 to-transparent">
                  <div className="flex items-center gap-4">
                    <div className={`h-11 w-11 rounded-lg flex items-center justify-center transition-all duration-300 ${section.sentiment === 'bullish' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-sm'
                      : section.sentiment === 'bearish' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20 shadow-sm'
                        : 'bg-surface-secondary text-content-secondary border border-edge shadow-sm'
                      }`}>
                      {React.cloneElement(section.icon as React.ReactElement<Record<string, unknown>>, { className: "w-5 h-5", strokeWidth: 2 })}
                    </div>
                    <div className="text-left">
                      <p className="text-base font-bold text-content">{section.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-semibold text-content-secondary">{section.items.length} {section.items.length === 1 ? 'signal' : 'signals'}</span>
                        {section.sentiment !== 'neutral' && (
                          <span className={`px-1.5 py-0.5 text-xs font-bold rounded ${section.sentiment === 'bullish' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                            : 'bg-rose-500/10 text-rose-600'
                            }`}>
                            {section.sentiment}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className="p-2.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-hover transition-all duration-200"
                    aria-expanded={expandedSections.has(section.id)}
                    aria-label={`${expandedSections.has(section.id) ? 'Collapse' : 'Expand'} ${section.title}`}
                  >
                    {expandedSections.has(section.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Section Items */}
                {expandedSections.has(section.id) && (
                  <div className="divide-y divide-edge/50 dark:divide-white/10">
                    {section.items.slice(0, 4).map((item, idx) => (
                      <div
                        key={idx}
                        className="group/item px-5 py-4 flex items-start justify-between gap-4 hover:bg-surface-hover/50 transition-all duration-200"
                      >
                        <div
                          onClick={() => onItemClick?.(item)}
                          className="flex items-start gap-3 flex-1 cursor-pointer"
                        >
                          <span className={`mt-2 h-2 w-2 rounded-full transition-all duration-300 ${item.relevance === 'high' ? 'bg-surface-secondary border border-edge shadow-sm'
                            : item.relevance === 'medium' ? 'bg-indigo-600/80'
                              : 'bg-content-muted/30'
                            } group-hover/item:scale-125`} />
                          <div className="text-sm font-medium text-content-secondary leading-relaxed group-hover/item:text-content transition-colors overflow-hidden">
                            <CrossLinkedText
                              text={item.text || 'Untitled signal'}
                              entities={entityLibrary?.entities || {}}
                              onEntityClick={(name, type) => onEntityClick?.(name, type as any)}
                              onAskAI={(prompt) => onItemClick?.({ text: prompt, relevance: 'high' })}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity duration-200">
                          {item.linkedEntity ? (() => {
                            const entityName = item.linkedEntity;
                            return (
                              <button
                                type="button"
                                onClick={() => onEntityClick?.(entityName, "company")}
                                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-bold font-mono text-content-secondary bg-surface-secondary border border-edge tracking-tight hover:text-content hover:border-edge transition-all"
                                title={`Open topic: ${entityName}`}
                              >
                                {entityName}
                              </button>
                            );
                          })() : null}
                          <button
                            type="button"
                            onClick={() => onItemClick?.(item)}
                            className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-hover transition-all"
                            title="Open signal"
                            aria-label="Open signal details"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold tracking-wide ${item.relevance === 'high' ? 'bg-surface-secondary text-content-secondary border border-edge'
                            : item.relevance === 'medium' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                              : 'bg-surface-secondary/50 text-content-muted border border-edge/50'
                            }`}>
                            {item.relevance === 'high' ? 'Priority' : item.relevance === 'medium' ? 'Watch' : 'FYI'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Action Buttons - Premium CTAs */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={() => onItemClick?.({ text: "Give me a quick brief for this morning", relevance: 'high', linkedEntity: 'morning brief' })}
              className="group relative flex items-center justify-center gap-3 rounded-lg border border-edge bg-gray-900 px-5 py-4 text-sm font-bold text-[#FAFAFA] hover:bg-gray-800 hover:shadow-gray-900/20 transition-all duration-300 active:scale-[0.98] overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-amber-400/0 via-amber-400/10 to-amber-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <Sparkles className="w-5 h-5" />
              <span>Strategic Brief</span>
            </button>
            <button
              type="button"
              onClick={() => onItemClick?.({ text: "Prepare the full market report for me", relevance: 'medium', linkedEntity: 'market report' })}
              className="group relative flex items-center justify-center gap-3 rounded-lg border border-edge bg-background px-5 py-4 text-sm font-bold text-content-secondary hover:border-primary/20 hover:bg-surface-hover hover:shadow-sm transition-all duration-300 active:scale-[0.98] overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-gray-400/0 via-gray-400/10 to-gray-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <Newspaper className="w-5 h-5" />
              <span>Full Report</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
