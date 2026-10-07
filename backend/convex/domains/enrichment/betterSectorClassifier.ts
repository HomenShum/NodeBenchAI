/**
 * Improved Sector Classifier
 *
 * Re-classifies "Technology" companies into specific sectors using enhanced keywords
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

// Manual sector overrides based on known company types
const COMPANY_SECTOR_OVERRIDES: Record<string, string> = {
  // HealthTech
  "OpenEvidence": "HealthTech - Digital Health",
  "Healthcare AI startup OpenEvidence": "HealthTech - Digital Health",
  "Exciva": "HealthTech - Biotech",
  "Converge Bio": "HealthTech - Biotech",
  "Vaccinex": "HealthTech - Biotech",

  // AI/ML Infrastructure
  "Baseten": "AI/ML - AI Infrastructure",
  "Upscale AI": "AI/ML - AI Infrastructure",
  "Etched": "AI/ML - AI Infrastructure",

  // AI/ML Generative
  "Higgsfield": "AI/ML - Generative AI",

  // AI/ML Vertical
  "Humans": "AI/ML - Vertical AI",
  "WebAI": "AI/ML - Vertical AI",
  "Harmonic": "AI/ML - Vertical AI",
  "Emergent": "AI/ML - Vertical AI",

  // FinTech
  "Pennylane": "FinTech - Banking Infrastructure",
  "Alpaca": "FinTech - Wealth Management",
  "Datarails": "FinTech - Banking Infrastructure",

  // Enterprise SaaS
  "Depthfirst": "Enterprise SaaS - Security",
  "GovDash": "Enterprise SaaS - Collaboration",
  "Deepgram": "Enterprise SaaS - DevTools",

  // DeepTech
  "Type One Energy": "DeepTech - Space Tech",
  "IO River": "Enterprise SaaS - Data Infrastructure",

  // LegalTech
  "Ivo AI": "LegalTech",

  // DeepTech - Quantum
  "Equal1": "DeepTech - Quantum Computing",

  // Defense (already has Defense Tech entry but Onebrief might be missing)
  // Check if Onebrief is already classified

  // Construction
  "XBuild": "Construction Tech",

  // Retail
  "Another": "Retail Tech",

  // Crypto
  "Project Eleven": "Crypto/Web3",

  // Other
  "Flip": "FinTech - Banking Infrastructure",
};

export const improveSectorClassification = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[improveSector] Starting sector reclassification...");

    const events = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours: 720,
      limit: 100,
    });

    console.log(`[improveSector] Found ${events.length} events`);

    // Filter for "Technology" companies
    const techCompanies = events.filter(e => e.sector === "Technology");
    console.log(`[improveSector] Found ${techCompanies.length} generic "Technology" companies`);

    let updated = 0;
    let skipped = 0;

    for (const event of techCompanies) {
      const newSector = COMPANY_SECTOR_OVERRIDES[event.companyName];

      if (!newSector) {
        console.log(`  ⚠️  No override for: ${event.companyName}`);
        skipped++;
        continue;
      }

      console.log(`  ✅ Updating ${event.companyName}: Technology → ${newSector}`);

      try {
        await ctx.runMutation(internal.domains.enrichment.backfillMetadata.updateSector, {
          fundingEventId: event.id as any,
          sector: newSector,
        });
        updated++;
      } catch (e: any) {
        console.log(`  ❌ Failed: ${e.message}`);
      }
    }

    console.log(`[improveSector] Complete!`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Remaining "Technology": ${techCompanies.length - updated}`);

    return {
      success: true,
      updated,
      skipped,
      remaining: techCompanies.length - updated,
    };
  },
});
