import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ExternalLink, Link2, Network, Sparkles } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPath } from "@/features/entities/lib/entityExport";

type Props = {
  entitySlug: string;
  shareToken?: string;
  canOpenLive?: boolean;
  onOpenLive?: () => void;
  openingLive?: boolean;
};

type AuthorKind = "user" | "agent" | "anonymous";

type SourceLite = {
  id: string;
  label: string;
  href?: string;
  confidence?: number;
  domain?: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
  supportCount?: number;
};

type NotebookBlock = {
  id: string;
  kind:
    | "heading-1"
    | "heading-2"
    | "heading-3"
    | "text"
    | "bullet"
    | "todo"
    | "callout"
    | "evidence";
  author: AuthorKind;
  authorLabel: string;
  body: string;
  sourceRefIds?: string[];
  modelUsed?: string;
  costUsd?: number;
  confidence?: number;
  step?: number;
  revisionLabel?: string;
  href?: string;
  evidenceDomain?: string;
  updatedAt?: number;
};

function authorClass(author: AuthorKind): string {
  switch (author) {
    case "agent":
      return "bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]";
    case "user":
      return "bg-emerald-500/20 text-emerald-500";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

function authorLetter(author: AuthorKind): string {
  return author === "agent" ? "A" : author === "user" ? "Y" : "?";
}

function confidenceTone(confidence: number | undefined): string {
  if (confidence == null) return "text-gray-400 bg-gray-500/10";
  if (confidence >= 0.85) return "text-emerald-500 bg-emerald-500/10";
  if (confidence >= 0.6) return "text-amber-500 bg-amber-500/10";
  return "text-red-400 bg-red-500/10";
}

function formatMs(ms: number | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function formatUsd(usd: number | undefined): string {
  if (usd == null) return "—";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}

function formatDateLabel(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(parsed).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function formatMilestoneOffset(timestamp: number | undefined, baseTimestamp: number | undefined): string {
  if (!timestamp || !baseTimestamp) return "—";
  const delta = Math.max(0, timestamp - baseTimestamp);
  if (delta < 1000) return `${delta}ms`;
  return `${(delta / 1000).toFixed(2)}s`;
}

export function EntityNotebookView({ entitySlug, shareToken, canOpenLive = false, onOpenLive, openingLive = false }: Props) {
  const api = useConvexApi();
  const navigate = useNavigate();
  const anonymousSessionId = getAnonymousProductSessionId();
  const snapshot = useQuery(
    api?.domains.product.blocks.getEntityNotebook ?? "skip",
    api?.domains.product.blocks.getEntityNotebook
      ? { anonymousSessionId, shareToken, entitySlug }
      : "skip",
  );
  const backlinks = useQuery(
    api?.domains.product.blocks.listBacklinksForEntity ?? "skip",
    api?.domains.product.blocks.listBacklinksForEntity
      ? { anonymousSessionId, shareToken, entitySlug }
      : "skip",
  );
  const buildEntityPathWithShare = (nextSlug: string) => buildEntityPath(nextSlug, shareToken);
  const canTraverseLinkedEntities = !shareToken;

  const [routingOpen, setRoutingOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const citationLabelByKey = useMemo(() => {
    if (!snapshot) return new Map<string, string>();
    const map = new Map<string, string>();
    snapshot.sources.forEach((source: any, index: number) => {
      const label = `s${index + 1}`;
      map.set(source.id, label);
      map.set(source.label.toLowerCase(), label);
    });
    return map;
  }, [snapshot]);

  const sourcesByKey = useMemo(() => {
    const map = new Map<string, SourceLite>();
    if (!snapshot) return map;
    for (const source of snapshot.sources) {
      map.set(source.id, source);
      map.set(source.label.toLowerCase(), source);
      if (source.href) {
        map.set(source.href, source);
      }
    }
    return map;
  }, [snapshot]);

  if (snapshot === undefined || backlinks === undefined) {
    return <div className="py-16 text-center text-sm text-gray-500">Loading notebook...</div>;
  }

  if (snapshot === null) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="text-sm font-medium text-gray-300">No notebook data for this entity yet.</div>
        {canOpenLive && onOpenLive ? (
          <>
            <p className="max-w-md text-sm leading-6 text-gray-500">
              This tab only shows the read-only derivation. Open Live to start writing.
            </p>
            <button
              type="button"
              onClick={onOpenLive}
              disabled={openingLive}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-4 py-2 text-sm font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {openingLive ? "Opening Live..." : "Open Live notebook"}
            </button>
          </>
        ) : (
          <p className="max-w-md text-sm leading-6 text-gray-500">
            This tab is read-only. Use Live to create the first editable notebook block.
          </p>
        )}
      </div>
    );
  }

  const { routing, planTrace, sources, blocks, revision, reportUpdatedAt, sourceSummary } = snapshot;
  const routingModel = routing.executionModel ?? routing.plannerModel;
  const routingSummary = [
    routingModel ? `🤖 ${routingModel}` : null,
    routing.mode ? `(${routing.mode})` : null,
    formatMs(planTrace.totalDurationMs),
    formatUsd(planTrace.totalCostUsd),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-6">
      <section className="rounded-2xl border border-gray-200 bg-white/[0.75] p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Notebook workspace
            </div>
            <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {snapshot.entityName}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded-full border border-gray-200 px-2 py-1 dark:border-white/10">
                {snapshot.entityType}
              </span>
              <span>{snapshot.reportCount} report{snapshot.reportCount === 1 ? "" : "s"}</span>
              <span>{snapshot.noteCount} note block{snapshot.noteCount === 1 ? "" : "s"}</span>
              {revision ? <span>rev {revision}</span> : null}
              {reportUpdatedAt ? <span>updated {new Date(reportUpdatedAt).toLocaleString()}</span> : null}
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="rounded-full border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-primary)]">
              {routingSummary}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              {routing.operatorLabel ? (
                <span className="rounded-full border border-gray-200 px-2 py-1 dark:border-white/10">
                  using {routing.operatorLabel}
                </span>
              ) : null}
              {snapshot.lastError ? (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-400">
                  last run error
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <details
        open={routingOpen}
        onToggle={(event) => setRoutingOpen((event.target as HTMLDetailsElement).open)}
        className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-white/10"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-3 bg-gray-50/60 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:bg-white/[0.02] dark:text-gray-400 dark:hover:bg-white/[0.04]">
          <div className="flex items-center gap-2">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${routingOpen ? "rotate-90" : ""}`} />
            <strong className="font-medium text-gray-900 dark:text-gray-100">Routing &amp; operator context</strong>
            <span className="text-xs text-gray-500">how this brief was generated</span>
          </div>
          {routing.mode ? (
            <span className="rounded border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-2 py-0.5 font-mono text-[11px] text-[var(--accent-primary)]">
              {routing.mode}
              {routing.reasoningEffort ? ` · ${routing.reasoningEffort} reasoning` : ""}
            </span>
          ) : null}
        </summary>
        <div className="bg-black/20 px-4 py-3 font-mono text-xs text-gray-400 dark:bg-black/30">
          <ProvRow k="routingMode" v={routing.mode ?? "—"} />
          <ProvRow k="routingReason" v={routing.reason ?? "—"} />
          <ProvRow k="routingSource" v={routing.source ?? "—"} />
          <ProvRow k="plannerModel" v={routing.plannerModel ?? "—"} />
          <ProvRow k="executionModel" v={routing.executionModel ?? "—"} />
          <ProvRow k="reasoningEffort" v={routing.reasoningEffort ?? "—"} />
          <ProvRow k="operator.label" v={routing.operatorLabel ?? "—"} />
          <ProvRow k="operator.hint" v={routing.operatorHint ?? "—"} last />
        </div>
      </details>

      <details
        open={planOpen}
        onToggle={(event) => setPlanOpen((event.target as HTMLDetailsElement).open)}
        className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-white/10"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-3 bg-gray-50/60 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:bg-white/[0.02] dark:text-gray-400 dark:hover:bg-white/[0.04]">
          <div className="flex items-center gap-2">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${planOpen ? "rotate-90" : ""}`} />
            <strong className="font-medium text-gray-900 dark:text-gray-100">Execution plan trace</strong>
            <span className="text-xs text-gray-500">what tools ran, in what order</span>
          </div>
          <span className="text-xs text-gray-500">
            {planTrace.steps.length} step{planTrace.steps.length === 1 ? "" : "s"} · {formatMs(planTrace.totalDurationMs)} ·{" "}
            {formatUsd(planTrace.totalCostUsd)} · {planTrace.adaptationCount} adaptations
          </span>
        </summary>
        <div className="bg-black/20 px-4 py-3 font-mono text-xs text-gray-300 dark:bg-black/30">
          {planTrace.steps.length === 0 ? (
            <div className="text-gray-500">No tool events recorded for this run.</div>
          ) : (
            planTrace.steps.map((step: any) => (
              <div
                key={`${step.step}-${step.tool}`}
                className="grid grid-cols-[24px_170px_1fr_auto] gap-3 border-b border-dashed border-gray-200/40 py-1.5 last:border-0 dark:border-white/[0.06]"
              >
                <span className="text-right text-gray-500">{step.step}</span>
                <span className="truncate text-[var(--accent-primary)]">
                  {step.tool}
                  {step.parallel ? (
                    <span className="ml-1 rounded bg-[var(--accent-primary)]/10 px-1.5 py-0.5 text-[10px] text-[var(--accent-primary)]">
                      parallel
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 truncate text-[11px] text-gray-500">
                  {step.preview ?? step.reason ?? (step.model ? `model=${step.model}` : "")}
                </span>
                <span
                  className={
                    step.status === "done"
                      ? "text-emerald-500"
                      : step.status === "error"
                        ? "text-red-400"
                        : "text-[var(--accent-primary)]"
                  }
                >
                  {step.status} · {formatMs(step.durationMs)}
                  {step.tokensIn || step.tokensOut ? ` · ${step.tokensIn ?? 0}/${step.tokensOut ?? 0} tok` : ""}
                  {step.costUsd != null ? ` · ${formatUsd(step.costUsd)}` : ""}
                </span>
              </div>
            ))
          )}
          <div className="pt-3 text-[11px] text-gray-500">
            Milestones: firstStageAt {formatMilestoneOffset(planTrace.milestones.firstStageAt, snapshot.sessionStartedAt)} ·
            firstSourceAt {formatMilestoneOffset(planTrace.milestones.firstSourceAt, snapshot.sessionStartedAt)} ·
            firstPartialAnswerAt {formatMilestoneOffset(planTrace.milestones.firstPartialAnswerAt, snapshot.sessionStartedAt)} ·
            totalDurationMs {formatMs(planTrace.totalDurationMs)}
          </div>
        </div>
      </details>

      <details
        open={sourcesOpen}
        onToggle={(event) => setSourcesOpen((event.target as HTMLDetailsElement).open)}
        className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-white/10"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-3 bg-gray-50/60 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:bg-white/[0.02] dark:text-gray-400 dark:hover:bg-white/[0.04]">
          <div className="flex items-center gap-2">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${sourcesOpen ? "rotate-90" : ""}`} />
            <strong className="font-medium text-gray-900 dark:text-gray-100">Sources with confidence</strong>
            <span className="text-xs text-gray-500">
              {sources.length} source{sources.length === 1 ? "" : "s"} graded
            </span>
          </div>
          <span className="text-xs text-gray-500">
            confidence avg {sourceSummary.averageConfidence?.toFixed(2) ?? "—"} · {sourceSummary.corroboratedCount} corroborated ·{" "}
            {sourceSummary.unverifiedCount} unverified
          </span>
        </summary>
        <div className="bg-black/20 px-4 py-3 font-mono text-xs dark:bg-black/30">
          {sources.length === 0 ? (
            <div className="text-gray-500">No sources captured.</div>
          ) : (
            sources.map((source: any, index: number) => (
              <div
                key={source.id}
                className="grid grid-cols-[120px_1fr_auto] gap-3 border-b border-dashed border-gray-200/40 py-1.5 last:border-0 dark:border-white/[0.06]"
              >
                <span className="truncate text-gray-500">
                  s{index + 1} · {source.domain ?? source.siteName ?? "source"}
                </span>
                <span className="min-w-0 text-gray-300">
                  {source.href ? (
                    <a
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {source.title ?? source.label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    source.title ?? source.label
                  )}
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {formatDateLabel(source.publishedAt) ? `pub ${formatDateLabel(source.publishedAt)} · ` : ""}
                    {source.excerpt ? source.excerpt : source.label}
                  </div>
                </span>
                <div className="flex items-start gap-2">
                  {source.supportCount ? (
                    <span className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 bg-white/[0.05]">
                      {source.supportCount} section{source.supportCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span className={`rounded px-1.5 py-0.5 ${confidenceTone(source.confidence)}`}>
                    {source.confidence != null ? source.confidence.toFixed(2) : "—"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </details>

      <div className="mt-6 border-b border-gray-100 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-white/[0.06] dark:text-gray-400">
        Notebook
      </div>

      <div className="mt-4 space-y-0.5">
        {blocks.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">No content yet. Start a chat to generate a brief.</div>
        ) : (
          blocks.map((block: any) => (
            <BlockRow
              key={block.id}
              block={block}
              sourcesByKey={sourcesByKey}
              citationLabelByKey={citationLabelByKey}
            />
          ))
        )}
      </div>

      {backlinks.length > 0 ? (
        <section className="mt-10 border-t border-gray-100 pt-6 dark:border-white/[0.06]">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Linked from · {backlinks.length} place{backlinks.length === 1 ? "" : "s"}
          </div>
          <div className="mt-3 space-y-2">
            {backlinks.map((ref: any) =>
              canTraverseLinkedEntities ? (
                <button
                  key={ref.relationId}
                  type="button"
                  onClick={() => navigate(buildEntityPathWithShare(ref.fromEntitySlug))}
                  className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/[0.03]"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{ref.fromEntityName}</div>
                  <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {ref.snippet || "Linked through notebook content."}
                  </div>
                </button>
              ) : (
                <div
                  key={ref.relationId}
                  className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left dark:border-white/10"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{ref.fromEntityName}</div>
                  <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {ref.snippet || "Linked through notebook content."}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      ) : null}

      {snapshot.linkedFrom.length > 0 ? (
        <section className="mt-8">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Linked entities
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.linkedFrom.map((item: any) =>
              canTraverseLinkedEntities ? (
              <button
                key={`linked-${item.slug}`}
                type="button"
                onClick={() => navigate(buildEntityPathWithShare(item.slug))}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              >
                <Network className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                <span>{item.name}</span>
                {item.reason ? <span className="text-xs text-gray-400">· {item.reason}</span> : null}
              </button>
              ) : (
                <div
                  key={`linked-${item.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 dark:border-white/10 dark:text-gray-300"
                >
                  <Network className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                  <span>{item.name}</span>
                  {item.reason ? <span className="text-xs text-gray-400">&middot; {item.reason}</span> : null}
                </div>
              )
            )}
          </div>
        </section>
      ) : null}

      {snapshot.relatedEntities.length > 0 ? (
        <section className="mt-8">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Related entities (harness-suggested)
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.relatedEntities.map((item: any) =>
              canTraverseLinkedEntities ? (
              <button
                key={`related-${item.slug}`}
                type="button"
                onClick={() => navigate(buildEntityPathWithShare(item.slug))}
                className="flex w-full items-start justify-between rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/[0.03]"
              >
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                  <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {item.reason ?? item.relation ?? item.entityType}
                  </div>
                </div>
                <Sparkles className="mt-0.5 h-4 w-4 text-[var(--accent-primary)]" />
              </button>
              ) : (
                <div
                  key={`related-${item.slug}`}
                  className="flex w-full items-start justify-between rounded-lg border border-gray-200 px-3 py-2 text-left dark:border-white/10"
                >
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                    <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                      {item.reason ?? item.relation ?? item.entityType}
                    </div>
                  </div>
                  <Sparkles className="mt-0.5 h-4 w-4 text-[var(--accent-primary)]" />
                </div>
              )
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProvRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div
      className={`grid grid-cols-[140px_1fr] gap-3 py-1 ${
        last ? "" : "border-b border-dashed border-gray-200/40 dark:border-white/[0.06]"
      }`}
    >
      <span className="text-gray-500">{k}</span>
      <span className="break-words text-gray-200">{v}</span>
    </div>
  );
}

function BlockRow({
  block,
  sourcesByKey,
  citationLabelByKey,
}: {
  block: NotebookBlock;
  sourcesByKey: Map<string, SourceLite>;
  citationLabelByKey: Map<string, string>;
}) {
  const isEvidence = block.kind === "evidence";

  return (
    <div
      className={`group relative grid grid-cols-[22px_1fr] gap-2 rounded px-1 py-0.5 transition-colors hover:bg-gray-50 focus-within:bg-gray-50 dark:hover:bg-white/[0.015] dark:focus-within:bg-white/[0.015] ${
        isEvidence ? "ml-6" : ""
      }`}
    >
      <div className="flex items-start justify-center pt-1">
        <span
          title={block.authorLabel}
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold ${authorClass(block.author)}`}
        >
          {authorLetter(block.author)}
        </span>
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <BlockBody block={block} sourcesByKey={sourcesByKey} citationLabelByKey={citationLabelByKey} />
        </div>
        <BlockProvenance block={block} />
      </div>
    </div>
  );
}

function BlockBody({
  block,
  sourcesByKey,
  citationLabelByKey,
}: {
  block: NotebookBlock;
  sourcesByKey: Map<string, SourceLite>;
  citationLabelByKey: Map<string, string>;
}) {
  if (block.kind === "heading-1") {
    return <h1 className="mb-1 mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">{block.body}</h1>;
  }
  if (block.kind === "heading-2") {
    return <h2 className="mb-1 mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{block.body}</h2>;
  }
  if (block.kind === "heading-3") {
    return <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{block.body}</h3>;
  }
  if (block.kind === "bullet") {
    return (
      <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        <span className="mr-2 text-gray-400">•</span>
        {block.body}
      </div>
    );
  }
  if (block.kind === "todo") {
    return (
      <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        <span className="mr-2 text-gray-400">☐</span>
        {block.body}
      </div>
    );
  }
  if (block.kind === "callout") {
    return (
      <div className="my-2 border-l-2 border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 py-1 pl-3 text-sm text-gray-700 dark:text-gray-300">
        {block.body}
      </div>
    );
  }
  if (block.kind === "evidence") {
    const matchedSource =
      (block.href ? sourcesByKey.get(block.href) : undefined) ??
      sourcesByKey.get(block.body) ??
      (block.evidenceDomain ? sourcesByKey.get(block.evidenceDomain) : undefined);
    return (
      <a
        href={block.href ?? "#"}
        target={block.href ? "_blank" : undefined}
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white/40 px-2.5 py-1 text-[12.5px] text-gray-600 transition-colors hover:border-gray-300 dark:border-white/10 dark:bg-white/[0.02] dark:text-gray-400 dark:hover:border-white/20 ${
          block.href ? "" : "pointer-events-none"
        }`}
      >
        <Link2 className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
        <span className="truncate">{matchedSource?.title ?? block.body}</span>
        {(matchedSource?.domain ?? block.evidenceDomain) ? (
          <span className="text-[11px] text-gray-400">
            · {matchedSource?.domain ?? block.evidenceDomain}
            {formatDateLabel(matchedSource?.publishedAt) ? ` · ${formatDateLabel(matchedSource?.publishedAt)}` : ""}
          </span>
        ) : null}
        {block.confidence != null ? (
          <span className={`rounded px-1.5 text-[10px] ${confidenceTone(block.confidence)}`}>
            {block.confidence.toFixed(2)}
          </span>
        ) : null}
      </a>
    );
  }

  return (
    <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
      {block.body}
      {block.sourceRefIds && block.sourceRefIds.length > 0 ? (
        <span className="ml-1 inline-flex gap-0.5 align-super">
          {block.sourceRefIds.map((refId, index) => {
            const source = sourcesByKey.get(refId) ?? sourcesByKey.get(refId.toLowerCase());
            const tooltip = source
              ? `${source.domain ?? source.title ?? source.label}${
                  source.confidence != null ? ` · confidence ${source.confidence.toFixed(2)}` : ""
                }`
              : refId;
            const citeLabel = citationLabelByKey.get(refId) ?? citationLabelByKey.get(refId.toLowerCase()) ?? refId;
            return (
              <a
                key={`${block.id}-cite-${index}`}
                href={source?.href ?? "#"}
                target={source?.href ? "_blank" : undefined}
                rel="noopener noreferrer"
                title={tooltip}
                className="rounded bg-[var(--accent-primary)]/15 px-1 text-[10px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25"
              >
                [{citeLabel}]
              </a>
            );
          })}
        </span>
      ) : null}
    </p>
  );
}

function BlockProvenance({ block }: { block: NotebookBlock }) {
  if (block.author !== "agent" || block.kind !== "text") return null;

  const items: Array<{ label: string; tone: string; title?: string }> = [];
  if (block.modelUsed) {
    items.push({
      label: block.modelUsed,
      tone: "text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
      title: "Model used",
    });
  }
  if (block.step != null) {
    items.push({
      label: `step ${block.step}`,
      tone: "text-gray-500 bg-gray-500/10",
      title: "Tool step",
    });
  }
  if (block.costUsd != null) {
    items.push({
      label: formatUsd(block.costUsd),
      tone: "text-amber-500 bg-amber-500/10",
      title: "Estimated cost",
    });
  }
  if (block.confidence != null) {
    items.push({
      label: `conf ${block.confidence.toFixed(2)}`,
      tone: confidenceTone(block.confidence),
      title: "Section confidence",
    });
  }
  if (block.revisionLabel) {
    items.push({
      label: block.revisionLabel,
      tone: "text-gray-500 bg-gray-500/10",
      title: "Revision lineage",
    });
  }
  if (items.length === 0) return null;

  return (
    <span className="flex flex-shrink-0 items-start gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-90 group-focus-within:opacity-90">
      {items.map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          title={item.title}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${item.tone}`}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

export default EntityNotebookView;
