import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { TopNav } from "./TopNav";

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  state: { isAuthenticated: false, isLoading: false },
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: authMocks.signIn, signOut: authMocks.signOut }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => authMocks.state,
}));

describe("TopNav — single-surface header", () => {
  beforeEach(() => {
    authMocks.signIn.mockReset();
    authMocks.signOut.mockReset();
    authMocks.state.isAuthenticated = false;
    authMocks.state.isLoading = false;
  });

  it("keeps identity and utilities without advertising another product surface", () => {
    const { getByRole, getByText, queryByRole, queryByText } = render(
      <TopNav theme="light" onToggleTheme={vi.fn()} />,
    );

    expect(getByRole("banner")).toBeTruthy();
    expect(getByRole("link", { name: "NodeBench decision workspace" })).toHaveAttribute("href", "/redesign/chat");
    expect(getByText("Decision workspace")).toBeTruthy();
    expect(getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(getByRole("button", { name: "Switch to dark mode" })).toBeTruthy();
    expect(queryByRole("navigation")).toBeNull();
    expect(queryByText("Home")).toBeNull();
    expect(queryByText("Reports")).toBeNull();
    expect(queryByText("Inbox")).toBeNull();
    expect(queryByText("Me")).toBeNull();
  });

  it("keeps theme switching explicit and keyboard reachable", () => {
    const onToggleTheme = vi.fn();
    const { getByRole } = render(<TopNav theme="light" onToggleTheme={onToggleTheme} />);
    fireEvent.click(getByRole("button", { name: "Switch to dark mode" }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("labels authentication honestly", () => {
    const { getByRole } = render(<TopNav theme="light" onToggleTheme={vi.fn()} />);
    fireEvent.click(getByRole("button", { name: "Sign in" }));
    expect(authMocks.signIn).toHaveBeenCalledWith("google", expect.objectContaining({ redirectTo: expect.any(String) }));
  });

  it("gives signed-in users a keyboard-reachable account menu", () => {
    authMocks.state.isAuthenticated = true;
    const { getByRole } = render(<TopNav theme="light" onToggleTheme={vi.fn()} />);

    expect(getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-haspopup", "menu");
  });
});
