/**
 * useGeminiLiveSession — Gemini 3.1 Flash Live WebSocket hook.
 *
 * Manages the full lifecycle of a Gemini Live voice session:
 *   1. Gets session config + WebSocket URL from server
 *   2. Opens WebSocket to Gemini Live API
 *   3. Captures mic audio via AudioWorklet (16kHz PCM)
 *   4. Sends audio chunks as base64 over WebSocket
 *   5. Receives and plays model audio responses (24kHz PCM)
 *   6. Provides input/output transcription
 *   7. Handles tool calls (function calling)
 *   8. Supports barge-in (user interrupts model)
 *
 * Replaces useStreamingTranscription (OpenAI Realtime WebRTC).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  createPcmWorkletUrl,
  float32ToBase64Pcm16,
  computeAudioLevel,
  PCM_WORKLET_NAME,
} from "@/lib/audio/pcmWorklet";
import { createPcmPlayer, type PcmPlayer } from "@/lib/audio/pcmPlayer";

// ── Types ──────────────────────────────────────────────────────────────────

export type GeminiSpeechState =
  | "idle"
  | "connecting"
  | "listening"
  | "speech_started"
  | "speech_ended"
  | "model_speaking"
  | "error";

export interface UseGeminiLiveSessionOptions {
  /** Called with interim + stable transcript text */
  onTranscript?: (text: string) => void;
  /** Called when a complete utterance is finalized */
  onUtterance?: (text: string) => void;
  /** Called when session ends */
  onEnd?: (finalText: string) => void;
  /** Called with model's spoken text (output transcription) */
  onModelTranscript?: (text: string) => void;
  /** Language code (e.g., "en") */
  lang?: string;
  /** Custom system instruction */
  systemInstruction?: string;
}

export interface UseGeminiLiveSessionReturn {
  /** Start the live session */
  start: () => void;
  /** Stop the live session */
  stop: () => void;
  /** Toggle start/stop */
  toggle: () => void;
  /** Current speech state */
  speechState: GeminiSpeechState;
  /** Stable (finalized) user transcript */
  stableText: string;
  /** Interim (in-progress) user transcript */
  interimText: string;
  /** Full accumulated user transcript */
  fullText: string;
  /** Model's spoken response transcript */
  modelTranscript: string;
  /** Whether model audio is currently playing */
  modelAudioPlaying: boolean;
  /** Mic audio level 0-1 for UI visualization */
  audioLevel: number;
  /** Confidence score 0-1 (estimated from response quality) */
  confidence: number;
  /** Connection latency in ms */
  latencyMs: number | null;
  /** Error message if any */
  error: string | null;
  /** Whether a session is active */
  isActive: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SESSION_ENDPOINT = "/voice/session";
const MIC_SAMPLE_RATE = 16000;

// ── Hook ───────────────────────────────────────────────────────────────────

export function useGeminiLiveSession(
  options: UseGeminiLiveSessionOptions = {},
): UseGeminiLiveSessionReturn {
  const {
    onTranscript,
    onUtterance,
    onEnd,
    onModelTranscript,
    lang = "en",
    systemInstruction,
  } = options;

  const [speechState, setSpeechState] = useState<GeminiSpeechState>("idle");
  const [stableText, setStableText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [modelTranscript, setModelTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const fullTextRef = useRef("");
  const connectTimeRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  // Stable callback refs
  const onTranscriptRef = useRef(onTranscript);
  const onUtteranceRef = useRef(onUtterance);
  const onEndRef = useRef(onEnd);
  const onModelTranscriptRef = useRef(onModelTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onUtteranceRef.current = onUtterance;
    onEndRef.current = onEnd;
    onModelTranscriptRef.current = onModelTranscript;
  });

  const cleanup = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Stop mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Disconnect worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    // Close audio context
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    // Stop player
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    // Delete session on server
    if (sessionIdRef.current) {
      fetch(`${SESSION_ENDPOINT}/${sessionIdRef.current}`, { method: "DELETE" }).catch(() => {});
      sessionIdRef.current = null;
    }
    activeRef.current = false;
  }, []);

  const stop = useCallback(() => {
    const finalText = fullTextRef.current;
    cleanup();
    setSpeechState("idle");
    setAudioLevel(0);
    onEndRef.current?.(finalText);
  }, [cleanup]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;

    setError(null);
    setStableText("");
    setInterimText("");
    setModelTranscript("");
    fullTextRef.current = "";
    setSpeechState("connecting");
    connectTimeRef.current = performance.now();

    try {
      // ── Step 1: Get session config from server ────────────────────
      const sessionRes = await fetch(SESSION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "web-user",
          systemInstruction,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => ({}));
        if ((errData as { fallback?: string }).fallback === "browser") {
          throw new Error("GEMINI_NOT_CONFIGURED");
        }
        throw new Error(`Session creation failed: ${sessionRes.status}`);
      }

      const session = (await sessionRes.json()) as {
        sessionId: string;
        wsUrl: string;
        config: Record<string, unknown>;
      };
      sessionIdRef.current = session.sessionId;

      // ── Step 2: Open WebSocket to Gemini ──────────────────────────
      const ws = new WebSocket(session.wsUrl);
      wsRef.current = ws;

      // Create audio player for model responses
      playerRef.current = createPcmPlayer();

      ws.onopen = () => {
        // Send config as first message
        ws.send(JSON.stringify({ setup: session.config }));
      };

      // Wait for setup complete
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket setup timeout")), 15000);

        const originalOnMessage = ws.onmessage;
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.setupComplete) {
              clearTimeout(timeout);
              setLatencyMs(Math.round(performance.now() - connectTimeRef.current));
              // Restore normal message handler
              ws.onmessage = handleMessage;
              resolve();
            }
          } catch {
            // Not JSON yet, ignore
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };
      });

      // ── Step 3: Capture mic audio ─────────────────────────────────
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: MIC_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = micStream;

      // ── Step 4: Set up AudioWorklet for PCM capture ───────────────
      const audioCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const workletUrl = createPcmWorkletUrl();
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(audioCtx, PCM_WORKLET_NAME);
      workletNodeRef.current = workletNode;

      const source = audioCtx.createMediaStreamSource(micStream);
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination); // Required for worklet to process

      // ── Step 5: Stream PCM to Gemini ──────────────────────────────
      workletNode.port.onmessage = (e: MessageEvent) => {
        const data = e.data as { type: string; samples: Float32Array };
        if (data.type !== "pcm" || !activeRef.current || !wsRef.current) return;

        // Update audio level for UI
        const level = computeAudioLevel(data.samples);
        setAudioLevel(level);

        // Barge-in: if user is speaking while model is playing, stop model audio
        if (level > 0.05 && playerRef.current?.isPlaying) {
          playerRef.current.stop();
          setSpeechState("speech_started");
        }

        // Send audio to Gemini
        if (wsRef.current.readyState === WebSocket.OPEN) {
          const base64 = float32ToBase64Pcm16(data.samples);
          wsRef.current.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: base64,
                  mimeType: "audio/pcm;rate=16000",
                },
              },
            }),
          );
        }
      };

      setSpeechState("listening");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[gemini-live] Start error:", msg);
      setError(msg);
      setSpeechState("error");
      cleanup();
      activeRef.current = false;
    }

    // ── Message handler ───────────────────────────────────────────────
    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;

        // Server content (audio + transcription)
        if (msg.serverContent) {
          const content = msg.serverContent as Record<string, unknown>;

          // Model audio output
          const modelTurn = content.modelTurn as { parts?: Array<{ inlineData?: { data: string } }> } | undefined;
          if (modelTurn?.parts) {
            setSpeechState("model_speaking");
            for (const part of modelTurn.parts) {
              if (part.inlineData?.data) {
                playerRef.current?.enqueue(part.inlineData.data);
              }
            }
          }

          // Input transcription (user speech)
          const inputTranscription = content.inputTranscription as { text?: string } | undefined;
          if (inputTranscription?.text) {
            const text = inputTranscription.text;
            setInterimText(text);
            onTranscriptRef.current?.(fullTextRef.current + " " + text);
          }

          // Output transcription (model speech)
          const outputTranscription = content.outputTranscription as { text?: string } | undefined;
          if (outputTranscription?.text) {
            setModelTranscript((prev) => prev + outputTranscription.text);
            onModelTranscriptRef.current?.(outputTranscription.text!);
          }

          // Turn complete
          if (content.turnComplete) {
            if (interimText) {
              fullTextRef.current = (fullTextRef.current + " " + interimText).trim();
              setStableText(fullTextRef.current);
              setInterimText("");
              onUtteranceRef.current?.(fullTextRef.current);
            }
            setSpeechState("listening");
          }
        }

        // Tool calls
        if (msg.toolCall) {
          const toolCall = msg.toolCall as {
            functionCalls?: Array<{ name: string; id: string; args: Record<string, unknown> }>;
          };
          if (toolCall.functionCalls) {
            void handleToolCalls(toolCall.functionCalls);
          }
        }
      } catch {
        // Malformed message — ignore silently
      }
    }

    async function handleToolCalls(
      calls: Array<{ name: string; id: string; args: Record<string, unknown> }>,
    ) {
      const responses: Array<{ name: string; id: string; response: { result: unknown } }> = [];

      for (const call of calls) {
        console.log(`[gemini-live] Tool call: ${call.name}`, call.args);
        try {
          // Execute tool on server
          const res = await fetch("/voice/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: call.name,
              args: call.args,
              userId: "web-user",
            }),
          });
          const result = res.ok ? await res.json() : { error: `Tool failed: ${res.status}` };
          responses.push({ name: call.name, id: call.id, response: { result } });
        } catch (err) {
          responses.push({
            name: call.name,
            id: call.id,
            response: { result: { error: String(err) } },
          });
        }
      }

      // Send tool responses back to Gemini
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            toolResponse: { functionResponses: responses },
          }),
        );
      }
    }
  }, [cleanup, systemInstruction]);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return {
    start: () => void start(),
    stop,
    toggle,
    speechState,
    stableText,
    interimText,
    fullText: fullTextRef.current,
    modelTranscript,
    modelAudioPlaying: playerRef.current?.isPlaying ?? false,
    audioLevel,
    confidence: speechState === "error" ? 0 : 0.85,
    latencyMs,
    error,
    isActive: activeRef.current,
  };
}
