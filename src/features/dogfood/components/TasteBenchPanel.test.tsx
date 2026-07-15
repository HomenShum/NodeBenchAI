import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TasteBenchPanelView,
  type TasteBenchDashboard,
  type TasteBenchPanelViewProps,
} from "./TasteBenchPanel";

const EMPTY_DASHBOARD: TasteBenchDashboard = {
  activeRun: null,
  latestCompleted: null,
  metrics: {
    runCount: 0,
    completedRunCount: 0,
    completionRate: null,
    medianDecisionMs: null,
    manualCorrectionCount: null,
    operationChangedCount: null,
    operationUndoneCount: null,
    approvalInterruptionCount: null,
    proposalInvalidCount: null,
    proposalRetryCount: null,
    artifactReuseCount: null,
    timeToFirstReviewableMs: null,
  },
};

function makeProps(
  overrides: Partial<TasteBenchPanelViewProps> = {},
): TasteBenchPanelViewProps {
  return {
    eligibility: { eligibleCount: 0, requiredCount: 2, ready: false },
    dashboard: EMPTY_DASHBOARD,
    selectedScenarioId: "app-02-pre-delegation-packet",
    onScenarioChange: vi.fn(),
    onStart: vi.fn(),
    onSubmit: vi.fn(),
    onAbandon: vi.fn(),
    onRecordCorrection: vi.fn(),
    ...overrides,
  };
}

describe("TasteBenchPanelView", () => {
  it("fails closed when two real, scenario-matched evidence packs do not exist", () => {
    render(<TasteBenchPanelView {...makeProps()} />);

    expect(
      screen.getByRole("heading", { name: "TasteBench" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tastebench-empty")).toHaveTextContent("0 of 2");
    expect(
      screen.getByText(/stays empty instead of substituting fixtures/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tastebench-scenario:app-02-pre-delegation-packet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start blind comparison/i }),
    ).toBeDisabled();
    expect(
      screen.queryByLabelText(/artifact a evidence/i),
    ).not.toBeInTheDocument();
  });

  it("renders a role-blind evidence review and requires a reason plus rubric dimension", () => {
    const onSubmit = vi.fn();
    render(
      <TasteBenchPanelView
        {...makeProps({
          eligibility: { eligibleCount: 2, requiredCount: 2, ready: true },
          onSubmit,
          dashboard: {
            ...EMPTY_DASHBOARD,
            activeRun: {
              runId: "run-1",
              scenarioId: "app-02-pre-delegation-packet",
              catalogVersion: "tastebench-v1",
              createdAt: 1,
              blindness: {
                level: "role_only",
                disclosure:
                  "A/B roles are withheld. Artifact content is not anonymized.",
              },
              slotA: {
                slotHandle: "a",
                summary: "Packet A summary",
                issues: [],
                evidenceUrl: "https://evidence.example/a.mp4",
              },
              slotB: {
                slotHandle: "b",
                summary: "Packet B summary",
                issues: [],
                evidenceUrl: "https://evidence.example/b.mp4",
              },
            },
          },
        })}
      />,
    );

    expect(screen.getByText(/role-blind comparison/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Artifact A evidence")).toHaveAttribute(
      "src",
      "https://evidence.example/a.mp4",
    );
    expect(screen.getByLabelText("Artifact B evidence")).toHaveAttribute(
      "src",
      "https://evidence.example/b.mp4",
    );
    expect(screen.getAllByText("Role withheld")).toHaveLength(2);
    expect(screen.getByTestId("tastebench-role-a")).toHaveTextContent(
      "Role withheld",
    );
    expect(screen.getByTestId("tastebench-role-b")).toHaveTextContent(
      "Role withheld",
    );
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
    expect(screen.queryByText("Candidate")).not.toBeInTheDocument();

    const preferA = screen.getByRole("button", { name: "Prefer A" });
    expect(preferA).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Trust" }));
    fireEvent.change(screen.getByLabelText("Why?"), {
      target: {
        value:
          "Artifact A makes the evidence chain materially easier to verify.",
      },
    });
    expect(preferA).toBeEnabled();
    fireEvent.click(preferA);

    expect(onSubmit).toHaveBeenCalledWith({
      runId: "run-1",
      presentedChoice: "a",
      reason:
        "Artifact A makes the evidence chain materially easier to verify.",
      dimensions: ["trust"],
    });
  });

  it("starts only a server-selected pair and never asks the browser for source artifact IDs", () => {
    const onStart = vi.fn();
    render(
      <TasteBenchPanelView
        {...makeProps({
          eligibility: { eligibleCount: 3, requiredCount: 2, ready: true },
          onStart,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /start blind comparison/i }),
    );
    expect(onStart).toHaveBeenCalledWith("app-02-pre-delegation-packet");
    expect(screen.queryByText(/artifact id/i)).not.toBeInTheDocument();
  });

  it("shows both completed artifacts before recording and clears saved correction input", async () => {
    const onRecordCorrection = vi.fn().mockResolvedValue(undefined);
    render(
      <TasteBenchPanelView
        {...makeProps({
          onRecordCorrection,
          dashboard: {
            ...EMPTY_DASHBOARD,
            latestCompleted: {
              runId: "run-completed",
              scenarioId: "app-02-pre-delegation-packet",
              catalogVersion: "tastebench-v1",
              createdAt: 1,
              blindness: {
                level: "role_only",
                disclosure: "Roles withheld.",
              },
              roleReveal: {
                slotA: "baseline",
                slotB: "candidate",
                disclosure:
                  "Roles are revealed only after the human judgment is persisted.",
              },
              slotA: {
                slotHandle: "a",
                summary: "Completed artifact A",
                issues: [],
                evidenceUrl: "https://evidence.example/completed-a.mp4",
              },
              slotB: {
                slotHandle: "b",
                summary: "Completed artifact B",
                issues: [],
                evidenceUrl: "https://evidence.example/completed-b.mp4",
              },
              decision: {
                choice: "candidate",
                reason: "The selected artifact is clearer for the intended audience.",
                dimensions: ["narrative"],
                createdAt: 2,
              },
            },
          },
        })}
      />,
    );

    fireEvent.click(
      screen.getByText("Record an observed before/after correction"),
    );
    expect(screen.getByText("Completed artifact A")).toBeInTheDocument();
    expect(screen.getByText("Completed artifact B")).toBeInTheDocument();
    expect(screen.getByTestId("tastebench-role-a")).toHaveTextContent("Baseline");
    expect(screen.getByTestId("tastebench-role-b")).toHaveTextContent("Candidate");
    expect(screen.queryByText("Role withheld")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Direction")).toHaveDisplayValue(
      "Baseline → Candidate",
    );

    fireEvent.click(screen.getByRole("button", { name: "Trust" }));
    const note = screen.getByLabelText("What changed?");
    fireEvent.change(note, {
      target: {
        value: "The after artifact makes the evidence relationship easier to verify.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction evidence" }));

    await waitFor(() => expect(onRecordCorrection).toHaveBeenCalledOnce());
    await waitFor(() => expect(note).toHaveValue(""));
  });
});
