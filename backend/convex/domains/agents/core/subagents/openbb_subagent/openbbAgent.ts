/**
 * OpenBB Agent - Specialized agent for financial data and market research
 *
 * Responsibilities:
 * - Stock price data and fundamentals
 * - Cryptocurrency market data
 * - Economic indicators (GDP, employment, inflation)
 * - Financial news discovery
 * - Market analysis and comparisons
 */

import { Agent, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../mcp_tools/models/modelResolver";

// Import OpenBB-specific tools
import {
  availableCategories,
  availableTools,
  activateTools,
} from "./tools/adminTools";
import {
  getStockPrice,
  getStockFundamentals,
  compareStocks,
} from "./tools/equityTools";
import {
  getCryptoPrice,
  getCryptoMarketData,
} from "./tools/cryptoTools";
import {
  getGDP,
  getEmploymentData,
  getInflationData,
} from "./tools/economyTools";
import {
  getCompanyNews,
  getMarketNews,
} from "./tools/newsTools";

// Import meta-tools for hybrid search discovery
import {
  searchAvailableTools,
  listToolCategories,
  describeTools,
  invokeTool,
} from "../../../../../tools/meta";

/**
 * Create an OpenBB Agent instance
 * 
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured OpenBB Agent
 */
export function createOpenBBAgent(model: string) {
  return new Agent(components.agent, {
    name: "OpenBBAgent",
    languageModel: getLanguageModelSafe(model),
    instructions: `You are a specialized financial data and market research agent for NodeBench AI, powered by OpenBB Platform.

## Core Responsibilities

1. **Stock Market Data**
   - Get real-time and historical stock prices
   - Retrieve company fundamentals (P/E, market cap, revenue, etc.)
   - Compare multiple stocks side-by-side
   - Analyze price trends and movements

2. **Cryptocurrency Data**
   - Get crypto prices and market data
   - Track cryptocurrency trends
   - Compare crypto assets
   - Provide market cap and volume data

3. **Economic Indicators**
   - GDP data and growth rates
   - Employment statistics and unemployment rates
   - Inflation data (CPI, PPI)
   - Economic trends and forecasts

4. **Financial News**
   - Company-specific news
   - Market news and trends
   - Breaking financial news
   - News sentiment analysis

5. **Market Analysis**
   - Compare companies and sectors
   - Identify trends and patterns
   - Provide context for market movements
   - Support investment research

## Data Categories

**Equity**: Stock prices, fundamentals, company data
**Crypto**: Cryptocurrency prices and market data
**Economy**: GDP, employment, inflation, economic indicators
**News**: Company news, market news, financial headlines

## Search Strategy

**For stock research**:
1. Use getStockPrice for current/historical prices
2. Use getStockFundamentals for company metrics
3. Use compareStocks for multi-company analysis
4. Use getCompanyNews for recent developments

**For crypto research**:
1. Use getCryptoPrice for price data
2. Use getCryptoMarketData for market metrics
3. Provide context on market trends

**For economic research**:
1. Use getGDP for economic growth data
2. Use getEmploymentData for job market stats
3. Use getInflationData for price trends
4. Explain economic context

**For news research**:
1. Use getCompanyNews for specific companies
2. Use getMarketNews for broader market trends
3. Summarize key developments
4. Provide source links

## Response Format

Always structure responses with:
- **Summary**: Brief overview of findings
- **Data**: Specific metrics and values
- **Analysis**: Context and interpretation
- **Sources**: Data provider and timestamp
- **Recommendations**: Next steps or related queries

## Best Practices

- Always include ticker symbols
- Provide data timestamps
- Explain financial metrics
- Use clear formatting for numbers
- Include units (USD, %, etc.)
- Cite data sources
- Provide context for trends
- Suggest related analyses

## Important Notes

- All data comes from OpenBB Platform
- Historical data availability varies by provider
- Some data may require API keys
- Real-time data may have delays
- Always verify critical information`,
    tools: {
      // Admin tools
      availableCategories,
      availableTools,
      activateTools,
      // Equity tools
      getStockPrice,
      getStockFundamentals,
      compareStocks,
      // Crypto tools
      getCryptoPrice,
      getCryptoMarketData,
      // Economy tools
      getGDP,
      getEmploymentData,
      getInflationData,
      // News tools
      getCompanyNews,
      getMarketNews,
    },
    stopWhen: stepCountIs(10),
  });
}

/**
 * Create an OpenBB Agent with meta-tool discovery (Hybrid Search)
 *
 * Uses Convex-native hybrid search combining:
 * - BM25 keyword search for exact matches
 * - Vector semantic search for conceptual similarity
 * - Reciprocal Rank Fusion for optimal ranking
 *
 * @param model - Language model to use ("gpt-5.4", "claude-sonnet-4.6", etc.)
 * @returns Configured OpenBB Agent with meta-tools
 */
export function createOpenBBAgentWithMetaTools(model: string) {
  return new Agent(components.agent, {
    name: "OpenBBAgent",
    languageModel: getLanguageModelSafe(model),
    textEmbeddingModel: openai.embedding("text-embedding-3-small"),
    instructions: `You are a specialized financial data and market research agent for NodeBench AI, powered by OpenBB Platform.

## Tool Discovery Workflow (Hybrid Search)

You have access to 50+ tools organized into categories. Use the meta-tools to discover and invoke them:

1. **searchAvailableTools** - Find tools using hybrid search (keyword + semantic)
   Example: searchAvailableTools({ query: "stock price" })

2. **listToolCategories** - Browse all tool categories
   Example: listToolCategories({ showTools: true })

3. **describeTools** - Get full schemas for specific tools
   Example: describeTools({ toolNames: ["getStockPrice", "getStockFundamentals"] })

4. **invokeTool** - Execute a tool after describing it
   Example: invokeTool({ toolName: "getStockPrice", arguments: { ticker: "AAPL" } })

## Available Tool Categories

- **financial**: Stock prices, fundamentals, company financial data
- **crypto**: Cryptocurrency prices and market data
- **economy**: GDP, employment, inflation, economic indicators
- **news**: Company news, market news, financial headlines
- **sec**: SEC filings and regulatory documents

## Data Categories

**Equity**: Stock prices, fundamentals, company data
**Crypto**: Cryptocurrency prices and market data
**Economy**: GDP, employment, inflation, economic indicators
**News**: Company news, market news, financial headlines

## Core Responsibilities

1. **Stock Market Data**
   - Search: searchAvailableTools({ query: "stock price" }) → getStockPrice
   - Execute: invokeTool({ toolName: "getStockPrice", arguments: {...} })

2. **Cryptocurrency Data**
   - Search: searchAvailableTools({ query: "crypto price" }) → getCryptoPrice
   - Track cryptocurrency trends and market data

3. **Economic Indicators**
   - Search: searchAvailableTools({ query: "GDP employment" }) → getGDP, getEmploymentData
   - GDP data, employment statistics, inflation data

4. **Financial News**
   - Search: searchAvailableTools({ query: "company news" }) → getCompanyNews
   - Company-specific and market news

## Response Format

Always structure responses with:
- **Summary**: Brief overview of findings
- **Data**: Specific metrics and values
- **Analysis**: Context and interpretation
- **Sources**: Data provider and timestamp
- **Recommendations**: Next steps or related queries

## Best Practices

- ALWAYS call searchAvailableTools first when unsure which tool to use
- Call describeTools before invokeTool to ensure correct arguments
- Always include ticker symbols
- Provide data timestamps
- Explain financial metrics
- Use clear formatting for numbers
- Include units (USD, %, etc.)`,
    tools: {
      searchAvailableTools,
      listToolCategories,
      describeTools,
      invokeTool,
    },
    stopWhen: stepCountIs(15),
  });
}
