"use node";

/**
 * LinkedIn Quality Judge - LLM-based content evaluation
 *
 * 2-step validation:
 * 1. Engagement gate (existing boolean checks from linkedinPosting.ts)
 * 2. LLM judge (3 boolean criteria: hookQuality, opinionDepth, questionAuthenticity)
 *
 * Model strategy: reviewed FREE-FIRST route via the existing model resolver
 * - poolside/laguna-s-2.1:free
 * - poolside/laguna-xs-2.1:free as an explicit fallback
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateText } from "ai";
import {
  getLanguageModelSafe,
  getModelSpec,
} from "../agents/mcp_tools/models/modelResolver";
import { validatePostEngagement } from "./linkedinPosting";
import {
  parseLinkedInQualityJudgeResponse,
  runLinkedInQualityJudgeWithFallback,
  shouldContinueLinkedInJudgeBatch,
} from "./linkedinQualityJudgePolicy";

// ═══════════════════════════════════════════════════════════════════════════
// LLM JUDGE
// ═══════════════════════════════════════════════════════════════════════════

const JUDGE_PROMPT_TEMPLATE = `You are a LinkedIn content quality judge for the CafeCorner organization page.

POST TYPE: {postType}
PERSONA: {persona}

POST CONTENT:
{content}

Evaluate these THREE boolean criteria:

1. hookQuality: Does the first line grab attention? It should NOT be a date, label, or report header. It SHOULD be a surprising claim, stat, or provocative question. Return true ONLY if the first line makes you want to read more.

2. opinionDepth: Does the post contain interpretive language? Look for phrases like "this signals", "the real story", "watch for", "here's why", "my take", "what matters most". Pure information dumps without interpretation = false.

3. questionAuthenticity: If there's a question, does it feel genuine and specific? NOT formulaic like "What do you think?" or "Thoughts?". GOOD questions reference specific details and invite expert responses. If there's NO question at all, return false.

Respond ONLY with valid JSON (no markdown, no explanation outside the JSON):
{"hookQuality": true, "opinionDepth": true, "questionAuthenticity": true, "reasoning": "Brief explanation", "verdict": "approve"}

VERDICT RULES:
- "approve": All 3 criteria pass
- "needs_rewrite": 1-2 criteria fail (content is fixable)
- "reject": All 3 criteria fail (fundamentally weak content)`;

/**
 * Judge a single post's quality using engagement gate + LLM.
 */
export const judgePostQuality = internalAction({
  args: {
    queueId: v.id("linkedinContentQueue"),
    content: v.string(),
    postType: v.string(),
    persona: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[judge] Evaluating queue item ${args.queueId}`);

    // Mark as judging
    await ctx.runMutation(internal.domains.social.linkedinContentQueue.updateQueueStatus, {
      queueId: args.queueId,
      status: "judging",
    });

    // Step 1: Run engagement gate (deterministic boolean checks)
    const gate = validatePostEngagement(args.content);

    await ctx.runMutation(internal.domains.social.linkedinContentQueue.storeEngagementGateResult, {
      queueId: args.queueId,
      passed: gate.passed,
      failures: gate.failures,
      softWarnings: gate.softWarnings,
    });

    // Auto-reject if 3+ engagement gate failures (fundamentally bad format)
    if (!gate.passed && gate.failures.length >= 3) {
      await ctx.runMutation(internal.domains.social.linkedinContentQueue.storeLLMJudgeResult, {
        queueId: args.queueId,
        model: "engagement_gate_auto",
        verdict: "reject",
        hookQuality: false,
        opinionDepth: false,
        questionAuthenticity: false,
        reasoning: `Auto-rejected: engagement gate hard fail with ${gate.failures.length} failures: ${gate.failures.map(f => f.split(":")[0]).join(", ")}`,
      });

      console.log(`[judge] Auto-rejected ${args.queueId} (${gate.failures.length} gate failures)`);
      return { success: true, verdict: "reject" as const };
    }

    // Step 2: LLM judge (3 boolean criteria)
    try {
      const prompt = JUDGE_PROMPT_TEMPLATE
        .replace("{postType}", args.postType)
        .replace("{persona}", args.persona)
        .replace("{content}", args.content);

      const judged = await runLinkedInQualityJudgeWithFallback(async (modelAlias) => {
        const model = getLanguageModelSafe(modelAlias);
        const result = await generateText({
          model,
          prompt,
          temperature: 0.1,
        });
        return parseLinkedInQualityJudgeResponse(result.text);
      });

      const judgeResult = judged.value;
      const resolvedModelId = getModelSpec(judged.modelAlias).sdkId;

      await ctx.runMutation(internal.domains.social.linkedinContentQueue.storeLLMJudgeResult, {
        queueId: args.queueId,
        model: resolvedModelId,
        verdict: judgeResult.verdict,
        hookQuality: judgeResult.hookQuality,
        opinionDepth: judgeResult.opinionDepth,
        questionAuthenticity: judgeResult.questionAuthenticity,
        reasoning: judgeResult.reasoning,
      });

      if (judged.failures.length > 0) {
        console.warn(
          `[judge] ${args.queueId}: used ${resolvedModelId} after ${judged.failures.length} failed free-model attempt(s)`,
        );
      }
      console.log(`[judge] ${args.queueId}: ${judgeResult.verdict} (hook=${judgeResult.hookQuality}, opinion=${judgeResult.opinionDepth}, question=${judgeResult.questionAuthenticity}) [${resolvedModelId}]`);

      return { success: true, verdict: judgeResult.verdict, model: resolvedModelId };
    } catch (error) {
      console.error(`[judge] Error judging ${args.queueId}:`, error);

      // Revert to pending so it can be retried
      await ctx.runMutation(internal.domains.social.linkedinContentQueue.updateQueueStatus, {
        queueId: args.queueId,
        status: "pending",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Batch judge pending posts. Called by cron every 30 minutes.
 */
export const batchJudgePending = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;
    const results: Array<{ queueId: string; verdict: string; success: boolean }> = [];

    for (let i = 0; i < limit; i++) {
      const item = await ctx.runQuery(
        internal.domains.social.linkedinContentQueue.getNextPendingForJudge,
        {},
      );

      if (!item) {
        console.log(`[batchJudge] No more pending items (processed ${i})`);
        break;
      }

      const result = await ctx.runAction(
        internal.domains.social.linkedinQualityJudge.judgePostQuality,
        {
          queueId: item._id,
          content: item.content,
          postType: item.postType,
          persona: item.persona,
        },
      );

      results.push({
        queueId: item._id,
        verdict: result.verdict ?? "error",
        success: result.success,
      });

      // The query is oldest-first and a failed item is reverted to pending. Stop
      // here so a transient provider outage cannot judge the same draft `limit`
      // times in one batch.
      if (!shouldContinueLinkedInJudgeBatch(result)) {
        console.warn(`[batchJudge] Stopping after failed item ${item._id}`);
        break;
      }

      // Rate limit: 2-second delay between judge calls
      if (i < limit - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`[batchJudge] Processed ${results.length}: ${JSON.stringify(results.map(r => r.verdict))}`);

    return {
      processed: results.length,
      results,
    };
  },
});
