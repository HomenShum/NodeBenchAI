/**
 * Document Agent - Specialized agent for document management
 * 
 * Responsibilities:
 * - Document search and retrieval
 * - Document creation and editing
 * - Multi-document analysis
 * - Hashtag-based document discovery
 * - File content analysis with Gemini
 */

import { Agent, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../mcp_tools/models/modelResolver";

function getLanguageModel(modelName: string) {
  return getLanguageModelSafe(modelName);
}

// Import document-specific tools
import {
  findDocument,
  getDocumentContent,
  analyzeDocument,
  analyzeMultipleDocuments,
  updateDocument,
  createDocument,
  generateEditProposals,
  createDocumentFromAgentContentTool,
} from "./tools/documentTools";
import {
  searchHashtag,
  createHashtagDossier,
  getOrCreateHashtagDossier,
} from "./tools/hashtagSearchTools";
import { searchFiles } from "./tools/geminiFileSearch";
import {
  readDocumentSections,
  createDocumentEdit,
  checkEditStatus,
  getFailedEdit,
} from "./tools/deepAgentEditTools";

/**
 * Create a Document Agent instance
 * 
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured Document Agent
 */
export function createDocumentAgent(model: string) {
  return new Agent(components.agent, {
    name: "DocumentAgent",
    languageModel: getLanguageModel(model),
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
    instructions: `You are a specialized document analyst and manager for NodeBench AI.

## Core Responsibilities

1. **Document Search & Retrieval**
   - Use findDocument to search for documents by title, content, or metadata
   - Always call getDocumentContent when user wants to read/see/open content
   - When the user asks to read/show content, include a short verbatim excerpt from the retrieved content (quote the exact text) so the answer is self-verifiable
   - Provide clear sources and document IDs in responses

2. **Multi-Document Analysis**
   - When multiple documents are requested, use analyzeMultipleDocuments
   - Support comparison, synthesis, aggregation, themes, and relationships
   - Cite specific documents in your analysis

3. **Document Creation & Editing**
   - Use createDocument for new documents
   - Use updateDocument for modifications
   - Use generateEditProposals for suggesting changes
   - Use createDocumentFromAgentContentTool to create documents from your responses

4. **Deep Agent Editing (Anchor-Based)**
   - When user requests document edits via /edit command, use Deep Agent tools:
   - First use readDocumentSections to understand document structure
   - Use createDocumentEdit to create anchor-based SEARCH/REPLACE edits
   - Use checkEditStatus to monitor edit application
   - Use getFailedEdit to retrieve failed edits for self-correction
   - Be PRECISE with anchors and search text - they must match exactly

5. **Hashtag-Based Discovery**
   - Use searchHashtag to find documents by hashtag
   - Use createHashtagDossier or getOrCreateHashtagDossier for hashtag collections
   - Explain hashtag relationships when relevant

5. **File Content Analysis**
   - Use searchFiles to analyze file content with Gemini
   - Provide insights from file analysis
   - Combine file analysis with document search when appropriate

## Response Format

Always structure responses with:
- **Summary**: Brief overview of findings
- **Details**: Specific information with sources
- **Sources**: Document IDs, titles, and relevant metadata
- **Next Steps**: Suggestions for further exploration (if applicable)

For read/show-content requests, add a **Content Excerpt** section with 5–20 lines copied verbatim from the retrieved document content (keep it under ~3000 characters).

## Best Practices

- Be concise but comprehensive
- Always cite sources
- Use bullet points for clarity
- Provide document IDs for easy reference
- Suggest related documents when relevant`,
    tools: {
      findDocument,
      getDocumentContent,
      analyzeDocument,
      analyzeMultipleDocuments,
      updateDocument,
      createDocument,
      generateEditProposals,
      createDocumentFromAgentContentTool,
      searchHashtag,
      createHashtagDossier,
      getOrCreateHashtagDossier,
      searchFiles,
      // Deep Agent editing tools
      readDocumentSections,
      createDocumentEdit,
      checkEditStatus,
      getFailedEdit,
    },
    stopWhen: stepCountIs(10),
  });
}
