/**
 * expandResource — ring-bounded expansion of a canonical entity.
 *
 * Reads from the canonical entity graph:
 *   intelligenceEntities + entityAliases + edges + claims + claimEvidence
 *
 * Returns a ResourceCard[] + evidence + nextHops shaped to `ExpandResponse`
 * from shared/research/resourceCards.ts. The API route is a thin adapter.
 *
 * Bounds (BOUND rule, agentic_reliability.md):
 *   - hard cap of 60 cards per call
 *   - hard cap of 80 edges traversed per call
 *   - hard cap of 40 evidence rows per call
 */

import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import { COMPANY_DOSSIER_LENS, getLensTemplate } from "./lensRegistry";

const HARD_CARD_CAP = 60;
const HARD_EDGE_CAP = 80;
const HARD_EVIDENCE_CAP = 40;

function entityUri(kind: string, id: string): string {
  // intelligenceEntities.entityType values map onto URI kinds.
  const uriKind =
    kind === "person"
      ? "person"
      : kind === "product"
      ? "product"
      : "org";
  return `nodebench://${uriKind}/${id}`;
}

function companySlugToUri(slug: string): string {
  return `nodebench://org/${slug}`;
}

export const expand = query({
  args: {
    entityKey: v.optional(v.string()),
    entityId: v.optional(v.id("intelligenceEntities")),
    lensId: v.optional(v.string()),
    depth: v.optional(v.union(v.literal("quick"), v.literal("standard"))),
  },
  handler: async (ctx, { entityKey, entityId, lensId, depth }) => {
    const resolvedDepth = depth ?? "standard";
    const lens = getLensTemplate((lensId as any) ?? "company_dossier")
      ?? COMPANY_DOSSIER_LENS;

    // Resolve root entity ----------------------------------------------------
    let root: Doc<"intelligenceEntities"> | null = null;
    if (entityId) {
      root = await ctx.db.get(entityId);
    } else if (entityKey) {
      root = await ctx.db
        .query("intelligenceEntities")
        .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
        .unique();
    }
    if (!root) {
      return {
        rootUri: "nodebench://org/unknown",
        lensId: lens.id,
        depth: resolvedDepth,
        cards: [],
        evidence: [],
        nextHops: [],
        builtAt: Date.now(),
        fromCache: false,
        status: "not_found" as const,
      };
    }

    const rootUri = companySlugToUri(root.entityKey);

    // Collect outgoing + incoming edges, bounded ----------------------------
    const outgoing = await ctx.db
      .query("edges")
      .withIndex("by_from_rel", (q) => q.eq("fromId", root._id))
      .take(HARD_EDGE_CAP);
    const budgetRemaining = Math.max(0, HARD_EDGE_CAP - outgoing.length);
    const incoming = budgetRemaining > 0
      ? await ctx.db
          .query("edges")
          .withIndex("by_to_rel", (q) => q.eq("toId", root._id))
          .take(budgetRemaining)
      : [];

    // Group neighbours per layer per the lens relationWhitelist -------------
    type NeighborInfo = {
      entity: Doc<"intelligenceEntities">;
      via: { direction: "out" | "in"; relationType: string; confidence: number };
    };

    const neighbourById = new Map<Id<"intelligenceEntities">, NeighborInfo>();

    for (const e of outgoing) {
      const neighbour = await ctx.db.get(e.toId);
      if (!neighbour) continue;
      if (!neighbourById.has(neighbour._id)) {
        neighbourById.set(neighbour._id, {
          entity: neighbour,
          via: {
            direction: "out",
            relationType: e.relationType,
            confidence: e.confidence,
          },
        });
      }
    }
    for (const e of incoming) {
      const neighbour = await ctx.db.get(e.fromId);
      if (!neighbour) continue;
      if (!neighbourById.has(neighbour._id)) {
        neighbourById.set(neighbour._id, {
          entity: neighbour,
          via: {
            direction: "in",
            relationType: e.relationType,
            confidence: e.confidence,
          },
        });
      }
    }

    // Emit cards ------------------------------------------------------------
    const cards: Array<Record<string, unknown>> = [];

    // Root card always first.
    cards.push({
      cardId: `card-${root._id}`,
      uri: rootUri,
      kind: "org_summary",
      title: root.canonicalName,
      subtitle: root.sector ?? undefined,
      summary: root.description ?? "",
      chips: [
        { label: root.entityType, tone: "default" as const },
        ...(root.status !== "active"
          ? [{ label: root.status, tone: "warn" as const }]
          : []),
      ],
      keyFacts: [
        ...(root.foundedYear ? [`Founded ${root.foundedYear}`] : []),
        ...(root.headquarters ? [`HQ: ${root.headquarters}`] : []),
      ],
      nextHops: [],
      confidence: 1,
    });

    // Per-layer cards respecting maxItems per layer.
    const perLayerCounts = new Map<string, number>();
    for (const layer of lens.layers) {
      perLayerCounts.set(layer.id, 0);
    }

    for (const info of neighbourById.values()) {
      if (cards.length >= HARD_CARD_CAP) break;
      for (const layer of lens.layers) {
        const layerCount = perLayerCounts.get(layer.id) ?? 0;
        if (layerCount >= layer.maxItems) continue;
        if (!layer.allowedEntityTypes.includes(info.entity.entityType)) continue;
        if (!layer.relationWhitelist.includes(info.via.relationType)) continue;

        cards.push({
          cardId: `card-${info.entity._id}`,
          uri: entityUri(info.entity.entityType, info.entity.entityKey),
          kind:
            info.entity.entityType === "person"
              ? "person_summary"
              : info.entity.entityType === "product"
              ? "product_summary"
              : "org_summary",
          title: info.entity.canonicalName,
          subtitle: info.via.relationType.replaceAll("_", " ").toLowerCase(),
          summary: info.entity.description ?? "",
          chips: [
            { label: layer.label, tone: "accent" as const },
            { label: info.entity.entityType, tone: "default" as const },
          ],
          nextHops: [],
          confidence: info.via.confidence,
        });
        perLayerCounts.set(layer.id, layerCount + 1);
        break;
      }
    }

    // Evidence ring --------------------------------------------------------
    const topClaims = await ctx.db
      .query("claims")
      .withIndex("by_subject", (q) => q.eq("subjectEntityId", root._id))
      .take(20);

    const evidence: Array<Record<string, unknown>> = [];
    for (const c of topClaims) {
      if (evidence.length >= HARD_EVIDENCE_CAP) break;
      const evs = await ctx.db
        .query("claimEvidence")
        .withIndex("by_claim", (q) => q.eq("claimId", c._id))
        .take(Math.max(1, HARD_EVIDENCE_CAP - evidence.length));
      for (const ev of evs) {
        evidence.push({
          claim: c.literalValue ?? `${c.predicate}`,
          uri: ev.url
            ? `nodebench://artifact/${ev.url}`
            : `nodebench://artifact/${ev._id}`,
          confidence: c.confidence,
        });
        if (evidence.length >= HARD_EVIDENCE_CAP) break;
      }
    }

    // Next hops = up to 12 highest-confidence neighbours not already carded
    const nextHops = Array.from(neighbourById.values())
      .sort((a, b) => b.via.confidence - a.via.confidence)
      .slice(0, 12)
      .map((info) => entityUri(info.entity.entityType, info.entity.entityKey));

    return {
      rootUri,
      lensId: lens.id,
      depth: resolvedDepth,
      cards,
      evidence,
      nextHops,
      builtAt: Date.now(),
      fromCache: false,
      status: "ok" as const,
    };
  },
});
