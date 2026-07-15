import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

import { digestCanonical } from "./hash";
import {
  AUTONOMY_LIMITS,
  AutonomyPolicyError,
  type AutonomyValidationCheck,
} from "./policy";

export const AUTONOMY_DILIGENCE_BLOCK_TYPES = [
  "projection",
  "founder",
  "product",
  "funding",
  "news",
  "hiring",
  "patent",
  "publicOpinion",
  "competitor",
  "regulatory",
  "financial",
] as const;

export type AutonomyDiligenceBlockType =
  (typeof AUTONOMY_DILIGENCE_BLOCK_TYPES)[number];
export type AutonomyEvidenceTier = Doc<"diligenceProjections">["overallTier"];
type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

function check(
  code: string,
  passed: boolean,
  detail?: string,
): AutonomyValidationCheck {
  return detail ? { code, passed, detail } : { code, passed };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Matches the browser helper's two-pass FNV key derivation. */
function stableKeyDigest(value: unknown): string {
  const input = canonicalJson(value);
  const hash = (seed: number) => {
    let result = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

export function buildDecorationOperationKey(args: {
  entityId: Id<"productEntities"> | string;
  scratchpadId: Id<"agentScratchpads"> | string;
  scratchpadRunId: string;
  blockType: AutonomyDiligenceBlockType;
  decorationVersion: number;
}): string {
  return `notebook-decoration-op:${stableKeyDigest({
    entityId: String(args.entityId),
    scratchpadId: String(args.scratchpadId),
    scratchpadRunId: args.scratchpadRunId,
    blockType: args.blockType,
    decorationVersion: args.decorationVersion,
  })}`;
}

export function normalizeOperationKey(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > AUTONOMY_LIMITS.maxOperationKeyLength
  ) {
    throw new AutonomyPolicyError(
      "operation_key_invalid",
      `operationKey must be exact and contain 1-${AUTONOMY_LIMITS.maxOperationKeyLength} characters.`,
    );
  }
  return value;
}

export function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function analyzeEvidenceSourceRefs(values: readonly string[]): {
  sourceRefIds: string[];
  valid: boolean;
  checks: AutonomyValidationCheck[];
} {
  const sourceRefIds = [...values];
  const bytes = new TextEncoder().encode(JSON.stringify(sourceRefIds)).length;
  const checks = [
    check(
      "evidence_source_ref_count_bounded",
      sourceRefIds.length <= AUTONOMY_LIMITS.maxSourceRefIds,
    ),
    check(
      "evidence_source_ref_values_valid",
      sourceRefIds.every(
        (value) =>
          value === value.trim() &&
          value.length > 0 &&
          value.length <= AUTONOMY_LIMITS.maxSourceRefLength,
      ),
    ),
    check(
      "evidence_source_ref_values_unique",
      new Set(sourceRefIds).size === sourceRefIds.length,
    ),
    check(
      "evidence_source_ref_bytes_bounded",
      bytes <= AUTONOMY_LIMITS.maxSourceRefBytes,
    ),
  ];
  return {
    sourceRefIds,
    valid: checks.every((item) => item.passed),
    checks,
  };
}

export type ResolvedDecorationEvidence = {
  projection: Doc<"diligenceProjections"> | null;
  derivedContent: Doc<"productBlocks">["content"] | null;
  derivedContentHash: string | undefined;
  evidenceSourceRefIds: string[];
  evidenceSourceSectionId: string | undefined;
  evidenceSourceCount: number | undefined;
  evidenceTier: AutonomyEvidenceTier | undefined;
  evidenceDigest: string | undefined;
  checks: AutonomyValidationCheck[];
};

/**
 * Resolves the exact projection behind a decoration through the authenticated
 * owner's real scratchpad. The projection table is entity-slug keyed, so the
 * owned scratchpad thread match is the tenant boundary for this evidence.
 */
export async function resolveDecorationEvidence(
  ctx: ReadCtx,
  args: {
    ownerKey: string;
    userId: Id<"users">;
    entity: Doc<"productEntities"> | null;
    scratchpad: Doc<"agentScratchpads"> | null;
    operationKey: string;
    blockType: AutonomyDiligenceBlockType;
    scratchpadRunId: string;
    version: number;
    proposedContent: Doc<"productBlocks">["content"];
    proposedSourceRefIds: readonly string[];
  },
): Promise<ResolvedDecorationEvidence> {
  const identityValuesValid =
    args.scratchpadRunId === args.scratchpadRunId.trim() &&
    args.scratchpadRunId.length > 0 &&
    args.scratchpadRunId.length <= AUTONOMY_LIMITS.maxRunIdLength &&
    Number.isSafeInteger(args.version) &&
    args.version >= 0;
  const expectedOperationKey =
    args.entity && args.scratchpad
      ? buildDecorationOperationKey({
          entityId: args.entity._id,
          scratchpadId: args.scratchpad._id,
          scratchpadRunId: args.scratchpadRunId,
          blockType: args.blockType,
          decorationVersion: args.version,
        })
      : null;

  let projection: Doc<"diligenceProjections"> | null = null;
  if (args.entity && args.scratchpad && identityValuesValid) {
    const candidates = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_block_run", (q) =>
        q
          .eq("ownerKey", args.ownerKey)
          .eq("entityId", args.entity!._id)
          .eq("blockType", args.blockType)
          .eq("scratchpadRunId", args.scratchpadRunId),
      )
      .order("desc")
      .take(AUTONOMY_LIMITS.maxProjectionVersionLookback);
    projection =
      candidates
        .filter((candidate) => candidate.version === args.version)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  }

  const sourceAnalysis = analyzeEvidenceSourceRefs(
    projection?.sourceRefIds ?? [],
  );
  const projectionPayload =
    projection?.payload &&
    typeof projection.payload === "object" &&
    !Array.isArray(projection.payload)
      ? (projection.payload as Record<string, unknown>)
      : null;
  const scratchpadBaseRunId =
    typeof projectionPayload?.scratchpadBaseRunId === "string"
      ? projectionPayload.scratchpadBaseRunId
      : null;
  const scratchpadBaseRunValid =
    scratchpadBaseRunId !== null &&
    scratchpadBaseRunId === scratchpadBaseRunId.trim() &&
    scratchpadBaseRunId.length > 0 &&
    scratchpadBaseRunId.length <= AUTONOMY_LIMITS.maxRunIdLength;
  const derivedParagraph = (projection?.bodyProse ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .find(
      (paragraph) =>
        paragraph.length > 0 && !/^[-*\u2022]\s+/.test(paragraph),
    );
  const derivedContent: Doc<"productBlocks">["content"] | null =
    derivedParagraph
      ? [{ type: "text", value: derivedParagraph }]
      : null;
  const [derivedContentHash, submittedContentHash] = await Promise.all([
    derivedContent ? digestCanonical(derivedContent) : Promise.resolve(undefined),
    digestCanonical(args.proposedContent),
  ]);
  const evidenceTier = projection?.overallTier;
  const checks: AutonomyValidationCheck[] = [
    check("evidence_identity_values_valid", identityValuesValid),
    check(
      "operation_key_matches_identity",
      expectedOperationKey !== null && args.operationKey === expectedOperationKey,
    ),
    check(
      "evidence_entity_owner_matches",
      !!args.entity && args.entity.ownerKey === args.ownerKey,
    ),
    check(
      "evidence_scratchpad_owner_matches",
      !!args.scratchpad && args.scratchpad.ownerKey === args.ownerKey,
    ),
    check(
      "evidence_scratchpad_entity_matches",
      !!args.entity &&
        !!args.scratchpad &&
        args.scratchpad.entitySlug === args.entity.slug &&
        args.scratchpad.entityId === args.entity._id,
    ),
    check("evidence_scratchpad_base_run_valid", scratchpadBaseRunValid),
    check(
      "evidence_scratchpad_thread_matches",
      !!args.scratchpad &&
        scratchpadBaseRunValid &&
        args.scratchpad.agentThreadId === scratchpadBaseRunId,
    ),
    check("evidence_projection_exists", !!projection),
    check(
      "evidence_projection_owner_matches",
      !!projection && projection.ownerKey === args.ownerKey,
    ),
    check(
      "evidence_projection_entity_matches",
      !!projection && projection.entityId === args.entity?._id,
    ),
    check(
      "evidence_projection_scratchpad_matches",
      !!projection &&
        projection.producerScratchpadId === args.scratchpad?._id,
    ),
    check(
      "evidence_producer_assured",
      projection?.producerAssurance === "internal_structuring_v1",
    ),
    check("evidence_body_text_available", derivedContent !== null),
    check(
      "proposed_content_matches_evidence",
      derivedContentHash !== undefined &&
        submittedContentHash === derivedContentHash,
    ),
    check(
      "evidence_tier_sufficient",
      evidenceTier === "verified" || evidenceTier === "corroborated",
    ),
    ...sourceAnalysis.checks,
    check(
      "evidence_source_refs_required",
      sourceAnalysis.valid && sourceAnalysis.sourceRefIds.length > 0,
    ),
    check(
      "evidence_source_section_valid",
      projection?.sourceSectionId === undefined ||
        (projection.sourceSectionId === projection.sourceSectionId.trim() &&
          projection.sourceSectionId.length > 0 &&
          projection.sourceSectionId.length <= AUTONOMY_LIMITS.maxKeyLength),
    ),
    check(
      "evidence_source_count_valid",
      projection?.sourceCount === undefined ||
        (Number.isSafeInteger(projection.sourceCount) &&
          projection.sourceCount >= 0),
    ),
    check(
      "proposed_source_refs_match_evidence",
      sourceAnalysis.valid &&
        sameOrderedStrings(
          args.proposedSourceRefIds,
          sourceAnalysis.sourceRefIds,
        ),
    ),
  ];
  const evidenceDigest =
    projection && sourceAnalysis.valid
      ? await digestCanonical({
          projectionId: String(projection._id),
          ownerKey: args.ownerKey,
          entityId: String(args.entity?._id),
          scratchpadId: String(args.scratchpad?._id),
          scratchpadRunId: args.scratchpadRunId,
          scratchpadBaseRunId,
          blockType: args.blockType,
          version: args.version,
          tier: projection.overallTier,
          sourceRefIds: sourceAnalysis.sourceRefIds,
          sourceSectionId: projection.sourceSectionId ?? null,
          sourceCount: projection.sourceCount ?? null,
          derivedContentHash: derivedContentHash ?? null,
          producerAssurance: projection.producerAssurance ?? null,
        })
      : undefined;

  return {
    projection,
    derivedContent,
    derivedContentHash,
    evidenceSourceRefIds: sourceAnalysis.valid
      ? sourceAnalysis.sourceRefIds
      : [],
    evidenceSourceSectionId: projection?.sourceSectionId,
    evidenceSourceCount: projection?.sourceCount,
    evidenceTier,
    evidenceDigest,
    checks,
  };
}
