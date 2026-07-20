/**
 * SlashMenu — Notion-style block-insert popover.
 *
 * Trigger: anchor coords (where the caret sits) + filter text.
 * Picks: emit an HTML snippet that the editor inserts at the caret.
 *
 * Categories mirror Notion's block-type menu, augmented with NodeBench-specific
 * blocks (Claim, Follow-up, Source list, Entity link).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

export interface SlashOption {
  id: string;
  group: "Basic" | "Lists" | "NodeBench" | "AI";
  title: string;
  hint: string;
  icon: ReactNode;
  insertHtml: string;
}

const ALL_OPTIONS: SlashOption[] = [
  { id: "h1", group: "Basic", title: "Heading 1", hint: "Large section title", icon: "H1", insertHtml: "<h1>Heading</h1>" },
  { id: "h2", group: "Basic", title: "Heading 2", hint: "Medium section title", icon: "H2", insertHtml: "<h2>Heading</h2>" },
  { id: "h3", group: "Basic", title: "Heading 3", hint: "Small section title", icon: "H3", insertHtml: "<h3>Heading</h3>" },
  { id: "p", group: "Basic", title: "Paragraph", hint: "Plain text", icon: "¶", insertHtml: "<p></p>" },
  { id: "quote", group: "Basic", title: "Quote", hint: "Pull quote with accent border", icon: "“", insertHtml: "<blockquote><p>Quote</p></blockquote>" },
  { id: "divider", group: "Basic", title: "Divider", hint: "Horizontal rule", icon: "—", insertHtml: "<hr />" },

  { id: "ul", group: "Lists", title: "Bulleted list", hint: "Ordered with bullets", icon: "•", insertHtml: "<ul><li>Item</li></ul>" },
  { id: "ol", group: "Lists", title: "Numbered list", hint: "Ordered list", icon: "1.", insertHtml: "<ol><li>Item</li></ol>" },

  {
    id: "claim", group: "NodeBench", title: "Claim", hint: "Citable assertion with status + source", icon: "✓",
    insertHtml: `<div data-block="claim" data-status="review"><p>State the claim here.</p></div><p></p>`,
  },
  {
    id: "follow-up", group: "NodeBench", title: "Follow-up", hint: "Action item with owner + due", icon: "→",
    insertHtml: `<div data-block="follow-up" data-due="this-week"><p>What's the next action?</p></div><p></p>`,
  },
  {
    id: "source-list", group: "NodeBench", title: "Source list", hint: "Numbered citations panel", icon: "[n]",
    insertHtml: `<div data-block="source-list"><ol><li>New source · refreshed today</li></ol></div><p></p>`,
  },
  {
    id: "entity", group: "NodeBench", title: "Entity link", hint: "Roam-style [[link]] to a tracked entity", icon: "[[",
    insertHtml: `<a class="rd-entity-link" href="#" data-entity="">Untitled entity</a>`,
  },

  {
    id: "ai-improve", group: "AI", title: "Ask AI to improve selection", hint: "Rewrites the selected text in your voice", icon: "✦",
    insertHtml: `<p><strong>(Ask AI runs against the selection — wired to the agent runtime in production.)</strong></p>`,
  },
  {
    id: "ai-summary", group: "AI", title: "Summarize this report", hint: "Distill claims + risks into a 3-line memo", icon: "✦",
    insertHtml: `<blockquote><p><strong>Summary:</strong> AI summary appears here once the agent runs against the saved notebook content.</p></blockquote>`,
  },
];

interface SlashMenuProps {
  anchor: { top: number; left: number } | null;
  query: string;
  onSelect: (opt: SlashOption) => void;
  onClose: () => void;
}

export function SlashMenu({ anchor, query, onSelect, onClose }: SlashMenuProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ALL_OPTIONS;
    return ALL_OPTIONS.filter((o) =>
      o.title.toLowerCase().includes(q) || o.hint.toLowerCase().includes(q) || o.id.includes(q)
    );
  }, [query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (filtered[activeIdx]) {
          e.preventDefault();
          onSelect(filtered[activeIdx]);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anchor, filtered, activeIdx, onSelect, onClose]);

  if (!anchor) return null;
  if (filtered.length === 0) {
    return (
      <div
        className="rd-slash-menu"
        role="listbox"
        aria-label="Block types"
        style={{ top: anchor.top, left: anchor.left }}
      >
        <div className="rd-slash-menu__header">No matches</div>
      </div>
    );
  }

  // Group by .group preserving the order of ALL_OPTIONS
  const grouped: Array<[string, SlashOption[]]> = [];
  for (const opt of filtered) {
    const last = grouped[grouped.length - 1];
    if (last && last[0] === opt.group) last[1].push(opt);
    else grouped.push([opt.group, [opt]]);
  }

  let renderIdx = 0;

  return (
    <div
      className="rd-slash-menu"
      role="listbox"
      aria-label="Block types"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {grouped.map(([group, opts]) => (
        <div key={group}>
          <div className="rd-slash-menu__header">{group}</div>
          {opts.map((o) => {
            const idx = renderIdx++;
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={idx === activeIdx}
                className={`rd-slash-menu__item ${idx === activeIdx ? "active" : ""}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(o)}
              >
                <span className="rd-slash-menu__icon">{o.icon}</span>
                <span>
                  <span className="rd-slash-menu__title">{o.title}</span>
                  <span className="rd-slash-menu__hint">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
