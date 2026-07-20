/**
 * Autonomous Agent Ecosystem Configuration
 * Deep Agents 3.0 - Zero-Human-Input Continuous Intelligence Platform
 *
 * This file contains all configuration constants for the autonomous agent ecosystem.
 * Modify these values to tune system behavior without code changes.
 */

/* ================================================================== */
/* RESEARCH CONFIGURATION                                              */
/* ================================================================== */

export const RESEARCH_CONFIG = {
  /** Maximum concurrent research tasks */
  maxConcurrentResearch: 10,

  /** Research execution timeout (5 minutes) */
  researchTimeoutMs: 300_000,

  /** Maximum retry attempts for failed research */
  maxRetries: 3,

  /** Exponential backoff delays for retries (ms) */
  retryBackoffMs: [5_000, 30_000, 120_000] as const,

  /** Base priority for new tasks (0-100) */
  basePriority: 50,

  /** Priority boosts for different triggers */
  priorityBoosts: {
    urgencyCritical: 40,
    urgencyHigh: 25,
    urgencyMedium: 10,
    urgencyLow: 0,
    stale30Days: 15,
    stale60Days: 25,
    perWatchlistUser: 5,
    maxWatchlistBoost: 20,
    trendingMultiplier: 1.5,
  },
} as const;

/* ================================================================== */
/* PUBLISHING CONFIGURATION                                            */
/* ================================================================== */

export const PUBLISHING_CONFIG = {
  /** Maximum delivery attempts per channel */
  maxDeliveryAttempts: 5,

  /** Delivery timeout per channel (30 seconds) */
  deliveryTimeoutMs: 30_000,

  /** Batch size for parallel deliveries */
  batchSize: 50,

  /** Channel-specific rate limits (per minute) */
  rateLimits: {
    ntfy: 60,
    email: 30,
    sms: 10,
    slack: 60,
    rss: 100,
    ui: 1000, // Effectively unlimited
  },

  /** Format budgets */
  formatBudgets: {
    ntfy: {
      maxTitle: 80,
      maxMessage: 500,
      actIIIReserve: 100, // Reserved for next actions
    },
    email: {
      maxSubject: 150,
      maxSummary: 1000,
    },
    sms: {
      maxMessage: 160, // Single SMS segment
    },
    slack: {
      maxMessage: 3000,
    },
  },
} as const;

/* ================================================================== */
/* QUALITY & VALIDATION CONFIGURATION                                  */
/* ================================================================== */

export const QUALITY_CONFIG = {
  /** Minimum quality score to publish (0-100) */
  minQualityScore: 70,

  /** Maximum allowed unresolved contradictions */
  maxContradictions: 2,

  /** Minimum required sources per claim */
  minSources: 2,

  /** Validation score penalties */
  penalties: {
    blockerIssue: 30,
    warningIssue: 10,
    infoIssue: 0,
    missingSource: 15,
    staleData: 10,
    contradictionFound: 20,
  },

  /** Validation thresholds */
  thresholds: {
    confidenceHigh: 0.8,
    confidenceMedium: 0.5,
    confidenceLow: 0.3,
    freshnessVerified: 0.9,
    freshnessAcceptable: 0.7,
  },
} as const;

/* ================================================================== */
/* ENTITY DECAY CONFIGURATION                                          */
/* ================================================================== */

export const DECAY_CONFIG = {
  /** Default half-life for entity decay (days) */
  decayHalfLifeDays: 14,

  /** Staleness thresholds */
  staleThreshold: 0.5, // Below this = stale
  criticalThreshold: 0.2, // Below this = critical

  /** Entity-type specific half-lives (days) */
  entityTypeHalfLives: {
    company: 14,
    person: 30,
    topic: 7,
    product: 14,
    event: 3,
  },

  /** Persona-specific freshness requirements (days) */
  personaFreshnessRequirements: {
    JPM_STARTUP_BANKER: 30,
    EARLY_STAGE_VC: 60,
    CTO_TECH_LEAD: 7, // Security needs freshness
    ACADEMIC_RD: 365, // Papers can be older
    PHARMA_BD: 30,
    MACRO_STRATEGIST: 14,
    QUANT_PM: 7,
    CORP_DEV: 30,
    LP_ALLOCATOR: 60,
    JOURNALIST: 7,
  },
} as const;

/* ================================================================== */
/* BUDGET CONFIGURATION                                                */
/* ================================================================== */

export const BUDGET_CONFIG = {
  /** Global daily limits */
  dailyTokenLimit: 2_000_000,
  dailyCostLimitUsd: 20.0,

  /** Per-persona daily limits */
  personaBudgets: {
    JPM_STARTUP_BANKER: { tokens: 500_000, costUsd: 5.0 },
    EARLY_STAGE_VC: { tokens: 400_000, costUsd: 4.0 },
    CTO_TECH_LEAD: { tokens: 300_000, costUsd: 3.0 },
    ACADEMIC_RD: { tokens: 300_000, costUsd: 3.0 },
    PHARMA_BD: { tokens: 400_000, costUsd: 4.0 },
    MACRO_STRATEGIST: { tokens: 300_000, costUsd: 3.0 },
    QUANT_PM: { tokens: 300_000, costUsd: 3.0 },
    CORP_DEV: { tokens: 400_000, costUsd: 4.0 },
    LP_ALLOCATOR: { tokens: 300_000, costUsd: 3.0 },
    JOURNALIST: { tokens: 300_000, costUsd: 3.0 },
  },

  /** Cost per 1K tokens (estimate) */
  costPer1kTokens: {
    gpt4: 0.03,
    claude: 0.025,
    gemini: 0.001,
  },
} as const;

/* ================================================================== */
/* ENGAGEMENT CONFIGURATION                                            */
/* ================================================================== */

export const ENGAGEMENT_CONFIG = {
  /** Default quiet hours (local time) */
  quietHoursDefault: { start: "22:00", end: "07:00" },

  /** Minimum events for optimization analysis */
  minEngagementForOptimization: 10,

  /** Engagement window for trending detection (hours) */
  trendingWindowHours: 24,

  /** Spike threshold for trending (multiplier over baseline) */
  trendingSpikeThreshold: 3,

  /** Engagement decay half-life (days) */
  engagementDecayDays: 7,

  /** Dismiss rate threshold to reduce frequency */
  dismissThreshold: 0.3,

  /** Maximum daily messages per channel */
  maxDailyMessages: 10,
} as const;

/* ================================================================== */
/* HEALTH & MONITORING CONFIGURATION                                   */
/* ================================================================== */

export const HEALTH_CONFIG = {
  /** Health check interval (ms). This is also the deployed cron cadence. */
  healthCheckIntervalMs: 5 * 60_000,

  /** A measurement is stale after this many missed health-check intervals. */
  healthCheckStaleMultiplier: 3,

  /** Error rate thresholds */
  errorRateCritical: 0.05, // 5%
  errorRateWarning: 0.01, // 1%

  /** Latency thresholds (ms) */
  latencyP99Critical: 30_000, // 30s
  latencyP99Warning: 10_000, // 10s

  /** Queue depth thresholds */
  queueDepthWarning: 100,
  queueDepthCritical: 500,

  /** Component list for monitoring */
  monitoredComponents: [
    "signal_ingestion",
    "research_queue",
    "publishing",
    "delivery",
    "entity_lifecycle",
    "validation",
    "budget",
    "database",
  ] as const,
} as const;

/* ================================================================== */
/* SIGNAL INGESTION CONFIGURATION                                      */
/* ================================================================== */

export const SIGNAL_CONFIG = {
  /** Signal processing batch size */
  batchSize: 50,

  /** Signal TTL (7 days) */
  signalTtlMs: 7 * 24 * 60 * 60 * 1000,

  /** Deduplication window (24 hours) */
  deduplicationWindowMs: 24 * 60 * 60 * 1000,

  /** NER confidence threshold */
  nerConfidenceThreshold: 0.7,

  /** Maximum entities to extract per signal */
  maxEntitiesPerSignal: 10,

  /** Urgency keywords (lowercase) */
  urgencyKeywords: {
    critical: [
      "breaking",
      "urgent",
      "emergency",
      "cve-",
      "security breach",
      "data leak",
    ],
    high: [
      "series a",
      "series b",
      "ipo",
      "acquisition",
      "merger",
      "fda approval",
    ],
    medium: ["funding", "partnership", "launch", "announcement", "update"],
    low: ["blog", "opinion", "analysis", "review", "study"],
  },

  /** Research depth keywords */
  depthKeywords: {
    deep: [
      "comprehensive",
      "detailed",
      "in-depth",
      "analysis",
      "investigation",
    ],
    standard: ["report", "news", "update", "announcement"],
    shallow: ["brief", "quick", "summary", "tldr"],
  },
} as const;

/* ================================================================== */
/* PERSONA CONFIGURATION                                               */
/* ================================================================== */

export const PERSONA_CONFIG = {
  /** All available persona IDs */
  personaIds: [
    "JPM_STARTUP_BANKER",
    "EARLY_STAGE_VC",
    "CTO_TECH_LEAD",
    "ACADEMIC_RD",
    "PHARMA_BD",
    "MACRO_STRATEGIST",
    "QUANT_PM",
    "CORP_DEV",
    "LP_ALLOCATOR",
    "JOURNALIST",
    "FOUNDER_STRATEGY",
  ] as const,

  /** Default persona for generic queries */
  defaultPersona: "JPM_STARTUP_BANKER",

  /** Persona sector mappings */
  sectorMappings: {
    JPM_STARTUP_BANKER: ["biotech", "fintech", "healthtech", "climatetech"],
    EARLY_STAGE_VC: ["saas", "ai", "consumer", "enterprise"],
    CTO_TECH_LEAD: ["security", "infrastructure", "devtools"],
    ACADEMIC_RD: ["research", "papers", "methodology"],
    PHARMA_BD: ["biotech", "pharma", "clinical"],
    MACRO_STRATEGIST: ["markets", "economics", "policy"],
    QUANT_PM: ["trading", "data", "algorithms"],
    CORP_DEV: ["m&a", "partnerships", "strategy"],
    LP_ALLOCATOR: ["funds", "allocation", "performance"],
    JOURNALIST: ["news", "media", "coverage"],
    FOUNDER_STRATEGY: ["startups", "fundraising", "growth", "competition"],
  },

  /** Persona research cadences */
  researchCadence: {
    JPM_STARTUP_BANKER: "daily",
    EARLY_STAGE_VC: "daily",
    CTO_TECH_LEAD: "continuous", // Security needs real-time
    ACADEMIC_RD: "weekly",
    PHARMA_BD: "daily",
    MACRO_STRATEGIST: "daily",
    QUANT_PM: "continuous",
    CORP_DEV: "daily",
    LP_ALLOCATOR: "weekly",
    JOURNALIST: "continuous",
    FOUNDER_STRATEGY: "daily",
  },
} as const;

/* ================================================================== */
/* CRON SCHEDULE CONFIGURATION                                         */
/* ================================================================== */

export const CRON_CONFIG = {
  /** Research scheduler tick (every minute) */
  researchSchedulerCron: "* * * * *",

  /** Signal ingestion tick (every 5 minutes) */
  signalIngestionCron: "*/5 * * * *",

  /** Entity decay check (daily at midnight UTC) */
  decayCheckCron: "0 0 * * *",

  /** Delivery queue processor (every minute) */
  deliveryQueueCron: "* * * * *",

  /** Health check (every 5 minutes) */
  healthCheckCron: "*/5 * * * *",

  /** Budget reset (daily at midnight UTC) */
  budgetResetCron: "0 0 * * *",

  /** Engagement optimization (daily at 2am UTC) */
  engagementOptimizationCron: "0 2 * * *",

  /** Cleanup old data (daily at 3am UTC) */
  cleanupCron: "0 3 * * *",

  /** Morning brief (6am UTC) */
  morningBriefCron: "0 6 * * *",

  /** Evening summary (6pm UTC) */
  eveningSummaryCron: "0 18 * * *",
} as const;

/* ================================================================== */
/* TYPE EXPORTS                                                        */
/* ================================================================== */

export type PersonaId = (typeof PERSONA_CONFIG.personaIds)[number];
export type MonitoredComponent =
  (typeof HEALTH_CONFIG.monitoredComponents)[number];
export type ResearchCadence =
  (typeof PERSONA_CONFIG.researchCadence)[keyof typeof PERSONA_CONFIG.researchCadence];

/** Signal urgency levels */
export type SignalUrgency = "critical" | "high" | "medium" | "low";

/** Research depth levels */
export type ResearchDepth = "shallow" | "standard" | "deep";

/** Entity types */
export type EntityType = "company" | "person" | "topic" | "product" | "event";

/** Channel types */
export type ChannelType = "ui" | "ntfy" | "email" | "sms" | "slack" | "rss";

/** Publishing format types */
export type PublishingFormat = "full" | "summary" | "alert" | "digest";

/** Validation issue types */
export type ValidationIssueType =
  | "factual"
  | "freshness"
  | "completeness"
  | "grounding"
  | "contradiction";

/** Validation severity levels */
export type ValidationSeverity = "blocker" | "warning" | "info";

/** Contradiction nature types */
export type ContradictionNature =
  | "direct"
  | "temporal"
  | "numerical"
  | "semantic";

/** Health status levels */
export type HealthStatus = "healthy" | "degraded" | "down";

/** Healing action types */
export type HealingAction =
  | "restart"
  | "scale"
  | "fallback"
  | "isolate"
  | "alert";

/* ================================================================== */
/* FREE MODEL CONFIGURATION                                            */
/* Deep Agents 3.0 - Zero-cost autonomous operations                   */
/* ================================================================== */

export const FREE_MODEL_CONFIG = {
  /** Prefer free models for all autonomous operations */
  preferFreeModels: true,

  /** Model discovery interval (6 hours) */
  discoveryIntervalMs: 6 * 60 * 60 * 1000,

  /** Model evaluation interval (1 hour) */
  evaluationIntervalMs: 60 * 60 * 1000,

  /** Minimum context length for autonomous tasks */
  minContextLength: 8192,

  /** Minimum reliability score for active status (0-100) */
  minReliabilityScore: 60,

  /** Maximum evaluations per tick (rate limiting) */
  maxEvaluationsPerTick: 5,

  /** Model call timeout (60 seconds) */
  modelTimeoutMs: 60_000,

  /** Maximum retries before falling back to paid model */
  maxFreeModelRetries: 3,

  /** Known good free models (hardcoded fallback) */
  knownFreeModels: [
    "qwen/qwen3-coder:free",
    "google/gemma-2-9b-it:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "huggingfaceh4/zephyr-7b-beta:free",
  ] as const,

  /** Paid model fallback chain (last resort) */
  paidFallbackChain: [
    "gemini-3-flash-preview",
    "deepseek-v3.2",       // $0.25/M input - very cheap
    "qwen3-235b",          // $0.18/M input - cheap
    "gpt-5.4-mini",
      "claude-haiku-4.5",
  ] as const,

  /** Task requirements for model selection */
  taskRequirements: {
    research: { minContext: 16000, toolUse: false },
    synthesis: { minContext: 32000, toolUse: false },
    publishing: { minContext: 8000, toolUse: false },
    validation: { minContext: 16000, toolUse: false },
    agentLoop: { minContext: 32000, toolUse: true },
    signalProcessing: { minContext: 8000, toolUse: false },
  },

  /** Usage retention (keep 7 days of usage data) */
  usageRetentionDays: 7,

  /** Evaluation retention (keep 30 days of eval history) */
  evaluationRetentionDays: 30,
} as const;

/** Autonomous task types */
export type AutonomousTaskType = keyof typeof FREE_MODEL_CONFIG.taskRequirements;
