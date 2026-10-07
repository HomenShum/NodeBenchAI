/**
 * Delta Detection Tool
 * 
 * Tracks changes since last arbitrage check.
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { DELTA_TYPES } from "../config";

// Output types
export interface Delta {
  type: keyof typeof DELTA_TYPES;
  factSignature?: string;
  description: string;
  severity: "high" | "medium" | "low";
  timestamp: number;
}

export interface DeltaResult {
  isFirstRun: boolean;
  deltas: Delta[];
  added: number;
  removed: number;
  modified: number;
  summary: string;
}

// High-severity predicates (funding, valuation, etc.)
const HIGH_SEVERITY_PREDICATES = [
  "raised", "funding", "valuation", "acquisition", "lawsuit", "ipo", "bankruptcy",
];

const MEDIUM_SEVERITY_PREDICATES = [
  "revenue", "product", "hiring", "layoff", "partnership", "launch",
];

/**
 * Generate fact signature for comparison
 */
function generateSignature(fact: { subject: string; predicate: string; object: string }): string {
  return `${fact.subject.toLowerCase()}::${fact.predicate.toLowerCase()}::${fact.object.toLowerCase()}`;
}

/**
 * Determine severity based on predicate
 */
function getSeverity(predicate: string): "high" | "medium" | "low" {
  const lowerPred = predicate.toLowerCase();
  if (HIGH_SEVERITY_PREDICATES.some(p => lowerPred.includes(p))) return "high";
  if (MEDIUM_SEVERITY_PREDICATES.some(p => lowerPred.includes(p))) return "medium";
  return "low";
}

/**
 * Detect deltas between baseline and current facts
 */
export async function executeDeltaDetection(
  ctx: ActionCtx,
  args: {
    canonicalKey: string;
    currentFacts: Array<{
      subject: string;
      predicate: string;
      object: string;
      confidence?: number;
    }>;
  }
): Promise<DeltaResult> {
  console.log(`[deltaDetection] Comparing facts for: ${args.canonicalKey}`);
  const now = Date.now();

  // Try to load baseline from entityContexts
  let baselineFacts: Array<{ subject: string; predicate: string; object: string }> = [];
  let isFirstRun = true;

  try {
    // Query memory for baseline
    const entities = await ctx.runQuery(api.domains.knowledge.entityContexts.getByCanonicalKey, {
      canonicalKey: args.canonicalKey,
    });

    if (entities && entities.structuredFacts && entities.structuredFacts.length > 0) {
      isFirstRun = false;
      baselineFacts = entities.structuredFacts.map((f: any) => ({
        subject: f.subject || args.canonicalKey,
        predicate: f.predicate || "has",
        object: f.object || f.fact || "",
      }));
      console.log(`[deltaDetection] Found baseline with ${baselineFacts.length} facts`);
    }
  } catch (error) {
    console.log(`[deltaDetection] No baseline found, treating as first run`);
  }

  if (isFirstRun) {
    // All current facts are "new"
    const deltas: Delta[] = args.currentFacts.map(fact => ({
      type: "FACT_ADDED" as keyof typeof DELTA_TYPES,
      factSignature: generateSignature(fact),
      description: `New: ${fact.subject} ${fact.predicate} ${fact.object}`,
      severity: getSeverity(fact.predicate),
      timestamp: now,
    }));

    return {
      isFirstRun: true,
      deltas,
      added: args.currentFacts.length,
      removed: 0,
      modified: 0,
      summary: `First analysis for ${args.canonicalKey}. ${args.currentFacts.length} facts recorded as baseline.`,
    };
  }

  // Build signature maps
  const baselineMap = new Map<string, typeof baselineFacts[0]>();
  baselineFacts.forEach(fact => {
    baselineMap.set(generateSignature(fact), fact);
  });

  const currentMap = new Map<string, typeof args.currentFacts[0]>();
  args.currentFacts.forEach(fact => {
    currentMap.set(generateSignature(fact), fact);
  });

  const deltas: Delta[] = [];

  // Find added facts (in current, not in baseline)
  for (const [sig, fact] of currentMap) {
    if (!baselineMap.has(sig)) {
      deltas.push({
        type: "FACT_ADDED",
        factSignature: sig,
        description: `Added: ${fact.subject} ${fact.predicate} ${fact.object}`,
        severity: getSeverity(fact.predicate),
        timestamp: now,
      });
    }
  }

  // Find removed facts (in baseline, not in current)
  for (const [sig, fact] of baselineMap) {
    if (!currentMap.has(sig)) {
      deltas.push({
        type: "FACT_REMOVED",
        factSignature: sig,
        description: `Removed: ${fact.subject} ${fact.predicate} ${fact.object}`,
        severity: getSeverity(fact.predicate),
        timestamp: now,
      });
    }
  }

  const added = deltas.filter(d => d.type === "FACT_ADDED").length;
  const removed = deltas.filter(d => d.type === "FACT_REMOVED").length;
  const modified = 0; // Future: detect confidence changes

  const summary = `Delta analysis: +${added} added, -${removed} removed, ~${modified} modified. High priority: ${deltas.filter(d => d.severity === "high").length}`;

  console.log(`[deltaDetection] ${summary}`);

  return {
    isFirstRun: false,
    deltas,
    added,
    removed,
    modified,
    summary,
  };
}

// Tool definition for AI SDK
export const deltaDetectionToolDefinition = {
  description: `Detect changes since last arbitrage analysis for an entity.
Compares current facts to stored baseline in entityContexts.
Returns:
- Added facts (new since last check)
- Removed facts (no longer present)
- Severity classification (high for funding/valuation, medium for product/revenue, low for other)

Use for "What's new with X?" queries and weekly digest generation.`,
  inputSchema: z.object({
    canonicalKey: z.string().describe("Entity key like 'company:TSLA'"),
    currentFacts: z.array(z.object({
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
      confidence: z.number().optional(),
    })),
  }),
};
