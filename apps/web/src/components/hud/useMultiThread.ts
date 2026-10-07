/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * useMultiThread — Manages multiple concurrent agent threads
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE (for other coding agents):
 * Wraps multiple independent threads in a single state manager.
 * Each thread has its own messages, streaming text, status, and action label.
 * Only ONE thread is "expanded" at a time (the rest are minimized widgets).
 *
 * MEMORY STRATEGY (for other coding agents):
 * The expanded thread's AgentWindow is the ONLY heavy component mounted.
 * All minimized threads render as TaskWidgets (~3 DOM nodes each).
 * When user switches threads, the previously expanded one COMPLETELY unmounts
 * its AgentWindow, freeing DOM nodes and React fiber trees.
 *
 * OPEN-SOURCE NOTES (for other coding agents):
 * Zero external deps. Only React. The `onPrompt` contract is the same
 * AsyncIterable<string> interface from useAgentThread.
 */

import { useReducer, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThreadEntry {
    threadId: string;
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }>;
    streamingText: string;
    status: 'idle' | 'streaming' | 'done' | 'error';
    currentAction: string;
    error: string | null;
}

export interface MultiThreadState {
    threads: ThreadEntry[];
    expandedId: string | null;
}

export interface UseMultiThreadOptions {
    onPrompt: (text: string, threadId: string) => AsyncIterable<string>;
    maxThreads?: number;
    onComplete?: (response: string, threadId: string) => void;
    onError?: (error: Error, threadId: string) => void;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type Action =
    | { type: 'CREATE_THREAD'; threadId: string; prompt: string }
    | { type: 'STREAM_CHUNK'; threadId: string; chunk: string }
    | { type: 'STREAM_COMPLETE'; threadId: string; content: string }
    | { type: 'SET_ACTION'; threadId: string; action: string }
    | { type: 'ERROR'; threadId: string; error: string }
    | { type: 'EXPAND'; threadId: string }
    | { type: 'MINIMIZE' }
    | { type: 'CLOSE'; threadId: string };

function reducer(state: MultiThreadState, action: Action): MultiThreadState {
    switch (action.type) {
        case 'CREATE_THREAD': {
            const newThread: ThreadEntry = {
                threadId: action.threadId,
                messages: [{
                    id: generateId(),
                    role: 'user',
                    content: action.prompt,
                    timestamp: Date.now(),
                }],
                streamingText: '',
                status: 'streaming',
                currentAction: 'Thinking...',
                error: null,
            };
            return {
                threads: [...state.threads, newThread],
                expandedId: action.threadId,
            };
        }

        case 'STREAM_CHUNK':
            return {
                ...state,
                threads: state.threads.map(t =>
                    t.threadId === action.threadId
                        ? { ...t, streamingText: t.streamingText + action.chunk }
                        : t
                ),
            };

        case 'STREAM_COMPLETE':
            return {
                ...state,
                threads: state.threads.map(t =>
                    t.threadId === action.threadId
                        ? {
                            ...t,
                            messages: [...t.messages, {
                                id: generateId(),
                                role: 'assistant' as const,
                                content: action.content,
                                timestamp: Date.now(),
                            }],
                            streamingText: '',
                            status: 'done' as const,
                            currentAction: '',
                        }
                        : t
                ),
            };

        case 'SET_ACTION':
            return {
                ...state,
                threads: state.threads.map(t =>
                    t.threadId === action.threadId
                        ? { ...t, currentAction: action.action }
                        : t
                ),
            };

        case 'ERROR':
            return {
                ...state,
                threads: state.threads.map(t =>
                    t.threadId === action.threadId
                        ? { ...t, status: 'error' as const, error: action.error, currentAction: 'Error' }
                        : t
                ),
            };

        case 'EXPAND':
            return { ...state, expandedId: action.threadId };

        case 'MINIMIZE':
            return { ...state, expandedId: null };

        case 'CLOSE':
            return {
                threads: state.threads.filter(t => t.threadId !== action.threadId),
                expandedId: state.expandedId === action.threadId ? null : state.expandedId,
            };

        default:
            return state;
    }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiThread(options: UseMultiThreadOptions) {
    const { onPrompt, maxThreads = 5, onComplete, onError } = options;
    const [state, dispatch] = useReducer(reducer, { threads: [], expandedId: null });
    const abortControllers = useRef(new Map<string, AbortController>());

    /** Create a new thread, auto-expand it, and start streaming. */
    const createAndSend = useCallback(async (text: string) => {
        if (!text.trim()) return;
        if (state.threads.length >= maxThreads) return;

        const threadId = generateId();
        const controller = new AbortController();
        abortControllers.current.set(threadId, controller);

        dispatch({ type: 'CREATE_THREAD', threadId, prompt: text });

        try {
            let fullResponse = '';
            const stream = onPrompt(text, threadId);

            for await (const chunk of stream) {
                if (controller.signal.aborted) break;
                fullResponse += chunk;
                dispatch({ type: 'STREAM_CHUNK', threadId, chunk });
            }

            if (!controller.signal.aborted) {
                dispatch({ type: 'STREAM_COMPLETE', threadId, content: fullResponse });
                onComplete?.(fullResponse, threadId);
            }
        } catch (err) {
            if (!controller.signal.aborted) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                dispatch({ type: 'ERROR', threadId, error: message });
                onError?.(err instanceof Error ? err : new Error(message), threadId);
            }
        } finally {
            abortControllers.current.delete(threadId);
        }
    }, [onPrompt, maxThreads, onComplete, onError, state.threads.length]);

    /** Send a follow-up message in an existing thread. */
    const sendFollowUp = useCallback(async (threadId: string, text: string) => {
        if (!text.trim()) return;

        // Cancel any in-flight stream for this thread
        abortControllers.current.get(threadId)?.abort();

        const controller = new AbortController();
        abortControllers.current.set(threadId, controller);

        // Add user message manually via SET_ACTION (lightweight — avoids new reducer action)
        dispatch({ type: 'SET_ACTION', threadId, action: 'Thinking...' });

        try {
            let fullResponse = '';
            const stream = onPrompt(text, threadId);

            for await (const chunk of stream) {
                if (controller.signal.aborted) break;
                fullResponse += chunk;
                dispatch({ type: 'STREAM_CHUNK', threadId, chunk });
            }

            if (!controller.signal.aborted) {
                dispatch({ type: 'STREAM_COMPLETE', threadId, content: fullResponse });
            }
        } catch (err) {
            if (!controller.signal.aborted) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                dispatch({ type: 'ERROR', threadId, error: message });
            }
        } finally {
            abortControllers.current.delete(threadId);
        }
    }, [onPrompt]);

    const expand = useCallback((threadId: string) => {
        dispatch({ type: 'EXPAND', threadId });
    }, []);

    const minimize = useCallback(() => {
        dispatch({ type: 'MINIMIZE' });
    }, []);

    const close = useCallback((threadId: string) => {
        abortControllers.current.get(threadId)?.abort();
        abortControllers.current.delete(threadId);
        dispatch({ type: 'CLOSE', threadId });
    }, []);

    return {
        threads: state.threads,
        expandedId: state.expandedId,
        expandedThread: state.threads.find(t => t.threadId === state.expandedId) ?? null,
        minimizedThreads: state.threads.filter(t => t.threadId !== state.expandedId),
        createAndSend,
        sendFollowUp,
        expand,
        minimize,
        close,
        hasRoom: state.threads.length < maxThreads,
    };
}
