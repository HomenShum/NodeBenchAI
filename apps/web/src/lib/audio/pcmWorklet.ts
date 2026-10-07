/**
 * PCM Audio Worklet — Captures raw 16kHz mono PCM from microphone.
 *
 * Runs in the audio thread (AudioWorkletNode) for zero main-thread blocking.
 * Posts Float32Array chunks to the main thread for base64 encoding and
 * streaming to Gemini Live API.
 *
 * Usage:
 *   const ctx = new AudioContext({ sampleRate: 16000 });
 *   await ctx.audioWorklet.addModule(pcmWorkletUrl);
 *   const worklet = new AudioWorkletNode(ctx, "pcm-capture");
 *   worklet.port.onmessage = (e) => { // e.data is Float32Array chunk };
 */

// ── Worklet processor code (runs in AudioWorkletGlobalScope) ────────────

export const PCM_WORKLET_NAME = "pcm-capture";

/**
 * Inline worklet processor source.
 * We use a blob URL so no separate file is needed.
 */
export const PCM_WORKLET_SOURCE = /* js */ `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    // Send chunks every ~100ms at 16kHz = 1600 samples
    this._chunkSize = 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0]; // mono
    // Append to buffer
    const combined = new Float32Array(this._buffer.length + channel.length);
    combined.set(this._buffer);
    combined.set(channel, this._buffer.length);
    this._buffer = combined;

    // When we have enough samples, send a chunk
    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.slice(0, this._chunkSize);
      this._buffer = this._buffer.slice(this._chunkSize);
      this.port.postMessage({ type: "pcm", samples: chunk });
    }

    return true;
  }
}

registerProcessor("${PCM_WORKLET_NAME}", PcmCaptureProcessor);
`;

/** Create a blob URL for the worklet processor */
export function createPcmWorkletUrl(): string {
  const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

/**
 * Convert Float32Array PCM samples to base64-encoded Int16 PCM.
 * Gemini Live API expects `audio/pcm;rate=16000` as base64.
 */
export function float32ToBase64Pcm16(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Compute RMS audio level from Float32 samples (0-1 range).
 * Boosted 4x for UI visualization.
 */
export function computeAudioLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 4.2);
}
