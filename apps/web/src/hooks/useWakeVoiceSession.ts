import { useCallback, useEffect, useRef, useState } from "react";

export type WakeVoicePhase = "idle" | "replying" | "starting" | "active";

interface UseWakeVoiceSessionOptions {
  isListening: boolean;
  isTranscribing: boolean;
  startVoiceCapture: () => Promise<boolean> | boolean | void;
  speakWakeConfirmation: () => Promise<boolean>;
  focusInput?: () => void;
  minVisibleMs?: number;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useWakeVoiceSession({
  isListening,
  isTranscribing,
  startVoiceCapture,
  speakWakeConfirmation,
  focusInput,
  minVisibleMs = 1800,
}: UseWakeVoiceSessionOptions) {
  const [phase, setPhase] = useState<WakeVoicePhase>("idle");
  const runIdRef = useRef(0);
  const phaseRef = useRef<WakeVoicePhase>("idle");
  const visibleUntilRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  phaseRef.current = phase;

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    clearResetTimer();
    setPhase("idle");
  }, [clearResetTimer]);

  const beginWakeSession = useCallback(async () => {
    if (phaseRef.current !== "idle" || isListening || isTranscribing) {
      return false;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    visibleUntilRef.current = Date.now() + minVisibleMs;

    setPhase("replying");
    focusInput?.();

    const spoken = await speakWakeConfirmation();
    if (runIdRef.current !== runId) return false;

    setPhase("starting");
    focusInput?.();

    if (spoken) {
      await wait(100);
      if (runIdRef.current !== runId) return false;
    }

    const started = await startVoiceCapture();
    return started !== false;
  }, [
    focusInput,
    isListening,
    isTranscribing,
    minVisibleMs,
    speakWakeConfirmation,
    startVoiceCapture,
  ]);

  useEffect(() => {
    clearResetTimer();

    if (isListening || isTranscribing) {
      setPhase("active");
      return;
    }

    if (phaseRef.current === "idle") {
      return;
    }

    const remainingVisibleMs = Math.max(0, visibleUntilRef.current - Date.now());
    const delayMs = Math.max(remainingVisibleMs, 700);

    resetTimerRef.current = window.setTimeout(() => {
      setPhase("idle");
    }, delayMs);

    return clearResetTimer;
  }, [clearResetTimer, isListening, isTranscribing, phase]);

  useEffect(() => () => {
    clearResetTimer();
  }, [clearResetTimer]);

  return {
    phase,
    isActive: phase !== "idle",
    beginWakeSession,
    reset,
  };
}
