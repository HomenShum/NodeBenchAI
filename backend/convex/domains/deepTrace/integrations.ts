"use node";

import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import { buildCanonicalKey, slugify } from "../../lib/entityResolution";
import {
  buildCausalChainSeedFromWorldEvent,
  buildEntityContextObservationSeeds,
  buildEntityContextWorldEventSeeds,
  buildObservationSeedsFromDueDiligence,
  buildRelationshipObservationSeedsFromExtraction,
  buildWorldEventSeedsFromDueDiligence,
  buildWorldEventSeedsFromExtraction,
  type DeepTraceSourceRef,
  type WorldEventSeed,
} from "./heuristics";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function dedupeSourceRefs(refs: DeepTraceSourceRef[]): DeepTraceSourceRef[] {
  const seen = new Set<string>();
  const deduped: DeepTraceSourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

function artifactSourceRefs(artifact: {
  title?: string;
  sourceUrl?: string;
  fetchedAt: number;
} | null): DeepTraceSourceRef[] {
  if (!artifact) return [];
  return [
    {
      label: artifact.title ?? "Source artifact",
      href: artifact.sourceUrl,
      kind: "source_artifact",
      publishedAtIso: new Date(artifact.fetchedAt).toISOString(),
    },
  ];
}

async function ensureEvidenceForArtifacts(
  ctx: any,
  artifactIds: Id<"sourceArtifacts">[],
  query: string,
) {
  const uniqueArtifactIds = [...new Set(artifactIds)];
  const artifacts: Array<any> = [];
  const chunkIds: Id<"artifactChunks">[] = [];

  for (const artifactId of uniqueArtifactIds.slice(0, 5)) {
    const artifact = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.getArtifactById, {
      artifactId,
    });
    if (!artifact) continue;
    artifacts.push(artifact);
    await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, { artifactId });
    const artifactChunkIds = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.listChunkIdsForArtifact, {
      artifactId,
      limit: 8,
    });
    chunkIds.push(...artifactChunkIds);
  }

  const uniqueChunkIds = [...new Set(chunkIds)].slice(0, 24);
  const evidencePackId =
    uniqueChunkIds.length > 0
      ? await ctx.runMutation(internal.domains.artifacts.evidencePacks.createEvidencePack, {
          runId: artifacts[0]?.runId,
          query,
          scope: { artifactIds: uniqueArtifactIds },
          chunkIds: uniqueChunkIds,
        })
      : undefined;

  return {
    artifacts,
    evidencePackId,
    sourceRefs: dedupeSourceRefs(artifacts.flatMap((artifact: any) => artifactSourceRefs(artifact))),
  };
}

async function ensureCausalChain(ctx: any, event: WorldEventSeed) {
  const seed = buildCausalChainSeedFromWorldEvent(event);
  if (!seed) return undefined;

  const chainKey = `deeptrace:${slugify(seed.title)}:${stableHash(
    [seed.title, seed.entityKey ?? "", String(seed.happenedAt)].join("|"),
  )}`;
  const existing = await ctx.runQuery(api.domains.temporal.queries.getCausalChainByKey, {
    chainKey,
  });
  if (existing?._id) return existing._id;

  return await ctx.runMutation(api.domains.temporal.mutations.insertCausalChain, {
    chainKey,
    title: seed.title,
    entityKey: seed.entityKey,
    rootQuestion: seed.rootQuestion,
    status: "draft",
    timeframeStartAt: seed.happenedAt,
    timeframeEndAt: seed.happenedAt,
    summary: seed.summary,
    plainEnglish: seed.plainEnglish,
    outcome: seed.outcome,
    nodes: seed.nodes,
    sourceRefs: seed.sourceRefs?.map((ref) => ({
      label: ref.label,
      href: ref.href,
      note: ref.note,
    })),
  });
}

async function persistObservationSeeds(
  ctx: any,
  seeds: ReturnType<typeof buildEntityContextObservationSeeds>,
  extra: {
    sourceArtifactId?: Id<"sourceArtifacts">;
    evidencePackId?: Id<"evidencePacks">;
  } = {},
) {
  let count = 0;
  for (const seed of seeds.slice(0, 40)) {
    await ctx.runMutation(api.domains.knowledge.relationshipGraph.ingestObservation, {
      ...seed,
      sourceArtifactId: extra.sourceArtifactId,
      evidencePackId: extra.evidencePackId,
    });
    count += 1;
  }
  return count;
}

async function persistWorldEvents(ctx: any, seeds: WorldEventSeed[]) {
  let count = 0;
  let chainCount = 0;
  for (const event of seeds.slice(0, 20)) {
    const linkedChainId = await ensureCausalChain(ctx, event);
    await ctx.runMutation(api.domains.monitoring.worldMonitor.ingestEvent, {
      ...event,
      linkedChainId,
    });
    count += 1;
    if (linkedChainId) chainCount += 1;
  }
  return { eventCount: count, causalChainCount: chainCount };
}

export const syncEntityContextToDeepTrace = internalAction({
  args: {
    entityContextId: v.id("entityContexts"),
  },
  returns: v.object({
    relationshipCount: v.number(),
    worldEventCount: v.number(),
    causalChainCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const entityContext = await ctx.runQuery(
      internal.domains.knowledge.entityContexts.getEntityContextById,
      { entityId: args.entityContextId },
    );
    if (!entityContext) {
      return { relationshipCount: 0, worldEventCount: 0, causalChainCount: 0 };
    }

    const entityKey =
      entityContext.canonicalKey ??
      buildCanonicalKey(entityContext.entityType, entityContext.entityName);
    const relationshipSeeds = buildEntityContextObservationSeeds({
      entityName: entityContext.entityName,
      entityType: entityContext.entityType,
      entityKey,
      researchedAt: entityContext.researchedAt,
      summary: entityContext.summary,
      people: entityContext.people,
      crmFields: entityContext.crmFields,
      funding: entityContext.funding,
      sources: entityContext.sources,
    });
    const worldEventSeeds = buildEntityContextWorldEventSeeds({
      entityName: entityContext.entityName,
      entityKey,
      recentNewsItems: entityContext.recentNewsItems,
    });

    const relationshipCount = await persistObservationSeeds(ctx, relationshipSeeds);
    const { eventCount: worldEventCount, causalChainCount } = await persistWorldEvents(ctx, worldEventSeeds);
    await ctx.runMutation(internal.domains.deepTrace.dimensions.recomputeDimensionProfileInternal, {
      entityId: args.entityContextId,
      entityKey,
      entityName: entityContext.entityName,
      entityType: entityContext.entityType,
    });

    return { relationshipCount, worldEventCount, causalChainCount };
  },
});

export const syncStructuredSourceTextToDeepTrace = internalAction({
  args: {
    entityKey: v.optional(v.string()),
    entityName: v.optional(v.string()),
    sourceArtifactId: v.id("sourceArtifacts"),
    extraction: v.any(),
    observedAt: v.optional(v.number()),
  },
  returns: v.object({
    relationshipCount: v.number(),
    worldEventCount: v.number(),
    causalChainCount: v.number(),
    evidencePackId: v.optional(v.id("evidencePacks")),
  }),
  handler: async (ctx, args) => {
    const evidence = await ensureEvidenceForArtifacts(
      ctx,
      [args.sourceArtifactId],
      `DeepTrace structured extraction ${args.entityName ?? args.entityKey ?? "unknown"}`,
    );
    const sourceRefs = dedupeSourceRefs(evidence.sourceRefs);
    const relationshipSeeds = buildRelationshipObservationSeedsFromExtraction({
      entityKey: args.entityKey,
      entityName: args.entityName,
      extraction: args.extraction,
      observedAt: args.observedAt,
      sourceRefs,
    });
    const worldEventSeeds = buildWorldEventSeedsFromExtraction({
      entityKey: args.entityKey,
      entityName: args.entityName,
      extraction: args.extraction,
      observedAt: args.observedAt,
      sourceRefs,
    });

    const relationshipCount = await persistObservationSeeds(ctx, relationshipSeeds, {
      sourceArtifactId: args.sourceArtifactId,
      evidencePackId: evidence.evidencePackId,
    });
    const { eventCount: worldEventCount, causalChainCount } = await persistWorldEvents(ctx, worldEventSeeds);
    await ctx.runMutation(internal.domains.deepTrace.dimensions.recomputeDimensionProfileInternal, {
      entityKey: args.entityKey,
      entityName: args.entityName,
    });

    return {
      relationshipCount,
      worldEventCount,
      causalChainCount,
      evidencePackId: evidence.evidencePackId,
    };
  },
});

export const syncDueDiligenceBranchToDeepTrace = internalAction({
  args: {
    jobId: v.string(),
    branchType: v.string(),
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("person"), v.literal("fund")),
    findings: v.any(),
    sources: v.array(v.any()),
    confidence: v.optional(v.number()),
  },
  returns: v.object({
    relationshipCount: v.number(),
    worldEventCount: v.number(),
    causalChainCount: v.number(),
    artifactId: v.optional(v.id("sourceArtifacts")),
    evidencePackId: v.optional(v.id("evidencePacks")),
  }),
  handler: async (ctx, args) => {
    const sourceUrl = (args.sources.find((source: any) => typeof source?.url === "string" && source.url.trim())?.url ?? undefined) as
      | string
      | undefined;
    const artifact = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
      sourceType: "extracted_text",
      sourceUrl,
      title: `${args.entityName} ${args.branchType} due diligence findings`,
      rawContent: JSON.stringify(args.findings, null, 2),
      extractedData: {
        kind: "deeptrace_due_diligence_branch",
        jobId: args.jobId,
        branchType: args.branchType,
        sourceCount: args.sources.length,
      },
      fetchedAt: Date.now(),
    });
    const evidence = await ensureEvidenceForArtifacts(
      ctx,
      [artifact.id],
      `DeepTrace due diligence ${args.entityName} ${args.branchType}`,
    );

    const relationshipSeeds = buildObservationSeedsFromDueDiligence({
      entityName: args.entityName,
      entityType: args.entityType,
      branchType: args.branchType,
      findings: args.findings,
      sources: args.sources,
      confidence: args.confidence,
      observedAt: Date.now(),
    });
    const worldEventSeeds = buildWorldEventSeedsFromDueDiligence({
      entityName: args.entityName,
      entityType: args.entityType,
      branchType: args.branchType,
      findings: args.findings,
      sources: args.sources,
      confidence: args.confidence,
      observedAt: Date.now(),
    });

    const relationshipCount = await persistObservationSeeds(ctx, relationshipSeeds, {
      sourceArtifactId: artifact.id,
      evidencePackId: evidence.evidencePackId,
    });
    const { eventCount: worldEventCount, causalChainCount } = await persistWorldEvents(ctx, worldEventSeeds);
    const canonicalEntityKey = buildCanonicalKey(args.entityType, args.entityName);
    await ctx.runMutation(internal.domains.deepTrace.dimensions.recomputeDimensionProfileInternal, {
      entityKey: canonicalEntityKey,
      entityName: args.entityName,
      entityType: args.entityType,
      triggerEventKey: `${args.branchType}:${args.jobId}`,
    });

    return {
      relationshipCount,
      worldEventCount,
      causalChainCount,
      artifactId: artifact.id,
      evidencePackId: evidence.evidencePackId,
    };
  },
});

export const syncNarrativeEventToDeepTrace = internalAction({
  args: {
    eventId: v.id("narrativeEvents"),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    fallbackEntityKey: v.optional(v.string()),
  },
  returns: v.object({
    worldEventCount: v.number(),
    causalChainCount: v.number(),
    evidencePackId: v.optional(v.id("evidencePacks")),
  }),
  handler: async (ctx, args) => {
    const event = await ctx.runQuery(api.domains.narrative.queries.events.getEvent, {
      eventId: args.eventId,
    });
    if (!event) {
      return { worldEventCount: 0, causalChainCount: 0, evidencePackId: undefined };
    }

    const artifactIds = (args.artifactIds ?? ((event as any).artifactIds ?? [])) as Id<"sourceArtifacts">[];
    const evidence =
      artifactIds.length > 0
        ? await ensureEvidenceForArtifacts(
            ctx,
            artifactIds,
            `DeepTrace narrative event ${(event as any).headline}`,
          )
        : { evidencePackId: undefined, sourceRefs: [] as DeepTraceSourceRef[] };

    const sourceRefs = dedupeSourceRefs([
      ...evidence.sourceRefs,
      ...(((event as any).sourceUrls ?? []) as string[]).map((url, index) => ({
        label: ((event as any).sourceNames ?? [])[index] ?? `Event source ${index + 1}`,
        href: url,
        kind: "narrative_event",
      })),
    ]);

    const primaryEntityKey =
      args.fallbackEntityKey ??
      (((event as any).claimSet?.entities ?? [])[0]?.canonicalKey as string | undefined);
    const severity =
      (event as any).significance === "plot_twist"
        ? "high"
        : (event as any).significance === "major"
          ? "high"
          : (event as any).significance === "moderate"
            ? "medium"
            : "low";

    const worldEventSeed: WorldEventSeed = {
      title: (event as any).headline,
      summary: (event as any).summary,
      topic: "narrative event",
      severity,
      happenedAt: (event as any).occurredAt,
      detectedAt: (event as any).discoveredAt,
      primaryEntityKey,
      linkedEntityKeys: primaryEntityKey ? [primaryEntityKey] : undefined,
      sourceRefs,
      metadata: {
        source: "newsroom_postprocess",
        significance: (event as any).significance,
      },
      causalSummary:
        severity === "high"
          ? `${(event as any).headline} may alter sentiment, competitive posture, or operating conditions for linked entities.`
          : undefined,
    };

    const { eventCount: worldEventCount, causalChainCount } = await persistWorldEvents(ctx, [worldEventSeed]);
    if (primaryEntityKey) {
      await ctx.runMutation(internal.domains.deepTrace.dimensions.recomputeDimensionProfileInternal, {
        entityKey: primaryEntityKey,
        entityName: primaryEntityKey,
        triggerEventKey: worldEventSeed.title,
      });
    }
    return { worldEventCount, causalChainCount, evidencePackId: evidence.evidencePackId };
  },
});
