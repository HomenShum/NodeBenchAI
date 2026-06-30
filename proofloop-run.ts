/**
 * proof-looping driver: run nodebench-ai's REAL agent harness "full force",
 * but with noderoom's model (z-ai/glm-5.2 via OpenRouter) + web substrate (Firecrawl).
 *
 * The harness routes every model call through callTool("call_llm") and every web step
 * through callTool("web_search"), so this swaps the brain+web without touching the harness.
 *
 * Keys are read from env (injected at run time, never printed):
 *   OPENROUTER_API_KEY  -> glm-5.2   (== noderoom default)
 *   FIRECRAWL_API_KEY   -> web search (== noderoom web substrate)
 *
 * Run:  npx tsx proofloop-run.ts "<query>" "<Entity>"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePlan, executeHarness, synthesizeResults } from "./server/agentHarness.ts";

const MODEL = "z-ai/glm-5.2";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY ?? "";
if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY missing");
if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY missing");

const query = process.argv[2] ?? "Anthropic enterprise strategy, revenue trajectory, and key risks in 2026";
const entity = process.argv[3] ?? "Anthropic";
const classification = "company_search";
const lens = "general";

let llmCalls = 0, llmTokIn = 0, llmTokOut = 0, fcCalls = 0;
const COST = { in: 0.30 / 1e6, out: 1.20 / 1e6 }; // approx glm-5.2 $/token; informational only

function estTok(s: string) { return Math.ceil((s ?? "").length / 4); }

async function callLlm(args: Record<string, unknown>): Promise<unknown> {
  llmCalls++;
  const sys = (args.system ?? args.systemPrompt ?? "") as string;
  const user = (args.prompt ?? args.input ?? args.query ?? args.text ?? JSON.stringify(args)) as string;
  const messages = Array.isArray(args.messages) && args.messages.length
    ? (args.messages as any[])
    : [...(sys ? [{ role: "system", content: sys }] : []), { role: "user", content: user }];
  llmTokIn += estTok(sys) + estTok(user);
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://noderoom.local",
      "X-Title": "proof-looping nodebench-ai run",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 1200 }),
  });
  if (!resp.ok) throw new Error(`openrouter ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json: any = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  llmTokOut += estTok(content);
  return { text: content, content, answer: content, output: content, model: MODEL };
}

async function webSearch(args: Record<string, unknown>): Promise<unknown> {
  fcCalls++;
  const q = (args.query ?? args.q ?? "") as string;
  const limit = Math.min(Number(args.maxResults ?? args.limit ?? 5) || 5, 8);
  const resp = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, limit }),
  });
  if (!resp.ok) {
    return { results: [], error: `firecrawl ${resp.status}: ${(await resp.text()).slice(0, 160)}` };
  }
  const json: any = await resp.json();
  const data: any[] = json?.data ?? json?.results ?? [];
  const results = data.slice(0, limit).map((r) => ({
    title: r?.title ?? r?.metadata?.title ?? r?.name ?? "",
    url: r?.url ?? r?.link ?? r?.metadata?.sourceURL ?? "",
    snippet: r?.description ?? r?.snippet ?? (typeof r?.markdown === "string" ? r.markdown.slice(0, 300) : ""),
  }));
  return { results };
}

async function llmJson(system: string, user: string): Promise<any> {
  const r = await callLlm({ system, prompt: user + "\n\nReturn ONLY valid minified JSON, no prose, no code fences." });
  const raw = String((r as any).content ?? "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; }
}

function priorContext(args: Record<string, unknown>): string {
  const prior = (args as any)._priorResults ?? {};
  const out: string[] = [];
  for (const v of Object.values(prior)) {
    for (const res of ((v as any)?.results ?? [])) out.push(`- ${res.title}: ${res.snippet}`.slice(0, 280));
  }
  return out.slice(0, 12).join("\n") || "(no prior web results)";
}

// run_recon via glm-5.2: model does the diligence analysis over the live web findings.
async function runRecon(args: Record<string, unknown>) {
  const j = await llmJson(
    "You are a sharp equity-research / diligence analyst. Be specific and evidence-grounded.",
    `Entity: ${entity}. Question: ${query}\nLive web findings:\n${priorContext(args)}\n\n` +
    `Produce JSON: {"findings":[{"name":"<one-line finding>","direction":"up|down|neutral","impact":"high|medium|low"}],"summary":"<3-4 sentence diligence read>","nextSteps":[{"action":"<concrete next diligence step>"}]}. 5 findings max.`);
  return { findings: j.findings ?? [], summary: j.summary ?? "", nextSteps: j.nextSteps ?? [] };
}

// enrich_entity via glm-5.2: model produces lens-specific signals.
async function enrichEntity(args: Record<string, unknown>) {
  const j = await llmJson(
    "You are a markets analyst extracting durable signals from evidence.",
    `Entity: ${entity}. Question: ${query}\nLive web findings:\n${priorContext(args)}\n\n` +
    `Produce JSON: {"signals":[{"name":"<signal>","direction":"up|down|neutral","impact":"high|medium|low"}],"description":"<2-3 sentence synthesis>"}. 5 signals max.`);
  return { signals: j.signals ?? [], description: j.description ?? "" };
}

const trace: any[] = [];
const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const t0 = Date.now();
  try {
    let out: unknown;
    if (name === "call_llm") out = await callLlm(args);
    else if (name === "web_search" || name === "linkup_search") out = await webSearch(args);
    else if (name === "run_recon") out = await runRecon(args);
    else if (name === "enrich_entity") out = await enrichEntity(args);
    else out = { findings: [], note: `tool '${name}' not wired in standalone driver` }; // founder_local_gather/simulate
    trace.push({ tool: name, ms: Date.now() - t0, ok: true });
    return out;
  } catch (e: any) {
    trace.push({ tool: name, ms: Date.now() - t0, ok: false, error: String(e?.message ?? e) });
    throw e;
  }
};

const events: any[] = [];
const onTrace = (ev: any) => { events.push(ev); };

const started = Date.now();
console.log(`\n=== proof-looping: nodebench-ai harness @ ${MODEL} (+ Firecrawl web) ===`);
console.log(`query: ${query}\nentity: ${entity}\n`);

const plan = await generatePlan(query, classification, [entity], lens, callTool);
console.log(`PLAN: ${plan.steps.length} steps | classification=${plan.classification}`);
for (const s of plan.steps) console.log(`  - ${(s as any).id ?? "?"} ${(s as any).toolName} :: ${(s as any).purpose ?? ""}`.slice(0, 120));

const execution = await executeHarness(plan, callTool, onTrace, { toolTimeoutMs: 40000 });
const packet = await synthesizeResults(execution, query, lens, callTool);
const wallMs = Date.now() - started;

const stepResults: any[] = (execution as any).stepResults ?? [];
const estCost = llmTokIn * COST.in + llmTokOut * COST.out;

const report = {
  model: MODEL, query, entity, wallMs,
  planSteps: plan.steps.length,
  executedSteps: stepResults.length,
  llmCalls, firecrawlCalls: fcCalls, estTokIn: llmTokIn, estTokOut: llmTokOut, estCostUsd: Number(estCost.toFixed(5)),
  stepTrace: stepResults.map((s) => ({ id: s.stepId ?? s.id, tool: s.toolName, ok: s.success ?? !s.error, ms: s.latencyMs ?? s.ms, model: s.model })),
  toolTrace: trace,
  entityName: (packet as any).entityName,
  sources: (packet as any).sources ?? (packet as any).sourceList,
  packetKeys: Object.keys(packet as any),
};

const dir = `.proofloop-run/${new Date(started).toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
writeFileSync(`${dir}/packet.json`, JSON.stringify(packet, null, 2));
writeFileSync(`${dir}/events.json`, JSON.stringify(events, null, 2));

console.log(`\n=== RESULT ===`);
console.log(`wall: ${(wallMs / 1000).toFixed(1)}s | steps exec: ${stepResults.length} | llm calls: ${llmCalls} | firecrawl: ${fcCalls}`);
console.log(`est tokens: ${llmTokIn} in / ${llmTokOut} out | est cost: $${estCost.toFixed(5)}`);
console.log(`entityName: ${(packet as any).entityName}`);
const ans = (packet as any).answer ?? (packet as any).summary ?? (packet as any).narrative ?? (packet as any).text ?? "";
console.log(`\n--- synthesized answer (first 900 chars) ---\n${String(ans).slice(0, 900)}`);
const srcs = (packet as any).sources ?? [];
console.log(`\n--- sources (${Array.isArray(srcs) ? srcs.length : 0}) ---`);
for (const s of (Array.isArray(srcs) ? srcs : []).slice(0, 8)) console.log(`  - ${s.label ?? s.title ?? s.name} ${s.href ?? s.url ?? ""}`.slice(0, 120));
console.log(`\nevidence written to: ${dir}/`);
