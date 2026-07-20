"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "../../_generated/dataModel";
import OpenAI from "openai";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  Type,
} from "@google/genai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// --- Embedding helper ---
async function embedTexts(openai: OpenAI, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const primaryModel = process.env.OPENAI_EMBEDDING_MODEL
    || process.env.CONVEX_OPENAI_EMBEDDING_MODEL
    || "text-embedding-3-small";
  try {
    const resp = await openai.embeddings.create({
      model: primaryModel,
      input: texts,
    });
    // Ensure order alignment
    return resp.data.map((d) => d.embedding as unknown as number[]);
  } catch (err: any) {
    // If the model/route is not found, try a common fallback model once.
    if (err?.status === 404) {
      const fallback = primaryModel === "text-embedding-3-small"
        ? "text-embedding-3-large"
        : primaryModel;
      if (fallback !== primaryModel) {
        const resp = await openai.embeddings.create({ model: fallback, input: texts });
        return resp.data.map((d) => d.embedding as unknown as number[]);
      }
    }
    throw err;
  }
}

// Normalize OpenAI base URL so it includes '/v1' when needed
function normalizeOpenAIBase(base?: string | null): string | undefined {
  if (!base) return undefined;
  const trimmed = base.trim().replace(/\/$/, "");
  if (!trimmed) return undefined;
  // Azure OpenAI uses /openai/deployments/{deployment} paths and api-version query param; no /v1
  if (trimmed.includes("openai.azure.com") || trimmed.includes("/openai/deployments/")) {
    return trimmed;
  }
  // If already ends with /v{n}, keep it
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  // Append /v1 for OpenAI-compatible endpoints
  return trimmed + "/v1";
}

// Use only env-provided Gemini key on the server (E2E keys remain client-only)
export async function getGeminiKey(_ctx: any): Promise<string | null> {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- Extract + Index Chunks ---
export const extractAndIndexFile = action({
  args: {
    fileId: v.id("files"),
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    inserted: v.number(),
    usedCache: v.boolean(),
    summary: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }),
  handler: async (ctx, { fileId, force }): Promise<{
    inserted: number;
    usedCache: boolean;
    summary?: string;
    metadata?: any;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    const fileDoc: Doc<"files"> | null = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId });
    if (!fileDoc) throw new Error("File not found");
    if (fileDoc.userId !== userId) throw new Error("Forbidden");

    const now = Date.now();
    if (!force && fileDoc.cacheExpiresAt && fileDoc.cacheExpiresAt > now) {
      // Cache still valid; skip extraction
      return { inserted: 0, usedCache: true, summary: fileDoc.contentSummary, metadata: fileDoc.metadata };
    }

    const geminiKey = await getGeminiKey(ctx);
    if (!geminiKey) throw new Error("Gemini API key not configured");
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const openaiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    const openaiBase = normalizeOpenAIBase(
      process.env.OPENAI_EMBEDDINGS_BASE_URL
      || process.env.CONVEX_OPENAI_EMBEDDINGS_BASE_URL
      || process.env.OPENAI_BASE_URL
      || process.env.CONVEX_OPENAI_BASE_URL
    );
    let openai: OpenAI | null = null;
    if (openaiKey) {
      openai = new OpenAI({ apiKey: openaiKey, baseURL: openaiBase });
    } else {
      console.warn("[extractAndIndexFile] OpenAI API key not configured; proceeding without embeddings");
    }

    // Get storage URL
    const url = await ctx.storage.getUrl(fileDoc.storageId);
    if (!url) throw new Error("Storage URL unavailable");

    // Fetch blob
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch file blob: ${res.statusText}`);
    const blob = await res.blob();
    const contentType = fileDoc.mimeType || blob.type || "application/octet-stream";

    // Upload to Gemini for content extraction if needed (non-text types)
    let partRef: ReturnType<typeof createPartFromUri> | undefined;
    let uploadedName: string | undefined;

    const needsUpload = contentType.startsWith("video/") || contentType.startsWith("audio/") || contentType === "application/pdf";
    if (needsUpload) {
      const upload = await ai.files.upload({
        file: blob,
        config: { mimeType: contentType, displayName: fileDoc.fileName },
      });

      // Wait until ACTIVE
      const uploadName = upload.name as string;
      let fileInfo = await ai.files.get({ name: uploadName });
      let attempts = 0;
      while (String(fileInfo.state) === "PROCESSING" && attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        fileInfo = await ai.files.get({ name: uploadName });
        attempts++;
      }
      if (String(fileInfo.state) !== "ACTIVE" || !fileInfo.uri || !fileInfo.mimeType) {
        throw new Error("Gemini file processing failed");
      }
      partRef = createPartFromUri(fileInfo.uri, fileInfo.mimeType);
      uploadedName = uploadName;
    }

    // Ask Gemini to extract summarized metadata + text chunks (JSON)
    const contents = createUserContent([
      needsUpload && partRef
        ? partRef
        : {
            inlineData: {
              data: Buffer.from(await blob.arrayBuffer()).toString("base64"),
              mimeType: contentType,
            },
          },
      {
        text: `Extract structured JSON with keys: metadata (object), summary (string), chunks (array of objects with text and optional meta). \n- chunks: split the content into coherent ~500-1500 char pieces without breaking sentences. \n- meta can include {page, startTimeSec, endTimeSec} when applicable. \n- Strict JSON only.`,
      },
    ]);

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        metadata: {
          type: Type.OBJECT,
          properties: {
            pageCount: { type: Type.NUMBER },
            durationSec: { type: Type.NUMBER },
            title: { type: Type.STRING },
            language: { type: Type.STRING },
          },
        },
        summary: { type: Type.STRING },
        chunks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              meta: {
                type: Type.OBJECT,
                properties: {
                  page: { type: Type.NUMBER },
                  startTimeSec: { type: Type.NUMBER },
                  endTimeSec: { type: Type.NUMBER },
                },
              },
            },
            required: ["text"],
          },
        },
      },
      required: ["chunks"],
    } as const;

    let response;
    try {
      response = await ai.models.generateContent({
        model: getLlmModel("analysis", "gemini", "gemini-3.1-flash-lite-preview"),
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("response_schema") || msg.includes("INVALID_ARGUMENT")) {
        console.warn(
          "[extractAndIndexFile] Structured schema rejected by Gemini; retrying without responseSchema",
          e,
        );
        response = await ai.models.generateContent({
          model: getLlmModel("analysis", "gemini", "gemini-3.1-flash-lite-preview"),
          contents,
          config: {
            responseMimeType: "application/json",
          },
        });
      } else {
        throw e;
      }
    }

    // Increment usage on successful Gemini call
    try {
      await ctx.runMutation(internal.domains.auth.usage.incrementDailyUsage, { provider: "gemini" });
    } catch (e) {
      console.warn("[usage] incrementDailyUsage failed (gemini)", e);
    }

    // Parse JSON
    let json: { metadata?: any; summary?: string; chunks: Array<{ text: string; meta?: any }>; };
    try {
      const raw = response.text;
      json = JSON.parse(raw ?? "{}");
    } catch {
      throw new Error("Failed to parse Gemini extraction JSON");
    }

    const chunkTexts = json.chunks.map((c) => c.text).filter((t) => t && t.trim().length > 0);
    let embeddings: number[][] = [];
    if (openai) {
      try {
        embeddings = await embedTexts(openai, chunkTexts);
      } catch (err) {
        console.warn("[extractAndIndexFile] Embedding failed; proceeding without embeddings", err);
        embeddings = chunkTexts.map(() => []);
      }
    } else {
      embeddings = chunkTexts.map(() => []);
    }

    // Clear and save new chunks
    await ctx.runMutation(internal.domains.documents.chunks.clearFileChunks, { fileId });
    const toInsert = json.chunks.map((c, i) => ({ text: c.text, meta: c.meta, embedding: embeddings[i] || [] }));
    const inserted: number = await ctx.runMutation(internal.domains.documents.chunks.saveFileChunks, { fileId, chunks: toInsert });

    // Update file cache fields (omit undefined values)
    const patchData: {
      genaiFileName?: string;
      cacheName?: string;
      cacheExpiresAt?: number;
      metadata?: any;
      contentSummary?: string;
      textPreview?: string;
      analyzedAt?: number;
    } = {
      cacheName: `file-${fileId}`,
      cacheExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour TTL
      textPreview: chunkTexts.slice(0, 2).join("\n\n"),
      analyzedAt: Date.now(),
    };
    if (uploadedName) patchData.genaiFileName = uploadedName;
    if (json.metadata !== undefined) patchData.metadata = json.metadata;
    if (json.summary !== undefined) patchData.contentSummary = json.summary;
    await ctx.runMutation(internal.domains.documents.chunks.updateFileCache, { fileId, patch: patchData });

    // Auto-index into RAG vector store so page-indexed search works immediately
    try {
      const doc = await ctx.runQuery(
        internal.domains.documents.documents.getDocumentByFileId,
        { fileId },
      );
      if (doc) {
        await ctx.runAction(internal.domains.search.rag.addDocumentToRag, {
          documentId: doc._id,
        });
        console.log(`[extractAndIndexFile] RAG indexed document ${doc._id} for file ${fileId}`);
      }
    } catch (ragErr) {
      console.warn("[extractAndIndexFile] RAG indexing failed (non-fatal):", ragErr);
    }

    // Cleanup uploaded temp file reference best-effort
    if (uploadedName) {
      try {
        await ai.files.delete({ name: uploadedName });
      } catch (err) {
        console.warn("Failed to delete temporary Gemini file:", err);
      }
    }

    return { inserted, usedCache: false, summary: json.summary, metadata: json.metadata };
  },
});

// --- Rank chunks for selected files ---
export const rankChunksForFiles = action({
  args: {
    fileIds: v.array(v.id("files")),
    query: v.string(),
    topK: v.optional(v.number()),
  },
  returns: v.object({
    results: v.array(
      v.object({
        chunkId: v.id("chunks"),
        fileId: v.id("files"),
        score: v.number(),
        text: v.string(),
        meta: v.optional(v.any()),
      })
    ),
  }),
  handler: async (ctx, { fileIds, query, topK }): Promise<{
    results: Array<{
      chunkId: Id<"chunks">;
      fileId: Id<"files">;
      score: number;
      text: string;
      meta?: any;
    }>;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Ownership check (basic): ensure files belong to user
    for (const fid of fileIds) {
      const f = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId: fid });
      if (!f) throw new Error("File not found");
      if (f.userId !== userId) throw new Error("Forbidden");
    }

    const openaiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
    const openaiBase = normalizeOpenAIBase(
      process.env.OPENAI_EMBEDDINGS_BASE_URL
      || process.env.CONVEX_OPENAI_EMBEDDINGS_BASE_URL
      || process.env.OPENAI_BASE_URL
      || process.env.CONVEX_OPENAI_BASE_URL
    );
    let openai: OpenAI | null = null;
    if (openaiKey) {
      openai = new OpenAI({ apiKey: openaiKey, baseURL: openaiBase });
    } else {
      console.warn("[rankChunksForFiles] OpenAI API key not configured; ranking will proceed without embeddings");
    }

    let qEmbedding: number[] = [];
    if (openai) {
      try {
        qEmbedding = (await embedTexts(openai, [query]))[0] ?? [];
      } catch (err) {
        console.warn("[rankChunksForFiles] Embedding failed; proceeding with zero vectors", err);
        qEmbedding = [];
      }
    }

    const chunks: Array<{ _id: Id<"chunks">; fileId: Id<"files">; text: string; meta?: any; embedding: number[] }>
      = await ctx.runQuery(internal.domains.documents.chunks.listChunksByFiles, { fileIds, limitPerFile: undefined });
    const scored: Array<{ chunkId: Id<"chunks">; fileId: Id<"files">; text: string; meta?: any; score: number }>
      = chunks.map((c) => ({
        chunkId: c._id,
        fileId: c.fileId,
        text: c.text,
        meta: c.meta,
        score: cosineSim(qEmbedding, c.embedding),
      }));

    scored.sort((a, b) => b.score - a.score);
    const k = Math.max(1, Math.min(topK ?? 8, scored.length));
    return { results: scored.slice(0, k) };
  },
});

// --- Answer using cache summaries (fast path) ---
export const answerFromCache = action({
  args: {
    fileIds: v.array(v.id("files")),
    question: v.string(),
  },
  returns: v.object({
    answer: v.string(),
    used: v.array(v.id("files")),
  }),
  handler: async (ctx, { fileIds, question }): Promise<{ answer: string; used: Array<Id<"files">> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const files: Doc<"files">[] = [];
    for (const fid of fileIds) {
      const f = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId: fid });
      if (!f) continue;
      if (f.userId !== userId) continue;
      files.push(f);
    }

    const geminiKey = await getGeminiKey(ctx);
    if (!geminiKey) throw new Error("Gemini API key not configured");
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const contextText = files
      .map((f) => `# ${f.fileName}\n${f.contentSummary ?? f.analysis ?? f.textPreview ?? ""}`)
      .join("\n\n---\n\n");

    const rsp = await ai.models.generateContent({
      model: getLlmModel("analysis", "gemini"),
      contents: createUserContent([
        { text: `You are answering questions using ONLY the provided cached summaries. If information isn't present, say you don't have enough info.` },
        { text: `Context:\n${contextText}` },
        { text: `Question: ${question}` },
      ]),
    });

    // Increment usage on successful Gemini call
    try {
      await ctx.runMutation(internal.domains.auth.usage.incrementDailyUsage, { provider: "gemini" });
    } catch (e) {
      console.warn("[usage] incrementDailyUsage failed (gemini)", e);
    }

    const answer = rsp.text ?? "";
    return { answer, used: files.map((f) => f._id) };
  },
});

// --- Ensure file cache (runs extraction if expired) ---
export const ensureFileCache = action({
  args: { fileId: v.id("files") },
  returns: v.object({ refreshed: v.boolean() }),
  handler: async (ctx, { fileId }): Promise<{ refreshed: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const f = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId });
    if (!f) throw new Error("File not found");
    if (f.userId !== userId) throw new Error("Forbidden");
    if (f.cacheExpiresAt && f.cacheExpiresAt > Date.now()) return { refreshed: false };
    try {
      const _result: { inserted: number; usedCache: boolean; summary?: string; metadata?: any } =
        await ctx.runAction(api.domains.ai.genai.extractAndIndexFile, { fileId, force: true });
      return { refreshed: true };
    } catch (e) {
      console.warn("[ensureFileCache] failed to refresh cache (continuing)", e);
      return { refreshed: false };
    }
  },
});

// --- QA Smoke: PDF page metadata present in chunk meta ---
export const smokePdfPages = action({
  args: { fileId: v.id("files") },
  returns: v.object({
    fileId: v.id("files"),
    chunkCount: v.number(),
    hasPageMeta: v.boolean(),
    samplePages: v.array(v.number()),
  }),
  handler: async (ctx, { fileId }): Promise<{
    fileId: Id<"files">; chunkCount: number; hasPageMeta: boolean; samplePages: number[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const f = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId });
    if (!f) throw new Error("File not found");
    if (f.userId !== userId) throw new Error("Forbidden");

    // Ensure cache is fresh (will analyze if needed)
    try {
      await ctx.runAction(api.domains.ai.genai.ensureFileCache, { fileId });
    } catch (e) {
      console.warn("[smokePdfPages] ensureFileCache failed (continuing)", e);
    }

    const chunks = await ctx.runQuery(internal.domains.documents.chunks.listChunksByFile, { fileId });
    const pages: number[] = chunks
      .map((c: any) => (c.meta && typeof c.meta.page === "number") ? (c.meta.page as number) : undefined)
      .filter((p: unknown): p is number => typeof p === "number");
    const uniq = Array.from(new Set(pages));
    return {
      fileId,
      chunkCount: chunks.length,
      hasPageMeta: uniq.length > 0,
      samplePages: uniq.slice(0, 5),
    };
  },
});

// --- QA Smoke: Audio/Video timestamp metadata present in chunk meta ---
export const smokeAvTimestamps = action({
  args: { fileId: v.id("files") },
  returns: v.object({
    fileId: v.id("files"),
    chunkCount: v.number(),
    hasTimestamps: v.boolean(),
    sample: v.array(
      v.object({ start: v.optional(v.number()), end: v.optional(v.number()) })
    ),
  }),
  handler: async (ctx, { fileId }): Promise<{
    fileId: Id<"files">;
    chunkCount: number;
    hasTimestamps: boolean;
    sample: Array<{ start?: number; end?: number }>;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const f = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId });
    if (!f) throw new Error("File not found");
    if (f.userId !== userId) throw new Error("Forbidden");

    // Ensure cache is fresh (will analyze if needed)
    try {
      await ctx.runAction(api.domains.ai.genai.ensureFileCache, { fileId });
    } catch (e) {
      console.warn("[smokeAvTimestamps] ensureFileCache failed (continuing)", e);
    }

    const chunks = await ctx.runQuery(internal.domains.documents.chunks.listChunksByFile, { fileId });
    const ts = chunks
      .map((c: any) => ({
        start: c.meta && typeof c.meta.startTimeSec === "number" ? (c.meta.startTimeSec as number) : undefined,
        end: c.meta && typeof c.meta.endTimeSec === "number" ? (c.meta.endTimeSec as number) : undefined,
      }))
      .filter((m: { start?: number; end?: number }) => m.start !== undefined || m.end !== undefined);

    return {
      fileId,
      chunkCount: chunks.length,
      hasTimestamps: ts.length > 0,
      sample: ts.slice(0, 5),
    };
  },
});
 
// --- QA Smoke: End-to-end CSV ingest + ranking + cache Q&A ---
export const smokeE2E = action({
  args: {},
  returns: v.object({
    fileId: v.id("files"),
    inserted: v.number(),
    usedCache: v.boolean(),
    chunks: v.number(),
    topText: v.optional(v.string()),
    cacheAnswer: v.optional(v.string()),
    filesBasicCount: v.number(),
  }),
  handler: async (ctx, _args): Promise<{
    fileId: Id<"files">;
    inserted: number;
    usedCache: boolean;
    chunks: number;
    topText?: string;
    cacheAnswer?: string;
    filesBasicCount: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Create a small CSV fixture and store it.
    const csv = "name,age\nAlice,30\nBob,25\nCharlie,22\n";
    const bytes = new TextEncoder().encode(csv);
    const blob = new Blob([bytes], { type: "text/csv" });
    const storageId = await ctx.storage.store(blob);

    // Create a file record.
    const fileId: Id<"files"> = await ctx.runMutation(api.domains.documents.files.createFile, {
      storageId,
      fileName: "smoke-e2e.csv",
      fileType: "document",
      mimeType: "text/csv",
      fileSize: bytes.length,
    });

    // Extract + index content.
    const analyzeRes: { inserted: number; usedCache: boolean; summary?: string; metadata?: any } =
      await ctx.runAction(api.domains.ai.genai.extractAndIndexFile, { fileId, force: true });

    // Verify chunks saved.
    const chunkRows = await ctx.runQuery(internal.domains.documents.chunks.listChunksByFile, { fileId });

    // Rank chunks as a quick semantic check.
    let topText: string | undefined = undefined;
    try {
      const rank = await ctx.runAction(api.domains.ai.genai.rankChunksForFiles, {
        fileIds: [fileId],
        query: "Alice",
        topK: 1,
      });
      topText = rank.results[0]?.text;
    } catch {
      // ignore ranking errors in smoke
    }

    // Quick cache-based answer.
    let cacheAnswer: string | undefined = undefined;
    try {
      const cache = await ctx.runAction(api.domains.ai.genai.answerFromCache, {
        fileIds: [fileId],
        question: "List all names in the CSV.",
      });
      cacheAnswer = cache.answer;
    } catch {
      // ignore cache errors if provider not configured
    }

    // Public enriched metadata check.
    const filesBasic = await ctx.runQuery(api.domains.documents.chunks.getFilesBasicPublic, { fileIds: [fileId] });

    return {
      fileId,
      inserted: analyzeRes.inserted,
      usedCache: analyzeRes.usedCache,
      chunks: chunkRows.length,
      topText,
      cacheAnswer,
      filesBasicCount: filesBasic.length,
    };
  },
});
