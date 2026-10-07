/**
 * AINews-style daily-brief scaffolding for the LinkedIn pipeline.
 *
 * Pattern: provenance-first, number-dense newsletter digest.
 * Prior art:
 *   - Latent.Space / smol.ai "AINews" daily roundup
 *     https://www.latent.space/p/ainews-nvidia-cosmos-3-nemotron-3
 *     Borrowed mechanisms (not vibe):
 *       1. Bracketed top-3 headline  -> "[AINews] NVIDIA Cosmos 3, Nemotron 3 Ultra, and RTX Spark"
 *       2. The "we checked N sources" provenance line (the signature trust move)
 *       3. A top-story prose lead before the structured recap
 *       4. Number-first bullets with inline source links
 *   - NodeBench-original: maps that shape onto a LinkedIn 3-post thread under the
 *     GENERAL practitioner voice + LinkedIn sanitization constraints (no raw
 *     parens, no pipes — see CLAUDE.md "LinkedIn API posting rules").
 *
 * This module is intentionally dependency-free and pure so it can be unit-tested
 * in isolation (scenario_testing rule). The Convex action in dailyLinkedInPost.ts
 * composes these fragments into the final posts.
 *
 * See: CLAUDE.md "LinkedIn post pipeline" + "Voice principles (GENERAL persona)".
 */

/**
 * Structural subset of AgentDigestOutput that the brief scaffolding reads.
 * AgentDigestOutput is structurally assignable to this — callers pass the digest
 * directly. Keeping it local (not an import) keeps this module test-portable.
 */
export interface BriefDigest {
  narrativeThesis?: string;
  leadStory?: {
    title: string;
    url?: string;
    whyItMatters?: string;
  } | null;
  signals?: Array<{
    title: string;
    url?: string;
    summary?: string;
    hardNumbers?: string;
    directQuote?: string;
  }>;
  narrativeFraming?: {
    dominantStory: string;
    attentionShare: string;
    underReportedAngle: string;
  } | null;
  storyCount?: number;
  topSources?: string[];
  topCategories?: string[];
}

/** Normalize a title to a stable de-dup key (lead vs signal collision). */
export function storyKey(title: string | undefined | null): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Collapse whitespace + clip to `max` chars at a word boundary, adding an ellipsis. */
export function clip(text: string | undefined | null, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // Reserve room for the trailing ellipsis so output never exceeds `max`.
  const hardMax = Math.max(1, max - 3);
  const cut = t.slice(0, hardMax);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > hardMax * 0.6 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[.,;:\-\s]+$/, "").trimEnd() + "...";
}

/**
 * Reduce a full signal/story title to a short noun phrase for the headline.
 * Strips trailing parentheticals/brackets and punctuation, then word-clips.
 * No ellipsis — a headline segment should read as a clean name, not a fragment.
 */
export function shortenForHeadline(title: string | undefined | null, max = 44): string {
  let t = (title ?? "").replace(/\s+/g, " ").trim();
  // Drop a single trailing parenthetical / bracketed aside: "Cosmos 3 (omnimodal)" -> "Cosmos 3"
  t = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();
  // Signal titles are full sentences ("NVIDIA ships Cosmos 3, an omnimodal...").
  // AINews headlines are short noun phrases. Cut at the first clause boundary —
  // a comma/colon/semicolon or a subordinating connective — so we keep the head
  // noun phrase and drop the descriptive tail. NOTE: never break on a hyphen
  // (it lives inside "open-weight", "Quantum-X").
  const clauseBreak = t.match(/^(.*?)(?:[,:;]| (?:as|that|which|after|amid|with|while) )/i);
  if (clauseBreak && clauseBreak[1].trim().split(/\s+/).length >= 2) {
    t = clauseBreak[1].trim();
  }
  t = t.replace(/[.,;:\-\s]+$/, "").trim();
  if (t.length <= max) return t;
  // Word-clip to max. No ellipsis — a headline segment should read as a name.
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[.,;:\-\s]+$/, "").trim();
}

/** Oxford-comma join: [a] -> "a"; [a,b] -> "a and b"; [a,b,c] -> "a, b, and c". */
export function joinOxford(items: string[]): string {
  const a = items.filter((s) => Boolean(s && s.trim()));
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}

/** Top story titles for the headline: leadStory first, then de-duped signals. */
export function topStoryTitles(d: BriefDigest, n = 3): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    if (!raw || titles.length >= n) return;
    const short = shortenForHeadline(raw);
    const key = storyKey(short);
    if (!short || !key || seen.has(key)) return;
    seen.add(key);
    titles.push(short);
  };
  push(d.leadStory?.title ?? undefined);
  for (const s of d.signals ?? []) {
    if (titles.length >= n) break;
    push(s.title);
  }
  return titles;
}

/**
 * AINews-style headline. `label` brands the brief lane
 * (e.g. "Daily Brief", "Deal Flow Brief", "Tech Radar").
 */
export function buildBriefHeadline(d: BriefDigest, label = "Daily Brief"): string {
  const titles = topStoryTitles(d, 3);
  if (titles.length === 0) {
    const cat = (d.topCategories ?? []).find((c) => Boolean(c && c.trim()));
    return cat ? `[${label}] ${clip(cat, 60)} roundup` : `[${label}] What moved in AI and markets today`;
  }
  return clip(`[${label}] ${joinOxford(titles)}`, 150);
}

/** One-line "so what" dek under the headline. */
export function buildBriefDek(d: BriefDigest, max = 130): string {
  const framingDek = d.narrativeFraming
    ? `${d.narrativeFraming.dominantStory} is the loud story. ${d.narrativeFraming.underReportedAngle} is the one that matters.`
    : "";
  const dek =
    (d.narrativeThesis && d.narrativeThesis.trim()) ||
    framingDek ||
    (d.leadStory?.whyItMatters ?? "") ||
    "";
  return clip(dek, max);
}

/**
 * The signature AINews provenance line. HONEST_SCORES: every number printed is a
 * real measured count from the digest — never fabricated. If `storyCount` is
 * missing/zero we degrade to a count-free phrasing rather than invent coverage.
 *
 * @param shownCount how many signals the post actually surfaces.
 */
export function buildProvenanceLine(d: BriefDigest, shownCount: number): string {
  const scanned =
    typeof d.storyCount === "number" && Number.isFinite(d.storyCount) && d.storyCount > 0
      ? Math.floor(d.storyCount)
      : null;
  const sourceN = (d.topSources ?? []).filter((s) => Boolean(s && s.trim())).length;
  const shown = Math.max(1, Math.floor(shownCount) || 1);
  const noun = shown === 1 ? "signal" : "signals";

  if (scanned && sourceN > 0) {
    const storyWord = scanned === 1 ? "story" : "stories";
    const sourceWord = sourceN === 1 ? "source" : "sources";
    return `Scanned ${scanned} ${storyWord} across ${sourceN} ${sourceWord} today. Here are the ${shown} ${noun} that actually moved:`;
  }
  if (scanned) {
    const storyWord = scanned === 1 ? "story" : "stories";
    return `Scanned ${scanned} ${storyWord} today. Here are the ${shown} ${noun} that actually moved:`;
  }
  return `Here are today's ${shown} ${noun} that actually moved, with the numbers and the sources:`;
}

/** "Top sources:" provenance footer. Empty string when no sources are known. */
export function buildTopSourcesLine(d: BriefDigest, max = 3): string {
  const sources = (d.topSources ?? []).filter((s) => Boolean(s && s.trim())).slice(0, max);
  if (sources.length === 0) return "";
  return `Top sources: ${sources.join(", ")}.`;
}

/**
 * Prose lead for the single biggest story (leadStory, else the top signal).
 * Returns the line(s) plus the de-dup key of the title it consumed, so the
 * caller can skip re-listing that story in the numbered bullets.
 */
export function buildTopStoryLead(d: BriefDigest): { lines: string[]; consumedKey: string | null } {
  const lead = d.leadStory;
  const signals = d.signals ?? [];
  let title: string | undefined;
  let why: string | undefined;
  let url: string | undefined;

  if (lead?.title) {
    title = lead.title;
    why = lead.whyItMatters;
    url = lead.url;
  } else if (signals[0]?.title) {
    title = signals[0].title;
    why = signals[0].summary;
    url = signals[0].url;
  }

  if (!title) return { lines: [], consumedKey: null };

  const lines: string[] = [];
  const head = why ? `Lead: ${clip(title, 90)} -- ${clip(why, 200)}` : `Lead: ${clip(title, 130)}`;
  lines.push(clip(head, 300));
  if (url && url.trim()) lines.push(url.trim());

  return { lines, consumedKey: storyKey(shortenForHeadline(title)) };
}

/**
 * Join body lines into a post, guaranteeing the footer (e.g. "[1/3] #tags")
 * always survives. Plain length-cap truncation drops the footer when a post runs
 * long — this reserves the footer's budget first. Collapses 3+ blank lines.
 */
export function briefFooterCap(bodyLines: string[], footer: string, max = 1450): string {
  const footerBlock = footer && footer.trim() ? `\n\n${footer.trim()}` : "";
  let body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trimEnd();
  const budget = max - footerBlock.length;
  if (body.length > budget) {
    body = body.slice(0, Math.max(0, budget - 3)).trimEnd() + "...";
  }
  return body + footerBlock;
}

/** Thresholds for whether a digest can produce a publishable AINews-style brief. */
export interface DigestQualityThresholds {
  /** Minimum signals needed to build the top-3 headline + bullet list. */
  minSignals: number;
  /** Minimum signals carrying a hard number OR a source URL (the AINews density signal). */
  minDenseSignals: number;
}

export const DEFAULT_DIGEST_QUALITY: DigestQualityThresholds = {
  minSignals: 3,
  minDenseSignals: 2,
};

export interface DigestQualityResult {
  publishable: boolean;
  reason: string;
  signalCount: number;
  denseSignalCount: number;
}

/**
 * Quality gate: would this digest produce a publishable AINews-style brief?
 *
 * Used to decide whether a CHEAP/FREE model's output is good enough to publish,
 * or whether to fall through to a more expensive trusted model. The AINews format
 * leans on (a) enough distinct stories for the top-3 headline + bullets and
 * (b) number/source density in the bullets — so those are exactly what we check.
 *
 * HONEST_SCORES: every count is measured from the digest, never assumed. This is
 * a structural check only — it does not judge factual accuracy (the fact-check
 * layer owns that).
 */
export function assessDigestQuality(
  d: BriefDigest,
  thresholds: DigestQualityThresholds = DEFAULT_DIGEST_QUALITY,
): DigestQualityResult {
  const signals = (d.signals ?? []).filter((s) => Boolean(s && s.title && s.title.trim()));
  const signalCount = signals.length;
  const denseSignalCount = signals.filter(
    (s) => Boolean((s.hardNumbers && s.hardNumbers.trim()) || (s.url && s.url.trim())),
  ).length;
  const hasThesis = Boolean(d.narrativeThesis && d.narrativeThesis.trim());

  if (signalCount < thresholds.minSignals) {
    return { publishable: false, reason: `only ${signalCount} usable signals (need ${thresholds.minSignals})`, signalCount, denseSignalCount };
  }
  if (denseSignalCount < thresholds.minDenseSignals) {
    return { publishable: false, reason: `only ${denseSignalCount} signals carry a number or source (need ${thresholds.minDenseSignals})`, signalCount, denseSignalCount };
  }
  if (!hasThesis) {
    return { publishable: false, reason: "missing narrative thesis (no dek)", signalCount, denseSignalCount };
  }
  return { publishable: true, reason: "ok", signalCount, denseSignalCount };
}
