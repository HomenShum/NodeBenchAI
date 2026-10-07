import { Pill } from "../components/Pill";
import type { ReportCardData } from "../fixtures";
import type { EditionHypothesis } from "../hooks/useActiveHypotheses";
import type { LiveArtifactSourceRow } from "../hooks/useLiveArtifacts";
import type { EditionForecast } from "../hooks/useTopForecasts";
import {
  getForecastReviewSummary,
  getHypothesisReviewSummary,
  getHypothesisReviewTitle,
} from "./EditorialHomeAudienceRelevance";

export type DecisionLane = "Now" | "Prep" | "Check" | "Report" | "Source" | "Later";

export interface ProductDecisionItem {
  id: string;
  lane: DecisionLane;
  title: string;
  context: string;
  next: string;
  meta?: string;
  tone?: "accent" | "green" | "blue" | "amber";
  reportId?: string;
  prompt?: string;
}

export interface DecisionQueueProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: ProductDecisionItem[];
  emptyLabel: string;
  compact?: boolean;
  onOpenItem?: (item: ProductDecisionItem) => void;
}

const LANE_TONE: Record<DecisionLane, ProductDecisionItem["tone"]> = {
  Now: "accent",
  Prep: "blue",
  Check: "amber",
  Report: "green",
  Source: "blue",
  Later: undefined,
};

export function sanitizeDecisionText(value: string): string {
  return value
    .replace(/\bSo What:\s*/gi, "Review note: ")
    .replace(/\(\s*So What\s*\)/gi, "(review note)")
    .replace(/\bNow What:\s*/gi, "Next check: ")
    .replace(/\(\s*Now What\s*\)/gi, "(next check)")
    .replace(/\bWhy it matters:\s*/gi, "Why useful: ")
    .replace(/\bWhy it matters\b/gi, "Why useful");
}

function shortText(value: string, max = 150): string {
  const text = sanitizeDecisionText(value)
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function statusPriority(status: ReportCardData["status"]): number {
  if (status === "review") return 0;
  if (status === "watching") return 1;
  return 2;
}

function uniqueItems(items: ProductDecisionItem[]): ProductDecisionItem[] {
  const seen = new Set<string>();
  const out: ProductDecisionItem[] = [];
  for (const item of items) {
    const key = `${item.lane}:${item.title}:${item.next}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildHomeDecisionQueue({
  pulses,
  hypotheses,
  forecasts,
  reports,
  sourceRows,
}: {
  pulses:
    | {
        provenance?: string;
        pulses: Array<{
          _id: string;
          entitySlug: string;
          changeCount: number;
          materialChangeCount?: number;
          summaryMarkdown?: string;
        }>;
      }
    | undefined;
  hypotheses: EditionHypothesis[] | undefined;
  forecasts: EditionForecast[] | undefined;
  reports: ReportCardData[];
  sourceRows: LiveArtifactSourceRow[];
}): ProductDecisionItem[] {
  const items: ProductDecisionItem[] = [];
  const firstPulse = pulses?.pulses.find((p) => (p.materialChangeCount ?? 0) > 0) ?? pulses?.pulses[0];
  const materialChanges =
    pulses?.pulses.reduce((total, pulse) => total + (pulse.materialChangeCount ?? 0), 0) ?? 0;

  if (firstPulse) {
    const entity = firstPulse.entitySlug.replace(/-/g, " ");
    items.push({
      id: `pulse-${firstPulse._id}`,
      lane: materialChanges > 0 ? "Now" : "Prep",
      title: `Review ${entity}`,
      context:
        materialChanges > 0
          ? `${materialChanges} material change${materialChanges === 1 ? "" : "s"} surfaced across today's pulse.`
          : `${firstPulse.changeCount} live change${firstPulse.changeCount === 1 ? "" : "s"} surfaced in the pulse.`,
      next: "Decide whether this belongs in an existing report notebook.",
      meta: pulses?.provenance === "public-trending" ? "public trending" : "live pulse",
      prompt: `Review today's pulse for ${entity} and propose the smallest report or notebook update.`,
    });
  }

  for (const hypothesis of (hypotheses ?? []).slice(0, 2)) {
    items.push({
      id: `hypothesis-${hypothesis._id}`,
      lane: hypothesis.evidenceChecksPassing < hypothesis.evidenceChecksTotal ? "Check" : "Prep",
      title: getHypothesisReviewTitle(hypothesis),
      context: getHypothesisReviewSummary(hypothesis),
      next:
        hypothesis.evidenceChecksPassing < hypothesis.evidenceChecksTotal
          ? "Review missing evidence before changing a report."
          : "Open the notebook patch queue if the evidence still holds.",
      meta: hypothesis.label,
      prompt: `Review the evidence state for ${getHypothesisReviewTitle(hypothesis)} and draft a notebook-safe next step.`,
    });
  }

  for (const forecast of (forecasts ?? []).slice(0, 2)) {
    items.push({
      id: `forecast-${forecast._id}`,
      lane: "Check",
      title: "Check evidence watchlist",
      context: getForecastReviewSummary(forecast),
      next: "Use the ledger move as a review cue, not as an unsupported prediction.",
      meta: `resolves ${forecast.resolutionDate}`,
      prompt: "Review the current evidence watchlist and identify what source should be checked next.",
    });
  }

  const reviewReport = [...reports].sort((a, b) => {
    const statusDelta = statusPriority(a.status) - statusPriority(b.status);
    if (statusDelta !== 0) return statusDelta;
    return b.followUps - a.followUps;
  })[0];
  if (reviewReport) {
    items.push({
      id: `report-${reviewReport.id}`,
      lane: "Report",
      title: reviewReport.entity,
      context: shortText(reviewReport.description),
      next:
        reviewReport.status === "review"
          ? "Open the report and clear the review state."
          : reviewReport.followUps > 0
            ? "Open follow-ups before creating another report."
            : "Confirm whether the latest brief should be saved here.",
      meta: `${reviewReport.sources} sources | ${reviewReport.claims} claims | ${reviewReport.updatedAt}`,
      reportId: reviewReport.id,
    });
  }

  const source = sourceRows.find((row) => row.href) ?? sourceRows[0];
  if (source) {
    items.push({
      id: `source-${source.id}`,
      lane: "Source",
      title: source.title || "Source check",
      context: shortText(source.excerpt || `${source.type} source refreshed ${source.refreshed}`),
      next: "Verify citation support before elevating this into the brief.",
      meta: `${source.type} | ${source.refreshed}`,
    });
  }

  return uniqueItems(items).slice(0, 7);
}

export function buildReportsDecisionQueue(reports: ReportCardData[]): ProductDecisionItem[] {
  return [...reports]
    .sort((a, b) => {
      const statusDelta = statusPriority(a.status) - statusPriority(b.status);
      if (statusDelta !== 0) return statusDelta;
      const followUpDelta = b.followUps - a.followUps;
      if (followUpDelta !== 0) return followUpDelta;
      return b.sources - a.sources;
    })
    .slice(0, 4)
    .map((report, index) => ({
      id: `report-next-${report.id}`,
      lane: index === 0 ? "Now" : report.status === "review" ? "Check" : "Report",
      title: report.entity,
      context: shortText(report.description, 120),
      next:
        report.status === "review"
          ? "Clear review state before exporting or sharing."
          : report.followUps > 0
            ? "Open linked follow-ups and decide what still matters."
            : "Scan the brief and confirm it remains useful.",
      meta: `${report.kind} | ${report.sources} sources | ${report.claims} claims | ${report.updatedAt}`,
      reportId: report.id,
      tone: report.status === "review" ? "amber" : report.status === "watching" ? "blue" : "green",
    }));
}

export function buildWorkspaceDecision({
  title,
  sourceCount,
  claimCount,
  followUps,
  primaryAction,
  canVerifySources,
}: {
  title: string;
  sourceCount: number;
  claimCount: number;
  followUps: number;
  primaryAction?: string;
  canVerifySources: boolean;
}): ProductDecisionItem {
  if (followUps > 0) {
    return {
      id: "workspace-followups",
      lane: "Now",
      title: "Clear linked follow-ups",
      context: `${followUps} follow-up${followUps === 1 ? "" : "s"} are attached to ${title}.`,
      next: primaryAction || "Open Chat or Notebook after the follow-ups are resolved.",
      tone: "accent",
    };
  }
  if (canVerifySources && sourceCount > 0) {
    return {
      id: "workspace-source-check",
      lane: "Check",
      title: "Verify source support",
      context: `${sourceCount} sources support ${claimCount} claim${claimCount === 1 ? "" : "s"}.`,
      next: "Run source verification before saving or exporting this workspace.",
      tone: "amber",
    };
  }
  return {
    id: "workspace-save",
    lane: "Report",
    title: "Save the useful artifact",
    context: `${title} is readable, but the next durable step is still a user decision.`,
    next: primaryAction || "Save as report if this should enter the coverage book.",
    tone: "green",
  };
}

export function ProductDecisionQueue({
  eyebrow,
  title,
  subtitle,
  items,
  emptyLabel,
  compact = false,
  onOpenItem,
}: DecisionQueueProps) {
  const primary = items[0];
  return (
    <section
      className={compact ? "rd-decision-queue rd-decision-queue--compact" : "rd-decision-queue"}
      data-decision-queue
      aria-label={eyebrow}
    >
      <div className="rd-decision-queue__header">
        <div>
          <p className="rd-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p>{subtitle}</p>
      </div>

      {primary ? (
        <div className="rd-decision-queue__lead">
          <Pill tone={primary.tone ?? LANE_TONE[primary.lane]}>{primary.lane}</Pill>
          <div>
            <span className="rd-decision-queue__lead-label">Next best action</span>
            <strong>{primary.next}</strong>
            <p>{primary.title} - {primary.context}</p>
          </div>
          {onOpenItem && (
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm"
              onClick={() => onOpenItem(primary)}
            >
              Open
            </button>
          )}
        </div>
      ) : (
        <p className="rd-decision-queue__empty">{emptyLabel}</p>
      )}

      {items.length > 0 && (
        <ol className="rd-decision-queue__list" aria-label="Ranked decision queue">
          {items.map((item, index) => (
            <li key={item.id} className="rd-decision-queue__item">
              <span className="rd-decision-queue__rank">{index + 1}</span>
              <Pill tone={item.tone ?? LANE_TONE[item.lane]}>{item.lane}</Pill>
              <div className="rd-decision-queue__copy">
                <strong>{item.title}</strong>
                <span>{item.context}</span>
                {item.meta && <em>{item.meta}</em>}
              </div>
              <span className="rd-decision-queue__next">{item.next}</span>
              {onOpenItem && index > 0 && (
                <button
                  type="button"
                  className="rd-btn rd-btn--quiet rd-btn--sm"
                  onClick={() => onOpenItem(item)}
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
