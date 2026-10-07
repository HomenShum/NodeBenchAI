#!/usr/bin/env npx tsx

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import dotenv from "dotenv";

import { inferCaptureRoute, type CaptureRoute } from "../apps/web/src/features/product/lib/captureRouter";
import { HERO_SCENARIO_TESTS, type ScenarioTestCase } from "../apps/web/src/features/workspace/data/scenarioCatalog";

dotenv.config({ path: ".env.local" });
dotenv.config();

type ScenarioFlow = "event" | "job" | "founder" | "investor" | "research_workspace";

type FlowSpec = {
  flow: ScenarioFlow;
  lens: "founder" | "investor" | "banker" | "ceo" | "legal" | "student";
  mode: "ask" | "note" | "task";
  activeContextLabel?: string;
  contextHint: string;
  agentPrompt: string;
  requiredResultTerms: string[];
  expectedClassification?: string[];
  maxPaidCalls: number;
};

type RuntimeResult = {
  ok: boolean;
  status: number;
  payload: any;
  elapsedMs: number;
  error?: string;
};

type ScenarioRun = {
  id: string;
  title: string;
  flow: ScenarioFlow;
  passed: boolean;
  capture: {
    enabled: boolean;
    target?: string;
    intent?: string;
    gate?: string;
    ack?: string;
    entityCount?: number;
    claimCount?: number;
    followUpCount?: number;
    passed: boolean;
    failures: string[];
  };
  runtime: {
    status: number;
    elapsedMs: number;
    classification?: string;
    lens?: string;
    entityName?: string;
    sourceCount: number;
    signalCount: number;
    nextActionCount: number;
    traceSteps: string[];
    paidCalls: number;
    providerLeak: boolean;
    passed: boolean;
    failures: string[];
  };
};

type EvalReport = {
  generatedAt: string;
  baseUrl: string;
  paidSearchAllowed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    byFlow: Record<string, { total: number; passed: number; passRate: number }>;
  };
  results: ScenarioRun[];
};

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function timestampFileSafe(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function scenarioSpec(scenario: ScenarioTestCase): FlowSpec {
  switch (scenario.id) {
    case "live-event-capture":
      return {
        flow: "event",
        lens: "investor",
        mode: "note",
        activeContextLabel: "Ship Demo Day",
        contextHint:
          "Event corpus available: Ship Demo Day includes Orbital Labs, founder conversations, healthcare design-partner interest, and field-note claims. Use event corpus first. Captures stay private by default. No paid search.",
        agentPrompt:
          "Ship Demo Day event capture: Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners. Turn this into an event intelligence packet with entities, claims, verification status, and next actions.",
        requiredResultTerms: ["Orbital", "event", "claim", "follow"],
        expectedClassification: ["company_search", "general", "multi_entity", "pre_delegation"],
        maxPaidCalls: 0,
      };
    case "recruiter-prep":
      return {
        flow: "job",
        lens: "founder",
        mode: "task",
        contextHint:
          "Inbox item available: recruiter email about a Staff Engineer role. Build interview prep from the inbox item and reusable memory before public search. No paid search.",
        agentPrompt:
          "Recruiter emailed me about Staff Engineer at Anthropic. Prepare a company-risk briefing, role-specific talking points, questions to ask, and a concise reply draft.",
        requiredResultTerms: ["Anthropic", "interview", "reply"],
        expectedClassification: ["company_search", "general"],
        maxPaidCalls: 0,
      };
    case "founder-customer-discovery":
      return {
        flow: "founder",
        lens: "founder",
        mode: "note",
        activeContextLabel: "Customer discovery report",
        contextHint:
          "Private founder customer-discovery notes. Treat them as field evidence, cluster pain themes, preserve objections, and produce follow-ups. No paid search.",
        agentPrompt:
          "Founder customer discovery notes: five clinic operators reported prior-auth delays, no budget owner, and interest in a pilot only if ROI proof exists. Synthesize pain themes, objections, roadmap implications, and next actions.",
        requiredResultTerms: ["prior", "budget", "pilot"],
        expectedClassification: ["general", "founder_progression", "plan_proposal", "pre_delegation"],
        maxPaidCalls: 0,
      };
    case "investor-demo-day":
      return {
        flow: "investor",
        lens: "investor",
        mode: "ask",
        activeContextLabel: "Ship Demo Day",
        contextHint:
          "Event corpus available for Ship Demo Day. Use event corpus and tenant memory first. Treat traction as unverified field claims unless evidence exists. No paid search.",
        agentPrompt:
          "Investor demo day diligence: compare Orbital Labs, Everlaw, Mercor, and DISCO from Ship Demo Day. Cluster by market, identify unverified traction claims, rank founder follow-ups, and create a diligence queue.",
        requiredResultTerms: ["compare", "claim", "follow"],
        expectedClassification: ["multi_entity", "company_search", "general"],
        maxPaidCalls: 0,
      };
    case "research-report-workspace":
      return {
        flow: "research_workspace",
        lens: "investor",
        mode: "ask",
        activeContextLabel: "Research report workspace",
        contextHint:
          "Workspace handoff required. Output should be usable in Brief, Cards, Notebook, Sources, Chat, and Map. Use cached/source memory before live search. No paid search.",
        agentPrompt:
          "Create a research report workspace from a messy question: which AI eval infrastructure companies are worth tracking for investors? Produce brief, cards, notebook notes, source verification needs, chat follow-ups, and map edges.",
        requiredResultTerms: ["workspace", "cards", "sources"],
        expectedClassification: ["general", "company_search", "multi_entity"],
        maxPaidCalls: 0,
      };
    default:
      throw new Error(`No runtime flow spec for scenario ${scenario.id}`);
  }
}

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // wait and retry
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function stopProcessTree(proc: ChildProcess | null): Promise<void> {
  if (!proc || typeof proc.pid !== "number") return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    proc.kill("SIGTERM");
  } catch {
    return;
  }

  const exited = await Promise.race([
    new Promise((resolve) => proc.once("exit", () => resolve(true))),
    sleep(6000).then(() => false),
  ]);
  if (exited) return;

  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

async function maybeStartServer(baseUrl: string, port: number, allowPaidSearch: boolean): Promise<ChildProcess | null> {
  const url = new URL(baseUrl);
  if (await isPortOpen(url.hostname, Number(url.port || port))) {
    return null;
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const command = `${npx} tsx workers/node/index.ts --port ${port}`;
  const child = spawn(command, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      NODEBENCH_ALLOW_PAID_SEARCH: allowPaidSearch ? "true" : "false",
      LINKUP_SEARCH_ALLOW_PAID: allowPaidSearch ? "true" : "false",
      NODEBENCH_SCENARIO_CATALOG_EVAL: "1",
    },
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(String(chunk)));
  child.stderr?.on("data", (chunk) => process.stderr.write(String(chunk)));
  await waitForHealth(baseUrl, 180_000);
  return child;
}

function buildCaptureResult(scenario: ScenarioTestCase, spec: FlowSpec): { route: CaptureRoute; passed: boolean; failures: string[] } {
  const route = inferCaptureRoute({
    text: scenario.realLifeInput,
    mode: spec.mode,
    activeContextLabel: spec.activeContextLabel,
  });
  const failures: string[] = [];
  if (route.intent !== scenario.inferredIntent) {
    failures.push(`capture intent ${route.intent} != ${scenario.inferredIntent}`);
  }
  if (route.target !== scenario.target) {
    failures.push(`capture target ${route.target} != ${scenario.target}`);
  }
  if (scenario.target === "active_event_session" && !route.ack.toLowerCase().includes("active event session")) {
    failures.push("event capture ack does not mention active event session");
  }
  if (route.entities.length === 0) failures.push("capture extracted no entities");
  if (route.claims.length === 0 && scenario.inferredIntent === "capture_field_note") {
    failures.push("capture extracted no claims");
  }
  return { route, passed: failures.length === 0, failures };
}

async function callRuntime(baseUrl: string, scenario: ScenarioTestCase, spec: FlowSpec): Promise<RuntimeResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-owner-key": "scenario-catalog-eval",
      },
      body: JSON.stringify({
        query: spec.agentPrompt,
        lens: spec.lens,
        daysBack: 14,
        ownerKey: "scenario-catalog-eval",
        sessionId: `scenario-catalog-${scenario.id}-${Date.now()}`,
        contextHint: spec.contextHint,
      }),
      signal: AbortSignal.timeout(Number(getArg("--timeout-ms") ?? 90_000)),
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { rawText: text };
    }
    return {
      ok: response.ok && payload?.success === true,
      status: response.status,
      payload,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function countPaidCalls(trace: any[], paidSearchAllowed: boolean): number {
  if (!paidSearchAllowed) return 0;
  return trace.filter((entry) => {
    const tool = String(entry?.tool ?? "").toLowerCase();
    const status = String(entry?.status ?? "").toLowerCase();
    const detail = String(entry?.detail ?? "").toLowerCase();
    return tool.includes("linkup") && status === "ok" && !detail.includes("null") && !detail.includes("no live sources");
  }).length;
}

function hasProviderLeak(result: any): boolean {
  const visiblePayload = {
    canonicalEntity: result?.canonicalEntity,
    signals: result?.signals,
    whatChanged: result?.whatChanged,
    contradictions: result?.contradictions,
    nextActions: result?.nextActions,
    nextQuestions: result?.nextQuestions,
    keyMetrics: result?.keyMetrics,
  };
  return /\b(brave|serper|tavily|linkup)\b/i.test(JSON.stringify(visiblePayload));
}

function evaluateRuntime(
  runtime: RuntimeResult,
  spec: FlowSpec,
  paidSearchAllowed: boolean,
): ScenarioRun["runtime"] {
  const payload = runtime.payload ?? {};
  const result = payload.result ?? {};
  const trace = Array.isArray(payload.trace) ? payload.trace : [];
  const traceSteps = trace.map((entry: any) => String(entry?.step ?? entry?.tool ?? "unknown"));
  const sourceCount = Array.isArray(result.sourceRefs)
    ? result.sourceRefs.length
    : Array.isArray(result.sourcesUsed)
      ? result.sourcesUsed.length
      : 0;
  const signalCount = Array.isArray(result.signals) ? result.signals.length : 0;
  const nextActionCount = Array.isArray(result.nextActions) ? result.nextActions.length : 0;
  const entityName = typeof result?.canonicalEntity?.name === "string" ? result.canonicalEntity.name : undefined;
  const resultText = JSON.stringify(result).toLowerCase();
  const paidCalls = countPaidCalls(trace, paidSearchAllowed);
  const providerLeak = hasProviderLeak(result);
  const failures: string[] = [];

  if (!runtime.ok) failures.push(runtime.error ?? payload?.message ?? `runtime status ${runtime.status}`);
  if (!payload.classification) failures.push("missing runtime classification");
  if (spec.expectedClassification && payload.classification && !spec.expectedClassification.includes(payload.classification)) {
    failures.push(`classification ${payload.classification} not in ${spec.expectedClassification.join(", ")}`);
  }
  if (!entityName) failures.push("missing canonical entity");
  if (signalCount === 0 && sourceCount === 0 && nextActionCount === 0) {
    failures.push("missing signals, sources, and next actions");
  }
  if (nextActionCount === 0) failures.push("missing next actions");
  if (!traceSteps.includes("classify_query")) failures.push("trace missing classify_query");
  if (!traceSteps.includes("build_context_bundle")) failures.push("trace missing build_context_bundle");
  if (!traceSteps.some((step) => step === "agent_plan" || step === "agent_execute" || step === "tool_call")) {
    failures.push("trace missing agent/tool execution");
  }
  for (const term of spec.requiredResultTerms) {
    if (!resultText.includes(term.toLowerCase())) failures.push(`missing result term: ${term}`);
  }
  if (paidCalls > spec.maxPaidCalls) failures.push(`paid calls ${paidCalls} > ${spec.maxPaidCalls}`);
  if (providerLeak) failures.push("visible result leaks provider names");

  return {
    status: runtime.status,
    elapsedMs: runtime.elapsedMs,
    classification: payload.classification,
    lens: payload.lens,
    entityName,
    sourceCount,
    signalCount,
    nextActionCount,
    traceSteps,
    paidCalls,
    providerLeak,
    passed: failures.length === 0,
    failures,
  };
}

function summarize(results: ScenarioRun[], baseUrl: string, paidSearchAllowed: boolean): EvalReport {
  const byFlow: EvalReport["summary"]["byFlow"] = {};
  for (const result of results) {
    const entry = byFlow[result.flow] ?? { total: 0, passed: 0, passRate: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    entry.passRate = entry.total > 0 ? entry.passed / entry.total : 0;
    byFlow[result.flow] = entry;
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    paidSearchAllowed,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      byFlow,
    },
    results,
  };
}

function writeReports(report: EvalReport, jsonPath: string, mdPath: string): void {
  ensureDir(join(process.cwd(), "docs", "architecture", "benchmarks"));
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    "# Scenario Catalog Runtime Eval",
    "",
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseUrl}`,
    `Paid search allowed: ${report.paidSearchAllowed}`,
    `Pass rate: ${(report.summary.passRate * 100).toFixed(1)}% (${report.summary.passed}/${report.summary.total})`,
    "",
    "## Results",
    "",
    "| Scenario | Flow | Capture | Runtime | Classification | Entity | Sources | Signals | Paid Calls | Latency | Failures |",
    "|---|---|---|---|---|---|---:|---:|---:|---:|---|",
    ...report.results.map((result) => {
      const failures = [...result.capture.failures, ...result.runtime.failures].join("; ") || "none";
      return [
        result.title,
        result.flow,
        result.capture.passed ? "pass" : "fail",
        result.runtime.passed ? "pass" : "fail",
        result.runtime.classification ?? "n/a",
        result.runtime.entityName ?? "n/a",
        String(result.runtime.sourceCount),
        String(result.runtime.signalCount),
        String(result.runtime.paidCalls),
        String(result.runtime.elapsedMs),
        failures.replace(/\|/g, "/"),
      ].join(" | ");
    }).map((row) => `| ${row} |`),
    "",
    "## Flow Summary",
    "",
    "| Flow | Passed | Total | Pass Rate |",
    "|---|---:|---:|---:|",
    ...Object.entries(report.summary.byFlow).map(
      ([flow, entry]) => `| ${flow} | ${entry.passed} | ${entry.total} | ${(entry.passRate * 100).toFixed(1)}% |`,
    ),
  ];
  writeFileSync(mdPath, lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  const allowPaidSearch = hasFlag("--allow-paid-search");
  process.env.NODEBENCH_ALLOW_PAID_SEARCH = allowPaidSearch ? "true" : "false";
  process.env.LINKUP_SEARCH_ALLOW_PAID = allowPaidSearch ? "true" : "false";

  const port = Number(getArg("--port") ?? 3100);
  const baseUrl = stripTrailingSlash(getArg("--base-url") ?? `http://127.0.0.1:${port}`);
  const runStamp = timestampFileSafe();
  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  const jsonPath = getArg("--jsonOut") ?? join(outDir, `scenario-catalog-runtime-eval-${runStamp}.json`);
  const mdPath = getArg("--mdOut") ?? join(outDir, `scenario-catalog-runtime-eval-${runStamp}.md`);
  const latestJsonPath = join(outDir, "scenario-catalog-runtime-eval-latest.json");
  const latestMdPath = join(outDir, "scenario-catalog-runtime-eval-latest.md");

  const scenarioFilter = getArg("--scenario");
  const limit = Number(getArg("--limit") ?? HERO_SCENARIO_TESTS.length);
  const scenarios = HERO_SCENARIO_TESTS
    .filter((scenario) => !scenarioFilter || scenario.id === scenarioFilter)
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : HERO_SCENARIO_TESTS.length);

  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched ${scenarioFilter ?? "filters"}`);
  }

  let serverProc: ChildProcess | null = null;
  try {
    if (hasFlag("--start-server")) {
      serverProc = await maybeStartServer(baseUrl, port, allowPaidSearch);
    } else {
      await waitForHealth(baseUrl, 5000);
    }

    const results: ScenarioRun[] = [];
    for (const scenario of scenarios) {
      const spec = scenarioSpec(scenario);
      console.log(`\nRunning ${scenario.id} (${spec.flow})`);
      const capture = buildCaptureResult(scenario, spec);
      const runtime = await callRuntime(baseUrl, scenario, spec);
      const runtimeEval = evaluateRuntime(runtime, spec, allowPaidSearch);
      const passed = capture.passed && runtimeEval.passed;
      results.push({
        id: scenario.id,
        title: scenario.title,
        flow: spec.flow,
        passed,
        capture: {
          enabled: true,
          target: capture.route.target,
          intent: capture.route.intent,
          gate: capture.route.gate,
          ack: capture.route.ack,
          entityCount: capture.route.entities.length,
          claimCount: capture.route.claims.length,
          followUpCount: capture.route.followUps.length,
          passed: capture.passed,
          failures: capture.failures,
        },
        runtime: runtimeEval,
      });
      console.log(`  capture=${capture.passed ? "pass" : "fail"} runtime=${runtimeEval.passed ? "pass" : "fail"} ${runtimeEval.elapsedMs}ms`);
      if (!passed) {
        for (const failure of [...capture.failures, ...runtimeEval.failures]) {
          console.log(`  - ${failure}`);
        }
      }
    }

    const report = summarize(results, baseUrl, allowPaidSearch);
    writeReports(report, jsonPath, mdPath);
    writeReports(report, latestJsonPath, latestMdPath);

    console.log(`\nScenario catalog runtime eval: ${report.summary.passed}/${report.summary.total} passed (${(report.summary.passRate * 100).toFixed(1)}%)`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Markdown: ${mdPath}`);

    if (report.summary.failed > 0) process.exitCode = 1;
  } finally {
    await stopProcessTree(serverProc);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
