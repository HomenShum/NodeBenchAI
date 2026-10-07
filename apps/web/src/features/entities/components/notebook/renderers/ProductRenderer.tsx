/**
 * ProductRenderer — prose-native DOM for the Products diligence decoration.
 *
 * Industry UX reference (best-in-class):
 *   - Notion database sections — compact rows that read like prose
 *   - Linear project entries — name + status + one-line context
 *   - ProductHunt / App Store listings — product + tagline + metadata
 *
 * Design bias: products should read as a short inventory the user can scan
 *              in seconds. One line per product. Name bold, context muted,
 *              no card shells, no decorative icons.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *      .claude/rules/reexamine_design_reduction.md  (earned complexity)
 *      .claude/rules/reference_attribution.md
 */

import type {
  DiligenceDecorationData,
  DecorationRenderer,
} from "../DiligenceDecorationPlugin";
import {
  buildDecorationActions,
  buildDecorationHeader,
  buildDecorationRoot,
  buildProseBody,
} from "./sharedRendererHelpers";

const EMPTY_MESSAGE =
  "No products identified yet. Add the company's homepage or a product-page URL to the ingest.";

export function renderProductDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-product");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const ProductRenderer: DecorationRenderer = {
  render: renderProductDecoration,
};

export default ProductRenderer;
