/**
 * acceptDecorationIntoNotebook — converts a live diligence decoration into
 * a frozen notebook snapshot plan.
 *
 * This module stays pure on purpose. It knows how to translate the overlay
 * contract into concrete notebook blocks, but it does not own persistence.
 * EntityNotebookLive executes the returned plan through productBlocks
 * mutations so the notebook remains the only persisted writing surface.
 */

import type { BlockChip } from "./BlockChipRenderer";
import type { DiligenceDecorationData } from "./DiligenceDecorationPlugin";

export type AcceptedNotebookBlockKind = "generated_marker" | "heading_3" | "bullet" | "text";

export type AcceptedNotebookBlockDraft = {
  kind: AcceptedNotebookBlockKind;
  content: BlockChip[];
  sourceRefIds?: string[];
  attributes?: Record<string, unknown>;
};

export type AcceptDecorationArgs = {
  decoration: DiligenceDecorationData;
  insertAfterBlockId?: string;
  onFailure?: (reason: string) => void;
  frozenAt?: number;
};

export type AcceptDecorationResult = {
  succeeded: boolean;
  blockId?: string;
  frozenAt?: number;
  failureReason?: string;
  drafts?: AcceptedNotebookBlockDraft[];
};

type AcceptedDecorationMetadata = {
  acceptedFromLive: {
    blockType: DiligenceDecorationData["blockType"];
    sourceScratchpadRunId: string;
    sourceSectionId?: string;
    sourceRefIds?: string[];
    overallTier: DiligenceDecorationData["overallTier"];
    sourceCount?: number;
    frozenAt: number;
  };
};

function normalizeParagraphs(bodyProse: string | undefined): string[] {
  return (bodyProse ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildAcceptedMetadata(
  decoration: DiligenceDecorationData,
  frozenAt: number,
): AcceptedDecorationMetadata {
  return {
    acceptedFromLive: {
      blockType: decoration.blockType,
      sourceScratchpadRunId: decoration.scratchpadRunId,
      sourceSectionId: decoration.sourceSectionId,
      sourceRefIds: decoration.sourceRefIds,
      overallTier: decoration.overallTier,
      sourceCount: decoration.sourceCount,
      frozenAt,
    },
  };
}

function chipsFromText(value: string): BlockChip[] {
  return [{ type: "text", value }];
}

function paragraphKind(paragraph: string): AcceptedNotebookBlockKind {
  if (/^[-*•]\s+/.test(paragraph)) {
    return "bullet";
  }
  return "text";
}

function paragraphText(paragraph: string): string {
  return paragraphKind(paragraph) === "bullet"
    ? paragraph.replace(/^[-*•]\s+/, "")
    : paragraph;
}

export function buildAcceptedOwnershipCue(
  decoration: DiligenceDecorationData,
  frozenAt: number,
): string {
  const ageMs = Date.now() - frozenAt;
  const ageMin = Math.max(1, Math.round(ageMs / 60000));
  const timestamp =
    ageMin < 60
      ? `${ageMin}m ago`
      : ageMin < 24 * 60
        ? `${Math.round(ageMin / 60)}h ago`
        : `${Math.round(ageMin / (60 * 24))}d ago`;

  const kindLabel: Record<DiligenceDecorationData["blockType"], string> = {
    projection: "notebook",
    founder: "founders",
    product: "products",
    funding: "funding",
    news: "news",
    hiring: "hiring",
    patent: "patents",
    publicOpinion: "public opinion",
    competitor: "competitors",
    regulatory: "regulatory",
    financial: "financial",
  };

  return `Accepted from live ${kindLabel[decoration.blockType]} intelligence · ${timestamp}`;
}

export function buildAcceptedNotebookDrafts(
  decoration: DiligenceDecorationData,
  frozenAt: number,
): AcceptedNotebookBlockDraft[] {
  const metadata = buildAcceptedMetadata(decoration, frozenAt);
  const paragraphs = normalizeParagraphs(decoration.bodyProse);
  const drafts: AcceptedNotebookBlockDraft[] = [
    {
      kind: "generated_marker",
      content: chipsFromText(buildAcceptedOwnershipCue(decoration, frozenAt)),
      attributes: metadata,
    },
  ];

  const header = decoration.headerText.trim();
  if (header) {
    drafts.push({
      kind: "heading_3",
      content: chipsFromText(header),
      attributes: metadata,
    });
  }

  if (paragraphs.length === 0 && header) {
    return drafts;
  }

  for (const paragraph of paragraphs) {
    const text = paragraphText(paragraph);
    if (!text.trim()) continue;
    drafts.push({
      kind: paragraphKind(paragraph),
      content: chipsFromText(text),
      sourceRefIds: decoration.sourceRefIds,
      attributes: metadata,
    });
  }

  return drafts;
}

export function acceptDecorationIntoNotebook(
  args: AcceptDecorationArgs,
): AcceptDecorationResult {
  const frozenAt = args.frozenAt ?? Date.now();
  const header = args.decoration.headerText.trim();
  const paragraphs = normalizeParagraphs(args.decoration.bodyProse);
  if (!header && paragraphs.length === 0) {
    const failureReason = "Live decoration had no content to materialize.";
    args.onFailure?.(failureReason);
    return {
      succeeded: false,
      failureReason,
    };
  }

  const drafts = buildAcceptedNotebookDrafts(args.decoration, frozenAt);
  return {
    succeeded: drafts.length > 0,
    frozenAt,
    drafts,
    failureReason: drafts.length > 0 ? undefined : "No notebook blocks were generated.",
  };
}
