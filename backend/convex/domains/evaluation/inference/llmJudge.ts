/**
 * llmJudge.ts
 *
 * LLM-as-a-Judge Evaluation System
 *
 * Uses LLM for nuanced evaluation that outperforms arbitrary scoring:
 * 1. Claim verification assessment (is this claim plausibly true?)
 * 2. Risk signal severity grading (is this signal actually concerning?)
 * 3. Evidence quality evaluation (is this source reliable?)
 * 4. Contradiction resolution (which source should we trust?)
 *
 * Reference: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (2023)
 * The LLM judge approach provides more nuanced evaluation than rule-based systems.
 *
 * Note: This module provides evaluation prompts and result parsing.
 * Actual LLM calls are made via the existing Claude integration.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { api } from "../../../_generated/api";
import { DDClaim, DDRiskSignal, DDRiskCategory } from "../../agents/dueDiligence/types";
import { SourceCitation } from "../scoring/claimLifecycle";

// ============================================================================
// LLM JUDGE TYPES
// ============================================================================

/**
 * LLM judge verdict for a claim
 */
export interface LLMClaimVerdict {
  claimId: string;
  originalVerdict: DDClaim["verdict"];
  llmVerdict: DDClaim["verdict"];
  confidence: number;  // 0-1
  reasoning: string;
  suggestedFollowUp?: string;
  redFlags: string[];
  greenFlags: string[];
  evaluatedAt: number;
}

/**
 * LLM judge evaluation of a risk signal
 */
export interface LLMSignalEvaluation {
  signalId: string;
  signal: DDRiskSignal;
  originalSeverity: DDRiskSignal["severity"];
  evaluatedSeverity: DDRiskSignal["severity"];
  severityAdjustment: "upgrade" | "downgrade" | "maintain";
  reasoning: string;
  contextConsiderations: string[];
  falsePositiveLikelihood: "low" | "medium" | "high";
  evaluatedAt: number;
}

/**
 * LLM judge evaluation of source quality
 */
export interface LLMSourceEvaluation {
  sourceId: string;
  url: string;
  originalReliability: SourceCitation["reliability"];
  evaluatedReliability: SourceCitation["reliability"];
  qualityScore: number;  // 0-100
  reasoning: string;
  biasIndicators: string[];
  factualAccuracySignals: string[];
  recencyConsiderations: string;
  evaluatedAt: number;
}

/**
 * LLM judge contradiction resolution
 */
export interface LLMContradictionResolution {
  contradictionId: string;
  claimA: { text: string; source: string };
  claimB: { text: string; source: string };
  resolution: "a_correct" | "b_correct" | "both_valid" | "both_suspect" | "insufficient_data";
  confidence: number;
  reasoning: string;
  evidenceWeighting: string;
  recommendedAction: string;
  evaluatedAt: number;
}

/**
 * Full LLM evaluation result for a DD job
 */
export interface LLMEvaluationResult {
  jobId: string;
  entityName: string;
  evaluatedAt: number;

  // Claim evaluations
  claimVerdicts: LLMClaimVerdict[];
  claimVerdictChanges: number;
  claimAgreementRate: number;

  // Signal evaluations
  signalEvaluations: LLMSignalEvaluation[];
  signalAdjustments: number;

  // Source evaluations
  sourceEvaluations: LLMSourceEvaluation[];
  lowQualitySources: number;

  // Contradiction resolutions
  contradictionResolutions: LLMContradictionResolution[];

  // Overall assessment
  overallRiskAssessment: string;
  llmConfidenceScore: number;
  keyInsights: string[];
  recommendedActions: string[];

  // Meta
  tokensUsed: number;
  evaluationTimeMs: number;
}

// ============================================================================
// LLM JUDGE PROMPTS
// ============================================================================

/**
 * Prompt for evaluating a single claim
 */
export function buildClaimEvaluationPrompt(
  claim: DDClaim,
  entityName: string,
  context: string
): string {
  return `You are an expert due diligence analyst evaluating claims about companies.

ENTITY: ${entityName}

CLAIM TO EVALUATE:
- Text: "${claim.claimText}"
- Type: ${claim.claimType}
- Current Verdict: ${claim.verdict}
- Confidence: ${(claim.confidence * 100).toFixed(0)}%
- Source: ${claim.extractedFrom.source}
${claim.extractedFrom.quoteSpan ? `- Quote: "${claim.extractedFrom.quoteSpan}"` : ""}

CONTEXT:
${context}

INSTRUCTIONS:
Evaluate this claim and provide:
1. Your verdict: "verified" (strong evidence confirms), "disputed" (conflicting evidence), "unverifiable" (cannot confirm/deny), or "context_needed" (need more info)
2. Confidence (0-1)
3. Your reasoning (2-3 sentences)
4. Any red flags that make you doubt this claim
5. Any green flags that support this claim
6. Suggested follow-up verification steps (if any)

Respond in JSON format:
{
  "verdict": "verified|disputed|unverifiable|context_needed",
  "confidence": 0.X,
  "reasoning": "...",
  "redFlags": ["..."],
  "greenFlags": ["..."],
  "suggestedFollowUp": "..." or null
}`;
}

/**
 * Prompt for evaluating a risk signal
 */
export function buildSignalEvaluationPrompt(
  signal: DDRiskSignal,
  entityName: string,
  entityContext: string
): string {
  return `You are an expert risk analyst evaluating due diligence signals.

ENTITY: ${entityName}

SIGNAL TO EVALUATE:
- Category: ${signal.category}
- Signal: "${signal.signal}"
- Current Severity: ${signal.severity}
- Source: ${signal.source}
- Detected: ${new Date(signal.detectedAt).toISOString()}

ENTITY CONTEXT:
${entityContext}

INSTRUCTIONS:
Evaluate whether this signal's severity is appropriate given the context.

Consider:
1. Is this signal truly concerning in this specific context?
2. Could this be a false positive? (e.g., new company legitimately has young domain)
3. Are there mitigating factors?
4. Should severity be upgraded, downgraded, or maintained?

Provide:
1. Your evaluated severity: "low", "medium", "high", or "critical"
2. Whether to upgrade/downgrade/maintain
3. Your reasoning
4. Context considerations that affect interpretation
5. False positive likelihood

Respond in JSON format:
{
  "evaluatedSeverity": "low|medium|high|critical",
  "severityAdjustment": "upgrade|downgrade|maintain",
  "reasoning": "...",
  "contextConsiderations": ["..."],
  "falsePositiveLikelihood": "low|medium|high"
}`;
}

/**
 * Prompt for evaluating source quality
 */
export function buildSourceEvaluationPrompt(
  source: SourceCitation,
  claimText: string
): string {
  return `You are an expert evaluating source reliability for due diligence.

SOURCE TO EVALUATE:
- URL: ${source.url}
- Type: ${source.sourceType}
- Accessed: ${new Date(source.accessedAt).toISOString()}
${source.publishedAt ? `- Published: ${new Date(source.publishedAt).toISOString()}` : ""}
${source.extractedSnippet ? `- Snippet: "${source.extractedSnippet}"` : ""}

CLAIM SUPPORTED: "${claimText}"

INSTRUCTIONS:
Evaluate this source's reliability for supporting the claim.

Consider:
1. Source type credibility (SEC filing > press release > blog post)
2. Potential biases (company website may self-promote)
3. Recency of information
4. Factual accuracy indicators

Provide:
1. Reliability rating: "authoritative", "reliable", "secondary", or "unverified"
2. Quality score (0-100)
3. Your reasoning
4. Any bias indicators
5. Factual accuracy signals
6. Recency considerations

Respond in JSON format:
{
  "evaluatedReliability": "authoritative|reliable|secondary|unverified",
  "qualityScore": 0-100,
  "reasoning": "...",
  "biasIndicators": ["..."],
  "factualAccuracySignals": ["..."],
  "recencyConsiderations": "..."
}`;
}

/**
 * Prompt for resolving contradictions
 */
export function buildContradictionPrompt(
  claimA: { text: string; source: string },
  claimB: { text: string; source: string },
  entityName: string
): string {
  return `You are an expert analyst resolving contradictory information.

ENTITY: ${entityName}

CLAIM A:
- Text: "${claimA.text}"
- Source: ${claimA.source}

CLAIM B (contradicts A):
- Text: "${claimB.text}"
- Source: ${claimB.source}

INSTRUCTIONS:
Determine which claim (if either) is more likely correct.

Consider:
1. Source reliability (official filings > news > company claims)
2. Specificity (specific numbers are more verifiable)
3. Recency (more recent info may be more accurate)
4. Consistency with other known facts

Provide:
1. Resolution: "a_correct", "b_correct", "both_valid" (context-dependent), "both_suspect", or "insufficient_data"
2. Confidence (0-1)
3. Your reasoning
4. How you weighted the evidence
5. Recommended action

Respond in JSON format:
{
  "resolution": "a_correct|b_correct|both_valid|both_suspect|insufficient_data",
  "confidence": 0.X,
  "reasoning": "...",
  "evidenceWeighting": "...",
  "recommendedAction": "..."
}`;
}

// ============================================================================
// LLM JUDGE ACTIONS
// ============================================================================

/**
 * Evaluate a single claim using LLM
 */
export const evaluateClaim = internalAction({
  args: {
    entityName: v.string(),
    claim: v.object({
      id: v.string(),
      claimText: v.string(),
      claimType: v.string(),
      verdict: v.string(),
      confidence: v.number(),
      extractedFrom: v.object({
        source: v.string(),
        timestamp: v.optional(v.number()),
        quoteSpan: v.optional(v.string()),
      }),
    }),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LLMClaimVerdict> => {
    const startTime = Date.now();

    const claim: DDClaim = {
      ...args.claim,
      claimType: args.claim.claimType as DDClaim["claimType"],
      verdict: args.claim.verdict as DDClaim["verdict"],
      freshness: "current",
      citations: [],
    };

    const prompt = buildClaimEvaluationPrompt(
      claim,
      args.entityName,
      args.context || "No additional context provided."
    );

    try {
      // Call LLM via Claude integration
      const response = await ctx.runAction(
        api.domains.ai.claude.actions.generateClaudeResponse,
        {
          systemPrompt: "You are an expert due diligence analyst. Respond only with valid JSON.",
          userMessage: prompt,
          model: "haiku",  // Use faster model for evaluation
          maxTokens: 500,
        }
      );

      // Parse response
      const result = parseJSONResponse(response.content);

      return {
        claimId: args.claim.id,
        originalVerdict: claim.verdict,
        llmVerdict: result.verdict || claim.verdict,
        confidence: result.confidence || 0.5,
        reasoning: result.reasoning || "Unable to evaluate",
        suggestedFollowUp: result.suggestedFollowUp,
        redFlags: result.redFlags || [],
        greenFlags: result.greenFlags || [],
        evaluatedAt: Date.now(),
      };
    } catch (error) {
      // Fallback if LLM call fails
      return {
        claimId: args.claim.id,
        originalVerdict: claim.verdict,
        llmVerdict: claim.verdict,
        confidence: claim.confidence,
        reasoning: `LLM evaluation failed: ${error}`,
        redFlags: [],
        greenFlags: [],
        evaluatedAt: Date.now(),
      };
    }
  },
});

/**
 * Evaluate a risk signal using LLM
 */
export const evaluateSignal = internalAction({
  args: {
    entityName: v.string(),
    signal: v.object({
      category: v.string(),
      severity: v.string(),
      signal: v.string(),
      source: v.string(),
      detectedAt: v.number(),
    }),
    entityContext: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LLMSignalEvaluation> => {
    const signal: DDRiskSignal = {
      ...args.signal,
      category: args.signal.category as DDRiskCategory,
      severity: args.signal.severity as DDRiskSignal["severity"],
    };

    const prompt = buildSignalEvaluationPrompt(
      signal,
      args.entityName,
      args.entityContext || "No additional context provided."
    );

    try {
      const response = await ctx.runAction(
        api.domains.ai.claude.actions.generateClaudeResponse,
        {
          systemPrompt: "You are an expert risk analyst. Respond only with valid JSON.",
          userMessage: prompt,
          model: "haiku",
          maxTokens: 400,
        }
      );

      const result = parseJSONResponse(response.content);

      return {
        signalId: `sig_${Date.now()}`,
        signal,
        originalSeverity: signal.severity,
        evaluatedSeverity: result.evaluatedSeverity || signal.severity,
        severityAdjustment: result.severityAdjustment || "maintain",
        reasoning: result.reasoning || "Unable to evaluate",
        contextConsiderations: result.contextConsiderations || [],
        falsePositiveLikelihood: result.falsePositiveLikelihood || "medium",
        evaluatedAt: Date.now(),
      };
    } catch (error) {
      return {
        signalId: `sig_${Date.now()}`,
        signal,
        originalSeverity: signal.severity,
        evaluatedSeverity: signal.severity,
        severityAdjustment: "maintain",
        reasoning: `LLM evaluation failed: ${error}`,
        contextConsiderations: [],
        falsePositiveLikelihood: "medium",
        evaluatedAt: Date.now(),
      };
    }
  },
});

/**
 * Batch evaluate multiple claims
 */
export const batchEvaluateClaims = internalAction({
  args: {
    entityName: v.string(),
    claims: v.array(v.object({
      id: v.string(),
      claimText: v.string(),
      claimType: v.string(),
      verdict: v.string(),
      confidence: v.number(),
      extractedFrom: v.object({
        source: v.string(),
        timestamp: v.optional(v.number()),
        quoteSpan: v.optional(v.string()),
      }),
    })),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    verdicts: LLMClaimVerdict[];
    agreementRate: number;
    changes: number;
  }> => {
    const verdicts: LLMClaimVerdict[] = [];

    // Evaluate claims in batches to avoid rate limits
    for (const claim of args.claims) {
      const verdict = await ctx.runAction(
        api.domains.evaluation.inference.llmJudge.evaluateClaim,
        {
          entityName: args.entityName,
          claim,
          context: args.context,
        }
      );
      verdicts.push(verdict);
    }

    // Calculate metrics
    const changes = verdicts.filter(v => v.originalVerdict !== v.llmVerdict).length;
    const agreementRate = (verdicts.length - changes) / verdicts.length;

    return {
      verdicts,
      agreementRate,
      changes,
    };
  },
});

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Parse JSON response from LLM, handling markdown code blocks
 */
function parseJSONResponse(content: string): any {
  // Remove markdown code blocks if present
  let jsonStr = content.trim();

  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }

  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * Calculate inter-rater agreement (simple Cohen's kappa approximation)
 */
export function calculateAgreement(
  originalVerdicts: string[],
  llmVerdicts: string[]
): number {
  if (originalVerdicts.length !== llmVerdicts.length) {
    throw new Error("Verdict arrays must have same length");
  }

  const n = originalVerdicts.length;
  if (n === 0) return 1;

  // Calculate observed agreement
  let agreements = 0;
  for (let i = 0; i < n; i++) {
    if (originalVerdicts[i] === llmVerdicts[i]) {
      agreements++;
    }
  }

  return agreements / n;
}
