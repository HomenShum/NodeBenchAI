/**
 * Mention menu hook for UnifiedEditor
 * Handles @mention suggestions and document linking
 */

import { useCallback } from 'react';
import { useConvex } from 'convex/react';
import { DefaultReactSuggestionItem } from '@blocknote/react';
import { api } from '../../../../convex/_generated/api';

interface UseMentionMenuOptions {
  editor: any; // BlockNote editor instance
}

export function useMentionMenu({ editor }: UseMentionMenuOptions) {
  const convex = useConvex();

  const getMentionMenuItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      try {
        const trimmed = (query ?? '').trim();
        let documents: any[] = [];

        if (trimmed.length < 1) {
          // Show recent documents
          documents = await convex.query(api.domains.documents.documents.getRecentForMentions, { limit: 8 });
        } else {
          // Search documents
          documents = await convex.query(api.domains.documents.documents.getSearch, { query: trimmed });
        }

        return (documents || []).map((doc: any) => ({
          title: doc.title || 'Untitled',
          onItemClick: () => {
            if (editor) {
              // Insert mention as styled text instead of custom inline content
              editor.insertInlineContent([
                {
                  type: "text",
                  text: `@${doc.title || 'Untitled'}`,
                  styles: {
                    backgroundColor: "#8400ff33",
                    textColor: "#8400ff",
                  },
                },
                " ", // add a space after the mention
              ]);
            }
          },
        }));
      } catch (error) {
        console.error("[useMentionMenu] Error fetching mention items:", error);
        return [];
      }
    },
    [convex, editor]
  );

  return { getMentionMenuItems };
}

