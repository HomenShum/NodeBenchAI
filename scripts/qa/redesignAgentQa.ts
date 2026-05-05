/**
 * Redesign Agent QA — live Gemini 3.1 Pro Preview pass over the /redesign route.
 *
 * Runs each persona scenario from `personas.ts`, sends a multi-modal prompt to Gemini
 * (page screenshot + scenario + rubric), parses structured findings, and writes a
 * markdown report under `.tmp/redesign-qa/<timestamp>/`.
 *
 * Usage:
 *   npx tsx scripts/qa/redesignAgentQa.ts
 *   npx tsx scripts/qa/redesignAgentQa.ts --personas banker_diligence,karpathy_learner
 *   BASE_URL=http://localhost:5200 npx tsx scripts/qa/redesignAgentQa.ts
 *
 * Env (read from .env.local via dotenv if present, else process.env):
 *   GEMINI_API_KEY  — required
 *   BASE_URL        — default http://localhost:5200
 *
 * Pi-AI / Convex parity:
 *   Uses the same `@google/genai` SDK + `process.env.GEMINI_API_KEY` pattern that
 *   `convex/domains/evaluation/dogfood/screenshotQa.ts` uses. Same model fallback
 *   chain (gemini-3.1-pro-preview → gemini-3-flash-preview → gemini-2.5-flash-lite).
 *   Drop-in promotable to a Convex action when needed.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { chromium, type Browser, type Page } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

import { PERSONAS, RUBRIC_DIMENSIONS, type PersonaScenario } from "./personas";

// Load .env.local if present (dev parity)
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const PRIMARY_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"];

interface CliArgs {
  personas: string[];
  baseUrl: string;
  outputDir: string;
  reportId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    personas: PERSONAS.map((p) => p.id),
    baseUrl: process.env.BASE_URL ?? "http://localhost:5200",
    outputDir: path.resolve(".tmp/redesign-qa", new Date().toISOString().replace(/[:.]/g, "-")),
    reportId: "rep_orbital",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--personas" && argv[i + 1]) {
      args.personas = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (argv[i] === "--report-id" && argv[i + 1]) {
      args.reportId = argv[++i];
    } else if (argv[i] === "--out" && argv[i + 1]) {
      args.outputDir = argv[++i];
    } else if (argv[i] === "--base-url" && argv[i + 1]) {
      args.baseUrl = argv[++i];
    }
  }
  return args;
}

async function captureScenario(
  page: Page,
  scenario: PersonaScenario,
  baseUrl: string,
  outputDir: string,
): Promise<{ screenshotPath: string; html: string; consoleErrors: string[] }> {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const url = `${baseUrl}${scenario.startUrl}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000); // let TipTap mount

  const screenshotPath = path.join(outputDir, `${scenario.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Capture a structural snapshot so the judge can reason about DOM-level details
  const html = await page.evaluate(() => {
    const container = document.querySelector("[data-redesign]") ?? document.body;
    return (container as HTMLElement).innerText.slice(0, 8000);
  });

  return { screenshotPath, html, consoleErrors };
}

interface JudgeFinding {
  severity: "p0" | "p1" | "p2" | "p3";
  dimension: string;
  title: string;
  details: string;
  suggestedFix: string;
  evidence: string;
}

interface JudgeResult {
  scenario: string;
  modelUsed: string;
  scoreOverall: number;     // 0..100
  scoresByDimension: Record<string, number>; // dimension → 0..10
  summary: string;
  findings: JudgeFinding[];
  rawResponseText: string;
}

const JUDGE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scoreOverall: { type: Type.NUMBER, description: "0-100 weighted by persona's rubricEmphasis" },
    scoresByDimension: {
      type: Type.OBJECT,
      description: "Map of rubric dimension id (snake_case) to score 0-10",
      additionalProperties: { type: Type.NUMBER },
    },
    summary: { type: Type.STRING, description: "2-3 sentences on the persona's experience" },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: { type: Type.STRING, enum: ["p0", "p1", "p2", "p3"] },
          dimension: { type: Type.STRING, description: "Rubric dimension id this finding maps to" },
          title: { type: Type.STRING, description: "<60 chars" },
          details: { type: Type.STRING, description: "1-3 sentences of WHY" },
          suggestedFix: { type: Type.STRING, description: "concrete code/CSS/UX change" },
          evidence: { type: Type.STRING, description: "what in the screenshot/text proves this" },
        },
        required: ["severity", "dimension", "title", "details", "suggestedFix", "evidence"],
      },
    },
  },
  required: ["scoreOverall", "scoresByDimension", "summary", "findings"],
} as const;

function buildJudgePrompt(scenario: PersonaScenario, html: string): string {
  const rubricLines = scenario.rubricEmphasis
    .map((dim) => {
      const r = RUBRIC_DIMENSIONS[dim];
      if (!r) return `- ${dim}: (no description)`;
      return `- **${dim}** — ${r.name}: ${r.description}`;
    })
    .join("\n");

  return `You are an Obsidian + Roam + Notion + Karpathy-style power user reviewing the NodeBench redesign route. Your job is to judge whether the live page matches the depth, polish, and feel of those products combined.

# Persona

${scenario.name}: ${scenario.oneLine}

${scenario.context}

# What this persona would attempt

${scenario.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

# Success criteria

${scenario.successCriteria.map((c) => `- ${c}`).join("\n")}

# Rubric (dimensions weighted highest for THIS persona)

${rubricLines}

Score 0–10 per dimension. The overall score is a weighted average where these emphasized dimensions count 2× and others count 1×. Be honest — sub-7 means the persona would churn.

# Live page innerText (first 8 KB, for grounding)

\`\`\`
${html}
\`\`\`

# Output

Respond with structured JSON matching the schema. Findings:
- p0: blocks the persona's task entirely
- p1: forces the persona to abandon a sub-flow
- p2: noticeable polish gap
- p3: nit

Cite concrete evidence from the screenshot or innerText. Suggest concrete fixes (CSS class, JSX prop, copy change) — no hand-waving.

DO NOT use any external knowledge about NodeBench beyond what's in the screenshot + innerText. Score what you see.`;
}

async function judgeScenario(
  ai: GoogleGenAI,
  scenario: PersonaScenario,
  screenshotPath: string,
  html: string,
): Promise<JudgeResult> {
  const screenshotBytes = await fs.readFile(screenshotPath);
  const screenshotPart = {
    inlineData: {
      mimeType: "image/png",
      data: screenshotBytes.toString("base64"),
    },
  };
  const prompt = buildJudgePrompt(scenario, html);

  const modelChain = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown = null;
  for (const model of modelChain) {
    try {
      // eslint-disable-next-line no-console
      console.log(`  → ${scenario.id} via ${model}…`);
      const t0 = Date.now();
      const response = await ai.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: prompt }, screenshotPart] },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: JUDGE_RESPONSE_SCHEMA as never,
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      });

      const rawText = response.text ?? "";
      const elapsedMs = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`     ✓ ${model} responded in ${(elapsedMs / 1000).toFixed(1)}s`);

      let parsed: Omit<JudgeResult, "scenario" | "modelUsed" | "rawResponseText">;
      try {
        parsed = JSON.parse(rawText);
      } catch (parseErr) {
        // eslint-disable-next-line no-console
        console.warn(`     ⚠ JSON parse failed for ${model}: ${(parseErr as Error).message}`);
        throw parseErr;
      }

      return {
        scenario: scenario.id,
        modelUsed: model,
        scoreOverall: parsed.scoreOverall ?? 0,
        scoresByDimension: parsed.scoresByDimension ?? {},
        summary: parsed.summary ?? "",
        findings: parsed.findings ?? [],
        rawResponseText: rawText,
      };
    } catch (err) {
      lastErr = err;
      // eslint-disable-next-line no-console
      console.warn(`     ✗ ${model} failed: ${(err as Error).message}`);
      // try next model
    }
  }
  throw new Error(
    `All Gemini models failed for ${scenario.id}: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

function aggregateFindings(results: JudgeResult[]): JudgeFinding[] {
  const all: JudgeFinding[] = [];
  for (const r of results) {
    for (const f of r.findings) {
      all.push({ ...f, evidence: `[${r.scenario}] ${f.evidence}` });
    }
  }
  // Sort by severity (p0 first) then dimension
  const order = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;
  all.sort((a, b) => order[a.severity] - order[b.severity]);
  return all;
}

function renderMarkdownReport(args: {
  baseUrl: string;
  reportId: string;
  results: JudgeResult[];
  startedAt: Date;
  finishedAt: Date;
}): string {
  const { baseUrl, reportId, results, startedAt, finishedAt } = args;
  const totalScore =
    results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + r.scoreOverall, 0) / results.length)
      : 0;
  const elapsedSec = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1);
  const findings = aggregateFindings(results);
  const counts = {
    p0: findings.filter((f) => f.severity === "p0").length,
    p1: findings.filter((f) => f.severity === "p1").length,
    p2: findings.filter((f) => f.severity === "p2").length,
    p3: findings.filter((f) => f.severity === "p3").length,
  };

  const lines: string[] = [];
  lines.push(`# Redesign Agent QA — ${startedAt.toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");
  lines.push(`**Target**: \`${baseUrl}/redesign/reports/${reportId}\``);
  lines.push(`**Personas**: ${results.length}  ·  **Wall-clock**: ${elapsedSec}s  ·  **Avg score**: **${totalScore}/100**`);
  lines.push(`**Findings**: P0 ${counts.p0} · P1 ${counts.p1} · P2 ${counts.p2} · P3 ${counts.p3}`);
  lines.push("");
  lines.push("> Ground truth: live `/redesign` route. Judge: Gemini 3.1 Pro Preview (with Flash fallback). Pi-AI parity: same `@google/genai` SDK + `process.env.GEMINI_API_KEY` pattern as `convex/domains/evaluation/dogfood/screenshotQa.ts`.");
  lines.push("");

  // Per-persona summary
  lines.push("## Per-persona summary");
  lines.push("");
  lines.push("| Persona | Score | Model | Findings | Top finding |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    const top = r.findings[0];
    const topLabel = top ? `${top.severity.toUpperCase()} · ${top.title}` : "—";
    lines.push(
      `| ${r.scenario} | **${r.scoreOverall}/100** | \`${r.modelUsed}\` | ${r.findings.length} | ${topLabel} |`,
    );
  }
  lines.push("");

  // Per-dimension heatmap
  const allDims = new Set<string>();
  for (const r of results) Object.keys(r.scoresByDimension).forEach((d) => allDims.add(d));
  if (allDims.size > 0) {
    lines.push("## Dimension scores (0–10)");
    lines.push("");
    const dims = Array.from(allDims).sort();
    lines.push("| Dimension | " + results.map((r) => r.scenario).join(" | ") + " |");
    lines.push("|---|" + results.map(() => "---").join("|") + "|");
    for (const d of dims) {
      const row = results.map((r) => {
        const s = r.scoresByDimension[d];
        return s == null ? "—" : s.toFixed(1);
      });
      lines.push(`| ${d} | ${row.join(" | ")} |`);
    }
    lines.push("");
  }

  // Findings (P0/P1 first)
  for (const sev of ["p0", "p1", "p2", "p3"] as const) {
    const subset = findings.filter((f) => f.severity === sev);
    if (subset.length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} — ${subset.length} finding${subset.length === 1 ? "" : "s"}`);
    lines.push("");
    for (const f of subset) {
      lines.push(`### ${f.title}`);
      lines.push(`*Dimension*: \`${f.dimension}\`  ·  *Evidence*: ${f.evidence}`);
      lines.push("");
      lines.push(f.details);
      lines.push("");
      lines.push(`**Suggested fix**: ${f.suggestedFix}`);
      lines.push("");
    }
  }

  // Per-persona detailed sections
  lines.push("---");
  lines.push("");
  lines.push("## Per-persona detail");
  for (const r of results) {
    const persona = PERSONAS.find((p) => p.id === r.scenario)!;
    lines.push("");
    lines.push(`### ${persona.name} — ${r.scoreOverall}/100`);
    lines.push(`*Scenario*: ${persona.oneLine}  ·  *Model*: \`${r.modelUsed}\``);
    lines.push("");
    lines.push("> " + r.summary);
    lines.push("");
    if (r.findings.length === 0) {
      lines.push("_No findings._");
    } else {
      for (const f of r.findings) {
        lines.push(`- **${f.severity.toUpperCase()} · ${f.dimension}** — ${f.title}`);
        lines.push(`  - ${f.details}`);
        lines.push(`  - Fix: ${f.suggestedFix}`);
      }
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    console.error(
      "✗ GEMINI_API_KEY not set. Add it to .env.local or pass via env. " +
        "Same key the existing convex/domains/evaluation/dogfood/screenshotQa.ts reads.",
    );
    process.exit(1);
  }

  const personasToRun = PERSONAS.filter((p) => args.personas.includes(p.id));
  if (personasToRun.length === 0) {
    console.error(`✗ No personas matched: ${args.personas.join(", ")}`);
    console.error(`  Available: ${PERSONAS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  await fs.mkdir(args.outputDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`▸ Redesign Agent QA`);
  console.log(`  Base URL : ${args.baseUrl}`);
  console.log(`  Output   : ${args.outputDir}`);
  console.log(`  Personas : ${personasToRun.map((p) => p.id).join(", ")}`);
  console.log(`  Model    : ${PRIMARY_MODEL} (fallback → ${FALLBACK_MODELS.join(" → ")})`);
  console.log("");

  const ai = new GoogleGenAI({ apiKey });
  const browser: Browser = await chromium.launch({ headless: true });
  const startedAt = new Date();
  const results: JudgeResult[] = [];

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    for (const persona of personasToRun) {
      console.log(`▸ ${persona.id}  (${persona.name})`);
      try {
        const { screenshotPath, html, consoleErrors } = await captureScenario(
          page,
          persona,
          args.baseUrl,
          args.outputDir,
        );
        if (consoleErrors.length > 0) {
          console.log(`  ⚠ ${consoleErrors.length} console error(s) on page`);
        }
        const result = await judgeScenario(ai, persona, screenshotPath, html);
        results.push(result);
        console.log(`  ✓ scored ${result.scoreOverall}/100  ·  ${result.findings.length} findings`);
      } catch (err) {
        console.error(`  ✗ ${persona.id} failed: ${(err as Error).message}`);
        results.push({
          scenario: persona.id,
          modelUsed: "(failed)",
          scoreOverall: 0,
          scoresByDimension: {},
          summary: `Run failed: ${(err as Error).message}`,
          findings: [],
          rawResponseText: "",
        });
      }
    }

    await ctx.close();
  } finally {
    await browser.close();
  }

  const finishedAt = new Date();
  const reportPath = path.join(args.outputDir, "findings.md");
  const jsonPath = path.join(args.outputDir, "results.json");
  const md = renderMarkdownReport({
    baseUrl: args.baseUrl,
    reportId: args.reportId,
    results,
    startedAt,
    finishedAt,
  });
  await fs.writeFile(reportPath, md, "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), "utf8");

  console.log("");
  console.log(`✓ Markdown report: ${reportPath}`);
  console.log(`✓ JSON results  : ${jsonPath}`);

  // Summary
  const total = results.reduce((acc, r) => acc + r.scoreOverall, 0);
  const avg = results.length ? Math.round(total / results.length) : 0;
  const allFindings = aggregateFindings(results);
  const p0 = allFindings.filter((f) => f.severity === "p0").length;
  const p1 = allFindings.filter((f) => f.severity === "p1").length;
  console.log("");
  console.log(`▸ Summary: avg ${avg}/100  ·  P0 ${p0}  ·  P1 ${p1}  ·  total findings ${allFindings.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
