/**
 * RightInspector - chat-page right rail.
 *
 * The rail can be driven by an explicit active live artifact from Chat. When
 * no prop is passed, it falls back to the live Convex-backed artifact list.
 */

import { useState } from "react";
import { Pill } from "./Pill";
import { useLiveArtifacts, type LiveArtifactDetail } from "../hooks/useLiveArtifacts";
import { VoiceCostBadge } from "@/features/voice";
import { useCurrentUserId } from "@/hooks/useCurrentUser";

export type AgentRailStatus = "done" | "running" | "queued" | "blocked" | "idle";

export interface AgentRailItem {
  id: string;
  label: string;
  status?: AgentRailStatus;
  detail?: string;
  meta?: string;
  href?: string;
}

export interface AgentRailMetric {
  label: string;
  value: string;
  tone?: "green" | "amber" | "accent";
}

export interface AgentRailSnapshot {
  title: string;
  subtitle?: string;
  status: "idle" | "thinking" | "ok" | "error";
  runId?: string;
  progress: AgentRailItem[];
  runDetails: AgentRailItem[];
  artifacts: AgentRailItem[];
  backgroundAgents: AgentRailItem[];
  sources: AgentRailItem[];
  metrics?: AgentRailMetric[];
}

const utilityTabs = [
  { id: "agent", label: "Agent" },
  { id: "entity", label: "Entity" },
  { id: "graph", label: "Graph" },
  { id: "sources", label: "Sources" },
  { id: "threads", label: "Threads" },
  { id: "notebook", label: "Notebook" },
  { id: "report", label: "Report" },
] as const;

type UtilityTab = typeof utilityTabs[number]["id"];

interface RightInspectorProps {
  activeLiveArtifactDetail?: LiveArtifactDetail | null;
  agentSnapshot?: AgentRailSnapshot | null;
}

export function RightInspector({ activeLiveArtifactDetail, agentSnapshot }: RightInspectorProps = {}) {
  const [activeTab, setActiveTab] = useState<UtilityTab>("agent");
  const liveArtifacts = useLiveArtifacts(12);
  const detail = activeLiveArtifactDetail === undefined
    ? liveArtifacts.details[0]
    : activeLiveArtifactDetail ?? undefined;
  const title = detail?.title ?? "Current report";
  const summary = detail?.summary ?? "Ask a question, capture a note, or open a live artifact to hydrate this inspector.";
  const sources = detail?.sourceRows.slice(0, 6) ?? [];
  const nodes = detail?.nodes.slice(0, 5) ?? [];
  const resolvedAgentSnapshot = agentSnapshot ?? buildFallbackAgentSnapshot(detail, liveArtifacts.isLoading);
  // HONEST_STATUS: only mount VoiceCostBadge for signed-in viewers.
  // `null` = signed out (skip), `undefined` = loading auth (skip until known).
  const userId = useCurrentUserId();

  return (
    <aside className="rd-pane rd-pane--right" data-testid="right-inspector" style={{ padding: "20px 18px", gap: 16 }}>
      {userId && <VoiceCostBadge userId={userId} />}

      <section className="rd-card rd-card__pad-tight" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          className="rd-tabs"
          role="tablist"
          aria-label="Chat utility panels"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", width: "100%" }}
        >
          {utilityTabs.map((tab) => (
            <button
              key={tab.id}
              id={`right-inspector-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`right-inspector-panel-${tab.id}`}
              className="rd-tab"
              style={{ minHeight: 30, padding: "6px 4px", fontSize: 11 }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          <div
            id="right-inspector-panel-agent"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-agent"
            hidden={activeTab !== "agent"}
          >
            <AgentProgressPanel snapshot={resolvedAgentSnapshot} />
          </div>
          <div
            id="right-inspector-panel-entity"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-entity"
            hidden={activeTab !== "entity"}
          >
            <EntityPanel detail={detail} title={title} summary={summary} />
          </div>
          <div
            id="right-inspector-panel-graph"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-graph"
            hidden={activeTab !== "graph"}
          >
            <GraphPanel detail={detail} nodes={nodes} />
          </div>
          <div
            id="right-inspector-panel-sources"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-sources"
            hidden={activeTab !== "sources"}
          >
            <SourcesPanel detail={detail} sources={sources} />
          </div>
          <div
            id="right-inspector-panel-threads"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-threads"
            hidden={activeTab !== "threads"}
          >
            <ThreadsPanel detail={detail} />
          </div>
          <div
            id="right-inspector-panel-notebook"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-notebook"
            hidden={activeTab !== "notebook"}
          >
            <NotebookPanel detail={detail} />
          </div>
          <div
            id="right-inspector-panel-report"
            role="tabpanel"
            aria-labelledby="right-inspector-tab-report"
            hidden={activeTab !== "report"}
          >
            <ReportPanel detail={detail} title={title} />
          </div>
        </div>
      </section>
    </aside>
  );
}

function buildFallbackAgentSnapshot(detail: LiveArtifactDetail | undefined, isLoading: boolean): AgentRailSnapshot {
  const hasDetail = Boolean(detail);
  const status: AgentRailSnapshot["status"] = isLoading ? "thinking" : hasDetail ? "ok" : "idle";
  return {
    title: isLoading ? "Hydrating agent context" : hasDetail ? "Agent ready on live artifact" : "Agent idle",
    subtitle: hasDetail
      ? `${detail.title} - ${detail.sourceCount} sources - ${detail.claimCount} claims`
      : "Ask in Chat to start a Convex-backed run with traceable tool calls.",
    status,
    progress: [
      {
        id: "context",
        label: "Resolve active context",
        status: isLoading ? "running" : hasDetail ? "done" : "queued",
        detail: hasDetail ? detail.title : "Waiting for a chat prompt or selected artifact.",
      },
      {
        id: "memory",
        label: "Search reusable memory",
        status: hasDetail ? "done" : "queued",
        detail: hasDetail ? `${detail.sourceCount} source refs already attached.` : "Runs before any paid refresh.",
      },
      {
        id: "sources",
        label: "Verify sources and evidence",
        status: hasDetail && detail.sourceCount > 0 ? "done" : "queued",
        detail: hasDetail ? `${detail.claimCount} claims available for review.` : "Hydrates when a run starts.",
      },
      {
        id: "answer",
        label: "Assemble answer packet",
        status: hasDetail ? "done" : "queued",
        detail: hasDetail ? detail.primaryAction : "Produces answer, evidence, risk, next action.",
      },
    ],
    runDetails: [
      { id: "state", label: "Run state", status, detail: isLoading ? "Subscribing to Convex live state." : "No active paid run in progress." },
      { id: "writes", label: "Safe writes", status: "idle", detail: "Notebook, follow-up, and export writes require explicit user action." },
    ],
    artifacts: hasDetail
      ? [
          { id: "artifact", label: detail.title, status: "done", detail: detail.kind, href: `/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=brief` },
          { id: "notebook", label: "Notebook handoff", status: detail.notebookHtml ? "done" : "queued", detail: detail.notebookHtml ? "Draft available" : "No notebook draft yet", href: `/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=notebook` },
        ]
      : [{ id: "empty", label: "No artifacts yet", status: "queued", detail: "Start with a question, source, or report." }],
    backgroundAgents: [
      { id: "coordinator", label: "Coordinator", status: hasDetail ? "done" : "queued", detail: "Plans context, tools, and safe write path." },
      { id: "memory", label: "Memory agent", status: hasDetail ? "done" : "queued", detail: "Looks up reports, notebooks, sources, and prior chats." },
      { id: "judge", label: "Judge", status: "queued", detail: "Checks citation support and unsupported claims." },
    ],
    sources: hasDetail
      ? detail.sourceRows.slice(0, 5).map((source, index) => ({
          id: source.id || `source-${index}`,
          label: source.title,
          status: "done",
          detail: source.host || source.type,
          href: source.href,
        }))
      : [{ id: "convex", label: "Convex live memory", status: isLoading ? "running" : "queued", detail: "Primary source of truth." }],
    metrics: [
      { label: "sources", value: String(detail?.sourceCount ?? 0), tone: "accent" },
      { label: "claims", value: String(detail?.claimCount ?? 0), tone: "green" },
      { label: "paid", value: "$0.00", tone: "green" },
    ],
  };
}

function AgentProgressPanel({ snapshot }: { snapshot: AgentRailSnapshot }) {
  return (
    <div className="rd-stack" style={{ gap: 14 }} data-testid="chat-agent-run-rail">
      <div className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-row--between" style={{ gap: 10 }}>
          <div className="rd-eyebrow">Agent run</div>
          <StatusPill status={snapshot.status} />
        </div>
        <h3 className="rd-h2" style={{ fontSize: 16, lineHeight: 1.15, margin: 0 }}>{snapshot.title}</h3>
        {snapshot.subtitle && (
          <p className="rd-body" style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: 0 }}>
            {snapshot.subtitle}
          </p>
        )}
        {snapshot.runId && (
          <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>run {snapshot.runId}</span>
        )}
      </div>

      {snapshot.metrics?.length ? (
        <div className="rd-row" style={{ gap: 6 }}>
          {snapshot.metrics.map((metric) => (
            <div
              key={metric.label}
              style={{
                flex: 1,
                minWidth: 0,
                border: "1px solid var(--rd-line)",
                borderRadius: 6,
                padding: "7px 8px",
                background: "var(--rd-muted)",
              }}
            >
              <div className="rd-h3" style={{ fontSize: 13, color: metric.tone === "amber" ? "var(--rd-amber)" : metric.tone === "green" ? "var(--rd-green)" : "var(--rd-ink)" }}>{metric.value}</div>
              <div className="rd-mono" style={{ fontSize: 9, color: "var(--rd-ink-soft)", marginTop: 2 }}>{metric.label}</div>
            </div>
          ))}
        </div>
      ) : null}

      <AgentSection title="Progress" items={snapshot.progress} />
      <AgentSection title="Run details" items={snapshot.runDetails} compact />
      <AgentSection title="Artifacts" items={snapshot.artifacts} compact />
      <AgentSection title="Background agents" items={snapshot.backgroundAgents} compact />
      <AgentSection title="Sources" items={snapshot.sources} compact />
    </div>
  );
}

function AgentSection({ title, items, compact = false }: { title: string; items: AgentRailItem[]; compact?: boolean }) {
  return (
    <section className="rd-stack" style={{ gap: 7 }}>
      <div className="rd-eyebrow">{title}</div>
      {items.length ? (
        <ul className="rd-stack" style={{ gap: compact ? 5 : 7, listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <li key={item.id} className="rd-row" style={{ alignItems: "flex-start", gap: 8, minWidth: 0 }}>
              <StatusGlyph status={item.status ?? "idle"} />
              <span style={{ minWidth: 0, flex: 1 }}>
                {item.href ? (
                  <a
                    href={item.href}
                    style={{
                      color: "var(--rd-ink)",
                      fontSize: compact ? 12 : 12.5,
                      fontWeight: 590,
                      textDecoration: "none",
                    }}
                  >
                    {item.label}
                  </a>
                ) : (
                  <span style={{ display: "block", color: "var(--rd-ink)", fontSize: compact ? 12 : 12.5, fontWeight: 590 }}>
                    {item.label}
                  </span>
                )}
                {item.detail && (
                  <span style={{ display: "block", marginTop: 2, color: "var(--rd-ink-mute)", fontSize: compact ? 11 : 11.5, lineHeight: 1.35 }}>
                    {item.detail}
                  </span>
                )}
                {item.meta && (
                  <span className="rd-mono" style={{ display: "block", marginTop: 2, color: "var(--rd-ink-soft)", fontSize: 10 }}>
                    {item.meta}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPanel message={`No ${title.toLowerCase()} yet.`} />
      )}
    </section>
  );
}

function StatusPill({ status }: { status: AgentRailSnapshot["status"] }) {
  const label = status === "thinking" ? "Running" : status === "ok" ? "Ready" : status === "error" ? "Needs review" : "Idle";
  const tone = status === "error" ? undefined : status === "ok" ? "green" : status === "thinking" ? "accent" : undefined;
  return <Pill tone={tone}>{label}</Pill>;
}

function StatusGlyph({ status }: { status: AgentRailStatus }) {
  const color =
    status === "done" ? "var(--rd-green)"
      : status === "running" ? "var(--rd-accent-strong)"
      : status === "blocked" ? "var(--rd-amber)"
      : "var(--rd-ink-soft)";
  const label = status === "done" ? "done" : status === "running" ? "running" : status === "blocked" ? "blocked" : "queued";
  return (
    <span
      aria-label={label}
      title={label}
      style={{
        width: 16,
        height: 16,
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        marginTop: 1,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {status === "done" ? "✓" : status === "running" ? "…" : status === "blocked" ? "!" : ""}
    </span>
  );
}

function EntityPanel({ detail, title, summary }: { detail?: LiveArtifactDetail; title: string; summary: string }) {
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-eyebrow">{detail ? "Active live artifact" : "Active context"}</div>
      <h3 className="rd-h2" style={{ fontSize: 16 }}>{title}</h3>
      <p className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)", margin: 0 }}>
        {detail?.kind ?? "No live artifact selected"}
      </p>
      <p className="rd-body" style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: 0 }}>{summary}</p>
      <div className="rd-row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        {(detail?.tags ?? ["Ask", "Capture", "Report"]).slice(0, 4).map((tag, i) => (
          <Pill key={`${tag}-${i}`} tone={i === 0 ? "accent" : undefined}>{tag}</Pill>
        ))}
      </div>
      <div className="rd-row" style={{ gap: 8 }}>
        <MetricTile label="Claims" value={detail?.claimCount ?? 0} />
        <MetricTile label="Sources" value={detail?.sourceCount ?? 0} />
        <MetricTile label="Follow-ups" value={detail?.followUps ?? 0} />
      </div>
    </div>
  );
}

function GraphPanel({ detail, nodes }: { detail?: LiveArtifactDetail; nodes: Array<{ title: string }> }) {
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-row--between">
        <div className="rd-eyebrow">Graph preview</div>
        {detail ? (
          <a
            className="rd-btn rd-btn--quiet rd-btn--sm"
            href={`/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=map`}
            style={{ padding: "1px 6px", fontSize: 10, textDecoration: "none" }}
          >
            Open Map
          </a>
        ) : (
          <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>No map yet</span>
        )}
      </div>
      <svg viewBox="0 0 240 120" width="100%" height={120}>
        <GraphPreview detail={detail} nodes={nodes} />
      </svg>
      <p className="rd-body" style={{ fontSize: 12, color: "var(--rd-ink-mute)", margin: 0 }}>
        {detail ? `${detail.nodes.length} nodes and ${detail.edges.length} relationships are attached to this artifact.` : "Pin or open a live artifact to hydrate first-ring relationships."}
      </p>
    </div>
  );
}

function SourcesPanel({ detail, sources }: { detail?: LiveArtifactDetail; sources: LiveArtifactDetail["sourceRows"] }) {
  const displayedTotal = Math.max(sources.length, detail?.sourceCount ?? 0);
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-eyebrow">Sources used ({sources.length} / {displayedTotal})</div>
      {sources.length ? (
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {sources.map((source, i) => (
            <li key={source.id || i} className="rd-row" style={{ alignItems: "flex-start", gap: 8, fontSize: 12 }}>
              <span className="rd-mono" style={{
                fontSize: 10,
                background: "var(--rd-accent-soft)",
                color: "var(--rd-accent-strong)",
                padding: "1px 5px",
                borderRadius: 3,
              }}>[{i + 1}]</span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--rd-ink-mute)" }}>
                <span style={{ display: "block", color: "var(--rd-ink)", fontWeight: 590 }}>{source.title}</span>
                <span className="rd-mono" style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--rd-ink-soft)" }}>
                  {source.type} - {source.refreshed}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPanel message="Open a live artifact to hydrate source rows." />
      )}
    </div>
  );
}

function ThreadsPanel({ detail }: { detail?: LiveArtifactDetail }) {
  const threads = [
    {
      title: detail ? `Review ${detail.kind.toLowerCase()} claims` : "Start a research thread",
      when: detail?.updatedAt ?? "now",
      href: detail ? `/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=chat` : "/redesign/chat",
    },
    {
      title: detail ? "Open notebook handoff" : "Attach sources",
      when: "next",
      href: detail ? `/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=notebook` : "/redesign/workspace?tab=sources",
    },
    {
      title: detail ? "Export reusable memory" : "Create report",
      when: "later",
      href: detail ? `/redesign/workspace?report=${encodeURIComponent(detail.id)}&tab=brief` : "/redesign/reports",
    },
  ];

  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-eyebrow">Prior threads</div>
      <ul className="rd-stack" style={{ gap: 4, listStyle: "none", padding: 0, margin: 0 }}>
        {threads.map((thread, i) => (
          <li key={i}>
            <a className="rd-btn rd-btn--quiet" href={thread.href} style={{ width: "100%", justifyContent: "flex-start", padding: "5px 8px", textDecoration: "none" }}>
              <span style={{ flex: 1, textAlign: "left", fontSize: 12 }}>{thread.title}</span>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{thread.when}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotebookPanel({ detail }: { detail?: LiveArtifactDetail }) {
  const sections = detail?.sections.slice(0, 3) ?? [];

  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-row--between">
        <div className="rd-eyebrow">Notebook</div>
        <Pill tone={detail?.notebookHtml ? "green" : undefined}>{detail?.notebookHtml ? "Draft" : "Empty"}</Pill>
      </div>
      {detail ? (
        <>
          <p className="rd-body" style={{ fontSize: 12.5, color: "var(--rd-ink-mute)", margin: 0 }}>
            {detail.primaryAction}
          </p>
          {sections.length ? (
            <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {sections.map((section) => (
                <li
                  key={section.title}
                  style={{
                    border: "1px solid var(--rd-line)",
                    borderRadius: 6,
                    padding: 10,
                    background: "var(--rd-muted)",
                  }}
                >
                  <div className="rd-h3" style={{ fontSize: 12 }}>{section.title}</div>
                  <p className="rd-body" style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--rd-ink-mute)" }}>{section.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel message="No notebook sections are attached yet." />
          )}
        </>
      ) : (
        <EmptyPanel message="Create or open a live artifact to prepare a notebook handoff." />
      )}
    </div>
  );
}

function ReportPanel({ detail, title }: { detail?: LiveArtifactDetail; title: string }) {
  return (
    <div className="rd-stack" style={{ gap: 10 }}>
      <div className="rd-eyebrow">Report status</div>
      <div className="rd-row--between">
        <span className="rd-h3">{title}</span>
        <Pill tone="green"><span className="rd-dot rd-dot--live" />{detail ? `Updated ${detail.updatedAt}` : "Ready"}</Pill>
      </div>
      <div className="rd-row" style={{ gap: 8 }}>
        <MetricTile label="Sources" value={detail?.sourceCount ?? 0} />
        <MetricTile label="Claims" value={detail?.claimCount ?? 0} />
        <MetricTile label="Follow-ups" value={detail?.followUps ?? 0} />
      </div>
      <button className="rd-btn rd-btn--quiet rd-btn--sm" style={{ width: "100%", justifyContent: "center" }}>
        Open report notebook
      </button>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: "1px solid var(--rd-line)",
        borderRadius: 6,
        padding: "8px 10px",
        background: "var(--rd-muted)",
      }}
    >
      <div className="rd-h3" style={{ fontSize: 14 }}>{value}</div>
      <div className="rd-mono" style={{ marginTop: 2, fontSize: 9.5, color: "var(--rd-ink-soft)" }}>{label}</div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--rd-line)",
        borderRadius: 6,
        padding: 10,
        background: "var(--rd-muted)",
        color: "var(--rd-ink-mute)",
        fontSize: 12,
      }}
    >
      {message}
    </div>
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
      {outer.map((node, i) => <NodeDot key={`${node.title}-${i}`} cx={positions[i].cx} cy={positions[i].cy} label={node.title.slice(0, 10)} />)}
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
