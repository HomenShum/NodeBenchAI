/**
 * Manual Location Enrichment Script
 *
 * Quick manual population of known company locations from analysis
 */

import { api } from "../backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../backend/convex/_generated/dataModel";

const client = new ConvexHttpClient(process.env.CONVEX_URL!);

// Known locations from AVAILABLE_METRICS_ANALYSIS.md
const KNOWN_LOCATIONS: Record<string, string> = {
  "Baseten": "United States",
  "OpenEvidence": "United States",
  "Humans": "United States",
  "Pennylane": "France",
  "Skild AI": "United States",
  "Harmonic": "United States",
  "Equal1": "Ireland",
  "Ivo AI": "Australia",
  "Emergent": "United States",
  "Alpaca": "United States",
  "Datarails": "United States",
  "Higgsfield": "United Kingdom",
  "Etched": "United States",
  "Aikido Security": "Belgium",
  "Onebrief": "United States",
  "Depthfirst": "United States",
  "GovDash": "United States",
  "Type One Energy": "United States",
  "Exciva": "United States",
  "Nexxa AI": "United States",
  "RiskFront": "United States",
  "XBuild": "United States",
  "Project Eleven": "United States",
  "Another": "United States",
  "Defense Unicorns": "United States",
  "WebAI": "United States",
  "Flip": "United States",
  "Deepgram": "United States",
  "Converge Bio": "United States",
  "Vaccinex": "United States",
  "IO River": "Israel",
  "Upscale AI": "United States",
};

async function updateLocations() {
  console.log("[manualEnrichLocations] Starting...");

  // Get all recent events
  const events = await client.query(api.domains.enrichment.fundingQueries.getRecentFundingEvents, {
    lookbackHours: 720,
    limit: 100,
  });

  console.log(`Found ${events.length} events`);

  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const location = KNOWN_LOCATIONS[event.companyName];

    if (!location) {
      console.log(`  ⚠️  No location data for: ${event.companyName}`);
      skipped++;
      continue;
    }

    if (event.location) {
      console.log(`  ⏭️  Already has location: ${event.companyName} (${event.location})`);
      skipped++;
      continue;
    }

    console.log(`  ✅ Updating ${event.companyName} → ${location}`);

    try {
      await client.mutation(api.domains.enrichment.backfillMetadata.updateLocation, {
        fundingEventId: event.id as Id<"fundingEvents">,
        location,
      });
      updated++;
    } catch (e: any) {
      console.log(`  ❌ Failed to update ${event.companyName}: ${e.message}`);
    }
  }

  console.log(`\n[manualEnrichLocations] Complete!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${events.length}`);
}

updateLocations().catch(console.error);
