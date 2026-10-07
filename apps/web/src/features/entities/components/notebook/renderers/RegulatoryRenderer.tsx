/**
 * RegulatoryRenderer — prose-native DOM for the Regulatory diligence block.
 *
 * Industry UX reference (best-in-class):
 *   - CourtListener case summaries — court · date · title · docket
 *   - SEC EDGAR filing rows — form · accession · date · summary
 *   - FTC/CFPB enforcement action pages — action · date · respondent · status
 *
 * Design bias: regulatory data is HIGH-CONSEQUENCE. Every rendered fact
 *              must link back to the official filing. Never imply outcomes
 *              that aren't explicit in the source. Prefer "alleged" /
 *              "settled" / "dismissed" verbatim from the filing. The
 *              HONEST_SCORES rule applies especially hard here — if the
 *              source says "pending", render "pending", never a summary
 *              phrase that implies severity.
 *
 *              Legal fence (v1): PACER is paid per-page — use CourtListener
 *              mirror for federal cases instead. State courts are partial.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (regulatory allowlist)
 *      .claude/rules/agentic_reliability.md  (HONEST_SCORES)
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
  "No regulatory signals found. The regulatory block queries SEC EDGAR, FTC, CFPB, and CourtListener (free PACER mirror) — no paid PACER page-by-page billing.";

export function renderRegulatoryDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-regulatory");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const RegulatoryRenderer: DecorationRenderer = {
  render: renderRegulatoryDecoration,
};

export default RegulatoryRenderer;
