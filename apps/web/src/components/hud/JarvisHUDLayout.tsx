/**
 * AgentHUDLayout — Multi-thread agent interface
 *
 * Orchestrates prompt bar, expanded conversation window, minimized task widgets,
 * and compact trigger. All share Framer Motion layoutId for smooth transitions.
 *
 * Flow:
 *   1. User lands → centered prompt bar
 *   2. User submits → prompt bar morphs into expanded window
 *   3. Agent streams response → typewriter text with cursor
 *   4. After delay → window auto-minimizes to task widget
 *   5. User clicks widget → expands back to full window
 *   6. User can close → returns to prompt bar
 *
 * Memory: When minimized, AgentWindow is unmounted. Only a lightweight
 * widget exists in the DOM. Re-expanding re-renders from persisted state.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useMotionConfig } from '@/lib/motion';
import { useMultiThread } from './useMultiThread';
import { TaskWidgetStack } from './TaskWidgetStack';
import { TypewriterText } from './TypewriterText';
import { useRealtimeTranscription } from '../../hooks/useRealtimeTranscription';
import { useVoiceInput, type VoiceMode } from '../../hooks/useVoiceInput';
import { isIgnoredVoiceTranscript } from '../../hooks/useVoiceIntentRouter';
import { useWakeVoiceFeedback } from '../../hooks/useWakeVoiceFeedback';
import { useWakeVoiceSession } from '../../hooks/useWakeVoiceSession';
import { useWakeWordActivation } from '../../hooks/useWakeWordActivation';
import { cn } from '../../lib/utils';

function useIsMobileViewport(breakpoint = 768): boolean {
    const compute = () => {
        if (typeof window === 'undefined') return false;
        const isNarrow = window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
        const isShort = window.matchMedia('(max-height: 500px)').matches;
        const isTabletOrPhoneWidth = window.innerWidth <= 1024;
        return isNarrow || (isShort && isTabletOrPhoneWidth);
    };

    const [isMobile, setIsMobile] = useState(() => compute());

    useEffect(() => {
        const widthMedia = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
        const shortMedia = window.matchMedia('(max-height: 500px)');
        const update = () => setIsMobile(compute());
        update();
        widthMedia.addEventListener('change', update);
        shortMedia.addEventListener('change', update);
        window.addEventListener('resize', update, { passive: true });
        return () => {
            widthMedia.removeEventListener('change', update);
            shortMedia.removeEventListener('change', update);
            window.removeEventListener('resize', update);
        };
    }, [breakpoint]);

    return isMobile;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JarvisHUDLayoutProps {
    onPrompt?: (text: string, threadId: string) => AsyncIterable<string>;
    className?: string;
    autoMinimizeDelay?: number;
    onNavigate?: (targetView: string, context?: Record<string, unknown>) => void;
    voiceMode?: VoiceMode;
    onVoiceIntent?: (text: string, source?: 'voice' | 'text') => boolean;
}

type WakeWordStatus = 'ready' | 'arming' | 'permission' | 'blocked' | 'unsupported';

function VoiceLevelMeter({
    level,
    active,
}: {
    level: number;
    active: boolean;
}) {
    const bars = [0.3, 0.48, 0.66, 0.84, 1];
    return (
        <div
            data-testid="voice-level-meter"
            className="pointer-events-none absolute -bottom-6 right-2 flex items-end gap-1 rounded-full border border-primary/15 bg-surface/85 px-2 py-1"
            aria-hidden="true"
        >
            {bars.map((threshold, index) => {
                const lit = active && level >= threshold * 0.45;
                return (
                    <span
                        key={threshold}
                        className={cn(
                            'w-1 rounded-full transition-all duration-120',
                            lit ? 'bg-primary shadow-[0_0_8px_rgba(59,130,246,0.45)]' : 'bg-primary/20',
                        )}
                        style={{
                            height: `${8 + index * 4}px`,
                            opacity: active ? 0.45 + Math.min(0.55, level * 1.25) : 0.28,
                            transform: `scaleY(${lit ? 1 : 0.72})`,
                        }}
                    />
                );
            })}
        </div>
    );
}

// ─── Mock Stream ──────────────────────────────────────────────────────────────

async function* mockStream(text: string): AsyncIterable<string> {
    const response = `I'm analyzing your request: "${text}"\n\nSearching relevant data sources...\nCross-referencing with latest updates...\nCompiling results...\n\nBased on my analysis, I can help you with that. The system is processing your request and will provide detailed results momentarily.`;
    const words = response.split(' ');
    for (const word of words) {
        await new Promise((r) => setTimeout(r, 30 + Math.random() * 60));
        yield word + ' ';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function PromptBar({
    onSubmit,
    layoutId,
    isMobile,
    voiceMode = 'browser',
    autoActivateVoiceToken = 0,
    wakeWordStatus = 'permission',
    onEnableWakeWord,
    onVoiceSessionActiveChange,
}: {
    onSubmit: (text: string, source: 'voice' | 'text') => void;
    layoutId: string;
    isMobile: boolean;
    voiceMode?: VoiceMode;
    autoActivateVoiceToken?: number;
    wakeWordStatus?: WakeWordStatus;
    onEnableWakeWord?: () => Promise<void> | void;
    onVoiceSessionActiveChange?: (active: boolean) => void;
}) {
    const { instant, transition: motionTransition } = useMotionConfig();
    const [input, setInput] = useState('');
    const [voiceChatMode, setVoiceChatMode] = useState(false);
    const [isEnablingWakeWord, setIsEnablingWakeWord] = useState(false);
    const [wakeTransport, setWakeTransport] = useState<'openai_realtime' | 'browser_fallback' | 'manual' | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const handledActivationTokenRef = useRef(0);
    const { speakWakeConfirmation } = useWakeVoiceFeedback();

    const voice = useVoiceInput({
        mode: voiceMode,
        onTranscript: (text) => setInput(text),
        onEnd: (finalText) => {
            if (finalText.trim() && !isIgnoredVoiceTranscript(finalText)) {
                onSubmit(finalText.trim(), 'voice');
                setInput('');
            }
        },
    });

    const wakeRealtime = useRealtimeTranscription({
        onTranscript: (text) => setInput(text),
        onEnd: (finalText) => {
            if (finalText.trim() && !isIgnoredVoiceTranscript(finalText)) {
                onSubmit(finalText.trim(), 'voice');
                setInput('');
            }
        },
    });

    const wakeFallbackVoice = useVoiceInput({
        mode: 'browser',
        onTranscript: (text) => setInput(text),
        onEnd: (finalText) => {
            if (finalText.trim() && !isIgnoredVoiceTranscript(finalText)) {
                onSubmit(finalText.trim(), 'voice');
                setInput('');
            }
        },
    });

    const wakeSession = useWakeVoiceSession({
        isListening: wakeRealtime.isListening || wakeFallbackVoice.isListening || voice.isListening,
        isTranscribing: wakeRealtime.isTranscribing || wakeFallbackVoice.isTranscribing || voice.isTranscribing,
        focusInput: () => inputRef.current?.focus(),
        speakWakeConfirmation: () => speakWakeConfirmation(),
        startVoiceCapture: async () => {
            if (wakeRealtime.isSupported) {
                const started = await wakeRealtime.start();
                if (started) {
                    setWakeTransport('openai_realtime');
                    return true;
                }
            }
            if (wakeFallbackVoice.isSupported) {
                setWakeTransport('browser_fallback');
                wakeFallbackVoice.start();
                return true;
            }
            setWakeTransport('manual');
            voice.start();
            return true;
        },
    });

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 300);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (autoActivateVoiceToken === 0) return;
        if (handledActivationTokenRef.current === autoActivateVoiceToken) return;
        handledActivationTokenRef.current = autoActivateVoiceToken;

        setInput('');
        setVoiceChatMode(true);
        void wakeSession.beginWakeSession();
    }, [autoActivateVoiceToken, wakeSession]);

    useEffect(() => {
        if (wakeRealtime.isListening || wakeRealtime.isTranscribing || wakeFallbackVoice.isListening || wakeFallbackVoice.isTranscribing || voice.isListening || voice.isTranscribing || wakeSession.isActive) {
            setVoiceChatMode(true);
            return;
        }

        const timer = setTimeout(() => {
            if (!input.trim()) setVoiceChatMode(false);
        }, 900);

        return () => clearTimeout(timer);
    }, [input, voice.isListening, voice.isTranscribing, wakeSession.isActive, wakeRealtime.isListening, wakeRealtime.isTranscribing, wakeFallbackVoice.isListening, wakeFallbackVoice.isTranscribing]);

    const isLiveWakeTranscript = wakeRealtime.isListening || wakeFallbackVoice.isListening;
    const isAnyListening = wakeRealtime.isListening || wakeFallbackVoice.isListening || voice.isListening;
    const isAnyTranscribing = wakeRealtime.isTranscribing || wakeFallbackVoice.isTranscribing || voice.isTranscribing;
    const activeVoiceError = wakeRealtime.error ?? wakeFallbackVoice.error ?? voice.error;
    const audioLevel = Math.max(wakeRealtime.audioLevel, wakeFallbackVoice.audioLevel, voice.audioLevel);
    const showVoiceChatMode = voiceChatMode || wakeSession.isActive || isAnyListening || isAnyTranscribing;
    const voiceTransportLabel =
        wakeTransport === 'browser_fallback'
            ? 'Browser fallback'
            : wakeTransport === 'manual'
                ? voice.mode === 'whisper'
                    ? 'Manual Whisper'
                    : 'Manual browser speech'
                : 'OpenAI Realtime';
    const voiceTransportHint =
        wakeTransport === 'browser_fallback'
            ? (wakeRealtime.error ? 'OpenAI Realtime unavailable, using browser fallback.' : 'Using browser fallback transcription.')
            : wakeTransport === 'manual'
                ? 'Using the manual mic path.'
                : 'OpenAI Realtime streaming transcript is updating live.';

    useEffect(() => {
        onVoiceSessionActiveChange?.(showVoiceChatMode);
        return () => {
            onVoiceSessionActiveChange?.(false);
        };
    }, [onVoiceSessionActiveChange, showVoiceChatMode]);

    useEffect(() => {
        if (!showVoiceChatMode) {
            setWakeTransport(null);
        }
    }, [showVoiceChatMode]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        voice.stop();
        onSubmit(input.trim(), 'text');
        setInput('');
        setVoiceChatMode(false);
    };

    const showWakeWordAction = !showVoiceChatMode && wakeWordStatus === 'permission' && !!onEnableWakeWord;

    const handleEnableWakeWord = useCallback(async () => {
        if (!onEnableWakeWord || isEnablingWakeWord) return;
        setIsEnablingWakeWord(true);
        try {
            await onEnableWakeWord();
        } finally {
            setIsEnablingWakeWord(false);
        }
    }, [isEnablingWakeWord, onEnableWakeWord]);

    const wakeWordMessage = showVoiceChatMode
        ? isLiveWakeTranscript
            ? 'Live transcript active'
            : isAnyTranscribing
                ? 'Voice channel analyzing'
                : 'Voice channel open'
        : wakeSession.phase === 'replying'
            ? 'NodeBench is listening'
            : wakeSession.phase === 'starting'
                ? 'Opening voice channel'
        : isEnablingWakeWord
            ? 'Enabling wake word'
            : wakeWordStatus === 'ready'
                ? 'Say "Hey NodeBench"'
                : wakeWordStatus === 'arming'
                    ? 'Arming wake word'
                    : wakeWordStatus === 'blocked'
                        ? 'Wake word blocked - allow microphone'
                        : wakeWordStatus === 'unsupported'
                            ? 'Wake word unavailable in this browser'
                            : 'Enable "Hey NodeBench"';

    return (
        <motion.div
            layoutId={layoutId}
            className={cn(
                'fixed z-50',
                isMobile
                    ? 'left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]'
                    : 'top-1/2 left-1/2',
            )}
            style={isMobile ? undefined : { x: '-50%', y: '-50%' }}
            initial={instant ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={{
                opacity: 1,
                scale: showVoiceChatMode ? 1.03 : 1,
                y: showVoiceChatMode ? -10 : 0,
            }}
            transition={motionTransition({ type: 'spring', stiffness: 190, damping: 22 })}
        >
            <form onSubmit={handleSubmit} className="relative">
                <AnimatePresence>
                    {showVoiceChatMode && (
                        <motion.div
                            aria-hidden="true"
                            className={cn(
                                'pointer-events-none absolute inset-x-6 -inset-y-4 rounded-[2rem] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.22),rgba(59,130,246,0.08)_42%,transparent_72%)] blur-2xl',
                                isMobile && 'inset-x-3 -inset-y-3 rounded-[1.5rem]',
                            )}
                            initial={instant ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1.04 }}
                            exit={instant ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                            transition={motionTransition({ duration: 0.35, ease: [0.22, 1, 0.36, 1] })}
                        />
                    )}
                </AnimatePresence>
                <motion.div
                    data-testid="voice-chat-mode-indicator"
                    className={cn(
                        'absolute left-1/2 z-10 w-max max-w-[min(90vw,18rem)] -translate-x-1/2 rounded-full border px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-center leading-tight',
                        isMobile ? '-top-9' : '-top-8',
                        showVoiceChatMode
                            ? 'border-primary/45 bg-primary/15 text-primary'
                            : wakeWordStatus === 'blocked'
                                ? 'border-rose-500/35 bg-rose-500/10 text-rose-300'
                                : wakeWordStatus === 'unsupported'
                                    ? 'border-edge bg-surface/85 text-content-secondary'
                                    : wakeWordStatus === 'permission'
                                        ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                                        : 'border-edge bg-surface/85 text-content-secondary',
                    )}
                    initial={instant ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={motionTransition({})}
                >
                    {showWakeWordAction ? (
                        <button
                            type="button"
                            onClick={handleEnableWakeWord}
                            className="pointer-events-auto rounded-full px-1 text-[9px] uppercase tracking-[0.12em] whitespace-normal text-center outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-[10px]"
                            aria-label='Enable wake word detection for "Hey NodeBench"'
                        >
                            {wakeWordMessage}
                        </button>
                    ) : (
                        wakeWordMessage
                    )}
                </motion.div>
                <div className={cn(
                    'relative flex items-center gap-3',
                    isMobile
                        ? 'w-full px-4 py-3 rounded-xl'
                        : 'w-[520px] max-w-[90vw] px-6 py-4 rounded-2xl',
                    showVoiceChatMode
                        ? 'border-primary/50 bg-surface backdrop-blur-xl shadow-[0_0_40px_rgba(59,130,246,0.18)]'
                        : 'border border-edge bg-surface backdrop-blur-xl shadow-lg',
                    'transition-all duration-300',
                )} data-voice-chat-active={showVoiceChatMode ? 'true' : 'false'}>
                    {/* Status indicator */}
                    <div className={cn(
                        'flex-shrink-0 rounded-full transition-all duration-200',
                        showVoiceChatMode
                            ? 'w-3 h-3 bg-primary shadow-[0_0_12px_rgba(59,130,246,0.65)]'
                            : 'w-2.5 h-2.5 bg-primary',
                    )} />

                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                            isLiveWakeTranscript
                                ? 'Live transcript appears here...'
                                : showVoiceChatMode
                                    ? 'Listening for your command...'
                                : isMobile
                                    ? 'Ask anything…'
                                    : 'Ask me anything...'
                        }
                        className={cn(
                            'flex-1 bg-transparent text-content text-base',
                            'placeholder:text-content-muted outline-none',
                        )}
                        autoComplete="off"
                    />

                    {/* Mic button */}
                    {(voice.isSupported || wakeRealtime.isSupported || wakeFallbackVoice.isSupported) && (
                        <motion.button
                            type="button"
                            onClick={() => {
                                if (wakeRealtime.isListening) {
                                    wakeRealtime.stop();
                                    return;
                                }
                                if (wakeFallbackVoice.isListening) {
                                    wakeFallbackVoice.stop();
                                    return;
                                }
                                voice.toggle();
                            }}
                            disabled={isAnyTranscribing}
                            className={cn(
                                isMobile ? 'flex-shrink-0 w-14 h-14 rounded-lg' : 'flex-shrink-0 w-11 h-11 rounded-lg',
                                'flex items-center justify-center',
                                'border transition-colors duration-150',
                                isAnyTranscribing
                                    ? 'bg-amber-500/20 border-amber-400/40 text-amber-600 cursor-wait'
                                    : isAnyListening
                                        ? 'bg-primary/20 border-primary/50 text-primary'
                                        : 'bg-surface-secondary border-edge text-content-secondary hover:bg-surface-hover hover:text-content',
                            )}
                            whileHover={!instant && !isAnyTranscribing ? { scale: 1.05 } : undefined}
                            whileTap={!instant && !isAnyTranscribing ? { scale: 0.95 } : undefined}
                            title={isAnyTranscribing ? 'Transcribing…' : isAnyListening ? 'Stop listening' : `Voice input (${voice.mode})`}
                            aria-label={isAnyTranscribing ? 'Transcribing audio' : isAnyListening ? 'Stop listening' : `Voice input using ${voice.mode} mode`}
                        >
                            {isAnyTranscribing ? (
                                <svg width="18" height="18" viewBox="0 0 14 14" fill="none" className="motion-safe:animate-spin">
                                    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="20 12" />
                                </svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                                    <path d="M7 1v6a2 2 0 004 0V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                    <path d="M3 6a4 4 0 008 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                    <path d="M7 12v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                </svg>
                            )}
                        </motion.button>
                    )}
                    {showVoiceChatMode && (
                        <div className="absolute -bottom-7 left-0 flex items-center gap-2 text-[10px]">
                            <span
                                data-testid="voice-transport-label"
                                className="rounded-full border border-primary/20 bg-surface/90 px-2 py-1 text-primary/90"
                            >
                                {voiceTransportLabel}
                            </span>
                            <span className="text-primary/80">
                                {isLiveWakeTranscript ? voiceTransportHint : 'Voice channel is active.'}
                            </span>
                        </div>
                    )}
                    {showVoiceChatMode && <VoiceLevelMeter level={audioLevel} active={isAnyListening} />}
                    {/* Whisper latency badge */}
                    {voice.mode === 'whisper' && voice.latencyMs !== null && !isAnyListening && !activeVoiceError && (
                        <span className="absolute -bottom-5 right-10 text-[10px] text-content-muted">{voice.latencyMs}ms</span>
                    )}
                    {/* Voice error */}
                    {activeVoiceError && !isAnyListening && (
                        <span className="absolute -bottom-5 left-0 right-0 text-[10px] text-red-500 truncate" role="alert">{activeVoiceError}</span>
                    )}

                    {/* Submit button */}
                    <motion.button
                        type="submit"
                        aria-label="Submit prompt"
                        className={cn(
                            isMobile ? 'flex-shrink-0 w-14 h-14 rounded-lg' : 'flex-shrink-0 w-11 h-11 rounded-lg',
                            'flex items-center justify-center',
                            'bg-primary/10 border border-primary/30',
                            'text-primary hover:bg-primary/20',
                            'transition-colors duration-150',
                        )}
                        whileHover={!instant ? { scale: 1.05 } : undefined}
                        whileTap={!instant ? { scale: 0.95 } : undefined}
                    >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </motion.button>
                </div>
            </form>
        </motion.div>
    );
}

/** Expanded streaming conversation panel */
function AgentWindow({
    messages,
    streamingText,
    status,
    currentAction,
    onMinimize,
    onClose,
    onFollowUp,
    layoutId,
    isMobile,
}: {
    messages: Array<{ id: string; role: string; content: string }>;
    streamingText: string;
    status: string;
    currentAction: string;
    onMinimize: () => void;
    onClose: () => void;
    onFollowUp: (text: string) => void;
    layoutId: string;
    isMobile: boolean;
}) {
    const { instant, transition: motionTransition } = useMotionConfig();
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamingText, messages.length]);

    return (
        <motion.div
            layoutId={layoutId}
            className={cn(
                isMobile
                    ? 'fixed inset-0 z-50 rounded-none border-x-0 border-y border-edge'
                    : 'fixed top-1/2 left-1/2 z-50 w-[800px] max-w-[95vw] h-[600px] max-h-[85vh] rounded-2xl border border-edge',
                'bg-surface backdrop-blur-xl shadow-xl',
                'flex flex-col overflow-hidden',
            )}
            style={isMobile ? undefined : { x: '-50%', y: '-50%' }}
            transition={motionTransition({ type: 'spring', stiffness: 200, damping: 28 })}
        >
            {/* Header */}
            <div className={cn(
                'flex items-center justify-between border-b border-edge',
                isMobile
                    ? 'px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]'
                    : 'px-5 py-3',
            )}>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        'w-2 h-2 rounded-full',
                        status === 'streaming'
                            ? 'bg-primary motion-safe:animate-pulse'
                            : status === 'done'
                                ? 'bg-emerald-500'
                                : 'bg-content-muted',
                    )} />
                    <span className="text-xs font-medium text-content-secondary">
                        {status === 'streaming' ? currentAction || 'Processing...' : status === 'done' ? 'Complete' : 'Assistant'}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <motion.button
                        onClick={onMinimize}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-content-muted hover:text-content hover:bg-surface-hover transition-colors"
                        whileHover={!instant ? { scale: 1.1 } : undefined}
                        whileTap={!instant ? { scale: 0.9 } : undefined}
                        title="Minimize"
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </motion.button>
                    <motion.button
                        onClick={onClose}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-content-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        whileHover={!instant ? { scale: 1.1 } : undefined}
                        whileTap={!instant ? { scale: 0.9 } : undefined}
                        title="Close"
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </motion.button>
                </div>
            </div>

            {/* Message Area */}
            <div
                ref={scrollRef}
                className={cn(
                    'flex-1 overflow-y-auto overflow-x-hidden space-y-4',
                    isMobile ? 'px-4 py-3' : 'px-6 py-4',
                )}
            >
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={cn(
                            'max-w-[90%]',
                            msg.role === 'user' ? 'ml-auto text-right' : 'mr-auto',
                        )}
                    >
                        {msg.role === 'user' ? (
                            <div className="inline-block px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
                                <span className="text-sm text-content">{msg.content}</span>
                            </div>
                        ) : (
                            <div className="px-1">
                                <TypewriterText text={msg.content} isStreaming={false} />
                            </div>
                        )}
                    </div>
                ))}

                {status === 'streaming' && streamingText && (
                    <div className="max-w-[90%] mr-auto px-1">
                        <TypewriterText text={streamingText} isStreaming={true} />
                    </div>
                )}

                {status === 'idle' && messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-content-muted text-sm">
                        Awaiting input...
                    </div>
                )}
            </div>

            {/* Input Bar */}
            <ExpandedInputBar onSubmit={onFollowUp} disabled={status === 'streaming'} isMobile={isMobile} />
        </motion.div>
    );
}

function ExpandedInputBar({
    onSubmit,
    disabled,
    isMobile,
}: {
    onSubmit: (text: string) => void;
    disabled: boolean;
    isMobile: boolean;
}) {
    const [input, setInput] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || disabled) return;
        onSubmit(input.trim());
        setInput('');
    };

    return (
        <form
            onSubmit={handleSubmit}
            className={cn(
                'flex items-center gap-3 border-t border-edge',
                isMobile
                    ? 'px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]'
                    : 'px-5 py-3',
            )}
        >
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={disabled ? 'Processing...' : 'Follow-up...'}
                disabled={disabled}
                className={cn(
                    'flex-1 bg-transparent text-content text-sm',
                    'placeholder:text-content-muted outline-none',
                    'disabled:opacity-40',
                )}
                autoComplete="off"
            />
        </form>
    );
}

/** Minimized task widget */
function TaskWidget({
    currentAction,
    status,
    onExpand,
    layoutId,
    isMobile,
}: {
    currentAction: string;
    status: string;
    onExpand: () => void;
    layoutId: string;
    isMobile: boolean;
}) {
    const { instant, transition: motionTransition } = useMotionConfig();
    return (
        <motion.div
            layoutId={layoutId}
            onClick={onExpand}
            className={cn(
                isMobile
                    ? 'fixed left-2 right-2 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 px-4 py-3'
                    : 'fixed top-4 left-4 z-50 w-72 px-4 py-3',
                'rounded-xl border border-edge',
                'bg-surface backdrop-blur-md cursor-pointer shadow-sm',
                'flex items-center gap-3',
                'hover:border-edge-strong hover:shadow-md',
                'transition-[border-color,box-shadow] duration-200',
            )}
            transition={motionTransition({ type: 'spring', stiffness: 200, damping: 28 })}
            whileHover={!instant && !isMobile ? { scale: 1.02 } : undefined}
            whileTap={!instant ? { scale: 0.98 } : undefined}
        >
            <div className={cn(
                'flex-shrink-0 w-2 h-2 rounded-full',
                status === 'streaming'
                    ? 'bg-primary motion-safe:animate-pulse'
                    : status === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-content-muted',
            )} />
            <span className="flex-1 text-xs text-content-secondary truncate">
                {currentAction || (status === 'done' ? 'Task complete — click to view' : 'Idle')}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0 text-content-muted">
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </motion.div>
    );
}

/** Compact floating action button for starting a new task */
function CompactTrigger({
    onClick,
    isMobile,
}: {
    onClick: () => void;
    isMobile: boolean;
}) {
    const { instant, transition: motionTransition } = useMotionConfig();
    return (
        <motion.button
            initial={instant ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={instant ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            transition={motionTransition({ type: 'spring', stiffness: 300, damping: 25 })}
            whileHover={!instant ? { scale: 1.08 } : undefined}
            whileTap={!instant ? { scale: 0.95 } : undefined}
            onClick={onClick}
            className={cn(
                'fixed z-50',
                isMobile
                    ? 'bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-4'
                    : 'bottom-6 right-6',
                'w-12 h-12 rounded-full',
                'bg-surface backdrop-blur-xl',
                'border border-edge shadow-lg',
                'flex items-center justify-center',
                'text-primary hover:text-primary/80',
                'hover:border-edge-strong hover:shadow-xl',
                'transition-[border-color,box-shadow] duration-200',
            )}
            title="New task"
            aria-label="Start a new task"
        >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 3V15M3 9H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        </motion.button>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function JarvisHUDLayout({
    onPrompt,
    className = '',
    autoMinimizeDelay = 2500,
    onNavigate,
    voiceMode = 'whisper',
    onVoiceIntent,
}: JarvisHUDLayoutProps) {
    const isMobile = useIsMobileViewport();
    const [compactExpanded, setCompactExpanded] = useState(false);
    const [voiceWakeActivationToken, setVoiceWakeActivationToken] = useState(0);
    const [voiceWakeSessionActive, setVoiceWakeSessionActive] = useState(false);

    const multi = useMultiThread({
        onPrompt: onPrompt || mockStream,
    });

    useEffect(() => {
        if (multi.threads.length === 0) setCompactExpanded(false);
    }, [multi.threads.length]);

    // Auto-minimize timer
    const autoMinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => { if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current); };
    }, []);

    const scheduleAutoMinimize = useCallback(() => {
        if (autoMinimizeDelay <= 0) return;
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        autoMinTimerRef.current = setTimeout(() => {
            multi.minimize();
        }, autoMinimizeDelay);
    }, [autoMinimizeDelay, multi]);

    // Derived state
    const expanded = multi.expandedThread;
    const showPrompt = !expanded && multi.threads.length === 0;
    const showExpanded = !!expanded;
    const showCompact = !showPrompt && !showExpanded && multi.hasRoom;
    const LAYOUT_ID = expanded ? `agent-hud-${expanded.threadId}` : 'agent-hud-prompt';

    // Voice intent confirmation
    const [voiceConfirmation, setVoiceConfirmation] = useState<string | null>(null);
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        };
    }, []);

    const handlePromptSubmit = useCallback((text: string, source: 'voice' | 'text' = 'text') => {
        if (onVoiceIntent?.(text, source)) {
            setVoiceConfirmation(`✓ ${text}`);
            if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = setTimeout(() => setVoiceConfirmation(null), 1500);
            return;
        }
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        multi.createAndSend(text);
        scheduleAutoMinimize();
    }, [multi, scheduleAutoMinimize, onVoiceIntent]);

    const handleFollowUp = useCallback((text: string) => {
        if (!expanded) return;
        multi.sendFollowUp(expanded.threadId, text);
        scheduleAutoMinimize();
    }, [multi, expanded, scheduleAutoMinimize]);

    const handleMinimize = useCallback(() => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        multi.minimize();
    }, [multi]);

    const handleClose = useCallback(() => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        if (expanded) multi.close(expanded.threadId);
    }, [multi, expanded]);

    const handleExpand = useCallback((threadId: string) => {
        if (autoMinTimerRef.current) clearTimeout(autoMinTimerRef.current);
        multi.expand(threadId);
    }, [multi]);

    const handleWakeWord = useCallback((phrase: string) => {
        if (showExpanded) return;
        if (showCompact && !compactExpanded) {
            setCompactExpanded(true);
        }
        setVoiceWakeActivationToken((value) => value + 1);
        setVoiceConfirmation(`VOICE ${phrase.toUpperCase()}`);
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = setTimeout(() => setVoiceConfirmation(null), 1800);
    }, [compactExpanded, showCompact, showExpanded]);

    const wakeWord = useWakeWordActivation({
        enabled: true,
        lang: 'en-US',
        suspended: showExpanded || voiceWakeSessionActive,
        onWakeWord: handleWakeWord,
    });

    const wakeWordStatus: WakeWordStatus = !wakeWord.isSupported
        ? 'unsupported'
        : wakeWord.permissionState === 'denied'
            ? 'blocked'
            : wakeWord.permissionState === 'granted'
                ? (wakeWord.isArmed || wakeWord.isRestarting ? 'ready' : 'arming')
                : 'permission';

    const handleEnableWakeWord = useCallback(async () => {
        const state = await wakeWord.requestPermission();
        setVoiceConfirmation(
            state === 'granted'
                ? 'WAKE WORD ARMED'
                : state === 'denied'
                    ? 'WAKE WORD BLOCKED'
                    : state === 'unsupported'
                        ? 'WAKE WORD UNSUPPORTED'
                        : 'WAKE WORD PENDING',
        );
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = setTimeout(() => setVoiceConfirmation(null), 1800);
    }, [wakeWord]);

    return (
        <div className={cn('fixed inset-0 z-40 pointer-events-none', className)} aria-label="Agent Interface">
            {/* Backdrop scrim */}
            {(showPrompt || showExpanded) && (
                <div
                    className={cn(
                        'absolute inset-0 pointer-events-none transition-opacity duration-500',
                        showPrompt ? 'bg-surface/95' : 'bg-surface/80'
                    )}
                    aria-hidden="true"
                />
            )}

            {/* Interactive layer */}
            <div className="pointer-events-auto">
                <LayoutGroup>
                    <AnimatePresence mode="wait">
                        {showPrompt && (
                            <PromptBar
                                key="prompt"
                                onSubmit={handlePromptSubmit}
                                layoutId={LAYOUT_ID}
                                isMobile={isMobile}
                                voiceMode={voiceMode}
                                autoActivateVoiceToken={voiceWakeActivationToken}
                                wakeWordStatus={wakeWordStatus}
                                onEnableWakeWord={handleEnableWakeWord}
                                onVoiceSessionActiveChange={setVoiceWakeSessionActive}
                            />
                        )}

                        {showCompact && !compactExpanded && (
                            <CompactTrigger
                                key="compact-trigger"
                                onClick={() => setCompactExpanded(true)}
                                isMobile={isMobile}
                            />
                        )}

                        {showCompact && compactExpanded && (
                            <PromptBar
                                key="prompt-new"
                                onSubmit={(text, source) => { handlePromptSubmit(text, source); setCompactExpanded(false); }}
                                layoutId="agent-hud-prompt-compact"
                                isMobile={isMobile}
                                voiceMode={voiceMode}
                                autoActivateVoiceToken={voiceWakeActivationToken}
                                wakeWordStatus={wakeWordStatus}
                                onEnableWakeWord={handleEnableWakeWord}
                                onVoiceSessionActiveChange={setVoiceWakeSessionActive}
                            />
                        )}

                        {showExpanded && expanded && (
                            <AgentWindow
                                key={`expanded-${expanded.threadId}`}
                                messages={expanded.messages}
                                streamingText={expanded.streamingText}
                                status={expanded.status}
                                currentAction={expanded.currentAction}
                                onMinimize={handleMinimize}
                                onClose={handleClose}
                                onFollowUp={handleFollowUp}
                                layoutId={LAYOUT_ID}
                                isMobile={isMobile}
                            />
                        )}
                    </AnimatePresence>
                </LayoutGroup>
            </div>

            {/* Minimized thread widgets */}
            <TaskWidgetStack
                threads={multi.minimizedThreads}
                onExpand={handleExpand}
                onClose={multi.close}
                isMobile={isMobile}
            />

            {/* Voice command confirmation */}
            {voiceConfirmation && (
                <div
                    data-testid="voice-command-confirmation"
                    className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none
                        px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20
                        text-primary text-xs backdrop-blur-sm"
                    aria-live="polite"
                    role="status"
                >
                    {voiceConfirmation}
                </div>
            )}
        </div>
    );
}
