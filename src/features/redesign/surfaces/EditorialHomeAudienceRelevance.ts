import type { EditionHypothesis } from "../hooks/useActiveHypotheses";

export const HOME_AUDIENCE_RELEVANCE_SECTION = {
  kicker: "Audience relevance",
  tocLabel: "Useful",
  heading: "Why this is useful",
} as const;

export const HOME_EVIDENCE_WATCHLIST_SECTION = {
  kicker: "Evidence watchlist",
  tocLabel: "Check",
  heading: "What to check next",
} as const;

export interface ForecastReviewInput {
  probability?: number | null;
  previousProbability?: number | null;
  probabilityDelta?: number | null;
  resolutionDate?: string | null;
  updateCount?: number | null;
  status?: string | null;
}

function formatReviewProbability(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return "probability ledger pending";
  }
  return `${Math.round(p * 100)}% current ledger`;
}

function formatReviewDelta(f: ForecastReviewInput): string | null {
  if (
    f.previousProbability !== null &&
    f.previousProbability !== undefined &&
    Number.isFinite(f.previousProbability)
  ) {
    return `${Math.round(f.previousProbability * 100)}% previous ledger`;
  }
  if (
    f.probabilityDelta !== null &&
    f.probabilityDelta !== undefined &&
    Number.isFinite(f.probabilityDelta)
  ) {
    const pp = Math.round(f.probabilityDelta * 100);
    return `${pp > 0 ? "+" : ""}${pp}pp weekly ledger move`;
  }
  return null;
}

export function getHypothesisReviewTitle(
  h: Pick<EditionHypothesis, "label" | "threadName"> | { label?: string; threadName?: string },
): string {
  const topic = h.threadName?.trim() || h.label?.trim() || "Hypothesis";
  return `${topic} evidence review`;
}

export function getHypothesisReviewSummary(h: EditionHypothesis): string {
  const checks =
    h.evidenceChecksTotal > 0
      ? `${h.evidenceChecksPassing}/${h.evidenceChecksTotal} evidence checks passing`
      : "evidence checks pending";

  return [
    `${h.supportingEvidenceCount} supporting refs`,
    `${h.contradictingEvidenceCount} contradicting refs`,
    checks,
    `${h.threadName} review queue`,
  ].join(" | ");
}

export function getForecastReviewSummary(f: ForecastReviewInput): string {
  const parts = [
    formatReviewProbability(f.probability),
    formatReviewDelta(f),
    f.updateCount !== null && f.updateCount !== undefined
      ? `${f.updateCount} update${f.updateCount === 1 ? "" : "s"} logged`
      : "weekly movement logged",
    f.resolutionDate ? `resolution ${f.resolutionDate}` : "resolution date pending",
    f.status ? `${f.status} status` : null,
  ];

  return parts.filter(Boolean).join(" | ");
}
