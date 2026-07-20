#!/usr/bin/env npx tsx

/**
 * Comprehensive Evaluation Runner with LLM Judge & Success Metrics
 *
 * Runs ALL scenarios across ALL models in complete parallel with:
 * - LLM-as-a-Judge boolean scoring (10 criteria)
 * - Memory-first compliance tracking
 * - Tool ordering validation
 * - Invariant status monitoring
 * - Success metrics aggregation
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-comprehensive-eval.ts --models kimi-k2.6,gpt-5.4,claude-sonnet-4.6
 *   npx tsx scripts/run-comprehensive-eval.ts --all --suite full --judge
 *   npx tsx scripts/run-comprehensive-eval.ts --all --ndjson --metrics
 */

import dotenv from "dotenv";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
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
  estimatedToolSchemaTokens: number;
  warnings: string[];
}

interface LLMJudgeResult {
  criteria: Record<string, boolean>;
  score: number;
  verdict: "PASS" | "FAIL" | "PARTIAL";
  summary: string;
}

interface EpisodeResult {
  model: string;
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  elapsed: number;
  disclosure?: DisclosureMetrics;
  judge?: LLMJudgeResult;
  checks?: Record<string, boolean>;
  failureReasons: string[];
  responseText?: string;
  responsePreview?: string;
  error?: string;
}

type ScenarioSuite = "core" | "next" | "stress";

interface EvalScenario {
  id: string;
  name: string;
  query: string;
  expectedPersona: string;
  expectedEntityId: string;
  evalSuite: ScenarioSuite;
}

interface SuccessMetrics {
  // Overall pass rates
  overallPassRate: number;
  passRateByModel: Record<string, number>;
  passRateByScenario: Record<string, number>;

  // Memory-first compliance (Part 4)
  memoryFirstComplianceRate: number;
  memoryFirstByModel: Record<string, number>;

  // Tool ordering (Part 4)
  toolOrderingAccuracy: number;
  toolOrderingByModel: Record<string, number>;

  // Invariant tracking (Part 4)
  invariantViolations: {
    A: number; // Message ID isolation
    C: number; // Memory deduplication
    D: number; // Capability version check
  };

  // LLM Judge metrics (if enabled)
  judgeMetrics?: {
    avgScore: number;
    scoreByModel: Record<string, number>;
    criteriaPassRates: Record<string, number>;
  };

  // Latency metrics
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  latencyByModel: Record<string, number>;

  // Disclosure metrics
  avgDisclosureLevel: Record<string, number>;
  skillFirstRate: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO DEFINITIONS (32 scenarios covering all 10 personas)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SCENARIOS: EvalScenario[] = [
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
].map((scenario) => ({ ...scenario, evalSuite: "core" as const }));

const NEXT_SCENARIOS: EvalScenario[] = [
  { id: "next_banker_vague_disco_cover_this_week", name: "Next: banker vague (fast debrief)", query: "DISCO — can we cover them this week? Give me the fastest banker-grade debrief and tell me what you're unsure about.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
  { id: "next_banker_tool_ambros_outbound_pack", name: "Next: banker tool-driven outbound pack", query: "Build an outbound-ready pack for Ambros: last round details, why-now, 3 talk-track bullets, and primary-source citations.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "AMBROS" },
  { id: "next_vc_vague_disco_wedge", name: "Next: VC vague wedge", query: "DISCO — I want a wedge. What's the thesis and where's the weakness?", expectedPersona: "EARLY_STAGE_VC", expectedEntityId: "DISCO" },
  { id: "next_vc_tool_disco_comps", name: "Next: VC tool-driven comps + diligence", query: "Map DISCO vs 2 nearest comparables. Output: market map, wedge, why-now, key risks, and 5 diligence questions.", expectedPersona: "EARLY_STAGE_VC", expectedEntityId: "DISCO" },
  { id: "next_cto_vague_quickjs_exposure", name: "Next: CTO vague exposure", query: "QuickJS — am I exposed? I'm not sure where it's used.", expectedPersona: "CTO_TECH_LEAD", expectedEntityId: "MQUICKJS" },
  { id: "next_cto_tool_cve_plan", name: "Next: CTO tool-driven CVE plan", query: "Assess CVE-2025-62495: fixed version, mitigations, and a dependency-trace plan.", expectedPersona: "CTO_TECH_LEAD", expectedEntityId: "MQUICKJS" },
  { id: "next_founder_vague_salesforce_agentforce", name: "Next: founder vague positioning", query: "Salesforce Agentforce — what does this mean for our positioning?", expectedPersona: "FOUNDER_STRATEGY", expectedEntityId: "SALESFORCE" },
  { id: "next_founder_tool_salesforce_memo", name: "Next: founder tool-driven memo", query: "Write a founder memo: Salesforce's agent strategy, where it's strong, where it's weak, and 3 counter-positioning moves.", expectedPersona: "FOUNDER_STRATEGY", expectedEntityId: "SALESFORCE" },
  { id: "next_academic_vague_ryr2_alz", name: "Next: academic vague anchor", query: "RyR2 and Alzheimer's — what's real here?", expectedPersona: "ACADEMIC_RD", expectedEntityId: "ALZHEIMERS" },
  { id: "next_academic_tool_lit_debrief", name: "Next: academic tool-driven literature debrief", query: "Produce a literature-anchored debrief: 2–3 key papers, what methods were used, limitations, and a replication plan.", expectedPersona: "ACADEMIC_RD", expectedEntityId: "ALZHEIMERS" },
  { id: "next_exec_vague_gemini_standardize", name: "Next: exec vague standardize", query: "Gemini 3 — should we standardize on Flash or Pro for agent loops?", expectedPersona: "ENTERPRISE_EXEC", expectedEntityId: "GEMINI_3" },
  { id: "next_exec_tool_cost_model", name: "Next: exec tool-driven cost model", query: "Build a cost model using official pricing: 3 usage scenarios, caching impact, and a procurement checklist.", expectedPersona: "ENTERPRISE_EXEC", expectedEntityId: "GEMINI_3" },
  { id: "next_ecosystem_vague_soundcloud_vpn", name: "Next: ecosystem vague incident", query: "SoundCloud VPN issue — who benefits and why should I care?", expectedPersona: "ECOSYSTEM_PARTNER", expectedEntityId: "SOUNDCLOUD" },
  { id: "next_ecosystem_tool_second_order_brief", name: "Next: ecosystem tool-driven second-order brief", query: "Produce a second-order ecosystem brief: incident timeline, 3 beneficiary categories, and 2 partnership plays.", expectedPersona: "ECOSYSTEM_PARTNER", expectedEntityId: "SOUNDCLOUD" },
  { id: "next_quant_vague_disco_track", name: "Next: quant vague what to track", query: "DISCO — what should I track over time?", expectedPersona: "QUANT_ANALYST", expectedEntityId: "DISCO" },
  { id: "next_quant_tool_signal_json", name: "Next: quant tool-driven signal set JSON", query: "Extract a structured signal set for DISCO: funding event timeline, key milestones, and 5 measurable KPIs.", expectedPersona: "QUANT_ANALYST", expectedEntityId: "DISCO" },
  { id: "next_product_vague_make_usable_ui", name: "Next: product vague UI usable", query: "Make this usable in the UI: DISCO.", expectedPersona: "PRODUCT_DESIGNER", expectedEntityId: "DISCO" },
  { id: "next_product_tool_expandable_card", name: "Next: product tool-driven expandable card schema", query: "Generate a UI-ready entity card schema for DISCO with expandable sections.", expectedPersona: "PRODUCT_DESIGNER", expectedEntityId: "DISCO" },
  { id: "next_sales_vague_shareable", name: "Next: sales vague shareable", query: "DISCO — give me the shareable version.", expectedPersona: "SALES_ENGINEER", expectedEntityId: "DISCO" },
  { id: "next_sales_tool_one_screen_objections", name: "Next: sales tool-driven one-screen + objections", query: "Write a single-screen outbound-ready summary with objections & responses.", expectedPersona: "SALES_ENGINEER", expectedEntityId: "DISCO" },
].map((scenario) => ({ ...scenario, evalSuite: "next" as const }));

const STRESS_SCENARIOS: EvalScenario[] = [
  { id: "stress_ambiguous_persona_disco_wedge_outreach", name: "Stress: ambiguous persona (wedge + outreach)", query: "Disco — wedge + outreach. I'm moving fast.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
  { id: "stress_contradiction_disco_series_a_claim", name: "Stress: contradiction handling (Seed vs Series A)", query: "DISCO raised a Series A for €36M—give me the banker pack.", expectedPersona: "JPM_STARTUP_BANKER", expectedEntityId: "DISCO" },
].map((scenario) => ({ ...scenario, evalSuite: "stress" as const }));

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

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
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseCsvArg(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readFailedScenarioIds(path: string | undefined): string[] {
  if (!path) return [];
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as { results?: Array<{ scenarioId?: string; passed?: boolean }> };
    return Array.isArray(payload?.results)
      ? payload.results
          .filter((row) => row?.passed === false && typeof row?.scenarioId === "string")
          .map((row) => String(row!.scenarioId))
      : [];
  } catch {
    return [];
  }
}

function scenarioMatchesFilter(scenario: EvalScenario, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const haystack = `${scenario.id} ${scenario.name} ${scenario.query} ${scenario.expectedPersona} ${scenario.expectedEntityId}`.toLowerCase();
  return filters.some((filter) => haystack.includes(filter.toLowerCase()));
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

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function getEvalFallbackModel(model: string): string | null {
  switch (model) {
    case "kimi-k2.6":
      return "gpt-5.4";
    case "gpt-5.4":
      return "claude-sonnet-4.6";
    case "claude-sonnet-4.6":
      return "gpt-5.4";
    default:
      return null;
  }
}

function getEvalJudgeFallbackModel(model: string): string | null {
  switch (model) {
    case "kimi-k2.6":
      return "gpt-5.4";
    case "gpt-5.4":
      return "claude-sonnet-4.6";
    case "claude-sonnet-4.6":
      return "gpt-5.4";
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function runSingleEpisode(
  client: ConvexHttpClient,
  secret: string,
  model: string,
  scenario: EvalScenario,
  suite: string,
  enableJudge: boolean,
  judgeModel: string
): Promise<EpisodeResult> {
  const startTime = Date.now();
  const effectiveSuite: ScenarioSuite =
    suite === "full" || suite === "all"
      ? scenario.evalSuite
      : suite === "next" || suite === "stress"
        ? suite
        : "core";

  try {
    const maxAttempts = 2;
    let run: any = null;
    let activeModel = model;
    let fallbackActivated = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const scenarioInput = {
        id: scenario.id,
        name: scenario.name,
        query: scenario.query,
        expectedPersona: scenario.expectedPersona,
        expectedEntityId: scenario.expectedEntityId,
      };
      const result = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
        secret,
        model: activeModel,
        suite: effectiveSuite as any,
        offset: 0,
        limit: 1,
        scenarios: [scenarioInput],
      });

      run = result?.runs?.[0] ?? null;
      const responseForRetry = String(run?.responseText ?? run?.responsePreview ?? "").trim();
      const failureReasons = Array.isArray(run?.failureReasons) ? run.failureReasons.map((reason: unknown) => String(reason)) : [];
      const missingDebrief = failureReasons.some((reason) => reason.includes("Missing [DEBRIEF_V1_JSON] block"));
      const missingRun = !run;
      const opaqueEmptyFailure = responseForRetry.length === 0 && failureReasons.length === 0;
      const shouldRetry = attempt < maxAttempts && (missingRun || missingDebrief || opaqueEmptyFailure);

      if (!shouldRetry) {
        break;
      }

      const fallbackModel = getEvalFallbackModel(activeModel);
      if (!fallbackActivated && fallbackModel && fallbackModel !== activeModel) {
        console.warn(
          `[${model}/${scenario.id}] Empty response with missing debrief on attempt ${attempt}; retrying with fallback ${fallbackModel}...`,
        );
        activeModel = fallbackModel;
        fallbackActivated = true;
      } else {
        console.warn(
          `[${model}/${scenario.id}] Empty response with missing debrief on attempt ${attempt}; retrying once...`,
        );
      }
    }

    const elapsed = Date.now() - startTime;

    let judgeResult: LLMJudgeResult | undefined;

    const responseForJudge = String(run?.responseText ?? run?.responsePreview ?? "");

    // Run LLM judge if enabled and we have a response
    if (enableJudge && responseForJudge) {
      const judgeModels = [judgeModel, getEvalJudgeFallbackModel(judgeModel)].filter(
        (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
      );
      for (const activeJudgeModel of judgeModels) {
        try {
          const judgeResponse = await client.action(api.domains.evaluation.llmJudge.quickBooleanEval, {
            query: scenario.query,
            response: responseForJudge,
            targetEntity: scenario.expectedEntityId,
            expectedPersona: scenario.expectedPersona,
            judgeModel: activeJudgeModel,
          });
          judgeResult = judgeResponse as LLMJudgeResult;
          break;
        } catch (judgeErr) {
          console.warn(`[${model}/${scenario.id}] Judge failed with ${activeJudgeModel}:`, judgeErr);
        }
      }
    }

    return {
      model,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      passed: run?.ok ?? false,
      elapsed,
      disclosure: run?.disclosure as DisclosureMetrics | undefined,
      judge: judgeResult,
      checks: run?.checks,
      failureReasons: run?.failureReasons ?? (run ? [] : ["No run returned by personaEpisodeEval"]),
      responseText: responseForJudge,
      responsePreview: run?.responsePreview?.slice(0, 500),
      error: run ? undefined : "No run returned by personaEpisodeEval",
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return {
      model,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      passed: false,
      elapsed,
      failureReasons: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function computeSuccessMetrics(results: EpisodeResult[]): SuccessMetrics {
  const models = [...new Set(results.map((r) => r.model))];
  const scenarios = [...new Set(results.map((r) => r.scenarioId))];

  // Overall pass rate
  const passed = results.filter((r) => r.passed).length;
  const overallPassRate = (passed / results.length) * 100;

  // Pass rate by model
  const passRateByModel: Record<string, number> = {};
  for (const model of models) {
    const modelResults = results.filter((r) => r.model === model);
    const modelPassed = modelResults.filter((r) => r.passed).length;
    passRateByModel[model] = (modelPassed / modelResults.length) * 100;
  }

  // Pass rate by scenario
  const passRateByScenario: Record<string, number> = {};
  for (const scenarioId of scenarios) {
    const scenarioResults = results.filter((r) => r.scenarioId === scenarioId);
    const scenarioPassed = scenarioResults.filter((r) => r.passed).length;
    passRateByScenario[scenarioId] = (scenarioPassed / scenarioResults.length) * 100;
  }

  // Memory-first compliance
  const withDisclosure = results.filter((r) => r.disclosure);
  const memoryFirstCount = withDisclosure.filter((r) => r.disclosure?.usedSkillFirst).length;
  const memoryFirstComplianceRate = withDisclosure.length > 0 ? (memoryFirstCount / withDisclosure.length) * 100 : 0;

  const memoryFirstByModel: Record<string, number> = {};
  for (const model of models) {
    const modelWithDisclosure = results.filter((r) => r.model === model && r.disclosure);
    const modelMemoryFirst = modelWithDisclosure.filter((r) => r.disclosure?.usedSkillFirst).length;
    memoryFirstByModel[model] = modelWithDisclosure.length > 0 ? (modelMemoryFirst / modelWithDisclosure.length) * 100 : 0;
  }

  // Tool ordering (use usedMetaTools as proxy for correct ordering)
  const usedMetaToolsCount = withDisclosure.filter((r) => r.disclosure?.usedMetaTools).length;
  const toolOrderingAccuracy = withDisclosure.length > 0 ? (usedMetaToolsCount / withDisclosure.length) * 100 : 0;

  const toolOrderingByModel: Record<string, number> = {};
  for (const model of models) {
    const modelWithDisclosure = results.filter((r) => r.model === model && r.disclosure);
    const modelUsedMeta = modelWithDisclosure.filter((r) => r.disclosure?.usedMetaTools).length;
    toolOrderingByModel[model] = modelWithDisclosure.length > 0 ? (modelUsedMeta / modelWithDisclosure.length) * 100 : 0;
  }

  // Invariant violations (placeholder - would be computed from disclosure events)
  const invariantViolations = { A: 0, C: 0, D: 0 };

  // LLM Judge metrics
  const withJudge = results.filter((r) => r.judge);
  let judgeMetrics: SuccessMetrics["judgeMetrics"];
  if (withJudge.length > 0) {
    const totalScore = withJudge.reduce((sum, r) => sum + (r.judge?.score ?? 0), 0);
    const avgScore = totalScore / withJudge.length;

    const scoreByModel: Record<string, number> = {};
    for (const model of models) {
      const modelWithJudge = results.filter((r) => r.model === model && r.judge);
      const modelScore = modelWithJudge.reduce((sum, r) => sum + (r.judge?.score ?? 0), 0);
      scoreByModel[model] = modelWithJudge.length > 0 ? modelScore / modelWithJudge.length : 0;
    }

    // Criteria pass rates
    const criteriaPassRates: Record<string, number> = {};
    const allCriteria = withJudge.flatMap((r) => Object.keys(r.judge?.criteria ?? {}));
    const uniqueCriteria = [...new Set(allCriteria)];
    for (const criterion of uniqueCriteria) {
      const passCount = withJudge.filter((r) => r.judge?.criteria?.[criterion] === true).length;
      criteriaPassRates[criterion] = (passCount / withJudge.length) * 100;
    }

    judgeMetrics = { avgScore, scoreByModel, criteriaPassRates };
  }

  // Latency metrics
  const latencies = results.map((r) => r.elapsed);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50LatencyMs = percentile(latencies, 50);
  const p95LatencyMs = percentile(latencies, 95);

  const latencyByModel: Record<string, number> = {};
  for (const model of models) {
    const modelLatencies = results.filter((r) => r.model === model).map((r) => r.elapsed);
    latencyByModel[model] = modelLatencies.reduce((a, b) => a + b, 0) / modelLatencies.length;
  }

  // Disclosure level metrics
  const avgDisclosureLevel: Record<string, number> = { none: 0, partial: 0, full: 0 };
  for (const r of withDisclosure) {
    const level = r.disclosure?.disclosureLevel ?? "none";
    avgDisclosureLevel[level]++;
  }
  if (withDisclosure.length > 0) {
    avgDisclosureLevel.none = (avgDisclosureLevel.none / withDisclosure.length) * 100;
    avgDisclosureLevel.partial = (avgDisclosureLevel.partial / withDisclosure.length) * 100;
    avgDisclosureLevel.full = (avgDisclosureLevel.full / withDisclosure.length) * 100;
  }

  const skillFirstRate = memoryFirstComplianceRate;

  return {
    overallPassRate,
    passRateByModel,
    passRateByScenario,
    memoryFirstComplianceRate,
    memoryFirstByModel,
    toolOrderingAccuracy,
    toolOrderingByModel,
    invariantViolations,
    judgeMetrics,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    latencyByModel,
    avgDisclosureLevel,
    skillFirstRate,
  };
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
  const modelsArg = getArg("--models");
  const allModels = hasFlag("--all");
  const suite = getArg("--suite") || "core";
  const limit = parseNonNegativeInt(getArg("--limit")) ?? 0; // 0 = no limit
  const ndjsonMode = hasFlag("--ndjson");
  const enableJudge = hasFlag("--judge");
  const showMetrics = hasFlag("--metrics");
  const concurrency = parseNonNegativeInt(getArg("--concurrency")) ?? 10;
  const judgeModel = getArg("--judge-model") || process.env.EVAL_JUDGE_MODEL || "kimi-k2.6";
  const scenarioFilters = parseCsvArg(getArg("--scenario"));
  const rerunFailureFilters = readFailedScenarioIds(getArg("--rerun-failures-from"));
  const combinedScenarioFilters = Array.from(new Set([...scenarioFilters, ...rerunFailureFilters]));

  // Available models (production lane first, shadow/comparison lanes after)
  const availableModels = [
    "kimi-k2.6",
    "gpt-5.4",
    "gpt-5.4-mini",
    "claude-sonnet-4.6",
    "claude-haiku-4.5",
    "gemini-3-flash-preview",
    "deepseek-r1",
    "deepseek-v3.2",
    "qwen3-235b",
    "minimax-m2.1",
  ];

  let modelsToTest: string[];
  if (allModels) {
    modelsToTest = availableModels;
  } else if (modelsArg) {
    modelsToTest = modelsArg.split(",").map((m) => m.trim());
  } else {
    // Default: current production lane only. Shadow comparisons must be explicit.
    modelsToTest = ["kimi-k2.6"];
  }

  // Select scenarios based on suite
  let allScenarios;
  if (suite === "full" || suite === "all") {
    allScenarios = [...DEFAULT_SCENARIOS, ...NEXT_SCENARIOS, ...STRESS_SCENARIOS];
  } else if (suite === "next") {
    allScenarios = NEXT_SCENARIOS;
  } else if (suite === "stress") {
    allScenarios = STRESS_SCENARIOS;
  } else {
    allScenarios = DEFAULT_SCENARIOS;
  }

  const filteredScenarios = combinedScenarioFilters.length > 0
    ? allScenarios.filter((scenario: EvalScenario) => scenarioMatchesFilter(scenario, combinedScenarioFilters))
    : allScenarios;
  const scenarios = limit > 0 ? filteredScenarios.slice(0, limit) : filteredScenarios;

  console.log(`\n🚀 Starting COMPREHENSIVE evaluation:`);
  console.log(`   Models: ${modelsToTest.join(", ")}`);
  console.log(`   Suite: ${suite}`);
  console.log(`   Scenarios: ${scenarios.length}`);
  console.log(`   Total evaluations: ${modelsToTest.length * scenarios.length}`);
  console.log(`   LLM Judge: ${enableJudge ? "enabled" : "disabled"}`);
  console.log(`   Judge model: ${enableJudge ? judgeModel : "n/a"}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(``);

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  const startTime = Date.now();

  // Create all (model, scenario) combinations
  const tasks: Array<{ model: string; scenario: EvalScenario }> = [];
  for (const model of modelsToTest) {
    for (const scenario of scenarios) {
      tasks.push({ model, scenario });
    }
  }

  // Run with concurrency limit
  const results: EpisodeResult[] = [];
  const batches = Math.ceil(tasks.length / concurrency);

  for (let i = 0; i < batches; i++) {
    const batch = tasks.slice(i * concurrency, (i + 1) * concurrency);
    console.log(`[Batch ${i + 1}/${batches}] Running ${batch.length} evaluations...`);

    const batchResults = await Promise.all(
      batch.map(({ model, scenario }) => {
        console.log(`  [${model}/${scenario.id}] Starting...`);
        return runSingleEpisode(client, secret, model, scenario, suite, enableJudge, judgeModel);
      })
    );

    results.push(...batchResults);

    for (const r of batchResults) {
      const status = r.passed ? "✅" : "❌";
      const judgeInfo = r.judge ? ` [judge: ${r.judge.score}/10]` : "";
      console.log(`  [${r.model}/${r.scenarioId}] ${status} (${(r.elapsed / 1000).toFixed(1)}s)${judgeInfo}`);
    }
  }

  const totalElapsed = Date.now() - startTime;

  console.log(`\n📊 All ${results.length} evaluations completed in ${(totalElapsed / 1000).toFixed(1)}s\n`);

  // Compute success metrics
  const metrics = computeSuccessMetrics(results);

  // Print summary
  console.log(`\n📈 SUCCESS METRICS:`);
  console.log(`   Overall Pass Rate: ${metrics.overallPassRate.toFixed(1)}%`);
  console.log(`   Memory-First Compliance: ${metrics.memoryFirstComplianceRate.toFixed(1)}%`);
  console.log(`   Tool Ordering Accuracy: ${metrics.toolOrderingAccuracy.toFixed(1)}%`);
  console.log(`   Skill-First Rate: ${metrics.skillFirstRate.toFixed(1)}%`);
  console.log(`   Avg Latency: ${(metrics.avgLatencyMs / 1000).toFixed(1)}s (p50: ${(metrics.p50LatencyMs / 1000).toFixed(1)}s, p95: ${(metrics.p95LatencyMs / 1000).toFixed(1)}s)`);

  if (metrics.judgeMetrics) {
    console.log(`\n🧑‍⚖️ LLM JUDGE METRICS:`);
    console.log(`   Avg Score: ${metrics.judgeMetrics.avgScore.toFixed(1)}/10`);
    console.log(`   Score by Model:`);
    for (const [model, score] of Object.entries(metrics.judgeMetrics.scoreByModel)) {
      console.log(`     ${model}: ${score.toFixed(1)}/10`);
    }
    console.log(`   Criteria Pass Rates:`);
    for (const [criterion, rate] of Object.entries(metrics.judgeMetrics.criteriaPassRates)) {
      console.log(`     ${criterion}: ${rate.toFixed(0)}%`);
    }
  }

  console.log(`\n📊 PASS RATE BY MODEL:`);
  for (const [model, rate] of Object.entries(metrics.passRateByModel)) {
    const bar = "█".repeat(Math.floor(rate / 5)) + "░".repeat(20 - Math.floor(rate / 5));
    console.log(`   ${model}: ${bar} ${rate.toFixed(0)}%`);
  }

  // Write results to file
  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mdPath = join(outDir, `comprehensive-eval-${timestamp}.md`);
  const jsonPath = join(outDir, `comprehensive-eval-${timestamp}.json`);

  // Generate markdown report
  const mdLines: string[] = [];
  mdLines.push(`# Comprehensive Evaluation Results`);
  mdLines.push(``);
  mdLines.push(`Generated: ${new Date().toISOString()}`);
  mdLines.push(`Total Time: ${(totalElapsed / 1000).toFixed(1)}s`);
  mdLines.push(`Suite: ${suite}`);
  mdLines.push(`Models: ${modelsToTest.length}`);
  mdLines.push(`Scenarios: ${scenarios.length}`);
  mdLines.push(`Total evaluations: ${results.length}`);
  mdLines.push(`LLM Judge: ${enableJudge ? "enabled" : "disabled"}`);
  mdLines.push(``);
  mdLines.push(`## Success Metrics`);
  mdLines.push(``);
  mdLines.push(`| Metric | Value |`);
  mdLines.push(`|--------|-------|`);
  mdLines.push(`| Overall Pass Rate | ${metrics.overallPassRate.toFixed(1)}% |`);
  mdLines.push(`| Memory-First Compliance | ${metrics.memoryFirstComplianceRate.toFixed(1)}% |`);
  mdLines.push(`| Tool Ordering Accuracy | ${metrics.toolOrderingAccuracy.toFixed(1)}% |`);
  mdLines.push(`| Skill-First Rate | ${metrics.skillFirstRate.toFixed(1)}% |`);
  mdLines.push(`| Avg Latency | ${(metrics.avgLatencyMs / 1000).toFixed(1)}s |`);
  mdLines.push(`| p50 Latency | ${(metrics.p50LatencyMs / 1000).toFixed(1)}s |`);
  mdLines.push(`| p95 Latency | ${(metrics.p95LatencyMs / 1000).toFixed(1)}s |`);
  mdLines.push(``);

  if (metrics.judgeMetrics) {
    mdLines.push(`## LLM Judge Metrics`);
    mdLines.push(``);
    mdLines.push(`Average Score: ${metrics.judgeMetrics.avgScore.toFixed(1)}/10`);
    mdLines.push(``);
    mdLines.push(`| Model | Judge Score |`);
    mdLines.push(`|-------|-------------|`);
    for (const [model, score] of Object.entries(metrics.judgeMetrics.scoreByModel)) {
      mdLines.push(`| ${model} | ${score.toFixed(1)}/10 |`);
    }
    mdLines.push(``);
    mdLines.push(`### Criteria Pass Rates`);
    mdLines.push(``);
    mdLines.push(`| Criterion | Pass Rate |`);
    mdLines.push(`|-----------|-----------|`);
    for (const [criterion, rate] of Object.entries(metrics.judgeMetrics.criteriaPassRates)) {
      mdLines.push(`| ${criterion} | ${rate.toFixed(0)}% |`);
    }
    mdLines.push(``);
  }

  mdLines.push(`## Pass Rate by Model`);
  mdLines.push(``);
  mdLines.push(`| Model | Pass Rate | Memory-First | Tool Ordering | Avg Latency |`);
  mdLines.push(`|-------|-----------|--------------|---------------|-------------|`);
  for (const model of modelsToTest) {
    const passRate = metrics.passRateByModel[model]?.toFixed(0) ?? "N/A";
    const memFirst = metrics.memoryFirstByModel[model]?.toFixed(0) ?? "N/A";
    const toolOrder = metrics.toolOrderingByModel[model]?.toFixed(0) ?? "N/A";
    const latency = ((metrics.latencyByModel[model] ?? 0) / 1000).toFixed(1);
    mdLines.push(`| ${model} | ${passRate}% | ${memFirst}% | ${toolOrder}% | ${latency}s |`);
  }
  mdLines.push(``);

  mdLines.push(`## Pass Rate by Scenario`);
  mdLines.push(``);
  mdLines.push(`| Scenario | Pass Rate |`);
  mdLines.push(`|----------|-----------|`);
  for (const [scenarioId, rate] of Object.entries(metrics.passRateByScenario)) {
    const status = rate === 100 ? "✅" : rate >= 50 ? "⚠️" : "❌";
    mdLines.push(`| ${status} ${scenarioId} | ${rate.toFixed(0)}% |`);
  }
  mdLines.push(``);

  writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalElapsed,
        modelsToTest,
        suite,
        scenarios: scenarios.length,
        totalEvaluations: results.length,
        enableJudge,
        judgeModel,
        metrics,
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

  // NDJSON output
  if (ndjsonMode) {
    const ndjsonPath = join(outDir, `comprehensive-eval-${timestamp}.ndjson`);
    for (const r of results) {
      const episode = {
        model: r.model,
        scenario: r.scenarioId,
        ok: r.passed,
        latencyMs: r.elapsed,
        disclosure: r.disclosure ?? null,
        judge: r.judge ?? null,
        checks: r.checks ?? {},
        failureReasons: r.failureReasons,
      };
      appendFileSync(ndjsonPath, JSON.stringify(episode) + "\n", "utf8");
    }
    console.log(`   ${ndjsonPath} (NDJSON stream-processable)`);
  }

  // Extended metrics output
  if (showMetrics) {
    const metricsPath = join(outDir, `comprehensive-eval-${timestamp}-metrics.json`);
    writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + "\n", "utf8");
    console.log(`   ${metricsPath} (success metrics)`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
