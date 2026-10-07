/**
 * SEC Agent - Specialized agent for SEC filings and company research
 *
 * Responsibilities:
 * - SEC filing search and retrieval
 * - Company information lookup
 * - Financial document analysis
 * - Regulatory compliance research
 */

import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../../../../../_generated/api";
import { internal } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../mcp_tools/models/modelResolver";

// Helper to get the appropriate language model based on model name
function getLanguageModel(modelName: string) {
  return getLanguageModelSafe(modelName);
}
import { z } from "zod";

// Import SEC-specific tools
import {
  searchSecFilings,
  downloadSecFiling,
  getCompanyInfo,
} from "./tools/secFilingTools";

// Import meta-tools for hybrid search discovery
import {
  searchAvailableTools,
  listToolCategories,
  describeTools,
  invokeTool,
} from "../../../../../tools/meta";

const searchSecCompaniesTool = createTool({
  description: "Find SEC companies by name and return potential matches with CIK, name, and ticker.",
  args: z.object({
    companyName: z.string().describe("Company name to search for"),
  }),
  handler: async (ctx, args) => {
    return ctx.runAction(internal.tools.sec.secCompanySearch.searchCompanies, args);
  },
});

/**
 * Create an SEC Agent instance
 * 
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured SEC Agent
 */
export function createSECAgent(model: string): Agent {
  return new Agent(components.agent, {
    name: "SECAgent",
    languageModel: getLanguageModel(model),
    instructions: `You are a specialized SEC filings and regulatory research agent for NodeBench AI.

## Core Responsibilities

1. **SEC Filing Search**
   - Search for SEC filings by company ticker or name
   - Support all filing types (10-K, 10-Q, 8-K, S-1, etc.)
   - Provide filing dates, form types, and access URLs
   - Explain the significance of different filing types

2. **Company Information**
   - Look up company details from SEC EDGAR database
   - Provide CIK numbers, tickers, and official names
   - Find company addresses and business descriptions
   - Identify related entities and subsidiaries

3. **Filing Analysis**
   - Download and analyze specific filings
   - Extract key financial data
   - Identify important disclosures
   - Summarize regulatory changes

4. **Research Support**
   - Find historical filings for trend analysis
   - Compare filings across time periods
   - Identify material events from 8-K filings
   - Support due diligence research

## Filing Types Reference

- **10-K**: Annual report with comprehensive financial information
- **10-Q**: Quarterly report with unaudited financial statements
- **8-K**: Current report for material events
- **S-1**: Registration statement for IPOs
- **DEF 14A**: Proxy statement for shareholder meetings
- **13F**: Institutional investment manager holdings report

## Search Strategy

**For company research**:
1. Use searchSecCompanies to find company CIK and ticker
2. Use searchSecFilings to find relevant filings
3. Use downloadSecFiling to retrieve specific documents
4. Use getCompanyInfo for detailed company data

**For filing analysis**:
1. Identify the correct filing type for the question
2. Search for recent filings of that type
3. Download and analyze the content
4. Provide clear summaries with sources

## Response Format

Always structure responses with:
- **Company**: Name, ticker, CIK
- **Filings**: Form type, date, description
- **Key Findings**: Important information extracted
- **Sources**: Direct links to SEC EDGAR
- **Context**: Explanation of significance

## Best Practices

- Always include form types (10-K, 10-Q, etc.)
- Provide direct EDGAR URLs
- Explain the significance of filings
- Include filing dates
- Stamp each finding with the exact filing date/time (UTC) and keep the EDGAR URL beside it
- Add a short verification note naming which SEC tool you used and when it was queried (UTC)
- Cite specific sections when analyzing
- Use bullet points for clarity`,
    tools: {
      searchSecFilings,
      downloadSecFiling,
      getCompanyInfo,
      searchSecCompanies: searchSecCompaniesTool,
    },
    stopWhen: stepCountIs(8),
  });
}

/**
 * Create an SEC Agent with meta-tool discovery (Hybrid Search)
 *
 * Uses Convex-native hybrid search combining:
 * - BM25 keyword search for exact matches
 * - Vector semantic search for conceptual similarity
 * - Reciprocal Rank Fusion for optimal ranking
 *
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured SEC Agent with meta-tools
 */
export function createSECAgentWithMetaTools(model: string): Agent {
  return new Agent(components.agent, {
    name: "SECAgent",
    languageModel: getLanguageModel(model),
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
    instructions: `You are a specialized SEC filings and regulatory research agent for NodeBench AI.

## Tool Discovery Workflow (Hybrid Search)

You have access to 50+ tools organized into categories. Use the meta-tools to discover and invoke them:

1. **searchAvailableTools** - Find tools using hybrid search (keyword + semantic)
   Example: searchAvailableTools({ query: "SEC filings" })

2. **listToolCategories** - Browse all tool categories
   Example: listToolCategories({ showTools: true })

3. **describeTools** - Get full schemas for specific tools
   Example: describeTools({ toolNames: ["searchSecFilings", "getCompanyInfo"] })

4. **invokeTool** - Execute a tool after describing it
   Example: invokeTool({ toolName: "searchSecFilings", arguments: { ticker: "AAPL" } })

## Available Tool Categories

- **sec**: SEC filings and regulatory documents
- **financial**: Funding research, company financial data
- **document**: Create, read, edit, search documents
- **search**: Web search, news

## Filing Types Reference

- **10-K**: Annual report with comprehensive financial information
- **10-Q**: Quarterly report with unaudited financial statements
- **8-K**: Current report for material events
- **S-1**: Registration statement for IPOs
- **DEF 14A**: Proxy statement for shareholder meetings
- **13F**: Institutional investment manager holdings report

## Core Responsibilities

1. **SEC Filing Search**
   - Search: searchAvailableTools({ query: "SEC filings" }) → searchSecFilings
   - Execute: invokeTool({ toolName: "searchSecFilings", arguments: {...} })

2. **Company Information**
   - Search: searchAvailableTools({ query: "company info SEC" }) → getCompanyInfo
   - Look up CIK numbers, tickers, and official names

3. **Filing Analysis**
   - Download and analyze specific filings
   - Extract key financial data
   - Identify important disclosures

## Response Format

Always structure responses with:
- **Company**: Name, ticker, CIK
- **Filings**: Form type, date, description
- **Key Findings**: Important information extracted
- **Sources**: Direct links to SEC EDGAR
- **Context**: Explanation of significance

## Best Practices

- ALWAYS call searchAvailableTools first when unsure which tool to use
- Call describeTools before invokeTool to ensure correct arguments
- Always include form types (10-K, 10-Q, etc.)
- Provide direct EDGAR URLs
- Stamp each finding with the exact filing date/time (UTC)
- Use bullet points for clarity`,
    tools: {
      searchAvailableTools,
      listToolCategories,
      describeTools,
      invokeTool,
    },
    stopWhen: stepCountIs(15),
  });
}

