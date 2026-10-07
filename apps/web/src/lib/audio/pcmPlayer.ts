/**
 * PCM Audio Player — Plays base64-encoded PCM audio from Gemini Live API.
 *
 * Decodes base64 PCM chunks into AudioBuffers and queues them for
 * gapless playback via AudioContext. Supports barge-in (stops playback
 * when user starts speaking).
 *
 * Gemini returns PCM at 24kHz mono (Int16).
 */

const OUTPUT_SAMPLE_RATE = 24000;

export interface PcmPlayer {
  /** Queue a base64-encoded PCM chunk for playback */
  enqueue(base64Pcm: string): void;
  /** Stop all playback immediately (barge-in) */
  stop(): void;
  /** Whether audio is currently playing */
  readonly isPlaying: boolean;
  /** Clean up AudioContext */
  destroy(): void;
}

export function createPcmPlayer(): PcmPlayer {
  let ctx: AudioContext | null = null;
  let nextStartTime = 0;
  let playing = false;
  const sources: AudioBufferSourceNode[] = [];

  function ensureContext(): AudioContext {
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  }

  function base64ToFloat32(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }
    return float32;
  }

  return {
    enqueue(base64Pcm: string) {
      const audioCtx = ensureContext();
      const samples = base64ToFloat32(base64Pcm);
      if (samples.length === 0) return;

      const buffer = audioCtx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      // Schedule gapless playback
      const now = audioCtx.currentTime;
      const startAt = Math.max(now, nextStartTime);
      source.start(startAt);
      nextStartTime = startAt + buffer.duration;

      playing = true;
      source.onended = () => {
        const idx = sources.indexOf(source);
        if (idx >= 0) sources.splice(idx, 1);
        if (sources.length === 0) playing = false;
      };
      sources.push(source);

      // BOUND: max 20 queued sources to prevent memory issues
      if (sources.length > 20) {
        const oldest = sources.shift();
        oldest?.stop();
        oldest?.disconnect();
      }
    },

    stop() {
      for (const source of sources) {
        try {
          source.stop();
          source.disconnect();
        } catch {
          // Already stopped
        }
      }
      sources.length = 0;
      nextStartTime = 0;
      playing = false;
    },

    get isPlaying() {
      return playing;
    },

    destroy() {
      this.stop();
      if (ctx && ctx.state !== "closed") {
        void ctx.close();
      }
      ctx = null;
    },
  };
}
