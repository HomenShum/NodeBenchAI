import React, { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import changelogMarkdown from "../data/CHANGELOG.md?raw";

type ChangelogEntry = {
  id: string;
  version: string;
  dateLabel: string;
  title: string;
  bodyMarkdown: string;
};

function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const re = /^###\s+(v[0-9.]+)\s*\(([^)]+)\)\s*$/gm;
  const matches = Array.from(markdown.matchAll(re));
  if (matches.length === 0) return entries;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    const headerLine = match[0];
    const version = match[1];
    const dateLabel = match[2];
    const body = markdown.slice(start + headerLine.length, end).trim();
    entries.push({
      id: `${version}-${dateLabel}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      version,
      dateLabel,
      title: `${version} (${dateLabel})`,
      bodyMarkdown: body,
    });
  }

  return entries;
}

export default function ProductChangelogPanel() {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => parseChangelog(changelogMarkdown), []);
  const latestId = entries[0]?.id ?? null;
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const haystack = `${e.title}\n${e.bodyMarkdown}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query]);

  const handleJumpTo = (id: string) => {
    const el = entryRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-content">Changelog</h2>
          <p className="text-sm text-content-secondary">Product updates and release notes.</p>
        </div>
        <div className="text-xs text-content-secondary">
          {entries.length ? `${entries.length} releases` : "No releases found"}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="bg-surface dark:bg-white/[0.03] border border-edge rounded-lg p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search releases..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-edge rounded-md bg-surface text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="mt-3 space-y-1">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => handleJumpTo(e.id)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors",
                    e.id === latestId ? "text-content font-semibold" : "text-content-secondary",
                    "hover:bg-surface-hover",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{e.version}</span>
                    {e.id === latestId ? (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/30 text-content border border-indigo-200 dark:border-indigo-900/50">
                        Latest
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-content-muted truncate">{e.dateLabel}</div>
                </button>
              ))}
              {filtered.length === 0 ? (
                <div className="py-6 text-sm text-content-secondary text-center">No matches.</div>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {filtered.map((e) => (
            <section
              key={e.id}
              ref={(node) => {
                entryRefs.current[e.id] = node;
              }}
              className="bg-surface border border-edge rounded-lg p-5"
            >
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="text-xs font-bold text-content">{e.version}</div>
                <div className="text-xs text-content-secondary">{e.dateLabel}</div>
                {e.id === latestId ? (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/30 text-content border border-indigo-200 dark:border-indigo-900/50">
                    Latest
                  </span>
                ) : null}
              </div>

              <div className="prose prose-sm max-w-none prose-headings:scroll-mt-24">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.bodyMarkdown}</ReactMarkdown>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
