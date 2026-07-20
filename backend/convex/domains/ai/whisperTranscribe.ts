import { action } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Server-side Whisper transcription action.
 * Receives base64-encoded audio, sends to OpenAI Whisper API, returns text.
 * Keeps API key server-side (never exposed to client).
 */
export const transcribe = action({
  args: {
    /** Base64-encoded audio data (webm/opus from MediaRecorder) */
    audioBase64: v.string(),
    /** MIME type of the audio. Default: audio/webm */
    mimeType: v.optional(v.string()),
    /** Language hint for Whisper. Default: en */
    language: v.optional(v.string()),
  },
  returns: v.object({
    text: v.string(),
    durationMs: v.number(),
  }),
  handler: async (_ctx, { audioBase64, mimeType, language }) => {
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("No OpenAI API key configured for Whisper transcription");
    }

    const baseUrl =
      process.env.OPENAI_BASE_URL ||
      process.env.CONVEX_OPENAI_BASE_URL ||
      "https://api.openai.com";

    const start = Date.now();

    // Decode base64 → binary
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const mime = mimeType || "audio/webm";
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : "wav";

    // Build multipart form data for Whisper API
    const blob = new Blob([bytes], { type: mime });
    const formData = new FormData();
    formData.append("file", blob, `recording.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "json");
    if (language) formData.append("language", language);

    const response = await fetch(
      `${baseUrl}/v1/audio/transcriptions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Whisper API error ${response.status}: ${errorText.slice(0, 200)}`
      );
    }

    const result = await response.json();
    const durationMs = Date.now() - start;

    return {
      text: (result as { text: string }).text || "",
      durationMs,
    };
  },
});
