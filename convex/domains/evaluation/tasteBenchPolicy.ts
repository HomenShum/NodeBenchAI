/**
 * Pure policy for TasteBench.
 *
 * Keep this module free of Convex runtime imports so the authorization,
 * blinding, validation, and append-only state rules can be unit tested without
 * a deployment.
 */

export const TASTE_BENCH_CATALOG_VERSION = "tastebench-v1" as const;

// IDs mirror the six AI-app entries in
// src/features/controlPlane/components/dogfoodSuite.ts. TasteBench narrows the
// existing fixed catalog; it does not create a parallel fixture catalog.
export const TASTE_BENCH_SCENARIOS = [
  {
    id: "app-01-founder-weekly-reset",
    title: "Founder Weekly Reset",
    surface: "AI app",
    audience: "founder",
    expectedOutcome:
      "A decisive, evidence-led weekly reset with next moves and a reusable packet.",
    expectedPrimitiveCoverage: [
      "context_recall",
      "evidence_grounding",
      "decision_packet",
      "artifact_export",
    ],
  },
  {
    id: "app-02-pre-delegation-packet",
    title: "Pre-Delegation Packet",
    surface: "AI app",
    audience: "founder",
    expectedOutcome:
      "An executable handoff packet that does not require the next agent to re-derive context.",
    expectedPrimitiveCoverage: [
      "context_packet",
      "scope_constraints",
      "success_criteria",
      "delegation_handoff",
    ],
  },
  {
    id: "app-03-important-change-review",
    title: "Important-Change Review",
    surface: "AI app",
    audience: "founder",
    expectedOutcome:
      "A low-noise review of consequential changes and the refreshes they require.",
    expectedPrimitiveCoverage: [
      "change_detection",
      "noise_suppression",
      "evidence_grounding",
      "packet_refresh",
    ],
  },
  {
    id: "app-04-competitor-supermemory",
    title: "Competitor Intelligence Brief",
    surface: "AI app",
    audience: "researcher",
    expectedOutcome:
      "A sourced competitor brief that separates what to absorb from what not to compete with.",
    expectedPrimitiveCoverage: [
      "web_grounding",
      "claim_graph",
      "countermodel",
      "decision_packet",
    ],
  },
  {
    id: "app-05-banker-anthropic",
    title: "Banker / CEO Company Search",
    surface: "AI app",
    audience: "banker",
    expectedOutcome:
      "An exportable executive memo with business quality, risks, changes, and diligence questions.",
    expectedPrimitiveCoverage: [
      "company_search",
      "source_citations",
      "risk_assessment",
      "memo_export",
    ],
  },
  {
    id: "app-06-student-shopify",
    title: "Student Strategy Search",
    surface: "AI app",
    audience: "student",
    expectedOutcome:
      "A plain-language, citation-friendly study brief calibrated to a student audience.",
    expectedPrimitiveCoverage: [
      "web_grounding",
      "audience_calibration",
      "comparables",
      "study_brief",
    ],
  },
] as const;

export type TasteBenchScenarioId = (typeof TASTE_BENCH_SCENARIOS)[number]["id"];

export const TASTE_BENCH_DIMENSIONS = [
  "narrative",
  "visual_semantics",
  "composition",
  "craft",
  "trust",
  "interaction",
] as const;

export type TasteBenchDimension = (typeof TASTE_BENCH_DIMENSIONS)[number];

export const TASTE_BENCH_CORRECTION_TAXONOMY = [
  "reduced_density",
  "strengthened_hierarchy",
  "changed_visual_encoding",
  "corrected_audience_level",
  "factual",
  "source",
  "scope",
  "tone",
  "other",
] as const;

export type TasteBenchCorrectionKind =
  (typeof TASTE_BENCH_CORRECTION_TAXONOMY)[number];

export const TASTE_BENCH_STORED_CHOICES = [
  "baseline",
  "candidate",
  "tie",
  "both_fail",
] as const;

export type TasteBenchStoredChoice =
  (typeof TASTE_BENCH_STORED_CHOICES)[number];
export type TasteBenchPresentedChoice = "a" | "b" | "tie" | "both_fail";
export type TasteBenchRunState = "active" | "completed" | "abandoned";
export type TasteBenchEventType =
  | "run_started"
  | "direction_generated"
  | "direction_viewed"
  | "direction_selected"
  | "direction_rejected"
  | "operation_accepted"
  | "operation_changed"
  | "operation_undone"
  | "approval_interrupted"
  | "proposal_invalid"
  | "proposal_retried"
  | "reviewable_output"
  | "artifact_exported"
  | "artifact_presented"
  | "artifact_reused"
  | "artifact_refreshed"
  | "correction_recorded"
  | "run_completed"
  | "run_abandoned";

export const TASTE_BENCH_OPERATIONAL_EVENT_TYPES = [
  "direction_generated",
  "direction_viewed",
  "direction_selected",
  "direction_rejected",
  "operation_accepted",
  "operation_changed",
  "operation_undone",
  "approval_interrupted",
  "proposal_invalid",
  "proposal_retried",
  "reviewable_output",
  "artifact_exported",
  "artifact_presented",
  "artifact_reused",
  "artifact_refreshed",
] as const;

export type TasteBenchOperationalEventType =
  (typeof TASTE_BENCH_OPERATIONAL_EVENT_TYPES)[number];

export type TasteBenchStateEvent = {
  eventType: TasteBenchEventType;
  sequence: number;
};

function includesString<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value as T[number]);
}

export function assertTasteBenchScenarioId(
  value: string,
): asserts value is TasteBenchScenarioId {
  if (!TASTE_BENCH_SCENARIOS.some((scenario) => scenario.id === value)) {
    throw new Error("Unknown TasteBench scenario");
  }
}

export function validateTasteBenchDimensions(
  values: readonly string[],
): TasteBenchDimension[] {
  const normalized = Array.from(new Set(values));
  if (normalized.length === 0) {
    throw new Error("Select at least one TasteBench dimension");
  }
  if (
    normalized.some((value) => !includesString(TASTE_BENCH_DIMENSIONS, value))
  ) {
    throw new Error("Unknown TasteBench dimension");
  }
  return normalized as TasteBenchDimension[];
}

export function assertTasteBenchCorrectionKind(
  value: string,
): asserts value is TasteBenchCorrectionKind {
  if (!includesString(TASTE_BENCH_CORRECTION_TAXONOMY, value)) {
    throw new Error("Unknown TasteBench correction classification");
  }
}

export function assertTasteBenchOperationalEventType(
  value: string,
): asserts value is TasteBenchOperationalEventType {
  if (!includesString(TASTE_BENCH_OPERATIONAL_EVENT_TYPES, value)) {
    throw new Error("Unknown TasteBench operational event");
  }
}

export function normalizeTasteBenchReason(
  value: string,
  field = "Reason",
): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 16) {
    throw new Error(`${field} must explain the human judgment`);
  }
  if (normalized.length > 1_200) {
    throw new Error(`${field} must be 1,200 characters or fewer`);
  }
  return normalized;
}

export function isTasteBenchEvidenceEligible(args: {
  prompt: string;
  scenarioId: TasteBenchScenarioId;
  mediaUrl?: string | null;
  inputSha256?: string | null;
  summary: string;
}): boolean {
  const prompt = args.prompt.toLocaleLowerCase();
  const scenarioMarkers = Array.from(
    prompt.matchAll(
      /(?:^|[^a-z0-9_-])tastebench-scenario:([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[^a-z0-9_-])/gi,
    ),
    (match) => match[1]?.toLocaleLowerCase(),
  ).filter((marker): marker is string => Boolean(marker));
  const mediaUrl = args.mediaUrl?.trim() ?? "";
  const inputSha256 = args.inputSha256?.trim() ?? "";
  return Boolean(
    scenarioMarkers.length === 1 &&
    scenarioMarkers[0] === args.scenarioId.toLocaleLowerCase() &&
    /^(https?:\/\/|\/)/i.test(mediaUrl) &&
    /^[a-f0-9]{64}$/i.test(inputSha256) &&
    args.summary.trim(),
  );
}

export function assertTasteBenchOwner(
  expectedOwnerId: unknown,
  actualOwnerId: unknown,
): void {
  if (!expectedOwnerId || String(expectedOwnerId) !== String(actualOwnerId)) {
    // Keep the error deliberately opaque so cross-tenant callers cannot probe IDs.
    throw new Error("TasteBench run not found");
  }
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildTasteBenchBlindOrder(args: {
  baselineArtifactRef: string;
  candidateArtifactRef: string;
  salt: string;
}): { slotA: "baseline" | "candidate"; slotB: "baseline" | "candidate" } {
  if (!args.baselineArtifactRef || !args.candidateArtifactRef) {
    throw new Error("Two real artifact references are required");
  }
  if (args.baselineArtifactRef === args.candidateArtifactRef) {
    throw new Error("TasteBench artifacts must be different");
  }

  const baselineFirst =
    stableHash(
      `${args.salt}:${args.baselineArtifactRef}:${args.candidateArtifactRef}`,
    ) %
      2 ===
    0;
  return baselineFirst
    ? { slotA: "baseline", slotB: "candidate" }
    : { slotA: "candidate", slotB: "baseline" };
}

export function normalizeBlindTasteBenchChoice(
  presentedChoice: TasteBenchPresentedChoice,
  slotA: "baseline" | "candidate",
): TasteBenchStoredChoice {
  if (presentedChoice === "tie" || presentedChoice === "both_fail") {
    return presentedChoice;
  }
  if (presentedChoice === "a") return slotA;
  return slotA === "baseline" ? "candidate" : "baseline";
}

export function deriveTasteBenchRunState(
  events: readonly TasteBenchStateEvent[],
): TasteBenchRunState {
  if (events.some((event) => event.eventType === "run_abandoned"))
    return "abandoned";
  if (events.some((event) => event.eventType === "run_completed"))
    return "completed";
  return "active";
}

/**
 * Validates an append without modifying prior events. TasteBench intentionally
 * exposes no patch or delete endpoint for runs or events.
 */
export function assertTasteBenchEventCanAppend(
  existingEvents: readonly TasteBenchStateEvent[],
  nextEvent: TasteBenchStateEvent,
): void {
  const expectedSequence = existingEvents.length + 1;
  if (nextEvent.sequence !== expectedSequence) {
    throw new Error("TasteBench event sequence is not append-only");
  }

  if (existingEvents.length === 0) {
    if (nextEvent.eventType !== "run_started") {
      throw new Error("TasteBench runs must begin with run_started");
    }
    return;
  }

  if (nextEvent.eventType === "run_started") {
    throw new Error("TasteBench run_started can only be appended once");
  }

  const state = deriveTasteBenchRunState(existingEvents);
  if (state === "abandoned") {
    throw new Error("Abandoned TasteBench runs are immutable");
  }
  if (nextEvent.eventType === "run_completed" && state !== "active") {
    throw new Error("TasteBench run has already been completed");
  }
  if (nextEvent.eventType === "run_abandoned" && state !== "active") {
    throw new Error("Completed TasteBench runs cannot be abandoned");
  }
  if (nextEvent.eventType === "correction_recorded" && state !== "completed") {
    throw new Error("Corrections require a completed TasteBench comparison");
  }

  const postCompletionEvents: readonly TasteBenchEventType[] = [
    "correction_recorded",
    "operation_undone",
    "artifact_exported",
    "artifact_presented",
    "artifact_reused",
    "artifact_refreshed",
  ];
  if (
    state === "completed" &&
    !postCompletionEvents.includes(nextEvent.eventType)
  ) {
    throw new Error(
      "Completed TasteBench runs only accept post-review evidence",
    );
  }
}
