// convex/tools/mediaTools.ts
// Media management tools for Convex Agent
// Enables voice-controlled image/video operations

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

/**
 * Search for images and videos by topic or filename
 * Voice: "Find images about architecture" or "Show me videos from last month"
 */
export const searchMedia = createTool({
  description: "Search for images and videos by topic, filename, or content. Returns a list of media files with preview URLs. Use this when the user wants to find images or videos.",
  
  args: z.object({
    query: z.string().describe("Search query - can be filename, topic, or content description"),
    mediaType: z.enum(["image", "video", "all"]).default("all").describe("Type of media to search for"),
    limit: z.number().default(20).describe("Maximum number of results (default: 20, max: 50)"),
    useWebSearch: z.boolean().default(false).describe("Whether to also search the web for images (uses linkupSearch)"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[searchMedia] Searching for ${args.mediaType}: "${args.query}"`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;
    console.log(`[searchMedia] userId:`, userId);

    const results: any[] = [];

    // Search internal files
    // Note: We'll need to query documents with documentType="file" and filter by fileType
    const allDocs = await ctx.runQuery(api.domains.documents.documents.getSearch, {
      query: args.query,
      userId, // Pass userId for evaluation
    });
    console.log(`[searchMedia] getSearch returned ${allDocs.length} documents`);
    console.log(`[searchMedia] First few docs:`, allDocs.slice(0, 5).map((d: any) => ({ title: d.title, fileType: d.fileType, documentType: d.documentType })));

    // Filter for media files
    const mediaFiles = allDocs.filter((doc: any) => {
      const fileType = (doc.fileType || '').toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(fileType);
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(fileType);

      if (args.mediaType === 'image') return isImage;
      if (args.mediaType === 'video') return isVideo;
      return isImage || isVideo;
    });
    console.log(`[searchMedia] After filtering, ${mediaFiles.length} media files found`);
    
    // Format internal results
    for (const doc of mediaFiles.slice(0, args.limit)) {
      const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
        documentId: doc._id,
        userId, // Pass userId for evaluation
      });
      
      if (fileDoc && fileDoc.file) {
        const fileSizeMB = (fileDoc.file.fileSize / (1024 * 1024)).toFixed(2);
        const mediaType = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes((doc.fileType || '').toLowerCase()) ? 'image' : 'video';
        
        results.push({
          id: doc._id,
          title: doc.title,
          type: mediaType,
          fileType: doc.fileType,
          size: `${fileSizeMB} MB`,
          url: fileDoc.storageUrl || 'URL not available',
          analysis: fileDoc.file.analysis ? fileDoc.file.analysis.substring(0, 200) : 'No analysis',
          lastModified: new Date((doc).lastModified || doc._creationTime).toLocaleDateString(),
        });
      }
    }
    
    // Web search if requested
    let webResults = '';
    if (args.useWebSearch && args.mediaType !== 'video') {
      // Note: Web search integration would require importing linkupSearch directly
      // For now, suggest using linkupSearch tool separately
      webResults = `\n\n💡 Tip: Use the linkupSearch tool with includeImages: true to search the web for images.`;
    }
    
    if (results.length === 0 && !args.useWebSearch) {
      return `No ${args.mediaType === 'all' ? 'media files' : args.mediaType + 's'} found matching "${args.query}".

Try using useWebSearch: true to search the web for images.`;
    }
    
    const formattedResults = results.map((item, idx) => {
      return `${idx + 1}. ${item.type === 'image' ? '🖼️' : '🎥'} "${item.title}"
   ID: ${item.id}
   Type: ${item.fileType}
   Size: ${item.size}
   Last Modified: ${item.lastModified}
   ${item.analysis !== 'No analysis' ? `Analysis: ${item.analysis}...` : ''}`;
    }).join('\n\n');
    
    return `Found ${results.length} media file(s):\n\n${formattedResults}${webResults}`;
  },
});

/**
 * Analyze a media file (image or video)
 * Voice: "Analyze this image" or "What's in this video?"
 */
export const analyzeMediaFile = createTool({
  description: "Analyze an image or video file using AI. For images, performs object detection and scene analysis. For videos, extracts highlights and key moments. Returns detailed analysis results.",
  
  args: z.object({
    fileId: z.string().describe("The file ID to analyze (from searchMedia results)"),
    analysisType: z.enum(["general", "object-detection", "highlights", "detailed"]).default("general").describe("Type of analysis to perform"),
    analysisTopics: z.array(z.string()).optional().describe("Optional list of topics to focus on (reduces generic output and cost)"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[analyzeMediaFile] Analyzing file: ${args.fileId}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    // Get the file document
    const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
      documentId: args.fileId as any,
      userId, // Pass userId for evaluation
    });
    
    if (!fileDoc || !fileDoc.file) {
      return `File not found or not accessible.`;
    }
    
    // Check if analysis already exists
    if (fileDoc.file.analysis) {
      return `Existing Analysis for "${fileDoc.document.title}":

${fileDoc.file.analysis}

File Details:
- Type: ${fileDoc.document.fileType || 'unknown'}
- Size: ${(fileDoc.file.fileSize / (1024 * 1024)).toFixed(2)} MB`;
    }
    
    // Trigger new analysis
    const analysisPrompt = args.analysisType === 'object-detection' 
      ? "Detect and describe all objects, people, and elements in this image. Provide detailed descriptions of what you see."
      : args.analysisType === 'highlights'
      ? "Extract key highlights and important moments from this video. Provide timestamps and descriptions."
      : "Provide a comprehensive analysis of this file, including key insights and summary.";
    
    try {
      const result = await ctx.runAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI, {
        fileId: args.fileId as any,
        analysisPrompt: args.analysisTopics?.length ? undefined : analysisPrompt,
        analysisTopics: args.analysisTopics,
        analysisType: args.analysisType,
      });
      
      if ((result)?.success) {
        return `Analysis Complete for "${fileDoc.document.title}":

${(result).analysis}

File Details:
- Type: ${fileDoc.document.fileType || 'unknown'}
- Size: ${(fileDoc.file.fileSize / (1024 * 1024)).toFixed(2)} MB
- Analysis Type: ${args.analysisType}`;
      } else {
        return `Analysis failed for "${fileDoc.document.title}". Please try again or use a different analysis type.`;
      }
    } catch (error: any) {
      return `Error analyzing file: ${error.message}`;
    }
  },
});

/**
 * Get media file details and preview URL
 * Voice: "Show me this image" or "Display this video"
 */
export const getMediaDetails = createTool({
  description: "Get detailed information about a media file including preview URL, metadata, and analysis. Use this to display or view a specific image or video.",
  
  args: z.object({
    fileId: z.string().describe("The file ID to get details for"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[getMediaDetails] Getting details for file: ${args.fileId}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
      documentId: args.fileId as any,
      userId, // Pass userId for evaluation
    });
    
    if (!fileDoc || !fileDoc.file) {
      return `File not found.`;
    }
    
    const fileSizeMB = (fileDoc.file.fileSize / (1024 * 1024)).toFixed(2);
    const mediaType = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes((fileDoc.document.fileType || '').toLowerCase()) ? 'Image' : 'Video';
    
    const lastModified = fileDoc.document.lastModified
      ? new Date(fileDoc.document.lastModified).toLocaleString()
      : 'Unknown';

    return `${mediaType} Details: "${fileDoc.document.title}"

File Information:
- ID: ${fileDoc.file._id}
- Filename: ${fileDoc.file.fileName}
- Type: ${fileDoc.document.fileType || 'unknown'}
- Size: ${fileSizeMB} MB
- MIME Type: ${fileDoc.document.mimeType || 'unknown'}
- Last Modified: ${lastModified}

Preview URL: ${fileDoc.storageUrl || 'Not available'}

${fileDoc.file.analysis ? `Analysis:\n${fileDoc.file.analysis}` : 'No analysis available. Use analyzeMediaFile to generate analysis.'}

${fileDoc.file.structuredData ? `\nStructured Data Available: Yes` : ''}`;
  },
});

/**
 * List all media files with optional filtering
 * Voice: "Show me all my images" or "List recent videos"
 */
export const listMediaFiles = createTool({
  description: "List all media files (images and videos) with optional filtering by type, date range, or other criteria. Returns a gallery-style list of media files.",
  
  args: z.object({
    mediaType: z.enum(["image", "video", "all"]).default("all").describe("Type of media to list"),
    limit: z.number().default(20).describe("Maximum number of files to return"),
    sortBy: z.enum(["recent", "oldest", "name"]).default("recent").describe("How to sort the results"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[listMediaFiles] Listing ${args.mediaType} files, sorted by ${args.sortBy}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    // Get all documents (we'll filter for media files)
    // Note: This is a simplified approach - in production, you'd want a more efficient query
    const allDocs = await ctx.runQuery(api.domains.documents.documents.getSearch, {
      query: "", // Empty query to get all
      userId, // Pass userId for evaluation
    });
    
    // Filter for media files
    const mediaFiles = allDocs.filter((doc: any) => {
      const fileType = (doc.fileType || '').toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(fileType);
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(fileType);
      
      if (args.mediaType === 'image') return isImage;
      if (args.mediaType === 'video') return isVideo;
      return isImage || isVideo;
    });
    
    // Sort files
    const sortedFiles = [...mediaFiles].sort((a: any, b: any) => {
      if (args.sortBy === 'recent') {
        return (b.lastModified || b._creationTime) - (a.lastModified || a._creationTime);
      } else if (args.sortBy === 'oldest') {
        return (a.lastModified || a._creationTime) - (b.lastModified || b._creationTime);
      } else {
        return a.title.localeCompare(b.title);
      }
    });
    
    const limitedFiles = sortedFiles.slice(0, args.limit);
    
    if (limitedFiles.length === 0) {
      return `No ${args.mediaType === 'all' ? 'media files' : args.mediaType + 's'} found.`;
    }
    
    const formattedList = limitedFiles.map((doc: any, idx: number) => {
      const mediaType = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes((doc.fileType || '').toLowerCase()) ? '🖼️' : '🎥';
      const date = new Date((doc).lastModified || doc._creationTime).toLocaleDateString();
      
      return `${idx + 1}. ${mediaType} "${doc.title}"
   ID: ${doc._id}
   Type: ${doc.fileType}
   Date: ${date}`;
    }).join('\n\n');
    
    return `Found ${limitedFiles.length} ${args.mediaType === 'all' ? 'media file(s)' : args.mediaType + '(s)'}:

${formattedList}

Total available: ${mediaFiles.length}
Showing: ${limitedFiles.length}`;
  },
});
