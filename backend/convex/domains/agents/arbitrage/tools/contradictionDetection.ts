/**
 * Contradiction Detection Tool
 * 
 * Detects conflicting claims across sources using semantic analysis.
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { 
  CONTRADICTION_SEVERITY, 
  SOURCE_QUALITY_SCORES,
  type SourceType,
  type ContradictionInput 
} from "../config";

// Output types
export interface Contradiction {
  id: string;
  severity: "high" | "medium" | "low";
  fact1: {
    claim: string;
    source: string;
    sourceType: SourceType;
  };
  fact2: {
    claim: string;
    source: string;
    sourceType: SourceType;
  };
  verdict: "fact1_trusted" | "fact2_trusted" | "needs_investigation";
  explanation: string;
}

export interface ContradictionResult {
  contradictions: Contradiction[];
  totalAnalyzed: number;
  summary: string;
}

/**
 * Detect contradictions in a set of facts
 */
export async function executeContradictionDetection(
  ctx: ActionCtx,
  args: ContradictionInput
): Promise<ContradictionResult> {
  console.log(`[contradictionDetection] Analyzing ${args.facts.length} facts for contradictions`);

  if (args.facts.length < 2) {
    return {
      contradictions: [],
      totalAnalyzed: args.facts.length,
      summary: "Not enough facts to detect contradictions (need at least 2).",
    };
  }

  try {
    // Use LLM to detect semantic contradictions
    const factsJson = JSON.stringify(args.facts, null, 2);
    
    const result = await generateText({
      model: openai("gpt-5.4"),
      maxRetries: 2,
      system: `You are a contradiction detection expert. Analyze the provided facts and identify any contradictions.

For each contradiction found:
1. Identify the two conflicting claims
2. Classify severity:
   - HIGH: Direct numeric/factual contradiction (e.g., "$100M" vs "$50M")
   - MEDIUM: Conflicting interpretations (e.g., "strong growth" vs "struggling")
   - LOW: Nuanced differences (emphasis, detail level)
3. Determine verdict based on source type hierarchy:
   - primary > secondary_reputable > secondary_general > tertiary
   - If primary contradicts secondary, primary wins ("fact1_trusted" or "fact2_trusted")
   - If same type, mark as "needs_investigation"

Output ONLY valid JSON array of contradictions. Empty array if none found.`,
      prompt: `Analyze these facts for contradictions:

${factsJson}

Return JSON array format:
[
  {
    "fact1_index": 0,
    "fact2_index": 1,
    "severity": "high|medium|low",
    "verdict": "fact1_trusted|fact2_trusted|needs_investigation",
    "explanation": "Brief explanation"
  }
]`,
    });

    // Parse LLM response
    let rawContradictions: any[] = [];
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        rawContradictions = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error(`[contradictionDetection] Failed to parse LLM response:`, e);
    }

    // Build structured contradictions
    const contradictions: Contradiction[] = rawContradictions.map((c, idx) => {
      const fact1 = args.facts[c.fact1_index];
      const fact2 = args.facts[c.fact2_index];
      
      // Determine verdict based on source hierarchy if LLM didn't
      let verdict = c.verdict;
      if (!verdict || verdict === "needs_investigation") {
        const score1 = SOURCE_QUALITY_SCORES[fact1.sourceType as SourceType] || 30;
        const score2 = SOURCE_QUALITY_SCORES[fact2.sourceType as SourceType] || 30;
        if (score1 > score2) verdict = "fact1_trusted";
        else if (score2 > score1) verdict = "fact2_trusted";
        else verdict = "needs_investigation";
      }

      return {
        id: `contradiction_${idx}_${Date.now()}`,
        severity: c.severity || "medium",
        fact1: {
          claim: fact1.claim,
          source: fact1.source,
          sourceType: fact1.sourceType as SourceType,
        },
        fact2: {
          claim: fact2.claim,
          source: fact2.source,
          sourceType: fact2.sourceType as SourceType,
        },
        verdict,
        explanation: c.explanation || "Conflicting claims detected.",
      };
    });

    const summary = contradictions.length === 0
      ? "No contradictions detected across sources."
      : `Found ${contradictions.length} contradiction(s): ${contradictions.filter(c => c.severity === "high").length} high, ${contradictions.filter(c => c.severity === "medium").length} medium, ${contradictions.filter(c => c.severity === "low").length} low severity.`;

    console.log(`[contradictionDetection] ${summary}`);
    
    return {
      contradictions,
      totalAnalyzed: args.facts.length,
      summary,
    };
  } catch (error: any) {
    console.error(`[contradictionDetection] Error:`, error);
    return {
      contradictions: [],
      totalAnalyzed: args.facts.length,
      summary: `Error detecting contradictions: ${error.message}`,
    };
  }
}

// Tool definition for AI SDK
export const contradictionDetectionToolDefinition = {
  description: `Detect contradictions across multiple source claims. 
Uses semantic analysis to find conflicting facts and determines which source to trust based on quality hierarchy (PRIMARY > SECONDARY > TERTIARY).
Returns severity (high/medium/low) and verdict for each contradiction.`,
  inputSchema: z.object({
    facts: z.array(z.object({
      claim: z.string(),
      source: z.string(),
      sourceType: z.enum(["primary", "secondary_reputable", "secondary_general", "tertiary"]),
      timestamp: z.number().optional(),
    })),
  }),
};
