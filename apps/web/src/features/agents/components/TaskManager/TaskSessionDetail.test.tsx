import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSessionDetail } from "./TaskSessionDetail";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

describe("TaskSessionDetail", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("renders the proof pack summary, citations, and next actions", () => {
    useQueryMock.mockImplementation((_queryRef: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (typeof args === "object" && args !== null && "sessionId" in args) {
        return {
          session: {
            _id: "session_1",
            title: "ByteDance strategy check",
            description: "Validate open-source claims with trace-backed evidence.",
            type: "agent",
            visibility: "public",
            status: "completed",
            startedAt: Date.parse("2026-03-13T18:00:00.000Z"),
            totalDurationMs: 90_000,
            totalTokens: 3200,
            toolsUsed: ["discover_tools", "get_workflow_chain"],
            agentsInvolved: ["research-agent"],
            crossCheckStatus: "aligned",
            goalId: "goal_bytedance_strategy",
            successCriteria: ["Every claim is cited."],
            sourceRefs: [{ label: "SEC filing", href: "https://example.com/sec" }],
          },
          traces: [
            {
              _id: "trace_1",
              traceId: "trace_1",
              workflowName: "Open-source verification",
              status: "completed",
              startedAt: Date.parse("2026-03-13T18:01:00.000Z"),
              totalDurationMs: 60_000,
            },
          ],
          traceCount: 1,
          proofPack: {
            verdict: "verified",
            verdictLabel: "Verified",
            summary: "Completed with cited open-source evidence and successful verification checks.",
            evidenceCount: 2,
            citationCount: 3,
            sourceRefCount: 3,
            decisionCount: 1,
            progressiveDisclosureUsed: true,
            progressiveDisclosureTools: ["discover_tools", "get_workflow_chain"],
            verificationCounts: {
              total: 2,
              passed: 2,
              warning: 0,
              failed: 0,
              fixed: 0,
            },
            approvalCounts: {
              total: 0,
              pending: 0,
            },
            keyFindings: [
              "The filing confirms customer concentration risk.",
            ],
            openIssues: [],
            nextActions: [
              "Draft the final memo or response with citations and link back to this trace.",
            ],
            topSourceRefs: [
              { label: "SEC filing", href: "https://example.com/sec" },
              { label: "Company release", href: "https://example.com/release" },
            ],
            traceHighlights: [
              {
                traceId: "trace_1",
                workflowName: "Open-source verification",
                status: "completed",
                summary: "Gathered evidence.",
              },
            ],
          },
        };
      }
      return undefined;
    });

    render(<TaskSessionDetail sessionId={"session_1" as any} />);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByText(/Confidence \d+%/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Completed with cited open-source evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Draft the final memo or response with citations/i)).toBeInTheDocument();
    expect(screen.getByText(/Progressive disclosure: discover_tools, get_workflow_chain/i)).toBeInTheDocument();
    expect(screen.getAllByText("SEC filing").length).toBeGreaterThan(0);
    expect(screen.getByText("Company release")).toBeInTheDocument();
  });
});
