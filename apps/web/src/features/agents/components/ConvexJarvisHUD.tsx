/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ConvexJarvisHUD — Convex-aware wrapper around the headless JarvisHUDLayout
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE (for other coding agents):
 * JarvisHUDLayout is 100% headless — it has no Convex dependency.
 * This wrapper bridges the React/Convex reactive model to the
 * `onPrompt: (text) => AsyncIterable<string>` interface that the HUD needs.
 *
 * ARCHITECTURE (for other coding agents):
 *   1. useAction(createThread) — creates Convex + agent thread on first prompt
 *   2. convex.query(getThreadByStreamId) — gets agentThreadId after creation
 *   3. setAgentThreadId() — activates useUIMessages subscription
 *   4. useEffect on convexMessages — extracts delta text, pushes to chunkQueueRef
 *   5. onPrompt async generator — dequeues chunks, yields them to useAgentThread
 *
 * CHUNK BRIDGE PATTERN (for other coding agents):
 * Convex is reactive (push), but onPrompt must be pull (async generator).
 * Bridge: chunkQueueRef stores pending chunks; resolverRef holds the
 * generator's current await resolver. When a new chunk arrives via useEffect,
 * it calls resolverRef() to wake the sleeping generator immediately.
 * This avoids busy-polling and gives near-instant chunk delivery.
 *
 * ANONYMOUS USER SUPPORT (for other coding agents):
 * A stable UUID is generated on mount and passed to all Convex calls.
 * Authenticated users get full memory; anonymous users are rate-limited
 * to 5 messages/day (enforced by the initiateAsyncStreaming mutation).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useConvex, useAction, useMutation, useConvexAuth } from 'convex/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { JarvisHUDLayout } from '../../../components/hud/JarvisHUDLayout';
import type { VoiceMode } from '../../../hooks/useVoiceInput';

// ─── Local fallback stream (used if Convex thread creation fails) ──────────────
async function* errorStream(text: string): AsyncIterable<string> {
  yield `Could not reach the AI backend for: "${text.slice(0, 40)}". Please check your connection and try again.`;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface ConvexJarvisHUDProps {
  autoMinimizeDelay?: number;
  className?: string;
  /**
   * Called when the agent triggers a navigation to a different view.
   * The host layout (CockpitLayout) wires this to useMainLayoutRouting.
   */
  onNavigate?: (targetView: string, context?: Record<string, unknown>) => void;
  /** Voice input mode. 'browser' = Web Speech API, 'whisper' = OpenAI Whisper via Convex. Default 'whisper'. */
  voiceMode?: VoiceMode;
  /**
   * Voice intent router — intercepts UI commands before they reach the agent.
   * Return true if handled, false to fall through to agent chat.
   */
  onVoiceIntent?: (text: string, source?: "voice" | "text") => boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ConvexJarvisHUD({ autoMinimizeDelay, className, onNavigate, voiceMode = 'whisper', onVoiceIntent }: ConvexJarvisHUDProps) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  // Stable anonymous session ID for this component instance
  // Using useRef so it doesn't change on re-renders
  const anonSessionIdRef = useRef<string | null>(null);
  if (!anonSessionIdRef.current) {
    anonSessionIdRef.current = crypto.randomUUID();
  }

  // Convex thread IDs — refs so they're readable inside async generators
  const convexThreadIdRef = useRef<Id<'chatThreadsStream'> | null>(null);
  const [agentThreadId, setAgentThreadId] = useState<string | null>(null);

  // Chunk bridge: Convex reactive updates → async generator pull model
  const chunkQueueRef = useRef<string[]>([]);
  const resolverRef = useRef<(() => void) | null>(null);
  const prevTextRef = useRef('');
  const lastChunkTimeRef = useRef(Date.now());
  const isStreamingRef = useRef(false);

  // Convex action + mutation hooks
  const createThread = useAction(api.domains.agents.fastAgentPanelStreaming.createThread);
  const initiateStreaming = useMutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming);

  // Subscribe to streaming messages — only active when agentThreadId is set.
  // NOTE: anonymousSessionId must be passed here too (matches FastAgentPanel pattern).
  // The query uses it to authorize anonymous users reading their own thread messages.
  const { results: convexMessages } = useUIMessages(
    api.domains.agents.fastAgentPanelStreaming.getThreadMessagesWithStreaming,
    agentThreadId
      ? {
          threadId: agentThreadId,
          anonymousSessionId: !isAuthenticated ? anonSessionIdRef.current! : undefined,
        }
      : 'skip',
    { initialNumItems: 100, stream: true }
  );

  // Push new text delta to chunk queue whenever Convex messages update
  useEffect(() => {
    if (!isStreamingRef.current || !convexMessages?.length) return;
    const assistants = convexMessages.filter((m: any) => m.role === 'assistant');
    if (!assistants.length) return;
    const latest = assistants[assistants.length - 1];
    const fullText: string = (latest as any).text ?? '';
    const delta = fullText.slice(prevTextRef.current.length);
    if (!delta) return;
    prevTextRef.current = fullText;
    lastChunkTimeRef.current = Date.now();
    chunkQueueRef.current.push(delta);
    // Wake sleeping generator immediately — no polling delay
    resolverRef.current?.();
    resolverRef.current = null;
  }, [convexMessages]);

  const onPrompt = useCallback(async function* (text: string): AsyncIterable<string> {
    // Reset bridge state for each new prompt
    prevTextRef.current = '';
    chunkQueueRef.current = [];
    lastChunkTimeRef.current = Date.now();
    isStreamingRef.current = true;

    try {
      // ── Step 1: Create thread on first prompt ──
      if (!convexThreadIdRef.current) {
        const anonSessionId = !isAuthenticated ? anonSessionIdRef.current! : undefined;
        const newThreadId = await createThread({
          title: text.slice(0, 60),
          anonymousSessionId: anonSessionId,
        });

        // ── Step 2: Fetch agentThreadId via direct client query ──
        // ConvexReactClient.query() returns a Promise — valid to call inside async generators
        const threadDoc = await convex.query(
          api.domains.agents.fastAgentPanelStreaming.getThreadByStreamId,
          { threadId: newThreadId, anonymousSessionId: anonSessionId }
        );
        const agentId = threadDoc?.agentThreadId;
        if (!agentId) {
          console.warn('[ConvexJarvisHUD] No agentThreadId — falling back to error stream');
          yield* errorStream(text);
          return;
        }
        convexThreadIdRef.current = newThreadId;
        setAgentThreadId(agentId);
        // Give React one tick to activate useUIMessages subscription
        await new Promise<void>((r) => setTimeout(r, 150));
      }

      // ── Step 3: Initiate async streaming on Convex ──
      const anonSessionId = !isAuthenticated ? anonSessionIdRef.current! : undefined;
      await initiateStreaming({
        threadId: convexThreadIdRef.current!,
        prompt: text,
        anonymousSessionId: anonSessionId,
      });

      // ── Step 4: Yield chunks with 8s idle timeout ──
      while (true) {
        if (chunkQueueRef.current.length > 0) {
          yield chunkQueueRef.current.shift()!;
        } else {
          const elapsed = Date.now() - lastChunkTimeRef.current;
          if (elapsed > 8000) break; // 8s idle → assume done
          await new Promise<void>((resolve) => {
            const ms = Math.min(8000 - elapsed, 300);
            const t = setTimeout(resolve, ms);
            resolverRef.current = () => { clearTimeout(t); resolve(); };
          });
        }
      }
      // Drain any remaining queued chunks
      while (chunkQueueRef.current.length > 0) yield chunkQueueRef.current.shift()!;
    } finally {
      isStreamingRef.current = false;
    }
  }, [convex, createThread, initiateStreaming, isAuthenticated]);

  return (
    <JarvisHUDLayout
      autoMinimizeDelay={autoMinimizeDelay}
      className={className}
      onPrompt={onPrompt}
      onNavigate={onNavigate}
      voiceMode={voiceMode}
      onVoiceIntent={onVoiceIntent}
    />
  );
}
