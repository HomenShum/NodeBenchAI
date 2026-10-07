/**
 * FundingRenderer — prose-native DOM for the Funding diligence decoration.
 *
 * Industry UX reference (best-in-class):
 *   - Crunchbase round cards — amount · round name · date · lead investor
 *   - PitchBook round summaries — compact, pipe-separated
 *   - TechCrunch funding coverage — prose with inline round context
 *
 * Design bias: funding reads best as a reverse-chronological timeline. Most
 *              recent round first. Amount + round name + date + lead — in
 *              that order — matches every investor-intuitive sweep.
 *              Never sensationalize: no "massive raise" copy, just numbers.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *      .claude/rules/reexamine_design_reduction.md
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
  "No funding signals found. Add a press release or SEC filing to seed this block.";

export function renderFundingDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-funding");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const FundingRenderer: DecorationRenderer = {
  render: renderFundingDecoration,
};

export default FundingRenderer;
