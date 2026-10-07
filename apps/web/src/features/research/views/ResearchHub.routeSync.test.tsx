import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => null),
  useQuery: () => null,
}));

vi.mock("@/features/agents/context/FastAgentContext", () => ({
  useFastAgent: () => ({ openWithContext: vi.fn() }),
}));

vi.mock("@/features/research/contexts/EvidenceContext", () => ({
  EvidenceProvider: ({ children }: { children: React.ReactNode }) => children,
  useEvidence: () => ({ registerEvidence: vi.fn() }),
}));

vi.mock("@/features/research/hooks/usePersonalBrief", () => ({
  usePersonalBrief: () => ({
    executiveBrief: { summary: "Summary" },
    sourceSummary: null,
    dashboardMetrics: null,
    evidence: [],
    deltas: [],
    briefMemory: { _id: "brief-1" },
    personalizedContext: null,
    tasksToday: [],
    recentDocs: [],
    taskResults: [],
    availableDates: [],
    briefingDateString: "2026-03-19",
    isLoading: false,
  }),
}));

vi.mock("@/features/research/sections/DigestSection", () => ({
  DigestSection: () => <div>digest-section</div>,
}));
vi.mock("@/features/research/components/PersonalPulse", () => ({
  PersonalPulse: () => <div>personal-pulse</div>,
}));
vi.mock("@/features/research/sections/DashboardSection", () => ({
  DashboardSection: () => <div>dashboard-section</div>,
}));
vi.mock("@/features/research/components/ActAwareDashboard", () => ({
  ActAwareDashboard: () => <div>act-aware-dashboard</div>,
}));
vi.mock("@/features/research/sections/BriefingSection", () => ({
  BriefingSection: () => <div>briefing-section</div>,
}));
vi.mock("@/features/research/sections/FeedSection", () => ({
  FeedSection: () => <div>feed-section</div>,
}));
vi.mock("@/features/research/components/ForecastCockpit", () => ({
  default: () => <div>forecast-cockpit</div>,
}));
vi.mock("@/features/research/components/IntelPulseMonitor", () => ({
  IntelPulseMonitor: () => <div>intel-pulse-monitor</div>,
}));
vi.mock("@/components/NotificationActivityPanel", () => ({
  NotificationActivityPanel: () => <div>notification-activity</div>,
}));
vi.mock("@/features/research/components/FeedReaderModal", () => ({
  FeedReaderModal: () => null,
  default: () => null,
}));
vi.mock("@/features/research/components/EntityContextDrawer", () => ({
  EntityContextDrawer: () => null,
  default: () => null,
}));
vi.mock("@/features/research/components/TimelineStrip", () => ({
  TimelineStrip: () => <div>timeline-strip</div>,
}));
vi.mock("@/shared/ui", () => ({
  SurfacePageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import ResearchHub from "./ResearchHub";

describe("ResearchHub route sync", () => {
  it("updates the active tab when initialTab changes on a mounted research surface", async () => {
    const { rerender } = render(<ResearchHub embedded initialTab="overview" />);

    expect(screen.queryByText("briefing-section")).toBeNull();

    rerender(<ResearchHub embedded initialTab="briefing" />);

    await waitFor(() => {
      expect(screen.getByText("briefing-section")).toBeTruthy();
    });
  });
});
