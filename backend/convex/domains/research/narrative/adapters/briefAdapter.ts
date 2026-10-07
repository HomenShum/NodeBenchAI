/**
 * Brief Adapter
 *
 * Converts Daily Brief features and signals into NarrativeEvents.
 * Maps brief priority (1-10) to event significance (minor/moderate/major).
 *
 * Integration points:
 * - dailyBriefMemories.features[] → NarrativeEvent
 * - DailyBriefPayload.actII.signals[] → NarrativeEvent (with evidence)
 *
 * @module domains/narrative/adapters/briefAdapter
 */

import type {
  ContentAdapter,
  NarrativeEventInput,
  TemporalBounds,
  EventSignificance,
  BriefFeature,
  BriefSignal,
} from "./types";
import {
  briefPriorityToSignificance,
  getCurrentWeekNumber,
  getWeekNumberForDate,
  generateEventId,
  normalizeEntityKey,
  fnv1a32Hex,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// BRIEF FEATURE ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapter for converting Daily Brief features to NarrativeEvents.
 */
export const BriefFeatureAdapter: ContentAdapter<BriefFeature> = {
  toNarrativeEvents(feature: BriefFeature): NarrativeEventInput[] {
    if (!this.shouldCreateEvent(feature)) {
      return [];
    }

    const temporalBounds = this.extractTemporalBounds(feature);
    const entityKeys = this.extractEntityKeys(feature);
    const significance = this.computeSignificance(feature);

    // Extract source URLs from sourceRefs
    const sourceUrls = feature.sourceRefs?.urls || [];
    const sourceNames = sourceUrls.map((url) => extractDomain(url));

    // Generate citation IDs
    const citationIds = sourceUrls.map((url) => `websrc_${fnv1a32Hex(url)}`);

    const event: NarrativeEventInput = {
      headline: feature.name,
      summary: feature.testCriteria || feature.notes || `Brief feature: ${feature.type}`,
      significance,
      occurredAt: temporalBounds.occurredAt,
      weekNumber: getWeekNumberForDate(temporalBounds.occurredAt),
      sourceUrls,
      sourceNames,
      citationIds,
      discoveredByAgent: "BriefAdapter",
      agentConfidence: feature.status === "passing" ? 0.9 : 0.7,
      entityKeys,
      topicTags: [feature.type],
      sourceType: "brief_feature",
      sourceId: feature.id,
    };

    return [event];
  },

  extractEntityKeys(feature: BriefFeature): string[] {
    const keys: string[] = [];

    // Extract entities from feature name using simple NER patterns
    const companyPatterns = /\b(OpenAI|Google|Microsoft|Apple|Meta|Amazon|Anthropic|xAI|Tesla|Nvidia|DeepSeek|Mistral)\b/gi;
    const matches = feature.name.match(companyPatterns);

    if (matches) {
      for (const match of matches) {
        keys.push(normalizeEntityKey(match, "company"));
      }
    }

    // Add topic-based entity if type is recognizable
    if (feature.type) {
      keys.push(`topic:${feature.type.replace(/[^a-zA-Z0-9]/g, "_")}`);
    }

    return [...new Set(keys)]; // Deduplicate
  },

  computeSignificance(feature: BriefFeature): EventSignificance {
    return briefPriorityToSignificance(feature.priority);
  },

  extractTemporalBounds(feature: BriefFeature): TemporalBounds {
    return {
      occurredAt: feature.updatedAt,
      validFrom: feature.updatedAt,
    };
  },

  shouldCreateEvent(feature: BriefFeature): boolean {
    // Only create events for priority >= 5 or passing status
    const priority = feature.priority ?? 0;
    return priority >= 5 || feature.status === "passing";
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BRIEF SIGNAL ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended interface for Signal with temporal context
 */
interface BriefSignalWithContext extends BriefSignal {
  briefDate: string; // YYYY-MM-DD
  briefTimestamp: number;
}

/**
 * Adapter for converting Brief Signals (actII.signals) to NarrativeEvents.
 */
export const BriefSignalAdapter: ContentAdapter<BriefSignalWithContext> = {
  toNarrativeEvents(signal: BriefSignalWithContext): NarrativeEventInput[] {
    if (!this.shouldCreateEvent(signal)) {
      return [];
    }

    const temporalBounds = this.extractTemporalBounds(signal);
    const entityKeys = this.extractEntityKeys(signal);
    const significance = this.computeSignificance(signal);

    // Extract sources from evidence
    const sourceUrls = signal.evidence.map((e) => e.url).filter(Boolean);
    const sourceNames = signal.evidence.map((e) => e.title).filter(Boolean);
    const citationIds = sourceUrls.map((url) => `websrc_${fnv1a32Hex(url)}`);

    const event: NarrativeEventInput = {
      headline: signal.headline,
      summary: signal.synthesis,
      significance,
      occurredAt: temporalBounds.occurredAt,
      weekNumber: getWeekNumberForDate(temporalBounds.occurredAt),
      sourceUrls,
      sourceNames,
      citationIds,
      discoveredByAgent: "BriefAdapter",
      agentConfidence: 0.85, // Signals are curated content
      entityKeys,
      topicTags: signal.classification ? [signal.classification] : [],
      sourceType: "brief_feature",
      sourceId: signal.id,
    };

    return [event];
  },

  extractEntityKeys(signal: BriefSignalWithContext): string[] {
    const keys: string[] = [];
    const text = `${signal.headline} ${signal.synthesis}`;

    // Extract company mentions
    const companyPatterns = /\b(OpenAI|Google|Microsoft|Apple|Meta|Amazon|Anthropic|xAI|Tesla|Nvidia|DeepSeek|Mistral|Cursor|Kilo Code|Lovable)\b/gi;
    const companyMatches = text.match(companyPatterns);
    if (companyMatches) {
      for (const match of companyMatches) {
        keys.push(normalizeEntityKey(match, "company"));
      }
    }

    // Extract person mentions
    const personPatterns = /\b(Elon Musk|Sam Altman|Dario Amodei|Demis Hassabis|Sundar Pichai|Satya Nadella|Tim Cook|Jensen Huang)\b/gi;
    const personMatches = text.match(personPatterns);
    if (personMatches) {
      for (const match of personMatches) {
        keys.push(normalizeEntityKey(match, "person"));
      }
    }

    return [...new Set(keys)];
  },

  computeSignificance(signal: BriefSignalWithContext): EventSignificance {
    // Signals with high urgency are major events
    const urgency = signal.urgency?.toLowerCase() || "";
    if (urgency.includes("critical") || urgency.includes("urgent")) {
      return "major";
    }
    if (urgency.includes("high") || urgency.includes("important")) {
      return "moderate";
    }
    return "minor";
  },

  extractTemporalBounds(signal: BriefSignalWithContext): TemporalBounds {
    // Try to extract earliest evidence date
    const evidenceDates = signal.evidence
      .map((e) => e.publishedAt)
      .filter(Boolean)
      .map((d) => new Date(d!).getTime())
      .filter((t) => !isNaN(t));

    const earliestEvidence = evidenceDates.length > 0 ? Math.min(...evidenceDates) : signal.briefTimestamp;

    return {
      occurredAt: earliestEvidence,
      validFrom: earliestEvidence,
    };
  },

  shouldCreateEvent(signal: BriefSignalWithContext): boolean {
    // All signals should create events (they're already curated)
    return signal.headline.length > 0 && signal.synthesis.length > 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BATCH PROCESSING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process all features from a daily brief memory.
 */
export function processBriefFeatures(
  features: BriefFeature[],
  options?: { minPriority?: number }
): NarrativeEventInput[] {
  const minPriority = options?.minPriority ?? 5;

  return features
    .filter((f) => (f.priority ?? 0) >= minPriority || f.status === "passing")
    .flatMap((f) => BriefFeatureAdapter.toNarrativeEvents(f));
}

/**
 * Process all signals from a daily brief payload.
 */
export function processBriefSignals(
  signals: BriefSignal[],
  briefDate: string,
  briefTimestamp: number
): NarrativeEventInput[] {
  return signals.flatMap((signal) =>
    BriefSignalAdapter.toNarrativeEvents({
      ...signal,
      briefDate,
      briefTimestamp,
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract domain from URL.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
