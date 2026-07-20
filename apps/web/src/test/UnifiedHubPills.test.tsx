// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import { UnifiedHubPills } from "@shared/ui/UnifiedHubPills";
import { renderWithRouter } from "./testUtils";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("UnifiedHubPills", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("marks the active pill via aria-selected", () => {
    renderWithRouter(<UnifiedHubPills active="documents" />);
    const documents = screen.getByRole("tab", { name: "Documents" });
    const schedule = screen.getByRole("tab", { name: "Schedule" });
    const agents = screen.getByRole("tab", { name: "Agents" });

    expect(documents).toHaveAttribute("aria-selected", "true");
    expect(schedule).toHaveAttribute("aria-selected", "false");
    expect(agents).toHaveAttribute("aria-selected", "false");
  });

  it("navigates to the schedule and agents workspace routes on click", () => {
    renderWithRouter(<UnifiedHubPills active="documents" />);

    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "calendar" } }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "agents" } }),
    );
  });

  it("navigates to the documents workspace route when clicking Documents", () => {
    renderWithRouter(<UnifiedHubPills active="calendar" />);

    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: "workspace" as any }),
    );
  });

  it("does not navigate when Roadmap is disabled, and does when enabled", () => {
    renderWithRouter(<UnifiedHubPills active="calendar" showRoadmap roadmapDisabled />);
    const roadmapDisabled = screen.getByRole("tab", { name: "Roadmap" });
    expect(roadmapDisabled).toHaveAttribute("disabled");

    fireEvent.click(roadmapDisabled);
    expect(navigateMock).not.toHaveBeenCalled();

    cleanup();
    navigateMock.mockReset();

    renderWithRouter(
      <UnifiedHubPills active="calendar" showRoadmap roadmapDisabled={false} />,
    );
    const roadmapEnabled = screen.getByRole("tab", { name: "Roadmap" });
    expect(roadmapEnabled).not.toHaveAttribute("disabled");

    fireEvent.click(roadmapEnabled);
    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "roadmap" } }),
    );
  });

  it("uses a compact mobile chooser that names the active hub", () => {
    renderWithRouter(<UnifiedHubPills active="documents" showRoadmap />);

    const chooser = screen.getByRole("combobox", {
      name: "Choose hub. Current hub: Documents",
    });
    expect(chooser).toHaveValue("documents");
    expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual([
      "Agents",
      "Workspace",
      "Documents",
      "Schedule",
      "Roadmap — unavailable",
    ]);
    expect((screen.getByRole("option", { name: "Documents" }) as HTMLOptionElement).selected).toBe(true);
  });

  it("keeps disabled Roadmap semantics in the mobile chooser", () => {
    renderWithRouter(<UnifiedHubPills active="calendar" showRoadmap roadmapDisabled />);

    const chooser = screen.getByRole("combobox", {
      name: "Choose hub. Current hub: Schedule",
    });
    const roadmap = screen.getByRole("option", { name: "Roadmap — unavailable" });

    expect(roadmap).toBeDisabled();

    fireEvent.change(chooser, { target: { value: "roadmap" } });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates from the mobile chooser", () => {
    renderWithRouter(
      <UnifiedHubPills active="agents" showRoadmap roadmapDisabled={false} />,
    );
    const chooser = screen.getByRole("combobox", {
      name: "Choose hub. Current hub: Agents",
    });

    fireEvent.change(chooser, { target: { value: "roadmap" } });

    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({ surfaceId: "workspace" as any, extra: { view: "roadmap" } }),
    );
  });

  it("uses a native, focusable select for keyboard operation", () => {
    renderWithRouter(<UnifiedHubPills active="documents" />);
    const chooser = screen.getByRole("combobox", {
      name: "Choose hub. Current hub: Documents",
    });

    expect(chooser.tagName).toBe("SELECT");
    chooser.focus();
    expect(chooser).toHaveFocus();
    expect(chooser).not.toHaveAttribute("tabindex", "-1");
  });

  it("preserves the original tab rail at sm and above", () => {
    renderWithRouter(<UnifiedHubPills active="agents" showRoadmap roadmapDisabled={false} />);

    const desktopRail = screen.getByRole("tablist", { name: "Primary hubs" });
    expect(desktopRail).toHaveClass("hidden", "sm:inline-flex");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Agents",
      "Workspace",
      "Documents",
      "Schedule",
      "Roadmap",
    ]);
  });
});
