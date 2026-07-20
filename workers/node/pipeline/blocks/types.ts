/**
 * DiligenceBlock<T> contract — the generic primitive every block config plugs
 * into. See docs/architecture/DILIGENCE_BLOCKS.md for the full taxonomy.
 *
 * Pattern: Orchestrator-Workers — this is the shape of a worker config.
 *
 * Prior art:
 *   - Anthropic: "Building Effective Agents" orchestrator-workers pattern
 *   - LangGraph subgraphs — typed worker nodes
 *   - Manus AI — sub-agent writes to named scratchpad section
 *
 * See: .claude/rules/orchestrator_workers.md
 *      .claude/rules/scratchpad_first.md
 *      .claude/rules/reference_attribution.md
 */

import type { BlockType, BlockAuthorityConfig } from "../authority/defaultTiers";

/**
 * Budget envelope per sub-agent. All three must be set; the wrapper enforces.
 * Maps to `agentic_reliability.md` → BOUND + TIMEOUT.
 */
export type AgentBudget = {
  /** Wall-clock cap in milliseconds. */
  wallMs: number;
  /** LLM output-token cap. */
  outTokens: number;
  /** Max tool calls (search, fetch, extract, write) within this sub-agent. */
  toolCalls: number;
};

/**
 * The verification gate — boolean outputs only. No vibe scores.
 * Each gate is deterministic given the same input; drives the confidence
 * tier computation downstream. Maps to `agentic_reliability.md:HONEST_SCORES`.
 */
export type VerificationGate<TCandidate, TContext> = {
  /** Short identifier for logs and failure reports. */
  name: string;
  /** One-sentence description for docs + feedback drafts. */
  description: string;
  /** Boolean check — true = pass, false = fail, throw = unknown (fails closed). */
  check: (candidate: TCandidate, ctx: TContext) => boolean | Promise<boolean>;
  /** If true, a failure of this gate blocks the candidate from any tier above "unverified". */
  required: boolean;
};

/**
 * Extractor config — defines the prompt + output schema a sub-agent uses to
 * turn retrieved source text into structured candidates. Stored here so tests
 * can mock the extractor independently of the LLM provider.
 */
export type ExtractorConfig = {
  /** Block-specific system prompt template. May include `{{entity}}` etc. */
  systemPromptTemplate: string;
  /** Zod schema name used to validate LLM output (actual Zod object is wired elsewhere). */
  outputSchemaName: string;
  /** Max snippets from the source corpus to include in the extraction prompt. */
  maxSourceSnippets: number;
  /** Preferred LLM model for this block (can be overridden by runtime). */
  preferredModel?: string;
};

/**
 * The full DiligenceBlock<T> contract. Every block config in `blocks/*.ts`
 * exports a `BLOCK_CONFIG: DiligenceBlockConfig<TCandidate>`.
 *
 * TCandidate is the block-specific candidate shape — e.g., FounderCandidate,
 * ProductCandidate, PatentCandidate. Strong typing per block + a shared
 * pipeline primitive.
 */
export type DiligenceBlockConfig<TCandidate> = {
  /** Block identifier. Must match a key in DEFAULT_TIERS. */
  block: BlockType;

  /** Human-readable name for the UI. */
  displayName: string;

  /** Short description shown in the Founders/Products/etc. section header. */
  description: string;

  /** Budget envelope — enforced by the sub-agent wrapper. */
  budget: AgentBudget;

  /** Authority allowlist — inherited from DEFAULT_TIERS by default. */
  authority: BlockAuthorityConfig;

  /** Extractor config — prompt + output schema. */
  extractor: ExtractorConfig;

  /** Verification gates — run after extraction, drive the confidence tier. */
  gates: ReadonlyArray<VerificationGate<TCandidate, unknown>>;

  /**
   * Scratchpad section name for this block. Sub-agent writes here, and
   * ONLY here. Cross-section writes are forbidden by the orchestrator.
   */
  scratchpadSection: string;

  /** Target entity type this block attributes to. */
  attributionTarget: "company" | "person" | "market" | "product";

  /**
   * Description-first loading trigger. When the orchestrator reads the
   * scratchpad and the trigger matches, this block's sub-agent is spawned.
   * Typically "always on" for core blocks; optional for premium.
   */
  autoSpawn: boolean;
};

/**
 * Result of a sub-agent run. The orchestrator aggregates these and feeds
 * them to the structuring pass.
 */
export type BlockRunResult<TCandidate> = {
  block: BlockType;
  runId: string;
  candidates: TCandidate[];
  /** Per-candidate verification outcome, keyed by candidate identity. */
  verifications: Map<string, GateVerdict[]>;
  /** Which gates each candidate passed — used by the confidence tier computation. */
  bounds: BlockBound[];
  /** Snippets used as evidence, indexed for citation back-references. */
  sourceSnippets: Array<{ idx: number; text: string; url: string; tier: string }>;
  /** Wall-clock duration + token usage — feeds the trace tree. */
  telemetry: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    toolCallCount: number;
  };
};

/**
 * Per-gate outcome on a single candidate. `passed === null` means UNKNOWN
 * (fails closed — `HONEST_SCORES` rule).
 */
export type GateVerdict = {
  gateName: string;
  passed: boolean | null;
  reason?: string;
};

/**
 * Honest bounds — what the agent COULD NOT do and why. Surfaced in the UI,
 * never hidden. Seeds the auto-feedback drafts.
 */
export type BlockBound = {
  kind: "known-gap" | "rate-limited" | "unreachable-source" | "low-retrieval-confidence" | "needs-human";
  reason: string;
  /** URL or identifier of the source that bounded us (if applicable). */
  source?: string;
  /** Whether a scheduled retry should be attempted and when. */
  retrySchedule?: "in-12h" | "in-24h" | "in-48h" | "never";
};
