import { memo } from "react";
import { ArrowRight, CheckCircle2, Clock3, Layers3, Sparkles, Workflow, XCircle } from "lucide-react";

export type FounderEpisodeSpan = {
  stage: "before" | "during" | "after";
  type: string;
  status: "ok" | "running" | "error";
  label: string;
  detail?: string;
  timestamp: string;
  contextId?: string;
  taskId?: string;
  metrics?: Record<string, string | number | null | undefined>;
};

export type FounderEpisodeRecord = {
  episodeId: string;
  correlationId: string;
  sessionKey?: string | null;
  workspaceId?: string | null;
  surface: string;
  episodeType: string;
  status: "active" | "completed" | "error" | "aborted";
  query?: string | null;
  lens?: string | null;
  entityName?: string | null;
  packetId?: string | null;
  packetType?: string | null;
  contextId?: string | null;
  taskId?: string | null;
  summary?: string | null;
  stateBeforeHash?: string | null;
  stateAfterHash?: string | null;
  spans: FounderEpisodeSpan[];
  traceStepCount?: number | null;
  toolsInvoked: string[];
  artifactsProduced: string[];
  importantChangesDetected?: number | null;
  contradictionsDetected?: number | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type FounderEpisodeLineageNode = {
  id: string;
  label: string;
  detail: string;
  status: "complete" | "active" | "pending";
};

export type FounderSubconsciousPreview = {
  mode: "off" | "whisper" | "packet" | "full" | "review";
  classification: string;
  whisperText: string;
  suppressed: boolean;
  suppressionReason?: string | null;
  contradictions: string[];
  stalePackets: string[];
  blockIdsUsed: string[];
};

function statusTone(status: FounderEpisodeRecord["status"] | FounderEpisodeSpan["status"]): string {
  if (status === "completed" || status === "ok") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if (status === "active" || status === "running") return "text-[#f2b49f] bg-[#d97757]/10 border-[#d97757]/20";
  return "text-rose-300 bg-rose-500/10 border-rose-500/20";
}

function stageTone(stage: FounderEpisodeSpan["stage"]): string {
  if (stage === "before") return "text-sky-300 bg-sky-500/10";
  if (stage === "during") return "text-[#f2b49f] bg-[#d97757]/10";
  return "text-emerald-300 bg-emerald-500/10";
}

function StageIcon({ stage, status }: { stage: FounderEpisodeSpan["stage"]; status: FounderEpisodeSpan["status"] }) {
  if (status === "error") return <XCircle className="h-4 w-4 text-rose-300" />;
  if (status === "running") return <Clock3 className="h-4 w-4 text-[#f2b49f]" />;
  if (stage === "after") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (stage === "during") return <Workflow className="h-4 w-4 text-[#f2b49f]" />;
  return <Layers3 className="h-4 w-4 text-sky-300" />;
}

export const FounderEpisodePanel = memo(function FounderEpisodePanel({
  activeEpisode,
  recentEpisodes,
  packetLineage,
  subconsciousPreview,
  isSubconsciousLoading = false,
}: {
  activeEpisode: FounderEpisodeRecord | null;
  recentEpisodes: FounderEpisodeRecord[];
  packetLineage?: FounderEpisodeLineageNode[];
  subconsciousPreview?: FounderSubconsciousPreview | null;
  isSubconsciousLoading?: boolean;
}) {
  const activeSpans = activeEpisode?.spans ?? [];
  if (!activeEpisode && recentEpisodes.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#d97757]" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Founder Episode
            </div>
            <div className="text-sm text-content">
              {activeEpisode?.entityName ?? activeEpisode?.query ?? "Founder-intelligence timeline"}
            </div>
          </div>
        </div>
        {activeEpisode ? (
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(activeEpisode.status)}`}>
            {activeEpisode.status}
          </span>
        ) : null}
      </div>

      {activeEpisode ? (
        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.9fr)]">
          <div>
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-content-muted">
              {activeEpisode.lens ? <span className="rounded-full bg-white/[0.05] px-2.5 py-1">{activeEpisode.lens} lens</span> : null}
              {activeEpisode.traceStepCount ? <span className="rounded-full bg-white/[0.05] px-2.5 py-1">{activeEpisode.traceStepCount} trace steps</span> : null}
              {activeEpisode.contextId ? <span className="rounded-full bg-white/[0.05] px-2.5 py-1">packet linked</span> : null}
              {activeEpisode.taskId ? <span className="rounded-full bg-white/[0.05] px-2.5 py-1">delegation ready</span> : null}
            </div>
            <div className="space-y-2.5">
              {activeSpans.map((span, index) => (
                <div key={`${span.type}:${span.timestamp}:${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <StageIcon stage={span.stage} status={span.status} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${stageTone(span.stage)}`}>
                          {span.stage}
                        </span>
                        <span className="text-sm font-medium text-content">{span.label}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusTone(span.status)}`}>
                          {span.status}
                        </span>
                      </div>
                      {span.detail ? <p className="mt-1 text-xs leading-relaxed text-content-muted">{span.detail}</p> : null}
                      {span.metrics && Object.keys(span.metrics).length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-content-muted">
                          {Object.entries(span.metrics).map(([key, value]) => (
                            <span key={key} className="rounded-full bg-white/[0.05] px-2 py-1">
                              {key.replace(/_/g, " ")}: {value ?? "—"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">Outcome</div>
              <div className="mt-2 text-sm text-content">{activeEpisode.summary ?? "Founder packet compiled and ready for action."}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-content-muted">
                <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                  <div>Important changes</div>
                  <div className="mt-1 text-base text-content">{activeEpisode.importantChangesDetected ?? 0}</div>
                </div>
                <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                  <div>Contradictions</div>
                  <div className="mt-1 text-base text-content">{activeEpisode.contradictionsDetected ?? 0}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">Tools and Artifacts</div>
              <div className="mt-2 text-xs text-content-muted">
                {(activeEpisode.toolsInvoked ?? []).length > 0 ? (activeEpisode.toolsInvoked ?? []).join(", ") : "No tool list captured yet."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(((activeEpisode.artifactsProduced ?? []).length > 0 ? activeEpisode.artifactsProduced : ["founder_packet"]) ?? ["founder_packet"]).map((artifact) => (
                  <span key={artifact} className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-content-secondary">
                    {artifact}
                  </span>
                ))}
              </div>
            </div>

            {packetLineage && packetLineage.length > 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">Packet Lineage</div>
                <div className="mt-3 space-y-2">
                  {packetLineage.map((node) => (
                    <div key={node.id} className="rounded-lg bg-white/[0.04] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                          node.status === "complete"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : node.status === "active"
                              ? "bg-[#d97757]/10 text-[#f2b49f]"
                              : "bg-white/[0.06] text-content-muted"
                        }`}>
                          {node.status}
                        </span>
                        <span className="text-xs font-medium text-content">{node.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-content-muted">{node.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {isSubconsciousLoading || subconsciousPreview ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">Subconscious Routing</div>
                  {subconsciousPreview ? (
                    <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-content-muted">
                      {subconsciousPreview.mode}
                    </span>
                  ) : null}
                </div>
                {isSubconsciousLoading ? (
                  <div className="mt-3 text-xs text-content-muted">Preparing packet-aware guidance…</div>
                ) : subconsciousPreview ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-sm text-content">
                      {subconsciousPreview.suppressed
                        ? "No whisper injected."
                        : subconsciousPreview.whisperText || "Guidance is available for this founder episode."}
                    </div>
                    {subconsciousPreview.suppressed && subconsciousPreview.suppressionReason ? (
                      <div className="text-[11px] text-content-muted">
                        Suppressed because {subconsciousPreview.suppressionReason.replace(/_/g, " ")}.
                      </div>
                    ) : null}
                    {subconsciousPreview.contradictions.length > 0 ? (
                      <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        {subconsciousPreview.contradictions[0]}
                      </div>
                    ) : null}
                    {subconsciousPreview.stalePackets.length > 0 ? (
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-[11px] text-content-muted">
                        {subconsciousPreview.stalePackets[0]}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {recentEpisodes.length > 0 ? (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">Recent Episodes</div>
          <div className="space-y-2">
            {recentEpisodes.slice(0, 4).map((episode) => (
              <div key={episode.episodeId} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusTone(episode.status)}`}>
                  {episode.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-content">{episode.entityName ?? episode.query ?? episode.episodeType}</div>
                  <div className="truncate text-[11px] text-content-muted">
                    {episode.summary ?? `${episode.traceStepCount ?? 0} trace steps`}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-content-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});
