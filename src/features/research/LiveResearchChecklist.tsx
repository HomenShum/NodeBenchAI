/**
 * LiveResearchChecklist — Sprint Q1 2026
 *
 * Closes the QA audit P1 finding "No visible live checklist or tool-call
 * evidence focus animation" (.tmp/qa-design-audit/NODEBENCH_DESIGN_PRINCIPLES_AUDIT.md).
 *
 * The audit lists the 14 canonical stages NodeBench runs through to
 * answer a research question:
 *
 *   1. Understanding the prompt
 *   2. Entity identification
 *   3. Memory check
 *   4. Source plan
 *   5. Official sources
 *   6. News / web
 *   7. Primary reading
 *   8. Claims extraction
 *   9. Contradictions check
 *  10. Graph build
 *  11. Evidence scoring
 *  12. Memo drafting
 *  13. Citations
 *  14. Vault save
 *
 * Each stage has one of four states: waiting / running / passed / warning.
 * This component renders the stages as a vertical checklist with state
 * dots + labels + a status pill + an optional one-line detail. It can
 * either be driven externally (via the `stages` prop) or auto-cycle
 * through a demo sequence so anonymous showcase visitors see the live-
 * progress shape even without a real backend run.
 *
 * The streaming chat at /redesign/chat already emits real "tool_call"
 * events from Convex (Phases 1-7); a future PR can pipe those events
 * directly into `stages` for a live data-driven render. For now this
 * component honors the audit by making the run process visible.
 */

import { useEffect, useMemo, useState } from "react";

export type ResearchStageId =
  | "understanding"
  | "entity"
  | "memory"
  | "source_plan"
  | "official"
  | "news_web"
  | "primary_reading"
  | "claims"
  | "contradictions"
  | "graph"
  | "evidence_scoring"
  | "memo_draft"
  | "citations"
  | "vault_save";

export type ResearchStageState = "waiting" | "running" | "passed" | "warning";

export interface ResearchStage {
  id: ResearchStageId;
  label: string;
  /** One-line detail about what this stage checked (e.g. "12 sources, 4 official"). */
  detail?: string;
  state: ResearchStageState;
  /** Optional short hint shown when state === "warning". */
  warning?: string;
  /** Optional tool name to label the row (e.g. "web_search"). */
  tool?: string;
}

const DEFAULT_STAGES: ResearchStage[] = [
  { id: "understanding", label: "Understanding the prompt", state: "waiting" },
  { id: "entity", label: "Entity identification", state: "waiting" },
  { id: "memory", label: "Memory check", state: "waiting" },
  { id: "source_plan", label: "Source plan", state: "waiting" },
  { id: "official", label: "Official sources", state: "waiting" },
  { id: "news_web", label: "News / web", state: "waiting" },
  { id: "primary_reading", label: "Primary reading", state: "waiting" },
  { id: "claims", label: "Claims extraction", state: "waiting" },
  { id: "contradictions", label: "Contradictions check", state: "waiting" },
  { id: "graph", label: "Graph build", state: "waiting" },
  { id: "evidence_scoring", label: "Evidence scoring", state: "waiting" },
  { id: "memo_draft", label: "Memo drafting", state: "waiting" },
  { id: "citations", label: "Citations", state: "waiting" },
  { id: "vault_save", label: "Vault save", state: "waiting" },
];

function stateColor(state: ResearchStageState) {
  switch (state) {
    case "passed":
      return { bg: "var(--rd-green, #15803d)", border: "var(--rd-green, #15803d)" };
    case "running":
      return { bg: "var(--rd-accent, #d97757)", border: "var(--rd-accent, #d97757)" };
    case "warning":
      return { bg: "var(--rd-amber, #b45309)", border: "var(--rd-amber, #b45309)" };
    default:
      return { bg: "transparent", border: "rgba(0,0,0,0.18)" };
  }
}

interface LiveResearchChecklistProps {
  /** Externally-driven stage list. When omitted, the component auto-cycles
   *  through the 14 default stages as a visible demo so users always see
   *  the run shape, even without backend events. */
  stages?: ResearchStage[];
  /** When true, the component renders the auto-demo even if stages are passed.
   *  Useful for screenshot tests. */
  forceDemo?: boolean;
  /** Compact mode shrinks vertical density for embedding inside chat turns. */
  compact?: boolean;
  /** Optional title override (default: "Live research"). */
  title?: string;
  /** Hide everything once the demo finishes (waiting → all-passed → reset),
   *  for screenshots that prefer a single-frame steady state. */
  hideOnComplete?: boolean;
}

/** Demo cycle: every CYCLE_MS, advance one stage from waiting → running,
 *  the prior running → passed (with one warning sprinkled in). When all
 *  stages are passed, reset back to waiting and start over. */
const CYCLE_MS = 1_400;
const WARNING_INDEX = 8; // contradictions stage gets a warning to demo non-happy path

function buildAutoCycle(elapsed: number): ResearchStage[] {
  const tick = Math.floor(elapsed / CYCLE_MS) % (DEFAULT_STAGES.length + 2);
  return DEFAULT_STAGES.map((stage, i) => {
    if (tick > DEFAULT_STAGES.length) return { ...stage, state: "passed" as ResearchStageState };
    if (i < tick) {
      const wasWarning = i === WARNING_INDEX;
      return {
        ...stage,
        state: wasWarning ? ("warning" as ResearchStageState) : ("passed" as ResearchStageState),
        detail: i === 0 ? "deep diligence intent · banker lens"
          : i === 1 ? "1 entity · DISCO (Series C legal tech)"
          : i === 2 ? "12 prior reports · 38 claims indexed"
          : i === 3 ? "5 source classes · official + news + primary"
          : i === 4 ? "4 SEC filings · 1 court ruling"
          : i === 5 ? "11 articles · 2026-04 → today"
          : i === 6 ? "Q3 IR pack · S-1 amendment"
          : i === 7 ? "23 claims extracted from 8 sources"
          : i === 8 ? "1 contradiction in pricing claim"
          : i === 9 ? "8 entities · 14 edges"
          : i === 10 ? "evidence score 4.7 / 6"
          : i === 11 ? "260-word banker memo"
          : i === 12 ? "23 / 23 cites linked to source"
          : "stored to Orbital Labs vault",
        warning: wasWarning ? "Pricing claim disagreed across two sources — flagged for review" : undefined,
      };
    }
    if (i === tick) {
      return {
        ...stage,
        state: "running" as ResearchStageState,
        detail: i === 0 ? "parsing intent…"
          : i === 1 ? "resolving named entities…"
          : i === 2 ? "scanning vault for prior runs…"
          : i === 3 ? "ranking source classes…"
          : i === 4 ? "fetching SEC + court records…"
          : i === 5 ? "calling web_search…"
          : i === 6 ? "reading primary sources…"
          : i === 7 ? "extracting claims…"
          : i === 8 ? "checking for contradictions…"
          : i === 9 ? "constructing entity graph…"
          : i === 10 ? "scoring evidence weight…"
          : i === 11 ? "drafting memo…"
          : i === 12 ? "linking citations…"
          : "saving to vault…",
      };
    }
    return { ...stage, state: "waiting" as ResearchStageState };
  });
}

export function LiveResearchChecklist({
  stages,
  forceDemo,
  compact,
  title = "Live research",
  hideOnComplete = false,
}: LiveResearchChecklistProps) {
  const [elapsed, setElapsed] = useState(0);
  const useDemo = forceDemo || !stages || stages.length === 0;
  useEffect(() => {
    if (!useDemo) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      setElapsed(performance.now() - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [useDemo]);

  const view = useMemo<ResearchStage[]>(() => {
    if (useDemo) return buildAutoCycle(elapsed);
    return stages!;
  }, [useDemo, elapsed, stages]);

  const passed = view.filter((s) => s.state === "passed").length;
  const running = view.find((s) => s.state === "running");
  const warnings = view.filter((s) => s.state === "warning");
  const allDone = passed === view.length && !running;
  if (hideOnComplete && allDone) return null;

  return (
    <section
      data-testid="live-research-checklist"
      aria-label="Live research progress"
      className="rd-card"
      style={{
        padding: compact ? "10px 12px" : "14px 16px",
        background: "var(--rd-paper, #fff)",
        borderColor: "var(--rd-line-faint, rgba(0,0,0,0.08))",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          className="rd-eyebrow"
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            color: "var(--rd-accent-strong, #c75a3a)",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
        <span className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
          {passed} / {view.length} passed
          {running ? ` · ${running.label.toLowerCase()}…` : ""}
          {warnings.length > 0 ? ` · ${warnings.length} flagged` : ""}
        </span>
      </header>
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: compact ? 2 : 4,
        }}
      >
        {view.map((stage) => {
          const colors = stateColor(stage.state);
          const isRunning = stage.state === "running";
          return (
            <li
              key={stage.id}
              data-stage={stage.id}
              data-state={stage.state}
              style={{
                display: "grid",
                gridTemplateColumns: "16px 1fr auto",
                alignItems: "center",
                gap: 10,
                padding: compact ? "3px 4px" : "5px 6px",
                borderRadius: 6,
                opacity: stage.state === "waiting" ? 0.55 : 1,
                transition: "opacity 200ms ease, background 200ms ease",
                background: isRunning ? "var(--rd-accent-tint, rgba(217,119,87,0.07))" : "transparent",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: `1.5px solid ${colors.border}`,
                  background: colors.bg,
                  marginLeft: 3,
                  position: "relative",
                  animation: isRunning ? "rd-pulse 1.1s ease-in-out infinite" : undefined,
                }}
              />
              <span
                style={{
                  fontSize: compact ? 12 : 13,
                  fontWeight: stage.state === "running" ? 600 : 500,
                  color: stage.state === "waiting"
                    ? "var(--rd-ink-mute, #475569)"
                    : "var(--rd-ink-strong, #0f172a)",
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>{stage.label}</span>
                {stage.detail && (
                  <span
                    className="rd-faint"
                    style={{ fontSize: compact ? 10.5 : 11, fontWeight: 400 }}
                  >
                    {stage.detail}
                  </span>
                )}
                {stage.warning && (
                  <span
                    style={{
                      fontSize: compact ? 10 : 10.5,
                      color: "var(--rd-amber, #b45309)",
                      fontStyle: "italic",
                    }}
                  >
                    ⚠ {stage.warning}
                  </span>
                )}
              </span>
              <span
                className="rd-mono rd-faint"
                style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}
              >
                {stage.tool ?? stage.state}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default LiveResearchChecklist;
