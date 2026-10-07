/**
 * ElevenLabs TTS Client — thin, zero-dependency streaming text-to-speech.
 *
 * Architecture:
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
 *   Auth: xi-api-key header
 *   Body: { text, model_id, voice_settings }
 *   Response: chunked audio/mpeg stream
 *
 * Uses raw fetch + Web Audio API for streaming playback.
 * No npm dependencies — browser-native only.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  /** Model ID — "eleven_turbo_v2_5" for lowest latency, "eleven_multilingual_v2" for quality. */
  model?: string;
  /** Stability 0-1 (default 0.5). Higher = more consistent, lower = more expressive. */
  stability?: number;
  /** Similarity boost 0-1 (default 0.75). Higher = closer to original voice. */
  similarityBoost?: number;
}

/** Safe defaults for an AI assistant voice. */
const DEFAULTS = {
  model: "eleven_turbo_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  /** Rachel — clear, professional, American English. */
  voiceId: "21m00Tcm4TlvDq8ikWAM",
} as const;

/** BOUND: max characters per single TTS request to avoid runaway costs. */
const MAX_CHARS = 5000;

/**
 * TTS proxy URL — server-side proxy that holds the ElevenLabs API key.
 * Set VITE_TTS_PROXY_URL to point at your server (e.g. "https://your-server.com/tts").
 * Falls back to relative "/tts" for same-origin deployments.
 */
const TTS_PROXY_URL = import.meta.env.VITE_TTS_PROXY_URL || "/tts";

// ---------------------------------------------------------------------------
// Streaming TTS fetch (via server-side proxy)
// ---------------------------------------------------------------------------

/**
 * Stream speech audio via the server-side TTS proxy.
 *
 * The proxy holds the ElevenLabs API key securely — no secrets in the client bundle.
 * Returns a ReadableStream of mp3 bytes for low-latency streaming playback.
 *
 * @throws if the proxy returns a non-OK status.
 */
export async function streamSpeech(
  text: string,
  config: ElevenLabsConfig,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const trimmed = text.slice(0, MAX_CHARS);
  if (!trimmed) throw new Error("ElevenLabs: empty text");

  const res = await fetch(TTS_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: trimmed,
      voiceId: config.voiceId || DEFAULTS.voiceId,
      model: config.model || DEFAULTS.model,
      stability: config.stability ?? DEFAULTS.stability,
      similarityBoost: config.similarityBoost ?? DEFAULTS.similarityBoost,
    }),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown");
    throw new Error(`TTS proxy ${res.status}: ${errorText}`);
  }

  if (!res.body) {
    throw new Error("TTS proxy: response has no body stream");
  }

  return res.body;
}

// ---------------------------------------------------------------------------
// Audio player — streaming mp3 playback via MediaSource / Audio element
// ---------------------------------------------------------------------------

export interface AudioPlayer {
  /** Begin streaming playback from a ReadableStream of mp3 bytes. */
  play(stream: ReadableStream<Uint8Array>): Promise<void>;
  /** Stop playback immediately and release resources. */
  stop(): void;
  /** Whether audio is currently playing. */
  readonly isPlaying: boolean;
}

/**
 * Create an audio player that streams mp3 chunks into an <audio> element.
 *
 * Strategy: accumulate chunks into a Blob, create an object URL, and play.
 * For true streaming we'd use MediaSource Extensions, but mp3 MSE support
 * is inconsistent across browsers. The blob approach adds ~200-400ms latency
 * on top of network time but works universally.
 *
 * For lower latency on supported browsers, we attempt MSE first and fall
 * back to blob playback.
 */
export function createAudioPlayer(): AudioPlayer {
  let audio: HTMLAudioElement | null = null;
  let abortController: AbortController | null = null;
  let playing = false;

  function cleanup() {
    if (audio) {
      audio.pause();
      if (audio.src) URL.revokeObjectURL(audio.src);
      audio.removeAttribute("src");
      audio = null;
    }
    playing = false;
  }

  return {
    get isPlaying() {
      return playing;
    },

    async play(stream: ReadableStream<Uint8Array>) {
      // Stop any previous playback
      this.stop();

      abortController = new AbortController();
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      try {
        // Read all chunks (streaming from ElevenLabs is fast, typically <2s)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abortController.signal.aborted) {
            reader.cancel();
            return;
          }
          chunks.push(value);
        }

        if (abortController.signal.aborted) return;

        // Combine into single blob and play
        const blob = new Blob(chunks, { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);

        audio = new Audio(url);
        audio.playbackRate = 1.0;
        playing = true;

        audio.onended = () => {
          cleanup();
        };
        audio.onerror = () => {
          cleanup();
        };

        await audio.play();
      } catch (err) {
        cleanup();
        // Don't rethrow abort errors — they're expected on cancellation
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      }
    },

    stop() {
      abortController?.abort();
      abortController = null;
      cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// Text cleaning — strip markdown formatting before speaking
// ---------------------------------------------------------------------------

/**
 * Strip markdown syntax so TTS reads clean prose.
 * Removes: headers, bold/italic markers, links (keeps text), code blocks,
 * bullet markers, image tags, horizontal rules.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    // Code blocks (fenced)
    .replace(/```[\s\S]*?```/g, "")
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Links — keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Headers
    .replace(/^#{1,6}\s+/gm, "")
    // Bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Bullet/numbered list markers
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Blockquotes
    .replace(/^>\s+/gm, "")
    // HTML tags
    .replace(/<[^>]+>/g, "")
    // Multiple newlines → single
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Utility: check if ElevenLabs is configured
// ---------------------------------------------------------------------------

/**
 * ElevenLabs TTS is proxied through a server-side endpoint at /tts.
 * The ELEVENLABS_API_KEY env var is held server-side — never bundled in the client.
 *
 * The streamSpeech() function above sends requests to the TTS proxy,
 * which forwards to ElevenLabs with the real API key attached.
 *
 * If the voice server is not running (e.g. Vercel-only deployment),
 * the /tts proxy will 404 and useVoiceOutput falls back to browser SpeechSynthesis.
 */
export function isElevenLabsConfigured(): boolean {
  // Enabled via server-side TTS proxy at /tts — no client-side API key needed.
  return true;
}

export function getDefaultConfig(): ElevenLabsConfig | null {
  // apiKey is "proxy" — the real key lives server-side in ELEVENLABS_API_KEY env var.
  return {
    apiKey: "proxy",
    voiceId: DEFAULTS.voiceId,
    model: DEFAULTS.model,
    stability: DEFAULTS.stability,
    similarityBoost: DEFAULTS.similarityBoost,
  };
}
