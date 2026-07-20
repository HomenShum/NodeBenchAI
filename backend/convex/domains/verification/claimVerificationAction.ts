"use node";
// convex/domains/verification/claimVerificationAction.ts
// LLM-as-a-Judge verification system for fact claims
// 
// Verifies that source artifacts actually support the claims made.
// Uses Linkup to fetch source content, then LLM judges if claim is supported.

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { getLlmModel, resolveModelAlias, getModelWithFailover } from "../../../shared/llm/modelCatalog";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Verdict = "supported" | "not_found" | "contradicted" | "inaccessible";

interface JudgeResult {
  verdict: Verdict;
  confidence: number;
  explanation: string;
}

interface VerificationResult {
  factId: string;
  artifactId: string;
  verdict: Verdict;
  confidence: number;
  explanation?: string;
  snippet?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM-AS-A-JUDGE PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM_PROMPT = `You are verifying whether a source supports a specific claim.

You MUST respond with strict JSON only (no markdown, no explanation outside JSON):
{
  "verdict": "supported" | "not_found" | "contradicted" | "inaccessible",
  "confidence": number between 0 and 1,
  "explanation": "short explanation (max 60 words)"
}

Rules:
- "supported" ONLY if the source explicitly states the claim (or a numerically equivalent variant).
- "not_found" if the source does not clearly mention the claim.
- "contradicted" if the source states numbers or facts that conflict with the claim.
- "inaccessible" if the content is clearly an error page, paywall, login wall, or blocked content.

Be strict: a claim is only "supported" if the source unambiguously confirms it.`;

function buildJudgePrompt(claimText: string, sourceContent: string): string {
  return `CLAIM:
<<<
${claimText}
>>>

SOURCE CONTENT:
<<<
${sourceContent.slice(0, 3000)}${sourceContent.length > 3000 ? '...[truncated]' : ''}
>>>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/**
 * Fetch source content via Linkup
 */
async function fetchSourceContent(
  url: string,
  claimText: string
): Promise<{ content: string; snippet: string } | null> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    console.error("[claimVerification] LINKUP_API_KEY not configured");
    return null;
  }

  const domain = extractDomain(url);
  if (!domain) return null;

  try {
    // Use Linkup to search the specific domain for content related to the claim
    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: claimText,
        depth: "standard",
        outputType: "sourcedAnswer",
        includeDomains: [domain],
        maxResults: 3,
      }),
    });

    if (!response.ok) {
      console.error(`[claimVerification] Linkup error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Combine answer and source snippets
    let content = data.answer || '';
    let snippet = data.answer?.slice(0, 300) || '';
    
    if (data.sources && data.sources.length > 0) {
      for (const src of data.sources) {
        if (src.snippet) {
          content += `\n\n[Source: ${src.name}]\n${src.snippet}`;
          if (!snippet) snippet = src.snippet.slice(0, 300);
        }
      }
    }

    return content ? { content, snippet } : null;
  } catch (error) {
    console.error("[claimVerification] Fetch error:", error);
    return null;
  }
}

/**
 * Call LLM-as-a-judge to verify claim against source
 */
async function judgeClaimAgainstSource(
  claimText: string,
  sourceContent: string
): Promise<JudgeResult> {
  const { model: modelName, provider } = getModelWithFailover(resolveModelAlias(getLlmModel("judge")));
  const userPrompt = buildJudgePrompt(claimText, sourceContent);

  try {
    let content: string | undefined;
    
    if (provider === "anthropic") {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 200,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
      content = response.content[0]?.type === "text" ? response.content[0].text : undefined;
    } else if (provider === "gemini") {
      const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
      const result = await generateText({
        model: google(modelName),
        system: JUDGE_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: 200,
      });
      content = result.text;
    } else {
      // OpenAI
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: modelName,
        max_completion_tokens: 200,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      content = response.choices[0]?.message?.content?.trim();
    }
    if (!content) {
      throw new Error("Empty response from judge");
    }

    // Parse JSON response
    const result = JSON.parse(content) as JudgeResult;
    
    // Validate verdict
    if (!["supported", "not_found", "contradicted", "inaccessible"].includes(result.verdict)) {
      throw new Error(`Invalid verdict: ${result.verdict}`);
    }
    
    // Clamp confidence to 0-1
    result.confidence = Math.max(0, Math.min(1, result.confidence || 0));
    
    return result;
  } catch (error) {
    console.error("[claimVerification] Judge error:", error);
    // Default to not_found on errors
    return {
      verdict: "not_found",
      confidence: 0.5,
      explanation: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VERIFICATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a single claim against a single artifact
 */
export const verifySingleClaim = internalAction({
  args: {
    runId: v.string(),
    factId: v.string(),
    claimText: v.string(),
    artifactId: v.string(),
    artifactUrl: v.string(),
  },
  handler: async (ctx, args): Promise<VerificationResult> => {
    console.log(`[claimVerification] Verifying claim "${args.claimText.slice(0, 50)}..." against ${args.artifactUrl}`);

    // 1. Fetch source content via Linkup
    const sourceData = await fetchSourceContent(args.artifactUrl, args.claimText);

    let result: VerificationResult;

    if (!sourceData) {
      // Could not fetch source
      result = {
        factId: args.factId,
        artifactId: args.artifactId,
        verdict: "inaccessible",
        confidence: 0.9,
        explanation: "Could not fetch source content",
      };
    } else {
      // 2. Call LLM-as-a-judge
      const judgment = await judgeClaimAgainstSource(args.claimText, sourceData.content);

      result = {
        factId: args.factId,
        artifactId: args.artifactId,
        verdict: judgment.verdict,
        confidence: judgment.confidence,
        explanation: judgment.explanation,
        snippet: sourceData.snippet,
      };
    }

    // 3. Store verification result
    await ctx.runMutation(internal.domains.verification.claimVerificationQueries.storeVerification, {
      runId: args.runId,
      factId: args.factId,
      artifactId: args.artifactId,
      verdict: result.verdict,
      confidence: result.confidence,
      explanation: result.explanation,
      snippet: result.snippet,
    });

    // 4. Update artifact health
    await ctx.runMutation(internal.domains.verification.claimVerificationQueries.updateArtifactHealth, {
      runId: args.runId,
      artifactId: args.artifactId,
    });

    console.log(`[claimVerification] Result: ${result.verdict} (${result.confidence.toFixed(2)})`);
    return result;
  },
});

/**
 * Verify a batch of facts for a run
 * 
 * @param runId - The run to verify
 * @param factIds - Specific facts to verify (optional, defaults to all)
 * @param prioritySections - Only verify facts from these sections (optional)
 * @param maxFacts - Maximum number of facts to verify in this batch
 */
export const verifyFactBatch = internalAction({
  args: {
    runId: v.string(),
    factIds: v.optional(v.array(v.string())),
    prioritySections: v.optional(v.array(v.string())),
    maxFacts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxFacts = args.maxFacts || 20;

    console.log(`[verifyFactBatch] Starting verification for run ${args.runId}`);

    // 1. Get facts to verify
    const facts = await ctx.runQuery(internal.domains.verification.facts.internalGetFactsForVerification, {
      runId: args.runId,
      factIds: args.factIds,
      sectionKeys: args.prioritySections,
    });

    if (!facts || facts.length === 0) {
      console.log(`[verifyFactBatch] No facts found to verify`);
      return { verified: 0, results: [] };
    }

    console.log(`[verifyFactBatch] Found ${facts.length} facts, limiting to ${maxFacts}`);

    // 2. Get artifacts for the run
    const artifacts = await ctx.runQuery(internal.lib.artifactQueries.getAllowedUrlsForRun, {
      runId: args.runId,
      userId: "system" as any, // Internal action, bypass auth
    });

    // Build artifact URL map
    const artifactUrlMap = new Map<string, string>();
    // We need the full artifacts, not just URLs
    // Let me query them properly
    
    const results: VerificationResult[] = [];
    let verified = 0;

    // 3. Process each fact (up to maxFacts)
    for (const fact of facts.slice(0, maxFacts)) {
      if (!fact) continue; // TypeScript guard
      if (!fact.artifactIds || fact.artifactIds.length === 0) {
        console.log(`[verifyFactBatch] Skipping fact ${fact.factId} - no linked artifacts`);
        continue;
      }

      // Verify against each linked artifact
      for (const artifactId of fact.artifactIds) {
        // Get artifact URL
        const artifact = await ctx.runQuery(internal.domains.verification.claimVerificationQueries.getArtifactForVerification, {
          runId: args.runId,
          artifactId,
        });

        if (!artifact || !artifact.canonicalUrl) {
          console.log(`[verifyFactBatch] Skipping artifact ${artifactId} - not found or no URL`);
          continue;
        }

        // Verify this claim against this artifact
        const result = await ctx.runAction(internal.domains.verification.claimVerificationAction.verifySingleClaim, {
          runId: args.runId,
          factId: fact.factId,
          claimText: fact.claimText,
          artifactId,
          artifactUrl: artifact.canonicalUrl,
        });

        results.push(result);
        verified++;

        // Rate limit between verifications (don't hammer APIs)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[verifyFactBatch] Completed: ${verified} verifications`);

    // Summarize results
    const summary = {
      verified,
      supported: results.filter(r => r.verdict === "supported").length,
      notFound: results.filter(r => r.verdict === "not_found").length,
      contradicted: results.filter(r => r.verdict === "contradicted").length,
      inaccessible: results.filter(r => r.verdict === "inaccessible").length,
    };

    return { ...summary, results };
  },
});

/**
 * Schedule verification for a run (fire-and-forget)
 * Call this after dossier generation or on user request
 */
export const scheduleVerification = internalAction({
  args: {
    runId: v.string(),
    prioritySections: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Schedule the batch verification to run async
    await ctx.scheduler.runAfter(0, internal.domains.verification.claimVerificationAction.verifyFactBatch, {
      runId: args.runId,
      prioritySections: args.prioritySections || ["executive_summary", "funding_signals"],
      maxFacts: 20,
    });

    console.log(`[scheduleVerification] Scheduled verification for run ${args.runId}`);
  },
});
