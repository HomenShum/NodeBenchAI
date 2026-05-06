/**
 * CardStack — the primary graph traversal UX.
 *
 * Spec rules:
 *   - max 3 active columns
 *   - breadcrumb always visible
 *   - return to root always visible
 *   - older columns collapse
 *   - sources one click away
 *
 * Card anatomy: title · type badge · summary · why-it-matters · key facts ·
 * relationship pills · claims · sources · actions (Pin / Promote-to-root /
 * Compare / Add-to-notebook / Ask-about-this / Export).
 */

import { useState } from "react";
import type { CardStackEntity } from "../fixtures";
import { Pill } from "./Pill";

interface CardStackProps {
  rootId: string;
}

const cardStackEntities: Record<string, CardStackEntity> = {
  live_root: {
    id: "live_root",
    type: "event",
    title: "Live report",
    subtitle: "Artifact root",
    whyItMatters: "Cards explain a live report by turning claims, sources, follow-ups, and themes into drillable nodes.",
    facts: [
      { label: "Status", value: "Awaiting live artifact" },
      { label: "Use", value: "Open Reports, then Explore" },
    ],
    pills: [{ label: "graph-ready", tone: "blue" }],
    claims: [{ idx: 1, text: "Every card should trace back to a live artifact or source row.", status: "review" }],
    sources: 0,
    nextHops: [
      { id: "claim_node", label: "Claim", type: "topic", subtitle: "Needs evidence" },
      { id: "source_node", label: "Source", type: "topic", subtitle: "Verification row" },
    ],
  },
  claim_node: {
    id: "claim_node",
    type: "topic",
    title: "Claim",
    subtitle: "Reviewable assertion",
    whyItMatters: "Claims are useful only when they retain evidence, confidence, and review state.",
    facts: [{ label: "State", value: "needs review" }],
    pills: [{ label: "claim", tone: "amber" }],
    claims: [{ idx: 2, text: "Attach a source before marking verified.", status: "review" }],
    sources: 0,
    nextHops: [{ id: "source_node", label: "Source", type: "topic", subtitle: "Evidence trail" }],
  },
  source_node: {
    id: "source_node",
    type: "topic",
    title: "Source",
    subtitle: "Evidence row",
    whyItMatters: "Sources prove claims and keep the notebook auditable after export.",
    facts: [{ label: "Access", value: "open evidence drawer" }],
    pills: [{ label: "source", tone: "green" }],
    claims: [{ idx: 3, text: "Source rows should include title, refresh time, excerpt, and link when available.", status: "verified" }],
    sources: 1,
    nextHops: [],
  },
};

export function CardStack({ rootId }: CardStackProps) {
  const initialRootId = cardStackEntities[rootId] ? rootId : "live_root";
  const [path, setPath] = useState<string[]>([initialRootId]);

  // Render strategy: only the LAST 3 cards are active. Earlier ones collapse to crumbs.
  const visible = path.slice(-3);
  const collapsed = path.slice(0, -3);

  const promote = (id: string) => setPath([id]);
  const drillTo = (id: string, idx: number) => {
    // Drill from card at index idx → push id (truncating any deeper history)
    setPath([...path.slice(0, idx + 1), id]);
  };
  const back = () => setPath((p) => (p.length > 1 ? p.slice(0, -1) : p));

  return (
    <div className="rd-stack" style={{ gap: 16, padding: "20px 24px 32px", height: "100%", overflow: "hidden" }}>
      {/* Breadcrumb */}
      <nav aria-label="Card stack path" className="rd-row" style={{ gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setPath([path[0]])}
          className="rd-btn rd-btn--quiet rd-btn--sm"
          style={{ padding: "3px 8px" }}
        >
          ← Root
        </button>
        {collapsed.length > 0 && (
          <span className="rd-pill" style={{ background: "var(--rd-muted)" }}>+{collapsed.length} hops</span>
        )}
        {path.map((id, i) => {
          const ent = cardStackEntities[id];
          if (!ent) return null;
          const isLast = i === path.length - 1;
          return (
            <span key={id} className="rd-row" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => setPath(path.slice(0, i + 1))}
                className="rd-btn rd-btn--quiet rd-btn--sm"
                disabled={isLast}
                style={{
                  padding: "3px 8px",
                  fontWeight: isLast ? 590 : 510,
                  color: isLast ? "var(--rd-ink-strong)" : "var(--rd-ink-mute)",
                }}
              >{ent.title}</button>
              {!isLast && <span style={{ color: "var(--rd-ink-faint)", fontSize: 12 }}>›</span>}
            </span>
          );
        })}
        {path.length > 1 && (
          <button
            type="button"
            onClick={back}
            className="rd-btn rd-btn--quiet rd-btn--sm"
            style={{ marginLeft: "auto" }}
          >← Back</button>
        )}
      </nav>

      {/* Active 3-column stack */}
      <div style={{
        display: "grid",
        gridTemplateColumns: visible.length === 3 ? "1fr 1fr 1fr" : visible.length === 2 ? "1fr 1fr" : "minmax(0, 720px)",
        gap: 14,
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}>
        {visible.map((id, i) => {
          const ent = cardStackEntities[id];
          if (!ent) return null;
          const realIdx = path.length - visible.length + i;
          const isActive = i === visible.length - 1;
          return (
            <CardColumn
              key={`${id}-${realIdx}`}
              entity={ent}
              isActive={isActive}
              onPromote={() => promote(id)}
              onDrill={(nid) => drillTo(nid, realIdx)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CardColumnProps {
  entity: CardStackEntity;
  isActive: boolean;
  onPromote: () => void;
  onDrill: (id: string) => void;
}

function CardColumn({ entity, isActive, onPromote, onDrill }: CardColumnProps) {
  return (
    <article
      className="rd-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 18,
        height: "100%",
        overflow: "auto",
        borderColor: isActive ? "var(--rd-accent-ring)" : "var(--rd-line)",
        boxShadow: isActive ? "var(--rd-shadow-md)" : "var(--rd-shadow-xs)",
        opacity: isActive ? 1 : 0.92,
      }}
    >
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-row" style={{ gap: 6 }}>
          <TypeBadge type={entity.type} />
          {entity.pills.map((p, i) => (
            <Pill key={i} tone={p.tone}>{p.label}</Pill>
          ))}
        </div>
        <h2 className="rd-h2" style={{ fontSize: 17 }}>{entity.title}</h2>
        <p className="rd-mono" style={{ fontSize: 11.5, color: "var(--rd-ink-soft)" }}>{entity.subtitle}</p>
      </header>

      {entity.whyItMatters && (
        <section className="rd-card rd-card__pad-tight" style={{ background: "var(--rd-accent-tint)", borderColor: "var(--rd-accent-ring)" }}>
          <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)", fontSize: 10 }}>Why it matters</div>
          <p className="rd-body" style={{ marginTop: 4, fontSize: 12.5 }}>{entity.whyItMatters}</p>
        </section>
      )}

      {entity.facts.length > 0 && (
        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Key facts</div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: 0, fontSize: 12 }}>
            {entity.facts.map((f, i) => (
              <FactRow key={i} {...f} />
            ))}
          </dl>
        </section>
      )}

      {entity.claims && entity.claims.length > 0 && (
        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Claims</div>
          <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
            {entity.claims.map((c) => (
              <li key={c.idx} className="rd-row" style={{ gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                <span className={`rd-dot rd-dot--${c.status === "verified" ? "live" : "review"}`} style={{ marginTop: 5, flexShrink: 0 }} />
                <span style={{ color: "var(--rd-ink-mute)", flex: 1 }}>
                  <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-accent-strong)", marginRight: 6 }}>[{c.idx}]</span>
                  {c.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entity.nextHops.length > 0 && (
        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Next hops</div>
          <ul className="rd-stack" style={{ gap: 4, listStyle: "none", padding: 0, margin: 0 }}>
            {entity.nextHops.map((hop) => (
              <li key={hop.id}>
                <button
                  type="button"
                  onClick={() => onDrill(hop.id)}
                  className="rd-btn rd-btn--quiet"
                  style={{
                    padding: "8px 10px",
                    width: "100%",
                    justifyContent: "flex-start",
                    gap: 10,
                    background: "var(--rd-paper-warm)",
                    border: "1px solid var(--rd-line)",
                  }}
                >
                  <TypeBadge type={hop.type} compact />
                  <span className="rd-stack" style={{ alignItems: "flex-start", gap: 1, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 590, color: "var(--rd-ink-strong)" }}>{hop.label}</span>
                    <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{hop.subtitle}</span>
                  </span>
                  <span style={{ color: "var(--rd-ink-soft)", fontSize: 14 }}>→</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="rd-row" style={{ gap: 4, paddingTop: 10, borderTop: "1px solid var(--rd-line-faint)", flexWrap: "wrap" }}>
        {entity.sources !== undefined && (
          <button className="rd-btn rd-btn--ghost rd-btn--sm">
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            {entity.sources} sources
          </button>
        )}
        <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onPromote} title="Make this the new root">
          ⤴ Promote
        </button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm">Pin</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm">Add to notebook</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm">Ask</button>
      </footer>
    </article>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: "var(--rd-ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10, paddingTop: 2 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--rd-ink)", fontWeight: 510 }}>{value}</dd>
    </>
  );
}

function TypeBadge({ type, compact }: { type: CardStackEntity["type"]; compact?: boolean }) {
  const map: Record<CardStackEntity["type"], { label: string; bg: string; color: string; icon: string }> = {
    event: { label: "Event", bg: "var(--rd-blue-bg)", color: "var(--rd-blue)", icon: "M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4" },
    company: { label: "Company", bg: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)", icon: "M3 21V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v16M3 21h18M9 9h.01M9 13h.01M9 17h.01M13 9h.01M13 13h.01M13 17h.01" },
    person: { label: "Person", bg: "var(--rd-green-bg)", color: "var(--rd-green)", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" },
    topic: { label: "Topic", bg: "var(--rd-amber-bg)", color: "var(--rd-amber)", icon: "M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" },
  };
  const m = map[type];
  if (compact) {
    return (
      <span style={{
        width: 24, height: 24, borderRadius: 6, background: m.bg, color: m.color,
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={m.icon} /></svg>
      </span>
    );
  }
  return (
    <span className="rd-pill" style={{ background: m.bg, color: m.color, borderColor: m.color, opacity: 0.9 }}>
      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={m.icon} /></svg>
      {m.label}
    </span>
  );
}
