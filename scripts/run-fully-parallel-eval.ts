#!/usr/bin/env npx tsx

/**
 * Fully Parallel Persona Episode Evaluation Runner
 *
 * Runs ALL scenarios across ALL models in complete parallel (every combination simultaneously).
 * Creates individual evaluation tasks for each (model, scenario) pair.
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-fully-parallel-eval.ts --models kimi-k2.6,gpt-5.4-mini,claude-haiku-4.5 --limit 5
 *   npx tsx scripts/run-fully-parallel-eval.ts --all --suite core
 *   npx tsx scripts/run-fully-parallel-eval.ts --all --suite pack --use-db   # Use DB-backed scenarios (if server supports it)
 *   npx tsx scripts/run-fully-parallel-eval.ts --all --ndjson   # Enable NDJSON streaming output
 */

import dotenv from "dotenv";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// DISCLOSURE METRICS TYPES (P0 Instrumentation)
// ═══════════════════════════════════════════════════════════════════════════

interface DisclosureMetrics {
  skillSearchCalls: number;
  skillsActivated: string[];
  toolSearchCalls: number;
  toolsExpanded: string[];
  toolsInvoked: string[];
  toolInvokeErrors: number;
  usedSkillFirst: boolean;
  usedMetaTools: boolean;
  directToolCalls: string[];
  disclosureLevel: "none" | "partial" | "full";
  estimatedToolSchemaTokens: number;  // P0: baseline for tool schema token measurement
  warnings: string[];
}

dotenv.config({ path: ".env.local" });
dotenv.config();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;  // Allow 0 for "no limit"
  return Math.floor(n);
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

/**
 * Run a single (suite, offset) scenario for a single model.
 *
 * IMPORTANT: We do NOT pass custom scenarios to the harness so server-side
 * requirements (pack/full gating) are applied.
 */
async function runSingleScenarioEval(
  client: ConvexHttpClient,
  secret: string,
  model: string,
  suite: string,
  offset: number,
  useDbScenarios: boolean
): Promise<any> {
  const startTime = Date.now();

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
        secret,
        model,
        suite: suite as any,
        offset,
        limit: 1,
        ...(useDbScenarios ? { useDbScenarios: true } : {}),
      });

      const runs = Array.isArray((result as any)?.runs) ? (result as any).runs : [];
      const run = runs[0];
      if (!run) {
        throw new Error(`No run returned for suite="${suite}" offset=${offset} (attempt ${attempt}/${maxAttempts})`);
      }

      const elapsed = Date.now() - startTime;
      return {
        model,
        offset,
        scenarioId: String(run?.id ?? `offset:${offset}`),
        scenarioName: String(run?.name ?? `offset:${offset}`),
        result: run,
        elapsed,
        error: null,
      };
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      const elapsed = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        model,
        offset,
        scenarioId: `offset:${offset}`,
        scenarioName: `offset:${offset}`,
        result: null,
        elapsed,
        error: msg,
      };
    }
  }
  // Unreachable, but keeps TypeScript happy.
  return {
    model,
    offset,
    scenarioId: `offset:${offset}`,
    scenarioName: `offset:${offset}`,
    result: null,
    elapsed: Date.now() - startTime,
    error: "Unknown error",
  };
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET.");

  // Parse arguments
  const modelsArg = getArg("--models");
  const allModels = hasFlag("--all");
  const suite = getArg("--suite") || "core"; // Default to core suite
  const limit = parseNonNegativeInt(getArg("--limit")) ?? 3;
  const ndjsonMode = hasFlag("--ndjson"); // P0: Enable NDJSON streaming output
  const useDbScenarios = hasFlag("--use-db") || hasFlag("--db");

  // Determine which models to test
  // Native providers + OpenRouter models for comprehensive evaluation (Jan 2026)
  // Pricing: input/output per million tokens
  const availableModels = [
    "kimi-k2.6",             // OpenRouter - primary NodeBench agent lane
    // Native providers (baseline) - All major providers
    "claude-haiku-4.5",       // Anthropic - lightweight, fast reasoning
    "gpt-5.4-mini",           // OpenAI - efficient reasoning
    "gemini-3-flash-preview", // Google - fast multimodal preview
    // OpenRouter models - LATEST frontier models (Jan 2026)
    "deepseek-r1",      // DeepSeek R1 - $0.70/$2.40 - reasoning model
    "deepseek-v3.2",    // DeepSeek V3.2 - $0.25/$0.38 - general purpose
    "qwen3-235b",       // Qwen3 235B - $0.18/$0.54 - latest with tools
    "minimax-m2.1",     // MiniMax M2.1 - $0.28/$1.20 - agentic workflows
    "mimo-v2-flash-free", // Xiaomi MiMo V2 Flash - OpenRouter free tier
  ];
  let modelsToTest: string[];

  if (allModels) {
    modelsToTest = availableModels;
  } else if (modelsArg) {
    modelsToTest = modelsArg.split(",").map((m) => m.trim());
  } else {
    modelsToTest = availableModels;
  }

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  // Probe suite scenario count from server (includes DB-backed suites + pack/full requirements)
  if (modelsToTest.length === 0) throw new Error("No models selected");
  const probeModel = modelsToTest[0];
  const probe = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
    secret,
    model: probeModel,
    suite: suite as any,
    offset: 0,
    limit: 1,
    ...(useDbScenarios ? { useDbScenarios: true } : {}),
  });
  const totalAvailable = Number(probe?.window?.totalAvailable ?? 0);
  if (!Number.isFinite(totalAvailable) || totalAvailable <= 0) {
    throw new Error(`Failed to probe totalAvailable scenarios for suite="${suite}"`);
  }
  const offsetsToRun = Array.from({ length: totalAvailable }, (_, i) => i);
  const offsets = limit > 0 ? offsetsToRun.slice(0, limit) : offsetsToRun;

  // Define ALL scenarios (DEFAULT + NEXT + STRESS from personaEpisodeEval.ts)
  // Total: 32 scenarios covering all 10 personas

  const DEFAULT_SCENARIOS = [
    { id: "banker_vague_disco", name: "Banker vague outreach debrief", query: "DISCO — I'm trying to figure out if this is worth reaching out on and what I should do with it.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
    { id: "vc_vague_openautoglm", name: "VC wedge from OSS signal", query: "OpenAutoGLM — what does this imply about the agent market and where is the wedge?", expectedPersona: "EARLY_STAGE_VC", expectedEntityId: "OPEN-AUTOGLM" },
    { id: "cto_vague_quickjs", name: "CTO risk exposure + patch plan", query: "QuickJS — do I have risk exposure and what is my patch plan?", expectedPersona: "CTO_TECH_LEAD", expectedEntityId: "MQUICKJS" },
    { id: "exec_vague_gemini", name: "Exec vendor evaluation", query: "Gemini 3 — should we consider this, and what's the procurement next step?", expectedPersona: "ENTERPRISE_EXEC", expectedEntityId: "GEMINI_3" },
    { id: "ecosystem_vague_soundcloud", name: "Ecosystem second-order effects", query: "SoundCloud VPN issue — who benefits and what partnerships does this create?", expectedPersona: "ECOSYSTEM_PARTNER", expectedEntityId: "SOUNDCLOUD" },
    { id: "founder_salesforce_positioning", name: "Founder positioning vs incumbent", query: "Salesforce Agentforce — what does this mean for a founder's positioning and what should we do next?", expectedPersona: "FOUNDER_STRATEGY", expectedEntityId: "SALESFORCE" },
    { id: "academic_ryr2_anchor", name: "Academic literature anchor", query: "RyR2 / Alzheimer's — what's the literature anchor and what's methodologically solid?", expectedPersona: "ACADEMIC_RD", expectedEntityId: "ALZHEIMERS" },
    { id: "quant_disco_signal", name: "Quant signal extraction", query: "DISCO — extract the funding signal and timeline points you'd track.", expectedPersona: "QUANT_ANALYST", expectedEntityId: "DISCO" },
    { id: "product_disco_card", name: "Product designer schema card", query: "DISCO — I need a schema-dense UI card JSON that can be rendered.", expectedPersona: "PRODUCT_DESIGNER", expectedEntityId: "DISCO" },
    { id: "sales_disco_onepager", name: "Sales engineer one-screen summary", query: "DISCO — write a share-ready single-screen outbound summary.", expectedPersona: "SALES_ENGINEER", expectedEntityId: "DISCO" },
  ];

  const NEXT_SCENARIOS = [
    // JPM_STARTUP_BANKER
    { id: "next_banker_vague_disco_cover_this_week", name: "Next: banker vague (fast debrief)", query: "DISCO — can we cover them this week? Give me the fastest banker-grade debrief and tell me what you're unsure about.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
    { id: "next_banker_tool_ambros_outbound_pack", name: "Next: banker tool-driven outbound pack", query: "Build an outbound-ready pack for Ambros: last round details, why-now, 3 talk-track bullets, and primary-source citations. If any primary is missing, say so and propose the fastest way to resolve.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "AMBROS" },
    // EARLY_STAGE_VC
    { id: "next_vc_vague_disco_wedge", name: "Next: VC vague wedge", query: "DISCO — I want a wedge. What's the thesis and where's the weakness?", expectedPersona: "EARLY_STAGE_VC", expectedEntityId: "DISCO" },
    { id: "next_vc_tool_disco_comps", name: "Next: VC tool-driven comps + diligence", query: "Map DISCO vs 2 nearest comparables (pick them via research). Output: market map, wedge, why-now, key risks, and 5 diligence questions. Cite sources and label assumptions.", expectedPersona: "EARLY_STAGE_VC", expectedEntityId: "DISCO" },
    // CTO_TECH_LEAD
    { id: "next_cto_vague_quickjs_exposure", name: "Next: CTO vague exposure", query: "QuickJS — am I exposed? I'm not sure where it's used.", expectedPersona: "CTO_TECH_LEAD", expectedEntityId: "MQUICKJS" },
    { id: "next_cto_tool_cve_plan", name: "Next: CTO tool-driven CVE plan", query: "Assess CVE-2025-62495: fixed version, mitigations, and a dependency-trace plan. Include a verification checklist and cite NVD + upstream changelog.", expectedPersona: "CTO_TECH_LEAD", expectedEntityId: "MQUICKJS" },
    // FOUNDER_STRATEGY
    { id: "next_founder_vague_salesforce_agentforce", name: "Next: founder vague positioning", query: "Salesforce Agentforce — what does this mean for our positioning?", expectedPersona: "FOUNDER_STRATEGY", expectedEntityId: "SALESFORCE" },
    { id: "next_founder_tool_salesforce_memo", name: "Next: founder tool-driven memo", query: "Write a founder memo: Salesforce's agent strategy, where it's strong, where it's weak, and 3 counter-positioning moves. Must be grounded in filings/IR + credible coverage; no invented metrics.", expectedPersona: "FOUNDER_STRATEGY", expectedEntityId: "SALESFORCE" },
    // ACADEMIC_RD
    { id: "next_academic_vague_ryr2_alz", name: "Next: academic vague anchor", query: "RyR2 and Alzheimer's — what's real here?", expectedPersona: "ACADEMIC_RD", expectedEntityId: "ALZHEIMERS" },
    { id: "next_academic_tool_lit_debrief", name: "Next: academic tool-driven literature debrief", query: "Produce a literature-anchored debrief: 2–3 key papers, what methods were used, limitations, and a replication/next-experiment plan. Cite primary literature and label uncertainty.", expectedPersona: "ACADEMIC_RD", expectedEntityId: "ALZHEIMERS" },
    // ENTERPRISE_EXEC
    { id: "next_exec_vague_gemini_standardize", name: "Next: exec vague standardize", query: "Gemini 3 — should we standardize on Flash or Pro for agent loops?", expectedPersona: "ENTERPRISE_EXEC", expectedEntityId: "GEMINI_3" },
    { id: "next_exec_tool_cost_model", name: "Next: exec tool-driven cost model", query: "Build a cost model using official pricing: 3 usage scenarios, caching impact, and a procurement next-step checklist. Cite the pricing source of truth.", expectedPersona: "ENTERPRISE_EXEC", expectedEntityId: "GEMINI_3" },
    // ECOSYSTEM_PARTNER
    { id: "next_ecosystem_vague_soundcloud_vpn", name: "Next: ecosystem vague incident", query: "SoundCloud VPN issue — who benefits and why should I care?", expectedPersona: "ECOSYSTEM_PARTNER", expectedEntityId: "SOUNDCLOUD" },
    { id: "next_ecosystem_tool_second_order_brief", name: "Next: ecosystem tool-driven second-order brief", query: "Produce a second-order ecosystem brief: incident timeline, 3 beneficiary categories, and 2 partnership plays. Cite at least 2 credible sources; clearly separate fact vs inference.", expectedPersona: "ECOSYSTEM_PARTNER", expectedEntityId: "SOUNDCLOUD" },
    // QUANT_ANALYST
    { id: "next_quant_vague_disco_track", name: "Next: quant vague what to track", query: "DISCO — what should I track over time?", expectedPersona: "QUANT_ANALYST", expectedEntityId: "DISCO" },
    { id: "next_quant_tool_signal_json", name: "Next: quant tool-driven signal set JSON", query: "Extract a structured signal set for DISCO: funding event timeline, key milestones, and 5 measurable KPIs. Output JSON + 'data sources to ingest' list.", expectedPersona: "QUANT_ANALYST", expectedEntityId: "DISCO" },
    // PRODUCT_DESIGNER
    { id: "next_product_vague_make_usable_ui", name: "Next: product vague UI usable", query: "Make this usable in the UI: DISCO.", expectedPersona: "PRODUCT_DESIGNER", expectedEntityId: "DISCO" },
    { id: "next_product_tool_expandable_card", name: "Next: product tool-driven expandable card schema", query: "Generate a UI-ready entity card schema for DISCO with expandable sections (funding, people, pipeline, sources, freshness, confidence). Include citation pointers and a 'missing fields' panel.", expectedPersona: "PRODUCT_DESIGNER", expectedEntityId: "DISCO" },
    // SALES_ENGINEER
    { id: "next_sales_vague_shareable", name: "Next: sales vague shareable", query: "DISCO — give me the shareable version.", expectedPersona: "SALES_ENGINEER", expectedEntityId: "DISCO" },
    { id: "next_sales_tool_one_screen_objections", name: "Next: sales tool-driven one-screen + objections", query: "Write a single-screen outbound-ready summary: headline, 3 bullets, funding line (amount/date/round), and contact path. Include 'objections & responses' and cite sources.", expectedPersona: "SALES_ENGINEER", expectedEntityId: "DISCO" },
  ];

  const STRESS_SCENARIOS = [
    { id: "stress_ambiguous_persona_disco_wedge_outreach", name: "Stress: ambiguous persona (wedge + outreach)", query: "Disco — wedge + outreach. I'm moving fast.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
    { id: "stress_contradiction_disco_series_a_claim", name: "Stress: contradiction handling (Seed vs Series A)", query: "DISCO raised a Series A for €36M—give me the banker pack.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
  ];

  // Select scenarios based on suite
  let allScenarios;
  if (suite === "full" || suite === "all") {
    allScenarios = [...DEFAULT_SCENARIOS, ...NEXT_SCENARIOS, ...STRESS_SCENARIOS];
  } else if (suite === "next") {
    allScenarios = NEXT_SCENARIOS;
  } else if (suite === "stress") {
    allScenarios = STRESS_SCENARIOS;
  } else {
    // Default: core (DEFAULT_SCENARIOS only)
    allScenarios = DEFAULT_SCENARIOS;
  }

  const scenarios = limit > 0 ? allScenarios.slice(0, limit) : allScenarios;

  console.log(`\n🚀 Starting FULLY PARALLEL evaluation:`);
  console.log(`   Models: ${modelsToTest.join(", ")}`);
  console.log(`   Suite: ${suite}`);
  console.log(`   Scenario source: ${useDbScenarios ? "db" : "builtin"}`);
  console.log(`   Scenarios: ${offsets.length} of ${totalAvailable} (limit=${limit})`);
  console.log(`   Total evaluations: ${modelsToTest.length * offsets.length}`);
  console.log(``);

  const startTime = Date.now();

  // Create all (model, scenario) combinations
  const tasks: Promise<any>[] = [];
  for (const model of modelsToTest) {
    for (const offset of offsets) {
      console.log(`[${model}/offset:${offset}] Starting...`);
      tasks.push(runSingleScenarioEval(client, secret, model, suite, offset, useDbScenarios));
    }
  }

  // Run ALL tasks in parallel
  const results = await Promise.all(tasks);

  const totalElapsed = Date.now() - startTime;

  console.log(`\n📊 All ${results.length} evaluations completed in ${(totalElapsed / 1000).toFixed(1)}s\n`);

  // Organize results by model
  const resultsByModel: Record<string, any[]> = {};
  for (const model of modelsToTest) {
    resultsByModel[model] = results.filter((r) => r.model === model);
  }

  // Generate summary report
  const summaryLines: string[] = [];
  summaryLines.push(`# Fully Parallel Evaluation Results`);
  summaryLines.push(``);
  summaryLines.push(`Generated: ${new Date().toISOString()}`);
  summaryLines.push(`Total Time: ${(totalElapsed / 1000).toFixed(1)}s`);
  summaryLines.push(`Suite: ${suite}`);
  summaryLines.push(`Models: ${modelsToTest.length}`);
  summaryLines.push(`Scenarios: ${offsets.length} of ${totalAvailable} (limit=${limit})`);
  summaryLines.push(`Total evaluations: ${results.length}`);
  summaryLines.push(``);
  summaryLines.push(`## Summary by Model`);
  summaryLines.push(``);
  summaryLines.push(`| Model | Total | Passed | Failed | Avg Time (s) |`);
  summaryLines.push(`|-------|-------|--------|--------|--------------|`);

  for (const model of modelsToTest) {
    const modelResults = resultsByModel[model];
    const passed = modelResults.filter((r) => r.result?.ok === true).length;
    const failed = modelResults.filter((r) => r.result?.ok !== true || r.error).length;
    const avgTime = modelResults.reduce((sum, r) => sum + r.elapsed, 0) / modelResults.length / 1000;

    summaryLines.push(`| ${model} | ${modelResults.length} | ${passed} | ${failed} | ${avgTime.toFixed(1)} |`);
  }

  summaryLines.push(``);
  summaryLines.push(`## Summary by Scenario`);
  summaryLines.push(``);
  summaryLines.push(`| Scenario | Total | Passed | Failed |`);
  summaryLines.push(`|----------|-------|--------|--------|`);

  const scenarioAgg = new Map<string, { name: string; total: number; passed: number; failed: number }>();
  for (const r of results) {
    const id = String(r.scenarioId ?? `offset:${r.offset ?? "?"}`);
    const name = String(r.scenarioName ?? id);
    const entry = scenarioAgg.get(id) ?? { name, total: 0, passed: 0, failed: 0 };
    entry.total++;
    if (r.error) {
      entry.failed++;
    } else if (r.result?.ok === true) {
      entry.passed++;
    } else {
      entry.failed++;
    }
    scenarioAgg.set(id, entry);
  }

  const scenarioEntries = Array.from(scenarioAgg.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const s of scenarioEntries) {
    summaryLines.push(`| ${s.name} | ${s.total} | ${s.passed} | ${s.failed} |`);
  }

  summaryLines.push(``);
  summaryLines.push(`## Detailed Results`);
  summaryLines.push(``);

  for (const model of modelsToTest) {
    summaryLines.push(`### ${model}`);
    summaryLines.push(``);

    const modelResults = resultsByModel[model];

    summaryLines.push(`| Scenario | Status | Time (s) | Failures |`);
    summaryLines.push(`|----------|--------|----------|----------|`);

    for (const r of modelResults) {
      const status = r.error ? "❌ ERROR" : r.result?.ok ? "✅ PASS" : "❌ FAIL";
      const time = (r.elapsed / 1000).toFixed(1);
      const failures = r.error
        ? r.error.slice(0, 80)
        : Array.isArray(r.result?.failureReasons) && r.result.failureReasons.length > 0
          ? r.result.failureReasons[0].slice(0, 80)
          : "-";

      const scenarioName = r.scenarioName || r.scenarioId || `offset:${r.offset ?? "?"}`;
      summaryLines.push(`| ${scenarioName} | ${status} | ${time} | ${failures} |`);
    }

    summaryLines.push(``);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // P0: DISCLOSURE METRICS SUMMARY (Non-scored warnings, Week 1-2 mode)
  // ═══════════════════════════════════════════════════════════════════════════

  // Collect disclosure warnings from all results
  const allWarnings: string[] = [];
  const disclosureByModel: Record<string, { full: number; partial: number; none: number }> = {};

  for (const r of results) {
    const disclosure = r.result?.disclosure as DisclosureMetrics | undefined;
    if (disclosure) {
      // Collect warnings with model/scenario context
      for (const warning of disclosure.warnings ?? []) {
        allWarnings.push(`⚠️ [${r.model}/${r.scenarioId}] ${warning}`);
      }

      // Track disclosure level by model
      if (!disclosureByModel[r.model]) {
        disclosureByModel[r.model] = { full: 0, partial: 0, none: 0 };
      }
      disclosureByModel[r.model][disclosure.disclosureLevel]++;
    }
  }

  // Add disclosure summary section
  summaryLines.push(`## Disclosure Metrics (P0 Instrumentation)`);
  summaryLines.push(``);
  summaryLines.push(`### Disclosure Level by Model`);
  summaryLines.push(``);
  summaryLines.push(`| Model | Full | Partial | None |`);
  summaryLines.push(`|-------|------|---------|------|`);

  for (const model of modelsToTest) {
    const d = disclosureByModel[model] ?? { full: 0, partial: 0, none: 0 };
    summaryLines.push(`| ${model} | ${d.full} | ${d.partial} | ${d.none} |`);
  }

  summaryLines.push(``);

  // Add disclosure warnings (non-scored)
  if (allWarnings.length > 0) {
    summaryLines.push(`### Disclosure Warnings (Non-Scored)`);
    summaryLines.push(``);
    summaryLines.push(`> **Note:** These warnings are informational and do not affect pass/fail.`);
    summaryLines.push(`> They track progressive disclosure usage for Week 1-2 observability.`);
    summaryLines.push(``);
    for (const warning of allWarnings.slice(0, 50)) { // Cap at 50 warnings
      summaryLines.push(warning);
    }
    if (allWarnings.length > 50) {
      summaryLines.push(`... and ${allWarnings.length - 50} more warnings`);
    }
    summaryLines.push(``);
  } else {
    summaryLines.push(`### Disclosure Warnings (Non-Scored)`);
    summaryLines.push(``);
    summaryLines.push(`✅ No disclosure warnings generated.`);
    summaryLines.push(``);
  }

  // Write results to file
  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mdPath = join(outDir, `fully-parallel-eval-${timestamp}.md`);
  const jsonPath = join(outDir, `fully-parallel-eval-${timestamp}.json`);

  writeFileSync(mdPath, summaryLines.join("\n"), "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalElapsed,
        modelsToTest,
        suite,
        totalAvailable,
        scenarios: offsets.length,
        totalEvaluations: results.length,
        results,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`\n📄 Results written to:`);
  console.log(`   ${mdPath}`);
  console.log(`   ${jsonPath}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0: NDJSON OUTPUT MODE (Stream-processable, one JSON object per episode)
  // ═══════════════════════════════════════════════════════════════════════════

  if (ndjsonMode) {
    const ndjsonPath = join(outDir, `fully-parallel-eval-${timestamp}.ndjson`);

    // Write each episode as a single JSON line
    for (const r of results) {
      const episode = {
        model: r.model,
        scenario: r.scenarioId,
        ok: r.result?.ok ?? false,
        latencyMs: r.elapsed,
        disclosure: r.result?.disclosure ?? null,
        // Compact summary for stream processing
        checks: r.result?.checks ?? {},
        failureReasons: r.result?.failureReasons ?? [],
      };
      appendFileSync(ndjsonPath, JSON.stringify(episode) + "\n", "utf8");
    }

    console.log(`   ${ndjsonPath} (NDJSON stream-processable)`);

    // Print quick disclosure summary to console
    console.log(`\n📊 Disclosure Summary (NDJSON mode):`);
    for (const model of modelsToTest) {
      const d = disclosureByModel[model] ?? { full: 0, partial: 0, none: 0 };
      console.log(`   ${model}: ${d.full} full, ${d.partial} partial, ${d.none} none`);
    }
    if (allWarnings.length > 0) {
      console.log(`   ⚠️ ${allWarnings.length} disclosure warnings generated`);
    }
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
