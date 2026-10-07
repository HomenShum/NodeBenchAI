/**
 * Prompt Injection Containment Layer
 *
 * Prevents malicious content from steering agents.
 * Sanitizes user-generated content before agent consumption.
 *
 * Attack vectors defended against:
 * - Direct instruction injection ("ignore previous instructions")
 * - Delimiter injection (<|im_start|>, [INST])
 * - Jailbreak attempts
 * - Context manipulation
 * - Instruction smuggling via formatting
 *
 * Industry standard patterns:
 * - OWASP LLM Top 10 (LLM01: Prompt Injection)
 * - Microsoft Azure AI Content Safety
 * - OpenAI moderation endpoint
 *
 * @module domains/narrative/guards/injectionContainment
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
} from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SanitizationResult {
  sanitized: string;
  modified: boolean;
  detections: InjectionDetection[];
  threatLevel: "none" | "low" | "medium" | "high" | "critical";
  blocked: boolean;
}

export interface InjectionDetection {
  pattern: string;
  category: InjectionCategory;
  severity: "low" | "medium" | "high" | "critical";
  location: { start: number; end: number };
  redacted: boolean;
}

export type InjectionCategory =
  | "instruction_override"
  | "delimiter_injection"
  | "jailbreak_attempt"
  | "context_manipulation"
  | "formatting_smuggle"
  | "role_hijack"
  | "output_manipulation";

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Instruction override patterns - attempts to change agent behavior.
 */
const INSTRUCTION_OVERRIDE_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}> = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/gi,
    severity: "critical",
    description: "Direct instruction override attempt",
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)/gi,
    severity: "critical",
    description: "Disregard instruction attempt",
  },
  {
    pattern: /forget\s+(everything|all|what)\s+(you|i)\s+(said|told|wrote)/gi,
    severity: "high",
    description: "Memory manipulation attempt",
  },
  {
    pattern: /you\s+are\s+now\s+(a|an|the)/gi,
    severity: "high",
    description: "Role reassignment attempt",
  },
  {
    pattern: /act\s+as\s+(if\s+)?(you\s+)?(are|were)\s+(a|an)/gi,
    severity: "medium",
    description: "Role play injection",
  },
  {
    pattern: /pretend\s+(to\s+be|you\s+are)/gi,
    severity: "medium",
    description: "Pretend role injection",
  },
  {
    pattern: /new\s+instructions?\s*:/gi,
    severity: "critical",
    description: "New instruction injection",
  },
  {
    pattern: /system\s*:\s*/gi,
    severity: "critical",
    description: "System prompt injection",
  },
  {
    pattern: /override\s+(mode|settings?|config)/gi,
    severity: "high",
    description: "Override command injection",
  },
];

/**
 * Delimiter injection patterns - attempts to break out of content boundaries.
 */
const DELIMITER_INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}> = [
  {
    pattern: /<\|im_start\|>/gi,
    severity: "critical",
    description: "ChatML delimiter injection",
  },
  {
    pattern: /<\|im_end\|>/gi,
    severity: "critical",
    description: "ChatML end delimiter injection",
  },
  {
    pattern: /\[INST\]/gi,
    severity: "critical",
    description: "Llama instruction delimiter",
  },
  {
    pattern: /\[\/INST\]/gi,
    severity: "critical",
    description: "Llama instruction end delimiter",
  },
  {
    pattern: /<<SYS>>/gi,
    severity: "critical",
    description: "Llama system delimiter",
  },
  {
    pattern: /<\|system\|>/gi,
    severity: "critical",
    description: "System delimiter injection",
  },
  {
    pattern: /<\|user\|>/gi,
    severity: "high",
    description: "User delimiter injection",
  },
  {
    pattern: /<\|assistant\|>/gi,
    severity: "high",
    description: "Assistant delimiter injection",
  },
  {
    pattern: /```system/gi,
    severity: "medium",
    description: "Code block system injection",
  },
  {
    pattern: /Human:|Assistant:|System:/gi,
    severity: "medium",
    description: "Anthropic-style delimiter",
  },
];

/**
 * Jailbreak patterns - attempts to bypass safety.
 */
const JAILBREAK_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}> = [
  {
    pattern: /DAN\s*(mode)?/gi,
    severity: "critical",
    description: "DAN jailbreak attempt",
  },
  {
    pattern: /jailbreak/gi,
    severity: "high",
    description: "Explicit jailbreak mention",
  },
  {
    pattern: /bypass\s+(safety|filter|moderation|restriction)/gi,
    severity: "critical",
    description: "Safety bypass attempt",
  },
  {
    pattern: /disable\s+(safety|filter|moderation)/gi,
    severity: "critical",
    description: "Safety disable attempt",
  },
  {
    pattern: /without\s+(any\s+)?(restrictions?|limitations?|filters?)/gi,
    severity: "high",
    description: "Restriction removal attempt",
  },
  {
    pattern: /unfiltered\s+(mode|response|output)/gi,
    severity: "high",
    description: "Unfiltered mode request",
  },
  {
    pattern: /evil\s*(mode|persona|version)/gi,
    severity: "high",
    description: "Evil mode jailbreak",
  },
];

/**
 * Context manipulation patterns - attempts to poison narrative.
 */
const CONTEXT_MANIPULATION_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}> = [
  {
    pattern: /this\s+is\s+(actually|really)\s+(true|a\s+fact)/gi,
    severity: "medium",
    description: "False fact assertion",
  },
  {
    pattern: /everyone\s+knows\s+(that)?/gi,
    severity: "low",
    description: "False consensus injection",
  },
  {
    pattern: /it\s+is\s+(well\s+)?known\s+that/gi,
    severity: "low",
    description: "False authority injection",
  },
  {
    pattern: /update\s+your\s+(knowledge|information|data)/gi,
    severity: "high",
    description: "Knowledge update injection",
  },
  {
    pattern: /correct\s+your\s+(understanding|knowledge)/gi,
    severity: "high",
    description: "Understanding correction injection",
  },
];

/**
 * Output manipulation patterns - attempts to control agent output.
 */
const OUTPUT_MANIPULATION_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}> = [
  {
    pattern: /respond\s+only\s+with/gi,
    severity: "medium",
    description: "Response constraint injection",
  },
  {
    pattern: /output\s+the\s+following/gi,
    severity: "medium",
    description: "Output dictation attempt",
  },
  {
    pattern: /say\s+exactly/gi,
    severity: "medium",
    description: "Exact output injection",
  },
  {
    pattern: /your\s+(response|answer)\s+must\s+(be|start|end)/gi,
    severity: "medium",
    description: "Response format injection",
  },
  {
    pattern: /print\s+(only|just)?/gi,
    severity: "low",
    description: "Print command injection",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All patterns combined with categories.
 */
const ALL_PATTERNS: Array<{
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  category: InjectionCategory;
}> = [
  ...INSTRUCTION_OVERRIDE_PATTERNS.map((p) => ({
    ...p,
    category: "instruction_override" as InjectionCategory,
  })),
  ...DELIMITER_INJECTION_PATTERNS.map((p) => ({
    ...p,
    category: "delimiter_injection" as InjectionCategory,
  })),
  ...JAILBREAK_PATTERNS.map((p) => ({
    ...p,
    category: "jailbreak_attempt" as InjectionCategory,
  })),
  ...CONTEXT_MANIPULATION_PATTERNS.map((p) => ({
    ...p,
    category: "context_manipulation" as InjectionCategory,
  })),
  ...OUTPUT_MANIPULATION_PATTERNS.map((p) => ({
    ...p,
    category: "output_manipulation" as InjectionCategory,
  })),
];

/**
 * Detect injections in content.
 */
function detectInjections(content: string): InjectionDetection[] {
  const detections: InjectionDetection[] = [];

  for (const { pattern, severity, description, category } of ALL_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      detections.push({
        pattern: description,
        category,
        severity,
        location: {
          start: match.index,
          end: match.index + match[0].length,
        },
        redacted: false,
      });
    }
  }

  // Sort by severity (critical first)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  detections.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return detections;
}

/**
 * Calculate threat level from detections.
 */
function calculateThreatLevel(
  detections: InjectionDetection[]
): "none" | "low" | "medium" | "high" | "critical" {
  if (detections.length === 0) return "none";

  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const d of detections) {
    severityCounts[d.severity]++;
  }

  // Any critical = critical threat
  if (severityCounts.critical > 0) return "critical";

  // Multiple high = high threat
  if (severityCounts.high >= 2) return "high";

  // Any high = high threat
  if (severityCounts.high > 0) return "high";

  // Multiple medium = medium threat
  if (severityCounts.medium >= 2) return "medium";

  // Any medium = medium threat
  if (severityCounts.medium > 0) return "medium";

  // Low only = low threat
  return "low";
}

/**
 * Redact detected injections from content.
 */
function redactInjections(
  content: string,
  detections: InjectionDetection[]
): { sanitized: string; detections: InjectionDetection[] } {
  // Sort detections by location (reverse order to preserve indices)
  const sorted = [...detections].sort(
    (a, b) => b.location.start - a.location.start
  );

  let sanitized = content;
  const updatedDetections: InjectionDetection[] = [];

  for (const detection of sorted) {
    // Redact based on severity
    if (detection.severity === "critical" || detection.severity === "high") {
      const before = sanitized.slice(0, detection.location.start);
      const after = sanitized.slice(detection.location.end);
      sanitized = before + "[REDACTED]" + after;

      updatedDetections.push({
        ...detection,
        redacted: true,
      });
    } else {
      // Medium/low - wrap in warning but keep
      const before = sanitized.slice(0, detection.location.start);
      const match = sanitized.slice(detection.location.start, detection.location.end);
      const after = sanitized.slice(detection.location.end);
      sanitized = before + `[FLAGGED: ${match}]` + after;

      updatedDetections.push({
        ...detection,
        redacted: false,
      });
    }
  }

  return { sanitized, detections: updatedDetections };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitize content for agent consumption.
 */
export const sanitizeForAgent = internalAction({
  args: {
    content: v.string(),
    authorId: v.optional(v.string()),
    authorType: v.optional(v.union(v.literal("agent"), v.literal("human"))),
    blockOnCritical: v.optional(v.boolean()),
  },
  returns: v.object({
    sanitized: v.string(),
    modified: v.boolean(),
    detections: v.array(
      v.object({
        pattern: v.string(),
        category: v.string(),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical")
        ),
        location: v.object({
          start: v.number(),
          end: v.number(),
        }),
        redacted: v.boolean(),
      })
    ),
    threatLevel: v.union(
      v.literal("none"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    blocked: v.boolean(),
  }),
  handler: async (ctx, args): Promise<SanitizationResult> => {
    const blockOnCritical = args.blockOnCritical ?? true;

    // Detect injections
    const detections = detectInjections(args.content);
    const threatLevel = calculateThreatLevel(detections);

    // Block critical threats if configured
    if (blockOnCritical && threatLevel === "critical") {
      // Record injection attempt if author provided
      if (args.authorId && args.authorType) {
        await ctx.runMutation(
          internal.domains.narrative.guards.trustScoring.updateTrustScore,
          {
            authorId: args.authorId,
            authorType: args.authorType,
            action: "injection_attempt",
            details: `Critical injection attempt: ${detections[0]?.pattern}`,
          }
        );
      }

      return {
        sanitized: "[CONTENT BLOCKED: Critical injection attempt detected]",
        modified: true,
        detections,
        threatLevel,
        blocked: true,
      };
    }

    // Redact/flag detections
    if (detections.length > 0) {
      const { sanitized, detections: updatedDetections } = redactInjections(
        args.content,
        detections
      );

      return {
        sanitized,
        modified: true,
        detections: updatedDetections,
        threatLevel,
        blocked: false,
      };
    }

    // No detections - return original
    return {
      sanitized: args.content,
      modified: false,
      detections: [],
      threatLevel: "none",
      blocked: false,
    };
  },
});

/**
 * Check content for injections without sanitizing.
 */
export const checkForInjections = internalQuery({
  args: {
    content: v.string(),
  },
  returns: v.object({
    hasInjections: v.boolean(),
    threatLevel: v.string(),
    detectionCount: v.number(),
    criticalCount: v.number(),
    highCount: v.number(),
  }),
  handler: async (_ctx, args) => {
    const detections = detectInjections(args.content);
    const threatLevel = calculateThreatLevel(detections);

    return {
      hasInjections: detections.length > 0,
      threatLevel,
      detectionCount: detections.length,
      criticalCount: detections.filter((d) => d.severity === "critical").length,
      highCount: detections.filter((d) => d.severity === "high").length,
    };
  },
});

/**
 * Log injection attempt for monitoring.
 */
export const logInjectionAttempt = internalMutation({
  args: {
    content: v.string(),
    detections: v.array(
      v.object({
        pattern: v.string(),
        category: v.string(),
        severity: v.string(),
      })
    ),
    authorId: v.optional(v.string()),
    authorType: v.optional(v.string()),
    sourceType: v.string(), // "post", "reply", "evidence"
    blocked: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Log to console for monitoring
    console.warn(
      `[InjectionContainment] ${args.blocked ? "BLOCKED" : "FLAGGED"} ` +
        `injection attempt in ${args.sourceType}` +
        (args.authorId ? ` by ${args.authorType}:${args.authorId}` : "") +
        `. Detections: ${args.detections.map((d) => d.pattern).join(", ")}`
    );

    // In production, would write to a security log table
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitize multiple content items.
 */
export const batchSanitize = internalAction({
  args: {
    items: v.array(
      v.object({
        id: v.string(),
        content: v.string(),
      })
    ),
    blockOnCritical: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      sanitized: v.string(),
      modified: v.boolean(),
      threatLevel: v.string(),
      blocked: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const results: Array<{
      id: string;
      sanitized: string;
      modified: boolean;
      threatLevel: string;
      blocked: boolean;
    }> = [];

    for (const item of args.items) {
      const result = await ctx.runAction(
        internal.domains.narrative.guards.injectionContainment.sanitizeForAgent,
        {
          content: item.content,
          blockOnCritical: args.blockOnCritical,
        }
      );

      results.push({
        id: item.id,
        sanitized: result.sanitized,
        modified: result.modified,
        threatLevel: result.threatLevel,
        blocked: result.blocked,
      });
    }

    return results;
  },
});
