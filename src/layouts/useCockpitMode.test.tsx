import { MemoryRouter } from "react-router-dom";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setCurrentView = vi.fn();
let mockCurrentView: "mcp-ledger" | "research" | "control-plane" = "mcp-ledger";

vi.mock("../hooks/useCockpitRouting", () => ({
  useCockpitRouting: () => ({
    currentView: mockCurrentView,
    setCurrentView,
    entityName: null,
    setEntityName: vi.fn(),
    selectedSpreadsheetId: null,
    setSelectedSpreadsheetId: vi.fn(),
    researchHubInitialTab: "overview",
    setResearchHubInitialTab: vi.fn(),
    isTransitioning: false,
    setIsTransitioning: vi.fn(),
  }),
}));

import { useCockpitMode } from "./useCockpitMode";
import { ALL_VIEW_IDS } from "@/lib/registry/viewRegistry";
import { MODES } from "./cockpitModes";

describe("useCockpitMode", () => {
  beforeEach(() => {
    setCurrentView.mockReset();
    mockCurrentView = "mcp-ledger";
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not restore a saved cockpit mode over an explicit trace deep link", () => {
    window.localStorage.setItem("nodebench-cockpit-mode", "mission");

    renderHook(() => useCockpitMode(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={["/mcp/ledger"]}>{children}</MemoryRouter>,
    });

    expect(setCurrentView).not.toHaveBeenCalled();
  });

  it("does not restore a saved cockpit mode over the clean home route", () => {
    mockCurrentView = "control-plane";
    window.localStorage.setItem("nodebench-cockpit-mode", "system");

    renderHook(() => useCockpitMode(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>,
    });

    expect(setCurrentView).not.toHaveBeenCalled();
  });

  it("maps every registered view to exactly one cockpit mode", () => {
    const mappedViews = MODES.flatMap((mode) => mode.views);
    expect(new Set(mappedViews).size).toBe(mappedViews.length);
    expect([...mappedViews].sort()).toEqual([...ALL_VIEW_IDS].sort());
  });
});
