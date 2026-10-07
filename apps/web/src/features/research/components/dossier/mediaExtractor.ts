// src/components/views/dossier/mediaExtractor.ts
// Utility to extract media assets from EditorJS blocks for DossierViewer

export interface VideoAsset {
  type: 'youtube';
  videoId: string;
  url: string;
  thumbnail: string;
  caption?: string;
  title?: string;
  channel?: string;
}

export interface ImageAsset {
  type: 'image';
  url: string;
  caption?: string;
  alt?: string;
}

export interface DocumentAsset {
  type: 'document' | 'link';
  url: string;
  title: string;
  description?: string;
  thumbnail?: string;
  domain?: string;
}

export interface ExtractedMedia {
  videos: VideoAsset[];
  images: ImageAsset[];
  documents: DocumentAsset[];
}

/**
 * Extract all media assets from EditorJS blocks
 */
export function extractMediaFromBlocks(blocks: any[]): ExtractedMedia {
  const videos: VideoAsset[] = [];
  const images: ImageAsset[] = [];
  const documents: DocumentAsset[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'embed': {
        const video = extractVideoFromEmbed(block);
        if (video) videos.push(video);
        break;
      }
      case 'image': {
        const image = extractImageFromBlock(block);
        if (image) images.push(image);
        break;
      }
      case 'linkTool': {
        const doc = extractDocumentFromLink(block);
        if (doc) documents.push(doc);
        break;
      }
      case 'paragraph': {
        const docs = extractDocumentsFromParagraph(block);
        if (docs.length) documents.push(...docs);
        break;
      }
    }
  }

  return { videos, images, documents };
}

/**
 * Extract document links from paragraph blocks (fallback for plain URLs or <a href="...">)
 */
function extractDocumentsFromParagraph(block: any): DocumentAsset[] {
  const text: string = block.data?.text || '';
  if (!text) return [];

  const results: DocumentAsset[] = [];

  // 1) Extract from anchor tags href
  const anchorHrefRegex = /href=\"([^\"]+)\"/g;
  let match: RegExpExecArray | null;
  while ((match = anchorHrefRegex.exec(text)) !== null) {
    const url = match[1];
    if (isHttpUrl(url)) {
      results.push({ type: 'document', url, title: url });
    }
  }

  // 2) Extract raw http(s) URLs in text
  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[1];
    if (isHttpUrl(url)) {
      results.push({ type: 'document', url, title: url });
    }
  }

  return dedupeDocuments(results);
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function dedupeDocuments(docs: DocumentAsset[]): DocumentAsset[] {
  const seen = new Set<string>();
  const out: DocumentAsset[] = [];
  for (const d of docs) {
    if (!seen.has(d.url)) {
      seen.add(d.url);
      out.push(d);
    }
  }
  return out;
}

/**
 * Extract YouTube video from embed block
 */
function extractVideoFromEmbed(block: any): VideoAsset | null {
  const embedUrl = block.data?.source || block.data?.embed || '';
  const isYouTube = embedUrl.includes('youtube.com') || embedUrl.includes('youtu.be');

  if (!isYouTube) return null;

  // Extract video ID
  let videoId = '';
  if (embedUrl.includes('youtube.com/watch?v=')) {
    videoId = embedUrl.split('v=')[1]?.split('&')[0] || '';
  } else if (embedUrl.includes('youtu.be/')) {
    videoId = embedUrl.split('youtu.be/')[1]?.split('?')[0] || '';
  } else if (embedUrl.includes('youtube.com/embed/')) {
    videoId = embedUrl.split('embed/')[1]?.split('?')[0] || '';
  }

  if (!videoId) return null;

  return {
    type: 'youtube',
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    caption: block.data?.caption,
  };
}

/**
 * Extract image from image block
 */
function extractImageFromBlock(block: any): ImageAsset | null {
  const url = block.data?.file?.url;
  if (!url) return null;

  return {
    type: 'image',
    url,
    caption: block.data?.caption,
    alt: block.data?.caption || 'Image',
  };
}

/**
 * Extract document/link from linkTool block
 */
function extractDocumentFromLink(block: any): DocumentAsset | null {
  const url = block.data?.link;
  if (!url) return null;

  const title = block.data?.meta?.title || url;
  const description = block.data?.meta?.description || '';
  const thumbnail = block.data?.meta?.image?.url || '';

  // Extract domain
  let domain = '';
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace('www.', '');
  } catch {
    domain = url;
  }

  return {
    type: 'link',
    url,
    title,
    description,
    thumbnail,
    domain,
  };
}

/**
 * Count media assets by type
 */
export function countMediaAssets(media: ExtractedMedia): {
  videos: number;
  images: number;
  documents: number;
  total: number;
} {
  return {
    videos: media.videos.length,
    images: media.images.length,
    documents: media.documents.length,
    total: media.videos.length + media.images.length + media.documents.length,
  };
}

/**
 * Check if a block contains media
 */
export function isMediaBlock(block: any): boolean {
  return block.type === 'embed' || block.type === 'image' || block.type === 'linkTool';
}

/**
 * Get media type from block
 */
export function getMediaTypeFromBlock(block: any): 'video' | 'image' | 'document' | null {
  switch (block.type) {
    case 'embed':
      const embedUrl = block.data?.source || block.data?.embed || '';
      if (embedUrl.includes('youtube.com') || embedUrl.includes('youtu.be')) {
        return 'video';
      }
      return null;
    case 'image':
      return 'image';
    case 'linkTool':
      return 'document';
    default:
      return null;
  }
}

