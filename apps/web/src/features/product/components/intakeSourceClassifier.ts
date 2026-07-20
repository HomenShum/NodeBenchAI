/**
 * intakeSourceClassifier — pure classifier that extracts structured source
 * hints from a free-form intake input (text + files).
 *
 * Covers the pitch-line claim: "ingests recruiter notes, LinkedIn URLs,
 * pitch decks, and bios from a single input."
 *
 * Outputs a typed catalog of detected sources so the UI can:
 *   - Show "Detected: 2 LinkedIn profiles · 1 pitch deck" affordance
 *   - Route each source to the right backend pipeline
 *
 * Pure — no I/O, no regex-only fragile matching. Every classifier function
 * is deterministic and unit-tested.
 */

export type IntakeSourceKind =
  | "linkedin_url"
  | "github_url"
  | "twitter_url"
  | "product_hunt_url"
  | "press_release_url"
  | "generic_url"
  | "pitch_deck_file"
  | "bio_file"
  | "founder_note"
  | "recruiter_note"
  | "free_text";

export type IntakeSource =
  | { kind: "linkedin_url"; url: string; slug?: string }
  | { kind: "github_url"; url: string; owner?: string; repo?: string }
  | { kind: "twitter_url"; url: string; handle?: string }
  | { kind: "product_hunt_url"; url: string; slug?: string }
  | { kind: "press_release_url"; url: string; host: string }
  | { kind: "generic_url"; url: string; host: string }
  | { kind: "pitch_deck_file"; fileName: string; sizeBytes?: number }
  | { kind: "bio_file"; fileName: string; sizeBytes?: number }
  | { kind: "founder_note"; text: string }
  | { kind: "recruiter_note"; text: string }
  | { kind: "free_text"; text: string };

const URL_REGEX = /https?:\/\/[^\s<>()]+/gi;
const LINKEDIN_SLUG_REGEX = /linkedin\.com\/(?:in|company)\/([A-Za-z0-9._-]+)/i;
const GITHUB_REPO_REGEX = /github\.com\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9._-]+))?/i;
const TWITTER_HANDLE_REGEX = /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i;
const PRODUCT_HUNT_REGEX = /producthunt\.com\/(?:posts|products)\/([A-Za-z0-9-]+)/i;

/** Hosts commonly used for press / funding announcements — broadens "press_release_url". */
const PRESS_HOSTS = new Set([
  "techcrunch.com",
  "theinformation.com",
  "crunchbase.com",
  "businesswire.com",
  "prnewswire.com",
  "bloomberg.com",
  "reuters.com",
  "axios.com",
  "venturebeat.com",
  "wired.com",
]);

function safeHost(urlLike: string): string {
  try {
    return new URL(urlLike).host.toLowerCase();
  } catch {
    return "";
  }
}

/** Normalize a URL: trim trailing punctuation that regex greedily captures. */
function trimUrlJunk(raw: string): string {
  return raw.replace(/[),.;!?]+$/g, "");
}

/** Classify a single URL into one of the URL source kinds. */
export function classifyUrl(raw: string): IntakeSource {
  const url = trimUrlJunk(raw);
  const host = safeHost(url);

  const liMatch = url.match(LINKEDIN_SLUG_REGEX);
  if (liMatch) return { kind: "linkedin_url", url, slug: liMatch[1] };

  const ghMatch = url.match(GITHUB_REPO_REGEX);
  if (ghMatch) {
    return {
      kind: "github_url",
      url,
      owner: ghMatch[1],
      repo: ghMatch[2],
    };
  }

  const twMatch = url.match(TWITTER_HANDLE_REGEX);
  if (twMatch) return { kind: "twitter_url", url, handle: twMatch[1] };

  const phMatch = url.match(PRODUCT_HUNT_REGEX);
  if (phMatch) return { kind: "product_hunt_url", url, slug: phMatch[1] };

  if (PRESS_HOSTS.has(host)) {
    return { kind: "press_release_url", url, host };
  }

  return { kind: "generic_url", url, host };
}

/** Extract all URLs from a text blob and classify each. */
export function extractUrls(text: string): ReadonlyArray<IntakeSource> {
  if (!text) return [];
  const urls = text.match(URL_REGEX) ?? [];
  // De-dupe by normalized URL — users paste the same link twice.
  const seen = new Set<string>();
  const result: IntakeSource[] = [];
  for (const raw of urls) {
    const url = trimUrlJunk(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(classifyUrl(url));
  }
  return result;
}

/** Recruiter-note shape markers — simple heuristics, BOUNDED regex set. */
const RECRUITER_MARKERS = [
  /\brecruit(er|ing)\b/i,
  /\bhiring manager\b/i,
  /\btake home\b/i,
  /\bjob spec\b/i,
  /\brole:\s/i,
  /\bcandidate profile\b/i,
];

const FOUNDER_NOTE_MARKERS = [
  /\bfounder\b/i,
  /\bCEO\b/,
  /\bCTO\b/,
  /\bco-?founder\b/i,
  /\bex-\w+/i, // ex-Google, ex-Stripe
];

export function classifyText(text: string): IntakeSource {
  const t = text.trim();
  if (t.length === 0) return { kind: "free_text", text: "" };
  // Text is short enough that simple boolean checks are fine.
  const isRecruiter = RECRUITER_MARKERS.some((r) => r.test(t));
  if (isRecruiter) return { kind: "recruiter_note", text: t };
  const isFounder = FOUNDER_NOTE_MARKERS.some((r) => r.test(t));
  if (isFounder) return { kind: "founder_note", text: t };
  return { kind: "free_text", text: t };
}

/** File extensions typically used for pitch decks. */
const PITCH_DECK_EXTS = [".pdf", ".pptx", ".key", ".ppt"];
const BIO_EXTS = [".pdf", ".docx", ".doc", ".md", ".txt"];

function extOf(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? `.${m[1]}` : "";
}

/** Classify a file by (name, size). Pitch decks vs bios are ambiguous by
 *  extension alone — we use filename hints to disambiguate and fall back
 *  to bio_file if uncertain (since bio is the broader kind). */
export function classifyFile(
  fileName: string,
  sizeBytes?: number,
): IntakeSource {
  const ext = extOf(fileName);
  const lower = fileName.toLowerCase();
  const hintsDeck =
    lower.includes("deck") ||
    lower.includes("pitch") ||
    lower.includes("seed") ||
    lower.includes("seriesa") ||
    lower.includes("series-a") ||
    lower.includes("investor");
  const hintsBio =
    lower.includes("bio") ||
    lower.includes("resume") ||
    lower.includes("cv") ||
    lower.includes("profile");

  if (hintsDeck && PITCH_DECK_EXTS.includes(ext)) {
    return { kind: "pitch_deck_file", fileName, sizeBytes };
  }
  if (hintsBio && BIO_EXTS.includes(ext)) {
    return { kind: "bio_file", fileName, sizeBytes };
  }
  // Extension-only fallback.
  if (ext === ".pptx" || ext === ".key" || ext === ".ppt") {
    return { kind: "pitch_deck_file", fileName, sizeBytes };
  }
  if (ext === ".pdf") {
    // PDFs are ambiguous — prefer deck if filename is shortish (deck), else bio.
    return hintsDeck
      ? { kind: "pitch_deck_file", fileName, sizeBytes }
      : { kind: "bio_file", fileName, sizeBytes };
  }
  return { kind: "bio_file", fileName, sizeBytes };
}

/** Classify an entire intake blob (text + files) into a deduped source list. */
export function classifyIntake(args: {
  text?: string;
  files?: ReadonlyArray<{ name: string; size?: number }>;
}): ReadonlyArray<IntakeSource> {
  const out: IntakeSource[] = [];
  const urlSources = args.text ? extractUrls(args.text) : [];
  out.push(...urlSources);

  // Classify the text residue (with URLs stripped) as note/free-text.
  if (args.text) {
    const stripped = args.text.replace(URL_REGEX, "").trim();
    if (stripped.length > 0) {
      out.push(classifyText(stripped));
    }
  }

  for (const f of args.files ?? []) {
    out.push(classifyFile(f.name, f.size));
  }
  return out;
}

/** Render a human summary of a source catalog. Used in the UI affordance. */
export function summarizeSources(sources: ReadonlyArray<IntakeSource>): string {
  if (sources.length === 0) return "";
  const counts: Record<string, number> = {};
  for (const s of sources) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  }
  const labels: Record<string, (n: number) => string> = {
    linkedin_url: (n) => `${n} LinkedIn ${n === 1 ? "profile" : "profiles"}`,
    github_url: (n) => `${n} GitHub ${n === 1 ? "repo" : "repos"}`,
    twitter_url: (n) => `${n} X/Twitter ${n === 1 ? "handle" : "handles"}`,
    product_hunt_url: (n) => `${n} Product Hunt ${n === 1 ? "post" : "posts"}`,
    press_release_url: (n) => `${n} press ${n === 1 ? "article" : "articles"}`,
    generic_url: (n) => `${n} web ${n === 1 ? "link" : "links"}`,
    pitch_deck_file: (n) => `${n} pitch ${n === 1 ? "deck" : "decks"}`,
    bio_file: (n) => `${n} bio/${n === 1 ? "resume" : "resumes"}`,
    founder_note: (n) => `${n} founder ${n === 1 ? "note" : "notes"}`,
    recruiter_note: (n) => `${n} recruiter ${n === 1 ? "note" : "notes"}`,
    free_text: () => `free-form text`,
  };
  const parts = Object.entries(counts)
    .map(([k, n]) => (labels[k] ? labels[k](n) : `${n} ${k}`))
    .sort();
  return parts.join(" · ");
}
