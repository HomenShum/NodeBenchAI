/**
 * Arbitrage Analysis Tool
 * 
 * Core tool for the Arbitrage Agent that:
 * - Scores source quality (primary > secondary > tertiary)
 * - Detects contradictions between sources
 * - Calculates deltas from memory baseline
 * - Generates arbitrage reports
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

/**
 * Source type scoring rubric
 * Primary: SEC filings, official announcements, court docs, patents = 10 points each
 * Secondary: News articles from reputable outlets = 5-7 points each
 * Tertiary: Blogs, social media, aggregators = 2-3 points each
 */
const SOURCE_SCORES = {
  primary: 10,
  secondary: 5,
  tertiary: 2,
} as const;

/**
 * Maximum quality score (10 primary sources would max it out)
 */
const MAX_QUALITY_SCORE = 100;

/**
 * Fact schema for structured fact input
 */
const factSchema = z.object({
  claim: z.string().describe("The factual claim (e.g., 'Tesla raised $240M in Series C')"),
  source: z.string().describe("Source name (e.g., 'SEC S-1 Filing', 'TechCrunch')"),
  sourceType: z.enum(["primary", "secondary", "tertiary"]).describe("Type of source"),
  url: z.string().optional().describe("URL to the source if available"),
  value: z.string().optional().describe("Extracted value for comparison (e.g., '$240M', '10M users')"),
});

type Fact = z.infer<typeof factSchema>;

/**
 * Contradiction detection result
 */
interface Contradiction {
  claim: string;
  sourceA: { name: string; value?: string; type: string };
  sourceB: { name: string; value?: string; type: string };
  verdict: string;
}

/**
 * Generate a fact signature for grouping similar claims
 * Uses the first ~50 chars of claim normalized for comparison
 */
function generateFactSignature(fact: Fact): string {
  return fact.claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .slice(0, 50);
}

/**
 * Detect contradictions by grouping similar claims
 * and finding those with different values from different sources
 */
function detectContradictions(facts: Fact[]): Contradiction[] {
  const contradictions: Contradiction[] = [];
  
  // Group facts by similar claim signature
  const claimGroups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const signature = generateFactSignature(fact);
    if (!claimGroups.has(signature)) {
      claimGroups.set(signature, []);
    }
    claimGroups.get(signature)!.push(fact);
  }
  
  // Find groups with multiple sources that might contradict
  for (const [signature, groupFacts] of claimGroups) {
    if (groupFacts.length < 2) continue;
    
    // Look for facts with different values
    const factsWithValues = groupFacts.filter(f => f.value);
    if (factsWithValues.length < 2) continue;
    
    // Check for value mismatches
    const uniqueValues = new Set(factsWithValues.map(f => f.value?.toLowerCase()));
    if (uniqueValues.size > 1) {
      // We have a contradiction!
      // Find the highest quality source (primary wins)
      const sorted = [...factsWithValues].sort((a, b) => {
        const scoreA = SOURCE_SCORES[a.sourceType];
        const scoreB = SOURCE_SCORES[b.sourceType];
        return scoreB - scoreA;
      });
      
      const primary = sorted[0];
      const contradicting = sorted.find(f => f.value?.toLowerCase() !== primary.value?.toLowerCase());
      
      if (contradicting) {
        const primaryTypeLabel = primary.sourceType.charAt(0).toUpperCase() + primary.sourceType.slice(1);
        const contradictingTypeLabel = contradicting.sourceType.charAt(0).toUpperCase() + contradicting.sourceType.slice(1);
        
        contradictions.push({
          claim: primary.claim,
          sourceA: {
            name: primary.source,
            value: primary.value,
            type: primaryTypeLabel,
          },
          sourceB: {
            name: contradicting.source,
            value: contradicting.value,
            type: contradictingTypeLabel,
          },
          verdict: primary.sourceType === "primary" 
            ? `${primaryTypeLabel} source (${primary.source}) wins - value: ${primary.value}`
            : `Conflict unresolved - ${primary.source} vs ${contradicting.source}`,
        });
      }
    }
  }
  
  return contradictions;
}

/**
 * Calculate source quality score
 * Formula: sum of source scores, capped at 100
 */
function calculateQualityScore(facts: Fact[]): {
  score: number;
  breakdown: { primary: number; secondary: number; tertiary: number };
} {
  const breakdown = {
    primary: 0,
    secondary: 0,
    tertiary: 0,
  };
  
  for (const fact of facts) {
    breakdown[fact.sourceType]++;
  }
  
  const rawScore = 
    (breakdown.primary * SOURCE_SCORES.primary) +
    (breakdown.secondary * SOURCE_SCORES.secondary) +
    (breakdown.tertiary * SOURCE_SCORES.tertiary);
  
  return {
    score: Math.min(MAX_QUALITY_SCORE, rawScore),
    breakdown,
  };
}

/**
 * Main arbitrage analysis tool
 */
export const analyzeWithArbitrage = createTool({
  description: `Perform arbitrage analysis on collected research facts.
  
Call this tool AFTER gathering facts from research (LinkUp, SEC, subagents).
It will:
1. Score overall source quality (primary > secondary > tertiary)
2. Detect contradictions between sources
3. Compare against memory baseline to find deltas
4. Generate an arbitrage report

Use this for any research query when arbitrage mode is enabled.

Returns JSON with:
- qualityScore: 0-100 based on source types
- sourceBreakdown: count of primary/secondary/tertiary sources
- contradictions: array of detected conflicts
- deltas: changes compared to memory baseline`,

  args: z.object({
    entityKey: z.string().describe("Canonical entity key (e.g., 'company:Tesla', 'person:Sam Altman')"),
    facts: z.array(factSchema).describe("Array of facts collected from research"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[analyzeWithArbitrage] Analyzing ${args.facts.length} facts for ${args.entityKey}`);
    
    // 1. Calculate quality score
    const { score: qualityScore, breakdown: sourceBreakdown } = calculateQualityScore(args.facts);
    
    // 2. Detect contradictions
    const contradictions = detectContradictions(args.facts);
    
    // 3. Load baseline from entityContexts (if exists)
    let baseline: any = null;
    let deltas: {
      isFirstRun: boolean;
      factCountChange: number;
      lastChecked: number | null;
      daysSinceLastResearch: number | null;
      newFacts: string[];
    } = {
      isFirstRun: true,
      factCountChange: args.facts.length,
      lastChecked: null,
      daysSinceLastResearch: null,
      newFacts: [],
    };
    
    try {
      // Try to get entity by canonical key
      baseline = await ctx.runQuery(api.domains.knowledge.entityContexts.getByCanonicalKey, {
        canonicalKey: args.entityKey,
      });
      
      if (baseline) {
        const baselineFactCount = baseline.factCount ?? baseline.keyFacts?.length ?? 0;
        const daysSince = baseline.researchedAt 
          ? Math.floor((Date.now() - baseline.researchedAt) / (1000 * 60 * 60 * 24))
          : null;
        
        // Find facts that weren't in the baseline
        const baselineFactSignatures = new Set(
          (baseline.keyFacts ?? []).map((f: string) => f.toLowerCase().slice(0, 50))
        );
        const newFacts = args.facts
          .filter(f => !baselineFactSignatures.has(generateFactSignature(f)))
          .map(f => f.claim);
        
        deltas = {
          isFirstRun: false,
          factCountChange: args.facts.length - baselineFactCount,
          lastChecked: baseline.researchedAt ?? null,
          daysSinceLastResearch: daysSince,
          newFacts: newFacts.slice(0, 10), // Limit to 10 for brevity
        };
        
        console.log(`[analyzeWithArbitrage] Found baseline for ${args.entityKey}, ${deltas.newFacts.length} new facts`);
      }
    } catch (err) {
      console.warn(`[analyzeWithArbitrage] Could not load baseline for ${args.entityKey}:`, err);
    }
    
    // 4. Build arbitrage report
    const report = {
      entityKey: args.entityKey,
      analysisTimestamp: new Date().toISOString(),
      
      // Quality assessment
      qualityScore,
      qualityTier: qualityScore >= 70 ? "high" : qualityScore >= 40 ? "medium" : "low",
      sourceBreakdown,
      
      // Contradictions
      contradictionCount: contradictions.length,
      contradictions: contradictions.map(c => ({
        claim: c.claim,
        sourceA: `${c.sourceA.name} (${c.sourceA.type}): ${c.sourceA.value}`,
        sourceB: `${c.sourceB.name} (${c.sourceB.type}): ${c.sourceB.value}`,
        verdict: c.verdict,
      })),
      
      // Deltas
      deltas,
      
      // Summary
      summary: buildSummary(qualityScore, sourceBreakdown, contradictions.length, deltas),
    };
    
    console.log(`[analyzeWithArbitrage] Report: quality=${qualityScore}, contradictions=${contradictions.length}`);
    
    return JSON.stringify(report, null, 2);
  },
});

/**
 * Build a human-readable summary of the arbitrage analysis
 */
function buildSummary(
  qualityScore: number,
  breakdown: { primary: number; secondary: number; tertiary: number },
  contradictionCount: number,
  deltas: { isFirstRun: boolean; factCountChange: number; daysSinceLastResearch: number | null }
): string {
  const parts: string[] = [];
  
  // Quality statement
  const qualityTier = qualityScore >= 70 ? "high" : qualityScore >= 40 ? "medium" : "low";
  parts.push(`Source quality: ${qualityScore}/100 (${qualityTier})`);
  parts.push(`Based on ${breakdown.primary} primary, ${breakdown.secondary} secondary, ${breakdown.tertiary} tertiary sources.`);
  
  // Contradictions
  if (contradictionCount > 0) {
    parts.push(`⚠️ ${contradictionCount} contradiction(s) detected - see details above.`);
  } else {
    parts.push(`✅ No contradictions detected.`);
  }
  
  // Deltas
  if (deltas.isFirstRun) {
    parts.push(`📋 First research on this entity - establishing baseline.`);
  } else {
    if (deltas.daysSinceLastResearch !== null) {
      parts.push(`📅 Last researched ${deltas.daysSinceLastResearch} day(s) ago.`);
    }
    if (deltas.factCountChange > 0) {
      parts.push(`📈 ${deltas.factCountChange} new fact(s) since last research.`);
    } else if (deltas.factCountChange < 0) {
      parts.push(`📉 ${Math.abs(deltas.factCountChange)} fewer fact(s) than baseline.`);
    } else {
      parts.push(`📊 Same fact count as baseline.`);
    }
  }
  
  return parts.join(" ");
}

