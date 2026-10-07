"use node";
/**
 * Pre-Execution Decision Gate — "Should I act?" evaluation before task dispatch
 *
 * Evaluates 5 required gates and 6 disqualifiers using LLM analysis.
 * Decision: proceed (all gates pass, no disqualifiers) | skip (disqualifier hit)
 *           | escalate (too few gates pass)
 *
 * Fail-open: on LLM timeout, defaults to proceed (gate shouldn't block service).
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getLanguageModelSafe } from "../agents/mcp_tools/models/modelResolver";
import { generateText } from "ai";
import { createHash } from "crypto";

// ============================================================================
// Constants
// ============================================================================

/** TIMEOUT: Fast gate — 15s max, should never block dispatch */
const GATE_TIMEOUT_MS = 15_000;
/** BOUND_READ: Max chars to store from LLM reasoning */
const MAX_RESPONSE_CHARS = 3_000;
/** Minimum gates that must pass to proceed without escalation */
const MIN_GATES_TO_PROCEED = 3; // Need at least 3 of 5 gates
// ============================================================================
// Types
// ============================================================================

interface GateEvaluation {
  gates: {
    opportunity_identified: boolean;
    unique_value: boolean;
    actionable_outcome: boolean;
    right_audience: boolean;
    information_not_lost: boolean;
  };
  disqualifiers: {
    already_resolved: boolean;
    social_only: boolean;
    bot_already_replied: boolean;
    sensitive_topic: boolean;
    rapid_fire: boolean;
    command_word: boolean;
  };
  reasoning: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * DETERMINISTIC: Compute a stable hash for rapid-fire deduplication.
 * Returns first 16 chars of SHA-256 hex digest.
 */
function computePromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/**
 * Build the system prompt for gate evaluation.
 * Clear boolean criteria — LLM must return parseable JSON.
 */
function buildGateSystemPrompt(): string {
  return `You are a pre-execution decision gate. Your job is to evaluate whether a prompt/task should proceed to execution.

Evaluate the following 5 GATES (each true/false):
1. opportunity_identified: Does this prompt identify a specific, concrete opportunity or question that requires action?
2. unique_value: Can this system provide value that the user couldn't easily get elsewhere (e.g., a simple Google search)?
3. actionable_outcome: Will the output lead to a specific action the user can take?
4. right_audience: Is this directed at the right system/audience for this type of request?
5. information_not_lost: Would skipping this lose time-sensitive information or context?

Evaluate the following 5 DISQUALIFIERS (each true/false — true means disqualified):
1. already_resolved: Has this question/task already been answered or completed based on the context?
2. social_only: Is this purely social interaction with no actionable component (e.g., "thanks", "hi")?
3. bot_already_replied: Has an automated system already adequately addressed this based on context?
4. sensitive_topic: Does this involve medical, legal, or financial advice that requires human expertise?
5. command_word: Does the prompt contain explicit opt-out commands like "stop", "cancel", "unsubscribe"?

NOTE: rapid_fire is checked separately — always set it to false in your response.

Respond with ONLY valid JSON (no markdown, no wrapping):
{
  "gates": {
    "opportunity_identified": true/false,
    "unique_value": true/false,
    "actionable_outcome": true/false,
    "right_audience": true/false,
    "information_not_lost": true/false
  },
  "disqualifiers": {
    "already_resolved": true/false,
    "social_only": true/false,
    "bot_already_replied": true/false,
    "sensitive_topic": true/false,
    "rapid_fire": false,
    "command_word": true/false
  },
  "reasoning": "Brief explanation of your evaluation"
}`;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Core LLM evaluation — calls a fast model to score gates and disqualifiers.
 * ERROR_BOUNDARY: wraps LLM call in try/catch, fail-open on any error.
 * TIMEOUT: 15s AbortController.
 * BOUND_READ: truncates reasoning to MAX_RESPONSE_CHARS.
 */
export const evaluateGates = internalAction({
  args: {
    prompt: v.string(),
    missionType: v.optional(v.string()),
    context: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<GateEvaluation> => {
    const failOpenResult: GateEvaluation = {
      gates: {
        opportunity_identified: true,
        unique_value: true,
        actionable_outcome: true,
        right_audience: true,
        information_not_lost: true,
      },
      disqualifiers: {
        already_resolved: false,
        social_only: false,
        bot_already_replied: false,
        sensitive_topic: false,
        rapid_fire: false,
        command_word: false,
      },
      reasoning: "Fail-open: gate evaluation defaulted to proceed.",
    };

    const model = getLanguageModelSafe("gemini-3.1-flash-lite-preview");
    if (!model) {
      return failOpenResult;
    }

    // Build user message with optional context
    let userMessage = `Evaluate this prompt:\n\n"${args.prompt}"`;
    if (args.missionType) {
      userMessage += `\n\nMission type: ${args.missionType}`;
    }
    if (args.context) {
      userMessage += `\n\nAdditional context: ${args.context}`;
    }

    // ERROR_BOUNDARY + TIMEOUT: wrap LLM call with AbortController
    let result: Awaited<ReturnType<typeof generateText>> | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS);

      try {
        result = await generateText({
          model,
          system: buildGateSystemPrompt(),
          prompt: userMessage,
          abortSignal: controller.signal,
          maxOutputTokens: 1024,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown LLM error";
      console.error(`[preExecutionGate] LLM call failed: ${message}`);
      return {
        ...failOpenResult,
        reasoning: `Fail-open: LLM error — ${message}`,
      };
    }

    // Parse LLM response
    const raw = result?.text?.trim() ?? "";
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as GateEvaluation;

      // Validate structure — ensure all expected fields exist
      const gates = parsed.gates;
      const disqualifiers = parsed.disqualifiers;

      if (
        typeof gates?.opportunity_identified !== "boolean" ||
        typeof gates?.unique_value !== "boolean" ||
        typeof gates?.actionable_outcome !== "boolean" ||
        typeof gates?.right_audience !== "boolean" ||
        typeof gates?.information_not_lost !== "boolean" ||
        typeof disqualifiers?.already_resolved !== "boolean" ||
        typeof disqualifiers?.social_only !== "boolean" ||
        typeof disqualifiers?.bot_already_replied !== "boolean" ||
        typeof disqualifiers?.sensitive_topic !== "boolean" ||
        typeof disqualifiers?.command_word !== "boolean"
      ) {
        console.warn(
          "[preExecutionGate] LLM response missing required boolean fields, fail-open",
        );
        return {
          ...failOpenResult,
          reasoning: "Fail-open: LLM response had missing/invalid fields.",
        };
      }

      // BOUND_READ: truncate reasoning
      const reasoning =
        typeof parsed.reasoning === "string"
          ? parsed.reasoning.slice(0, MAX_RESPONSE_CHARS)
          : "No reasoning provided.";

      return {
        gates,
        disqualifiers: {
          ...disqualifiers,
          rapid_fire: false, // Always set by checkRapidFire, not LLM
        },
        reasoning,
      };
    } catch {
      console.warn(
        "[preExecutionGate] Failed to parse LLM JSON response, fail-open",
      );
      return {
        ...failOpenResult,
        reasoning: `Fail-open: could not parse LLM response as JSON.`,
      };
    }
  },
});

/**
 * Main entry point — evaluates all gates and disqualifiers, records result.
 *
 * Orchestrates: checkRapidFire → evaluateGates → decide → recordGateResult.
 * HONEST_STATUS: skip returns the actual disqualifier name, not a generic message.
 */
export const evaluatePreExecutionGate = internalAction({
  args: {
    prompt: v.string(),
    missionId: v.optional(v.id("missions")),
    missionType: v.optional(v.string()),
    context: v.optional(v.string()),
  },
  returns: v.object({
    decision: v.string(),
    reasoning: v.string(),
    gatesPassed: v.number(),
    disqualifiersTriggered: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const startMs = Date.now();
    const promptHash = computePromptHash(args.prompt);

    // Step 1: Check rapid-fire (same prompt in last 5 min)
    const isRapidFire = await ctx.runQuery(
      internal.domains.missions.preExecutionGateQueries.checkRapidFire,
      { promptHash },
    );

    // Step 2: Evaluate gates via LLM (fail-open on error)
    let evaluation: GateEvaluation;
    try {
      evaluation = (await ctx.runAction(
        internal.domains.missions.preExecutionGate.evaluateGates,
        {
          prompt: args.prompt,
          missionType: args.missionType,
          context: args.context,
        },
      )) as GateEvaluation;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[preExecutionGate] evaluateGates action failed: ${message}`,
      );
      // Fail-open: proceed on any evaluation error
      evaluation = {
        gates: {
          opportunity_identified: true,
          unique_value: true,
          actionable_outcome: true,
          right_audience: true,
          information_not_lost: true,
        },
        disqualifiers: {
          already_resolved: false,
          social_only: false,
          bot_already_replied: false,
          sensitive_topic: false,
          rapid_fire: false,
          command_word: false,
        },
        reasoning: `Fail-open: gate evaluation action failed — ${message}`,
      };
    }

    // Step 3: Merge rapid_fire into disqualifiers
    evaluation.disqualifiers.rapid_fire = isRapidFire;

    // Step 4: Count gates passed
    const gateValues = Object.values(evaluation.gates);
    const gatesPassed = gateValues.filter(Boolean).length;

    // Step 5: Collect triggered disqualifiers
    const disqualifiersTriggered = Object.entries(evaluation.disqualifiers)
      .filter(([, v]) => v === true)
      .map(([k]) => k);

    // Step 6: Determine decision
    let decision: "proceed" | "skip" | "escalate";
    if (disqualifiersTriggered.length > 0) {
      decision = "skip";
    } else if (gatesPassed < MIN_GATES_TO_PROCEED) {
      decision = "escalate";
    } else {
      decision = "proceed";
    }

    const latencyMs = Date.now() - startMs;

    // Step 7: Record to database
    await ctx.runMutation(
      internal.domains.missions.preExecutionGateQueries.recordGateResult,
      {
        missionId: args.missionId,
        promptHash,
        prompt: args.prompt,
        gates: evaluation.gates,
        disqualifiers: evaluation.disqualifiers,
        decision,
        reasoning: evaluation.reasoning,
        gatesPassed,
        disqualifiersTriggered,
        latencyMs,
      },
    );

    return {
      decision,
      reasoning: evaluation.reasoning,
      gatesPassed,
      disqualifiersTriggered,
    };
  },
});

