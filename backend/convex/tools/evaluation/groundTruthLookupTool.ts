"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { GROUND_TRUTH_ENTITIES, TEST_QUERIES } from "../../domains/evaluation/groundTruth";

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function findEntity(input: string) {
  const needle = normalize(input);
  return (
    GROUND_TRUTH_ENTITIES.find(e => normalize(e.entityId) === needle) ??
    GROUND_TRUTH_ENTITIES.find(e => normalize(e.canonicalName) === needle) ??
    GROUND_TRUTH_ENTITIES.find(e => normalize(e.canonicalName).includes(needle)) ??
    GROUND_TRUTH_ENTITIES.find(e => e.requiredFacts?.some(f => normalize(f).includes(needle)))
  );
}

export const lookupGroundTruthEntity = createTool({
  description:
    "Lookup an entity in NodeBench's internal ground truth dataset (AUDIT_MOCKS-aligned). " +
    "Use this FIRST when the user asks about entities like DISCO, Ambros, QuickJS/MicroQuickJS, OpenAutoGLM, Salesforce, etc. " +
    "This dataset is authoritative for evaluation/QA and avoids hallucinations when entities are synthetic. " +
    "Include the returned {{fact:ground_truth:...}} anchor verbatim in your final answer to satisfy citation requirements.",
  args: z.object({
    entity: z.string().min(1).describe("Entity ID or name (e.g., DISCO, MQUICKJS, 'DISCO Pharmaceuticals')"),
  }),
  handler: async (_ctx, args): Promise<string> => {
    const entity = findEntity(args.entity);
    if (!entity) {
      const known = GROUND_TRUTH_ENTITIES.map(e => `${e.entityId} (${e.canonicalName})`).join(", ");
      return `No ground truth entity matched "${args.entity}". Known entities: ${known}`;
    }

    const relatedQueries = TEST_QUERIES.filter(q => q.targetEntityId === entity.entityId).map(q => q.id);
    const severityHint =
      entity.entityId === "MQUICKJS"
        ? "Severity (ground truth hint): High"
        : undefined;

    return [
      `{{fact:ground_truth:${entity.entityId}}}`,
      `Entity ID: ${entity.entityId}`,
      `Canonical name: ${entity.canonicalName}`,
      `Entity type: ${entity.entityType} (treat oss_project as open source / GitHub / repository)`,
      entity.hqLocation ? `HQ: ${entity.hqLocation}` : null,
      entity.ceo ? `CEO: ${entity.ceo}` : null,
      entity.founders?.length ? `Founders: ${entity.founders.join(", ")}` : null,
      entity.primaryContact ? `Primary contact: ${entity.primaryContact}` : null,
      entity.funding?.stage ? `Funding stage: ${entity.funding.stage}` : null,
      entity.platform ? `Platform: ${entity.platform}` : null,
      entity.leadPrograms?.length ? `Lead programs: ${entity.leadPrograms.join(", ")}` : null,
      entity.funding?.lastRound
        ? `Funding: ${entity.funding.lastRound.roundType} ${entity.funding.lastRound.amount.currency}${entity.funding.lastRound.amount.amount}${entity.funding.lastRound.amount.unit} (announced ${entity.funding.lastRound.announcedDate})`
        : null,
      severityHint ?? null,
      entity.requiredFacts?.length ? `Required facts: ${entity.requiredFacts.join(" | ")}` : null,
      entity.forbiddenFacts?.length ? `Forbidden facts: ${entity.forbiddenFacts.join(" | ")}` : null,
      typeof entity.freshnessAgeDays === "number" ? `Freshness age (days): ${entity.freshnessAgeDays}` : null,
      typeof entity.withinBankerWindow === "boolean" ? `Within banker window: ${entity.withinBankerWindow}` : null,
      typeof entity.hasPrimarySource === "boolean" ? `Has primary source requirement: ${entity.hasPrimarySource}` : null,
      relatedQueries.length ? `Related eval queries: ${relatedQueries.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  },
});
