/**
 * Document Agent with Meta-Tools - Progressive Disclosure Pattern
 *
 * This version uses the meta-tool discovery system instead of directly
 * exposing all tools. Benefits:
 * - Initial context < 5K tokens (vs 40K+ with direct tools)
 * - Scales to 100+ tools without context window issues
 * - Agent discovers tools on-demand based on task requirements
 * - Uses hybrid search (BM25 + vector) for intelligent tool discovery
 * - Query caching for repeated searches
 *
 * Usage:
 * - For token-sensitive contexts, use createDocumentAgentWithMetaTools
 * - For direct access (backward compat), use createDocumentAgent from documentAgent.ts
 */

import { Agent, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../../../../../_generated/api";

// Import centralized model resolver (2025 consolidated - 7 models only)
import { getLanguageModelSafe } from "../../../../agents/mcp_tools/models";

// Import meta-tools (hybrid search)
import {
  searchAvailableTools,
  listToolCategories,
  describeTools,
  invokeTool,
} from "../../../../../tools/meta";

/**
 * Create a Document Agent with meta-tool discovery (Hybrid Search)
 *
 * Uses Convex-native hybrid search combining:
 * - BM25 keyword search for exact matches
 * - Vector semantic search for conceptual similarity
 * - Reciprocal Rank Fusion for optimal ranking
 * - Query result caching for performance
 *
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured Document Agent with meta-tools
 */
export function createDocumentAgentWithMetaTools(model: string) {
  return new Agent(components.agent, {
    name: "DocumentAgent",
    languageModel: getLanguageModelSafe(model),
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
    instructions: `You are a specialized document analyst and manager for NodeBench AI.

## Tool Discovery Workflow (Hybrid Search)

You have access to 50+ tools organized into categories. Use the meta-tools to discover and invoke them:

1. **searchAvailableTools** - Find tools using hybrid search (keyword + semantic)
   Example: searchAvailableTools({ query: "create document" })
   - Uses BM25 for exact keyword matches
   - Uses vector search for semantic similarity
   - Combines results with Reciprocal Rank Fusion

2. **listToolCategories** - Browse all tool categories
   Example: listToolCategories({ showTools: true })

3. **describeTools** - Get full schemas for specific tools
   Example: describeTools({ toolNames: ["createDocument", "findDocument"] })

4. **invokeTool** - Execute a tool after describing it
   Example: invokeTool({ toolName: "createDocument", arguments: { title: "My Doc" } })

## Available Tool Categories

- **document**: Create, read, edit, search documents
- **deepEdit**: Anchor-based document editing with self-correction
- **hashtag**: Hashtag search and dossier creation
- **media**: Search/analyze images, videos, files
- **search**: Web search, YouTube, news
- **sec**: SEC filings and regulatory documents
- **financial**: Funding research, company financial data
- **tasks**: Task management
- **calendar**: Calendar events and scheduling
- **memory**: Agent working memory
- **planning**: Task planning, orchestration
- **knowledge**: Knowledge graphs, clustering
- **humanInput**: Request human clarification

## Core Responsibilities

1. **Document Search & Retrieval**
   - Search: searchAvailableTools({ query: "find document" }) → findDocument
   - Read: searchAvailableTools({ query: "get content" }) → getDocumentContent

2. **Document Creation & Editing**
   - Create: invokeTool({ toolName: "createDocument", arguments: {...} })
   - Edit: invokeTool({ toolName: "updateDocument", arguments: {...} })

3. **Deep Agent Editing (Anchor-Based)**
   - Read sections: invokeTool({ toolName: "readDocumentSections", arguments: {...} })
   - Create edit: invokeTool({ toolName: "createDocumentEdit", arguments: {...} })
   - Check status: invokeTool({ toolName: "checkEditStatus", arguments: {...} })

4. **Multi-Document Analysis**
   - Compare: invokeTool({ toolName: "analyzeMultipleDocuments", arguments: {...} })

## Response Format

Always structure responses with:
- **Summary**: Brief overview of findings
- **Details**: Specific information with sources
- **Sources**: Document IDs, titles, and relevant metadata
- **Next Steps**: Suggestions for further exploration

## Best Practices

- ALWAYS call searchAvailableTools first when unsure which tool to use
- Call describeTools before invokeTool to ensure correct arguments
- Be concise but comprehensive
- Always cite sources with document IDs
- Use bullet points for clarity`,
    tools: {
      searchAvailableTools,
      listToolCategories,
      describeTools,
      invokeTool,
    },
    stopWhen: stepCountIs(15), // Allow more steps for meta-tool workflow
  });
}

/**
 * Create a minimal Document Agent for simple tasks
 * Only exposes the most common document tools directly
 *
 * Use this when:
 * - Task is simple (search, read, create)
 * - Context is not limited
 * - Speed is priority over discovery
 */
export function createMinimalDocumentAgent(model: string) {
  // Import only essential tools
  const { findDocument, getDocumentContent, createDocument, updateDocument } = require("./tools/documentTools");

  return new Agent(components.agent, {
    name: "DocumentAgent",
    languageModel: getLanguageModelSafe(model),
    instructions: `You are a document assistant. You can search, read, create, and update documents.

Available tools:
- findDocument: Search for documents by title/content
- getDocumentContent: Read a document by ID
- createDocument: Create a new document
- updateDocument: Modify an existing document

For advanced operations (editing, analysis, hashtags), ask to be upgraded to full capabilities.`,
    tools: {
      findDocument,
      getDocumentContent,
      createDocument,
      updateDocument,
    },
    stopWhen: stepCountIs(5),
  });
}
