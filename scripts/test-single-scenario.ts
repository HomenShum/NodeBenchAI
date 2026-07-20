#!/usr/bin/env npx tsx

/**
 * Single Scenario Test Harness
 *
 * Test one evaluation scenario with verbose logging to debug model issues
 *
 * Usage:
 *   npx tsx scripts/test-single-scenario.ts --model claude-haiku-4.5
 *   npx tsx scripts/test-single-scenario.ts --model gemini-3-flash-preview --scenario banker_vague_disco
 */

import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";
import { writeFileSync } from "fs";
import { join } from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function tryReadConvexEnvVar(name: string): string | null {
  const local = process.env[name];
  if (local && local.trim()) return local.trim();

  const cli = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "convex.cmd" : "convex");
  const res =
    process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${cli}' env get ${name}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
      : spawnSync(cli, ["env", "get", name], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
  if (res.status !== 0) return null;
  const value = String(res.stdout ?? "").trim();
  return value.length ? value : null;
}

const TEST_SCENARIOS = {
  banker_vague_disco: {
    id: "test_banker_vague_disco",
    name: "Banker vague: DISCO outreach",
    query: "DISCO — can we cover them this week? Give me the fastest banker-grade debrief.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "DISCO",
  },
  vc_wedge_disco: {
    id: "test_vc_wedge_disco",
    name: "VC: DISCO wedge analysis",
    query: "DISCO — I want a wedge. What's the thesis and where's the weakness?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "DISCO",
  },
  cto_quickjs_cve: {
    id: "test_cto_quickjs",
    name: "CTO: QuickJS CVE assessment",
    query: "QuickJS — am I exposed? I'm not sure where it's used.",
    expectedPersona: "CTO_TECH_LEAD",
    expectedEntityId: "MQUICKJS",
  },
  minimal_test: {
    id: "test_minimal",
    name: "Minimal test: Just entity name",
    query: "DISCO",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "DISCO",
  },
};

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET");

  const model = getArg("--model") || "claude-haiku-4.5";
  const scenarioKey = (getArg("--scenario") || "banker_vague_disco") as keyof typeof TEST_SCENARIOS;
  const scenario = TEST_SCENARIOS[scenarioKey];

  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}`);
    console.error(`Available: ${Object.keys(TEST_SCENARIOS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n=== Single Scenario Test ===`);
  console.log(`Model: ${model}`);
  console.log(`Scenario: ${scenario.name}`);
  console.log(`Query: "${scenario.query}"`);
  console.log(`Expected: ${scenario.expectedPersona} / ${scenario.expectedEntityId}`);
  console.log(``);

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  console.log(`Running evaluation...`);
  const startTime = Date.now();

  try {
    const result = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
      secret,
      model,
      suite: "core",
      offset: 0,
      limit: 1,
      scenarios: [
        {
          id: scenario.id,
          name: scenario.name,
          query: scenario.query,
          expectedPersona: scenario.expectedPersona,
          expectedEntityId: scenario.expectedEntityId,
        },
      ],
    });

    const elapsed = Date.now() - startTime;

    console.log(`\n=== RESULT (${elapsed}ms) ===`);
    console.log(JSON.stringify(result, null, 2));

    // Save to file for analysis
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outPath = join(
      process.cwd(),
      "docs",
      "architecture",
      "benchmarks",
      `test-single-${model.replace(/[^a-z0-9]/gi, "-")}-${scenarioKey}-${timestamp}.json`
    );

    writeFileSync(outPath, JSON.stringify({ model, scenario, result, elapsed }, null, 2), "utf8");

    console.log(`\n✅ Saved to: ${outPath}`);

    // Extract key diagnostic info
    const run = result?.runs?.[0];
    if (run) {
      console.log(`\n=== DIAGNOSTICS ===`);
      console.log(`Status: ${run.ok ? "PASS ✅" : "FAIL ❌"}`);
      console.log(`Stream status: ${run.execution?.streamStatus ?? "unknown"}`);
      console.log(`Steps: ${run.execution?.stepsCount ?? 0}`);
      console.log(`Tool calls: ${run.execution?.toolCalls?.length ?? 0}`);
      console.log(`Tool results: ${run.execution?.toolResults?.length ?? 0}`);
      console.log(`Input tokens: ${run.execution?.estimatedInputTokens ?? 0}`);
      console.log(`Output tokens: ${run.execution?.estimatedOutputTokens ?? 0}`);

      if (run.execution?.providerUsage) {
        console.log(`Provider tokens: ${run.execution.providerUsage.totalTokens ?? 0}`);
      }

      if (run.failureReasons && run.failureReasons.length > 0) {
        console.log(`\nFailure reasons:`);
        run.failureReasons.forEach((reason: string) => console.log(`  - ${reason}`));
      }

      if (run.responsePreview) {
        console.log(`\nResponse preview (first 500 chars):`);
        console.log(run.responsePreview.slice(0, 500));
      }

      // Check for debrief
      if (run.debrief) {
        console.log(`\n✅ Debrief found:`);
        console.log(`  Persona: ${run.debrief.persona?.inferred} (${run.debrief.persona?.confidence})`);
        console.log(`  Entity: ${run.debrief.entity?.canonicalName}`);
        console.log(`  Verdict: ${run.debrief.verdict}`);
        console.log(`  Tool calls recorded: ${run.debrief.toolsUsed?.length ?? 0}`);
        console.log(`  Next actions: ${run.debrief.nextActions?.length ?? 0}`);
      } else {
        console.log(`\n❌ No debrief found`);
        if (run.debriefValidation?.errors) {
          console.log(`Validation errors:`);
          run.debriefValidation.errors.forEach((err: string) => console.log(`  - ${err}`));
        }
      }
    }

    process.exit(run?.ok ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ ERROR:`, err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
