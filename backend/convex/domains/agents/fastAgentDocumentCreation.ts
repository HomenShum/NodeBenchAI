/**
 * Unified document generation and creation action
 * Single server-side entry point for all agent-driven document creation
 *
 * Features:
 * - Idempotent: prevents duplicate documents via creationKey
 * - Standardized: all documents stored as TipTap JSON
 * - Auditable: emits tool-result messages for timeline visibility
 * - Indexed: triggers RAG indexing and snapshots automatically
 */

import { action, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal, components } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";
import {
  markdownToTipTap,
  extractTextFromTipTap,
  validateTipTapDocument,
  convertMediaAssetsToTipTap,
  type MediaAsset,
  type TipTapNode
} from "../../lib/markdownToTipTap";
import { extractMediaFromMessages } from "../../lib/dossierHelpers";
import { assertFastAgentDocumentThreadOwner } from "./fastAgentDocumentCreationOwnership";

/**
 * Constants for validation
 */
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TITLE_LENGTH = 500;
const MAX_SECTIONS = 1000;
const MIN_CONTENT_LENGTH = 10; // Minimum content length to prevent empty documents
const MAX_PROMPT_LENGTH = 5000; // Maximum prompt length

/**
 * Validation errors
 */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate prompt input
 */
function validatePrompt(prompt: string): void {
  if (!prompt || typeof prompt !== "string") {
    throw new ValidationError("Prompt must be a non-empty string");
  }
  if (prompt.trim().length === 0) {
    throw new ValidationError("Prompt cannot be empty or whitespace-only");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError(`Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}`);
  }
}

/**
 * Validate title
 */
function validateTitle(title: string): void {
  if (!title || typeof title !== "string") {
    throw new ValidationError("Title must be a non-empty string");
  }
  if (title.trim().length === 0) {
    throw new ValidationError("Title cannot be empty or whitespace-only");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`Title exceeds maximum length of ${MAX_TITLE_LENGTH}`);
  }
}

/**
 * Validate content
 */
function validateContent(content: string): void {
  if (typeof content !== "string") {
    throw new ValidationError("Content must be a string");
  }
  if (content.length > MAX_DOCUMENT_SIZE) {
    throw new ValidationError(`Content exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`);
  }
  if (content.trim().length < MIN_CONTENT_LENGTH) {
    throw new ValidationError(`Content must be at least ${MIN_CONTENT_LENGTH} characters`);
  }
}

/**
 * Simple hash function for idempotency (non-cryptographic)
 * Uses a basic string hash algorithm suitable for deduplication
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate creation key for idempotency
 * Combines threadId + content hash to detect duplicate creation attempts
 */
function generateCreationKey(threadId: string | undefined, title: string, contentHash: string): string {
  const combined = `${threadId || "no-thread"}|${title}|${contentHash}`;
  return simpleHash(combined);
}

// Internal query to fetch a document id by creation key
export const findByCreationKey = internalQuery({
  args: {
    creationKey: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, { creationKey, userId }): Promise<Id<"documents"> | undefined> => {
    const row = await ctx.db
      .query("documents")
      .withIndex("by_creation_key", q => q.eq("creationKey", creationKey))
      .filter((q) => q.eq(q.field("createdBy"), userId))
      .first() as Doc<"documents"> | null;
    return row?._id;
  }
});

/**
 * Hash content for idempotency detection
 */
function hashContent(content: string): string {
  return simpleHash(content);
}

/**
 * Check if document with this creation key already exists
 */
async function findExistingDocument(
  ctx: any,
  creationKey: string,
  userId: Id<"users">
): Promise<Id<"documents"> | null> {
  const docId = await ctx.runQuery(
    internal.domains.agents.fastAgentDocumentCreation.findByCreationKey,
    { creationKey, userId },
  );
  return (docId as Id<"documents">) ?? null;
}

/**
 * Main action: Generate document content and persist it
 *
 * Input:
 * - prompt: user request for document creation
 * - threadId: optional agent thread ID for linking
 * - isPublic: whether document should be public (default: false)
 * - creationKey: optional explicit creation key for idempotency
 *
 * Output:
 * - documentId: ID of created document
 * - title: document title
 * - contentPreview: first 200 chars of content
 */
export const generateAndCreateDocument = action({
  args: {
    prompt: v.string(),
    threadId: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    creationKey: v.optional(v.string()),
  },
  returns: v.object({
    documentId: v.id("documents"),
    title: v.string(),
    contentPreview: v.string(),
  }),
  handler: async (ctx, args): Promise<{ documentId: Id<"documents">; title: string; contentPreview: string }> => {
    const executionId = Math.random().toString(36).substring(2, 10);
    console.log(`[generateAndCreateDocument:${executionId}] Starting authorized request`);

    try {
      // 1. Validate input
      validatePrompt(args.prompt);
      console.log(`[generateAndCreateDocument:${executionId}] Input validation passed`);

      // 2. Authenticate user
      const userId = await getAuthUserId(ctx);
      if (!userId) {
        throw new ValidationError("Not authenticated");
      }
      console.log(`[generateAndCreateDocument:${executionId}] User authenticated: ${userId}`);

      // 3. Get thread info if provided
      let threadUserId: Id<"users"> | null = null;
      if (args.threadId) {
        try {
          const thread = await ctx.runQuery(components.agent.threads.getThread, {
            threadId: args.threadId,
          });
          threadUserId = (thread?.userId ?? null) as Id<"users"> | null;
          assertFastAgentDocumentThreadOwner(userId, threadUserId);
        } catch (err) {
          console.warn(`[generateAndCreateDocument:${executionId}] Thread ownership check failed`);
          throw new ValidationError("Thread not found or unauthorized");
        }
      }

      // 4. Generate document content using DocumentGenerationAgent
      console.log(`[generateAndCreateDocument:${executionId}] Generating content...`);

      // Define agent locally since specializedAgents is deprecated
      const { Agent } = await import("@convex-dev/agent");
      const { openai } = await import("@ai-sdk/openai");
      const { anthropic } = await import("@ai-sdk/anthropic");
      const { google } = await import("@ai-sdk/google");

      // Use model catalog for consistent model selection
      const { getLlmModel } = await import("../../../../shared/llm/modelCatalog");
      const agentModel = getLlmModel("agent", "openai");

      // Helper to get language model based on model name
      // Supports: OpenAI (gpt-*), Anthropic (claude-*), Google (gemini-*)
      const getLanguageModel = (model: string) => {
        if (model.startsWith("claude-")) return anthropic(model);
        if (model.startsWith("gemini-")) return google(model);
        return openai.chat(model);
      };

      const createDocumentGenerationAgent = () => new Agent(components.agent, {
        name: "DocumentGenerationAgent",
        languageModel: getLanguageModel(agentModel),
        instructions: `You are an expert document writer and editor.
Your goal is to write high-quality, well-structured documents based on user prompts.

GUIDELINES:
1. Use clear, professional language
2. Structure content with proper Markdown headings (#, ##, ###)
3. Use lists, tables, and formatting to improve readability
4. Ensure the content is comprehensive and addresses the user's prompt
5. If the user provides a title, use it. If not, generate a relevant title.

OUTPUT FORMAT:
You must include a metadata block at the start of your response:
<!-- DOCUMENT_METADATA
{
  "title": "Document Title",
  "summary": "Brief summary of content"
}
-->

Followed by the document content in Markdown.`,
      });

      const agent = createDocumentGenerationAgent();

      const result = await agent.streamText(
        ctx,
        {
          userId,
          ...(args.threadId ? { threadId: args.threadId } : {}),
        },
        { prompt: args.prompt }
      );

      await result.consumeStream();
      const generatedText = await result.text;
      console.log(`[generateAndCreateDocument:${executionId}] Generated ${generatedText.length} characters`);

      // 5. Extract metadata and content
      const metadataMatch = generatedText.match(/<!-- DOCUMENT_METADATA\s*\n([\s\S]*?)\n-->/);
      let title = "Untitled Document";
      let summary = undefined;

      if (metadataMatch) {
        try {
          const metadata = JSON.parse(metadataMatch[1]);
          title = metadata.title || title;
          summary = metadata.summary;
        } catch (e) {
          console.warn(`[generateAndCreateDocument:${executionId}] Failed to parse metadata:`, e);
        }
      }

      const markdownContent = generatedText.replace(/<!-- DOCUMENT_METADATA[\s\S]*?-->\s*/, "").trim();

      // 6. Validate extracted content
      validateTitle(title);
      validateContent(markdownContent);
      console.log(`[generateAndCreateDocument:${executionId}] Content validation passed`);

      // 7. Convert markdown to TipTap JSON
      console.log(`[generateAndCreateDocument:${executionId}] Converting to TipTap format...`);
      const tiptapDoc = markdownToTipTap(markdownContent);

      // 8. Extract media assets from thread if available
      let mediaAssets: MediaAsset[] = [];
      if (args.threadId) {
        try {
          console.log(`[generateAndCreateDocument:${executionId}] Extracting media from thread...`);

          // Fetch all messages from the thread
          const allMessages: any[] = [];
          let cursor: string | null = null;
          let hasMore = true;

          while (hasMore) {
            const result: any = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
              threadId: args.threadId,
              order: "asc" as const,
              paginationOpts: {
                cursor: cursor,
                numItems: 100,
              },
            });

            allMessages.push(...result.page);
            cursor = result.continueCursor;
            hasMore = !result.isDone;
          }

          console.log(`[generateAndCreateDocument:${executionId}] Fetched ${allMessages.length} messages`);

          // Extract media from messages
          const extractedAssets = extractMediaFromMessages(allMessages);
          console.log(`[generateAndCreateDocument:${executionId}] Extracted ${extractedAssets.length} media assets`);

          // Convert to MediaAsset format
          mediaAssets = extractedAssets.map((asset) => ({
            type: asset.type as any,
            url: asset.url,
            title: asset.title,
            thumbnail: asset.thumbnail,
            metadata: asset.metadata,
          }));
        } catch (err) {
          console.warn(`[generateAndCreateDocument:${executionId}] Failed to extract media:`, err);
        }
      }

      // 9. Add media assets to TipTap document if present
      if (mediaAssets.length > 0) {
        console.log(`[generateAndCreateDocument:${executionId}] Adding ${mediaAssets.length} media assets to document`);
        const mediaNodes = convertMediaAssetsToTipTap(mediaAssets);
        tiptapDoc.content.push(...mediaNodes);
      }

      // 10. Validate TipTap document
      if (!validateTipTapDocument(tiptapDoc)) {
        throw new ValidationError("Generated document failed TipTap validation");
      }

      // 11. Check for idempotency
      const contentHash = hashContent(markdownContent);
      const creationKey = args.creationKey || generateCreationKey(args.threadId, title, contentHash);

      const existingDocId = await findExistingDocument(ctx, creationKey, userId);
      if (existingDocId) {
        console.log(`[generateAndCreateDocument:${executionId}] Document already exists: ${existingDocId}`);
        return {
          documentId: existingDocId,
          title,
          contentPreview: markdownContent.substring(0, 200),
        };
      }

      // 12. Persist document
      console.log(`[generateAndCreateDocument:${executionId}] Persisting document...`);
      const documentId: Id<"documents"> = await ctx.runMutation(internal.domains.agents.fastAgentDocumentCreation.persistDocument, {
        title,
        content: JSON.stringify(tiptapDoc),
        userId,
        threadId: args.threadId,
        isPublic: args.isPublic || false,
        creationKey,
        summary,
      });

      console.log(`[generateAndCreateDocument:${executionId}] Document created: ${documentId}`);

      // 13. Mark document as having content (for UnifiedEditor)
      await ctx.runMutation(internal.domains.agents.fastAgentDocumentCreation.markDocumentHasContent, {
        documentId,
        userId,
      });

      // 14. Trigger indexing and snapshotting asynchronously
      await ctx.scheduler.runAfter(0, internal.domains.agents.fastAgentDocumentCreation.indexAndSnapshot, {
        documentId,
        content: JSON.stringify(tiptapDoc),
        userId,
      });

      return {
        documentId,
        title,
        contentPreview: markdownContent.substring(0, 200),
      };
    } catch (err) {
      console.error(`[generateAndCreateDocument:${executionId}] Error:`, err);
      if (err instanceof ValidationError) {
        throw new Error(`Validation failed: ${err.message}`);
      }
      throw err;
    }
  },
});

/**
 * Internal mutation: Mark document as having content
 * Sets the agentsPrefs flag so UnifiedEditor knows to load content instead of showing "Create document" button
 */
export const markDocumentHasContent = internalMutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const now = Date.now();

      // Get existing user preferences
      const existing = await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first() as Doc<"userPreferences"> | null;

      const key = `doc.hasContent.${args.documentId}`;
      const newAgentsPrefs = { ...(existing?.agentsPrefs || {}), [key]: "1" };

      if (existing) {
        await ctx.db.patch(existing._id, {
          agentsPrefs: newAgentsPrefs,
          updatedAt: now,
        });
      } else {
        // Create new userPreferences record with minimal required fields
        await ctx.db.insert("userPreferences", {
          userId: args.userId,
          agentsPrefs: newAgentsPrefs,
          createdAt: now,
          updatedAt: now,
        } as any);
      }

      console.log(`[markDocumentHasContent] Marked document ${args.documentId} as having content`);
    } catch (err) {
      console.error(`[markDocumentHasContent] Error:`, err);
      // Don't throw - this is a UX enhancement, not critical
    }
    return null;
  },
});

/**
 * Internal mutation: Persist document to database
 *
 * Creates documents as dossier type since Fast Agent often gathers
 * multi-media content (videos, images, SEC docs, news) during research.
 * The dossier viewer is designed to display this rich media content.
 */
export const persistDocument = internalMutation({
  args: {
    title: v.string(),
    content: v.string(), // TipTap JSON
    userId: v.id("users"),
    threadId: v.optional(v.string()),
    isPublic: v.boolean(),
    creationKey: v.string(),
    summary: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const documentId = await ctx.db.insert("documents", {
      title: args.title,
      content: args.content,
      createdBy: args.userId,
      isPublic: args.isPublic,
      isArchived: false,
      isFavorite: false,
      lastModified: Date.now(),
      chatThreadId: args.threadId,
      creationKey: args.creationKey,
      summary: args.summary,
      documentType: "dossier",      // Use dossier type for rich media support
      dossierType: "primary",        // Mark as primary dossier
    } as any);

    console.log(`[persistDocument] Document persisted as dossier: ${documentId}`);
    return documentId;
  },
});

/**
 * Internal mutation: Create initial snapshot for a document
 */
export const createInitialSnapshot = internalMutation({
  args: {
    documentId: v.id("documents"),
    content: v.string(), // TipTap JSON
    userId: v.id("users"),
  },
  returns: v.id("documentSnapshots"),
  handler: async (ctx, args) => {
    const snapshotId = await ctx.db.insert("documentSnapshots", {
      documentId: args.documentId,
      content: args.content,
      version: 0,
      createdBy: args.userId,
      createdAt: Date.now(),
      stepCount: 0,
      isManual: false,
      triggerReason: "auto-created-on-generation",
      contentSize: args.content.length,
    } as any);
    return snapshotId;
  }
});

/**
 * Internal action: Index document and create snapshot
 *
 * This runs asynchronously after document creation to:
 * 1. Add document to ENHANCED RAG index for semantic search with LLM validation
 * 2. Add to legacy RAG for backward compatibility
 * 3. Create initial snapshot for version control
 *
 * Failures here don't block document creation - they're logged but not thrown
 */
export const indexAndSnapshot = internalAction({
  args: {
    documentId: v.id("documents"),
    content: v.string(), // TipTap JSON
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      // 1. Index for ENHANCED RAG (with metadata, filters, and LLM validation)
      console.log(`[indexAndSnapshot] Indexing document with enhanced RAG: ${args.documentId}`);
      const doc = await ctx.runQuery(api.domains.documents.documents.getById, { documentId: args.documentId });
      if (doc) {
        // Add to enhanced RAG with user namespace and metadata
        try {
          const enhancedResult = await ctx.runAction(internal.domains.search.ragEnhanced.addDocumentToEnhancedRag, {
            documentId: args.documentId,
            userId: args.userId,
          });

          if (enhancedResult.success) {
            console.log(`[indexAndSnapshot] Enhanced RAG indexing successful: ${args.documentId} (${enhancedResult.chunksCount} chunks)`);
          } else {
            console.warn(`[indexAndSnapshot] Enhanced RAG indexing failed for: ${args.documentId}`);
          }
        } catch (enhancedError) {
          console.error(`[indexAndSnapshot] Enhanced RAG error:`, enhancedError);
        }

        // 2. Also add to legacy RAG for backward compatibility
        try {
          await ctx.runAction(internal.domains.search.rag.addDocumentToRag, { documentId: args.documentId });
          console.log(`[indexAndSnapshot] Legacy RAG indexing successful: ${args.documentId}`);
        } catch (legacyError) {
          console.error(`[indexAndSnapshot] Legacy RAG error:`, legacyError);
        }
      } else {
        console.warn(`[indexAndSnapshot] Document not found for indexing: ${args.documentId}`);
      }

      // 3. Create initial snapshot for version control
      console.log(`[indexAndSnapshot] Creating snapshot for: ${args.documentId}`);
      const snapshotId = await ctx.runMutation(internal.domains.agents.fastAgentDocumentCreation.createInitialSnapshot, {
        documentId: args.documentId,
        content: args.content,
        userId: args.userId,
      });

      console.log(`[indexAndSnapshot] Snapshot created: ${snapshotId}`);
    } catch (err) {
      console.error(`[indexAndSnapshot] Error:`, err);
      // Don't throw - indexing/snapshot failure shouldn't block document creation
      // These are background operations that can be retried later if needed
    }
  },
});
