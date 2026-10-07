import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutonomousOperationsPanel,
  getOperationsSummary,
} from "./AutonomousOperationsPanel";

const useActionMock = vi.fn();
const useConvexAuthMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useConvexAuth: () => useConvexAuthMock(),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

const cronStatuses = [
  {
    component: "healthMonitor",
    displayName: "Health Monitor",
    measurementIntervalMinutes: 5,
    status: "healthy",
    lastRun: Date.parse("2026-07-15T12:00:00.000Z"),
    latencyP50: 42,
    latencyP99: 80,
    errorRate: 0,
    queueDepth: 0,
    isHealthy: true,
    isStale: false,
  },
];

function makeControlTower(attentionItems: Array<{ severity: "critical" | "warning" | "info"; title: string; detail: string }> = []) {
  return {
    generatedAt: Date.parse("2026-07-15T12:00:00.000Z"),
    health: {
      overall: "healthy",
      latestCheckAt: Date.parse("2026-07-15T12:00:00.000Z"),
      activeAlertCount: 0,
      unhealthyComponents: [],
      degradedComponents: [],
      staleComponents: [],
    },
    healing: {
      attempted24h: 0,
      succeeded24h: 0,
      failed24h: 0,
      escalated24h: 0,
      successRate24h: 0,
      recentActions: [],
    },
    maintenance: {
      lastRunAt: null,
      passed: false,
      workflowId: null,
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
      hotspotSync: null,
      autoInvestigate: null,
    },
    loops: {
      intentHotspots: { total: 0, byColumn: {} },
      bugCards: { total: 0, byColumn: {} },
    },
    attentionItems,
  };
}

function mockRuntimeQueries(
  crons: unknown,
  controlTower: unknown,
  adminAccess: unknown = { hasAccess: true, role: "owner" },
) {
  let callIndex = 0;
  useQueryMock.mockImplementation(() => {
    const results = [adminAccess, crons, controlTower];
    const result = results[callIndex % 3];
    callIndex += 1;
    return result;
  });
}

describe("getOperationsSummary", () => {
  it("keeps unhealthy runtime state ahead of attention-card counts", () => {
    const controlTower = makeControlTower([
      { severity: "warning", title: "Queue delay", detail: "Delayed" },
    ]);
    controlTower.health.overall = "unhealthy";

    expect(getOperationsSummary(cronStatuses as never, controlTower as never)).toMatchObject({
      label: "Unhealthy",
      className: expect.stringContaining("red"),
    });
  });

  it("never calls a stale measured component healthy", () => {
    expect(
      getOperationsSummary(
        [{ ...cronStatuses[0], isHealthy: false, isStale: true }] as never,
        makeControlTower() as never,
      ),
    ).toMatchObject({
      label: "Degraded",
    });
  });
});

describe("AutonomousOperationsPanel", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useActionMock.mockReset();
    useActionMock.mockReturnValue(vi.fn().mockResolvedValue({ ok: true }));
    useConvexAuthMock.mockReset();
    useConvexAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    useQueryMock.mockReset();
  });

  it("stays collapsed and makes no metric claim while runtime data is loading", () => {
    mockRuntimeQueries(undefined, undefined);

    render(<AutonomousOperationsPanel />);

    const disclosure = screen.getByRole("button", { name: /Autonomous Operations/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Loading status")).toBeInTheDocument();
    expect(screen.queryByText(/0\/0 healthy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/System health/i)).not.toBeInTheDocument();
  });

  it("reveals only runtime-backed attention and operational facts", () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: true });
    mockRuntimeQueries(
      cronStatuses,
      makeControlTower([
          {
            severity: "warning",
            title: "Research queue is delayed",
            detail: "The latest health check exceeded its interval.",
          },
        ]),
    );

    render(<AutonomousOperationsPanel />);

    expect(screen.getByText("Attention needed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Autonomous Operations/i }));

    expect(screen.getByText("Research queue is delayed")).toBeInTheDocument();
    expect(screen.getByText("System health")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run maintenance" })).toBeInTheDocument();
    expect(screen.getByText(/Self-healing: no attempts in 24h/i)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0%/i)).not.toBeInTheDocument();
  });

  it("does not expose global operation data to a signed-out visitor", () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    useQueryMock.mockReturnValue(undefined);

    render(<AutonomousOperationsPanel />);

    expect(screen.queryByRole("button", { name: /Autonomous Operations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run maintenance/i })).not.toBeInTheDocument();
  });

  it("allows a viewer to inspect facts without exposing the write control", () => {
    mockRuntimeQueries(cronStatuses, makeControlTower(), {
      hasAccess: true,
      role: "viewer",
    });

    render(<AutonomousOperationsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Autonomous Operations/i }));

    expect(screen.getByText("System health")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run maintenance/i })).not.toBeInTheDocument();
  });

  it("reports a resolved maintenance run with failed gates as needing review", async () => {
    const run = vi.fn().mockResolvedValue({ maintenance: { passed: false } });
    useActionMock.mockReturnValue(run);
    mockRuntimeQueries(cronStatuses, makeControlTower());

    render(<AutonomousOperationsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Autonomous Operations/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run maintenance" }));

    expect(
      await screen.findByText(/Maintenance ran, but one or more gates need review/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/all maintenance gates passed/i)).not.toBeInTheDocument();
  });
});
