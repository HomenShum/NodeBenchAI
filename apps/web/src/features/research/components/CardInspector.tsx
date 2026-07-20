/**
 * CardInspector — right-side inspector pane for expanded card detail.
 *
 * Pattern: Workspace shell right-inspector (contextual detail + drill action)
 * Prior art:
 *   - docs/design/nodebench-ai-design-system/ui_kits/nodebench-workspace/Report.jsx
 *     (CardInspector @ line 318; `ws-inspector-*` classes from workspace.css)
 *
 * Ported to production React + Tailwind. The kit uses `window.WS_DATA.entities[id]`
 * fixtures; prod receives a `ResourceCard` directly (chips + keyFacts + evidenceRefs
 * + nextHops) with an onDrill callback that promotes the card to root.
 *
 * Visual contract (matches kit):
 *   - 360px fixed width column on lg+
 *   - Rounded 16px (kit uses 20px; we honor the glass-card DNA of 16px/xl in prod)
 *   - Sticky inspector header with close button
 *   - Dark glass surface: border-white/[0.06] bg-white/[0.02]
 *   - Kicker (uppercase tracked) + title + subtitle
 *   - Metrics grid fallback to keyFacts when metrics are not modeled
 *   - Actions block: Promote to root (drill) + Pin + Watch
 *
 * Accessibility:
 *   - aria-label on close button
 *   - role="complementary" on the aside so screen readers know it's auxiliary
 *   - Primary action button has focus-visible ring
 */

import { useMemo } from "react";
import { X, Network, Bell, Layers } from "lucide-react";
import type {
  ResourceCard,
  ResourceUri,
} from "../../../../shared/research/resourceCards";

export interface CardInspectorProps {
  card: ResourceCard | null;
  onDrill: (uri: ResourceUri) => void;
  onClose: () => void;
}

export function CardInspector({ card, onDrill, onClose }: CardInspectorProps) {
  // Memoize derived kicker + confidence so we don't recompute on every keypress
  // in the surrounding surface.
  const derived = useMemo(() => {
    if (!card) return null;
    const kicker = kickerForCardKind(card.kind);
    const confidencePct = Math.round(
      Math.max(0, Math.min(1, card.confidence)) * 100,
    );
    return { kicker, confidencePct };
  }, [card]);

  if (!card || !derived) {
    return (
      <aside
        role="complementary"
        aria-label="Card inspector"
        data-testid="card-inspector-empty"
        className="hidden lg:flex h-full w-[360px] shrink-0 flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md"
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
            Inspector
          </div>
          <div className="text-sm text-white/60">
            Select a card to inspect
          </div>
          <div className="max-w-[220px] text-[11px] leading-relaxed text-white/35">
            Click any card in the columns to the left to see its evidence,
            relations, and drill actions here.
          </div>
        </div>
      </aside>
    );
  }

  const { kicker, confidencePct } = derived;

  return (
    <aside
      role="complementary"
      aria-label={`Inspector for ${card.title}`}
      data-testid="card-inspector"
      className="hidden lg:flex h-full w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md"
    >
      {/* Sticky header — ws-inspector-header parity */}
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-[0.2em] text-white/45">
            {kicker}
          </div>
          <h3 className="mt-1 truncate text-[15px] font-semibold text-white">
            {card.title}
          </h3>
          {card.subtitle && (
            <div className="mt-0.5 truncate text-[11.5px] text-white/55">
              {card.subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          title="Close inspector"
          className="shrink-0 rounded-md p-1 text-white/60 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/70"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Chips row (if any) */}
        {card.chips && card.chips.length > 0 && (
          <section className="mb-4 flex flex-wrap gap-1.5">
            {card.chips.map((chip, i) => (
              <span
                key={`${chip.label}-${i}`}
                className={chipClass(chip.tone)}
              >
                {chip.label}
              </span>
            ))}
          </section>
        )}

        {/* At-a-glance: key facts grid (metrics fallback) */}
        {card.keyFacts && card.keyFacts.length > 0 && (
          <section className="mb-4">
            <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
              At a glance
            </h4>
            <ul className="grid grid-cols-1 gap-1.5">
              {card.keyFacts.slice(0, 6).map((fact, i) => (
                <li
                  key={i}
                  className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2.5 py-1.5 font-mono text-[11.5px] leading-snug text-white/75"
                >
                  {fact}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Summary */}
        <section className="mb-4">
          <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
            Summary
          </h4>
          <p className="text-[12.5px] leading-[1.55] text-white/75">
            {card.summary || "No summary available for this card."}
          </p>
        </section>

        {/* Confidence meter (HONEST_SCORES: renders the actual card.confidence) */}
        <section className="mb-4">
          <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
            Confidence
          </h4>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[#d97757]"
                style={{ width: `${confidencePct}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-white/60">
              {confidencePct}%
            </span>
          </div>
        </section>

        {/* Evidence refs */}
        {card.evidenceRefs && card.evidenceRefs.length > 0 && (
          <section className="mb-4">
            <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
              Evidence ({card.evidenceRefs.length})
            </h4>
            <ul className="flex flex-col gap-1">
              {card.evidenceRefs.slice(0, 6).map((uri, i) => (
                <li
                  key={uri}
                  className="truncate rounded-md border border-white/[0.04] bg-white/[0.015] px-2 py-1 font-mono text-[10.5px] text-white/55"
                  title={uri}
                >
                  <span className="mr-1.5 text-white/40">[{i + 1}]</span>
                  {formatUriShort(uri)}
                </li>
              ))}
              {card.evidenceRefs.length > 6 && (
                <li className="px-2 text-[10.5px] text-white/40">
                  +{card.evidenceRefs.length - 6} more
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Relations / next hops */}
        {card.nextHops && card.nextHops.length > 0 && (
          <section className="mb-4">
            <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
              Relations ({card.nextHops.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {card.nextHops.slice(0, 8).map((uri) => (
                <button
                  key={uri}
                  type="button"
                  onClick={() => onDrill(uri)}
                  title={`Drill into ${uri}`}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 font-mono text-[10.5px] text-white/70 transition hover:border-[#d97757]/40 hover:bg-[#d97757]/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/70"
                >
                  {formatUriShort(uri)}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Actions */}
        <section>
          <h4 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-white/45">
            Actions
          </h4>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onDrill(card.uri)}
              data-testid="card-inspector-promote"
              className="flex items-center gap-2 rounded-md border border-[#d97757]/40 bg-[#d97757]/10 px-3 py-2 text-left text-[12px] font-medium text-white transition hover:bg-[#d97757]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/70"
            >
              <Network size={13} aria-hidden="true" />
              <span className="truncate">Promote to root</span>
            </button>
            <button
              type="button"
              disabled
              title="Watch for changes (coming soon)"
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[12px] text-white/50"
            >
              <Bell size={13} aria-hidden="true" />
              <span>Watch for changes</span>
            </button>
            <button
              type="button"
              disabled
              title="Pin to notebook (coming soon)"
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[12px] text-white/50"
            >
              <Layers size={13} aria-hidden="true" />
              <span>Pin to notebook</span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function kickerForCardKind(kind: ResourceCard["kind"]): string {
  switch (kind) {
    case "org_summary":
      return "organization";
    case "person_summary":
      return "person";
    case "product_summary":
      return "product";
    case "event_summary":
      return "event";
    case "topic_summary":
      return "topic";
    case "signal_summary":
      return "signal";
    case "evidence_ref":
      return "evidence";
    default:
      return "card";
  }
}

function chipClass(tone: "default" | "accent" | "warn" | "positive" | undefined): string {
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium tracking-tight";
  switch (tone) {
    case "accent":
      return `${base} border-[#d97757]/40 bg-[#d97757]/10 text-[#f4a57a]`;
    case "warn":
      return `${base} border-amber-500/40 bg-amber-500/10 text-amber-200`;
    case "positive":
      return `${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`;
    default:
      return `${base} border-white/[0.08] bg-white/[0.03] text-white/70`;
  }
}

/**
 * Trim `nodebench://kind/long-id-string` to a short display label.
 * Never throws — degrades gracefully on malformed input.
 */
function formatUriShort(uri: ResourceUri): string {
  const afterScheme = uri.replace(/^nodebench:\/\//, "");
  if (afterScheme.length <= 48) return afterScheme;
  return `${afterScheme.slice(0, 45)}…`;
}

export default CardInspector;
