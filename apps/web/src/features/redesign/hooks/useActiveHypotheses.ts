/**
 * useActiveHypotheses — wraps the public Convex query
 * `domains.research.editionQueries.getActiveHypotheses` for §2.
 * Returns `undefined` (loading), `[]` (no hypotheses — section
 * hides), or the array of hypotheses ready to render.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { EvidenceChecklist } from "../../../../convex/domains/research/narrative/validators";

export interface EditionHypothesis {
  _id: string;
  hypothesisId: string;
  threadId: string;
  threadName: string;
  label: string;
  title: string;
  claimForm: string;
  measurementApproach: string;
  falsificationCriteria: string | null;
  status: "active" | "supported" | "weakened" | "inconclusive" | "retired";
  confidence: number;
  speculativeRisk: "grounded" | "mixed" | "speculative";
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  evidenceArtifactIds: string[];
  competingHypothesisIds: string[];
  updatedAt: number;
  evidenceChecklist: EvidenceChecklist;
  evidenceChecksPassing: number;
  evidenceChecksTotal: number;
  evidenceLevel: "grounded" | "mixed" | "speculative";
}

export function useActiveHypotheses(limit = 5): EditionHypothesis[] | undefined {
  const data = useQuery(
    api.domains.research.editionQueries.getActiveHypotheses,
    { limit },
  );
  return data as EditionHypothesis[] | undefined;
}
