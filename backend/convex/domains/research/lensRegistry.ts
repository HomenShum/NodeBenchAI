/**
 * Lens Registry
 *
 * Each lens tells the research orchestrator how to project the canonical
 * entity graph (intelligenceEntities + edges + claims + claimEvidence) into
 * a layered card workspace.
 *
 * Pattern: "graph is the truth, hierarchy is the view" —
 * see .claude/rules/orchestrator_workers.md and the canonical ontology
 * spec in docs/architecture/NODEBENCH_ONTOLOGY.md (to be written).
 *
 * v1 ships only `company_dossier`. Other lens IDs are reserved type slots
 * to keep the routing layer forward-compatible; adding them is a schema-
 * free change once v1 is proven.
 */

import type { AngleId } from "../../../shared/research/angleIds";
import type { LensId, DepthId } from "../../../shared/research/lensIds";

/** A single layer of a lens's rendered hierarchy. */
export interface LensLayer {
  /** Stable id — drives card-stack navigation. */
  id: string;
  /** Human label for the layer header. */
  label: string;
  /** Entity `entityType` values (from intelligenceEntities) allowed here. */
  allowedEntityTypes: ReadonlyArray<string>;
  /** Relation types (edges.relationType) used to traverse INTO this layer. */
  relationWhitelist: ReadonlyArray<string>;
  /** Max cards emitted per layer per ring — BOUND rule. */
  maxItems: number;
}

export interface LensTemplate {
  id: LensId;
  /** Entity types that may serve as this lens's root. */
  rootEntityTypes: ReadonlyArray<string>;
  /** Angles activated when this lens runs (per depth). */
  angles: Partial<Record<DepthId, ReadonlyArray<AngleId>>>;
  /** Ordered layer definitions. */
  layers: ReadonlyArray<LensLayer>;
}

// ---------------------------------------------------------------------------
// company_dossier — v1 MVP lens
// ---------------------------------------------------------------------------

export const COMPANY_DOSSIER_LENS: LensTemplate = {
  id: "company_dossier",
  rootEntityTypes: ["company", "subsidiary", "organization"],
  angles: {
    quick: ["entity_profile", "public_signals"],
    standard: ["entity_profile", "public_signals", "document_discovery"],
  },
  layers: [
    {
      id: "people",
      label: "Key People",
      allowedEntityTypes: ["person"],
      relationWhitelist: ["FOUNDED", "WORKS_AT", "BOARD_MEMBER_OF", "ADVISES"],
      maxItems: 25,
    },
    {
      id: "products",
      label: "Products",
      allowedEntityTypes: ["product"],
      relationWhitelist: ["BUILDS", "OWNS", "MAINTAINS"],
      maxItems: 20,
    },
    {
      id: "capital_commercial",
      label: "Capital & Commercial",
      allowedEntityTypes: ["company", "fund", "investor", "organization"],
      relationWhitelist: [
        "INVESTED_IN",
        "PARTNERS_WITH",
        "CUSTOMER_OF",
        "ACQUIRED",
        "COMPETES_WITH",
      ],
      maxItems: 25,
    },
    {
      id: "press_market",
      label: "Press & Market",
      allowedEntityTypes: ["organization", "other"],
      relationWhitelist: ["MENTIONED_IN", "REPORTED_BY"],
      maxItems: 40,
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

export const LENS_TEMPLATES: Partial<Record<LensId, LensTemplate>> = {
  company_dossier: COMPANY_DOSSIER_LENS,
  // event_brief, person_deep_dive, product_map, topic_monitor — v2.
};

export function getLensTemplate(lensId: LensId): LensTemplate | undefined {
  return LENS_TEMPLATES[lensId];
}

/**
 * Pick the angle set for the given lens + depth. Falls back to `quick` if
 * the depth is undefined for a lens, then to an empty array (HONEST_STATUS —
 * never fabricate angle coverage).
 */
export function anglesForLens(
  lensId: LensId,
  depth: DepthId,
): ReadonlyArray<AngleId> {
  const tpl = LENS_TEMPLATES[lensId];
  if (!tpl) return [];
  return tpl.angles[depth] ?? tpl.angles.quick ?? [];
}
