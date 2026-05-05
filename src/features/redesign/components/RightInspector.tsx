/**
 * RightInspector — chat-page right rail.
 *
 * Spec: active entity card · graph preview · sources · prior threads · report status.
 */

import { Pill } from "./Pill";
import { cardStackEntities } from "../fixtures";

export function RightInspector() {
  const ent = cardStackEntities.orbital;

  return (
    <aside className="rd-pane rd-pane--right" style={{ padding: "20px 18px", gap: 16 }}>
      {/* Report status */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-eyebrow">Report status</div>
        <div className="rd-row--between" style={{ marginTop: 8 }}>
          <span className="rd-h3">Orbital Labs</span>
          <Pill tone="green"><span className="rd-dot rd-dot--live" />Saved 12s ago</Pill>
        </div>
        <div className="rd-row" style={{ gap: 12, fontSize: 11, color: "var(--rd-ink-soft)", marginTop: 8 }}>
          <span>14 sources</span>
          <span>7 claims</span>
          <span>3 follow-ups</span>
        </div>
      </section>

      {/* Active entity card */}
      <section className="rd-card rd-card__pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rd-eyebrow">Active entity</div>
        <h3 className="rd-h2" style={{ fontSize: 16 }}>{ent.title}</h3>
        <p className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)", margin: 0 }}>{ent.subtitle}</p>
        {ent.whyItMatters && (
          <p className="rd-body" style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: 0 }}>{ent.whyItMatters}</p>
        )}
        <div className="rd-row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {ent.pills.map((p, i) => <Pill key={i} tone={p.tone}>{p.label}</Pill>)}
        </div>
      </section>

      {/* Graph preview */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-row--between">
          <div className="rd-eyebrow">Graph preview</div>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "1px 6px", fontSize: 10 }}>Open Map</button>
        </div>
        <svg viewBox="0 0 240 120" width="100%" height={120} style={{ marginTop: 8 }}>
          <g stroke="var(--rd-line-strong)" strokeWidth={1} fill="none">
            <path d="M 120,60 L 50,30" />
            <path d="M 120,60 L 50,90" />
            <path d="M 120,60 L 190,30" />
            <path d="M 120,60 L 190,90" />
          </g>
          <circle cx={120} cy={60} r={18} fill="var(--rd-accent-soft)" stroke="var(--rd-accent)" strokeWidth={1.2} />
          <text x={120} y={64} textAnchor="middle" fontSize={9} fontWeight={590} fill="var(--rd-accent-strong)">Orbital</text>
          <NodeDot cx={50} cy={30} label="Alex" />
          <NodeDot cx={50} cy={90} label="Voice" />
          <NodeDot cx={190} cy={30} label="Pilot" />
          <NodeDot cx={190} cy={90} label="Health" />
        </svg>
      </section>

      {/* Sources */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-eyebrow">Sources used (4 / 14)</div>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {[
            "Orbital Labs whitepaper, p.4",
            "Founder note, Ship Demo Day",
            "Notion meeting recap, Apr 30",
            "TechCrunch coverage, Mar 2026",
          ].map((s, i) => (
            <li key={i} className="rd-row" style={{ gap: 8, fontSize: 12 }}>
              <span className="rd-mono" style={{
                fontSize: 10, background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)",
                padding: "1px 5px", borderRadius: 3,
              }}>[{i + 1}]</span>
              <span style={{ flex: 1, color: "var(--rd-ink-mute)" }}>{s}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Prior threads */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-eyebrow">Prior threads</div>
        <ul className="rd-stack" style={{ gap: 4, listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {[
            { title: "Pilot timeline + procurement", when: "Yesterday" },
            { title: "Founder background check", when: "3d ago" },
            { title: "Initial discovery (Ship Demo Day)", when: "Mon" },
          ].map((t, i) => (
            <li key={i}>
              <button className="rd-btn rd-btn--quiet" style={{ width: "100%", justifyContent: "flex-start", padding: "5px 8px" }}>
                <span style={{ flex: 1, textAlign: "left", fontSize: 12 }}>{t.title}</span>
                <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{t.when}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function NodeDot({ cx, cy, label }: { cx: number; cy: number; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="var(--rd-paper)" stroke="var(--rd-line-strong)" strokeWidth={1} />
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize={9} fill="var(--rd-ink-mute)">{label}</text>
    </g>
  );
}
