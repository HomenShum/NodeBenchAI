/**
 * useVoiceOutput — React hook for text-to-speech output.
 *
 * Priority chain:
 *   1. ElevenLabs streaming TTS (if VITE_ELEVENLABS_API_KEY is set)
 *   2. Browser SpeechSynthesis API (free, built-in fallback)
 *   3. Silent no-op (if neither available)
 *
 * Features:
 *   - Streaming playback (ElevenLabs starts playing before full response)
 *   - AbortController cancellation (user interrupts)
 *   - Markdown stripping (no "asterisk asterisk bold text")
 *   - localStorage persistence for enabled/disabled preference
 *   - Graceful degradation — never throws to caller
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  streamSpeech,
  createAudioPlayer,
  stripMarkdownForSpeech,
  getDefaultConfig,
  type AudioPlayer,
  type ElevenLabsConfig,
} from "@/lib/elevenlabs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseVoiceOutputReturn {
  /** Speak the given text. Strips markdown automatically. */
  speak(text: string): Promise<void>;
  /** Stop current speech immediately. */
  stop(): void;
  /** Whether audio is currently playing. */
  isSpeaking: boolean;
  /** Whether voice output is enabled by the user. */
  isEnabled: boolean;
  /** Toggle voice output on/off (persists to localStorage). */
  toggleEnabled(): void;
  /** "gemini-live" | "elevenlabs" | "browser" | "none" — which backend is active. */
  backend: "gemini-live" | "elevenlabs" | "browser" | "none";
  /** Set the active backend (e.g., when Gemini Live session handles audio output directly). */
  setBackendOverride(backend: "gemini-live" | null): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "nodebench:voice-output-enabled";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceOutput(): UseVoiceOutputReturn {
  // Persist preference
  const [isEnabled, setIsEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [backendOverride, setBackendOverride] = useState<"gemini-live" | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const configRef = useRef<ElevenLabsConfig | null>(null);

  // Resolve config once
  useEffect(() => {
    configRef.current = getDefaultConfig();
  }, []);

  const hasBrowserTTS =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // When Gemini Live is active, it handles audio output natively —
  // no need for separate TTS. The override is set by useGeminiLiveSession.
  const backend: "gemini-live" | "elevenlabs" | "browser" | "none" = backendOverride
    ? backendOverride
    : configRef.current
    ? "elevenlabs"
    : hasBrowserTTS
      ? "browser"
      : "none";

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      abortRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    // ElevenLabs
    playerRef.current?.stop();
    abortRef.current?.abort();
    abortRef.current = null;

    // Browser fallback
    window.speechSynthesis?.cancel();

    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (rawText: string) => {
      if (!isEnabled) return;

      // Stop any current playback first
      stop();

      const text = stripMarkdownForSpeech(rawText);
      if (!text) return;

      const config = getDefaultConfig();

      // --- ElevenLabs path ---
      if (config) {
        try {
          const ac = new AbortController();
          abortRef.current = ac;

          if (!playerRef.current) {
            playerRef.current = createAudioPlayer();
          }

          setIsSpeaking(true);

          const stream = await streamSpeech(text, config, ac.signal);
          await playerRef.current.play(stream);

          // Play resolves when audio ends
          if (!ac.signal.aborted) {
            setIsSpeaking(false);
          }
        } catch (err) {
          // Silently degrade — don't crash the UI for TTS failures
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            // User cancelled — expected
          } else {
            console.warn("[useVoiceOutput] ElevenLabs TTS failed, falling back to browser:", err);
            // Fall through to browser TTS
            speakWithBrowser(text, setIsSpeaking);
          }
        }
        return;
      }

      // --- Browser SpeechSynthesis fallback ---
      if (hasBrowserTTS) {
        speakWithBrowser(text, setIsSpeaking);
        return;
      }

      // --- No TTS available — silent no-op ---
    },
    [isEnabled, stop, hasBrowserTTS],
  );

  const toggleEnabled = useCallback(() => {
    setIsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Quota exceeded or private mode — ignore
      }
      if (!next) {
        // Turning off — stop any current speech
        stop();
      }
      return next;
    });
  }, [stop]);

  return {
    speak,
    stop,
    isSpeaking,
    isEnabled,
    toggleEnabled,
    backend,
    setBackendOverride: useCallback((override: "gemini-live" | null) => {
      setBackendOverride(override);
    }, []),
  };
}

// ---------------------------------------------------------------------------
// Browser SpeechSynthesis helper
// ---------------------------------------------------------------------------

function speakWithBrowser(
  text: string,
  setIsSpeaking: (v: boolean) => void,
) {
  if (!window.speechSynthesis) return;

  // BOUND: limit to 5000 chars
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
  utterance.rate = 1.1;
  utterance.onend = () => setIsSpeaking(false);
  utterance.onerror = () => setIsSpeaking(false);

  setIsSpeaking(true);
  window.speechSynthesis.speak(utterance);
}
