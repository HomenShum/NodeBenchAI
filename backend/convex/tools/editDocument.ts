// convex/tools/editDocument.ts
// Patch-based document editing tool for Agent component
//
// Implements a patch protocol with:
// - Locators (heading/section anchors + offsets)
// - Operations (insert/replace/delete)
// - Stores patches as events; document can be re-rendered from patches

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// PATCH SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const locatorSchema = z.object({
  type: z.enum(["heading", "paragraph", "line", "search"]).describe("Locator type"),
  anchor: z.string().describe("Text anchor to find position (heading text, search string, etc.)"),
  offset: z.number().default(0).describe("Character offset from anchor position"),
  sectionHint: z.string().optional().describe("Human-readable section name for context"),
});

const operationSchema = z.object({
  type: z.enum(["insert", "replace", "delete"]).describe("Operation type"),
  locator: locatorSchema,
  content: z.string().optional().describe("Content to insert/replace with (not needed for delete)"),
  deleteLength: z.number().optional().describe("Characters to delete (for delete/replace)"),
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: EDIT DOCUMENT
// ═══════════════════════════════════════════════════════════════════════════

export const editDocument = createTool({
  description: `Apply patch-based edits to a document.

This tool supports precise document edits using a locator + operation protocol:

**Locator Types:**
- "heading": Find a heading by its text (e.g., "## Introduction")
- "paragraph": Find paragraph by first few words
- "line": Find line by number
- "search": Find exact text string

**Operation Types:**
- "insert": Insert content at locator position
- "replace": Replace content starting at locator
- "delete": Delete content starting at locator

**Examples:**
1. Insert after heading: { type: "insert", locator: { type: "heading", anchor: "## Summary" }, content: "New paragraph here." }
2. Replace text: { type: "replace", locator: { type: "search", anchor: "old text" }, content: "new text" }
3. Delete section: { type: "delete", locator: { type: "heading", anchor: "## Deprecated" }, deleteLength: 500 }

All edits are stored as patches for audit trail and undo capability.`,

  args: z.object({
    documentId: z.string().describe("The document ID to edit"),
    operations: z.array(operationSchema).describe("List of edit operations to apply in order"),
    description: z.string().optional().describe("Human-readable description of the edit"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const startTime = Date.now();

    try {
      // Fetch the document using internal API (bypasses auth for agent tools)
      const doc = await ctx.runQuery(internal.domains.documents.documents.getDocumentById, {
        documentId: args.documentId as any,
      });

      if (!doc) {
        return `❌ Document not found: "${args.documentId}"`;
      }

      // Get current content
      let content = doc.content || "";
      const originalContent = content;
      const appliedPatches: Array<{
        operation: typeof args.operations[0];
        success: boolean;
        error?: string;
        position?: number;
      }> = [];

      // Apply each operation
      for (const operation of args.operations) {
        const result = applyOperation(content, operation);

        if (result.success) {
          content = result.newContent;
          appliedPatches.push({
            operation,
            success: true,
            position: result.position,
          });
        } else {
          appliedPatches.push({
            operation,
            success: false,
            error: result.error,
          });
        }
      }

      // Check if any changes were made
      const changesApplied = appliedPatches.filter(p => p.success).length;
      if (changesApplied === 0) {
        return `⚠️ No changes applied. Errors:\n${appliedPatches.map(p => p.error).filter(Boolean).join("\n")}`;
      }

      // Store the edit as a patch event
      try {
        await ctx.runMutation(internal.tools.editDocumentMutations.storeDocumentPatch, {
          documentId: args.documentId,
          operations: args.operations,
          description: args.description,
          originalContent: originalContent.slice(0, 500), // Store preview for audit
          newContentPreview: content.slice(0, 500),
          appliedCount: changesApplied,
          failedCount: appliedPatches.filter(p => !p.success).length,
        });
      } catch (patchError) {
        console.warn("[editDocument] Failed to store patch event:", patchError);
      }

      // Update the document content
      try {
        await ctx.runMutation(internal.domains.documents.documents.updateDocumentContent, {
          documentId: args.documentId as any,
          content,
        });
      } catch (updateError) {
        console.error("[editDocument] Failed to update document:", updateError);
        return `❌ Failed to save document changes: ${updateError instanceof Error ? updateError.message : "Unknown error"}`;
      }

      // Format result
      let result = `✅ Document edited successfully!\n\n`;
      result += `**Document:** ${doc.title || args.documentId}\n`;
      result += `**Operations Applied:** ${changesApplied}/${args.operations.length}\n`;

      if (args.description) {
        result += `**Description:** ${args.description}\n`;
      }

      // Show applied changes
      result += `\n**Changes:**\n`;
      for (const patch of appliedPatches) {
        const status = patch.success ? "✓" : "✗";
        const op = patch.operation;
        result += `${status} ${op.type} at "${op.locator.anchor.slice(0, 30)}..."`;
        if (!patch.success && patch.error) {
          result += ` (${patch.error})`;
        }
        result += "\n";
      }

      console.log("[editDocument] Completed", {
        documentId: args.documentId,
        changesApplied,
        elapsedMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      console.error("[editDocument] Error:", error);
      return `❌ Failed to edit document: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Apply single operation to content
// ═══════════════════════════════════════════════════════════════════════════

interface ApplyResult {
  success: boolean;
  newContent: string;
  position?: number;
  error?: string;
}

function applyOperation(
  content: string,
  operation: z.infer<typeof operationSchema>
): ApplyResult {
  const { locator, type } = operation;

  // Find position based on locator type
  let position = findPosition(content, locator);

  if (position === -1) {
    return {
      success: false,
      newContent: content,
      error: `Locator not found: "${locator.anchor.slice(0, 50)}"`,
    };
  }

  // Apply offset
  position += locator.offset || 0;

  // Ensure position is valid
  if (position < 0) position = 0;
  if (position > content.length) position = content.length;

  let newContent: string;

  switch (type) {
    case "insert":
      if (!operation.content) {
        return { success: false, newContent: content, error: "Insert requires content" };
      }
      newContent = content.slice(0, position) + operation.content + content.slice(position);
      break;

    case "replace":
      if (!operation.content) {
        return { success: false, newContent: content, error: "Replace requires content" };
      }
      const replaceLength = operation.deleteLength || operation.content.length;
      newContent = content.slice(0, position) + operation.content + content.slice(position + replaceLength);
      break;

    case "delete":
      const deleteLen = operation.deleteLength || 0;
      if (deleteLen <= 0) {
        return { success: false, newContent: content, error: "Delete requires deleteLength > 0" };
      }
      newContent = content.slice(0, position) + content.slice(position + deleteLen);
      break;

    default:
      return { success: false, newContent: content, error: `Unknown operation type: ${type}` };
  }

  return { success: true, newContent, position };
}

function findPosition(content: string, locator: z.infer<typeof locatorSchema>): number {
  switch (locator.type) {
    case "heading": {
      // Find heading (markdown format: # or ##)
      const headingRegex = new RegExp(`^(#+\\s*)?${escapeRegex(locator.anchor)}`, "mi");
      const match = content.match(headingRegex);
      return match ? content.indexOf(match[0]) : -1;
    }

    case "paragraph": {
      // Find paragraph by first words
      const paraIndex = content.indexOf(locator.anchor);
      return paraIndex;
    }

    case "line": {
      // Find line by number (1-indexed)
      const lineNumber = parseInt(locator.anchor, 10);
      if (isNaN(lineNumber) || lineNumber < 1) return -1;

      const lines = content.split("\n");
      if (lineNumber > lines.length) return -1;

      let position = 0;
      for (let i = 0; i < lineNumber - 1; i++) {
        position += lines[i].length + 1; // +1 for newline
      }
      return position;
    }

    case "search": {
      // Direct text search
      return content.indexOf(locator.anchor);
    }

    default:
      return -1;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: GET DOCUMENT PATCHES
// ═══════════════════════════════════════════════════════════════════════════

export const getDocumentPatches = createTool({
  description: `Get the patch history for a document.

Useful for:
- Viewing edit history
- Understanding recent changes
- Preparing to undo changes

Returns the most recent patches with timestamps and descriptions.`,

  args: z.object({
    documentId: z.string().describe("The document ID to get patches for"),
    limit: z.number().default(10).describe("Maximum number of patches to return"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const patches = await ctx.runQuery(internal.tools.editDocumentMutations.getDocumentPatches, {
        documentId: args.documentId,
        limit: args.limit,
      });

      if (!patches || patches.length === 0) {
        return `No edit history found for document "${args.documentId}"`;
      }

      let result = `## Edit History (${patches.length} patches)\n\n`;

      for (const patch of patches) {
        const date = new Date(patch.createdAt).toLocaleString();
        result += `### ${date}\n`;
        if (patch.description) {
          result += `**Description:** ${patch.description}\n`;
        }
        result += `**Applied:** ${patch.appliedCount}, **Failed:** ${patch.failedCount}\n`;
        result += `---\n\n`;
      }

      return result;
    } catch (error) {
      return `❌ Failed to get patches: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
