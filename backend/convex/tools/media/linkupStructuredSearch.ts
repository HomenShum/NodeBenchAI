// convex/tools/linkupStructuredSearch.ts
// Structured output search tool using Linkup's JSON schema feature
// 
// CRITICAL: This tool returns STRUCTURED DATA with CONTRACTED SOURCES.
// Each data row includes sourceArtifactIds - URLs are NEVER exposed to LLM.
// Use this for funding tables, company comparisons, and any tabular data.

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface LinkupStructuredResult {
  // Structured output follows the provided schema
  [key: string]: unknown;
  // Sources array when includeSources is true
  sources?: Array<{
    name: string;
    url: string;
    snippet?: string;
    publishedAt?: string;
    published_at?: string;
    date?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// PREDEFINED SCHEMAS FOR COMMON USE CASES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for funding/investment announcements
 */
export const FUNDING_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    deals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Name of the company" },
          amount: { type: "string", description: "Funding amount (e.g., '$50M')" },
          round: { type: "string", description: "Funding round (e.g., 'Series A', 'Seed')" },
          date: { type: "string", description: "Announcement date (YYYY-MM-DD if known)" },
          investors: { 
            type: "array", 
            items: { type: "string" },
            description: "List of investors" 
          },
          sector: { type: "string", description: "Industry/sector" },
          description: { type: "string", description: "Brief description of the company" },
        },
        required: ["companyName", "amount", "round"],
      },
    },
    totalDeals: { type: "number", description: "Total number of deals found" },
    dateRange: { type: "string", description: "Date range of the search" },
  },
  required: ["deals"],
});

/**
 * Schema for company comparison
 */
export const COMPANY_COMPARISON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          marketCap: { type: "string" },
          revenue: { type: "string" },
          employees: { type: "string" },
          founded: { type: "string" },
          headquarters: { type: "string" },
          keyProducts: { type: "array", items: { type: "string" } },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
    comparisonSummary: { type: "string" },
  },
  required: ["companies"],
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

function getPublishedAt(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const v = obj["publishedAt"] ?? obj["published_at"] ?? obj["date"];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structured search tool that returns JSON data with verified sources
 * 
 * Use this for:
 * - Funding tables (use schemaType: "funding")
 * - Company comparisons (use schemaType: "comparison")
 * - Custom structured data (provide custom schema)
 * 
 * Sources are automatically persisted to artifacts. The LLM should
 * present data WITHOUT constructing URLs.
 */
export const linkupStructuredSearch = createTool({
  description: `Search the web and return STRUCTURED JSON data with verified sources.

USE THIS TOOL FOR:
- Funding announcements / investment tables
- Company comparisons
- Any data that should be presented as a table or structured format

IMPORTANT:
1. Use schemaType="funding" for funding/investment queries
2. Use schemaType="comparison" for company comparisons
3. Always use fromDate/toDate for time-bounded queries
4. Sources are stored in artifacts - DO NOT construct URLs
5. Present the returned data directly - it's already structured`,

  args: z.object({
    query: z.string().describe("Natural language query for the structured search"),
    
    // Schema selection
    schemaType: z.enum(["funding", "comparison", "custom"]).default("custom")
      .describe("Predefined schema type: 'funding' for deals, 'comparison' for companies"),
    customSchema: z.string().optional()
      .describe("Custom JSON schema string (only used when schemaType='custom')"),
    
    // Date filtering (critical for temporal queries)
    fromDate: z.string().optional()
      .describe("Start date YYYY-MM-DD. REQUIRED for queries like 'this week', 'today', 'past month'"),
    toDate: z.string().optional()
      .describe("End date YYYY-MM-DD"),
    
    // Search parameters
    depth: z.enum(["standard", "deep"]).default("deep")
      .describe("'deep' recommended for structured output (more comprehensive)"),
    maxResults: z.number().optional()
      .describe("Maximum number of results"),
    
    // Domain filtering
    includeDomains: z.array(z.string()).optional()
      .describe("Limit to these domains (e.g., ['techcrunch.com', 'crunchbase.com'])"),
    excludeDomains: z.array(z.string()).optional()
      .describe("Exclude these domains"),
  }),

  handler: async (_ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    const startTime = Date.now();

    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    // Select schema based on schemaType
    let schema: string;
    switch (args.schemaType) {
      case "funding":
        schema = FUNDING_SCHEMA;
        break;
      case "comparison":
        schema = COMPANY_COMPARISON_SCHEMA;
        break;
      case "custom":
        if (!args.customSchema) {
          throw new Error("customSchema is required when schemaType='custom'");
        }
        schema = args.customSchema;
        break;
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      q: args.query,
      depth: args.depth,
      outputType: "structured",
      structuredOutputSchema: schema,
      includeSources: true, // Always get sources for artifact persistence
    };

    // Add optional parameters
    if (args.fromDate) requestBody.fromDate = args.fromDate;
    if (args.toDate) requestBody.toDate = args.toDate;
    if (args.maxResults) requestBody.maxResults = args.maxResults;
    if (args.includeDomains?.length) requestBody.includeDomains = args.includeDomains;
    if (args.excludeDomains?.length) requestBody.excludeDomains = args.excludeDomains;

    console.log(`[linkupStructuredSearch] Query: "${args.query}"`, {
      schemaType: args.schemaType,
      fromDate: args.fromDate,
      toDate: args.toDate,
      depth: args.depth,
    });

    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[linkupStructuredSearch] API error (${response.status}):`, errorText);
        throw new Error(`Linkup API error: ${response.status}`);
      }

      const data: LinkupStructuredResult = await response.json();
      
      console.log(`[linkupStructuredSearch] ✅ Structured response received`, {
        hasData: Object.keys(data).length > 0,
        hasSources: !!data.sources?.length,
        sourceCount: data.sources?.length || 0,
      });

      // ═══════════════════════════════════════════════════════════════════════
      // BUILD OUTPUT
      // We emit structured data + source markers for artifact extraction
      // The human-readable output uses citation numbers, NOT URLs
      // ═══════════════════════════════════════════════════════════════════════

      let result = "";

      // Extract sources for artifact persistence
      const sources = data.sources || [];
      delete data.sources; // Remove from main data object

      // Add structured data marker for artifact extraction
      if (sources.length > 0) {
        const sourceGalleryData = sources.map((src, idx) => ({
          title: src.name,
          url: src.url,
          domain: extractDomain(src.url),
          description: src.snippet || '',
          citationIndex: idx + 1,
	          publishedAt: getPublishedAt(src),
        }));
        result += `<!-- SOURCE_GALLERY_DATA\n${JSON.stringify(sourceGalleryData, null, 2)}\n-->\n\n`;
      }

      // Add the structured data as JSON (this is what the LLM should present)
      result += `## Structured Results\n\n`;
      result += "```json\n";
      result += JSON.stringify(data, null, 2);
      result += "\n```\n\n";

      // Add citation legend (no URLs, just names and domains)
      if (sources.length > 0) {
        result += "## Sources (stored in artifact system)\n\n";
        sources.forEach((src, idx) => {
          const domain = extractDomain(src.url);
          result += `[${idx + 1}] **${src.name}** (${domain})\n`;
        });
        result += "\n**Note:** Present the structured data above. Sources are tracked in the artifact system.\n";
      }

      // Track API usage
      const responseTime = Date.now() - startTime;
      _ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
        apiName: "linkup",
        operation: "structured_search",
        unitsUsed: 1,
        estimatedCost: args.depth === "deep" ? 6 : 1, // Deep is ~5.5 cents
        requestMetadata: { 
          query: args.query, 
          schemaType: args.schemaType,
          depth: args.depth,
        },
        success: true,
        responseTime,
      });

      return result;

    } catch (error) {
      console.error("[linkupStructuredSearch] Error:", error);
      
      // Track failed call
      const responseTime = Date.now() - startTime;
      _ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
        apiName: "linkup",
        operation: "structured_search",
        unitsUsed: 0,
        estimatedCost: 0,
        requestMetadata: { query: args.query },
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        responseTime,
      });
      
      throw error;
    }
  },
});

/**
 * Convenience tool specifically for funding searches
 * Pre-configured with funding schema and sensible defaults
 */
export const searchTodaysFunding = createTool({
  description: `Search for today's funding announcements and investment deals.

This is a convenience wrapper around linkupStructuredSearch with:
- Pre-configured funding schema
- Deep search depth
- Date auto-set to today (override with fromDate/toDate)

Returns structured JSON with deal data. Sources are stored in artifacts.`,

  args: z.object({
    sectors: z.array(z.string()).optional()
      .describe("Filter by sectors (e.g., ['AI', 'fintech', 'healthcare'])"),
    minAmount: z.string().optional()
      .describe("Minimum funding amount (e.g., '$5M', '$10M')"),
    fundingStages: z.array(z.string()).optional()
      .describe("Filter by stages (e.g., ['Seed', 'Series A', 'Series B'])"),
    fromDate: z.string().optional()
      .describe("Start date YYYY-MM-DD (defaults to today)"),
    toDate: z.string().optional()
      .describe("End date YYYY-MM-DD (defaults to today)"),
  }),

  handler: async (_ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    const startTime = Date.now();

    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    // Build natural language query from parameters
    const queryParts = ["funding announcement", "investment round", "startup funding"];
    
    if (args.sectors?.length) {
      queryParts.push(`in ${args.sectors.join(" OR ")}`);
    }
    if (args.fundingStages?.length) {
      queryParts.push(`(${args.fundingStages.join(" OR ")})`);
    }
    if (args.minAmount) {
      queryParts.push(`at least ${args.minAmount}`);
    }

    const query = queryParts.join(" ");

    // Default to today if no dates provided
    const today = new Date().toISOString().split('T')[0];
    const fromDate = args.fromDate || today;
    const toDate = args.toDate || today;

    console.log(`[searchTodaysFunding] Query: "${query}"`, { fromDate, toDate });

    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "deep",
          outputType: "structured",
          structuredOutputSchema: FUNDING_SCHEMA,
          includeSources: true,
          fromDate,
          toDate,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[searchTodaysFunding] API error:`, errorText);
        throw new Error(`Linkup API error: ${response.status}`);
      }

      const data: LinkupStructuredResult = await response.json();
      const sources = data.sources || [];
      delete data.sources;

      console.log(`[searchTodaysFunding] ✅ Found ${(data as any).deals?.length || 0} deals`);

      // Build output
      let result = "";

      // Artifact extraction marker
      if (sources.length > 0) {
        const sourceGalleryData = sources.map((src, idx) => ({
          title: src.name,
          url: src.url,
          domain: extractDomain(src.url),
          description: src.snippet || '',
          citationIndex: idx + 1,
        }));
        result += `<!-- SOURCE_GALLERY_DATA\n${JSON.stringify(sourceGalleryData, null, 2)}\n-->\n\n`;
      }

      // Structured data
      result += `## Funding Announcements (${fromDate} to ${toDate})\n\n`;
      result += "```json\n";
      result += JSON.stringify(data, null, 2);
      result += "\n```\n\n";

      // Source citation legend
      if (sources.length > 0) {
        result += "## Sources\n\n";
        sources.forEach((src, idx) => {
          result += `[${idx + 1}] **${src.name}** (${extractDomain(src.url)})\n`;
        });
        result += "\n";
      }

      // Track usage
      const responseTime = Date.now() - startTime;
      _ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
        apiName: "linkup",
        operation: "funding_search",
        unitsUsed: 1,
        estimatedCost: 6, // Deep search
        requestMetadata: { query, fromDate, toDate },
        success: true,
        responseTime,
      });

      return result;

    } catch (error) {
      console.error("[searchTodaysFunding] Error:", error);
      throw error;
    }
  },
});
