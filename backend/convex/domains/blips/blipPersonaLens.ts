/**
 * blipPersonaLens.ts - Generate persona-specific lenses for blips
 *
 * Creates 10 persona lenses per blip with framing hooks and relevance scores.
 * Leverages existing 10-persona system from autonomousConfig.ts.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { PersonaId } from "./types";

// ============================================================================
// Persona Definitions
// ============================================================================

const PERSONAS: Record<PersonaId, {
  name: string;
  sectors: string[];
  keywords: string[];
  framePrefix: string;
}> = {
  JPM_STARTUP_BANKER: {
    name: "JPM Startup Banker",
    sectors: ["biotech", "fintech", "healthtech", "climatetech"],
    keywords: ["funding", "ipo", "m&a", "valuation", "series"],
    framePrefix: "Deal signal:",
  },
  EARLY_STAGE_VC: {
    name: "Early Stage VC",
    sectors: ["saas", "ai", "consumer", "marketplace"],
    keywords: ["seed", "series a", "founder", "market", "growth"],
    framePrefix: "Investment angle:",
  },
  CTO_TECH_LEAD: {
    name: "CTO/Tech Lead",
    sectors: ["infrastructure", "devtools", "security", "cloud"],
    keywords: ["architecture", "scale", "performance", "open source"],
    framePrefix: "Tech implication:",
  },
  ACADEMIC_RD: {
    name: "Academic R&D",
    sectors: ["research", "ml", "science", "papers"],
    keywords: ["research", "paper", "breakthrough", "methodology"],
    framePrefix: "Research insight:",
  },
  PHARMA_BD: {
    name: "Pharma BD",
    sectors: ["biotech", "pharma", "clinical", "fda"],
    keywords: ["clinical", "approval", "drug", "trial", "fda"],
    framePrefix: "BD opportunity:",
  },
  MACRO_STRATEGIST: {
    name: "Macro Strategist",
    sectors: ["markets", "economics", "policy", "macro"],
    keywords: ["fed", "rates", "inflation", "gdp", "market"],
    framePrefix: "Macro signal:",
  },
  QUANT_PM: {
    name: "Quant PM",
    sectors: ["trading", "data", "algorithms", "quant"],
    keywords: ["alpha", "model", "data", "signal", "volatility"],
    framePrefix: "Quant edge:",
  },
  CORP_DEV: {
    name: "Corporate Development",
    sectors: ["m&a", "partnerships", "integration"],
    keywords: ["acquisition", "merger", "partnership", "strategic"],
    framePrefix: "Strategic move:",
  },
  LP_ALLOCATOR: {
    name: "LP Allocator",
    sectors: ["funds", "allocation", "returns"],
    keywords: ["fund", "returns", "portfolio", "allocation", "vintage"],
    framePrefix: "Allocation signal:",
  },
  JOURNALIST: {
    name: "Journalist",
    sectors: ["media", "news", "coverage"],
    keywords: ["breaking", "exclusive", "source", "story", "angle"],
    framePrefix: "Story angle:",
  },
};

// ============================================================================
// Persona Lens Actions
// ============================================================================

/**
 * Generate persona lenses for a single blip
 */
export const generatePersonaLenses = internalAction({
  args: {
    blipId: v.id("meaningBlips"),
  },
  handler: async (ctx, args) => {
    // Get the blip - we need to get it from all blips
    const blip = await ctx.runQuery(
      internal.domains.blips.blipQueries.getBlipsByCategory,
      { category: "tech", limit: 100 }
    );

    // For now, we'll generate based on basic info
    // In a real implementation, we'd fetch the blip directly

    const lenses: Array<{
      personaId: string;
      framingHook: string;
      actionPrompt?: string;
      relevanceScore: number;
      whyItMatters?: string;
    }> = [];

    // Generate lens for each persona
    for (const [personaId, persona] of Object.entries(PERSONAS)) {
      const lens = await generateLensForPersona(
        args.blipId,
        personaId as PersonaId,
        persona,
        blip[0] // Use first blip as proxy - we'd fetch the actual one
      );
      lenses.push(lens);
    }

    // Bulk insert all lenses
    await ctx.runMutation(
      internal.domains.blips.blipMutations.bulkInsertPersonaLenses,
      {
        blipId: args.blipId,
        lenses,
      }
    );

    return {
      blipId: args.blipId,
      lensesGenerated: lenses.length,
    };
  },
});

/**
 * Generate persona lenses for batch of blips
 */
export const generatePersonaLensesBatch = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get blips that need persona lenses
    // We'll check by looking for blips without lenses
    const allBlips = await ctx.runQuery(
      internal.domains.blips.blipQueries.getBlipsByCategory,
      { category: "tech", limit: 50 }
    );

    // Filter to those without lenses (in practice, we'd have a query for this)
    const blipsToProcess = allBlips.slice(0, limit);
    const results: any[] = [];

    for (const blip of blipsToProcess) {
      try {
        const result = await ctx.runAction(
          internal.domains.blips.blipPersonaLens.generatePersonaLenses,
          { blipId: blip._id }
        );
        results.push(result);
      } catch (error) {
        console.error(`[PersonaLens] Error for ${blip._id}:`, error);
        results.push({ blipId: blip._id, error: String(error) });
      }
    }

    return {
      processed: results.length,
      successful: results.filter((r) => !r.error).length,
    };
  },
});

// ============================================================================
// Lens Generation
// ============================================================================

async function generateLensForPersona(
  blipId: any,
  personaId: PersonaId,
  persona: typeof PERSONAS[PersonaId],
  blip: any
): Promise<{
  personaId: string;
  framingHook: string;
  actionPrompt?: string;
  relevanceScore: number;
  whyItMatters?: string;
}> {
  // Calculate relevance based on category/tags match
  let relevanceScore = 50;

  if (blip) {
    const blipTags = (blip.tags || []).map((t: string) => t.toLowerCase());
    const blipCategory = (blip.category || "").toLowerCase();

    // Check sector match
    for (const sector of persona.sectors) {
      if (blipTags.includes(sector) || blipCategory.includes(sector)) {
        relevanceScore += 15;
      }
    }

    // Check keyword match
    const blipText = [blip.headline, blip.summary, blip.context].join(" ").toLowerCase();
    for (const keyword of persona.keywords) {
      if (blipText.includes(keyword)) {
        relevanceScore += 5;
      }
    }
  }

  relevanceScore = Math.min(100, relevanceScore);

  // Generate framing hook
  const framingHook = await generateFramingHook(persona, blip);

  // Generate action prompt if relevant
  let actionPrompt: string | undefined;
  if (relevanceScore >= 70) {
    actionPrompt = generateActionPrompt(persona, blip);
  }

  // Generate "why it matters"
  let whyItMatters: string | undefined;
  if (relevanceScore >= 60) {
    whyItMatters = generateWhyItMatters(persona, blip);
  }

  return {
    personaId,
    framingHook,
    actionPrompt,
    relevanceScore,
    whyItMatters,
  };
}

async function generateFramingHook(
  persona: typeof PERSONAS[PersonaId],
  blip: any
): Promise<string> {
  if (!blip) {
    return `${persona.framePrefix} Relevance to be determined.`;
  }

  // Try LLM generation
  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../agents/mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      return generateHeuristicFrame(persona, blip);
    }

    const prompt = `You are a ${persona.name}. In ONE sentence (max 15 words), explain why this matters to you.

News: ${blip.summary || blip.headline}
Category: ${blip.category}
Tags: ${(blip.tags || []).join(", ")}

Your focus areas: ${persona.sectors.join(", ")}

Return ONLY the framing sentence starting with "${persona.framePrefix}"`;

    const { text: response } = await generateText({
      model,
      prompt,
      maxOutputTokens: 50,
      temperature: 0.3,
    });

    if (response) {
      return response.slice(0, 100);
    }
  } catch (error) {
    console.error("[PersonaLens] Frame generation error:", error);
  }

  return generateHeuristicFrame(persona, blip);
}

function generateHeuristicFrame(
  persona: typeof PERSONAS[PersonaId],
  blip: any
): string {
  const category = blip?.category || "tech";

  const frames: Record<PersonaId, string> = {
    JPM_STARTUP_BANKER: `${persona.framePrefix} Potential pipeline opportunity in ${category} sector.`,
    EARLY_STAGE_VC: `${persona.framePrefix} Market signal worth monitoring for thesis.`,
    CTO_TECH_LEAD: `${persona.framePrefix} Technical development to evaluate.`,
    ACADEMIC_RD: `${persona.framePrefix} Research implications to consider.`,
    PHARMA_BD: `${persona.framePrefix} Partnership or licensing opportunity.`,
    MACRO_STRATEGIST: `${persona.framePrefix} Sector trend indicator.`,
    QUANT_PM: `${persona.framePrefix} Data point for model consideration.`,
    CORP_DEV: `${persona.framePrefix} Strategic landscape shift.`,
    LP_ALLOCATOR: `${persona.framePrefix} Manager exposure consideration.`,
    JOURNALIST: `${persona.framePrefix} Story angle for coverage.`,
  };

  return frames[persona.name as PersonaId] || `${persona.framePrefix} Worth monitoring.`;
}

function generateActionPrompt(
  persona: typeof PERSONAS[PersonaId],
  blip: any
): string {
  const actions: Record<string, string> = {
    JPM_STARTUP_BANKER: "Add to deal pipeline tracker.",
    EARLY_STAGE_VC: "Schedule founder outreach.",
    CTO_TECH_LEAD: "Evaluate for tech stack consideration.",
    ACADEMIC_RD: "Review full paper/research.",
    PHARMA_BD: "Schedule BD call to explore.",
    MACRO_STRATEGIST: "Update sector thesis.",
    QUANT_PM: "Test signal in backtest.",
    CORP_DEV: "Brief leadership on strategic implications.",
    LP_ALLOCATOR: "Flag for manager meeting.",
    JOURNALIST: "Develop story pitch.",
  };

  return actions[persona.name] || "Follow up for more details.";
}

function generateWhyItMatters(
  persona: typeof PERSONAS[PersonaId],
  blip: any
): string {
  const category = blip?.category || "tech";

  const reasons: Record<string, string> = {
    JPM_STARTUP_BANKER: `Could indicate M&A or financing activity in ${category}.`,
    EARLY_STAGE_VC: `May signal emerging opportunity or competitive threat.`,
    CTO_TECH_LEAD: `Could impact technical decisions or vendor choices.`,
    ACADEMIC_RD: `Advances understanding of the field.`,
    PHARMA_BD: `Potential for collaboration or competitive positioning.`,
    MACRO_STRATEGIST: `Reflects broader sector or market dynamics.`,
    QUANT_PM: `New data source or alpha opportunity.`,
    CORP_DEV: `Strategic landscape shift worth monitoring.`,
    LP_ALLOCATOR: `Impacts manager selection or allocation.`,
    JOURNALIST: `Newsworthy development for audience.`,
  };

  return reasons[persona.name] || "Relevant to your focus areas.";
}
