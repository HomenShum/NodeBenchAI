/**
 * Founder diligence block — identifies and enriches founders/co-founders
 * of a target entity.
 *
 * Pattern: orchestrator-workers sub-agent · scratchpad-first · honest gates.
 *
 * Prior art:
 *   - Anthropic "Building Effective Agents" orchestrator-workers
 *   - LinkedIn bio extraction patterns (public data only)
 *   - SEC EDGAR Form D extraction for named founders
 *
 * This file is a **config-only stub for Phase 1 Week 1** — it declares the
 * block contract so downstream modules (attribution, scratchpad, session
 * artifacts) can type-check. Runtime behavior (search/extract/verify loop)
 * is wired in Phase 1 Week 3, on top of the existing `server/agentHarness.ts`
 * and `convex/domains/agents/dueDiligence/ddEnhancedOrchestrator.ts`.
 *
 * See: docs/architecture/FOUNDER_FEATURE.md
 *      docs/architecture/DILIGENCE_BLOCKS.md
 *      .claude/rules/orchestrator_workers.md
 *      .claude/rules/scratchpad_first.md
 */

import { DEFAULT_TIERS } from "../authority/defaultTiers";
import type {
  DiligenceBlockConfig,
  VerificationGate,
  GateVerdict,
} from "./types";

/**
 * Block-specific candidate shape — what the founder sub-agent extracts.
 */
export type FounderCandidate = {
  /** Canonical full name. */
  name: string;
  /** Role at the target entity — e.g., "CEO", "Co-founder / CTO". */
  role: string;
  /** Claimed tenure if stated by a source. */
  tenure?: { startYear?: number; endYear?: number };
  /** Prior companies + titles, if extracted. */
  priorRoles?: Array<{ company: string; title: string; years?: string }>;
  /** Education, if stated by a source. */
  education?: Array<{ school: string; credential?: string; year?: string }>;
  /** Notable public claims (blog posts, patents, open-source, etc.). */
  notableClaims?: string[];
  /** Source snippet indices that contributed to this candidate. */
  sourceIndices: number[];
  /** Short identity hash for homonym-collision detection. */
  identityHash: string;
};

/**
 * Context object passed to each gate. Kept minimal — gates should depend only
 * on the candidate + the source corpus, never on runtime state.
 */
type FounderGateContext = {
  /** Concatenated lowercase source corpus for grounding checks. */
  sourceCorpus: string;
  /** Target entity's canonical name (e.g., "Acme AI"). */
  entityName: string;
  /** Target entity's URL, if known — used to boost "company About page" trust. */
  entityHomepageUrl?: string;
};

// ── Verification gates ────────────────────────────────────────────────

/**
 * Gate 1: the candidate's name must appear in the source corpus.
 * Coarse but necessary — prevents fabricated founders.
 */
const nameAppearsInSource: VerificationGate<FounderCandidate, FounderGateContext> = {
  name: "name_appears_in_source",
  description: "The candidate's name appears at least once in the retrieved source corpus.",
  required: true,
  check: (c, ctx) => {
    const context = ctx as FounderGateContext;
    if (!c.name || !context.sourceCorpus) return false;
    return context.sourceCorpus.toLowerCase().includes(c.name.toLowerCase());
  },
};

/**
 * Gate 2: the role title must appear near the name in the corpus (>= 1 source).
 * Prevents "assigning" a role to someone who was only mentioned in passing.
 *
 * Implementation detail: checks that role word(s) appear within N chars of
 * the name in the corpus. For Phase 1 Week 1 this is a stub — the full
 * implementation uses span-level evidence refs once wired.
 */
const roleMatchesSomewhere: VerificationGate<FounderCandidate, FounderGateContext> = {
  name: "role_matches_somewhere",
  description: "The claimed role title appears in the corpus, near the candidate's name.",
  required: true,
  check: (c, ctx) => {
    const context = ctx as FounderGateContext;
    if (!c.role) return false;
    const corpus = context.sourceCorpus.toLowerCase();
    const nameIdx = corpus.indexOf(c.name.toLowerCase());
    if (nameIdx < 0) return false;
    const window = corpus.slice(Math.max(0, nameIdx - 400), nameIdx + 400);
    // Role tokens include 2-char+ abbreviations: "CEO", "CTO", "VP", "PM",
    // "COO", etc. — all are real role tokens. A >3 filter would reject CEO.
    // Short prepositions ("is", "at") are never valid role tokens anyway.
    const roleTokens = c.role
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 2);
    if (roleTokens.length === 0) return false;
    return roleTokens.some((t) => window.includes(t));
  },
};

/**
 * Gate 3: no homonym collision — the identityHash must be unique within the
 * candidates extracted for this run. Two "John Smith"s without distinguishing
 * context both fail this gate.
 *
 * Implementation note: this gate needs the full candidate set as context.
 * Phase 1 stub checks only the candidate's own hash against a supplied
 * map; the orchestrator wires the map at spawn time.
 */
const noHomonymCollision: VerificationGate<
  FounderCandidate,
  FounderGateContext & { identityCounts: Map<string, number> }
> = {
  name: "no_homonym_collision",
  description: "Candidate's identity hash is unique among this run's candidates.",
  required: true,
  check: (c, ctx) => {
    const context = ctx as FounderGateContext & { identityCounts?: Map<string, number> };
    if (!context.identityCounts) return true; // not set up — skip rather than fail-closed during stub phase
    const count = context.identityCounts.get(c.identityHash) ?? 0;
    return count <= 1;
  },
};

/**
 * The founder block config. Exported as the canonical registration point for
 * the orchestrator.
 */
export const FOUNDER_BLOCK: DiligenceBlockConfig<FounderCandidate> = {
  block: "founder",
  displayName: "Founders",
  description:
    "Identified founders, co-founders, and key operators of the target company. Verified against official bios and corroborated by reputable press where possible.",

  budget: {
    wallMs: 60_000, // 60s — generous because fan-out is per-founder after this
    outTokens: 2_000, // extraction + gate outputs
    toolCalls: 10, // search × 3 · fetch × 5 · write × 2
  },

  authority: DEFAULT_TIERS.founder,

  extractor: {
    systemPromptTemplate: `You are a founder-identification sub-agent for a diligence pipeline.

You receive retrieved source snippets about a company. Extract a list of the
company's founders, co-founders, and key operating leaders (C-suite + VPs).

Output a JSON array of FounderCandidate objects with fields:
  - name (canonical full name)
  - role (exact title as stated in source)
  - tenure (startYear / endYear if stated, else omit)
  - priorRoles (array of {company, title, years?} if stated, else omit)
  - education (array if stated)
  - notableClaims (array of 1-line strings if substantive)
  - sourceIndices (which snippet indices support this candidate — INT ARRAY)
  - identityHash (sha256 of name + primary prior company, lowercased)

Rules:
  - If a person is mentioned but their role at this company is unclear, OMIT them.
  - Never invent prior roles or credentials — if not stated, omit.
  - If multiple sources disagree on a role, prefer the most recent + most authoritative.
  - For each candidate, record ALL snippet indices that support ANY field on that candidate.

Entity: {{entity_name}}
Source snippets (indexed): {{snippets}}`,
    outputSchemaName: "FounderCandidate[]",
    maxSourceSnippets: 12,
  },

  gates: [
    nameAppearsInSource,
    roleMatchesSomewhere,
    noHomonymCollision as VerificationGate<FounderCandidate, unknown>,
  ],

  scratchpadSection: "Founders",
  attributionTarget: "person",
  autoSpawn: true,
};

/**
 * Compute the confidence tier for a founder candidate from gate verdicts +
 * source tier + source count. HONEST_SCORES rule — no hardcoded floors.
 *
 * Tiers:
 *   verified       — all required gates pass AND ≥2 tier1/tier2 sources
 *   corroborated   — all required gates pass AND ≥1 tier2 source (no tier1)
 *                    OR ≥2 tier3 sources with agreement
 *   single-source  — all required gates pass BUT only 1 source overall
 *   unverified     — at least one required gate failed, OR 0 sources
 */
export type FounderConfidenceTier =
  | "verified"
  | "corroborated"
  | "single-source"
  | "unverified";

export function computeFounderConfidence(
  verdicts: GateVerdict[],
  sourceTiers: Array<"tier1" | "tier2" | "tier3">,
): FounderConfidenceTier {
  const requiredGateNames = FOUNDER_BLOCK.gates
    .filter((g) => g.required)
    .map((g) => g.name);
  const requiredPassed = requiredGateNames.every((name) => {
    const v = verdicts.find((x) => x.gateName === name);
    return v?.passed === true;
  });

  if (!requiredPassed || sourceTiers.length === 0) return "unverified";

  // HONEST ordering: single-source wins first — one source is one source,
  // regardless of tier quality. A single tier1 source is still single-sourced.
  if (sourceTiers.length === 1) return "single-source";

  const tier1Count = sourceTiers.filter((t) => t === "tier1").length;
  const tier2Count = sourceTiers.filter((t) => t === "tier2").length;
  const highQualityCount = tier1Count + tier2Count;

  // ≥2 high-quality (tier1 or tier2) sources → verified
  if (highQualityCount >= 2) return "verified";

  // Any other multi-source combination → corroborated
  return "corroborated";
}
