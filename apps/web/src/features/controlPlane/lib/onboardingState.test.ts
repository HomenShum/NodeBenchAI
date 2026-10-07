import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS_VIEW_MODE_KEY,
  CONTROL_PLANE_CHECKLIST_KEY,
  CONTROL_PLANE_PREFERRED_PATH_KEY,
  deriveChecklistCompletionsFromRoute,
  loadAgentsViewMode,
  loadBuyerChecklistState,
  loadBuyerPreferredPath,
  mergeChecklistCompletions,
  orderByBuyerPreference,
  saveAgentsViewMode,
  saveBuyerChecklistState,
  saveBuyerPreferredPath,
} from "./onboardingState";

describe("onboardingState", () => {
  beforeEach(() => {
    localStorage.removeItem(CONTROL_PLANE_PREFERRED_PATH_KEY);
    localStorage.removeItem(CONTROL_PLANE_CHECKLIST_KEY);
    localStorage.removeItem(AGENTS_VIEW_MODE_KEY);
  });

  it("persists and reloads the buyer preferred path", () => {
    expect(loadBuyerPreferredPath()).toBeNull();
    saveBuyerPreferredPath("investigation");
    expect(loadBuyerPreferredPath()).toBe("investigation");
  });

  it("migrates the legacy research briefing preferred path", () => {
    localStorage.setItem(CONTROL_PLANE_PREFERRED_PATH_KEY, "research-briefing");

    expect(loadBuyerPreferredPath()).toBe("mcp-ledger");
    expect(localStorage.getItem(CONTROL_PLANE_PREFERRED_PATH_KEY)).toBe("mcp-ledger");
  });

  it("reorders role cards by the saved preferred path", () => {
    const ordered = orderByBuyerPreference(
      [
        { id: "a", preferredPath: "receipts" as const },
        { id: "b", preferredPath: "delegation" as const },
        { id: "c", preferredPath: "investigation" as const },
      ],
      "investigation",
    );

    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("derives checklist completion from route visits instead of clicks", () => {
    expect(
      deriveChecklistCompletionsFromRoute({
        currentView: "mcp-ledger",

        researchHubInitialTab: "overview",
      }),
    ).toEqual(["tool-activity"]);

    expect(
      deriveChecklistCompletionsFromRoute({
        currentView: "receipts",

        researchHubInitialTab: "overview",
      }),
    ).toEqual(["receipt"]);
  });

  it("merges route completions into stored checklist state", () => {
    const merged = mergeChecklistCompletions({ receipt: true }, ["delegation", "tool-activity"]);
    expect(merged).toEqual({ receipt: true, delegation: true, "tool-activity": true });
  });

  it("persists checklist dismissal and state separately", () => {
    saveBuyerChecklistState({ receipt: true });
    expect(loadBuyerChecklistState()).toEqual({ receipt: true });

    saveBuyerChecklistState("dismissed");
    expect(loadBuyerChecklistState()).toBe("dismissed");
  });

  it("migrates the legacy briefing checklist entry", () => {
    localStorage.setItem(CONTROL_PLANE_CHECKLIST_KEY, JSON.stringify({ receipt: true, brief: true }));

    expect(loadBuyerChecklistState()).toEqual({ receipt: true, "tool-activity": true });
    expect(localStorage.getItem(CONTROL_PLANE_CHECKLIST_KEY)).toBe(
      JSON.stringify({ receipt: true, "tool-activity": true }),
    );
  });

  it("persists the agents hub view mode", () => {
    expect(loadAgentsViewMode()).toBe("basic");
    saveAgentsViewMode("advanced");
    expect(loadAgentsViewMode()).toBe("advanced");
  });
});
