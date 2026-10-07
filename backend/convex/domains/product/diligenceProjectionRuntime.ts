import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ALL_BLOCK_TYPES, classifyAuthority, type BlockType, type AuthorityTier } from "../../../../workers/node/pipeline/authority/defaultTiers";

export type ProjectionBlockType = "projection" | BlockType;

type ProjectionSectionLike = {
  id: string;
  title: string;
  body: string;
  sourceRefIds?: string[];
};

type ProjectionSourceLike = {
  id: string;
  label: string;
  href?: string;
  domain?: string;
  title?: string;
  siteName?: string;
};

type ProjectionReportLike = {
  entitySlug: string;
  title: string;
  primaryEntity?: string;
  sections: ProjectionSectionLike[];
  sources: ProjectionSourceLike[];
  updatedAt: number;
  revision?: number;
};

export type ProjectionDraft = {
  entitySlug: string;
  blockType: ProjectionBlockType;
  scratchpadRunId: string;
  version: number;
  overallTier: Doc<"diligenceProjections">["overallTier"];
  headerText: string;
  bodyProse?: string;
  sourceRefIds?: string[];
  sourceCount?: number;
  sourceLabel?: string;
  sourceTokens?: string[];
  payload?: unknown;
  sourceSectionId?: string;
};

export type ScratchpadRunDraft = ProjectionDraft & {
  scratchpadBaseRunId: string;
  checkpointNumber: number;
};

type ProjectionSyncResult = {
  status: "materialized" | "noop";
  total: number;
  created: number;
  updated: number;
  stale: number;
  deleted: number;
};

function inferProjectionBlockType(title: string, body: string): ProjectionBlockType {
  const haystack = `${title} ${body}`.toLowerCase();
  if (/\bfounder|\bceo\b|\bcto\b|\bteam\b/.test(haystack)) return "founder";
  if (/\bfunding|\bseries\b|\braised\b|\bround\b/.test(haystack)) return "funding";
  if (/\bproduct|\bplatform\b|\bwhat it is\b|\bhow it works\b/.test(haystack)) return "product";
  if (/\bnews\b|\brecent\b|\bsignal\b|\bheadline\b/.test(haystack)) return "news";
  if (/\bhiring|\bjob\b|\bteam growth\b/.test(haystack)) return "hiring";
  if (/\bpatent|\buspto\b|\bepo\b/.test(haystack)) return "patent";
  if (/\bregulatory|\blegal\b|\bcourt\b|\bfda\b|\bcompliance\b/.test(haystack)) return "regulatory";
  if (/\bcompetitor|\balternative|\bmarket map\b/.test(haystack)) return "competitor";
  if (/\bpublic opinion|\bsentiment|\breddit\b|\bhn\b/.test(haystack)) return "publicOpinion";
  if (/\bfinancial|\brevenue\b|\bgross margin\b|\bburn\b/.test(haystack)) return "financial";
  return "projection";
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => value.length > 0),
    ),
  );
}

function resolveSourceLabel(source: ProjectionSourceLike): string {
  return source.domain ?? source.siteName ?? source.title ?? source.label;
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
    labels.push(resolveSourceLabel(source));
    if (labels.length >= 2) break;
  }

  return {
    sourceTokens,
    sourceLabel: labels.length > 0 ? labels.join(" · ") : undefined,
  };
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
  blockType: ProjectionBlockType,
  source: ProjectionSourceLike,
): AuthorityTier | "unknown" | "denied" {
  if (!source.href) return "unknown";
  if (blockType === "projection") {
    return bestProjectionAuthorityTier(source.href);
  }
  return classifyAuthority(source.href, blockType);
}

function computeOverallTier(
  blockType: ProjectionBlockType,
  sourceRefIds: readonly string[],
  sources: readonly ProjectionSourceLike[],
): Doc<"diligenceProjections">["overallTier"] {
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

export function buildGenericDiligenceProjectionDrafts(report: ProjectionReportLike): ProjectionDraft[] {
  const drafts: ProjectionDraft[] = [];
  report.sections.forEach((section, index) => {
      const body = section.body.trim();
      const title = section.title.trim();
      if (!title && !body) return;

      const blockType = inferProjectionBlockType(title, body);
      const sourceRefIds = uniqueStrings(section.sourceRefIds ?? []);
      const { sourceTokens, sourceLabel } = summarizeSourceMeta(sourceRefIds, report.sources);
      const versionBase = Number.isFinite(report.updatedAt) ? report.updatedAt : Date.now();
      const version = versionBase + index;

      drafts.push({
        entitySlug: report.entitySlug,
        blockType,
        scratchpadRunId: `projection:${report.entitySlug}:${report.updatedAt}:${section.id}`,
        version,
        overallTier: computeOverallTier(blockType, sourceRefIds, report.sources),
        headerText: title || report.primaryEntity || report.title,
        bodyProse: body || undefined,
        sourceRefIds,
        sourceCount: sourceRefIds.length,
        sourceLabel,
        sourceTokens,
        payload: {
          kind: "report-section",
          sectionId: section.id,
          title: section.title,
          reportTitle: report.title,
          revision: report.revision ?? 1,
        },
        sourceSectionId: section.id,
      });
    });
  return drafts;
}

export function buildScratchpadStructuredProjectionDrafts(
  report: ProjectionReportLike,
  scratchpadBaseRunId: string,
): ScratchpadRunDraft[] {
  return buildGenericDiligenceProjectionDrafts(report).map((draft, index) => ({
    ...draft,
    scratchpadBaseRunId,
    checkpointNumber: index + 1,
    scratchpadRunId: `${scratchpadBaseRunId}:${draft.sourceSectionId ?? index + 1}`,
    payload: {
      ...(draft.payload && typeof draft.payload === "object" ? draft.payload : {}),
      kind: "scratchpad-checkpoint",
      scratchpadBaseRunId,
      checkpointNumber: index + 1,
    },
  }));
}

export function buildScratchpadMarkdownForDrafts(args: {
  entitySlug: string;
  entityName?: string;
  scratchpadBaseRunId: string;
  status: "streaming" | "structuring" | "merged" | "failed";
  drafts: readonly Pick<
    ScratchpadRunDraft,
    "blockType" | "headerText" | "bodyProse" | "sourceTokens" | "overallTier" | "sourceSectionId" | "checkpointNumber"
  >[];
  currentStep?: string;
  failureReason?: string;
}): string {
  const lines: string[] = [
    `# Diligence scratchpad`,
    ``,
    `- Entity: ${args.entityName?.trim() || args.entitySlug}`,
    `- Run: ${args.scratchpadBaseRunId}`,
    `- Status: ${args.status}`,
  ];

  if (args.currentStep?.trim()) {
    lines.push(`- Current step: ${args.currentStep.trim()}`);
  }

  if (args.failureReason?.trim()) {
    lines.push(`- Failure: ${args.failureReason.trim()}`);
  }

  for (const draft of args.drafts) {
    lines.push(
      ``,
      `## [${draft.checkpointNumber}] ${draft.headerText}`,
      `- Block type: ${draft.blockType}`,
      `- Evidence tier: ${draft.overallTier}`,
      `- Section id: ${draft.sourceSectionId ?? "unknown"}`,
      `- Sources: ${
        Array.isArray(draft.sourceTokens) && draft.sourceTokens.length > 0
          ? draft.sourceTokens.join(" ")
          : "none yet"
      }`,
      ``,
      (draft.bodyProse ?? "").trim() || "_No structured prose yet._",
    );
  }

  return lines.join("\n");
}

export async function syncGenericDiligenceProjectionDrafts(
  ctx: MutationCtx,
  args: {
    ownerKey: string;
    entityId: Id<"productEntities">;
    entitySlug: string;
    drafts: readonly ProjectionDraft[];
  },
): Promise<ProjectionSyncResult> {
  const existingRows = await ctx.db
    .query("diligenceProjections")
    .withIndex("by_owner_entity", (q) =>
      q.eq("ownerKey", args.ownerKey).eq("entityId", args.entityId),
    )
    .collect();

  const producerPrefix = `projection:${args.entitySlug}:`;
  const nextKeys = new Set<string>(
    args.drafts.map((draft) => `${draft.blockType}:${draft.scratchpadRunId}`),
  );
  const existingByKey = new Map<string, (typeof existingRows)[number]>(
    existingRows.map((row) => [`${row.blockType}:${row.scratchpadRunId}`, row]),
  );

  let created = 0;
  let updated = 0;
  let stale = 0;
  let deleted = 0;

  for (const row of existingRows) {
    if (!row.scratchpadRunId.startsWith(producerPrefix)) continue;
    const key = `${row.blockType}:${row.scratchpadRunId}`;
    if (nextKeys.has(key)) continue;
    await ctx.db.delete(row._id);
    deleted += 1;
  }

  for (const draft of args.drafts) {
    const key = `${draft.blockType}:${draft.scratchpadRunId}`;
    const existing = existingByKey.get(key);
    if (!existing) {
      await ctx.db.insert("diligenceProjections", {
        ...draft,
        ownerKey: args.ownerKey,
        entityId: args.entityId,
        updatedAt: draft.version,
      });
      created += 1;
      continue;
    }

    if (draft.version <= existing.version) {
      stale += 1;
      continue;
    }

    await ctx.db.patch(existing._id, {
      ownerKey: args.ownerKey,
      entityId: args.entityId,
      version: draft.version,
      overallTier: draft.overallTier,
      headerText: draft.headerText,
      bodyProse: draft.bodyProse,
      sourceRefIds: draft.sourceRefIds,
      sourceCount: draft.sourceCount,
      sourceLabel: draft.sourceLabel,
      sourceTokens: draft.sourceTokens,
      payload: draft.payload,
      sourceSectionId: draft.sourceSectionId,
      updatedAt: draft.version,
      refreshRequestedAt: undefined,
    });
    updated += 1;
  }

  return {
    status: args.drafts.length > 0 ? "materialized" : "noop",
    total: args.drafts.length,
    created,
    updated,
    stale,
    deleted,
  };
}
