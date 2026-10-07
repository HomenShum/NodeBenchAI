import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// ---------- Hoisted mock state (mutable per test) ----------
const mocks = vi.hoisted(() => ({
  ownReport: {
    _id: "j5xxxxxxxxxxxxxxxxxxxxxx", // 25 chars, matches /^[a-z0-9]{20,}$/i
    title: "Test report",
    summary: "Mock summary",
    sections: [{ id: "s1", title: "Sec", body: "Body" }],
    sources: [],
    notebookHtml: "",
    updatedAt: 1_700_000_000_000,
  } as any,
  publicReport: null as any,
  workspaceSnapshot: null as any,
  saveCalls: [] as Array<{
    args: any;
    resolve: (v?: any) => void;
    reject: (e?: any) => void;
  }>,
  saveBehavior: "resolve" as "resolve" | "reject" | "manual",
  reportId: "j5xxxxxxxxxxxxxxxxxxxxxx",
}));

// Stub convex/react so the hooks resolve without real ConvexProvider.
vi.mock("convex/react", () => {
  return {
    useQuery: (queryRef: any) => {
      const name = String(queryRef ?? "");
      if (name.includes("getReport")) return mocks.ownReport;
      if (name.includes("getPublicReport")) return mocks.publicReport;
      if (name.includes("getSnapshot")) return mocks.workspaceSnapshot;
      return undefined;
    },
    useConvex: () => ({
      mutation: (_ref: any, args: any) => {
        if (mocks.saveBehavior === "resolve") {
          mocks.saveCalls.push({ args, resolve: () => {}, reject: () => {} });
          return Promise.resolve({ ok: true });
        }
        if (mocks.saveBehavior === "reject") {
          mocks.saveCalls.push({ args, resolve: () => {}, reject: () => {} });
          return Promise.reject(new Error("simulated network failure"));
        }
        // manual — caller resolves/rejects via the captured handle.
        return new Promise((resolve, reject) => {
          mocks.saveCalls.push({ args, resolve, reject });
        });
      },
    }),
  };
});

// Make api.domains.product.reports.* / eventWorkspace.getSnapshot reachable.
vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        reports: {
          getReport: "ref:getReport",
          getPublicReport: "ref:getPublicReport",
          saveReportNotebookHtml: "ref:saveReportNotebookHtml",
        },
        eventWorkspace: { getSnapshot: "ref:getSnapshot" },
      },
    },
  }),
}));

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon-test-session",
}));

// Path → reportId helper used by the component.
vi.mock("@/features/reports/lib/reportNotebookRouting", () => ({
  getReportNotebookIdFromPath: (path: string) => {
    const match = path.match(/\/reports\/([^/]+)\/notebook/);
    return match ? decodeURIComponent(match[1]) : null;
  },
}));

// Avoid hitting the workspace URL builder logic.
vi.mock("@/features/workspace/lib/workspaceRouting", () => ({
  buildWorkspaceUrl: ({ workspaceId, tab }: { workspaceId: string; tab: string }) =>
    `https://workspace.test/w/${workspaceId}?tab=${tab}`,
}));

import { ReportNotebookDetail } from "./ReportNotebookDetail";

function renderAt(reportId: string) {
  return render(
    <MemoryRouter initialEntries={[`/reports/${reportId}/notebook`]}>
      <ReportNotebookDetail />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.saveCalls.length = 0;
  mocks.saveBehavior = "resolve";
  mocks.publicReport = null;
  mocks.workspaceSnapshot = null;
  mocks.ownReport = {
    _id: mocks.reportId,
    title: "Test report",
    summary: "Mock summary",
    sections: [{ id: "s1", title: "Sec", body: "Body" }],
    sources: [],
    notebookHtml: "",
    updatedAt: 1_700_000_000_000,
  };
});

afterEach(() => {
  cleanup();
});

describe("ReportNotebookDetail — Convex persistence round-trip", () => {
  it("Scenario: typing in the editor triggers a debounced saveReportNotebookHtml call (1.2s)", async () => {
    const user = userEvent.setup();
    renderAt(mocks.reportId);

    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();
    await user.keyboard(" round-trip-marker");

    // Mutation should fire after the 1.2s debounce.
    await waitFor(
      () => {
        expect(mocks.saveCalls.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000 },
    );

    const last = mocks.saveCalls.at(-1)!;
    expect(last.args.reportId).toBe(mocks.reportId);
    expect(last.args.notebookHtml).toContain("round-trip-marker");
    expect(last.args.anonymousSessionId).toBe("anon-test-session");

    // Footer reflects the synced state.
    await waitFor(() => {
      const footer = document.body.textContent ?? "";
      expect(footer).toMatch(/synced to convex/i);
    });
  });

  it("Scenario: rapid typing collapses to a single save call (debounce semantics)", async () => {
    const user = userEvent.setup();
    renderAt(mocks.reportId);

    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();

    for (let i = 0; i < 5; i++) {
      await user.keyboard(` t${i}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120));
      });
    }

    await waitFor(
      () => {
        expect(mocks.saveCalls.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000 },
    );
    // Debounce of 1.2s on bursts of 120ms keystrokes ≈ 1 save.
    expect(mocks.saveCalls.length).toBeLessThanOrEqual(2);
  });

  it("Scenario: server rejects the save — UI footer shows 'save failed', no infinite retry loop", async () => {
    mocks.saveBehavior = "reject";
    const user = userEvent.setup();
    renderAt(mocks.reportId);

    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();
    await user.keyboard(" boom");

    await waitFor(
      () => {
        expect(mocks.saveCalls.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect((document.body.textContent ?? "").toLowerCase()).toMatch(
        /save failed/,
      );
    });

    // Wait an extra beat to confirm we don't auto-retry without new input.
    const before = mocks.saveCalls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(mocks.saveCalls.length).toBe(before);
  });

  it("Scenario: error then user keeps typing → next debounce window retries save", async () => {
    mocks.saveBehavior = "reject";
    const user = userEvent.setup();
    renderAt(mocks.reportId);

    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();
    await user.keyboard(" first");
    await waitFor(
      () => expect(mocks.saveCalls.length).toBeGreaterThanOrEqual(1),
      { timeout: 5000 },
    );
    const after1 = mocks.saveCalls.length;

    // Switch to success and keep typing.
    mocks.saveBehavior = "resolve";
    await user.keyboard(" second");
    await waitFor(() => expect(mocks.saveCalls.length).toBeGreaterThan(after1), {
      timeout: 5000,
    });

    await waitFor(() => {
      expect((document.body.textContent ?? "").toLowerCase()).toMatch(
        /synced to convex/,
      );
    });
  });

  it("Scenario: public-shared report (ownReport=null, publicReport set) — read-only, no save calls", async () => {
    mocks.ownReport = null;
    mocks.publicReport = {
      _id: mocks.reportId,
      title: "Public",
      summary: "Public summary",
      sections: [{ id: "p", title: "P", body: "B" }],
      sources: [],
      notebookHtml: "",
      updatedAt: 1_700_000_000_000,
    };
    const user = userEvent.setup();
    renderAt(mocks.reportId);

    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();
    await user.keyboard(" attempted-edit");

    // Even after debounce window, no save fires for public-shared reports.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(mocks.saveCalls.length).toBe(0);
  });

  it("Scenario: workspaceSnapshot drives Live Memory card values + latest run", async () => {
    mocks.workspaceSnapshot = {
      workspace: { source: "live", updatedAt: 1_700_000_000_000 },
      entities: [{}, {}, {}],
      evidence: [],
      claims: [{}, {}],
      followUps: [],
      captures: [{}, {}, {}, {}],
      runRecords: [
        { status: "queued", source: "ingest", updatedAt: 1_700_000_000_000 },
        { status: "completed", source: "agent", updatedAt: 1_700_000_001_000 },
      ],
    };
    renderAt(mocks.reportId);

    await waitFor(() => {
      const text = document.body.textContent ?? "";
      // Counts present (4 captures, 2 runs, 3 entities, 2 claims).
      expect(text).toMatch(/4\s*captures/i);
      expect(text).toMatch(/2\s*runs/i);
      expect(text).toMatch(/3\s*entities/i);
      expect(text).toMatch(/2\s*claims/i);
      // Latest run picks the higher updatedAt → "completed / agent".
      expect(text.toLowerCase()).toContain("completed");
      expect(text.toLowerCase()).toContain("agent");
    });
  });

  it("Scenario: starter slug (not Convex id) — skips Convex queries, no save wiring", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/reports/starter-stripe/notebook"]}>
        <ReportNotebookDetail />
      </MemoryRouter>,
    );
    const editor = await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="report-notebook-editor"] [contenteditable="true"]',
        );
        if (!el) throw new Error("editor not mounted");
        return el as HTMLElement;
      },
      { timeout: 4000 },
    );
    editor.focus();
    await user.keyboard(" starter-edit");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(mocks.saveCalls.length).toBe(0);
  });
});
