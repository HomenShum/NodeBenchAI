/**
 * Canonical server-side markdown to TipTap JSON converter
 * Standardizes all document content to TipTap/ProseMirror format
 *
 * Supports rich media blocks for dossier documents:
 * - YouTube video embeds
 * - Images with captions
 * - Link previews (SEC documents, news articles)
 * - Blockquotes
 * - Code blocks
 */

import { z } from "zod";

export interface TipTapNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

export interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

/**
 * Media asset types that can be embedded in TipTap documents
 */
export interface MediaAsset {
  type: "youtube" | "image" | "sec-document" | "news" | "local-document" | "file";
  url: string;
  title?: string;
  thumbnail?: string;
  metadata?: any;
}

/**
 * Validation schema for TipTap documents
 */
export const TipTapDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.any()),
});

/**
 * Parse markdown text into inline marks (bold, italic, code)
 */
export function parseInlineMarks(text: string): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  const currentIndex = 0;

  // Regex patterns for markdown formatting (in order of precedence)
  const patterns: Array<{
    regex: RegExp;
    markType: string;
  }> = [
    { regex: /\*\*\*(.*?)\*\*\*/g, markType: "bold-italic" },
    { regex: /\*\*(.*?)\*\*/g, markType: "bold" },
    { regex: /\*(.*?)\*/g, markType: "italic" },
    { regex: /`(.*?)`/g, markType: "code" },
    { regex: /____(.*?)____/g, markType: "bold-italic" },
    { regex: /__(.*?)__/g, markType: "bold" },
    { regex: /_(.*?)_/g, markType: "italic" },
  ];

  let lastIndex = 0;
  const matches: Array<{ start: number; end: number; text: string; markType: string }> = [];

  // Find all matches
  for (const { regex, markType } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1],
        markType,
      });
    }
  }

  // Sort by start position and merge overlapping
  matches.sort((a, b) => a.start - b.start);

  for (const match of matches) {
    if (match.start >= lastIndex) {
      // Add plain text before this match
      if (match.start > lastIndex) {
        nodes.push({
          type: "text",
          text: text.substring(lastIndex, match.start),
        });
      }

      // Add marked text
      const marks: Array<{ type: string }> = [];
      if (match.markType.includes("bold")) marks.push({ type: "bold" });
      if (match.markType.includes("italic")) marks.push({ type: "italic" });
      if (match.markType === "code") marks.push({ type: "code" });

      nodes.push({
        type: "text",
        text: match.text,
        marks: marks.length > 0 ? marks : undefined,
      });

      lastIndex = match.end;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push({
      type: "text",
      text: text.substring(lastIndex),
    });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text }];
}

/**
 * Convert markdown string to TipTap document
 * Supports: headings, paragraphs, lists, code blocks, blockquotes
 */
export function markdownToTipTap(markdown: string): TipTapDocument {
  const lines = markdown.split("\n");
  const content: TipTapNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      content.push({
        type: "heading",
        attrs: { level, textAlignment: "left" },
        content: parseInlineMarks(text),
      });
      i++;
      continue;
    }

    // Code blocks
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // Skip closing ```

      content.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith(">")) {
      const quoteText = trimmed.slice(1).trim();
      content.push({
        type: "blockquote",
        attrs: { textAlignment: "left" },
        content: [
          {
            type: "paragraph",
            attrs: { textAlignment: "left" },
            content: parseInlineMarks(quoteText),
          },
        ],
      });
      i++;
      continue;
    }

    // Unordered lists
    if (trimmed.match(/^[-*]\s+/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^[-*]\s+/)) {
        const itemText = lines[i].trim().slice(2).trim();
        listItems.push(itemText);
        i++;
      }

      content.push({
        type: "bulletList",
        content: listItems.map((item) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { textAlignment: "left" },
              content: parseInlineMarks(item),
            },
          ],
        })),
      });
      continue;
    }

    // Ordered lists
    if (trimmed.match(/^\d+\.\s+/)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^\d+\.\s+/)) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
        listItems.push(itemText);
        i++;
      }

      content.push({
        type: "orderedList",
        attrs: { start: 1 },
        content: listItems.map((item) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { textAlignment: "left" },
              content: parseInlineMarks(item),
            },
          ],
        })),
      });
      continue;
    }

    // Paragraphs
    const paragraphLines: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() && !lines[i].trim().match(/^[#`>\-*\d]/)) {
      paragraphLines.push(lines[i].trim());
      i++;
    }

    const paragraphText = paragraphLines.join(" ");
    content.push({
      type: "paragraph",
      attrs: { textAlignment: "left" },
      content: parseInlineMarks(paragraphText),
    });
  }

  // Ensure non-empty content
  if (content.length === 0) {
    content.push({
      type: "paragraph",
      attrs: { textAlignment: "left" },
      content: [{ type: "text", text: "" }],
    });
  }

  return { type: "doc", content };
}

/**
 * Validate TipTap document structure
 */
export function validateTipTapDocument(doc: any): boolean {
  try {
    TipTapDocumentSchema.parse(doc);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract plain text from TipTap document for indexing/search
 */
export function extractTextFromTipTap(doc: TipTapDocument): string {
  const texts: string[] = [];

  function traverse(node: TipTapNode) {
    if (node.type === "text" && node.text) {
      texts.push(node.text);
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  doc.content.forEach(traverse);
  return texts.join(" ");
}

/**
 * Create a YouTube video embed block
 */
export function createYouTubeBlock(asset: MediaAsset): TipTapNode {
  // Extract video ID from URL
  const videoId = extractYouTubeVideoId(asset.url);
  if (!videoId) {
    // Fallback to paragraph with link if invalid URL
    return {
      type: "paragraph",
      attrs: { textAlignment: "left" },
      content: [
        { type: "text", text: `Video: ${asset.title || asset.url}` }
      ],
    };
  }

  // BlockNote uses "video" block type with URL attribute
  return {
    type: "video",
    attrs: {
      url: asset.url,
      caption: asset.title || "",
      previewWidth: 512,
    },
  };
}

/**
 * Create an image block
 */
export function createImageBlock(asset: MediaAsset): TipTapNode {
  return {
    type: "image",
    attrs: {
      url: asset.url,
      caption: asset.title || "",
      previewWidth: 512,
    },
  };
}

/**
 * Create a file/document block (for SEC docs, PDFs, etc.)
 */
export function createFileBlock(asset: MediaAsset): TipTapNode {
  return {
    type: "file",
    attrs: {
      url: asset.url,
      caption: asset.title || asset.url,
      name: asset.title || "Document",
    },
  };
}

/**
 * Create a blockquote (for news snippets, quotes)
 */
export function createBlockquote(text: string): TipTapNode {
  return {
    type: "blockquote",
    content: [
      {
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: parseInlineMarks(text),
      },
    ],
  };
}

/**
 * Create a link preview block (for news articles, SEC documents)
 * Uses a paragraph with formatted text and metadata
 */
export function createLinkPreviewBlock(asset: MediaAsset): TipTapNode[] {
  const blocks: TipTapNode[] = [];

  // Title as bold paragraph
  if (asset.title) {
    blocks.push({
      type: "paragraph",
      attrs: { textAlignment: "left" },
      content: [
        {
          type: "text",
          text: asset.title,
          marks: [{ type: "bold" }],
        },
      ],
    });
  }

  // Metadata as italic paragraph
  if (asset.metadata) {
    const metadataText: string[] = [];

    if (asset.type === "sec-document") {
      if (asset.metadata.filingType) metadataText.push(`Type: ${asset.metadata.filingType}`);
      if (asset.metadata.filingDate) metadataText.push(`Filed: ${asset.metadata.filingDate}`);
      if (asset.metadata.company) metadataText.push(`Company: ${asset.metadata.company}`);
    } else if (asset.type === "news") {
      if (asset.metadata.source) metadataText.push(`Source: ${asset.metadata.source}`);
    }

    if (metadataText.length > 0) {
      blocks.push({
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: [
          {
            type: "text",
            text: metadataText.join(" • "),
            marks: [{ type: "italic" }],
          },
        ],
      });
    }

    // Add snippet as blockquote for news
    if (asset.type === "news" && asset.metadata.snippet) {
      blocks.push(createBlockquote(asset.metadata.snippet));
    }
  }

  // URL as link
  blocks.push({
    type: "paragraph",
    attrs: { textAlignment: "left" },
    content: [
      {
        type: "text",
        text: asset.url,
        marks: [
          {
            type: "link",
            attrs: { href: asset.url },
          },
        ],
      },
    ],
  });

  return blocks;
}

/**
 * Helper: Extract YouTube video ID from URL
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}


/**
 * Convert an array of media assets to TipTap blocks
 * Groups assets by type and creates appropriate block structures
 */
export function convertMediaAssetsToTipTap(assets: MediaAsset[]): TipTapNode[] {
  const blocks: TipTapNode[] = [];

  if (assets.length === 0) return blocks;

  // Group assets by type
  const assetsByType: Record<string, MediaAsset[]> = {};
  for (const asset of assets) {
    if (!assetsByType[asset.type]) {
      assetsByType[asset.type] = [];
    }
    assetsByType[asset.type].push(asset);
  }

  // Add header
  blocks.push({
    type: "heading",
    attrs: { level: 2, textAlignment: "left" },
    content: [{ type: "text", text: "📎 Media & Resources" }],
  });

  // Add YouTube videos
  if (assetsByType["youtube"]) {
    blocks.push({
      type: "heading",
      attrs: { level: 3, textAlignment: "left" },
      content: [{ type: "text", text: "🎥 Videos" }],
    });

    for (const asset of assetsByType["youtube"]) {
      blocks.push(createYouTubeBlock(asset));
    }
  }

  // Add images
  if (assetsByType["image"]) {
    blocks.push({
      type: "heading",
      attrs: { level: 3, textAlignment: "left" },
      content: [{ type: "text", text: "🖼️ Images" }],
    });

    for (const asset of assetsByType["image"]) {
      blocks.push(createImageBlock(asset));
    }
  }

  // Add SEC documents
  if (assetsByType["sec-document"]) {
    blocks.push({
      type: "heading",
      attrs: { level: 3, textAlignment: "left" },
      content: [{ type: "text", text: "📄 SEC Documents" }],
    });

    for (const asset of assetsByType["sec-document"]) {
      blocks.push(...createLinkPreviewBlock(asset));
      // Add separator
      blocks.push({
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: [{ type: "text", text: "---" }],
      });
    }
  }

  // Add news articles
  if (assetsByType["news"]) {
    blocks.push({
      type: "heading",
      attrs: { level: 3, textAlignment: "left" },
      content: [{ type: "text", text: "📰 News Articles" }],
    });

    for (const asset of assetsByType["news"]) {
      blocks.push(...createLinkPreviewBlock(asset));
      // Add separator
      blocks.push({
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: [{ type: "text", text: "---" }],
      });
    }
  }

  // Add local documents
  if (assetsByType["local-document"]) {
    blocks.push({
      type: "heading",
      attrs: { level: 3, textAlignment: "left" },
      content: [{ type: "text", text: "📁 Referenced Documents" }],
    });

    for (const asset of assetsByType["local-document"]) {
      blocks.push({
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: [
          {
            type: "text",
            text: `📄 ${asset.title || "Document"}`,
            marks: [
              {
                type: "link",
                attrs: { href: asset.url },
              },
            ],
          },
        ],
      });
    }
  }

  return blocks;
}
