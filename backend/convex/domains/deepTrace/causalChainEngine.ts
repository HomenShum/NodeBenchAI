import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

// ============================================================================
// Causal Chain Engine — DeepTrace v2
//
// Provides backward causal tracing, competitive mirroring, counter-hypothesis
// generation, and impact propagation over the DeepTrace relationship graph.
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

const PROPAGATION_WEIGHTS: Record<string, number> = {
  depends_on: 0.9,
  supplies: 0.8,
  subsidiary_of: 0.85,
  partners_with: 0.6,
  invests_in: 0.5,
  competes_with: 0.4,
  acquires: 0.7,
  disrupts: 0.65,
  regulates: 0.55,
  leads: 0.45,
  causes: 0.95,
};

/** Collect incoming relationship edges where the target is `toEntityKey`. */
async function getIncomingEdges(ctx: any, toEntityKey: string, minConfidence: number) {
  const edges = await ctx.db
    .query("relationshipEdges")
    .withIndex("by_related_type", (q: any) => q.eq("relatedEntityKey", toEntityKey))
    .collect();
  return edges.filter((e: any) => e.confidence > minConfidence && e.status === "active");
}

/** Collect outgoing relationship edges from a given entity. */
async function getOutgoingEdges(ctx: any, fromEntityKey: string) {
  const edges = await ctx.db
    .query("relationshipEdges")
    .withIndex("by_subject_type", (q: any) => q.eq("subjectEntityKey", fromEntityKey))
    .collect();
  return edges.filter((e: any) => e.status === "active");
}

/** Get recent observations for an entity, most-recent first. */
async function getRecentObservations(ctx: any, entityKey: string, limit: number) {
  return await ctx.db
    .query("relationshipObservations")
    .withIndex("by_subject_time", (q: any) => q.eq("subjectEntityKey", entityKey))
    .order("desc")
    .take(limit);
}

/** Get the current dimension profile for an entity (if any). */
async function getDimensionProfile(ctx: any, entityKey: string) {
  return await ctx.db
    .query("dimensionProfiles")
    .withIndex("by_entity", (q: any) => q.eq("entityKey", entityKey))
    .first();
}

// ---------------------------------------------------------------------------
// 1. buildCausalChain — backward trace through relationship graph
// ---------------------------------------------------------------------------

export const buildCausalChain = query({
  args: {
    entityKey: v.string(),
    eventType: v.optional(v.string()),
    maxDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDepth = Math.min(args.maxDepth ?? 5, 5);
    const minConfidence = 0.5;

    type ChainLink = {
      entityKey: string;
      event: { claimText: string; relationshipType: string; observedAt: number } | null;
      relationship: { type: string; confidence: number; summary: string } | null;
      compositeConfidence: number;
      depth: number;
    };

    const chain: ChainLink[] = [];
    const visited = new Set<string>();

    // BFS queue: [entityKey, compositeConfidence, depth]
    const queue: Array<[string, number, number]> = [[args.entityKey, 1.0, 0]];
    visited.add(args.entityKey);

    while (queue.length > 0) {
      const [currentEntity, confidence, depth] = queue.shift()!;

      if (depth > maxDepth) continue;

      // Get incoming edges (upstream causes)
      const incomingEdges = await getIncomingEdges(ctx, currentEntity, minConfidence);

      for (const edge of incomingEdges) {
        const upstreamEntity = edge.subjectEntityKey;
        if (visited.has(upstreamEntity)) continue;
        visited.add(upstreamEntity);

        // Check for recent observations on the upstream entity that could be causes
        const observations = await getRecentObservations(ctx, upstreamEntity, 5);

        // Filter by eventType if specified
        const relevantObs = args.eventType
          ? observations.filter((o: any) => o.relationshipType === args.eventType)
          : observations;

        const bestObs = relevantObs[0] ?? null;
        const edgeConfidence = edge.confidence * confidence;

        chain.push({
          entityKey: upstreamEntity,
          event: bestObs
            ? {
                claimText: bestObs.claimText,
                relationshipType: bestObs.relationshipType,
                observedAt: bestObs.observedAt,
              }
            : null,
          relationship: {
            type: edge.relationshipType,
            confidence: edge.confidence,
            summary: edge.summary,
          },
          compositeConfidence: edgeConfidence,
          depth: depth + 1,
        });

        if (depth + 1 < maxDepth) {
          queue.push([upstreamEntity, edgeConfidence, depth + 1]);
        }
      }
    }

    // Sort by composite confidence descending
    chain.sort((a, b) => b.compositeConfidence - a.compositeConfidence);

    return {
      targetEntityKey: args.entityKey,
      chainLength: chain.length,
      maxDepthReached: chain.length > 0 ? Math.max(...chain.map((c) => c.depth)) : 0,
      chain,
    };
  },
});

// ---------------------------------------------------------------------------
// 2. getCompetitiveMirror — dimension comparison with competitors
// ---------------------------------------------------------------------------

export const getCompetitiveMirror = query({
  args: {
    entityKey: v.string(),
  },
  handler: async (ctx, args) => {
    // Find competitors in both directions
    const outboundCompetitors = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_subject_type", (q: any) =>
        q.eq("subjectEntityKey", args.entityKey).eq("relationshipType", "competes_with"),
      )
      .collect();

    const inboundCompetitors = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_related_type", (q: any) =>
        q.eq("relatedEntityKey", args.entityKey).eq("relationshipType", "competes_with"),
      )
      .collect();

    // Dedupe competitor entity keys
    const competitorKeys = new Set<string>();
    for (const edge of outboundCompetitors) {
      if (edge.status === "active") competitorKeys.add(edge.relatedEntityKey);
    }
    for (const edge of inboundCompetitors) {
      if (edge.status === "active") competitorKeys.add(edge.subjectEntityKey);
    }

    // Get target's dimension profile
    const targetProfile = await getDimensionProfile(ctx, args.entityKey);

    // Extract flat dimension scores from a profile's dimensionState
    function extractScores(dimensionState: any): Record<string, number | null> {
      const scores: Record<string, number | null> = {};
      if (!dimensionState) return scores;
      for (const [family, metrics] of Object.entries(dimensionState)) {
        if (typeof metrics !== "object" || metrics === null) continue;
        for (const [metricName, metric] of Object.entries(metrics as Record<string, any>)) {
          const key = `${family}.${metricName}`;
          scores[key] = metric?.score ?? null;
        }
      }
      return scores;
    }

    const targetScores = extractScores(targetProfile?.dimensionState);

    // Build competitor comparison
    const competitors: Array<{
      entityKey: string;
      entityName: string | null;
      confidence: number;
      dimensions: Record<string, number | null>;
      relativeStrengths: string[];
      relativeWeaknesses: string[];
    }> = [];

    for (const compKey of competitorKeys) {
      const compProfile = await getDimensionProfile(ctx, compKey);
      const compScores = extractScores(compProfile?.dimensionState);

      const relativeStrengths: string[] = [];
      const relativeWeaknesses: string[] = [];

      // Compare dimension by dimension
      const allKeys = new Set([...Object.keys(targetScores), ...Object.keys(compScores)]);
      for (const dimKey of allKeys) {
        const targetVal = targetScores[dimKey];
        const compVal = compScores[dimKey];
        if (targetVal == null || compVal == null) continue;
        if (targetVal > compVal) {
          relativeStrengths.push(dimKey);
        } else if (compVal > targetVal) {
          relativeWeaknesses.push(dimKey);
        }
      }

      competitors.push({
        entityKey: compKey,
        entityName: compProfile?.entityName ?? null,
        confidence: compProfile?.confidence ?? 0,
        dimensions: compScores,
        relativeStrengths,
        relativeWeaknesses,
      });
    }

    return {
      target: {
        entityKey: args.entityKey,
        entityName: targetProfile?.entityName ?? null,
        dimensions: targetScores,
      },
      competitors,
      competitorCount: competitors.length,
    };
  },
});

// ---------------------------------------------------------------------------
// 3. getCounterHypotheses — find contradicting evidence for a claim
// ---------------------------------------------------------------------------

export const getCounterHypotheses = query({
  args: {
    entityKey: v.string(),
    claim: v.string(),
  },
  handler: async (ctx, args) => {
    const hypotheses: Array<{
      hypothesis: string;
      evidence: string;
      confidence: number;
      source: "observation" | "relationship" | "world_event";
    }> = [];

    const claimTokens = args.claim.toLowerCase().split(/\s+/);

    // 1. Negative-sentiment observations about the entity
    const observations = await ctx.db
      .query("relationshipObservations")
      .withIndex("by_subject_time", (q: any) => q.eq("subjectEntityKey", args.entityKey))
      .order("desc")
      .take(50);

    for (const obs of observations) {
      // Check if the observation might contradict the claim via keyword overlap
      const obsText = (obs.claimText ?? "").toLowerCase();
      const overlap = claimTokens.filter((t: string) => t.length > 3 && obsText.includes(t));

      // Consider observations with "disputed" status or those referencing competing explanations
      if (obs.status === "disputed" || overlap.length >= 2) {
        hypotheses.push({
          hypothesis: `Counter-evidence from ${obs.relationshipType} observation`,
          evidence: obs.claimText,
          confidence: obs.confidence * (overlap.length / Math.max(claimTokens.length, 1)),
          source: "observation",
        });
      }
    }

    // 2. Relationships where entity is disrupted/regulated by others
    const disruptEdges = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_related_type", (q: any) =>
        q.eq("relatedEntityKey", args.entityKey).eq("relationshipType", "disrupts"),
      )
      .collect();

    const regulateEdges = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_related_type", (q: any) =>
        q.eq("relatedEntityKey", args.entityKey).eq("relationshipType", "regulates"),
      )
      .collect();

    for (const edge of [...disruptEdges, ...regulateEdges]) {
      if (edge.status !== "active") continue;
      hypotheses.push({
        hypothesis: `${edge.subjectEntityKey} ${edge.relationshipType} ${args.entityKey}`,
        evidence: edge.summary,
        confidence: edge.confidence,
        source: "relationship",
      });
    }

    // 3. World events negatively affecting the entity
    const worldEvents = await ctx.db
      .query("worldEvents")
      .withIndex("by_primary_entity_detected", (q: any) =>
        q.eq("primaryEntityKey", args.entityKey),
      )
      .order("desc")
      .take(20);

    for (const evt of worldEvents) {
      // High severity events are counter-evidence to positive claims
      if (evt.severity === "high" || evt.severity === "critical") {
        hypotheses.push({
          hypothesis: `World event: ${evt.title}`,
          evidence: evt.summary,
          confidence: SEVERITY_WEIGHTS[evt.severity] ?? 0.5,
          source: "world_event",
        });
      }
    }

    // Also check events that list this entity in linkedEntityKeys
    const recentEvents = await ctx.db
      .query("worldEvents")
      .withIndex("by_severity_detected", (q: any) => q.eq("severity", "critical"))
      .order("desc")
      .take(30);

    for (const evt of recentEvents) {
      if (evt.primaryEntityKey === args.entityKey) continue; // already captured
      const linked = evt.linkedEntityKeys ?? [];
      if (linked.includes(args.entityKey)) {
        hypotheses.push({
          hypothesis: `Linked world event: ${evt.title}`,
          evidence: evt.summary,
          confidence: SEVERITY_WEIGHTS[evt.severity] ?? 0.5,
          source: "world_event",
        });
      }
    }

    // Sort by confidence descending, cap at 20
    hypotheses.sort((a, b) => b.confidence - a.confidence);

    return {
      entityKey: args.entityKey,
      claim: args.claim,
      counterHypotheses: hypotheses.slice(0, 20),
      totalFound: hypotheses.length,
    };
  },
});

// ---------------------------------------------------------------------------
// 4. traceImpactPropagation — forward trace from a world event
// ---------------------------------------------------------------------------

export const traceImpactPropagation = query({
  args: {
    worldEventId: v.id("worldEvents"),
    maxDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDepth = Math.min(args.maxDepth ?? 3, 3);

    const worldEvent = await ctx.db.get(args.worldEventId);
    if (!worldEvent) {
      return { error: "World event not found", tree: [] };
    }

    const severityWeight = SEVERITY_WEIGHTS[worldEvent.severity] ?? 0.5;

    type ImpactNode = {
      entityKey: string;
      impactLevel: number;
      propagationPath: string[];
      relationship: string;
      depth: number;
    };

    const tree: ImpactNode[] = [];
    const visited = new Set<string>();

    // Seed entities: primaryEntityKey + linkedEntityKeys
    const seedEntities: string[] = [];
    if (worldEvent.primaryEntityKey) seedEntities.push(worldEvent.primaryEntityKey);
    for (const ek of worldEvent.linkedEntityKeys ?? []) {
      if (!seedEntities.includes(ek)) seedEntities.push(ek);
    }

    // Mark seeds as directly affected
    for (const entityKey of seedEntities) {
      visited.add(entityKey);
      tree.push({
        entityKey,
        impactLevel: severityWeight,
        propagationPath: [entityKey],
        relationship: "direct",
        depth: 0,
      });
    }

    // BFS: propagate through outgoing relationships
    // [entityKey, impactLevel, path, depth]
    const queue: Array<[string, number, string[], number]> = seedEntities.map((ek) => [
      ek,
      severityWeight,
      [ek],
      0,
    ]);

    while (queue.length > 0) {
      const [currentEntity, parentImpact, path, depth] = queue.shift()!;
      if (depth >= maxDepth) continue;

      const outgoing = await getOutgoingEdges(ctx, currentEntity);

      // Filter to propagation-relevant relationship types
      const propagationTypes = new Set([
        "depends_on",
        "supplies",
        "subsidiary_of",
        "partners_with",
        "invests_in",
      ]);

      for (const edge of outgoing) {
        if (!propagationTypes.has(edge.relationshipType)) continue;
        const downstream = edge.relatedEntityKey;
        if (visited.has(downstream)) continue;
        visited.add(downstream);

        // Impact attenuates: parent impact * relationship weight * edge confidence
        const relWeight = PROPAGATION_WEIGHTS[edge.relationshipType] ?? 0.5;
        const impactLevel = parentImpact * relWeight * edge.confidence;

        const newPath = [...path, downstream];

        tree.push({
          entityKey: downstream,
          impactLevel,
          propagationPath: newPath,
          relationship: edge.relationshipType,
          depth: depth + 1,
        });

        // Only propagate further if impact is still meaningful
        if (impactLevel > 0.05) {
          queue.push([downstream, impactLevel, newPath, depth + 1]);
        }
      }
    }

    // Sort by impact level descending
    tree.sort((a, b) => b.impactLevel - a.impactLevel);

    return {
      worldEventId: args.worldEventId,
      eventTitle: worldEvent.title,
      severity: worldEvent.severity,
      seedEntities,
      affectedEntities: tree.length,
      maxDepthReached: tree.length > 0 ? Math.max(...tree.map((n) => n.depth)) : 0,
      tree,
    };
  },
});

// ---------------------------------------------------------------------------
// 5. recordCausalLink — persist an explicit causal link between observations
// ---------------------------------------------------------------------------

export const recordCausalLink = mutation({
  args: {
    fromObservationId: v.id("relationshipObservations"),
    toObservationId: v.id("relationshipObservations"),
    causalStrength: v.number(),
    mechanism: v.string(),
    evidenceRefs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Validate both observations exist
    const fromObs = await ctx.db.get(args.fromObservationId);
    const toObs = await ctx.db.get(args.toObservationId);
    if (!fromObs || !toObs) {
      throw new Error("One or both observations not found");
    }

    // Clamp causal strength to [0, 1]
    const strength = Math.max(0, Math.min(1, args.causalStrength));

    const now = Date.now();
    const edgeKey = `causal:${fromObs.subjectEntityKey}:${toObs.subjectEntityKey}:${now}`;

    // Store as a relationship edge with relationType "causes"
    const edgeId = await ctx.db.insert("relationshipEdges", {
      edgeKey,
      subjectEntityKey: fromObs.subjectEntityKey,
      relatedEntityKey: toObs.subjectEntityKey,
      relatedEntityName: toObs.relatedEntityName ?? toObs.subjectEntityKey,
      relationshipType: "causes",
      direction: "outbound",
      status: "active",
      confidence: strength,
      summary: args.mechanism,
      latestObservationId: args.fromObservationId,
      observationCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      sourceRefs: (args.evidenceRefs ?? []).map((ref) => ({ label: ref })),
      metadata: {
        causalLink: true,
        fromObservationId: args.fromObservationId,
        toObservationId: args.toObservationId,
        mechanism: args.mechanism,
      },
      updatedAt: now,
    });

    return {
      edgeId,
      edgeKey,
      fromEntityKey: fromObs.subjectEntityKey,
      toEntityKey: toObs.subjectEntityKey,
      causalStrength: strength,
    };
  },
});

// ---------------------------------------------------------------------------
// 6. updateCompetitiveMirror — refresh competitive analysis for an entity
// ---------------------------------------------------------------------------

export const updateCompetitiveMirror = mutation({
  args: {
    entityKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find all competitors (both directions)
    const outbound = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_subject_type", (q: any) =>
        q.eq("subjectEntityKey", args.entityKey).eq("relationshipType", "competes_with"),
      )
      .collect();

    const inbound = await ctx.db
      .query("relationshipEdges")
      .withIndex("by_related_type", (q: any) =>
        q.eq("relatedEntityKey", args.entityKey).eq("relationshipType", "competes_with"),
      )
      .collect();

    const competitorKeys = new Set<string>();
    for (const e of outbound) {
      if (e.status === "active") competitorKeys.add(e.relatedEntityKey);
    }
    for (const e of inbound) {
      if (e.status === "active") competitorKeys.add(e.subjectEntityKey);
    }

    // Get target profile
    const targetProfile = await getDimensionProfile(ctx, args.entityKey);
    if (!targetProfile) {
      return { updated: false, reason: "No dimension profile found for target entity" };
    }

    // Compute relative positioning per competitor and refresh edge metadata
    let updatedEdges = 0;

    for (const compKey of competitorKeys) {
      const compProfile = await getDimensionProfile(ctx, compKey);

      // Calculate aggregate advantage score
      let advantageCount = 0;
      let disadvantageCount = 0;
      let totalCompared = 0;

      if (targetProfile.dimensionState && compProfile?.dimensionState) {
        for (const [family, metrics] of Object.entries(targetProfile.dimensionState as Record<string, any>)) {
          const compFamily = (compProfile.dimensionState as any)?.[family];
          if (!compFamily || typeof metrics !== "object") continue;
          for (const [metricName, metric] of Object.entries(metrics as Record<string, any>)) {
            const targetScore = metric?.score;
            const compScore = compFamily?.[metricName]?.score;
            if (targetScore == null || compScore == null) continue;
            totalCompared++;
            if (targetScore > compScore) advantageCount++;
            else if (compScore > targetScore) disadvantageCount++;
          }
        }
      }

      // Update the outbound competitive edge metadata with analysis summary
      const existingEdge = outbound.find((e) => e.relatedEntityKey === compKey);
      if (existingEdge) {
        await ctx.db.patch(existingEdge._id, {
          metadata: {
            ...(existingEdge.metadata ?? {}),
            competitiveAnalysis: {
              advantageCount,
              disadvantageCount,
              totalCompared,
              netAdvantage: advantageCount - disadvantageCount,
              analyzedAt: now,
            },
          },
          lastSeenAt: now,
          updatedAt: now,
        });
        updatedEdges++;
      }
    }

    return {
      updated: true,
      entityKey: args.entityKey,
      competitorsAnalyzed: competitorKeys.size,
      edgesUpdated: updatedEdges,
      analyzedAt: now,
    };
  },
});
