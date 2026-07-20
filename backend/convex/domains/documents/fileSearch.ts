"use node";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { GoogleGenAI } from "@google/genai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Helper to get Gemini API key
function getGeminiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key not configured (set GEMINI_API_KEY or GOOGLE_AI_API_KEY)");
  }
  return apiKey;
}

async function ensureStoreForUser(ctx: any, userId: Id<"users">): Promise<string> {
  const existing = await ctx.runQuery(internal.domains.documents.fileSearchData.getFileSearchStoreForUser, { userId });
  if (existing?.storeName) return existing.storeName;

  const apiKey = getGeminiKey();
  const ai = new GoogleGenAI({ apiKey });

  const displayName = `nb-store-${String(userId).slice(0, 8)}`;
  const fileSearchStore = await ai.fileSearchStores.create({
    config: { displayName }
  });

  const storeName = fileSearchStore.name || displayName;

  await ctx.runMutation(internal.domains.documents.fileSearchData.createFileSearchStore, {
    userId,
    storeName,
  });

  return storeName;
}

async function uploadBufferToStore(args: {
  store: string;
  bytes: ArrayBuffer | Uint8Array;
  mimeType: string;
  displayName: string;
}) {
  const apiKey = getGeminiKey();
  const ai = new GoogleGenAI({ apiKey });

  const payload = args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
  const blob = new Blob([payload as any], { type: args.mimeType });

  // Upload directly to the file search store
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: blob as any,
    fileSearchStoreName: args.store,
    config: {
      displayName: args.displayName,
    }
  });

  // Wait for the operation to complete
  let op = operation;
  let attempts = 0;
  while (!op.done && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    op = await ai.operations.get({ operation: op });
    attempts++;
  }

  return op.done ? args.displayName : null;
}

async function uploadTextToStore(args: {
  store: string;
  text: string;
  displayName: string;
  mimeType?: string;
}) {
  const encoder = new TextEncoder();
  return uploadBufferToStore({
    store: args.store,
    bytes: encoder.encode(args.text),
    mimeType: args.mimeType || "text/plain",
    displayName: args.displayName,
  });
}

const extractPlain = (content: any): string => {
  if (!content) return "";
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return extractPlain(parsed);
    } catch {
      return content;
    }
  }
  if (Array.isArray(content)) {
    return content.map(extractPlain).join("\n\n");
  }
  if (typeof content === "object") {
    if (Array.isArray((content).blocks)) {
      return (content).blocks.map((b: any) => b?.data?.text || "").join("\n\n");
    }
    if (Array.isArray((content).content)) {
      return (content).content.map(extractPlain).join("\n");
    }
  }
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
};

export const upsertDocument = internalAction({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.union(
    v.object({ store: v.string(), fileName: v.optional(v.string()) }),
    v.null()
  ),
  handler: async (ctx, { documentId }) => {
    const data = await ctx.runQuery(internal.domains.documents.fileSearchData.getDocumentForUpsert, { documentId });
    if (!data || !data.doc) return null;

    const { doc, fileData } = data;
    const userId = doc.createdBy as Id<"users">;

    let storeName: string;
    try {
      storeName = await ensureStoreForUser(ctx, userId);
    } catch (err) {
      console.error("[fileSearch.upsertDocument] ensureStoreForUser failed", err);
      return null;
    }

    try {
      const displayName = doc.title || `Document ${documentId}`;

      if (fileData) {
        const bytes = await ctx.storage.get(fileData.storageId);
        if (bytes) {
          await uploadBufferToStore({
            store: storeName,
            bytes: await bytes.arrayBuffer(),
            mimeType: fileData.mimeType || "application/octet-stream",
            displayName,
          });
        }
      } else {
        const text = extractPlain((doc).content) || extractPlain((doc).summary);
        if (text?.trim()) {
          await uploadTextToStore({
            store: storeName,
            text,
            displayName,
          });
        }
      }

      await ctx.runMutation(internal.domains.documents.fileSearchData.updateDocumentIndexedAt, { documentId });
      return { store: storeName };
    } catch (err) {
      console.error("[fileSearch.upsertDocument] upload failed", err);
      return { store: storeName };
    }
  },
});

/**
 * Upload a file to Gemini File Search
 */
export const uploadFileToSearch = internalAction({
  args: {
    userId: v.id("users"),
    bytes: v.bytes(),
    mimeType: v.string(),
    displayName: v.string(),
  },
  returns: v.union(v.object({ store: v.string() }), v.null()),
  handler: async (ctx, args) => {
    try {
      const storeName = await ensureStoreForUser(ctx, args.userId);
      await uploadBufferToStore({
        store: storeName,
        bytes: args.bytes,
        mimeType: args.mimeType,
        displayName: args.displayName,
      });
      return { store: storeName };
    } catch (err) {
      console.error("[fileSearch.uploadFileToSearch] Upload failed", err);
      return null;
    }
  },
});

/**
 * Search user's files using Gemini File Search
 */
export const searchUserFiles = internalAction({
  args: {
    query: v.string(),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    results: v.array(v.object({
      fileName: v.string(),
      excerpt: v.string(),
      relevance: v.optional(v.number()),
    })),
    summary: v.string(),
  }),
  handler: async (ctx, args) => {
    const { query } = args;
    // Accept explicit userId (from agent tool context) or fall back to auth
    const userId = args.userId ?? (await getAuthUserId(ctx));
    if (!userId) {
      console.warn("[fileSearch.searchUserFiles] No userId from args or auth — returning empty");
      return {
        results: [],
        summary: "Not authenticated. Please sign in to search your files.",
      };
    }

    // Get the user's file search store
    const store = await ctx.runQuery(internal.domains.documents.fileSearchData.getFileSearchStoreForUser, { userId });

    if (!store) {
      return {
        results: [],
        summary: "No files have been uploaded yet. Upload some files first to search them.",
      };
    }

    try {
      const apiKey = getGeminiKey();
      const ai = new GoogleGenAI({ apiKey });

      // Use Gemini with file search
      const response = await ai.models.generateContent({
        model: getLlmModel("fileSearch", "gemini"),
        contents: query,
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [store.storeName]
              }
            }
          ]
        } as any
      });

      const text = response.text || "";

      // Extract citations if available
      const citations: Array<{ fileName: string; excerpt: string }> = [];

      // Check if there are grounding metadata/citations
      if ((response as any).candidates?.[0]?.groundingMetadata?.groundingChunks) {
        for (const chunk of (response as any).candidates[0].groundingMetadata.groundingChunks) {
          if (chunk.web) continue; // Skip web results
          citations.push({
            fileName: chunk.retrievedContext?.title || "Unknown file",
            excerpt: chunk.retrievedContext?.text || "",
          });
        }
      }

      return {
        results: citations,
        summary: text,
      };
    } catch (err) {
      console.error("[fileSearch.searchUserFiles] Search failed", err);
      return {
        results: [],
        summary: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
