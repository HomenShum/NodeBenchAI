import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2, Mic, Search } from "lucide-react";
import { useMotionConfig } from "@/lib/motion";
import { useRealtimeTranscription } from "@/hooks/useRealtimeTranscription";
import { useVoiceInput, type VoiceMode } from "@/hooks/useVoiceInput";
import { useWakeVoiceFeedback } from "@/hooks/useWakeVoiceFeedback";
import { useWakeVoiceSession } from "@/hooks/useWakeVoiceSession";
import { useWakeWordActivation } from "@/hooks/useWakeWordActivation";
import { cn } from "@/lib/utils";

export interface JarvisHUDLayoutProps {
  className?: string;
  onPromptSubmit?: (prompt: string) => void | Promise<void>;
  autoExpandOnDone?: boolean;
  voiceMode?: VoiceMode;
}

const SUGGESTIONS = [
  "Summarize today's signals",
  "Draft a research brief",
  "Compare latest model benchmarks",
];

const VOICE_SURFACE_SPRING = {
  type: "spring" as const,
  stiffness: 170,
  damping: 26,
  mass: 0.9,
};

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
      className="pointer-events-none absolute -bottom-7 right-2 flex items-end gap-1 rounded-full border border-primary/15 bg-surface/85 px-2 py-1"
      aria-hidden="true"
    >
      {bars.map((threshold, index) => {
        const lit = active && level >= threshold * 0.45;
        return (
          <span
            key={threshold}
            className={cn(
              "w-1 rounded-full transition-all duration-120",
              lit ? "bg-primary shadow-[0_0_8px_rgba(99,102,241,0.45)]" : "bg-primary/20",
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

export function JarvisHUDLayout({
  className,
  onPromptSubmit,
  voiceMode = "whisper",
}: JarvisHUDLayoutProps) {
  const { instant, transition } = useMotionConfig();
  const reducedMotion = instant;
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceChatMode, setVoiceChatMode] = useState(false);
  const [isEnablingWakeWord, setIsEnablingWakeWord] = useState(false);
  const [wakeTransport, setWakeTransport] = useState<"openai_realtime" | "browser_fallback" | "manual" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { speakWakeConfirmation } = useWakeVoiceFeedback();

  const submitPrompt = useCallback(async (rawPrompt: string) => {
    const normalized = rawPrompt.trim();
    if (!normalized || isLoading) return;

    setIsLoading(true);
    try {
      if (onPromptSubmit) {
        await Promise.resolve(onPromptSubmit(normalized));
      }
    } catch {
      // Keep UI responsive even if backend fails
    } finally {
      setIsLoading(false);
      setPrompt("");
    }
  }, [isLoading, onPromptSubmit]);

  const voice = useVoiceInput({
    mode: voiceMode,
    onTranscript: (text) => {
      setPrompt(text);
      if (text.trim()) setVoiceChatMode(true);
    },
    onEnd: (finalText) => {
      const normalized = finalText.trim();
      if (!normalized) {
        return;
      }
      void submitPrompt(normalized);
    },
  });

  const wakeRealtime = useRealtimeTranscription({
    onTranscript: (text) => {
      setPrompt(text);
      if (text.trim()) setVoiceChatMode(true);
    },
    onEnd: (finalText) => {
      const normalized = finalText.trim();
      if (!normalized) return;
      void submitPrompt(normalized);
    },
  });

  const wakeFallbackVoice = useVoiceInput({
    mode: "browser",
    onTranscript: (text) => {
      setPrompt(text);
      if (text.trim()) setVoiceChatMode(true);
    },
    onEnd: (finalText) => {
      const normalized = finalText.trim();
      if (!normalized) return;
      void submitPrompt(normalized);
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
          setWakeTransport("openai_realtime");
          return true;
        }
      }
      if (wakeFallbackVoice.isSupported) {
        setWakeTransport("browser_fallback");
        wakeFallbackVoice.start();
        return true;
      }
      setWakeTransport("manual");
      voice.start();
      return true;
    },
  });

  const isLiveWakeTranscript = wakeRealtime.isListening || wakeFallbackVoice.isListening;
  const isAnyListening = wakeRealtime.isListening || wakeFallbackVoice.isListening || voice.isListening;
  const isAnyTranscribing = wakeRealtime.isTranscribing || wakeFallbackVoice.isTranscribing || voice.isTranscribing;
  const activeVoiceError = wakeRealtime.error ?? wakeFallbackVoice.error ?? voice.error;
  const audioLevel = Math.max(wakeRealtime.audioLevel, wakeFallbackVoice.audioLevel, voice.audioLevel);
  const showVoiceChatMode = voiceChatMode || wakeSession.isActive || isAnyListening || isAnyTranscribing;
  const voiceTransportLabel =
    wakeTransport === "browser_fallback"
      ? "Browser fallback"
      : wakeTransport === "manual"
        ? voice.mode === "whisper"
          ? "Manual Whisper"
          : "Manual browser speech"
        : "OpenAI Realtime";
  const voiceTransportHint =
    wakeTransport === "browser_fallback"
      ? (wakeRealtime.error ? "OpenAI Realtime unavailable, using browser fallback." : "Using browser fallback transcription.")
      : wakeTransport === "manual"
        ? "Using the manual mic path."
        : "OpenAI Realtime streaming transcript is updating live.";

  const wakeWord = useWakeWordActivation({
    enabled: true,
    suspended: showVoiceChatMode || isLoading || isEnablingWakeWord,
    onWakeWord: () => {
      void (async () => {
        if (showVoiceChatMode) return;
        setPrompt("");
        setVoiceChatMode(true);
        await wakeSession.beginWakeSession();
      })();
    },
  });

  const wakeWordStatus = !wakeWord.isSupported
    ? "unsupported"
    : wakeWord.permissionState === "denied"
      ? "blocked"
      : wakeWord.permissionState === "granted"
        ? (wakeWord.isArmed || wakeWord.isRestarting ? "ready" : "arming")
        : "permission";

  const wakeWordMessage = showVoiceChatMode
    ? isLiveWakeTranscript
      ? "Live transcript active"
      : isAnyTranscribing
        ? "Voice channel analyzing"
        : "Voice channel open"
    : wakeSession.phase === "replying"
      ? "NodeBench is listening"
      : wakeSession.phase === "starting"
        ? "Opening voice channel"
    : isEnablingWakeWord
      ? 'Enabling wake word'
      : wakeWordStatus === "ready"
        ? 'Say "Hey NodeBench"'
        : wakeWordStatus === "arming"
          ? "Arming wake word"
          : wakeWordStatus === "blocked"
            ? "Wake word blocked - allow microphone"
            : wakeWordStatus === "unsupported"
              ? "Wake word unavailable in this browser"
              : 'Enable "Hey NodeBench"';
  const wakeWordEnableShortLabel = "Enable wake word";

  useEffect(() => {
    if (isAnyListening || isAnyTranscribing || wakeSession.isActive) {
      setVoiceChatMode(true);
      return;
    }

    const settleTimer = window.setTimeout(() => {
      if (!prompt.trim() && !isLoading) {
        setVoiceChatMode(false);
      }
    }, 650);

    return () => window.clearTimeout(settleTimer);
  }, [isAnyListening, isAnyTranscribing, isLoading, prompt, wakeSession.isActive]);

  useEffect(() => {
    if (!showVoiceChatMode) {
      setWakeTransport(null);
    }
  }, [showVoiceChatMode]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      await submitPrompt(prompt);
    },
    [prompt, submitPrompt],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      setPrompt(suggestion);
      inputRef.current?.focus();
      void submitPrompt(suggestion);
    },
    [submitPrompt],
  );

  const handleEnableWakeWord = useCallback(async () => {
    if (isEnablingWakeWord) return;
    setIsEnablingWakeWord(true);
    try {
      await wakeWord.requestPermission();
    } finally {
      setIsEnablingWakeWord(false);
      inputRef.current?.focus();
    }
  }, [isEnablingWakeWord, wakeWord]);

  const handleMicClick = useCallback(() => {
    setVoiceChatMode(true);
    inputRef.current?.focus();
    if (wakeRealtime.isListening) {
      wakeRealtime.stop();
      return;
    }
    if (wakeFallbackVoice.isListening) {
      wakeFallbackVoice.stop();
      return;
    }
    voice.toggle();
  }, [voice, wakeFallbackVoice, wakeRealtime]);

  const heroGlowClass = useMemo(() => (
    showVoiceChatMode
      ? "shadow-[0_0_48px_rgba(99,102,241,0.18)] border-primary/40 bg-surface"
      : "shadow-sm"
  ), [showVoiceChatMode]);

  return (
    <div
      className={cn(
        "relative w-full flex flex-col items-center justify-center gap-6 py-8",
        className,
      )}
    >
      {/* Search/prompt input */}
      <form onSubmit={handleSubmit} className="relative w-full max-w-2xl">
        <motion.div
          data-testid="classic-voice-mode-indicator"
          className={cn(
            "absolute -top-8 left-1/2 z-10 w-max max-w-[min(94vw,22rem)] -translate-x-1/2 rounded-full border px-3 py-1 text-[9px] font-mono uppercase tracking-[0.12em] text-center leading-tight sm:text-[10px]",
            showVoiceChatMode
              ? "border-primary/45 bg-primary/15 text-primary"
              : wakeWordStatus === "blocked"
                ? "border-rose-500/35 bg-rose-500/10 text-rose-300"
                : wakeWordStatus === "unsupported"
                  ? "border-edge bg-surface/85 text-content-secondary"
                  : wakeWordStatus === "permission"
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                    : "border-edge bg-surface/85 text-content-secondary",
          )}
          initial={instant ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition(0.2)}
        >
          {wakeWordStatus === "permission" && !showVoiceChatMode ? (
            <button
              type="button"
              onClick={handleEnableWakeWord}
              className="pointer-events-auto rounded-full px-2 py-0.5 text-center outline-none transition-all hover:bg-white/5 hover:text-content focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label='Enable wake word detection for "Hey NodeBench" on classic home'
            >
              <span className="font-semibold normal-case tracking-normal sm:hidden">{wakeWordEnableShortLabel}</span>
              <span className="hidden font-semibold normal-case tracking-normal sm:inline">{wakeWordMessage}</span>
            </button>
          ) : (
            wakeWordMessage
          )}
        </motion.div>
        <label htmlFor="home-prompt-input" className="sr-only">
          Ask anything
        </label>
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Ask, search, or jump
            </p>
            <p className="mt-1 text-xs text-content-secondary">
              Type or say a command and watch the transcript update here in real time.
            </p>
          </div>
          {!showVoiceChatMode ? (
            <span className="rounded-full border border-edge bg-surface/80 px-2.5 py-1 text-[11px] text-content-secondary">
              Command deck
            </span>
          ) : null}
        </div>
        <motion.div
          className={cn(
            "relative rounded-xl transform-gpu will-change-transform",
            "transition-[box-shadow,border-color,background-color] duration-400",
            heroGlowClass,
          )}
          animate={showVoiceChatMode ? { scale: 1.008, y: -3 } : { scale: 1, y: 0 }}
          transition={VOICE_SURFACE_SPRING}
        >
          <AnimatePresence>
            {showVoiceChatMode && (
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 -inset-y-3 rounded-[1.5rem] bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.24),rgba(99,102,241,0.08)_42%,transparent_72%)] blur-2xl"
                initial={{ opacity: instant ? 0.95 : 0, scale: instant ? 1.02 : 0.94 }}
                animate={{ opacity: 0.95, scale: 1.02 }}
                exit={{ opacity: 0, scale: instant ? 1.02 : 0.98 }}
                transition={transition({ duration: 0.42, ease: [0.22, 1, 0.36, 1] })}
              />
            )}
          </AnimatePresence>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-muted" />
          <input
            ref={inputRef}
            id="home-prompt-input"
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              isLiveWakeTranscript
                ? "Live transcript appears here..."
                : showVoiceChatMode
                  ? "Listening for your command..."
                  : "Ask anything..."
            }
            disabled={isLoading}
            className={cn(
              "w-full rounded-xl border border-edge bg-surface py-4 pl-12 pr-14 text-base text-content",
              "placeholder:text-content-secondary/90 outline-none transition-all",
              "hover:border-primary/35 hover:bg-surface-hover/80 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
              "shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          {(voice.isSupported || wakeRealtime.isSupported || wakeFallbackVoice.isSupported) && (
            <button
              type="button"
              onClick={handleMicClick}
              disabled={isLoading || isAnyTranscribing}
              className={cn(
                "absolute right-12 top-1/2 -translate-y-1/2 rounded-lg p-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isAnyTranscribing
                  ? "cursor-wait bg-amber-500/20 text-amber-600"
                  : isAnyListening
                    ? "bg-primary/20 text-primary"
                    : "bg-surface-secondary text-content-secondary hover:bg-surface-hover hover:text-content",
              )}
              title={isAnyTranscribing ? "Transcribing..." : isAnyListening ? "Stop listening" : `Voice input (${voice.mode})`}
              aria-label={isAnyTranscribing ? "Transcribing audio" : isAnyListening ? "Stop listening" : `Voice input using ${voice.mode} mode`}
            >
              {isAnyTranscribing ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          )}
          {showVoiceChatMode && (
            <div className="pointer-events-none absolute -bottom-8 left-0 flex items-center gap-2 text-[11px]">
              <span
                data-testid="voice-transport-label"
                className="rounded-full border border-primary/20 bg-surface/90 px-2 py-1 text-primary/90"
              >
                {voiceTransportLabel}
              </span>
              <span className="text-primary/80">
                {isLiveWakeTranscript ? voiceTransportHint : "Voice channel is active."}
              </span>
            </div>
          )}
          {showVoiceChatMode && <VoiceLevelMeter level={audioLevel} active={isAnyListening} />}
          <AnimatePresence>
            <motion.button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              initial={false}
              animate={{
                opacity: prompt.trim().length > 0 || isLoading ? 1 : 0,
                scale: prompt.trim().length > 0 || isLoading ? 1 : 0.92,
              }}
              transition={transition({ duration: 0.18, ease: "easeOut" })}
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2",
                "bg-primary text-white transition-colors",
                "hover:bg-primary/90 disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
              aria-label="Submit"
              style={{ pointerEvents: prompt.trim().length > 0 || isLoading ? "auto" : "none" }}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </motion.button>
          </AnimatePresence>
        </motion.div>
        {activeVoiceError && !isAnyListening && (
          <div className="mt-2 text-sm text-rose-500" role="alert">
            {activeVoiceError}
          </div>
        )}
      </form>

      {/* Quick suggestions */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSuggestionClick(s)}
            className={cn(
              "rounded-lg border border-edge bg-surface-secondary px-3 py-1.5 text-xs text-content-secondary shadow-sm",
              "transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/10 hover:text-content hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] active:translate-y-0 active:scale-[0.99]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
