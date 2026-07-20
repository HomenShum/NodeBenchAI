"use node";

import { generateObject } from "ai";
import { z } from "zod";
import type { ScratchpadRunDraft } from "./diligenceProjectionRuntime";
import {
  ALL_BLOCK_TYPES,
  classifyAuthority,
  type AuthorityTier,
  type BlockType as AuthorityBlockType,
} from "../../../server/pipeline/authority/defaultTiers";
import {
  DEFAULT_MODEL,
  executeWithModelFallback,
  type ApprovedModel,
} from "../agents/mcp_tools/models/modelResolver";

const STRUCTURING_PROMPT_VERSION = "diligence-structuring-v1";
const DEFAULT_STRUCTURING_MODEL: ApprovedModel = DEFAULT_MODEL;

const ConfidenceTierSchema = z.enum([
  "verified",
  "corroborated",
  "single-source",
  "unverified",
]);

const StructuredCheckpointSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2000),
  claims: z.array(z.string().min(1).max(400)).max(8).default([]),
  evidenceRefs: z.array(z.string().min(1).max(120)).max(12).default([]),
  confidenceTier: ConfidenceTierSchema,
  openQuestions: z.array(z.string().min(1).max(300)).max(6).default([]),
  sourceSectionIds: z.array(z.string().min(1).max(120)).max(6).default([]),
});

export type StructuredCheckpoint = z.infer<typeof StructuredCheckpointSchema>;

export type StructuringAudit = {
  promptVersion: string;
  model: string;
  status: "structured" | "repaired" | "fallback";
  validation: "passed" | "repaired" | "fallback";
  attemptCount: number;
  fallbackReason?: string;
};

export type StructuringTelemetry = {
  toolCalls: number;
  tokensIn?: number;
  tokensOut?: number;
  sourceCount: number;
};

export type StructuredCheckpointResult = {
  draft: ScratchpadRunDraft;
  structured: StructuredCheckpoint;
  audit: StructuringAudit;
  telemetry: StructuringTelemetry;
};

type ProjectionSourceLike = {
  id: string;
  label: string;
  href?: string;
  domain?: string;
  title?: string;
  siteName?: string;
};

type StructuringInput = {
  entitySlug: string;
  entityName?: string;
  scratchpadMarkdown: string;
  checkpointNumber: number;
  checkpointStep: string;
  draft: ScratchpadRunDraft;
  reportSources: readonly ProjectionSourceLike[];
  modelId?: ApprovedModel;
};

type GeneratedStructuredObject = {
  object: StructuredCheckpoint;
  modelUsed: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

type StructuringDeps = {
  generateStructuredObject?: (
    prompt: string,
    mode: "primary" | "repair",
    modelId?: ApprovedModel,
  ) => Promise<GeneratedStructuredObject>;
};

function normalizeLines(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function bestProjectionAuthorityTier(href: string): AuthorityTier | "unknown" | "denied" {
  let best: AuthorityTier | "unknown" | "denied" = "unknown";
  const rank = (value: AuthorityTier | "unknown" | "denied") => {
    switch (value) {
      case "tier1":
        return 4;
      case "tier2":
        return 3;
      case "tier3":
        return 2;
      case "unknown":
        return 1;
      case "denied":
        return 0;
    }
  };

  for (const blockType of ALL_BLOCK_TYPES) {
    const next = classifyAuthority(href, blockType);
    if (next === "denied") continue;
    if (rank(next) > rank(best)) {
      best = next;
    }
  }

  return best;
}

function classifySectionSourceTier(
  blockType: ScratchpadRunDraft["blockType"],
  source: ProjectionSourceLike,
): AuthorityTier | "unknown" | "denied" {
  if (!source.href) return "unknown";
  if (blockType === "projection") {
    return bestProjectionAuthorityTier(source.href);
  }
  return classifyAuthority(source.href, blockType as AuthorityBlockType);
}

function computeOverallTier(
  blockType: ScratchpadRunDraft["blockType"],
  sourceRefIds: readonly string[],
  sources: readonly ProjectionSourceLike[],
): ScratchpadRunDraft["overallTier"] {
  if (sourceRefIds.length === 0) return "unverified";

  const sourceMap = new Map(sources.map((source) => [source.id, source] as const));
  const classifications = sourceRefIds
    .map((refId) => sourceMap.get(refId))
    .filter((source): source is ProjectionSourceLike => Boolean(source))
    .map((source) => classifySectionSourceTier(blockType, source))
    .filter((tier): tier is AuthorityTier => tier === "tier1" || tier === "tier2" || tier === "tier3");

  if (classifications.length === 0) return "unverified";
  if (classifications.length === 1) return "single-source";

  const highQualityCount = classifications.filter((tier) => tier === "tier1" || tier === "tier2").length;
  if (highQualityCount >= 2) return "verified";
  return "corroborated";
}

function summarizeSourceMeta(
  sourceRefIds: readonly string[],
  sources: readonly ProjectionSourceLike[],
): { sourceTokens: string[]; sourceLabel?: string } {
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index] as const));
  const sourceMap = new Map(sources.map((source) => [source.id, source] as const));
  const sourceTokens = sourceRefIds
    .map((refId) => sourceIndex.get(refId))
    .filter((index): index is number => typeof index === "number")
    .map((index) => `[s${index + 1}]`);

  const labels: string[] = [];
  for (const refId of sourceRefIds) {
    const source = sourceMap.get(refId);
    if (!source) continue;
    labels.push(source.domain ?? source.siteName ?? source.title ?? source.label);
    if (labels.length >= 2) break;
  }

  return {
    sourceTokens,
    sourceLabel: labels.length > 0 ? labels.join(" · ") : undefined,
  };
}

function buildBodyProse(structured: StructuredCheckpoint): string {
  const parts: string[] = [structured.summary.trim()];
  const claims = normalizeLines(structured.claims);
  const openQuestions = normalizeLines(structured.openQuestions);

  if (claims.length > 0) {
    parts.push(claims.map((claim) => `- ${claim}`).join("\n"));
  }

  if (openQuestions.length > 0) {
    parts.push(`Open questions:\n${openQuestions.map((question) => `- ${question}`).join("\n")}`);
  }

  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

function validateStructuredCheckpoint(
  structured: StructuredCheckpoint,
  args: StructuringInput,
): StructuredCheckpoint {
  const title = structured.title.trim();
  const summary = structured.summary.trim();
  if (title.length === 0) {
    throw new Error(`Structured checkpoint ${args.checkpointNumber} missing title`);
  }
  if (summary.length < 12) {
    throw new Error(`Structured checkpoint ${args.checkpointNumber} summary is too short`);
  }
  return {
    title,
    summary,
    claims: normalizeLines(structured.claims),
    evidenceRefs: normalizeLines(structured.evidenceRefs),
    confidenceTier: structured.confidenceTier,
    openQuestions: normalizeLines(structured.openQuestions),
    sourceSectionIds: normalizeLines(structured.sourceSectionIds),
  };
}

function filterEvidenceRefs(
  evidenceRefs: readonly string[],
  sources: readonly ProjectionSourceLike[],
): string[] {
  const valid = new Set(sources.map((source) => source.id));
  return evidenceRefs.filter((ref) => valid.has(ref));
}

function buildFallbackStructuredCheckpoint(args: StructuringInput): StructuredCheckpoint {
  return {
    title: args.draft.headerText,
    summary: args.draft.bodyProse?.trim() || `${args.entityName ?? args.entitySlug} has no structured checkpoint summary yet.`,
    claims: [],
    evidenceRefs: normalizeLines(args.draft.sourceRefIds ?? []),
    confidenceTier: args.draft.overallTier,
    openQuestions: [],
    sourceSectionIds: normalizeLines(
      args.draft.sourceSectionId ? [args.draft.sourceSectionId] : [],
    ),
  };
}

function buildProjectionDraft(
  args: StructuringInput,
  structured: StructuredCheckpoint,
  audit: StructuringAudit,
): ScratchpadRunDraft {
  const sourceRefIds = filterEvidenceRefs(structured.evidenceRefs, args.reportSources);
  const { sourceTokens, sourceLabel } = summarizeSourceMeta(sourceRefIds, args.reportSources);
  const overallTier = computeOverallTier(args.draft.blockType, sourceRefIds, args.reportSources);
  const payloadBase =
    args.draft.payload && typeof args.draft.payload === "object" ? args.draft.payload : {};

  return {
    ...args.draft,
    headerText: structured.title,
    bodyProse: buildBodyProse(structured),
    overallTier,
    sourceRefIds,
    sourceCount: sourceRefIds.length,
    sourceLabel,
    sourceTokens,
    payload: {
      ...payloadBase,
      kind: "structured-checkpoint",
      structured,
      structuringAudit: audit,
    },
  };
}

function buildPrimaryPrompt(args: StructuringInput): string {
  const availableSources = args.reportSources
    .map((source) => `- ${source.id}: ${source.domain ?? source.label}${source.href ? ` (${source.href})` : ""}`)
    .join("\n");

  return `You are structuring one diligence checkpoint into strict JSON for notebook overlays.

Return only grounded structure for this single block.

Entity: ${args.entityName ?? args.entitySlug}
Block type: ${args.draft.blockType}
Checkpoint number: ${args.checkpointNumber}
Checkpoint step: ${args.checkpointStep}
Current block header: ${args.draft.headerText}
Current block prose:
${args.draft.bodyProse ?? "(none)"}

Current block source section id: ${args.draft.sourceSectionId ?? "unknown"}
Current block source refs: ${(args.draft.sourceRefIds ?? []).join(", ") || "(none)"}

Available source refs:
${availableSources || "(none)"}

Scratchpad markdown:
${args.scratchpadMarkdown}

Rules:
- Keep the title concise and notebook-native.
- Summary must be factual and grounded in the scratchpad and current block only.
- Claims should be short factual bullets, not marketing copy.
- evidenceRefs must only contain ids from the available source refs list.
- sourceSectionIds must contain only real section ids from the current checkpoint context.
- confidenceTier must be one of verified, corroborated, single-source, unverified.
- If evidence is weak, keep confidenceTier low and use openQuestions instead of overclaiming.
- Do not invent people, products, funding amounts, or source ids.`;
}

function buildRepairPrompt(args: StructuringInput, priorError: string): string {
  return `Repair the structured diligence checkpoint output.

Prior issue: ${priorError}

You must return schema-valid JSON for one notebook overlay checkpoint.
Be conservative. Preserve only grounded content.

Entity: ${args.entityName ?? args.entitySlug}
Block type: ${args.draft.blockType}
Current block header: ${args.draft.headerText}
Current block prose:
${args.draft.bodyProse ?? "(none)"}

Allowed source refs: ${(args.reportSources.map((source) => source.id).join(", ")) || "(none)"}
Allowed source section ids: ${args.draft.sourceSectionId ?? "unknown"}

Scratchpad markdown:
${args.scratchpadMarkdown}`;
}

async function defaultGenerateStructuredObject(
  prompt: string,
  _mode: "primary" | "repair",
  modelId?: ApprovedModel,
): Promise<GeneratedStructuredObject> {
  const { result, modelUsed } = await executeWithModelFallback(
    async (model, resolvedModelId) => {
      const generated = await generateObject({
        model,
        schema: StructuredCheckpointSchema,
        prompt,
        maxOutputTokens: 1200,
      });
      return {
        object: generated.object,
        usage: {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
        },
        modelUsed: resolvedModelId,
      };
    },
    {
      startModel: modelId ?? DEFAULT_STRUCTURING_MODEL,
    },
  );

  return {
    object: result.object,
    modelUsed,
    usage: result.usage,
  };
}

export async function structureScratchpadCheckpoint(
  args: StructuringInput,
  deps: StructuringDeps = {},
): Promise<StructuredCheckpointResult> {
  const generateStructuredObject =
    deps.generateStructuredObject ?? defaultGenerateStructuredObject;

  let attemptCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let lastError: Error | null = null;

  const runAttempt = async (
    mode: "primary" | "repair",
    prompt: string,
  ): Promise<{ structured: StructuredCheckpoint; modelUsed: string }> => {
    attemptCount += 1;
    const generated = await generateStructuredObject(prompt, mode, args.modelId);
    tokensIn += generated.usage?.inputTokens ?? 0;
    tokensOut += generated.usage?.outputTokens ?? 0;
    const structured = validateStructuredCheckpoint(generated.object, args);
    return {
      structured,
      modelUsed: generated.modelUsed,
    };
  };

  try {
    const primary = await runAttempt("primary", buildPrimaryPrompt(args));
    const audit: StructuringAudit = {
      promptVersion: STRUCTURING_PROMPT_VERSION,
      model: primary.modelUsed,
      status: "structured",
      validation: "passed",
      attemptCount,
    };
    const draft = buildProjectionDraft(args, primary.structured, audit);
    return {
      draft,
      structured: primary.structured,
      audit,
      telemetry: {
        toolCalls: 1,
        tokensIn,
        tokensOut,
        sourceCount: draft.sourceCount ?? 0,
      },
    };
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const repaired = await runAttempt(
      "repair",
      buildRepairPrompt(args, lastError?.message ?? "unknown validation error"),
    );
    const audit: StructuringAudit = {
      promptVersion: STRUCTURING_PROMPT_VERSION,
      model: repaired.modelUsed,
      status: "repaired",
      validation: "repaired",
      attemptCount,
    };
    const draft = buildProjectionDraft(args, repaired.structured, audit);
    return {
      draft,
      structured: repaired.structured,
      audit,
      telemetry: {
        toolCalls: 1,
        tokensIn,
        tokensOut,
        sourceCount: draft.sourceCount ?? 0,
      },
    };
  } catch (repairError) {
    lastError = repairError instanceof Error ? repairError : new Error(String(repairError));
  }

  const fallbackStructured = buildFallbackStructuredCheckpoint(args);
  const audit: StructuringAudit = {
    promptVersion: STRUCTURING_PROMPT_VERSION,
    model: args.modelId ?? DEFAULT_STRUCTURING_MODEL,
    status: "fallback",
    validation: "fallback",
    attemptCount,
    fallbackReason: lastError?.message ?? "unknown structuring failure",
  };
  const draft = buildProjectionDraft(args, fallbackStructured, audit);
  return {
    draft,
    structured: fallbackStructured,
    audit,
    telemetry: {
      toolCalls: 1,
      tokensIn,
      tokensOut,
      sourceCount: draft.sourceCount ?? 0,
    },
  };
}
