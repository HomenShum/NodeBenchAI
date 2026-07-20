import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EntityNotebookSurface } from "./EntityNotebookSurface";

vi.mock("@/features/entities/components/EntityNotebookView", () => ({
  EntityNotebookView: ({
    entitySlug,
    canOpenLive,
    openingLive,
  }: {
    entitySlug: string;
    canOpenLive?: boolean;
    openingLive?: boolean;
  }) => (
    <div data-testid="mock-notebook-view">
      notebook:{entitySlug}:{String(canOpenLive)}:{String(openingLive)}
    </div>
  ),
}));

vi.mock("@/features/entities/components/notebook/EntityNotebookLiveMount", () => ({
  EntityNotebookLiveMount: ({
    entitySlug,
    canEdit,
    latestHumanEditorOwnerKey,
  }: {
    entitySlug: string;
    canEdit: boolean;
    latestHumanEditorOwnerKey?: string | null;
  }) => (
    <div data-testid="mock-live-notebook">
      live:{entitySlug}:{String(canEdit)}:{latestHumanEditorOwnerKey ?? "none"}
    </div>
  ),
}));

describe("EntityNotebookSurface", () => {
  const baseProps = {
    entitySlug: "softbank",
    shareToken: undefined,
    showViewModeToggle: false,
    isReadMode: false,
    liveNotebookEnabled: true,
    materializingLiveWorkspace: false,
    hasWorkspaceSlug: true,
    canEditNotebook: true,
    notebookDriftMessage: null,
    notebookDriftUpdatedLabel: null,
    viewerOwnerKey: "user:owner",
    collaborationParticipants: [],
    latestHumanEditorOwnerKey: "user:owner",
    latestHumanEditorUpdatedAt: Date.now(),
    onSelectClassic: vi.fn(),
    onSelectNotebook: vi.fn(),
    onSelectLive: vi.fn(),
    onOpenReferenceNotebook: vi.fn(),
  } as const;

  it("renders the fallback notebook view when no live notebook exists yet", async () => {
    render(
      <EntityNotebookSurface
        {...baseProps}
        entityViewMode="notebook"
        hasLiveEntity={false}
      />,
    );

    expect(await screen.findByTestId("mock-notebook-view")).toHaveTextContent(
      "notebook:softbank:true:false",
    );
    expect(screen.queryByTestId("mock-live-notebook")).not.toBeInTheDocument();
  });

  it("renders the live notebook surface whenever live data exists", async () => {
    render(
      <EntityNotebookSurface
        {...baseProps}
        entityViewMode="notebook"
        hasLiveEntity
      />,
    );

    expect(await screen.findByTestId("mock-live-notebook")).toHaveTextContent(
      "live:softbank:true:user:owner",
    );
    expect(screen.queryByTestId("mock-notebook-view")).not.toBeInTheDocument();
  });

  it("turns the live notebook into a read-only report surface in read mode", async () => {
    render(
      <EntityNotebookSurface
        {...baseProps}
        entityViewMode="live"
        isReadMode
        hasLiveEntity
      />,
    );

    expect(await screen.findByTestId("mock-live-notebook")).toHaveTextContent(
      "live:softbank:false:user:owner",
    );
  });
});
