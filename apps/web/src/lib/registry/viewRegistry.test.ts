import { describe, expect, it } from "vitest";

import { buildCockpitPath, buildCockpitPathForView, resolvePathToCockpitState, resolvePathToView } from "./viewRegistry";

describe("resolvePathToView", () => {
  it("resolves the world monitor research route as its own view", () => {
    expect(resolvePathToView("/research/world-monitor")).toMatchObject({
      view: "world-monitor",
      researchTab: "overview",
    });
  });

  it("resolves the watchlists research route as its own view", () => {
    expect(resolvePathToView("/research/watchlists")).toMatchObject({
      view: "watchlists",
      researchTab: "overview",
    });
  });

  it("keeps research tabs routed to the research hub", () => {
    expect(resolvePathToView("/research/signals")).toMatchObject({
      view: "research",
      researchTab: "signals",
    });
  });

  it("resolves the MCP ledger direct route instead of falling back to ask", () => {
    expect(resolvePathToView("/mcp/ledger")).toMatchObject({
      view: "mcp-ledger",
      researchTab: "overview",
      isUnknownRoute: false,
    });
  });

  it("maps the MCP ledger direct route to the trace surface", () => {
    expect(resolvePathToCockpitState("/mcp/ledger")).toMatchObject({
      surfaceId: "trace",
      view: "mcp-ledger",
      isUnknownRoute: false,
    });
  });

  it("canonicalizes legacy MCP ledger aliases to the live audit route", () => {
    for (const path of ["/mcp-ledger", "/internal/mcp-ledger", "/activity-log"]) {
      expect(resolvePathToCockpitState(path)).toMatchObject({
        surfaceId: "trace",
        view: "mcp-ledger",
        canonicalPath: "/mcp/ledger",
        isLegacyRedirect: true,
        isUnknownRoute: false,
      });
    }
  });

  it("emits clean public surface params for product routes", () => {
    expect(buildCockpitPath({ surfaceId: "ask" })).toBe("/?surface=home");
    expect(buildCockpitPath({ surfaceId: "workspace" })).toBe("/?surface=chat");
    expect(buildCockpitPath({ surfaceId: "packets" })).toBe("/?surface=reports");
  });

  it("accepts legacy and canonical public surface params", () => {
    expect(resolvePathToCockpitState("/", "?surface=ask")).toMatchObject({
      surfaceId: "ask",
      canonicalPath: "/?surface=home",
    });
    expect(resolvePathToCockpitState("/", "?surface=home")).toMatchObject({
      surfaceId: "ask",
      canonicalPath: "/?surface=home",
    });
    expect(resolvePathToCockpitState("/", "?surface=chat")).toMatchObject({
      surfaceId: "workspace",
      canonicalPath: "/?surface=chat",
    });
  });

  it("defaults bare mobile root routes to Home (5-tab lock)", () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: (query: string) => ({
          matches: query === "(max-width: 1279px)",
        }),
      },
    });

    try {
      // Post 5-tab lock: mobile lands on Home (ask surface) which renders
      // MobileHomeSurface. Previously this defaulted to chat, which
      // bypassed the canonical mobile Home surface.
      expect(resolvePathToCockpitState("/", "")).toMatchObject({
        surfaceId: "ask",
        canonicalPath: "/?surface=home",
        isLegacyRedirect: true,
      });
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it("keeps entity routes canonical on direct slug paths", () => {
    expect(buildCockpitPathForView({ view: "entity", entity: "ditto-ai" })).toBe("/entity/ditto-ai");
    expect(resolvePathToCockpitState("/entity/ditto-ai")).toMatchObject({
      surfaceId: "packets",
      view: "entity",
      entityName: "ditto-ai",
      canonicalPath: "/entity/ditto-ai",
      isLegacyRedirect: false,
    });
  });

  it("preserves entity read mode in the canonical path", () => {
    expect(resolvePathToCockpitState("/entity/ditto-ai", "?view=read")).toMatchObject({
      canonicalPath: "/entity/ditto-ai?view=read",
      isLegacyRedirect: false,
    });
  });

  it("preserves research tab routes in the canonical path", () => {
    expect(resolvePathToCockpitState("/research/signals")).toMatchObject({
      canonicalPath: "/research/signals",
      researchTab: "signals",
      isLegacyRedirect: false,
    });
  });

  it("keeps canonical entity pulse routes on direct slug paths", () => {
    expect(buildCockpitPathForView({ view: "entity-pulse", entity: "ditto-ai" })).toBe(
      "/entity/ditto-ai/pulse",
    );
    expect(resolvePathToView("/entity/ditto-ai/pulse")).toMatchObject({
      view: "entity-pulse",
      entityName: "ditto-ai",
    });
    expect(resolvePathToView("/entity/ditto-ai/pulse/2026-04-20")).toMatchObject({
      view: "entity-pulse",
      entityName: "ditto-ai",
    });
  });

});
