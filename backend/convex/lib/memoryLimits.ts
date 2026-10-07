// convex/lib/memoryLimits.ts
// Memory system limits and thresholds for GAM

/**
 * Memory limits for the General Agentic Memory (GAM) system.
 * All thresholds use boolean logic - values either pass or fail.
 */
export const MEMORY_LIMITS = {
  // ═══════════════════════════════════════════════════════════════════
  // PER-USER LIMITS
  // ═══════════════════════════════════════════════════════════════════
  maxEntityContextsPerUser: 200,
  maxActiveEntities: 100,           // Accessed in last 30 days
  maxThemeMemoriesPerUser: 50,

  // ═══════════════════════════════════════════════════════════════════
  // PER-ENTITY LIMITS
  // ═══════════════════════════════════════════════════════════════════
  maxStructuredFactsPerEntity: 100,
  maxKeyFactsPerEntity: 50,         // String keyFacts array
  maxNarrativesPerEntity: 10,
  maxHeuristicsPerEntity: 20,
  maxLinkedDocsPerEntity: 50,

  // ═══════════════════════════════════════════════════════════════════
  // PER-THEME LIMITS
  // ═══════════════════════════════════════════════════════════════════
  maxFactsPerTheme: 50,

  // ═══════════════════════════════════════════════════════════════════
  // STALENESS THRESHOLDS (in days)
  // ═══════════════════════════════════════════════════════════════════
  entityStaleDays: 7,
  themeStaleDays: 30,

  // ═══════════════════════════════════════════════════════════════════
  // GC THRESHOLDS (in days)
  // ═══════════════════════════════════════════════════════════════════
  archiveAfterDays: 90,             // Soft delete after 90 days no access
  deleteAfterDays: 365,             // Hard delete after 1 year no access

  // ═══════════════════════════════════════════════════════════════════
  // RESEARCH JOB RATE LIMITS
  // ═══════════════════════════════════════════════════════════════════
  maxJobsPerUserPerHour: 10,
  maxConcurrentJobsPerUser: 3,
  cooldownPerEntityHours: 12,
};

/**
 * Boolean quality thresholds.
 * Memory quality is evaluated as PASS/FAIL for each criterion.
 */
export const QUALITY_THRESHOLDS = {
  // Minimum facts required for "sufficient coverage"
  minFactsForCoverage: 5,
  
  // Maximum age (days) for "recent research"
  maxDaysForFresh: 7,
  
  // Minimum sources for "verified"
  minSourcesForVerified: 2,
  
  // Minimum confidence for a fact to be considered "high confidence"
  // Note: This is the only numeric threshold - facts below this are FAIL
  minFactConfidence: 0.7,
  
  // Maximum unresolved conflicts for "clean" memory
  maxUnresolvedConflicts: 0,
};

/**
 * Research depth definitions
 */
export const RESEARCH_DEPTH = {
  shallow: {
    description: "Basic LinkUp search, summary only",
    maxFacts: 10,
    includesNarratives: false,
    includesHeuristics: false,
  },
  standard: {
    description: "Full enrichment with structured facts",
    maxFacts: 50,
    includesNarratives: true,
    includesHeuristics: false,
  },
  deep: {
    description: "Complete analysis with narratives and heuristics",
    maxFacts: 100,
    includesNarratives: true,
    includesHeuristics: true,
  },
} as const;

export type ResearchDepth = keyof typeof RESEARCH_DEPTH;
