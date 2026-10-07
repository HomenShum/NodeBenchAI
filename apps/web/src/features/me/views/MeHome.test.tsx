import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

import { MeHome } from "./MeHome";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        me: {
          getMeSnapshot: "product.me.getMeSnapshot",
          generateUploadUrl: "product.me.generateUploadUrl",
          saveFile: "product.me.saveFile",
          updateProfile: "product.me.updateProfile",
          listFiles: "product.me.listFiles",
        },
        nudges: {
          getNudgesSnapshot: "product.nudges.getNudgesSnapshot",
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

describe("MeHome", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReset();

    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === "product.me.getMeSnapshot") {
        return {
          profile: {
            backgroundSummary: "Founder running product and GTM.",
            preferredLens: "founder",
            rolesOfInterest: ["Founder", "Investor"],
            preferences: {
              communicationStyle: "balanced",
              evidenceStyle: "balanced",
              avoidCorporateTone: true,
            },
          },
          savedContext: [
            { label: "Companies", value: "4" },
            { label: "Reports", value: "6" },
          ],
        };
      }
      if (query === "product.nudges.getNudgesSnapshot") {
        return {
          channels: [{ label: "Slack", status: "Connected" }],
        };
      }
      if (query === "product.me.listFiles") {
        return [];
      }
      return undefined;
    });
  });

  it("renders profile controls with stable ids and names", () => {
    const { container } = render(<MeHome />);

    const fields = [...container.querySelectorAll("input, textarea, select")];

    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => field.getAttribute("id") && field.getAttribute("name"))).toBe(true);
  });

  it("uses explicit choice controls for lens and style instead of native dropdown menus", () => {
    render(<MeHome />);

    expect(screen.getByRole("radiogroup", { name: /preferred lens/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /communication style/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("founder")).toHaveAttribute("id", "me-preferred-lens");
    expect(screen.getAllByRole("radio").some((node) => node.getAttribute("data-state") === "active")).toBe(true);
    expect(screen.queryByRole("combobox", { name: /communication style/i })).not.toBeInTheDocument();
  });

  // Scenario:  First-visit user opens the Me surface and must immediately see that this is context
  //            (leverage), not settings (chore). The page heading establishes the whole mental model.
  // User:      First-time signed-in user, or returning user checking "is my context right?"
  // Failure mode: reverting the heading to "Settings" would re-break the invariant that Me feels like
  //            leverage, not configuration. This test locks the rename in.
  it("renders the heading as 'Your context', not 'Settings'", () => {
    render(<MeHome />);
    expect(screen.getByRole("heading", { level: 1, name: /your context/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /^settings$/i })).not.toBeInTheDocument();
  });

  // Scenario:  The "How NodeBench sees you" hero must be a readable self-model sentence, not a form.
  //            The sentence must be derived from the user's current preferences so editing the lens
  //            updates the mirror. This is the feedback loop that was missing before the redesign.
  // User:      Founder persona — lens "founder", balanced style, balanced evidence, populated background
  // Failure modes covered: missing lens label, stale capitalization, missing commStyle/evidenceStyle readout
  it("renders the 'How NodeBench sees you' hero that reads the current lens, style, and evidence mode", () => {
    render(<MeHome />);

    // The hero kicker exists and is visually distinct
    expect(screen.getByText(/how nodebench sees you/i)).toBeInTheDocument();

    // Lens is capitalized and readable — not "founder", not "FOUNDER"
    const heroRegion = screen.getByText(/how nodebench sees you/i).parentElement as HTMLElement;
    expect(heroRegion).not.toBeNull();
    expect(heroRegion.textContent ?? "").toMatch(/You're a Founder/);

    // Style and evidence readouts appear and are derived from preferences snapshot
    expect(heroRegion.textContent ?? "").toMatch(/balanced style/i);
    expect(heroRegion.textContent ?? "").toMatch(/balanced evidence/i);

    // With a populated background summary, the mirror confirms it rather than prompting to add one
    expect(heroRegion.textContent ?? "").toMatch(/your background shapes every run/i);
  });

  // Scenario:  First-time user with NO background summary must see a prompt to add one, not a silent
  //            empty state. Without this nudge, the feedback loop stays broken for new users.
  // User:      Brand-new user — empty backgroundSummary, default lens
  it("nudges the user to add a background summary when the profile is empty", () => {
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === "product.me.getMeSnapshot") {
        return {
          profile: {
            backgroundSummary: "",
            preferredLens: "founder",
            rolesOfInterest: [],
            preferences: {
              communicationStyle: "balanced",
              evidenceStyle: "balanced",
              avoidCorporateTone: false,
            },
          },
          savedContext: [],
        };
      }
      if (query === "product.nudges.getNudgesSnapshot") return { channels: [] };
      if (query === "product.me.listFiles") return [];
      return undefined;
    });

    render(<MeHome />);

    const heroRegion = screen.getByText(/how nodebench sees you/i).parentElement as HTMLElement;
    expect(heroRegion.textContent ?? "").toMatch(/add a background summary/i);
  });

  // Scenario:  Saved-context zeros must not display as a dead "0 / 0 / 0 / 0" table — they must
  //            convert into an actionable nudge pointing back to Home. A dead-zeros state was the
  //            original violation this redesign fixed.
  // User:      New user with no saved context
  it("renders a guided CTA when saved context is empty instead of showing dead zeros", () => {
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === "product.me.getMeSnapshot") {
        return {
          profile: {
            backgroundSummary: "",
            preferredLens: "founder",
            rolesOfInterest: [],
            preferences: { communicationStyle: "balanced", evidenceStyle: "balanced" },
          },
          savedContext: [],
        };
      }
      if (query === "product.nudges.getNudgesSnapshot") return { channels: [] };
      if (query === "product.me.listFiles") return [];
      return undefined;
    });

    render(<MeHome />);

    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();

    const goChatButton = screen.getByRole("button", { name: /go to chat/i });
    fireEvent.click(goChatButton);
    expect(navigateMock).toHaveBeenCalledWith(buildCockpitPath({ surfaceId: "ask" }));
  });
});
