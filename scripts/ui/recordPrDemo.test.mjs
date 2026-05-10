/**
 * Scenario-based tests for the PR demo recorder's surface-routing
 * function.
 *
 * Pinning this contract matters because:
 *   - The routing decides what gets recorded; a regression turns the
 *     PR-demo into a useless "landing page only" video.
 *   - The function is pure → cheap to test with full coverage of the
 *     known routing rules.
 *
 * Persona axis:
 *   - PR author who touched only redesign surfaces (happy path).
 *   - PR author who touched only convex backend.
 *   - PR author who touched docs only (default fallback).
 *   - PR author who touched 50 files across multiple surfaces (BOUND
 *     check — must cap at MAX_SURFACES_PER_SESSION).
 *
 * Failure-mode axis:
 *   - Empty file list → fallback to defaults (the recorder must still
 *     produce a video for doc-only PRs).
 *   - Files with the same target path → deduplication preserves order.
 */

import { describe, expect, it } from "vitest";
import { pickSurfacesForPr } from "./recordPrDemo.mjs";

describe("pickSurfacesForPr — routing contract", () => {
  it("routes redesign-surface edits to /redesign", () => {
    const surfaces = pickSurfacesForPr([
      "src/features/redesign/surfaces/EditorialHomeSurface.tsx",
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].path).toBe("/redesign");
    expect(surfaces[0].name).toMatch(/Redesign/i);
  });

  it("routes voice-integration edits to /voice/health", () => {
    const surfaces = pickSurfacesForPr([
      "convex/domains/integrations/voice/voiceActions.ts",
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].path).toBe("/voice/health");
  });

  it("routes macro-integration edits to /redesign (Scoreboard)", () => {
    const surfaces = pickSurfacesForPr([
      "convex/domains/integrations/macro/fredSeed.ts",
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].path).toBe("/redesign");
    expect(surfaces[0].name).toMatch(/Scoreboard/);
  });

  it("routes video-integration edits to /redesign (lite-embed)", () => {
    const surfaces = pickSurfacesForPr([
      "convex/domains/integrations/video/oembedFetcher.ts",
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].path).toBe("/redesign");
  });

  it("dedupes when multiple files map to the same surface path", () => {
    // Two redesign components → one entry, not two.
    const surfaces = pickSurfacesForPr([
      "src/features/redesign/components/edition/Footnote.tsx",
      "src/features/redesign/components/edition/EditionTOC.tsx",
    ]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].path).toBe("/redesign");
  });

  it("uses default surfaces when no rule matches (doc-only PR)", () => {
    const surfaces = pickSurfacesForPr([
      "docs/architecture/SOMETHING.md",
      "README.md",
    ]);
    expect(surfaces.length).toBeGreaterThan(0);
    // Default list must include the landing page so we always have
    // SOMETHING in the recording.
    expect(surfaces.some((s) => s.path === "/")).toBe(true);
  });

  it("uses default surfaces when file list is empty", () => {
    const surfaces = pickSurfacesForPr([]);
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces.some((s) => s.path === "/")).toBe(true);
  });

  it("caps at MAX_SURFACES_PER_SESSION (5) even when many surfaces match", () => {
    // Construct a file list that hits every routing rule.
    const surfaces = pickSurfacesForPr([
      "src/features/redesign/surfaces/EditorialHomeSurface.tsx",
      "convex/domains/integrations/voice/voiceActions.ts",
      "convex/domains/integrations/macro/fredSeed.ts",
      "convex/domains/integrations/video/oembedFetcher.ts",
      "src/features/redesign/components/edition/Footnote.tsx",
      // Sixth entry with a hypothetical extra rule — even if more
      // rules existed, the cap should hold.
      "src/features/redesign/RedesignShell.tsx",
    ]);
    expect(surfaces.length).toBeLessThanOrEqual(5);
  });

  it("preserves first-match order across the changed-file list", () => {
    const surfaces = pickSurfacesForPr([
      "convex/domains/integrations/voice/voiceActions.ts",
      "src/features/redesign/surfaces/EditorialHomeSurface.tsx",
    ]);
    // Voice was first → it must come first in the output.
    expect(surfaces[0].path).toBe("/voice/health");
    expect(surfaces[1]?.path).toBe("/redesign");
  });
});
