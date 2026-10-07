/**
 * ConnectSourcesWizard — 3-step "make it work with my world" setup flow.
 *
 * Step 1: What are you analyzing? (entity name, type, optional URL)
 * Step 2: Connect your sources (toggle cards for docs, GitHub, URLs, metrics, notes, MCP)
 * Step 3: Run your first analysis (workflow preset selector + CTA)
 *
 * Route: /connect (view key: connect-sources)
 * Design: glass card DNA, warm terracotta accent, stagger reveal.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Check,
  Code2,
  FileText,
  Globe,
  Layers,
  LineChart,
  Link2,
  MessageSquare,
  Sparkles,
  StickyNote,
  Target,
  Terminal,
  TrendingUp,
  Upload,
  Users,
  User,
  Rocket,
  BarChart3,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type EntityType = "company" | "product" | "founder" | "creator" | "market" | "team";

interface EntityTypeOption {
  value: EntityType;
  label: string;
  Icon: typeof Briefcase;
}

interface SourceCard {
  id: string;
  label: string;
  description: string;
  Icon: typeof FileText;
  placeholder?: string;
}

interface WorkflowPreset {
  id: string;
  icon: typeof TrendingUp;
  label: string;
  description: string;
}

/* ─── Static data ────────────────────────────────────────────────────────── */

const ENTITY_TYPES: EntityTypeOption[] = [
  { value: "company", label: "Company", Icon: Briefcase },
  { value: "product", label: "Product", Icon: Layers },
  { value: "founder", label: "Founder", Icon: User },
  { value: "creator", label: "Creator", Icon: Sparkles },
  { value: "market", label: "Market", Icon: TrendingUp },
  { value: "team", label: "Team", Icon: Users },
];

const SOURCE_CARDS: SourceCard[] = [
  {
    id: "documents",
    label: "Documents",
    description: "PDFs, pitch decks, memos, notes",
    Icon: FileText,
    placeholder: "Drag & drop files here",
  },
  {
    id: "github",
    label: "GitHub Repos",
    description: "Paste a repo URL to analyze",
    Icon: Code2,
    placeholder: "https://github.com/org/repo",
  },
  {
    id: "urls",
    label: "URLs & Websites",
    description: "Web pages to monitor and analyze",
    Icon: Globe,
    placeholder: "https://example.com",
  },
  {
    id: "metrics",
    label: "Metrics & Data",
    description: "CSV upload or API endpoint",
    Icon: LineChart,
    placeholder: "Paste CSV or API URL",
  },
  {
    id: "notes",
    label: "Notes & Context",
    description: "Free-text background context",
    Icon: StickyNote,
    placeholder: "Add any relevant context...",
  },
  {
    id: "mcp",
    label: "MCP Connection",
    description: "Connect your local agent directly",
    Icon: Terminal,
  },
];

const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: "investor-diligence",
    icon: TrendingUp,
    label: "Investor Diligence",
    description: "Is this company compounding or just storytelling?",
  },
  {
    id: "ceo-strategy",
    icon: Target,
    label: "CEO Strategy",
    description: "What are the top variables and what should I do next?",
  },
  {
    id: "gtm-planning",
    icon: Layers,
    label: "GTM Planning",
    description: "How should we position this and what could go wrong?",
  },
  {
    id: "product-launch",
    icon: Rocket,
    label: "Product Launch",
    description: "What resonates, what's noise, what compounds?",
  },
  {
    id: "creator-growth",
    icon: Sparkles,
    label: "Creator Growth",
    description: "How do I adapt without becoming generic?",
  },
  {
    id: "competitive-analysis",
    icon: BarChart3,
    label: "Competitive Analysis",
    description: "Where do we win and where are we exposed?",
  },
];

/** Demo preview matching DEMO_PACKET structure from landing page. */
const DEMO_PREVIEW = {
  question: "Should we raise Series A now or wait until Q3?",
  confidence: 78,
  sourceCount: 14,
  topVariables: [
    "Distribution quality",
    "Competitive entry timing",
    "Revenue retention trend",
  ],
  scenarios: [
    { label: "Base", probability: 55 },
    { label: "Bull", probability: 25 },
    { label: "Bear", probability: 20 },
  ],
};

/* ─── Step indicator ─────────────────────────────────────────────────────── */

const STEP_LABELS = ["What are you analyzing?", "Connect your sources", "Run your first analysis"];

const StepIndicator = memo(function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-3" data-agent-id="connect-step-indicator">
      {STEP_LABELS.map((label, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-6 transition-colors duration-300 ${
                  isDone ? "bg-accent-primary" : "bg-white/[0.08]"
                }`}
              />
            )}
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/20"
                  : isDone
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "border border-white/[0.1] text-content-muted"
              }`}
              aria-current={isActive ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${label}`}
            >
              {isDone ? <Check size={12} /> : i + 1}
            </div>
            <span
              className={`hidden text-xs sm:inline ${
                isActive ? "font-medium text-content" : "text-content-muted"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
});

/* ─── Step 1: What are you analyzing? ────────────────────────────────────── */

interface Step1Props {
  entityName: string;
  setEntityName: (v: string) => void;
  entityType: EntityType;
  setEntityType: (v: EntityType) => void;
  entityUrl: string;
  setEntityUrl: (v: string) => void;
}

const Step1Entity = memo(function Step1Entity({
  entityName,
  setEntityName,
  entityType,
  setEntityType,
  entityUrl,
  setEntityUrl,
}: Step1Props) {
  const { ref, isVisible } = useRevealOnMount();

  return (
    <div
      ref={ref}
      className="space-y-6"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
      }}
      data-agent-surface="connect-step-1"
    >
      <div className="text-center">
        <h2 className="text-xl font-semibold text-content">What are you analyzing?</h2>
        <p className="mt-1.5 text-sm text-content-muted">
          Name the entity you want NodeBench to investigate.
        </p>
      </div>

      {/* Entity name input */}
      <div>
        <label
          htmlFor="entity-name"
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted"
        >
          Entity name
        </label>
        <input
          id="entity-name"
          type="text"
          value={entityName}
          onChange={(e) => setEntityName(e.target.value)}
          placeholder="e.g. Acme AI, Cursor, Jane Smith"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-content placeholder:text-content-muted/60 focus:border-accent-primary/50 focus:outline-none focus:ring-1 focus:ring-[#d97757]/30"
          data-agent-input="entity-name"
          autoFocus
        />
      </div>

      {/* Entity type selector */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          Entity type
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-agent-group="entity-type">
          {ENTITY_TYPES.map(({ value, label, Icon }) => {
            const isSelected = entityType === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setEntityType(value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs transition-all duration-200 ${
                  isSelected
                    ? "border-accent-primary/50 bg-accent-primary/10 text-accent-primary"
                    : "border-white/[0.06] bg-white/[0.02] text-content-muted hover:border-white/[0.12] hover:bg-white/[0.04]"
                }`}
                data-agent-action={`select-type-${value}`}
                aria-pressed={isSelected}
              >
                <Icon size={16} />
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional URL / description */}
      <div>
        <label
          htmlFor="entity-url"
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted"
        >
          URL, repo link, or description <span className="text-content-muted/60">(optional)</span>
        </label>
        <input
          id="entity-url"
          type="text"
          value={entityUrl}
          onChange={(e) => setEntityUrl(e.target.value)}
          placeholder="https://acme.ai or a short description"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-content placeholder:text-content-muted/60 focus:border-accent-primary/50 focus:outline-none focus:ring-1 focus:ring-[#d97757]/30"
          data-agent-input="entity-url"
        />
      </div>
    </div>
  );
});

/* ─── Step 2: Connect your sources ───────────────────────────────────────── */

interface Step2Props {
  connectedSources: Set<string>;
  toggleSource: (id: string) => void;
}

const Step2Sources = memo(function Step2Sources({ connectedSources, toggleSource }: Step2Props) {
  const { ref, isVisible } = useRevealOnMount();

  return (
    <div
      ref={ref}
      className="space-y-6"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
      }}
      data-agent-surface="connect-step-2"
    >
      <div className="text-center">
        <h2 className="text-xl font-semibold text-content">Connect your sources</h2>
        <p className="mt-1.5 text-sm text-content-muted">
          Toggle the data sources you want NodeBench to analyze. You can always add more later.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-agent-group="source-cards">
        {SOURCE_CARDS.map(({ id, label, description, Icon, placeholder }, idx) => {
          const isConnected = connectedSources.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleSource(id)}
              className={`group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200 ${
                isConnected
                  ? "border-accent-primary/40 bg-accent-primary/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
              }`}
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(8px)",
                transition: `opacity 0.35s ease-out ${idx * 0.06}s, transform 0.35s ease-out ${idx * 0.06}s`,
              }}
              data-agent-action={`toggle-source-${id}`}
              aria-pressed={isConnected}
            >
              {/* Connected badge */}
              {isConnected && (
                <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-white">
                  <Check size={10} strokeWidth={3} />
                </div>
              )}

              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isConnected
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "bg-white/[0.04] text-content-muted group-hover:text-content"
                }`}
              >
                <Icon size={18} />
              </div>

              <div>
                <h3
                  className={`text-sm font-semibold transition-colors ${
                    isConnected ? "text-content" : "text-content-muted group-hover:text-content"
                  }`}
                >
                  {label}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{description}</p>
              </div>

              {/* MCP card shows command instead of placeholder */}
              {id === "mcp" && (
                <code className="mt-auto w-full rounded-md bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-accent-primary/80">
                  claude mcp add nodebench
                </code>
              )}

              {placeholder && id !== "mcp" && (
                <div className="mt-auto w-full rounded-md border border-dashed border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-content-muted/60">
                  {placeholder}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {connectedSources.size > 0 && (
        <p className="text-center text-xs text-content-muted">
          <span className="font-medium text-accent-primary">{connectedSources.size}</span> source
          {connectedSources.size !== 1 && "s"} selected
        </p>
      )}
    </div>
  );
});

/* ─── Step 3: Run your first analysis ────────────────────────────────────── */

interface Step3Props {
  selectedWorkflow: string;
  setSelectedWorkflow: (id: string) => void;
  entityName: string;
}

const Step3Analysis = memo(function Step3Analysis({
  selectedWorkflow,
  setSelectedWorkflow,
  entityName,
}: Step3Props) {
  const { ref, isVisible } = useRevealOnMount();

  return (
    <div
      ref={ref}
      className="space-y-6"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
      }}
      data-agent-surface="connect-step-3"
    >
      <div className="text-center">
        <h2 className="text-xl font-semibold text-content">Run your first analysis</h2>
        <p className="mt-1.5 text-sm text-content-muted">
          Pick a workflow preset and NodeBench will generate an analysis
          {entityName ? (
            <>
              {" "}for <span className="font-medium text-content">{entityName}</span>
            </>
          ) : null}
          .
        </p>
      </div>

      {/* Workflow preset grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-agent-group="workflow-presets">
        {WORKFLOW_PRESETS.map(({ id, icon: WfIcon, label, description }, idx) => {
          const isSelected = selectedWorkflow === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedWorkflow(id)}
              className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 ${
                isSelected
                  ? "border-accent-primary/40 bg-accent-primary/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
              }`}
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(8px)",
                transition: `opacity 0.35s ease-out ${idx * 0.05}s, transform 0.35s ease-out ${idx * 0.05}s`,
              }}
              data-agent-action={`select-workflow-${id}`}
              aria-pressed={isSelected}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isSelected ? "bg-accent-primary/20 text-accent-primary" : "bg-white/[0.04] text-content-muted"
                }`}
              >
                <WfIcon size={16} />
              </div>
              <div className="min-w-0">
                <h3
                  className={`text-sm font-semibold ${
                    isSelected ? "text-content" : "text-content-muted"
                  }`}
                >
                  {label}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Output preview (reuses DEMO_PACKET structure) */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4" data-agent-surface="output-preview">
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          Output preview
        </h4>
        <div className="space-y-3">
          {/* Question + confidence */}
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium leading-snug text-content">
              {DEMO_PREVIEW.question}
            </p>
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent-primary/30 bg-accent-primary/10 px-2.5 py-1">
              <span className="text-xs font-semibold text-accent-primary">{DEMO_PREVIEW.confidence}%</span>
            </div>
          </div>

          {/* Variables */}
          <div className="flex flex-wrap gap-1.5">
            {DEMO_PREVIEW.topVariables.map((v) => (
              <span
                key={v}
                className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] text-content-muted"
              >
                {v}
              </span>
            ))}
            <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] text-content-muted">
              +{DEMO_PREVIEW.sourceCount - DEMO_PREVIEW.topVariables.length} more
            </span>
          </div>

          {/* Scenario bars */}
          <div className="flex gap-1.5">
            {DEMO_PREVIEW.scenarios.map(({ label, probability }) => (
              <div
                key={label}
                className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-center"
              >
                <p className="text-[10px] font-medium uppercase tracking-wider text-content-muted">
                  {label}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-content">{probability}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── Main wizard ────────────────────────────────────────────────────────── */

export function ConnectSourcesWizard() {
  const [step, setStep] = useState(0);

  // Step 1 state
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [entityUrl, setEntityUrl] = useState("");

  // Step 2 state
  const [connectedSources, setConnectedSources] = useState<Set<string>>(new Set());
  const toggleSource = useCallback((id: string) => {
    setConnectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Step 3 state
  const [selectedWorkflow, setSelectedWorkflow] = useState("investor-diligence");

  // Navigation
  const canAdvance = useMemo(() => {
    if (step === 0) return entityName.trim().length > 0;
    if (step === 1) return true; // Sources are optional
    if (step === 2) return selectedWorkflow.length > 0;
    return false;
  }, [step, entityName, selectedWorkflow]);

  const next = useCallback(() => {
    if (step < 2) setStep((s) => s + 1);
    else {
      // Final step: navigate to the ask surface with context
      // In guest mode this just navigates; with backend it would trigger a real analysis
      const params = new URLSearchParams({
        surface: "ask",
        entity: entityName.trim(),
        workflow: selectedWorkflow,
      });
      window.location.href = `/?${params.toString()}`;
    }
  }, [step, entityName, selectedWorkflow]);

  const back = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const { ref: pageRef, isVisible: pageVisible } = useRevealOnMount();

  return (
    <div
      ref={pageRef}
      className="mx-auto flex min-h-[80vh] max-w-3xl flex-col px-4 py-10 sm:py-16"
      style={{
        opacity: pageVisible ? 1 : 0,
        transition: "opacity 0.3s ease-out",
      }}
      data-agent-id="connect-sources-wizard"
      data-agent-step={step}
    >
      {/* Header */}
      <div className="mb-8 flex flex-col items-center gap-4">
        <StepIndicator current={step} />
      </div>

      {/* Step content */}
      <div className="flex-1">
        {step === 0 && (
          <Step1Entity
            entityName={entityName}
            setEntityName={setEntityName}
            entityType={entityType}
            setEntityType={setEntityType}
            entityUrl={entityUrl}
            setEntityUrl={setEntityUrl}
          />
        )}
        {step === 1 && (
          <Step2Sources
            connectedSources={connectedSources}
            toggleSource={toggleSource}
          />
        )}
        {step === 2 && (
          <Step3Analysis
            selectedWorkflow={selectedWorkflow}
            setSelectedWorkflow={setSelectedWorkflow}
            entityName={entityName}
          />
        )}
      </div>

      {/* Footer navigation */}
      <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-6">
        <button
          type="button"
          onClick={back}
          className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            step === 0
              ? "invisible"
              : "text-content-muted hover:text-content"
          }`}
          data-agent-action="connect-back"
          tabIndex={step === 0 ? -1 : 0}
        >
          Back
        </button>

        <button
          type="button"
          onClick={next}
          disabled={!canAdvance}
          className={`inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] ${
            canAdvance
              ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/20 hover:bg-[#c4684a]"
              : "cursor-not-allowed bg-white/[0.06] text-content-muted"
          }`}
          data-agent-action={step === 2 ? "run-analysis" : "connect-next"}
        >
          {step === 2 ? "Run Analysis" : step === 1 ? "Choose workflow" : "Next"}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

export default ConnectSourcesWizard;
