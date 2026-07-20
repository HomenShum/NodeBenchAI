/**
 * EngineDemoView — One-Page CRUD Jarvis Demo
 *
 * Ultra minimal Dribbble ASCII aesthetic:
 * - Pure JetBrains Mono typography, thin dividers, maximum whitespace
 * - No grid overlay, scan lines, glow, or CRT effects
 * - 6 panels: Spec / Trace / Context / Scoreboard / Timeline / Publish
 * - Backed by the headless engine API on port 6276
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";

// ── Types ─────────────────────────────────────────────────────────────

interface EngineSpec {
  id: string;
  name: string;
  workflow: string;
  preset: string;
  stepArgs: Record<string, Record<string, unknown>>;
  status: "draft" | "running" | "completed" | "failed";
}

interface StepResult {
  stepIndex: number;
  tool: string;
  action: string;
  status: "running" | "complete" | "error";
  durationMs?: number;
  result?: unknown;
}

interface ConformanceReport {
  score: number;
  grade: string;
  breakdown: Record<string, boolean>;
  summary: string;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalDurationMs: number;
}

interface TraceEvent {
  kind: string;
  toolName?: string;
  stepIndex?: number;
  status: string;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const ENGINE_BASE = "http://127.0.0.1:6276";

const WORKFLOWS = [
  "new_feature", "fix_bug", "ui_change", "security_audit", "code_review",
  "deployment", "migration", "research_phase", "daily_review", "gemini_qa",
  "agent_eval", "session_recovery", "email_assistant", "seo_audit", "pr_review",
];

const PRESETS = [
  "default", "web_dev", "research", "data", "devops",
  "mobile", "academic", "multi_agent", "content", "full",
];

const STATUS_CHAR: Record<string, string> = {
  draft: "\u25CB",      // ○
  running: "\u25CF",    // ●
  completed: "\u2713",  // ✓
  failed: "\u2717",     // ✗
};

// ── Persistence ───────────────────────────────────────────────────────

function loadSpecs(): EngineSpec[] {
  try {
    const raw = localStorage.getItem("engine-specs");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSpecs(specs: EngineSpec[]) {
  localStorage.setItem("engine-specs", JSON.stringify(specs));
}

function genId(): string {
  return `spec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Sub-components ────────────────────────────────────────────────────

const PanelHeader = memo(({ title, actions }: { title: string; actions?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-4">
    <span className="text-[10px] tracking-[0.12em] text-content-muted uppercase">{title}</span>
    {actions && <div className="flex items-center gap-3">{actions}</div>}
  </div>
));
PanelHeader.displayName = "PanelHeader";

const TextButton = memo(({ label, onClick, disabled, active }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`text-xs font-mono transition-colors ${
      disabled ? "text-content-muted cursor-not-allowed"
      : active ? "text-primary underline underline-offset-4"
      : "text-content-muted hover:text-content hover:underline hover:underline-offset-4"
    }`}
  >
    {label}
  </button>
));
TextButton.displayName = "TextButton";

// ── Spec Panel ────────────────────────────────────────────────────────

function SpecPanel({
  specs, selected, onSelect, onCreate, onDelete, onUpdate, onRun,
}: {
  specs: EngineSpec[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<EngineSpec>) => void;
  onRun: (spec: EngineSpec) => void;
}) {
  const active = specs.find((s) => s.id === selected);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Spec"
        actions={
          <>
            <TextButton label="+ NEW" onClick={onCreate} />
            {active && active.status === "draft" && (
              <TextButton label="RUN" onClick={() => onRun(active)} />
            )}
          </>
        }
      />

      {/* Spec List */}
      <div className="flex-1 overflow-auto space-y-1 min-h-0">
        {specs.length === 0 && (
          <div className="text-content-muted text-xs py-8 text-center">
            No specs yet. Click + NEW to create one.
          </div>
        )}
        {specs.map((spec) => (
          <button
            key={spec.id}
            onClick={() => onSelect(spec.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors ${
              selected === spec.id
                ? "bg-surface-hover text-content"
                : "text-content-muted hover:text-content-secondary hover:bg-surface-secondary/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate">{spec.name}</span>
              <span className={`ml-2 flex-shrink-0 ${
                spec.status === "completed" ? "text-primary"
                : spec.status === "running" ? "text-amber-500"
                : spec.status === "failed" ? "text-red-500"
                : "text-content-muted"
              }`}>
                {STATUS_CHAR[spec.status]} {spec.status}
              </span>
            </div>
            <div className="text-[10px] text-content-muted mt-0.5">
              {spec.workflow} {"\u00B7"} {spec.preset}
            </div>
          </button>
        ))}
      </div>

      {/* Spec Editor */}
      {active && (
        <div className="border-t border-edge/50 pt-3 mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-content-muted w-16">Name</label>
            <input
              className="flex-1 bg-transparent border-b border-edge text-xs text-content-secondary px-1 py-0.5 font-mono focus:border-content-muted focus:outline-none"
              value={active.name}
              onChange={(e) => onUpdate(active.id, { name: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-content-muted w-16">Workflow</label>
            <select
              className="flex-1 bg-transparent border-b border-edge text-xs text-content-secondary px-1 py-0.5 font-mono focus:border-content-muted focus:outline-none"
              value={active.workflow}
              onChange={(e) => onUpdate(active.id, { workflow: e.target.value })}
            >
              {WORKFLOWS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-content-muted w-16">Preset</label>
            <select
              className="flex-1 bg-transparent border-b border-edge text-xs text-content-secondary px-1 py-0.5 font-mono focus:border-content-muted focus:outline-none"
              value={active.preset}
              onChange={(e) => onUpdate(active.id, { preset: e.target.value })}
            >
              {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex justify-end pt-1">
            <TextButton label="DELETE" onClick={() => onDelete(active.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trace Panel ───────────────────────────────────────────────────────

function TracePanel({ events }: { events: TraceEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Trace" />
      <div className="flex-1 overflow-auto min-h-0 space-y-px">
        {events.length === 0 && (
          <div className="text-content-muted text-xs py-8 text-center">
            Run a spec to see the execution trace.
          </div>
        )}
        {events.map((evt, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] font-mono py-0.5">
            <span className={`flex-shrink-0 w-4 text-center ${
              evt.status === "complete" ? "text-primary"
              : evt.status === "running" ? "text-amber-500"
              : evt.status === "error" ? "text-red-500"
              : "text-content-muted"
            }`}>
              {evt.status === "complete" ? "\u2713"
               : evt.status === "running" ? "\u25CF"
               : evt.status === "error" ? "\u2717"
               : "\u00B7"}
            </span>
            <span className="text-content-muted">{evt.stepIndex !== undefined ? `#${evt.stepIndex}` : ""}</span>
            <span className="text-content-secondary truncate">{evt.toolName ?? evt.kind}</span>
            <span className="text-content-muted ml-auto flex-shrink-0">
              {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Scoreboard Panel ──────────────────────────────────────────────────

function ScoreboardPanel({ report }: { report: ConformanceReport | null }) {
  if (!report) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Scoreboard" />
        <div className="text-content-muted text-xs py-8 text-center">
          Conformance report will appear after execution.
        </div>
      </div>
    );
  }

  const gradeColor =
    report.grade === "A" ? "text-primary"
    : report.grade === "B" ? "text-green-400"
    : report.grade === "C" ? "text-amber-400"
    : report.grade === "D" ? "text-orange-400"
    : "text-red-400";

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Scoreboard" />
      <div className="space-y-3 text-xs font-mono">
        {/* Grade */}
        <div className="flex items-baseline gap-3">
          <span className={`text-3xl font-bold ${gradeColor}`}>{report.grade}</span>
          <span className="text-content-muted">{report.score}/100</span>
        </div>

        {/* Steps */}
        <div className="text-content-muted">
          {report.successfulSteps}/{report.totalSteps} steps
          {report.failedSteps > 0 && <span className="text-red-400 ml-2">{report.failedSteps} failed</span>}
          <span className="text-content-muted ml-2">{report.totalDurationMs}ms</span>
        </div>

        {/* Breakdown */}
        <div className="border-t border-edge/50 pt-2 space-y-1">
          {Object.entries(report.breakdown).map(([key, passed]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-content-muted">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <span className={passed ? "text-primary" : "text-content-muted"}>
                {passed ? "\u2713" : "\u25CB"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Timeline Panel ────────────────────────────────────────────────────

function TimelinePanel({ steps }: { steps: StepResult[] }) {
  const maxDuration = Math.max(1, ...steps.map((s) => s.durationMs ?? 0));

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Timeline" />
      <div className="flex-1 overflow-auto min-h-0 space-y-1.5">
        {steps.length === 0 && (
          <div className="text-content-muted text-xs py-8 text-center">
            Execution timeline will appear here.
          </div>
        )}
        {steps.map((step) => {
          const pct = ((step.durationMs ?? 0) / maxDuration) * 100;
          const barColor =
            step.status === "complete" ? "bg-cyan-500/70"
            : step.status === "running" ? "bg-amber-500/70"
            : "bg-red-500/70";

          return (
            <div key={step.stepIndex} className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-content-muted truncate">{step.tool}</span>
                <span className="text-content-muted ml-2 flex-shrink-0">
                  {step.durationMs !== undefined ? `${step.durationMs}ms` : "..."}
                </span>
              </div>
              <div className="h-px bg-surface-hover relative">
                <div
                  className={`absolute top-0 left-0 h-full ${barColor} transition-all duration-300`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Publish Panel ─────────────────────────────────────────────────────

function PublishPanel({
  sessionId, report, specs, selectedSpecId,
}: {
  sessionId: string | null;
  report: ConformanceReport | null;
  specs: EngineSpec[];
  selectedSpecId: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const spec = specs.find((s) => s.id === selectedSpecId);

  const curlCmd = spec
    ? `curl -X POST ${ENGINE_BASE}/api/workflows/${spec.workflow} \\
  -H "Content-Type: application/json" \\
  -d '{"preset": "${spec.preset}", "streaming": true}'`
    : "";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(curlCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [curlCmd]);

  const handleDownload = useCallback(() => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conformance-${sessionId ?? "report"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, sessionId]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Publish"
        actions={
          <>
            {report && <TextButton label="Download Report" onClick={handleDownload} />}
            {curlCmd && <TextButton label={copied ? "Copied" : "Copy curl"} onClick={handleCopy} />}
          </>
        }
      />
      {!spec ? (
        <div className="text-content-muted text-xs text-center">
          Select a spec to see publish options.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Curl preview */}
          <pre className="text-[10px] font-mono text-content-muted bg-surface-secondary/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
            {curlCmd}
          </pre>
          {/* Session info */}
          {sessionId && (
            <div className="text-[10px] text-content-muted font-mono">
              session {sessionId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Context Panel ────────────────────────────────────────────────────

interface ContextHealth {
  learningsCount: number;
  recentRunScores: number[];
  trendDirection: string;
  contentArchiveSize: number;
  daysSinceLastLearning: number | null;
  workflowCoverage: Record<string, number>;
}

const TREND_ICONS: Record<string, string> = {
  improving: "\u2191",    // ↑
  stable: "\u2192",       // →
  regressing: "\u2193",   // ↓
  insufficient_data: "\u2014", // —
};

const TREND_COLORS: Record<string, string> = {
  improving: "text-primary",
  stable: "text-content-muted",
  regressing: "text-red-400",
  insufficient_data: "text-content-muted",
};

function ContextPanel({ engineOnline, refreshKey }: { engineOnline: boolean | null; refreshKey: number }) {
  const [health, setHealth] = useState<ContextHealth | null>(null);

  useEffect(() => {
    if (!engineOnline) return;
    fetch(`${ENGINE_BASE}/api/context`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setHealth(d); })
      .catch(() => {});
  }, [engineOnline, refreshKey]);

  const freshness = health?.daysSinceLastLearning === null ? "never"
    : health?.daysSinceLastLearning === 0 ? "today"
    : `${health?.daysSinceLastLearning}d ago`;

  const maxScore = health?.recentRunScores?.length
    ? Math.max(1, ...health.recentRunScores)
    : 1;

  const coverageEntries = health?.workflowCoverage
    ? Object.entries(health.workflowCoverage).slice(0, 5)
    : [];

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Context" />

      {!health ? (
        <div className="text-content-muted text-xs py-8 text-center">
          {engineOnline ? "Loading context..." : "Engine offline."}
        </div>
      ) : (
        <div className="space-y-3 text-xs font-mono">
          {/* Learnings + Freshness */}
          <div className="flex items-baseline justify-between">
            <span className="text-content-muted">
              {health.learningsCount} learnings
            </span>
            <span className="text-content-muted text-[10px]">
              last {freshness}
            </span>
          </div>

          {/* Trend */}
          <div className="flex items-center gap-2">
            <span className={TREND_COLORS[health.trendDirection] ?? "text-content-muted"}>
              {TREND_ICONS[health.trendDirection] ?? "\u2014"} {health.trendDirection}
            </span>
          </div>

          {/* Score Sparkline */}
          {health.recentRunScores.length > 0 && (
            <div className="border-t border-edge/50 pt-2">
              <div className="text-[10px] text-content-muted mb-1">Recent scores</div>
              <div className="flex items-end gap-px h-6">
                {[...health.recentRunScores].reverse().map((score, i) => {
                  const pct = (score / maxScore) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-primary/50 rounded-sm min-w-[2px]"
                      style={{ height: `${Math.max(8, pct)}%` }}
                      title={`${score}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Content Archive */}
          <div className="flex items-baseline justify-between border-t border-edge/50 pt-2">
            <span className="text-content-muted">archive</span>
            <span className="text-content-muted">{health.contentArchiveSize} items</span>
          </div>

          {/* Workflow Coverage */}
          {coverageEntries.length > 0 && (
            <div className="border-t border-edge/50 pt-2 space-y-1">
              <div className="text-[10px] text-content-muted">Workflow coverage</div>
              {coverageEntries.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between text-[10px]">
                  <span className="text-content-muted truncate">{name}</span>
                  <span className="text-content-muted ml-2">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────

export function EngineDemoView() {
  const [specs, setSpecs] = useState<EngineSpec[]>(loadSpecs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [report, setReport] = useState<ConformanceReport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Persist specs
  useEffect(() => { saveSpecs(specs); }, [specs]);

  // Check engine health
  useEffect(() => {
    fetch(`${ENGINE_BASE}/api/health`)
      .then((r) => r.ok ? setEngineOnline(true) : setEngineOnline(false))
      .catch(() => setEngineOnline(false));
  }, []);

  const handleCreate = useCallback(() => {
    const spec: EngineSpec = {
      id: genId(),
      name: `Spec ${specs.length + 1}`,
      workflow: "fix_bug",
      preset: "default",
      stepArgs: {},
      status: "draft",
    };
    setSpecs((prev) => [spec, ...prev]);
    setSelectedId(spec.id);
  }, [specs.length]);

  const handleDelete = useCallback((id: string) => {
    setSpecs((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const handleUpdate = useCallback((id: string, patch: Partial<EngineSpec>) => {
    setSpecs((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const handleRun = useCallback((spec: EngineSpec) => {
    // Reset state
    setTraceEvents([]);
    setStepResults([]);
    setReport(null);
    setSessionId(null);
    handleUpdate(spec.id, { status: "running" });

    // Close previous SSE connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Start SSE workflow execution
    const url = `${ENGINE_BASE}/api/workflows/${spec.workflow}`;
    const body = JSON.stringify({
      preset: spec.preset,
      stepArgs: spec.stepArgs,
      streaming: true,
    });

    // EventSource doesn't support POST, use fetch + ReadableStream
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).then(async (response) => {
      if (!response.ok || !response.body) {
        handleUpdate(spec.id, { status: "failed" });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(currentEvent, data, spec.id);
            } catch { /* skip malformed */ }
            currentEvent = "";
          }
        }
      }
    }).catch(() => {
      handleUpdate(spec.id, { status: "failed" });
    });
  }, [handleUpdate]);

  const handleSSEEvent = useCallback((event: string, data: any, specId: string) => {
    if (event === "start") {
      setSessionId(data.sessionId);
    } else if (event === "step") {
      const traceEvt: TraceEvent = {
        kind: "tool.invoke",
        toolName: data.tool,
        stepIndex: data.stepIndex,
        status: data.status,
        timestamp: Date.now(),
      };
      setTraceEvents((prev) => [...prev, traceEvt]);

      if (data.status === "complete" || data.status === "error") {
        const stepResult: StepResult = {
          stepIndex: data.stepIndex,
          tool: data.tool,
          action: data.action,
          status: data.status,
          durationMs: data.durationMs,
          result: data.result,
        };
        setStepResults((prev) => {
          const existing = prev.findIndex((s) => s.stepIndex === data.stepIndex);
          if (existing >= 0) {
            const copy = [...prev];
            copy[existing] = stepResult;
            return copy;
          }
          return [...prev, stepResult];
        });
      }
    } else if (event === "context") {
      // Context was loaded — inject trace event
      setTraceEvents((prev) => [...prev, {
        kind: "context.loaded",
        toolName: `context: ${data.recentRunCount ?? 0} runs, ${data.learningsAvailable ?? 0} learnings`,
        status: "complete",
        timestamp: Date.now(),
      }]);
    } else if (event === "complete") {
      setReport({
        score: data.conformanceScore,
        grade: data.grade,
        breakdown: {},
        summary: "",
        totalSteps: data.totalSteps,
        successfulSteps: data.totalSteps,
        failedSteps: 0,
        totalDurationMs: data.totalDurationMs,
      });
      setSpecs((prev) => prev.map((s) =>
        s.id === specId ? { ...s, status: "completed" } : s
      ));
      // Refresh context panel after run completes
      setContextRefreshKey((k) => k + 1);

      // Fetch full report
      if (data.sessionId) {
        fetch(`${ENGINE_BASE}/api/sessions/${data.sessionId}/report`)
          .then((r) => r.json())
          .then((d) => { if (d.ok && d.report) setReport(d.report); })
          .catch(() => {});
      }
    }
  }, []);

  return (
    <div className="h-full bg-surface text-content font-mono flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-edge/40">
        <div className="flex items-center gap-3">
          <span className="text-sm text-content">Engine</span>
          <span className="text-[10px] text-content-muted">v1.0.0</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-[10px] ${engineOnline ? "text-emerald-500" : "text-content-muted"}`}>
            {engineOnline === null ? "checking..." : engineOnline ? "online :6276" : "offline"}
          </span>
        </div>
      </div>

      {/* Grid: 3×2 */}
      <div className="flex-1 grid grid-cols-3 grid-rows-2 min-h-0">
        {/* Row 1: Spec / Trace / Context */}
        <div className="p-5 border-r border-b border-edge/30 overflow-hidden">
          <SpecPanel
            specs={specs}
            selected={selectedId}
            onSelect={setSelectedId}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onRun={handleRun}
          />
        </div>

        <div className="p-5 border-r border-b border-edge/30 overflow-hidden">
          <TracePanel events={traceEvents} />
        </div>

        <div className="p-5 border-b border-edge/30 overflow-hidden">
          <ContextPanel engineOnline={engineOnline} refreshKey={contextRefreshKey} />
        </div>

        {/* Row 2: Scoreboard / Timeline / Publish */}
        <div className="p-5 border-r border-edge/30 overflow-hidden">
          <ScoreboardPanel report={report} />
        </div>

        <div className="p-5 border-r border-edge/30 overflow-hidden">
          <TimelinePanel steps={stepResults} />
        </div>

        <div className="p-5 overflow-hidden">
          <PublishPanel
            sessionId={sessionId}
            report={report}
            specs={specs}
            selectedSpecId={selectedId}
          />
        </div>
      </div>
    </div>
  );
}

export default EngineDemoView;
