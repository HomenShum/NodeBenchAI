import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import type { EvidenceTier } from "@/features/entities/components/EvidenceChip";
import type { DiligenceBlockType, DiligenceDecorationData } from "./DiligenceDecorationPlugin";

export type DiligenceBlockProjection = DiligenceDecorationData;

export type DiligenceBlocksSubscription = {
  isLoading: boolean;
  projections: ReadonlyArray<DiligenceBlockProjection>;
  overallTier: EvidenceTier | null;
  pendingBlockCount: number;
};

type NotebookSnapshotLike = {
  entityName?: string;
  reportUpdatedAt?: number;
  reportCount?: number;
  blocks?: Array<{
    id?: string;
    kind?: string;
    body?: string;
    sourceRefIds?: string[];
  }>;
  sources?: Array<{
    id: string;
    label: string;
    domain?: string;
    href?: string;
  }>;
} | null;

const EMPTY_READY: DiligenceBlocksSubscription = {
  isLoading: false,
  projections: [],
  overallTier: null,
  pendingBlockCount: 0,
};

const EMPTY_LOADING: DiligenceBlocksSubscription = {
  isLoading: true,
  projections: [],
  overallTier: null,
  pendingBlockCount: 0,
};

function inferTier(sourceCount: number): EvidenceTier {
  if (sourceCount >= 3) return "verified";
  if (sourceCount >= 2) return "corroborated";
  if (sourceCount >= 1) return "single-source";
  return "unverified";
}

function inferBlockType(title: string, body: string): DiligenceBlockType {
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

function tierRank(tier: EvidenceTier): number {
  switch (tier) {
    case "verified":
      return 3;
    case "corroborated":
      return 2;
    case "single-source":
      return 1;
    case "unverified":
      return 0;
  }
}

function summarizeSourceLabels(
  sourceRefs: readonly string[],
  sources: NonNullable<NotebookSnapshotLike>["sources"],
): { sourceTokens: string[]; sourceLabel?: string } {
  if (!sources || sourceRefs.length === 0) return { sourceTokens: [] };
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index]));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const labels: string[] = [];
  const tokens = sourceRefs
    .map((ref) => sourceIndex.get(ref))
    .filter((index): index is number => typeof index === "number")
    .map((index) => `[s${index + 1}]`);

  for (const ref of sourceRefs) {
    const source = sourceMap.get(ref);
    if (!source) continue;
    labels.push(source.domain ?? source.label);
    if (labels.length >= 2) break;
  }

  return {
    sourceTokens: tokens,
    sourceLabel: labels.length > 0 ? labels.join(" · ") : undefined,
  };
}

type DerivedSection = {
  title: string;
  body: string;
  sourceRefIds: string[];
  sectionKey: string;
};

function deriveSections(snapshot: NonNullable<NotebookSnapshotLike>): DerivedSection[] {
  const blocks = snapshot.blocks ?? [];
  const sections: DerivedSection[] = [];
  let currentTitle = snapshot.entityName?.trim() || "Latest intelligence";
  let currentBody: string[] = [];
  let currentSourceRefIds = new Set<string>();
  let currentSectionKey = "top";

  const flush = () => {
    const body = currentBody.join("\n\n").trim();
    if (!body) return;
    sections.push({
      title: currentTitle,
      body,
      sourceRefIds: Array.from(currentSourceRefIds),
      sectionKey: currentSectionKey,
    });
  };

  for (const block of blocks) {
    if (!block?.body?.trim()) continue;
    if (block.kind === "evidence") continue;
    if (block.kind === "heading-2" || block.kind === "heading-3") {
      flush();
      currentTitle = block.body.trim();
      currentBody = [];
      currentSourceRefIds = new Set<string>();
      currentSectionKey = block.id ?? `${block.kind}-${sections.length + 1}`;
      continue;
    }

    currentBody.push(block.body.trim());
    for (const refId of block.sourceRefIds ?? []) {
      currentSourceRefIds.add(refId);
    }
  }

  flush();
  return sections.slice(0, 5);
}

export function deriveDiligenceProjectionsFromSnapshot(
  entitySlug: string,
  snapshot: NonNullable<NotebookSnapshotLike>,
): ReadonlyArray<DiligenceBlockProjection> {
  const sections = deriveSections(snapshot);
  return sections.map((section, index) => {
    const sourceCount = section.sourceRefIds.length;
    const { sourceTokens, sourceLabel } = summarizeSourceLabels(
      section.sourceRefIds,
      snapshot.sources,
    );
    return {
      blockType: inferBlockType(section.title, section.body),
      overallTier: inferTier(sourceCount),
      headerText: section.title,
      bodyProse: section.body,
      scratchpadRunId: `projection:${entitySlug}:${snapshot.reportUpdatedAt ?? 0}:${section.sectionKey}`,
      version: (snapshot.reportUpdatedAt ?? 0) + index,
      updatedAt: snapshot.reportUpdatedAt ?? Date.now(),
      sourceSectionId: section.sectionKey,
      sourceRefIds: section.sourceRefIds,
      sourceCount,
      sourceLabel,
      sourceTokens,
    };
  });
}

export function useDiligenceBlocks(
  entitySlug: string,
  snapshot?: NotebookSnapshotLike | undefined,
  access?: { anonymousSessionId?: string; shareToken?: string },
): DiligenceBlocksSubscription {
  // Read Convex-side projections if the generic projection orchestrator has
  // materialized rows for this entity. Snapshot-derived projections remain as
  // a bridge for older entities until the notebook surface backfills them. See:
  //   convex/domains/product/diligenceProjections.ts
  //   docs/architecture/AGENT_PIPELINE.md
  //   .claude/rules/scratchpad_first.md
  const api = useConvexApi();
  const convexRows = useQuery(
    api?.domains.product.diligenceProjections.listForEntity as never,
    (api && entitySlug
      ? {
          entitySlug,
          anonymousSessionId: access?.anonymousSessionId,
          shareToken: access?.shareToken,
        }
      : "skip") as never,
  ) as
    | ReadonlyArray<{
        entitySlug: string;
        blockType: DiligenceBlockType;
        scratchpadRunId: string;
        version: number;
        overallTier: EvidenceTier;
        headerText: string;
        bodyProse?: string;
        sourceRefIds?: string[];
        sourceCount?: number;
        sourceLabel?: string;
        sourceTokens?: string[];
        payload?: unknown;
        sourceSectionId?: string;
        updatedAt: number;
      }>
    | undefined;

  return useMemo(() => {
    // Snapshot-derived projections — bridge for pre-materialized entities.
    const snapshotProjections =
      snapshot && snapshot.blocks && snapshot.blocks.length > 0
        ? deriveDiligenceProjectionsFromSnapshot(entitySlug, snapshot)
        : [];

    // Convex-side projections — orchestrator output. Merge key is
    // (blockType, scratchpadRunId); a Convex row wins when both sources
    // disagree because the orchestrator's structuring pass is authoritative.
    const convexProjections: DiligenceBlockProjection[] = (convexRows ?? []).map(
      (row) => ({
        blockType: row.blockType,
        overallTier: row.overallTier,
        headerText: row.headerText,
        bodyProse: row.bodyProse,
        sourceRefIds: row.sourceRefIds,
        sourceCount: row.sourceCount,
        sourceLabel: row.sourceLabel,
        sourceTokens: row.sourceTokens,
        payload: row.payload,
        scratchpadRunId: row.scratchpadRunId,
        version: row.version,
        updatedAt: row.updatedAt,
        sourceSectionId: row.sourceSectionId,
      }),
    );

    // Determine loading state HONESTLY:
    //   - snapshot undefined AND convexRows undefined → still loading
    //   - either source has data → ready
    //   - both resolved to empty → ready with no projections
    const snapshotLoading = snapshot === undefined;
    const convexLoading = api != null && convexRows === undefined;
    if (snapshotLoading && convexLoading) return EMPTY_LOADING;

    // Deterministic merge:
    //   1. Scratchpad-backed rows progressively replace the old report-backed
    //      bridge by matching sourceSectionId first, then blockType.
    //   2. Remaining Convex rows stay authoritative over snapshot fallback.
    //   3. Snapshot rows fill any gap that has not been checkpointed yet.
    const scratchpadProjections = convexProjections.filter((projection) =>
      projection.scratchpadRunId.startsWith(`scratchpad:${entitySlug}:`),
    );
    const reportBackedProjections = convexProjections.filter(
      (projection) => !projection.scratchpadRunId.startsWith(`scratchpad:${entitySlug}:`),
    );
    const scratchpadSectionKeys = new Set(
      scratchpadProjections
        .map((projection) => projection.sourceSectionId?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const scratchpadBlockTypes = new Set(scratchpadProjections.map((projection) => projection.blockType));
    const authoritativeConvexProjections =
      scratchpadProjections.length > 0
        ? [
            ...scratchpadProjections,
            ...reportBackedProjections.filter((projection) => {
              const sourceSectionId = projection.sourceSectionId?.trim();
              if (sourceSectionId && scratchpadSectionKeys.has(sourceSectionId)) return false;
              if (!sourceSectionId && scratchpadBlockTypes.has(projection.blockType)) return false;
              return true;
            }),
          ]
        : convexProjections;

    const mergedKey = (p: DiligenceBlockProjection) =>
      `${p.blockType}:${p.scratchpadRunId}`;
    const seen = new Set<string>();
    const merged: DiligenceBlockProjection[] = [];
    for (const p of authoritativeConvexProjections) {
      const key = mergedKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
    for (const p of snapshotProjections) {
      const key = mergedKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }

    if (merged.length === 0) return EMPTY_READY;
    const overallTier = merged.reduce<EvidenceTier>(
      (lowest, current) =>
        tierRank(current.overallTier) < tierRank(lowest) ? current.overallTier : lowest,
      merged[0].overallTier,
    );
    return {
      isLoading: false,
      projections: merged,
      overallTier,
      pendingBlockCount: 0,
    };
  }, [entitySlug, snapshot, convexRows, api]);
}
