import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";

const OWNERSHIP_TYPES = new Set([
  "holder",
  "beneficial_owner",
  "owner",
  "investor",
  "board_member",
  "executive",
  "founder",
]);

const SUPPLY_CHAIN_TYPES = new Set([
  "supplier",
  "customer",
  "partner",
  "subsidiary",
  "distributor",
]);

const COMPETITOR_TYPES = new Set(["competitor"]);

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeSourceRefs(sourceRefs?: Array<any>) {
  if (!sourceRefs?.length) return undefined;
  const seen = new Set<string>();
  const deduped: Array<any> = [];
  for (const ref of sourceRefs) {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

function sortByTimestampDesc<T extends { observedAt?: number; time?: number; lastSeenAt?: number; detectedAt?: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const aTime = a.observedAt ?? a.time ?? a.lastSeenAt ?? a.detectedAt ?? 0;
    const bTime = b.observedAt ?? b.time ?? b.lastSeenAt ?? b.detectedAt ?? 0;
    return bTime - aTime;
  });
}

async function loadEntityContext(ctx: any, entityKey: string, entityName?: string) {
  let entityContext =
    (await ctx.db
      .query("entityContexts")
      .withIndex("by_canonicalKey", (q: any) => q.eq("canonicalKey", entityKey))
      .first()) ?? null;

  if (!entityContext && entityName) {
    entityContext =
      (await ctx.db
        .query("entityContexts")
        .withIndex("by_entity", (q: any) => q.eq("entityName", entityName).eq("entityType", "company"))
        .first()) ??
      (await ctx.db
        .query("entityContexts")
        .withIndex("by_entity", (q: any) => q.eq("entityName", entityName).eq("entityType", "person"))
        .first()) ??
      null;
  }

  return entityContext;
}

async function loadAdaptiveProfile(ctx: any, entityName?: string) {
  if (!entityName) return null;
  return (
    (await ctx.db
      .query("adaptiveEntityProfiles")
      .withIndex("by_name", (q: any) => q.eq("entityName", entityName))
      .first()) ?? null
  );
}

function buildDerivedEdges(params: {
  entityContext: any;
  adaptiveProfile: any;
  entityKey: string;
  entityName?: string;
}) {
  const { entityContext, adaptiveProfile, entityKey, entityName } = params;
  const crm = entityContext?.crmFields;
  const funding = entityContext?.funding;
  const people = entityContext?.people;
  const sourceRefs = dedupeSourceRefs(entityContext?.sources);
  const baseSummary = entityContext?.summary ?? adaptiveProfile?.profile?.executiveSummary?.whatTheyreKnownFor ?? null;
  const fallbackName = entityName ?? entityContext?.entityName ?? entityKey;
  const referenceTime = entityContext?.researchedAt ?? adaptiveProfile?.updatedAt ?? 0;

  const pushEdge = (
    edges: Array<any>,
    relationshipType: string,
    relatedEntityName: string,
    relatedEntityType: string,
    summary?: string,
  ) => {
    if (!relatedEntityName?.trim()) return;
    const relatedEntityKey = `${relatedEntityType}:${slugify(relatedEntityName)}`;
    const edgeKey = `${entityKey}:${relationshipType}:${relatedEntityKey}`;
    edges.push({
      edgeKey,
      subjectEntityKey: entityKey,
      relatedEntityKey,
      relatedEntityName,
      relatedEntityType,
      relationshipType,
      direction: relationshipType === "competitor" ? "bidirectional" : "outbound",
      status: "active",
      confidence: 0.58,
      freshness: entityContext?.freshness?.daysSinceUpdate,
      summary:
        summary ??
        `${fallbackName} is connected to ${relatedEntityName} as ${relationshipType.replace(/_/g, " ")}.`,
      observationCount: 0,
      firstSeenAt: referenceTime,
      lastSeenAt: referenceTime,
      sourceRefs,
      metadata: {
        derived: true,
        source: "entity_context",
      },
    });
  };

  const edges: Array<any> = [];

  for (const investor of [...(crm?.investors ?? []), ...(funding?.investors ?? [])]) {
    pushEdge(edges, "investor", investor, "organization", crm?.investorBackground);
  }

  for (const founder of crm?.founders ?? []) {
    pushEdge(edges, "founder", founder, "person", crm?.foundersBackground);
  }

  for (const person of crm?.keyPeople ?? []) {
    pushEdge(
      edges,
      person?.title?.toLowerCase().includes("board") ? "board_member" : "executive",
      person?.name,
      "person",
      person?.title,
    );
  }

  for (const person of people ?? []) {
    if (!person?.name) continue;
    pushEdge(
      edges,
      String(person?.title ?? "").toLowerCase().includes("board") ? "board_member" : "executive",
      person.name,
      "person",
      person.title,
    );
  }

  for (const competitor of crm?.competitors ?? []) {
    pushEdge(edges, "competitor", competitor, "organization", crm?.competitorAnalysis);
  }

  for (const partner of crm?.partnerships ?? []) {
    const lowered = partner.toLowerCase();
    const relationshipType = lowered.includes("supplier")
      ? "supplier"
      : lowered.includes("customer")
        ? "customer"
        : lowered.includes("subsidiar")
          ? "subsidiary"
          : "partner";
    pushEdge(edges, relationshipType, partner, "organization", baseSummary ?? undefined);
  }

  for (const relation of adaptiveProfile?.profile?.relationships ?? adaptiveProfile?.relationships ?? []) {
    pushEdge(
      edges,
      slugify(relation.relationshipType ?? "relationship").replace(/-/g, "_"),
      relation.entityName,
      relation.entityType ?? "entity",
      relation.context,
    );
  }

  const deduped = new Map<string, any>();
  for (const edge of edges) {
    if (!edge.relatedEntityName) continue;
    if (!deduped.has(edge.edgeKey)) {
      deduped.set(edge.edgeKey, edge);
    }
  }
  return [...deduped.values()];
}

function mergeEdges(storedEdges: Array<any>, derivedEdges: Array<any>) {
  const merged = new Map<string, any>();
  for (const edge of [...storedEdges, ...derivedEdges]) {
    const existing = merged.get(edge.edgeKey);
    if (!existing) {
      merged.set(edge.edgeKey, edge);
      continue;
    }
    merged.set(edge.edgeKey, {
      ...existing,
      ...edge,
      confidence: Math.max(existing.confidence ?? 0, edge.confidence ?? 0),
      observationCount: Math.max(existing.observationCount ?? 0, edge.observationCount ?? 0),
      sourceRefs: dedupeSourceRefs([...(existing.sourceRefs ?? []), ...(edge.sourceRefs ?? [])]),
      metadata: {
        ...(existing.metadata ?? {}),
        ...(edge.metadata ?? {}),
      },
    });
  }
  return sortByTimestampDesc([...merged.values()]);
}

async function loadEntityGraphData(
  ctx: any,
  args: { entityKey: string; entityName?: string; limit?: number },
) {
  const limit = args.limit ?? 24;
  const storedEdges = (
    await ctx.db
      .query("relationshipEdges")
      .withIndex("by_last_seen", (q: any) => q.eq("subjectEntityKey", args.entityKey))
      .order("desc")
      .take(limit)
  ).map((edge: any) => ({
    ...edge,
    metadata: {
      ...(edge.metadata ?? {}),
      source: "stored",
    },
  }));

  const observations = await ctx.db
    .query("relationshipObservations")
    .withIndex("by_subject_time", (q: any) => q.eq("subjectEntityKey", args.entityKey))
    .order("desc")
    .take(limit);

  const entityContext = await loadEntityContext(ctx, args.entityKey, args.entityName);
  const adaptiveProfile = await loadAdaptiveProfile(ctx, args.entityName ?? entityContext?.entityName);
  const derivedEdges = buildDerivedEdges({
    entityContext,
    adaptiveProfile,
    entityKey: args.entityKey,
    entityName: args.entityName,
  });

  const edges = mergeEdges(storedEdges, derivedEdges).slice(0, limit);
  const nodes = [
    {
      entityKey: args.entityKey,
      entityName: args.entityName ?? entityContext?.entityName ?? args.entityKey,
      entityType: entityContext?.entityType ?? "entity",
      role: "focus",
    },
    ...edges.map((edge: any) => ({
      entityKey: edge.relatedEntityKey,
      entityName: edge.relatedEntityName,
      entityType: edge.relatedEntityType ?? "entity",
      role: edge.relationshipType,
    })),
  ];

  const dedupedNodes = new Map<string, any>();
  for (const node of nodes) {
    if (!dedupedNodes.has(node.entityKey)) {
      dedupedNodes.set(node.entityKey, node);
    }
  }

  return {
    entityKey: args.entityKey,
    entityName: args.entityName ?? entityContext?.entityName ?? null,
    source:
      storedEdges.length && derivedEdges.length
        ? "mixed"
        : storedEdges.length
          ? "stored"
          : derivedEdges.length
            ? "derived"
            : "empty",
    nodes: [...dedupedNodes.values()],
    edges,
    observations,
    summary: entityContext?.summary ?? adaptiveProfile?.profile?.executiveSummary?.keyInsight ?? null,
    dataQuality: entityContext?.crmFields?.dataQuality ?? null,
  };
}

async function upsertMaterializedEdge(ctx: any, args: {
  subjectEntityKey: string;
  subjectEntityId?: any;
  relatedEntityKey: string;
  relatedEntityId?: any;
  relatedEntityName: string;
  relatedEntityType?: string;
  relationshipType: string;
  direction?: "outbound" | "inbound" | "bidirectional";
}) {
  const observationCandidates = await ctx.db
    .query("relationshipObservations")
    .withIndex("by_subject_type_time", (q: any) =>
      q.eq("subjectEntityKey", args.subjectEntityKey).eq("relationshipType", args.relationshipType),
    )
    .collect();

  const observations = observationCandidates.filter(
    (ob: any) => ob.relatedEntityKey === args.relatedEntityKey,
  ) as any[];

  if (!observations.length) {
    throw new Error("No observations found for this relationship edge");
  }

  const latest = sortByTimestampDesc(observations)[0] as any;
  const confidence =
    observations.reduce((sum: number, item: any) => sum + (item.confidence ?? 0), 0) / observations.length;
  const sourceRefs = dedupeSourceRefs(observations.flatMap((item: any) => item.sourceRefs ?? []));
  const edgeKey = `${args.subjectEntityKey}:${args.relationshipType}:${args.relatedEntityKey}`;

  const existing = await ctx.db
    .query("relationshipEdges")
    .withIndex("by_edge_key", (q: any) => q.eq("edgeKey", edgeKey))
    .first();

  const payload = {
    edgeKey,
    subjectEntityKey: args.subjectEntityKey,
    subjectEntityId: args.subjectEntityId,
    relatedEntityKey: args.relatedEntityKey,
    relatedEntityId: args.relatedEntityId,
    relatedEntityName: args.relatedEntityName,
    relatedEntityType: args.relatedEntityType,
    relationshipType: args.relationshipType,
    direction: args.direction ?? latest.direction ?? "outbound",
    status: latest.status,
    confidence: Number(confidence.toFixed(3)),
    freshness: latest.freshness,
    summary: latest.summary ?? latest.claimText,
    latestObservationId: latest._id,
    observationCount: observations.length,
    firstSeenAt: Math.min(...observations.map((item: any) => item.observedAt)),
    lastSeenAt: Math.max(...observations.map((item: any) => item.observedAt)),
    sourceRefs,
    linkedChainId: latest.linkedChainId,
    metadata: {
      observationHashes: observations.map((item: any) => item.observationHash),
    },
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return { edgeId: existing._id, edgeKey, materialized: "updated" as const };
  }

  const edgeId = await ctx.db.insert("relationshipEdges", payload);
  return { edgeId, edgeKey, materialized: "created" as const };
}

export const ingestObservation = mutation({
  args: {
    subjectEntityKey: v.string(),
    subjectEntityId: v.optional(v.id("entityContexts")),
    relatedEntityKey: v.string(),
    relatedEntityId: v.optional(v.id("entityContexts")),
    relatedEntityName: v.string(),
    relatedEntityType: v.optional(v.string()),
    relationshipType: v.string(),
    direction: v.optional(v.union(v.literal("outbound"), v.literal("inbound"), v.literal("bidirectional"))),
    claimText: v.string(),
    summary: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("active"), v.literal("watch"), v.literal("historical"), v.literal("disputed")),
    ),
    confidence: v.number(),
    freshness: v.optional(v.number()),
    effectiveAt: v.optional(v.number()),
    observedAt: v.number(),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          note: v.optional(v.string()),
          kind: v.optional(v.string()),
          publishedAtIso: v.optional(v.string()),
        }),
      ),
    ),
    sourceArtifactId: v.optional(v.id("sourceArtifacts")),
    evidencePackId: v.optional(v.id("evidencePacks")),
    linkedChainId: v.optional(v.id("causalChains")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const observationKey = `obs_${stableHash(
      [
        args.subjectEntityKey,
        args.relatedEntityKey,
        args.relationshipType,
        args.claimText,
        String(args.observedAt),
      ].join("|"),
    )}`;
    const observationHash = stableHash(
      [
        args.subjectEntityKey,
        args.relatedEntityKey,
        args.relationshipType,
        args.claimText,
        JSON.stringify(args.sourceRefs ?? []),
      ].join("|"),
    );

    const existing = await ctx.db
      .query("relationshipObservations")
      .withIndex("by_hash", (q) => q.eq("observationHash", observationHash))
      .first();

    let observationId = existing?._id ?? null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        observationKey,
        observationHash,
        status: args.status ?? "active",
        updatedAt: now,
      });
      observationId = existing._id;
    } else {
      observationId = await ctx.db.insert("relationshipObservations", {
        ...args,
        observationKey,
        observationHash,
        status: args.status ?? "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    const materialized = await upsertMaterializedEdge(ctx, {
      subjectEntityKey: args.subjectEntityKey,
      subjectEntityId: args.subjectEntityId,
      relatedEntityKey: args.relatedEntityKey,
      relatedEntityId: args.relatedEntityId,
      relatedEntityName: args.relatedEntityName,
      relatedEntityType: args.relatedEntityType,
      relationshipType: args.relationshipType,
      direction: args.direction,
    });

    return {
      observationId,
      observationKey,
      edgeId: materialized.edgeId,
      edgeKey: materialized.edgeKey,
    };
  },
});

export const materializeEdge = mutation({
  args: {
    subjectEntityKey: v.string(),
    subjectEntityId: v.optional(v.id("entityContexts")),
    relatedEntityKey: v.string(),
    relatedEntityId: v.optional(v.id("entityContexts")),
    relatedEntityName: v.string(),
    relatedEntityType: v.optional(v.string()),
    relationshipType: v.string(),
    direction: v.optional(v.union(v.literal("outbound"), v.literal("inbound"), v.literal("bidirectional"))),
  },
  handler: async (ctx, args) => {
    return await upsertMaterializedEdge(ctx, args);
  },
});

export const getEntityGraph = query({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await loadEntityGraphData(ctx, args);
  },
});

export const getRelationshipTimeline = query({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const stored = await ctx.db
      .query("relationshipObservations")
      .withIndex("by_subject_time", (q) => q.eq("subjectEntityKey", args.entityKey))
      .order("desc")
      .take(limit);

    const entityContext = await loadEntityContext(ctx, args.entityKey, args.entityName);
    const adaptiveProfile = await loadAdaptiveProfile(ctx, args.entityName ?? entityContext?.entityName);
    const referenceTime = entityContext?.researchedAt ?? adaptiveProfile?.updatedAt ?? 0;

    const derivedTimeline = [
      ...(entityContext?.crmFields?.newsTimeline ?? []).map((item: any, index: number) => ({
        timelineKey: `crm_news_${index}`,
        time: item?.date ? Date.parse(item.date) || referenceTime : referenceTime,
        title: item?.headline ?? "News timeline item",
        summary: item?.source ?? entityContext?.summary ?? "",
        relationshipType: "news_timeline",
        relatedEntityName: undefined,
        sourceRefs: entityContext?.sources,
        source: "entity_context",
      })),
      ...(entityContext?.recentNewsItems ?? []).map((item: any, index: number) => ({
        timelineKey: `recent_news_${index}`,
        time: item?.publishedAt ? Number(item.publishedAt) : referenceTime,
        title: item?.headline ?? item?.title ?? "Recent news item",
        summary: item?.summary ?? item?.source ?? "",
        relationshipType: "news_timeline",
        relatedEntityName: undefined,
        sourceRefs: item?.url
          ? [{ label: item?.source ?? "Source", href: item.url }]
          : entityContext?.sources,
        source: "entity_context",
      })),
      ...(adaptiveProfile?.profile?.timeline ?? adaptiveProfile?.timeline ?? []).map((item: any, index: number) => ({
        timelineKey: `adaptive_timeline_${index}`,
        time: item?.date ? Date.parse(item.date) || referenceTime : referenceTime,
        title: item?.title ?? "Relationship event",
        summary: item?.description ?? "",
        relationshipType: item?.category ?? "timeline",
        relatedEntityName: item?.relatedEntities?.[0]?.name,
        sourceRefs: entityContext?.sources,
        source: "adaptive_profile",
      })),
    ];

    const combined = sortByTimestampDesc([
      ...stored.map((item: any) => ({
        timelineKey: item.observationKey,
        time: item.observedAt,
        title: item.relatedEntityName,
        summary: item.summary ?? item.claimText,
        relationshipType: item.relationshipType,
        relatedEntityName: item.relatedEntityName,
        sourceRefs: item.sourceRefs,
        source: "stored",
      })),
      ...derivedTimeline,
    ]).slice(0, limit);

    return {
      entityKey: args.entityKey,
      items: combined,
    };
  },
});

export const getOwnershipSnapshot = query({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const graph = await loadEntityGraphData(ctx, {
      entityKey: args.entityKey,
      entityName: args.entityName,
      limit: 40,
    });
    const ownershipEdges = graph.edges.filter((edge: any) => OWNERSHIP_TYPES.has(edge.relationshipType));

    return {
      entityKey: args.entityKey,
      totalConnections: ownershipEdges.length,
      holders: ownershipEdges.filter((edge: any) => ["holder", "beneficial_owner", "owner"].includes(edge.relationshipType)),
      investors: ownershipEdges.filter((edge: any) => edge.relationshipType === "investor"),
      board: ownershipEdges.filter((edge: any) => edge.relationshipType === "board_member"),
      executives: ownershipEdges.filter((edge: any) => edge.relationshipType === "executive"),
      founders: ownershipEdges.filter((edge: any) => edge.relationshipType === "founder"),
      source: graph.source,
    };
  },
});

export const getSupplyChainView = query({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const graph = await loadEntityGraphData(ctx, {
      entityKey: args.entityKey,
      entityName: args.entityName,
      limit: 40,
    });
    const supplyChainEdges = graph.edges.filter((edge: any) => SUPPLY_CHAIN_TYPES.has(edge.relationshipType));
    const competitorEdges = graph.edges.filter((edge: any) => COMPETITOR_TYPES.has(edge.relationshipType));

    return {
      entityKey: args.entityKey,
      suppliers: supplyChainEdges.filter((edge: any) => edge.relationshipType === "supplier"),
      customers: supplyChainEdges.filter((edge: any) => edge.relationshipType === "customer"),
      partners: supplyChainEdges.filter((edge: any) => edge.relationshipType === "partner"),
      subsidiaries: supplyChainEdges.filter((edge: any) => edge.relationshipType === "subsidiary"),
      competitors: competitorEdges,
      source: graph.source,
    };
  },
});
