/**
 * signalMatcher.ts — Deterministic Signal↔Forecast Cross-Reference
 *
 * Matches today's digest signals to active forecasts using keyword overlap,
 * entity matching, and driver alignment. No LLM — pure text matching.
 *
 * Used by: dailyLinkedInPost.ts to add Δ badges to Post 1 signals
 *          and evidence→forecast links to Post 2 findings.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DigestSignal {
  title: string;
  summary: string;
  url?: string;
  hardNumbers?: string;
}

export interface DigestFinding {
  claim: string;
  status: "verified" | "partially_verified" | "unverified" | "false";
  explanation: string;
  source?: string;
  sourceUrl?: string;
}

export interface ActiveForecast {
  id: string;
  question: string;
  tags: string[];
  topDrivers: string[];
  topCounterarguments: string[];
  probability: number;
}

export interface ForecastUpdate {
  forecastId: string;
  previousProbability: number;
  newProbability: number;
  reasoning: string;
  updatedAt: number;
}

export interface SignalForecastMatch {
  forecastId: string;
  signalIndex: number;
  matchScore: number;
  matchReasons: string[];
  forecastQuestion: string;
  probabilityDelta?: { from: number; to: number };
}

export interface FindingForecastMatch {
  forecastId: string;
  findingIndex: number;
  matchScore: number;
  matchReasons: string[];
  forecastQuestion: string;
  direction: "supports" | "challenges" | "neutral";
  probabilityDelta?: number; // pp change
}

// ─── Stop Words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "and", "but", "or", "if", "it", "its",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "about", "up", "their", "they", "them", "we", "us", "our", "you",
  "your", "he", "she", "him", "her", "his", "i", "me", "my",
]);

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Extract meaningful tokens from text.
 * Keeps proper nouns (capitalized), numbers, and content words.
 * Removes stop words and short tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Extract likely named entities (capitalized multi-word sequences, acronyms).
 * Simple heuristic — no NER model.
 */
export function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // Capitalized sequences (e.g., "OpenAI", "GPT-5", "Federal Reserve")
  const capPattern = /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)*)\b/g;
  let match;
  while ((match = capPattern.exec(text)) !== null) {
    const entity = match[1];
    // Skip single-word entities that are just sentence starters
    if (entity.length > 2 && !/^(The|This|That|Here|When|Where|How|What|Which|Why|Will|Does|Has|And|But|For)$/.test(entity)) {
      entities.push(entity.toLowerCase());
    }
  }

  // Acronyms (2+ uppercase letters, optionally with digits)
  const acronymPattern = /\b([A-Z]{2,}[\d]*)\b/g;
  while ((match = acronymPattern.exec(text)) !== null) {
    entities.push(match[1].toLowerCase());
  }

  return [...new Set(entities)];
}

// ─── Matchers ─────────────────────────────────────────────────────────────────

/**
 * Match digest signals to active forecasts.
 * Returns scored matches above threshold, sorted by score descending.
 *
 * Scoring:
 *   +1 per shared content token (min 2 shared tokens for any score)
 *   +3 per shared entity
 *   +2 per tag match
 *   +2 per driver keyword match
 *
 * Threshold: score ≥ 3 to be considered a match.
 */
export function matchSignalsToForecasts(
  signals: DigestSignal[],
  forecasts: ActiveForecast[],
  recentUpdates?: ForecastUpdate[],
): SignalForecastMatch[] {
  const matches: SignalForecastMatch[] = [];
  const updatesByForecast = new Map<string, ForecastUpdate>();

  if (recentUpdates) {
    for (const u of recentUpdates) {
      const existing = updatesByForecast.get(u.forecastId);
      if (!existing || u.updatedAt > existing.updatedAt) {
        updatesByForecast.set(u.forecastId, u);
      }
    }
  }

  for (let si = 0; si < signals.length; si++) {
    const signal = signals[si];
    const signalText = `${signal.title} ${signal.summary} ${signal.hardNumbers || ""}`;
    const signalTokens = new Set(tokenize(signalText));
    const signalEntities = new Set(extractEntities(signalText));

    for (const forecast of forecasts) {
      let score = 0;
      const reasons: string[] = [];

      const forecastText = `${forecast.question} ${forecast.topDrivers.join(" ")} ${forecast.topCounterarguments.join(" ")}`;
      const forecastTokens = new Set(tokenize(forecastText));
      const forecastEntities = new Set(extractEntities(forecast.question));

      // 1. Token overlap
      let sharedTokens = 0;
      for (const token of signalTokens) {
        if (forecastTokens.has(token)) sharedTokens++;
      }
      if (sharedTokens >= 2) {
        score += sharedTokens;
        reasons.push(`${sharedTokens} shared keywords`);
      }

      // 2. Entity match (+3 per entity)
      let sharedEntities = 0;
      for (const entity of signalEntities) {
        if (forecastEntities.has(entity)) sharedEntities++;
      }
      if (sharedEntities > 0) {
        score += sharedEntities * 3;
        reasons.push(`${sharedEntities} entity match`);
      }

      // 3. Tag match (+2 per tag)
      const signalLower = signalText.toLowerCase();
      let tagMatches = 0;
      for (const tag of forecast.tags) {
        if (signalLower.includes(tag.toLowerCase())) {
          tagMatches++;
        }
      }
      if (tagMatches > 0) {
        score += tagMatches * 2;
        reasons.push(`${tagMatches} tag match`);
      }

      // 4. Driver keyword match (+2 per driver)
      let driverMatches = 0;
      const allDrivers = [...forecast.topDrivers, ...forecast.topCounterarguments];
      for (const driver of allDrivers) {
        const driverTokens = tokenize(driver);
        const overlap = driverTokens.filter((t) => signalTokens.has(t)).length;
        if (overlap >= 2) driverMatches++;
      }
      if (driverMatches > 0) {
        score += driverMatches * 2;
        reasons.push(`${driverMatches} driver match`);
      }

      if (score >= 3) {
        const update = updatesByForecast.get(forecast.id);
        matches.push({
          forecastId: forecast.id,
          signalIndex: si,
          matchScore: score,
          matchReasons: reasons,
          forecastQuestion: forecast.question,
          probabilityDelta: update
            ? { from: update.previousProbability, to: update.newProbability }
            : undefined,
        });
      }
    }
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Match fact-check findings to active forecasts.
 * Returns scored matches with direction (supports/challenges).
 *
 * Direction logic:
 *   - "verified" finding matching a forecast → supports (probability should rise)
 *   - "false" finding matching a forecast → challenges (probability should drop)
 *   - "partially_verified" → neutral
 *   - "unverified" → neutral
 */
export function matchFindingsToForecasts(
  findings: DigestFinding[],
  forecasts: ActiveForecast[],
  recentUpdates?: ForecastUpdate[],
): FindingForecastMatch[] {
  const matches: FindingForecastMatch[] = [];

  // Build update lookup for delta calculation
  const latestUpdate = new Map<string, ForecastUpdate>();
  if (recentUpdates) {
    for (const u of recentUpdates) {
      const existing = latestUpdate.get(u.forecastId);
      if (!existing || u.updatedAt > existing.updatedAt) {
        latestUpdate.set(u.forecastId, u);
      }
    }
  }

  for (let fi = 0; fi < findings.length; fi++) {
    const finding = findings[fi];
    const findingText = `${finding.claim} ${finding.explanation}`;
    const findingTokens = new Set(tokenize(findingText));
    const findingEntities = new Set(extractEntities(findingText));

    for (const forecast of forecasts) {
      let score = 0;
      const reasons: string[] = [];

      const forecastTokens = new Set(tokenize(forecast.question));
      const forecastEntities = new Set(extractEntities(forecast.question));

      // Token overlap
      let sharedTokens = 0;
      for (const token of findingTokens) {
        if (forecastTokens.has(token)) sharedTokens++;
      }
      if (sharedTokens >= 2) {
        score += sharedTokens;
        reasons.push(`${sharedTokens} shared keywords`);
      }

      // Entity match
      let sharedEntities = 0;
      for (const entity of findingEntities) {
        if (forecastEntities.has(entity)) sharedEntities++;
      }
      if (sharedEntities > 0) {
        score += sharedEntities * 3;
        reasons.push(`${sharedEntities} entity match`);
      }

      // Tag match
      const findingLower = findingText.toLowerCase();
      let tagMatches = 0;
      for (const tag of forecast.tags) {
        if (findingLower.includes(tag.toLowerCase())) tagMatches++;
      }
      if (tagMatches > 0) {
        score += tagMatches * 2;
        reasons.push(`${tagMatches} tag match`);
      }

      if (score >= 3) {
        // Determine direction from verification status
        let direction: "supports" | "challenges" | "neutral";
        if (finding.status === "verified") {
          direction = "supports";
        } else if (finding.status === "false") {
          direction = "challenges";
        } else {
          direction = "neutral";
        }

        const update = latestUpdate.get(forecast.id);
        const delta = update
          ? Math.round((update.newProbability - update.previousProbability) * 100)
          : undefined;

        matches.push({
          forecastId: forecast.id,
          findingIndex: fi,
          matchScore: score,
          matchReasons: reasons,
          forecastQuestion: forecast.question,
          direction,
          probabilityDelta: delta,
        });
      }
    }
  }

  return matches.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Format a short Δ badge for a signal that moved a forecast.
 * e.g., '📊 Moved "Will GPT-5 launch?" 62→68%'
 *
 * Max ~45 chars (fits within signal budget).
 */
export function formatDeltaBadge(
  question: string,
  from: number,
  to: number,
): string {
  const shortQ = question.length > 30 ? question.slice(0, 28) + ".." : question;
  const fromPct = Math.round(from * 100);
  const toPct = Math.round(to * 100);
  // Use chart emoji that works on LinkedIn (no custom emoji)
  return `Moved "${shortQ}" ${fromPct}\u2192${toPct}%`;
}

/**
 * Format an evidence link for a finding that affects a forecast.
 * e.g., '→ Supports "Will GPT-5 launch?" [+6pp]'
 *
 * Max ~50 chars.
 */
export function formatEvidenceLink(
  question: string,
  direction: "supports" | "challenges" | "neutral",
  deltaPp?: number,
): string {
  const shortQ = question.length > 25 ? question.slice(0, 23) + ".." : question;
  const verb = direction === "supports" ? "Supports" : direction === "challenges" ? "Challenges" : "Relates to";
  const delta = deltaPp != null ? ` [${deltaPp >= 0 ? "+" : ""}${deltaPp}pp]` : "";
  return `\u2192 ${verb} "${shortQ}"${delta}`;
}
