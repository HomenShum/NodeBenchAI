/**
 * WikiPageDetail — three-zone layout per docs/architecture/ME_PAGE_WIKI_SPEC.md §4
 *
 * Zone 1 (generated overview): AI-maintained, regenerates only; marked with AI chip.
 * Zone 2 (evidence + sources): strictly derived; read-only.
 * Zone 3 (your notes): Human-owned, editable; AI reads but never writes.
 *
 * Dreaming Pipeline Integration:
 * - Themes panel from REFLECT phase
 * - Notes editor with 64KB bound
 * - Source provenance from OBSERVE/CONSOLIDATE phases
 *
 * Contract: inputs are already-fetched Convex docs from getPageBySlug. The
 * component does not fetch; it only presents.
 */
import { Sparkles, Link2, AlertTriangle, Brain, Clock } from "lucide-react";
import { WikiFreshnessBadge, type FreshnessState } from "./WikiFreshnessBadge";
import { WikiRegenerateButton } from "./WikiRegenerateButton";
import { WikiThemesPanel } from "./WikiThemesPanel";
import { WikiNotesEditor } from "./WikiNotesEditor";

export type WikiRevisionDoc = {
  revision: number;
  summary: string;
  whatItIs: string;
  whyItMatters: string;
  whatChanged: string;
  openQuestions: string;
  modelUsed: string;
  generatedAt: number;
  answerControlPassed: boolean;
  hallucinationGateFailed: boolean;
  unsupportedClaimCount: number;
  approvedByUser: boolean;
};

export type WikiPageDoc = {
  slug: string;
  pageType:
    | "topic" | "company" | "person" | "product"
    | "event" | "location" | "job" | "contradiction";
  title: string;
  summary: string;
  freshnessState: FreshnessState;
  contradictionCount: number;
  revision: number;
  regeneratedAt: number;
  pendingRegenAt?: number;
};

function formatRelative(ts: number): string {
  if (!ts) return "never";
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function AiChip({ model, generatedAt, revision }: { model: string; generatedAt: number; revision: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
      title={`${model} · revision ${revision} · ${formatRelative(generatedAt)}`}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      AI-maintained
    </span>
  );
}

function PendingBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="wiki-pending-banner"
      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
    >
      A new revision is regenerating in the background. The UI will update automatically.
    </div>
  );
}

export function WikiPageDetail({
  ownerKey,
  page,
  latestRevision,
}: {
  ownerKey: string;
  page: WikiPageDoc;
  latestRevision: WikiRevisionDoc | null;
}) {
  const hasRevision = latestRevision != null;
  const isPending = !!page.pendingRegenAt && page.pendingRegenAt > Date.now() - 60 * 60 * 1000;

  return (
    <article
      data-testid="wiki-page"
      data-page-slug={page.slug}
      className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6"
    >
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
              {page.title}
            </h1>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300">
              {page.pageType}
            </span>
            <WikiFreshnessBadge state={page.freshnessState} />
            {page.contradictionCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                data-testid="wiki-contradiction-badge"
                aria-label={`${page.contradictionCount} contradiction${page.contradictionCount === 1 ? "" : "s"}`}
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {page.contradictionCount} contradiction
                {page.contradictionCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {page.summary ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">{page.summary}</p>
          ) : null}
        </div>
        <WikiRegenerateButton
          ownerKey={ownerKey}
          slug={page.slug}
          pageType={page.pageType}
          pendingRegenAt={page.pendingRegenAt}
        />
      </header>

      {isPending ? <PendingBanner /> : null}

      {/* Zone 1: AI-maintained generated overview */}
      <section
        data-testid="wiki-zone-generated"
        role="region"
        aria-label="AI-maintained summary"
        className="rounded-lg border-l-[3px] border-l-[var(--accent-primary,#d97757)] border-t border-r border-b border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            AI Summary
          </h2>
          {latestRevision ? (
            <AiChip
              model={latestRevision.modelUsed}
              generatedAt={latestRevision.generatedAt}
              revision={latestRevision.revision}
            />
          ) : null}
        </div>

        {!hasRevision ? (
          <div className="flex flex-col items-start gap-2 py-6 text-sm text-gray-600 dark:text-gray-300">
            <p>No revision yet. Click Regenerate to build the first one.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
            <WikiSection title="What it is" body={latestRevision!.whatItIs} />
            <WikiSection title="Why it matters" body={latestRevision!.whyItMatters} />
            <WikiSection title="What changed" body={latestRevision!.whatChanged} />
            <WikiSection title="Open questions" body={latestRevision!.openQuestions} />
          </div>
        )}

        {latestRevision && !latestRevision.approvedByUser ? (
          <p
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            data-testid="wiki-draft-notice"
          >
            This revision is held as a draft (
            {latestRevision.hallucinationGateFailed
              ? "hallucination gate failed"
              : `${latestRevision.unsupportedClaimCount} unsupported claim${latestRevision.unsupportedClaimCount === 1 ? "" : "s"} detected`}
            ). The page summary above reflects the last approved revision.
          </p>
        ) : null}
      </section>

      {/* Zone 2: Evidence + sources */}
      <section
        data-testid="wiki-zone-evidence"
        role="region"
        aria-label="Evidence and sources"
        className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/[0.06] dark:bg-white/[0.01]"
      >
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
          Evidence
        </h2>
        <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Last regenerated {formatRelative(page.regeneratedAt)}; revision {page.revision}.
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Linked reports feed this page. Fix a fact by editing the source report
            and regenerating — the wiki follows your ground truth.
          </p>
          {/* Linked-artifact list lives here in Phase 2 (table joins) */}
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            Linked reports render in the next UI iteration.
          </div>
        </div>
      </section>

      {/* Themes Panel from REFLECT phase */}
      <WikiThemesPanel ownerKey={ownerKey} />

      {/* Zone 3: Your notes (human-owned, editable) */}
      <WikiNotesEditor ownerKey={ownerKey} pageId={page._id as any} />
    </article>
  );
}

function WikiSection({ title, body }: { title: string; body: string }) {
  if (!body || body.trim().length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      <p className="whitespace-pre-wrap text-sm">{body}</p>
    </div>
  );
}
