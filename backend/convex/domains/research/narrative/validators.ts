/**
 * Shared DRANE Narrative Validators (Phase 7)
 *
 * Single source of truth for validators used across mutations, queries, and schema.
 * Import these instead of defining inline to avoid copy-paste drift.
 *
 * @module domains/narrative/validators
 */

import { v } from "convex/values";

// ─── Speculative Risk ────────────────────────────────────────────────────────
export const speculativeRiskValidator = v.union(
  v.literal("grounded"),
  v.literal("mixed"),
  v.literal("speculative")
);

export type SpeculativeRisk = "grounded" | "mixed" | "speculative";

// ─── Entailment Verdict ──────────────────────────────────────────────────────
export const entailmentVerdictValidator = v.union(
  v.literal("entailed"),
  v.literal("neutral"),
  v.literal("contradicted")
);

export type EntailmentVerdict = "entailed" | "neutral" | "contradicted";

// ─── Claim Kind ──────────────────────────────────────────────────────────────
export const claimKindValidator = v.union(
  v.literal("verifiable"),
  v.literal("interpretation"),
  v.literal("prediction")
);

export type ClaimKind = "verifiable" | "interpretation" | "prediction";

// ─── ClaimSet Item (Phase 7) ─────────────────────────────────────────────────
export const claimSetItemValidator = v.object({
  claim: v.string(),
  confidence: v.number(),
  evidenceArtifactIds: v.array(v.string()),
  kind: v.optional(claimKindValidator),
  uncertainty: v.optional(v.number()),
  speculativeRisk: v.optional(speculativeRiskValidator),
  entailmentVerdict: v.optional(entailmentVerdictValidator),
  hypothesisId: v.optional(v.string()),
});

export const claimSetValidator = v.optional(v.array(claimSetItemValidator));

// ─── Hypothesis Status ───────────────────────────────────────────────────────
export const hypothesisStatusValidator = v.union(
  v.literal("active"),
  v.literal("supported"),
  v.literal("weakened"),
  v.literal("inconclusive"),
  v.literal("retired")
);

export type HypothesisStatus = "active" | "supported" | "weakened" | "inconclusive" | "retired";

// ─── Signal Metric Domain ────────────────────────────────────────────────────
export const signalDomainValidator = v.union(
  v.literal("attention"),
  v.literal("policy"),
  v.literal("labor"),
  v.literal("market"),
  v.literal("sentiment")
);

export type SignalDomain = "attention" | "policy" | "labor" | "market" | "sentiment";

// ─── Source Tier ─────────────────────────────────────────────────────────────
export const sourceTierValidator = v.union(
  v.literal("tier1"),
  v.literal("tier2"),
  v.literal("tier3"),
  v.literal("tier4")
);

export type SourceTier = "tier1" | "tier2" | "tier3" | "tier4";

// ─── Evidence Checklist (Deterministic Boolean Confidence) ──────────────────
//
// Replaces arbitrary 0.0-1.0 confidence floats with explainable boolean gates.
// Each check is independently verifiable. Confidence = passing checks / total.
// Evidence level derived deterministically:
//   grounded:    ≥ 4 of 6 checks pass
//   mixed:       2-3 of 6 checks pass
//   speculative: 0-1 of 6 checks pass

export const evidenceChecklistValidator = v.object({
  hasPrimarySource: v.boolean(),    // tier1/tier2 source (gov filing, court doc, wire service)
  hasCorroboration: v.boolean(),    // 2+ independent sources agree on core claim
  hasFalsifiableClaim: v.boolean(), // a defined way to disprove this exists
  hasQuantitativeData: v.boolean(), // hard numbers, not just qualitative assertion
  hasNamedAttribution: v.boolean(), // named expert, official, or org (not "sources say")
  isReproducible: v.boolean(),      // someone could independently verify by following sources
});

export interface EvidenceChecklist {
  hasPrimarySource: boolean;
  hasCorroboration: boolean;
  hasFalsifiableClaim: boolean;
  hasQuantitativeData: boolean;
  hasNamedAttribution: boolean;
  isReproducible: boolean;
}

const CHECKLIST_KEYS: (keyof EvidenceChecklist)[] = [
  "hasPrimarySource",
  "hasCorroboration",
  "hasFalsifiableClaim",
  "hasQuantitativeData",
  "hasNamedAttribution",
  "isReproducible",
];

/** Count how many boolean checks pass */
export function countPassingChecks(checklist: EvidenceChecklist): number {
  return CHECKLIST_KEYS.filter((k) => checklist[k]).length;
}

/** Deterministic confidence: passing / total (0.0 - 1.0) */
export function deterministicConfidence(checklist: EvidenceChecklist): number {
  return countPassingChecks(checklist) / CHECKLIST_KEYS.length;
}

/** Derive evidence level from boolean count — no arbitrary thresholds */
export function deriveEvidenceLevel(checklist: EvidenceChecklist): SpeculativeRisk {
  const passing = countPassingChecks(checklist);
  if (passing >= 4) return "grounded";
  if (passing >= 2) return "mixed";
  return "speculative";
}

/** Human-readable explanation of what passed and what didn't */
export function explainChecklist(checklist: EvidenceChecklist): string {
  const passing = CHECKLIST_KEYS.filter((k) => checklist[k]);
  const failing = CHECKLIST_KEYS.filter((k) => !checklist[k]);
  const parts: string[] = [];
  if (passing.length > 0) parts.push(`Passes: ${passing.join(", ")}`);
  if (failing.length > 0) parts.push(`Missing: ${failing.join(", ")}`);
  return `${passing.length}/${CHECKLIST_KEYS.length} checks. ${parts.join(". ")}`;
}

// ─── Hypothesis Candidate (shared between Analyst agent and NewsroomState) ───
export interface HypothesisCandidate {
  label: string;
  title: string;
  claimForm: string;
  measurementApproach: string;
  speculativeRisk: SpeculativeRisk;
  falsificationCriteria?: string;
  evidenceChecklist?: EvidenceChecklist;
}
