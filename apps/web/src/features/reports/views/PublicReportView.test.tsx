import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PublicReportView } from "./PublicReportView";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        reports: {
          getPublicReport: "product.reports.getPublicReport",
        },
      },
    },
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ to, children, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/features/reports/components/ReportReadOnlyPanel", () => ({
  ReportReadOnlyPanel: ({ report }: { report: { title?: string } }) => (
    <div>Rendered report: {report.title ?? "Untitled"}</div>
  ),
}));

describe("PublicReportView", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    window.history.replaceState({}, "", "/report/js911q05ptd2hd1abvgge5hk0s85atat");
  });

  it("loads the public report id from the standalone pathname", () => {
    useQueryMock.mockReturnValue({ title: "SoftBank" });

    render(<PublicReportView />);

    expect(useQueryMock).toHaveBeenCalledWith(
      "product.reports.getPublicReport",
      { reportId: "js911q05ptd2hd1abvgge5hk0s85atat" },
    );
    expect(screen.getByText(/rendered report: softbank/i)).toBeInTheDocument();
  });

  it("shows unavailable state when the backend returns null", () => {
    useQueryMock.mockReturnValue(null);

    render(<PublicReportView />);

    expect(screen.getByRole("heading", { name: /report unavailable/i })).toBeInTheDocument();
  });
});
