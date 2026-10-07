/**
 * changeDetector — pure differ that classifies topic-content changes into
 * "material" vs "low" / "medium" significance.
 *
 * Role (layered_memory.md + async_reliability.md):
 *   Feeds the nudge pipeline. Material changes surface as user-visible
 *   nudges; low-significance changes are logged but don't notify.
 *
 * Pure — same (previous, next) input always yields the same verdict.
 *
 * Significance rules (overridable by callers via weightOverrides):
 *   material — always notify:
 *     * new fact on "funding" topic (any new funding event matters)
 *     * new fact on "patent" (competitive moat signal)
 *     * new fact on "regulatory" (compliance risk)
 *     * new fact mentioning dollar amounts, round names, exec titles,
 *       acquisition language, or legal action
 *   medium — notify on first material-looking fact per session:
 *     * new fact on "founder" or "product" topics
 *     * new fact mentioning hiring / headcount / launch
 *   low — log only:
 *     * all other new facts (e.g. generic "news" chatter)
 *     * removed facts (compaction cap eviction is not a signal)
 */

export type SignificanceLevel = "low" | "medium" | "material";

export type ChangeDiff = {
  addedFacts: ReadonlyArray<{ text: string; observedAt: number }>;
  removedFacts: ReadonlyArray<{ text: string; observedAt: number }>;
  significance: SignificanceLevel;
  /** One-liner explaining WHY this was classified — used in the nudge summary. */
  reason: string;
};

/** Topics where ANY added fact is automatically "material". */
const ALWAYS_MATERIAL_TOPICS = new Set([
  "funding",
  "patent",
  "regulatory",
  "financial",
]);

/** Topics where a fact triggering medium-significance keywords becomes material. */
const CONTEXT_MATERIAL_TOPICS = new Set([
  "founder",
  "product",
  "competitor",
  "news",
  "hiring",
  "publicOpinion",
]);

/** Keywords that upgrade a fact to material significance anywhere. */
const MATERIAL_KEYWORDS = [
  /\$\s?\d[\d,]*(\.\d+)?\s?(m|b|k)?\b/i, // dollar amounts
  /\bseries [a-f]\b/i,
  /\bseed (round|funding|extension)\b/i,
  /\bacqui(red|sition|rer)\b/i,
  /\bmerg(ed|er)\b/i,
  /\bchapter \d+\b/i,
  /\blawsuit|settle|settled|sued|litigation\b/i,
  /\bsec (filing|investigation|settlement)\b/i,
  /\bipo\b/i,
  /\bC[EF]O|co-founder|founder|president\b/i,
];

/** Keywords that suggest medium significance (hiring / launch / exec moves). */
const MEDIUM_KEYWORDS = [
  /\bhir(ed|ing|ing manager)\b/i,
  /\b(head|vp|director) of\b/i,
  /\blaunch(ed|ing|es)?\b/i,
  /\bheadcount|team size|grew to\b/i,
  /\bpartner(ed|ship) with\b/i,
];

function factKey(text: string, sourceRefId?: string): string {
  return `${sourceRefId ?? ""}::${text}`;
}

function containsMaterial(text: string): boolean {
  return MATERIAL_KEYWORDS.some((r) => r.test(text));
}
function containsMedium(text: string): boolean {
  return MEDIUM_KEYWORDS.some((r) => r.test(text));
}

/**
 * Diff previous/next topic fact lists. Pure. Stable output order —
 * addedFacts sorted by observedAt desc, removedFacts sorted by observedAt
 * desc as well.
 */
export function diffTopicFacts(args: {
  topicName: string;
  previousFacts: ReadonlyArray<{ text: string; sourceRefId?: string; observedAt: number }>;
  nextFacts: ReadonlyArray<{ text: string; sourceRefId?: string; observedAt: number }>;
}): ChangeDiff {
  const prevKeys = new Set<string>();
  const prevByKey = new Map<
    string,
    { text: string; observedAt: number }
  >();
  for (const f of args.previousFacts) {
    const k = factKey(f.text, f.sourceRefId);
    prevKeys.add(k);
    prevByKey.set(k, { text: f.text, observedAt: f.observedAt });
  }

  const nextKeys = new Set<string>();
  const nextByKey = new Map<
    string,
    { text: string; observedAt: number }
  >();
  for (const f of args.nextFacts) {
    const k = factKey(f.text, f.sourceRefId);
    nextKeys.add(k);
    nextByKey.set(k, { text: f.text, observedAt: f.observedAt });
  }

  const added: Array<{ text: string; observedAt: number }> = [];
  for (const k of nextKeys) {
    if (!prevKeys.has(k)) {
      const row = nextByKey.get(k)!;
      added.push({ text: row.text, observedAt: row.observedAt });
    }
  }
  const removed: Array<{ text: string; observedAt: number }> = [];
  for (const k of prevKeys) {
    if (!nextKeys.has(k)) {
      const row = prevByKey.get(k)!;
      removed.push({ text: row.text, observedAt: row.observedAt });
    }
  }

  added.sort((a, b) => b.observedAt - a.observedAt);
  removed.sort((a, b) => b.observedAt - a.observedAt);

  // Classify significance. Caller owns what they do with it.
  if (added.length === 0) {
    return {
      addedFacts: [],
      removedFacts: removed,
      significance: "low",
      reason:
        removed.length > 0
          ? "facts evicted by compaction cap; not a real-world change"
          : "no changes",
    };
  }

  const alwaysMaterialTopic = ALWAYS_MATERIAL_TOPICS.has(args.topicName);
  let materialHit: string | null = null;
  let mediumHit: string | null = null;

  for (const f of added) {
    if (containsMaterial(f.text)) {
      materialHit = f.text;
      break;
    }
    if (containsMedium(f.text) && !mediumHit) {
      mediumHit = f.text;
    }
  }

  if (alwaysMaterialTopic || materialHit) {
    return {
      addedFacts: added,
      removedFacts: removed,
      significance: "material",
      reason: alwaysMaterialTopic
        ? `new ${args.topicName} fact — always notify`
        : `material keyword matched: "${materialHit!.slice(0, 80)}"`,
    };
  }

  if (CONTEXT_MATERIAL_TOPICS.has(args.topicName) && mediumHit) {
    return {
      addedFacts: added,
      removedFacts: removed,
      significance: "medium",
      reason: `medium-significance keyword: "${mediumHit.slice(0, 80)}"`,
    };
  }

  return {
    addedFacts: added,
    removedFacts: removed,
    significance: "low",
    reason: `${added.length} new ${args.topicName} fact${added.length === 1 ? "" : "s"} without material keywords`,
  };
}

/** Build a short user-facing nudge title + summary from a diff verdict. */
export function buildNudgeText(args: {
  entityLabel: string;
  topicName: string;
  diff: ChangeDiff;
}): { title: string; summary: string } {
  const first = args.diff.addedFacts[0];
  const count = args.diff.addedFacts.length;
  const topicCap = args.topicName.charAt(0).toUpperCase() + args.topicName.slice(1);
  const title =
    count > 1
      ? `${topicCap}: ${count} new facts on ${args.entityLabel}`
      : `${topicCap} change on ${args.entityLabel}`;
  const summary = first
    ? first.text.length > 160
      ? first.text.slice(0, 160) + "…"
      : first.text
    : "Topic updated.";
  return { title, summary };
}
