// src/components/FastAgentPanel/hooks/useSmartAutoScroll.ts
// Smart auto-scroll that respects user scroll position and uses scroll anchoring

import { useEffect, useRef, useCallback } from 'react';

interface SmartAutoScrollConfig {
  nearBottomThreshold?: number; // pixels from bottom to consider "near bottom"
  enableLogging?: boolean;
}

/**
 * useSmartAutoScroll - Intelligent auto-scroll that:
 * - Only scrolls when user is near the bottom
 * - Pauses auto-scroll when user scrolls up
 * - Resumes when user scrolls back to bottom
 * - Uses scroll anchoring to prevent layout thrash
 * 
 * @param containerRef - Ref to scrollable container
 * @param config - Configuration options
 * @returns Object with scroll state and control methods
 */
export function useSmartAutoScroll(
  containerRef: React.RefObject<HTMLDivElement>,
  config: SmartAutoScrollConfig = {}
) {
  const {
    nearBottomThreshold = 80,
    enableLogging = false,
  } = config;

  const userHasScrolledUpRef = useRef(false);
  const lastScrollHeightRef = useRef(0);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // Check if container is near bottom
  const isNearBottom = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return false;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const nearBottom = distanceFromBottom < nearBottomThreshold;

    return nearBottom;
  }, [containerRef, nearBottomThreshold]);

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;

    if (enableLogging) {
    }

    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [containerRef, enableLogging]);

  // Scroll to anchor element (for scroll anchoring)
  const scrollToAnchor = useCallback(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, []);

  // Handle scroll events to detect user scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isNear = distanceFromBottom < nearBottomThreshold;

      // User scrolled up (away from bottom)
      if (!isNear && lastScrollHeightRef.current === scrollHeight) {
        userHasScrolledUpRef.current = true;
        if (enableLogging) {
        }
      }

      // User scrolled back to bottom
      if (isNear && userHasScrolledUpRef.current) {
        userHasScrolledUpRef.current = false;
        if (enableLogging) {
        }
      }

      lastScrollHeightRef.current = scrollHeight;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [containerRef, nearBottomThreshold, enableLogging]);

  // Auto-scroll when content changes (if user hasn't scrolled up)
  const autoScroll = useCallback(() => {
    if (userHasScrolledUpRef.current) {
      if (enableLogging) {
      }
      return;
    }

    scrollToBottom(true);
  }, [scrollToBottom, enableLogging]);

  // Reset scroll state (e.g., when starting new stream)
  const reset = useCallback(() => {
    userHasScrolledUpRef.current = false;
    lastScrollHeightRef.current = 0;
    if (enableLogging) {
    }
  }, [enableLogging]);

  return {
    isNearBottom,
    scrollToBottom,
    scrollToAnchor,
    autoScroll,
    reset,
    userHasScrolledUp: userHasScrolledUpRef.current,
    scrollAnchorRef,
  };
}

