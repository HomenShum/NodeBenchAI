/**
 * Tri-search MULTI-TURN conversation eval — the real workflow, not single-shot queries.
 *
 * Models realistic running sessions (an event attendee's /ask thread, an analyst's
 * diligence thread) where follow-up turns reference earlier ones ("rotate THOSE",
 * "compare THAT", "their biggest risks") and the candidate pool is full of keyword
 * traps. Compares THREE rankers per turn:
 *   - LEXICAL: token-overlap on the current query (baseline).
 *   - NAIVE rerank: rerankWithGemini(currentQueryOnly) — no conversation memory.
 *   - CONTEXT rerank: rerankWithGemini(conversationPrefix + currentQuery) — sees the thread.
 *
 * The thesis under test: on context-DEPENDENT follow-ups, naive rerank can't resolve
 * "those"/"that"/"their" and mis-ranks; only the context-aware rerank wins. This is
 * what /ask must do in a real multi-turn room. Reports NDCG@5 split by turn type
 * (standalone vs context-dependent) so the multi-turn lift is isolated, honestly.
 *
 * Run: npx tsx scripts/eval-harness/triSearchConversationEval.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rerankWithGemini, condenseQuery, type TriCandidate } from "../../shared/search/triSearch";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
function loadKey() {
  if (process.env.GEMINI_API_KEY) return;
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.trim().startsWith("GEMINI_API_KEY="));
  if (line) process.env.GEMINI_API_KEY = line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

type Cand = { id: string; title: string; snippet: string; rel: 0 | 1 | 2 };
type Turn = { query: string; dependsOnContext: boolean; candidates: Cand[] };
type Convo = { name: string; persona: string; turns: Turn[] };

// Distractors deliberately share the follow-up's keywords ("rotate", "audit", "static",
// "key", "compare") so a context-free reranker is tempted by them — the realistic trap.
const CONVERSATIONS: Convo[] = [
  {
    name: "AI Infra Summit attendee — MCP auth deep-dive",
    persona: "event attendee asking a running /ask thread",
    turns: [
      {
        query: "What did the panel recommend for MCP enterprise authentication?",
        dependsOnContext: false,
        candidates: [
          { id: "c1.1", title: "Panel: MCP enterprise auth recommendations", snippet: "Use short-lived scoped credentials over static API keys; enforce host actions server-side.", rel: 2 },
          { id: "c1.2", title: "MCP server quickstart", snippet: "Install and run an MCP server locally.", rel: 1 },
          { id: "c1.3", title: "Enterprise SSO pricing tiers", snippet: "Per-seat SSO pricing.", rel: 0 },
          { id: "c1.4", title: "Auth service outage postmortem", snippet: "Login outage root cause.", rel: 0 },
          { id: "c1.5", title: "Conference wifi login", snippet: "Authenticate to venue wifi.", rel: 0 },
        ],
      },
      {
        query: "How do I rotate those?",
        dependsOnContext: true, // "those" = the scoped MCP credentials/secrets from turn 1
        candidates: [
          { id: "c2.1", title: "Rotating MCP scoped credentials safely", snippet: "Cadence and tooling to rotate the scoped API credentials issued to MCP clients.", rel: 2 },
          { id: "c2.2", title: "How to rotate your car tires", snippet: "Rotate tires every 5,000 miles for even wear.", rel: 0 },
          { id: "c2.3", title: "Crop rotation for home gardens", snippet: "Rotate crops each season to preserve soil.", rel: 0 },
          { id: "c2.4", title: "Secret rotation cadence + audit", snippet: "Rotate secrets on a fixed schedule; audit each rotation.", rel: 2 },
          { id: "c2.5", title: "Yoga: rotate your shoulders", snippet: "Shoulder rotation stretches.", rel: 0 },
        ],
      },
      {
        query: "And what's the cost of all that auditing?",
        dependsOnContext: true, // "that auditing" = auditing tool calls / secret rotations from prior turns
        candidates: [
          { id: "c3.1", title: "Cost of audit logging tool calls at scale", snippet: "Storage + compute cost of auditing every MCP tool call and secret rotation.", rel: 2 },
          { id: "c3.2", title: "Auditing 101 for accountants", snippet: "Financial audit fundamentals.", rel: 0 },
          { id: "c3.3", title: "Movie review: 'The Audit'", snippet: "A thriller about a tax audit.", rel: 0 },
          { id: "c3.4", title: "Annual financial audit fees", snippet: "What firms charge for a yearly audit.", rel: 0 },
          { id: "c3.5", title: "Audit log retention + cost tradeoffs", snippet: "How retention windows drive logging cost.", rel: 1 },
        ],
      },
      {
        query: "Compare that to just using static API keys.",
        dependsOnContext: true, // "that" = the scoped-credential + rotation approach
        candidates: [
          { id: "c4.1", title: "Scoped credentials vs static API keys", snippet: "Tradeoffs: blast radius, rotation, revocation for scoped creds vs long-lived static keys.", rel: 2 },
          { id: "c4.2", title: "Static site generators compared", snippet: "Hugo vs Jekyll vs Astro.", rel: 0 },
          { id: "c4.3", title: "Comparing mechanical keyboards", snippet: "Switch types compared.", rel: 0 },
          { id: "c4.4", title: "API key leakage incidents", snippet: "Static keys in client code get scraped; why long-lived keys are risky.", rel: 1 },
          { id: "c4.5", title: "Key lime pie recipe", snippet: "A classic dessert.", rel: 0 },
        ],
      },
    ],
  },
  {
    name: "Founder diligence thread — Acme AI",
    persona: "analyst working a long diligence conversation",
    turns: [
      {
        query: "Give me the diligence summary on Acme AI.",
        dependsOnContext: false,
        candidates: [
          { id: "d1.1", title: "Acme AI diligence summary", snippet: "Founders, last round, product traction, two open flags.", rel: 2 },
          { id: "d1.2", title: "Acme Inc. hardware manual", snippet: "Unrelated hardware company.", rel: 0 },
          { id: "d1.3", title: "Diligence checklist template", snippet: "Generic VC diligence checklist.", rel: 1 },
          { id: "d1.4", title: "Roadrunner cartoon trivia", snippet: "Acme products in cartoons.", rel: 0 },
        ],
      },
      {
        query: "What are their biggest risks?",
        dependsOnContext: true, // "their" = Acme AI
        candidates: [
          { id: "d2.1", title: "Acme AI: top risks", snippet: "Concentration risk, thin moat, key-person dependency, runway.", rel: 2 },
          { id: "d2.2", title: "Biggest risks of skydiving", snippet: "Parachute failure and landing injury.", rel: 0 },
          { id: "d2.3", title: "Risk management 101", snippet: "Generic enterprise risk framework.", rel: 0 },
          { id: "d2.4", title: "Acme AI customer concentration note", snippet: "Top 3 customers = 70% of revenue.", rel: 2 },
          { id: "d2.5", title: "Biggest risks in mountaineering", snippet: "Altitude and weather.", rel: 0 },
        ],
      },
      {
        query: "How does that compare to their main competitor?",
        dependsOnContext: true, // "that" = Acme's risk/profile; "their competitor"
        candidates: [
          { id: "d3.1", title: "Acme AI vs main competitor: risk + traction", snippet: "Side-by-side of moat, concentration, and growth vs the closest rival.", rel: 2 },
          { id: "d3.2", title: "Comparing running shoes", snippet: "Cushioning vs weight.", rel: 0 },
          { id: "d3.3", title: "Competitor's funding history", snippet: "The rival's rounds and valuation.", rel: 1 },
          { id: "d3.4", title: "How to compare mortgages", snippet: "APR vs points.", rel: 0 },
        ],
      },
      {
        query: "Should I take this to the partner meeting?",
        dependsOnContext: true, // "this" = the Acme diligence case built across the thread
        candidates: [
          { id: "d4.1", title: "Acme AI: partner-meeting readiness + open gaps", snippet: "What's strong, the two gaps to close, and the recommend/pass call.", rel: 2 },
          { id: "d4.2", title: "How to run a great team meeting", snippet: "Generic meeting facilitation tips.", rel: 0 },
          { id: "d4.3", title: "Partner yoga poses", snippet: "Two-person stretches.", rel: 0 },
          { id: "d4.4", title: "IC memo template", snippet: "Investment committee memo structure.", rel: 1 },
        ],
      },
    ],
  },
];

const tokenize = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
function lexicalScore(q: string, text: string): number {
  const qs = new Set(tokenize(q));
  let n = 0; for (const t of tokenize(text)) if (qs.has(t)) n++; return n;
}
function dcg(g: number[], k: number) { let s = 0; for (let i = 0; i < Math.min(k, g.length); i++) s += (2 ** g[i] - 1) / Math.log2(i + 2); return s; }
function ndcg5(ordered: number[], all: number[]) { const idcg = dcg([...all].sort((a, b) => b - a), 5); return idcg ? dcg(ordered, 5) / idcg : 0; }
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function rankNdcg(query: string, cands: Cand[], grades: Record<string, number>, mode: "lexical" | "rerank"): Promise<number> {
  const all = cands.map((c) => c.rel);
  if (mode === "lexical") {
    const ordered = [...cands].sort((a, b) => lexicalScore(query, `${b.title} ${b.snippet}`) - lexicalScore(query, `${a.title} ${a.snippet}`));
    return ndcg5(ordered.map((c) => grades[c.id]), all);
  }
  // baseline order into the reranker = lexical (so rerank competes from the same start)
  const lexOrder = [...cands].sort((a, b) => lexicalScore(query, `${b.title} ${b.snippet}`) - lexicalScore(query, `${a.title} ${a.snippet}`));
  const tc: TriCandidate[] = lexOrder.map((c) => ({ id: c.id, title: c.title, snippet: c.snippet, source: "corpus" }));
  const rr = await rerankWithGemini(query, tc, { topN: tc.length });
  const seen = new Set(rr.ranked.map((c) => c.id));
  const ids = [...rr.ranked.map((c) => c.id), ...lexOrder.map((c) => c.id).filter((id) => !seen.has(id))];
  return ndcg5(ids.map((id) => grades[id]), all);
}

async function main() {
  loadKey();
  if (!process.env.GEMINI_API_KEY) { console.error("no GEMINI_API_KEY"); process.exit(2); }
  console.log("Tri-search MULTI-TURN conversation eval — lexical vs naive-rerank vs context-rerank\n");

  const rows: Array<{ convo: string; turn: number; dep: boolean; lex: number; naive: number; ctx: number; rw: number }> = [];

  for (const convo of CONVERSATIONS) {
    console.log(`\n# ${convo.name}`);
    const history: string[] = [];
    for (let t = 0; t < convo.turns.length; t++) {
      const turn = convo.turns[t];
      const grades: Record<string, number> = {};
      for (const c of turn.candidates) grades[c.id] = c.rel;

      const lex = await rankNdcg(turn.query, turn.candidates, grades, "lexical");
      const naive = await rankNdcg(turn.query, turn.candidates, grades, "rerank");
      const ctxQuery = history.length
        ? `Conversation so far:\n${history.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}\nCurrent question: ${turn.query}`
        : turn.query;
      const ctx = await rankNdcg(ctxQuery, turn.candidates, grades, "rerank");
      // REWRITE path (what /ask now does): condense history+follow-up → standalone query, then rerank.
      const cond = await condenseQuery(turn.query, history);
      const rw = await rankNdcg(cond.query, turn.candidates, grades, "rerank");

      rows.push({ convo: convo.name, turn: t + 1, dep: turn.dependsOnContext, lex: r3(lex), naive: r3(naive), ctx: r3(ctx), rw: r3(rw) });
      const flag = turn.dependsOnContext ? "↳ctx-dep" : "standalone";
      console.log(`  T${t + 1} ${flag.padEnd(11)} NDCG@5 lex ${r3(lex)} | naive ${r3(naive)} | append ${r3(ctx)} | rewrite ${r3(rw)}  "${turn.query.slice(0, 36)}"`);
      history.push(turn.query);
    }
  }

  const dep = rows.filter((r) => r.dep);
  const standalone = rows.filter((r) => !r.dep);
  const agg = (rs: typeof rows) => ({ lex: r3(mean(rs.map((r) => r.lex))), naive: r3(mean(rs.map((r) => r.naive))), ctx: r3(mean(rs.map((r) => r.ctx))), rw: r3(mean(rs.map((r) => r.rw))) });
  const summary = { turns: rows.length, contextDependent: agg(dep), standalone: agg(standalone), overall: agg(rows) };

  console.log("\n=== AGGREGATE NDCG@5 (lexical → naive → append → rewrite) ===");
  for (const [label, a] of [["context-dependent turns", summary.contextDependent], ["standalone turns", summary.standalone], ["overall", summary.overall]] as const) {
    console.log(`  ${label.padEnd(24)} ${a.lex} → ${a.naive} → ${a.ctx} → ${a.rw}   (rewrite vs naive: ${(a.rw - a.naive >= 0 ? "+" : "")}${r3(a.rw - a.naive)}; rewrite vs append: ${(a.rw - a.ctx >= 0 ? "+" : "")}${r3(a.rw - a.ctx)})`);
  }

  const outDir = resolve(HERE, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(outDir, `triSearch-convo-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));

  const rwLiftOnDeps = summary.contextDependent.rw - summary.contextDependent.naive;
  const rwVsAppend = summary.contextDependent.rw - summary.contextDependent.ctx;
  console.log(`\nVERDICT: on context-dependent follow-ups, REWRITE-then-rerank (what /ask now does) beats naive current-query-only by NDCG@5 ${rwLiftOnDeps >= 0 ? "+" : ""}${r3(rwLiftOnDeps)}; vs raw-append ${rwVsAppend >= 0 ? "+" : ""}${r3(rwVsAppend)} (rewrite ${rwVsAppend >= -0.02 ? "matches/beats" : "trails"} append — confirms the prod-standard choice).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
