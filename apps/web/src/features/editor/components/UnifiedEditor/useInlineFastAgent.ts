/**
 * Custom hook for inline Fast Agent integration with streaming support
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useConvex, useAction, useMutation, useQuery } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { api, internal } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import type { BlockNoteEditor } from "@blocknote/core";

interface InlineFastAgentOptions {
  editor: BlockNoteEditor | null;
  userId: Id<"users"> | undefined;
  documentId?: Id<"documents">;
}

interface StreamingState {
  isStreaming: boolean;
  threadId: string | null;
  messageId: string | null;
  currentText: string;
  targetBlockId: string | null;
}

export function useInlineFastAgent({ editor, userId, documentId }: InlineFastAgentOptions) {
  const convex = useConvex();
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    threadId: null,
    messageId: null,
    currentText: "",
    targetBlockId: null,
  });

  const createStreamingThread = useAction(api.domains.agents.fastAgentPanelStreaming.createThread);
  const sendStreamingMessage = useMutation(api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming);
  
  // Track the block we're streaming into
  const streamingBlockRef = useRef<any>(null);
  const lastTextLengthRef = useRef(0);

  // Get streaming thread data
  const streamingThread = useQuery(
    api.domains.agents.fastAgentPanelStreaming.getThread,
    streamingState.threadId
      ? { threadId: streamingState.threadId as Id<"chatThreadsStream"> }
      : "skip"
  );

  // Subscribe to streaming messages
  const { results: streamingMessages } = useUIMessages(
    api.domains.agents.fastAgentPanelStreaming.getThreadMessagesWithStreaming,
    streamingThread?.agentThreadId && streamingState.isStreaming
      ? { threadId: streamingThread.agentThreadId }
      : "skip",
    {
      initialNumItems: 100,
      stream: true, // Enable streaming deltas
    }
  );

  // Update the editor block with streaming text
  useEffect(() => {
    if (!streamingState.isStreaming || !editor || !streamingBlockRef.current) {
      return;
    }

    // Find the latest assistant message
    const assistantMessages = (streamingMessages || []).filter(
      (msg: any) => msg.role === "assistant"
    );

    if (assistantMessages.length === 0) {
      return;
    }

    const latestMessage = assistantMessages[assistantMessages.length - 1];

    // Extract text from message - prefer the text field, fallback to parts
    let fullText = latestMessage.text || "";

    if (!fullText && latestMessage.parts && Array.isArray(latestMessage.parts)) {
      fullText = latestMessage.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text || "")
        .join("");
    }

    // Extract images from markdown syntax AND plain text URLs
    const images: Array<{ url: string; alt: string }> = [];

    // Extract markdown images: ![alt](url)
    const imageMatches = fullText.match(/!\[.*?\]\(.*?\)/g) || [];
    const markdownImages = imageMatches
      .map((match: string) => {
        const urlMatch = match.match(/\((.*?)\)/);
        const altMatch = match.match(/!\[(.*?)\]/);
        return {
          url: urlMatch?.[1] || '',
          alt: altMatch?.[1] || 'Image'
        };
      })
      .filter((img: { url: string; alt: string }) => img.url && img.url.trim().length > 0);

    images.push(...markdownImages);

    // Extract plain text image URLs from list items
    // Pattern: "- Description — https://example.com/image.jpg"
    const imageUrlPattern = /[-•]\s*([^—\n]+?)\s*[—–-]\s*(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?)/gi;
    let match;
    while ((match = imageUrlPattern.exec(fullText)) !== null) {
      const [, description, url] = match;
      images.push({
        url: url.trim(),
        alt: description.trim() || 'Image'
      });
    }

    // Check if message contains media (videos, documents, sources)
    const hasMedia = fullText.includes('<!-- YOUTUBE_GALLERY_DATA') ||
                     fullText.includes('<!-- SEC_GALLERY_DATA') ||
                     fullText.includes('<!-- WEB_SOURCE_DATA') ||
                     fullText.includes('<!-- PROFILE_DATA') ||
                     images.length > 0;


    // Only update if text has changed
    if (fullText && fullText.length > lastTextLengthRef.current) {
      lastTextLengthRef.current = fullText.length;

      try {
        // Update the streaming block with new text
        const block = streamingBlockRef.current;
        if (block && block.id) {

          // Remove HTML comment markers, image markdown, and plain image URL lists for cleaner inline display
          const cleanText = fullText
            .replace(/<!-- YOUTUBE_GALLERY_DATA[\s\S]*?-->/g, '')
            .replace(/<!-- SEC_GALLERY_DATA[\s\S]*?-->/g, '')
            .replace(/<!-- WEB_SOURCE_DATA[\s\S]*?-->/g, '')
            .replace(/<!-- PROFILE_DATA[\s\S]*?-->/g, '')
            .replace(/<!-- IMAGE_DATA[\s\S]*?-->/g, '')
            .replace(/## Images\s*\n+(?:!\[.*?\]\(.*?\)\s*)+/g, '') // Remove "## Images" section
            .replace(/!\[.*?\]\(.*?\)/g, '') // Remove standalone image markdown
            .replace(/Images\s*\(examples\)\s*\n+(?:[-•]\s*[^—\n]+?[—–-]\s*https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?\s*\n*)+/gi, '') // Remove "Images (examples)" section
            .replace(/[-•]\s*[^—\n]+?[—–-]\s*https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?\s*\n*/gi, '') // Remove individual image URL list items
            .trim();

          editor.updateBlock(block.id, {
            type: "paragraph",
            content: [{ type: "text", text: cleanText, styles: {} }],
          });

          // If streaming is complete, insert images as BlockNote image blocks
          if (latestMessage.status === 'complete' && images.length > 0) {
            const blocks = editor.document;
            const blockIndex = blocks.findIndex((b: any) => b.id === block.id);

            // Check if images already inserted (avoid duplicates)
            const nextBlock = blocks[blockIndex + 1];
            const hasImageBlocks = nextBlock && nextBlock.type === 'image';

            if (!hasImageBlocks) {

              // Insert image blocks after the text block
              const imageBlocks = images.map(img => ({
                type: 'image' as const,
                props: {
                  url: img.url,
                  caption: img.alt,
                  previewWidth: 512,
                },
              }));

              editor.insertBlocks(imageBlocks, block, 'after');
            }
          }

          // If media detected (videos/docs), add a note below
          if (hasMedia && latestMessage.status === 'complete' && (
            fullText.includes('<!-- YOUTUBE_GALLERY_DATA') ||
            fullText.includes('<!-- SEC_GALLERY_DATA') ||
            fullText.includes('<!-- WEB_SOURCE_DATA')
          )) {
            const blocks = editor.document;
            const blockIndex = blocks.findIndex((b: any) => b.id === block.id);

            // Find the last block (after images if any)
            let lastBlockIndex = blockIndex;
            if (images.length > 0) {
              lastBlockIndex = blockIndex + images.length;
            }

            const nextBlock = blocks[lastBlockIndex + 1];

            // Only add media note if it doesn't already exist
            if (!nextBlock || !(nextBlock.content as any[])?.some?.((c: any) => c.text?.includes('📎 Media files found'))) {
              const lastBlock = blocks[lastBlockIndex];
              editor.insertBlocks([{
                type: 'paragraph',
                content: [{
                  type: 'text',
                  text: '📎 Videos, documents, and sources found - Click "View in Panel →" to see them',
                  styles: { italic: true, textColor: 'gray' },
                }],
              }], lastBlock, 'after');
            }
          }
        }
      } catch (error) {
        console.error("[useInlineFastAgent] Error updating block:", error);
      }
    }

    // Check if streaming is complete by checking message status
    // Message status changes from 'streaming' to 'complete' when done
    const isComplete = latestMessage.status === "complete" || latestMessage.status === "error";

    if (isComplete && streamingState.isStreaming) {
      setStreamingState((prev) => ({
        ...prev,
        isStreaming: false,
      }));
      streamingBlockRef.current = null;
      lastTextLengthRef.current = 0;
    }
  }, [streamingMessages, streamingState.isStreaming, editor]);

  /**
   * Ask Fast Agent with streaming response
   */
  const askFastAgent = useCallback(
    async (question: string, context?: string) => {
      if (!editor || !userId) {
        console.error("[useInlineFastAgent] Editor or userId not available");
        return;
      }

      try {
        setStreamingState((prev) => ({ ...prev, isStreaming: true }));

        // Create or reuse thread
        let threadId = streamingState.threadId;
        if (!threadId) {
          threadId = await createStreamingThread({
            title: `Inline AI: ${question.substring(0, 50)}`,
            model: "gpt-5-chat-latest",
          });
          setStreamingState((prev) => ({ ...prev, threadId }));
        }

        // Get current cursor position
        const currentBlock = editor.getTextCursorPosition().block;

        // Insert a placeholder block for streaming
        const placeholderBlock = {
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: "🤖 Thinking...", styles: {} }],
        };

        editor.insertBlocks([placeholderBlock], currentBlock, "after");

        // Get the newly inserted block
        const blocks = editor.document;
        const currentIndex = blocks.findIndex((b: any) => b.id === currentBlock.id);
        const newBlock = blocks[currentIndex + 1];
        
        if (newBlock) {
          streamingBlockRef.current = newBlock;
          setStreamingState((prev) => ({ ...prev, targetBlockId: newBlock.id }));
        }

        // Send message to Fast Agent
        const message = context ? `${question}\n\nContext:\n${context}` : question;
        const clientContext =
          typeof window !== "undefined"
            ? {
                timezone: (() => {
                  try {
                    return Intl.DateTimeFormat().resolvedOptions().timeZone;
                  } catch {
                    return undefined;
                  }
                })(),
                locale: typeof navigator !== "undefined" ? navigator.language : undefined,
                utcOffsetMinutes: new Date().getTimezoneOffset(),
              }
            : undefined;
        const result = await sendStreamingMessage({
          threadId: threadId as Id<"chatThreadsStream">,
          prompt: message,
          model: "gpt-5-chat-latest",
          clientContext,
        });

        setStreamingState((prev) => ({ ...prev, messageId: result.messageId }));

      } catch (error) {
        console.error("[useInlineFastAgent] Error:", error);
        setStreamingState({
          isStreaming: false,
          threadId: null,
          messageId: null,
          currentText: "",
          targetBlockId: null,
        });
        
        // Show error to user
        if (streamingBlockRef.current && editor) {
          try {
            editor.updateBlock(streamingBlockRef.current.id, {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "❌ Failed to get response from Fast Agent",
                  styles: { textColor: "red" },
                },
              ],
            });
          } catch {}
        }
        
        throw error;
      }
    },
    [editor, userId, streamingState.threadId, createStreamingThread, sendStreamingMessage]
  );

  /**
   * Cancel ongoing streaming
   */
  const cancelStreaming = useCallback(() => {
    setStreamingState({
      isStreaming: false,
      threadId: null,
      messageId: null,
      currentText: "",
      targetBlockId: null,
    });
    streamingBlockRef.current = null;
    lastTextLengthRef.current = 0;
  }, []);

  return {
    askFastAgent,
    cancelStreaming,
    isStreaming: streamingState.isStreaming,
    currentText: streamingState.currentText,
    streamingMessages: streamingMessages || [],
    threadId: streamingState.threadId,
  };
}
