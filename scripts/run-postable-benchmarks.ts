#!/usr/bin/env npx tsx

/**
 * Postable benchmarks for NodeBench AI.
 *
 * Runs a small set of representative, end-to-end checks and produces:
 * - docs/benchmarks/benchmark-report-latest.md
 * - docs/benchmarks/benchmark-report-latest.json
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-postable-benchmarks.ts --iterations 5 --include-linkup
 *
 * Notes:
 * - May spend money (Linkup + LLM API calls). Use --no-linkup and --skip-persona to reduce cost.
 * - Never prints secrets intentionally.
 */

import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

dotenv.config({ path: ".env.local" });
dotenv.config();

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const pos = (xs.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (xs[base + 1] === undefined) return xs[base];
  return xs[base] + rest * (xs[base + 1] - xs[base]);
}

function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(n: number, d: number): string {
  if (d <= 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function redactSecrets(text: string): string {
  // Best-effort: scrub common secret env var values if they appear.
  const secrets = [
    process.env.MCP_SECRET,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.LINKUP_API_KEY,
    process.env.YOUTUBE_API_KEY,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  let out = text;
  for (const s of secrets) {
    out = out.split(s).join("[REDACTED]");
  }
  return out;
}

const PERSONAS = [
  "JPM_STARTUP_BANKER",
  "EARLY_STAGE_VC",
  "CTO_TECH_LEAD",
  "FOUNDER_STRATEGY",
  "ACADEMIC_RD",
  "ENTERPRISE_EXEC",
  "ECOSYSTEM_PARTNER",
  "QUANT_ANALYST",
  "PRODUCT_DESIGNER",
  "SALES_ENGINEER",
] as const;

function inferPersonaFromQueryId(queryId: string): (typeof PERSONAS)[number] | "Unknown" {
  const q = queryId.toLowerCase();
  if (q.startsWith("banker-")) return "JPM_STARTUP_BANKER";
  if (q.startsWith("vc-")) return "EARLY_STAGE_VC";
  if (q.startsWith("cto-")) return "CTO_TECH_LEAD";
  if (q.startsWith("founder-")) return "FOUNDER_STRATEGY";
  if (q.startsWith("academic-")) return "ACADEMIC_RD";
  if (q.startsWith("exec-")) return "ENTERPRISE_EXEC";
  if (q.startsWith("ecosystem-")) return "ECOSYSTEM_PARTNER";
  if (q.startsWith("quant-")) return "QUANT_ANALYST";
  if (q.startsWith("product-designer-")) return "PRODUCT_DESIGNER";
  if (q.startsWith("sales-")) return "SALES_ENGINEER";
  return "Unknown";
}

function getGitSha(): string | null {
  const git = process.platform === "win32" ? "git.exe" : "git";
  const res = spawnSync(git, ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (res.status !== 0) return null;
  const sha = String(res.stdout ?? "").trim();
  return sha.length ? sha : null;
}

function tryReadConvexEnvVar(name: string): string | null {
  const local = process.env[name];
  if (local && local.trim()) return local.trim();

  // Avoid `npx` on Windows (it may be a PowerShell shim). Prefer the local CLI.
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

async function timed<T>(fn: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
  const startedAt = Date.now();
  const value = await fn();
  return { elapsedMs: Date.now() - startedAt, value };
}

async function main() {
  const iterations = parsePositiveInt(getArg("--iterations"), 5);
  const includeLinkup = hasFlag("--include-linkup") && !hasFlag("--no-linkup");
  const linkupQuery = getArg("--linkup-query") || "DISCO Pharmaceuticals seed funding December 2025";
  const includePersona = hasFlag("--include-persona") && !hasFlag("--skip-persona");
  const personaSuiteRaw = (getArg("--persona-suite") || "core").toLowerCase();
  const personaSuite: "core" | "full" = personaSuiteRaw === "full" ? "full" : "core";

  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");
  }
  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) {
    throw new Error("Missing MCP_SECRET. Tip: `node_modules/.bin/convex env get MCP_SECRET` then `set MCP_SECRET=...`.");
  }

  const gitSha = getGitSha();
  const client = new ConvexHttpClient(convexUrl);

  const benchmark: any = {
    generatedAt: new Date().toISOString(),
    gitSha,
    convexUrl,
    config: { iterations, includeLinkup, includePersona },
    runs: {
      liveApiSmoke: [] as any[],
      systemE2E: null as any,
    },
  };

  for (let i = 0; i < iterations; i++) {
    const { value } = await timed(async () => {
      return await client.action(api.domains.evaluation.liveApiSmoke.run, {
        secret,
        requireMcpChecks: true,
        includeLinkup: includeLinkup || undefined,
        linkupQuery: includeLinkup ? linkupQuery : undefined,
      });
    });
    benchmark.runs.liveApiSmoke.push(value);
  }

  {
    const out: any = {
      ok: true,
      timestamp: Date.now(),
      checks: {},
    };

    try {
      const daily = await client.action(api.domains.evaluation.systemE2E.validateDailyBriefing, { runWorkflow: true });
      out.checks.dailyBrief = daily;
      if (!daily?.ok) out.ok = false;
    } catch (e) {
      out.ok = false;
      out.checks.dailyBrief = { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) };
    }

    try {
      const localCtx = await client.action(api.domains.evaluation.systemE2E.validateFastAgentLocalContext, {
        timeoutMs: 120_000,
      });
      out.checks.fastAgentLocalContext = localCtx;
      if (!localCtx?.ok) out.ok = false;
    } catch (e) {
      out.ok = false;
      out.checks.fastAgentLocalContext = { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) };
    }

    try {
      const coreQueryIds = ["banker-disco-1", "cto-quickjs-1", "exec-gemini-1"];
      const fullQueryIds = [
        "banker-disco-1",
        "vc-disco-1",
        "cto-quickjs-1",
        "founder-salesforce-1",
        "academic-ryr2-1",
        "exec-gemini-1",
        "ecosystem-soundcloud-1",
        "quant-disco-1",
        "product-designer-disco-1",
        "sales-disco-1",
      ];

      const queryIds = personaSuite === "full" ? fullQueryIds : coreQueryIds;
      const batches = personaSuite === "full" ? [queryIds.slice(0, 5), queryIds.slice(5, 10)] : [queryIds];
      const batchResults: any[] = [];
      for (const batch of batches) {
        const res = await client.action(api.domains.evaluation.systemE2E.runAnonymousEvalSuite, { queryIds: batch });
        batchResults.push(res);
      }

      const combined = {
        ok: batchResults.every((b) => Boolean(b?.ok)) && batchResults.length > 0,
        elapsedMs: batchResults.reduce((sum, b) => sum + Number(b?.elapsedMs ?? 0), 0),
        sessionId: String(batchResults[0]?.sessionId ?? ""),
        sessionIds: batchResults.map((b) => String(b?.sessionId ?? "")).filter((s) => s.length > 0),
        summary: {
          total: batchResults.reduce((sum, b) => sum + Number(b?.summary?.total ?? 0), 0),
          passed: batchResults.reduce((sum, b) => sum + Number(b?.summary?.passed ?? 0), 0),
          failed: batchResults.reduce((sum, b) => sum + Number(b?.summary?.failed ?? 0), 0),
        },
        results: batchResults.flatMap((b) => (Array.isArray(b?.results) ? b.results : [])),
      };

      const anon = combined;
      out.checks.anonymousEvalSuite = anon;
      if (!anon?.ok) out.ok = false;
    } catch (e) {
      out.ok = false;
      out.checks.anonymousEvalSuite = { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) };
    }

    if (includePersona) {
      try {
        const persona = await client.action(api.domains.evaluation.personaLiveEval.runPersonaLiveEval, {});
        out.checks.personaLiveEval = persona;
        const scenarios = Array.isArray(persona?.scenarios) ? persona.scenarios : [];
        const failed = scenarios.filter((s: any) => s?.success !== true);
        if (failed.length > 0) out.ok = false;
      } catch (e) {
        out.ok = false;
        out.checks.personaLiveEval = { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) };
      }
    }

    benchmark.runs.systemE2E = out;
  }

  // Aggregate stats
  const liveRuns = (benchmark.runs.liveApiSmoke as Array<any>).filter((r) => r && typeof r === "object");
  const byCheck: Record<string, { ok: number; total: number; elapsed: number[] }> = {};
  for (const r of liveRuns) {
    const results = r?.results ?? {};
    for (const [name, v] of Object.entries(results)) {
      const entry = (byCheck[name] ??= { ok: 0, total: 0, elapsed: [] });
      entry.total += 1;
      if ((v as any)?.ok === true) entry.ok += 1;
      const ms = Number((v as any)?.elapsedMs);
      if (Number.isFinite(ms)) entry.elapsed.push(ms);
    }
  }

  const liveSummary = Object.entries(byCheck)
    .map(([name, s]) => ({
      name,
      passRate: pct(s.ok, s.total),
      ok: s.ok,
      total: s.total,
      p50: quantile(s.elapsed, 0.5),
      p95: quantile(s.elapsed, 0.95),
      mean: mean(s.elapsed),
    }))
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));

  benchmark.summary = {
    liveApiSmoke: liveSummary,
    systemE2E: {
      ok: Boolean(benchmark.runs.systemE2E?.ok),
      checks: benchmark.runs.systemE2E?.checks ? Object.keys(benchmark.runs.systemE2E.checks) : [],
    },
  };

  // Render Markdown report
  const mdLines: string[] = [];
  mdLines.push(`# NodeBench AI — Postable Benchmarks`);
  mdLines.push(``);
  mdLines.push(`Generated: ${benchmark.generatedAt}`);
  mdLines.push(`Git SHA: ${gitSha ?? "(unknown)"}`);
  mdLines.push(`Convex: ${convexUrl}`);
  mdLines.push(`Iterations (MCP smoke): ${iterations}`);
  mdLines.push(`Include Linkup: ${includeLinkup ? "yes" : "no"}`);
  mdLines.push(`Include Persona Live Eval: ${includePersona ? "yes" : "no"}`);
  mdLines.push(`Persona Suite (Boolean Eval): ${personaSuite}`);
  mdLines.push(``);

  mdLines.push(`## 1) MCP + Live API Smoke (MCP-1/4/5)`);
  mdLines.push(`This suite validates: Core-agent planning/memory tools, OpenBB executeTool, Research fusion_search, plus public provider health checks.`);
  mdLines.push(``);
  mdLines.push(`| Check | Pass | p50 (ms) | p95 (ms) | mean (ms) |`);
  mdLines.push(`|---|---:|---:|---:|---:|`);
  for (const row of liveSummary) {
    mdLines.push(
      `| ${row.name} | ${row.passRate} (${row.ok}/${row.total}) | ${row.p50 == null ? "" : Math.round(row.p50)} | ${row.p95 == null ? "" : Math.round(row.p95)} | ${
        row.mean == null ? "" : Math.round(row.mean)
      } |`
    );
  }
  mdLines.push(``);

  mdLines.push(`## 2) System E2E (Daily Brief + Fast Agent Context + QA)`);
  const sys = benchmark.runs.systemE2E ?? {};
  mdLines.push(`Overall: ${sys.ok ? "PASS" : "FAIL"}`);
  mdLines.push(``);
  if (sys.checks?.dailyBrief) {
    mdLines.push(`- Daily brief: ok=${Boolean(sys.checks.dailyBrief.ok)} day=${sys.checks.dailyBrief.day} title=${sys.checks.dailyBrief.landingLog?.latestBriefTitle ?? ""}`);
  }
  if (sys.checks?.fastAgentLocalContext) {
    mdLines.push(`- Fast Agent local context: ok=${Boolean(sys.checks.fastAgentLocalContext.ok)} elapsedMs=${sys.checks.fastAgentLocalContext.elapsedMs ?? ""}`);
    const got = sys.checks.fastAgentLocalContext.got;
    if (got) {
      mdLines.push(`  - timezone=${got.timezone ?? ""}, location=${got.location ?? ""}, utcDay=${got.utcDay ?? ""}`);
      mdLines.push(`  - trendingTopics=${Array.isArray(got.trendingTopics) ? got.trendingTopics.slice(0, 8).join(", ") : ""}`);
    }
  }
  if (sys.checks?.anonymousEvalSuite) {
    const results = Array.isArray(sys.checks.anonymousEvalSuite.results) ? sys.checks.anonymousEvalSuite.results : [];
    const passed = results.filter((r: any) => r?.passed === true).length;
    mdLines.push(`- Anonymous QA suite: ok=${Boolean(sys.checks.anonymousEvalSuite.ok)} passed=${passed}/${results.length}`);
  }
  if (sys.checks?.personaLiveEval) {
    const scenarios = Array.isArray(sys.checks.personaLiveEval.scenarios) ? sys.checks.personaLiveEval.scenarios : [];
    const succeeded = scenarios.filter((s: any) => s?.success === true).length;
    mdLines.push(`- Persona live eval: scenarios=${scenarios.length} success=${succeeded}/${scenarios.length}`);
  }
  mdLines.push(``);

  // Persona-gated view (tailored to the 10 personas in audit_mocks.ts)
  if (sys.checks?.anonymousEvalSuite) {
    const results = Array.isArray(sys.checks.anonymousEvalSuite.results) ? sys.checks.anonymousEvalSuite.results : [];
    const byPersona = new Map<string, Array<{ queryId: string; passed: boolean; score: number; failureReasons: string[] }>>();
    for (const r of results) {
      const queryId = String(r?.queryId ?? "");
      const persona = inferPersonaFromQueryId(queryId);
      const passed = r?.passed === true;
      const score = typeof r?.score === "number" ? r.score : 0;
      const failureReasons = Array.isArray(r?.failureReasons) ? r.failureReasons.map(String) : [];
      const arr = byPersona.get(persona) ?? [];
      arr.push({ queryId, passed, score, failureReasons });
      byPersona.set(persona, arr);
    }

    const covered = new Set([...byPersona.keys()].filter((k) => k !== "Unknown"));
    const missing = PERSONAS.filter((p) => !covered.has(p));

    mdLines.push(`## 3) Persona Quality Gates (Boolean Eval)`);
    mdLines.push(`Covers ${covered.size}/${PERSONAS.length} personas (derived from \`audit_mocks.ts\`).`);
    if (missing.length > 0) {
      mdLines.push(`Missing personas (no queries executed): ${missing.join(", ")}`);
    }
    mdLines.push(``);

    mdLines.push(`| Persona | Query | Status | Score | Notes |`);
    mdLines.push(`|---|---|---:|---:|---|`);
    for (const [persona, rows] of [...byPersona.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      for (const row of rows) {
        const status = row.passed ? "PASS" : "FAIL";
        const notes = row.passed ? "" : row.failureReasons.slice(0, 2).join("; ").slice(0, 120);
        mdLines.push(`| ${persona} | ${row.queryId} | ${status} | ${row.score} | ${notes} |`);
      }
    }
    mdLines.push(``);
  }

  mdLines.push(`## Notes`);
  mdLines.push(`- This report is generated without printing secrets; MCP/LLM keys are not included.`);
  mdLines.push(`- Re-run with: \`set CONVEX_URL=...; set MCP_SECRET=...; npx tsx scripts/run-postable-benchmarks.ts --iterations 5 --include-linkup --include-persona --persona-suite full\``);
  mdLines.push(``);

  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });
  const outMd = join(outDir, "benchmark-report-latest.md");
  const outJson = join(outDir, "benchmark-report-latest.json");
  writeFileSync(outMd, mdLines.join("\n"), "utf8");
  writeFileSync(outJson, JSON.stringify(benchmark, null, 2) + "\n", "utf8");

  process.stdout.write(`Wrote:\n- ${outMd}\n- ${outJson}\n`);
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
