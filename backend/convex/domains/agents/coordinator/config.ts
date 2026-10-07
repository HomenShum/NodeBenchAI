/**
 * Coordinator Agent Configuration
 * 
 * Supervisor agent that orchestrates specialized subagents
 * Based on LangChain multi-agent supervisor pattern
 */

import { z } from "zod";

export const COORDINATOR_AGENT_CONFIG = {
  name: "CoordinatorAgent",
  description: "Supervisor agent that orchestrates specialized subagents",
  version: "2.0.0",
  maxDelegationDepth: 3,
};

// Delegation schema for subagent calls
export const delegationSchema = z.object({
  query: z.string().describe("The task/question to delegate to the subagent"),
  context: z.string().optional().describe("Additional context for the subagent"),
});

export type DelegationInput = z.infer<typeof delegationSchema>;

// System prompt for coordinator (LangChain supervisor pattern)
export const COORDINATOR_SYSTEM_PROMPT = `You are a Coordinator Agent - a supervisor that orchestrates specialized subagents.

## Architecture (LangChain Multi-Agent Pattern)
You follow the supervisor pattern:
1. Receive user request
2. Decide which subagent(s) to delegate to
3. Pass control and context to subagent
4. Receive results and synthesize response

## Available Subagents

### DataAccessAgent
- **Use for**: Calendar events, tasks/todos, file operations
- **Capabilities**: listEvents, listTasks, createEvent, createTask, updateTask
- **When**: User asks about schedule, calendar, tasks, todos

### DocumentAgent  
- **Use for**: Document search, reading, creation, editing
- **Capabilities**: Search docs, read content, create/edit documents
- **When**: User asks to find, read, or manage documents

### MediaAgent
- **Use for**: YouTube videos, web search, images
- **Capabilities**: YouTube search, web search, image search
- **When**: User asks for videos, web content, media

### SECAgent
- **Use for**: SEC filings, company research, regulatory documents
- **Capabilities**: Search EDGAR, find filings, company info
- **When**: User asks about SEC filings, company financials

### OpenBBAgent
- **Use for**: Financial data, stock prices, market research
- **Capabilities**: Stock data, crypto, economic indicators
- **When**: User asks about stocks, markets, financial data

## Delegation Guidelines

1. **Simple queries**: Handle directly if you have the right tool
2. **Specialist queries**: Delegate to the appropriate subagent
3. **Complex queries**: May require multiple subagents in sequence
4. **Always**: Pass sufficient context to subagents
5. **Never**: Make up data - always use tools or delegate

## Human-in-the-Loop
For sensitive operations (deletes, bulk changes), use askHuman to get approval.

## Current Date
Today is {DATE_PLACEHOLDER}. Use this for all date-related queries.
`;

// Generate dynamic coordinator system prompt
export function getCoordinatorSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { 
    weekday: "long", 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });
  return COORDINATOR_SYSTEM_PROMPT.replace("{DATE_PLACEHOLDER}", dateStr);
}

// Subagent metadata for routing decisions
export const SUBAGENT_REGISTRY = {
  dataAccess: {
    name: "DataAccessAgent",
    triggers: ["calendar", "events", "schedule", "tasks", "todos", "reminder", "ics", "meeting", "appointment"],
    description: "Handles calendar events, ICS artifacts, and tasks",
  },
  document: {
    name: "DocumentAgent",
    triggers: ["document", "file", "note", "read", "write", "search docs", "edit document", "patch"],
    description: "Handles document operations including patch-based editing",
  },
  media: {
    name: "MediaAgent",
    triggers: ["video", "youtube", "image", "web search", "media"],
    description: "Handles media discovery",
  },
  sec: {
    name: "SECAgent",
    triggers: ["sec", "filing", "10-k", "10-q", "edgar", "regulatory"],
    description: "Handles SEC filings and company research",
  },
  openbb: {
    name: "OpenBBAgent",
    triggers: ["stock", "price", "market", "crypto", "financial", "ticker"],
    description: "Handles financial data and market research",
  },
  email: {
    name: "EmailAgent",
    triggers: ["email", "send email", "compose", "inbox", "message", "mail", "notification"],
    description: "Handles email composition and sending via Resend",
  },
  spreadsheet: {
    name: "SpreadsheetAgent",
    triggers: ["spreadsheet", "excel", "csv", "cells", "formula", "row", "column"],
    description: "Handles spreadsheet editing with versioned artifacts",
  },
};
