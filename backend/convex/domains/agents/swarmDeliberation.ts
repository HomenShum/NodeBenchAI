"use node";
/**
 * swarmDeliberation.ts
 *
 * MiroFish-like multi-agent swarm deliberation system with deep simulation.
 * Follows OpenClaw architecture patterns adapted for NodeBench Convex infrastructure.
 *
 * Key innovations:
 * - Intent-Residual Compaction: 3-stage pipeline preserving positions/disagreements
 *   while aggressively compressing verbose tool outputs (NOT summarization)
 * - Structured 4-round deliberation with 6 agency roles
 * - Consensus detection with early-stop at 80% agreement
 * - Deep simulation phases: Research -> Deliberation -> Synthesis
 *
 * @module swarmDeliberation
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { GoogleGenAI } from "@google/genai";

// ============================================================================
// Constants & Types
// ============================================================================

/** Maximum rounds before forced synthesis */
const MAX_ROUNDS = 4;

/** Minimum word count for a quality assessment */
const MIN_ASSESSMENT_WORDS = 50;

/** Extra rounds granted when assessment quality is below threshold */
const QUALITY_PENALTY_ROUNDS = 2;

/** Agreement ratio threshold for early consensus stop */
const CONVERGENCE_THRESHOLD = 0.8;

/** Sliding window: verbatim messages retained from most recent history */
const SLIDING_WINDOW_SIZE = 6;

/** Sliding window overlap with compressed history */
const SLIDING_WINDOW_OVERLAP = 1;

/** Model used for all LLM calls */
const MODEL_ID = "gemini-3.1-flash-lite-preview";

/** TIMEOUT: LLM call timeout in ms */
const LLM_TIMEOUT_MS = 60_000;

/** BOUND: Max rounds to store (prevent unbounded growth) */
const MAX_STORED_ROUNDS = 10;

/** BOUND: Max roles that can accumulate penalty rounds */
const MAX_PENALTY_ROLES = 6;

/** BOUND_READ: Max chars from LLM response */
const MAX_RESPONSE_CHARS = 5_000;

/**
 * The six agency roles for structured deliberation.
 * Derived from OpenClaw's role taxonomy, mapped to NodeBench domains.
 */
const AGENCY_ROLES = [
  {
    id: "strategy_architect",
    label: "Strategy Architect",
    focus: "Market positioning, competitive landscape, product-market fit, strategic differentiation",
    systemPrompt: "You are a Strategy Architect. Evaluate from a market positioning and strategic fit perspective. Focus on competitive moats, ICP alignment, and distribution strategy.",
  },
  {
    id: "engineering_lead",
    label: "Engineering Lead",
    focus: "Technical feasibility, architecture trade-offs, implementation complexity, scalability",
    systemPrompt: "You are an Engineering Lead. Evaluate technical feasibility, architecture trade-offs, and implementation risk. Focus on what's buildable, maintainable, and scalable.",
  },
  {
    id: "growth_analyst",
    label: "Growth Analyst",
    focus: "User acquisition, retention metrics, growth loops, funnel optimization",
    systemPrompt: "You are a Growth Analyst. Evaluate acquisition channels, retention mechanics, and growth loop viability. Focus on measurable metrics and scalable distribution.",
  },
  {
    id: "design_steward",
    label: "Design Steward",
    focus: "User experience, interaction patterns, accessibility, information architecture",
    systemPrompt: "You are a Design Steward. Evaluate user experience quality, interaction coherence, and accessibility. Focus on reducing cognitive load and earning complexity progressively.",
  },
  {
    id: "security_auditor",
    label: "Security Auditor",
    focus: "Risk assessment, compliance, threat modeling, data governance",
    systemPrompt: "You are a Security Auditor. Evaluate risk vectors, compliance requirements, and threat surfaces. Focus on what can go wrong and what safeguards are non-negotiable.",
  },
  {
    id: "operations_coordinator",
    label: "Operations Coordinator",
    focus: "Execution timelines, resource allocation, dependency management, delivery risk",
    systemPrompt: "You are an Operations Coordinator. Evaluate execution feasibility, timelines, resource constraints, and delivery risks. Focus on what ships and what blocks shipping.",
  },
] as const;

type RoleId = (typeof AGENCY_ROLES)[number]["id"];

/** A single role's contribution in one deliberation round */
interface RoleAssessment {
  roleId: RoleId;
  roleLabel: string;
  assessment: string;
  keyRisks: string[];
  opportunities: string[];
  confidence: number;
  recommendation: string;
  wordCount: number;
}

/** Result of a single deliberation round */
interface RoundResult {
  roundNumber: number;
  assessments: RoleAssessment[];
  consensusCheck: ConsensusResult;
  compactedContext: string;
}

/** Consensus detection output */
interface ConsensusResult {
  converged: boolean;
  agreementRatio: number;
  divergencePoints: string[];
  dominantRecommendation: string | null;
}

/** Final synthesis output */
interface DeliberationSynthesis {
  consensusPoints: string[];
  divergencePoints: string[];
  blindSpots: string[];
  actionItems: string[];
  overallConfidence: number;
  finalRecommendation: string;
}

/** Deliberation phase for status tracking */
type DeliberationPhase = "research" | "deliberation" | "synthesis" | "completed" | "failed";

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * 3-stage Intent-Residual Compaction pipeline.
 *
 * This is NOT summarization. It preserves:
 * - Positions and stances taken by each role
 * - Disagreements and tension points
 * - Open questions requiring resolution
 * - Action items and constraints
 *
 * It drops:
 * - Verbose tool output formatting
 * - Redundant restatements of the topic
 * - Filler phrases and hedging language
 *
 * @param messages - Array of message strings from prior rounds
 * @param currentRound - Current round number (0-indexed)
 * @returns Compacted context string
 */
export function compactContext(messages: string[], currentRound: number): string {
  if (messages.length === 0) return "";

  // Stage 1: Tool Collapse — verbose tool outputs → one-liners
  const collapsed = messages.map((msg) => toolCollapse(msg));

  // Stage 2: Intent Residual Extraction — keep only positions, disagreements,
  // open questions, action items, constraints
  const residuals = collapsed.map((msg) => intentResidualExtraction(msg));

  // Stage 3: Sliding Window with Overlap
  return slidingWindowOverlap(residuals, currentRound);
}

/**
 * Stage 1: Collapse verbose tool outputs into one-line summaries.
 * Targets JSON blocks, code blocks, and repetitive list structures.
 */
function toolCollapse(message: string): string {
  let result = message;

  // Collapse JSON blocks to type + key count
  result = result.replace(
    /```json\s*\n([\s\S]*?)```/g,
    (_match, content: string) => {
      try {
        const parsed = JSON.parse(content);
        const keys = Object.keys(parsed);
        return `[JSON: ${keys.length} keys — ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "..." : ""}]`;
      } catch {
        return `[JSON block: ${content.length} chars]`;
      }
    },
  );

  // Collapse code blocks to language + line count
  result = result.replace(
    /```(\w*)\s*\n([\s\S]*?)```/g,
    (_match, lang: string, content: string) => {
      const lines = content.split("\n").filter((l: string) => l.trim()).length;
      return `[${lang || "code"}: ${lines} lines]`;
    },
  );

  // Collapse repetitive bullet lists (>5 items) to first 3 + count
  result = result.replace(
    /((?:^[\s]*[-*]\s+.+\n){6,})/gm,
    (match) => {
      const items = match.split("\n").filter((l: string) => l.trim().match(/^[-*]\s+/));
      const kept = items.slice(0, 3).join("\n");
      return `${kept}\n  ... and ${items.length - 3} more items\n`;
    },
  );

  return result;
}

/**
 * Stage 2: Extract intent residuals — only positions, disagreements,
 * open questions, action items, and constraints.
 */
function intentResidualExtraction(message: string): string {
  const lines = message.split("\n");
  const residualLines: string[] = [];

  // Intent signal patterns
  const intentPatterns = [
    /\b(recommend|suggest|propose|advocate|oppose|disagree|concern|risk|blocker)\b/i,
    /\b(action item|next step|todo|must|should|need to|require)\b/i,
    /\b(question|unclear|open issue|depends on|assumption|constraint)\b/i,
    /\b(agree|consensus|align|support|endorse|confidence)\b/i,
    /\b(trade-?off|alternative|instead|however|but|caveat|warning)\b/i,
    /\b(opportunity|upside|advantage|strength|leverage)\b/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Always keep headers
    if (trimmed.startsWith("#") || trimmed.startsWith("##")) {
      residualLines.push(trimmed);
      continue;
    }

    // Keep lines matching intent patterns
    const hasIntent = intentPatterns.some((p) => p.test(trimmed));
    if (hasIntent) {
      residualLines.push(trimmed);
      continue;
    }

    // Keep role attribution lines
    if (trimmed.match(/^\*\*[\w\s]+\*\*:/)) {
      residualLines.push(trimmed);
    }
  }

  return residualLines.join("\n");
}

/**
 * Stage 3: Sliding window with overlap.
 * Last SLIDING_WINDOW_SIZE messages are kept verbatim.
 * Earlier messages are compressed, with SLIDING_WINDOW_OVERLAP message(s)
 * bridging the compressed and verbatim sections.
 */
function slidingWindowOverlap(messages: string[], _currentRound: number): string {
  if (messages.length <= SLIDING_WINDOW_SIZE) {
    return messages.join("\n\n---\n\n");
  }

  const windowStart = messages.length - SLIDING_WINDOW_SIZE;
  const compressed = messages.slice(0, windowStart);
  const overlap = messages.slice(
    Math.max(0, windowStart - SLIDING_WINDOW_OVERLAP),
    windowStart,
  );
  const verbatim = messages.slice(windowStart);

  const compressedBlock = compressed.length > 0
    ? `[Compressed history — ${compressed.length} earlier messages]\n${compressed.map((m) => {
        // Ultra-compress: first line only
        const firstLine = m.split("\n").find((l: string) => l.trim()) || "(empty)";
        return `  > ${firstLine.slice(0, 120)}`;
      }).join("\n")}`
    : "";

  const overlapBlock = overlap.length > 0
    ? `[Bridge context]\n${overlap.join("\n")}`
    : "";

  const verbatimBlock = verbatim.join("\n\n---\n\n");

  return [compressedBlock, overlapBlock, verbatimBlock]
    .filter(Boolean)
    .join("\n\n===\n\n");
}

/**
 * Check consensus across role assessments for a given round.
 *
 * Extracts the core recommendation keyword from each role's recommendation,
 * computes agreement ratio, and determines convergence.
 *
 * @param assessments - All role assessments from the current round
 * @returns Consensus result with convergence status and divergence points
 */
export function checkConsensus(assessments: RoleAssessment[]): ConsensusResult {
  if (assessments.length === 0) {
    return { converged: false, agreementRatio: 0, divergencePoints: [], dominantRecommendation: null };
  }

  // Extract recommendation keywords (first significant verb/noun phrase)
  const keywords = assessments.map((a) => extractRecommendationKeyword(a.recommendation));

  // Count occurrences of each keyword
  const counts = new Map<string, number>();
  for (const kw of keywords) {
    counts.set(kw, (counts.get(kw) || 0) + 1);
  }

  // Find dominant recommendation
  let maxCount = 0;
  let dominant: string | null = null;
  for (const [kw, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = kw;
    }
  }

  const agreementRatio = maxCount / assessments.length;
  const converged = agreementRatio >= CONVERGENCE_THRESHOLD;

  // Identify divergence points — roles that disagree with dominant
  const divergencePoints: string[] = [];
  for (const a of assessments) {
    const kw = extractRecommendationKeyword(a.recommendation);
    if (kw !== dominant) {
      divergencePoints.push(`${a.roleLabel}: "${a.recommendation}" (vs dominant: "${dominant}")`);
    }
  }

  return { converged, agreementRatio, divergencePoints, dominantRecommendation: dominant };
}

/**
 * Extract core recommendation keyword for consensus matching.
 * Normalizes to lowercase, strips filler, extracts first action-oriented phrase.
 */
function extractRecommendationKeyword(recommendation: string): string {
  const normalized = recommendation
    .toLowerCase()
    .replace(/^(i |we |the team )?(recommend|suggest|propose|think we should)\s+/i, "")
    .replace(/\b(strongly|definitely|probably|likely|perhaps)\b/g, "")
    .trim();

  // Take first clause (up to comma, period, semicolon, or "because")
  const firstClause = normalized.split(/[,;.]|\bbecause\b|\bsince\b|\bas\b/)[0].trim();
  return firstClause.slice(0, 80) || normalized.slice(0, 80);
}

// ============================================================================
// LLM Helpers
// ============================================================================

/**
 * Initialize Google GenAI client from environment.
 * @throws Error if GEMINI_API_KEY is not set
 */
function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for swarm deliberation");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Generate a role assessment via LLM for a specific role and topic.
 *
 * @param genai - Google GenAI client
 * @param role - The agency role configuration
 * @param topic - The deliberation topic
 * @param context - Compacted context from prior rounds
 * @param roundNumber - Current round (1-indexed)
 * @returns Parsed role assessment
 */
async function generateRoleAssessment(
  genai: GoogleGenAI,
  role: (typeof AGENCY_ROLES)[number],
  topic: string,
  context: string,
  roundNumber: number,
): Promise<RoleAssessment> {
  const prompt = `${role.systemPrompt}

TOPIC FOR DELIBERATION (Round ${roundNumber}/${MAX_ROUNDS}):
${topic}

${context ? `PRIOR CONTEXT:\n${context}\n` : ""}
Provide your structured assessment. You MUST respond with valid JSON matching this schema exactly:
{
  "assessment": "Your detailed analysis (minimum 50 words)",
  "keyRisks": ["risk1", "risk2", ...],
  "opportunities": ["opp1", "opp2", ...],
  "confidence": 0.0-1.0,
  "recommendation": "Your clear recommendation in one sentence"
}

Be specific, cite evidence where possible, and state your position clearly. Do NOT hedge — take a stance.`;

  // TIMEOUT: AbortController for LLM call
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let text: string;
  try {
    const response = await genai.models.generateContent({
      model: MODEL_ID,
      contents: prompt,
      config: { abortSignal: controller.signal },
    });
    // BOUND_READ: cap response text
    text = (response.text ?? "").slice(0, MAX_RESPONSE_CHARS);
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      roleId: role.id,
      roleLabel: role.label,
      assessment: `LLM call failed: ${msg.slice(0, 200)}`,
      keyRisks: ["LLM call failed"],
      opportunities: [],
      confidence: 0, // HONEST_SCORES: no artificial floor on failure
      recommendation: "Retry with fallback model",
      wordCount: 0,
    };
  } finally {
    clearTimeout(timeout);
  }

  // Parse JSON from response (handle markdown code fences)
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) || [null, text];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[1]!.trim());
  } catch {
    // Fallback: construct from raw text
    parsed = {
      assessment: text.slice(0, 500),
      keyRisks: ["Unable to parse structured response"],
      opportunities: [],
      confidence: 0, // HONEST_SCORES: no artificial floor
      recommendation: "Re-evaluate with clearer prompting",
    };
  }

  const assessment = String(parsed.assessment || "");
  return {
    roleId: role.id,
    roleLabel: role.label,
    assessment,
    keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks.map(String) : [],
    opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.map(String) : [],
    confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0, // HONEST_SCORES: 0 default, not 0.5
    recommendation: String(parsed.recommendation || "No clear recommendation"),
    wordCount: assessment.split(/\s+/).filter(Boolean).length,
  };
}

// ============================================================================
// Core Actions
// ============================================================================

/**
 * Execute a single deliberation round across all (or selected) roles.
 *
 * Each role produces a structured assessment. After all assessments,
 * consensus is checked. If any assessment fails the quality gate
 * (<50 words), that role is flagged for extra rounds.
 *
 * @param topic - The deliberation topic
 * @param roundNumber - Current round (1-indexed)
 * @param priorContext - Compacted context from previous rounds
 * @param roleIds - Optional subset of roles to include (defaults to all 6)
 * @returns Round result with assessments, consensus check, and compacted context
 */
export const runDeliberationRound = internalAction({
  args: {
    sessionId: v.id("agentTaskSessions"),
    topic: v.string(),
    roundNumber: v.number(),
    priorContext: v.string(),
    roleIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<RoundResult> => {
    const genai = getGenAI();

    // Select roles for this round
    const activeRoles = args.roleIds
      ? AGENCY_ROLES.filter((r) => args.roleIds!.includes(r.id))
      : [...AGENCY_ROLES];

    // Generate assessments in parallel across all roles
    const assessments = await Promise.all(
      activeRoles.map((role) =>
        generateRoleAssessment(genai, role, args.topic, args.priorContext, args.roundNumber),
      ),
    );

    // Quality gate: flag roles with thin assessments
    const qualityFailures = assessments.filter((a) => a.wordCount < MIN_ASSESSMENT_WORDS);
    if (qualityFailures.length > 0) {
      console.warn(
        `[Deliberation R${args.roundNumber}] Quality gate: ${qualityFailures.length} role(s) below ${MIN_ASSESSMENT_WORDS} words:`,
        qualityFailures.map((a) => `${a.roleLabel} (${a.wordCount}w)`).join(", "),
      );
    }

    // Check consensus
    const consensusCheck = checkConsensus(assessments);

    // Build round messages for compaction
    const roundMessages = assessments.map(
      (a) =>
        `**${a.roleLabel}** (confidence: ${a.confidence.toFixed(2)}):\n${a.assessment}\nRisks: ${a.keyRisks.join("; ")}\nRecommendation: ${a.recommendation}`,
    );

    // Compact context: prior + this round
    const allMessages = args.priorContext
      ? [args.priorContext, ...roundMessages]
      : roundMessages;
    const compactedContext = compactContext(allMessages, args.roundNumber);

    // Persist progress
    await ctx.runMutation(internal.domains.agents.swarmDeliberationQueries.updateDeliberationState, {
      sessionId: args.sessionId,
      description: `Round ${args.roundNumber}/${MAX_ROUNDS} complete. Agreement: ${(consensusCheck.agreementRatio * 100).toFixed(0)}%. ${consensusCheck.converged ? "CONVERGED" : "Continuing..."}`,
    });

    return {
      roundNumber: args.roundNumber,
      assessments,
      consensusCheck,
      compactedContext,
    };
  },
});

/**
 * Final synthesis action: consolidate all round results into actionable output.
 *
 * Produces consensus points, remaining divergence, blind spots analysis,
 * and prioritized action items.
 *
 * @param sessionId - The deliberation session ID
 * @param topic - Original deliberation topic
 * @param allRounds - Results from all completed rounds
 * @returns Structured synthesis with consensus, divergence, blind spots, and actions
 */
export const synthesizeDeliberation = internalAction({
  args: {
    sessionId: v.id("agentTaskSessions"),
    topic: v.string(),
    roundSummaries: v.string(),
    finalConsensus: v.object({
      converged: v.boolean(),
      agreementRatio: v.number(),
      divergencePoints: v.array(v.string()),
      dominantRecommendation: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<DeliberationSynthesis> => {
    const genai = getGenAI();

    const prompt = `You are a synthesis agent for a multi-agent deliberation system.

ORIGINAL TOPIC: ${args.topic}

DELIBERATION RESULTS:
${args.roundSummaries}

CONSENSUS STATUS:
- Converged: ${args.finalConsensus.converged}
- Agreement ratio: ${(args.finalConsensus.agreementRatio * 100).toFixed(0)}%
- Dominant recommendation: ${args.finalConsensus.dominantRecommendation || "None"}
- Divergence points: ${args.finalConsensus.divergencePoints.join("; ") || "None"}

Synthesize the deliberation into a final output. Respond with valid JSON:
{
  "consensusPoints": ["Point where most/all roles agreed", ...],
  "divergencePoints": ["Unresolved disagreement with role attribution", ...],
  "blindSpots": ["Important angle no role adequately covered", ...],
  "actionItems": ["Specific, assignable next step with priority", ...],
  "overallConfidence": 0.0-1.0,
  "finalRecommendation": "One clear paragraph synthesizing the group decision"
}`;

    // TIMEOUT + ERROR_BOUNDARY: wrap LLM call
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let text: string;
    try {
      const response = await genai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: { abortSignal: controller.signal },
      });
      // BOUND_READ: cap response
      text = (response.text ?? "").slice(0, MAX_RESPONSE_CHARS);
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      // HONEST_STATUS: surface the failure, don't mask it
      await ctx.runMutation(internal.domains.agents.swarmDeliberationQueries.updateDeliberationState, {
        sessionId: args.sessionId,
        status: "failed",
        description: `Synthesis LLM call failed: ${msg.slice(0, 200)}`,
      });
      throw new Error(`Synthesis LLM call failed: ${msg.slice(0, 200)}`);
    } finally {
      clearTimeout(timeout);
    }

    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) || [null, text];

    let synthesis: DeliberationSynthesis;
    try {
      const parsed = JSON.parse(jsonMatch[1]!.trim());
      synthesis = {
        consensusPoints: Array.isArray(parsed.consensusPoints) ? parsed.consensusPoints.map(String) : [],
        divergencePoints: Array.isArray(parsed.divergencePoints) ? parsed.divergencePoints.map(String) : [],
        blindSpots: Array.isArray(parsed.blindSpots) ? parsed.blindSpots.map(String) : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String) : [],
        overallConfidence: typeof parsed.overallConfidence === "number" ? parsed.overallConfidence : 0, // HONEST_SCORES
        finalRecommendation: String(parsed.finalRecommendation || "No synthesis produced"),
      };
    } catch {
      synthesis = {
        consensusPoints: [],
        divergencePoints: args.finalConsensus.divergencePoints,
        blindSpots: ["Synthesis parsing failed — manual review required"],
        actionItems: ["Re-run deliberation with clearer topic framing"],
        overallConfidence: 0, // HONEST_SCORES: no artificial floor
        finalRecommendation: text.slice(0, 500),
      };
    }

    // Mark session complete
    await ctx.runMutation(internal.domains.agents.swarmDeliberationQueries.updateDeliberationState, {
      sessionId: args.sessionId,
      status: "completed",
      description: `Synthesis complete. Confidence: ${(synthesis.overallConfidence * 100).toFixed(0)}%. ${synthesis.actionItems.length} action items.`,
    });

    return synthesis;
  },
});

/**
 * Entry point for swarm deliberation.
 *
 * Orchestrates the full 3-phase deliberation lifecycle:
 * 1. Session creation and research context assembly
 * 2. Structured deliberation rounds (up to MAX_ROUNDS) with consensus checks
 * 3. Final synthesis consolidating all round results
 *
 * @param topic - The topic or question to deliberate on
 * @param context - Optional additional context (research findings, constraints, etc.)
 * @param roleIds - Optional subset of role IDs to include (defaults to all 6)
 * @returns Complete deliberation result with synthesis
 */
export const startSwarmDeliberation = internalAction({
  args: {
    topic: v.string(),
    context: v.optional(v.string()),
    roleIds: v.optional(v.array(v.string())),
    autoEvolve: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Phase 1: Create session
    const sessionId: Id<"agentTaskSessions"> = await ctx.runMutation(
      internal.domains.agents.swarmDeliberationQueries.createDeliberationSession,
      { topic: args.topic, context: args.context },
    );

    try {
      // Phase 2: Structured Deliberation — up to MAX_ROUNDS
      // BOUND: cap stored rounds and penalty tracking
      const allRounds: RoundResult[] = [];
      let currentContext = args.context || "";
      const extraRoundsMap = new Map<string, number>();

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        // Determine which roles participate this round
        // Roles with quality penalties get extra rounds beyond MAX_ROUNDS
        let activeRoleIds = args.roleIds || undefined;

        const roundResult: RoundResult = await ctx.runAction(
          internal.domains.agents.swarmDeliberation.runDeliberationRound,
          {
            sessionId,
            topic: args.topic,
            roundNumber: round,
            priorContext: currentContext,
            roleIds: activeRoleIds,
          },
        );

        // BOUND: evict oldest round if exceeding max
        if (allRounds.length >= MAX_STORED_ROUNDS) {
          allRounds.shift();
        }
        allRounds.push(roundResult);
        currentContext = roundResult.compactedContext;

        // Track quality failures for penalty rounds (BOUND: cap at MAX_PENALTY_ROLES)
        for (const assessment of roundResult.assessments) {
          if (assessment.wordCount < MIN_ASSESSMENT_WORDS && extraRoundsMap.size < MAX_PENALTY_ROLES) {
            const current = extraRoundsMap.get(assessment.roleId) || 0;
            if (current < QUALITY_PENALTY_ROUNDS) {
              extraRoundsMap.set(assessment.roleId, current + 1);
            }
          }
        }

        // Early stop on consensus
        if (roundResult.consensusCheck.converged) {
          console.log(
            `[Deliberation] Consensus reached at round ${round} with ${(roundResult.consensusCheck.agreementRatio * 100).toFixed(0)}% agreement`,
          );
          break;
        }
      }

      // Run penalty rounds for roles that failed quality gate
      if (extraRoundsMap.size > 0) {
        const penaltyRoleIds = Array.from(extraRoundsMap.keys());
        for (let extra = 1; extra <= QUALITY_PENALTY_ROUNDS; extra++) {
          const penaltyRound: RoundResult = await ctx.runAction(
            internal.domains.agents.swarmDeliberation.runDeliberationRound,
            {
              sessionId,
              topic: args.topic,
              roundNumber: MAX_ROUNDS + extra,
              priorContext: currentContext,
              roleIds: penaltyRoleIds,
            },
          );
          allRounds.push(penaltyRound);
          currentContext = penaltyRound.compactedContext;
        }
      }

      // Phase 3: Synthesis
      const lastRound = allRounds[allRounds.length - 1];
      const roundSummaries = allRounds
        .map((r) => {
          const roleLines = r.assessments
            .map(
              (a) =>
                `  ${a.roleLabel} (${a.confidence.toFixed(2)}): ${a.recommendation}`,
            )
            .join("\n");
          return `Round ${r.roundNumber} [Agreement: ${(r.consensusCheck.agreementRatio * 100).toFixed(0)}%]:\n${roleLines}`;
        })
        .join("\n\n");

      const synthesis = await ctx.runAction(
        internal.domains.agents.swarmDeliberation.synthesizeDeliberation,
        {
          sessionId,
          topic: args.topic,
          roundSummaries,
          finalConsensus: {
            converged: lastRound.consensusCheck.converged,
            agreementRatio: lastRound.consensusCheck.agreementRatio,
            divergencePoints: lastRound.consensusCheck.divergencePoints,
            dominantRecommendation: lastRound.consensusCheck.dominantRecommendation ?? undefined,
          },
        },
      );

      // Optional: bridge deliberation consensus to rubric evolution
      let evolutionResult = undefined;
      if (args.autoEvolve) {
        try {
          evolutionResult = await ctx.runAction(
            internal.domains.agents.deliberationToEvolution.bridgeDeliberationToEvolution,
            {
              synthesisResult: synthesis,
              domain: args.topic,
              autoApply: true,
            },
          );
        } catch (err) {
          // Non-blocking: evolution bridge failure doesn't fail deliberation
          console.error("Evolution bridge failed:", err instanceof Error ? err.message : String(err));
        }
      }

      return {
        sessionId,
        totalRounds: allRounds.length,
        converged: lastRound.consensusCheck.converged,
        synthesis,
        evolutionResult,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Mark session as failed
      await ctx.runMutation(
        internal.domains.agents.swarmDeliberationQueries.updateDeliberationState,
        {
          sessionId,
          status: "failed",
          description: `Deliberation failed: ${message.slice(0, 200)}`,
        },
      );
      throw error;
    }
  },
});
