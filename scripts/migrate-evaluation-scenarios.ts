#!/usr/bin/env npx tsx

/**
 * Migration script: Load evaluation scenarios from JSON into Convex database
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/migrate-evaluation-scenarios.ts
 */

import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const packPath = join(process.cwd(), "docs", "architecture", "benchmarks", "persona-episode-eval-pack-v2.json");

  console.log(`Loading scenarios from: ${packPath}`);
  const packData = readFileSync(packPath, "utf-8");
  const pack = JSON.parse(packData);

  if (!Array.isArray(pack.scenarios)) {
    throw new Error("Invalid pack format: scenarios array not found");
  }

  console.log(`Found ${pack.scenarios.length} scenarios`);

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  // Transform scenarios to match database schema
  const scenarios = pack.scenarios.map((s: any) => ({
    scenarioId: s.id,
    name: s.name,
    query: s.input,
    expectedPersona: s.persona,
    expectedEntityId: s.groundTruth?.lookupId ?? s.id,
    allowedPersonas: s.checks?.allowedPersonas,
    domain: s.domain,
    requirements: s.checks ? {
      minToolCalls: s.checks.minToolCalls,
      maxToolCalls: s.checks.maxToolCalls,
      maxCostUsd: s.checks.maxCostUsd,
      maxClarifyingQuestions: s.checks.maxClarifyingQuestions,
      requireVerificationStep: s.checks.verificationStep,
      requireProviderUsage: s.checks.requireProviderUsage,
      requireTools: s.checks.requireTools,
    } : undefined,
    version: pack.version || "v2",
  }));

  console.log("Migrating scenarios to database...");

  try {
    // Call the migration mutation
    await client.mutation(api.domains.evaluation.migrateEvaluationScenarios.migrateScenarios, {
      scenarios,
    });

    console.log(`✓ Successfully migrated ${scenarios.length} scenarios to evaluation_scenarios table`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Migration failed: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
