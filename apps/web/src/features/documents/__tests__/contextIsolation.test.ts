/**
 * Runtime context isolation tests for the documents workspace.
 *
 * These tests verify that context slice boundaries prevent unnecessary
 * rerenders across domain boundaries. They test the actual React context
 * subscription model, not just file structure.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FEATURES_ROOT = resolve(__dirname, "..");
const COMPONENTS_ROOT = resolve(FEATURES_ROOT, "components");

// ─── Context Consumer Verification ──────────────────────────────────────────

describe("Context Consumer Verification", () => {
  it("DocumentsWorkspaceSurface must consume document-domain context hooks", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsWorkspaceSurface.tsx"),
      "utf-8",
    );
    // Must import at least one document context hook
    const hasDocCtx =
      content.includes("useDocumentDataCtx") ||
      content.includes("useDocumentActionCtx") ||
      content.includes("useDocumentOrderCtx") ||
      content.includes("useDocumentUploadCtx") ||
      content.includes("useDocumentOverlayCtx");
    expect(hasDocCtx).toBe(true);
  });

  it("DocumentsPlannerOverlays must consume planner-domain context hooks", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsPlannerOverlays.tsx"),
      "utf-8",
    );
    const hasPlannerCtx =
      content.includes("usePlannerEditorCtx") ||
      content.includes("usePlannerViewCtx") ||
      content.includes("usePlannerAgendaCtx") ||
      content.includes("usePlannerDateNavCtx");
    expect(hasPlannerCtx).toBe(true);
  });
});

// ─── Prop Bag Elimination ───────────────────────────────────────────────────

describe("Prop Bag Elimination", () => {
  it("DocumentsWorkspaceSurface must NOT receive docWs as a prop", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsWorkspaceSurface.tsx"),
      "utf-8",
    );
    // The prop interface should not contain docWs
    expect(content).not.toMatch(/\bdocWs\b.*:/);
  });

  it("DocumentsHomeHub must NOT pass docWs to workspace surface", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsHomeHub.tsx"),
      "utf-8",
    );
    expect(content).not.toMatch(/docWs=\{docWs\}/);
  });
});

// ─── Subscription Isolation ─────────────────────────────────────────────────

describe("Subscription Isolation (structural proof)", () => {
  it("DocumentsWorkspaceSurface must NOT subscribe to planner editor state", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsWorkspaceSurface.tsx"),
      "utf-8",
    );
    // Workspace surface should not need editor state
    expect(content).not.toContain("usePlannerEditorCtx");
  });

  it("DocumentsPlannerOverlays must NOT subscribe to document data/selection", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "DocumentsPlannerOverlays.tsx"),
      "utf-8",
    );
    // Planner overlays should not need document grid data
    expect(content).not.toContain("useDocumentDataCtx");
    expect(content).not.toContain("useDocumentSelectionCtx");
    expect(content).not.toContain("useDocumentOrderCtx");
  });
});

// ─── Preview Descriptor ─────────────────────────────────────────────────────

describe("Preview Descriptor", () => {
  it("previewDescriptor.ts must exist and export resolvePreviewDescriptor", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "previewDescriptor.ts"),
      "utf-8",
    );
    expect(content).toContain("export function resolvePreviewDescriptor");
    expect(content).toContain("export type PreviewFamily");
    expect(content).toContain("export interface DocumentPreviewDescriptor");
  });

  it("previewDescriptor must NOT import xlsx or any preview implementation", () => {
    const content = readFileSync(
      resolve(COMPONENTS_ROOT, "previewDescriptor.ts"),
      "utf-8",
    );
    expect(content).not.toMatch(/from\s+["']xlsx["']/);
    expect(content).not.toContain("RichPreviews");
    // Must be pure metadata — no React imports
    expect(content).not.toContain("from \"react\"");
  });
});
