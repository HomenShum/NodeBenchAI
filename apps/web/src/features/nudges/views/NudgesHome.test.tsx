import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import { NudgesHome, buildNudgeChatQuery } from "./NudgesHome";

const useQueryMock = vi.fn();
const useConvexMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useConvex: () => useConvexMock(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        nudges: {
          getNudgesSnapshot: "product.nudges.getNudgesSnapshot",
          snoozeNudge: "product.nudges.snoozeNudge",
          completeNudge: "product.nudges.completeNudge",
        },
      },
    },
  }),
}));

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon_test",
}));

vi.mock("@/features/product/lib/useProductBootstrap", () => ({
  useProductBootstrap: () => undefined,
}));

describe("NudgesHome", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useConvexMock.mockReturnValue({ mutation: vi.fn() });
    useQueryMock.mockReset();
  });

  it("reopens report nudges into the saved entity workspace", () => {
    useQueryMock.mockReturnValue({
      nudges: [
        {
          _id: "nudge_report_1",
          type: "refresh_recommended",
          title: "Revisit Ramp",
          summary: "Open the saved report to review it.",
          actionLabel: "Open report",
          actionTargetSurface: "reports",
          actionTargetId: "ramp",
          linkedEntitySlug: "ramp",
        },
      ],
      channels: [],
      suggestedActions: ["Open report"],
    });

    render(<NudgesHome />);

    fireEvent.click(screen.getAllByRole("button", { name: /open report/i })[0]);

    expect(navigateMock).toHaveBeenCalledWith("/entity/ramp");
  });

  it("reopens chat nudges with the linked report query and lens", () => {
    const nudge = {
      _id: "nudge_chat_1",
      type: "report_changed",
      title: "Ramp moved",
      summary: "Continue the refresh in chat.",
      actionLabel: "Open in Chat",
      actionTargetSurface: "chat",
      linkedEntitySlug: "ramp",
      linkedReportQuery: "What changed recently at Ramp and why does it matter?",
      linkedReportLens: "founder",
      linkedReportTitle: "Ramp company brief",
    };

    useQueryMock.mockReturnValue({
      nudges: [nudge],
      channels: [],
      suggestedActions: ["Open in Chat"],
    });

    render(<NudgesHome />);

    fireEvent.click(screen.getAllByRole("button", { name: /open in chat/i })[0]);

    expect(navigateMock).toHaveBeenCalledWith(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: "ramp",
        extra: {
          q: buildNudgeChatQuery(nudge),
          lens: "founder",
        },
      }),
    );
  });

  it("shows grouped signal context when multiple nudges collapse into one loop", () => {
    useQueryMock.mockReturnValue({
      nudges: [
        {
          _id: "nudge_group_1",
          type: "report_changed",
          title: "Stripe changed",
          summary: "Something changed in the saved report.",
          actionLabel: "Open report",
          actionTargetSurface: "reports",
          linkedEntitySlug: "stripe",
          groupedCount: 2,
          groupedTypes: ["report_changed", "refresh_recommended"],
        },
      ],
      channels: [],
      suggestedActions: ["Open report"],
    });

    render(<NudgesHome />);

    expect(screen.getAllByText(/2 signals grouped/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/report changed, refresh recommended/i)).toBeInTheDocument();
  });

  // Scenario:  First-time user opens Nudges with nothing configured. The empty state must NOT show a
  //            feature tour ("Report changed / Reply draft ready / Reminder due"). It must show a
  //            single focused CTA that routes them to Home to start their first run.
  //            This test locks in the empty-state redesign.
  // User:      Brand-new user, 0 nudges, 0 connected tools
  // Failure modes covered: regressing to the 3-item example list; CTA wiring to the wrong surface;
  //            'Nothing urgent right now' filler re-appearing and stealing attention
  describe("empty state", () => {
    beforeEach(() => {
      useQueryMock.mockReturnValue({
        nudges: [],
        channels: [],
        suggestedActions: [],
      });
    });

  it("renders the positive Inbox empty state with primary + secondary CTAs", () => {
      render(<NudgesHome />);

      expect(screen.getAllByText(/inbox quiet/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: /you're all caught up/i }),
    ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open chat/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open saved report/i })).toBeInTheDocument();
    });

    it("does not render the legacy 3-item feature tour in the empty state", () => {
      render(<NudgesHome />);

      // The old empty state was a feature tour — regressing to it would break the invariant
      // "one nudge = one reason = one next action" in its emptiest form
      expect(screen.queryByText(/what shows up here/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/reply draft ready/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/reminder due/i)).not.toBeInTheDocument();
    });

    it("does not render 'Nothing urgent right now' filler when empty (wasted real estate)", () => {
      render(<NudgesHome />);
      expect(screen.queryByRole("heading", { name: /nothing urgent right now/i })).not.toBeInTheDocument();
    });

    it("routes the primary CTA to the Home surface (surfaceId: 'ask')", () => {
      render(<NudgesHome />);

      fireEvent.click(screen.getByRole("button", { name: /open chat/i }));
      expect(navigateMock).toHaveBeenCalledWith(buildCockpitPath({ surfaceId: "ask" }));
    });

    it("routes the secondary CTA to the Reports surface (surfaceId: 'packets')", () => {
      render(<NudgesHome />);

      fireEvent.click(screen.getByRole("button", { name: /open saved report/i }));
      expect(navigateMock).toHaveBeenCalledWith(buildCockpitPath({ surfaceId: "packets" }));
    });
  });
});
