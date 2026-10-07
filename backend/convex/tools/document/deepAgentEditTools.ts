/**
 * Deep Agent Edit Tools - Tools for generating anchor-based document edits
 * 
 * These tools enable the Deep Agent to create SEARCH/REPLACE edit instructions
 * that are stored in pendingDocumentEdits table and applied client-side via PmBridge.
 * 
 * Pattern: Agent generates edit → stores in DB → client applies → reports result
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/**
 * Read document sections for planning edits
 * Returns document content with section markers for anchor-based editing
 */
export const readDocumentSections = createTool({
  description: `Read a document's content broken into sections for planning edits.
Returns the document with section headers, anchors, and content previews.
Use this before making edits to understand document structure.`,

  args: z.object({
    documentId: z.string().describe("Document ID to read"),
    maxPreviewLength: z.number().default(500).describe("Max characters per section preview"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[readDocumentSections] Reading document: ${args.documentId}`);

    const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
      documentId: args.documentId,
    });

    if (!doc) {
      return `Document not found: ${args.documentId}`;
    }

    // Parse content into sections
    // Note: doc.content is a string (legacy ProseMirror JSON blob or plain text)
    const rawContent = doc.content || "";
    let contentText = "";

    if (typeof rawContent === "string") {
      // Try to parse as JSON (BlockNote format) first
      try {
        const parsed = JSON.parse(rawContent);
        if (Array.isArray(parsed)) {
          // BlockNote format - extract text from blocks
          contentText = parsed.map((block: any) => {
            if (block.content && Array.isArray(block.content)) {
              return block.content.map((c: any) => c.text || "").join("");
            }
            return "";
          }).join("\n");
        } else {
          contentText = rawContent;
        }
      } catch {
        // Not JSON, use as plain text
        contentText = rawContent;
      }
    }

    // Find section headers (lines starting with # or numbered patterns)
    const lines = contentText.split("\n");
    const sections: { header: string; anchor: string; preview: string; lineNumber: number }[] = [];
    
    let currentSection = { header: "Introduction", anchor: "", preview: "", lineNumber: 0 };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/) || line.match(/^(\d+\.)\s+(.+)$/);
      
      if (headerMatch) {
        // Save previous section
        if (currentSection.anchor || currentSection.preview) {
          sections.push({ ...currentSection });
        }
        
        currentSection = {
          header: headerMatch[2],
          anchor: line.substring(0, 50).trim(),
          preview: "",
          lineNumber: i + 1,
        };
      } else if (line.trim()) {
        // Add to current section preview
        if (currentSection.preview.length < args.maxPreviewLength) {
          currentSection.preview += (currentSection.preview ? " " : "") + line.trim();
        }
      }
    }
    
    // Add last section
    if (currentSection.anchor || currentSection.preview) {
      sections.push(currentSection);
    }

    // Format output
    const result = `# Document: ${doc.title}
ID: ${args.documentId}
Sections: ${sections.length}

${sections.map((s, i) => 
  `## Section ${i + 1}: ${s.header}
Anchor: "${s.anchor}"
Line: ${s.lineNumber}
Preview: ${s.preview.substring(0, args.maxPreviewLength)}${s.preview.length > args.maxPreviewLength ? "..." : ""}`
).join("\n\n")}`;

    return result;
  },
});

/**
 * Create a pending document edit using anchor-based SEARCH/REPLACE
 * The edit is stored in pendingDocumentEdits and applied client-side
 */
export const createDocumentEdit = createTool({
  description: `Create an anchor-based SEARCH/REPLACE edit for a document.
The edit will be stored and applied by the client's editor.

IMPORTANT:
- anchor: Text that uniquely identifies WHERE in the document to apply the edit
- search: The EXACT text to find and replace (must exist in document)
- replace: The new text to insert in place of search

For insertions: use empty search "" and place replace content at anchor position
For deletions: use empty replace "" to delete the search text`,

  args: z.object({
    documentId: z.string().describe("Document ID to edit"),
    anchor: z.string().describe("Text anchor - unique text near the edit location (10-50 chars)"),
    search: z.string().describe("Exact text to find and replace (empty for insertions)"),
    replace: z.string().describe("New text to insert (empty for deletions)"),
    sectionHint: z.string().optional().describe("Optional section name hint for disambiguation"),
    agentThreadId: z.string().describe("Current agent thread ID for correlation"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[createDocumentEdit] Creating edit for: ${args.documentId}`);
    console.log(`[createDocumentEdit] Anchor: "${args.anchor.substring(0, 30)}..."`);
    
    // Get userId from context (set by agent framework)
    const userId = (ctx as any).userId || (ctx as any).evaluationUserId;
    if (!userId) {
      return "Error: No user context available for creating edit";
    }

    // Get document to verify it exists and get version
    const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
      documentId: args.documentId,
    });

    if (!doc) {
      return `Error: Document not found: ${args.documentId}`;
    }

    // Get document version for OCC (optimistic concurrency control)
    const version = (doc).version || 1;

    // Create the pending edit
    try {
      const result = await ctx.runMutation(internal.domains.documents.pendingEdits.createPendingEdit, {
        documentId: args.documentId,
        userId: userId as Id<"users">,
        agentThreadId: args.agentThreadId,
        documentVersion: version,
        operation: {
          type: "anchoredReplace" as const,
          anchor: args.anchor,
          search: args.search,
          replace: args.replace,
          sectionHint: args.sectionHint,
        },
      });

      const editType = !args.search ? "INSERT" : !args.replace ? "DELETE" : "REPLACE";

      return `✅ Edit created successfully!

Type: ${editType}
Edit ID: ${result.editId}
Document: ${doc.title}
Anchor: "${args.anchor.substring(0, 30)}..."
${args.search ? `Search: "${args.search.substring(0, 50)}${args.search.length > 50 ? "..." : ""}"` : ""}
${args.replace ? `Replace: "${args.replace.substring(0, 50)}${args.replace.length > 50 ? "..." : ""}"` : ""}

The edit is now pending and will be applied by the client editor.
Monitor edit status to verify successful application.`;
    } catch (error) {
      console.error("[createDocumentEdit] Error:", error);
      return `Error creating edit: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Check the status of pending edits for a document or thread
 */
export const checkEditStatus = createTool({
  description: `Check the status of pending document edits.
Use after creating edits to monitor application progress and handle failures.`,

  args: z.object({
    agentThreadId: z.string().describe("Agent thread ID to check edits for"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[checkEditStatus] Checking edits for thread: ${args.agentThreadId}`);

    const stats = await ctx.runQuery(internal.domains.documents.pendingEdits.getEditStatsForThread, {
      agentThreadId: args.agentThreadId,
    });

    if (stats.total === 0) {
      return "No edits found for this thread.";
    }

    const statusEmoji = {
      pending: "⏳",
      applied: "✅",
      failed: "❌",
      cancelled: "🚫",
    };

    return `# Edit Status for Thread

Total Edits: ${stats.total}
${statusEmoji.pending} Pending: ${stats.pending}
${statusEmoji.applied} Applied: ${stats.applied}
${statusEmoji.failed} Failed: ${stats.failed}
${statusEmoji.cancelled} Cancelled: ${stats.cancelled}

${stats.failed > 0 ? `\n⚠️ ${stats.failed} edit(s) failed. Consider revising anchor/search patterns.` : ""}
${stats.pending > 0 ? `\n⏳ ${stats.pending} edit(s) still pending client application.` : ""}
${stats.applied === stats.total ? "\n🎉 All edits successfully applied!" : ""}`;
  },
});

/**
 * Get details of a failed edit for self-correction
 */
export const getFailedEdit = createTool({
  description: `Get details of a failed edit to understand what went wrong.
Use this when an edit fails to retrieve error information for self-correction.`,

  args: z.object({
    documentId: z.string().describe("Document ID"),
    anchor: z.string().describe("The anchor text of the failed edit"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[getFailedEdit] Getting failed edit for anchor: ${args.anchor}`);

    const failedEdit = await ctx.runQuery(internal.domains.documents.pendingEdits.getFailedEditForAnchor, {
      documentId: args.documentId,
      anchor: args.anchor,
    });

    if (!failedEdit) {
      return `No failed edit found for anchor "${args.anchor}" in document ${args.documentId}`;
    }

    return `# Failed Edit Details

Edit ID: ${failedEdit._id}
Status: ${failedEdit.status}
Error: ${failedEdit.errorMessage || "Unknown error"}
Retry Count: ${failedEdit.retryCount}

Operation:
- Type: ${failedEdit.operation.type}
- Anchor: "${failedEdit.operation.anchor}"
- Search: "${failedEdit.operation.search}"
- Replace: "${failedEdit.operation.replace.substring(0, 100)}..."

Suggestions:
1. Verify the anchor text exists in the document
2. Check that the search text matches exactly
3. Try a different, more unique anchor
4. Consider breaking into smaller edits`;
  },
});

