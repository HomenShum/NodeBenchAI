import type { ExtractionResult } from "./langExtract";

export interface TemporalObservationInput {
  observedAt: number;
  observationType: "numeric" | "categorical" | "event" | "text";
  valueNumber?: number;
  valueText?: string;
  units?: string;
  headline?: string;
  summary?: string;
  sourceExcerpt?: string;
  sourceRefs?: Array<{
    label: string;
    href?: string;
    note?: string;
    lineStart?: number;
    lineEnd?: number;
  }>;
  tags?: string[];
}

export interface StructuredSourceIngestionArgs {
  sourceType: "slack" | "github" | "jira" | "web" | "document" | "manual" | "system";
  sourceLabel?: string;
  sourceUrl?: string;
}

function buildSourceRefs(
  sourceLabel: string,
  sourceUrl: string | undefined,
  lineStart: number | undefined,
  lineEnd: number | undefined,
  note: string,
) {
  return [
    {
      label: sourceLabel,
      href: sourceUrl,
      note,
      lineStart,
      lineEnd,
    },
  ];
}

function resolveObservedAt(
  temporalMarkers: ExtractionResult["temporalMarkers"],
  lineNumber: number | undefined,
  fallbackBaseMs: number,
  sequenceOffset: number,
) {
  if (lineNumber !== undefined) {
    const sameLine = temporalMarkers.find(
      (marker) => marker.lineNumber === lineNumber && marker.resolvedDate !== undefined
    );
    if (sameLine?.resolvedDate) {
      return sameLine.resolvedDate;
    }

    const nearestEarlier = temporalMarkers
      .filter((marker) => marker.lineNumber <= lineNumber && marker.resolvedDate !== undefined)
      .sort((a, b) => b.lineNumber - a.lineNumber)[0];
    if (nearestEarlier?.resolvedDate) {
      return nearestEarlier.resolvedDate + sequenceOffset;
    }
  }

  return fallbackBaseMs + sequenceOffset;
}

export function buildObservationsFromExtraction(
  extraction: ExtractionResult,
  args: StructuredSourceIngestionArgs,
  fallbackBaseMs: number = Date.now(),
): TemporalObservationInput[] {
  const sourceLabel = args.sourceLabel ?? `${args.sourceType}-extract`;
  const observations: TemporalObservationInput[] = [];
  let offset = 0;

  for (const fact of extraction.numericFacts) {
    observations.push({
      observedAt: resolveObservedAt(
        extraction.temporalMarkers,
        fact.lineNumber,
        fallbackBaseMs,
        offset++
      ),
      observationType: "numeric",
      valueNumber: fact.value,
      units: fact.units,
      headline: fact.metric,
      summary: fact.context,
      sourceExcerpt: fact.context,
      sourceRefs: buildSourceRefs(
        sourceLabel,
        args.sourceUrl,
        fact.lineNumber,
        fact.lineNumber,
        `Numeric fact extracted from line ${fact.lineNumber}`
      ),
      tags: [args.sourceType, fact.metric, "numeric_fact"],
    });
  }

  for (const claim of extraction.claims) {
    observations.push({
      observedAt: resolveObservedAt(
        extraction.temporalMarkers,
        claim.sourceSpan?.lineStart,
        fallbackBaseMs,
        offset++
      ),
      observationType: claim.claimType === "causal" ? "event" : "text",
      valueText: claim.claimText,
      headline: claim.claimType,
      summary: claim.claimText,
      sourceExcerpt: claim.sourceSpan?.excerpt ?? claim.claimText,
      sourceRefs: buildSourceRefs(
        sourceLabel,
        args.sourceUrl,
        claim.sourceSpan?.lineStart,
        claim.sourceSpan?.lineEnd,
        `Claim extracted from lines ${claim.sourceSpan?.lineStart ?? "?"}-${claim.sourceSpan?.lineEnd ?? "?"}`
      ),
      tags: [args.sourceType, claim.claimType, "claim", ...claim.entities],
    });
  }

  for (const marker of extraction.temporalMarkers) {
    observations.push({
      observedAt: marker.resolvedDate ?? fallbackBaseMs + offset++,
      observationType: "event",
      valueText: marker.text,
      headline: "temporal_marker",
      summary: marker.text,
      sourceExcerpt: marker.text,
      sourceRefs: buildSourceRefs(
        sourceLabel,
        args.sourceUrl,
        marker.lineNumber,
        marker.lineNumber,
        `Temporal marker extracted from line ${marker.lineNumber}`
      ),
      tags: [args.sourceType, "temporal_marker"],
    });
  }

  return observations.sort((a, b) => a.observedAt - b.observedAt);
}

export function getSafeAverageStepMs(values: Array<{ t: number; v: number }>) {
  if (values.length < 2) {
    return 86400000;
  }

  const deltas: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const delta = values[i].t - values[i - 1].t;
    if (Number.isFinite(delta) && delta > 0) {
      deltas.push(delta);
    }
  }

  if (deltas.length === 0) {
    return 86400000;
  }

  const avg = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  return avg > 0 ? avg : 86400000;
}
