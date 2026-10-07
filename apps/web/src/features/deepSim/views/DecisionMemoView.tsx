import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Lightbulb,
  Link2,
  Scale,
  ShieldAlert,
  Variable,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";
import type {
  DeepSimClaim,
  DeepSimCounterModel,
  DeepSimIntervention,
  DeepSimMemo,
  DeepSimScenario,
  DeepSimSourceRef,
  DeepSimVariable,
} from "../types";
import { confidenceCategory } from "../types";
import {
  coerceDeepSimFixtureKey,
  DEEP_SIM_FIXTURE_OPTIONS,
  getDeepSimFixture,
} from "../fixtures";
import { HcsnGraphPanel } from "../components/HcsnGraphPanel";

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function confidenceDotColor(c: number): string {
  const cat = confidenceCategory(c);
  switch (cat) {
    case "high":
      return "bg-emerald-500";
    case "medium":
      return "bg-cyan-500";
    case "low":
      return "bg-amber-500";
    case "very_low":
      return "bg-rose-500";
  }
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function confidenceBadgeBg(c: number): string {
  const cat = confidenceCategory(c);
  switch (cat) {
    case "high":
      return "bg-emerald-500/10 text-emerald-400";
    case "medium":
      return "bg-cyan-500/10 text-cyan-400";
    case "low":
      return "bg-amber-500/10 text-amber-400";
    case "very_low":
      return "bg-rose-500/10 text-rose-400";
  }
}

function sensitivityBadgeClasses(s: "high" | "medium" | "low"): string {
  switch (s) {
    case "high":
      return "bg-rose-500/10 text-rose-400";
    case "medium":
      return "bg-amber-500/10 text-amber-400";
    case "low":
      return "bg-emerald-500/10 text-emerald-400";
  }
}

/* ------------------------------------------------------------------ */
/*  Inline badge — matches Ask surface DNA                             */
/* ------------------------------------------------------------------ */

function ConfidenceBadge({ confidence }: { confidence: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
        confidenceBadgeBg(confidence),
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", confidenceDotColor(confidence))} aria-hidden="true" />
      {formatPercent(confidence)}
    </span>
  );
}

function NeutralBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-content-muted/70",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Card primitives — raw Tailwind matching Ask DNA                    */
/* ------------------------------------------------------------------ */

const CARD_BASE = "rounded-xl border border-white/[0.06] bg-white/[0.02] p-4";
const CARD_INTERACTIVE = `${CARD_BASE} transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]`;
const CARD_COMPACT = "rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3";
const SECTION_TITLE = "mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted";

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function VariableChip({ variable }: { variable: DeepSimVariable }) {
  return (
    <div className={CARD_COMPACT} data-agent-id={variable.id}>
      <div className="flex items-center gap-2">
        <Variable className="h-3.5 w-3.5 shrink-0 text-content-muted/70" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-content">{variable.name}</div>
          <div className="text-[11px] text-content-muted/70">{variable.currentValue}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] font-medium tabular-nums text-content-muted/70">
            w{formatPercent(variable.weight)}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium",
              sensitivityBadgeClasses(variable.sensitivity),
            )}
          >
            {variable.sensitivity}
          </span>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: DeepSimScenario }) {
  return (
    <div
      className={cn(CARD_BASE, "flex flex-col")}
      data-agent-id={scenario.id}
      data-agent-action="scenario"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-content">{scenario.title}</h3>
        <ConfidenceBadge confidence={scenario.confidence} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{scenario.expectedOutcome}</p>

      {scenario.keyAssumptions.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-muted/70">Key assumptions</div>
          <ul className="mt-1.5 space-y-1">
            {scenario.keyAssumptions.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-content-secondary">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-content-muted" aria-hidden="true" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scenario.risks.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-content-muted/70">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Risks
          </div>
          <ul className="mt-1.5 space-y-1">
            {scenario.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-content-secondary">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InterventionRow({ intervention }: { intervention: DeepSimIntervention }) {
  return (
    <li data-agent-id={String(intervention.rank)}>
      <div className={CARD_COMPACT}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600/10 text-xs font-bold text-indigo-400">
            {intervention.rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-content">{intervention.title}</span>
              <ConfidenceBadge confidence={intervention.confidence} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-content-muted/70">
              <span>Delta: {intervention.expectedDelta}</span>
              <span>Cost: {intervention.cost}</span>
              <span>Timeframe: {intervention.timeframe}</span>
              <NeutralBadge>{intervention.category}</NeutralBadge>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}


function CounterModelCallout({ model }: { model: DeepSimCounterModel }) {
  return (
    <aside
      className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4"
      role="complementary"
      aria-label="Counter-model"
      data-agent-id={model.id}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-amber-400">Counter-Model</h3>
        <ConfidenceBadge confidence={model.confidence} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{model.thesis}</p>

      <div className="mt-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-content-muted/70">Key evidence</div>
        <ul className="mt-1.5 space-y-1">
          {model.keyEvidence.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-content-secondary">
              <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              {e}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 text-xs text-content-muted/70">
        <span className="font-medium">Key assumption:</span> {model.keyAssumption}
      </div>
      <div className="mt-1 text-xs italic text-content-muted/70">Would validate: {model.whatWouldValidate}</div>
    </aside>
  );
}

function SourcePacketItem({ source }: { source: DeepSimSourceRef }) {
  return (
    <div className={CARD_COMPACT} data-agent-id={source.ref}>
      <div className="flex items-center justify-between gap-2">
        <NeutralBadge className="text-[10px] uppercase tracking-wide">
          {source.type}
        </NeutralBadge>
        <span className="truncate text-[11px] text-content-muted/70">{source.ref}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{source.summary}</p>
    </div>
  );
}

function EvidenceDrawer({ claims }: { claims: DeepSimClaim[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="evidence-heading" data-agent-id="evidence-drawer">
      <button
        type="button"
        className={cn(CARD_INTERACTIVE, "flex w-full items-center justify-between text-left")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="evidence-panel"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-content" id="evidence-heading">
          <FileText className="h-4 w-4 text-content-muted/70" aria-hidden="true" />
          Evidence ({claims.length} claims)
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-content-muted/70" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-content-muted/70" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id="evidence-panel" className="mt-2 space-y-2" role="region" aria-label="Evidence claims">
          {claims.map((claim) => (
            <div
              key={claim.id}
              className={CARD_COMPACT}
              data-agent-id={claim.id}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-content">{claim.text}</p>
                <ConfidenceBadge confidence={claim.confidence} />
              </div>
              {claim.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {claim.sources.map((src, i) => (
                    <NeutralBadge key={i} className="text-[10px]">
                      {src}
                    </NeutralBadge>
                  ))}
                </div>
              )}
              {claim.contradictions.length > 0 && (
                <div className="mt-2 text-[11px] text-rose-400">
                  Contradictions: {claim.contradictions.join("; ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Workflow tabs — raw Tailwind                                       */
/* ------------------------------------------------------------------ */

const WORKFLOW_TABS = [
  { id: "investor_diligence" as const, label: "Investor Diligence" },
  { id: "founder_strategy" as const, label: "Founder Strategy" },
];

/* ------------------------------------------------------------------ */
/*  Main view                                                          */
/* ------------------------------------------------------------------ */

function useShareUrl() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return { copied, copy };
}

function ShareButton() {
  const { copied, copy } = useShareUrl();
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-content-muted hover:bg-white/[0.04] hover:text-content transition-colors"
      aria-label={copied ? "Link copied" : "Copy shareable link"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Share"}
    </button>
  );
}

function DecisionMemoViewInner({ memo: overrideMemo }: { memo?: DeepSimMemo }) {
  // NOTE: useRevealOnMount relies on IntersectionObserver which doesn't fire
  // when this view is mounted inside a hidden cockpit surface. We render
  // immediately visible instead — the cockpit surface transition handles animation.
  const ref = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const fixtureKey = coerceDeepSimFixtureKey(searchParams.get("fixture"));
  const fixture = getDeepSimFixture(fixtureKey);
  const m = overrideMemo ?? fixture.memo;

  const activeTab = fixture.workflow === "founder_strategy" ? "founder_strategy" : "investor_diligence";

  const handleFixtureChange = (nextKey: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("fixture", nextKey);
    setSearchParams(next, { replace: true });
  };

  const handleWorkflowChange = (nextWorkflow: string) => {
    const matchingFixture = DEEP_SIM_FIXTURE_OPTIONS.find((option) =>
      nextWorkflow === "founder_strategy"
        ? option.key.includes("founder") || option.key.includes("strategy")
        : !option.key.includes("founder") && !option.key.includes("strategy"),
    );
    if (matchingFixture) handleFixtureChange(matchingFixture.key);
  };

  // Render immediately visible — no stagger gating on IntersectionObserver
  const stagger = useCallback(
    (_delay: string): React.CSSProperties => ({}),
    [],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div ref={ref} className="mx-auto max-w-4xl px-6 py-8" data-agent-surface="decision-memo">
        {/* Top bar — fixture selector + frozen date */}
        <div style={stagger("0s")} className="flex items-center justify-between border-b border-white/[0.06] pb-4">
          <span className="flex items-center gap-1.5 text-xs font-medium text-content-muted/70">
            <Scale className="h-3.5 w-3.5" aria-hidden="true" />
            <select
              value={fixtureKey}
              onChange={(e) => handleFixtureChange(e.target.value)}
              className="appearance-none bg-transparent text-xs font-medium text-content-muted/70 hover:text-content cursor-pointer focus:outline-none"
              aria-label="Select analysis fixture"
            >
              {DEEP_SIM_FIXTURE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key} className="bg-[#1a1a2e] text-content">
                  {opt.label}
                </option>
              ))}
            </select>
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-content-muted/70">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              Frozen: {new Date(fixture.frozenAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <ShareButton />
          </div>
        </div>

        {/* Action hero — tells users what this page does */}
        <div style={stagger("0.05s")} className="mt-8 mb-8 text-center">
          <h2 className="text-2xl font-bold text-content">What should you decide?</h2>
          <p className="mt-2 text-sm text-content-muted/70">
            Drop a source packet or pick a scenario. NodeBench maps the variables, compares the branches, and shows the clearest next move.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              className="rounded-xl bg-accent-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-primary/20 hover:bg-accent-primary/80 transition-colors"
              data-agent-action="start-analysis"
            >
              Start new analysis
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/[0.06] px-5 py-2.5 text-sm font-medium text-content-secondary hover:bg-white/[0.04] transition-colors"
              data-agent-action="view-demo"
            >
              View demo: Acme AI Series A
            </button>
          </div>
        </div>

        {/* Hero header */}
        <div style={stagger("0.1s")}>
          <h1 className="text-2xl font-bold tracking-tight text-content">Decision Workbench</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-secondary">
            Takes messy inputs, maps variables, compares branches, and surfaces the clearest next move with evidence.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <NeutralBadge className="uppercase tracking-wide">
              {fixture.workflow.replaceAll("_", " ")}
            </NeutralBadge>
          </div>
        </div>

        {/* Workflow tabs */}
        <Tabs value={activeTab} onValueChange={handleWorkflowChange} className="contents">
        <TabsList
          style={stagger("0.15s")}
          className="mt-6 flex h-auto justify-start gap-1 rounded-none border-b border-white/[0.06] bg-transparent p-0"
          aria-label="Workflow type"
        >
          {WORKFLOW_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors data-[state=active]:bg-transparent data-[state=active]:text-content data-[state=active]:shadow-none",
                activeTab === tab.id
                  ? "border-indigo-500 text-content"
                  : "border-transparent text-content-muted/70 hover:text-content-secondary",
              )}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab panel content */}
        <TabsContent value={activeTab} className="mt-0" aria-label={`${activeTab === "founder_strategy" ? "Founder Strategy" : "Investor Diligence"} content`}>

        {/* Stats row */}
        <div style={stagger("0.2s")} className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Memo overview" data-agent-id="memo-overview">
          <div className={CARD_COMPACT}>
            <div className="text-sm font-medium text-content">{m.question}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-content-muted">Question</div>
          </div>
          <div className={CARD_COMPACT}>
            <div className="text-2xl font-bold text-content">{fixture.evidenceSummary.sourceCount}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-content-muted">Sources</div>
            <div className="mt-0.5 text-[11px] text-content-muted/70">
              {fixture.evidenceSummary.verifiedCount} verified, {fixture.evidenceSummary.partialCount} partial
            </div>
          </div>
          <div className={CARD_COMPACT}>
            <div className="flex items-center gap-2">
              <ConfidenceBadge confidence={m.confidence} />
              <span className="text-xs text-content-muted/70">current</span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-content-muted">Confidence</div>
          </div>
          <div className={CARD_COMPACT}>
            <div className="text-sm font-medium text-content">
              {new Date(m.forecastCheckDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-content-muted">Forecast Check</div>
          </div>
        </div>

        {/* Recommendation */}
        <div style={stagger("0.25s")} className="mt-8" data-agent-id="hero">
          <div className={SECTION_TITLE}>Recommendation</div>
          <div className={CARD_BASE}>
            <h2 className="flex flex-wrap items-center gap-3 text-xl font-bold leading-snug tracking-tight text-content md:text-2xl">
              {m.question}
              <ConfidenceBadge confidence={m.confidence} />
            </h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-content md:text-lg">
              {m.recommendation}
            </p>
            <p className="mt-2 max-w-3xl text-sm italic leading-relaxed text-content-muted/70">
              {m.whatWouldChangeMyMind}
            </p>
          </div>
        </div>

        {/* Source Packet */}
        <div style={stagger("0.3s")} className="mt-8" data-agent-id="source-packet">
          <div className={SECTION_TITLE}>Source Packet</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fixture.sourcePacket.sources.map((source) => (
              <SourcePacketItem key={source.ref} source={source} />
            ))}
          </div>
        </div>

        {/* HCSN Graph */}
        <div style={stagger("0.35s")} className="mt-8" data-agent-id="hcsn">
          <h3 className="sr-only">Hierarchical Causal Structure Network</h3>
          <HcsnGraphPanel graph={fixture.hcsn} />
        </div>

        {/* Top Variables */}
        <div style={stagger("0.4s")} className="mt-8" data-agent-id="top-variables">
          <div className={SECTION_TITLE}>Top Variables</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.topVariables.map((v) => (
              <VariableChip key={v.id} variable={v} />
            ))}
          </div>
        </div>

        {/* Scenarios */}
        <div style={stagger("0.45s")} className="mt-8" data-agent-id="scenarios">
          <div className={SECTION_TITLE}>Scenarios</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.scenarios.slice(0, 3).map((sc) => (
              <ScenarioCard key={sc.id} scenario={sc} />
            ))}
          </div>
        </div>

        {/* Ranked Interventions */}
        <div style={stagger("0.5s")} className="mt-8" data-agent-id="interventions">
          <div className={SECTION_TITLE}>Ranked Interventions</div>
          <ol className="space-y-2" aria-label="Ranked interventions list">
            {m.interventions.map((iv) => (
              <InterventionRow key={iv.rank} intervention={iv} />
            ))}
          </ol>
        </div>

        {/* Counter-Model */}
        <div style={stagger("0.55s")} className="mt-8" data-agent-id="counter-model">
          <h3 className="sr-only">Counter-Model</h3>
          <CounterModelCallout model={m.counterModel} />
        </div>

        {/* Evidence Drawer */}
        <div style={stagger("0.6s")} className="mt-8">
          <EvidenceDrawer claims={m.evidence} />
        </div>

        {/* Forecast check footer */}
        <div style={stagger("0.65s")} className="mt-8 mb-4" data-agent-id="forecast-check">
          <div className={CARD_COMPACT}>
            <div className="flex items-center gap-2" role="status" aria-label="Forecast check date">
              <Lightbulb className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <span className="text-sm text-content-secondary">
                Next forecast check:{" "}
                <time dateTime={m.forecastCheckDate} className="font-semibold text-content">
                  {new Date(m.forecastCheckDate).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </time>
              </span>
            </div>
          </div>
        </div>

        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export const DecisionMemoView = memo(DecisionMemoViewInner);
export default DecisionMemoView;
