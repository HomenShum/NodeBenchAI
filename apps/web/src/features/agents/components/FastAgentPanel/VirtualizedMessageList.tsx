/**
 * VirtualizedMessageList - Renders only visible messages + buffer for performance
 *
 * Uses IntersectionObserver to track which messages are in view and only renders
 * those plus a buffer above/below. Non-visible messages use placeholder divs
 * with estimated heights to maintain scroll position.
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';

interface VirtualizedMessageListProps<T> {
  messages: T[];
  renderMessage: (message: T, index: number) => React.ReactNode;
  getMessageKey: (message: T) => string;
  bufferSize?: number;           // Number of messages above/below viewport to render
  estimatedItemHeight?: number;  // Fallback height for messages not yet measured
  containerRef?: React.RefObject<HTMLElement | null>;  // Scroll container
  enabled?: boolean;             // Toggle virtualization on/off
}

interface MessageHeights {
  [key: string]: number;
}

export function VirtualizedMessageList<T>({
  messages,
  renderMessage,
  getMessageKey,
  bufferSize = 5,
  estimatedItemHeight = 150,
  containerRef,
  enabled = true,
}: VirtualizedMessageListProps<T>) {
  // Track measured heights for each message
  const [heights, setHeights] = useState<MessageHeights>({});

  // Track which messages are visible
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: messages.length });

  // Refs for measuring
  const measureRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Calculate which messages to render (visible + buffer)
  const renderRange = useMemo(() => {
    if (!enabled) {
      return { start: 0, end: messages.length };
    }
    const start = Math.max(0, visibleRange.start - bufferSize);
    const end = Math.min(messages.length, visibleRange.end + bufferSize);
    return { start, end };
  }, [enabled, visibleRange, bufferSize, messages.length]);

  // Get height for a message (measured or estimated)
  const getHeight = useCallback((key: string) => {
    return heights[key] ?? estimatedItemHeight;
  }, [heights, estimatedItemHeight]);

  // Calculate total height and offset for virtualization
  const { totalHeight, offsets } = useMemo(() => {
    const offs: number[] = [0];
    let total = 0;
    for (const msg of messages) {
      const key = getMessageKey(msg);
      const height = getHeight(key);
      total += height;
      offs.push(total);
    }
    return { totalHeight: total, offsets: offs };
  }, [messages, getMessageKey, getHeight]);

  // Setup IntersectionObserver to track visible messages
  useEffect(() => {
    if (!enabled) return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      const visibleKeys = new Set<string>();

      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const key = entry.target.getAttribute('data-message-key');
          if (key) visibleKeys.add(key);
        }
      });

      // Find visible range from visible keys
      if (visibleKeys.size > 0) {
        let minIdx = messages.length;
        let maxIdx = 0;
        messages.forEach((msg, idx) => {
          const key = getMessageKey(msg);
          if (visibleKeys.has(key)) {
            minIdx = Math.min(minIdx, idx);
            maxIdx = Math.max(maxIdx, idx);
          }
        });

        if (minIdx <= maxIdx) {
          setVisibleRange({ start: minIdx, end: maxIdx + 1 });
        }
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: containerRef?.current,
      rootMargin: '200px 0px', // Extend detection area
      threshold: 0,
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [enabled, messages, getMessageKey, containerRef]);

  // Measure rendered messages and observe them
  const measureRef = useCallback((node: HTMLDivElement | null, key: string) => {
    if (node) {
      measureRefs.current.set(key, node);

      // Measure height
      const rect = node.getBoundingClientRect();
      if (rect.height > 0 && heights[key] !== rect.height) {
        setHeights(prev => ({ ...prev, [key]: rect.height }));
      }

      // Observe for visibility
      observerRef.current?.observe(node);
    } else {
      const existing = measureRefs.current.get(key);
      if (existing) {
        observerRef.current?.unobserve(existing);
        measureRefs.current.delete(key);
      }
    }
  }, [heights]);

  // If not enabled, render all messages directly
  if (!enabled) {
    return (
      <>
        {messages.map((message, index) => (
          <div key={getMessageKey(message)}>
            {renderMessage(message, index)}
          </div>
        ))}
      </>
    );
  }

  // Calculate spacer heights
  const topSpacerHeight = offsets[renderRange.start] ?? 0;
  const bottomSpacerHeight = totalHeight - (offsets[renderRange.end] ?? totalHeight);

  return (
    <div style={{ position: 'relative' }}>
      {/* Top spacer for messages above viewport */}
      {topSpacerHeight > 0 && (
        <div style={{ height: topSpacerHeight }} aria-hidden="true" />
      )}

      {/* Render visible messages + buffer */}
      {messages.slice(renderRange.start, renderRange.end).map((message, relativeIndex) => {
        const absoluteIndex = renderRange.start + relativeIndex;
        const key = getMessageKey(message);

        return (
          <div
            key={key}
            ref={(node) => measureRef(node, key)}
            data-message-key={key}
          >
            {renderMessage(message, absoluteIndex)}
          </div>
        );
      })}

      {/* Bottom spacer for messages below viewport */}
      {bottomSpacerHeight > 0 && (
        <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Custom hook for simple virtualization control
 */
export function useMessageVirtualization(messageCount: number, threshold = 50) {
  // Enable virtualization only for long conversations
  const enabled = messageCount > threshold;

  return {
    enabled,
    shouldVirtualize: enabled,
  };
}

export default VirtualizedMessageList;
