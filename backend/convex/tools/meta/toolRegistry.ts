/**
 * Tool Registry - Centralized catalog of all available tools
 * 
 * This registry enables the Progressive Disclosure Pattern:
 * 1. Agents start with only meta-tools (searchAvailableTools, describeTools, invokeTool)
 * 2. Tools are discovered on-demand via semantic search
 * 3. Full schemas loaded only when needed
 * 
 * Benefits:
 * - Initial context < 5K tokens regardless of total tool count
 * - 90%+ token savings compared to exposing all tools directly
 * - Scales to 100+ tools without context window issues
 */

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export const toolCategories = {
  document: {
    name: "Document Operations",
    description: "Create, read, edit, and search documents",
  },
  deepEdit: {
    name: "Deep Agent Editing",
    description: "Anchor-based document editing with self-correction",
  },
  hashtag: {
    name: "Hashtag & Dossier",
    description: "Hashtag search and dossier creation",
  },
  media: {
    name: "Media & Files",
    description: "Search and analyze images, videos, and files",
  },
  search: {
    name: "Web Search",
    description: "Search the web, YouTube, and news sources",
  },
  sec: {
    name: "SEC & Regulatory",
    description: "SEC filings and regulatory document research",
  },
  financial: {
    name: "Financial Research",
    description: "Funding research and company financial data",
  },
  tasks: {
    name: "Task Management",
    description: "Create, update, and list tasks",
  },
  calendar: {
    name: "Calendar & Events",
    description: "Calendar events and scheduling",
  },
  memory: {
    name: "Agent Memory",
    description: "Store and retrieve agent working memory",
  },
  evidence: {
    name: "Evidence & Citations",
    description: "Store, index, and retrieve evidence chunks for citation",
  },
  planning: {
    name: "Planning & Orchestration",
    description: "Task planning and multi-step orchestration",
  },
  knowledge: {
    name: "Knowledge Graph",
    description: "Knowledge graph building, clustering, and analysis",
  },
  humanInput: {
    name: "Human Input",
    description: "Request human clarification or approval",
  },
  email: {
    name: "Email Operations",
    description: "Compose and send emails via Resend",
  },
  spreadsheet: {
    name: "Spreadsheet Operations",
    description: "Edit spreadsheets with versioned artifacts",
  },
} as const;

export type ToolCategory = keyof typeof toolCategories;

// ═══════════════════════════════════════════════════════════════════════════
// TOOL SUMMARIES - Lightweight descriptions for discovery
// Each summary is ~50 tokens vs ~800 tokens for full schema
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolSummary {
  description: string;  // One-line description for search
  category: ToolCategory;
  keywords: string[];   // Additional search keywords
  module: string;       // Import path for dynamic loading
}

export const toolSummaries: Record<string, ToolSummary> = {
  // ─────────────────────────────────────────────────────────────────────────
  // Document Operations
  // ─────────────────────────────────────────────────────────────────────────
  findDocument: {
    description: "Search for documents by title or content keywords",
    category: "document",
    keywords: ["search", "find", "lookup", "query"],
    module: "document/documentTools",
  },
  getDocumentContent: {
    description: "Retrieve full document content and metadata by ID",
    category: "document",
    keywords: ["read", "open", "view", "show", "display"],
    module: "document/documentTools",
  },
  analyzeDocument: {
    description: "Analyze and summarize a document's content",
    category: "document",
    keywords: ["summarize", "analyze", "understand", "explain"],
    module: "document/documentTools",
  },
  updateDocument: {
    description: "Update a document's title, content, or metadata",
    category: "document",
    keywords: ["edit", "modify", "change", "update"],
    module: "document/documentTools",
  },
  createDocument: {
    description: "Create a new document with title and optional content",
    category: "document",
    keywords: ["new", "create", "add", "make"],
    module: "document/documentTools",
  },
  analyzeMultipleDocuments: {
    description: "Analyze and compare multiple documents together",
    category: "document",
    keywords: ["compare", "synthesize", "aggregate", "multi"],
    module: "document/documentTools",
  },
  generateEditProposals: {
    description: "Generate AI-powered edit suggestions for a document",
    category: "document",
    keywords: ["suggest", "propose", "improve", "revise"],
    module: "document/documentTools",
  },
  createDocumentFromAgentContentTool: {
    description: "Persist agent-generated content as a document",
    category: "document",
    keywords: ["save", "persist", "store", "agent"],
    module: "document/documentTools",
  },
  searchLocalDocuments: {
    description: "Search local documents using hybrid search (exact + RAG)",
    category: "document",
    keywords: ["local", "hybrid", "semantic", "rag"],
    module: "document/documentTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Deep Agent Editing (Anchor-Based)
  // ─────────────────────────────────────────────────────────────────────────
  readDocumentSections: {
    description: "Read document content with section markers for planning edits",
    category: "deepEdit",
    keywords: ["sections", "structure", "anchors", "planning"],
    module: "document/deepAgentEditTools",
  },
  createDocumentEdit: {
    description: "Create anchor-based SEARCH/REPLACE edit for a document",
    category: "deepEdit",
    keywords: ["edit", "replace", "anchor", "search"],
    module: "document/deepAgentEditTools",
  },
  checkEditStatus: {
    description: "Check status of pending document edits",
    category: "deepEdit",
    keywords: ["status", "pending", "progress", "monitor"],
    module: "document/deepAgentEditTools",
  },
  getFailedEdit: {
    description: "Get details of failed edits for self-correction",
    category: "deepEdit",
    keywords: ["failed", "error", "retry", "fix"],
    module: "document/deepAgentEditTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Hashtag & Dossier
  // ─────────────────────────────────────────────────────────────────────────
  searchHashtag: {
    description: "Search documents by hashtag using hybrid search",
    category: "hashtag",
    keywords: ["hashtag", "tag", "topic", "category"],
    module: "document/hashtagSearchTools",
  },
  createHashtagDossier: {
    description: "Create a dossier document from hashtag search results",
    category: "hashtag",
    keywords: ["dossier", "collection", "compile", "gather"],
    module: "document/hashtagSearchTools",
  },
  getOrCreateHashtagDossier: {
    description: "Get existing or create new hashtag dossier (idempotent)",
    category: "hashtag",
    keywords: ["dossier", "idempotent", "get", "create"],
    module: "document/hashtagSearchTools",
  },
  listHashtagDossiers: {
    description: "List all hashtag dossiers created by the user",
    category: "hashtag",
    keywords: ["list", "all", "dossiers", "history"],
    module: "document/hashtagSearchTools",
  },
  reRankHashtagResults: {
    description: "Re-rank hashtag search results using AI for relevance",
    category: "hashtag",
    keywords: ["rerank", "relevance", "sort", "improve"],
    module: "document/hashtagSearchTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Media & Files
  // ─────────────────────────────────────────────────────────────────────────
  searchMedia: {
    description: "Search for images and videos by topic or filename",
    category: "media",
    keywords: ["image", "video", "photo", "media"],
    module: "media/mediaTools",
  },
  analyzeMediaFile: {
    description: "Analyze image or video with AI (object detection, highlights)",
    category: "media",
    keywords: ["analyze", "detect", "vision", "ai"],
    module: "media/mediaTools",
  },
  getMediaDetails: {
    description: "Get media file details and preview URL",
    category: "media",
    keywords: ["details", "preview", "info", "metadata"],
    module: "media/mediaTools",
  },
  listMediaFiles: {
    description: "List all media files with optional filtering",
    category: "media",
    keywords: ["list", "gallery", "all", "browse"],
    module: "media/mediaTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Web Search
  // ─────────────────────────────────────────────────────────────────────────
  linkupSearch: {
    description: "Search the web using Linkup's AI-optimized search",
    category: "search",
    keywords: ["web", "internet", "google", "search", "news"],
    module: "media/linkupSearch",
  },
  lookupGroundTruthEntity: {
    description: "Lookup an entity in the internal ground-truth dataset for evaluation-safe facts",
    category: "knowledge",
    keywords: ["ground truth", "evaluation", "entity", "synthetic", "qa", "facts"],
    module: "evaluation/groundTruthLookupTool",
  },
  youtubeSearch: {
    description: "Search YouTube for videos on a topic",
    category: "search",
    keywords: ["youtube", "video", "watch", "tutorial"],
    module: "media/youtubeSearch",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SEC & Regulatory
  // ─────────────────────────────────────────────────────────────────────────
  searchSecFilings: {
    description: "Search SEC EDGAR filings by ticker, CIK, or company name",
    category: "sec",
    keywords: ["sec", "edgar", "10k", "10q", "8k", "filing"],
    module: "sec/secFilingTools",
  },
  downloadSecFiling: {
    description: "Download and save an SEC filing document",
    category: "sec",
    keywords: ["download", "save", "sec", "filing"],
    module: "sec/secFilingTools",
  },
  getCompanyInfo: {
    description: "Get company information from SEC (CIK, SIC, address)",
    category: "sec",
    keywords: ["company", "info", "cik", "ticker"],
    module: "sec/secFilingTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Financial Research
  // ─────────────────────────────────────────────────────────────────────────
  searchTodaysFunding: {
    description: "Search today's seed/Series A funding announcements",
    category: "financial",
    keywords: ["funding", "seed", "series", "startup", "investment"],
    module: "financial/fundingResearchTools",
  },
  getFundedCompanyProfile: {
    description: "Get detailed profile of a recently funded company",
    category: "financial",
    keywords: ["profile", "company", "funded", "startup"],
    module: "financial/fundingResearchTools",
  },
  createDCFSpreadsheet: {
    description: "Create interactive DCF valuation model for a company with editable spreadsheet",
    category: "financial",
    keywords: ["dcf", "valuation", "model", "spreadsheet", "financial", "fair value", "wacc", "enterprise value"],
    module: "domains/agents/tools/createDCFSpreadsheet",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Task Management
  // ─────────────────────────────────────────────────────────────────────────
  listTasks: {
    description: "List tasks with filtering by status, priority, due date",
    category: "tasks",
    keywords: ["tasks", "todo", "list", "show"],
    module: "integration/dataAccessTools",
  },
  createTask: {
    description: "Create a new task with title, due date, priority",
    category: "tasks",
    keywords: ["task", "create", "add", "new", "todo"],
    module: "integration/dataAccessTools",
  },
  updateTask: {
    description: "Update task status, priority, or other properties",
    category: "tasks",
    keywords: ["task", "update", "complete", "done", "change"],
    module: "integration/dataAccessTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Calendar & Events
  // ─────────────────────────────────────────────────────────────────────────
  listEvents: {
    description: "List calendar events in a date range",
    category: "calendar",
    keywords: ["calendar", "events", "schedule", "agenda"],
    module: "integration/dataAccessTools",
  },
  createEvent: {
    description: "Create a new calendar event with time and location",
    category: "calendar",
    keywords: ["event", "meeting", "schedule", "calendar", "appointment"],
    module: "integration/dataAccessTools",
  },
  getFolderContents: {
    description: "Get all documents in a specific folder",
    category: "calendar",
    keywords: ["folder", "directory", "contents", "files"],
    module: "integration/dataAccessTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Agent Memory
  // ─────────────────────────────────────────────────────────────────────────
  writeAgentMemory: {
    description: "Store intermediate results for later retrieval",
    category: "memory",
    keywords: ["memory", "store", "save", "cache"],
    module: "wrappers/coreAgentTools",
  },
  readAgentMemory: {
    description: "Retrieve previously stored data from memory",
    category: "memory",
    keywords: ["memory", "retrieve", "get", "recall"],
    module: "wrappers/coreAgentTools",
  },
  listAgentMemory: {
    description: "List all stored memory entries with keys",
    category: "memory",
    keywords: ["memory", "list", "all", "entries"],
    module: "wrappers/coreAgentTools",
  },
  deleteAgentMemory: {
    description: "Delete a memory entry by key",
    category: "memory",
    keywords: ["memory", "delete", "remove", "clear"],
    module: "wrappers/coreAgentTools",
  },
  queryMemory: {
    description: "Query unified memory for existing entity knowledge",
    category: "memory",
    keywords: ["query", "entity", "knowledge", "recall"],
    module: "knowledge/unifiedMemoryTools",
  },
  getOrBuildMemory: {
    description: "Get existing memory or trigger research if missing",
    category: "memory",
    keywords: ["research", "build", "enrich", "entity"],
    module: "knowledge/unifiedMemoryTools",
  },
  updateMemoryFromReview: {
    description: "Merge findings from analysis into entity memory",
    category: "memory",
    keywords: ["update", "merge", "persist", "facts"],
    module: "knowledge/unifiedMemoryTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Planning & Orchestration
  // ─────────────────────────────────────────────────────────────────────────
  fetchUrlToEvidence: {
    description: "Fetch a URL and return an artifactId + short preview for later citation",
    category: "evidence",
    keywords: ["evidence", "fetch", "url", "article", "store", "snapshot"],
    module: "wrappers/evidenceTools",
  },
  indexEvidenceArtifact: {
    description: "Index a stored artifact into searchable evidence chunks",
    category: "evidence",
    keywords: ["evidence", "index", "chunks", "citation"],
    module: "wrappers/evidenceTools",
  },
  searchEvidence: {
    description: "Search stored evidence chunks and return quote + chunkId for citation",
    category: "evidence",
    keywords: ["evidence", "search", "quote", "cite", "chunk"],
    module: "wrappers/evidenceTools",
  },
  getEvidenceChunk: {
    description: "Fetch a specific evidence chunk by chunkId (bounded text)",
    category: "evidence",
    keywords: ["evidence", "chunk", "fetch", "quote", "citation"],
    module: "wrappers/evidenceTools",
  },

  createPlan: {
    description: "Create an explicit task plan with steps",
    category: "planning",
    keywords: ["plan", "steps", "tasks", "organize"],
    module: "wrappers/coreAgentTools",
  },
  updatePlanStep: {
    description: "Update status of a step in an existing plan",
    category: "planning",
    keywords: ["plan", "step", "update", "progress"],
    module: "wrappers/coreAgentTools",
  },
  getPlan: {
    description: "Retrieve an existing plan by ID",
    category: "planning",
    keywords: ["plan", "get", "retrieve", "status"],
    module: "wrappers/coreAgentTools",
  },
  discoverCapabilities: {
    description: "Get catalog of agent capabilities and tools",
    category: "planning",
    keywords: ["capabilities", "discover", "what", "can"],
    module: "integration/orchestrationTools",
  },
  sequentialThinking: {
    description: "Propose a multi-step plan for a research goal",
    category: "planning",
    keywords: ["think", "plan", "steps", "reasoning"],
    module: "integration/orchestrationTools",
  },
  decomposeQuery: {
    description: "Split complex query into atomic research units",
    category: "planning",
    keywords: ["decompose", "split", "multi", "entities"],
    module: "integration/orchestrationTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Knowledge Graph
  // ─────────────────────────────────────────────────────────────────────────
  buildKnowledgeGraph: {
    description: "Build knowledge graph from entity/theme (claims, edges)",
    category: "knowledge",
    keywords: ["knowledge", "graph", "claims", "relations"],
    module: "knowledge/knowledgeGraphTools",
  },
  fingerprintKnowledgeGraph: {
    description: "Generate semantic/structural fingerprints for clustering",
    category: "knowledge",
    keywords: ["fingerprint", "embedding", "signature", "wl"],
    module: "knowledge/knowledgeGraphTools",
  },
  getGraphSummary: {
    description: "Get summary of a knowledge graph (claims, edges, status)",
    category: "knowledge",
    keywords: ["summary", "graph", "overview", "stats"],
    module: "knowledge/knowledgeGraphTools",
  },
  groupAndDetectOutliers: {
    description: "Run HDBSCAN clustering on knowledge graphs",
    category: "knowledge",
    keywords: ["cluster", "hdbscan", "outlier", "group"],
    module: "knowledge/clusteringTools",
  },
  checkNovelty: {
    description: "Check if knowledge graph is novel vs existing clusters",
    category: "knowledge",
    keywords: ["novelty", "outlier", "svm", "new"],
    module: "knowledge/clusteringTools",
  },
  explainSimilarity: {
    description: "Compare two knowledge graphs and explain differences",
    category: "knowledge",
    keywords: ["compare", "similarity", "difference", "explain"],
    module: "knowledge/clusteringTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Human Input
  // ─────────────────────────────────────────────────────────────────────────
  askHuman: {
    description: "Ask human user for input, clarification, or approval",
    category: "humanInput",
    keywords: ["human", "ask", "clarify", "confirm", "approval"],
    module: "integration/humanInputTools",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Email Operations
  // ─────────────────────────────────────────────────────────────────────────
  sendEmail: {
    description: "Send email via Resend with full audit logging",
    category: "email",
    keywords: ["email", "send", "compose", "resend", "mail", "notification"],
    module: "sendEmail",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Calendar ICS Operations
  // ─────────────────────────────────────────────────────────────────────────
  createCalendarEvent: {
    description: "Create a calendar event and generate RFC 5545 ICS artifact",
    category: "calendar",
    keywords: ["calendar", "event", "ics", "meeting", "schedule", "create"],
    module: "calendarIcs",
  },
  updateCalendarEvent: {
    description: "Update an existing calendar event with new ICS version",
    category: "calendar",
    keywords: ["calendar", "event", "ics", "update", "modify", "reschedule"],
    module: "calendarIcs",
  },
  cancelCalendarEvent: {
    description: "Cancel a calendar event and generate cancellation ICS",
    category: "calendar",
    keywords: ["calendar", "event", "ics", "cancel", "delete", "remove"],
    module: "calendarIcs",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Patch-Based Document Editing
  // ─────────────────────────────────────────────────────────────────────────
  editDocument: {
    description: "Apply patch-based edits to documents using locators (heading, paragraph, line, search)",
    category: "deepEdit",
    keywords: ["edit", "patch", "document", "insert", "replace", "delete", "locator"],
    module: "editDocument",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Spreadsheet Operations
  // ─────────────────────────────────────────────────────────────────────────
  editSpreadsheet: {
    description: "Edit spreadsheet with versioned artifacts (set cell, insert row, apply formula, add sheet)",
    category: "spreadsheet",
    keywords: ["spreadsheet", "excel", "cell", "row", "column", "formula", "edit"],
    module: "editSpreadsheet",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all tool names for a category
 */
export function getToolsByCategory(category: ToolCategory): string[] {
  return Object.entries(toolSummaries)
    .filter(([_, summary]) => summary.category === category)
    .map(([name]) => name);
}

/**
 * Get all available tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(toolSummaries);
}

/**
 * Get tool count by category
 */
export function getToolCountByCategory(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const summary of Object.values(toolSummaries)) {
    counts[summary.category] = (counts[summary.category] || 0) + 1;
  }
  return counts;
}

/**
 * Simple keyword-based search for tools
 * Returns top matches with scores
 */
export function searchTools(
  query: string,
  limit: number = 5,
  category?: ToolCategory
): Array<{ name: string; score: number; description: string; category: string }> {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const results: Array<{ name: string; score: number; description: string; category: string }> = [];

  for (const [name, summary] of Object.entries(toolSummaries)) {
    // Filter by category if specified
    if (category && summary.category !== category) continue;

    let score = 0;
    const nameLower = name.toLowerCase();
    const descLower = summary.description.toLowerCase();

    // Exact name match
    if (nameLower === queryLower) score += 100;

    // Name contains query
    if (nameLower.includes(queryLower)) score += 50;

    // Query contains name
    if (queryLower.includes(nameLower)) score += 30;

    // Keyword matches
    for (const keyword of summary.keywords) {
      if (queryLower.includes(keyword)) score += 20;
      if (keyword.includes(queryLower)) score += 10;
    }

    // Word matches in description
    for (const word of queryWords) {
      if (descLower.includes(word)) score += 5;
      if (nameLower.includes(word)) score += 10;
    }

    if (score > 0) {
      results.push({
        name,
        score,
        description: summary.description,
        category: toolCategories[summary.category].name,
      });
    }
  }

  // Sort by score descending and limit
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
