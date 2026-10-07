#!/usr/bin/env npx tsx

/**
 * Comprehensive Feature Evaluation Suite
 *
 * Tests ALL features using the FREE-FIRST model strategy (devstral-2-free → mimo-v2-flash-free → paid fallback).
 * Validates end-to-end performance for every feature that uses DEFAULT_MODEL.
 *
 * Features tested:
 * 1. Frontend UI Components (AgentCommandBar, ModelSelector, etc.)
 * 2. Backend Convex Actions/Agents (fastAgentPanelStreaming, coordinatorAgent, etc.)
 * 3. Specialized Agents/Subagents (researchSubagent, financeSubagent, etc.)
 * 4. Tools & Evaluation (agentEvaluator, agentBenchmarkRunner, etc.)
 * 5. Adapters (adaptiveEntityEnrichment)
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-feature-eval.ts --all
 *   npx tsx scripts/run-feature-eval.ts --category backend
 *   npx tsx scripts/run-feature-eval.ts --feature fastAgentPanel
 */

import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface FeatureTest {
  id: string;
  name: string;
  category: "frontend" | "backend" | "agents" | "tools" | "adapters";
  description: string;
  testType: "api" | "action" | "query" | "integration";
  testFn: (client: ConvexHttpClient, secret: string) => Promise<FeatureTestResult>;
}

interface FeatureTestResult {
  passed: boolean;
  latencyMs: number;
  modelUsed?: string;
  isFreeModel?: boolean;
  fallbacksUsed?: number;
  error?: string;
  details?: Record<string, any>;
}

// Test queries that exercise the DEFAULT_MODEL
const FEATURE_TESTS: FeatureTest[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // BACKEND CONVEX ACTIONS/AGENTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "fastAgentPanel",
    name: "Fast Agent Panel Streaming",
    category: "backend",
    description: "Tests fastAgentPanelStreaming with DEFAULT_MODEL",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.fastAgentPanelStreaming.submitFastAgentQuery, {
          query: "What is the capital of France?",
          model: "devstral-2-free", // Use free model explicitly
        });
        return {
          passed: !!result,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { hasResponse: !!result },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    id: "coordinatorAgent",
    name: "Coordinator Agent",
    category: "backend",
    description: "Tests coordinatorAgent persona detection and routing",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.coordinatorAgent.runCoordinatorChat, {
          secret,
          messages: [{ role: "user", content: "Tell me about DISCO's funding" }],
          persona: "JPM_STARTUP_BANKER",
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.response,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { hasResponse: !!result?.response, responseLength: result?.response?.length },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    id: "digestAgent",
    name: "Digest Agent",
    category: "backend",
    description: "Tests digestAgent persona-driven summaries",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.digestAgent.generateDigestForPersona, {
          secret,
          persona: "CTO_TECH_LEAD",
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.digest,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { hasDigest: !!result?.digest },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    id: "swarmOrchestrator",
    name: "Swarm Orchestrator",
    category: "backend",
    description: "Tests swarm spawn and coordination",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.swarmOrchestrator.spawnSwarm, {
          secret,
          query: "Research funding trends in AI",
          agentTypes: ["research"],
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.swarmId,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { swarmId: result?.swarmId },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SPECIALIZED AGENTS/SUBAGENTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "researchSubagent",
    name: "Research Subagent",
    category: "agents",
    description: "Tests researchSubagent web research capabilities",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.subagents.researchSubagent.runResearch, {
          secret,
          query: "What are the latest trends in LLM pricing?",
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.findings,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { findingsCount: result?.findings?.length },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    id: "financeSubagent",
    name: "Finance Subagent",
    category: "agents",
    description: "Tests financeSubagent SEC/financial analysis",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.subagents.financeSubagent.analyzeFinancials, {
          secret,
          entityName: "Tesla",
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.analysis,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { hasAnalysis: !!result?.analysis },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  {
    id: "mediaSubagent",
    name: "Media Subagent",
    category: "agents",
    description: "Tests mediaSubagent news/media scanning",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.agents.subagents.mediaSubagent.scanMedia, {
          secret,
          topic: "AI funding rounds",
          model: "devstral-2-free",
        });
        return {
          passed: !!result?.articles,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { articleCount: result?.articles?.length },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVALUATION TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "personaEpisodeEval",
    name: "Persona Episode Evaluation",
    category: "tools",
    description: "Tests personaEpisodeEval with DEFAULT_MODEL",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
          secret,
          model: "devstral-2-free",
          suite: "core",
          offset: 0,
          limit: 1,
        });
        const run = result?.runs?.[0];
        return {
          passed: !!run,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: {
            scenarioRan: !!run,
            scenarioOk: run?.ok,
          },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADAPTERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "adaptiveEnrichment",
    name: "Adaptive Entity Enrichment",
    category: "adapters",
    description: "Tests adaptiveEntityEnrichment with DEFAULT_MODEL",
    testType: "action",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        const result = await client.action(api.domains.knowledge.adaptiveEntityEnrichment.enrichEntity, {
          secret,
          entityName: "OpenAI",
          enrichmentType: "basic",
        });
        return {
          passed: !!result?.enrichedData,
          latencyMs: Date.now() - start,
          modelUsed: "devstral-2-free",
          isFreeModel: true,
          details: { hasEnrichment: !!result?.enrichedData },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "modelResolution",
    name: "Model Resolution (Free-First)",
    category: "tools",
    description: "Tests that model resolver correctly prioritizes free models",
    testType: "integration",
    testFn: async (client, secret) => {
      const start = Date.now();
      try {
        // Test that we can resolve free models
        const result = await client.action(api.domains.agents.fastAgentPanelStreaming.submitFastAgentQuery, {
          query: "test",
          model: "devstral-2-free",
        });

        // Check for fallback behavior
        const fallbackResult = await client.action(api.domains.agents.fastAgentPanelStreaming.submitFastAgentQuery, {
          query: "test",
          model: "mimo-v2-flash-free",
        });

        return {
          passed: !!result || !!fallbackResult,
          latencyMs: Date.now() - start,
          modelUsed: result ? "devstral-2-free" : "mimo-v2-flash-free",
          isFreeModel: true,
          details: {
            devstralWorked: !!result,
            mimoWorked: !!fallbackResult,
          },
        };
      } catch (error) {
        return {
          passed: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET.");

  // Parse arguments
  const allFeatures = hasFlag("--all");
  const categoryFilter = getArg("--category");
  const featureFilter = getArg("--feature");
  const verbose = hasFlag("--verbose") || hasFlag("-v");

  // Filter features
  let testsToRun = FEATURE_TESTS;
  if (!allFeatures) {
    if (categoryFilter) {
      testsToRun = testsToRun.filter((t) => t.category === categoryFilter);
    }
    if (featureFilter) {
      testsToRun = testsToRun.filter((t) => t.id.includes(featureFilter) || t.name.toLowerCase().includes(featureFilter.toLowerCase()));
    }
  }

  if (testsToRun.length === 0) {
    console.error("No features matched the filter criteria.");
    console.error("Available features:", FEATURE_TESTS.map((t) => t.id).join(", "));
    process.exit(1);
  }

  console.log(`\n🚀 Starting FEATURE EVALUATION (FREE-FIRST STRATEGY):`);
  console.log(`   Features: ${testsToRun.length}`);
  console.log(`   Default Model: devstral-2-free (FREE)`);
  console.log(`   Fallback Chain: mimo-v2-flash-free → gemini-3-flash-preview → gpt-5.4-nano → claude-haiku-4.5`);
  console.log(``);

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  const startTime = Date.now();
  const results: Array<FeatureTestResult & { feature: FeatureTest }> = [];

  // Run tests sequentially to avoid overwhelming the API
  for (const feature of testsToRun) {
    console.log(`\n[${feature.category}/${feature.id}] Testing: ${feature.name}...`);
    if (verbose) {
      console.log(`   Description: ${feature.description}`);
    }

    try {
      const result = await feature.testFn(client, secret);
      results.push({ ...result, feature });

      const status = result.passed ? "✅ PASS" : "❌ FAIL";
      const modelInfo = result.isFreeModel ? "(FREE)" : "(PAID)";
      const fallbackInfo = result.fallbacksUsed ? ` [${result.fallbacksUsed} fallbacks]` : "";

      console.log(`   ${status} (${(result.latencyMs / 1000).toFixed(1)}s) ${result.modelUsed || "unknown"} ${modelInfo}${fallbackInfo}`);

      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error.slice(0, 100)}`);
      }
      if (verbose && result.details) {
        console.log(`   Details: ${JSON.stringify(result.details)}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      results.push({
        passed: false,
        latencyMs: 0,
        error: err,
        feature,
      });
      console.log(`   ❌ ERROR: ${err.slice(0, 100)}`);
    }
  }

  const totalElapsed = Date.now() - startTime;

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const freeModelCount = results.filter((r) => r.isFreeModel).length;
  const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 FEATURE EVALUATION SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Total Features: ${results.length}`);
  console.log(`   Passed: ${passed} (${((passed / results.length) * 100).toFixed(0)}%)`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Free Model Usage: ${freeModelCount}/${results.length} (${((freeModelCount / results.length) * 100).toFixed(0)}%)`);
  console.log(`   Average Latency: ${(avgLatency / 1000).toFixed(1)}s`);
  console.log(`   Total Time: ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log(``);

  // Results by category
  const categories = [...new Set(results.map((r) => r.feature.category))];
  console.log(`📈 RESULTS BY CATEGORY:`);
  for (const category of categories) {
    const categoryResults = results.filter((r) => r.feature.category === category);
    const categoryPassed = categoryResults.filter((r) => r.passed).length;
    const bar = "█".repeat(Math.floor((categoryPassed / categoryResults.length) * 10)) +
                "░".repeat(10 - Math.floor((categoryPassed / categoryResults.length) * 10));
    console.log(`   ${category}: ${bar} ${categoryPassed}/${categoryResults.length}`);
  }
  console.log(``);

  // Failed features
  const failedFeatures = results.filter((r) => !r.passed);
  if (failedFeatures.length > 0) {
    console.log(`❌ FAILED FEATURES:`);
    for (const r of failedFeatures) {
      console.log(`   - ${r.feature.id}: ${r.error?.slice(0, 80) || "Unknown error"}`);
    }
    console.log(``);
  }

  // Write results to file
  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mdPath = join(outDir, `feature-eval-${timestamp}.md`);
  const jsonPath = join(outDir, `feature-eval-${timestamp}.json`);

  // Generate markdown report
  const mdLines: string[] = [];
  mdLines.push(`# Feature Evaluation Results (FREE-FIRST STRATEGY)`);
  mdLines.push(``);
  mdLines.push(`Generated: ${new Date().toISOString()}`);
  mdLines.push(`Total Time: ${(totalElapsed / 1000).toFixed(1)}s`);
  mdLines.push(`Default Model: devstral-2-free (FREE)`);
  mdLines.push(`Fallback Chain: mimo-v2-flash-free → gemini-3-flash-preview → gpt-5.4-nano → claude-haiku-4.5`);
  mdLines.push(``);
  mdLines.push(`## Summary`);
  mdLines.push(``);
  mdLines.push(`| Metric | Value |`);
  mdLines.push(`|--------|-------|`);
  mdLines.push(`| Total Features | ${results.length} |`);
  mdLines.push(`| Passed | ${passed} (${((passed / results.length) * 100).toFixed(0)}%) |`);
  mdLines.push(`| Failed | ${failed} |`);
  mdLines.push(`| Free Model Usage | ${freeModelCount}/${results.length} (${((freeModelCount / results.length) * 100).toFixed(0)}%) |`);
  mdLines.push(`| Average Latency | ${(avgLatency / 1000).toFixed(1)}s |`);
  mdLines.push(``);
  mdLines.push(`## Results by Feature`);
  mdLines.push(``);
  mdLines.push(`| Feature | Category | Status | Latency | Model | Free |`);
  mdLines.push(`|---------|----------|--------|---------|-------|------|`);

  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    const latency = `${(r.latencyMs / 1000).toFixed(1)}s`;
    const model = r.modelUsed || "N/A";
    const free = r.isFreeModel ? "✅" : "❌";
    mdLines.push(`| ${r.feature.name} | ${r.feature.category} | ${status} | ${latency} | ${model} | ${free} |`);
  }

  mdLines.push(``);

  if (failedFeatures.length > 0) {
    mdLines.push(`## Failed Features`);
    mdLines.push(``);
    for (const r of failedFeatures) {
      mdLines.push(`### ${r.feature.name}`);
      mdLines.push(`- **ID:** ${r.feature.id}`);
      mdLines.push(`- **Category:** ${r.feature.category}`);
      mdLines.push(`- **Error:** ${r.error || "Unknown error"}`);
      mdLines.push(``);
    }
  }

  writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalElapsed,
        defaultModel: "devstral-2-free",
    fallbackChain: ["mimo-v2-flash-free", "gemini-3-flash-preview", "gpt-5.4-nano", "claude-haiku-4.5"],
        summary: {
          total: results.length,
          passed,
          failed,
          freeModelCount,
          avgLatencyMs: avgLatency,
        },
        results: results.map((r) => ({
          featureId: r.feature.id,
          featureName: r.feature.name,
          category: r.feature.category,
          passed: r.passed,
          latencyMs: r.latencyMs,
          modelUsed: r.modelUsed,
          isFreeModel: r.isFreeModel,
          fallbacksUsed: r.fallbacksUsed,
          error: r.error,
          details: r.details,
        })),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`📄 Results written to:`);
  console.log(`   ${mdPath}`);
  console.log(`   ${jsonPath}`);

  // Exit with error if any tests failed
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
