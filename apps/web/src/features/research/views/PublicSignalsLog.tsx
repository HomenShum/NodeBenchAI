import { useMemo, useState, useCallback } from "react";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../../convex/_generated/api";
import ReactMarkdown from "react-markdown";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sanitizeReadableText } from "@/lib/displayText";

function utcDayString(ms = Date.now()): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayLabel(isoDay: string): string {
  const [yyyy, mm, dd] = isoDay.split("-").map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toLocaleDateString('en-US', { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function offsetDay(isoDay: string, offset: number): string {
  const [yyyy, mm, dd] = isoDay.split("-").map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd + offset));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const KIND_LABELS: Record<string, string> = {
  daily_brief: 'Daily Brief',
  daily_snapshot: 'Snapshot',
  signal: 'Signal',
  linkedin_funding: 'Funding',
  linkedin_post: 'Post',
  news: 'News',
  research: 'Research',
  repo: 'Repository',
  product: 'Product',
  alert: 'Alert',
};

function formatKindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Sanitize markdown content from API — replace raw slugs with readable labels,
 *  hide nonsensical trend indicators (e.g., "0.0% (Rising)"). */
function formatUrlLabel(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function repairMojibake(text: string): string {
  return text
    .replace(/Ã¢â‚¬â€|â€”/g, "—")
    .replace(/Ã¢â‚¬â€œ|â€“/g, "–")
    .replace(/Ã¢â‚¬Â¢|â€¢/g, "•")
    .replace(/Ã¢â‚¬Â¦|â€¦/g, "...")
    .replace(/Â·/g, "·")
    .replace(/Â/g, "");
}

function sanitizeSignalMarkdown(raw: unknown): string {
  const input = sanitizeReadableText(raw);
  const normalized = repairMojibake(input).replace(/\r\n/g, "\n");
  const mapped = normalized
    .replace(/\bai_ml\b/gi, "AI & ML")
    .replace(/\bopen_source\b/gi, "Open Source")
    .replace(/\bopensource\b/gi, "Open Source")
    .replace(/\bmachine_learning\b/gi, "Machine Learning")
    .replace(/\bdeep_learning\b/gi, "Deep Learning")
    .replace(/\bdata_science\b/gi, "Data Science")
    .replace(/\bnatural_language_processing\b/gi, "NLP")
    .replace(/\bcomputer_vision\b/gi, "Computer Vision");

  // NOTE(coworker): Keep this sanitization conservative. We only remove repetitive
  // formatting artifacts from automated dossiers, not factual source lines.
  const cleanedLines: string[] = [];
  for (const originalLine of mapped.split("\n")) {
    let line = originalLine
      .replace(/\[?Open Full Dashboard\]?\([^)]*\)/gi, "")
      .replace(/\[?Open Signals Log\]?\([^)]*\)/gi, "")
      .replace(/\s*\[?Dashboard\]?\(\/[^)]*\)/gi, "")
      .replace(/\s+Dashboard\s*$/gi, "")
      .replace(/\s+Source\s*$/g, "")
      .replace(/\s+(Source|Dashboard)(?:\s+\1)+\s*$/gi, " $1")
      .replace(/(\bSource\b|\bDashboard\b)\s+(?=\1\b)/gi, "");

    const trimmed = line.trim();
    if (
      /^(?:\*+\s*)?source[:]?$/i.test(trimmed) ||
      /^(?:\*+\s*)?dashboard[:]?$/i.test(trimmed) ||
      /^(?:\*+\s*)?\[source\]\([^)]*\)$/i.test(trimmed)
    ) {
      continue;
    }

    if (trimmed === "" && cleanedLines[cleanedLines.length - 1]?.trim() === "") {
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines
    .join("\n")
    .replace(/\b0\.0%?\s*\((Rising|Falling)\)/gi, "0.0%")
    .replace(
      /\b(\d{4,})\b(?=\s+(?:points?|comments?|upvotes?|likes?|views?|items?|stories?|sources?)\b)/gi,
      (_full, digits) => Number(digits).toLocaleString("en-US"),
    )
    .replace(
      /\b(?!(?:19|20)\d{2}\b)(\d{4,})\b/g,
      (_full, digits) => Number(digits).toLocaleString("en-US"),
    )
    .replace(/\bWhat this means for\./gi, "What this means")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toMarkdownPreview(markdown: string, maxLines = 22): { text: string; truncated: boolean } {
  const lines = markdown.split("\n");
  if (lines.length <= maxLines) {
    return { text: markdown, truncated: false };
  }
  const preview = lines.slice(0, maxLines).join("\n").trimEnd();
  return {
    text: `${preview}\n\n...`,
    truncated: true,
  };
}

export function PublicSignalsLog() {
  const [day, setDay] = useState<string>(() => utcDayString());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dayNavFeedback, setDayNavFeedback] = useState<"prev" | "next" | null>(null);
  const today = utcDayString();
  const isToday = day === today;

  const prevDay = useCallback(() => {
    setDayNavFeedback("prev");
    setDay((d) => offsetDay(d, -1));
  }, []);

  const nextDay = useCallback(() => {
    setDayNavFeedback("next");
    setDay((d) => offsetDay(d, 1));
  }, []);

  useEffect(() => {
    if (!dayNavFeedback) return;
    const timer = window.setTimeout(() => setDayNavFeedback(null), 220);
    return () => window.clearTimeout(timer);
  }, [dayNavFeedback]);

  const entries = useQuery((api as any).domains.landing.landingPageLog.listPublic, {
    day,
    limit: 250,
  }) as Array<any> | undefined;

  const sorted = useMemo(() => {
    const list = entries ?? [];
    return [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [entries]);

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame-narrow">
          <div className="flex items-center gap-3 mb-6">
            <div>
              <h1 className="type-page-title text-content">Signals</h1>
              <p className="type-caption mt-0.5">Research events captured throughout the day — articles, data points, insights</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={prevDay}
                aria-label="Previous day"
                className={`p-1.5 rounded-md hover:bg-surface-secondary text-content-secondary hover:text-content transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${dayNavFeedback === "prev" ? "bg-surface-secondary ring-2 ring-primary/30" : ""}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="relative">
                <span className="block px-3 py-1 text-sm border border-edge rounded-md bg-surface text-content min-w-[160px] text-center">
                  {formatDayLabel(day)}
                </span>
                <input
                  id="signals-day"
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  aria-label="Select date"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
              </div>
              <button
                type="button"
                onClick={nextDay}
                disabled={isToday}
                aria-label="Next day"
                className={`p-1.5 rounded-md hover:bg-surface-secondary text-content-secondary hover:text-content transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${dayNavFeedback === "next" ? "bg-surface-secondary ring-2 ring-primary/30" : ""}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="nb-surface-card flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <p className="text-base font-semibold text-content mb-2">No signals for {formatDayLabel(day)}</p>
              <p className="text-sm text-content-secondary max-w-xs">Signals are research events captured throughout the day — articles, data points, and insights. Use the arrows above to navigate to a different date.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sorted.map((e) => (
                <div key={String(e._id)} className="nb-surface-card group p-4 transition-colors hover:border-edge-strong">
                  {(() => {
                    const entryId = String(e._id);
                    const markdown = sanitizeSignalMarkdown(e.markdown ?? "");
                    const expanded = expandedIds.has(entryId);
                    const preview = toMarkdownPreview(markdown);
                    const displayMarkdown = expanded || !preview.truncated ? markdown : preview.text;

                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-0.5 rounded bg-surface-secondary text-content">
                            {formatKindLabel(e.kind)}
                          </div>
                          <div className="text-sm font-semibold text-content">
                            {sanitizeReadableText(repairMojibake(String(e.title ?? "")))}
                          </div>
                          <div className="ml-auto text-xs text-content-secondary">
                            {typeof e.createdAt === "number"
                              ? new Date(e.createdAt).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : ""}
                          </div>
                        </div>

                        {e.url ? (
                          <div className="mt-1 text-xs">
                            <a
                              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-primary transition-colors hover:border-primary/35 hover:bg-primary/10 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                              href={e.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {formatUrlLabel(e.url)}
                              <ChevronRight className="h-3 w-3" />
                            </a>
                          </div>
                        ) : null}

                        <div className="nb-prose mt-3">
                          <ReactMarkdown>{displayMarkdown}</ReactMarkdown>
                        </div>

                        {preview.truncated && (
                          <button
                            type="button"
                            aria-pressed={expanded}
                            onClick={() => {
                              setExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(entryId)) next.delete(entryId);
                                else next.add(entryId);
                                return next;
                              });
                            }}
                            className={`mt-2 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                              expanded
                                ? "border-primary/35 bg-primary/10 text-primary shadow-sm"
                                : "border-edge bg-surface-secondary text-content-secondary hover:border-edge-strong hover:bg-surface hover:text-content"
                            }`}
                          >
                            <span>{expanded ? "Show less" : "Show full briefing"}</span>
                            <span className="text-[10px] uppercase tracking-[0.16em]">
                              {expanded ? "Expanded" : "Preview"}
                            </span>
                          </button>
                        )}

                        {Array.isArray(e.tags) && e.tags.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {e.tags.map((t: string) => (
                              <span key={t} className="text-xs px-2 py-0.5 rounded border border-primary/25 bg-primary/10 text-primary">
                                {t.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
