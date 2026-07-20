/**
 * My Wiki UI — Phase 1+2 public surface.
 *
 * Consumers (Me-page route, ActiveSurfaceHost) import from this barrel.
 * Phase 1 scope: landing list, page detail (three-zone layout), regenerate
 * button, freshness badge.
 * Phase 2 (Dreaming): themes panel, notes editor, dreaming pipeline.
 *
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md §12
 */

export { WikiLanding } from "./WikiLanding";
export { WikiPageDetail, type WikiPageDoc, type WikiRevisionDoc } from "./WikiPageDetail";
export { WikiPageDetailContainer } from "./WikiPageDetailContainer";
export { WikiRegenerateButton } from "./WikiRegenerateButton";
export { WikiFreshnessBadge, type FreshnessState } from "./WikiFreshnessBadge";
// Phase 2 — Dreaming pipeline UI
export { WikiThemesPanel } from "./WikiThemesPanel";
export { WikiNotesEditor } from "./WikiNotesEditor";
