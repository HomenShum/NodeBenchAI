"use node";

/**
 * Brief Generator with Structured Outputs
 * 
 * Generates canonical DailyBriefPayload using OpenAI Structured Outputs.
 * Integrates with the brief validator for lint-and-retry pattern.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Import schema and validator types
import type { DailyBriefPayload, Signal, Evidence, Action } from "../../../src/features/research/types/dailyBriefSchema";
import { DailyBriefJSONSchema } from "../../../src/features/research/types/dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface FeedItem {
  _id?: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  type?: string;
  category?: string;
  tags?: string[];
  score?: number;
  publishedAt?: string;
}

interface GenerationContext {
  briefDate: string;
  feedItems: FeedItem[];
  snapshotSummary?: {
    totalItems?: number;
    bySource?: Record<string, number>;
    topTrending?: string[];
  };
  previousErrors?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildBriefPrompt(context: GenerationContext): string {
  const { briefDate, feedItems, snapshotSummary, previousErrors } = context;

  // Build citation registry from feed items
  const citationRegistry = feedItems.slice(0, 20).map((item, i) => {
    const citationId = `src-${i + 1}`;
    return {
      id: citationId,
      title: item.title,
      source: item.source || "Unknown",
      url: item.url || "",
    };
  });

  const itemsContext = feedItems.slice(0, 20).map((item, i) => {
    const citationId = `src-${i + 1}`;
    return `[CITATION_ID: ${citationId}] ${item.title}
   Source: ${item.source || "Unknown"} | Score: ${item.score || 0}
   URL: ${item.url || "N/A"}
   Published: ${item.publishedAt || "Unknown"}
   Summary: ${item.summary?.slice(0, 200) || "No summary"}`;
  }).join("\n\n");

  const sourceBreakdown = snapshotSummary?.bySource
    ? Object.entries(snapshotSummary.bySource)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
        .map(([source, count]) => `${source}: ${count}`)
        .join(", ")
    : "Various sources";

  const errorFeedback = previousErrors?.length
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${previousErrors.map(e => `  - ${e}`).join("\n")}\nFix these issues in your new response.`
    : "";

  return `You are an executive intelligence analyst writing "The Morning Dossier" for ${briefDate}.

STRICT RULES:
1. ALL synthesis fields must be PROSE PARAGRAPHS (2-4 sentences). NO bullets. NO numbered lists.
2. Do NOT include raw URLs in synthesis text. URLs go ONLY in evidence.url fields.
3. Do NOT include timestamps like "2024-12-14T..." in synthesis text.
4. Do NOT use log-style formatting like "source: X" or "points: Y" in prose.
5. Each signal MUST have 1-5 evidence items with all required fields.
6. Action linkedSignalIds MUST reference real signal IDs you created.

═══════════════════════════════════════════════════════════════════════════
CITATION TOKEN SYSTEM (CRITICAL - You MUST use these in synthesis fields)
═══════════════════════════════════════════════════════════════════════════

When referencing feed items in your synthesis text, use citation tokens:
  {{cite:CITATION_ID}}

Example synthesis with citations:
  "Market sentiment remains constructive{{cite:src-1}}, with open-source AI tooling continuing to gain momentum{{cite:src-3}}. The release of new vision models{{cite:src-5}} signals broader industry investment in multimodal capabilities."

AVAILABLE CITATIONS:
${citationRegistry.map(c => `  - ${c.id}: "${c.title}" (${c.source})`).join("\n")}

═══════════════════════════════════════════════════════════════════════════
ENTITY TOKEN SYSTEM (Use for companies, people, products, technologies)
═══════════════════════════════════════════════════════════════════════════

When mentioning entities (companies, people, products, technologies), wrap them in entity tokens:
  @@entity:entity-id|Display Name|type:TYPE@@

Entity types: company, person, product, technology, topic, metric

Example synthesis with entities:
  "@@entity:openai|OpenAI|type:company@@ continues to lead in frontier models, while @@entity:mistral|Mistral AI|type:company@@ gains traction in the open-weight space. @@entity:sam-altman|Sam Altman|type:person@@ announced new pricing tiers."

Generate entity IDs using kebab-case from the entity name (e.g., "OpenAI" → "openai", "Sam Altman" → "sam-altman").

═══════════════════════════════════════════════════════════════════════════
CHART REFERENCE SYNTAX (For interactive spans in scrollytelling)
═══════════════════════════════════════════════════════════════════════════

When referencing data points that could be visualized, use interactive span syntax:
  [[descriptive label|dataIndex:N]]

Example:
  "The [[funding spike in Q3|dataIndex:2]] reflects renewed investor confidence, though the [[reliability gap|dataIndex:4]] remains a concern."

═══════════════════════════════════════════════════════════════════════════

TODAY'S FEED (${snapshotSummary?.totalItems || feedItems.length} items from ${sourceBreakdown}):

${itemsContext}
${errorFeedback}

Generate a structured 3-Act brief following the exact JSON schema provided. Remember to embed {{cite:id}}, @@entity:id|name|type:TYPE@@, and [[label|dataIndex:N]] tokens throughout your synthesis prose.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROSE HYGIENE PATTERNS (Production-grade lint gates)
// ═══════════════════════════════════════════════════════════════════════════

const PROSE_LINT_RULES = {
  // Bullets and lists
  BULLET_MARKERS: /^\s*[-*•]\s+/m,
  NUMBERED_LIST: /^\s*\d+[.)]\s+/m,

  // URL patterns (comprehensive)
  FULL_URL: /https?:\/\/[^\s]+/i,
  WWW_URL: /www\.[^\s]+/i,
  DOMAIN_PATTERNS: /\b\w+\.(com|io|org|net|co|ai|dev|app)\b/i,

  // Timestamp patterns
  ISO_TIMESTAMP: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  TIME_12H: /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i,
  TIME_24H: /\b\d{1,2}:\d{2}:\d{2}\b/,

  // Feed-log tells (the patterns that reveal raw feed data)
  TRENDING_TELL: /trending on (hacker\s?news|reddit|twitter|hn)/i,
  POINTS_TELL: /\b\d+\s*(points?|pts)\b/i,
  COMMENTS_TELL: /\b\d+\s*comments?\b/i,
  SOURCE_LOG_TELL: /·\s*\d+\s*(pts|points)/i,
  STAR_TELL: /\b\d+\s*stars?\b/i,
  UPVOTE_TELL: /\b\d+\s*upvotes?\b/i,
};

interface ProseViolation {
  rule: string;
  pattern: string;
  field: string;
  snippet: string;
}

function lintProseField(text: string, fieldName: string): ProseViolation[] {
  const violations: ProseViolation[] = [];

  if (!text || typeof text !== "string") return violations;

  const checks: Array<{ rule: string; regex: RegExp }> = [
    { rule: "bullet_markers", regex: PROSE_LINT_RULES.BULLET_MARKERS },
    { rule: "numbered_list", regex: PROSE_LINT_RULES.NUMBERED_LIST },
    { rule: "full_url", regex: PROSE_LINT_RULES.FULL_URL },
    { rule: "www_url", regex: PROSE_LINT_RULES.WWW_URL },
    { rule: "domain_pattern", regex: PROSE_LINT_RULES.DOMAIN_PATTERNS },
    { rule: "iso_timestamp", regex: PROSE_LINT_RULES.ISO_TIMESTAMP },
    { rule: "time_12h", regex: PROSE_LINT_RULES.TIME_12H },
    { rule: "time_24h", regex: PROSE_LINT_RULES.TIME_24H },
    { rule: "trending_tell", regex: PROSE_LINT_RULES.TRENDING_TELL },
    { rule: "points_tell", regex: PROSE_LINT_RULES.POINTS_TELL },
    { rule: "comments_tell", regex: PROSE_LINT_RULES.COMMENTS_TELL },
    { rule: "source_log_tell", regex: PROSE_LINT_RULES.SOURCE_LOG_TELL },
    { rule: "star_tell", regex: PROSE_LINT_RULES.STAR_TELL },
    { rule: "upvote_tell", regex: PROSE_LINT_RULES.UPVOTE_TELL },
  ];

  for (const { rule, regex } of checks) {
    const match = text.match(regex);
    if (match) {
      violations.push({
        rule,
        pattern: regex.source,
        field: fieldName,
        snippet: match[0].slice(0, 50),
      });
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION (Production-grade with comprehensive prose hygiene)
// ═══════════════════════════════════════════════════════════════════════════

interface ValidationResult {
  valid: boolean;
  errors: string[];
  violations: ProseViolation[];
  warnings: string[];
}

function quickValidateBrief(payload: unknown): ValidationResult {
  const errors: string[] = [];
  const violations: ProseViolation[] = [];
  const warnings: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Payload must be a non-null object"], violations: [], warnings: [] };
  }

  const brief = payload as DailyBriefPayload;

  // Check required fields
  if (!brief.meta?.date) errors.push("meta.date: Required");
  if (!brief.meta?.headline) errors.push("meta.headline: Required");
  if (!brief.actI?.title) errors.push("actI.title: Required");
  if (!brief.actII?.title) errors.push("actII.title: Required");
  if (!brief.actIII?.title) errors.push("actIII.title: Required");

  // Collect all prose fields for lint checking
  const proseFields: Array<{ path: string; text: string | undefined }> = [
    { path: "meta.summary", text: brief.meta?.summary },
    { path: "meta.headline", text: brief.meta?.headline },
    { path: "actI.synthesis", text: brief.actI?.synthesis },
    { path: "actII.synthesis", text: brief.actII?.synthesis },
    { path: "actIII.synthesis", text: brief.actIII?.synthesis },
  ];

  // Add signal synthesis fields
  if (Array.isArray(brief.actII?.signals)) {
    brief.actII.signals.forEach((signal, idx) => {
      proseFields.push({ path: `actII.signals[${idx}].synthesis`, text: signal.synthesis });
      proseFields.push({ path: `actII.signals[${idx}].headline`, text: signal.headline });
    });
  }

  // Add action content fields
  if (Array.isArray(brief.actIII?.actions)) {
    brief.actIII.actions.forEach((action, idx) => {
      proseFields.push({ path: `actIII.actions[${idx}].content`, text: action.content });
      proseFields.push({ path: `actIII.actions[${idx}].label`, text: action.label });
    });
  }

  // Run prose hygiene lint on all fields
  for (const { path, text } of proseFields) {
    if (text) {
      const fieldViolations = lintProseField(text, path);
      violations.push(...fieldViolations);
    }
  }

  // Convert violations to errors (blocking)
  for (const v of violations) {
    errors.push(`${v.field}: Prose hygiene violation [${v.rule}] - found "${v.snippet}"`);
  }

  // Validate signals have evidence
  if (Array.isArray(brief.actII?.signals)) {
    brief.actII.signals.forEach((signal, idx) => {
      if (!signal.evidence?.length) {
        errors.push(`actII.signals[${idx}].evidence: Must have at least 1 evidence item`);
      }
    });
  }

  // Validate actions use proper status enum
  if (Array.isArray(brief.actIII?.actions)) {
    const validStatuses = ["proposed", "insufficient_data", "skipped", "in_progress", "completed"];
    brief.actIII.actions.forEach((action, idx) => {
      if (!validStatuses.includes(action.status)) {
        errors.push(`actIII.actions[${idx}].status: Must be one of ${validStatuses.join(", ")}`);
      }
      // Warn if skipped/insufficient_data has no explanation
      if ((action.status === "skipped" || action.status === "insufficient_data") && action.content.length < 10) {
        warnings.push(`actIII.actions[${idx}].content: Should explain why action was skipped`);
      }
    });
  }

  return { valid: errors.length === 0, errors, violations, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEMETRY (Structured logging for monitoring)
// ═══════════════════════════════════════════════════════════════════════════

interface GenerationTelemetry {
  timestamp: number;
  attempt: number;
  success: boolean;
  model: string;
  validationErrors?: string[];
  violations?: ProseViolation[];
  warnings?: string[];
  apiError?: string;
  durationMs?: number;
}

function logTelemetry(event: string, telemetry: GenerationTelemetry): void {
  // Structured log for observability (can be ingested by logging platforms)
  console.log(JSON.stringify({
    event: `briefGenerator.${event}`,
    ...telemetry,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE GENERATOR (with regeneration loop and telemetry)
// ═══════════════════════════════════════════════════════════════════════════

async function callOpenAIStructured(
  prompt: string,
  maxRetries: number = 3
): Promise<DailyBriefPayload> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const modelName = getLlmModel("analysis", "openai");

  let lastValidation: ValidationResult | null = null;
  const allTelemetry: GenerationTelemetry[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();

    // Build prompt with specific violation feedback for regeneration
    let finalPrompt = prompt;
    if (attempt > 0 && lastValidation) {
      const violationFeedback = lastValidation.violations.length > 0
        ? `\n\nPROSE HYGIENE VIOLATIONS TO FIX:\n${lastValidation.violations.map(v =>
            `  - ${v.field}: Remove "${v.snippet}" (violates ${v.rule} rule)`
          ).join("\n")}`
        : "";

      const errorFeedback = lastValidation.errors.length > 0
        ? `\n\nVALIDATION ERRORS TO FIX:\n${lastValidation.errors.map(e => `  - ${e}`).join("\n")}`
        : "";

      finalPrompt = `${prompt}${violationFeedback}${errorFeedback}\n\nRewrite synthesis fields to fix these issues. Keep evidence objects unchanged.`;
    }

    try {
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: "system",
            content: `You are an expert intelligence analyst. Generate structured JSON following the exact schema.

CRITICAL PROSE RULES:
1. Use flowing editorial prose sentences. NO bullet points. NO numbered lists.
2. Do NOT include raw URLs anywhere in prose text. URLs go ONLY in evidence.url fields.
3. Do NOT include timestamps (like "12:30 PM" or "2024-12-14T...") in prose.
4. Do NOT use feed-log phrases like "Trending on HackerNews", "X points", "Y comments", "starred".
5. Do NOT include domain names like "github.com" in prose text.
6. For actions with insufficient data, set status to "insufficient_data" and explain in content field.

INLINE TOKEN REQUIREMENTS (MANDATORY):
7. ALWAYS embed {{cite:src-N}} tokens when referencing feed items in synthesis text.
8. ALWAYS wrap company/person/product names in @@entity:id|Name|type:TYPE@@ tokens.
9. Use [[label|dataIndex:N]] for data points that could be charted.

Example synthesis:
"@@entity:anthropic|Anthropic|type:company@@ released new safety research{{cite:src-2}}, while the [[capability gap|dataIndex:1]] continues to widen."`
          },
          { role: "user", content: finalPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: DailyBriefJSONSchema as any,
        },
        max_completion_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty response from OpenAI");

      const payload = JSON.parse(content) as DailyBriefPayload;
      const validation = quickValidateBrief(payload);
      lastValidation = validation;

      const telemetry: GenerationTelemetry = {
        timestamp: Date.now(),
        attempt: attempt + 1,
        success: validation.valid,
        model: modelName,
        durationMs: Date.now() - startTime,
        validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
        violations: validation.violations.length > 0 ? validation.violations : undefined,
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      };
      allTelemetry.push(telemetry);

      if (validation.valid) {
        logTelemetry("generation_success", telemetry);
        if (validation.warnings.length > 0) {
          console.warn(`[briefGenerator] Warnings:`, validation.warnings);
        }
        return payload;
      }

      logTelemetry("validation_failed", telemetry);
      console.warn(`[briefGenerator] Validation failed (attempt ${attempt + 1}/${maxRetries + 1}):`, {
        errors: validation.errors.slice(0, 5),
        violations: validation.violations.slice(0, 3),
      });

    } catch (err) {
      const telemetry: GenerationTelemetry = {
        timestamp: Date.now(),
        attempt: attempt + 1,
        success: false,
        model: modelName,
        durationMs: Date.now() - startTime,
        apiError: err instanceof Error ? err.message : String(err),
      };
      allTelemetry.push(telemetry);
      logTelemetry("api_error", telemetry);

      console.error(`[briefGenerator] API error (attempt ${attempt + 1}):`, err);
      if (attempt === maxRetries) throw err;
    }
  }

  // Log final failure summary
  logTelemetry("generation_exhausted", {
    timestamp: Date.now(),
    attempt: maxRetries + 1,
    success: false,
    model: modelName,
    validationErrors: lastValidation?.errors,
    violations: lastValidation?.violations,
  });

  throw new Error(`Brief generation failed after ${maxRetries + 1} attempts. Last errors: ${lastValidation?.errors.slice(0, 3).join("; ")}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX ACTION
// ═══════════════════════════════════════════════════════════════════════════

export const generateBrief = internalAction({
  args: {
    snapshotId: v.id("dailyBriefSnapshots"),
  },
  handler: async (ctx, args): Promise<{ brief: DailyBriefPayload; memoryId?: string }> => {
    // 1. Get snapshot
    const snapshot: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getSnapshotById,
      { snapshotId: args.snapshotId }
    );
    if (!snapshot) throw new Error("Snapshot not found");

    // 2. Get existing memory for context
    const memory: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getMemoryBySnapshot,
      { snapshotId: args.snapshotId }
    );

    // 3. Build generation context
    const feedItems: FeedItem[] = memory?.context?.topFeedItems || [];
    const context: GenerationContext = {
      briefDate: snapshot.dateString,
      feedItems,
      snapshotSummary: {
        totalItems: memory?.context?.snapshotSummary?.totalItems || feedItems.length,
        bySource: memory?.context?.snapshotSummary?.bySource || {},
        topTrending: memory?.context?.snapshotSummary?.topTrending || [],
      },
    };

    // 4. Generate structured brief
    const prompt = buildBriefPrompt(context);
    const brief = await callOpenAIStructured(prompt);

    // 5. Store brief in memory context
    if (memory?._id) {
      await ctx.runMutation(
        internal.domains.research.dailyBriefMemoryMutations.updateMemoryContext,
        {
          memoryId: memory._id,
          contextPatch: { generatedBrief: brief },
        }
      );
    }

    console.log(`[briefGenerator] Generated brief for ${snapshot.dateString}:`, {
      headline: brief.meta.headline,
      signals: brief.actII.signals.length,
      actions: brief.actIII.actions.length,
    });

    return { brief, memoryId: memory?._id };
  },
});

