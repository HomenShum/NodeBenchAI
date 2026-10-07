/**
 * Brief Payload Validator (The "Anti-Log" Lint)
 *
 * This validator runs immediately after LLM generation. If it fails,
 * reject the output and auto-retry with the error messages.
 *
 * Validation Rules:
 * 1. PROSE HYGIENE: No bullets, no log formatting, no raw URLs in synthesis
 * 2. VEGA SANDBOX: No data.url (security), limited complexity
 * 3. INTEGRITY: linkedSignalIds must reference existing signals
 */

import type { DailyBriefPayload, Signal, Action, VizArtifact } from "../types/dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX PATTERNS FOR PROSE HYGIENE
// ═══════════════════════════════════════════════════════════════════════════

/** Detects lines starting with bullets or numbers (markdown lists) */
const BULLET_REGEX = /^[\s\t]*[-*•]\s+/m;
const NUMBERED_LIST_REGEX = /^[\s\t]*\d+[.)]\s+/m;

/** Detects ISO timestamps in text (log-style formatting) */
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Detects raw URLs in text (should be in evidence objects only) */
const URL_REGEX = /https?:\/\/[^\s]+/;

/** Detects log-style patterns like "source: X" or "points: Y" */
const LOG_PATTERN_REGEX = /^[\s\t]*(source|points|score|url|timestamp|type|category):\s+/im;

// ═══════════════════════════════════════════════════════════════════════════
// PROSE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateProse(text: string, fieldName: string, errors: string[], warnings: string[]): void {
  if (!text || typeof text !== "string") {
    errors.push(`${fieldName}: Expected string, got ${typeof text}`);
    return;
  }

  if (BULLET_REGEX.test(text)) {
    errors.push(`${fieldName}: Contains bullet points. Use prose sentences instead.`);
  }

  if (NUMBERED_LIST_REGEX.test(text)) {
    errors.push(`${fieldName}: Contains numbered lists. Use prose sentences instead.`);
  }

  if (ISO_TIMESTAMP_REGEX.test(text)) {
    errors.push(`${fieldName}: Contains raw timestamps. Move temporal data to evidence objects.`);
  }

  if (URL_REGEX.test(text)) {
    errors.push(`${fieldName}: Contains raw URLs. Move URLs to evidence objects.`);
  }

  if (LOG_PATTERN_REGEX.test(text)) {
    errors.push(`${fieldName}: Contains log-style formatting (e.g., "source: X"). Use prose.`);
  }

  // Warnings for quality
  if (text.length < 20) {
    warnings.push(`${fieldName}: Very short (${text.length} chars). Consider adding more context.`);
  }

  if (text.length > 2000) {
    warnings.push(`${fieldName}: Very long (${text.length} chars). Consider being more concise.`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateSignal(signal: Signal, index: number, errors: string[], warnings: string[]): void {
  const prefix = `actII.signals[${index}]`;

  if (!signal.id || typeof signal.id !== "string") {
    errors.push(`${prefix}.id: Required string field missing or invalid`);
  }

  if (!signal.headline || typeof signal.headline !== "string") {
    errors.push(`${prefix}.headline: Required string field missing or invalid`);
  } else if (signal.headline.length > 100) {
    warnings.push(`${prefix}.headline: Very long (${signal.headline.length} chars). Keep headlines concise.`);
  }

  validateProse(signal.synthesis, `${prefix}.synthesis`, errors, warnings);

  if (!Array.isArray(signal.evidence) || signal.evidence.length === 0) {
    errors.push(`${prefix}.evidence: Must be a non-empty array of evidence objects`);
  } else {
    signal.evidence.forEach((ev, evIdx) => {
      const evPrefix = `${prefix}.evidence[${evIdx}]`;

      if (!ev.id) errors.push(`${evPrefix}.id: Required`);
      if (!ev.source) errors.push(`${evPrefix}.source: Required`);
      if (!ev.title) errors.push(`${evPrefix}.title: Required`);
      if (!ev.url) errors.push(`${evPrefix}.url: Required`);
      if (!ev.publishedAt) errors.push(`${evPrefix}.publishedAt: Required`);
      if (!ev.relevance) errors.push(`${evPrefix}.relevance: Required`);

      // Validate URL format
      if (ev.url && !ev.url.startsWith("http")) {
        errors.push(`${evPrefix}.url: Must be a valid URL (got: ${ev.url.slice(0, 50)}...)`);
      }
    });

    if (signal.evidence.length > 5) {
      warnings.push(`${prefix}.evidence: Has ${signal.evidence.length} items. Consider limiting to 5 most relevant.`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateAction(
  action: Action,
  index: number,
  validSignalIds: Set<string>,
  errors: string[],
  warnings: string[]
): void {
  const prefix = `actIII.actions[${index}]`;
  const validStatuses = ["proposed", "insufficient_data", "skipped", "in_progress", "completed"];

  if (!action.id || typeof action.id !== "string") {
    errors.push(`${prefix}.id: Required string field missing or invalid`);
  }

  if (!action.label || typeof action.label !== "string") {
    errors.push(`${prefix}.label: Required string field missing or invalid`);
  }

  if (!validStatuses.includes(action.status)) {
    errors.push(`${prefix}.status: Must be one of ${validStatuses.join(", ")} (got: ${action.status})`);
  }

  // Validate content based on status
  if (action.status === "proposed" || action.status === "in_progress" || action.status === "completed") {
    validateProse(action.content, `${prefix}.content`, errors, warnings);
  } else if (action.status === "insufficient_data" || action.status === "skipped") {
    // For skipped/insufficient, content should explain why but doesn't need full prose validation
    if (!action.content || action.content.length < 10) {
      errors.push(`${prefix}.content: Must explain why this action was ${action.status}`);
    }
  }

  // Validate linkedSignalIds reference existing signals
  if (!Array.isArray(action.linkedSignalIds)) {
    errors.push(`${prefix}.linkedSignalIds: Must be an array`);
  } else {
    action.linkedSignalIds.forEach((signalId) => {
      if (!validSignalIds.has(signalId)) {
        errors.push(`${prefix}.linkedSignalIds: References non-existent signal ID "${signalId}"`);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VEGA SANDBOX VALIDATION (Security)
// ═══════════════════════════════════════════════════════════════════════════

function validateVegaSpec(viz: VizArtifact | undefined, errors: string[], warnings: string[]): void {
  if (!viz) return;

  const validIntents = ["time_series", "category_compare", "distribution", "correlation", "part_to_whole"];

  if (!validIntents.includes(viz.intent)) {
    errors.push(`dashboard.vizArtifact.intent: Must be one of ${validIntents.join(", ")}`);
  }

  if (!viz.rationale || viz.rationale.length < 10) {
    warnings.push(`dashboard.vizArtifact.rationale: Should explain why this visualization was chosen`);
  }

  if (!Array.isArray(viz.data)) {
    errors.push(`dashboard.vizArtifact.data: Must be an inline array (no external URLs)`);
  } else if (viz.data.length === 0) {
    errors.push(`dashboard.vizArtifact.data: Must contain at least one data point`);
  }

  // SECURITY: Check spec for forbidden patterns
  const specString = JSON.stringify(viz.spec);

  // Forbidden: Loading data from URLs (Privacy/SSRF risk)
  if (/"url"\s*:/i.test(specString) || /'url'\s*:/i.test(specString)) {
    // Check if it's data.url specifically (the dangerous one)
    if (/"data"\s*:\s*\{[^}]*"url"/i.test(specString)) {
      errors.push(
        `dashboard.vizArtifact.spec: Contains forbidden 'data.url' property. Use inline 'data.values' only.`
      );
    }
  }

  // Forbidden: External data sources
  if (/data\.url/i.test(specString)) {
    errors.push(`dashboard.vizArtifact.spec: External data URLs are forbidden for security.`);
  }

  // Forbidden: Signal listeners that could exfiltrate data
  if (/"signals"\s*:\s*\[/.test(specString) && /"on"\s*:/.test(specString)) {
    warnings.push(
      `dashboard.vizArtifact.spec: Contains signal listeners. Ensure no data exfiltration is possible.`
    );
  }

  // Warning: Very complex specs
  if (specString.length > 5000) {
    warnings.push(
      `dashboard.vizArtifact.spec: Very large spec (${specString.length} chars). Consider simplifying.`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validates a Daily Brief payload against the canonical schema.
 *
 * @param payload - The generated brief payload to validate
 * @returns ValidationResult with errors (hard failures) and warnings (quality issues)
 *
 * @example
 * ```ts
 * const result = validateBriefPayload(payload);
 * if (!result.valid) {
 *   // Reject and retry with errors
 *   console.error("Validation failed:", result.errors);
 * }
 * ```
 */
export function validateBriefPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Type guard
  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      errors: ["Payload must be a non-null object"],
      warnings: []
    };
  }

  const brief = payload as DailyBriefPayload;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. META VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  if (!brief.meta) {
    errors.push("meta: Required object missing");
  } else {
    if (!brief.meta.date) errors.push("meta.date: Required");
    if (!brief.meta.headline) errors.push("meta.headline: Required");
    if (!brief.meta.summary) {
      errors.push("meta.summary: Required");
    } else {
      validateProse(brief.meta.summary, "meta.summary", errors, warnings);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. ACT I VALIDATION
  // ─────────────────────────────────────────────────────────────────────────

  if (!brief.actI) {
    errors.push("actI: Required object missing");
  } else {
    if (!brief.actI.title) errors.push("actI.title: Required");
    if (brief.actI.synthesis) {
      validateProse(brief.actI.synthesis, "actI.synthesis", errors, warnings);
    }
    if (typeof brief.actI.totalItems !== "number") {
      errors.push("actI.totalItems: Required number");
    }
    if (typeof brief.actI.sourcesCount !== "number") {
      errors.push("actI.sourcesCount: Required number");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. ACT II VALIDATION (Signals)
  // ─────────────────────────────────────────────────────────────────────────

  if (!brief.actII) {
    errors.push("actII: Required object missing");
  } else {
    if (!brief.actII.title) errors.push("actII.title: Required");

    validateProse(brief.actII.synthesis, "actII.synthesis", errors, warnings);

    if (!Array.isArray(brief.actII.signals)) {
      errors.push("actII.signals: Must be an array of signal objects");
    } else {
      brief.actII.signals.forEach((signal, idx) => {
        validateSignal(signal, idx, errors, warnings);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. ACT III VALIDATION (Actions)
  // ─────────────────────────────────────────────────────────────────────────

  // Build set of valid signal IDs for cross-reference validation
  const validSignalIds = new Set<string>(
    brief.actII?.signals?.map((s) => s.id).filter(Boolean) || []
  );

  if (!brief.actIII) {
    errors.push("actIII: Required object missing");
  } else {
    if (!brief.actIII.title) errors.push("actIII.title: Required");

    validateProse(brief.actIII.synthesis, "actIII.synthesis", errors, warnings);

    if (!Array.isArray(brief.actIII.actions)) {
      errors.push("actIII.actions: Must be an array of action objects");
    } else {
      // Filter out actions with insufficient_data or skipped status for display
      const displayableActions = brief.actIII.actions.filter(
        (a) => a.status !== "insufficient_data" && a.status !== "skipped"
      );

      if (displayableActions.length === 0 && brief.actIII.actions.length > 0) {
        warnings.push(
          "actIII.actions: All actions are skipped or have insufficient data. Consider adding at least one proposed action."
        );
      }

      brief.actIII.actions.forEach((action, idx) => {
        validateAction(action, idx, validSignalIds, errors, warnings);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. DASHBOARD/VEGA VALIDATION (Security)
  // ─────────────────────────────────────────────────────────────────────────

  if (brief.dashboard?.vizArtifact) {
    validateVegaSpec(brief.dashboard.vizArtifact, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Formats validation errors for LLM retry prompt
 */
export function formatValidationErrorsForRetry(result: ValidationResult): string {
  if (result.valid) return "";

  const lines = [
    "Your output failed validation. Please regenerate strictly adhering to the schema.",
    "",
    "ERRORS (must fix):",
    ...result.errors.map((e) => `  - ${e}`),
  ];

  if (result.warnings.length > 0) {
    lines.push("", "WARNINGS (quality issues):", ...result.warnings.map((w) => `  - ${w}`));
  }

  return lines.join("\n");
}

/**
 * Quick check if a payload has any "log-like" content that should be rejected
 */
export function hasLogLikeContent(text: string): boolean {
  return (
    BULLET_REGEX.test(text) ||
    NUMBERED_LIST_REGEX.test(text) ||
    ISO_TIMESTAMP_REGEX.test(text) ||
    LOG_PATTERN_REGEX.test(text)
  );
}
