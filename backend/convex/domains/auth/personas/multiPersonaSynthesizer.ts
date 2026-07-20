/**
 * Multi-Persona Synthesizer - Cross-Persona Intelligence Fusion
 * Deep Agents 3.0 - Combines insights from multiple personas into unified outputs
 *
 * Features:
 * - Cross-persona insight aggregation
 * - Conflict resolution between personas
 * - Consensus scoring
 * - Multi-perspective summaries
 * - Action item consolidation
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { PERSONA_CONFIG, type PersonaId } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface PersonaInsight {
  personaId: PersonaId;
  content: string;
  confidence: number;
  sources: string[];
  verdict?: "bullish" | "bearish" | "neutral" | "mixed";
  keyPoints: string[];
  nextActions: string[];
}

export interface SynthesizedOutput {
  entityId: string;
  entityName: string;
  timestamp: number;

  // Consensus view
  consensusVerdict: "bullish" | "bearish" | "neutral" | "mixed";
  consensusScore: number;
  consensusSummary: string;

  // Individual perspectives
  perspectives: Array<{
    personaId: PersonaId;
    personaName: string;
    verdict: string;
    confidence: number;
    keyInsight: string;
  }>;

  // Conflicts and agreements
  agreements: string[];
  conflicts: Array<{
    topic: string;
    positions: Array<{ personaId: string; position: string }>;
    resolution?: string;
  }>;

  // Consolidated actions
  prioritizedActions: Array<{
    action: string;
    supportingPersonas: PersonaId[];
    priority: "high" | "medium" | "low";
    reasoning: string;
  }>;

  // Metadata
  personasConsulted: PersonaId[];
  totalSources: number;
  synthesisQuality: number;
}

export interface PersonaAgreement {
  topic: string;
  agreeingPersonas: PersonaId[];
  sharedInsight: string;
  strength: number;
}

export interface PersonaConflict {
  topic: string;
  conflictingPositions: Array<{
    personaId: PersonaId;
    position: string;
    confidence: number;
  }>;
  suggestedResolution: string;
  severity: "minor" | "moderate" | "major";
}

/* ================================================================== */
/* VERDICT ANALYSIS                                                    */
/* ================================================================== */

const VERDICT_WEIGHTS: Record<string, number> = {
  bullish: 1,
  neutral: 0,
  bearish: -1,
  mixed: 0,
};

/**
 * Calculate consensus verdict from multiple persona verdicts
 */
function calculateConsensus(
  insights: PersonaInsight[]
): { verdict: "bullish" | "bearish" | "neutral" | "mixed"; score: number } {
  if (insights.length === 0) {
    return { verdict: "neutral", score: 0 };
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const insight of insights) {
    const verdictWeight = VERDICT_WEIGHTS[insight.verdict || "neutral"];
    const confidenceWeight = insight.confidence;

    weightedSum += verdictWeight * confidenceWeight;
    totalWeight += confidenceWeight;
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Determine verdict based on score
  let verdict: "bullish" | "bearish" | "neutral" | "mixed";
  if (score > 0.3) {
    verdict = "bullish";
  } else if (score < -0.3) {
    verdict = "bearish";
  } else if (Math.abs(score) < 0.1) {
    verdict = "neutral";
  } else {
    verdict = "mixed";
  }

  return { verdict, score };
}

/**
 * Find agreements between personas
 */
function findAgreements(insights: PersonaInsight[]): PersonaAgreement[] {
  const agreements: PersonaAgreement[] = [];

  // Group key points by similarity
  const pointClusters: Map<string, { personas: PersonaId[]; points: string[] }> = new Map();

  for (const insight of insights) {
    for (const point of insight.keyPoints) {
      const normalizedPoint = point.toLowerCase().trim();

      // Find if this point is similar to existing clusters
      let matched = false;
      for (const [key, cluster] of pointClusters) {
        // Simple similarity check (could be enhanced with embeddings)
        if (
          normalizedPoint.includes(key.slice(0, 20)) ||
          key.includes(normalizedPoint.slice(0, 20))
        ) {
          cluster.personas.push(insight.personaId);
          cluster.points.push(point);
          matched = true;
          break;
        }
      }

      if (!matched) {
        pointClusters.set(normalizedPoint, {
          personas: [insight.personaId],
          points: [point],
        });
      }
    }
  }

  // Convert clusters with multiple personas into agreements
  for (const [topic, cluster] of pointClusters) {
    if (cluster.personas.length >= 2) {
      agreements.push({
        topic: topic.slice(0, 100),
        agreeingPersonas: [...new Set(cluster.personas)],
        sharedInsight: cluster.points[0],
        strength: cluster.personas.length / insights.length,
      });
    }
  }

  return agreements.sort((a, b) => b.strength - a.strength).slice(0, 5);
}

/**
 * Find conflicts between personas
 */
function findConflicts(insights: PersonaInsight[]): PersonaConflict[] {
  const conflicts: PersonaConflict[] = [];

  // Check for verdict conflicts
  const verdicts = insights.map((i) => ({
    personaId: i.personaId,
    verdict: i.verdict || "neutral",
    confidence: i.confidence,
  }));

  const hasBullish = verdicts.some((v) => v.verdict === "bullish");
  const hasBearish = verdicts.some((v) => v.verdict === "bearish");

  if (hasBullish && hasBearish) {
    const bullishPersonas = verdicts
      .filter((v) => v.verdict === "bullish")
      .map((v) => ({ personaId: v.personaId, position: "bullish", confidence: v.confidence }));
    const bearishPersonas = verdicts
      .filter((v) => v.verdict === "bearish")
      .map((v) => ({ personaId: v.personaId, position: "bearish", confidence: v.confidence }));

    conflicts.push({
      topic: "Overall verdict",
      conflictingPositions: [...bullishPersonas, ...bearishPersonas],
      suggestedResolution: "Review supporting evidence from both sides",
      severity: "major",
    });
  }

  return conflicts;
}

/**
 * Consolidate and prioritize actions from all personas
 */
function consolidateActions(
  insights: PersonaInsight[]
): SynthesizedOutput["prioritizedActions"] {
  const actionMap: Map<string, { personas: PersonaId[]; action: string }> = new Map();

  for (const insight of insights) {
    for (const action of insight.nextActions) {
      const normalizedAction = action.toLowerCase().trim();
      const key = normalizedAction.slice(0, 50);

      if (actionMap.has(key)) {
        actionMap.get(key)!.personas.push(insight.personaId);
      } else {
        actionMap.set(key, { personas: [insight.personaId], action });
      }
    }
  }

  // Convert to prioritized actions
  const prioritizedActions: SynthesizedOutput["prioritizedActions"] = [];

  for (const [, data] of actionMap) {
    const supportCount = data.personas.length;
    let priority: "high" | "medium" | "low";

    if (supportCount >= 3 || supportCount === insights.length) {
      priority = "high";
    } else if (supportCount >= 2) {
      priority = "medium";
    } else {
      priority = "low";
    }

    prioritizedActions.push({
      action: data.action,
      supportingPersonas: data.personas,
      priority,
      reasoning: `Recommended by ${supportCount} persona(s): ${data.personas.join(", ")}`,
    });
  }

  // Sort by priority and support count
  return prioritizedActions
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.supportingPersonas.length - a.supportingPersonas.length;
    })
    .slice(0, 10);
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get insights for an entity from all personas
 */
export const getEntityInsights = internalQuery({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }): Promise<PersonaInsight[]> => {
    // Get completed research tasks for this entity
    const tasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .take(20);

    // Transform tasks into insights
    const insights: PersonaInsight[] = [];

    for (const task of tasks) {
      if (task.result) {
        insights.push({
          personaId: task.primaryPersona as PersonaId,
          content: task.result.content || "",
          confidence: (task.result.qualityScore || 50) / 100,
          sources: task.result.sources?.map((s: { name: string }) => s.name) || [],
          verdict: task.result.verdict as PersonaInsight["verdict"],
          keyPoints: task.result.keyPoints || [],
          nextActions: task.result.nextActions || [],
        });
      }
    }

    return insights;
  },
});

/**
 * Get synthesis history for an entity
 */
export const getSynthesisHistory = internalQuery({
  args: { entityId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { entityId, limit = 10 }): Promise<Doc<"publishingTasks">[]> => {
    return await ctx.db
      .query("publishingTasks")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .order("desc")
      .take(limit);
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Store synthesized output
 */
export const storeSynthesis = internalMutation({
  args: {
    entityId: v.string(),
    entityName: v.string(),
    synthesis: v.any(),
  },
  handler: async (ctx, { entityId, entityName, synthesis }): Promise<Id<"publishingTasks">> => {
    return await ctx.db.insert("publishingTasks", {
      researchTaskId: undefined, // Synthesis is standalone
      entityId,
      entityName,
      content: synthesis.consensusSummary,
      format: "synthesis",
      channels: ["ui"],
      status: "completed",
      metadata: {
        synthesisData: synthesis,
        personasConsulted: synthesis.personasConsulted,
        consensusVerdict: synthesis.consensusVerdict,
        consensusScore: synthesis.consensusScore,
      },
      createdAt: Date.now(),
      completedAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Synthesize insights from multiple personas for an entity
 */
export const synthesizeEntityInsights = internalAction({
  args: {
    entityId: v.string(),
    entityName: v.string(),
    personas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { entityId, entityName, personas }): Promise<SynthesizedOutput> => {
    console.log(`[MultiPersonaSynthesizer] Synthesizing insights for ${entityName}`);

    // Get all insights for the entity
    let insights = await ctx.runQuery(
      internal.domains.personas.multiPersonaSynthesizer.getEntityInsights,
      { entityId }
    );

    // Filter by specified personas if provided
    if (personas && personas.length > 0) {
      insights = insights.filter((i: PersonaInsight) => personas.includes(i.personaId));
    }

    if (insights.length === 0) {
      return {
        entityId,
        entityName,
        timestamp: Date.now(),
        consensusVerdict: "neutral",
        consensusScore: 0,
        consensusSummary: `No insights available for ${entityName}`,
        perspectives: [],
        agreements: [],
        conflicts: [],
        prioritizedActions: [],
        personasConsulted: [],
        totalSources: 0,
        synthesisQuality: 0,
      };
    }

    // Calculate consensus
    const { verdict: consensusVerdict, score: consensusScore } = calculateConsensus(insights);

    // Find agreements and conflicts
    const agreements = findAgreements(insights);
    const conflicts = findConflicts(insights);

    // Consolidate actions
    const prioritizedActions = consolidateActions(insights);

    // Build perspectives array
    const perspectives = insights.map((insight: PersonaInsight) => ({
      personaId: insight.personaId,
      personaName: insight.personaId, // Use personaId as the display name
      verdict: insight.verdict || "neutral",
      confidence: insight.confidence,
      keyInsight: insight.keyPoints[0] || insight.content.slice(0, 200),
    }));

    // Generate consensus summary
    const personasConsulted = [...new Set(insights.map((i: PersonaInsight) => i.personaId))] as PersonaId[];
    const totalSources = insights.reduce((sum: number, i: PersonaInsight) => sum + i.sources.length, 0);

    let consensusSummary = `Based on ${personasConsulted.length} persona perspectives with ${totalSources} sources:\n\n`;

    consensusSummary += `**Overall Verdict: ${consensusVerdict.toUpperCase()}** (confidence: ${(Math.abs(consensusScore) * 100).toFixed(0)}%)\n\n`;

    if (agreements.length > 0) {
      consensusSummary += `**Key Agreements:**\n`;
      for (const agreement of agreements.slice(0, 3)) {
        consensusSummary += `- ${agreement.sharedInsight} (${agreement.agreeingPersonas.length} personas agree)\n`;
      }
      consensusSummary += "\n";
    }

    if (conflicts.length > 0) {
      consensusSummary += `**Notable Conflicts:**\n`;
      for (const conflict of conflicts) {
        consensusSummary += `- ${conflict.topic}: ${conflict.suggestedResolution}\n`;
      }
      consensusSummary += "\n";
    }

    if (prioritizedActions.length > 0) {
      consensusSummary += `**Recommended Actions:**\n`;
      for (const action of prioritizedActions.filter((a) => a.priority === "high").slice(0, 3)) {
        consensusSummary += `- ${action.action}\n`;
      }
    }

    // Calculate synthesis quality
    const synthesisQuality = Math.min(
      100,
      personasConsulted.length * 15 + agreements.length * 10 + Math.min(totalSources, 10) * 3
    );

    const synthesis: SynthesizedOutput = {
      entityId,
      entityName,
      timestamp: Date.now(),
      consensusVerdict,
      consensusScore,
      consensusSummary,
      perspectives,
      agreements: agreements.map((a) => a.sharedInsight),
      conflicts: conflicts.map((c) => ({
        topic: c.topic,
        positions: c.conflictingPositions.map((p) => ({
          personaId: p.personaId,
          position: p.position,
        })),
        resolution: c.suggestedResolution,
      })),
      prioritizedActions,
      personasConsulted,
      totalSources,
      synthesisQuality,
    };

    // Store the synthesis
    await ctx.runMutation(
      internal.domains.personas.multiPersonaSynthesizer.storeSynthesis,
      { entityId, entityName, synthesis }
    );

    console.log(
      `[MultiPersonaSynthesizer] Synthesis complete for ${entityName}: ${consensusVerdict} (${synthesisQuality}% quality)`
    );

    return synthesis;
  },
});

/**
 * Generate cross-entity synthesis (portfolio view)
 */
export const synthesizePortfolio = internalAction({
  args: {
    entityIds: v.array(v.string()),
    personaId: v.optional(v.string()),
  },
  handler: async (ctx, { entityIds, personaId }): Promise<{
    entities: Array<{
      entityId: string;
      entityName: string;
      verdict: string;
      confidence: number;
    }>;
    overallSentiment: string;
    topActions: string[];
    commonThemes: string[];
  }> => {
    const entities: Array<{
      entityId: string;
      entityName: string;
      verdict: string;
      confidence: number;
    }> = [];

    const allActions: string[] = [];
    const allKeyPoints: string[] = [];

    for (const entityId of entityIds) {
      const insights = await ctx.runQuery(
        internal.domains.personas.multiPersonaSynthesizer.getEntityInsights,
        { entityId }
      );

      if (insights.length === 0) continue;

      // Filter by persona if specified
      const filteredInsights = personaId
        ? insights.filter((i: PersonaInsight) => i.personaId === personaId)
        : insights;

      if (filteredInsights.length === 0) continue;

      const { verdict, score } = calculateConsensus(filteredInsights);

      entities.push({
        entityId,
        entityName: entityId, // Would need entity lookup for real name
        verdict,
        confidence: Math.abs(score),
      });

      // Collect actions and key points
      for (const insight of filteredInsights) {
        allActions.push(...insight.nextActions);
        allKeyPoints.push(...insight.keyPoints);
      }
    }

    // Calculate overall sentiment
    const bullishCount = entities.filter((e) => e.verdict === "bullish").length;
    const bearishCount = entities.filter((e) => e.verdict === "bearish").length;

    let overallSentiment: string;
    if (bullishCount > bearishCount * 2) {
      overallSentiment = "strongly bullish";
    } else if (bullishCount > bearishCount) {
      overallSentiment = "moderately bullish";
    } else if (bearishCount > bullishCount * 2) {
      overallSentiment = "strongly bearish";
    } else if (bearishCount > bullishCount) {
      overallSentiment = "moderately bearish";
    } else {
      overallSentiment = "mixed";
    }

    // Find top actions (most common)
    const actionCounts = new Map<string, number>();
    for (const action of allActions) {
      const key = action.toLowerCase().slice(0, 50);
      actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
    }
    const topActions = [...actionCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([action]) => action);

    // Find common themes (most common key points)
    const themeCounts = new Map<string, number>();
    for (const point of allKeyPoints) {
      const key = point.toLowerCase().slice(0, 50);
      themeCounts.set(key, (themeCounts.get(key) || 0) + 1);
    }
    const commonThemes = [...themeCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([theme]) => theme);

    return {
      entities,
      overallSentiment,
      topActions,
      commonThemes,
    };
  },
});

/**
 * Compare perspectives between two personas
 */
export const comparePersonaPerspectives = internalAction({
  args: {
    entityId: v.string(),
    personaA: v.string(),
    personaB: v.string(),
  },
  handler: async (ctx, { entityId, personaA, personaB }): Promise<{
    comparison: {
      personaA: { name: string; verdict: string; keyPoints: string[] };
      personaB: { name: string; verdict: string; keyPoints: string[] };
    };
    agreements: string[];
    disagreements: string[];
    recommendation: string;
  }> => {
    const allInsights = await ctx.runQuery(
      internal.domains.personas.multiPersonaSynthesizer.getEntityInsights,
      { entityId }
    );

    const insightA = allInsights.find((i: PersonaInsight) => i.personaId === personaA);
    const insightB = allInsights.find((i: PersonaInsight) => i.personaId === personaB);

    if (!insightA || !insightB) {
      return {
        comparison: {
          personaA: { name: personaA, verdict: "unknown", keyPoints: [] },
          personaB: { name: personaB, verdict: "unknown", keyPoints: [] },
        },
        agreements: [],
        disagreements: ["Insufficient data for comparison"],
        recommendation: "Need more research from both personas",
      };
    }

    // Find agreements (overlapping key points)
    const agreements: string[] = [];
    const pointsA = new Set(insightA.keyPoints.map((p: string) => p.toLowerCase().slice(0, 50)));

    for (const pointB of insightB.keyPoints) {
      const normalizedB = pointB.toLowerCase().slice(0, 50);
      for (const pointA of pointsA) {
        if ((pointA as string).includes(normalizedB.slice(0, 20)) || normalizedB.includes((pointA as string).slice(0, 20))) {
          agreements.push(pointB);
          break;
        }
      }
    }

    // Find disagreements (conflicting verdicts)
    const disagreements: string[] = [];
    if (insightA.verdict !== insightB.verdict) {
      disagreements.push(
        `${personaA} is ${insightA.verdict}, ${personaB} is ${insightB.verdict}`
      );
    }

    // Generate recommendation
    let recommendation: string;
    if (insightA.confidence > insightB.confidence + 0.2) {
      recommendation = `Consider ${personaA}'s perspective (higher confidence)`;
    } else if (insightB.confidence > insightA.confidence + 0.2) {
      recommendation = `Consider ${personaB}'s perspective (higher confidence)`;
    } else if (agreements.length > disagreements.length) {
      recommendation = "Strong consensus between personas";
    } else {
      recommendation = "Seek additional perspectives to resolve differences";
    }

    return {
      comparison: {
        personaA: {
          name: personaA, // Use personaId as the display name
          verdict: insightA.verdict || "neutral",
          keyPoints: insightA.keyPoints.slice(0, 5),
        },
        personaB: {
          name: personaB, // Use personaId as the display name
          verdict: insightB.verdict || "neutral",
          keyPoints: insightB.keyPoints.slice(0, 5),
        },
      },
      agreements,
      disagreements,
      recommendation,
    };
  },
});
