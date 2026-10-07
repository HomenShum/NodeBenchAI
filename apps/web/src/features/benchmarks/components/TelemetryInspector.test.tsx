import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TelemetryInspector } from "./TelemetryInspector";
import { generateTelemetryInspectorMockRuns } from "../data/telemetryInspectorMockData";
import { useTelemetryInspectorStore } from "../store/useTelemetryInspectorStore";

function renderInspector() {
  return render(
    <MemoryRouter>
      <TelemetryInspector />
    </MemoryRouter>,
  );
}

describe("TelemetryInspector", () => {
  beforeEach(() => {
    useTelemetryInspectorStore.setState({
      selectedRunId: null,
      selectedStepId: null,
      activeTab: "trace",
      searchQuery: "",
      statusFilter: "all",
      feedbackOpen: false,
      feedbackDraft: "",
    });
  });

  it("renders runs and selects the first run by default", () => {
    renderInspector();

    expect(screen.getByText("Telemetry & Evidence Chain Inspector")).toBeInTheDocument();
    expect(screen.getAllByText("Payment timeout enterprise investigation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trace Details").length).toBeGreaterThan(0);
  });

  it("filters runs by search query", async () => {
    renderInspector();

    fireEvent.change(screen.getByPlaceholderText("Search runs, datasets, or goals"), {
      target: { value: "XZ backdoor" },
    });

    await waitFor(() => {
      expect(screen.getAllByText("XZ backdoor trust-shift diagnosis").length).toBeGreaterThan(0);
      expect(screen.queryAllByText("Payment timeout enterprise investigation")).toHaveLength(0);
    });
  });

  it("opens the feedback modal", () => {
    renderInspector();

    fireEvent.click(screen.getAllByText("Report UI issue")[0]);

    expect(screen.getByText("What broke or felt off?")).toBeInTheDocument();
  });
});

describe("telemetry inspector mock data", () => {
  it("includes evidence and mixed statuses for QA coverage", () => {
    const runs = generateTelemetryInspectorMockRuns(Date.UTC(2026, 2, 9, 12, 0, 0));

    expect(runs.length).toBeGreaterThanOrEqual(4);
    expect(runs.some((run) => run.status === "error")).toBe(true);
    expect(runs.some((run) => run.status === "running")).toBe(true);
    expect(runs.every((run) => run.evidenceFrames.length >= run.steps.length)).toBe(true);
  });
});
