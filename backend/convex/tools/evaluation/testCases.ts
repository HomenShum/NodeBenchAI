// convex/tools/evaluation/testCases.ts
// Comprehensive test cases for all Agent tools

export interface TestCase {
  id: string;
  category: string;
  tool: string;
  scenario: string;
  userQuery: string;
  expectedTool: string;
  expectedArgs: Record<string, any>;
  successCriteria: string[];
  evaluationPrompt: string;
}

export const documentToolTests: TestCase[] = [
  {
    id: "doc-001",
    category: "Document Discovery",
    tool: "findDocument",
    scenario: "User wants to find a document by title",
    userQuery: "Find my revenue report",
    expectedTool: "findDocument, delegateToDocumentAgent",
    expectedArgs: { query: "revenue report", limit: 10 },
    successCriteria: [
      "Tool called includes findDocument OR delegateToDocumentAgent (document search may be performed via delegation)",
      "Query parameter contains 'revenue' or 'report' (in findDocument query OR delegation query)",
      "Response mentions the Revenue Report Q4 2024 document",
      "Response includes document title and/or metadata",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI correctly searched for revenue-related documents. Accept either a direct findDocument call or delegation to DocumentAgent (delegateToDocumentAgent) as long as it produces the correct document result. The agent may also call getDocumentContent for better UX, but should not invent numbers not supported by tool outputs."
  },
  {
    id: "doc-002",
    category: "Document Reading",
    tool: "getDocumentContent",
    scenario: "User wants to read a specific document",
    userQuery: "Show me the content of the Revenue Report Q4 2024 document",
    expectedTool: "getDocumentContent, delegateToDocumentAgent",
    expectedArgs: { query: "Revenue Report Q4 2024" },
    successCriteria: [
      "Tool called is getDocumentContent or findDocument followed by getDocumentContent (directly OR via delegateToDocumentAgent)",
      "Response includes document content about Q4 2024 revenue",
      "Response mentions revenue figures or metrics",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI correctly retrieved the Revenue Report Q4 2024 document content. Check if the response includes revenue data, metrics, or summary information from the document."
  },
  {
    id: "doc-003",
    category: "Document Analysis",
    tool: "analyzeDocument",
    scenario: "User wants to understand document content",
    userQuery: "What is the Revenue Report Q4 2024 document about?",
    expectedTool: "analyzeDocument",
    expectedArgs: { analysisType: "summary" },
    successCriteria: [
      "Tool called includes analyzeDocument or findDocument+getDocumentContent",
      "Response includes summary or analysis of the Revenue Report",
      "Response mentions revenue data, metrics, or key findings",
      "Analysis is coherent and relevant"
    ],
    evaluationPrompt: "Evaluate if the AI provided a meaningful summary of the Revenue Report Q4 2024 document. The agent may use findDocument+getDocumentContent or analyzeDocument. Check if the analysis includes revenue data and is helpful."
  },
  {
    id: "doc-004",
    category: "Document Creation",
    tool: "createDocument",
    scenario: "User wants to create a new document",
    userQuery: "Create a new document called 'Q4 Planning' with initial content about planning goals",
    expectedTool: "createDocument",
    expectedArgs: { title: "Q4 Planning" },
    successCriteria: [
      "Tool called is createDocument OR response offers to create the document",
      "If tool called, title parameter includes 'Q4 Planning'",
      "Response confirms creation OR asks for confirmation to proceed",
      "Response is helpful and acknowledges the request"
    ],
    evaluationPrompt: "Evaluate if the AI handled the document creation request appropriately. ACCEPT EITHER: (1) Actual creation with createDocument tool, OR (2) A helpful response offering to create the document or asking for confirmation. The agent may be cautious about mutations and ask before proceeding - this is acceptable behavior."
  },
  {
    id: "doc-005",
    category: "Document Editing",
    tool: "updateDocument",
    scenario: "User wants to edit document properties",
    userQuery: "Change the Revenue Report Q4 2024 document title to 'Q4 Final Report'",
    expectedTool: "updateDocument",
    expectedArgs: { title: "Q4 Final Report" },
    successCriteria: [
      "Tool called includes updateDocument OR findDocument (may ask for confirmation)",
      "If updateDocument called, title parameter includes 'Q4 Final Report'",
      "Response confirms the update OR offers to make the update",
      "Response is helpful and acknowledges the request"
    ],
    evaluationPrompt: "Evaluate if the AI handled the document update request appropriately. ACCEPT EITHER: (1) Actual update with updateDocument tool, OR (2) Finding the document and offering to update it. The agent may be cautious about mutations and ask before proceeding - this is acceptable behavior."
  }
];

export const mediaToolTests: TestCase[] = [
  {
    id: "media-001",
    category: "Media Search",
    tool: "searchMedia",
    scenario: "User wants to find images",
    userQuery: "Find images about architecture",
    expectedTool: "searchMedia, linkupSearch, delegateToMediaAgent",
    expectedArgs: { query: "architecture", mediaType: "image" },
    successCriteria: [
      "Tool called includes searchMedia OR linkupSearch OR delegateToMediaAgent (media search may be performed via delegation)",
      "Query parameter contains 'architecture'",
      "Response includes relevant architecture information (images, links, or descriptions)",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI found relevant architecture resources. The agent may search both internal files (searchMedia) and web (linkupSearch) to provide comprehensive results. Check if the response includes relevant architecture images, links, or descriptions and is helpful. Accept both image URLs and web resource links as valid responses."
  },
  {
    id: "media-002",
    category: "Media Analysis",
    tool: "analyzeMediaFile",
    scenario: "User wants to analyze an image",
    userQuery: "Analyze the modern-architecture-1.jpg image",
    expectedTool: "analyzeMediaFile",
    expectedArgs: { analysisType: "general" },
    successCriteria: [
      "Tool called includes analyzeMediaFile or searchMedia+getMediaDetails",
      "Response includes description or analysis of the image",
      "Response mentions architecture or building features",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI provided meaningful analysis of the modern-architecture-1.jpg image. The agent may search for the file first. Check if the description mentions architectural features."
  },
  {
    id: "media-003",
    category: "Media Details",
    tool: "getMediaDetails",
    scenario: "User wants to view media file details",
    userQuery: "Show me details for the modern-architecture-1.jpg image",
    expectedTool: "getMediaDetails",
    expectedArgs: {},
    successCriteria: [
      "Tool called includes getMediaDetails or searchMedia",
      "Response includes file information (name, type, or size)",
      "Response is helpful and accurate",
      "File is identified correctly"
    ],
    evaluationPrompt: "Evaluate if the AI provided file details for modern-architecture-1.jpg. The agent may search for the file first. Check if basic file information is provided."
  },
  {
    id: "media-004",
    category: "Media Listing",
    tool: "listMediaFiles",
    scenario: "User wants to see all images",
    userQuery: "Show me all my images",
    expectedTool: "listMediaFiles",
    expectedArgs: { mediaType: "image", sortBy: "recent" },
    successCriteria: [
      "Tool called is listMediaFiles",
      "Response attempts to list images or explains if none found",
      "Response is helpful (either shows images or offers alternatives)",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI attempted to list all images. If no images are found, the agent should explain this clearly and offer alternatives (like searching the web). Accept both successful listings and helpful 'no results' responses."
  }
];

export const taskToolTests: TestCase[] = [
  {
    id: "task-001",
    category: "Task Listing",
    tool: "listTasks",
    scenario: "User wants to see today's tasks",
    userQuery: "What tasks are due today?",
    expectedTool: "listTasks",
    expectedArgs: { filter: "today" },
    successCriteria: [
      "Tool called is listTasks",
      "Filter is 'today'",
      "Response includes a task list (may be empty, but must be explicit)",
      "If tasks are present, they show status and priority"
    ],
    evaluationPrompt: "Evaluate if the AI correctly filtered tasks for today. ACCEPT empty lists if explicitly stated (e.g., “- (none)”). If tasks are present, ensure each includes status and priority."
  },
  {
    id: "task-002",
    category: "Task Creation",
    tool: "createTask",
    scenario: "User wants to create a task",
    userQuery: "Create a task to review the Q4 report by Friday",
    expectedTool: "createTask",
    expectedArgs: { title: "review the Q4 report", priority: "medium" },
    successCriteria: [
      "Tool called is createTask OR response offers to create the task",
      "If tool called, title includes 'review' or 'Q4 report'",
      "Response confirms task creation OR asks for confirmation to proceed",
      "Response is helpful and acknowledges the request"
    ],
    evaluationPrompt: "Evaluate if the AI handled the task creation request appropriately. ACCEPT EITHER: (1) Actual creation with createTask tool, OR (2) A helpful response offering to create the task or asking for confirmation. The agent may be cautious about mutations and ask before proceeding - this is acceptable behavior."
  },
  {
    id: "task-003",
    category: "Task Update",
    tool: "updateTask",
    scenario: "User wants to mark task as complete",
    userQuery: "Mark the 'Review Q4 revenue report' task as complete",
    expectedTool: "updateTask",
    expectedArgs: { status: "done" },
    successCriteria: [
      "Tool called includes updateTask OR listTasks (may ask for confirmation)",
      "If updateTask called, status is set to 'done' or 'completed'",
      "Response confirms the update OR offers to make the update",
      "Response is helpful and acknowledges the request"
    ],
    evaluationPrompt: "Evaluate if the AI handled the task update request appropriately. ACCEPT EITHER: (1) Actual update with updateTask tool, OR (2) Finding the task with listTasks and offering to update it. The agent may be cautious about mutations and ask before proceeding - this is acceptable behavior."
  },
  {
    id: "task-004",
    category: "Task Priority",
    tool: "listTasks",
    scenario: "User wants to see high priority tasks",
    userQuery: "Show me only high priority tasks",
    expectedTool: "listTasks",
    expectedArgs: { priority: "high", filter: "all" },
    successCriteria: [
      "Tool called is listTasks",
      "Response shows tasks filtered by priority",
      "Response mentions high priority or shows high priority tasks",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI attempted to filter tasks by high priority. Accept responses that show high priority tasks or explain the filtering. The response should focus on high priority items."
  }
];

export const calendarToolTests: TestCase[] = [
  {
    id: "cal-001",
    category: "Event Listing",
    tool: "listEvents",
    scenario: "User wants to see this week's events",
    userQuery: "What events do I have this week?",
    expectedTool: "listEvents",
    expectedArgs: { timeRange: "week" },
    successCriteria: [
      "Tool called is listEvents",
      "timeRange is 'week'",
      "Response includes an event list (may be empty, but must be explicit)",
      "If events are present, they show time and location"
    ],
    evaluationPrompt: "Evaluate if the AI listed this week's events correctly. ACCEPT empty lists if explicitly stated (e.g., “- (none)”). If events are present, ensure time and location are included."
  },
  {
    id: "cal-002",
    category: "Event Creation",
    tool: "createEvent",
    scenario: "User wants to schedule a meeting",
    userQuery: "Schedule a meeting with the team tomorrow at 2pm",
    expectedTool: "createEvent",
    expectedArgs: { title: "meeting with the team" },
    successCriteria: [
      "Tool called is createEvent OR response offers to create the event",
      "If tool called, title includes 'meeting' or 'team'",
      "Response confirms event creation OR asks for confirmation to proceed",
      "Response is helpful and acknowledges the request"
    ],
    evaluationPrompt: "Evaluate if the AI handled the event creation request appropriately. ACCEPT EITHER: (1) Actual creation with createEvent tool, OR (2) A helpful response offering to create the event or asking for confirmation. The agent may be cautious about mutations and ask before proceeding - this is acceptable behavior."
  }
];

export const organizationToolTests: TestCase[] = [
  {
    id: "org-001",
    category: "Folder Contents",
    tool: "getFolderContents",
    scenario: "User wants to see folder contents",
    userQuery: "Show me what's in the Finance Reports folder",
    expectedTool: "getFolderContents",
    expectedArgs: { folderName: "Finance Reports" },
    successCriteria: [
      "Tool called includes getFolderContents or getUserFolders",
      "Response attempts to show folder contents or lists available folders",
      "Response is helpful (either shows contents or explains folder doesn't exist)",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI attempted to show folder contents for 'Finance Reports'. Accept responses that show the folder contents, list available folders, or explain the folder status. The golden dataset has a 'Finance Reports' folder."
  }
];

export const webSearchToolTests: TestCase[] = [
  {
    id: "web-001",
    category: "Web Search",
    tool: "linkupSearch",
    scenario: "User wants current information",
    userQuery: "Search the web for latest AI developments",
    expectedTool: "linkupSearch",
    expectedArgs: { query: "latest AI developments", depth: "standard" },
    successCriteria: [
      "Tool called includes linkupSearch (may also call helper/meta tools)",
      "Query is relevant",
      "Response includes sources",
      "Answer is current and avoids unsupported specifics (must be grounded in cited sources)"
    ],
    evaluationPrompt: "Evaluate if the AI found relevant and current information. The answer should be grounded in cited sources and avoid overconfident claims that are not supported by the cited sources."
  },
  {
    id: "web-002",
    category: "Image Search",
    tool: "linkupSearch",
    scenario: "User wants to find images on the web",
    userQuery: "Find images of the Eiffel Tower on the web",
    expectedTool: "linkupSearch",
    expectedArgs: { query: "Eiffel Tower", includeImages: true },
    successCriteria: [
      "Tool called includes linkupSearch (may also call searchMedia first)",
      "Response includes image URLs or links",
      "Images are displayed or linked properly",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI found relevant Eiffel Tower images from the web. The agent may check internal files first with searchMedia, then use linkupSearch. Accept responses with image URLs or links."
  }
];

export const secFilingToolTests: TestCase[] = [
  {
    id: "sec-001",
    category: "SEC Filing Search",
    tool: "searchSecFilings",
    scenario: "User wants to find SEC filings by ticker",
    userQuery: "Find SEC filings for Apple",
    expectedTool: "searchSecFilings",
    expectedArgs: { ticker: "AAPL", formType: "ALL", limit: 10 },
    successCriteria: [
      "Tool called includes searchSecFilings OR SECAgent is used via delegation",
      "Ticker parameter is 'AAPL' or 'Apple'",
      "Response includes filing information",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI searched for Apple's SEC filings. Accept either a direct searchSecFilings call or delegation to SECAgent (as long as filings are returned). Check if the response includes filing types, dates, and document URLs."
  },
  {
    id: "sec-002",
    category: "SEC Filing Download",
    tool: "downloadSecFiling",
    scenario: "User wants to download a specific SEC filing",
    userQuery: "Download Apple's latest 10-K filing",
    expectedTool: "searchSecFilings",
    expectedArgs: { ticker: "AAPL", formType: "10-K" },
    successCriteria: [
      "Tool called includes searchSecFilings",
      "Response attempts to find and download the 10-K",
      "Response is helpful (either downloads or explains how to)",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI attempted to find and download Apple's 10-K filing. Accept responses that search for the filing and offer to download it."
  },
  {
    id: "sec-003",
    category: "Company Information",
    tool: "getCompanyInfo",
    scenario: "User wants company information from SEC",
    userQuery: "Get company info for Tesla",
    expectedTool: "getCompanyInfo",
    expectedArgs: { ticker: "TSLA" },
    successCriteria: [
      "Tool called is getCompanyInfo",
      "Response includes company details (CIK, SIC, address, etc.)",
      "Response is helpful and accurate",
      "Company name is mentioned"
    ],
    evaluationPrompt: "Evaluate if the AI retrieved Tesla's company information from SEC. Check if the response includes CIK, business address, and other company details."
  },
  {
    id: "sec-004",
    category: "SEC Filing Type Filter",
    tool: "searchSecFilings",
    scenario: "User wants specific type of SEC filing",
    userQuery: "Show me Microsoft's quarterly reports",
    expectedTool: "searchSecFilings",
    expectedArgs: { ticker: "MSFT", formType: "10-Q" },
    successCriteria: [
      "Tool called is searchSecFilings",
      "Form type is filtered to 10-Q or quarterly",
      "Response shows quarterly reports",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI correctly filtered for Microsoft's 10-Q (quarterly) filings. Check if the response focuses on quarterly reports."
  },
];

// Multi-step workflow tests
export const workflowTests: TestCase[] = [
  {
    id: "workflow-001",
    category: "Document Workflow",
    tool: "multiple",
    scenario: "Find, open, analyze, and edit a document",
    userQuery: "Find my revenue report, open it, tell me what it's about, and add a section on Q1 projections",
    expectedTool: "findDocument,getDocumentContent,analyzeDocument,updateDocument",
    expectedArgs: {},
    successCriteria: [
      "At least 3 tools are called (findDocument, getDocumentContent, and either analyzeDocument or updateDocument)",
      "Document is found and content retrieved",
      "Analysis or summary is provided",
      "Response is helpful and addresses all parts of the request"
    ],
    evaluationPrompt: "Evaluate if the AI completed the document workflow. The agent should find the revenue report, retrieve its content, and provide analysis. Updating the document is optional but preferred. Accept workflows that complete at least 3 of the 4 steps."
  },
  {
    id: "workflow-002",
    category: "Task Workflow",
    tool: "multiple",
    scenario: "List tasks, create new task, update existing task",
    userQuery: "Show me today's tasks, create a new task to call the client, and mark the 'Review Q4 revenue report' task as done",
    expectedTool: "listTasks,createTask,updateTask",
    expectedArgs: {},
    successCriteria: [
      "At least 2 of the 3 tools are called",
      "Response addresses multiple parts of the request",
      "Response is helpful and shows progress on the workflow",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handled the multi-step task workflow. The agent should list today's tasks, create a new task, and update an existing task. Accept workflows that complete at least 2 of the 3 steps."
  }
];

// ============================================================================
// EDGE CASES & ERROR HANDLING TESTS
// ============================================================================

export const edgeCaseTests: TestCase[] = [
  {
    id: "edge-001",
    category: "Empty Results",
    tool: "findDocument",
    scenario: "User searches for non-existent document",
    userQuery: "Find document about quantum physics research",
    expectedTool: "findDocument",
    expectedArgs: { query: "quantum physics research" },
    successCriteria: [
      "Tool called is findDocument",
      "Response acknowledges no results found",
      "Response is helpful and suggests alternatives",
      "No errors or crashes"
    ],
    evaluationPrompt: "Evaluate if the AI gracefully handles empty search results. Check if it acknowledges no documents were found and offers helpful suggestions."
  },
  {
    id: "edge-002",
    category: "Ambiguous Query",
    tool: "findDocument",
    scenario: "User provides vague search query",
    userQuery: "Find my recent document",
    expectedTool: "findDocument",
    expectedArgs: { query: "document" },
    successCriteria: [
      "Tool called is findDocument",
      "Response shows search results or asks for clarification",
      "Response is helpful",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handles ambiguous queries. Accept responses that either show recent documents or ask for clarification. Both approaches are valid."
  },
  {
    id: "edge-003",
    category: "Date Range Edge Case",
    tool: "listTasks",
    scenario: "User asks for tasks with no due date",
    userQuery: "Show me tasks that don't have a due date",
    expectedTool: "listTasks",
    expectedArgs: { filter: "all", status: "all" },
    successCriteria: [
      "Tool called is listTasks",
      "Response addresses the query about tasks without due dates",
      "Response is helpful (either shows tasks or explains none exist)",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handles the edge case of tasks without due dates. Accept responses that show such tasks or explain that all tasks have due dates."
  },
  {
    id: "edge-004",
    category: "Multiple Tool Calls",
    tool: "findDocument",
    scenario: "User asks complex question requiring multiple tools",
    userQuery: "Find my revenue report and tell me what tasks are related to it",
    expectedTool: "findDocument",
    expectedArgs: { query: "revenue report" },
    successCriteria: [
      "Multiple tools are called (at least findDocument and listTasks)",
      "Response mentions both the revenue report and related tasks",
      "Response is comprehensive and helpful",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handles complex multi-tool queries. The agent should find the revenue report and identify related tasks. Accept responses that address both parts of the query."
  },
  {
    id: "edge-005",
    category: "Time Zone Handling",
    tool: "listEvents",
    scenario: "User asks for events today (time-sensitive)",
    userQuery: "What events do I have today?",
    expectedTool: "listEvents",
    expectedArgs: { timeRange: "today" },
    successCriteria: [
      "Tool called is listEvents",
      "Response shows today's events or explains if none exist",
      "Response is helpful",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI correctly handles time-sensitive queries for today's events. Accept responses that show events or explain the schedule."
  },
];

// ============================================================================
// ADVANCED SCENARIO TESTS
// ============================================================================

export const advancedScenarioTests: TestCase[] = [
  {
    id: "adv-001",
    category: "Document Analysis Chain",
    tool: "analyzeDocument",
    scenario: "User wants deep analysis of document",
    userQuery: "Analyze the Revenue Report Q4 2024 and give me key insights",
    expectedTool: "analyzeDocument",
    expectedArgs: { query: "Revenue Report Q4 2024" },
    successCriteria: [
      "Tool called includes analyzeDocument or findDocument + analyzeDocument",
      "Response provides insights about revenue data",
      "Response mentions key metrics or trends",
      "Analysis is accurate and helpful"
    ],
    evaluationPrompt: "Evaluate if the AI provides meaningful analysis of the document. Check if insights are accurate and relevant."
  },
  {
    id: "adv-002",
    category: "Cross-Reference",
    tool: "findDocument",
    scenario: "User wants to cross-reference multiple documents",
    userQuery: "Compare the Revenue Report Q4 2024 with the Product Roadmap 2025",
    expectedTool: "findDocument",
    expectedArgs: { query: "revenue report" },
    successCriteria: [
      "At least one document is found and retrieved",
      "Response attempts to compare or relate the documents",
      "Response is helpful and addresses the comparison request",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI attempts to cross-reference the Revenue Report and Product Roadmap documents. Accept responses that retrieve and compare the documents, or explain the relationship between them."
  },
  {
    id: "adv-003",
    category: "Priority-Based Filtering",
    tool: "listTasks",
    scenario: "User wants high-priority tasks only",
    userQuery: "Show me only my high priority tasks",
    expectedTool: "listTasks",
    expectedArgs: { filter: "all", status: "all" },
    successCriteria: [
      "Tool called is listTasks",
      "Response focuses on high priority tasks",
      "Response is helpful in showing priority-filtered tasks",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI filters tasks by high priority. Accept responses that show high priority tasks or explain the priority distribution. The response should focus on high priority items."
  },
  {
    id: "adv-004",
    category: "Natural Language Date",
    tool: "listEvents",
    scenario: "User uses natural language for dates",
    userQuery: "What meetings do I have next week?",
    expectedTool: "listEvents",
    expectedArgs: { timeRange: "week" },
    successCriteria: [
      "Tool called is listEvents",
      "Natural language date is correctly interpreted",
      "Events for next week are shown",
      "Response is accurate"
    ],
    evaluationPrompt: "Evaluate if the AI correctly interprets natural language dates like 'next week'. Check if the correct time range is used."
  },
  {
    id: "adv-005",
    category: "Contextual Follow-up",
    tool: "getDocumentContent",
    scenario: "User asks follow-up question in context",
    userQuery: "Show me more details about the Revenue Report Q4 2024",
    expectedTool: "getDocumentContent",
    expectedArgs: { query: "revenue report" },
    successCriteria: [
      "Tool called includes getDocumentContent or findDocument",
      "Response provides detailed information about the revenue report",
      "Response includes revenue data or metrics",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI provides detailed information about the Revenue Report Q4 2024. Accept responses that retrieve and display the document content or key details."
  },
];

// ============================================================================
// PERFORMANCE & STRESS TESTS
// ============================================================================

export const performanceTests: TestCase[] = [
  {
    id: "perf-001",
    category: "Large Result Set",
    tool: "listTasks",
    scenario: "User requests all tasks (potentially large dataset)",
    userQuery: "Show me all my tasks",
    expectedTool: "listTasks",
    expectedArgs: { filter: "all", status: "all" },
    successCriteria: [
      "Tool called is listTasks",
      "Response shows tasks or explains the task list",
      "Response is well-formatted and readable",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handles the request for all tasks. Accept responses that show tasks (even if limited) or explain the task list. The response should be well-formatted."
  },
  {
    id: "perf-002",
    category: "Complex Search Query",
    tool: "findDocument",
    scenario: "User provides complex multi-word search",
    userQuery: "Find documents about Q4 2024 revenue analysis and financial projections",
    expectedTool: "findDocument",
    expectedArgs: { query: "Q4 2024 revenue analysis financial projections" },
    successCriteria: [
      "Tool called is findDocument",
      "Complex query is handled correctly",
      "Relevant documents are found",
      "Response is accurate and helpful"
    ],
    evaluationPrompt: "Evaluate if the AI handles complex multi-word searches. Check if relevant documents are found despite query complexity."
  },
  {
    id: "perf-003",
    category: "Rapid Sequential Queries",
    tool: "listTasks",
    scenario: "User asks multiple related questions quickly",
    userQuery: "What tasks are due today? And what about tomorrow?",
    expectedTool: "listTasks",
    expectedArgs: { filter: "today" },
    successCriteria: [
      "At least one question is addressed",
      "Response shows tasks for today or tomorrow (or both)",
      "Response is organized and clear",
      "Response is helpful and accurate"
    ],
    evaluationPrompt: "Evaluate if the AI handles multiple questions in one query. Accept responses that address at least one of the questions (today's or tomorrow's tasks). Ideally both should be addressed."
  },
];

// Specialized Agent Tests
export const specializedAgentTests: TestCase[] = [
  {
    id: "agent-001",
    category: "Specialized Agents",
    tool: "Coordinator Agent",
    scenario: "Multi-domain query requiring document and video search",
    userQuery: "Find me documents and videos about Google",
    expectedTool: "delegateToDocumentAgent, delegateToMediaAgent",
    expectedArgs: { query: "Google" },
    successCriteria: [
      "Coordinator delegates to both DocumentAgent and MediaAgent (acceptable via delegateToDocumentAgent+delegateToMediaAgent OR via parallelDelegate including both agents)",
      "Document search outcome is returned (documents found OR explicitly none found OR external sources via SOURCE_GALLERY_DATA/linkupSearch)",
      "YouTube video gallery is displayed (presence of a <!-- YOUTUBE_GALLERY_DATA ... --> block counts as displayed)",
      "Response combines both results coherently",
    ],
    evaluationPrompt: "Evaluate if the coordinator correctly identified the need for both document and video search, delegated to appropriate agents (direct delegation or parallelDelegate), and combined results effectively."
  },
  {
    id: "agent-002",
    category: "Specialized Agents",
    tool: "Media Agent",
    scenario: "YouTube video search",
    userQuery: "Find videos about Python programming",
    expectedTool: "youtubeSearch, delegateToMediaAgent",
    expectedArgs: { query: "Python programming" },
    successCriteria: [
      "MediaAgent is used (directly or via delegation)",
      "youtubeSearch tool is called (directly OR via MediaAgent delegation)",
      "YouTube gallery with video thumbnails is displayed (presence of a <!-- YOUTUBE_GALLERY_DATA ... --> block counts)",
      "Videos are relevant to Python programming",
    ],
    evaluationPrompt: "Evaluate if the agent correctly used youtubeSearch to find Python programming videos and displayed them in a gallery format."
  },
  {
    id: "agent-003",
    category: "Specialized Agents",
    tool: "SEC Agent",
    scenario: "SEC filing search by ticker",
    userQuery: "Find Apple's SEC filings",
    expectedTool: "searchSecFilings",
    expectedArgs: { ticker: "AAPL" },
    successCriteria: [
      "SECAgent is used (directly or via delegation) OR searchSecFilings is called directly",
      "searchSecFilings tool is called with ticker AAPL (directly OR via SECAgent delegation)",
      "SEC document gallery is displayed (presence of a <!-- SEC_GALLERY_DATA ... --> block counts)",
      "Filings include form types (10-K, 10-Q, etc.)",
    ],
    evaluationPrompt: "Evaluate if the agent correctly identified Apple's ticker symbol (AAPL) and used searchSecFilings to retrieve SEC filings."
  },
  {
    id: "agent-004",
    category: "Specialized Agents",
    tool: "Document Agent",
    scenario: "Find and read document workflow",
    userQuery: "Show me the revenue report",
    expectedTool: "findDocument, getDocumentContent",
    expectedArgs: { query: "revenue report" },
    successCriteria: [
      "DocumentAgent is used (directly or via delegation)",
      "findDocument is called first",
      "getDocumentContent is called with found document ID",
      "Full document content is displayed",
    ],
    evaluationPrompt: "Evaluate if the agent correctly executed the two-step workflow: find document, then retrieve content."
  },
  {
    id: "agent-005",
    category: "Specialized Agents",
    tool: "Coordinator Agent",
    scenario: "Complex multi-agent workflow",
    userQuery: "Get Tesla's 10-K and find videos about Tesla",
    expectedTool: "delegateToSECAgent, delegateToMediaAgent",
    expectedArgs: { query: "Tesla" },
    successCriteria: [
      "Coordinator delegates to both SECAgent and MediaAgent",
      "SEC filing for Tesla (TSLA) is retrieved",
      "YouTube videos about Tesla are displayed",
      "Response is well-organized with both results",
    ],
    evaluationPrompt: "Evaluate if the coordinator correctly handled a complex query requiring both SEC filings and video search."
  },
  {
    id: "agent-006",
    category: "Specialized Agents",
    tool: "Web Agent",
    scenario: "Current information search",
    userQuery: "What's the latest news on AI?",
    expectedTool: "linkupSearch",
    expectedArgs: { query: "latest news on AI" },
    successCriteria: [
      "WebAgent is used (directly or via delegation)",
      "linkupSearch tool is called",
      "Current web results with sources are returned",
      "Information is recent and relevant",
    ],
    evaluationPrompt: "Evaluate if the agent correctly used web search to find current AI news with proper source attribution."
  },
];

// Combine all test cases
export const allTestCases: TestCase[] = [
  ...documentToolTests,
  ...mediaToolTests,
  ...taskToolTests,
  ...calendarToolTests,
  ...organizationToolTests,
  ...webSearchToolTests,
  ...secFilingToolTests,
  ...workflowTests,
  ...edgeCaseTests,
  ...advancedScenarioTests,
  ...performanceTests,
  ...specializedAgentTests,
];

// Export test case counts
export const testCaseStats = {
  documents: documentToolTests.length,
  media: mediaToolTests.length,
  tasks: taskToolTests.length,
  calendar: calendarToolTests.length,
  organization: organizationToolTests.length,
  webSearch: webSearchToolTests.length,
  secFilings: secFilingToolTests.length,
  workflows: workflowTests.length,
  edgeCases: edgeCaseTests.length,
  advancedScenarios: advancedScenarioTests.length,
  performance: performanceTests.length,
  specializedAgents: specializedAgentTests.length,
  total: allTestCases.length,
};
