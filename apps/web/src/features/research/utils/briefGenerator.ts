/**
 * Brief Generator Utilities
 *
 * Helper functions for generating validated Daily Briefs with retry logic.
 */

import type { DailyBriefPayload } from "../types/dailyBriefSchema";
import { validateBriefPayload, formatValidationErrorsForRetry, type ValidationResult } from "../validators/briefValidator";
import { BRIEF_OUTPUT_CONSTRAINTS, BRIEF_RETRY_PROMPT } from "../prompts/briefConstraints";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface GenerationResult {
  success: boolean;
  payload: DailyBriefPayload | null;
  validation: ValidationResult;
  attempts: number;
  lastError?: string;
}

export interface GeneratorOptions {
  /** Maximum retry attempts (default: 2) */
  maxRetries?: number;
  /** Whether to include warnings in retry prompt (default: false) */
  includeWarningsInRetry?: boolean;
  /** Callback for each attempt */
  onAttempt?: (attempt: number, result: ValidationResult) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIEF GENERATION WITH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses and validates a JSON string as a DailyBriefPayload.
 *
 * @param jsonString - Raw JSON string from LLM
 * @returns Validation result with parsed payload if valid
 */
export function parseAndValidateBrief(jsonString: string): {
  payload: DailyBriefPayload | null;
  validation: ValidationResult;
  parseError?: string;
} {
  const raw = typeof jsonString === "string" ? jsonString.trim() : "";

  const tryParse = (s: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    try {
      return { ok: true, value: JSON.parse(s) as unknown };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const extractLikelyJsonObject = (s: string): string | null => {
    const start = s.indexOf("{");
    if (start < 0) return null;
    const end = s.lastIndexOf("}");
    if (end > start) return s.slice(start, end + 1);
    return null;
  };

  const repairTruncatedJson = (s: string): string | null => {
    const start = s.indexOf("{");
    if (start < 0) return null;
    const t = s.slice(start);

    let inString = false;
    let escape = false;
    let brace = 0;
    let bracket = 0;
    let lastBalancedPos = -1;

    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") brace++;
      else if (ch === "}") brace = Math.max(0, brace - 1);
      else if (ch === "[") bracket++;
      else if (ch === "]") bracket = Math.max(0, bracket - 1);

      if (!inString && brace === 0 && bracket === 0) lastBalancedPos = i + 1;
    }

    if (lastBalancedPos > 0) return t.slice(0, lastBalancedPos);

    // If it never balanced, attempt a minimal close-out (works for common truncation-at-end failures).
    let repaired = t;
    if (inString) repaired += "\"";
    if (bracket > 0) repaired += "]".repeat(bracket);
    if (brace > 0) repaired += "}".repeat(brace);
    return repaired;
  };

  // Try parse JSON as-is.
  let parsed = tryParse(raw);

  // Common failure: model returns extra text; try extract { ... }.
  if (!parsed.ok) {
    const extracted = extractLikelyJsonObject(raw);
    if (extracted) parsed = tryParse(extracted);
  }

  // Common failure: output truncated; try close braces/brackets.
  if (!parsed.ok && /Unexpected end of JSON input/i.test(parsed.error)) {
    const repaired = repairTruncatedJson(raw);
    if (repaired) parsed = tryParse(repaired);
  }

  if (!parsed.ok) {
    return {
      payload: null,
      validation: {
        valid: false,
        errors: [`JSON parse error: ${parsed.error}`],
        warnings: []
      },
      parseError: parsed.error
    };
  }

  const payload = parsed.value;

  // Validate the parsed payload
  const validation = validateBriefPayload(payload);

  return {
    payload: validation.valid ? (payload as DailyBriefPayload) : null,
    validation
  };
}

/**
 * Builds a retry prompt with validation errors.
 *
 * @param validation - Previous validation result
 * @param includeWarnings - Whether to include warnings
 * @returns Formatted retry prompt
 */
export function buildRetryPrompt(
  validation: ValidationResult,
  includeWarnings = false
): string {
  const errorSection = formatValidationErrorsForRetry(validation);

  const prompt = [
    BRIEF_RETRY_PROMPT,
    "",
    errorSection,
    "",
    "Remember to follow the output constraints:",
    BRIEF_OUTPUT_CONSTRAINTS
  ];

  return prompt.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a DailyBriefPayload to ScrollySection format for the UI.
 *
 * This bridges the canonical schema to the existing ScrollytellingLayout component.
 */
export function briefToScrollySections(brief: DailyBriefPayload): Array<{
  id: string;
  meta: { date: string; title: string };
  content: { body: string[]; deepDives: Array<{ title: string; content: string }> };
  dashboard: {
    phaseLabel: string;
    kpis: Array<{ label: string; value: number; unit: string; color: string }>;
    marketSentiment: number;
    activeRegion: string;
  };
}> {
  type ScrollySection = {
    id: string;
    meta: { date: string; title: string };
    content: { body: string[]; deepDives: Array<{ title: string; content: string }> };
    dashboard: {
      phaseLabel: string;
      kpis: Array<{ label: string; value: number; unit: string; color: string }>;
      marketSentiment: number;
      activeRegion: string;
    };
  };
  const sections: ScrollySection[] = [];

  // Act I - Setup
  sections.push({
    id: `brief-${brief.meta.date}-act-1`,
    meta: {
      date: "Today's Briefing",
      title: "Act I — Setup: Coverage & Freshness"
    },
    content: {
      body: [
        `Briefing for ${new Date(brief.meta.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        })}.`,
        brief.actI.synthesis,
        brief.actI.topSources.length
          ? `Top sources: ${brief.actI.topSources
              .map((s) => `${s.source}: ${s.count}`)
              .join(" · ")}`
          : ""
      ].filter(Boolean),
      deepDives: []
    },
    dashboard: {
      phaseLabel: "Quick Pulse",
      kpis: [
        { label: "Items", value: brief.actI.totalItems, unit: "", color: "bg-slate-900" },
        { label: "Sources", value: brief.actI.sourcesCount, unit: "", color: "bg-slate-600" }
      ],
      marketSentiment: Math.min(100, brief.actI.totalItems),
      activeRegion: "Global"
    }
  });

  // Act II - Signals
  const signalBodies: string[] = [brief.actII.synthesis];
  brief.actII.signals.forEach((signal) => {
    signalBodies.push(`**${signal.headline}**: ${signal.synthesis}`);
  });

  sections.push({
    id: `brief-${brief.meta.date}-act-2`,
    meta: {
      date: "Signals",
      title: "Analysis — What's New Today"
    },
    content: {
      body: signalBodies,
      deepDives: brief.actII.signals.map((signal) => ({
        title: signal.headline,
        content: [
          signal.synthesis,
          "",
          "**Evidence:**",
          ...signal.evidence.map(
            (ev) => `- [${ev.title}](${ev.url}) — ${ev.relevance}`
          )
        ].join("\n")
      }))
    },
    dashboard: {
      phaseLabel: "Analysis",
      kpis: [
        {
          label: "Signals",
          value: brief.actII.signals.length,
          unit: "",
          color: "bg-slate-900"
        }
      ],
      marketSentiment: Math.min(
        100,
        brief.actII.signals.reduce(
          (sum, s) => sum + s.evidence.reduce((eSum, e) => eSum + (e.score || 0), 0),
          0
        )
      ),
      activeRegion: "Global"
    }
  });

  // Act III - Actions
  const proposedActions = brief.actIII.actions.filter(
    (a) => a.status === "proposed" || a.status === "in_progress" || a.status === "completed"
  );

  sections.push({
    id: `brief-${brief.meta.date}-act-3`,
    meta: {
      date: "Actions",
      title: "Deep Dive — Turn Signals Into Moves"
    },
    content: {
      body: [
        brief.actIII.synthesis,
        proposedActions.length
          ? "Open the follow-ups below to review or continue the work."
          : "No actionable items identified for today.",
        "Tip: Ask Fast Agent to use Linkup + Fusion Search to enrich any headline."
      ],
      deepDives: brief.actIII.actions.map((action) => ({
        title: `${action.label}${action.status !== "proposed" ? ` (${action.status})` : ""}`,
        content: action.content
      }))
    },
    dashboard: {
      phaseLabel: "Deep Dive",
      kpis: [
        { label: "Actions", value: brief.actIII.actions.length, unit: "", color: "bg-slate-900" },
        { label: "Proposed", value: proposedActions.length, unit: "", color: "bg-indigo-600" }
      ],
      marketSentiment: Math.round((proposedActions.length / Math.max(brief.actIII.actions.length, 1)) * 100),
      activeRegion: "Global"
    }
  });

  return sections;
}

/**
 * Extracts all evidence from a brief for the evidence panel.
 */
export function extractAllEvidence(brief: DailyBriefPayload): Array<{
  id: string;
  signalId: string;
  signalHeadline: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  relevance: string;
  score?: number;
}> {
  const evidence: Array<{
    id: string;
    signalId: string;
    signalHeadline: string;
    source: string;
    title: string;
    url: string;
    publishedAt: string;
    relevance: string;
    score?: number;
  }> = [];

  brief.actII.signals.forEach((signal) => {
    signal.evidence.forEach((ev) => {
      evidence.push({
        id: ev.id,
        signalId: signal.id,
        signalHeadline: signal.headline,
        source: ev.source,
        title: ev.title,
        url: ev.url,
        publishedAt: ev.publishedAt,
        relevance: ev.relevance,
        score: ev.score
      });
    });
  });

  return evidence;
}

/**
 * Gets all unique sources from a brief.
 */
export function getSourceBreakdown(brief: DailyBriefPayload): Record<string, number> {
  if (brief.dashboard?.sourceBreakdown) {
    return brief.dashboard.sourceBreakdown;
  }

  // Fallback: count from evidence
  const counts: Record<string, number> = {};
  brief.actII.signals.forEach((signal) => {
    signal.evidence.forEach((ev) => {
      counts[ev.source] = (counts[ev.source] || 0) + 1;
    });
  });

  return counts;
}
