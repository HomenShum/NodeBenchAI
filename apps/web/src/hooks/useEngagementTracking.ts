import { useEffect, useRef, useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';

export type ReportType = 'daily_brief' | 'weekly_digest' | 'funding_report' | 'research_highlights';
export type EngagementType = 'view' | 'click' | 'expand' | 'scroll' | 'time_spent';

export interface EngagementTrackingConfig {
  date: string; // YYYY-MM-DD
  reportType: ReportType;
  componentType: string;
  sourceName: string;
  category?: string;
  autoTrackView?: boolean; // Automatically track view on mount
  autoTrackTime?: boolean; // Automatically track time spent on unmount
}

export interface EngagementEvent {
  engagementType: EngagementType;
  durationMs?: number;
  targetUrl?: string;
  metadata?: any;
}

/**
 * Hook for tracking user engagement with report components
 *
 * Usage:
 * ```tsx
 * const { trackEngagement, trackClick, trackExpand } = useEngagementTracking({
 *   date: '2026-01-22',
 *   reportType: 'daily_brief',
 *   componentType: 'feed_items',
 *   sourceName: 'GitHub',
 *   autoTrackView: true,
 *   autoTrackTime: true,
 * });
 *
 * <button onClick={() => trackClick('https://example.com')}>
 *   Read More
 * </button>
 * ```
 */
export function useEngagementTracking(config: EngagementTrackingConfig) {
  const recordEngagement = useMutation(api.domains.analytics.componentMetrics.recordEngagement);

  const startTimeRef = useRef<number>(Date.now());
  const hasTrackedViewRef = useRef<boolean>(false);
  const configRef = useRef(config);

  // Update config ref when config changes
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Generic engagement tracking function
  const trackEngagement = useCallback(async (event: EngagementEvent) => {
    try {
      await recordEngagement({
        date: configRef.current.date,
        reportType: configRef.current.reportType,
        componentType: configRef.current.componentType,
        sourceName: configRef.current.sourceName,
        category: configRef.current.category,
        engagementType: event.engagementType,
        durationMs: event.durationMs,
        targetUrl: event.targetUrl,
        metadata: event.metadata,
      });
    } catch (error) {
      console.warn('[useEngagementTracking] Failed to track engagement:', error);
      // Don't throw - engagement tracking should never break UI
    }
  }, [recordEngagement]);

  // Track view on mount if autoTrackView is enabled
  useEffect(() => {
    if (config.autoTrackView && !hasTrackedViewRef.current) {
      trackEngagement({ engagementType: 'view' });
      hasTrackedViewRef.current = true;
    }
  }, [config.autoTrackView, trackEngagement]);

  // Track time spent on unmount if autoTrackTime is enabled
  useEffect(() => {
    if (!config.autoTrackTime) return;

    return () => {
      const timeSpentMs = Date.now() - startTimeRef.current;
      // Only track if user spent at least 1 second
      if (timeSpentMs >= 1000) {
        trackEngagement({
          engagementType: 'time_spent',
          durationMs: timeSpentMs,
        });
      }
    };
  }, [config.autoTrackTime, trackEngagement]);

  // Convenience function for tracking clicks
  const trackClick = useCallback((targetUrl: string) => {
    trackEngagement({
      engagementType: 'click',
      targetUrl,
    });
  }, [trackEngagement]);

  // Convenience function for tracking expansions (e.g., accordion, collapsible)
  const trackExpand = useCallback((expanded: boolean) => {
    if (expanded) {
      trackEngagement({
        engagementType: 'expand',
      });
    }
  }, [trackEngagement]);

  // Convenience function for tracking scroll events
  const trackScroll = useCallback((scrollPercentage: number) => {
    trackEngagement({
      engagementType: 'scroll',
      metadata: { scrollPercentage },
    });
  }, [trackEngagement]);

  return {
    trackEngagement,
    trackClick,
    trackExpand,
    trackScroll,
  };
}

/**
 * Hook for tracking scroll depth
 * Automatically tracks when user scrolls past 25%, 50%, 75%, 100%
 *
 * Usage:
 * ```tsx
 * const containerRef = useScrollTracking({
 *   date: '2026-01-22',
 *   reportType: 'daily_brief',
 *   componentType: 'feed_items',
 *   sourceName: 'GitHub',
 * });
 *
 * <div ref={containerRef}>
 *   ...long content...
 * </div>
 * ```
 */
export function useScrollTracking(config: EngagementTrackingConfig) {
  const { trackScroll } = useEngagementTracking(config);
  const containerRef = useRef<HTMLElement | null>(null);
  const trackedMilestonesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100;

      // Track milestones: 25%, 50%, 75%, 100%
      const milestones = [25, 50, 75, 100];
      for (const milestone of milestones) {
        if (scrollPercentage >= milestone && !trackedMilestonesRef.current.has(milestone)) {
          trackedMilestonesRef.current.add(milestone);
          trackScroll(milestone);
        }
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [trackScroll]);

  return containerRef;
}
