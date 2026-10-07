/**
 * Enhanced Funding Research Tools
 * 
 * Implements:
 * 1. Auto-fallback logic (T-3, T-7 days expansion)
 * 2. Dossier enrichment (founder search, thesis search, patents)
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";

/**
 * Smart funding search with auto-fallback
 * - Step 1: Search today
 * - Step 2: If 0 results → expand to T-3 days
 * - Step 3: If still 0 → expand to T-7 days
 * - Step 4: If ≤2 deals → go deeper (enrichment)
 */
export const smartFundingSearch = createTool({
  description: `Smart funding search with automatic fallback logic.
  
  Searches for funding announcements with intelligent date expansion:
  1. First tries today's deals
  2. If none found, expands to last 3 days
  3. If still none, expands to last 7 days
  4. If sparse results (≤2 deals), triggers deep enrichment
  
  Returns structured funding data with fallback metadata.`,
  
  args: z.object({
    industries: z.array(z.string()).describe("Industries to search"),
    fundingStages: z.array(z.enum(['seed', 'series-a', 'series-b'])).default(['seed', 'series-a']),
    minAmount: z.number().optional().describe("Minimum funding amount in USD"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }
    
    const today = new Date();
    const dateRanges = [
      { days: 0, label: 'today' },
      { days: 3, label: 'last 3 days' },
      { days: 7, label: 'last 7 days' },
    ];
    
    let results: any = null;
    let fallbackApplied = false;
    let dateRangeUsed = 'today';
    
    // Try each date range until we get results
    for (const range of dateRanges) {
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - range.days);
      const dateStr = startDate.toISOString().split('T')[0];
      
      console.log(`[smartFundingSearch] Trying ${range.label} (since ${dateStr})`);
      
      const industryTerms = args.industries.join(' OR ');
      const stageTerms = args.fundingStages.map(s => s.replace('-', ' ')).join(' OR ');
      const query = `funding announcement since:${dateStr} (${industryTerms}) (${stageTerms})`;
      
      const fundingSchema = {
        type: "object",
        properties: {
          announcements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                companyName: { type: "string" },
                description: { type: "string" },
                website: { type: "string" },
                fundingStage: { type: "string" },
                amountRaised: { type: "string" },
                leadInvestors: { type: "array", items: { type: "string" } },
                industry: { type: "string" },
                sector: { type: "string" },
                location: { type: "string" },
                announcementDate: { type: "string" },
                newsUrl: { type: "string" },
                keyHighlights: { type: "array", items: { type: "string" } },
              },
            },
          },
          totalAnnouncements: { type: "number" },
        },
      };
      
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
            structuredOutputSchema: fundingSchema,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          const announcements = data.output?.announcements || [];
          
          // Filter by min amount if specified
          const filtered = args.minAmount
            ? announcements.filter((a: any) => {
                const amount = parseAmount(a.amountRaised);
                return amount >= args.minAmount!;
              })
            : announcements;
          
          if (filtered.length > 0) {
            results = { ...data.output, announcements: filtered };
            dateRangeUsed = range.label;
            fallbackApplied = range.days > 0;
            break;
          }
        }
      } catch (err) {
        console.error(`[smartFundingSearch] Error for ${range.label}:`, err);
      }
    }
    
    if (!results || results.announcements.length === 0) {
      return JSON.stringify({
        announcements: [],
        fallback: { applied: true, reason: 'No deals found in last 7 days', dateRange: 'last 7 days' },
        suggestion: 'Try broadening industry criteria or lowering minimum amount threshold.',
      });
    }
    
    // Check if we should trigger enrichment (≤2 deals)
    const shouldEnrich = results.announcements.length <= 2;
    
    return JSON.stringify({
      ...results,
      fallback: fallbackApplied ? {
        applied: true,
        originalDate: 'today',
        expandedTo: dateRangeUsed,
        reason: `No deals found today, expanded search to ${dateRangeUsed}`,
      } : { applied: false },
      enrichmentRecommended: shouldEnrich,
      metadata: {
        dateRange: dateRangeUsed,
        totalDeals: results.announcements.length,
      },
    });
  },
});

/**
 * Enrich company dossier with founder information
 * Searches for founder backgrounds, prior exits, education
 */
export const enrichFounderInfo = createTool({
  description: `Deep dive into company founders' backgrounds.

  Searches for:
  - Founder names and roles
  - Prior companies and exits
  - Educational background (schools, degrees)
  - Notable achievements
  - LinkedIn profiles

  Use this to add credibility and context to investment thesis.`,

  args: z.object({
    companyName: z.string().describe("Company name to research"),
    industry: z.string().optional().describe("Industry context for better search"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    const query = `"${args.companyName}" founders CEO co-founder background education prior company exit`;

    const founderSchema = {
      type: "object",
      properties: {
        founders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              priorCompanies: { type: "array", items: { type: "string" } },
              education: { type: "array", items: { type: "string" } },
              notableAchievements: { type: "array", items: { type: "string" } },
              linkedIn: { type: "string" },
            },
          },
        },
        summary: { type: "string" },
      },
    };

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
          structuredOutputSchema: founderSchema,
        }),
      });

      if (!response.ok) {
        return `Error searching founder info: ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data.output || { founders: [], summary: 'No founder information found' });
    } catch (err) {
      return `Error: ${err}`;
    }
  },
});

/**
 * Research investment thesis - why this round happened
 * Looks for clinical trials, FDA approvals, product launches, partnerships
 */
export const enrichInvestmentThesis = createTool({
  description: `Research why investors funded this company now.

  Searches for catalysts:
  - Clinical trial results (Phase 1/2/3)
  - FDA approvals or submissions
  - Product launches or milestones
  - Strategic partnerships
  - Market validation signals
  - Competitive advantages

  Returns structured thesis points for "Why This Matters" section.`,

  args: z.object({
    companyName: z.string().describe("Company name"),
    industry: z.string().describe("Industry/sector for context"),
    fundingStage: z.string().optional().describe("Funding stage (Seed, Series A, etc.)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    // Build query based on industry
    const isLifeSciences = args.industry.toLowerCase().includes('life sciences') ||
                           args.industry.toLowerCase().includes('biotech') ||
                           args.industry.toLowerCase().includes('pharma');

    const catalystTerms = isLifeSciences
      ? 'clinical trial FDA approval Phase pipeline patent'
      : 'product launch partnership revenue traction market validation';

    const query = `"${args.companyName}" ${catalystTerms} milestone breakthrough innovation`;

    const thesisSchema = {
      type: "object",
      properties: {
        whyFunded: {
          type: "array",
          items: { type: "string" },
          description: "Key reasons why investors funded this company",
        },
        catalysts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["clinical_trial", "fda_approval", "product_launch", "partnership", "market_validation", "other"] },
              description: { type: "string" },
              date: { type: "string" },
            },
          },
        },
        competitiveAdvantages: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
    };

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
          structuredOutputSchema: thesisSchema,
        }),
      });

      if (!response.ok) {
        return `Error researching thesis: ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data.output || { whyFunded: [], catalysts: [], risks: [], summary: 'No thesis information found' });
    } catch (err) {
      return `Error: ${err}`;
    }
  },
});

/**
 * Search for patents and research papers (life sciences focus)
 * Adds scientific credibility to dossier
 */
export const enrichPatentsAndResearch = createTool({
  description: `Search for patents and research papers related to company's technology.

  Particularly useful for life sciences, biotech, pharma companies.

  Searches for:
  - Patent filings and grants
  - Research papers and publications
  - Clinical trial registrations
  - Scientific citations

  Returns structured IP and research data.`,

  args: z.object({
    companyName: z.string().describe("Company name"),
    technology: z.string().optional().describe("Technology or therapeutic area"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    const techTerm = args.technology || '';
    const query = `"${args.companyName}" ${techTerm} patent OR "research paper" OR "clinical trial" OR publication`;

    const researchSchema = {
      type: "object",
      properties: {
        patents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              patentNumber: { type: "string" },
              filingDate: { type: "string" },
              status: { type: "string" },
              summary: { type: "string" },
            },
          },
        },
        papers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              authors: { type: "array", items: { type: "string" } },
              journal: { type: "string" },
              publicationDate: { type: "string" },
              citations: { type: "number" },
              url: { type: "string" },
            },
          },
        },
        clinicalTrials: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nctId: { type: "string" },
              title: { type: "string" },
              phase: { type: "string" },
              status: { type: "string" },
              startDate: { type: "string" },
            },
          },
        },
        summary: { type: "string" },
      },
    };

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
          structuredOutputSchema: researchSchema,
        }),
      });

      if (!response.ok) {
        return `Error searching patents/research: ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data.output || { patents: [], papers: [], clinicalTrials: [], summary: 'No IP or research found' });
    } catch (err) {
      return `Error: ${err}`;
    }
  },
});

/**
 * Orchestrator tool - runs full enrichment pipeline
 * Use this when you have ≤2 deals and want to go deep
 *
 * NOTE: This tool provides instructions for the agent to call the enrichment tools.
 * The agent will execute enrichFounderInfo, enrichInvestmentThesis, and enrichPatentsAndResearch
 * in sequence based on these instructions.
 */
export const enrichCompanyDossier = createTool({
  description: `Guide for running full dossier enrichment pipeline for a company.

  INSTRUCTIONS FOR AGENT:
  When you need to enrich a company dossier, execute these tools in sequence:

  1. Call enrichFounderInfo with { companyName, industry }
     - This gets founder backgrounds, prior exits, education

  2. Call enrichInvestmentThesis with { companyName, industry, fundingStage }
     - This analyzes why investors funded this company
     - Gets catalysts, competitive advantages, risks

  3. (Optional) Call enrichPatentsAndResearch with { companyName, technology }
     - Only for life sciences/biotech/pharma companies
     - Gets patents, research papers, clinical trials

  4. Synthesize all results into a comprehensive dossier with:
     - Company overview
     - Why funded (investment thesis)
     - Founders (with highlights)
     - Lead investors
     - Notable risks

  Use this workflow when you have sparse results (≤2 deals) and want to provide
  deep, banker-quality analysis instead of surface-level summaries.`,

  args: z.object({
    companyName: z.string().describe("Company name to enrich"),
    industry: z.string().describe("Industry/sector for context"),
    fundingStage: z.string().optional().describe("Funding stage (Seed, Series A, etc.)"),
    includePatents: z.boolean().default(true).describe("Whether to include patent/research search (recommended for life sciences)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    // This tool returns instructions for the agent to follow
    // The agent will call the individual enrichment tools
    const isLifeSciences = args.industry.toLowerCase().includes('life sciences') ||
                           args.industry.toLowerCase().includes('biotech') ||
                           args.industry.toLowerCase().includes('pharma');

    return `ENRICHMENT WORKFLOW for ${args.companyName}:

1. First, call enrichFounderInfo to get founder backgrounds
2. Then, call enrichInvestmentThesis to understand why this company was funded
${args.includePatents && isLifeSciences ? '3. Finally, call enrichPatentsAndResearch to get IP and research validation' : ''}

After gathering all enrichment data, synthesize it into a comprehensive company dossier with:
- Company: ${args.companyName}
- Industry: ${args.industry}
- Round: ${args.fundingStage || 'Unknown'}
- Why This Matters: [Key investment thesis points from enrichInvestmentThesis]
- Founders: [Founder profiles from enrichFounderInfo]
- Notable Risks: [Risk factors from enrichInvestmentThesis]
${args.includePatents && isLifeSciences ? '- IP Portfolio: [Patent summary from enrichPatentsAndResearch]' : ''}

Present this as a structured dossier for banker review.`;
  },
});

// Helper function
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const match = amountStr.match(/[\d.]+/);
  if (!match) return 0;
  const num = parseFloat(match[0]);
  if (amountStr.toLowerCase().includes('b')) return num * 1000000000;
  if (amountStr.toLowerCase().includes('m')) return num * 1000000;
  if (amountStr.toLowerCase().includes('k')) return num * 1000;
  return num;
}

