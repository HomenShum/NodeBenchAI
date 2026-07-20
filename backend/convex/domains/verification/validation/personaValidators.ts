/**
 * Persona Validators - Persona-Specific Validation Rules
 * Deep Agents 3.0 - Validates outputs against persona definition of done
 *
 * Each persona has specific requirements for:
 * - Required fields
 * - Freshness thresholds
 * - Source diversity
 * - Quality standards
 */

import { v } from "convex/values";
import { internalQuery } from "../../../_generated/server";
import { DECAY_CONFIG, QUALITY_CONFIG, type PersonaId } from "../../../config/autonomousConfig";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface PersonaValidationRules {
  personaId: PersonaId;
  freshnessThresholdDays: number;
  requiredFields: string[];
  minSources: number;
  minNextActions: number;
  allowedFactTypes: string[];
  contradictionTolerance: "strict" | "moderate" | "lenient";
  qualityThreshold: number;
}

export interface PersonaValidationResult {
  personaId: string;
  passed: boolean;
  score: number;
  fieldChecks: {
    field: string;
    present: boolean;
    quality?: "high" | "medium" | "low";
  }[];
  freshnessCheck: {
    passed: boolean;
    dataAgeDays: number;
    thresholdDays: number;
  };
  sourceCheck: {
    passed: boolean;
    count: number;
    required: number;
  };
  actionCheck: {
    passed: boolean;
    count: number;
    required: number;
  };
  issues: string[];
}

/* ================================================================== */
/* PERSONA VALIDATION RULES                                            */
/* ================================================================== */

export const PERSONA_VALIDATION_RULES: Record<PersonaId, PersonaValidationRules> = {
  JPM_STARTUP_BANKER: {
    personaId: "JPM_STARTUP_BANKER",
    freshnessThresholdDays: 30,
    requiredFields: ["funding", "hq", "contact", "verdict", "thesis"],
    minSources: 2,
    minNextActions: 3,
    allowedFactTypes: ["funding", "contact", "news", "metric", "team"],
    contradictionTolerance: "strict",
    qualityThreshold: 80,
  },
  EARLY_STAGE_VC: {
    personaId: "EARLY_STAGE_VC",
    freshnessThresholdDays: 60,
    requiredFields: ["thesis", "comps", "tam", "whyNow", "team"],
    minSources: 3,
    minNextActions: 3,
    allowedFactTypes: ["funding", "market", "competitive", "team", "traction"],
    contradictionTolerance: "moderate",
    qualityThreshold: 75,
  },
  CTO_TECH_LEAD: {
    personaId: "CTO_TECH_LEAD",
    freshnessThresholdDays: 7, // Security needs freshness
    requiredFields: ["exposure", "impact", "mitigations", "verification", "timeline"],
    minSources: 2,
    minNextActions: 4,
    allowedFactTypes: ["cve", "dependency", "patch", "architecture", "security"],
    contradictionTolerance: "strict",
    qualityThreshold: 90,
  },
  ACADEMIC_RD: {
    personaId: "ACADEMIC_RD",
    freshnessThresholdDays: 365, // Papers can be older
    requiredFields: ["methodology", "findings", "citations", "gaps", "implications"],
    minSources: 5, // Higher standard for academic
    minNextActions: 2,
    allowedFactTypes: ["paper", "citation", "methodology", "data", "hypothesis"],
    contradictionTolerance: "lenient", // Academic debate is normal
    qualityThreshold: 70,
  },
  PHARMA_BD: {
    personaId: "PHARMA_BD",
    freshnessThresholdDays: 30,
    requiredFields: ["pipeline", "trials", "fdaStatus", "partners", "timeline"],
    minSources: 3,
    minNextActions: 3,
    allowedFactTypes: ["clinical", "regulatory", "partnership", "ip", "market"],
    contradictionTolerance: "strict",
    qualityThreshold: 85,
  },
  MACRO_STRATEGIST: {
    personaId: "MACRO_STRATEGIST",
    freshnessThresholdDays: 14,
    requiredFields: ["thesis", "indicators", "risks", "positioning", "timeline"],
    minSources: 4,
    minNextActions: 3,
    allowedFactTypes: ["economic", "policy", "market", "geopolitical", "trend"],
    contradictionTolerance: "moderate",
    qualityThreshold: 75,
  },
  QUANT_PM: {
    personaId: "QUANT_PM",
    freshnessThresholdDays: 7,
    requiredFields: ["signal", "backtest", "risk", "correlation", "implementation"],
    minSources: 3,
    minNextActions: 3,
    allowedFactTypes: ["data", "signal", "model", "risk", "execution"],
    contradictionTolerance: "strict",
    qualityThreshold: 85,
  },
  CORP_DEV: {
    personaId: "CORP_DEV",
    freshnessThresholdDays: 30,
    requiredFields: ["strategic fit", "synergies", "valuation", "risks", "timeline"],
    minSources: 3,
    minNextActions: 3,
    allowedFactTypes: ["financial", "strategic", "operational", "legal", "integration"],
    contradictionTolerance: "moderate",
    qualityThreshold: 80,
  },
  LP_ALLOCATOR: {
    personaId: "LP_ALLOCATOR",
    freshnessThresholdDays: 60,
    requiredFields: ["track record", "team", "strategy", "terms", "fit"],
    minSources: 3,
    minNextActions: 2,
    allowedFactTypes: ["performance", "team", "strategy", "terms", "reference"],
    contradictionTolerance: "moderate",
    qualityThreshold: 75,
  },
  JOURNALIST: {
    personaId: "JOURNALIST",
    freshnessThresholdDays: 7,
    requiredFields: ["story", "sources", "context", "impact", "quotes"],
    minSources: 2,
    minNextActions: 2,
    allowedFactTypes: ["news", "quote", "context", "timeline", "reaction"],
    contradictionTolerance: "strict",
    qualityThreshold: 80,
  },
  FOUNDER_STRATEGY: {
    personaId: "FOUNDER_STRATEGY",
    freshnessThresholdDays: 30,
    requiredFields: ["competitive position", "market", "strategy", "risks", "opportunities"],
    minSources: 3,
    minNextActions: 3,
    allowedFactTypes: ["competitive", "market", "strategy", "product", "team"],
    contradictionTolerance: "moderate",
    qualityThreshold: 75,
  },
};

/* ================================================================== */
/* VALIDATION FUNCTIONS                                                */
/* ================================================================== */

/**
 * Check if content contains required field
 */
function checkFieldPresence(
  content: string,
  field: string
): { present: boolean; quality: "high" | "medium" | "low" } {
  const contentLower = content.toLowerCase();
  const fieldLower = field.toLowerCase();

  // Check for exact field mention
  if (contentLower.includes(fieldLower)) {
    // Check quality based on context around the field
    const fieldIndex = contentLower.indexOf(fieldLower);
    const contextStart = Math.max(0, fieldIndex - 50);
    const contextEnd = Math.min(contentLower.length, fieldIndex + fieldLower.length + 200);
    const context = contentLower.slice(contextStart, contextEnd);

    // High quality: has specific data
    if (/\$[\d.]+|\d{4}|%|\d+\s*(?:million|billion|employees|users)/i.test(context)) {
      return { present: true, quality: "high" };
    }

    // Medium quality: has some detail
    if (context.length > 100) {
      return { present: true, quality: "medium" };
    }

    return { present: true, quality: "low" };
  }

  // Check for synonyms
  const synonyms: Record<string, string[]> = {
    funding: ["raised", "investment", "capital", "round", "financing"],
    hq: ["headquarters", "based in", "located", "office"],
    contact: ["email", "phone", "reach", "linkedin"],
    thesis: ["investment thesis", "rationale", "why invest"],
    comps: ["competitors", "comparable", "competition", "alternatives"],
    tam: ["market size", "total addressable", "opportunity"],
    whyNow: ["timing", "catalyst", "why now", "inflection"],
    exposure: ["vulnerability", "affected", "impacted", "risk"],
    impact: ["severity", "consequence", "effect", "damage"],
    mitigations: ["fix", "patch", "remediation", "workaround"],
  };

  const fieldSynonyms = synonyms[field] || [];
  for (const synonym of fieldSynonyms) {
    if (contentLower.includes(synonym.toLowerCase())) {
      return { present: true, quality: "medium" };
    }
  }

  return { present: false, quality: "low" };
}

/**
 * Count next actions in content
 */
function countNextActions(content: string): number {
  // Look for action patterns
  const actionPatterns = [
    /\d+\.\s*[A-Z]/g, // Numbered list: "1. Review..."
    /[-•]\s*[A-Z]/g, // Bullet points: "- Contact..."
    /\b(?:should|need to|must|recommend|suggest|action|next step)[^.]+/gi,
  ];

  let count = 0;
  for (const pattern of actionPatterns) {
    const matches = content.match(pattern) || [];
    count += matches.length;
  }

  return Math.min(count, 10); // Cap at 10
}

/**
 * Validate content against persona requirements
 */
export function validateForPersona(
  content: string,
  personaId: PersonaId,
  metadata: {
    dataAgeDays?: number;
    sourceCount?: number;
    sources?: Array<{ name: string; url: string }>;
  }
): PersonaValidationResult {
  const rules = PERSONA_VALIDATION_RULES[personaId];
  if (!rules) {
    return {
      personaId,
      passed: false,
      score: 0,
      fieldChecks: [],
      freshnessCheck: { passed: false, dataAgeDays: 0, thresholdDays: 30 },
      sourceCheck: { passed: false, count: 0, required: 2 },
      actionCheck: { passed: false, count: 0, required: 2 },
      issues: [`Unknown persona: ${personaId}`],
    };
  }

  const issues: string[] = [];
  let score = 100;

  // Field checks
  const fieldChecks = rules.requiredFields.map((field) => {
    const result = checkFieldPresence(content, field);
    if (!result.present) {
      score -= 10;
      issues.push(`Missing required field: ${field}`);
    } else if (result.quality === "low") {
      score -= 3;
    }
    return { field, ...result };
  });

  // Freshness check
  const dataAgeDays = metadata.dataAgeDays ?? 0;
  const freshnessCheck = {
    passed: dataAgeDays <= rules.freshnessThresholdDays,
    dataAgeDays,
    thresholdDays: rules.freshnessThresholdDays,
  };
  if (!freshnessCheck.passed) {
    score -= 15;
    issues.push(
      `Data too old: ${dataAgeDays} days (max ${rules.freshnessThresholdDays} for ${personaId})`
    );
  }

  // Source check
  const sourceCount = metadata.sourceCount ?? metadata.sources?.length ?? 0;
  const sourceCheck = {
    passed: sourceCount >= rules.minSources,
    count: sourceCount,
    required: rules.minSources,
  };
  if (!sourceCheck.passed) {
    score -= 10;
    issues.push(`Insufficient sources: ${sourceCount}/${rules.minSources}`);
  }

  // Action check
  const actionCount = countNextActions(content);
  const actionCheck = {
    passed: actionCount >= rules.minNextActions,
    count: actionCount,
    required: rules.minNextActions,
  };
  if (!actionCheck.passed) {
    score -= 5;
    issues.push(`Insufficient next actions: ${actionCount}/${rules.minNextActions}`);
  }

  // Determine pass/fail
  const passed = score >= rules.qualityThreshold && issues.length <= 2;

  return {
    personaId,
    passed,
    score: Math.max(0, score),
    fieldChecks,
    freshnessCheck,
    sourceCheck,
    actionCheck,
    issues,
  };
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get validation rules for a persona
 */
export const getPersonaRules = internalQuery({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<PersonaValidationRules | null> => {
    return PERSONA_VALIDATION_RULES[personaId as PersonaId] || null;
  },
});

/**
 * Get all persona validation rules
 */
export const getAllPersonaRules = internalQuery({
  args: {},
  handler: async (ctx): Promise<PersonaValidationRules[]> => {
    return Object.values(PERSONA_VALIDATION_RULES);
  },
});

/**
 * Get strictest personas for an entity type
 */
export const getStrictestPersonas = internalQuery({
  args: { entityType: v.optional(v.string()) },
  handler: async (ctx, { entityType }): Promise<PersonaId[]> => {
    // Return personas sorted by quality threshold (highest first)
    const sorted = Object.entries(PERSONA_VALIDATION_RULES)
      .sort(([, a], [, b]) => b.qualityThreshold - a.qualityThreshold)
      .map(([id]) => id as PersonaId);

    return sorted.slice(0, 5);
  },
});
