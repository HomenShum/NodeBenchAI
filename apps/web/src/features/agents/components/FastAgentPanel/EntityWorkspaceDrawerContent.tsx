import { memo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Activity, FileText, GitBranch } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { ExtendedRunPanel } from "@/features/entities/components/notebook/ExtendedRunPanel";
import { NotebookRunMapPanel } from "@/features/entities/components/notebook/NotebookRunMapPanel";
import { NotebookScratchpadTracePanel } from "@/features/entities/components/notebook/NotebookScratchpadTracePanel";

type ScratchpadRunSummary = {
  runId: string;
  status: "streaming" | "structuring" | "merged" | "failed";
  markdownSource: string | null;
  version: number;
  updatedAt: number;
  checkpointCount: number;
  latestBlockType?: string | null;
  checkpoints: Array<{
    checkpointId: string;
    checkpointNumber: number;
    currentStep: string;
    status: "active" | "paused" | "completed" | "error" | "waiting_approval";
    progress: number;
    createdAt: number;
    error?: string;
  }>;
} | null;

type WorkspaceAccess = {
  entity?: {
    name?: string;
  } | null;
  viewerAccess?: {
    canEditNotebook?: boolean;
  } | null;
} | null;

type Props = {
  entitySlug: string;
  tab: "scratchpad" | "flow";
};

function WorkspaceEmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-white/72">
      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-white/48">{detail}</p>
    </div>
  );
}

function EntityWorkspaceDrawerContentBase({ entitySlug, tab }: Props) {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();

  const workspace = useQuery(
    api?.domains?.product?.entities?.getEntityWorkspace ?? ("skip" as any),
    api?.domains?.product?.entities?.getEntityWorkspace
      ? { anonymousSessionId, entitySlug }
      : "skip",
  ) as WorkspaceAccess | undefined;

  const latestScratchpadRun = useQuery(
    api?.domains?.product?.diligenceScratchpads?.getLatestForEntity as never,
    (api?.domains?.product?.diligenceScratchpads?.getLatestForEntity
      ? { anonymousSessionId, entitySlug, checkpointLimit: 8 }
      : "skip") as any,
  ) as ScratchpadRunSummary | undefined;

  const entityLabel = workspace?.entity?.name?.trim() || entitySlug;
  const canEdit = workspace?.viewerAccess?.canEditNotebook ?? true;

  if (tab === "scratchpad") {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Scratchpad
          </div>
          <div className="mt-2 text-sm font-semibold text-white/92">{entityLabel}</div>
          <p className="mt-1 text-[12px] leading-5 text-white/48">
            Raw working memory stays in the drawer. It never writes directly into owned notebook prose.
          </p>
        </div>

        {latestScratchpadRun ? (
          <NotebookScratchpadTracePanel
            markdownSource={latestScratchpadRun.markdownSource}
            runLabel={`${entityLabel} · ${latestScratchpadRun.status}`}
            version={latestScratchpadRun.version}
            updatedAt={latestScratchpadRun.updatedAt}
            checkpoints={latestScratchpadRun.checkpoints}
          />
        ) : (
          <WorkspaceEmptyState
            icon={<FileText className="h-4 w-4 text-white/55" />}
            title="No scratchpad yet"
            detail="Start a diligence run from the Flow tab and the live working memory will stream here."
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
          Flow
        </div>
        <div className="mt-2 text-sm font-semibold text-white/92">{entityLabel}</div>
        <p className="mt-1 text-[12px] leading-5 text-white/48">
          Launch runs, inspect checkpoints, and watch section updates without crowding the notebook page.
        </p>
      </div>

      <ExtendedRunPanel entitySlug={entitySlug} canEdit={canEdit} showLauncherWhenIdle />

      {latestScratchpadRun ? (
        <NotebookRunMapPanel
          entitySlug={entitySlug}
          runStatus={latestScratchpadRun.status}
          checkpointCount={latestScratchpadRun.checkpointCount}
          updatedAt={latestScratchpadRun.updatedAt}
          latestBlockType={latestScratchpadRun.latestBlockType}
        />
      ) : (
        <WorkspaceEmptyState
          icon={<GitBranch className="h-4 w-4 text-white/55" />}
          title="No run graph yet"
          detail="The first diligence run will populate the live flow map here."
        />
      )}

      {!latestScratchpadRun ? (
        <WorkspaceEmptyState
          icon={<Activity className="h-4 w-4 text-white/55" />}
          title="Runtime stays in the drawer"
          detail="The notebook remains the page. Chat, scratchpad, and flow live here as supporting workspace surfaces."
        />
      ) : null}
    </div>
  );
}

export const EntityWorkspaceDrawerContent = memo(EntityWorkspaceDrawerContentBase);
EntityWorkspaceDrawerContent.displayName = "EntityWorkspaceDrawerContent";

export default EntityWorkspaceDrawerContent;
