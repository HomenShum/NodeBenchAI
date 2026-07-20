/**
 * PostmortemView — Forecast scorekeeping: compare predictions against reality.
 *
 * Dark-mode first. Score color-coded (emerald/cyan/amber/rose).
 * Fully accessible: ARIA labels, roles, keyboard navigable, reduced-motion safe.
 *
 * Uses SurfacePrimitives for unified design language.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Crosshair,
  Lightbulb,
  Link2,
  Scale,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import {
  SurfaceBadge,
  SurfaceCard,
  SurfaceGrid,
  SurfacePageHeader,
  SurfaceScroll,
  SurfaceSection,
  SurfaceStat,
  scoreToBadgeTone,
} from "@/shared/ui/SurfacePrimitives";
import type { PostmortemScorecard, PostmortemOutcomeCategory } from "../types";
import { confidenceCategory } from "../types";

/* ------------------------------------------------------------------ */
/*  Styling helpers                                                    */
/* ------------------------------------------------------------------ */

function scoreDotColor(score: number): string {
  const cat = confidenceCategory(score);
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

function outcomeCategoryLabel(cat: PostmortemOutcomeCategory): string {
  switch (cat) {
    case "correct":
      return "Correct";
    case "partially_correct":
      return "Partially Correct";
    case "wrong_direction":
      return "Wrong Direction";
    case "right_concern_wrong_mechanism":
      return "Right Concern, Wrong Mechanism";
    case "right_narrative_wrong_timing":
      return "Right Narrative, Wrong Timing";
    case "intervention_successful":
      return "Intervention Successful";
    case "intervention_noise":
      return "Intervention Was Noise";
  }
}

function outcomeCategoryTone(cat: PostmortemOutcomeCategory): "positive" | "warning" | "danger" {
  switch (cat) {
    case "correct":
    case "intervention_successful":
      return "positive";
    case "partially_correct":
    case "right_concern_wrong_mechanism":
    case "right_narrative_wrong_timing":
      return "warning";
    case "wrong_direction":
    case "intervention_noise":
      return "danger";
  }
}

function outcomeCategoryIcon(cat: PostmortemOutcomeCategory) {
  switch (cat) {
    case "correct":
    case "intervention_successful":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
    case "partially_correct":
    case "right_concern_wrong_mechanism":
    case "right_narrative_wrong_timing":
      return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />;
    case "wrong_direction":
    case "intervention_noise":
      return <XCircle className="h-4 w-4 text-rose-500" aria-hidden="true" />;
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

const SCORING_DIMENSIONS: {
  key: keyof Pick<
    PostmortemScorecard,
    | "variableRecall"
    | "scenarioUsefulness"
    | "interventionUsefulness"
    | "recommendationClarity"
    | "outcomeAlignment"
    | "confidenceCalibration"
  >;
  label: string;
  description: string;
  weight: number;
}[] = [
  {
    key: "variableRecall",
    label: "Variable Recall",
    description: "How many of the predicted top variables actually mattered",
    weight: 0.2,
  },
  {
    key: "scenarioUsefulness",
    label: "Scenario Usefulness",
    description: "Was the winning scenario in our set",
    weight: 0.2,
  },
  {
    key: "interventionUsefulness",
    label: "Intervention Usefulness",
    description: "Did recommended interventions help",
    weight: 0.15,
  },
  {
    key: "recommendationClarity",
    label: "Recommendation Clarity",
    description: "Was the advice actionable and specific",
    weight: 0.15,
  },
  {
    key: "outcomeAlignment",
    label: "Outcome Alignment",
    description: "Did the recommendation lead toward the right outcome",
    weight: 0.2,
  },
  {
    key: "confidenceCalibration",
    label: "Confidence Calibration",
    description: "Was the confidence level appropriate (not over/under)",
    weight: 0.1,
  },
];

function computeOverallScore(scorecard: PostmortemScorecard): number {
  return SCORING_DIMENSIONS.reduce(
    (sum, dim) => sum + scorecard[dim.key] * dim.weight,
    0,
  );
}

function ScoreDimensionCard({
  label,
  description,
  score,
  weight,
}: {
  label: string;
  description: string;
  score: number;
  weight: number;
}) {
  return (
    <SurfaceCard
      data-agent-action={label.toLowerCase().replace(/\s+/g, "-")}
    >
      <div
        className="flex flex-col"
        aria-label={`${label}: ${formatPercent(score)}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-content-muted">
            {label}
          </span>
          <span className="text-[10px] tabular-nums text-content-muted/60">
            w{formatPercent(weight)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn("h-2 w-2 rounded-full", scoreDotColor(score))}
            aria-hidden="true"
          />
          <SurfaceBadge tone={scoreToBadgeTone(score)}>
            {formatPercent(score)}
          </SurfaceBadge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-content-secondary">{description}</p>
      </div>
    </SurfaceCard>
  );
}

function LearningList({
  title,
  items,
  icon,
  id,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
  id: string;
}) {
  if (items.length === 0) return null;
  return (
    <SurfaceCard data-agent-action={id}>
      <h4
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-content-muted"
        id={`learning-${id}`}
      >
        {icon}
        {title}
      </h4>
      <ul
        className="mt-3 space-y-2"
        aria-labelledby={`learning-${id}`}
      >
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm leading-relaxed text-content-secondary"
          >
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-content-muted"
              aria-hidden="true"
            />
            {item}
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Share button                                                       */
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

/* ------------------------------------------------------------------ */
/*  Demo data — Acme AI postmortem                                    */
/* ------------------------------------------------------------------ */

const DEMO_SCORECARD: PostmortemScorecard = {
  memoId: "acme-ai-series-a",
  originalQuestion: "Should we invest in Acme AI's $12M Series A?",
  originalRecommendation:
    "Invest $2M at $40M pre-money. The founding team's distribution advantage in mid-market SaaS and their 3x NRR trajectory justify the risk, contingent on confirming enterprise pipeline conversion in Q3.",
  originalConfidence: 0.72,
  forecastCheckDate: "2026-09-19",
  actualOutcome:
    "The Series A closed at $14M on a $48M pre-money valuation. Acme reached $6.2M ARR by Q4, exceeding the base case but falling short of the bull case. Enterprise pipeline conversion settled at 18% (within range). However, NRR dropped to 128% as two large mid-market accounts churned due to integration friction the counter-model flagged. The CTO remained but a VP Engineering departure caused a 6-week product roadmap delay.",
  outcomeCategory: "partially_correct",
  variableRecall: 0.67,
  scenarioUsefulness: 0.82,
  interventionUsefulness: 0.75,
  recommendationClarity: 0.88,
  outcomeAlignment: 0.71,
  confidenceCalibration: 0.65,
  whatWeMissed: [
    "VP Engineering departure risk was not modeled as a distinct variable separate from CTO dependency",
    "Integration friction as a churn driver was flagged in the counter-model but not promoted to a top variable",
    "Competitive response was overweighted (incumbents did not ship AI features as feared)",
  ],
  whatVariableMoved: [
    "NRR dropped from 142% to 128% — integration friction was the driver, not market saturation",
    "Enterprise pipeline conversion stabilized at 18%, within the base-to-bull corridor",
    "Burn multiple improved to 1.5x as revenue grew faster than headcount",
    "Valuation premium: market priced AI-native workflow 20% above our model",
  ],
  whatAssumptionFailed: [
    "Assumed CTO departure was the key-person risk; actual risk was VP Engineering (bus factor was deeper than modeled)",
    "Assumed NRR was primarily demand-driven; churn component from integration friction was underweighted",
    "Counter-model's 'trough of disillusionment' timeline was too aggressive (predicted 2027, integration issues appeared in 2026 Q3 but did not collapse demand)",
  ],
  whatInterventionMattered: [
    "Pro-rata rights and board observer seat: provided early signal on NRR decline, enabled proactive portfolio support",
    "Enterprise prospect intros: 1 of 3 converted to a $180K ACV deal, directly supporting ARR growth",
    "Technical due diligence: correctly identified modular architecture but missed VP Engineering single-point-of-failure in DevOps pipeline",
    "Milestone-based tranche: second tranche release was delayed 3 weeks pending NRR stabilization, preserving optionality",
  ],
  updatedPriors: [
    "Key-person risk should model 2-3 critical roles, not just C-suite. VP-level departures in <50-person companies can cause 4-8 week roadmap delays.",
    "Counter-model signals that appear in customer interviews (integration friction mentioned by 3/8) should be promoted to tracked variables even at low confidence.",
    "NRR decomposition: separate expansion revenue from gross retention when evaluating AI-native SaaS. High expansion can mask rising churn.",
    "Confidence calibration: 72% was slightly overconfident given the data gaps in enterprise pipeline (small sample). Future memos with <25 pipeline deals should cap confidence at 65%.",
    "Competitive response timelines for incumbents in AI features trend 12-18 months, not 6 months. Reduce weight on competitive urgency variable.",
  ],
};

/* ------------------------------------------------------------------ */
/*  Main View                                                         */
/* ------------------------------------------------------------------ */

function PostmortemViewInner({
  scorecard = DEMO_SCORECARD,
}: {
  scorecard?: PostmortemScorecard;
}) {
  const { ref, isVisible, instant } = useRevealOnMount();
  const overallScore = computeOverallScore(scorecard);

  return (
    <SurfaceScroll maxWidth="lg">
      <div
        ref={ref}
        className="space-y-6"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "none" : "translateY(12px)",
          transition: instant
            ? "none"
            : "opacity 0.4s ease, transform 0.4s ease",
        }}
        data-agent-surface="postmortem"
      >
        {/* ---- Page header with outcome badge ---- */}
        <div className="flex items-start justify-between gap-4">
          <SurfacePageHeader
            title="Postmortem Review"
            subtitle={`Forecast check: ${new Date(scorecard.forecastCheckDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
            badge={
              <SurfaceBadge tone={outcomeCategoryTone(scorecard.outcomeCategory)}>
                {outcomeCategoryIcon(scorecard.outcomeCategory)}
                <span className="ml-1">{outcomeCategoryLabel(scorecard.outcomeCategory)}</span>
              </SurfaceBadge>
            }
          />
          <ShareButton />
        </div>

        {/* ---- Overall score ---- */}
        <SurfaceCard
          data-agent-action="overall-score"
        >
          <div
            className="flex items-center justify-between"
            role="status"
            aria-label={`Overall postmortem score: ${formatPercent(overallScore)}`}
          >
            <div className="flex items-center gap-4">
              <Activity className="h-6 w-6 text-content-muted" aria-hidden="true" />
              <SurfaceStat
                value={formatPercent(overallScore)}
                label="Overall Forecast Score"
                tone={scoreToBadgeTone(overallScore)}
              />
            </div>
            <SurfaceBadge tone={scoreToBadgeTone(scorecard.originalConfidence)}>
              Original confidence: {formatPercent(scorecard.originalConfidence)}
            </SurfaceBadge>
          </div>
        </SurfaceCard>

        {/* ---- Prediction vs Reality ---- */}
        <SurfaceSection
          title="Prediction vs. Reality"
          data-agent-id="prediction-vs-reality"
        >
          <SurfaceGrid cols={2}>
            {/* Original prediction */}
            <SurfaceCard data-agent-action="original-prediction">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-muted">
                <Target className="h-3.5 w-3.5" aria-hidden="true" />
                Original Prediction
              </div>
              <h4 className="mt-3 text-sm font-semibold text-content">
                {scorecard.originalQuestion}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                {scorecard.originalRecommendation}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[11px] text-content-muted">
                  Original confidence:
                </span>
                <SurfaceBadge tone={scoreToBadgeTone(scorecard.originalConfidence)}>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      scoreDotColor(scorecard.originalConfidence),
                    )}
                    aria-hidden="true"
                  />
                  {formatPercent(scorecard.originalConfidence)}
                </SurfaceBadge>
              </div>
            </SurfaceCard>

            {/* Actual outcome */}
            <SurfaceCard data-agent-action="actual-outcome">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-muted">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                What Actually Happened
              </div>
              <p className="mt-3 text-sm leading-relaxed text-content">
                {scorecard.actualOutcome}
              </p>
            </SurfaceCard>
          </SurfaceGrid>
        </SurfaceSection>

        {/* ---- Scoring dimensions ---- */}
        <SurfaceSection
          title="Scoring Dimensions"
          data-agent-id="scoring-dimensions"
        >
          <SurfaceGrid cols={3}>
            {SCORING_DIMENSIONS.map((dim) => (
              <ScoreDimensionCard
                key={dim.key}
                label={dim.label}
                description={dim.description}
                score={scorecard[dim.key]}
                weight={dim.weight}
              />
            ))}
          </SurfaceGrid>
        </SurfaceSection>

        {/* ---- What we learned ---- */}
        <SurfaceSection
          title="What We Learned"
          data-agent-id="what-we-learned"
        >
          <SurfaceGrid cols={2}>
            <LearningList
              id="what-we-missed"
              title="What We Missed"
              items={scorecard.whatWeMissed}
              icon={
                <XCircle
                  className="h-3.5 w-3.5 text-rose-500"
                  aria-hidden="true"
                />
              }
            />
            <LearningList
              id="what-variable-moved"
              title="What Variable Moved"
              items={scorecard.whatVariableMoved}
              icon={
                <Activity
                  className="h-3.5 w-3.5 text-cyan-500"
                  aria-hidden="true"
                />
              }
            />
            <LearningList
              id="what-assumption-failed"
              title="What Assumption Failed"
              items={scorecard.whatAssumptionFailed}
              icon={
                <AlertTriangle
                  className="h-3.5 w-3.5 text-amber-500"
                  aria-hidden="true"
                />
              }
            />
            <LearningList
              id="what-intervention-mattered"
              title="What Intervention Mattered"
              items={scorecard.whatInterventionMattered}
              icon={
                <CheckCircle2
                  className="h-3.5 w-3.5 text-emerald-500"
                  aria-hidden="true"
                />
              }
            />
          </SurfaceGrid>
        </SurfaceSection>

        {/* ---- Updated priors ---- */}
        <SurfaceSection
          title="Updated Priors"
          data-agent-id="updated-priors"
        >
          <SurfaceCard>
            <ul className="space-y-3" aria-label="Updated priors for future decisions">
              {scorecard.updatedPriors.map((prior, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-sm leading-relaxed text-content"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                    {i + 1}
                  </span>
                  {prior}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        </SurfaceSection>

        {/* ---- Forecast check reminder ---- */}
        <SurfaceCard
          compact
          data-agent-action="memo-source"
        >
          <div
            className="flex items-center gap-2"
            role="status"
            aria-label="Memo source"
          >
            <Scale className="h-4 w-4 text-accent" aria-hidden="true" />
            <span className="text-sm text-content">
              Postmortem for memo:{" "}
              <span className="font-semibold">{scorecard.memoId}</span>
            </span>
          </div>
        </SurfaceCard>
      </div>
    </SurfaceScroll>
  );
}

export const PostmortemView = memo(PostmortemViewInner);
export default PostmortemView;
