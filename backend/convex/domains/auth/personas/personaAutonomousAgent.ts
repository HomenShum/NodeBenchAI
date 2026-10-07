/**
 * Persona Autonomous Agent - Self-Directed Research Per Persona
 * Deep Agents 3.0 - Each persona runs autonomous research loops
 *
 * Features:
 * - Persona-specific research strategies
 * - Budget management per persona
 * - Quality threshold enforcement
 * - Autonomous task generation
 * - Cross-persona coordination
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  PERSONA_CONFIG,
  BUDGET_CONFIG,
  RESEARCH_CONFIG,
  QUALITY_CONFIG,
  type PersonaId,
} from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface PersonaResearchContext {
  personaId: PersonaId;
  focusAreas: string[];
  recentEntities: string[];
  pendingQuestions: string[];
  qualityThreshold: number;
}

export interface PersonaResearchPlan {
  personaId: PersonaId;
  targetEntities: Array<{
    entityId: string;
    entityName: string;
    priority: number;
    reason: string;
  }>;
  researchQuestions: string[];
  estimatedCost: number;
  estimatedDuration: number;
}

export interface PersonaResearchResult {
  personaId: PersonaId;
  entityId: string;
  findings: string;
  qualityScore: number;
  sources: Array<{ name: string; url: string; credibility: number }>;
  nextActions: string[];
  contradictions: string[];
  cost: number;
}

/* ================================================================== */
/* PERSONA DEFINITIONS                                                 */
/* ================================================================== */

const PERSONA_RESEARCH_STRATEGIES: Record<
  PersonaId,
  {
    focusAreas: string[];
    searchPatterns: string[];
    prioritySignals: string[];
    outputFormat: string;
  }
> = {
  JPM_STARTUP_BANKER: {
    focusAreas: ["funding", "m&a", "valuations", "deal flow"],
    searchPatterns: [
      "company raised funding",
      "startup acquisition",
      "series funding round",
      "IPO filing",
    ],
    prioritySignals: ["funding announcement", "acquisition rumor", "IPO"],
    outputFormat: "Deal memo with verdict, next actions, and timeline",
  },
  EARLY_STAGE_VC: {
    focusAreas: ["seed rounds", "market timing", "founder backgrounds", "traction metrics"],
    searchPatterns: [
      "seed funding",
      "pre-seed round",
      "founder background",
      "YC batch",
    ],
    prioritySignals: ["demo day", "founder exit", "market shift"],
    outputFormat: "Investment thesis with comps, TAM, and why now",
  },
  CTO_TECH_LEAD: {
    focusAreas: ["security vulnerabilities", "tech stack changes", "architecture patterns"],
    searchPatterns: [
      "CVE vulnerability",
      "security advisory",
      "zero-day exploit",
      "tech stack migration",
    ],
    prioritySignals: ["critical CVE", "data breach", "dependency vulnerability"],
    outputFormat: "Security brief with exposure, impact, and mitigations",
  },
  ACADEMIC_RD: {
    focusAreas: ["research papers", "methodology advances", "citation networks"],
    searchPatterns: [
      "arxiv paper",
      "research breakthrough",
      "methodology advance",
      "peer review",
    ],
    prioritySignals: ["paper accepted", "breakthrough result", "replication study"],
    outputFormat: "Research summary with methodology, findings, and gaps",
  },
  PHARMA_BD: {
    focusAreas: ["clinical trials", "FDA approvals", "partnerships", "pipeline updates"],
    searchPatterns: [
      "FDA approval",
      "clinical trial results",
      "pharma partnership",
      "drug pipeline",
    ],
    prioritySignals: ["phase 3 results", "FDA decision", "licensing deal"],
    outputFormat: "Pipeline update with trial status, partners, and timeline",
  },
  MACRO_STRATEGIST: {
    focusAreas: ["economic indicators", "policy changes", "market trends"],
    searchPatterns: [
      "Fed policy",
      "economic indicator",
      "market trend",
      "geopolitical risk",
    ],
    prioritySignals: ["rate decision", "inflation data", "policy shift"],
    outputFormat: "Macro thesis with indicators, risks, and positioning",
  },
  QUANT_PM: {
    focusAreas: ["market signals", "factor performance", "risk metrics"],
    searchPatterns: [
      "market anomaly",
      "factor momentum",
      "volatility signal",
      "correlation breakdown",
    ],
    prioritySignals: ["vol spike", "factor rotation", "liquidity event"],
    outputFormat: "Signal analysis with backtest, risk, and implementation",
  },
  CORP_DEV: {
    focusAreas: ["M&A activity", "strategic partnerships", "competitive landscape"],
    searchPatterns: [
      "acquisition announcement",
      "strategic partnership",
      "competitive move",
      "market consolidation",
    ],
    prioritySignals: ["deal announcement", "strategic review", "competitive threat"],
    outputFormat: "Strategic brief with fit, synergies, and risks",
  },
  LP_ALLOCATOR: {
    focusAreas: ["fund performance", "manager track records", "allocation trends"],
    searchPatterns: [
      "fund performance",
      "GP track record",
      "allocation strategy",
      "fund closing",
    ],
    prioritySignals: ["fund launch", "performance report", "team change"],
    outputFormat: "Manager memo with track record, strategy, and fit",
  },
  JOURNALIST: {
    focusAreas: ["breaking news", "story angles", "source quotes"],
    searchPatterns: [
      "breaking news",
      "exclusive story",
      "industry trend",
      "executive comment",
    ],
    prioritySignals: ["breaking announcement", "exclusive", "trend emergence"],
    outputFormat: "Story brief with angle, sources, and context",
  },
  FOUNDER_STRATEGY: {
    focusAreas: ["competitive landscape", "market positioning", "growth strategy"],
    searchPatterns: [
      "competitor analysis",
      "market opportunity",
      "growth strategy",
      "founder playbook",
    ],
    prioritySignals: ["competitor move", "market shift", "strategy pivot"],
    outputFormat: "Strategic brief with competitive position, opportunities, and risks",
  },
};

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get persona's current research context
 */
export const getPersonaContext = internalQuery({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<PersonaResearchContext | null> => {
    // Validate personaId is in the list
    if (!PERSONA_CONFIG.personaIds.includes(personaId as PersonaId)) return null;

    // Get recent research tasks for this persona
    const recentTasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_persona", (q) => q.eq("primaryPersona", personaId))
      .order("desc")
      .take(20) as Doc<"researchTasks">[];

    const recentEntities = [...new Set(recentTasks.map((t: Doc<"researchTasks">) => t.entityId))].slice(0, 10);

    // Get strategy for this persona
    const strategy = PERSONA_RESEARCH_STRATEGIES[personaId as PersonaId];

    return {
      personaId: personaId as PersonaId,
      focusAreas: strategy?.focusAreas || [],
      recentEntities,
      pendingQuestions: [], // TODO: Pull from question queue
      qualityThreshold: QUALITY_CONFIG.minQualityScore,
    };
  },
});

/**
 * Get persona budget status
 */
export const getPersonaBudget = internalQuery({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<Doc<"personaBudgets"> | null> => {
    return await ctx.db
      .query("personaBudgets")
      .withIndex("by_persona", (q) => q.eq("personaId", personaId))
      .first() as Doc<"personaBudgets"> | null;
  },
});

/**
 * Get all persona budgets
 */
export const getAllPersonaBudgets = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"personaBudgets">[]> => {
    return await ctx.db.query("personaBudgets").collect() as Doc<"personaBudgets">[];
  },
});

/**
 * Get persona research queue
 */
export const getPersonaResearchQueue = internalQuery({
  args: { personaId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { personaId, limit = 10 }): Promise<Doc<"researchTasks">[]> => {
    return await ctx.db
      .query("researchTasks")
      .withIndex("by_persona", (q) => q.eq("primaryPersona", personaId))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .order("desc")
      .take(limit) as Doc<"researchTasks">[];
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Initialize or reset persona budget
 */
export const initializePersonaBudget = internalMutation({
  args: {
    personaId: v.string(),
    dailyBudget: v.optional(v.number()),
  },
  handler: async (ctx, { personaId, dailyBudget }): Promise<Id<"personaBudgets">> => {
    const existing = await ctx.db
      .query("personaBudgets")
      .withIndex("by_persona", (q) => q.eq("personaId", personaId))
      .first() as Doc<"personaBudgets"> | null;

    const budget = dailyBudget || BUDGET_CONFIG.dailyCostLimitUsd;

    if (existing) {
      await ctx.db.patch(existing._id, {
        dailyBudget: budget,
        remainingBudget: budget,
        lastReset: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("personaBudgets", {
      personaId,
      dailyBudget: budget,
      remainingBudget: budget,
      usedToday: 0,
      tasksCompleted: 0,
      lastReset: Date.now(),
    });
  },
});

/**
 * Consume budget for a research task
 */
export const consumeBudget = internalMutation({
  args: {
    personaId: v.string(),
    cost: v.number(),
  },
  handler: async (ctx, { personaId, cost }): Promise<boolean> => {
    const budget = await ctx.db
      .query("personaBudgets")
      .withIndex("by_persona", (q) => q.eq("personaId", personaId))
      .first() as Doc<"personaBudgets"> | null;

    if (!budget) {
      console.log(`[PersonaAgent] No budget found for ${personaId}`);
      return false;
    }

    // Check if we need to reset (new day)
    const lastResetDate = new Date(budget.lastReset).toDateString();
    const today = new Date().toDateString();

    if (lastResetDate !== today) {
      // Reset budget for new day
      await ctx.db.patch(budget._id, {
        remainingBudget: budget.dailyBudget,
        usedToday: 0,
        tasksCompleted: 0,
        lastReset: Date.now(),
      });
      return true;
    }

    // Check if enough budget
    if (budget.remainingBudget < cost) {
      console.log(`[PersonaAgent] Insufficient budget for ${personaId}: ${budget.remainingBudget} < ${cost}`);
      return false;
    }

    await ctx.db.patch(budget._id, {
      remainingBudget: budget.remainingBudget - cost,
      usedToday: budget.usedToday + cost,
      tasksCompleted: budget.tasksCompleted + 1,
    });

    return true;
  },
});

/**
 * Create persona-specific research task
 */
export const createPersonaResearchTask = internalMutation({
  args: {
    personaId: v.string(),
    entityId: v.string(),
    entityName: v.string(),
    entityType: v.string(),
    priority: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"researchTasks">> => {
    return await ctx.db.insert("researchTasks", {
      entityId: args.entityId,
      entityName: args.entityName,
      entityType: args.entityType,
      personas: [args.personaId],
      primaryPersona: args.personaId,
      priority: args.priority,
      priorityFactors: {
        personaInitiated: true,
        reason: args.reason,
      },
      status: "queued",
      triggeredBy: "persona",
      retryCount: 0,
      createdAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Generate research plan for a persona
 */
export const generateResearchPlan = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<PersonaResearchPlan | null> => {
    const context = await ctx.runQuery(
      internal.domains.personas.personaAutonomousAgent.getPersonaContext,
      { personaId }
    );

    if (!context) {
      console.log(`[PersonaAgent] Unknown persona: ${personaId}`);
      return null;
    }

    const budget = await ctx.runQuery(
      internal.domains.personas.personaAutonomousAgent.getPersonaBudget,
      { personaId }
    );

    // Use a minimum task cost of $0.01 (1 cent)
    const minTaskCost = 0.01;
    if (!budget || budget.remainingBudget < minTaskCost) {
      console.log(`[PersonaAgent] ${personaId} has insufficient budget`);
      return null;
    }

    // Get stale entities that need research
    const staleEntities = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getStaleEntities,
      { limit: 20 }
    );

    // Filter to entities relevant to this persona's focus areas
    const strategy = PERSONA_RESEARCH_STRATEGIES[personaId as PersonaId];
    type StaleEntity = { entityId: string; canonicalName: string; freshness: { decayScore: number } };
    const relevantEntities = (staleEntities as StaleEntity[])
      .filter((e: StaleEntity) => !context.recentEntities.includes(e.entityId))
      .map((e: StaleEntity) => ({
        entityId: e.entityId,
        entityName: e.canonicalName,
        priority: 100 - Math.round(e.freshness.decayScore * 100),
        reason: `Stale (decay: ${e.freshness.decayScore.toFixed(2)})`,
      }))
      .slice(0, 5);

    // Generate research questions based on focus areas
    const researchQuestions = strategy.focusAreas.map(
      (area: string) => `What are the latest developments in ${area}?`
    );

    // Estimate cost based on number of entities ($0.05 per entity)
    const avgTaskCost = 0.05;
    const estimatedCost = relevantEntities.length * avgTaskCost;

    return {
      personaId: personaId as PersonaId,
      targetEntities: relevantEntities,
      researchQuestions,
      estimatedCost,
      estimatedDuration: relevantEntities.length * 5, // 5 min per entity
    };
  },
});

/**
 * Execute autonomous research for a persona
 */
export const executePersonaResearch = internalAction({
  args: {
    personaId: v.string(),
    entityId: v.string(),
    entityName: v.string(),
    entityType: v.string(),
  },
  handler: async (ctx, { personaId, entityId, entityName, entityType }): Promise<PersonaResearchResult | null> => {
    // Average cost per research task
    const estimatedCost = 0.05;

    // Check and consume budget
    const budgetOk = await ctx.runMutation(
      internal.domains.personas.personaAutonomousAgent.consumeBudget,
      { personaId, cost: estimatedCost }
    );

    if (!budgetOk) {
      return null;
    }

    console.log(`[PersonaAgent] ${personaId} researching ${entityName}`);

    // Create research task
    const taskId = await ctx.runMutation(
      internal.domains.personas.personaAutonomousAgent.createPersonaResearchTask,
      {
        personaId,
        entityId,
        entityName,
        entityType,
        priority: 70,
        reason: "Persona autonomous research",
      }
    );

    // Execute research via the main research pipeline
    const result = await ctx.runAction(
      internal.domains.research.autonomousResearcher.runResearch,
      { taskId }
    );

    if (!result.success) {
      return null;
    }

    // Return formatted result
    return {
      personaId: personaId as PersonaId,
      entityId,
      findings: result.findings || "",
      qualityScore: result.qualityScore,
      sources: result.sources || [],
      nextActions: result.nextActions || [],
      contradictions: [],
      cost: estimatedCost,
    };
  },
});

/**
 * Run autonomous research tick for a persona
 */
export const tickPersonaResearch = internalAction({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<{
    tasksExecuted: number;
    totalCost: number;
  }> => {
    console.log(`[PersonaAgent] Starting autonomous tick for ${personaId}`);

    // Generate research plan
    const plan = await ctx.runAction(
      internal.domains.personas.personaAutonomousAgent.generateResearchPlan,
      { personaId }
    );

    if (!plan || plan.targetEntities.length === 0) {
      console.log(`[PersonaAgent] ${personaId}: No research targets`);
      return { tasksExecuted: 0, totalCost: 0 };
    }

    let tasksExecuted = 0;
    let totalCost = 0;

    // Execute research for each target entity (up to budget)
    for (const target of plan.targetEntities) {
      const result = await ctx.runAction(
        internal.domains.personas.personaAutonomousAgent.executePersonaResearch,
        {
          personaId,
          entityId: target.entityId,
          entityName: target.entityName,
          entityType: "company", // Default, should come from entity
        }
      );

      if (result) {
        tasksExecuted++;
        totalCost += result.cost;
      } else {
        // Budget exhausted or error
        break;
      }
    }

    console.log(
      `[PersonaAgent] ${personaId} completed ${tasksExecuted} tasks, cost: ${totalCost}`
    );

    return { tasksExecuted, totalCost };
  },
});

/**
 * Run all personas' autonomous research (orchestrator tick)
 */
export const tickAllPersonas = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    personasRun: number;
    totalTasks: number;
    totalCost: number;
  }> => {
    console.log("[PersonaAgent] Starting all-persona autonomous tick");

    const personas = Object.keys(PERSONA_CONFIG) as PersonaId[];
    let personasRun = 0;
    let totalTasks = 0;
    let totalCost = 0;

    for (const personaId of personas) {
      // Get research cadence for persona - if "continuous", enable autonomous operation
      const cadence = PERSONA_CONFIG.researchCadence[personaId];

      // For simplicity, enable all personas with "continuous" or "daily" cadence
      const isAutonomousEnabled = cadence === "continuous" || cadence === "daily";
      if (!isAutonomousEnabled) {
        continue;
      }

      const result = await ctx.runAction(
        internal.domains.personas.personaAutonomousAgent.tickPersonaResearch,
        { personaId }
      );

      personasRun++;
      totalTasks += result.tasksExecuted;
      totalCost += result.totalCost;
    }

    console.log(
      `[PersonaAgent] All personas complete: ${personasRun} personas, ${totalTasks} tasks, ${totalCost} cost`
    );

    return { personasRun, totalTasks, totalCost };
  },
});

/**
 * Initialize all persona budgets
 */
export const initializeAllBudgets = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const personas = Object.keys(PERSONA_CONFIG) as PersonaId[];
    let initialized = 0;

    for (const personaId of personas) {
      await ctx.runMutation(
        internal.domains.personas.personaAutonomousAgent.initializePersonaBudget,
        { personaId }
      );
      initialized++;
    }

    console.log(`[PersonaAgent] Initialized budgets for ${initialized} personas`);
    return initialized;
  },
});
