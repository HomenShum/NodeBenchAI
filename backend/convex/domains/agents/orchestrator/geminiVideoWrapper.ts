"use node";

/**
 * Gemini Video API Wrapper for Tool Router
 * 
 * Enables video transcription and content analysis using Gemini 1.5/2.0
 * for Instagram video ingestion pipeline.
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { createHash } from "crypto";
import { getLlmModel } from "../../../../shared/llm/modelCatalog";

const STORE_TO_STORAGE_CHARS = 250_000;
const MAX_INLINE_RAW_CONTENT_CHARS = 120_000;
const MAX_ANALYSIS_TOPICS = 10;
const MAX_TOPIC_CHARS = 80;
const OPENROUTER_DEFAULT_TIMEOUT_MS = 30_000;

function sha256Hex(input: string): string {
    return createHash("sha256").update(input).digest("hex");
}

function truncateForDb(input: string): string {
    if (input.length <= MAX_INLINE_RAW_CONTENT_CHARS) return input;
    return input.slice(0, MAX_INLINE_RAW_CONTENT_CHARS) + `\n\n<!-- TRUNCATED: ${input.length} chars -->\n`;
}

function normalizeAnalysisTopics(topics: string[] | undefined): string[] {
    if (!topics || topics.length === 0) return [];

    const normalized = topics
        .map((topic) => (topic ?? "").trim())
        .filter(Boolean)
        .map((topic) => (topic.length > MAX_TOPIC_CHARS ? topic.slice(0, MAX_TOPIC_CHARS) : topic));

    const unique: string[] = [];
    for (const topic of normalized) {
        const key = topic.toLowerCase();
        if (unique.some((t) => t.toLowerCase() === key)) continue;
        unique.push(topic);
        if (unique.length >= MAX_ANALYSIS_TOPICS) break;
    }

    return unique;
}

function buildVideoTranscriptionPrompt(params: { analysisTopics: string[] }): string {
    const topicsLine = params.analysisTopics.length
        ? `\n\n### Focus Topics (optional)\n- ${params.analysisTopics.join("\n- ")}\n\nIf topics are provided, pay extra attention to anything relevant to them, but still produce a complete transcription.`
        : "";

    return `Analyze this video and provide:
1. A complete, accurate transcription of all spoken content (verbatim; preserve numbers, names, and product claims)
2. A brief description of key visual elements and actions
3. Timestamps for major segments (approximate seconds from start)${topicsLine}

Format your response as:
## Transcription
[Complete transcription of audio]

## Visual Summary
[Key visual elements and actions]

## Timestamps
- 0:00 - [description]
- [timestamp] - [description]`;
}

function buildImageAnalysisPrompt(params: { extractClaims: boolean; analysisTopics: string[] }): string {
    const topicsLine = params.analysisTopics.length
        ? `\n\nFocus Topics (optional):\n- ${params.analysisTopics.join("\n- ")}\nOnly include details that are relevant to these topics, plus any high-salience safety/medical/legal claims.`
        : "";

    if (!params.extractClaims) {
        return `Describe this image in detail. Include any text visible and the context/purpose of the image.${topicsLine}`;
    }

    return `Analyze this image. Provide:
1. A clear description of what's shown (concise)
2. Any text visible in the image (quote it verbatim)
3. Any factual claims being made (e.g., product claims, statistics, assertions)${topicsLine}

For claims, format as JSON at the end:
{"claims": [{"claim": "...", "confidence": 0.9, "category": "product"}]}`;
}

function getOpenRouterHeaders(): Record<string, string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

    const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
    if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
    if (process.env.OPENROUTER_X_TITLE) headers["X-Title"] = process.env.OPENROUTER_X_TITLE;
    return headers;
}

function shouldFallbackFromOpenRouterStatus(status: number): boolean {
    // Treat rate limits + transient upstream errors as "fallback to Gemini" rather than hard failure.
    return [401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(status);
}

async function analyzeImageWithOpenRouter(args: {
    modelId: string;
    prompt: string;
    mimeType: string;
    imageBase64: string;
    timeoutMs?: number;
}): Promise<string> {
    const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    const imageUrl = `data:${args.mimeType};base64,${args.imageBase64}`;

    const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: getOpenRouterHeaders(),
        body: JSON.stringify({
            model: args.modelId,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: args.prompt },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
            max_tokens: 1400,
            temperature: 0,
        }),
        signal: AbortSignal.timeout(args.timeoutMs ?? OPENROUTER_DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("OpenRouter returned empty content");
    }

    return content;
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface ExtractedClaim {
    claim: string;
    confidence: number;
    sourceTimestamp?: number;
    category?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Video Transcription
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transcribe video content using Gemini 1.5/2.0 multimodal capabilities.
 * Routable through toolRouter for health-aware execution.
 */
export const transcribeVideo = internalAction({
    args: {
        videoUrl: v.string(),
        mimeType: v.optional(v.string()),
        extractClaims: v.optional(v.boolean()),
        analysisTopics: v.optional(v.array(v.string())),
    },
    returns: v.object({
        success: v.boolean(),
        transcript: v.optional(v.string()),
        claims: v.optional(v.array(v.object({
            claim: v.string(),
            confidence: v.number(),
            sourceTimestamp: v.optional(v.number()),
            category: v.optional(v.string()),
        }))),
        error: v.optional(v.string()),
        durationSeconds: v.optional(v.number()),
    }),
    handler: async (ctx, args) => {
        console.log(`[geminiVideoWrapper] Transcribing video: ${args.videoUrl}`);

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
            return {
                success: false,
                error: "Gemini API key not configured (GEMINI_API_KEY or GOOGLE_AI_API_KEY)",
            };
        }

        try {
            const ai = new GoogleGenAI({ apiKey });
            const analysisTopics = normalizeAnalysisTopics(args.analysisTopics);

            // For remote URLs, we need to either:
            // 1. Download and upload to Gemini File API
            // 2. Use inline base64 (for small videos)
            // Currently implementing URL-based approach with file upload

            const mimeType = args.mimeType || detectMimeType(args.videoUrl);

            // Download video to buffer
            const videoResponse = await fetch(args.videoUrl);
            if (!videoResponse.ok) {
                return {
                    success: false,
                    error: `Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`,
                };
            }

            const videoBlob = await videoResponse.blob();
            const videoBuffer = Buffer.from(await videoBlob.arrayBuffer());
            const videoBase64 = videoBuffer.toString("base64");

            const transcriptionPrompt = buildVideoTranscriptionPrompt({ analysisTopics });

            // Use cheaper Flash when topics are provided; default to Pro for best transcription fidelity.
            const model = analysisTopics.length
                ? getLlmModel("vision", "gemini", "gemini-3-flash-preview")
                : getLlmModel("vision", "gemini", "gemini-3-pro-preview");

            const response = await ai.models.generateContent({
                model,
                contents: createUserContent([
                    { text: transcriptionPrompt },
                    {
                        inlineData: {
                            data: videoBase64,
                            mimeType,
                        },
                    },
                ]),
            });

            const transcriptText = response.text || "";

            // Persist transcript for citations / replayability (store large transcripts in Convex Storage)
            try {
                const contentHash = sha256Hex(transcriptText);
                let storageId: string | undefined;
                if (transcriptText.length >= STORE_TO_STORAGE_CHARS) {
                    const blob = new Blob([transcriptText], { type: "text/plain; charset=utf-8" });
                    storageId = await ctx.storage.store(blob);
                }

                const artifactResult = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
                    sourceType: "video_transcript",
                    sourceUrl: args.videoUrl,
                    contentHash,
                    rawContent: storageId ? truncateForDb(transcriptText) : transcriptText,
                    rawStorageId: storageId as any,
                    mimeType: "text/plain; charset=utf-8",
                    sizeBytes: transcriptText.length,
                    title: "Video transcript",
                    extractedData: {
                        tool: "geminiTranscribe",
                        model,
                        mimeType,
                        storageId,
                        contentLength: transcriptText.length,
                        analysisTopics,
                    },
                    fetchedAt: Date.now(),
                });

                await ctx.scheduler.runAfter(0, internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
                    artifactId: artifactResult.id,
                });
            } catch (err) {
                console.warn("[geminiVideoWrapper] Failed to persist transcript as sourceArtifact", err);
            }

            // Extract claims if requested
            let claims: ExtractedClaim[] | undefined;
            if (args.extractClaims && transcriptText) {
                claims = await extractClaimsFromTranscript(ai, transcriptText);
            }

            // Estimate duration from timestamps in response (rough estimate)
            const durationMatch = transcriptText.match(/(\d+):(\d+)/g);
            let durationSeconds: number | undefined;
            if (durationMatch && durationMatch.length > 0) {
                const lastTimestamp = durationMatch[durationMatch.length - 1];
                const [mins, secs] = lastTimestamp.split(":").map(Number);
                durationSeconds = mins * 60 + secs;
            }

            return {
                success: true,
                transcript: transcriptText,
                claims,
                durationSeconds,
            };
        } catch (error) {
            console.error("[geminiVideoWrapper] Error:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Claim Extraction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract factual claims from video transcript for verification.
 */
async function extractClaimsFromTranscript(
    ai: GoogleGenAI,
    transcript: string
): Promise<ExtractedClaim[]> {
    const claimPrompt = `Analyze this video transcript and extract all factual claims made.
For each claim, provide:
- The exact claim being made
- Your confidence in correctly understanding the claim (0.0 to 1.0)
- Approximate timestamp if mentioned (in seconds)
- Category: "financial", "product", "health", "political", "scientific", "opinion"

Respond in JSON format:
{
  "claims": [
    {
      "claim": "exact claim text",
      "confidence": 0.85,
      "sourceTimestamp": 45,
      "category": "financial"
    }
  ]
}

Only extract concrete, verifiable claims. Skip opinions, questions, or vague statements.

Transcript:
${transcript.substring(0, 10000)}`; // Limit transcript length

    try {
        // Use faster Flash model for extraction
        const response = await ai.models.generateContent({
            model: getLlmModel("analysis", "gemini", "gemini-3-flash-preview"),
            contents: createUserContent([{ text: claimPrompt }]),
        });

        const responseText = response.text || "";

        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*"claims"[\s\S]*\}/);
        if (!jsonMatch) {
            console.log("[geminiVideoWrapper] No JSON found in claim extraction response");
            return [];
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return (parsed.claims || []) as ExtractedClaim[];
    } catch (error) {
        console.error("[geminiVideoWrapper] Claim extraction error:", error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Image Analysis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze image content and extract claims.
 */
export const analyzeImage = internalAction({
    args: {
        imageUrl: v.string(),
        extractClaims: v.optional(v.boolean()),
        analysisTopics: v.optional(v.array(v.string())),
    },
    returns: v.object({
        success: v.boolean(),
        description: v.optional(v.string()),
        claims: v.optional(v.array(v.object({
            claim: v.string(),
            confidence: v.number(),
            category: v.optional(v.string()),
        }))),
        error: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        console.log(`[geminiVideoWrapper] Analyzing image: ${args.imageUrl}`);

        try {
            const analysisTopics = normalizeAnalysisTopics(args.analysisTopics);

            // Download image
            const imageResponse = await fetch(args.imageUrl);
            if (!imageResponse.ok) {
                return {
                    success: false,
                    error: `Failed to fetch image: ${imageResponse.status}`,
                };
            }

            const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
            const imageBlob = await imageResponse.blob();
            const imageBuffer = Buffer.from(await imageBlob.arrayBuffer());
            const imageBase64 = imageBuffer.toString("base64");

            const prompt = buildImageAnalysisPrompt({
                extractClaims: Boolean(args.extractClaims),
                analysisTopics,
            });

            // FREE-FIRST: try OpenRouter vision first (Molmo), fall back to Gemini if rate-limited/unavailable.
            let responseText = "";
            let provider: "openrouter" | "gemini" = "gemini";
            let modelUsed = "";

            const openRouterKey = process.env.OPENROUTER_API_KEY;
            if (openRouterKey && openRouterKey.trim().length > 0) {
                try {
                    provider = "openrouter";
                    modelUsed = "allenai/molmo-2-8b:free";
                    responseText = await analyzeImageWithOpenRouter({
                        modelId: modelUsed,
                        prompt,
                        mimeType,
                        imageBase64,
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const statusMatch = message.match(/OpenRouter error (\d+):/);
                    const status = statusMatch ? Number(statusMatch[1]) : null;

                    if (status !== null && shouldFallbackFromOpenRouterStatus(status)) {
                        console.warn(`[geminiVideoWrapper] OpenRouter vision failed (${status}), falling back to Gemini.`);
                    } else {
                        console.warn("[geminiVideoWrapper] OpenRouter vision failed, falling back to Gemini.", err);
                    }
                    responseText = "";
                    provider = "gemini";
                    modelUsed = "";
                }
            }

            if (!responseText) {
                const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
                if (!apiKey) {
                    return {
                        success: false,
                        error: "No vision provider configured (OPENROUTER_API_KEY or GEMINI_API_KEY/GOOGLE_AI_API_KEY)",
                    };
                }

                const ai = new GoogleGenAI({ apiKey });
                const model = getLlmModel("vision", "gemini", "gemini-3-flash-preview");
                provider = "gemini";
                modelUsed = model;

                const response = await ai.models.generateContent({
                    model,
                    contents: createUserContent([
                        { text: prompt },
                        { inlineData: { data: imageBase64, mimeType } },
                    ]),
                });

                responseText = response.text || "";
            }

            // Extract claims if present
            let claims: ExtractedClaim[] | undefined;
            if (args.extractClaims) {
                const jsonMatch = responseText.match(/\{[\s\S]*"claims"[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        claims = parsed.claims;
                    } catch (e) {
                        // No valid JSON found
                    }
                }
            }

            // Persist image analysis for citations / replayability
            try {
                const contentHash = sha256Hex(responseText);
                let storageId: string | undefined;
                if (responseText.length >= STORE_TO_STORAGE_CHARS) {
                    const blob = new Blob([responseText], { type: "text/plain; charset=utf-8" });
                    storageId = await ctx.storage.store(blob);
                }

                const artifactResult = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
                    sourceType: "api_response",
                    sourceUrl: args.imageUrl,
                    contentHash,
                    rawContent: storageId ? truncateForDb(responseText) : responseText,
                    rawStorageId: storageId as any,
                    mimeType: "text/plain; charset=utf-8",
                    sizeBytes: responseText.length,
                    title: "Image analysis",
                    extractedData: {
                        tool: provider === "openrouter" ? "openrouterAnalyzeImage" : "geminiAnalyzeImage",
                        provider,
                        model: modelUsed,
                        storageId,
                        contentLength: responseText.length,
                        analysisTopics,
                    },
                    fetchedAt: Date.now(),
                });

                await ctx.scheduler.runAfter(0, internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
                    artifactId: artifactResult.id,
                });
            } catch (err) {
                console.warn("[geminiVideoWrapper] Failed to persist image analysis as sourceArtifact", err);
            }

            return {
                success: true,
                description: responseText.replace(/\{[\s\S]*"claims"[\s\S]*\}/, "").trim(),
                claims,
            };
        } catch (error) {
            console.error("[geminiVideoWrapper] Error:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function detectMimeType(url: string): string {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes(".mp4")) return "video/mp4";
    if (lowerUrl.includes(".webm")) return "video/webm";
    if (lowerUrl.includes(".mov")) return "video/quicktime";
    if (lowerUrl.includes(".avi")) return "video/x-msvideo";
    if (lowerUrl.includes(".mkv")) return "video/x-matroska";
    return "video/mp4"; // Default
}
