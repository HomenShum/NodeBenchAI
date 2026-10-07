// src/components/FastAgentPanel/utils/mediaExtractor.ts
// Utility to extract media (videos, documents, images) from text content

import type { YouTubeVideo, SECDocument } from '../MediaGallery';

export interface WebSource {
  title: string;
  url: string;
  domain?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  publishedAt?: string;
}

export interface PersonProfile {
  name: string;
  profession?: string;
  organization?: string;
  location?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  additionalInfo?: string;
}

export interface ExtractedMedia {
  youtubeVideos: YouTubeVideo[];
  secDocuments: SECDocument[];
  webSources: WebSource[];
  profiles: PersonProfile[];
  images: Array<{ url: string; alt: string }>;
}

/**
 * Extract all media types from text content
 * Looks for HTML comment markers and markdown image syntax
 */
export function extractMediaFromText(text: string): ExtractedMedia {
  return {
    youtubeVideos: extractYouTubeVideos(text),
    secDocuments: extractSECDocuments(text),
    webSources: extractWebSources(text),
    profiles: extractProfiles(text),
    images: extractImages(text),
  };
}

/**
 * Extract YouTube videos from HTML comment markers OR plain text format
 * Format 1: <!-- YOUTUBE_GALLERY_DATA\n[...]\n-->
 * Format 2: Plain text with "Video ID: xxx" and "YouTube: https://..." and "Thumbnail: https://..."
 */
function extractYouTubeVideos(text: string): YouTubeVideo[] {
  // Try HTML comment marker first
  const youtubeMatch = text.match(/<!-- YOUTUBE_GALLERY_DATA\s*([\s\S]*?)\s*-->/);
  if (youtubeMatch) {
    try {
      const videos = JSON.parse(youtubeMatch[1]);
      return Array.isArray(videos) ? videos : [];
    } catch (error) {
    }
  }

  // Fallback: Parse plain text format (when agent synthesizes response)
  // Look for patterns like:
  // - Video ID: d5EltXhbcfA
  // - YouTube: https://www.youtube.com/watch?v=d5EltXhbcfA
  // - Thumbnail: https://i.ytimg.com/vi/d5EltXhbcfA/mqdefault.jpg
  // - Channel: AI Engineer
  // - Title: Building and evaluating AI Agents
  const videos: YouTubeVideo[] = [];

  // Match video blocks (numbered list items with video details)
  const videoBlockRegex = /(?:^|\n)\d+\.\s*(?:Title:\s*)?(.*?)(?:\n|$)[\s\S]*?(?:Channel:\s*)(.*?)(?:\n|$)[\s\S]*?(?:YouTube:\s*)(https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+))[\s\S]*?(?:Video ID:\s*)([a-zA-Z0-9_-]+)[\s\S]*?(?:Thumbnail:\s*)(https:\/\/i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\/[^)\s]+)/g;

  let match;
  while ((match = videoBlockRegex.exec(text)) !== null) {
    const [, title, channel, url, videoId1, videoId2, thumbnail, videoId3] = match;
    const videoId = videoId1 || videoId2 || videoId3;

    if (videoId && title && channel) {
      videos.push({
        title: title.trim(),
        channel: channel.trim(),
        url: url.trim(),
        videoId: videoId.trim(),
        thumbnail: thumbnail?.trim() || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        description: '', // Not available in plain text format
      });
    }
  }

  return videos;
}

/**
 * Extract SEC documents from HTML comment markers
 * Format: <!-- SEC_GALLERY_DATA\n[...]\n-->
 */
function extractSECDocuments(text: string): SECDocument[] {
  const secMatch = text.match(/<!-- SEC_GALLERY_DATA\s*([\s\S]*?)\s*-->/);
  if (!secMatch) return [];

  try {
    const documents = JSON.parse(secMatch[1]);
    return Array.isArray(documents) ? documents : [];
  } catch (error) {
    return [];
  }
}

/**
 * Extract web sources from HTML comment markers
 * Format: <!-- SOURCE_GALLERY_DATA\n[...]\n-->
 */
function extractWebSources(text: string): WebSource[] {
  const sourceMatch = text.match(/<!-- SOURCE_GALLERY_DATA\s*([\s\S]*?)\s*-->/);
  if (!sourceMatch) return [];

  try {
    const sources = JSON.parse(sourceMatch[1]);
    return Array.isArray(sources) ? sources : [];
  } catch (error) {
    return [];
  }
}

/**
 * Extract person profiles from HTML comment markers
 * Format: <!-- PROFILE_GALLERY_DATA\n[...]\n-->
 */
function extractProfiles(text: string): PersonProfile[] {
  const profileMatch = text.match(/<!-- PROFILE_GALLERY_DATA\s*([\s\S]*?)\s*-->/);
  if (!profileMatch) return [];

  try {
    const profiles = JSON.parse(profileMatch[1]);
    return Array.isArray(profiles) ? profiles : [];
  } catch (error) {
    return [];
  }
}

/**
 * Extract images from HTML comment markers, markdown syntax, AND plain text URLs
 * Format 1: <!-- IMAGE_DATA\n[...]\n-->
 * Format 2: ![alt text](url)
 * Format 3: Plain text with image URLs (e.g., "Paris skyline — https://example.com/image.jpg")
 */
function extractImages(text: string): Array<{ url: string; alt: string }> {
  const images: Array<{ url: string; alt: string }> = [];

  // Try HTML comment marker first (highest priority - structured data from tool)
  const imageDataMatch = text.match(/<!-- IMAGE_DATA\s*([\s\S]*?)\s*-->/);
  if (imageDataMatch) {
    try {
      const imageData = JSON.parse(imageDataMatch[1]);
      if (Array.isArray(imageData)) {
        images.push(...imageData.map((img: any) => ({
          url: img.url || '',
          alt: img.alt || img.name || 'Image'
        })));
        return images; // Return early if we have structured data
      }
    } catch (error) {
    }
  }

  // Extract markdown images: ![alt](url)
  const imageMatches = text.match(/!\[.*?\]\(.*?\)/g) || [];
  const markdownImages = imageMatches
    .map(match => {
      const urlMatch = match.match(/\((.*?)\)/);
      const altMatch = match.match(/!\[(.*?)\]/);
      return {
        url: urlMatch?.[1] || '',
        alt: altMatch?.[1] || 'Image'
      };
    })
    .filter(img => img.url && img.url.trim().length > 0);

  images.push(...markdownImages);

  // Extract plain text image URLs from list items
  // Pattern: "- Description — https://example.com/image.jpg"
  // Common image extensions: jpg, jpeg, png, gif, webp, svg
  const imageUrlPattern = /[-•]\s*([^—\n]+?)\s*[—–-]\s*(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?)/gi;
  let match;
  while ((match = imageUrlPattern.exec(text)) !== null) {
    const [, description, url] = match;
    const cleanUrl = url.trim();
    // Avoid duplicates
    if (!images.some(img => img.url === cleanUrl)) {
      images.push({
        url: cleanUrl,
        alt: description.trim() || 'Image'
      });
    }
  }

  // Also extract standalone image URLs (not in lists)
  // Pattern: "https://example.com/image.jpg" on its own line or after text
  const standaloneUrlPattern = /(?:^|\s)(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?)/gi;
  const standaloneMatches = text.match(standaloneUrlPattern) || [];
  for (const urlMatch of standaloneMatches) {
    const url = urlMatch.trim();
    // Avoid duplicates
    if (!images.some(img => img.url === url)) {
      images.push({
        url,
        alt: 'Image'
      });
    }
  }

  if (images.length > 0) {
  }

  return images;
}

/**
 * Remove media markers from text to avoid duplicate display
 * Removes HTML comment markers, "## Images" headers, image markdown, and plain image URL lists
 */
export function removeMediaMarkersFromText(text: string): string {
  let cleaned = text
    .replace(/<!-- YOUTUBE_GALLERY_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- SEC_GALLERY_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- SOURCE_GALLERY_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- PROFILE_GALLERY_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- COMPANY_SELECTION_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- PEOPLE_SELECTION_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- EVENT_SELECTION_DATA\s*[\s\S]*?\s*-->\s*/g, '')
    .replace(/<!-- NEWS_SELECTION_DATA\s*[\s\S]*?\s*-->\s*/g, '');

  // Remove "## Images" section entirely (header + all images in that section)
  // This regex matches "## Images" followed by any content until the next heading or end
  // It captures the header, newlines, and all markdown images that follow
  cleaned = cleaned.replace(/## Images\s*\n+(?:!\[.*?\]\(.*?\)\s*)+/g, '');

  // Also remove any standalone "## Images" headers that might remain
  cleaned = cleaned.replace(/## Images\s*\n*/g, '');

  // Remove "Images (examples)" section with plain URL lists
  // Pattern: "Images (examples)" followed by list items with image URLs
  cleaned = cleaned.replace(/Images\s*\(examples\)\s*\n+(?:[-•]\s*[^—\n]+?[—–-]\s*https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?\s*\n*)+/gi, '');

  // Remove individual list items with image URLs
  cleaned = cleaned.replace(/[-•]\s*[^—\n]+?[—–-]\s*https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s]*)?\s*\n*/gi, '');

  return cleaned;
}

/**
 * Check if text contains any media
 */
export function hasMedia(media: ExtractedMedia): boolean {
  return (
    media.youtubeVideos.length > 0 ||
    media.secDocuments.length > 0 ||
    media.webSources.length > 0 ||
    media.profiles.length > 0 ||
    media.images.length > 0
  );
}

