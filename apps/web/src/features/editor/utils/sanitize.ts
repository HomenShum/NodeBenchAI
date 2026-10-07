/**
 * ProseMirror content sanitization utilities
 * Extracted from UnifiedEditor.tsx for modularity
 */

/**
 * Sanitize ProseMirror content to remove unsupported node types
 * Converts unsupported nodes (like horizontalRule, mention, hashtag, taskItem, taskList) to supported alternatives
 *
 * TipTap uses taskItem/taskList, but BlockNote uses checkListItem.
 * This function converts between the two schemas.
 */
export const sanitizeProseMirrorContent = (content: any): any => {
  if (!content) return content;

  if (Array.isArray(content)) {
    return content
      .map(node => sanitizeProseMirrorContent(node))
      .filter(node => node !== null);
  }

  if (typeof content === 'object' && content.type) {
    // Convert mentions to plain text
    if (content.type === 'mention') {
      const label = content.attrs?.label || content.attrs?.id || '';
      return {
        type: 'text',
        text: `@${label}`,
        marks: content.marks || [],
      };
    }

    // Convert hashtags to plain text
    if (content.type === 'hashtag') {
      const name = content.attrs?.name || content.attrs?.label || '';
      return {
        type: 'text',
        text: `#${name}`,
        marks: content.marks || [],
      };
    }

    // Convert TipTap taskList to BlockNote-compatible structure
    // taskList contains taskItem children - we flatten them to checkListItem blocks
    if (content.type === 'taskList') {
      // Return the sanitized children (taskItems will be converted to checkListItem)
      if (content.content && Array.isArray(content.content)) {
        return content.content
          .map((node: any) => sanitizeProseMirrorContent(node))
          .filter((node: any) => node !== null);
      }
      return null;
    }

    // Convert TipTap taskItem to BlockNote checkListItem
    if (content.type === 'taskItem') {
      const checked = content.attrs?.checked ?? false;
      // Extract text content from taskItem
      const textContent = content.content
        ? content.content
          .map((node: any) => sanitizeProseMirrorContent(node))
          .filter((node: any) => node !== null)
        : [];

      return {
        type: 'checkListItem',
        attrs: {
          checked: checked,
        },
        content: textContent,
      };
    }

    // Convert TipTap listItem to BlockNote bulletListItem
    // TipTap uses listItem inside bulletList/orderedList, BlockNote uses bulletListItem/numberedListItem
    if (content.type === 'listItem') {
      // Extract text content from listItem
      const textContent = content.content
        ? content.content
          .map((node: any) => sanitizeProseMirrorContent(node))
          .filter((node: any) => node !== null)
        : [];

      // listItem often contains a paragraph, extract its content for inline display
      // If the content is a single paragraph, use its content directly
      let finalContent = textContent;
      if (textContent.length === 1 && textContent[0]?.type === 'paragraph' && textContent[0]?.content) {
        finalContent = textContent[0].content;
      }

      return {
        type: 'bulletListItem',
        attrs: {},
        content: finalContent,
      };
    }

    // Convert bulletList to flattened bulletListItems
    if (content.type === 'bulletList') {
      if (content.content && Array.isArray(content.content)) {
        return content.content
          .map((node: any) => sanitizeProseMirrorContent(node))
          .filter((node: any) => node !== null);
      }
      return null;
    }

    // Convert orderedList to flattened numberedListItems
    if (content.type === 'orderedList') {
      if (content.content && Array.isArray(content.content)) {
        return content.content
          .map((node: any) => {
            const sanitized = sanitizeProseMirrorContent(node);
            // Convert bulletListItem to numberedListItem for ordered lists
            if (sanitized && sanitized.type === 'bulletListItem') {
              return { ...sanitized, type: 'numberedListItem' };
            }
            return sanitized;
          })
          .filter((node: any) => node !== null);
      }
      return null;
    }

    // Remove unsupported block types
    const unsupportedTypes = ['horizontalRule'];
    if (unsupportedTypes.includes(content.type)) {
      return null; // Filter out
    }

    // Recursively sanitize nested content
    if (content.content && Array.isArray(content.content)) {
      let sanitized = content.content
        .map((node: any) => sanitizeProseMirrorContent(node))
        .filter((node: any) => node !== null);

      // Flatten arrays (from taskList conversion)
      sanitized = sanitized.flat();

      // For doc/blockGroup/blockContainer nodes, wrap any bare text nodes in paragraphs
      // BlockNote expects bnBlock children, not raw text nodes
      const blockContainerTypes = ['doc', 'blockGroup', 'blockContainer'];
      if (blockContainerTypes.includes(content.type)) {
        sanitized = sanitized.map((child: any) => {
          if (!child || typeof child !== 'object') return child;

          if (child.type === 'text' && typeof child.text === 'string') {
            return {
              type: 'blockContainer',
              content: [
                { type: 'paragraph', attrs: { textAlignment: 'left' }, content: [child] }
              ]
            };
          }

          // If it's a structural node but not wrapped in blockContainer, wrap it
          const needsWrapper = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletListItem', 'numberedListItem', 'checkListItem'].includes(child.type);
          if (needsWrapper) {
            return {
              type: 'blockContainer',
              content: [child]
            };
          }

          return child;
        });
      }

      return {
        ...content,
        content: sanitized.length > 0 ? sanitized : undefined,
      };
    }
  }

  return content;
};

