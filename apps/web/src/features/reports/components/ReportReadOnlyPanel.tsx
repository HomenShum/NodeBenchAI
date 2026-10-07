import { ExternalLink, FileText, Link2 } from "lucide-react";

type ReportSection = {
  id?: string;
  title?: string;
  body?: string;
};

type ReportCompiledSentence = {
  sentenceId?: string;
  text?: string;
  claimIds?: string[];
  evidenceIds?: string[];
};

type ReportCompiledTruthSection = {
  id?: string;
  title?: string;
  sentences?: ReportCompiledSentence[];
};

type ReportActionItem = {
  type?: string;
  label?: string;
  rationale?: string;
  enabled?: boolean;
  blockedReason?: string;
};

type ReportSource = {
  id?: string;
  label?: string;
  title?: string;
  href?: string;
  domain?: string;
  siteName?: string;
  excerpt?: string;
};

export type ReadOnlyReportRecord = {
  _id?: string;
  title?: string;
  summary?: string;
  type?: string;
  updatedAt?: number;
  resolutionState?: "exact" | "probable" | "ambiguous" | "unresolved";
  artifactState?: "none" | "draft" | "saved" | "published";
  saveEligibility?: "blocked" | "draft_only" | "save_ready" | "publish_ready";
  sections?: ReportSection[];
  sources?: ReportSource[];
  sourceLabels?: string[];
  compiledAnswerV2?: {
    resolutionState?: "exact" | "probable" | "ambiguous" | "unresolved";
    artifactState?: "none" | "draft" | "saved" | "published";
    saveEligibility?: "blocked" | "draft_only" | "save_ready" | "publish_ready";
    truthSections?: ReportCompiledTruthSection[];
    actions?: ReportActionItem[];
  } | null;
  qualityGateSummary?: {
    totalClaims?: number;
    publishableClaims?: number;
    rejectedClaims?: number;
    contradictedClaims?: number;
    corroboratedClaims?: number;
    verifiedClaims?: number;
    weakClaims?: number;
    rejectionReasons?: string[];
  } | null;
};

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) return "Unknown";
  return new Date(updatedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReportReadOnlyPanel({
  report,
  chrome = "standalone",
}: {
  report: ReadOnlyReportRecord;
  chrome?: "standalone" | "embedded";
}) {
  const compiledSections = Array.isArray(report.compiledAnswerV2?.truthSections)
    ? report.compiledAnswerV2?.truthSections
        .map((section): ReportSection | null => {
          const sentences = Array.isArray(section?.sentences)
            ? section.sentences
                .map((sentence) =>
                  typeof sentence?.text === "string" ? sentence.text.trim() : "",
                )
                .filter((sentence) => sentence.length > 0)
            : [];
          if (!section?.title || sentences.length === 0) return null;
          return {
            id: section.id,
            title: section.title,
            body: sentences.join("\n\n"),
          };
        })
        .filter((section): section is ReportSection => section !== null)
    : [];
  const sections = compiledSections.length > 0
    ? compiledSections
    : Array.isArray(report.sections)
      ? report.sections
      : [];
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const actionItems = Array.isArray(report.compiledAnswerV2?.actions)
    ? report.compiledAnswerV2.actions.filter(
        (item): item is ReportActionItem =>
          Boolean(item && typeof item.label === "string" && item.label.trim().length > 0),
      )
    : [];
  const hasSections = sections.length > 0;
  const resolutionState =
    report.compiledAnswerV2?.resolutionState ?? report.resolutionState ?? null;
  const artifactState =
    report.compiledAnswerV2?.artifactState ?? report.artifactState ?? null;
  const saveEligibility =
    report.compiledAnswerV2?.saveEligibility ?? report.saveEligibility ?? null;
  const qualitySummary = report.qualityGateSummary ?? null;

  return (
    <article
      className={
        chrome === "embedded"
          ? "rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
          : "mx-auto w-full max-w-3xl rounded-3xl border border-white/[0.08] bg-[#141312] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.35)] sm:p-8"
      }
    >
      <header className="border-b border-white/[0.08] pb-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-white/55">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-1">
            <FileText className="h-3.5 w-3.5" />
            {report.type ?? "Report"}
          </span>
          <span>Updated {formatUpdatedAt(report.updatedAt)}</span>
        </div>
        <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-white sm:text-[34px]">
          {report.title ?? "Untitled report"}
        </h1>
        {report.summary ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-7 text-white/72 sm:text-[15px]">
            {report.summary}
          </p>
        ) : null}
        {resolutionState || artifactState || saveEligibility || qualitySummary ? (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/62">
            {resolutionState ? (
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                Resolution: {resolutionState}
              </span>
            ) : null}
            {artifactState ? (
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                Artifact: {artifactState}
              </span>
            ) : null}
            {saveEligibility ? (
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                Save: {saveEligibility}
              </span>
            ) : null}
            {typeof qualitySummary?.publishableClaims === "number" ? (
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                Claims: {qualitySummary.publishableClaims}/{qualitySummary.totalClaims ?? 0} publishable
              </span>
            ) : null}
            {typeof qualitySummary?.contradictedClaims === "number" &&
            qualitySummary.contradictedClaims > 0 ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                {qualitySummary.contradictedClaims} contradicted
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="mt-6 space-y-5">
        {hasSections ? (
          sections.map((section, index) => (
            <section key={section.id ?? `${section.title}-${index}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <h2 className="text-[16px] font-semibold text-white">{section.title ?? `Section ${index + 1}`}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-white/76">
                {section.body?.trim() || "No content was saved for this section."}
              </p>
            </section>
          ))
        ) : (
          <section className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] p-5 text-[14px] text-white/65">
            No structured sections were saved for this report.
          </section>
        )}
      </div>

      {actionItems.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/55">
            Recommended next actions
          </div>
          <div className="mt-3 grid gap-3">
            {actionItems.map((item, index) => (
              <div
                key={`${item.type ?? item.label}-${index}`}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-white">
                    {item.label}
                  </span>
                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/55">
                    {item.enabled ? "ready" : "blocked"}
                  </span>
                </div>
                {item.rationale ? (
                  <p className="mt-2 text-[13px] leading-6 text-white/68">
                    {item.rationale}
                  </p>
                ) : null}
                {item.blockedReason ? (
                  <p className="mt-2 text-[12px] text-amber-200/90">
                    {item.blockedReason}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-6 border-t border-white/[0.08] pt-5">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-white/55">
          <Link2 className="h-3.5 w-3.5" />
          Sources
        </div>
        {sources.length > 0 ? (
          <div className="mt-3 grid gap-3">
            {sources.map((source, index) => (
              <a
                key={source.id ?? source.href ?? `${source.label}-${index}`}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition hover:border-white/[0.16] hover:bg-white/[0.035]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-white">
                      {source.title || source.label || source.siteName || source.domain || `Source ${index + 1}`}
                    </div>
                    <div className="mt-1 truncate text-[12px] text-white/52">
                      {source.siteName || source.domain || source.href}
                    </div>
                  </div>
                  <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-white/45" />
                </div>
                {source.excerpt ? (
                  <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-white/68">{source.excerpt}</p>
                ) : null}
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] p-4 text-[14px] text-white/65">
            No sources were attached to this report.
          </div>
        )}
      </footer>
    </article>
  );
}

export default ReportReadOnlyPanel;
