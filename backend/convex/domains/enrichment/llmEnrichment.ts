/**
 * LLM-Based Metadata Enrichment
 *
 * Uses LLM to extract missing metadata that keyword matching can't find:
 * 1. Improve sector classification (move "Technology" to specific sectors)
 * 2. Extract company locations
 * 3. Extract additional valuations
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

/**
 * Use LLM to enrich a single funding event with better metadata
 */
export const enrichFundingEventWithLLM = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    fields: v.optional(v.array(v.union(
      v.literal("sector"),
      v.literal("location"),
      v.literal("description")
    ))),
  },
  handler: async (ctx, args) => {
    const event = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getFundingEventById, {
      id: args.fundingEventId,
    });

    if (!event) return { success: false, error: "Event not found" };

    const fieldsToEnrich = args.fields ?? ["sector", "location", "description"];

    // Build prompt
    const prompt = `Analyze this startup funding announcement and extract metadata:

Company: ${event.companyName}
Funding: ${event.amountRaw} (${event.roundType})
${event.description ? `Description: ${event.description}` : ""}
Source URL: ${event.sourceUrls[0] || "Unknown"}

Extract the following information:

1. SECTOR: Classify into one of these categories:
   - AI/ML - Foundation Models, Generative AI, Robotics, AI Agents, Infrastructure, Computer Vision, Vertical AI
   - HealthTech - Digital Health, MedTech, Biotech
   - FinTech - Banking Infrastructure, Lending, InsurTech, Wealth Management, Compliance
   - Enterprise SaaS - Security, DevTools, Data Infrastructure, Collaboration
   - DeepTech - Semiconductors, Quantum Computing, Defense Tech, Space Tech
   - LegalTech, Construction Tech, Climate Tech, EdTech, Consumer, Crypto/Web3, Retail Tech
   - Technology (only if none of the above fit)

2. LOCATION: Company headquarters or primary location (country or "City, Country")

3. IMPROVED_DESCRIPTION: A one-sentence description of what the company does (if not already clear)

Be specific with sectors. Avoid defaulting to "Technology" if a more specific category fits.`;

    try {
      const { generateObject } = await import("ai");
      const { getLanguageModelSafe } = await import("../agents/mcp_tools/models/modelResolver");

      const model = getLanguageModelSafe("qwen3-coder-free");

      const schema = {
        type: "object",
        properties: {
          sector: {
            type: "string",
            description: "Specific industry sector",
          },
          location: {
            type: "string",
            description: "Company headquarters location (or 'Unknown' if not found)",
          },
          improvedDescription: {
            type: "string",
            description: "One-sentence company description",
          },
          confidence: {
            type: "number",
            description: "Confidence in extractions (0-1)",
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of classifications",
          },
        },
        required: ["sector", "location", "confidence", "reasoning"],
      };

      const result = await generateObject({
        model,
        schema: schema as any,
        prompt,
      });

      const enrichment = result.object as any;

      // Update only requested fields
      const updates: any = {
        updatedAt: Date.now(),
      };

      if (fieldsToEnrich.includes("sector") && enrichment.sector && enrichment.sector !== event.sector) {
        updates.sector = enrichment.sector;
      }

      if (fieldsToEnrich.includes("location") && enrichment.location && !event.location) {
        updates.location = enrichment.location;
      }

      if (fieldsToEnrich.includes("description") && enrichment.improvedDescription) {
        // Append to existing description
        const newDesc = event.description
          ? `${event.description}\n\n[LLM Enrichment] ${enrichment.improvedDescription}`
          : enrichment.improvedDescription;
        updates.description = newDesc;
      }

      // Only update if there are changes
      if (Object.keys(updates).length > 1) {
        await ctx.runMutation(internal.domains.enrichment.llmEnrichment.updateEventMetadata, {
          fundingEventId: args.fundingEventId,
          updates,
        });
      }

      return {
        success: true,
        enrichment,
        updated: Object.keys(updates).length > 1,
      };
    } catch (error: any) {
      console.error("[enrichFundingEventWithLLM] Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

export const updateEventMetadata = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fundingEventId, args.updates);
  },
});

/**
 * Batch enrich all "Technology" companies to improve sector classification
 */
export const batchEnrichTechnologyCompanies = internalAction({
  args: {
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lookbackHours = args.lookbackHours ?? 720;
    const limit = args.limit ?? 100;
    const dryRun = args.dryRun ?? false;

    console.log(`[batchEnrichTechnology] Starting... (dryRun: ${dryRun})`);

    // Get all events
    const allEvents = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours,
      limit,
    });

    // Filter for "Technology" sector or missing locations
    const eventsToEnrich = allEvents.filter(e =>
      e.sector === "Technology" || !e.location
    );

    console.log(`[batchEnrichTechnology] Found ${eventsToEnrich.length} events to enrich`);

    const results = {
      total: eventsToEnrich.length,
      enriched: 0,
      failed: 0,
      skipped: 0,
    };

    for (let i = 0; i < eventsToEnrich.length; i++) {
      const event = eventsToEnrich[i];
      console.log(`[batchEnrichTechnology] Processing ${i + 1}/${eventsToEnrich.length}: ${event.companyName}`);

      if (dryRun) {
        console.log(`  - Would enrich: sector, location, description`);
        continue;
      }

      try {
        const result = await ctx.runAction(internal.domains.enrichment.llmEnrichment.enrichFundingEventWithLLM, {
          fundingEventId: event.id as any,
          fields: ["sector", "location", "description"],
        });

        if (result.success) {
          if (result.updated) {
            results.enriched++;
            console.log(`  ✓ Enriched: sector=${result.enrichment?.sector}, location=${result.enrichment?.location}`);
          } else {
            results.skipped++;
          }
        } else {
          results.failed++;
          console.log(`  ✗ Failed: ${result.error}`);
        }
      } catch (e: any) {
        console.log(`  ✗ Error: ${e.message}`);
        results.failed++;
      }

      // Rate limiting to avoid API overload
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    }

    console.log(`[batchEnrichTechnology] Complete!`);
    console.log(`  - Enriched: ${results.enriched}`);
    console.log(`  - Skipped: ${results.skipped}`);
    console.log(`  - Failed: ${results.failed}`);

    return {
      success: true,
      results,
    };
  },
});
