/**
 * CompetitorRenderer — prose-native DOM for the Competitor diligence block.
 *
 * Industry UX reference (best-in-class):
 *   - G2 / Capterra "similar to" comparison rows — compact, named peers
 *   - Crunchbase competitor lists — name + one-line positioning delta
 *   - ProductHunt "competitors" section — minimal, peer-first
 *
 * Design bias: competitor intel is relational ("X vs. Y") — so render as
 *              a flat, comparable list of peers with a one-line
 *              differentiator per peer. Never sort by market-cap or similar
 *              vanity; keep alphabetical or as the agent emits. Avoid
 *              "threat level" language that would require scoring we
 *              don't actually have.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (competitor allowlist)
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
  "No competitors identified yet. The competitor block cross-references G2, Capterra, Crunchbase, and ProductHunt — try adding a company category hint to the ingest.";

export function renderCompetitorDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-competitor");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const CompetitorRenderer: DecorationRenderer = {
  render: renderCompetitorDecoration,
};

export default CompetitorRenderer;
