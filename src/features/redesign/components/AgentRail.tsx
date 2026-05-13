import { useMemo, useState } from "react";
import type { ReportCardData, SurfaceId } from "../fixtures";
import { Pill } from "./Pill";

interface AgentRailProps {
  surface: SurfaceId;
  selectedReport?: ReportCardData | null;
  onSelectRelated?: (entity: string) => void;
  onSendPrompt?: (prompt: string) => void;
}

interface EntityDetail {
  title: string;
  score: number;
  scoreLabel: string;
  statusTone: "green" | "blue" | "amber";
  sources: number;
  claims: number;
  followUps: number;
  signals: Array<{ label: string; value: number; tone: "green" | "blue" | "amber" }>;
  related: string[];
  nextAction: string;
  trace: string[];
}

const SURFACE_LABEL: Record<SurfaceId, string> = {
  home: "Daily brief",
  reports: "Coverage",
  chat: "Chat",
  inbox: "Inbox",
  me: "Personal memory",
};

export function AgentRail({ surface, selectedReport, onSelectRelated, onSendPrompt }: AgentRailProps) {
  const detail = useMemo(() => selectedReport ? buildEntityDetail(selectedReport) : null, [selectedReport]);
  const [draft, setDraft] = useState("");
  const label = detail ? "Coverage agent" : `${SURFACE_LABEL[surface]} agent`;
  const prompt = draft.trim();

  const submit = () => {
    if (!prompt) return;
    onSendPrompt?.(prompt);
    setDraft("");
  };

  return (
    <aside className="rd-pane rd-pane--right rd-agent-rail" data-testid="redesign-right-rail" aria-label={`${label} context`}>
      <header className="rd-agent-rail__header">
        <div>
          <div className="rd-eyebrow">{label}</div>
          <h2 className="rd-agent-rail__title">
            {detail?.title ?? defaultRailTitle(surface)}
          </h2>
        </div>
        {detail ? (
          <Pill tone={detail.statusTone}>Score {detail.score}</Pill>
        ) : (
          <Pill tone="accent">Ready</Pill>
        )}
      </header>

      <div className="rd-agent-rail__pills" aria-label="Current context">
        <Pill>{SURFACE_LABEL[surface]}</Pill>
        {detail ? (
          <>
            <Pill>{detail.sources} sources</Pill>
            <Pill>{detail.claims} claims</Pill>
            <Pill tone={detail.followUps > 0 ? "amber" : "green"}>{detail.followUps} follow-ups</Pill>
          </>
        ) : (
          <>
            <Pill>Memory-first</Pill>
            <Pill>Notebook-ready</Pill>
          </>
        )}
      </div>

      {detail ? (
        <>
          <section className="rd-agent-card rd-agent-score" aria-label={`${detail.title} coverage score`}>
            <div className="rd-agent-score__number">{detail.score}</div>
            <div className="rd-stack" style={{ gap: 6 }}>
              <div className="rd-agent-score__label">{detail.scoreLabel}</div>
              <p className="rd-agent-rail__copy">
                The selected report is now the active entity context. The rail shows what the agent would use before
                opening notebook, graph, sources, or chat.
              </p>
            </div>
          </section>

          <section className="rd-agent-card" aria-label="Coverage dimensions">
            <div className="rd-row--between">
              <div className="rd-eyebrow">Signals</div>
              <span className="rd-mono rd-agent-rail__muted">{detail.trace.length} trace steps</span>
            </div>
            <div className="rd-agent-bars">
              {detail.signals.map((signal) => (
                <div className="rd-agent-bar" key={signal.label}>
                  <div className="rd-row--between">
                    <span>{signal.label}</span>
                    <span className="rd-mono">{signal.value}</span>
                  </div>
                  <div className="rd-agent-bar__track">
                    <span data-tone={signal.tone} style={{ width: `${signal.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rd-agent-card">
            <div className="rd-eyebrow">Next best action</div>
            <p className="rd-agent-rail__next">{detail.nextAction}</p>
            <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => onSendPrompt?.(`Open the notebook context for ${detail.title}.`)}>
                Open notebook
              </button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => onSendPrompt?.(`Check sources and unresolved claims for ${detail.title}.`)}>
                Verify claims
              </button>
            </div>
          </section>

          <section className="rd-agent-card">
            <div className="rd-eyebrow">Related entities</div>
            <div className="rd-agent-related">
              {detail.related.map((entity) => (
                <button key={entity} type="button" className="rd-agent-related__item" onClick={() => onSelectRelated?.(entity)}>
                  <span>{entity}</span>
                  <span aria-hidden="true">-&gt;</span>
                </button>
              ))}
            </div>
          </section>

          <details className="rd-agent-card rd-agent-trace">
            <summary>Context trace</summary>
            <ol>
              {detail.trace.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </details>
        </>
      ) : (
        <DefaultRail surface={surface} />
      )}

      <section className="rd-agent-composer" aria-label="Agent composer">
        <div className="rd-agent-composer__chips">
          <span>+ Context</span>
          <span>@ Reference</span>
          <span>/ Command</span>
          <span>Attach</span>
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={detail ? `Ask about ${detail.title}...` : "Ask the agent to inspect this surface..."}
          rows={3}
        />
        <div className="rd-row--between">
          <span className="rd-mono rd-agent-rail__muted">Memory first, sources before claims</span>
          <button className="rd-btn rd-btn--primary rd-btn--sm" disabled={!prompt} onClick={submit}>
            Send
          </button>
        </div>
      </section>
    </aside>
  );
}

function DefaultRail({ surface }: { surface: SurfaceId }) {
  const items = surface === "home"
    ? ["What changed", "So what", "Now what", "Reports touched"]
    : surface === "inbox"
      ? ["Needs approval", "Can batch", "Waiting", "Archive"]
      : surface === "me"
        ? ["User memory", "Preferences", "Watchlist", "Export rules"]
        : ["Select a report", "Inspect sources", "Open notebook", "Ask in chat"];

  return (
    <section className="rd-agent-card">
      <div className="rd-eyebrow">What this rail keeps visible</div>
      <ul className="rd-agent-list">
        {items.map((item) => (
          <li key={item}>
            <span className="rd-agent-list__dot" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="rd-agent-rail__copy">
        The center stays readable while the rail carries agent state, approval points, and handoffs.
      </p>
    </section>
  );
}

function buildEntityDetail(report: ReportCardData): EntityDetail {
  const evidence = clampScore(44 + report.sources * 2 + report.claims);
  const freshness = report.updatedAt.includes("m") || report.updatedAt.includes("h") ? 88 : report.updatedAt.toLowerCase().includes("yesterday") ? 72 : 62;
  const actionability = clampScore(50 + report.followUps * 8 + (report.status === "review" ? 10 : 0));
  const graph = clampScore(54 + report.claims * 2 + report.sources);
  const score = Math.round((evidence + freshness + actionability + graph) / 4);

  return {
    title: report.entity,
    score,
    scoreLabel: report.status === "verified" ? "Verified coverage" : report.status === "watching" ? "Active watch" : "Needs review",
    statusTone: report.status === "verified" ? "green" : report.status === "watching" ? "blue" : "amber",
    sources: report.sources,
    claims: report.claims,
    followUps: report.followUps,
    signals: [
      { label: "Evidence", value: evidence, tone: evidence > 78 ? "green" : "blue" },
      { label: "Freshness", value: freshness, tone: freshness > 80 ? "green" : "amber" },
      { label: "Actionability", value: actionability, tone: actionability > 82 ? "green" : "amber" },
      { label: "Graph fit", value: graph, tone: graph > 80 ? "green" : "blue" },
    ],
    related: relatedEntities(report),
    nextAction: report.status === "review"
      ? `Review unsupported claims in ${report.entity} before exporting or promoting notebook patches.`
      : report.followUps > 0
        ? `Clear ${report.followUps} follow-up${report.followUps === 1 ? "" : "s"} tied to ${report.entity}.`
        : `Open the notebook and reuse ${report.entity} as verified context.`,
    trace: [
      "Resolved selected report card",
      `${report.sources} sources and ${report.claims} claims loaded`,
      report.followUps > 0 ? "Follow-ups require action routing" : "No open follow-up pressure",
      "Ready for notebook, graph, sources, or chat handoff",
    ],
  };
}

function relatedEntities(report: ReportCardData): string[] {
  const base = report.kind === "Event"
    ? ["Event captures", "Follow-ups", "Shared context"]
    : report.kind === "Theme"
      ? ["Adjacent companies", "Claims needing review", "Market map"]
      : report.kind === "Coverage"
        ? ["Competitors", "Product lines", "Enterprise buyers"]
        : ["People", "Sources", "Similar companies"];
  return [report.entity, ...base].slice(0, 4);
}

function clampScore(value: number): number {
  return Math.max(42, Math.min(96, Math.round(value)));
}

function defaultRailTitle(surface: SurfaceId): string {
  if (surface === "reports") return "Select a report";
  if (surface === "home") return "Pulse context";
  if (surface === "inbox") return "Decision queue";
  if (surface === "me") return "Operator context";
  return "Agent context";
}
