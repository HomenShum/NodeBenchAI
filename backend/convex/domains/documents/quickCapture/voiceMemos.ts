import { v } from "convex/values";
import { internalAction, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import OpenAI from "openai";

/**
 * Transcribe a voice memo using OpenAI Whisper
 */
export const transcribeVoiceMemo = internalAction({
  args: { captureId: v.id("quickCaptures") },
  handler: async (ctx, { captureId }) => {
    // Get the capture
    const capture = await ctx.runQuery(internal.domains.quickCapture.voiceMemos.getCaptureInternal, { captureId });
    if (!capture || !capture.audioUrl) {
      throw new Error("Capture not found or no audio URL");
    }

    // Download audio from storage
    const response = await fetch(capture.audioUrl);
    if (!response.ok) {
      throw new Error("Failed to download audio");
    }
    const audioBuffer = await response.arrayBuffer();

    // Create a File object for OpenAI
    const audioFile = new File([audioBuffer], "audio.webm", { type: "audio/webm" });

    // Transcribe with Whisper
    const openai = new OpenAI();
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "en",
    });

    // Generate title with GPT
    const titleResponse = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        {
          role: "system",
          content: "Generate a concise title (5 words max) for this voice memo. Return only the title, no quotes or punctuation.",
        },
        {
          role: "user",
          content: transcription.text,
        },
      ],
    });

    const title = titleResponse.choices[0]?.message?.content?.trim() ?? "Voice Memo";

    // Update capture with transcription and title
    await ctx.runMutation(internal.domains.quickCapture.voiceMemos.updateCaptureTranscription, {
      captureId,
      transcription: transcription.text,
      title,
    });

    return { transcription: transcription.text, title };
  },
});

/**
 * Internal query to get capture (for use in actions)
 */
export const getCaptureInternal = internalMutation({
  args: { captureId: v.id("quickCaptures") },
  handler: async (ctx, { captureId }) => {
    return await ctx.db.get(captureId);
  },
});

/**
 * Internal mutation to update capture with transcription
 */
export const updateCaptureTranscription = internalMutation({
  args: {
    captureId: v.id("quickCaptures"),
    transcription: v.string(),
    title: v.string(),
  },
  handler: async (ctx, { captureId, transcription, title }) => {
    await ctx.db.patch(captureId, {
      transcription,
      title,
      content: transcription, // Also update content with transcription
      processed: true,
      updatedAt: Date.now(),
    });
  },
});

