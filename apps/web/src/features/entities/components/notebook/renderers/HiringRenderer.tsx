/**
 * HiringRenderer — prose-native DOM for the Hiring diligence decoration.
 *
 * Industry UX reference (best-in-class):
 *   - LinkedIn Jobs listings — role · location · posted
 *   - Wellfound (AngelList) role feeds — compact, team-sized
 *   - Greenhouse careers pages — role-first, department secondary
 *
 * Design bias: headcount growth is a leading-indicator signal. The common
 *              useful question is "what are they building, based on who
 *              they're hiring?" so lead with role titles + team delta count
 *              ("+3 this month"), not vanity "we're hiring!" copy.
 *              Never include Glassdoor sentiment — the v1 legal fence in
 *              server/pipeline/authority/defaultTiers.ts explicitly denies it.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (hiring allowlist)
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
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
  "No hiring signals identified. The hiring block pulls from the company careers page and LinkedIn Jobs — never from Glassdoor scraping.";

export function renderHiringDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-hiring");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const HiringRenderer: DecorationRenderer = {
  render: renderHiringDecoration,
};

export default HiringRenderer;
