// Helper functions for Research Dossier pattern
// Extracts media assets from chat messages and builds rich text transcripts

import { Id } from "../_generated/dataModel";

export type ExtractedAsset = {
  type: "image" | "video" | "youtube" | "sec-document" | "pdf" | "news" | "file" | "local-document";
  url: string;
  title?: string;
  thumbnail?: string;
  timestamp: number;
  toolName?: string;
  metadata?: any;
  documentId?: string; // For local documents
};

/**
 * Extract all media assets from agent messages
 * Parses tool outputs from message parts to find embedded media
 * Supports both old format (message.parts) and new format (message.message.content)
 */
export function extractMediaFromMessages(messages: any[]): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];
  const seenUrls = new Set<string>();

  console.log(`[extractMediaFromMessages] Processing ${messages.length} messages`);

  for (const message of messages) {
    // Skip user messages
    if (message.role === "user" || message.message?.role === "user") continue;

    // Get parts array - support both old and new message formats
    let parts: any[] = [];

    // New format: message.message.content is an array
    if (message.message?.content && Array.isArray(message.message.content)) {
      parts = message.message.content;
    }
    // Old format: message.parts is an array
    else if (message.parts && Array.isArray(message.parts)) {
      parts = message.parts;
    }

    if (parts.length === 0) continue;

    const toolResultParts = parts.filter((p: any) => p.type === "tool-result");
    if (toolResultParts.length > 0) {
      console.log(`[extractMediaFromMessages] Found ${toolResultParts.length} tool-result parts in message ${message._id}`);
    }

    for (const part of parts) {
      // Tool result parts contain the output from tool executions
      if (part.type === "tool-result") {
        const toolName = part.toolName || "unknown";
        const timestamp = message._creationTime || Date.now();

        console.log(`[extractMediaFromMessages] Processing tool-result: ${toolName}`);

        // Get the output - support multiple formats
        let output: any = null;
        if (part.output?.value) {
          // New format: part.output.value
          output = part.output.value;
          console.log(`[extractMediaFromMessages] Using part.output.value format`);
        } else if (part.output) {
          // Old format: part.output directly
          output = part.output;
          console.log(`[extractMediaFromMessages] Using part.output format`);
        } else if (part.result) {
          // Alternative format: part.result
          output = part.result;
          console.log(`[extractMediaFromMessages] Using part.result format`);
        }

        if (!output) {
          console.log(`[extractMediaFromMessages] No output found for tool ${toolName}`);
          continue;
        }

        console.log(`[extractMediaFromMessages] Output type: ${typeof output}, preview: ${JSON.stringify(output).substring(0, 200)}`);


        // Extract based on tool name
        if (toolName === "findDocument" || toolName === "openDocument" || toolName === "doc.find" || toolName === "doc.open") {
          const localDocs = extractLocalDocuments(output, timestamp, toolName);
          for (const asset of localDocs) {
            if (!seenUrls.has(asset.url)) {
              assets.push(asset);
              seenUrls.add(asset.url);
            }
          }
        } else if (toolName === "youtubeSearch") {
          const youtubeAssets = extractYouTubeVideos(output, timestamp, toolName);
          for (const asset of youtubeAssets) {
            if (!seenUrls.has(asset.url)) {
              assets.push(asset);
              seenUrls.add(asset.url);
            }
          }
        } else if (toolName === "searchSecFilings" || toolName === "downloadSecFiling") {
          const secAssets = extractSECDocuments(output, timestamp, toolName);
          for (const asset of secAssets) {
            if (!seenUrls.has(asset.url)) {
              assets.push(asset);
              seenUrls.add(asset.url);
            }
          }
        } else if (toolName === "linkupSearch") {
          const linkupAssets = extractLinkupMedia(output, timestamp, toolName);
          for (const asset of linkupAssets) {
            if (!seenUrls.has(asset.url)) {
              assets.push(asset);
              seenUrls.add(asset.url);
            }
          }
        } else if (toolName === "searchMedia") {
          const mediaAssets = extractSearchMedia(output, timestamp, toolName);
          for (const asset of mediaAssets) {
            if (!seenUrls.has(asset.url)) {
              assets.push(asset);
              seenUrls.add(asset.url);
            }
          }
        }
      }
    }
  }

  return assets;
}

/**
 * Extract local document references from findDocument/openDocument tool outputs
 */
function extractLocalDocuments(output: any, timestamp: number, toolName: string): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  try {
    if (typeof output !== "string") return assets;

    // Pattern 1: "ID: <documentId>" format from findDocument
    const idPattern = /ID:\s*([a-z0-9]{32})/gi;
    const idMatches = output.matchAll(idPattern);

    // Pattern 2: "Document: "<title>"" format
    const titlePattern = /Document:\s*"([^"]+)"/gi;
    const titleMatches = Array.from(output.matchAll(titlePattern));

    const idMatchesArray = Array.from(idMatches);

    console.log(`[extractLocalDocuments] Found ${idMatchesArray.length} document IDs`);

    for (let i = 0; i < idMatchesArray.length; i++) {
      const idMatch = idMatchesArray[i];
      const documentId = idMatch[1];

      // Try to find corresponding title
      let title = "Local Document";
      if (titleMatches[i]) {
        title = titleMatches[i][1];
      }

      console.log(`[extractLocalDocuments] Found document: ${title} (${documentId})`);

      assets.push({
        type: "local-document",
        url: `/documents/${documentId}`, // Internal app URL
        documentId: documentId,
        title: title,
        timestamp,
        toolName,
        metadata: {},
      });
    }
  } catch (error) {
    console.error("Error extracting local documents:", error);
  }

  return assets;
}

/**
 * Extract YouTube videos from youtubeSearch tool output
 */
function extractYouTubeVideos(output: any, timestamp: number, toolName: string): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  try {
    // Handle different output formats
    let data = output;
    
    // If output is a string, try to parse as JSON
    if (typeof output === "string") {
      try {
        data = JSON.parse(output);
      } catch {
        // If not JSON, try to extract video IDs from text
        const videoIdRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
        const matches = output.matchAll(videoIdRegex);
        for (const match of matches) {
          const videoId = match[1];
          assets.push({
            type: "youtube",
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
            timestamp,
            toolName,
          });
        }
        return assets;
      }
    }

    // Handle JSON output with videos array
    if (data && Array.isArray(data.videos)) {
      for (const video of data.videos) {
        if (video.videoId) {
          assets.push({
            type: "youtube",
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            title: video.title,
            thumbnail: video.thumbnail || `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`,
            timestamp,
            toolName,
            metadata: {
              channelTitle: video.channelTitle,
              description: video.description,
              publishedAt: video.publishedAt,
            },
          });
        }
      }
    }
  } catch (error) {
    console.error("Error extracting YouTube videos:", error);
  }

  return assets;
}

/**
 * Extract SEC documents from SEC filing tool outputs
 */
function extractSECDocuments(output: any, timestamp: number, toolName: string): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  try {
    let data = output;
    
    if (typeof output === "string") {
      try {
        data = JSON.parse(output);
      } catch {
        // Try to extract SEC URLs from text
        const secUrlRegex = /https?:\/\/www\.sec\.gov\/[^\s]+/g;
        const matches = output.matchAll(secUrlRegex);
        for (const match of matches) {
          assets.push({
            type: "sec-document",
            url: match[0],
            timestamp,
            toolName,
          });
        }
        return assets;
      }
    }

    // Handle JSON output with filings array
    if (data && Array.isArray(data.filings)) {
      for (const filing of data.filings) {
        if (filing.url || filing.documentUrl) {
          assets.push({
            type: "sec-document",
            url: filing.url || filing.documentUrl,
            title: filing.formType ? `${filing.formType} - ${filing.companyName || ""}` : filing.companyName,
            timestamp,
            toolName,
            metadata: {
              formType: filing.formType,
              companyName: filing.companyName,
              filingDate: filing.filingDate,
              cik: filing.cik,
            },
          });
        }
      }
    }
  } catch (error) {
    console.error("Error extracting SEC documents:", error);
  }

  return assets;
}

/**
 * Extract images and news from linkupSearch tool output
 */
function extractLinkupMedia(output: any, timestamp: number, toolName: string): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  try {
    let data = output;

    if (typeof output === "string") {
      try {
        data = JSON.parse(output);
      } catch {
        // If not JSON, try to extract from markdown format
        console.log(`[extractLinkupMedia] Parsing markdown format...`);

        // Extract images from markdown: ![alt text](url)
        const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const imageMatches = output.matchAll(markdownImageRegex);

        let imageCount = 0;
        for (const match of imageMatches) {
          const altText = match[1];
          const url = match[2];

          // Skip GIFs and very small images (likely icons)
          if (url.toLowerCase().endsWith('.gif')) {
            console.log(`[extractLinkupMedia] Skipping GIF: ${url}`);
            continue;
          }

          imageCount++;
          assets.push({
            type: "image",
            url: url,
            title: altText || "Image from search",
            thumbnail: url,
            timestamp,
            toolName,
            metadata: {},
          });
        }
        console.log(`[extractLinkupMedia] Extracted ${imageCount} images from markdown`);

        // Extract news articles from SOURCE_GALLERY_DATA JSON comment
        const sourceGalleryRegex = /<!--\s*SOURCE_GALLERY_DATA\s*\n([\s\S]*?)\n-->/;
        const galleryMatch = output.match(sourceGalleryRegex);

        if (galleryMatch && galleryMatch[1]) {
          try {
            const galleryData = JSON.parse(galleryMatch[1]);
            console.log(`[extractLinkupMedia] Found SOURCE_GALLERY_DATA with ${galleryData.length} items`);

            if (Array.isArray(galleryData)) {
              for (const item of galleryData) {
                if (item.url && item.title) {
                  assets.push({
                    type: "news",
                    url: item.url,
                    title: item.title,
                    thumbnail: undefined,
                    timestamp,
                    toolName,
                    metadata: {
                      snippet: item.description,
                      source: item.domain,
                    },
                  });
                }
              }
              console.log(`[extractLinkupMedia] Extracted ${galleryData.length} news articles from SOURCE_GALLERY_DATA`);
            }
          } catch (error) {
            console.log(`[extractLinkupMedia] Failed to parse SOURCE_GALLERY_DATA:`, error);
          }
        }

        return assets;
      }
    }

    // Extract images
    if (data && Array.isArray(data.images)) {
      for (const image of data.images) {
        if (image.url) {
          assets.push({
            type: "image",
            url: image.url,
            title: image.title,
            thumbnail: image.thumbnail || image.url,
            timestamp,
            toolName,
            metadata: {
              source: image.source,
              width: image.width,
              height: image.height,
            },
          });
        }
      }
    }

    // Extract news articles as "news" type
    if (data && Array.isArray(data.results)) {
      for (const result of data.results) {
        if (result.url) {
          assets.push({
            type: "news",
            url: result.url,
            title: result.title,
            thumbnail: result.image,
            timestamp,
            toolName,
            metadata: {
              snippet: result.snippet,
              source: result.source,
            },
          });
        }
      }
    }
  } catch (error) {
    console.error("Error extracting Linkup media:", error);
  }

  return assets;
}

/**
 * Extract media from searchMedia tool output
 */
function extractSearchMedia(output: any, timestamp: number, toolName: string): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  try {
    let data = output;
    
    if (typeof output === "string") {
      try {
        data = JSON.parse(output);
      } catch {
        return assets;
      }
    }

    // Handle media files array
    if (data && Array.isArray(data.files)) {
      for (const file of data.files) {
        if (file.url || file.storageId) {
          const type = file.mimeType?.startsWith("video/") ? "video" : 
                      file.mimeType?.startsWith("image/") ? "image" : "file";
          
          assets.push({
            type,
            url: file.url || file.storageId,
            title: file.name || file.title,
            thumbnail: file.thumbnail,
            timestamp,
            toolName,
            metadata: {
              mimeType: file.mimeType,
              size: file.size,
            },
          });
        }
      }
    }
  } catch (error) {
    console.error("Error extracting search media:", error);
  }

  return assets;
}

