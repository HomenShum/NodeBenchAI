/**
 * Entity Research Agent - Specialized agent for deep research on companies and people
 * 
 * Responsibilities:
 * - Deep company research (funding, founders, thesis, risks)
 * - Person research (background, education, track record)
 * - Hashtag/Topic research
 */

import { Agent, stepCountIs } from "@convex-dev/agent";
import { components } from "../../../../../_generated/api";
import { createTool } from "@convex-dev/agent";
import { getLanguageModelSafe } from "../../../mcp_tools/models/modelResolver";

import { z } from "zod";

// Import existing tools
import {
    enrichFounderInfo,
    enrichInvestmentThesis,
    enrichPatentsAndResearch,
    enrichCompanyDossier,
    smartFundingSearch
} from "../../../../../tools/financial/enhancedFundingTools";

import {
    searchHashtag,
    createHashtagDossier,
    getOrCreateHashtagDossier
} from "../../../../../tools/document/hashtagSearchTools";

// Import GAM unified memory tools
import {
    queryMemory,
    updateMemoryFromReview,
} from "../../../../../tools/knowledge/unifiedMemoryTools";

/**
 * General entity search tool
 * Uses LinkUp API via a simple wrapper (simulated here or imported if available)
 * Since we don't have a direct "searchEntity" tool in the imports, we'll create a simple one
 * wrapping the LinkUp search if possible, or rely on the specialized tools.
 * 
 * For now, we'll define a generic search tool that uses the agent's internal knowledge 
 * or delegates to specific enrichment tools.
 */
const searchEntity = createTool({
    description: `Search for general information about an entity (company or person).
  
  Use this for initial discovery before doing deep enrichment.
  Returns a summary of the entity.`,
    args: z.object({
        query: z.string().describe("Name of the entity to search for"),
        type: z.enum(["company", "person", "general"]).describe("Type of entity"),
    }),
    handler: async (ctx, args) => {
        // In a real implementation, this would call LinkUp or a search API.
        // For this implementation, we'll use the smartFundingSearch for companies
        // or return a placeholder that prompts the agent to use enrichment tools.

        if (args.type === "company") {
            return `To research company "${args.query}", please use the 'enrichCompanyDossier' tool which provides deep analysis including funding, founders, and investment thesis.`;
        }

        if (args.type === "person") {
            // We can use enrichFounderInfo for people if they are founders
            return `To research person "${args.query}", please use the 'enrichFounderInfo' tool (passing their company if known) or rely on your general knowledge.`;
        }

        return `For general research on "${args.query}", please use specific enrichment tools if applicable.`;
    }
});

/**
 * Create an Entity Research Agent instance
 * 
 * @param model - Language model to use
 * @returns Configured Entity Research Agent
 */
export function createEntityResearchAgent(model: string) {
    return new Agent(components.agent, {
        name: "EntityResearchAgent",
        languageModel: getLanguageModelSafe(model),
        instructions: `You are the Entity Research Agent for NodeBench AI.
    
    # RESPONSIBILITIES
    Your goal is to provide deep, banker-quality research on companies and people.
    
    # TOOLS
    
    ## Company Research
    - **enrichCompanyDossier**: THE PRIMARY TOOL for company research. Runs a full pipeline (Founders + Thesis + IP).
    - **smartFundingSearch**: Find recent funding rounds.
    - **enrichInvestmentThesis**: Analyze why a company was funded.
    - **enrichPatentsAndResearch**: Look for IP/Patents (Life Sciences focus).
    
    ## Person Research
    - **enrichFounderInfo**: Research founders' backgrounds, exits, and education.
    
    ## Topic/Hashtag Research
    - **searchHashtag**: Find documents about a topic.
    - **createHashtagDossier**: Create a dossier for a topic.
    
    # GAM PROTOCOL (MANDATORY)
    
    This protocol is NON-NEGOTIABLE. You MUST follow it.
    
    ## BEFORE Research (REQUIRED)
    1. ALWAYS call \`queryMemory\` for the target entity/topic FIRST
    2. Use existing facts and narratives as context
    3. Focus research on NEW information not already in memory
    
    ## AFTER Deep Research (REQUIRED)
    After producing ANY deep analysis, you MUST:
    1. Extract structured facts from your analysis
    2. Call \`updateMemoryFromReview\` with:
       - entityName: The researched entity
       - entityType: "company" or "person"
       - newFacts: Array of { subject, predicate, object, confidence }
    3. ONLY THEN return your response
    
    NEVER return raw analysis without updating memory first.
    
    ## Return Structure (REQUIRED)
    Always return a structured result:
    {
      summary: "...",
      keyFacts: [...],
      entityName: "...",
      memoryUpdated: true/false
    }
    
    # BEHAVIOR RULES
    1. **Memory First**: ALWAYS check queryMemory before external API calls
    2. **Go Deep**: Don't just give a summary. Look for "why" and "how"
    3. **Use Dossiers**: For companies, use enrichCompanyDossier for full picture
    4. **Cite Sources**: Place URL next to the fact it supports
    5. **Time Stamp**: Every finding needs date/time (UTC) and source/tool
    6. **Persist Learnings**: ALWAYS call updateMemoryFromReview after deep research
    7. **Never Skip Memory Update**: If you did research, memory MUST be updated
    `,
        tools: {
            // Company Tools
            enrichCompanyDossier,
            enrichFounderInfo,
            enrichInvestmentThesis,
            enrichPatentsAndResearch,
            smartFundingSearch,

            // Topic Tools
            searchHashtag,
            createHashtagDossier,
            getOrCreateHashtagDossier,

            // GAM Memory Tools
            queryMemory,
            updateMemoryFromReview,

            // General
            searchEntity
        },
        stopWhen: stepCountIs(10),
    });
}
