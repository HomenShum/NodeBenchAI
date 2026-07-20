/**
 * FinancialRenderer — prose-native DOM for the Financial diligence block.
 *
 * Industry UX reference (best-in-class):
 *   - Bloomberg / Yahoo Finance summary cards — revenue · margin · guidance
 *   - SEC 10-K / 10-Q summary rows — period · key metrics · YoY delta
 *   - Crunchbase financial section — burn / runway / revenue proxies
 *
 * Design bias: financial data is the MOST scrutinized. Every number must
 *              cite its source filing verbatim. Never interpolate private
 *              revenue for private companies — it's disinformation risk.
 *              For public companies: SEC filings only. For private:
 *              explicitly say "unavailable" rather than estimate.
 *
 *              Legal fence (v1): NO paid API proxies (SimilarWeb, Apptopia,
 *              PitchBook). SEC EDGAR only. The empty state makes this
 *              explicit so users understand why this block is quiet for
 *              private companies.
 *
 *              Full financial coverage lands in v2 once paid-API licensing
 *              is in place. The renderer is here now so the registry is
 *              complete and the fallback path works.
 *
 * See: docs/architecture/DILIGENCE_BLOCKS.md
 *      server/pipeline/authority/defaultTiers.ts  (financial denyList)
 *      .claude/rules/agentic_reliability.md  (HONEST_SCORES — no synthesis)
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
  "No public financials. The financial block reads SEC EDGAR filings only; paid proxies (SimilarWeb, Apptopia, PitchBook) are excluded per v1 legal fence. Private-company financials remain unavailable until a licensed data source ships in v2.";

export function renderFinancialDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = buildDecorationRoot(data, "diligence-decoration-financial");
  root.appendChild(buildDecorationHeader(data));
  root.appendChild(buildProseBody(data.bodyProse, EMPTY_MESSAGE));
  root.appendChild(buildDecorationActions(data));
  return root;
}

export const FinancialRenderer: DecorationRenderer = {
  render: renderFinancialDecoration,
};

export default FinancialRenderer;
