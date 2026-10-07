import { action } from "../../_generated/server";
import { v } from "convex/values";

export const createRealtimeTranscriptionSession = action({
  args: {
    language: v.optional(v.string()),
  },
  returns: v.object({
    clientSecret: v.string(),
    expiresAt: v.optional(v.number()),
    sessionId: v.string(),
    model: v.string(),
  }),
  handler: async (_ctx, { language }) => {
    const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("No OpenAI API key configured for realtime transcription");
    }

    const baseUrl =
      process.env.OPENAI_BASE_URL ||
      process.env.CONVEX_OPENAI_BASE_URL ||
      "https://api.openai.com";

    const model = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
    const response = await fetch(`${baseUrl}/v1/realtime/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        modalities: ["text"],
        input_audio_format: "pcm16",
        input_audio_transcription: {
          model,
          language: language || "en",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 450,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Realtime transcription session error ${response.status}: ${errorText.slice(0, 240)}`);
    }

    const session = await response.json() as {
      id?: string;
      client_secret?: { value?: string; expires_at?: number };
    };

    const clientSecret = session.client_secret?.value;
    if (!session.id || !clientSecret) {
      throw new Error("Realtime transcription session response missing client secret");
    }

    return {
      clientSecret,
      expiresAt: session.client_secret?.expires_at,
      sessionId: session.id,
      model,
    };
  },
});

export const startRealtimeTranscriptionCall = action({
  args: {
    offerSdp: v.string(),
    language: v.optional(v.string()),
  },
  returns: v.object({
    answerSdp: v.string(),
    model: v.string(),
  }),
  handler: async (_ctx, { offerSdp, language }) => {
    const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("No OpenAI API key configured for realtime transcription");
    }

    const baseUrl =
      process.env.OPENAI_BASE_URL ||
      process.env.CONVEX_OPENAI_BASE_URL ||
      "https://api.openai.com";

    const model = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
    const sessionConfig = JSON.stringify({
      model,
      modalities: ["text"],
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model,
        language: language || "en",
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 450,
      },
    });

    const formData = new FormData();
    formData.set("sdp", offerSdp);
    formData.set("session", sessionConfig);

    const response = await fetch(`${baseUrl}/v1/realtime/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Realtime transcription call error ${response.status}: ${errorText.slice(0, 240)}`);
    }

    return {
      answerSdp: await response.text(),
      model,
    };
  },
});
