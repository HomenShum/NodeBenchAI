/**
 * useSlashMenuItems hook for UnifiedEditor
 * Provides custom slash menu items including Fast Agent integration
 */

import { useCallback } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";

interface UseSlashMenuItemsProps {
  askFastAgent: (prompt: string, context: string) => Promise<void>;
}

export function useSlashMenuItems({ askFastAgent }: UseSlashMenuItemsProps) {
  const getCustomSlashMenuItems = useCallback((editor: BlockNoteEditor) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor);

    // Add custom Fast Agent item to the slash menu
    return [
      ...defaultItems,
      {
        title: "Ask Fast Agent",
        onItemClick: () => {
          // Get current block to check if user typed inline prompt
          const currentBlock = editor.getTextCursorPosition().block;
          let inlinePrompt = "";

          // Extract text from current block
          if (currentBlock.content && Array.isArray(currentBlock.content)) {
            const blockText = currentBlock.content
              .map((c: any) => c.text || "")
              .join("")
              .trim();

            // Check if user typed "/ai " followed by text
            const aiMatch = blockText.match(/^\/ai\s+(.+)$/i);
            if (aiMatch) {
              inlinePrompt = aiMatch[1].trim();
            }
          }

          // If no inline prompt, just clear the /ai text and let user continue typing
          if (!inlinePrompt) {
            // Clear the current block (remove the "/ai" text)
            editor.updateBlock(currentBlock, {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "🤖 ",
                  styles: {},
                },
              ],
            });

            // Set cursor at the end so user can continue typing
            editor.setTextCursorPosition(currentBlock, "end");
            return;
          }

          // Get selected text as context (if any)
          const selection = editor.getSelection();
          let context = "";

          if (selection) {
            const blocks = selection.blocks;
            context = blocks.map((block: any) => {
              if (block.content && Array.isArray(block.content)) {
                return block.content.map((c: any) => c.text || "").join("");
              }
              return "";
            }).join("\n");
          }

          // Clear the current block before inserting response
          editor.updateBlock(currentBlock, {
            type: "paragraph",
            content: [],
          });

          // Call Fast Agent with streaming
          askFastAgent(inlinePrompt, context).catch((error) => {
            console.error("[useSlashMenuItems] Fast Agent error:", error);
            // Insert error message inline instead of alert
            editor.insertBlocks(
              [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "❌ Failed to get response from Fast Agent. Please try again.",
                      styles: { bold: true, textColor: "red" },
                    },
                  ],
                },
              ],
              currentBlock,
              "after"
            );
          });
        },
        aliases: ["ai", "agent", "ask"],
        group: "AI",
        icon: "🤖",
        subtext: "Type '/ai {your question}' for instant response",
      },
      {
        title: "Edit with Deep Agent",
        onItemClick: () => {
          // Get current block to check if user typed inline edit instruction
          const currentBlock = editor.getTextCursorPosition().block;
          let editInstruction = "";

          // Extract text from current block
          if (currentBlock.content && Array.isArray(currentBlock.content)) {
            const blockText = currentBlock.content
              .map((c: any) => c.text || "")
              .join("")
              .trim();

            // Check for "/ai edit " or "/edit " followed by instruction
            const editMatch = blockText.match(/^\/(?:ai\s+)?edit\s+(.+)$/i);
            if (editMatch) {
              editInstruction = editMatch[1].trim();
            }
          }

          // If no inline instruction, show placeholder and let user type
          if (!editInstruction) {
            editor.updateBlock(currentBlock, {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "✏️ Edit: ",
                  styles: { bold: true, textColor: "purple" },
                },
              ],
            });
            editor.setTextCursorPosition(currentBlock, "end");
            return;
          }

          // Get document content as context for editing
          let documentContext = "";
          try {
            const allBlocks = editor.document;
            documentContext = allBlocks.slice(0, 20).map((block: any) => {
              if (block.content && Array.isArray(block.content)) {
                return block.content.map((c: any) => c.text || "").join("");
              }
              return "";
            }).filter(Boolean).join("\n").substring(0, 2000);
          } catch (e) {
          }

          // Show editing indicator
          editor.updateBlock(currentBlock, {
            type: "paragraph",
            content: [
              { type: "text", text: "✏️ ", styles: {} },
              { type: "text", text: "Deep Agent editing: ", styles: { bold: true, textColor: "purple" } },
              { type: "text", text: editInstruction, styles: { italic: true } },
            ],
          });

          // Call Fast Agent with edit-specific context and instruction
          const editPrompt = `You are in DOCUMENT EDITING mode. The user wants to edit this document.

INSTRUCTION: ${editInstruction}

DOCUMENT CONTEXT (first 2000 chars):
${documentContext}

Use the document editing tools (readDocumentSections, createDocumentEdit) to:
1. First read the document structure to understand where to make edits
2. Create anchor-based SEARCH/REPLACE edits for each change
3. Report on edit status after creating them

Be precise with anchors and search text - they must match exactly what's in the document.`;

          askFastAgent(editPrompt, "").catch((error) => {
            console.error("[useSlashMenuItems] Deep Agent edit error:", error);
            editor.insertBlocks(
              [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "❌ Deep Agent editing failed. Please try again.",
                      styles: { bold: true, textColor: "red" },
                    },
                  ],
                },
              ],
              currentBlock,
              "after"
            );
          });
        },
        aliases: ["edit", "aiedit", "deepedit"],
        group: "AI",
        icon: "✏️",
        subtext: "Type '/edit {instruction}' to edit document with AI",
      },
    ];
  }, [askFastAgent]);

  return { getCustomSlashMenuItems };
}

