import { useMemo } from 'react';
import { useQuery, useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useBriefData } from './useBriefData';
import type { DailyBriefPayload } from '../types';

interface UsePersonalBriefOptions {
    historyDays?: number;
    dateString?: string;
}

export function usePersonalBrief(options: UsePersonalBriefOptions = {}) {
    const { historyDays, dateString } = options;
    const globalData = useBriefData({ historyDays, dateString });
    const { briefingDateString, briefMemory } = globalData;

    // 1. Fetch Personal Overlay
    const personalOverlay = useQuery(
        api.domains.research.dailyBriefPersonalOverlayQueries.getOverlayByDateString,
        briefingDateString ? { dateString: briefingDateString } : 'skip'
    );

    // 2. Fetch User Tasks (Due Today)
    const tasksToday = useQuery(
        api.domains.tasks.userEvents.listUserEventsDueToday,
        {}
    );

    // 3. Fetch Recent Documents
    const recentDocs = useQuery(
        api.domains.documents.documents.getRecentForMentions,
        { limit: 5 }
    );

    // 4. Fetch FRESH critical signals (last 48h, prioritizing recency, 25 signals for all personas)
    const freshSignals = useQuery(api.domains.ai.morningDigestQueries.getFreshCriticalSignals, {
        lookbackHours: 48,
        maxSignals: 25,
    });

    // 5. Fetch legacy digest data as fallback
    const digestData = useQuery(api.domains.ai.morningDigestQueries.getDigestData);

    // 6. Ensure Overlay (Action to trigger generation if it doesn't exist)
    const ensureOverlay = useAction(api.domains.research.dailyBriefPersonalOverlay.ensurePersonalOverlay);

    // Aggregate results - prioritize FRESH signals
    const personalizedContext = useMemo(() => {
        // Map overlay features to Act-level implications
        const rawFeatures = (personalOverlay as any)?.features;
        const features = Array.isArray(rawFeatures) ? rawFeatures : [];
        const passingFeatures = features.filter((f: any) => f.status === 'passing');

        // If we have passing features from the overlay, use them
        if (passingFeatures.length > 0) {
            return {
                watchlist: features.filter((f: any) => f.type === 'watchlist_signal'),
                docLinks: features.filter((f: any) => f.type === 'doc_linking'),
                preferences: features.filter((f: any) => f.type === 'preference_followup'),
                passingFeatures,
                isLiveData: true,
                freshestAgeHours: null,
            };
        }

        // Use FRESH critical signals (recency-first approach like LinkedIn posts)
        // INCREASED: Show up to 10 signals in PersonalPulse (up from 3)
        const liveFeatures: Array<{ id: string; name: string; resultMarkdown: string; type: string; timestamp?: number; category?: string }> = [];
        const signalRows = Array.isArray((freshSignals as any)?.signals) ? (freshSignals as any).signals : [];

        if (signalRows.length > 0) {
            // Sort by timestamp (freshest first) and take top 10 for display
            const sortedSignals = [...signalRows]
                .sort((a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))
                .slice(0, 10);

            sortedSignals.forEach((signal, idx) => {
                const signalTimestamp = Number(signal?.timestamp ?? Date.now());
                const ageHours = Math.round((Date.now() - signalTimestamp) / (60 * 60 * 1000));
                const ageLabel = ageHours < 1 ? 'Just now' : ageHours === 1 ? '1h ago' : `${ageHours}h ago`;

                let featureType = 'market_signal';
                let featureName = 'Latest Signal';
                let emoji = '📊';

                // Categorize by type and source for all personas
                if (signal.type === 'funding') {
                    featureType = 'funding_alert';
                    featureName = 'Funding Alert';
                    emoji = '💰';
                } else if (signal.matchesUserTopics) {
                    featureType = 'watchlist_signal';
                    featureName = 'Your Topics';
                    emoji = '🎯';
                } else if (signal.category === 'research' || signal.source === 'ArXiv') {
                    featureType = 'research_signal';
                    featureName = 'Research';
                    emoji = '📚';
                } else if (signal.category === 'finance' || /bloomberg|reuters|wsj|marketwatch/i.test(signal.source || '')) {
                    featureType = 'finance_signal';
                    featureName = 'Markets';
                    emoji = '📈';
                } else if (signal.category === 'ai_ml' || /openai|anthropic|hugging/i.test(signal.source || '')) {
                    featureType = 'ai_signal';
                    featureName = 'AI/ML';
                    emoji = '🤖';
                } else if (/biotech|pharma|fierce|stat|endpoints/i.test(signal.source || '')) {
                    featureType = 'biotech_signal';
                    featureName = 'Biotech';
                    emoji = '🧬';
                } else if (/security|hacker|bleeping|dark/i.test(signal.source || '')) {
                    featureType = 'security_signal';
                    featureName = 'Security';
                    emoji = '🔒';
                } else if (/reddit|r\//i.test(signal.source || '')) {
                    featureName = 'Reddit';
                    emoji = '💬';
                } else if (/github/i.test(signal.source || '')) {
                    featureName = 'GitHub';
                    emoji = '⭐';
                } else if (/producthunt/i.test(signal.source || '')) {
                    featureName = 'Products';
                    emoji = '🚀';
                } else {
                    featureName = signal.source || 'News';
                    emoji = '📰';
                }

                liveFeatures.push({
                    id: `S${idx + 1}`,
                    name: `${emoji} ${featureName} • ${ageLabel}`,
                    resultMarkdown: signal.summary
                        ? `**${signal.title}** — ${signal.summary}`
                        : signal.title,
                    type: featureType,
                    timestamp: signalTimestamp,
                    category: signal.category,
                    // Enhanced data for richer cards
                    summary: signal.summary,
                    url: signal.url,
                    score: signal.score,
                    source: signal.source,
                });
            });
        }

        // Fallback to legacy digest data if no fresh signals
        const marketMovers = Array.isArray((digestData as any)?.marketMovers) ? (digestData as any).marketMovers : [];
        if (liveFeatures.length === 0 && marketMovers.length > 0) {
            const topMover = marketMovers[0];
            if (topMover) {
                liveFeatures.push({
                    id: 'M1',
                    name: 'Market Signal',
                    resultMarkdown: topMover.title || 'Latest market activity detected.',
                    type: 'market_signal',
                });
            }
        }

        return {
            watchlist: liveFeatures.filter((f) => f.type === 'watchlist_signal'),
            docLinks: [],
            preferences: [],
            passingFeatures: liveFeatures,
            isLiveData: liveFeatures.length > 0,
            freshestAgeHours: freshSignals?.freshestAgeHours ?? null,
            totalFreshSignals: signalRows.length,
            freshSignals,
            digestData,
        };
    }, [personalOverlay, freshSignals, digestData]);

    return {
        ...globalData,
        personalOverlay,
        personalizedContext,
        tasksToday,
        recentDocs,
        freshSignals,
        digestData,
        ensureOverlay,
        isPersonalLoading: personalOverlay === undefined || tasksToday === undefined || recentDocs === undefined
    };
}

export default usePersonalBrief;
