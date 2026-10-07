/**
 * blockOrdering.ts — Fractional indexing helper for productBlocks.
 *
 * Uses fractional indexing (Roam Research / outliner-style positioning).
 * Every block has (positionInt, positionFrac). To insert between two blocks, we
 * generate a new fractional key between their positionFrac values — O(1), no
 * re-indexing ever. Different positionInt values are used for "tiers" so that
 * a new tier can be added without touching sibling positions.
 */

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export type BlockPosition = {
  int: number;
  frac: string;
};

/**
 * Generate a new position that sits strictly between `before` and `after`.
 * Either side can be null (open-ended).
 *
 * Rules:
 *   - If both sides have the same `int`, produce a new `frac` between them at
 *     the same `int` tier.
 *   - If they have different `int` tiers, we take the lower tier's int and
 *     generate a frac relative to the frac boundaries of that tier.
 *   - If both sides are null, start a fresh tier at Date.now() (ensures new
 *     blocks appear after any pre-existing tier based on creation time).
 */
export function positionBetween(
  before: BlockPosition | null,
  after: BlockPosition | null,
): BlockPosition {
  if (!before && !after) {
    return { int: Date.now(), frac: generateKeyBetween(null, null) };
  }
  if (before && !after) {
    return {
      int: before.int,
      frac: generateKeyBetween(before.frac, null),
    };
  }
  if (!before && after) {
    return {
      int: after.int,
      frac: generateKeyBetween(null, after.frac),
    };
  }
  // Both sides present
  const b = before as BlockPosition;
  const a = after as BlockPosition;
  if (b.int === a.int) {
    return { int: b.int, frac: generateKeyBetween(b.frac, a.frac) };
  }
  // Cross-tier: anchor on the lower-int tier.
  const int = Math.min(b.int, a.int);
  return {
    int,
    frac: generateKeyBetween(b.int === int ? b.frac : null, a.int === int ? a.frac : null),
  };
}

/**
 * Generate N contiguous positions between `before` and `after`.
 * Useful when the agent inserts a whole block run at once (e.g. synthesize
 * produces 8 blocks that should sit between two existing anchors).
 */
export function positionsBetween(
  before: BlockPosition | null,
  after: BlockPosition | null,
  count: number,
): BlockPosition[] {
  if (count <= 0) return [];
  if (count === 1) return [positionBetween(before, after)];

  // Pick an int tier consistent with positionBetween's single-position logic.
  let int: number;
  if (!before && !after) int = Date.now();
  else if (before && !after) int = before.int;
  else if (!before && after) int = after.int;
  else int = Math.min((before as BlockPosition).int, (after as BlockPosition).int);

  const beforeFrac =
    before && before.int === int ? before.frac : null;
  const afterFrac =
    after && after.int === int ? after.frac : null;

  const fracs = generateNKeysBetween(beforeFrac, afterFrac, count);
  return fracs.map((frac) => ({ int, frac }));
}

/**
 * Compare two positions. Returns negative if a<b, 0 if equal, positive if a>b.
 * Callers use this to sort a block list in rendering order.
 *
 * NOTE: When two clients insert concurrently between the same pair, they can
 * produce identical (int, frac). In that case this returns 0 and render order
 * is UNDEFINED — use comparePositionsWithId for deterministic ordering.
 */
export function comparePositions(a: BlockPosition, b: BlockPosition): number {
  if (a.int !== b.int) return a.int - b.int;
  if (a.frac < b.frac) return -1;
  if (a.frac > b.frac) return 1;
  return 0;
}

/**
 * Deterministic compare with tiebreaker on a stable id (blockId / authorId).
 * Used to resolve concurrent-insert collisions. Both clients sorting the same
 * set with the same comparator always produce the same order.
 *
 * Scenario covered: two authors press Enter at the same position simultaneously.
 * Without the tiebreaker they get identical (int, frac) and render order flips
 * between refreshes. With the tiebreaker, lexicographic ordering on the id
 * gives stable output on every client.
 */
export function comparePositionsWithId(
  a: BlockPosition & { id: string },
  b: BlockPosition & { id: string },
): number {
  const primary = comparePositions(a, b);
  if (primary !== 0) return primary;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Default position for a brand-new root block (no siblings yet).
 */
export function initialPosition(): BlockPosition {
  return { int: Date.now(), frac: generateKeyBetween(null, null) };
}
