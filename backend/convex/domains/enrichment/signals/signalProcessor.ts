/**
 * Signal Processor - Entity Extraction and Research Queue Routing
 * Deep Agents 3.0 - Transforms raw signals into research tasks
 *
 * Processing pipeline:
 * 1. Entity extraction (NER)
 * 2. Persona relevance scoring
 * 3. Urgency classification
 * 4. Research queue routing
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  SIGNAL_CONFIG,
  PERSONA_CONFIG,
  RESEARCH_CONFIG,
  type PersonaId,
  type SignalUrgency,
} from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

interface ExtractedEntity {
  name: string;
  type: "company" | "person" | "topic" | "product" | "event";
  confidence: number;
  mentions: number;
}

interface PersonaScore {
  personaId: PersonaId;
  score: number;
  reason: string;
}

interface ProcessedSignal {
  signalId: Id<"signals">;
  entities: ExtractedEntity[];
  topPersonas: PersonaScore[];
  urgency: SignalUrgency;
  researchDepth: "shallow" | "standard" | "deep";
}

/* ================================================================== */
/* ENTITY EXTRACTION                                                   */
/* ================================================================== */

/**
 * Simple pattern-based entity extraction
 * For production, integrate with a proper NER model (spaCy, Hugging Face, etc.)
 */
function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const entities: Map<string, ExtractedEntity> = new Map();

  // Company patterns (common suffixes)
  const companyPatterns = [
    /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:Inc\.?|Corp\.?|LLC|Ltd\.?|Co\.?|Company|Therapeutics|Biosciences|Pharmaceuticals|Biotech)\b/g,
    /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:raises?|raised|secures?|closes?|announces?)\b/gi,
  ];

  // Person patterns (titles)
  const personPatterns = [
    /(?:CEO|CTO|CFO|COO|CMO|CSO|President|Founder|Co-founder|Director|VP|Vice President)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),?\s+(?:CEO|CTO|CFO|COO|CMO|CSO|President|Founder|Co-founder)/g,
  ];

  // Funding patterns (amounts)
  const fundingPatterns = [
    /\$(\d+(?:\.\d+)?)\s*(?:million|M|billion|B)/gi,
    /(?:Series\s+[A-Z]|Seed|Pre-Seed|IPO)/gi,
  ];

  // Extract companies
  for (const pattern of companyPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length >= 3 && name.length <= 50) {
        const existing = entities.get(name.toLowerCase());
        if (existing) {
          existing.mentions++;
        } else {
          entities.set(name.toLowerCase(), {
            name,
            type: "company",
            confidence: 0.7,
            mentions: 1,
          });
        }
      }
    }
  }

  // Extract people
  for (const pattern of personPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length >= 5 && name.length <= 50 && name.includes(" ")) {
        const existing = entities.get(name.toLowerCase());
        if (existing) {
          existing.mentions++;
        } else {
          entities.set(name.toLowerCase(), {
            name,
            type: "person",
            confidence: 0.6,
            mentions: 1,
          });
        }
      }
    }
  }

  // Detect topics from funding patterns
  let hasFunding = false;
  for (const pattern of fundingPatterns) {
    if (pattern.test(text)) {
      hasFunding = true;
      break;
    }
  }

  if (hasFunding) {
    entities.set("funding_event", {
      name: "funding_event",
      type: "event",
      confidence: 0.8,
      mentions: 1,
    });
  }

  // Filter by confidence and limit
  return Array.from(entities.values())
    .filter((e) => e.confidence >= SIGNAL_CONFIG.nerConfidenceThreshold)
    .sort((a, b) => b.confidence * b.mentions - a.confidence * a.mentions)
    .slice(0, SIGNAL_CONFIG.maxEntitiesPerSignal);
}

/* ================================================================== */
/* PERSONA SCORING                                                     */
/* ================================================================== */

/**
 * Score persona relevance based on entities and content
 */
function scorePersonaRelevance(
  entities: ExtractedEntity[],
  content: string,
  title?: string
): PersonaScore[] {
  const text = `${title || ""} ${content}`.toLowerCase();
  const scores: PersonaScore[] = [];

  // Keyword mappings for each persona
  const personaKeywords: Record<string, string[]> = {
    JPM_STARTUP_BANKER: [
      "funding",
      "series",
      "ipo",
      "valuation",
      "deal",
      "banking",
      "m&a",
      "biotech",
      "fintech",
    ],
    EARLY_STAGE_VC: [
      "seed",
      "pre-seed",
      "series a",
      "startup",
      "portfolio",
      "investment",
      "venture",
    ],
    CTO_TECH_LEAD: [
      "cve",
      "security",
      "vulnerability",
      "breach",
      "infrastructure",
      "devops",
      "architecture",
    ],
    ACADEMIC_RD: [
      "research",
      "paper",
      "study",
      "methodology",
      "findings",
      "publication",
      "arxiv",
    ],
    PHARMA_BD: [
      "clinical",
      "trial",
      "fda",
      "approval",
      "phase",
      "drug",
      "therapeutic",
      "pipeline",
    ],
    MACRO_STRATEGIST: [
      "market",
      "economy",
      "fed",
      "interest rate",
      "inflation",
      "gdp",
      "policy",
    ],
    QUANT_PM: [
      "algorithm",
      "trading",
      "quantitative",
      "model",
      "data",
      "signal",
      "backtest",
    ],
    CORP_DEV: [
      "acquisition",
      "merger",
      "partnership",
      "strategic",
      "integration",
      "synergy",
    ],
    LP_ALLOCATOR: [
      "fund",
      "allocation",
      "returns",
      "performance",
      "portfolio",
      "lp",
      "endowment",
    ],
    JOURNALIST: [
      "breaking",
      "exclusive",
      "sources",
      "report",
      "coverage",
      "story",
      "news",
    ],
  };

  // Entity type boosts
  const entityTypeBoosts: Record<string, Partial<Record<PersonaId, number>>> = {
    company: {
      JPM_STARTUP_BANKER: 0.3,
      EARLY_STAGE_VC: 0.3,
      CORP_DEV: 0.2,
      PHARMA_BD: 0.2,
    },
    person: {
      JOURNALIST: 0.2,
      LP_ALLOCATOR: 0.1,
    },
    event: {
      JPM_STARTUP_BANKER: 0.2,
      JOURNALIST: 0.3,
    },
  };

  for (const personaId of PERSONA_CONFIG.personaIds) {
    let score = 0;
    const reasons: string[] = [];

    // Keyword matching
    const keywords = personaKeywords[personaId] || [];
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        score += 0.15;
        reasons.push(`keyword: ${keyword}`);
      }
    }

    // Entity type boosts
    for (const entity of entities) {
      const boost = entityTypeBoosts[entity.type]?.[personaId] || 0;
      if (boost > 0) {
        score += boost * entity.confidence;
        reasons.push(`entity: ${entity.name}`);
      }
    }

    // Sector matching
    const sectors = PERSONA_CONFIG.sectorMappings[personaId] || [];
    for (const sector of sectors) {
      if (text.includes(sector)) {
        score += 0.2;
        reasons.push(`sector: ${sector}`);
      }
    }

    if (score > 0) {
      scores.push({
        personaId,
        score: Math.min(score, 1),
        reason: reasons.slice(0, 3).join(", "),
      });
    }
  }

  // Sort by score and return top 3
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get a signal by ID
 */
export const getSignal = internalQuery({
  args: { signalId: v.id("signals") },
  handler: async (ctx, { signalId }): Promise<Doc<"signals"> | null> => {
    return await ctx.db.get(signalId);
  },
});

/**
 * Check if entity already has a queued research task
 */
export const hasQueuedResearchTask = internalQuery({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }): Promise<boolean> => {
    const existing = await ctx.db
      .query("researchTasks")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "queued"),
          q.eq(q.field("status"), "researching"),
          q.eq(q.field("status"), "validating")
        )
      )
      .first();
    return existing !== null;
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Create a research task from processed signal
 */
export const createResearchTask = internalMutation({
  args: {
    entityId: v.string(),
    entityType: v.optional(v.string()),
    entityName: v.optional(v.string()),
    personas: v.array(v.string()),
    primaryPersona: v.optional(v.string()),
    priority: v.number(),
    priorityFactors: v.optional(
      v.object({
        urgencyBoost: v.optional(v.number()),
        stalenessBoost: v.optional(v.number()),
        watchlistBoost: v.optional(v.number()),
        trendingBoost: v.optional(v.number()),
      })
    ),
    signalId: v.optional(v.id("signals")),
    triggeredBy: v.optional(
      v.union(
        v.literal("signal"),
        v.literal("decay"),
        v.literal("watchlist"),
        v.literal("enrichment"),
        v.literal("manual")
      )
    ),
  },
  handler: async (ctx, args): Promise<Id<"researchTasks">> => {
    return await ctx.db.insert("researchTasks", {
      entityId: args.entityId,
      entityType: args.entityType,
      entityName: args.entityName,
      personas: args.personas,
      primaryPersona: args.primaryPersona || args.personas[0],
      priority: args.priority,
      priorityFactors: args.priorityFactors,
      status: "queued",
      signalId: args.signalId,
      triggeredBy: args.triggeredBy || "signal",
      retryCount: 0,
      createdAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* ACTIONS - SIGNAL PROCESSING                                         */
/* ================================================================== */

/**
 * Calculate priority for a research task
 */
function calculatePriority(
  urgency: SignalUrgency,
  entities: ExtractedEntity[],
  personaScores: PersonaScore[]
): { priority: number; factors: Record<string, number> } {
  let priority = RESEARCH_CONFIG.basePriority;
  const factors: Record<string, number> = {};

  // Urgency boost
  switch (urgency) {
    case "critical":
      factors.urgencyBoost = RESEARCH_CONFIG.priorityBoosts.urgencyCritical;
      break;
    case "high":
      factors.urgencyBoost = RESEARCH_CONFIG.priorityBoosts.urgencyHigh;
      break;
    case "medium":
      factors.urgencyBoost = RESEARCH_CONFIG.priorityBoosts.urgencyMedium;
      break;
    default:
      factors.urgencyBoost = 0;
  }
  priority += factors.urgencyBoost;

  // Entity confidence boost
  const avgConfidence =
    entities.reduce((sum, e) => sum + e.confidence, 0) / Math.max(entities.length, 1);
  factors.entityConfidence = Math.round(avgConfidence * 10);
  priority += factors.entityConfidence;

  // Persona relevance boost
  const topPersonaScore = personaScores[0]?.score || 0;
  factors.personaRelevance = Math.round(topPersonaScore * 15);
  priority += factors.personaRelevance;

  return {
    priority: Math.min(priority, 100),
    factors,
  };
}

/**
 * Process a single signal - main processing pipeline
 */
export const processSignal = internalAction({
  args: { signalId: v.id("signals") },
  handler: async (ctx, { signalId }): Promise<void> => {
    console.log(`[SignalProcessor] Processing signal ${signalId}`);

    // 1. Get the signal
    const signal = await ctx.runQuery(
      internal.domains.signals.signalProcessor.getSignal,
      { signalId }
    );

    if (!signal) {
      console.error(`[SignalProcessor] Signal not found: ${signalId}`);
      return;
    }

    if (signal.processingStatus !== "pending") {
      console.log(`[SignalProcessor] Signal already processed: ${signalId}`);
      return;
    }

    // 2. Mark as processing
    await ctx.runMutation(
      internal.domains.signals.signalIngester.updateSignalStatus,
      { signalId, status: "processing" }
    );

    try {
      // 3. Extract entities
      const entities = extractEntitiesFromText(
        `${signal.title || ""} ${signal.rawContent}`
      );
      console.log(
        `[SignalProcessor] Extracted ${entities.length} entities from signal ${signalId}`
      );

      // 4. Score persona relevance
      const personaScores = scorePersonaRelevance(
        entities,
        signal.rawContent,
        signal.title
      );

      // 5. Get urgency (already classified during ingestion)
      const urgency = (signal.urgency as SignalUrgency) || "low";

      // 6. Create research tasks for each extracted entity
      let tasksCreated = 0;
      for (const entity of entities) {
        // Skip if already queued
        const hasQueued = await ctx.runQuery(
          internal.domains.signals.signalProcessor.hasQueuedResearchTask,
          { entityId: entity.name.toLowerCase() }
        );

        if (hasQueued) {
          console.log(
            `[SignalProcessor] Skipping ${entity.name} - already queued`
          );
          continue;
        }

        // Calculate priority
        const { priority, factors } = calculatePriority(
          urgency,
          [entity],
          personaScores
        );

        // Create research task
        const taskId = await ctx.runMutation(
          internal.domains.signals.signalProcessor.createResearchTask,
          {
            entityId: entity.name.toLowerCase(),
            entityType: entity.type,
            entityName: entity.name,
            personas: personaScores.map((p) => p.personaId),
            primaryPersona: personaScores[0]?.personaId,
            priority,
            priorityFactors: {
              urgencyBoost: factors.urgencyBoost,
            },
            signalId,
            triggeredBy: "signal",
          }
        );

        console.log(
          `[SignalProcessor] Created research task ${taskId} for ${entity.name} (priority: ${priority})`
        );
        tasksCreated++;
      }

      // 7. Update signal status
      await ctx.runMutation(
        internal.domains.signals.signalIngester.updateSignalStatus,
        {
          signalId,
          status: "processed",
          extractedEntities: entities.map((e) => e.name),
          suggestedPersonas: personaScores.map((p) => p.personaId),
        }
      );

      console.log(
        `[SignalProcessor] Completed processing signal ${signalId}: ${tasksCreated} tasks created`
      );
    } catch (error) {
      console.error(`[SignalProcessor] Error processing signal ${signalId}:`, error);

      await ctx.runMutation(
        internal.domains.signals.signalIngester.markSignalForRetry,
        {
          signalId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  },
});

/**
 * Process all pending signals in batch
 */
export const processPendingSignals = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<{ processed: number }> => {
    console.log("[SignalProcessor] Processing pending signals...");

    const pendingSignals = await ctx.runQuery(
      internal.domains.signals.signalIngester.getPendingSignals,
      { limit }
    );

    let processed = 0;
    for (const signal of pendingSignals) {
      try {
        await ctx.runAction(
          internal.domains.signals.signalProcessor.processSignal,
          { signalId: signal._id }
        );
        processed++;
      } catch (error) {
        console.error(
          `[SignalProcessor] Failed to process signal ${signal._id}:`,
          error
        );
      }
    }

    console.log(
      `[SignalProcessor] Processed ${processed}/${pendingSignals.length} signals`
    );
    return { processed };
  },
});

/**
 * Main processing tick - called by cron
 */
export const tickSignalProcessing = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[SignalProcessor] Starting signal processing tick...");

    await ctx.runAction(
      internal.domains.signals.signalProcessor.processPendingSignals,
      {}
    );

    console.log("[SignalProcessor] Tick complete.");
  },
});
