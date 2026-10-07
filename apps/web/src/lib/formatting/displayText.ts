const PROFESSIONAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmicroslop\b/gi, "Microsoft"],
  [/\bmicro-slop\b/gi, "Microsoft"],
];

const SOURCE_LABEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^github$/i, "GitHub"],
  [/^arxiv$/i, "arXiv"],
  [/^techcrunch$/i, "TechCrunch"],
  [/^hackernews$/i, "Hacker News"],
  [/^twitter(?:\/x)?$/i, "Twitter/X"],
  [/^y[\s-]?combinator(?:\s+news)?$/i, "Hacker News"],
  [/^ycombinator$/i, "Hacker News"],
  [/^r\/(.+)$/i, "Reddit / $1"],
];

export function sanitizeDocumentTitle(title: unknown, fallback = "Untitled"): string {
  const raw = String(title ?? "").trim();
  if (!raw) return fallback;
  const collapsedDuplicateExtension = raw.replace(/(\.[a-z0-9]{1,8})(?:\1)+$/i, "$1");
  return collapsedDuplicateExtension || fallback;
}

export function normalizeNumericDisplay(text: string): string {
  return text.replace(/\b(\d{1,3}(?:,\s\d{3})+)\b/g, (match) => match.replace(/,\s+/g, ","));
}

export function sanitizeProfessionalText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PROFESSIONAL_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeReadableText(text: unknown): string {
  const raw = String(text ?? "");
  return normalizeNumericDisplay(sanitizeProfessionalText(raw));
}

export function normalizeSourceLabel(source: unknown, fallback = "Source"): string {
  const raw = sanitizeReadableText(source).trim();
  if (!raw) return fallback;
  const subredditMatch = raw.match(/^r\/(.+)$/i);
  if (subredditMatch) {
    const cleaned = subredditMatch[1]
      .split(/[\/_-]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return `Reddit / ${cleaned || "Source"}`;
  }

  for (const [pattern, replacement] of SOURCE_LABEL_REPLACEMENTS) {
    if (pattern.test(raw)) {
      return raw.replace(pattern, replacement);
    }
  }

  return raw;
}

export function sanitizeSignalSummary(summary: unknown, source?: unknown): string {
  const raw = sanitizeReadableText(summary).trim();
  if (!raw) return "";

  const normalizedSource = normalizeSourceLabel(source, "the source");

  return raw
    .replace(
      /Trending on Hacker News with [\d,]+ points and [\d,]+ comments\.?/gi,
      "Trending on Hacker News.",
    )
    .replace(
      /Discussion on (r\/[a-z0-9_+-]+) with [\d,]+ comments\.?/gi,
      (_match, subreddit) => `Active discussion on ${normalizeSourceLabel(subreddit)}.`,
    )
    .replace(
      /Article from ([^.]+)\.?/gi,
      (_match, provider) => `New article from ${normalizeSourceLabel(provider)}.`,
    )
    .replace(
      /Posted by ([^.]+)\.?/gi,
      (_match, provider) => `Posted via ${normalizeSourceLabel(provider)}.`,
    )
    .replace(/\s{2,}/g, " ")
    .replace(/^from\s+/i, `From ${normalizedSource}: `)
    .trim();
}
