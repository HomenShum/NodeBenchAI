/**
 * Deep Diligence Search — Tree-skeleton fanned-out chain architecture.
 *
 * Instead of one shallow pass, this fans out into 6 parallel research branches,
 * each of which chains deeper based on what it finds. The tree self-terminates
 * when branches reach sufficient depth or exhaust their sources.
 *
 * Architecture:
 *   Root: Entity Resolution (who/what is this?)
 *     ├── Branch 1: People & Leadership (founders → backgrounds → board → advisors)
 *     ├── Branch 2: Company History & Timeline (founding → milestones → pivots → current)
 *     ├── Branch 3: Financials & Metrics (revenue → margins → funding → unit economics)
 *     ├── Branch 4: Market & Competitive (TAM → competitors → positioning → win/loss)
 *     ├── Branch 5: Products & Technology (offerings → tech stack → IP → roadmap)
 *     └── Branch 6: Risks & Diligence Flags (key-person → concentration → regulatory → litigation)
 *
 * Each branch:
 *   1. Searches for its domain (Linkup + Gemini grounding)
 *   2. Extracts structured findings
 *   3. Identifies follow-up queries based on gaps
 *   4. Chains deeper (up to 3 levels) until sufficient or exhausted
 *
 * All branches run in parallel. Results merge into a single diligence packet.
 * Total budget: 10 minutes (Convex action limit). Typical: 30-90 seconds.
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  buildClassificationPrompt,
  collapseSignals,
  generateFollowUpQuestions,
  type ClassifiedSignal,
} from "./signalTaxonomy.js";
import { buildSearchForecastGate } from "./searchForecastGate.js";
import { searchWithFallback, GEMINI_API_URL } from "./linkupClient.js";

// ── Types ────────────────────────────────────────────────────────────────

interface BranchResult {
  branch: string;
  findings: Array<{ title: string; body: string; confidence: number; sources: string[] }>;
  gaps: string[];
  depth: number;
  searchCount: number;
}

interface DiligencePacket {
  entityName: string;
  entityType: string;
  confidence: number;
  people: BranchResult;
  history: BranchResult;
  financials: BranchResult;
  market: BranchResult;
  products: BranchResult;
  risks: BranchResult;
  synthesis: {
    answer: string;
    keyMetrics: Array<{ label: string; value: string }>;
    comparables: string[];
    nextActions: Array<{ action: string }>;
    nextQuestions: string[];
    diligenceGrade: string;
    totalSources: number;
    totalFindings: number;
  };
}

// ── Branch Definitions ───────────────────────────────────────────────────

const BRANCHES = [
  {
    id: "people",
    label: "People & Leadership",
    initialQuery: (entity: string) =>
      `"${entity}" founders CEO leadership team executives board members advisors backgrounds`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on what we know about ${entity}'s leadership: ${priorFindings}\n\nSearch for: LinkedIn profiles, prior companies, education, notable achievements, board composition, advisor network. What key people are we still missing?`,
    extractPrompt: (entity: string) =>
      `Extract all people associated with "${entity}". For each person: name, title/role, background (prior companies, education), LinkedIn URL if available, whether they are founder/executive/board/advisor. Return JSON array.`,
  },
  {
    id: "history",
    label: "Company History & Timeline",
    initialQuery: (entity: string) =>
      `"${entity}" founded history company timeline milestones funding rounds pivots ${new Date().getFullYear()}`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on ${entity}'s known history: ${priorFindings}\n\nSearch for: founding story, key pivots, product launches, partnerships, acquisitions, office expansions, headcount changes by quarter/year. Fill timeline gaps.`,
    extractPrompt: (entity: string) =>
      `Build a complete timeline for "${entity}". For each event: date (YYYY-MM or YYYY-Q#), event description, significance, source. Include: founding, funding rounds, product launches, pivots, key hires, partnerships, acquisitions. Return JSON array sorted by date.`,
  },
  {
    id: "financials",
    label: "Financials & Metrics",
    initialQuery: (entity: string) =>
      `"${entity}" revenue funding valuation growth rate ARR MRR margins burn rate runway ${new Date().getFullYear()}`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on ${entity}'s known financials: ${priorFindings}\n\nSearch for: revenue trajectory, unit economics (CAC/LTV/payback), gross margins, operating margins, funding rounds with amounts and investors, current valuation, burn rate, runway. Identify which numbers are verified vs estimated.`,
    extractPrompt: (entity: string) =>
      `Extract all financial data for "${entity}". For each metric: metric name, value, period, source, confidence (verified/estimated/rumored). Include: revenue, growth rate, valuation, funding raised, investors, margins, headcount, burn. Return JSON.`,
  },
  {
    id: "market",
    label: "Market & Competitive",
    initialQuery: (entity: string) =>
      `"${entity}" competitors market share competitive landscape TAM industry analysis ${new Date().getFullYear()}`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on ${entity}'s known competitive position: ${priorFindings}\n\nSearch for: direct competitors with revenue/funding comparisons, market share estimates, customer overlap, pricing comparisons, win/loss signals, industry analyst reports. Who is winning deals against them and why?`,
    extractPrompt: (entity: string) =>
      `Map the competitive landscape for "${entity}". For each competitor: name, estimated revenue/size, overlap areas, key differentiators, relative positioning (stronger/weaker/comparable). Also: TAM estimate, market growth rate, ${entity}'s estimated market share. Return JSON.`,
  },
  {
    id: "products",
    label: "Products & Technology",
    initialQuery: (entity: string) =>
      `"${entity}" products services technology stack platform capabilities pricing customers ${new Date().getFullYear()}`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on ${entity}'s known products: ${priorFindings}\n\nSearch for: detailed product features, pricing tiers, technology architecture, patents/IP, customer case studies, G2/Capterra reviews, integration ecosystem, product roadmap signals.`,
    extractPrompt: (entity: string) =>
      `Extract product intelligence for "${entity}". For each product: name, description, target customer, pricing (if available), key features, technology stack, customer logos/case studies. Also: overall platform strategy, IP/patents, developer ecosystem. Return JSON.`,
  },
  {
    id: "risks",
    label: "Risks & Diligence Flags",
    initialQuery: (entity: string) =>
      `"${entity}" risks lawsuits regulatory issues controversy concerns layoffs problems ${new Date().getFullYear()}`,
    followUpPrompt: (entity: string, priorFindings: string) =>
      `Based on known risks for ${entity}: ${priorFindings}\n\nSearch for: key-person dependency, customer concentration, regulatory exposure, pending litigation, negative press, employee reviews (Glassdoor), churn signals, technology debt, security incidents. What could kill this company?`,
    extractPrompt: (entity: string) =>
      `Identify all diligence flags for "${entity}". For each risk: category (key-person/concentration/regulatory/litigation/reputation/technology/financial), description, severity (critical/high/medium/low), evidence, mitigation if any. Return JSON.`,
  },
] as const;

const MAX_CHAIN_DEPTH = 3;

// ── Self-Search Detection ────────────────────────────────────────────────

const SELF_ENTITY_ALIASES = [
  "nodebench", "nodebench ai", "nodebenchai", "node bench",
  "nodebench-mcp", "nodebench mcp", "homen shum", "homenshum",
];

function isSelfSearch(query: string): boolean {
  const lq = query.toLowerCase().trim();
  return SELF_ENTITY_ALIASES.some((alias) => lq.includes(alias));
}

/**
 * Ground truth about NodeBench AI — injected as the primary source when
 * the user searches for themselves. This ensures the deep diligence pipeline
 * returns real product intelligence instead of web confusion.
 */
function getSelfSearchContext(): string {
  return `
# NodeBench AI — Company Ground Truth

## Identity
- **Full name**: NodeBench AI (dba NodeBench, Inc.)
- **Entity type**: Delaware C-Corp (active)
- **Founded**: 2024
- **Headquarters**: San Jose, California, USA
- **Website**: https://www.nodebenchai.com
- **Product**: Entity intelligence and operating memory for agent-native businesses
- **Tagline**: "Entity Intelligence for Any Company, Market, or Question"

## Founder
- **Homen Shum** — Founder & CEO
  - Background: Banking/finance (middle market, business banking) + data engineering + agentic AI
  - Prior: Capital One, banking analytics, financial data pipelines
  - GitHub: github.com/HomenShum
  - Skills: Builder-analyst hybrid — systems thinking, eval, reliability, tool orchestration

## Product
- **NodeBench AI App** (nodebenchai.com): Search-first entity intelligence workspace
  - 6 role lenses: Founder, Investor, Banker, CEO, Legal, Student
  - 5 surfaces: Ask, Workspace, Packets, History, System
  - Deep diligence: 6-branch parallel research (people, timeline, financials, market, products, risks)
  - Before/during/after founder episode tracking
  - Subconscious memory: 12 typed blocks for company truth persistence
  - Knowledge graph: entity + relationship traversal for contradiction detection

- **NodeBench MCP Server** (npm: nodebench-mcp, v2.70.0):
  - 350+ MCP tools across 57 domains
  - Progressive discovery: starts with 15 tools, expands as needed
  - Persona presets: starter (15), founder, banker, operator, researcher, full (350+)
  - CLI subcommands: discover, setup, workflow, quickref, call, demo
  - Local-first: SQLite at ~/.nodebench/, zero cloud dependency for MCP
  - Install: npx nodebench-mcp or npm install -g nodebench-mcp

## Technology Stack
- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Convex (realtime database + serverless functions + durable workflows)
- **MCP Server**: Node.js + TypeScript + better-sqlite3
- **Search**: Linkup API + Gemini 3.1 extraction + 4-layer grounding pipeline
- **Design**: Glass card DNA, warm terracotta #d97757, Manrope + JetBrains Mono
- **Infra**: Vercel (frontend), Convex Cloud (backend), npm registry (MCP package)

## Market Position
- **Category**: Entity intelligence / operating memory for founders and agents
- **Wedge**: Hidden diligence requirements that VCs, banks, and accelerators never share
- **Differentiator**: Local-first MCP + company truth packets + contradiction detection
- **Comparables**: Perplexity (search UX), Bloomberg (data density), Linear (speed), Crunchbase (entity profiles)
- **Adjacent competitors**: Supermemory (memory infra), Paperclip (runtime orchestration), DeerFlow (research harness), Crucix (monitoring)
- **Not competing with**: Lindy (workflow automation), Google Opal (mini-app builder), Obvious AI (artifact workspace)

## Business Model
- **Open core**: MCP server is open source, AI app is closed source
- **Pricing**: Free tier → Pro ($29-49/mo) → Team ($99-199/seat) → Enterprise
- **Distribution**: npm registry, MCP protocol, Claude Code/Cursor integration
- **Stage**: Pre-revenue, bootstrapped, building toward product-market fit

## Key Metrics (as of April 2026)
- npm package: nodebench-mcp v2.70.0
- MCP tools: 350+ across 57 domains
- Test coverage: 1510+ tests
- Convex tables: 50+ domain tables
- GitHub: github.com/HomenShum/nodebench-ai

## Timeline
- 2024 Q3: Founded NodeBench, Inc. (Delaware C-Corp)
- 2024 Q4: First MCP server release (75 tools)
- 2025 Q1: Expanded to 200+ tools, added embedding search
- 2025 Q2: Added deep sim tools, agent harness, WebSocket gateway
- 2025 Q3: 300+ tools, founder platform, 5-surface cockpit
- 2026 Q1: Search-first AI app, Convex backend, 6 role lenses
- 2026 Q2: Deep diligence pipeline, subconscious memory, knowledge graph
- 2026 Q2: Deep diligence pipeline (6-branch, depth-3 chaining), subconscious memory (12 blocks), knowledge graph
- 2026 Q2: Claude Code plugin with autonomous nudge hooks (PostToolUse + Stop gate)
- 2026 Q2: Codex bridge for remediation delegation
- 2026 Q2: Self-search enrichment — product can diligence itself
- 2026 Q2: SEO fixes — JSON-LD structured data, /about page, brand disambiguation to "NodeBench AI"
- 2026 Q2: Production at nodebenchai.com, 350+ tools, Gemini 3.1 integration

## SEO & Public Presence (current state)
- JSON-LD structured data: DEPLOYED (Organization + SoftwareApplication + WebSite schemas)
- /about page: DEPLOYED at nodebenchai.com/about (founder bio, tech stack, quick start)
- Brand: disambiguated to "NodeBench AI" in title, OG tags, Twitter cards, JSON-LD
- Canonical URL: www.nodebenchai.com (corrected from old nodebench.ai)
- Twitter cards: @nodebenchai + @homenshum creator tags
- SEO score: 70/100 (up from 50/100 before fixes)
- GitHub: github.com/HomenShum/nodebench-ai
- npm: npmjs.com/package/nodebench-mcp (v2.70.0)

## Remaining Risks & Diligence Flags
- Pre-revenue: no paying customers yet (critical — needs design partners / pilots)
- Solo founder: key-person risk (Homen Shum) — no #2 hire yet
- Discoverability: still limited organic search presence despite SEO fixes (needs blog posts, directory submissions)
- Missing presence: no Product Hunt listing, no Twitter/X activity
- Market: crowded AI tooling space, rapid commoditization of agent infrastructure
- Brand: "NodeBench" still overlaps with generic benchmarking tools in some contexts
`;
}

// ── Main Deep Diligence Action ───────────────────────────────────────────

export const executeDeepDiligence = internalAction({
  args: {
    sessionId: v.id("searchSessions"),
    query: v.string(),
    lens: v.string(),
  },
  handler: async (ctx, args) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const linkupKey = process.env.LINKUP_API_KEY;

    try {
      // ── Step 0: Entity Resolution ──────────────────────────────────
      await updateStatus(ctx, args.sessionId, "classifying", [
        { step: "entity_resolution", status: "ok", detail: "Resolving entity...", startedAt: Date.now() },
      ]);

      // Self-search detection: if searching ourselves, override entity resolution
      const selfMode = isSelfSearch(args.query);
      const resolved = selfMode
        ? { name: "NodeBench AI", type: "company" }
        : await resolveEntity(args.query, geminiKey);

      // Inject local ground truth as the first source for self-search
      const selfContext = selfMode ? getSelfSearchContext() : undefined;

      await updateStatus(ctx, args.sessionId, "searching", [
        {
          step: "entity_resolution",
          status: "ok",
          detail: `${resolved.name} (${resolved.type})${selfMode ? " [self-search: local context injected]" : ""}`,
          startedAt: Date.now(),
          durationMs: 0,
        },
      ]);

      // ── Step 1: Fan out all 6 branches in parallel ─────────────────
      const branchPromises = BRANCHES.map((branch) =>
        executeBranch(branch, resolved.name, geminiKey, linkupKey, async (trace) => {
          await updateStatus(ctx, args.sessionId, "searching", trace);
        }, selfContext),
      );

      const branchResults = await Promise.all(branchPromises);
      const resultMap: Record<string, BranchResult> = {};
      for (const r of branchResults) resultMap[r.branch] = r;

      // ── Step 2: Synthesize all branches into diligence packet ──────
      await updateStatus(ctx, args.sessionId, "synthesizing", [
        ...branchResults.flatMap((r) =>
          r.findings.map((f) => ({
            step: `branch_${r.branch}`,
            tool: "linkup_search",
            status: "ok" as const,
            detail: `${f.title} (${f.confidence}%)`,
            startedAt: Date.now(),
            durationMs: 0,
          })),
        ),
        { step: "synthesize", status: "ok", detail: "Merging all branches...", startedAt: Date.now() },
      ]);

      const synthesis = await synthesizeDiligence(resolved.name, resolved.type, args.lens, branchResults, geminiKey);

      const totalFindings = branchResults.reduce((s, r) => s + r.findings.length, 0);
      const totalSources = new Set(branchResults.flatMap((r) => r.findings.flatMap((f) => f.sources))).size;
      const totalSearches = branchResults.reduce((s, r) => s + r.searchCount, 0);
      const maxDepth = Math.max(...branchResults.map((r) => r.depth));

      // ── Step 3: Classify signals into controlled taxonomy ─────────
      let classifiedSignals: ClassifiedSignal[] = [];
      let classificationError: string | undefined;
      try {
        // Limit to top 5 findings per branch (30 max) to keep prompt under token limit
        const rawFindingsText = branchResults
          .flatMap((r) => r.findings.slice(0, 5).map((f, i) => `[src_${r.branch}_${i}] ${f.title}: ${f.body.slice(0, 200)}`))
          .join("\n")
          .slice(0, 6000); // hard cap
        const classifyPrompt = buildClassificationPrompt(resolved.name, rawFindingsText);
        if (!geminiKey) {
          classificationError = "GEMINI_API_KEY not available in action env";
        } else if (rawFindingsText.length <= 50) {
          classificationError = `rawFindingsText too short: ${rawFindingsText.length} chars`;
        }
        if (geminiKey && rawFindingsText.length > 50) {
          const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: classifyPrompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (resp.ok) {
            const data = (await resp.json()) as any;
            let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            text = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
              try {
                const parsed = JSON.parse(match[0]);
                if (Array.isArray(parsed) && parsed.length > 0) classifiedSignals = parsed;
                else classificationError = `Parsed array but length=${parsed?.length ?? 0}`;
              } catch (parseErr: unknown) {
                classificationError = `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. First 200 chars: ${match[0].slice(0, 200)}`;
              }
            } else {
              classificationError = `No JSON array found in response (${text.length} chars). First 200: ${text.slice(0, 200)}`;
            }
          } else {
            classificationError = `Gemini HTTP ${resp.status}`;
          }
        }
      } catch (classErr: unknown) {
        classificationError = classErr instanceof Error ? classErr.message : String(classErr);
      }

      // Collapse duplicates and sort by category
      classifiedSignals = collapseSignals(classifiedSignals);

      // Generate taxonomy-aware follow-up questions
      const taxonomyFollowUps = classifiedSignals.length > 0
        ? generateFollowUpQuestions(classifiedSignals, resolved.name)
        : [];

      // ── Step 4: Generate gap remediation for every risk/gap found ────
      const risks = resultMap.risks?.findings ?? [];
      const gaps = branchResults.flatMap((b) => b.gaps);
      const remediation = generateRemediation(resolved.name, risks, gaps, branchResults);

      // ── Step 5: Build the full result packet ───────────────────────
      const result = {
        success: true,
        query: args.query,
        entityName: resolved.name,
        lens: args.lens,
        packetType: "deep_diligence",
        answer: synthesis.answer,
        confidence: synthesis.confidence,
        sourceCount: totalSources,
        // Classified signals (taxonomy-controlled) — used by UI for grouped display
        classifiedSignals,
        classificationError,
        // Raw signals kept for backward compat and drill-down
        signals: branchResults.flatMap((r) =>
          r.findings.map((f) => ({ title: f.title, body: f.body, confidence: f.confidence })),
        ),
        risks: risks.map((f) => ({ title: f.title, body: f.body })),
        changes: (resultMap.history?.findings ?? []).map((f) => ({ description: f.title, detail: f.body })),
        comparables: synthesis.comparables,
        nextActions: [...synthesis.nextActions, ...remediation.topActions],
        nextQuestions: [...(taxonomyFollowUps.length > 0 ? taxonomyFollowUps : synthesis.nextQuestions)],
        sources: [...new Set(branchResults.flatMap((r) => r.findings.flatMap((f) => f.sources)))]
          .map((url, i) => ({ label: url, url, type: "web", sourceIdx: i })),
        keyMetrics: synthesis.keyMetrics,
        people: resultMap.people?.findings ?? [],
        timeline: resultMap.history?.findings ?? [],
        financialMetrics: resultMap.financials?.findings ?? [],
        competitiveLandscape: resultMap.market?.findings ?? [],
        productIntelligence: resultMap.products?.findings ?? [],
        diligenceFlags: risks,
        diligenceGrade: synthesis.diligenceGrade,
        researchDepth: { totalSearches, maxDepth, totalFindings, totalSources, branches: 6 },
        classification: "deep_diligence",
        // ── Gap Remediation Layer ──
        remediation: remediation.items,
        seoAudit: remediation.seoAudit,
        missingPresence: remediation.missingPresence,
      };
      const recentSessions = await ctx.runQuery(api.domains.search.searchPipeline.listRecentSearches, { limit: 25 });
      const forecastGate = buildSearchForecastGate({
        recentSessions,
        entityName: resolved.name,
        lens: args.lens,
        currentConfidence: synthesis.confidence,
        currentSessionId: args.sessionId,
      });
      const resultWithForecastGate = {
        ...result,
        forecastGate,
        temporalTrajectory: {
          kind: "search_session_confidence",
          streamKey: forecastGate.streamKey,
          valuesCount: forecastGate.valuesCount,
          modelUsed: forecastGate.modelUsed,
        },
      };

      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "complete",
        result: resultWithForecastGate,
        completedAt: Date.now(),
      });
    } catch (err: any) {
      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "error",
        error: err?.message ?? "Deep diligence failed",
        completedAt: Date.now(),
      });
    }
  },
});

// ── Branch Execution (chained depth) ─────────────────────────────────────

async function executeBranch(
  branch: (typeof BRANCHES)[number],
  entityName: string,
  geminiKey: string | undefined,
  linkupKey: string | undefined,
  onTrace: (trace: Array<{ step: string; tool?: string; status: string; detail?: string; startedAt: number; durationMs?: number }>) => Promise<void>,
  selfContext?: string,
): Promise<BranchResult> {
  const findings: BranchResult["findings"] = [];
  const allSources: string[] = [];
  // Seed with self-context if available — ensures branches start from ground truth
  const allSnippets: string[] = selfContext ? [selfContext] : [];
  let depth = 0;
  let searchCount = 0;
  let currentQuery = branch.initialQuery(entityName);
  let emptyDepths = 0;

  while (depth < MAX_CHAIN_DEPTH) {
    depth++;

    // Search
    const searchResult = await searchWithFallback(currentQuery, linkupKey, geminiKey);
    searchCount++;

    if (!searchResult.snippets.length) {
      emptyDepths++;
      if (emptyDepths >= 2) break; // truly exhausted after 2 empty rounds
      // Don't break on first empty — try a different angle
    }

    allSources.push(...searchResult.sources.map((s) => s.url).filter(Boolean));
    allSnippets.push(...searchResult.snippets);

    // Extract structured findings using ALL accumulated snippets for richer context
    const extracted = await extractFindings(
      entityName,
      branch.extractPrompt(entityName),
      allSnippets,
      geminiKey,
    );

    for (const f of extracted) {
      f.sources = searchResult.sources.map((s) => s.url).filter(Boolean);
      findings.push(f);
    }

    await onTrace([{
      step: `branch_${branch.id}_depth${depth}`,
      tool: "linkup_search",
      status: "ok",
      detail: `${extracted.length} findings at depth ${depth}`,
      startedAt: Date.now(),
      durationMs: 0,
    }]);

    // Decide whether to chain deeper
    if (depth >= MAX_CHAIN_DEPTH) break;
    // Only stop early if we have 8+ high-confidence findings (not raw fallbacks)
    const qualityFindings = findings.filter((f) => f.confidence >= 40);
    if (qualityFindings.length >= 8) break;

    // Generate follow-up query based on what we found + gaps
    const priorSummary = findings.map((f) => `${f.title}: ${f.body.slice(0, 100)}`).join("\n");
    const followUp = await generateFollowUp(
      entityName,
      branch.followUpPrompt(entityName, priorSummary),
      geminiKey,
    );

    if (!followUp || followUp === currentQuery) break; // no new angle
    currentQuery = followUp;
  }

  return {
    branch: branch.id,
    findings,
    gaps: findings.length < 3 ? [`Insufficient data for ${branch.label}`] : [],
    depth,
    searchCount,
  };
}


// ── Entity Resolution ────────────────────────────────────────────────────

async function resolveEntity(
  query: string,
  geminiKey: string | undefined,
): Promise<{ name: string; type: string }> {
  if (!geminiKey) {
    const match = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Inc|AI|Labs|Corp|LLC)\.?)?)\b/);
    return { name: match?.[1] ?? query.trim().slice(0, 50), type: "company" };
  }

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `What is the exact official name and entity type for this query? Return JSON only: {"name":"Official Company Name","type":"company|person|product|organization"}\n\nQuery: "${query}"` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 100 },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const match = text.match(/\{[^}]+\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch { /* fallthrough */ }

  return { name: query.trim(), type: "company" };
}

// ── Extract Structured Findings ──────────────────────────────────────────

async function extractFindings(
  entityName: string,
  extractPrompt: string,
  snippets: string[],
  geminiKey: string | undefined,
): Promise<Array<{ title: string; body: string; confidence: number; sources: string[] }>> {
  // Always produce baseline findings from raw snippets — extraction enhances, never gates
  const baselineFindings = snippets
    .filter((s) => s.length > 30)
    .slice(0, 6)
    .map((s, i) => {
      // Try to extract a meaningful title from the first sentence
      const firstSentence = s.match(/^[^.!?\n]{10,80}[.!?]/)?.[0] ?? `${entityName} finding ${i + 1}`;
      return {
        title: firstSentence.slice(0, 80),
        body: s.slice(0, 600),
        confidence: 35,
        sources: [] as string[],
      };
    });

  if (!geminiKey || snippets.length === 0) {
    return baselineFindings.length > 0 ? baselineFindings : [{
      title: `No data found for ${entityName}`,
      body: `Search returned no results for "${entityName}". Try a more specific query or alternative name.`,
      confidence: 5,
      sources: [],
    }];
  }

  try {
    const context = snippets.join("\n---\n").slice(0, 10000);
    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${extractPrompt}\n\nIMPORTANT: The entity name is "${entityName}". Never rename it to something generic.\n\nReturn a JSON array of objects: [{"title":"Finding title","body":"Detailed finding with specific numbers/names/dates","confidence":0-100}]\n\nSource material:\n${context}`,
          }],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as any;
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      // Strip markdown code fences that Gemini often wraps JSON in
      text = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
      // Try array match first, then object-with-array
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          const parsed = JSON.parse(arrayMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((f: any) => ({
              title: String(f.title ?? f.name ?? f.metric ?? ""),
              body: String(f.body ?? f.description ?? f.detail ?? f.value ?? ""),
              confidence: Number(f.confidence ?? 50),
              sources: [],
            }));
          }
        } catch { /* JSON parse failed, try line-by-line below */ }
      }
      // Fallback: parse structured text as findings (bullet points, numbered lists)
      if (text.length > 50) {
        const lines = text.split(/\n/).filter((l: string) => l.trim().length > 20);
        const structured = lines.slice(0, 10).map((line: string, i: number) => {
          const clean = line.replace(/^[\d\-\*\.\)]+\s*/, "").trim();
          const colonIdx = clean.indexOf(":");
          return {
            title: colonIdx > 3 && colonIdx < 60 ? clean.slice(0, colonIdx).trim() : `${entityName} finding ${i + 1}`,
            body: colonIdx > 3 ? clean.slice(colonIdx + 1).trim() : clean,
            confidence: 40,
            sources: [],
          };
        });
        if (structured.length > 0) return structured;
      }
    }
  } catch { /* fallthrough */ }

  // Use baseline findings (always available from raw snippets)
  return baselineFindings;
}

// ── Generate Follow-Up Query ─────────────────────────────────────────────

async function generateFollowUp(
  entityName: string,
  prompt: string,
  geminiKey: string | undefined,
): Promise<string | null> {
  if (!geminiKey) return null;

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\nGenerate ONE specific follow-up search query to fill the biggest gap. Return the query text only, no explanation. Keep "${entityName}" in the query.` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 100 },
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return text.trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* fallthrough */ }

  return null;
}

// ── Synthesize All Branches ──────────────────────────────────────────────

async function synthesizeDiligence(
  entityName: string,
  entityType: string,
  lens: string,
  branches: BranchResult[],
  geminiKey: string | undefined,
): Promise<{
  answer: string;
  confidence: number;
  keyMetrics: Array<{ label: string; value: string }>;
  comparables: string[];
  nextActions: Array<{ action: string }>;
  nextQuestions: string[];
  diligenceGrade: string;
}> {
  const branchSummary = branches.map((b) => {
    // Include MORE content per finding for better synthesis — up to 500 chars each
    const topFindings = b.findings.slice(0, 8).map((f) => `- ${f.title}: ${f.body.slice(0, 500)}`).join("\n");
    return `## ${b.branch.toUpperCase()} (${b.findings.length} findings, depth ${b.depth}, ${b.searchCount} searches)\n${topFindings}\n${b.gaps.length ? `GAPS: ${b.gaps.join(", ")}` : ""}`;
  }).join("\n\n");

  if (!geminiKey) {
    return {
      answer: branches.map((b) => b.findings.map((f) => f.body).join(" ")).join("\n\n"),
      confidence: 30,
      keyMetrics: [],
      comparables: [],
      nextActions: [{ action: "Add GEMINI_API_KEY for deeper synthesis" }],
      nextQuestions: [],
      diligenceGrade: "incomplete",
    };
  }

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a ${lens} conducting deep diligence on "${entityName}" (${entityType}).

Synthesize these research branches into a comprehensive investment/diligence brief.

${branchSummary}

Return JSON:
{
  "answer": "3-5 paragraph comprehensive diligence brief covering all branches",
  "confidence": 0-100,
  "keyMetrics": [{"label":"Revenue","value":"$X"},{"label":"Growth","value":"X%"},...],
  "comparables": ["Competitor1","Competitor2",...],
  "nextActions": [{"action":"specific next step"},...],
  "nextQuestions": ["question for deeper diligence",...],
  "diligenceGrade": "investment-ready|needs-more-data|early-stage|high-risk|insufficient-data"
}

IMPORTANT: Use "${entityName}" as the entity name throughout. Never substitute generic names.
Grade this like an investment banker would: is there enough evidence to make a decision?`,
          }],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as any;
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      text = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return {
            answer: String(parsed.answer ?? ""),
            confidence: Number(parsed.confidence ?? 50),
            keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
            comparables: Array.isArray(parsed.comparables) ? parsed.comparables : [],
            nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
            nextQuestions: Array.isArray(parsed.nextQuestions) ? parsed.nextQuestions : [],
            diligenceGrade: String(parsed.diligenceGrade ?? "needs-more-data"),
          };
        } catch { /* JSON parse failed — fall through to fallback */ }
      }
      // Fallback: use the raw text as the answer if JSON parse fails
      if (text.length > 100) {
        return {
          answer: text.slice(0, 3000),
          confidence: 35,
          keyMetrics: [],
          comparables: [],
          nextActions: [{ action: "Review findings and identify missing data" }],
          nextQuestions: [],
          diligenceGrade: "needs-more-data",
        };
      } else {
        // Gemini returned non-200 — build answer from raw branch data
        const rawAnswer = branches
          .filter((b) => b.findings.length > 0)
          .map((b) => `**${b.branch.toUpperCase()}**: ${b.findings.map((f) => f.body.slice(0, 300)).join(" ")}`)
          .join("\n\n");
        if (rawAnswer.length > 50) {
          return {
            answer: rawAnswer.slice(0, 3000),
            confidence: 25,
            keyMetrics: [],
            comparables: [],
            nextActions: [{ action: "Run deeper search with more specific entity name" }],
            nextQuestions: [`What exactly does ${entityName} do?`, `Who founded ${entityName}?`],
            diligenceGrade: "needs-more-data",
          };
        }
      }
    }
  } catch (err: unknown) {
    // Surface the error — don't swallow
    const msg = err instanceof Error ? err.message : String(err);
    const rawAnswer = branches
      .filter((b) => b.findings.length > 0)
      .map((b) => `**${b.branch.toUpperCase()}**: ${b.findings.map((f) => f.body.slice(0, 300)).join(" ")}`)
      .join("\n\n");
    if (rawAnswer.length > 50) {
      return {
        answer: `[Synthesis error: ${msg}]\n\n${rawAnswer.slice(0, 2500)}`,
        confidence: 20,
        keyMetrics: [],
        comparables: [],
        nextActions: [{ action: "Retry with GEMINI_API_KEY configured" }],
        nextQuestions: [],
        diligenceGrade: "needs-more-data",
      };
    }
  }

  // Final fallback: concatenate all branch findings as prose
  const allFindings = branches.flatMap((b) => b.findings);
  const fallbackAnswer = allFindings.length > 0
    ? allFindings.map((f) => `${f.title}: ${f.body}`).join("\n\n").slice(0, 3000)
    : `No data found for ${entityName}. The entity may be too niche for current data sources.`;

  return {
    answer: fallbackAnswer,
    confidence: allFindings.length > 0 ? 25 : 5,
    keyMetrics: [],
    comparables: [],
    nextActions: [{ action: "Review branch findings manually" }],
    nextQuestions: [],
    diligenceGrade: "insufficient-data",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function updateStatus(
  ctx: any,
  sessionId: any,
  status: string,
  trace: Array<{ step: string; tool?: string; status: string; detail?: string; startedAt: number; durationMs?: number }>,
) {
  await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
    sessionId,
    status,
    trace,
  });
}

// ── Gap Remediation Engine ───────────────────────────────────────────────

interface RemediationItem {
  gap: string;
  severity: "critical" | "high" | "medium" | "low";
  action: string;
  effort: string;
  expectedResult: string;
  artifact?: string;
}

function generateRemediation(
  entityName: string,
  risks: Array<{ title: string; body: string; confidence: number; sources: string[] }>,
  gaps: string[],
  branches: BranchResult[],
): {
  items: RemediationItem[];
  topActions: Array<{ action: string }>;
  seoAudit: { score: number; issues: string[] };
  missingPresence: string[];
} {
  const items: RemediationItem[] = [];
  const seoIssues: string[] = [];
  const missingPresence: string[] = [];
  const seenGaps = new Set<string>(); // dedup
  const addItem = (item: RemediationItem) => {
    if (seenGaps.has(item.gap)) return;
    seenGaps.add(item.gap);
    items.push(item);
  };
  const addSeoIssue = (issue: string) => {
    if (!seoIssues.includes(issue)) seoIssues.push(issue);
  };

  // ── Analyze risks for actionable remediation ──
  for (const risk of risks) {
    const lBody = risk.body.toLowerCase();
    const lTitle = risk.title.toLowerCase();

    // SEO / Discoverability
    if (lBody.includes("seo") || lBody.includes("discoverability") || lBody.includes("search engine") || lTitle.includes("seo") || lTitle.includes("brand")) {
      addSeoIssue("Low organic search visibility");
      addItem({
        gap: "Low SEO / discoverability",
        severity: "high",
        action: `Publish 3-5 technical blog posts about ${entityName}'s core technology. Submit to relevant directories (Product Hunt, HN, industry lists).`,
        effort: "2-4 weeks",
        expectedResult: "First-page ranking for branded terms within 30 days",
        artifact: "blog_post_outline",
      });
      addItem({
        gap: "Missing structured data",
        severity: "medium",
        action: "Add JSON-LD Organization schema to homepage. Add OpenGraph and Twitter Card meta tags.",
        effort: "1-2 hours",
        expectedResult: "Rich snippets in Google results, proper social media previews",
        artifact: "json_ld_template",
      });
    }

    // Key-person risk
    if (lTitle.includes("key-person") || lTitle.includes("solo founder") || lBody.includes("key-person")) {
      addItem({
        gap: "Key-person dependency",
        severity: "high",
        action: "Document all critical processes. Identify and begin recruiting for the #2 hire. Create a 'bus factor' contingency plan.",
        effort: "2-4 weeks",
        expectedResult: "Reduced single-point-of-failure risk for investor/banker evaluation",
      });
    }

    // Pre-revenue
    if (lBody.includes("pre-revenue") || lBody.includes("no revenue") || lBody.includes("no paying")) {
      addItem({
        gap: "No revenue / pre-revenue",
        severity: "critical",
        action: "Identify 3 potential design partners for paid pilots. Create a pricing page. Build a 'first 10 customers' outreach plan.",
        effort: "2-6 weeks",
        expectedResult: "First revenue milestone or LOIs for investor conversations",
        artifact: "pricing_page_draft",
      });
    }

    // Information asymmetry / lack of disclosure
    if (lBody.includes("information asymmetry") || lBody.includes("lack of public") || lBody.includes("operational obscurity")) {
      missingPresence.push("No public /about page with founder bio and company mission");
      missingPresence.push("No public /pricing page");
      missingPresence.push("No press kit or media page");
      addItem({
        gap: "Low public information / transparency",
        severity: "high",
        action: "Create public /about, /pricing, and /press pages. Publish a founder letter or company blog post explaining the mission.",
        effort: "1-2 days",
        expectedResult: "Evaluators (investors, bankers, journalists) can self-serve basic company information",
        artifact: "about_page_content",
      });
    }

    // Brand confusion
    if (lBody.includes("brand confusion") || lBody.includes("generic") || lBody.includes("overlaps with") || lTitle.includes("dilution")) {
      addSeoIssue("Brand name conflicts with generic/existing terms");
      addItem({
        gap: "Brand confusion / name overlap",
        severity: "medium",
        action: `Always use "${entityName} AI" (with qualifier) in public content. Register the exact-match domain if not already owned. Add disambiguation to the homepage meta description.`,
        effort: "1 day",
        expectedResult: "Search engines disambiguate the company from generic uses of the name",
      });
    }
  }

  // ── Analyze branch gaps (branches that found nothing) ──
  for (const branch of branches) {
    if (branch.findings.length <= 1 || branch.findings.every((f) => f.confidence < 30)) {
      const branchLabel = branch.branch.replace(/_/g, " ");
      addItem({
        gap: `Insufficient public data: ${branchLabel}`,
        severity: "medium",
        action: `Publish ${branchLabel} information publicly. For companies: add to your website, LinkedIn, or Crunchbase profile.`,
        effort: "1-3 days",
        expectedResult: `Future searches will find real ${branchLabel} data instead of "no information available"`,
      });
    }
  }

  // ── Check for missing web presence signals ──
  const allBodies = branches.flatMap((b) => b.findings.map((f) => f.body.toLowerCase())).join(" ");
  if (!allBodies.includes("linkedin")) missingPresence.push("No LinkedIn company page found");
  if (!allBodies.includes("twitter") && !allBodies.includes("x.com")) missingPresence.push("No Twitter/X presence found");
  if (!allBodies.includes("github")) missingPresence.push("No GitHub organization found");
  if (!allBodies.includes("crunchbase")) missingPresence.push("No Crunchbase profile found");
  if (!allBodies.includes("product hunt")) missingPresence.push("No Product Hunt listing found");

  // ── SEO audit score ──
  let seoScore = 100;
  if (seoIssues.length > 0) seoScore -= 30;
  if (missingPresence.length >= 3) seoScore -= 20;
  if (missingPresence.length >= 5) seoScore -= 15;
  const totalSources = new Set(branches.flatMap((b) => b.findings.flatMap((f) => f.sources))).size;
  if (totalSources < 10) seoScore -= 15;
  if (totalSources < 5) seoScore -= 10;
  seoScore = Math.max(0, seoScore);

  // ── Top actions (most impactful, sorted by severity) ──
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const topActions = items.slice(0, 5).map((i) => ({ action: `[${i.severity.toUpperCase()}] ${i.action}` }));

  return {
    items,
    topActions,
    seoAudit: { score: seoScore, issues: seoIssues },
    missingPresence,
  };
}
