/**
 * Performance gate tests for the documents workspace.
 *
 * These are compile-time / structural checks, not runtime perf tests.
 * They enforce invariants about the module graph and render boundaries.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FEATURES_ROOT = resolve(__dirname, "..");
const HOOKS_ROOT = resolve(FEATURES_ROOT, "hooks");
const CONTEXT_ROOT = resolve(FEATURES_ROOT, "context");

// ─── Bundle Structure Gates ──────────────────────────────────────────────────

describe("Bundle Structure Gates", () => {
  it("RichPreviews.tsx must NOT statically import xlsx", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "RichPreviews.tsx"),
      "utf-8",
    );
    // Static import of xlsx: `import * as XLSX from "xlsx"` or `import XLSX from "xlsx"`
    const staticXlsxImport = /^import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+["']xlsx["']/m;
    expect(content).not.toMatch(staticXlsxImport);
  });

  it("DocumentsHomeHub.tsx must use lazy() for workspace and planner surfaces", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    expect(content).toContain("lazy(");
    expect(content).toContain("Suspense");
  });

  it("DocumentsHomeHub.tsx must NOT directly import xlsx or react-spreadsheet", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    expect(content).not.toMatch(/from\s+["']xlsx["']/);
    expect(content).not.toMatch(/from\s+["']react-spreadsheet["']/);
  });
});

// ─── Hook Decomposition Gates ────────────────────────────────────────────────

describe("Hook Decomposition Gates", () => {
  const expectedDocSubHooks = [
    "useDocumentData",
    "useDocumentSelection",
    "useDocumentUpload",
    "useDocumentOrdering",
    "useDocumentOverlays",
  ];

  const expectedPlannerSubHooks = [
    "usePlannerDateNav",
    "usePlannerAgendaData",
    "usePlannerViewPrefs",
    "usePlannerEditor",
    "usePlannerMutations",
  ];

  for (const hookName of expectedDocSubHooks) {
    it(`${hookName}.ts must exist as a separate file`, () => {
      const filePath = resolve(HOOKS_ROOT, `${hookName}.ts`);
      expect(existsSync(filePath)).toBe(true);
    });
  }

  for (const hookName of expectedPlannerSubHooks) {
    it(`${hookName}.ts must exist as a separate file`, () => {
      const filePath = resolve(HOOKS_ROOT, `${hookName}.ts`);
      expect(existsSync(filePath)).toBe(true);
    });
  }

  it("useDocumentWorkspaceState.ts must compose sub-hooks, not define all state inline", () => {
    const content = readFileSync(
      resolve(HOOKS_ROOT, "useDocumentWorkspaceState.ts"),
      "utf-8",
    );
    // Should import at least 3 of the sub-hooks
    const subHookImports = expectedDocSubHooks.filter((name) =>
      content.includes(`from "./${name}"`),
    );
    expect(subHookImports.length).toBeGreaterThanOrEqual(3);
  });

  it("usePlannerController.ts must compose sub-hooks, not define all state inline", () => {
    const content = readFileSync(
      resolve(HOOKS_ROOT, "usePlannerController.ts"),
      "utf-8",
    );
    const subHookImports = expectedPlannerSubHooks.filter((name) =>
      content.includes(`from "./${name}"`),
    );
    expect(subHookImports.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Context Slice Gates ─────────────────────────────────────────────────────

describe("Context Slice Gates", () => {
  it("context/types.ts must export all slice types", () => {
    const content = readFileSync(resolve(CONTEXT_ROOT, "types.ts"), "utf-8");
    const expectedTypes = [
      "DocumentDataSlice",
      "DocumentActionSlice",
      "DocumentOrderSlice",
      "DocumentUploadSlice",
      "DocumentOverlaySlice",
      "PlannerDateNavSlice",
      "PlannerAgendaSlice",
      "PlannerViewSlice",
      "PlannerEditorSlice",
    ];
    for (const typeName of expectedTypes) {
      expect(content).toContain(`export interface ${typeName}`);
    }
  });

  it("DocumentsWorkspaceContext.tsx must export 9 consumer hooks", () => {
    const content = readFileSync(
      resolve(CONTEXT_ROOT, "DocumentsWorkspaceContext.tsx"),
      "utf-8",
    );
    const expectedHooks = [
      "useDocumentDataCtx",
      "useDocumentActionCtx",
      "useDocumentOrderCtx",
      "useDocumentUploadCtx",
      "useDocumentOverlayCtx",
      "usePlannerDateNavCtx",
      "usePlannerAgendaCtx",
      "usePlannerViewCtx",
      "usePlannerEditorCtx",
    ];
    for (const hookName of expectedHooks) {
      expect(content).toContain(hookName);
    }
  });
});

// ─── View Mode Split Gates ───────────────────────────────────────────────────

describe("View Mode Split Gates", () => {
  it("DocumentsTabContent must use lazy() for view-mode surfaces", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsTabContent.tsx"),
      "utf-8",
    );
    expect(content).toContain("lazy(");
    expect(content).toContain("Suspense");
  });

  it("DocumentsCardsView must exist as a separate module", () => {
    const filePath = resolve(FEATURES_ROOT, "components", "viewModes", "DocumentsCardsView.tsx");
    expect(existsSync(filePath)).toBe(true);
  });

  it("DocumentsListView must exist as a separate module", () => {
    const filePath = resolve(FEATURES_ROOT, "components", "viewModes", "DocumentsListView.tsx");
    expect(existsSync(filePath)).toBe(true);
  });

  it("DocumentsSegmentedView must exist as a separate module", () => {
    const filePath = resolve(FEATURES_ROOT, "components", "viewModes", "DocumentsSegmentedView.tsx");
    expect(existsSync(filePath)).toBe(true);
  });
});

// ─── Card Family Split Gates ─────────────────────────────────────────────────

describe("Card Family Split Gates", () => {
  it("VisualGlimpse must be in its own module", () => {
    const filePath = resolve(
      FEATURES_ROOT, "components", "documentsHub", "cards", "VisualGlimpse.tsx",
    );
    expect(existsSync(filePath)).toBe(true);
  });

  it("DocumentCard must lazy-load VisualGlimpse", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "documentsHub", "cards", "DocumentCard.tsx"),
      "utf-8",
    );
    expect(content).toContain("lazy(");
    // Should not define VisualGlimpse inline
    expect(content).not.toMatch(/^function VisualGlimpse/m);
  });
});

// ─── Planner Island Gates ────────────────────────────────────────────────────

describe("Planner Island Gates", () => {
  it("DocumentsHomeHub must NOT import usePlannerState or usePlannerController", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("usePlannerState");
    expect(content).not.toContain("usePlannerController");
  });

  it("DocumentsHomeHub must lazy-load DocumentsPlannerSurface", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    expect(content).toContain("DocumentsPlannerSurface");
    expect(content).toContain("lazy(");
  });

  it("DocumentsPlannerSurface must exist as a separate module", () => {
    const filePath = resolve(FEATURES_ROOT, "components", "DocumentsPlannerSurface.tsx");
    expect(existsSync(filePath)).toBe(true);
  });

  it("DocumentsWorkspaceSurface must NOT import planner hooks or sidebar", () => {
    const content = readFileSync(
      resolve(FEATURES_ROOT, "components", "DocumentsWorkspaceSurface.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("usePlannerState");
    expect(content).not.toContain("usePlannerController");
    expect(content).not.toContain("DocumentSidebarPanel");
  });
});
