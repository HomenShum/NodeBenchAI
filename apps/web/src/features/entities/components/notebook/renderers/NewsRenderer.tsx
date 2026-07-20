/**
 * NewsRenderer — prose-native DOM for the News diligence decoration.
 *
 * Industry UX reference (best-in-class):
 *   - Reuters/Bloomberg terminal-style — compact headline + source + date
 *   - Hacker News — title-first with quiet metadata below
 *   - NYTimes inline citations — short quote + named source + date
 *
 * Design bias: news is time-sensitive — always surface the newest item at
 *              the top. Show source name explicitly (trust is attached to
 *              the source, not the headline). Treat tier visually: Tier 1
 *              sources (Reuters, Bloomberg, WSJ, AP, BBC) get no extra
 *              annotation; Tier 3 aggregators carry a quiet "unverified"
 *              inline cue per `news` block's authority allowlist.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (news tier allowlist)
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
  "No recent news identified yet. The news block pulls from reputable newsrooms (Reuters, Bloomberg, WSJ) with editorial policy.";

export function renderNewsDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-news");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const NewsRenderer: DecorationRenderer = {
  render: renderNewsDecoration,
};

export default NewsRenderer;
