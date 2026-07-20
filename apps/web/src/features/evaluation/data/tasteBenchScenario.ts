// This is the controlled AI-app subset of the canonical fixed catalog in
// controlPlane/components/dogfoodSuite.ts. Keep IDs aligned; never add sample
// output or a fixture-only scenario here.
export const TASTE_BENCH_SCENARIO_VERSION = "tastebench-v1" as const;

export const TASTE_BENCH_SCENARIOS = [
  {
    id: "app-01-founder-weekly-reset",
    title: "Founder Weekly Reset",
    objective:
      "Judge whether the weekly reset is decisive, evidence-led, and immediately actionable.",
    audience: "Founder",
    expectedOutcome:
      "A reusable weekly reset packet with a clear contradiction and next moves.",
    expectedPrimitiveCoverage: [
      "Context recall",
      "Evidence grounding",
      "Decision packet",
      "Artifact export",
    ],
  },
  {
    id: "app-02-pre-delegation-packet",
    title: "Pre-Delegation Packet",
    objective:
      "Judge whether another agent could execute the packet without restating context.",
    audience: "Founder",
    expectedOutcome:
      "A bounded, agent-ready handoff with constraints and success criteria.",
    expectedPrimitiveCoverage: [
      "Context packet",
      "Scope constraints",
      "Success criteria",
      "Delegation handoff",
    ],
  },
  {
    id: "app-03-important-change-review",
    title: "Important-Change Review",
    objective:
      "Judge signal selection, suppression of noise, and consequence clarity.",
    audience: "Founder",
    expectedOutcome:
      "A low-noise review that makes packet or memo refreshes obvious.",
    expectedPrimitiveCoverage: [
      "Change detection",
      "Noise suppression",
      "Evidence grounding",
      "Packet refresh",
    ],
  },
  {
    id: "app-04-competitor-supermemory",
    title: "Competitor Intelligence Brief",
    objective:
      "Judge strategic differentiation, evidence quality, and decision usefulness.",
    audience: "Researcher",
    expectedOutcome:
      "A sourced competitor brief with an explicit absorb-versus-avoid recommendation.",
    expectedPrimitiveCoverage: [
      "Web grounding",
      "Claim graph",
      "Countermodel",
      "Decision packet",
    ],
  },
  {
    id: "app-05-banker-anthropic",
    title: "Banker / CEO Company Search",
    objective:
      "Judge executive compression, business quality, risk framing, and trust.",
    audience: "Banker",
    expectedOutcome:
      "An exportable executive memo with risks and next diligence questions.",
    expectedPrimitiveCoverage: [
      "Company search",
      "Source citations",
      "Risk assessment",
      "Memo export",
    ],
  },
  {
    id: "app-06-student-shopify",
    title: "Student Strategy Search",
    objective:
      "Judge audience fit, plain-language teaching, and source-grounded explanation.",
    audience: "Student",
    expectedOutcome:
      "A plain-language study brief with comparables and citations.",
    expectedPrimitiveCoverage: [
      "Web grounding",
      "Audience calibration",
      "Comparables",
      "Study brief",
    ],
  },
] as const;

export type TasteBenchScenarioId = (typeof TASTE_BENCH_SCENARIOS)[number]["id"];

export const TASTE_BENCH_DIMENSIONS = [
  { id: "narrative", label: "Narrative" },
  { id: "visual_semantics", label: "Visual semantics" },
  { id: "composition", label: "Composition" },
  { id: "craft", label: "Craft" },
  { id: "trust", label: "Trust" },
  { id: "interaction", label: "Interaction" },
] as const;

export type TasteBenchDimension = (typeof TASTE_BENCH_DIMENSIONS)[number]["id"];

export const TASTE_BENCH_CORRECTIONS = [
  { id: "reduced_density", label: "Reduced density" },
  { id: "strengthened_hierarchy", label: "Strengthened hierarchy" },
  { id: "changed_visual_encoding", label: "Changed visual encoding" },
  { id: "corrected_audience_level", label: "Corrected audience level" },
  { id: "factual", label: "Factual correction" },
  { id: "source", label: "Source correction" },
  { id: "scope", label: "Scope correction" },
  { id: "tone", label: "Tone correction" },
  { id: "other", label: "Other" },
] as const;

export type TasteBenchCorrectionKind =
  (typeof TASTE_BENCH_CORRECTIONS)[number]["id"];

export function getTasteBenchScenario(id: string) {
  return TASTE_BENCH_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
