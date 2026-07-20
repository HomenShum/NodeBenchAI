import { memo, Suspense, lazy } from "react";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

const EntityNotebookView = lazy(() =>
  import("@/features/entities/components/EntityNotebookView").then((mod) => ({
    default: mod.EntityNotebookView,
  })),
);

const EntityNotebookLiveMount = lazy(() =>
  import("@/features/entities/components/notebook/EntityNotebookLiveMount").then((mod) => ({
    default: mod.EntityNotebookLiveMount,
  })),
);

type EntityNotebookSurfaceProps = {
  entitySlug: string;
  shareToken?: string;
  entityViewMode: "classic" | "notebook" | "live";
  showViewModeToggle: boolean;
  isReadMode: boolean;
  liveNotebookEnabled: boolean;
  materializingLiveWorkspace: boolean;
  hasLiveEntity: boolean;
  hasWorkspaceSlug: boolean;
  canEditNotebook: boolean;
  notebookDriftMessage?: string | null;
  notebookDriftUpdatedLabel?: string | null;
  viewerOwnerKey: string | null;
  collaborationParticipants?: ReadonlyArray<{
    ownerKey: string;
    label: string;
    email?: string;
  }>;
  latestHumanEditorOwnerKey: string | null;
  latestHumanEditorUpdatedAt: number | null;
  onSelectClassic: () => void;
  onSelectNotebook: () => void;
  onSelectLive: () => void | Promise<void>;
  onOpenReferenceNotebook: () => void;
};

function EntityNotebookSurfaceBase({
  entitySlug,
  shareToken,
  entityViewMode,
  showViewModeToggle: _showViewModeToggle,
  isReadMode,
  liveNotebookEnabled,
  materializingLiveWorkspace,
  hasLiveEntity,
  hasWorkspaceSlug,
  canEditNotebook,
  notebookDriftMessage,
  notebookDriftUpdatedLabel,
  viewerOwnerKey,
  collaborationParticipants,
  latestHumanEditorOwnerKey,
  latestHumanEditorUpdatedAt,
  onSelectClassic: _onSelectClassic,
  onSelectNotebook: _onSelectNotebook,
  onSelectLive,
  onOpenReferenceNotebook: _onOpenReferenceNotebook,
}: EntityNotebookSurfaceProps) {
  const canOpenLiveFromNotebook =
    liveNotebookEnabled &&
    hasWorkspaceSlug &&
    !(Boolean(shareToken) && !hasLiveEntity) &&
    !materializingLiveWorkspace;
  const renderUnifiedNotebook = liveNotebookEnabled && hasLiveEntity;
  const shouldRenderFallbackNotebook =
    !renderUnifiedNotebook && entityViewMode !== "classic";
  const canEditLiveNotebook = canEditNotebook && !isReadMode;

  return (
    <>
      {notebookDriftMessage && entityViewMode === "classic" ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Live notebook ahead</span>
            {notebookDriftUpdatedLabel ? (
              <span className="text-xs opacity-80">{notebookDriftUpdatedLabel}</span>
            ) : null}
          </div>
          <p className="mt-1.5 leading-6">{notebookDriftMessage}</p>
        </div>
      ) : null}

      {shouldRenderFallbackNotebook ? (
        <ErrorBoundary section="Entity notebook">
          <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading notebook...</div>}>
            <article className="notebook-sheet mt-4">
              <EntityNotebookView
                entitySlug={entitySlug}
                shareToken={shareToken}
                canOpenLive={canOpenLiveFromNotebook}
                onOpenLive={onSelectLive}
                openingLive={materializingLiveWorkspace}
              />
            </article>
          </Suspense>
        </ErrorBoundary>
      ) : null}

      {renderUnifiedNotebook ? (
        <ErrorBoundary section="Live notebook">
          <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading live notebook...</div>}>
            <article className="notebook-sheet notebook-sheet-live mt-4">
              <EntityNotebookLiveMount
                entitySlug={entitySlug}
                shareToken={shareToken}
                canEdit={canEditLiveNotebook}
                showReferenceNotebookToggle={false}
                onOpenReferenceNotebook={undefined}
                viewerOwnerKey={viewerOwnerKey}
                collaborationParticipants={collaborationParticipants}
                latestHumanEditorOwnerKey={latestHumanEditorOwnerKey}
                latestHumanEditorUpdatedAt={latestHumanEditorUpdatedAt}
              />
            </article>
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </>
  );
}

export const EntityNotebookSurface = memo(EntityNotebookSurfaceBase);
EntityNotebookSurface.displayName = "EntityNotebookSurface";
