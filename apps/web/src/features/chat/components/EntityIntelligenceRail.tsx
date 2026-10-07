import {
  ArrowRight,
  BookOpen,
  Boxes,
  FileText,
  GitBranch,
  Map,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type RailSource = {
  id?: string | null;
  label?: string | null;
  domain?: string | null;
  href?: string | null;
};

type RailSection = {
  id: string;
  title: string;
  body?: string;
};

type RailAction = {
  label: string;
  rationale?: string;
  enabled?: boolean;
};

export function EntityIntelligenceRail({
  rootName,
  rootSlug,
  sources,
  sections,
  actions,
  threadCount,
  statusLabel,
  reportReady,
  onOpenReport,
  onOpenMap,
  onOpenArtifacts,
  onAskFollowUp,
  className,
}: {
  rootName: string | null;
  rootSlug: string | null;
  sources: RailSource[];
  sections: RailSection[];
  actions: RailAction[];
  threadCount: number;
  statusLabel: string;
  reportReady: boolean;
  onOpenReport?: () => void;
  onOpenMap?: () => void;
  onOpenArtifacts?: () => void;
  onAskFollowUp?: (prompt: string) => void;
  className?: string;
}) {
  const topSources = sources.slice(0, 4);
  const topSections = sections.slice(0, 3);
  const topActions = actions.filter((action) => action.enabled !== false).slice(0, 3);
  const hasRoot = Boolean(rootName?.trim() || rootSlug?.trim());
  const nodeCount =
    (hasRoot ? 1 : 0) + topSources.length + topSections.length + Math.min(topActions.length, 2);
  const edgeCount = Math.max(0, topSources.length + topSections.length + topActions.length);

  return (
    <aside
      data-testid="chat-entity-intelligence-rail"
      className={cn(
        "space-y-3 rounded-[14px] border border-black/[0.06] bg-white p-4 text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            <Boxes className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
            Entity workspace
          </div>
          <h2 className="mt-2 truncate text-base font-semibold tracking-[-0.02em] text-gray-950 dark:text-white">
            {rootName ?? "No active entity"}
          </h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {hasRoot
              ? statusLabel
              : "Ask about a company, person, event, or market to start the report graph."}
          </p>
        </div>
        <span
          data-ready={reportReady}
          className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 data-[ready=true]:border-emerald-700/15 data-[ready=true]:bg-emerald-700/10 data-[ready=true]:text-emerald-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300"
        >
          {reportReady ? "Report" : "Draft"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <RailMetric icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Sources" value={sources.length} />
        <RailMetric icon={<BookOpen className="h-3.5 w-3.5" />} label="Notes" value={sections.length} />
        <RailMetric icon={<MessageSquareText className="h-3.5 w-3.5" />} label="Threads" value={threadCount} />
      </div>

      <div className="rounded-[12px] border border-black/[0.06] bg-[#fbf9f6] p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
            Map preview
          </div>
          <span className="font-mono text-[10px] text-gray-400">
            {nodeCount} nodes / {edgeCount} edges
          </span>
        </div>
        <div className="mt-3">
          <div className="relative h-[116px] overflow-hidden rounded-[10px] border border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-black/20">
            <MapNode className="left-[38%] top-[38%]" tone="root" label={rootName?.slice(0, 2) ?? "NB"} />
            {topSources[0] ? <MapNode className="left-[12%] top-[20%]" tone="source" label="S" /> : null}
            {topSources[1] ? <MapNode className="right-[14%] top-[18%]" tone="source" label="S" /> : null}
            {topSections[0] ? <MapNode className="left-[18%] bottom-[16%]" tone="note" label="N" /> : null}
            {topActions[0] ? <MapNode className="right-[18%] bottom-[18%]" tone="action" label="A" /> : null}
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              <line x1="46%" y1="48%" x2="19%" y2="28%" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1.2" />
              <line x1="50%" y1="48%" x2="78%" y2="28%" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1.2" />
              <line x1="46%" y1="54%" x2="24%" y2="76%" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1.2" />
              <line x1="52%" y1="54%" x2="76%" y2="75%" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth="1.2" />
            </svg>
          </div>
          <button
            type="button"
            onClick={onOpenMap}
            disabled={!hasRoot || !onOpenMap}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-black/[0.07] bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-[var(--accent-primary)]/30 hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
          >
            <Map className="h-3.5 w-3.5" aria-hidden="true" />
            Open workspace map
          </button>
        </div>
      </div>

      <RailPanel title="Relationship pills" icon={<GitBranch className="h-3.5 w-3.5" />}>
        <div className="flex flex-wrap gap-1.5">
          {hasRoot ? (
            <RailPill onClick={onOpenReport} tone="root">
              {rootName}
            </RailPill>
          ) : null}
          {topSections.map((section) => (
            <RailPill key={section.id} onClick={onOpenReport} tone="note">
              {section.title}
            </RailPill>
          ))}
          {topSources.map((source, index) => (
            <RailPill
              key={source.id ?? source.href ?? `source-${index}`}
              onClick={() => {
                if (source.href && typeof window !== "undefined") {
                  window.open(source.href, "_blank", "noopener,noreferrer");
                }
              }}
              tone="source"
            >
              {source.label || source.domain || `Source ${index + 1}`}
            </RailPill>
          ))}
          {!hasRoot && topSections.length === 0 && topSources.length === 0 ? (
            <span className="text-xs leading-5 text-gray-500 dark:text-gray-400">
              Entity pills appear as soon as the thread resolves an entity, source, or notebook section.
            </span>
          ) : null}
        </div>
      </RailPanel>

      <RailPanel title="Report memory" icon={<FileText className="h-3.5 w-3.5" />}>
        <div className="grid gap-2">
          <RailActionButton
            label={reportReady ? "Open report notebook" : "Review artifacts"}
            onClick={reportReady ? onOpenReport : onOpenArtifacts}
            disabled={reportReady ? !onOpenReport : !onOpenArtifacts}
          />
          {topActions.map((action) => (
            <RailActionButton
              key={action.label}
              label={action.label}
              detail={action.rationale}
              onClick={() => onAskFollowUp?.(action.label)}
              disabled={!onAskFollowUp}
            />
          ))}
        </div>
      </RailPanel>
    </aside>
  );
}

function RailMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[12px] border border-black/[0.06] bg-[#fbf9f6] px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.03]">
      <div className="flex items-center gap-1.5 text-gray-400">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function RailPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-black/[0.06] bg-white p-3 dark:border-white/[0.07] dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function RailPill({
  children,
  onClick,
  tone = "source",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "root" | "note" | "source";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-tone={tone}
      className="max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-semibold transition data-[tone=note]:border-sky-500/20 data-[tone=note]:bg-sky-500/10 data-[tone=note]:text-sky-700 data-[tone=root]:border-[var(--accent-primary)]/25 data-[tone=root]:bg-[var(--accent-primary)]/10 data-[tone=root]:text-[var(--accent-primary)] data-[tone=source]:border-emerald-700/15 data-[tone=source]:bg-emerald-700/10 data-[tone=source]:text-emerald-700 disabled:cursor-default dark:data-[tone=note]:text-sky-300 dark:data-[tone=source]:text-emerald-300"
    >
      {children}
    </button>
  );
}

function RailActionButton({
  label,
  detail,
  onClick,
  disabled,
}: {
  label: string;
  detail?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center justify-between gap-3 rounded-[10px] border border-black/[0.06] bg-[#fbf9f6] px-3 py-2.5 text-left transition hover:border-[var(--accent-primary)]/30 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/[0.07] dark:bg-black/20"
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
          {label}
        </span>
        {detail ? (
          <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
            {detail}
          </span>
        ) : null}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--accent-primary)]" />
    </button>
  );
}

function MapNode({
  className,
  tone,
  label,
}: {
  className: string;
  tone: "root" | "source" | "note" | "action";
  label: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "absolute z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-[10px] font-black uppercase text-white shadow-sm",
        "data-[tone=action]:bg-amber-600 data-[tone=note]:bg-sky-600 data-[tone=root]:bg-[var(--accent-primary)] data-[tone=source]:bg-emerald-700",
        className,
      )}
    >
      {label.slice(0, 2)}
    </span>
  );
}
