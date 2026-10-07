/**
 * Rerender isolation tests for documents workspace context slices.
 *
 * These tests verify at the structural level that context consumers
 * subscribe to narrow slices and that cross-domain state changes
 * do not trigger rerenders in unrelated consumers.
 *
 * Note: True React render-count tests require a DOM environment with
 * React.Profiler or a testing-library setup. These structural tests
 * verify the preconditions for isolation: narrow hook subscriptions
 * and absence of cross-domain dependencies.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COMPONENTS = resolve(__dirname, "..", "components");
const CARDS = resolve(COMPONENTS, "documentsHub", "cards");

// ─── Cross-Slice Isolation ──────────────────────────────────────────────────

describe("Cross-Slice Isolation", () => {
  it("DocumentsWorkspaceSurface must NOT subscribe to PlannerEditorCtx", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "DocumentsWorkspaceSurface.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("usePlannerEditorCtx");
    expect(content).not.toContain("usePlannerAgendaCtx");
  });

  it("DocumentsPlannerOverlays must NOT subscribe to DocumentDataCtx", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "DocumentsPlannerOverlays.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("useDocumentDataCtx");
    expect(content).not.toContain("useDocumentOrderCtx");
    expect(content).not.toContain("useDocumentUploadCtx");
  });

  it("DocumentsPlannerOverlays must NOT subscribe to DocumentActionCtx", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "DocumentsPlannerOverlays.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("useDocumentActionCtx");
  });
});

// ─── Shell Thinness ─────────────────────────────────────────────────────────

describe("Shell Thinness", () => {
  it("DocumentsHomeHub must be under 500 lines (thin shell)", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    const lineCount = content.split("\n").length;
    expect(lineCount).toBeLessThan(500);
  });

  it("DocumentsHomeHub must NOT define useState for document/planner domain state", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    // Shell should only have miniEditorDocId as local state
    const useStateMatches = content.match(/useState</g) || [];
    // Allow at most 2 useState calls (miniEditorDocId + maybe one more)
    expect(useStateMatches.length).toBeLessThanOrEqual(2);
  });
});

// ─── Preview Family Isolation ───────────────────────────────────────────────

describe("Preview Family Isolation", () => {
  it("DocumentCard must NOT directly import from RichPreviews.tsx", () => {
    const content = readFileSync(
      resolve(CARDS, "DocumentCard.tsx"),
      "utf-8",
    );
    // Should import from previews/ family modules or use previewDescriptor
    expect(content).not.toMatch(/from\s+["']\.\.\/\.\.\/RichPreviews["']/);
  });

  it("DocumentCard must use resolvePreviewDescriptor", () => {
    const content = readFileSync(
      resolve(CARDS, "DocumentCard.tsx"),
      "utf-8",
    );
    expect(content).toContain("resolvePreviewDescriptor");
  });

  it("SpreadsheetPreview must be in its own module file", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "previews", "SpreadsheetPreview.tsx"),
      "utf-8",
    );
    expect(content).toContain("export function SpreadsheetPreview");
    // Must contain the xlsx lazy-load, not a static import
    expect(content).not.toMatch(/^import\s+\*\s+as\s+XLSX\s+from\s+["']xlsx["']/m);
  });

  it("LightPreviews must be in its own module file", () => {
    const content = readFileSync(
      resolve(COMPONENTS, "previews", "LightPreviews.tsx"),
      "utf-8",
    );
    expect(content).toContain("export function CodePreview");
    expect(content).toContain("export function MarkdownPreview");
    expect(content).toContain("export function NotePreview");
  });
});
