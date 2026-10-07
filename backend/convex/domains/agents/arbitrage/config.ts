/**
 * Arbitrage Agent Configuration
 * 
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 * Receipts-first research with contradiction detection and delta tracking
 */

import { z } from "zod";

export const ARBITRAGE_AGENT_CONFIG = {
  name: "ArbitrageAgent",
  description: "Receipts-first research agent with contradiction detection, source quality ranking, and delta tracking",
  version: "2.0.0",
};

// Source types with trust hierarchy
export const SOURCE_TYPES = {
  PRIMARY: "primary",      // SEC filings, press releases, transcripts
  SECONDARY_REPUTABLE: "secondary_reputable", // Reuters, Bloomberg, WSJ, FT
  SECONDARY_GENERAL: "secondary_general",     // TechCrunch, VentureBeat
  TERTIARY: "tertiary",    // Blogs, social media
} as const;

export type SourceType = typeof SOURCE_TYPES[keyof typeof SOURCE_TYPES];

// Source quality base scores
export const SOURCE_QUALITY_SCORES: Record<SourceType, number> = {
  primary: 95,
  secondary_reputable: 70,
  secondary_general: 50,
  tertiary: 30,
};

// Quality tiers
export const QUALITY_TIERS = {
  EXCELLENT: { min: 80, max: 100, label: "excellent" },
  GOOD: { min: 60, max: 79, label: "good" },
  FAIR: { min: 40, max: 59, label: "fair" },
  POOR: { min: 0, max: 39, label: "poor" },
} as const;

// Contradiction severity levels
export const CONTRADICTION_SEVERITY = {
  HIGH: "high",     // Direct numeric/factual contradiction
  MEDIUM: "medium", // Conflicting interpretations
  LOW: "low",       // Nuanced differences
} as const;

// Delta types
export const DELTA_TYPES = {
  FACT_ADDED: "fact_added",
  FACT_REMOVED: "fact_removed",
  FACT_MODIFIED: "fact_modified",
  CONFLICT_DETECTED: "conflict_detected",
  CONFLICT_RESOLVED: "conflict_resolved",
  SOURCE_404: "source_404",
  SOURCE_CHANGED: "source_changed",
} as const;

// Schemas
export const contradictionSchema = z.object({
  facts: z.array(z.object({
    claim: z.string(),
    source: z.string(),
    sourceType: z.enum(["primary", "secondary_reputable", "secondary_general", "tertiary"]),
    timestamp: z.number().optional(),
  })),
});

export const sourceQualitySchema = z.object({
  sources: z.array(z.object({
    url: z.string(),
    name: z.string(),
    type: z.enum(["primary", "secondary_reputable", "secondary_general", "tertiary"]),
    timestamp: z.number().optional(),
  })),
});

export const deltaDetectionSchema = z.object({
  canonicalKey: z.string().describe("Entity key like 'company:TSLA'"),
  currentFacts: z.array(z.object({
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    confidence: z.number().optional(),
  })),
});

export const sourceHealthSchema = z.object({
  canonicalKey: z.string().describe("Entity key to check sources for"),
  urls: z.array(z.string()).optional().describe("Specific URLs to check (or all from entity)"),
});

// Types
export type ContradictionInput = z.infer<typeof contradictionSchema>;
export type SourceQualityInput = z.infer<typeof sourceQualitySchema>;
export type DeltaDetectionInput = z.infer<typeof deltaDetectionSchema>;
export type SourceHealthInput = z.infer<typeof sourceHealthSchema>;

// Generate dynamic system prompt with current date
export function getArbitrageSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { 
    weekday: "long", 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });
  
  return `You are the Arbitrage Agent - a ruthless-but-trustworthy opportunity scout that exploits information mismatches across sources, time, and coverage.

## Core Promise
"Find the gap between narrative and reality—and show exactly where it comes from."

## Your Capabilities
1. **Source Arbitrage**: Detect contradictions across sources
2. **Time Arbitrage**: Track what changed since last check
3. **Coverage Arbitrage**: Find hidden primary sources not in mainstream coverage
4. **Consensus Arbitrage**: Compare narrative vs SEC/official docs

## Quality Hierarchy (ALWAYS ENFORCE)
- **PRIMARY** (95 pts): SEC filings, press releases, transcripts
- **SECONDARY REPUTABLE** (70 pts): Reuters, Bloomberg, WSJ, FT
- **SECONDARY GENERAL** (50 pts): TechCrunch, VentureBeat
- **TERTIARY** (30 pts): Blogs, social media

When sources conflict, PRIMARY ALWAYS wins over SECONDARY.

## Workflow
1. **queryMemory** first - establish baseline
2. **Gather evidence** - parallel delegation to SEC, Media, Entity agents
3. **detectContradictions** - compare all sources
4. **compareToBaseline** - detect deltas since last check
5. **rankSourceQuality** - score all sources
6. **Generate report** - with verification status for each claim

## Output Format
Every claim MUST have:
- Verification status: ✅ verified | ⚠️ partial | ❓ unverified | ❌ contradicted
- Source quality score (0-100)
- Primary source citation if available

## Current Date
Today is ${dateStr}. Use this for all recency calculations.
`;
}

export const ARBITRAGE_SYSTEM_PROMPT = getArbitrageSystemPrompt();
