// src/components/FastAgentPanel/hooks/useStreamingBuffer.ts
// Frame-aligned streaming buffer for smooth, batched UI updates
// Accumulates streaming updates and flushes on requestAnimationFrame for 30-60fps rendering

import { useEffect, useRef, useState, useCallback } from 'react';

export interface StreamingUpdate {
  type: 'token' | 'step' | 'tool' | 'status';
  data: any;
  timestamp: number;
}

interface BufferConfig {
  maxBufferSize?: number;
  flushIntervalMs?: number;
  enableLogging?: boolean;
}

/**
 * useStreamingBuffer - Batches streaming updates and flushes on animation frames
 * Prevents excessive re-renders by accumulating updates and applying them in sync with browser paint cycles
 * 
 * @param onFlush - Callback invoked with batched updates when buffer is flushed
 * @param config - Configuration for buffer behavior
 * @returns Object with buffer state and control methods
 */
export function useStreamingBuffer(
  onFlush: (updates: StreamingUpdate[]) => void,
  config: BufferConfig = {}
) {
  const {
    maxBufferSize = 50,
    flushIntervalMs = 33, // ~30fps
    enableLogging = false,
  } = config;

  const bufferRef = useRef<StreamingUpdate[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const lastFlushRef = useRef<number>(Date.now());
  const [isActive, setIsActive] = useState(false);
  const [bufferSize, setBufferSize] = useState(0);

  // Add update to buffer
  const addUpdate = useCallback((update: StreamingUpdate) => {
    bufferRef.current.push(update);
    setBufferSize(bufferRef.current.length);

    if (enableLogging) {
    }

    // If buffer exceeds max size, flush immediately
    if (bufferRef.current.length >= maxBufferSize) {
      flush();
    }
  }, [maxBufferSize, enableLogging]);

  // Flush buffer and invoke callback
  const flush = useCallback(() => {
    if (bufferRef.current.length === 0) return;

    const updates = bufferRef.current.splice(0);
    const now = Date.now();
    const timeSinceLastFlush = now - lastFlushRef.current;

    if (enableLogging && import.meta.env.DEV) {
      console.log(
        `[StreamingBuffer] Flushing ${updates.length} updates (${timeSinceLastFlush}ms since last flush)`
      );
    }

    onFlush(updates);
    lastFlushRef.current = now;
    setBufferSize(0);
  }, [onFlush, enableLogging]);

  // Schedule flush on next animation frame
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return; // Already scheduled

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      flush();
    });
  }, [flush]);

  // Start streaming (enable periodic flushing)
  const start = useCallback(() => {
    setIsActive(true);
    if (enableLogging && import.meta.env.DEV) console.log('[StreamingBuffer] Started');

    const intervalId = setInterval(() => {
      if (bufferRef.current.length > 0) {
        flush();
      }
    }, flushIntervalMs);

    return () => {
      clearInterval(intervalId);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [flush, flushIntervalMs, enableLogging]);

  // Stop streaming
  const stop = useCallback(() => {
    setIsActive(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Final flush
    if (bufferRef.current.length > 0) {
      flush();
    }
    if (enableLogging && import.meta.env.DEV) console.log('[StreamingBuffer] Stopped');
  }, [flush, enableLogging]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return {
    addUpdate,
    flush,
    scheduleFlush,
    start,
    stop,
    isActive,
    bufferSize,
  };
}

