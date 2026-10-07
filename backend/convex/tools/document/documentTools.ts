// convex/tools/documentTools.ts
// Document management tools for Convex Agent
// Enables voice-controlled document operations

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

/**
 * Find documents by title or content
 * Voice: "Find document about revenue" or "Search for Q4 planning"
 */
export const findDocument = createTool({
  description: "Search for documents by title or content. By default, returns matching documents with metadata. Set fetchContent=true to automatically retrieve the full content of the first matching document. Use fetchContent=true when the user wants to read, view, or see the document content.",

  args: z.object({
    query: z.string().describe("Search query - can be document title or content keywords"),
    limit: z.number().default(10).describe("Maximum number of results to return (default: 10, max: 50)"),
    includeArchived: z.boolean().default(false).describe("Whether to include archived documents in search results"),
    fetchContent: z.boolean().default(false).describe("Set to true to automatically fetch and return the full content of the first matching document. Use this when the user wants to read, view, or see the document content (not just find it)."),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[findDocument] Searching for: "${args.query}"`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;
    console.log(`[findDocument] userId from context:`, userId);
    console.log(`[findDocument] ctx keys:`, Object.keys(ctx));

    // Use the search index for fast title search
    const results = await ctx.runQuery(api.domains.documents.documents.getSearch, {
      query: args.query,
      userId, // Pass userId for evaluation
    });

    if (results.length === 0) {
      return `No documents found matching "${args.query}".`;
    }

    console.log(`[findDocument] Query: "${args.query}"`);
    console.log(`[findDocument] Results count: ${results.length}`);
    console.log(`[findDocument] fetchContent: ${args.fetchContent}`);

    // If fetchContent is true and we have results, automatically fetch the first document's content
    if (args.fetchContent && results.length > 0) {
      const firstDoc = results[0];
      console.log(`[findDocument] Auto-fetching content for document: ${firstDoc._id}`);

      const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
        documentId: firstDoc._id,
        userId,
      });

      if (doc) {
        const docType = (doc).documentType || 'text';
        const lastModified = new Date((doc).lastModified || doc._creationTime).toLocaleString();

        let contentPreview = '';

        if (docType === 'file') {
          // For file documents, get file details
          const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
            documentId: firstDoc._id,
            userId,
          });

          if (fileDoc && fileDoc.file) {
            const fileSizeMB = (fileDoc.file.fileSize / (1024 * 1024)).toFixed(2);
            contentPreview = `File: ${fileDoc.file.fileName}
Size: ${fileSizeMB} MB
Type: ${(doc).fileType || 'unknown'}
${fileDoc.file.analysis ? `\nAnalysis:\n${fileDoc.file.analysis.substring(0, 500)}...` : 'No analysis available'}`;
          }
        } else {
          // For text documents, extract content
          const content = doc.content || '';
          if (typeof content === 'string') {
            contentPreview = content.substring(0, 1000);
          } else {
            // Handle rich content (ProseMirror JSON)
            contentPreview = JSON.stringify(content).substring(0, 1000);
          }
        }

        return `Found document and retrieved content:

Document: "${doc.title}"
ID: ${doc._id}
Type: ${docType}
Last Modified: ${lastModified}

Content:
${contentPreview}${contentPreview.length >= 1000 ? '...' : ''}

${results.length > 1 ? `\nNote: Found ${results.length} matching documents. Showing the first one.` : ''}`;
      }
    }

    // Otherwise, just return the list of documents
    const formattedResults = results.slice(0, args.limit).map((doc: any, idx: number) => {
      const lastModified = (doc).lastModified || doc._creationTime;
      const date = new Date(lastModified).toLocaleDateString();
      const docType = (doc).documentType || 'text';
      const icon = (doc).icon || '📄';

      return `${idx + 1}. ${icon} "${doc.title}"
   ID: ${doc._id}
   Type: ${docType}
   Last Modified: ${date}
   ${doc.isArchived ? '⚠️ Archived' : ''}`;
    }).join('\n\n');

    return `Found ${results.length} document(s):\n\n${formattedResults}`;
  },
});

/**
 * Get full document content and metadata
 * Voice: "Open document [ID]" or "Show me the content of [title]"
 */
export const getDocumentContent = createTool({
  description: "Retrieve full document content and metadata by document ID. Returns the complete document including title, content, type, and metadata. ALWAYS use this tool when the user asks to 'show', 'read', 'open', 'display', or 'view' a document's content. Call findDocument first to get the document ID, then call this tool with that ID.",

  args: z.object({
    documentId: z.string().describe("The document ID (from findDocument results)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[getDocumentContent] Loading document: ${args.documentId}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
      documentId: args.documentId as any,
      userId, // Pass userId for evaluation
    });

    if (!doc) {
      return `Document not found or you don't have permission to access it.`;
    }

    const docType = (doc).documentType || 'text';
    const lastModified = new Date((doc).lastModified || doc._creationTime).toLocaleString();

    let contentPreview = '';

    if (docType === 'file') {
      // For file documents, get file details
      const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
        documentId: args.documentId as any,
        userId, // Pass userId for evaluation
      });

      if (fileDoc && fileDoc.file) {
        const fileSizeMB = (fileDoc.file.fileSize / (1024 * 1024)).toFixed(2);
        contentPreview = `File: ${fileDoc.file.fileName}
Size: ${fileSizeMB} MB
Type: ${(doc).fileType || 'unknown'}
${fileDoc.file.analysis ? `\nAnalysis:\n${fileDoc.file.analysis.substring(0, 500)}...` : 'No analysis available'}`;
      }
    } else {
      // For text documents, extract content
      const content = doc.content || '';
      if (typeof content === 'string') {
        contentPreview = content.substring(0, 1000);
      } else {
        // Handle rich content (ProseMirror JSON)
        contentPreview = JSON.stringify(content).substring(0, 1000);
      }
    }

    return `Document: "${doc.title}"
ID: ${doc._id}
Type: ${docType}
Last Modified: ${lastModified}
Public: ${doc.isPublic ? 'Yes' : 'No'}
Archived: ${doc.isArchived ? 'Yes' : 'No'}

Content Preview:
${contentPreview}${contentPreview.length >= 1000 ? '...' : ''}`;
  },
});

/**
 * Analyze and summarize document content
 * Voice: "What is this document about?" or "Summarize this document"
 */
export const analyzeDocument = createTool({
  description: "Analyze and summarize a document's content. For text documents, provides a summary of the content. For file documents, returns existing analysis or indicates if analysis is needed. Use this when the user wants to understand what a document is about.",

  args: z.object({
    documentId: z.string().describe("The document ID to analyze"),
    analysisType: z.enum(["summary", "detailed", "keywords"]).default("summary").describe("Type of analysis: summary (brief overview), detailed (comprehensive analysis), or keywords (extract key topics)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[analyzeDocument] Analyzing document: ${args.documentId}`);

    // Get userId from context if available (for evaluation)
    const userId = (ctx as any).evaluationUserId;

    const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
      documentId: args.documentId as any,
      userId, // Pass userId for evaluation
    });

    if (!doc) {
      return `Document not found.`;
    }

    const docType = (doc).documentType || 'text';

    if (docType === 'file') {
      // For file documents, check if analysis exists
      const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
        documentId: args.documentId as any,
        userId, // Pass userId for evaluation
      });

      if (fileDoc && fileDoc.file) {
        if (fileDoc.file.analysis) {
          return `Analysis of "${doc.title}":

${fileDoc.file.analysis}

File Details:
- Type: ${(doc).fileType || 'unknown'}
- Size: ${(fileDoc.file.fileSize / (1024 * 1024)).toFixed(2)} MB`;
        } else {
          return `File "${doc.title}" has not been analyzed yet. You can trigger analysis using the analyzeFile tool.`;
        }
      }
    }

    // For text documents, provide content-based analysis
    const content = doc.content || '';
    let textContent = '';

    if (typeof content === 'string') {
      textContent = content;
    } else {
      // Extract text from rich content
      textContent = JSON.stringify(content);
    }

    const wordCount = textContent.split(/\s+/).length;
    const charCount = textContent.length;

    return `Document Analysis: "${doc.title}"

Type: Text Document
Word Count: ${wordCount}
Character Count: ${charCount}
Last Modified: ${new Date((doc).lastModified || doc._creationTime).toLocaleString()}

Content Preview:
${textContent.substring(0, 500)}${textContent.length > 500 ? '...' : ''}

Note: For detailed AI-powered analysis, the content can be processed further.`;
  },
});

/**
 * Update document content
 * Voice: "Edit this document" → "Add section about XYZ"
 */
export const updateDocument = createTool({
  description: "Update a document's title, content, or metadata. Use this when the user wants to edit or modify a document. Returns confirmation of the update.",

  args: z.object({
    documentId: z.string().describe("The document ID to update"),
    title: z.string().optional().describe("New title for the document"),
    content: z.string().optional().describe("New content for the document (replaces existing content)"),
    isPublic: z.boolean().optional().describe("Whether the document should be public"),
    isFavorite: z.boolean().optional().describe("Whether to mark as favorite"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[updateDocument] Updating document: ${args.documentId}`);

    const updates: any = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic;
    if (args.isFavorite !== undefined) updates.isFavorite = args.isFavorite;

    await ctx.runMutation(api.domains.documents.documents.update, {
      id: args.documentId as any,
      ...updates,
    });

    const updatedFields = Object.keys(updates).join(', ');

    // Get document title for response
    const doc = await ctx.runQuery(api.domains.documents.documents.getById, {
      documentId: args.documentId as any,
    });

    // Return structured data with HTML marker for UI extraction
    const response = `Document updated successfully!
Updated fields: ${updatedFields}

The document has been saved with your changes.

<!-- DOCUMENT_ACTION_DATA
${JSON.stringify({
      action: 'updated',
      documentId: args.documentId,
      title: doc?.title || 'Document',
      updatedFields: Object.keys(updates)
    })}
-->`;

    return response;
  },
});

/**
 * Analyze and compare multiple documents
 * Voice: "Compare these documents" or "Analyze documents together"
 */
export const analyzeMultipleDocuments = createTool({
  description: "Analyze and compare multiple documents at once. Can synthesize information across documents, identify common themes, extract relationships, or aggregate data. Use this when the user wants to compare, combine, or analyze multiple documents together.",

  args: z.object({
    documentIds: z.array(z.string()).min(2).max(10).describe("Array of document IDs to analyze (minimum 2, maximum 10)"),
    analysisType: z.enum(["comparison", "synthesis", "aggregation", "themes", "relationships"]).default("synthesis").describe("Type of analysis: comparison (side-by-side), synthesis (combined insights), aggregation (data collection), themes (common topics), relationships (connections between docs)"),
    focusArea: z.string().optional().describe("Optional specific area to focus on (e.g., 'revenue', 'timeline', 'key findings')"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[analyzeMultipleDocuments] Analyzing ${args.documentIds.length} documents`);

    // Get userId from context if available
    const userId = (ctx as any).evaluationUserId;

    // Fetch all documents
    const documents = await Promise.all(
      args.documentIds.map(docId =>
        ctx.runQuery(api.domains.documents.documents.getById, {
          documentId: docId as any,
          userId,
        })
      )
    );

    // Filter out null/missing documents
    const validDocs = documents.filter((doc: any) => doc !== null);

    if (validDocs.length === 0) {
      return `No documents found or you don't have permission to access them.`;
    }

    if (validDocs.length < 2) {
      return `Only ${validDocs.length} document(s) found. Need at least 2 documents for multi-document analysis.`;
    }

    // Extract content from all documents
    const docContents = validDocs.map((doc: any, idx: number) => {
      let content = '';

      if (typeof doc.content === 'string') {
        content = doc.content;
      } else if (doc.content) {
        content = JSON.stringify(doc.content);
      }

      return {
        title: doc.title,
        id: doc._id,
        type: (doc).documentType || 'text',
        content: content.substring(0, 2000), // Limit per document for token efficiency
        lastModified: new Date((doc).lastModified || doc._creationTime).toLocaleDateString(),
      };
    });

    // Build analysis summary based on type
    let analysisHeader = '';
    switch (args.analysisType) {
      case 'comparison':
        analysisHeader = `Side-by-side Comparison of ${validDocs.length} Documents`;
        break;
      case 'synthesis':
        analysisHeader = `Synthesized Analysis of ${validDocs.length} Documents`;
        break;
      case 'aggregation':
        analysisHeader = `Data Aggregation from ${validDocs.length} Documents`;
        break;
      case 'themes':
        analysisHeader = `Common Themes Across ${validDocs.length} Documents`;
        break;
      case 'relationships':
        analysisHeader = `Relationships Between ${validDocs.length} Documents`;
        break;
    }

    // Format document list
    const docList = docContents.map((doc: any, idx: number) =>
      `${idx + 1}. "${doc.title}" (${doc.type}, ${doc.lastModified})\n   ID: ${doc.id}`
    ).join('\n');

    // Build response with document contents for LLM analysis
    let response = `${analysisHeader}

Documents Analyzed:
${docList}

${args.focusArea ? `Focus Area: ${args.focusArea}\n` : ''}

Document Contents:
${'='.repeat(60)}
`;

    docContents.forEach((doc: any, idx: number) => {
      response += `\n\nDocument ${idx + 1}: "${doc.title}"
${'-'.repeat(40)}
${doc.content}
`;
    });

    response += `\n${'='.repeat(60)}

Analysis Type: ${args.analysisType}
Ready for detailed analysis. The LLM will now analyze these documents according to the specified analysis type.`;

    return response;
  },
});

/**
 * Create a new document
 * Voice: "Create a new document called XYZ"
 */
export const createDocument = createTool({
  description: "Create a new document with a title and optional initial content. Returns the new document ID. Use this when the user wants to create a new document.",

  args: z.object({
    title: z.string().describe("Title for the new document"),
    content: z.string().optional().describe("Initial content for the document"),
    isPublic: z.boolean().default(false).describe("Whether the document should be public"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      console.log(`[createDocument] Creating document: "${args.title}"`);

      // Convert content string to array format if provided
      const contentArray = args.content ? [
        {
          type: "paragraph",
          content: [{ type: "text", text: args.content }]
        }
      ] : undefined;

      console.log(`[createDocument] Calling mutation with title: "${args.title}"`);
      const documentId = await ctx.runMutation(api.domains.documents.documents.create, {
        title: args.title,
        content: contentArray,
      });

      console.log(`[createDocument] Document created with ID: ${documentId}`);

      // If user wants it public, update it
      if (args.isPublic) {
        console.log(`[createDocument] Setting document to public`);
        await ctx.runMutation(api.domains.documents.documents.update, {
          id: documentId,
          isPublic: true,
        });
      }

      // Return structured data with HTML marker for UI extraction
      const response = `Document created successfully!

Title: "${args.title}"
ID: ${documentId}
Public: ${args.isPublic ? 'Yes' : 'No'}

The document is ready to edit.

<!-- DOCUMENT_ACTION_DATA
${JSON.stringify({
        action: 'created',
        documentId: String(documentId),
        title: args.title,
        isPublic: args.isPublic
      })}
-->`;

      console.log(`[createDocument] Returning response with document ID: ${documentId}`);
      return response;
    } catch (error) {
      console.error(`[createDocument] Error creating document:`, error);
      throw error;
    }
  },
});

/**
 * Generate edit proposals for a document
 * Voice: "Suggest edits to add a section about..." or "What changes would improve this document?"
 */
export const generateEditProposals = createTool({
  description: "Generate AI-powered edit proposals for a document based on user request. Returns structured proposals that can be reviewed before applying. Use this when the user wants suggestions for improving or modifying a document.",

  args: z.object({
    documentId: z.string().describe("The document ID to generate proposals for"),
    request: z.string().describe("The user's request for edits (e.g., 'Add a section about pricing', 'Improve the introduction')"),
    proposalType: z.enum(["title", "content", "append", "replace"]).default("content").describe("Type of edit proposal to generate"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[generateEditProposals] Generating proposals for: ${args.documentId}`);

    try {
      // Legacy editing agent was removed - this functionality needs to be reimplemented
      return `Edit proposals feature is currently unavailable. The editing agent was removed as part of the Deep Agents 2.0 refactor. Please edit the document manually or request this feature to be reimplemented.`;

      // TODO: Reimplement this using the new Deep Agents architecture
      /* 
      // Get the document
      const doc = await ctx.runQuery(api.domains.documents.documents.getById, { documentId: args.documentId as any });
      if (!doc) {
        return `Document not found: ${args.documentId}`;
      }

      // Import the editing agent (REMOVED - part of Deep Agents 2.0 refactor)
      // const { generateEdits } = await import("../fast_agents/editingAgent");

      // Generate proposals
      const proposals = await generateEdits(ctx, {
        message: args.request,
        documentId: args.documentId as any,
        currentContent: doc.content || "",
        currentTitle: doc.title,
      });

      // Format response
      let response = `📝 Edit Proposals for "${doc.title}":\n\n`;
      response += `${proposals.explanation}\n\n`;
      response += `Proposals (${proposals.proposals.length}):\n`;

      for (let i = 0; i < proposals.proposals.length; i++) {
        const p = proposals.proposals[i];
        response += `\n${i + 1}. **${p.type.toUpperCase()}**\n`;
        response += `   Reason: ${p.reason}\n`;
        response += `   Preview: ${p.newValue.slice(0, 100)}${p.newValue.length > 100 ? "..." : ""}\n`;
      }

      response += `\nConfidence: ${(proposals.confidence * 100).toFixed(0)}%`;

      return response;
      */
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return `Error generating proposals: ${errorMsg}`;
    }
  },
});


/**
 * Create a document from agent-generated content (DOCUMENT_METADATA + markdown)
 * Use this after generating content to persist the document and surface a tool call in the timeline.
 */
export const createDocumentFromAgentContentTool = createTool({
  description:
    "Persist agent-generated document content. Pass the parsed title and the markdown content (without the DOCUMENT_METADATA comment). Returns the created document ID and a structured marker for UI extraction.",
  args: z.object({
    title: z.string().describe("Document title (parsed from DOCUMENT_METADATA.title)"),
    content: z.string().describe("Markdown content without the DOCUMENT_METADATA block"),
    threadId: z.string().optional().describe("Optional agent thread id to link the document to the chat")
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log(`[createDocumentFromAgentContentTool] Creating doc: "${args.title}"`);
    const documentId = await ctx.runMutation(api.domains.agents.fastAgentPanelStreaming.createDocumentFromAgentContent, {
      title: args.title,
      content: args.content,
      threadId: args.threadId,
    });

    const response = `Document created successfully!\n\nTitle: "${args.title}"\nID: ${documentId}\n\n<!-- DOCUMENT_ACTION_DATA\n${JSON.stringify({
      action: 'created',
      documentId: String(documentId),
      title: args.title,
      via: 'createDocumentFromAgentContentTool',
    })}\n-->`;

    return response;
  },
});

/**
 * Search local documents by hashtag keyword
 * Uses hybrid search: exact title + exact content + semantic RAG
 * Voice: "Search for documents about biotech" or "Find all documents related to AI"
 */
export const searchLocalDocuments = createTool({
  description: `Search for documents in the user's local document library using hybrid search.

  This tool performs three types of search in parallel:
  1. Exact title match - finds documents with the keyword in the title
  2. Exact content match - finds documents with the keyword in the content (BM25)
  3. Semantic search - finds documents semantically related to the keyword (RAG)

  Results are deduplicated and ranked by relevance with match type labels.
  Use this when the user asks to search their documents, find documents about a topic, or wants to see what documents they have on a subject.

  This is different from web search - this searches ONLY the user's local documents.`,

  args: z.object({
    query: z.string().describe("Search query - the topic or keyword to search for"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)"),
    createDossier: z.boolean().optional().default(false).describe("Whether to automatically create a hashtag dossier with the results"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[searchLocalDocuments] Searching for: "${args.query}"`);

    // Call the existing searchForHashtag action
    const searchResult: any = await ctx.runAction(api.domains.search.hashtagDossiers.searchForHashtag, {
      hashtag: args.query,
    });

    if (searchResult.totalCount === 0) {
      return `No local documents found matching "${args.query}".`;
    }

    // Limit results
    const matches: any[] = searchResult.matches.slice(0, args.limit);

    // Format for AI consumption
    const formatted = matches.map((m: any, idx: number) => {
      const badge =
        m.matchType === "hybrid" ? "🎯" :
          m.matchType === "exact-hybrid" ? "🎯" :
            m.matchType === "exact-title" ? "📍" :
              m.matchType === "exact-content" ? "📄" :
                "🔍";

      return `${idx + 1}. ${badge} "${m.title}"
   ID: ${m._id}
   Match: ${m.matchType}
   Relevance: ${(m.score * 100).toFixed(0)}%${m.snippet ? `\n   Snippet: ${m.snippet.slice(0, 150)}...` : ''}`;
    }).join('\n\n');

    let response = `Found ${searchResult.totalCount} local document${searchResult.totalCount === 1 ? '' : 's'} matching "${args.query}":

${formatted}

Match types:
🎯 Hybrid - Found in both exact and semantic search (highest relevance)
📍 Exact-title - Found in document title
📄 Exact-content - Found in document content
🔍 Semantic - Found via AI semantic understanding`;

    // Optionally create dossier
    if (args.createDossier && searchResult.totalCount > 0) {
      const dossierId: any = await ctx.runMutation(api.domains.search.hashtagDossiers.createHashtagDossier, {
        hashtag: args.query,
        matchedDocuments: searchResult.matches,
      });

      response += `\n\n✅ Created hashtag dossier "#${args.query}" with all ${searchResult.totalCount} results.
Dossier ID: ${dossierId}

<!-- DOCUMENT_ACTION_DATA
${JSON.stringify({
        action: 'created',
        documentId: String(dossierId),
        title: `#${args.query}`,
        via: 'searchLocalDocuments',
      })}
-->`;
    }

    return response;
  },
});
