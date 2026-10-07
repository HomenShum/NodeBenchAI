/**
 * Per-table recompute helpers for the federated search `searchableText`
 * field. Single source of truth — every insert path AND every patch hook
 * MUST call the same helper so the field stays consistent.
 *
 * Pattern: deterministic projection (per .claude/rules/agentic_reliability.md
 * `DETERMINISTIC`). Same row → same string, every time. Backfill compares
 * the computed value to the existing field and skips writes when equal,
 * so re-running the backfill is a no-op.
 *
 * Prior art:
 *   - PR #310 inserts (entities/eventWorkspace) — these helpers extract the
 *     same `composeSearchableText([...])` shape into one place.
 *
 * Why this file lives in `domains/search/` (not `domains/product/`):
 *   - Avoids a circular import: `product/entities.ts` already imports
 *     `composeSearchableText` from this folder. Putting the recompute
 *     helpers here keeps the dependency arrow one-way.
 *   - The 7 search-indexed collections cross domains (sourceArtifacts is
 *     in `domains/documents/`, quickCaptures and chatThreadsStream are
 *     top-level schema). Search owns the projection rules.
 */

import { composeSearchableText } from "./federatedHelpers";
import type { Doc } from "../../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* productEntities                                                             */
/*                                                                             */
/* Source fields: name, slug, summary, savedBecause                            */
/* Insert sites that already match: entities.ts:412, 653, 1734, 1814           */
/* Insert sites that already match: eventWorkspace.ts:421                      */
/* -------------------------------------------------------------------------- */

export function recomputeEntitySearchableText(
  doc: Pick<
    Doc<"productEntities">,
    "name" | "slug" | "summary" | "savedBecause"
  >,
): string {
  return composeSearchableText([
    doc.name,
    doc.slug,
    doc.summary,
    doc.savedBecause,
  ]);
}

/* -------------------------------------------------------------------------- */
/* productReports                                                              */
/*                                                                             */
/* Source fields: title, summary, query, primaryEntity, entitySlug             */
/* PR #310's schema docs the shape — but NO insert path actually populated     */
/* the field at ship time. PR D fixes the 4 insert sites + adds the patch     */
/* hook.                                                                       */
/*                                                                             */
/* Both `primaryEntity` (display name) and `entitySlug` (canonical) are        */
/* included — composeSearchableText dedupes case-insensitively, so identical   */
/* values collapse to one token without bloating the index.                    */
/* -------------------------------------------------------------------------- */

export function recomputeReportSearchableText(
  doc: Pick<
    Doc<"productReports">,
    "title" | "summary" | "query" | "primaryEntity" | "entitySlug"
  >,
): string {
  return composeSearchableText([
    doc.title,
    doc.summary,
    doc.query,
    doc.primaryEntity,
    doc.entitySlug,
  ]);
}

/* -------------------------------------------------------------------------- */
/* productBlocks                                                               */
/*                                                                             */
/* Source field: content — an ARRAY of `{type, value, url?}` chips (text /     */
/* mention / link / linebreak / image). We flatten by joining `value` from     */
/* every chip plus URL hostnames from links so a search for "openai.com"       */
/* finds blocks that link to it. `kind` is filterable on the index.            */
/*                                                                             */
/* Soft-deleted blocks (deletedAt set) get an empty searchableText so they     */
/* drop out of the keyword search index immediately.                           */
/* -------------------------------------------------------------------------- */

type BlockChip = Doc<"productBlocks">["content"][number];

function chipToSearchableTokens(chip: BlockChip): string[] {
  const tokens: string[] = [];
  if (chip.value && chip.value.trim().length > 0) tokens.push(chip.value);
  // For link chips, surface the hostname so search hits the domain too.
  if (chip.type === "link" && chip.url) {
    try {
      const hostname = new URL(chip.url).hostname.replace(/^www\./, "");
      if (hostname) tokens.push(hostname);
    } catch {
      // Invalid URL — silently skip, the chip's `value` is still searchable.
    }
  }
  if (chip.mentionTarget) tokens.push(chip.mentionTarget);
  return tokens;
}

export function recomputeBlockSearchableText(
  doc: Pick<Doc<"productBlocks">, "content" | "deletedAt">,
): string {
  if (doc.deletedAt) return "";
  if (!Array.isArray(doc.content)) return "";
  const allTokens = doc.content.flatMap(chipToSearchableTokens);
  return composeSearchableText(allTokens);
}

/* -------------------------------------------------------------------------- */
/* sourceArtifacts                                                             */
/*                                                                             */
/* Source fields: title, sourceUrl, mimeType. We deliberately exclude          */
/* `rawContent` because it can be megabytes — the snippet from title + URL +   */
/* mime is enough signal for search ranking; full content is reachable via the */
/* row itself.                                                                 */
/* -------------------------------------------------------------------------- */

export function recomputeSourceSearchableText(
  doc: Pick<Doc<"sourceArtifacts">, "title" | "sourceUrl" | "mimeType">,
): string {
  return composeSearchableText([doc.title, doc.sourceUrl, doc.mimeType]);
}

/* -------------------------------------------------------------------------- */
/* productClaims, quickCaptures, chatThreadsStream                             */
/*                                                                             */
/* These three tables index a REQUIRED field directly:                         */
/*   - productClaims  → claimText (always populated on insert)                 */
/*   - quickCaptures  → content   (always populated on insert)                 */
/*   - chatThreadsStream → title  (always populated on insert)                 */
/*                                                                             */
/* So they need no `searchableText` projection or backfill — every existing    */
/* row is already searchable. Patch sites that mutate the source field will    */
/* automatically refresh the index because Convex re-indexes on patch.         */
/* -------------------------------------------------------------------------- */
