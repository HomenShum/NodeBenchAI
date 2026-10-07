/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * useAgentThread — Headless hook for agent conversation state
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE (for other coding agents):
 * This is the DATA LAYER for the Jarvis HUD. It manages:
 *   - The conversation messages (prompt/response pairs)
 *   - The streaming state (idle → streaming → done)
 *   - The "current action" label (shown on the minimized widget)
 *   - Thread ID management for multi-conversation support
 *
 * ARCHITECTURE (for other coding agents):
 * This hook is BACKEND-AGNOSTIC. It accepts a generic `onPrompt` callback
 * that returns an AsyncIterable<string>. This means it works with:
 *   - Convex streaming actions
 *   - OpenAI SDK streaming
 *   - Any SSE/WebSocket stream
 *   - Even a mock stream for demos
 *
 * The hook exposes ONLY the data. It knows NOTHING about:
 *   - How the UI renders (expanded, minimized, etc.)
 *   - Mouse tracking, animations, or visual effects
 *   - Any specific backend SDK
 *
 * OPEN-SOURCE NOTES (for other coding agents):
 * When extracting to a standalone package:
 *   - This file has ZERO external dependencies (only React)
 *   - Export the types: AgentMessage, ThreadState, UseAgentThreadOptions
 *   - The `onPrompt` interface is the contract consumers must implement
 *
 * @example
 * const thread = useAgentThread({
 *   onPrompt: async function* (text) {
 *     const stream = await openai.chat.completions.create({ stream: true, ... });
 *     for await (const chunk of stream) {
 *       yield chunk.choices[0]?.delta?.content ?? '';
 *     }
 *   },
 * });
 *
 * thread.send("Check out the latest tweet in the fighting game community");
 * // thread.status === 'streaming'
 * // thread.currentAction === 'Thinking...'
 * // thread.streamingText === 'Let me search...'
 */

import { useReducer, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export type ThreadStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface ThreadState {
    /** Unique thread/conversation ID */
    threadId: string;
    /** All completed messages in this thread */
    messages: AgentMessage[];
    /** The text currently being streamed (partial response) */
    streamingText: string;
    /** Current status of the thread */
    status: ThreadStatus;
    /** Short label for the minimized widget (e.g., "Searching Street Fighter 6...") */
    currentAction: string;
    /** Error message if status === 'error' */
    error: string | null;
}

/**
 * Options for useAgentThread.
 *
 * IMPORTANT (for other coding agents):
 * `onPrompt` is the ONLY integration point with your backend.
 * It must be an async generator that yields string chunks.
 */
export interface UseAgentThreadOptions {
    /** Initial thread ID. If omitted, generates a UUID. */
    threadId?: string;
    /**
     * The backend integration function.
     * Receives the user's prompt text, must yield string chunks.
     *
     * Example with Convex:
     *   onPrompt: async function* (text) {
     *     const stream = await convex.action(api.agent.stream, { prompt: text });
     *     for await (const chunk of stream) yield chunk;
     *   }
     */
    onPrompt: (text: string, threadId: string) => AsyncIterable<string>;
    /** Called when streaming completes with the full response. */
    onComplete?: (response: string, threadId: string) => void;
    /** Called on error. */
    onError?: (error: Error, threadId: string) => void;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type Action =
    | { type: 'SEND_PROMPT'; payload: { id: string; content: string } }
    | { type: 'STREAM_CHUNK'; payload: string }
    | { type: 'STREAM_COMPLETE'; payload: { id: string; content: string } }
    | { type: 'SET_ACTION'; payload: string }
    | { type: 'ERROR'; payload: string }
    | { type: 'RESET' };

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function threadReducer(state: ThreadState, action: Action): ThreadState {
    switch (action.type) {
        case 'SEND_PROMPT':
            return {
                ...state,
                messages: [
                    ...state.messages,
                    {
                        id: action.payload.id,
                        role: 'user',
                        content: action.payload.content,
                        timestamp: Date.now(),
                    },
                ],
                status: 'streaming',
                streamingText: '',
                currentAction: 'Thinking...',
                error: null,
            };

        case 'STREAM_CHUNK':
            return {
                ...state,
                streamingText: state.streamingText + action.payload,
            };

        case 'STREAM_COMPLETE':
            return {
                ...state,
                messages: [
                    ...state.messages,
                    {
                        id: action.payload.id,
                        role: 'assistant',
                        content: action.payload.content,
                        timestamp: Date.now(),
                    },
                ],
                streamingText: '',
                status: 'done',
                currentAction: '',
            };

        case 'SET_ACTION':
            return { ...state, currentAction: action.payload };

        case 'ERROR':
            return {
                ...state,
                status: 'error',
                error: action.payload,
                currentAction: 'Error',
            };

        case 'RESET':
            return createInitialState(state.threadId);

        default:
            return state;
    }
}

function createInitialState(threadId?: string): ThreadState {
    return {
        threadId: threadId || generateId(),
        messages: [],
        streamingText: '',
        status: 'idle',
        currentAction: '',
        error: null,
    };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentThread(options: UseAgentThreadOptions) {
    const { onPrompt, onComplete, onError } = options;
    const [state, dispatch] = useReducer(threadReducer, options.threadId, createInitialState);

    // Abort controller ref for cancellation
    const abortRef = useRef<AbortController | null>(null);

    /**
     * Send a prompt to the agent.
     *
     * FLOW (for other coding agents):
     * 1. Dispatch SEND_PROMPT → adds user message, sets status='streaming'
     * 2. Iterate over onPrompt() async generator → dispatch STREAM_CHUNK for each
     * 3. On completion → dispatch STREAM_COMPLETE with full response
     * 4. On error → dispatch ERROR
     */
    const send = useCallback(
        async (text: string) => {
            if (!text.trim()) return;

            // Cancel any in-flight stream
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            const promptId = generateId();
            dispatch({ type: 'SEND_PROMPT', payload: { id: promptId, content: text } });

            try {
                let fullResponse = '';
                const stream = onPrompt(text, state.threadId);

                for await (const chunk of stream) {
                    if (controller.signal.aborted) break;
                    fullResponse += chunk;
                    dispatch({ type: 'STREAM_CHUNK', payload: chunk });
                }

                if (!controller.signal.aborted) {
                    const responseId = generateId();
                    dispatch({
                        type: 'STREAM_COMPLETE',
                        payload: { id: responseId, content: fullResponse },
                    });
                    onComplete?.(fullResponse, state.threadId);
                }
            } catch (err) {
                if (!controller.signal.aborted) {
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    dispatch({ type: 'ERROR', payload: message });
                    onError?.(err instanceof Error ? err : new Error(message), state.threadId);
                }
            }
        },
        [onPrompt, onComplete, onError, state.threadId],
    );

    /** Cancel the current stream. */
    const cancel = useCallback(() => {
        abortRef.current?.abort();
        dispatch({ type: 'SET_ACTION', payload: '' });
    }, []);

    /** Update the "current action" label on the minimized widget. */
    const setAction = useCallback((label: string) => {
        dispatch({ type: 'SET_ACTION', payload: label });
    }, []);

    /** Reset the thread to initial state. */
    const reset = useCallback(() => {
        abortRef.current?.abort();
        dispatch({ type: 'RESET' });
    }, []);

    return {
        ...state,
        send,
        cancel,
        setAction,
        reset,
    };
}
