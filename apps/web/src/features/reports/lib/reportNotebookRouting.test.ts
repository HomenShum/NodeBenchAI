import { describe, expect, it } from "vitest";

import {
  buildReportNotebookPath,
  getReportNotebookIdFromPath,
  getReportWorkspaceRouteFromPath,
} from "./reportNotebookRouting";

describe("reportNotebookRouting", () => {
  it("builds the lightweight web notebook path under Reports", () => {
    expect(buildReportNotebookPath("orbital-labs")).toBe("/reports/orbital-labs/notebook");
    expect(buildReportNotebookPath("demo day")).toBe("/reports/demo%20day/notebook");
  });

  it("parses report ids from the lightweight web notebook route", () => {
    expect(getReportNotebookIdFromPath("/reports/orbital-labs/notebook")).toBe("orbital-labs");
    expect(getReportNotebookIdFromPath("/reports/demo%20day/notebook/")).toBe("demo day");
    expect(getReportNotebookIdFromPath("/reports/orbital-labs/graph")).toBeNull();
  });

  it("parses report workspace routes without stealing the reports index", () => {
    expect(getReportWorkspaceRouteFromPath("/reports")).toBeNull();
    expect(getReportWorkspaceRouteFromPath("/reports/orbital-labs")).toEqual({
      reportId: "orbital-labs",
      tab: "brief",
    });
    expect(getReportWorkspaceRouteFromPath("/reports/orbital-labs/cards")).toEqual({
      reportId: "orbital-labs",
      tab: "cards",
    });
    expect(getReportWorkspaceRouteFromPath("/reports/orbital-labs/sources")).toEqual({
      reportId: "orbital-labs",
      tab: "sources",
    });
    expect(getReportWorkspaceRouteFromPath("/reports/orbital-labs/graph")).toEqual({
      reportId: "orbital-labs",
      tab: "map",
    });
    expect(getReportWorkspaceRouteFromPath("/reports/orbital-labs/notebook")).toBeNull();
  });
});
