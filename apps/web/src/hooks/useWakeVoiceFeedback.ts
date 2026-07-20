import { useCallback, useEffect, useRef } from "react";

const DEFAULT_WAKE_CONFIRMATION = "NodeBench is listening.";

type SpeakWakeConfirmationOptions = {
  text?: string;
  cooldownMs?: number;
};

type UseWakeVoiceFeedbackOptions = {
  defaultText?: string;
  lang?: string;
  pitch?: number;
  rate?: number;
  volume?: number;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useWakeVoiceFeedback({
  defaultText = DEFAULT_WAKE_CONFIRMATION,
  lang = "en-US",
  pitch = 1,
  rate = 1,
  volume = 0.9,
}: UseWakeVoiceFeedbackOptions = {}) {
  const lastSpokenAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    window.speechSynthesis?.cancel();
  }, []);

  const speakWakeConfirmation = useCallback(async ({
    text = defaultText,
    cooldownMs = 1800,
  }: SpeakWakeConfirmationOptions = {}) => {
    if (typeof window === "undefined") return false;

    const synth = window.speechSynthesis;
    if (!text.trim() || !synth || typeof window.SpeechSynthesisUtterance === "undefined") {
      return false;
    }

    const now = Date.now();
    if (now - lastSpokenAtRef.current < cooldownMs) {
      return false;
    }
    lastSpokenAtRef.current = now;

    try {
      synth.cancel();
    } catch {
      // Ignore cancel errors from browsers with partial speechSynthesis support.
    }

    await wait(40);

    return await new Promise<boolean>((resolve) => {
      let settled = false;

      const finalize = (spoken: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        resolve(spoken);
      };

      const utterance = new window.SpeechSynthesisUtterance(text.trim());
      utterance.lang = lang;
      utterance.pitch = pitch;
      utterance.rate = rate;
      utterance.volume = volume;
      utterance.onend = () => finalize(true);
      utterance.onerror = () => finalize(false);

      timeoutRef.current = window.setTimeout(() => finalize(true), 1600);

      try {
        synth.speak(utterance);
      } catch {
        finalize(false);
      }
    });
  }, [defaultText, lang, pitch, rate, volume]);

  return { speakWakeConfirmation };
}
