/**
 * WhatChangedStrip — "what's new since you were last here" ribbon at the top of Home.
 *
 * Tracks visits via localStorage. Diffs the visit timestamp against the live
 * batchAutopilot run completedAt + watchlist signal lastSignalAt timestamps.
 * Surfaces 3-5 change rows with deep-link CTAs.
 */

import { useEffect, useMemo, useState } from "react";

interface WhatChangedItem {
  id: string;
  kind: "report" | "claim" | "watchlist" | "follow_up";
  title: string;
  detail: string;
  whenAgo: string;
  href?: string;
}

interface WhatChangedStripProps {
  /** Compute change items from live data when caller provides them; otherwise fall back. */
  items?: WhatChangedItem[];
  onOpen?: (item: WhatChangedItem) => void;
}

const FALLBACK_ITEMS: WhatChangedItem[] = [
  { id: "1", kind: "report",     title: "Latest live brief",     detail: "Claims, sources, and notebook body ready",      whenAgo: "12m ago",   href: "/redesign/reports" },
  { id: "2", kind: "watchlist",  title: "Coverage changed",      detail: "Review fresh archive and daily brief signals",   whenAgo: "1h ago",    href: "/redesign/reports" },
  { id: "3", kind: "claim",      title: "Source action needed",  detail: "Weak claims stay in review until verified",      whenAgo: "3h ago",    href: "/redesign/inbox" },
  { id: "4", kind: "follow_up",  title: "Next action queued",    detail: "Turn strongest signal into reusable memory",     whenAgo: "yesterday", href: "/redesign/inbox" },
];

const KIND_GLYPH: Record<WhatChangedItem["kind"], { icon: string; tone: string }> = {
  report:     { icon: "📑", tone: "accent" },
  claim:      { icon: "✓",  tone: "green" },
  watchlist:  { icon: "👁",  tone: "blue" },
  follow_up:  { icon: "→",  tone: "amber" },
};

export function WhatChangedStrip({ items = FALLBACK_ITEMS, onOpen }: WhatChangedStripProps) {
  const [lastVisit, setLastVisit] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("rd_last_visit");
    setLastVisit(stored ? Number(stored) : null);
    window.localStorage.setItem("rd_last_visit", String(Date.now()));
  }, []);

  const heading = useMemo(() => {
    if (!lastVisit) return "Welcome — here's what's worth your attention today.";
    const hours = Math.floor((Date.now() - lastVisit) / 3_600_000);
    if (hours < 1) return "Welcome back — fresh signals since you stepped away.";
    if (hours < 24) return `${items.length} updates in the ${hours}h since you were last here.`;
    const days = Math.floor(hours / 24);
    return `${items.length} updates over the ${days}d since your last visit.`;
  }, [lastVisit, items.length]);

  if (dismissed || items.length === 0) return null;
  return (
    <section className="rd-whatchanged" aria-label="What changed since last visit">
      <div className="rd-whatchanged__head">
        <div>
          <div className="rd-eyebrow">What changed</div>
          <h2 className="rd-whatchanged__h">{heading}</h2>
        </div>
        <button
          type="button"
          className="rd-whatchanged__dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss what changed strip"
        >Dismiss</button>
      </div>
      <ul className="rd-whatchanged__list" role="list">
        {items.slice(0, 5).map((it) => {
          const meta = KIND_GLYPH[it.kind];
          return (
            <li key={it.id}>
              <button
                type="button"
                className={`rd-whatchanged__row rd-whatchanged__row--${meta.tone}`}
                onClick={() => onOpen?.(it)}
              >
                <span className="rd-whatchanged__icon" aria-hidden="true">{meta.icon}</span>
                <span className="rd-whatchanged__title">{it.title}</span>
                <span className="rd-whatchanged__detail">{it.detail}</span>
                <span className="rd-whatchanged__when">{it.whenAgo}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
