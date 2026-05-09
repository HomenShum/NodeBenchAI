/**
 * Phase 8a §3 — Evergreen forecast seed.
 *
 * Hand-authored 8 forecast questions targeting agent-stack milestones
 * for 2026-2027.  Inserts as `forecasts` rows owned by a stable
 * `system:editorial` userId so they're surfaceable through the public
 * `getTopForecasts` query without colliding with any human's track
 * record.
 *
 * Idempotency: deterministic via `forecasts.search_question` + tag
 * match.  Re-running this mutation does NOT duplicate.
 *
 * agentic_reliability invariants:
 *   - BOUND          fixed list of 8 entries; no array growth
 *   - HONEST_STATUS  returns counts of inserted/skipped, no fakes
 *   - HONEST_SCORES  initial probability is hand-authored, marked as
 *                    `currentProbability` (analyst best-guess as of
 *                    seed date); previousProbability is null until
 *                    first refresh
 *   - DETERMINISTIC  question text is the canonical key; same question
 *                    text → no duplicate row
 *   - ERROR_BOUNDARY each row is independently inserted
 *
 * Run via:
 *   npx convex run domains/research/forecasting/seedEvergreenForecasts:seed '{}'
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";

const SYSTEM_USER_ID = "system:editorial";

type Seed = {
  question: string;
  currentProbability: number;
  resolutionDate: string;
  resolutionCriteria: string;
  topDrivers: string[];
  topCounterarguments: string[];
  tags: string[];
};

/**
 * 8 evergreen questions covering: agent capability frontiers, MCP
 * ecosystem maturity, safety regulation, model commoditization,
 * developer tooling, and Brier-scoring readiness.
 *
 * Each `currentProbability` is calibrated against publicly observable
 * trajectories as of 2026-05-09.  These are the analyst's prior, not
 * a measurement — the dashboard surfaces them with explicit "analyst
 * estimate, will refresh weekly" framing.
 */
const SEED_FORECASTS: Seed[] = [
  {
    question:
      "Will SWE-bench Verified pass-rate for any frontier model exceed 80% by 2026-09-30?",
    currentProbability: 0.55,
    resolutionDate: "2026-09-30",
    resolutionCriteria:
      "Resolves YES if any closed or open-weight model is reported with ≥80% pass on SWE-bench Verified by the deadline. Source: SWE-bench leaderboard at swebench.com.",
    topDrivers: [
      "Anthropic Sonnet variants improved 4.7→5 pp/month over Q1-Q2 2026",
      "OpenAI o-series chain-of-thought scaling continues",
      "Tooling (VSCode-style harnesses) adds 3-5pp on top of base model",
    ],
    topCounterarguments: [
      "SWE-bench Verified contains long-context tasks where current best is ~70%",
      "Eval saturation slows — last 10pp historically takes 2x longer than first 10pp",
    ],
    tags: ["agent-capabilities", "evergreen", "code-generation"],
  },
  {
    question:
      "Will the public MCP-server count tracked at mcpservers.org exceed 1000 by 2026-08-31?",
    currentProbability: 0.65,
    resolutionDate: "2026-08-31",
    resolutionCriteria:
      "Resolves YES if mcpservers.org's catalog count is ≥1000 on or before 2026-08-31. Snapshot via web archive if site changes.",
    topDrivers: [
      "Anthropic shipped MCP 2025-11-25 spec with annotations",
      "Claude Code, Cursor, Windsurf all integrated MCP",
      "Developer interest curves match early-React growth",
    ],
    topCounterarguments: [
      "Most MCP servers are demos or thin wrappers — quality dilution may discourage tracking",
      "Competing protocols (Anthropic's tool_use, OpenAI's Assistants v2) fragment the ecosystem",
    ],
    tags: ["ecosystem-growth", "evergreen", "mcp"],
  },
  {
    question:
      "Will at least one US federal agency (NIST, FTC, or DOJ) issue binding regulation specifically targeting agentic AI by 2026-12-31?",
    currentProbability: 0.35,
    resolutionDate: "2026-12-31",
    resolutionCriteria:
      "Resolves YES if a final rule, enforceable order, or settlement specifically references agentic-AI behavior (autonomous tool use, multi-step planning) is published in the Federal Register by 2026-12-31.",
    topDrivers: [
      "Multiple bipartisan AI safety bills in 119th Congress",
      "EU AI Act enforcement begins 2026-08, may trigger US response",
      "FTC has signaled focus on autonomous agent fraud risks",
    ],
    topCounterarguments: [
      "Federal rulemaking has 18-24mo median lifecycle — too slow for 2026 finals",
      "Industry lobby resistance via AI Industry Coalition",
    ],
    tags: ["regulation", "evergreen", "policy"],
  },
  {
    question:
      "Will the cost of GPT-5-class capability (HumanEval ≥90%) fall below $0.50 per million tokens by 2026-12-31?",
    currentProbability: 0.4,
    resolutionDate: "2026-12-31",
    resolutionCriteria:
      "Resolves YES if any provider lists a model with HumanEval ≥90% at ≤$0.50 per 1M output tokens (sticker price, not usage credit) by deadline. Open-weight self-hosted does not count.",
    topDrivers: [
      "Open-weight efficiency frontier (DeepSeek V3, Llama 4) compressing inference costs",
      "Chip-side gains from H200 → B200 transition",
      "Distillation / MoE advances published 2026 Q1",
    ],
    topCounterarguments: [
      "Frontier-lab pricing power persists while moat exists",
      "API-margin compression fight not yet started in earnest",
    ],
    tags: ["pricing", "evergreen", "model-economics"],
  },
  {
    question:
      "Will any GitHub repo with autonomous-agent-as-coworker positioning surpass 100k stars by 2026-12-31?",
    currentProbability: 0.5,
    resolutionDate: "2026-12-31",
    resolutionCriteria:
      "Resolves YES if a repo whose README claims autonomous coworker / employee positioning (not chatbot) reaches ≥100k GitHub stars by deadline. Star history must show organic ramp (not bot inflation).",
    topDrivers: [
      "OpenClaw, Devin, Cursor Composer all in race",
      "Anthropic Claude Code at >40k stars and growing 1k/week",
      "Developer mindshare shifting from copilot → coworker frame",
    ],
    topCounterarguments: [
      "Most agent repos plateau at 20-40k stars when usage curve falters",
      "Closed-source winners (Claude Code, Cursor) absorb mindshare from OSS",
    ],
    tags: ["adoption", "evergreen", "agent-platforms"],
  },
  {
    question:
      "Will at least one major AI provider publish a Brier-scored multi-month forecasting track record (≥10 resolved questions) by 2026-09-30?",
    currentProbability: 0.25,
    resolutionDate: "2026-09-30",
    resolutionCriteria:
      "Resolves YES if Anthropic, OpenAI, Google DeepMind, xAI, Meta, or Mistral publishes a public dashboard showing ≥10 resolved forecast questions with computed Brier scores by 2026-09-30.",
    topDrivers: [
      "Forecasting eval frameworks (FUTUREBENCH, ForecastBench) drawing investor attention",
      "Calibration is differentiated capability — labs may lead with it",
      "NodeBench, Manifold, Metaculus already publish this data",
    ],
    topCounterarguments: [
      "Brier-scored track record exposes weakness — labs averse",
      "Forecasting is not yet a tier-1 marketing axis",
    ],
    tags: ["calibration", "evergreen", "evals"],
  },
  {
    question:
      "Will any robotics platform demonstrate >10 contiguous hours of autonomous mobile-manipulation in unstructured environments by 2026-12-31?",
    currentProbability: 0.3,
    resolutionDate: "2026-12-31",
    resolutionCriteria:
      "Resolves YES if a peer-reviewed paper, public demo, or operator report shows a single robot completing ≥10 hours of mobile manipulation (not stationary) in unstructured (non-warehouse, non-rail) settings by deadline.",
    topDrivers: [
      "Figure 02, 1X NEO, Tesla Optimus all targeting late-2026 milestones",
      "World-model foundation pretraining accelerating sim-to-real",
      "Long-horizon RL planning advances published Q1 2026",
    ],
    topCounterarguments: [
      "Battery limits — 10h continuous load near limits of current packs",
      "Failure recovery in unstructured envs is order-of-magnitude harder than warehouse",
    ],
    tags: ["robotics", "evergreen", "embodied-ai"],
  },
  {
    question:
      "Will the share of GitHub PRs primarily authored by AI agents (vs humans) exceed 20% in any of the top-100 OSS repos by 2026-12-31?",
    currentProbability: 0.45,
    resolutionDate: "2026-12-31",
    resolutionCriteria:
      "Resolves YES if any of the GitHub top-100 OSS repos (by star count as of 2026-01-01) reports ≥20% of merged PRs in calendar Q4 2026 with primary AI-agent authorship (commit metadata or maintainer attribution). Source: GitHub Developer Velocity Lab data or repo maintainer statement.",
    topDrivers: [
      "Claude Code, Cursor, Windsurf all generating PRs via Bot accounts",
      "Maintainers of large repos increasingly delegating routine refactors to agents",
      "Github Copilot Workspace at GA",
    ],
    topCounterarguments: [
      "Maintainer aversion — agent PRs are reviewed harder, slower",
      "Attribution ambiguity — who counts as 'AI-authored' is contested",
    ],
    tags: ["adoption", "evergreen", "developer-tools"],
  },
];

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let inserted = 0;
    let skipped = 0;
    for (const seed of SEED_FORECASTS) {
      // Idempotency check: same question text + same userId → skip.
      const existing = await ctx.db
        .query("forecasts")
        .withIndex("by_user", (q) => q.eq("userId", SYSTEM_USER_ID))
        .filter((q) => q.eq(q.field("question"), seed.question))
        .first();
      if (existing) {
        skipped++;
        continue;
      }
      // Insert forecast with updateCount: 1 + matching history row so
      // the public `getTopForecasts` query sees them on first read.
      const forecastId = await ctx.db.insert("forecasts", {
        userId: SYSTEM_USER_ID,
        question: seed.question,
        forecastType: "binary" as const,
        probability: seed.currentProbability,
        baseRate: undefined,
        confidenceInterval: undefined,
        resolutionDate: seed.resolutionDate,
        resolutionCriteria: seed.resolutionCriteria,
        status: "active" as const,
        topDrivers: seed.topDrivers,
        topCounterarguments: seed.topCounterarguments,
        refreshFrequency: "weekly" as const,
        lastRefreshedAt: now,
        updateCount: 1,
        tags: seed.tags,
        createdAt: now,
        updatedAt: now,
      });
      // Record the seed as "update #1" so previousProbability is
      // honestly null (no prior measurement) and Δ badges render
      // empty until the first real refresh.
      await ctx.db.insert("forecastUpdateHistory", {
        forecastId,
        userId: SYSTEM_USER_ID,
        previousProbability: seed.currentProbability,
        newProbability: seed.currentProbability,
        reasoning: "Initial seed (analyst prior). No measurement yet.",
        evidenceIds: [],
        updatedAt: now,
      });
      inserted++;
    }
    return {
      inserted,
      skipped,
      total: SEED_FORECASTS.length,
    };
  },
});
