/**
 * Tri-search rerank quality eval — "is it measurably better?" proof.
 *
 * Golden-reference eval for the tri-search third leg (shared/search/triSearch.ts).
 * Compares two rankers over a labeled corpus and reports the LIFT:
 *   - BASELINE: a real lexical ranker (token-overlap), simulating BM25/keyword
 *     retrieval. NOT hand-ordered — computed by the script so it can't be rigged.
 *   - TRI-SEARCH: BASELINE order reranked by Gemini Flash-Lite (rerankWithGemini).
 *
 * Metrics (standard IR): NDCG@5 (graded relevance), MRR, Precision@5, Recall@5.
 * Per-query win/loss/tie by NDCG@5 is reported honestly — if rerank loses, it shows.
 *
 * This is the repeatable workflow (eval-flywheel pattern): re-run any time a
 * retrieval/rerank change lands, track the JSON in results/ over time, and gate
 * on "no NDCG@5 regression vs the last accepted baseline."
 *
 * Run:  npx tsx scripts/eval-harness/triSearchRerankEval.ts
 *       (loads GEMINI_API_KEY from .env.local automatically)
 *
 * Prior art: RRF (Cormack 2009), Anthropic Contextual Retrieval (rerank lift),
 * standard TREC IR metrics (NDCG/MRR/MAP).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rerankWithGemini, type TriCandidate } from "../../shared/search/triSearch";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

// --- Load GEMINI_API_KEY from .env.local (tsx doesn't auto-load it) ---
function loadEnvKey(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
    if (line) {
      let val = line.slice(line.indexOf("=") + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[name] = val;
      return val;
    }
  } catch { /* no .env.local */ }
  return undefined;
}

// --- Corpus: query + graded candidates (rel 0=irrelevant, 1=related, 2=highly relevant). ---
// Distractors deliberately share query keywords (so a lexical ranker mis-ranks them high) —
// this is the realistic case rerankers exist to fix. Two domains: event Q&A + entity intel.
type Cand = { id: string; title: string; snippet: string; rel: 0 | 1 | 2 };
type Q = { query: string; candidates: Cand[] };

const CORPUS: Q[] = [
  {
    query: "What did the panel recommend for MCP enterprise authentication?",
    candidates: [
      { id: "q1a", title: "Enterprise SSO pricing tiers announced", snippet: "New enterprise plan pricing for single sign-on seats.", rel: 0 },
      { id: "q1b", title: "MCP server quickstart", snippet: "How to install and run an MCP server locally in five minutes.", rel: 1 },
      { id: "q1c", title: "Panel transcript: MCP enterprise auth", snippet: "Panelists recommended short-lived scoped credentials over static API keys, per-client tool allow-lists, and server-side enforcement of every host action.", rel: 2 },
      { id: "q1d", title: "Authentication service outage postmortem", snippet: "Root cause of last week's auth login outage and remediation.", rel: 0 },
      { id: "q1e", title: "Security hardening: rotate secrets, audit tool calls", snippet: "Operational guidance: rotate secrets on a fixed cadence and audit every tool invocation.", rel: 2 },
      { id: "q1f", title: "Conference wifi login instructions", snippet: "Steps to authenticate to the venue wireless network.", rel: 0 },
    ],
  },
  {
    query: "How should teams control runaway cost in long-running agent loops?",
    candidates: [
      { id: "q2a", title: "Cloud compute pricing comparison", snippet: "GPU and CPU instance cost across providers.", rel: 0 },
      { id: "q2b", title: "Bounding agent loops: budgets and timeouts", snippet: "Set a per-run budget on wall-clock, tokens, and tool-call count; add abort timeouts on external calls so one hung provider can't stall a lane.", rel: 2 },
      { id: "q2c", title: "Marathon pacing tips for a long run", snippet: "How to pace yourself over a long-running race.", rel: 0 },
      { id: "q2d", title: "Deterministic fallback for slow providers", snippet: "Cache repeated lookups and fall back to a deterministic answer when a provider is slow, to cap latency and cost.", rel: 2 },
      { id: "q2e", title: "Loop quilting patterns", snippet: "Decorative quilting loop techniques for beginners.", rel: 0 },
      { id: "q2f", title: "Track cost per answer in observability", snippet: "Emit cost-per-answer so regressions are visible on a dashboard.", rel: 1 },
    ],
  },
  {
    query: "Anthropic latest funding round and valuation",
    candidates: [
      { id: "q3a", title: "Anthropic office locations", snippet: "Anthropic has offices in San Francisco and London.", rel: 0 },
      { id: "q3b", title: "Anthropic raises new round at higher valuation", snippet: "Anthropic closed a multi-billion dollar funding round led by major investors, raising its valuation substantially.", rel: 2 },
      { id: "q3c", title: "Anthropic model release notes", snippet: "Changelog for the latest Claude model family.", rel: 1 },
      { id: "q3d", title: "Funding 101: how venture rounds work", snippet: "A general explainer of seed, Series A, and later rounds.", rel: 0 },
      { id: "q3e", title: "Investor letter mentions Anthropic stake", snippet: "A backer's quarterly letter notes its position and the round's terms in Anthropic.", rel: 2 },
    ],
  },
  {
    query: "Key risks and challenges facing OpenAI",
    candidates: [
      { id: "q4a", title: "OpenAI office dog policy", snippet: "Pets are welcome on Fridays.", rel: 0 },
      { id: "q4b", title: "OpenAI governance and litigation risks", snippet: "Ongoing legal disputes, governance questions, and regulatory scrutiny pose challenges for OpenAI.", rel: 2 },
      { id: "q4c", title: "OpenAI compute and margin pressure", snippet: "Heavy compute spend creates margin and cost-structure risk.", rel: 2 },
      { id: "q4d", title: "Risk management for hikers", snippet: "How to assess challenges and risks on a mountain trail.", rel: 0 },
      { id: "q4e", title: "OpenAI product roadmap rumor", snippet: "Speculation about upcoming features.", rel: 1 },
    ],
  },
  {
    query: "How does Shopify compare to BigCommerce for enterprise?",
    candidates: [
      { id: "q5a", title: "Shopify vs BigCommerce: enterprise feature comparison", snippet: "Side-by-side of enterprise pricing, APIs, headless support, and SLAs for Shopify Plus vs BigCommerce Enterprise.", rel: 2 },
      { id: "q5b", title: "Shopify holiday sales numbers", snippet: "GMV during the holiday weekend.", rel: 1 },
      { id: "q5c", title: "Comparing apples to oranges", snippet: "An idiom explainer about comparisons.", rel: 0 },
      { id: "q5d", title: "BigCommerce headless commerce guide", snippet: "How BigCommerce supports headless storefronts at enterprise scale.", rel: 1 },
      { id: "q5e", title: "Enterprise software buying checklist", snippet: "Generic checklist for evaluating enterprise vendors.", rel: 0 },
    ],
  },
  {
    query: "What changed in the codebase this week that I should know about?",
    candidates: [
      { id: "q6a", title: "Weekly change digest: rate limits + rerank shipped", snippet: "This week: public-mutation rate limits landed, /ask timeout added, and tri-search rerank wired into the answer path.", rel: 2 },
      { id: "q6b", title: "Weekly team lunch menu", snippet: "Tuesday is taco day.", rel: 0 },
      { id: "q6c", title: "Changelog: UI polish (Esc, skeleton, contrast)", snippet: "Live Assist closes on Esc; connecting skeleton; AA contrast.", rel: 2 },
      { id: "q6d", title: "How to change a tire", snippet: "Step-by-step weekly car maintenance.", rel: 0 },
      { id: "q6e", title: "Open PRs awaiting review", snippet: "List of PRs that changed this week and need review.", rel: 1 },
    ],
  },
  {
    query: "Give me an agent handoff packet for the diligence on Acme AI",
    candidates: [
      { id: "q7a", title: "Acme AI diligence packet: founders, funding, product, risks", snippet: "Structured handoff: founder backgrounds, last round, product traction, and the two open diligence flags.", rel: 2 },
      { id: "q7b", title: "Acme hardware product manual", snippet: "Acme Inc. (unrelated hardware co) user manual.", rel: 0 },
      { id: "q7c", title: "What is a handoff in American football", snippet: "Rules explainer for the handoff play.", rel: 0 },
      { id: "q7d", title: "Acme AI hiring signals", snippet: "Open roles and recent senior hires at Acme AI.", rel: 1 },
      { id: "q7e", title: "Generic agent prompt templates", snippet: "Reusable prompt scaffolds for agents.", rel: 0 },
    ],
  },
  {
    query: "Are we ready to pitch Sequoia?",
    candidates: [
      { id: "q8a", title: "Sequoia pitch readiness: metrics, narrative, gaps", snippet: "What Sequoia looks for at this stage, our current metrics vs the bar, and the two narrative gaps to close before pitching.", rel: 2 },
      { id: "q8b", title: "Giant sequoia tree facts", snippet: "The sequoia is among the largest trees on earth.", rel: 0 },
      { id: "q8c", title: "Fundraising deck design tips", snippet: "General advice on slide design for pitch decks.", rel: 1 },
      { id: "q8d", title: "Sequoia portfolio companies list", snippet: "Companies Sequoia has backed.", rel: 1 },
      { id: "q8e", title: "How to pitch a tent", snippet: "Camping setup instructions.", rel: 0 },
    ],
  },
];

// --- Lexical baseline: token-overlap score (faithful keyword-retrieval simulation). ---
const tokenize = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
function lexicalScore(query: string, text: string): number {
  const q = new Set(tokenize(query));
  let overlap = 0;
  for (const t of tokenize(text)) if (q.has(t)) overlap++;
  return overlap;
}

// --- IR metrics over an ordered list of relevance grades ---
function dcg(grades: number[], k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, grades.length); i++) s += (Math.pow(2, grades[i]) - 1) / Math.log2(i + 2);
  return s;
}
function ndcgAt(orderedGrades: number[], allGrades: number[], k: number): number {
  const ideal = [...allGrades].sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  return idcg === 0 ? 0 : dcg(orderedGrades, k) / idcg;
}
function mrr(orderedGrades: number[]): number {
  for (let i = 0; i < orderedGrades.length; i++) if (orderedGrades[i] >= 1) return 1 / (i + 1);
  return 0;
}
function precisionAt(orderedGrades: number[], k: number): number {
  const top = orderedGrades.slice(0, k);
  return top.filter((g) => g >= 1).length / Math.min(k, orderedGrades.length || 1);
}
function recallAt(orderedGrades: number[], allGrades: number[], k: number): number {
  const totalRel = allGrades.filter((g) => g >= 1).length;
  if (totalRel === 0) return 0;
  return orderedGrades.slice(0, k).filter((g) => g >= 1).length / totalRel;
}

type MetricSet = { ndcg5: number; mrr: number; p5: number; recall5: number };
function metricsFor(orderedGrades: number[], allGrades: number[]): MetricSet {
  return {
    ndcg5: ndcgAt(orderedGrades, allGrades, 5),
    mrr: mrr(orderedGrades),
    p5: precisionAt(orderedGrades, 5),
    recall5: recallAt(orderedGrades, allGrades, 5),
  };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function main() {
  const key = loadEnvKey("GEMINI_API_KEY");
  if (!key) {
    console.error("GEMINI_API_KEY not found in env or .env.local — cannot run live rerank eval.");
    process.exit(2);
  }
  console.log(`Tri-search rerank eval — ${CORPUS.length} queries, baseline=lexical(token-overlap), rerank=Gemini Flash-Lite\n`);

  const perQuery: Array<{ query: string; base: MetricSet; rerank: MetricSet; status: string; winNdcg: "win" | "loss" | "tie" }> = [];

  for (const item of CORPUS) {
    const grades: Record<string, number> = {};
    for (const c of item.candidates) grades[c.id] = c.rel;
    const allGrades = item.candidates.map((c) => c.rel);

    // BASELINE: rank by lexical token-overlap (desc), stable by original index on tie.
    const baselineOrder = item.candidates
      .map((c, i) => ({ c, score: lexicalScore(item.query, `${c.title} ${c.snippet}`), i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.c);
    const baseGrades = baselineOrder.map((c) => grades[c.id]);

    // TRI-SEARCH: rerank the baseline order with Gemini.
    const candidates: TriCandidate[] = baselineOrder.map((c) => ({ id: c.id, title: c.title, snippet: c.snippet, source: "corpus" }));
    const rr = await rerankWithGemini(item.query, candidates, { topN: candidates.length });
    // completeness: reranked ids first, then any omitted in baseline order
    const seen = new Set(rr.ranked.map((c) => c.id));
    const rerankIds = [...rr.ranked.map((c) => c.id), ...baselineOrder.map((c) => c.id).filter((id) => !seen.has(id))];
    const rerankGrades = rerankIds.map((id) => grades[id]);

    const base = metricsFor(baseGrades, allGrades);
    const rerank = metricsFor(rerankGrades, allGrades);
    const winNdcg = rerank.ndcg5 > base.ndcg5 + 1e-9 ? "win" : rerank.ndcg5 < base.ndcg5 - 1e-9 ? "loss" : "tie";
    perQuery.push({ query: item.query, base, rerank, status: rr.rerankStatus, winNdcg });
    console.log(`${winNdcg === "win" ? "▲" : winNdcg === "loss" ? "▼" : "="} NDCG@5 ${r3(base.ndcg5)} → ${r3(rerank.ndcg5)}  [${rr.rerankStatus}]  ${item.query.slice(0, 60)}`);
  }

  const agg = (sel: (m: MetricSet) => number) => ({ base: r3(mean(perQuery.map((p) => sel(p.base)))), rerank: r3(mean(perQuery.map((p) => sel(p.rerank)))) });
  const summary = {
    queries: perQuery.length,
    wins: perQuery.filter((p) => p.winNdcg === "win").length,
    losses: perQuery.filter((p) => p.winNdcg === "loss").length,
    ties: perQuery.filter((p) => p.winNdcg === "tie").length,
    metrics: { ndcg5: agg((m) => m.ndcg5), mrr: agg((m) => m.mrr), p5: agg((m) => m.p5), recall5: agg((m) => m.recall5) },
  };

  console.log("\n=== AGGREGATE (baseline lexical → tri-search rerank) ===");
  for (const [name, v] of Object.entries(summary.metrics)) {
    const lift = r3(v.rerank - v.base);
    const pct = v.base > 0 ? `${r3(((v.rerank - v.base) / v.base) * 100)}%` : "n/a";
    console.log(`  ${name.padEnd(8)} ${String(v.base).padEnd(6)} → ${String(v.rerank).padEnd(6)}  lift ${lift >= 0 ? "+" : ""}${lift} (${pct})`);
  }
  console.log(`  win/loss/tie by NDCG@5: ${summary.wins}/${summary.losses}/${summary.ties}`);

  const outDir = resolve(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(outDir, `triSearch-rerank-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), summary, perQuery }, null, 2));
  console.log(`\nSaved: ${outPath.replace(ROOT, ".")}`);

  // Honest verdict — the proof, stated plainly.
  const ndcgLift = summary.metrics.ndcg5.rerank - summary.metrics.ndcg5.base;
  console.log(`\nVERDICT: tri-search rerank ${ndcgLift > 0.01 ? "MEASURABLY IMPROVES" : ndcgLift < -0.01 ? "REGRESSES" : "is roughly NEUTRAL on"} ranking vs lexical baseline (NDCG@5 ${ndcgLift >= 0 ? "+" : ""}${r3(ndcgLift)}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
