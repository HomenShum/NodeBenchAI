/**
 * EntityMentionText — Renders plain text with entity names as expandable
 * inline mention chips. Detects known entity names or @mentions in text
 * and wraps them with MentionExpansionPanel on click.
 *
 * Usage:
 *   <EntityMentionText text="Anthropic raised $2B from Sequoia Capital." />
 *   → "Anthropic" and "Sequoia Capital" become expandable chips
 *
 * Pattern: Entity name detection + inline expansion
 * Prior art: Notion @mention auto-linking, Roam Research entity detection
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */
import { useState, useMemo, Fragment, useCallback } from "react";
import { Building2, User, ChevronDown, ChevronRight } from "lucide-react";
import { MentionExpansionPanel } from "./MentionExpansionPanel";

// Known entity registry — populated at runtime via seedEntityRegistry()
// or from Convex entity profiles. Keys are lowercase canonical names.
// BOUND: max 500 entries with batch-safe eviction.
const entityRegistry = new Map<
  string,
  { id: string; name: string; kind: "company" | "person" | "tag" }
>();

const MAX_REGISTRY_SIZE = 500;

/** Cached regex pattern — invalidated on registry change */
let _cachedPattern: RegExp | null = null;
/** Cached sorted names — invalidated on registry change */
let _cachedSortedNames: string[] | null = null;

/** Invalidate caches when registry changes */
function invalidateRegistryCaches(): void {
  _cachedPattern = null;
  _cachedSortedNames = null;
}

/** Get sorted entity names (cached between registry changes) */
function getSortedNames(): string[] {
  if (_cachedSortedNames) return _cachedSortedNames;
  _cachedSortedNames = Array.from(entityRegistry.values())
    .map((e) => e.name)
    .sort((a, b) => b.length - a.length);
  return _cachedSortedNames;
}

/** Get compiled regex pattern (cached between registry changes) */
function getDetectionPattern(): RegExp | null {
  if (_cachedPattern) return _cachedPattern;
  const names = getSortedNames();
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  _cachedPattern = new RegExp(`@?(${escaped.join("|")})`, "gi");
  return _cachedPattern;
}

/**
 * Register a known entity so EntityMentionText can detect it in plain text.
 * Called from Home/Reports data hooks after loading entities.
 * BOUND: evicts oldest entries when at capacity (batch-safe).
 */
export function seedEntityRegistry(
  id: string,
  name: string,
  kind: "company" | "person" | "tag" = "company",
): void {
  // Batch-safe eviction: evict enough to stay under limit
  while (entityRegistry.size >= MAX_REGISTRY_SIZE) {
    const oldest = entityRegistry.keys().next().value;
    if (oldest !== undefined) entityRegistry.delete(oldest);
    else break;
  }
  entityRegistry.set(name.toLowerCase(), { id, name, kind });
  invalidateRegistryCaches();
}

type TextSegment =
  | { type: "text"; value: string }
  | { type: "entity"; id: string; name: string; kind: "company" | "person" | "tag" };

/**
 * Parse text into segments of plain text and entity mentions.
 * Detects @mentions and known entity names from the registry.
 */
function parseEntityMentions(text: string): TextSegment[] {
  if (!text || entityRegistry.size === 0) {
    return [{ type: "text", value: text || "" }];
  }

  // Use cached regex pattern (rebuilt only on registry change)
  const pattern = getDetectionPattern();
  if (!pattern) return [{ type: "text", value: text }];
  // Reset lastIndex since the regex is reused (global flag)
  pattern.lastIndex = 0;

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add preceding text
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const matchedName = match[1]; // without @ prefix
    const entry = entityRegistry.get(matchedName.toLowerCase());
    if (entry) {
      segments.push({
        type: "entity",
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
      });
    } else {
      // Fallback: treat as plain text
      segments.push({ type: "text", value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  // Add trailing text
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

type InlineMentionChipProps = {
  entityId: string;
  name: string;
  kind: "company" | "person" | "tag";
};

function InlineMentionChip({ entityId, name, kind }: InlineMentionChipProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const Icon = kind === "person" ? User : Building2;

  return (
    <span className="nb-expandable-mention-wrapper">
      <span
        className={`nb-expandable-mention ${expanded ? "expanded" : ""}`}
        data-kind={kind}
        data-entity={entityId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${name} entity${expanded ? ", expanded" : ""}`}
      >
        <Icon className="inline h-3 w-3 mr-0.5 opacity-60" aria-hidden="true" />
        <span>{name}</span>
        {expanded ? (
          <ChevronDown className="inline h-3 w-3 ml-0.5 opacity-40" aria-hidden="true" />
        ) : (
          <ChevronRight className="inline h-3 w-3 ml-0.5 opacity-40" aria-hidden="true" />
        )}
      </span>
      {expanded && (
        <MentionExpansionPanel entityId={entityId} label={name} kind={kind} />
      )}
    </span>
  );
}

type EntityMentionTextProps = {
  text: string;
  className?: string;
};

/**
 * Renders text with known entity names as expandable inline mention chips.
 * Falls back to plain text when no entities are registered.
 */
export function EntityMentionText({ text, className }: EntityMentionTextProps) {
  const segments = useMemo(() => parseEntityMentions(text), [text]);

  // If no entity segments found, render plain text (no wrapper overhead)
  const hasEntities = segments.some((s) => s.type === "entity");
  if (!hasEntities) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <Fragment key={`text-${i}`}>{seg.value}</Fragment>
        ) : (
          <InlineMentionChip
            key={`entity-${seg.id}-${i}`}
            entityId={seg.id}
            name={seg.name}
            kind={seg.kind}
          />
        ),
      )}
    </span>
  );
}

/**
 * Bulk-register entities from an array of entity data.
 * Call from data hooks after loading entity lists.
 */
export function seedEntitiesFromReports(
  reports: Array<{
    entitySlug?: string;
    title?: string;
    entityType?: string;
    primaryEntity?: string;
  }>,
): void {
  for (const r of reports) {
    const name = r.primaryEntity || r.title;
    const slug = r.entitySlug;
    if (!name || !slug) continue;

    const kind =
      r.entityType === "person"
        ? ("person" as const)
        : r.entityType === "tag"
          ? ("tag" as const)
          : ("company" as const);

    seedEntityRegistry(slug, name, kind);
  }
}
