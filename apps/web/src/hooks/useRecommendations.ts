import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook for managing recommendations
 */
export function useRecommendations() {
  const recommendations = useQuery(api.domains.recommendations.recommendationEngine.getActiveRecommendations, {
    limit: 5,
  });

  const stats = useQuery(api.domains.recommendations.recommendationEngine.getRecommendationStats);

  const dismissMutation = useMutation(api.domains.recommendations.recommendationEngine.dismissRecommendation);
  const clickMutation = useMutation(api.domains.recommendations.recommendationEngine.clickRecommendation);
  const feedbackMutation = useMutation(api.domains.recomm.feedback.recordRecommendationOutcome);

  const dismiss = useCallback(
    async (recommendationId: Id<"recommendations">) => {
      // Record as dismissed
      await feedbackMutation({
        recommendationId,
        action: "dismissed",
      });
      await dismissMutation({ recommendationId });
    },
    [dismissMutation, feedbackMutation]
  );

  const click = useCallback(
    async (recommendationId: Id<"recommendations">) => {
      await clickMutation({ recommendationId });
    },
    [clickMutation]
  );

  const recordFeedback = useCallback(
    async (
      recommendationId: Id<"recommendations">,
      action: "accepted" | "rejected",
      rating?: number,
      reason?: string
    ) => {
      const startTime = Date.now();

      await feedbackMutation({
        recommendationId,
        action,
        actualValue: rating ? rating / 5 : undefined, // Convert 1-5 to 0-1
        reason,
        timeTakenMs: Date.now() - startTime,
      });
    },
    [feedbackMutation]
  );

  // Track recommendations shown times for implicit ignore tracking
  const shownTimesRef = useRef<Map<string, number>>(new Map());
  const trackedAsIgnoredRef = useRef<Set<string>>(new Set());

  // Record when recommendations are first shown
  useEffect(() => {
    if (!recommendations) return;

    const now = Date.now();
    for (const rec of recommendations) {
      const id = rec._id;
      if (!shownTimesRef.current.has(id)) {
        shownTimesRef.current.set(id, now);
      }
    }
  }, [recommendations]);

  // Track implicit ignores when recommendations disappear without action
  useEffect(() => {
    return () => {
      // On unmount or when recommendations change, check for ignores
      const currentIds = new Set(recommendations?.map(r => r._id) ?? []);
      const previousIds = Array.from(shownTimesRef.current.keys());

      for (const id of previousIds) {
        // If recommendation is no longer shown and hasn't been tracked as ignored
        if (!currentIds.has(id) && !trackedAsIgnoredRef.current.has(id)) {
          const shownTime = shownTimesRef.current.get(id);
          if (shownTime) {
            const timeShown = Date.now() - shownTime;

            // Only track as ignored if shown for at least 3 seconds (indicates user saw it)
            if (timeShown >= 3000) {
              trackedAsIgnoredRef.current.add(id);
              feedbackMutation({
                recommendationId: id as Id<"recommendations">,
                action: "ignored",
                timeTakenMs: timeShown,
                displayContext: "recommendation_panel",
              }).catch(err => {
                console.warn('[useRecommendations] Failed to track ignore:', err);
              });
            }

            // Clean up tracked time
            shownTimesRef.current.delete(id);
          }
        }
      }
    };
  }, [recommendations, feedbackMutation]);

  return {
    recommendations: recommendations ?? [],
    stats,
    isLoading: recommendations === undefined,
    dismiss,
    click,
    recordFeedback,
  };
}

/**
 * Hook for tracking user behavior
 */
export function useBehaviorTracking() {
  const trackEventMutation = useMutation(api.domains.recommendations.behaviorTracking.trackEvent);
  const summary = useQuery(api.domains.recommendations.behaviorTracking.getBehaviorSummary);

  const trackEvent = useCallback(
    async (
      eventType: 
        | "document_created"
        | "document_viewed"
        | "document_edited"
        | "task_completed"
        | "task_created"
        | "agent_interaction"
        | "search_performed"
        | "calendar_event_ended"
        | "quick_capture",
      entityId?: string,
      metadata?: Record<string, unknown>
    ) => {
      await trackEventMutation({ eventType, entityId, metadata });
    },
    [trackEventMutation]
  );

  return {
    trackEvent,
    summary,
  };
}

export default useRecommendations;

