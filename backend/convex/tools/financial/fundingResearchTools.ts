/**
 * Funding Research Tools
 * 
 * Specialized tools for researching today's funding announcements
 * in specific industries (healthcare, life sciences, tech)
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";

/**
 * Search for today's funding announcements in specified industries
 * Uses LinkUp API with date filtering and structured output
 */
export const searchTodaysFunding = createTool({
  description: `Search for today's seed and Series A funding announcements in specified industries.
  
  Returns structured data including:
  - Company name, description, website
  - Funding stage (Seed, Series A)
  - Amount raised
  - Lead investors
  - Industry/sector
  - News sources with links
  
  Use this when users ask about recent funding, investment rounds, or startup news.`,

  args: z.object({
    industries: z.array(z.string()).describe("Industries to search (e.g., ['healthcare', 'life sciences', 'tech'])"),
    fundingStages: z.array(z.enum(['seed', 'series-a', 'series-b'])).default(['seed', 'series-a']).describe("Funding stages to include"),
    includeDate: z.string().optional().describe("Date to search (YYYY-MM-DD format). Defaults to today."),
  }),

  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not configured");
    }

    // Build search query
    const today = args.includeDate || new Date().toISOString().split('T')[0];
    const industryTerms = args.industries.join(' OR ');
    const stageTerms = args.fundingStages.map(s => s.replace('-', ' ')).join(' OR ');

    const query = `funding announcement ${today} (${industryTerms}) (${stageTerms}) investors amount`;

    console.log(`[searchTodaysFunding] Query: ${query}`);

    // Define structured output schema for funding announcements
    const fundingSchema = {
      type: "object",
      description: "Today's funding announcements with detailed information",
      properties: {
        announcements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              companyName: { type: "string" },
              description: { type: "string" },
              website: { type: "string" },
              fundingStage: { type: "string", enum: ["Seed", "Series A", "Series B"] },
              amountRaised: { type: "string" },
              leadInvestors: { type: "array", items: { type: "string" } },
              otherInvestors: { type: "array", items: { type: "string" } },
              industry: { type: "string" },
              sector: { type: "string" },
              location: { type: "string" },
              announcementDate: { type: "string" },
              newsSource: { type: "string" },
              newsUrl: { type: "string" },
              keyHighlights: { type: "array", items: { type: "string" } },
            },
            required: ["companyName", "fundingStage", "industry"],
          },
        },
        summary: { type: "string" },
        totalAnnouncements: { type: "number" },
        totalAmountRaised: { type: "string" },
      },
      required: ["announcements", "summary"],
    };

    try {
      // Call LinkUp API with structured output
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "deep", // Use deep search for comprehensive results
          outputType: "structured",
          structuredOutputSchema: fundingSchema,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[searchTodaysFunding] API error:`, errorText);
        throw new Error(`LinkUp API error: ${response.status}`);
      }

      const data = await response.json();
      const structured = data.structured || { announcements: [], summary: "No funding announcements found for today." };

      console.log(`[searchTodaysFunding] Found ${structured.announcements?.length || 0} announcements`);

      // Format response for AI consumption
      const announcements = structured.announcements || [];

      if (announcements.length === 0) {
        return `No funding announcements found for ${today} in ${args.industries.join(', ')}.

Try broadening the search or checking a different date.`;
      }

      // Build formatted response
      const lines: string[] = [];
      lines.push(`# Today's Funding Announcements (${today})`);
      lines.push(`\n${structured.summary || ''}\n`);
      lines.push(`**Total Announcements:** ${announcements.length}`);
      if (structured.totalAmountRaised) {
        lines.push(`**Total Amount Raised:** ${structured.totalAmountRaised}`);
      }
      lines.push('');

      // Group by funding stage
      const byStage: Record<string, any[]> = {};
      announcements.forEach((a: any) => {
        const stage = a.fundingStage || 'Unknown';
        if (!byStage[stage]) byStage[stage] = [];
        byStage[stage].push(a);
      });

      // Format each stage
      for (const [stage, companies] of Object.entries(byStage)) {
        lines.push(`## ${stage} Rounds (${companies.length})`);
        lines.push('');

        companies.forEach((company: any, idx: number) => {
          lines.push(`### ${idx + 1}. ${company.companyName}`);
          if (company.description) {
            lines.push(`**Description:** ${company.description}`);
          }
          if (company.amountRaised) {
            lines.push(`**Amount Raised:** ${company.amountRaised}`);
          }
          if (company.leadInvestors && company.leadInvestors.length > 0) {
            lines.push(`**Lead Investors:** ${company.leadInvestors.join(', ')}`);
          }
          if (company.otherInvestors && company.otherInvestors.length > 0) {
            lines.push(`**Other Investors:** ${company.otherInvestors.join(', ')}`);
          }
          if (company.industry) {
            lines.push(`**Industry:** ${company.industry}`);
          }
          if (company.location) {
            lines.push(`**Location:** ${company.location}`);
          }
          if (company.keyHighlights && company.keyHighlights.length > 0) {
            lines.push(`**Key Highlights:**`);
            company.keyHighlights.forEach((h: string) => lines.push(`- ${h}`));
          }
          if (company.newsUrl) {
            lines.push(`**Source:** [${company.newsSource || 'News'}](${company.newsUrl})`);
          }
          if (company.website) {
            lines.push(`**Website:** ${company.website}`);
          }
          lines.push('');
        });
      }

      // Add sources section
      lines.push('## Sources');
      const sources = announcements
        .filter((a: any) => a.newsUrl)
        .map((a: any) => `- [${a.newsSource || a.companyName}](${a.newsUrl})`);

      if (sources.length > 0) {
        lines.push(...sources);
      }

      return lines.join('\n');

    } catch (error: any) {
      console.error('[searchTodaysFunding] Error:', error);
      return `Error searching for funding announcements: ${error.message}

Please try again or refine your search criteria.`;
    }
  },
});

/**
 * Get detailed company profile for a funded company
 * Useful for follow-up research after finding funding announcements
 */
export const getFundedCompanyProfile = createTool({
  description: `Get detailed profile for a company that recently raised funding.
  
  Returns comprehensive information including:
  - Company overview and business model
  - Full funding history
  - Investor details and backgrounds
  - Product/service details
  - Market position and competitors
  - Recent news and milestones
  
  Use this for deep-dive research on specific companies from funding announcements.`,

  args: z.object({
    companyName: z.string().describe("Name of the company to research"),
  }),

  handler: async (ctx, args): Promise<string> => {
    // Use LinkUp API to search for company profile information
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      return "LinkUp API key not configured. Cannot retrieve company profile.";
    }

    try {
      const query = `${args.companyName} company profile overview business model funding investors`;

      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "deep",
          outputType: "sourcedAnswer",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[getFundedCompanyProfile] API error:`, errorText);
        return `Could not retrieve profile for ${args.companyName}: API error ${response.status}`;
      }

      const data = await response.json();

      if (!data.answer) {
        return `No profile information found for ${args.companyName}`;
      }

      // Format the response with sources
      const lines: string[] = [];
      lines.push(`# ${args.companyName} Profile`);
      lines.push('');
      lines.push(data.answer);

      if (data.sources && data.sources.length > 0) {
        lines.push('');
        lines.push('## Sources');
        data.sources.forEach((source: any, index: number) => {
          lines.push(`${index + 1}. [${source.name}](${source.url})`);
        });
      }

      return lines.join('\n');

    } catch (error: any) {
      return `Error retrieving company profile: ${error.message}`;
    }
  },
});

