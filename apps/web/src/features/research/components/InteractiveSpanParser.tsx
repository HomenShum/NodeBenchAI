"use client";

import React from "react";
import SmartLink from "./SmartLink";
import { InteractiveSpan } from "./InteractiveSpan";
import FootnoteMarker from "./FootnoteMarker";
import EntityLink from "./EntityLink";
import type { EntityHoverData } from "./EntityHoverPreview";
import type { Citation, CitationLibrary, CitationType } from "../types/citationSchema";
import { CITATION_REGEX } from "../types/citationSchema";
import type { Entity, EntityLibrary, EntityType } from "../types/entitySchema";
import { ENTITY_REGEX } from "../types/entitySchema";

type SmartLinkMeta = { summary: string; source?: string };

export interface InteractiveSpanParserProps {
  /** Raw narrative text that may contain SmartLink tags and token syntax */
  text: string;
  /** Optional smart link metadata for <SmartLink> tags */
  smartLinks?: Record<string, SmartLinkMeta>;
  /** Optional citation library for {{cite:id}} tokens */
  citations?: CitationLibrary;
  /** Optional entity library for @@entity:id@@ tokens */
  entities?: EntityLibrary;
  /** Pre-loaded entity enrichment data for medium-detail hover previews */
  entityEnrichment?: Record<string, EntityHoverData>;
  /** Prefix used to generate stable span IDs (e.g., section + paragraph) */
  spanPrefix?: string;
  /** Whether to show [index] indicator before the label when dataIndex is present */
  showIndicator?: boolean;
  /** Callback when a citation is clicked */
  onCitationClick?: (citation: Citation) => void;
  /** Callback when an entity is clicked */
  onEntityClick?: (entity: Entity) => void;
}

/**
 * Basic parser for `<SmartLink id="x">Label</SmartLink>` tags.
 *
 * Shared between classic scrollytelling layout and the interactive span
 * parser so we only maintain a single implementation.
 */
export const parseSmartLinks = (
  text: string,
  linksData?: Record<string, SmartLinkMeta>,
  keyPrefix = "smartlink",
): React.ReactNode[] => {
  const regex = /<SmartLink id=['"]([^'"]+)['"]>(.*?)<\/SmartLink>/g;
  const parts: Array<string | { id: string; label: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ id: match[1], label: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.map((part, idx) => {
    if (typeof part === "string") {
      return <React.Fragment key={`${keyPrefix}-text-${idx}`}>{part}</React.Fragment>;
    }
    const link = linksData?.[part.id];
    return (
      <SmartLink key={`${keyPrefix}-${part.id}-${idx}`} summary={link?.summary} source={link?.source}>
        {part.label}
      </SmartLink>
    );
  });
};

/**
 * Parse entity tokens from text and return nodes with EntityLink components
 */
const parseEntitiesAndSmartLinks = (
  text: string,
  linksData?: Record<string, SmartLinkMeta>,
  entities?: EntityLibrary,
  onEntityClick?: (entity: Entity) => void,
  entityEnrichment?: Record<string, EntityHoverData>,
  keyPrefix = "entity",
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const entityRegex = new RegExp(ENTITY_REGEX.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = entityRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      nodes.push(...parseSmartLinks(before, linksData, `${keyPrefix}-before-${match.index}`));
    }

    const entityId = match[1];
    const displayName = match[2];
    const typeOverride = match[3] as EntityType | undefined;

    const entity = entities?.entities[entityId];
    if (entity) {
      const displayEntity = typeOverride ? { ...entity, type: typeOverride } : entity;
      // Get pre-loaded enrichment data for medium-detail preview
      const enrichment = entityEnrichment?.[entityId] || entityEnrichment?.[entity.name];
      const useMediumPreview = !!enrichment || !!entityEnrichment;

      nodes.push(
        <EntityLink
          key={`${keyPrefix}-entity-${entityId}-${match.index}`}
          entity={displayEntity as any}
          displayName={displayName}
          onClick={onEntityClick}
          preloadedEnrichment={enrichment}
          useMediumPreview={useMediumPreview}
        />,
      );
    } else {
      nodes.push(
        <span
          key={`${keyPrefix}-entity-missing-${entityId}-${match.index}`}
        >
          {displayName || entityId}
        </span>,
      );
    }

    lastIndex = entityRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest) {
      nodes.push(...parseSmartLinks(rest, linksData, `${keyPrefix}-rest-${lastIndex}`));
    }
  }

  return nodes;
};

/**
 * Parse citation tokens from text and return nodes with FootnoteMarker components
 */
const parseCitationsEntitiesAndSmartLinks = (
  text: string,
  linksData?: Record<string, SmartLinkMeta>,
  citations?: CitationLibrary,
  entities?: EntityLibrary,
  onCitationClick?: (citation: Citation) => void,
  onEntityClick?: (entity: Entity) => void,
  entityEnrichment?: Record<string, EntityHoverData>,
  keyPrefix = "citation",
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const citationRegex = new RegExp(CITATION_REGEX.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before the citation (parse for entities)
    const before = text.slice(lastIndex, match.index);
    if (before) {
      nodes.push(
        ...parseEntitiesAndSmartLinks(
          before,
          linksData,
          entities,
          onEntityClick,
          entityEnrichment,
          `${keyPrefix}-before-${match.index}`,
        ),
      );
    }

    const citationId = match[1];
    const customLabel = match[2];
    const typeOverride = match[3] as CitationType | undefined;

    const citation = citations?.citations[citationId];
    if (citation) {
      const displayCitation = typeOverride
        ? { ...citation, type: typeOverride }
        : citation;

      nodes.push(
        <FootnoteMarker
          key={`${keyPrefix}-cite-${citationId}-${match.index}`}
          citation={displayCitation}
          onClick={onCitationClick}
        />,
      );
    } else {
      nodes.push(
        <span
          key={`${keyPrefix}-cite-missing-${citationId}-${match.index}`}
        >
          {customLabel || "source"}
        </span>,
      );
    }

    lastIndex = citationRegex.lastIndex;
  }

  // Add remaining text (parse for entities)
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest) {
      nodes.push(
        ...parseEntitiesAndSmartLinks(
          rest,
          linksData,
          entities,
          onEntityClick,
          entityEnrichment,
          `${keyPrefix}-rest-${lastIndex}`,
        ),
      );
    }
  }

  return nodes;
};

/**
 * InteractiveSpanParser
 *
 * Parses multiple token types in narrative text:
 * - `[[label|dataIndex:N]]` - Interactive spans wired to chart data indices
 * - `{{cite:id}}` - Citation footnote markers
 * - `{{cite:id|label}}` - Citation with custom label
 * - `{{cite:id|label|type:quote}}` - Citation with type override
 * - `@@entity:id@@` - Entity links with type-specific styling
 * - `@@entity:id|Display Name@@` - Entity with custom display name
 * - `@@entity:id|Display Name|type:company@@` - Entity with type override
 * - `<SmartLink id="x">Label</SmartLink>` - Contextual hover links
 *
 * Examples:
 *  - "The [[reliability gap|dataIndex:2]] remains dangerous{{cite:arxiv-001}}."
 *  - "[[Capability|dataIndex:0]] outruns [[Reliability|dataIndex:1]]."
 *  - "AWS announced{{cite:aws-blog|source}} new pricing."
 *  - "@@entity:openai@@ released a new model."
 *  - "@@entity:sam-altman|Sam Altman|type:person@@ announced..."
 */
export const InteractiveSpanParser: React.FC<InteractiveSpanParserProps> = ({
  text,
  smartLinks,
  citations,
  entities,
  entityEnrichment,
  spanPrefix = "interactive-span",
  showIndicator = true,
  onCitationClick,
  onEntityClick,
}) => {
  if (!text) return null;
  const nodes: React.ReactNode[] = [];
  // Match any [[...]] token. The inner payload is parsed for label and metadata.
  const tokenRegex = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenCounter = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      nodes.push(
        ...parseCitationsEntitiesAndSmartLinks(
          before,
          smartLinks,
          citations,
          entities,
          onCitationClick,
          onEntityClick,
          entityEnrichment,
          `token-before-${match.index}`,
        ),
      );
    }

    const rawContent = match[1].trim();
    const [labelPart, metaPart] = rawContent.split("|");
    const label = (labelPart ?? "").trim();

    let dataIndex: number | undefined;
    if (metaPart) {
      const dataIndexMatch = /dataIndex\s*:\s*(\d+)/i.exec(metaPart);
      if (dataIndexMatch) {
        const parsed = Number.parseInt(dataIndexMatch[1], 10);
        if (!Number.isNaN(parsed)) {
          dataIndex = parsed;
        }
      }
    }

    const spanId = `${spanPrefix}-${tokenCounter++}`;

    nodes.push(
      <InteractiveSpan
        key={spanId}
        spanId={spanId}
        dataIndex={dataIndex}
        showIndicator={showIndicator}
      >
        {label || rawContent}
      </InteractiveSpan>,
    );

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest) {
      nodes.push(
        ...parseCitationsEntitiesAndSmartLinks(
          rest,
          smartLinks,
          citations,
          entities,
          onCitationClick,
          onEntityClick,
          entityEnrichment,
          `token-rest-${lastIndex}`,
        ),
      );
    }
  }

  return <>{nodes}</>;
};

export default InteractiveSpanParser;
