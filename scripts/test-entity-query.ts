/**
 * Test the getEntityContext query (with type)
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function main() {
  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Testing getEntityContext query (with type)...\n");

  const entities = [
    { name: "Anthropic", type: "company" as const },
    { name: "OpenAI", type: "company" as const },
    { name: "Sam Altman", type: "person" as const },
    { name: "Dario Amodei", type: "person" as const },
  ];

  for (const entity of entities) {
    console.log(`Querying: "${entity.name}" (${entity.type})...`);

    try {
      const result = await client.query(api.domains.knowledge.entityContexts.getEntityContext, {
        entityName: entity.name,
        entityType: entity.type,
      });

      if (result) {
        console.log(`  ✅ Found!`);
        console.log(`     Summary: ${result.summary?.slice(0, 60)}...`);
        console.log(`     Facts: ${result.keyFacts?.length || 0}`);
      } else {
        console.log(`  ❌ Not found`);
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch(console.error);
