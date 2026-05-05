/**
 * Workspace — the deep intelligence surface.
 *
 * Tabs: Brief · Cards · Notebook · Sources · Chat · Map.
 * Mounted at /redesign/workspace. Spec: separate deployed surface, not a sixth tab in main app.
 */

import { useState } from "react";
import { CardStack } from "../components/CardStack";
import { Pill } from "../components/Pill";
import { ChatSurface } from "./ChatSurface";
import { ReportNotebookView } from "../components/ReportNotebookView";
import { cardStackEntities, sampleAnswer } from "../fixtures";

type Tab = "brief" | "cards" | "notebook" | "sources" | "chat" | "map";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "brief", label: "Brief", hint: "Read summary" },
  { id: "cards", label: "Cards", hint: "Graph traversal" },
  { id: "notebook", label: "Notebook", hint: "Editable artifact" },
  { id: "sources", label: "Sources", hint: "Verify claims" },
  { id: "chat", label: "Chat", hint: "Resume agent thread" },
  { id: "map", label: "Map", hint: "Wide-angle relationships" },
];

interface WorkspaceSurfaceProps {
  reportId?: string;
  initialTab?: Tab;
}

export function WorkspaceSurface({ reportId = "rep_orbital", initialTab = "brief" }: WorkspaceSurfaceProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const root = cardStackEntities.orbital;

  return (
    <div className="rd-stack" style={{ height: "100%", overflow: "hidden" }}>
      {/* Workspace header */}
      <header style={{
        padding: "16px 28px",
        borderBottom: "1px solid var(--rd-line-faint)",
        background: "var(--rd-paper)",
        flexShrink: 0,
      }}>
        <div className="rd-row" style={{ gap: 8 }}>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
            REPORTS / {reportId.toUpperCase()}
          </span>
          <span style={{ color: "var(--rd-ink-faint)" }}>›</span>
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink)" }}>WORKSPACE</span>
        </div>

        <div className="rd-row--between" style={{ marginTop: 10 }}>
          <div className="rd-stack" style={{ gap: 6 }}>
            <h1 className="rd-h1" style={{ fontSize: 22 }}>{root.title}</h1>
            <div className="rd-row" style={{ gap: 8, fontSize: 11.5, color: "var(--rd-ink-soft)" }}>
              <Pill tone="green"><span className="rd-dot rd-dot--live" />Fresh · 2h ago</Pill>
              <span>14 sources</span>
              <span>·</span>
              <span>7 claims</span>
              <span>·</span>
              <span>3 follow-ups</span>
              <span>·</span>
              <Pill tone="accent">71% from memory</Pill>
            </div>
          </div>

          <div className="rd-row" style={{ gap: 6 }}>
            <button className="rd-btn rd-btn--quiet rd-btn--sm">Share</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm">Export</button>
            <button className="rd-btn rd-btn--primary rd-btn--sm">Refresh</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ marginTop: 14 }}>
          <div className="rd-tabs" role="tablist" aria-label="Workspace tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                title={t.hint}
                className="rd-tab"
                onClick={() => setTab(t.id)}
              >{t.label}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Active tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "var(--rd-paper-warm)" }}>
        {tab === "brief" && <BriefTab />}
        {tab === "cards" && <CardStack rootId="ship_demo" />}
        {tab === "notebook" && (
          <div style={{ height: "100%", padding: "16px 24px 24px" }}>
            <ReportNotebookView reportId={reportId} embedded />
          </div>
        )}
        {tab === "sources" && <SourcesTab />}
        {tab === "chat" && <ChatSurface contextLabel="Asking about: Orbital Labs" />}
        {tab === "map" && <MapTab />}
      </div>
    </div>
  );
}

function BriefTab() {
  return (
    <div className="rd-stack" style={{ gap: 18, padding: "28px 32px", maxWidth: 760, overflow: "auto", height: "100%" }}>
      <section>
        <div className="rd-eyebrow">Short answer</div>
        <p style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, lineHeight: 1.35, color: "var(--rd-ink-strong)", letterSpacing: "-0.3px", marginTop: 6 }}>
          {sampleAnswer.shortAnswer}
        </p>
      </section>

      <section>
        <div className="rd-eyebrow">Why it matters</div>
        <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink-mute)" }}>{sampleAnswer.whyItMatters}</p>
      </section>

      <section>
        <div className="rd-eyebrow">Verified evidence</div>
        <ol className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, marginTop: 6 }}>
          {sampleAnswer.evidence.map((e) => (
            <li key={e.idx} className="rd-card rd-card__pad-tight" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10 }}>
              <span className="rd-mono" style={{ fontSize: 11, background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)", padding: "1px 6px", borderRadius: 4 }}>[{e.idx}]</span>
              <span style={{ fontSize: 13 }}>{e.quote}</span>
              <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{e.source}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="rd-eyebrow">Risks</div>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, marginTop: 6 }}>
          {sampleAnswer.risks.map((r, i) => (
            <li key={i} className="rd-row" style={{ gap: 10, alignItems: "flex-start" }}>
              <span className="rd-dot rd-dot--review" style={{ marginTop: 6 }} />
              <span style={{ color: "var(--rd-ink-mute)" }}>{r}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rd-card rd-card__pad" style={{ background: "var(--rd-accent-tint)", borderColor: "var(--rd-accent-ring)" }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>Recommended next action</div>
        <p className="rd-body" style={{ marginTop: 6 }}>{sampleAnswer.nextAction}</p>
      </section>
    </div>
  );
}

function NotebookTab() {
  return (
    <div className="rd-stack" style={{ gap: 16, padding: "28px 32px", maxWidth: 760, overflow: "auto", height: "100%" }}>
      <div className="rd-row" style={{ gap: 8 }}>
        <Pill tone="green"><span className="rd-dot rd-dot--live" />Saved · just now</Pill>
        <Pill>Public read-only mode</Pill>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ marginLeft: "auto" }}>Improve selection with AI</button>
      </div>

      <article className="rd-stack" style={{ gap: 14 }}>
        <h1 style={{ fontFamily: "var(--rd-font-display)", fontSize: 28, fontWeight: 590, color: "var(--rd-ink-strong)", letterSpacing: "-0.5px" }}>
          Orbital Labs — pilot pre-read
        </h1>
        <p className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
          Drafted by NodeBench · revised 12m ago · 7 claims · 3 follow-ups
        </p>

        <h2 className="rd-h2">What they do</h2>
        <p className="rd-body">
          Orbital Labs builds voice-agent evaluation infrastructure with first-class support for HIPAA-aware grading.
          The team is voice + healthcare from prior roles at Mode Analytics. Today they're seeking healthcare design
          partners — capital is not the binding constraint{" "}
          <span className="rd-mono" style={{ fontSize: 10, background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)", padding: "1px 5px", borderRadius: 4 }}>[2]</span>.
        </p>

        <h2 className="rd-h2">Why we should care</h2>
        <p className="rd-body">
          The HIPAA-aware grading wedge is structurally defensible — most LLM eval vendors treat regulated industries
          as an afterthought. If Orbital wins one regional hospital pilot, expansion follows the same procurement
          cycle.
        </p>

        <h2 className="rd-h2">Open questions</h2>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0 }}>
          <li className="rd-row" style={{ gap: 8 }}>
            <span className="rd-dot rd-dot--review" />
            <span>What's the expected pilot procurement timeline at the regional hospitals?</span>
          </li>
          <li className="rd-row" style={{ gap: 8 }}>
            <span className="rd-dot rd-dot--review" />
            <span>Is the eval framework open-source or closed-source?</span>
          </li>
        </ul>

        <h2 className="rd-h2">Decision</h2>
        <p className="rd-body">
          <strong style={{ color: "var(--rd-accent-strong)" }}>Take the call.</strong> Worth 30 minutes this week to
          stress-test the pilot timeline. Healthcare entrenchment makes this a one-shot opportunity if validated.
        </p>
      </article>
    </div>
  );
}

function SourcesTab() {
  const sources = [
    { type: "PDF", title: "Orbital Labs whitepaper, p.4", refreshed: "2d ago", reused: 4 },
    { type: "Note", title: "Founder note, Ship Demo Day", refreshed: "today", reused: 6 },
    { type: "Recap", title: "Notion meeting recap, Apr 30", refreshed: "5d ago", reused: 2 },
    { type: "Web", title: "TechCrunch coverage, Mar 2026", refreshed: "1w ago", reused: 3 },
  ];

  return (
    <div className="rd-stack" style={{ gap: 14, padding: "28px 32px", maxWidth: 880, overflow: "auto", height: "100%" }}>
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-eyebrow">Sources</div>
        <h2 className="rd-h2">14 sources, 71% reused this session</h2>
        <p className="rd-faint" style={{ fontSize: 12.5 }}>Each row is one click from the claim it supports.</p>
      </header>

      <div className="rd-card" style={{ padding: 0 }}>
        {sources.map((s, i) => (
          <div key={i} className="rd-row--between" style={{
            padding: "12px 16px",
            borderBottom: i < sources.length - 1 ? "1px solid var(--rd-line-faint)" : "none",
            gap: 12,
          }}>
            <div className="rd-row" style={{ gap: 12, flex: 1, minWidth: 0 }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: "var(--rd-muted)",
                display: "grid", placeItems: "center", fontSize: 10, fontWeight: 590,
                color: "var(--rd-ink-mute)", textTransform: "uppercase",
              }}>{s.type.slice(0, 3)}</span>
              <div className="rd-stack" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 510, color: "var(--rd-ink-strong)" }}>{s.title}</span>
                <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
                  Refreshed {s.refreshed} · reused {s.reused}× this session
                </span>
              </div>
            </div>
            <div className="rd-row" style={{ gap: 4 }}>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Open</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm">Verify</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MapTab() {
  return (
    <div style={{ position: "relative", height: "100%", padding: 32, overflow: "hidden" }}>
      <div className="rd-row--between" style={{ position: "absolute", top: 16, left: 32, right: 32, zIndex: 2 }}>
        <Pill tone="blue">Map · wide-angle relationships</Pill>
        <div className="rd-row" style={{ gap: 6 }}>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Filter</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Confidence ≥ 0.7</button>
          <button className="rd-btn rd-btn--primary rd-btn--sm">Open in Cards</button>
        </div>
      </div>

      <svg viewBox="0 0 800 480" style={{ width: "100%", height: "100%", maxHeight: 600 }} aria-label="Relationship map">
        <defs>
          <radialGradient id="rd-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--rd-accent-soft)" />
            <stop offset="100%" stopColor="var(--rd-paper)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Edges */}
        <g stroke="var(--rd-line-strong)" strokeWidth={1.2} fill="none">
          <path d="M 400,240 L 240,140" />
          <path d="M 400,240 L 580,140" />
          <path d="M 400,240 L 240,360" />
          <path d="M 400,240 L 580,360" />
          <path d="M 240,140 L 240,360" strokeDasharray="3 4" />
          <path d="M 580,140 L 580,360" strokeDasharray="3 4" />
        </g>

        {/* Root: Ship Demo Day */}
        <circle cx="400" cy="240" r="80" fill="url(#rd-glow)" />
        <MapNode cx={400} cy={240} title="Ship Demo Day" subtitle="Event · root" tone="accent" size="lg" />

        {/* Spokes */}
        <MapNode cx={240} cy={140} title="Orbital Labs" subtitle="Company · pilot" tone="blue" />
        <MapNode cx={580} cy={140} title="Anthropic" subtitle="Coverage" tone="default" />
        <MapNode cx={240} cy={360} title="Alex Chen" subtitle="Person · founder" tone="green" />
        <MapNode cx={580} cy={360} title="Voice eval" subtitle="Theme · 6 vendors" tone="amber" />
      </svg>

      <p className="rd-mono" style={{ position: "absolute", bottom: 16, left: 32, fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
        Sigma.js / Graphology mounts here in production · placeholder static SVG shown
      </p>
    </div>
  );
}

function MapNode({ cx, cy, title, subtitle, tone = "default", size = "md" }: {
  cx: number; cy: number; title: string; subtitle: string;
  tone?: "default" | "accent" | "blue" | "green" | "amber"; size?: "md" | "lg";
}) {
  const r = size === "lg" ? 36 : 26;
  const fillMap: Record<string, string> = {
    default: "var(--rd-muted)",
    accent: "var(--rd-accent-soft)",
    blue: "var(--rd-blue-bg)",
    green: "var(--rd-green-bg)",
    amber: "var(--rd-amber-bg)",
  };
  const colorMap: Record<string, string> = {
    default: "var(--rd-ink-mute)",
    accent: "var(--rd-accent-strong)",
    blue: "var(--rd-blue)",
    green: "var(--rd-green)",
    amber: "var(--rd-amber)",
  };
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fillMap[tone]} stroke={colorMap[tone]} strokeWidth={1.2} />
      <text x={cx} y={cy + r + 16} textAnchor="middle" fontSize={12} fontWeight={590} fill="var(--rd-ink-strong)">{title}</text>
      <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize={10.5} fill="var(--rd-ink-soft)">{subtitle}</text>
    </g>
  );
}
