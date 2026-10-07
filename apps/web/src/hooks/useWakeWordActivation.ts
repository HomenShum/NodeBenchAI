import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORD_PATTERN = /\b(?:hey|hi|okay|ok)\s+nodebench\b/i;
export const WAKE_WORD_EVENT = "nodebench:wake-word";

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectWakeWord(text: string): string | null {
  const normalized = normalizeTranscript(text);
  if (!normalized) return null;
  const match = normalized.match(WAKE_WORD_PATTERN);
  return match ? match[0] : null;
}

type MicrophonePermissionState = "unknown" | "granted" | "prompt" | "denied" | "unsupported";

interface UseWakeWordActivationOptions {
  enabled?: boolean;
  lang?: string;
  suspended?: boolean;
  onWakeWord: (phrase: string) => void;
}

interface UseWakeWordActivationReturn {
  isSupported: boolean;
  isArmed: boolean;
  isRestarting: boolean;
  permissionState: MicrophonePermissionState;
  lastWakePhrase: string | null;
  requestPermission: () => Promise<MicrophonePermissionState>;
}

export function useWakeWordActivation({
  enabled = true,
  lang = "en-US",
  suspended = false,
  onWakeWord,
}: UseWakeWordActivationOptions): UseWakeWordActivationReturn {
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeCooldownRef = useRef(0);
  const wakeLockUntilRef = useRef(0);
  const enabledRef = useRef(enabled);
  const suspendedRef = useRef(suspended);
  const permissionRef = useRef<MicrophonePermissionState>("unknown");

  const [isArmed, setIsArmed] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [permissionState, setPermissionState] = useState<MicrophonePermissionState>("unknown");
  const [lastWakePhrase, setLastWakePhrase] = useState<string | null>(null);

  enabledRef.current = enabled;
  suspendedRef.current = suspended;
  permissionRef.current = permissionState;

  const SpeechRecognitionCtor =
    typeof window !== "undefined"
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;
  const isSupported = !!SpeechRecognitionCtor;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        // Ignore stop errors from browsers that already ended the session.
      }
    }
    setIsArmed(false);
    setIsRestarting(false);
  }, [clearRestartTimer]);

  const triggerWakeWord = useCallback(
    (phrase: string) => {
      const now = Date.now();
      if (now - wakeCooldownRef.current < 3000) return;
      wakeCooldownRef.current = now;
      wakeLockUntilRef.current = now + 2600;
      setLastWakePhrase(phrase);
      onWakeWord(phrase);
    },
    [onWakeWord],
  );

  const startListening = useCallback(() => {
    if (!isSupported || !enabledRef.current || suspendedRef.current) return;
    if (permissionRef.current !== "granted") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (Date.now() < wakeLockUntilRef.current) return;
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsArmed(true);
      setIsRestarting(false);
    };

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? "";
      }

      const phrase = detectWakeWord(transcript);
      if (!phrase) return;

      triggerWakeWord(phrase);
      stopListening();
    };

    recognition.onerror = (event: any) => {
      setIsArmed(false);
      recognitionRef.current = null;

      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setIsRestarting(false);
        setPermissionState("denied");
        return;
      }

      if (!enabledRef.current || suspendedRef.current || permissionRef.current !== "granted") {
        setIsRestarting(false);
        return;
      }

      setIsRestarting(true);
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        startListening();
      }, 900);
    };

    recognition.onend = () => {
      setIsArmed(false);
      recognitionRef.current = null;

      if (!enabledRef.current || suspendedRef.current || permissionRef.current !== "granted") {
        setIsRestarting(false);
        return;
      }

      setIsRestarting(true);
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        startListening();
      }, 900);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsArmed(false);
      setIsRestarting(false);
    }
  }, [
    SpeechRecognitionCtor,
    clearRestartTimer,
    isSupported,
    lang,
    stopListening,
    triggerWakeWord,
  ]);

  const requestPermission = useCallback(async (): Promise<MicrophonePermissionState> => {
    if (!isSupported) {
      setPermissionState("unsupported");
      return "unsupported";
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState("granted");
      if (enabledRef.current && !suspendedRef.current) {
        setTimeout(() => startListening(), 0);
      }
      return "granted";
    } catch (error: any) {
      const denied =
        error?.name === "NotAllowedError" ||
        error?.name === "PermissionDeniedError" ||
        error?.name === "SecurityError";
      const nextState: MicrophonePermissionState = denied ? "denied" : "prompt";
      setPermissionState(nextState);
      return nextState;
    }
  }, [isSupported, startListening]);

  useEffect(() => {
    if (!isSupported) {
      setPermissionState("unsupported");
      return;
    }

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    const syncPermission = (state: MicrophonePermissionState) => {
      if (cancelled) return;
      setPermissionState(state);
      if (state !== "granted") {
        stopListening();
      } else if (enabled && !suspended) {
        startListening();
      }
    };

    const initialize = async () => {
      try {
        const permissionsApi = navigator.permissions as
          | { query: (descriptor: PermissionDescriptor) => Promise<PermissionStatus> }
          | undefined;
        if (!permissionsApi?.query) {
          syncPermission("unknown");
          return;
        }

        permissionStatus = await permissionsApi.query({ name: "microphone" as PermissionName });
        syncPermission(permissionStatus.state as MicrophonePermissionState);
        permissionStatus.onchange = () => {
          syncPermission(permissionStatus?.state as MicrophonePermissionState);
        };
      } catch {
        syncPermission("unknown");
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, [enabled, isSupported, startListening, stopListening, suspended]);

  useEffect(() => {
    if (!isSupported || permissionState !== "granted" || !enabled || suspended) {
      stopListening();
      return;
    }
    startListening();
    return stopListening;
  }, [enabled, isSupported, permissionState, startListening, stopListening, suspended]);

  useEffect(() => {
    if (!isSupported) return undefined;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopListening();
        return;
      }

      if (enabledRef.current && !suspendedRef.current && permissionRef.current === "granted") {
        startListening();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isSupported, startListening, stopListening]);

  useEffect(() => {
    const handleWakeWordEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ phrase?: string }>;
      const phrase = detectWakeWord(customEvent.detail?.phrase ?? "hey nodebench");
      if (!phrase) return;
      triggerWakeWord(phrase);
    };

    window.addEventListener(WAKE_WORD_EVENT, handleWakeWordEvent as EventListener);
    return () => {
      window.removeEventListener(WAKE_WORD_EVENT, handleWakeWordEvent as EventListener);
    };
  }, [triggerWakeWord]);

  return {
    isSupported,
    isArmed,
    isRestarting,
    permissionState,
    lastWakePhrase,
    requestPermission,
  };
}
