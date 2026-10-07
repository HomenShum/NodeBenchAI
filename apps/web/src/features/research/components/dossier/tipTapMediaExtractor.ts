/**
 * Extract media assets from TipTap JSON content
 * Replaces EditorJS-based media extraction for dossier documents
 */

import type { VideoAsset, ImageAsset, DocumentAsset } from './mediaExtractor';

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

export interface ExtractedMedia {
  videos: VideoAsset[];
  images: ImageAsset[];
  documents: DocumentAsset[];
}

/**
 * Extract all media assets from TipTap document
 */
export function extractMediaFromTipTap(doc: TipTapDocument | null): ExtractedMedia {
  const videos: VideoAsset[] = [];
  const images: ImageAsset[] = [];
  const documents: DocumentAsset[] = [];

  if (!doc || !doc.content) {
    return { videos, images, documents };
  }

  function traverse(node: TipTapNode) {
    // Extract based on node type
    switch (node.type) {
      case 'video': {
        const video = extractVideoFromNode(node);
        if (video) videos.push(video);
        break;
      }
      case 'image': {
        const image = extractImageFromNode(node);
        if (image) images.push(image);
        break;
      }
      case 'file': {
        const doc = extractFileFromNode(node);
        if (doc) documents.push(doc);
        break;
      }
      case 'paragraph': {
        // Extract links from paragraph content
        const docs = extractLinksFromParagraph(node);
        if (docs.length) documents.push(...docs);
        break;
      }
    }

    // Recursively traverse child nodes
    if (node.content) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  for (const node of doc.content) {
    traverse(node);
  }

  return { videos, images, documents };
}

/**
 * Extract video from video node
 */
function extractVideoFromNode(node: TipTapNode): VideoAsset | null {
  const url = node.attrs?.url;
  if (!url) return null;

  // Extract YouTube video ID
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;

  return {
    type: 'youtube',
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    caption: node.attrs?.caption,
  };
}

/**
 * Extract image from image node
 */
function extractImageFromNode(node: TipTapNode): ImageAsset | null {
  const url = node.attrs?.url;
  if (!url) return null;

  return {
    type: 'image',
    url,
    caption: node.attrs?.caption,
    alt: node.attrs?.caption || 'Image',
  };
}

/**
 * Extract file/document from file node
 */
function extractFileFromNode(node: TipTapNode): DocumentAsset | null {
  const url = node.attrs?.url;
  if (!url) return null;

  return {
    type: 'document',
    url,
    title: node.attrs?.name || node.attrs?.caption || url,
    thumbnail: undefined,
  };
}

/**
 * Extract document links from paragraph content
 * Looks for links with specific patterns (SEC docs, news, local docs)
 */
function extractLinksFromParagraph(node: TipTapNode): DocumentAsset[] {
  const documents: DocumentAsset[] = [];

  if (!node.content) return documents;

  function extractFromContent(content: TipTapNode[]) {
    for (const child of content) {
      // Check if this is a text node with link mark
      if (child.type === 'text' && child.marks) {
        const linkMark = child.marks.find(m => m.type === 'link');
        if (linkMark?.attrs?.href) {
          const url = linkMark.attrs.href;
          const title = child.text || url;

          // Only extract if it looks like a document link (not internal navigation)
          if (url.startsWith('http') || url.startsWith('/documents/')) {
            documents.push({
              type: 'document',
              url,
              title,
              thumbnail: undefined,
            });
          }
        }
      }

      // Recursively check child content
      if (child.content) {
        extractFromContent(child.content);
      }
    }
  }

  extractFromContent(node.content);
  return documents;
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
 * Count media assets by type
 */
export function countMediaAssets(media: ExtractedMedia): { videos: number; images: number; documents: number; total: number } {
  return {
    videos: media.videos.length,
    images: media.images.length,
    documents: media.documents.length,
    total: media.videos.length + media.images.length + media.documents.length,
  };
}

