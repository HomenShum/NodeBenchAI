/**
 * Hashtag menu hook for UnifiedEditor
 * Handles #hashtag suggestions and dossier creation
 */

import { useCallback } from 'react';
import { useConvex } from 'convex/react';
import { DefaultReactSuggestionItem } from '@blocknote/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';

interface UseHashtagMenuOptions {
  editor: any; // BlockNote editor instance
  documentId: Id<"documents">;
}

export function useHashtagMenu({ editor, documentId }: UseHashtagMenuOptions) {
  const convex = useConvex();

  const getHashtagMenuItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      try {
        const trimmed = (query ?? '').trim().toLowerCase();
        const items: DefaultReactSuggestionItem[] = [];

        if (trimmed.length === 0) {
          // Show recent hashtags when no query
          const recentHashtags = await convex.query(api.domains.search.hashtagDossiers.getRecentHashtags, { limit: 5 });

          recentHashtags.forEach((h: any) => {
            items.push({
              title: `#${h.hashtag}`,
              subtext: 'Existing hashtag dossier',
              onItemClick: () => {
                if (editor) {
                  editor.insertInlineContent([
                    {
                      type: "text",
                      text: `#${h.hashtag}`,
                      styles: {
                        backgroundColor: "#0ea5e933",
                        textColor: "#0ea5e9",
                      },
                    },
                    " ",
                  ]);
                }
              },
            });
          });

          return items;
        }

        // Check if hashtag dossier already exists
        const existingHashtags = await convex.query(api.domains.search.hashtagDossiers.getRecentHashtags, { limit: 50 });
        const existingDossier = existingHashtags.find((h: any) => h.hashtag.toLowerCase() === trimmed);

        if (existingDossier) {
          // Show existing hashtag dossier
          items.push({
            title: `#${trimmed}`,
            subtext: 'Existing hashtag dossier - click to insert',
            onItemClick: () => {
              if (editor) {
                editor.insertInlineContent([
                  {
                    type: "text",
                    text: `#${trimmed}`,
                    styles: {
                      backgroundColor: "#0ea5e933",
                      textColor: "#0ea5e9",
                    },
                  },
                  " ",
                ]);
              }
            },
          });
        } else {
          // Show "Search and create dossier" option
          items.push({
            title: `Search for "${trimmed}" and create dossier`,
            subtext: 'Will search documents and create a new hashtag dossier',
            onItemClick: async () => {
              if (!editor) return;
              await handleCreateHashtagDossier(trimmed);
            },
          });
        }

        return items;
      } catch (error) {
        console.error("[useHashtagMenu] Error fetching hashtag items:", error);
        return [];
      }
    },
    [convex, editor, documentId]
  );

  const handleCreateHashtagDossier = async (hashtag: string) => {
    // Show immediate visual feedback with a loading placeholder
    editor.insertInlineContent([
      { type: "text", text: `#${hashtag}`, styles: { textColor: "#94a3b8", backgroundColor: "#f1f5f933" } },
      { type: "text", text: " ⏳", styles: { textColor: "#94a3b8" } },
      " ",
    ]);

    try {
      const searchResult = await convex.action(api.domains.search.hashtagDossiers.searchForHashtag, { hashtag });

      await convex.mutation(api.domains.search.hashtagDossiers.createHashtagDossier, {
        hashtag,
        matchedDocuments: searchResult.matches,
      });

      // Update placeholder with success
      const cursorPos = editor.getTextCursorPosition();
      const block = cursorPos.block;
      const content = [...(block.content || [])];
      content.splice(-3, 3);
      content.push({ type: "text", text: `#${hashtag}`, styles: { backgroundColor: "#0ea5e933", textColor: "#0ea5e9" } });
      content.push(" ");
      (editor).updateBlock(block, { content });

    } catch (error) {
      console.error("[useHashtagMenu] Error creating hashtag dossier:", error);
      // Show error state
      const cursorPos = editor.getTextCursorPosition();
      const block = cursorPos.block;
      const content = [...(block.content || [])];
      content.splice(-3, 3);
      content.push({ type: "text", text: `#${hashtag} ❌`, styles: { textColor: "#ef4444" } });
      content.push(" ");
      (editor).updateBlock(block, { content });
    }
  };

  return { getHashtagMenuItems };
}

