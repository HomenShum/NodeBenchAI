import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DelegationShowcase } from "./DelegationShowcase";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("DelegationShowcase", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReturnValue(null);
    useMutationMock.mockReturnValue(vi.fn());
  });

  it("renders the report-aligned matrix, scope token, and delegation graph", () => {
    render(<DelegationShowcase />);

    expect(screen.getByRole("heading", { name: /passport scope matrix/i })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /share_externally/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /scope token object/i })).toBeInTheDocument();
    expect(screen.getByText(/"passport_id": "pass_financial_analyst_02"/i)).toBeInTheDocument();
    expect(screen.getByText(/"approval_policy"/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /delegation graph v0/i })).toBeInTheDocument();
    expect(screen.getByText(/human supervisor/i)).toBeInTheDocument();
    expect(screen.getByText(/denied sink/i)).toBeInTheDocument();
  });
});