/**
 * Unified Ingestion Pipeline — Layer D evidence ingestion orchestrator
 *
 * Routes any source (URL, file upload, API response, video transcript)
 * through: fetch → extract → chunk → store → index.
 *
 * Calls existing CRUD layer:
 * - sourceArtifacts.upsertSourceArtifact (dedup + store)
 * - evidenceIndex.startArtifactIndexJob (job tracking)
 * - evidenceIndex.replaceArtifactChunks (atomic chunk insert)
 * - evidenceIndex.finishArtifactIndexJob (job completion)
 * - evidencePacks.createEvidencePack (optional pack creation)
 *
 * v2 plan sections: 4 (Evidence Layer), 20.2 (Enrichment)
 */

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5 MB text content cap
const MAX_CHUNKS_PER_ARTIFACT = 500;
const DEFAULT_CHUNK_SIZE = 1500; // characters
const CHUNK_OVERLAP = 200;
const FETCH_TIMEOUT_MS = 30_000;
const CHUNK_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceType = "url_fetch" | "api_response" | "file_upload" | "extracted_text" | "video_transcript";

interface ChunkResult {
  chunkKey: string;
  startOffset: number;
  endOffset: number;
  pageIndex?: number;
  text: string;
  chunkHash: string;
}

interface IngestionResult {
  artifactId: string;
  created: boolean;
  contentHash: string;
  chunkCount: number;
  indexJobId: string;
  sourceType: SourceType;
  title?: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers — Content extraction by mime type
// ---------------------------------------------------------------------------

function extractTitle(content: string, mimeType: string): string | undefined {
  if (mimeType.includes("html")) {
    const match = content.match(/<title[^>]*>(.*?)<\/title>/is);
    return match?.[1]?.trim()?.substring(0, 200);
  }
  // First non-empty line for text
  if (mimeType.includes("text") || mimeType.includes("markdown")) {
    const firstLine = content.split("\n").find((l) => l.trim().length > 0);
    return firstLine?.trim()?.substring(0, 200);
  }
  return undefined;
}

function detectMimeType(url: string, contentType?: string): string {
  if (contentType) return contentType.split(";")[0].trim();
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",
    md: "text/markdown",
    txt: "text/plain",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return mimeMap[ext] ?? "text/plain";
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractContent(rawContent: string, mimeType: string): { text: string; metadata: Record<string, unknown> } {
  if (mimeType.includes("html")) {
    return { text: stripHtmlToText(rawContent), metadata: { originalMime: mimeType } };
  }
  if (mimeType.includes("json")) {
    try {
      const parsed = JSON.parse(rawContent);
      const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
      return { text, metadata: { originalMime: mimeType, jsonKeys: Object.keys(parsed) } };
    } catch {
      return { text: rawContent, metadata: { originalMime: mimeType, jsonParseError: true } };
    }
  }
  // Plain text, markdown, CSV, XML — pass through
  return { text: rawContent, metadata: { originalMime: mimeType } };
}

// ---------------------------------------------------------------------------
// Helpers — Chunking
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): Promise<ChunkResult[]> {
  const chunks: ChunkResult[] = [];
  let offset = 0;
  let index = 0;

  while (offset < text.length && chunks.length < MAX_CHUNKS_PER_ARTIFACT) {
    const end = Math.min(offset + chunkSize, text.length);
    let chunkEnd = end;

    // Try to break at sentence boundary
    if (end < text.length) {
      const searchWindow = text.substring(Math.max(offset + chunkSize - 200, offset), end);
      const lastSentence = searchWindow.lastIndexOf(". ");
      if (lastSentence > 0) {
        chunkEnd = Math.max(offset + chunkSize - 200, offset) + lastSentence + 2;
      }
    }

    const chunkText = text.substring(offset, chunkEnd);
    if (chunkText.trim().length === 0) {
      offset = chunkEnd;
      continue;
    }

    const chunkHash = await sha256Hex(chunkText);
    chunks.push({
      chunkKey: `chunk-${index}`,
      startOffset: offset,
      endOffset: chunkEnd,
      text: chunkText,
      chunkHash,
    });

    index++;
    offset = Math.max(chunkEnd - overlap, offset + 1);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Main ingestion action — public entry point
// ---------------------------------------------------------------------------

export const ingestSource = action({
  args: {
    sourceType: v.union(
      v.literal("url_fetch"),
      v.literal("api_response"),
      v.literal("file_upload"),
      v.literal("extracted_text"),
      v.literal("video_transcript"),
    ),
    sourceUrl: v.optional(v.string()),
    rawContent: v.optional(v.string()),
    title: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    runId: v.optional(v.string()),
    createEvidencePack: v.optional(v.boolean()),
    packQuery: v.optional(v.string()),
    chunkSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<IngestionResult> => {
    const errors: string[] = [];
    const startMs = Date.now();

    // Step 1: Resolve content
    let rawContent = args.rawContent ?? "";
    let mimeType = args.mimeType ?? "text/plain";
    let title = args.title;

    if (args.sourceType === "url_fetch" && args.sourceUrl && !rawContent) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(args.sourceUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "NodeBench-Ingestion/1.0" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          errors.push(`Fetch failed: ${response.status} ${response.statusText}`);
        } else {
          const contentType = response.headers.get("content-type") ?? "";
          mimeType = detectMimeType(args.sourceUrl, contentType);

          // Bound read size
          const body = await response.text();
          rawContent = body.substring(0, MAX_CONTENT_BYTES);
          if (body.length > MAX_CONTENT_BYTES) {
            errors.push(`Content truncated from ${body.length} to ${MAX_CONTENT_BYTES} bytes`);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Fetch error: ${msg}`);
      }
    }

    if (!rawContent && errors.length === 0) {
      errors.push("No content provided and no URL to fetch");
      return {
        artifactId: "",
        created: false,
        contentHash: "",
        chunkCount: 0,
        indexJobId: "",
        sourceType: args.sourceType,
        title,
        errors,
      };
    }

    // Step 2: Extract content
    const { text, metadata } = extractContent(rawContent, mimeType);
    if (!title) {
      title = extractTitle(rawContent, mimeType);
    }

    // Step 3: Store artifact (dedup via hash)
    const artifactResult = await ctx.runMutation(
      internal.domains.documents.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: args.sourceType,
        sourceUrl: args.sourceUrl,
        rawContent: rawContent.substring(0, MAX_CONTENT_BYTES),
        mimeType,
        sizeBytes: new TextEncoder().encode(rawContent).length,
        title,
        extractedData: metadata,
        fetchedAt: Date.now(),
      },
    );

    // Step 4: Chunk and index
    const chunkSize = args.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunks = await chunkText(text, chunkSize, CHUNK_OVERLAP);

    // Start index job
    const indexJob = await ctx.runMutation(
      internal.domains.documents.artifacts.evidenceIndex.startArtifactIndexJob,
      {
        artifactId: artifactResult.id,
        contentHash: artifactResult.contentHash,
        chunkVersion: CHUNK_VERSION,
      },
    );

    if (indexJob.alreadySucceeded) {
      return {
        artifactId: artifactResult.id,
        created: artifactResult.created,
        contentHash: artifactResult.contentHash,
        chunkCount: chunks.length,
        indexJobId: indexJob.jobId,
        sourceType: args.sourceType,
        title,
        errors,
      };
    }

    // Replace chunks atomically
    try {
      const chunkResult = await ctx.runMutation(
        internal.domains.documents.artifacts.evidenceIndex.replaceArtifactChunks,
        {
          artifactId: artifactResult.id,
          sourceUrl: args.sourceUrl,
          fetchedAt: Date.now(),
          contentHash: artifactResult.contentHash,
          chunkVersion: CHUNK_VERSION,
          chunks,
        },
      );

      await ctx.runMutation(
        internal.domains.documents.artifacts.evidenceIndex.finishArtifactIndexJob,
        {
          jobId: indexJob.jobId,
          status: "succeeded",
          chunkCount: chunkResult.inserted,
          latencyMs: Date.now() - startMs,
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Indexing error: ${msg}`);
      await ctx.runMutation(
        internal.domains.documents.artifacts.evidenceIndex.finishArtifactIndexJob,
        {
          jobId: indexJob.jobId,
          status: "failed",
          error: msg,
          latencyMs: Date.now() - startMs,
        },
      );
    }

    // Step 5: Optionally create evidence pack
    if (args.createEvidencePack && chunks.length > 0) {
      try {
        // Get chunk IDs by querying back — they were just inserted
        // For now, we skip pack creation if we can't retrieve IDs
        // (evidencePacks.createEvidencePack needs chunkIds)
        errors.push("Evidence pack creation deferred — chunk IDs require separate query");
      } catch {
        errors.push("Evidence pack creation failed");
      }
    }

    return {
      artifactId: artifactResult.id,
      created: artifactResult.created,
      contentHash: artifactResult.contentHash,
      chunkCount: chunks.length,
      indexJobId: indexJob.jobId,
      sourceType: args.sourceType,
      title,
      errors,
    };
  },
});

// ---------------------------------------------------------------------------
// Batch ingestion — ingest multiple sources in sequence
// ---------------------------------------------------------------------------

export const ingestBatch = action({
  args: {
    sources: v.array(
      v.object({
        sourceType: v.union(
          v.literal("url_fetch"),
          v.literal("api_response"),
          v.literal("file_upload"),
          v.literal("extracted_text"),
          v.literal("video_transcript"),
        ),
        sourceUrl: v.optional(v.string()),
        rawContent: v.optional(v.string()),
        title: v.optional(v.string()),
        mimeType: v.optional(v.string()),
      }),
    ),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results: IngestionResult[] = [];
    const MAX_BATCH = 20; // Bound batch size

    const batch = args.sources.slice(0, MAX_BATCH);

    for (const source of batch) {
      try {
        const result = await ctx.runAction(
          internal.domains.documents.artifacts.ingestionPipeline.ingestSourceInternal,
          {
            ...source,
          },
        );
        results.push(result as IngestionResult);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          artifactId: "",
          created: false,
          contentHash: "",
          chunkCount: 0,
          indexJobId: "",
          sourceType: source.sourceType,
          title: source.title,
          errors: [`Batch item failed: ${msg}`],
        });
      }
    }

    return {
      total: batch.length,
      succeeded: results.filter((r) => r.errors.length === 0).length,
      failed: results.filter((r) => r.errors.length > 0).length,
      results,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal action for batch calls
// ---------------------------------------------------------------------------

export const ingestSourceInternal = internalAction({
  args: {
    sourceType: v.union(
      v.literal("url_fetch"),
      v.literal("api_response"),
      v.literal("file_upload"),
      v.literal("extracted_text"),
      v.literal("video_transcript"),
    ),
    sourceUrl: v.optional(v.string()),
    rawContent: v.optional(v.string()),
    title: v.optional(v.string()),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<IngestionResult> => {
    const errors: string[] = [];
    const startMs = Date.now();
    let rawContent = args.rawContent ?? "";
    let mimeType = args.mimeType ?? "text/plain";
    let title = args.title;

    if (args.sourceType === "url_fetch" && args.sourceUrl && !rawContent) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(args.sourceUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "NodeBench-Ingestion/1.0" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          errors.push(`Fetch failed: ${response.status} ${response.statusText}`);
        } else {
          const contentType = response.headers.get("content-type") ?? "";
          mimeType = detectMimeType(args.sourceUrl, contentType);
          const body = await response.text();
          rawContent = body.substring(0, MAX_CONTENT_BYTES);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Fetch error: ${msg}`);
      }
    }

    if (!rawContent) {
      return {
        artifactId: "",
        created: false,
        contentHash: "",
        chunkCount: 0,
        indexJobId: "",
        sourceType: args.sourceType,
        title,
        errors: errors.length > 0 ? errors : ["No content"],
      };
    }

    const { text, metadata } = extractContent(rawContent, mimeType);
    if (!title) title = extractTitle(rawContent, mimeType);

    const artifactResult = await ctx.runMutation(
      internal.domains.documents.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: args.sourceType,
        sourceUrl: args.sourceUrl,
        rawContent: rawContent.substring(0, MAX_CONTENT_BYTES),
        mimeType,
        sizeBytes: new TextEncoder().encode(rawContent).length,
        title,
        extractedData: metadata,
        fetchedAt: Date.now(),
      },
    );

    const chunks = await chunkText(text, DEFAULT_CHUNK_SIZE, CHUNK_OVERLAP);

    const indexJob = await ctx.runMutation(
      internal.domains.documents.artifacts.evidenceIndex.startArtifactIndexJob,
      {
        artifactId: artifactResult.id,
        contentHash: artifactResult.contentHash,
        chunkVersion: CHUNK_VERSION,
      },
    );

    if (!indexJob.alreadySucceeded) {
      try {
        await ctx.runMutation(
          internal.domains.documents.artifacts.evidenceIndex.replaceArtifactChunks,
          {
            artifactId: artifactResult.id,
            sourceUrl: args.sourceUrl,
            fetchedAt: Date.now(),
            contentHash: artifactResult.contentHash,
            chunkVersion: CHUNK_VERSION,
            chunks,
          },
        );
        await ctx.runMutation(
          internal.domains.documents.artifacts.evidenceIndex.finishArtifactIndexJob,
          {
            jobId: indexJob.jobId,
            status: "succeeded",
            chunkCount: chunks.length,
            latencyMs: Date.now() - startMs,
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Indexing error: ${msg}`);
        await ctx.runMutation(
          internal.domains.documents.artifacts.evidenceIndex.finishArtifactIndexJob,
          {
            jobId: indexJob.jobId,
            status: "failed",
            error: msg,
          },
        );
      }
    }

    return {
      artifactId: artifactResult.id,
      created: artifactResult.created,
      contentHash: artifactResult.contentHash,
      chunkCount: chunks.length,
      indexJobId: indexJob.jobId,
      sourceType: args.sourceType,
      title,
      errors,
    };
  },
});
