import { describe, expect, it } from "vitest";
import { buildViewBreadcrumbs } from "./viewBreadcrumbs";

describe("buildViewBreadcrumbs", () => {
  it("returns no breadcrumbs for the control-plane landing", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "control-plane",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([]);
  });

  it("builds parent breadcrumbs for nested views", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "receipts",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([
      {
        id: "control-plane",
        isCurrent: false,
        label: "Home",
        path: "/",
        view: "control-plane",
      },
      {
        id: "receipts",
        isCurrent: true,
        label: "Agent Actions",
        path: "/receipts",
        view: "receipts",
      },
    ]);
  });

  it("builds research breadcrumbs for the product direction memo", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "product-direction",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([
      {
        id: "research",
        isCurrent: false,
        label: "Research Hub",
        path: "/research",
        view: "research",
      },
      {
        id: "product-direction",
        isCurrent: true,
        label: "Product Direction",
        path: "/product-direction",
        view: "product-direction",
      },
    ]);
  });

  it("builds control-plane breadcrumbs for execution trace", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "execution-trace",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([
      {
        id: "control-plane",
        isCurrent: false,
        label: "Home",
        path: "/",
        view: "control-plane",
      },
      {
        id: "execution-trace",
        isCurrent: true,
        label: "Execution Trace",
        path: "/execution-trace",
        view: "execution-trace",
      },
    ]);
  });

  it("builds research breadcrumbs for world monitor", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "world-monitor",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([
      {
        id: "research",
        isCurrent: false,
        label: "Research Hub",
        path: "/research",
        view: "research",
      },
      {
        id: "world-monitor",
        isCurrent: true,
        label: "World Monitor",
        path: "/research/world-monitor",
        view: "world-monitor",
      },
    ]);
  });

  it("builds research breadcrumbs for watchlists", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "watchlists",
        researchHubInitialTab: "overview",

      }),
    ).toEqual([
      {
        id: "research",
        isCurrent: false,
        label: "Research Hub",
        path: "/research",
        view: "research",
      },
      {
        id: "watchlists",
        isCurrent: true,
        label: "Watchlists",
        path: "/research/watchlists",
        view: "watchlists",
      },
    ]);
  });

  it("builds research tab breadcrumbs when the dossier shell is open", () => {
    expect(
      buildViewBreadcrumbs({
        currentView: "research",
        researchHubInitialTab: "briefing",

      }),
    ).toEqual([
      {
        id: "research",
        isCurrent: false,
        label: "Research Hub",
        path: "/research",
        view: "research",
      },
      {
        id: "research-briefing",
        isCurrent: true,
        label: "Briefing",
        path: "/research/briefing",
      },
    ]);
  });
});
