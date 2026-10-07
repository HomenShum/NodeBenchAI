/**
 * PatentRenderer — prose-native DOM for the Patents diligence decoration.
 *
 * Industry UX reference (best-in-class):
 *   - USPTO patent search result — filing date · title · inventors
 *   - Google Patents — clean compact listing with priority date
 *   - EPO Espacenet — filing / priority / grant lineage
 *
 * Design bias: patents are technical and low-frequency. The useful question
 *              is "what have they protected?" — so lead with title + filing
 *              date, keep inventors secondary. Never fabricate claim text;
 *              render only what the filing explicitly says. Legally clean
 *              (USPTO, EPO, WIPO are all public) so no legal fence here.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (patent allowlist = USPTO/EPO/WIPO)
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
  "No patents identified. The patent block queries USPTO, EPO, and Google Patents — try a founder-named inventor search if the company hasn't filed under its corporate name.";

export function renderPatentDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-patent");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const PatentRenderer: DecorationRenderer = {
  render: renderPatentDecoration,
};

export default PatentRenderer;
