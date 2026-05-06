/**
 * OnboardingWizard — 3-step first-visit modal overlay.
 *
 * Shown once when `localStorage` lacks the `nodebench-onboarded` key.
 * Steps: Welcome -> How it works -> Try it now.
 *
 * Design: glass card overlay, step dots, skip link, reduced-motion safe.
 */

import { useState, useCallback, useEffect } from "react";
import { MessageSquare, BarChart3, Activity } from "lucide-react";

const STORAGE_KEY = "nodebench-onboarded";

/* ── Step data ─────────────────────────────────────────────────────────── */

interface HowItWorksCard {
  label: string;
  description: string;
  Icon: typeof MessageSquare;
}

const HOW_IT_WORKS_CARDS: HowItWorksCard[] = [
  {
    label: "Capture",
    description: "Ask, paste, upload, or record messy context about a company, person, market, event, or account.",
    Icon: MessageSquare,
  },
  {
    label: "Preserve",
    description: "NodeBench turns the answer into a living report with sources, claims, notes, relationships, and follow-ups.",
    Icon: BarChart3,
  },
  {
    label: "Scale",
    description: "Reuse your style, rubric, and evidence rules across the next entity list instead of starting over.",
    Icon: Activity,
  },
];

/* ── Component ─────────────────────────────────────────────────────────── */

export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = 3;

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // storage full or blocked — silently continue
    }
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (step < totalSteps - 1) setStep((s) => s + 1);
    else finish();
  }, [step, finish]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [finish]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-agent-id="onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to NodeBench"
    >
      <div className="relative max-w-lg w-full mx-4 rounded-2xl border border-white/[0.06] bg-[var(--bg-primary)] p-8 shadow-2xl">
        {/* Skip link */}
        <button
          type="button"
          onClick={finish}
          className="absolute top-4 right-4 text-xs text-content-muted hover:text-content transition-colors"
        >
          Skip tour
        </button>

        {/* Step content */}
        <div
          className={prefersReducedMotion ? "" : "transition-opacity duration-200"}
          key={step}
        >
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepHowItWorks />}
          {step === 2 && <StepTryIt />}
        </div>

        {/* Footer: dots + button */}
        <div className="mt-8 flex items-center justify-between">
          {/* Step dots */}
          <div className="flex gap-2" aria-label={`Step ${step + 1} of ${totalSteps}`}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === step
                    ? "bg-accent-primary"
                    : "border border-white/20 bg-transparent"
                }`}
                aria-current={i === step ? "step" : undefined}
              />
            ))}
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
          >
            {step === 0 && "Get started"}
            {step === 1 && "Next"}
            {step === 2 && "Start exploring"}
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Step sub-components ───────────────────────────────────────────────── */

function StepWelcome() {
  return (
    <div className="text-center">
      {/* N logo */}
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-primary/10 text-accent-primary">
        <span className="text-3xl font-bold tracking-tight">N</span>
      </div>

      <h2 className="text-2xl font-semibold text-content">Welcome to NodeBench</h2>
      <p className="mt-2 text-base font-medium text-accent-primary">
        Turn messy context into reusable entity intelligence.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-content-muted">
        Chat creates the intelligence. Reports preserve it. Notebooks edit it. Sources verify it.
        Start with one question, then keep compounding the report instead of rebuilding from scratch.
      </p>
    </div>
  );
}

function StepHowItWorks() {
  return (
    <div>
      <h2 className="mb-6 text-center text-xl font-semibold text-content">
        How it works
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {HOW_IT_WORKS_CARDS.map(({ label, description, Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center"
          >
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary">
              <Icon size={20} />
            </div>
            <h3 className="text-sm font-semibold text-content">{label}</h3>
            <p className="mt-1 text-xs leading-relaxed text-content-muted">
              {description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepTryIt() {
  return (
    <div className="text-center">
      <h2 className="mb-6 text-xl font-semibold text-content">Try it now</h2>
      <ul className="space-y-3 text-left text-sm text-content-muted">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-[10px] font-bold text-accent-primary">
            1
          </span>
          <span>
            <strong className="text-content">Ask or capture anything</strong> about a company, person, market, event, or account
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-[10px] font-bold text-accent-primary">
            2
          </span>
          <span>Get a sourced answer that saves into a reusable report, not a disposable chat turn</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-[10px] font-bold text-accent-primary">
            3
          </span>
          <span>
            Export a memo, resume the attached chat, or connect automation through:{" "}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-accent-primary">
              npx nodebench-mcp
            </code>
          </span>
        </li>
      </ul>
    </div>
  );
}
