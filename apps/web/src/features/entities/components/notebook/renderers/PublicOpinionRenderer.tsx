/**
 * PublicOpinionRenderer — prose-native DOM for the Public Opinion block.
 *
 * Industry UX reference (best-in-class):
 *   - Reddit thread summaries — upvote count · subreddit · one-line theme
 *   - Hacker News comment digests — score · comment count · headline
 *   - Google Alerts digest — source · title · date in a calm list
 *
 * Design bias: aggregate sentiment has no tier 1 — it's inherently
 *              "many voices, some signal". Render themes, not individual
 *              quotes. Never single out a particular user. Volume matters
 *              more than any one post, so emphasize "N mentions across M
 *              threads" framing.
 *
 *              Legal fence (v1): Reddit free tier + HN only. NO X/Twitter
 *              (paid API), NO Glassdoor (scraping TOS). Empty state makes
 *              this explicit so users understand the scope.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (publicOpinion denyList)
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
  "No public sentiment signal yet. The public opinion block aggregates from Reddit (free tier) and Hacker News only — X/Twitter and Glassdoor are excluded per v1 legal fence.";

export function renderPublicOpinionDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-public-opinion");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const PublicOpinionRenderer: DecorationRenderer = {
  render: renderPublicOpinionDecoration,
};

export default PublicOpinionRenderer;
