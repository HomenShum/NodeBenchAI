/**
 * TopNav — unified top horizontal navigation scenarios.
 *
 * Scenario: Returning user navigating /redesign expects parity with cockpit
 *
 * Who:     A returning NodeBench user who has been working in the main
 *          cockpit (which has a sticky top horizontal nav: brand · 5 tabs
 *          · search · theme · profile).  They land on /redesign and
 *          expect the same affordances — without leaving the redesign's
 *          editorial token system.
 * What:    They expect to see (a) the brand mark, (b) all 5 surface tabs
 *          with the active one highlighted, (c) a search chip with the
 *          K keyboard hint, (d) a theme toggle, (e) a profile/sign-in
 *          slot.  They expect aria-current on the active tab and Alt+1..5
 *          to jump between surfaces.
 * Scale:   Single-component render.  At production scale this nav
 *          mounts on every desktop /redesign view that isn't the
 *          standalone workspace; correctness here is rendered on
 *          every page load.
 * Duration: Short-running.  No state accumulation.
 * Failure mode covered: missing tab, wrong active state, missing K
 *          shortcut chip, palette-trigger callback silently dropped.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopNav } from "./TopNav";

// The TopNav reaches into Convex auth (anonymous sign-in CTA + auth state).
// In the test environment we stub these to a deterministic guest state.
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

function renderTopNav(overrides: Partial<React.ComponentProps<typeof TopNav>> = {}) {
  const props: React.ComponentProps<typeof TopNav> = {
    active: "home",
    onChange: vi.fn(),
    onOpenPalette: vi.fn(),
    theme: "light",
    onToggleTheme: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <div data-redesign data-redesign-theme="light">
        <TopNav {...props} />
      </div>
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe("TopNav — unified top horizontal nav (Bug 2)", () => {
  it("renders all 5 primary nav items in order", () => {
    const { getByRole } = renderTopNav();
    const nav = getByRole("navigation", { name: /primary navigation/i });
    const tabs = nav.querySelectorAll("button");
    expect(tabs.length).toBe(5);
    expect(Array.from(tabs).map((b) => b.textContent?.trim())).toEqual([
      "Home",
      "Reports",
      "Chat",
      "Inbox",
      "Me",
    ]);
  });

  it("marks the active item with aria-current=page", () => {
    const { getByRole } = renderTopNav({ active: "reports" });
    const nav = getByRole("navigation", { name: /primary navigation/i });
    const current = nav.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent?.trim()).toBe("Reports");
  });

  it("exposes the K shortcut chip on the search button", () => {
    const { container } = renderTopNav();
    const searchBtn = container.querySelector(
      "[data-rd-topnav-search]",
    ) as HTMLButtonElement | null;
    expect(searchBtn).not.toBeNull();
    expect(searchBtn?.getAttribute("aria-keyshortcuts")).toMatch(/K/);
    const kbd = container.querySelector("[data-rd-topnav-kbd]");
    expect(kbd?.textContent?.trim()).toBe("K");
  });

  it("invokes onOpenPalette when the search button is clicked", () => {
    const { container, props } = renderTopNav();
    const searchBtn = container.querySelector(
      "[data-rd-topnav-search]",
    ) as HTMLButtonElement;
    fireEvent.click(searchBtn);
    expect(props.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("invokes onChange when a tab is clicked", () => {
    const { getByRole, props } = renderTopNav();
    const nav = getByRole("navigation", { name: /primary navigation/i });
    const inboxTab = Array.from(nav.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Inbox",
    );
    expect(inboxTab).toBeDefined();
    fireEvent.click(inboxTab!);
    expect(props.onChange).toHaveBeenCalledWith("inbox");
  });
});
