export type ResearchVerdictTier =
  | "verified"
  | "provisionally_verified"
  | "needs_review"
  | "failed";

export interface ResearchVerdict {
  tier: ResearchVerdictTier;
  passing: number;
  failing: number;
  notes: string[];
}

export type CitationBindingState =
  | "valid"
  | "no_external_sources"
  | "unbound_sources"
  | "invalid_markers";

export interface CitationMarkerValidation {
  state: CitationBindingState;
  validMarkers: number[];
  invalidMarkers: string[];
  sourceCount: number;
}

/**
 * Parse only explicit numeric `[N]` markers. Non-numeric Markdown brackets are
 * not citations. Markers must be canonical positive integers within the exact
 * retrieved-source range; `[0]`, `[-1]`, `[01]`, and out-of-range values fail.
 */
export function validateCitationMarkers(
  synthesis: string,
  sourceCount: number,
): CitationMarkerValidation {
  const validMarkers: number[] = [];
  const invalidMarkers: string[] = [];
  const validSeen = new Set<number>();
  const invalidSeen = new Set<string>();
  const markerPattern = /\[(-?\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(synthesis)) !== null) {
    const raw = match[1];
    const marker = Number(raw);
    const canonical = String(marker) === raw;
    if (
      !canonical ||
      !Number.isSafeInteger(marker) ||
      marker < 1 ||
      marker > sourceCount
    ) {
      const rendered = `[${raw}]`;
      if (!invalidSeen.has(rendered)) {
        invalidSeen.add(rendered);
        invalidMarkers.push(rendered);
      }
      continue;
    }
    if (!validSeen.has(marker)) {
      validSeen.add(marker);
      validMarkers.push(marker);
    }
  }

  const state: CitationBindingState =
    invalidMarkers.length > 0
      ? "invalid_markers"
      : sourceCount === 0
        ? "no_external_sources"
        : validMarkers.length === 0
          ? "unbound_sources"
          : "valid";
  return { state, validMarkers, invalidMarkers, sourceCount };
}

export function selectCitationsUsed<
  T extends { title?: string; url?: string },
>(
  sourcesConsulted: T[],
  validation: CitationMarkerValidation,
): Array<{ idx: number; title?: string; url?: string }> {
  return validation.validMarkers.map((idx) => {
    const source = sourcesConsulted[idx - 1];
    return { idx, title: source?.title, url: source?.url };
  });
}

function normalizeVerdict(
  input: Partial<ResearchVerdict> | null | undefined,
): ResearchVerdict {
  const candidate = input ?? {};
  const tier: ResearchVerdictTier =
    candidate.tier === "verified" ||
    candidate.tier === "provisionally_verified" ||
    candidate.tier === "needs_review" ||
    candidate.tier === "failed"
      ? candidate.tier
      : "needs_review";
  return {
    tier,
    passing:
      typeof candidate.passing === "number" && Number.isFinite(candidate.passing)
        ? Math.max(0, candidate.passing)
        : 0,
    failing:
      typeof candidate.failing === "number" && Number.isFinite(candidate.failing)
        ? Math.max(0, candidate.failing)
        : 0,
    notes: Array.isArray(candidate.notes)
      ? candidate.notes.filter((note): note is string => typeof note === "string")
      : [],
  };
}

function citationDowngradeNote(
  validation: CitationMarkerValidation,
): string {
  switch (validation.state) {
    case "no_external_sources":
      return "No external sources were retrieved; the synthesis requires review.";
    case "unbound_sources":
      return "Sources were consulted, but the synthesis contains no bound [N] citations.";
    case "invalid_markers":
      return `The synthesis contains invalid citation markers: ${validation.invalidMarkers.join(", ")}.`;
    default:
      return "";
  }
}

/** A model verdict can never override deterministic citation provenance. */
export function applyCitationBoundVerdict(
  candidate: Partial<ResearchVerdict> | null | undefined,
  validation: CitationMarkerValidation,
): ResearchVerdict {
  const verdict = normalizeVerdict(candidate);
  if (verdict.tier === "failed" || validation.state === "valid") return verdict;
  const note = citationDowngradeNote(validation);
  return {
    ...verdict,
    tier: "needs_review",
    notes: note && !verdict.notes.includes(note)
      ? [...verdict.notes, note]
      : verdict.notes,
  };
}
