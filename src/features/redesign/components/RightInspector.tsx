/**
 * RightInspector — chat-page right rail.
 *
 * Spec: active entity card · graph preview · sources · prior threads · report status.
 */

import { Pill } from "./Pill";
import { useLiveArtifacts, type LiveArtifactDetail } from "../hooks/useLiveArtifacts";

export function RightInspector() {
  const liveArtifacts = useLiveArtifacts(12);
  const detail = liveArtifacts.details[0];
  const title = detail?.title ?? "Current report";
  const summary = detail?.summary ?? "Ask a question, capture a note, or open a live artifact to hydrate this inspector.";
  const sources = detail?.sourceRows.slice(0, 4) ?? [];
  const nodes = detail?.nodes.slice(0, 5) ?? [];

  return (
    <aside className="rd-pane rd-pane--right" style={{ padding: "20px 18px", gap: 16 }}>
      {/* Report status */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-eyebrow">Report status</div>
        <div className="rd-row--between" style={{ marginTop: 8 }}>
          <span className="rd-h3">{title}</span>
          <Pill tone="green"><span className="rd-dot rd-dot--live" />{detail ? `Updated ${detail.updatedAt}` : "Ready"}</Pill>
        </div>
        <div className="rd-row" style={{ gap: 12, fontSize: 11, color: "var(--rd-ink-soft)", marginTop: 8 }}>
          <span>{detail?.sourceCount ?? 0} sources</span>
          <span>{detail?.claimCount ?? 0} claims</span>
          <span>{detail?.followUps ?? 0} follow-ups</span>
        </div>
      </section>

      {/* Active entity card */}
      <section className="rd-card rd-card__pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="rd-eyebrow">{detail ? "Active live artifact" : "Active context"}</div>
        <h3 className="rd-h2" style={{ fontSize: 16 }}>{title}</h3>
        <p className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)", margin: 0 }}>
          {detail?.kind ?? "No live artifact selected"}
        </p>
        <p className="rd-body" style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: 0 }}>{summary}</p>
        <div className="rd-row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {(detail?.tags ?? ["Ask", "Capture", "Report"]).slice(0, 4).map((tag, i) => <Pill key={`${tag}-${i}`} tone={i === 0 ? "accent" : undefined}>{tag}</Pill>)}
        </div>
      </section>

      {/* Graph preview */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-row--between">
          <div className="rd-eyebrow">Graph preview</div>
          <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ padding: "1px 6px", fontSize: 10 }}>Open Map</button>
        </div>
        <svg viewBox="0 0 240 120" width="100%" height={120} style={{ marginTop: 8 }}>
          <GraphPreview detail={detail} nodes={nodes} />
        </svg>
      </section>

      {/* Sources */}
      <section className="rd-card rd-card__pad-tight">
        <div className="rd-eyebrow">Sources used ({sources.length} / {detail?.sourceCount ?? 0})</div>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {(sources.length ? sources.map((source) => source.title) : ["Open a live artifact to hydrate source rows"]).map((s, i) => (
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
            { title: detail ? `Review ${detail.kind.toLowerCase()} claims` : "Start a research thread", when: detail?.updatedAt ?? "now" },
            { title: detail ? "Open notebook handoff" : "Attach sources", when: "next" },
            { title: detail ? "Export reusable memory" : "Create report", when: "later" },
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

function GraphPreview({ detail, nodes }: { detail?: LiveArtifactDetail; nodes: Array<{ title: string }> }) {
  if (!detail) {
    return (
      <>
        <circle cx={120} cy={60} r={20} fill="var(--rd-accent-soft)" stroke="var(--rd-accent)" strokeWidth={1.2} />
        <text x={120} y={64} textAnchor="middle" fontSize={9} fontWeight={590} fill="var(--rd-accent-strong)">Live</text>
      </>
    );
  }
  const outer = nodes.slice(1, 5);
  const positions = [
    { cx: 50, cy: 30 },
    { cx: 50, cy: 90 },
    { cx: 190, cy: 30 },
    { cx: 190, cy: 90 },
  ];
  return (
    <>
      <g stroke="var(--rd-line-strong)" strokeWidth={1} fill="none">
        {outer.map((_, i) => <path key={i} d={`M 120,60 L ${positions[i].cx},${positions[i].cy}`} />)}
      </g>
      <circle cx={120} cy={60} r={18} fill="var(--rd-accent-soft)" stroke="var(--rd-accent)" strokeWidth={1.2} />
      <text x={120} y={64} textAnchor="middle" fontSize={9} fontWeight={590} fill="var(--rd-accent-strong)">Root</text>
      {outer.map((node, i) => <NodeDot key={node.title} cx={positions[i].cx} cy={positions[i].cy} label={node.title.slice(0, 10)} />)}
    </>
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
