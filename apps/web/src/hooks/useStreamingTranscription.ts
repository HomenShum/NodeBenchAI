/**
 * useStreamingTranscription — OpenAI Realtime API streaming ASR via WebRTC
 *
 * Industry-standard live transcription with:
 * - Interim (unstable) vs final (stable) transcript layers
 * - Server VAD with speech_started / speech_stopped events
 * - Noise reduction (near-field mode)
 * - Logprob-based confidence scoring
 * - WebRTC data channel for transcript events (no WebSocket needed)
 *
 * Uses the existing Convex actions:
 * - `realtimeTranscription.startRealtimeTranscriptionCall` — SDP exchange
 *
 * Falls back gracefully: if no OPENAI_API_KEY is configured or WebRTC
 * unavailable, returns isSupported=false.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

// ── Types ────────────────────────────────────────────────────────────────────

export type SpeechState =
  | "idle"
  | "connecting"
  | "listening"
  | "speech_started"
  | "speech_ended"
  | "error";

export interface UseStreamingTranscriptionOptions {
  /** Called on every transcript update (interim + final) */
  onTranscript: (text: string) => void;
  /** Called when an utterance is finalized (turn complete) */
  onUtterance?: (text: string) => void;
  /** Called when session ends */
  onEnd?: (fullText: string) => void;
  /** Language code (default: "en") */
  lang?: string;
}

export interface UseStreamingTranscriptionReturn {
  speechState: SpeechState;
  isSupported: boolean;
  isListening: boolean;
  /** The interim (unstable) portion of the current transcript */
  interimText: string;
  /** The accumulated final (stable) text */
  stableText: string;
  /** Combined text (stable + interim) */
  fullText: string;
  /** Audio input level 0-1 */
  audioLevel: number;
  /** Average confidence of the last final segment (from logprobs) */
  confidence: number;
  /** Connection latency in ms */
  latencyMs: number | null;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useStreamingTranscription({
  onTranscript,
  onUtterance,
  onEnd,
  lang = "en",
}: UseStreamingTranscriptionOptions): UseStreamingTranscriptionReturn {
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [interimText, setInterimText] = useState("");
  const [stableText, setStableText] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(
    typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined",
  );

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const stableTextRef = useRef("");
  const connectTimeRef = useRef(0);

  const startCall = useAction(api.domains.ai.realtimeTranscription.startRealtimeTranscriptionCall);

  // ── Audio level meter ──────────────────────────────────────────────────

  const stopAudioMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    try { analyserRef.current?.disconnect(); } catch { /* noop */ }
    sourceRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => undefined);
    }
    audioContextRef.current = null;
    setAudioLevel(0);
  }, []);

  const startAudioMeter = useCallback((stream: MediaStream) => {
    stopAudioMeter();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const n = (data[i] - 128) / 128;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / data.length);
      const boosted = Math.min(1, rms * 4.2);
      setAudioLevel((prev) => Math.max(boosted, prev * 0.72));
      meterFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [stopAudioMeter]);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopAudioMeter();
  }, [stopAudioMeter]);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Start ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (pcRef.current) return;

    setError(null);
    setInterimText("");
    setStableText("");
    stableTextRef.current = "";
    setSpeechState("connecting");
    connectTimeRef.current = performance.now();

    // 1. Get microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
        },
      });
      streamRef.current = stream;
      startAudioMeter(stream);
    } catch (err: any) {
      setError(err?.message || "Microphone access denied");
      setSpeechState("error");
      return;
    }

    // 2. Create RTCPeerConnection
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // Add mic track
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    // 3. Create data channel for receiving transcript events
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleTranscriptEvent(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    dc.onopen = () => {
      setLatencyMs(Math.round(performance.now() - connectTimeRef.current));
      setSpeechState("listening");
    };

    dc.onerror = () => {
      setError("Data channel error");
      setSpeechState("error");
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        const finalText = stableTextRef.current.trim();
        if (finalText) onEnd?.(finalText);
        cleanup();
        setSpeechState("idle");
      }
    };

    // 4. Create offer and exchange SDP via Convex
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (or timeout)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const check = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", check);
        // Timeout after 3s
        setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }, 3000);
      });

      const offerSdp = pc.localDescription?.sdp;
      if (!offerSdp) throw new Error("No local SDP");

      const { answerSdp } = await startCall({
        offerSdp,
        language: lang,
      });

      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err: any) {
      const msg = err?.message || "Failed to establish transcription session";
      if (msg.includes("API key") || msg.includes("configured")) {
        setIsSupported(false);
      }
      setError(msg);
      cleanup();
      setSpeechState("error");
    }
  }, [cleanup, lang, onEnd, startAudioMeter, startCall]);

  // ── Handle transcript events from data channel ─────────────────────────

  const handleTranscriptEvent = useCallback((msg: any) => {
    const type = msg.type as string;

    // VAD events
    if (type === "input_audio_buffer.speech_started") {
      setSpeechState("speech_started");
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      setSpeechState("speech_ended");
      return;
    }

    // Interim transcription delta
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = msg.delta as string || "";
      if (delta) {
        setInterimText((prev) => prev + delta);
        onTranscript((stableTextRef.current + " " + delta).trim());
        setSpeechState("speech_started");
      }
      return;
    }

    // Final transcription completed
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = msg.transcript as string || "";
      if (transcript) {
        stableTextRef.current = (stableTextRef.current + " " + transcript).trim();
        setStableText(stableTextRef.current);
        setInterimText("");
        onTranscript(stableTextRef.current);

        // Extract confidence from logprobs if available
        const logprobs = msg.logprobs as Array<{ logprob: number }> | undefined;
        if (logprobs && logprobs.length > 0) {
          const avgLogprob = logprobs.reduce((s, lp) => s + lp.logprob, 0) / logprobs.length;
          setConfidence(Math.min(1, Math.max(0, Math.exp(avgLogprob))));
        } else {
          setConfidence(0.9); // Default high confidence for completed
        }

        onUtterance?.(stableTextRef.current);
      }
      return;
    }

    // Session errors
    if (type === "error") {
      setError(msg.error?.message || "Transcription error");
      setSpeechState("error");
    }
  }, [onTranscript, onUtterance]);

  // ── Stop ─────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    const finalText = stableTextRef.current.trim();
    if (finalText) onEnd?.(finalText);
    cleanup();
    setSpeechState("idle");
    setInterimText("");
  }, [cleanup, onEnd]);

  // ── Toggle ───────────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    if (speechState === "idle" || speechState === "error") {
      void start();
    } else {
      stop();
    }
  }, [speechState, start, stop]);

  const isListening = speechState === "listening" || speechState === "speech_started" || speechState === "speech_ended";
  const fullText = interimText
    ? (stableText + " " + interimText).trim()
    : stableText;

  return {
    speechState,
    isSupported,
    isListening,
    interimText,
    stableText,
    fullText,
    audioLevel,
    confidence,
    latencyMs,
    error,
    start,
    stop,
    toggle,
  };
}
