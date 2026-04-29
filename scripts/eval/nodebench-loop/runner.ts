/**
 * NodeBench Loop Eval Runner — runs the 13-section query bank through
 * a free OpenRouter model (via @mariozechner/pi-ai), captures full
 * telemetry, then judges each response against the 12 eval dimensions
 * using a SECOND free OpenRouter model.
 *
 * Outputs:
 *   scripts/eval/nodebench-loop/runs/<runId>/scorecard.json
 *   scripts/eval/nodebench-loop/runs/<runId>/scorecard.md
 *   scripts/eval/nodebench-loop/runs/<runId>/raw.jsonl  (per-query)
 *
 * Usage:
 *   npx tsx scripts/eval/nodebench-loop/runner.ts
 *   npx tsx scripts/eval/nodebench-loop/runner.ts --p0           # 30-query subset
 *   npx tsx scripts/eval/nodebench-loop/runner.ts --limit 5      # quick smoke
 *   npx tsx scripts/eval/nodebench-loop/runner.ts \
 *        --agent meta-llama/llama-3.3-70b-instruct:free \
 *        --judge nvidia/nemotron-3-super-120b-a12b:free
 *
 * Env: OPENROUTER_API_KEY (loaded from .env.local if not set).
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QUERY_BANK, P0_QUERIES, ALL_DIMENSIONS, type EvalDimension, type EvalQuery, getCategoryStats } from "./queryBank.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ─── env ─── */
function loadEnv() {
  if (process.env.OPENROUTER_API_KEY) return;
  for (const p of [".env.local", ".env", "../.env.local", "../../.env.local", "../../../.env.local"]) {
    try {
      const content = readFileSync(join(process.cwd(), p), "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^(OPENROUTER_API_KEY)\s*=\s*(.+)$/);
        if (m) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
          console.log(`[env] Loaded OPENROUTER_API_KEY from ${p}`);
          return;
        }
      }
    } catch { /* file missing */ }
  }
}
loadEnv();
if (!process.env.OPENROUTER_API_KEY) {
  console.error("[fatal] OPENROUTER_API_KEY not set. Add it to .env.local.");
  process.exit(1);
}

/* ─── config ─── */
const args = new Map<string, string | true>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
}

// "Free first, fall back to paid" — same dispatch shape as the parity
// studio repo's pipeline (lib/piAi.ts → openrouter), where the proven
// frontier model is moonshotai/kimi-k2.6. Free models are tried first
// to keep eval runs at zero cost; if every free entry rate-limits or
// errors out, we fall back to kimi-k2.6 so the run still completes.
const AGENT_FALLBACK_CHAIN: string[] = [
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "minimax/minimax-m2.5:free",
  // paid fallback (proven in the parity-studio repo's 3-stage pipeline)
  "moonshotai/kimi-k2.6",
];
const JUDGE_FALLBACK_CHAIN: string[] = [
  "z-ai/glm-4.5-air:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free",
  // paid fallback
  "moonshotai/kimi-k2.6",
];

const AGENT_MODEL_OVERRIDE = args.get("agent") as string | undefined;
const JUDGE_MODEL_OVERRIDE = args.get("judge") as string | undefined;
const RUN_P0_ONLY = args.get("p0") === true;
const LIMIT = args.has("limit") ? Number(args.get("limit")) : undefined;
const PER_QUERY_BUDGET_MS = 60_000;

// Tracks which model in each chain is currently active (rotates on 429).
let agentChainIdx = 0;
let judgeChainIdx = 0;
function activeAgentModel(): string {
  return AGENT_MODEL_OVERRIDE ?? AGENT_FALLBACK_CHAIN[agentChainIdx % AGENT_FALLBACK_CHAIN.length];
}
function activeJudgeModel(): string {
  return JUDGE_MODEL_OVERRIDE ?? JUDGE_FALLBACK_CHAIN[judgeChainIdx % JUDGE_FALLBACK_CHAIN.length];
}

const queries: EvalQuery[] = (RUN_P0_ONLY ? P0_QUERIES : QUERY_BANK)
  .slice(0, LIMIT ?? Infinity);

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = join(__dirname, "runs", RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });
const RAW_PATH = join(OUT_DIR, "raw.jsonl");

console.log(`[runner] run-id=${RUN_ID}`);
console.log(`[runner] agent chain (rotates on 429): ${AGENT_MODEL_OVERRIDE ? AGENT_MODEL_OVERRIDE : AGENT_FALLBACK_CHAIN.join(" → ")}`);
console.log(`[runner] judge chain (rotates on 429): ${JUDGE_MODEL_OVERRIDE ? JUDGE_MODEL_OVERRIDE : JUDGE_FALLBACK_CHAIN.join(" → ")}`);
console.log(`[runner] queries=${queries.length} (${RUN_P0_ONLY ? "P0 only" : "full bank"})`);
console.log(`[runner] out=${OUT_DIR}`);
console.log(`[runner] category breakdown=${JSON.stringify(getCategoryStats())}`);

/* ─── system prompts ─── */

const AGENT_SYSTEM = `You are NodeBench, an entity-intelligence agent for founders, bankers, and analysts.

Every user input flows through this loop:
  query/capture → memory search → entity resolution → report update →
  notebook update → graph edges → sources/claims → follow-up/export

Operating principles you MUST follow:
1. Memory-first: BEFORE doing any live search, search prior reports, captures,
   notebooks, and the graph. Report what you found in memory.
2. Entity resolution: explicitly name companies, people, topics, and events.
   Mark uncertain identity links as "needs_review".
3. Sources + claims: every nontrivial claim needs a source. Mark unverified
   claims as "needs_review".
4. Privacy: never infer private contact info; never auto-send anything.
5. Budget: avoid paid search unless explicitly approved; surface cost when used.
6. Follow-ups: surface "next action" you would take next.

Respond with a structured JSON object using EXACTLY this schema:

{
  "summary": "one sentence telling the user what you did",
  "memory_first_steps": ["short bullets of what you searched in memory FIRST"],
  "entities": [{"name": "...", "type": "company|person|topic|event", "confidence": "low|medium|high"}],
  "claims": [{"claim": "...", "status": "verified|needs_review|rumor", "source": "url-or-source-name-or-null"}],
  "graph_edges": [{"from": "...", "to": "...", "kind": "...", "confidence": "low|medium|high"}],
  "next_action": "what the agent suggests next",
  "policy_notes": ["budget/privacy guardrails fired, if any"],
  "routing": "report|notebook|graph|export|capture|approval_gate|refusal|noop",
  "confidence": "low|medium|high"
}

Be concise. If you cannot fulfill the request safely, set "routing": "refusal"
and explain in "next_action".`;

const JUDGE_SYSTEM = `You are a strict evaluation judge for NodeBench, an entity-intelligence
agent. You score agent responses on 12 dimensions, 0–4 each:

  0 = absent / wrong
  1 = poor (mostly wrong)
  2 = partial (mixed)
  3 = good (mostly correct)
  4 = excellent (kit-canonical, no gaps)

Dimensions:
  intent_accuracy           — did it understand what the user asked
  target_routing            — correct destination (report/notebook/graph/etc.)
  entity_resolution         — companies/people/topics/events named correctly
  memory_first_behavior     — did it search memory BEFORE live search
  source_citation_precision — claims tied to sources
  claim_correctness         — claims marked verified/needs_review correctly
  graph_edge_quality        — graph edges are typed + confidence-tagged
  notebook_update_correctness — notebook edits are scoped + diff-ready
  privacy_budget_policy     — privacy + paid-call guardrails respected
  time_to_first_useful_output — concise, no padding (proxy for speed)
  user_correction_needed    — INVERSE: 4 means user need do nothing,
                              0 means response is unusable without rewrite
  export_correctness        — export bundles match requested schema

ONLY score dimensions explicitly listed in the query's "relevant_dimensions"
input — for others output null.

Output STRICT JSON ONLY (no prose, no markdown fences):

{
  "scores": { "<dimension>": 0-4 or null, ... },
  "verdict": "pass|partial|fail",
  "rationale": "one sentence per scored dimension",
  "telemetry_flags": ["e.g. hallucinated_url", "missed_memory_first"]
}`;

/* ─── pi-ai helpers ─── */
type Role = "user" | "assistant" | "system";
type AgentResponse = {
  ok: boolean;
  text: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Total cost in USD as reported by pi-ai's usage.cost. */
  costUsd?: number;
  errorMessage?: string;
};

async function callModel(modelId: string, systemPrompt: string, userText: string): Promise<AgentResponse> {
  const t0 = Date.now();
  try {
    // Cast `as any` because pi-ai's model registry keys form a literal
    // union — we accept arbitrary OpenRouter model IDs at runtime.
    const model = getModel("openrouter" as any, modelId as any);
    // Don't force-disable reasoning — some free models (e.g. gpt-oss-120b)
    // make it mandatory. Let the provider default decide.
    const result = await Promise.race([
      complete(
        model,
        {
          systemPrompt,
          messages: [{ role: "user" as const, content: userText, timestamp: Date.now() }],
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("budget_timeout")), PER_QUERY_BUDGET_MS),
      ),
    ]);
    const durationMs = Date.now() - t0;
    const r = result as any;
    const content = r?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      // pi-ai returns array of { type: "text" | "thinking" | "toolCall", ... }.
      // Only "text" parts contribute to the response body.
      text = content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text as string)
        .join("\n");
    }
    const usage = r?.usage ?? {};
    const inputTokens = usage.inputTokens ?? usage.input_tokens;
    const outputTokens = usage.outputTokens ?? usage.output_tokens;
    // pi-ai exposes `usage.cost` as { input, output, cacheRead, cacheWrite, total }
    // (see calculateCost in models.ts). Sum the parts so the scorecard
    // shows a single per-call USD number — same shape the parity-studio
    // repo streams into runs.costBreakdown.
    let costUsd: number | undefined;
    const costObj = usage.cost;
    if (costObj && typeof costObj === "object") {
      const parts = ["total", "input", "output", "cacheRead", "cacheWrite"]
        .map((k) => (typeof costObj[k] === "number" ? (costObj[k] as number) : 0));
      costUsd = costObj.total ?? parts.slice(1).reduce((a, b) => a + b, 0);
    } else if (typeof costObj === "number") {
      costUsd = costObj;
    }
    const stopReason = r?.stopReason;
    const apiErrMessage = r?.errorMessage;
    if (apiErrMessage || stopReason === "error" || stopReason === "aborted") {
      return {
        ok: false,
        text,
        durationMs,
        inputTokens,
        outputTokens,
        costUsd,
        errorMessage: apiErrMessage ?? `stopReason=${stopReason}`,
      };
    }
    return { ok: true, text, durationMs, inputTokens, outputTokens, costUsd };
  } catch (err) {
    return {
      ok: false,
      text: "",
      durationMs: Date.now() - t0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function tryParseJson<T = any>(raw: string): T | null {
  if (!raw) return null;
  // Strip ```json ... ``` if present
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fence ? fence[1] : raw;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Find first { ... } block
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ─── per-query loop ─── */

interface Score {
  scores: Partial<Record<EvalDimension, number | null>>;
  verdict: "pass" | "partial" | "fail";
  rationale: string;
  telemetry_flags: string[];
}

interface QueryRecord {
  query: EvalQuery;
  agent: AgentResponse & { modelUsed?: string };
  agentJson: any;
  judge: AgentResponse & { modelUsed?: string };
  judgeJson: Score | null;
  weightedScore: number;
}

function weightedScore(judgeJson: Score | null): number {
  if (!judgeJson?.scores) return 0;
  let sum = 0;
  let count = 0;
  for (const v of Object.values(judgeJson.scores)) {
    if (typeof v === "number") {
      sum += v;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Call a model via the active chain entry. If the response hits a 429
 * (free-tier rate limit) we rotate to the next chain entry and retry —
 * up to chainLength times. Each retry is logged so the scorecard can
 * tell which model produced each response.
 */
async function callModelWithFallback(
  kind: "agent" | "judge",
  systemPrompt: string,
  userText: string,
): Promise<AgentResponse & { modelUsed: string }> {
  const chain = kind === "agent" ? AGENT_FALLBACK_CHAIN : JUDGE_FALLBACK_CHAIN;
  const chainLen = chain.length;
  let lastErr: AgentResponse | null = null;
  for (let attempt = 0; attempt < chainLen; attempt++) {
    const model = kind === "agent" ? activeAgentModel() : activeJudgeModel();
    const r = await callModel(model, systemPrompt, userText);
    if (r.ok && r.text) return { ...r, modelUsed: model };
    lastErr = r;
    const msg = (r.errorMessage ?? "").toLowerCase();
    const isRecoverable =
      msg.includes("429") ||
      msg.includes("rate-limit") ||
      msg.includes("rate limit") ||
      msg.includes("temporarily rate-limited") ||
      msg.includes("400") ||
      msg.includes("404") ||
      msg.includes("503") ||
      msg.includes("reasoning is mandatory") ||
      msg.includes("budget_timeout");
    if (!isRecoverable) return { ...r, modelUsed: model };
    // Rotate the chain pointer. Pacing keeps OpenRouter happy.
    if (kind === "agent") agentChainIdx++;
    else judgeChainIdx++;
    console.log(`  ↳ ${kind} on ${model} → rotating (${(r.errorMessage ?? "").slice(0, 60)})`);
    await new Promise((r) => setTimeout(r, 800));
  }
  return { ...(lastErr ?? { ok: false, text: "", durationMs: 0, errorMessage: "all_chain_entries_failed" }), modelUsed: chain[chainLen - 1] };
}

async function runOne(q: EvalQuery): Promise<QueryRecord> {
  console.log(`\n[query ${q.id}] ${q.category} — "${q.query.slice(0, 80)}"`);

  // 1. Run agent
  const agent = await callModelWithFallback("agent", AGENT_SYSTEM, q.context ? `${q.context}\n\n${q.query}` : q.query);
  const agentJson = tryParseJson(agent.text);
  console.log(`  ↳ agent[${agent.modelUsed}]: ${agent.ok ? "ok" : "FAIL"} · ${agent.durationMs}ms · parsed=${!!agentJson}`);

  // 2. Run judge
  const judgePrompt = JSON.stringify({
    user_query: q.query,
    expected_behavior: q.expected,
    relevant_dimensions: q.dimensions,
    agent_response: agent.text || `[ERROR: ${agent.errorMessage}]`,
  });
  const judge = await callModelWithFallback("judge", JUDGE_SYSTEM, judgePrompt);
  const judgeJson = tryParseJson<Score>(judge.text);
  const score = weightedScore(judgeJson);
  console.log(`  ↳ judge[${judge.modelUsed}]: ${judge.ok ? "ok" : "FAIL"} · ${judge.durationMs}ms · score=${score.toFixed(2)} · verdict=${judgeJson?.verdict ?? "?"}`);

  const record: QueryRecord = { query: q, agent, agentJson, judge, judgeJson, weightedScore: score };
  appendFileSync(RAW_PATH, JSON.stringify(record) + "\n");
  return record;
}

/* ─── main ─── */

async function main() {
  const records: QueryRecord[] = [];
  const t0 = Date.now();

  for (const q of queries) {
    try {
      const r = await runOne(q);
      records.push(r);
    } catch (err) {
      console.error(`[runOne] ${q.id} unexpected error:`, err);
    }
    // soft pace to avoid OpenRouter free-tier rate limit (10/min)
    await new Promise((r) => setTimeout(r, 500));
  }

  const totalMs = Date.now() - t0;

  /* ─── aggregate ─── */
  const byCategory: Record<string, { count: number; avgScore: number; passes: number; fails: number; partials: number }> = {};
  const byDim: Record<EvalDimension, { count: number; sum: number; avg: number }> = ALL_DIMENSIONS.reduce(
    (acc, d) => ({ ...acc, [d]: { count: 0, sum: 0, avg: 0 } }),
    {} as any,
  );

  for (const r of records) {
    const cat = r.query.category;
    if (!byCategory[cat]) byCategory[cat] = { count: 0, avgScore: 0, passes: 0, fails: 0, partials: 0 };
    byCategory[cat].count++;
    byCategory[cat].avgScore += r.weightedScore;
    const v = r.judgeJson?.verdict;
    if (v === "pass") byCategory[cat].passes++;
    else if (v === "fail") byCategory[cat].fails++;
    else if (v === "partial") byCategory[cat].partials++;

    if (r.judgeJson?.scores) {
      for (const [d, s] of Object.entries(r.judgeJson.scores)) {
        if (typeof s === "number" && d in byDim) {
          byDim[d as EvalDimension].count++;
          byDim[d as EvalDimension].sum += s;
        }
      }
    }
  }

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].avgScore /= byCategory[cat].count || 1;
  }
  for (const d of ALL_DIMENSIONS) {
    byDim[d].avg = byDim[d].count === 0 ? 0 : byDim[d].sum / byDim[d].count;
  }

  const overallAvg = records.reduce((s, r) => s + r.weightedScore, 0) / (records.length || 1);
  const passes = records.filter((r) => r.judgeJson?.verdict === "pass").length;
  const partials = records.filter((r) => r.judgeJson?.verdict === "partial").length;
  const fails = records.filter((r) => r.judgeJson?.verdict === "fail").length;

  const agentModelsUsed = new Set(records.map((r) => r.agent.modelUsed).filter(Boolean));
  const judgeModelsUsed = new Set(records.map((r) => r.judge.modelUsed).filter(Boolean));

  const costAgentTotal = records.reduce((s, r) => s + (r.agent.costUsd ?? 0), 0);
  const costJudgeTotal = records.reduce((s, r) => s + (r.judge.costUsd ?? 0), 0);
  const inTokAgent = records.reduce((s, r) => s + (r.agent.inputTokens ?? 0), 0);
  const outTokAgent = records.reduce((s, r) => s + (r.agent.outputTokens ?? 0), 0);
  const inTokJudge = records.reduce((s, r) => s + (r.judge.inputTokens ?? 0), 0);
  const outTokJudge = records.reduce((s, r) => s + (r.judge.outputTokens ?? 0), 0);

  const scorecard = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    agentModel: AGENT_MODEL_OVERRIDE ?? AGENT_FALLBACK_CHAIN[0],
    judgeModel: JUDGE_MODEL_OVERRIDE ?? JUDGE_FALLBACK_CHAIN[0],
    agentChain: AGENT_MODEL_OVERRIDE ? [AGENT_MODEL_OVERRIDE] : AGENT_FALLBACK_CHAIN,
    judgeChain: JUDGE_MODEL_OVERRIDE ? [JUDGE_MODEL_OVERRIDE] : JUDGE_FALLBACK_CHAIN,
    agentModelsUsed: [...agentModelsUsed],
    judgeModelsUsed: [...judgeModelsUsed],
    queryCount: records.length,
    totalMs,
    avgQueryMs: Math.round(totalMs / (records.length || 1)),
    overallScore: Number(overallAvg.toFixed(3)),
    overallScorePct: Math.round((overallAvg / 4) * 100),
    verdicts: { pass: passes, partial: partials, fail: fails },
    byCategory,
    byDimension: byDim,
    telemetry: {
      tokens: {
        agentInputTotal: inTokAgent,
        agentOutputTotal: outTokAgent,
        judgeInputTotal: inTokJudge,
        judgeOutputTotal: outTokJudge,
      },
      costUsd: {
        agentTotal: Number(costAgentTotal.toFixed(6)),
        judgeTotal: Number(costJudgeTotal.toFixed(6)),
        runTotal: Number((costAgentTotal + costJudgeTotal).toFixed(6)),
      },
    },
    perQuery: records.map((r) => ({
      id: r.query.id,
      category: r.query.category,
      verdict: r.judgeJson?.verdict ?? "?",
      score: Number(r.weightedScore.toFixed(3)),
      agentMs: r.agent.durationMs,
      judgeMs: r.judge.durationMs,
      agentModel: r.agent.modelUsed,
      judgeModel: r.judge.modelUsed,
      agentOk: r.agent.ok,
      agentParsed: !!r.agentJson,
      agentInputTokens: r.agent.inputTokens,
      agentOutputTokens: r.agent.outputTokens,
      agentCostUsd: r.agent.costUsd,
      judgeInputTokens: r.judge.inputTokens,
      judgeOutputTokens: r.judge.outputTokens,
      judgeCostUsd: r.judge.costUsd,
      flags: r.judgeJson?.telemetry_flags ?? [],
    })),
  };

  writeFileSync(join(OUT_DIR, "scorecard.json"), JSON.stringify(scorecard, null, 2));
  writeFileSync(join(OUT_DIR, "scorecard.md"), renderMarkdown(scorecard));

  console.log(`\n[runner] DONE`);
  console.log(`  • run-id:           ${RUN_ID}`);
  console.log(`  • queries:          ${records.length}`);
  console.log(`  • overall score:    ${overallAvg.toFixed(2)}/4 (${Math.round((overallAvg / 4) * 100)}%)`);
  console.log(`  • verdicts:         pass=${passes} partial=${partials} fail=${fails}`);
  console.log(`  • total runtime:    ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  • avg query time:   ${Math.round(totalMs / (records.length || 1))}ms`);
  console.log(`  • out:              ${OUT_DIR}`);
}

function renderMarkdown(sc: any): string {
  const lines: string[] = [];
  lines.push(`# NodeBench Loop Eval — ${sc.runId}`);
  lines.push("");
  lines.push(`**Agent chain (free OpenRouter via pi-ai):** ${sc.agentChain.map((m: string) => `\`${m}\``).join(" → ")}  `);
  lines.push(`**Judge chain (free OpenRouter via pi-ai):** ${sc.judgeChain.map((m: string) => `\`${m}\``).join(" → ")}  `);
  lines.push(`**Agent models that produced responses:** ${sc.agentModelsUsed.map((m: string) => `\`${m}\``).join(", ") || "none"}  `);
  lines.push(`**Judge models that produced verdicts:** ${sc.judgeModelsUsed.map((m: string) => `\`${m}\``).join(", ") || "none"}  `);
  lines.push(`**Generated:** ${sc.timestamp}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- **Queries:** ${sc.queryCount}`);
  lines.push(`- **Overall score:** ${sc.overallScore.toFixed(2)} / 4.00  (**${sc.overallScorePct}%**)`);
  lines.push(`- **Verdicts:** pass = ${sc.verdicts.pass} · partial = ${sc.verdicts.partial} · fail = ${sc.verdicts.fail}`);
  lines.push(`- **Total runtime:** ${(sc.totalMs / 1000).toFixed(1)}s · **avg query:** ${sc.avgQueryMs}ms`);
  lines.push("");
  lines.push(`## Telemetry (cost + tokens)`);
  lines.push("");
  lines.push(`| | input tokens | output tokens | cost (USD) |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| agent | ${sc.telemetry.tokens.agentInputTotal.toLocaleString()} | ${sc.telemetry.tokens.agentOutputTotal.toLocaleString()} | $${sc.telemetry.costUsd.agentTotal.toFixed(6)} |`);
  lines.push(`| judge | ${sc.telemetry.tokens.judgeInputTotal.toLocaleString()} | ${sc.telemetry.tokens.judgeOutputTotal.toLocaleString()} | $${sc.telemetry.costUsd.judgeTotal.toFixed(6)} |`);
  lines.push(`| **run total** | — | — | **$${sc.telemetry.costUsd.runTotal.toFixed(6)}** |`);
  lines.push("");
  lines.push(`## By category`);
  lines.push("");
  lines.push(`| Category | n | Avg score | Pass | Partial | Fail |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const [cat, v] of Object.entries(sc.byCategory) as [string, any][]) {
    lines.push(`| ${cat} | ${v.count} | ${v.avgScore.toFixed(2)} | ${v.passes} | ${v.partials} | ${v.fails} |`);
  }
  lines.push("");
  lines.push(`## By dimension`);
  lines.push("");
  lines.push(`| Dimension | n scored | Avg score |`);
  lines.push(`|---|---|---|`);
  for (const d of ALL_DIMENSIONS) {
    const v = sc.byDimension[d];
    lines.push(`| ${d} | ${v.count} | ${v.avg.toFixed(2)} |`);
  }
  lines.push("");
  lines.push(`## Per-query`);
  lines.push("");
  lines.push(`| Id | Category | Verdict | Score | Agent ms | Agent cost (USD) | Judge ms | Flags |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const q of sc.perQuery) {
    const flags = q.flags.length ? q.flags.slice(0, 3).join(", ") : "—";
    const cost = typeof q.agentCostUsd === "number" ? `$${q.agentCostUsd.toFixed(6)}` : "free";
    lines.push(`| ${q.id} | ${q.category} | ${q.verdict} | ${q.score.toFixed(2)} | ${q.agentMs} | ${cost} | ${q.judgeMs} | ${flags} |`);
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
