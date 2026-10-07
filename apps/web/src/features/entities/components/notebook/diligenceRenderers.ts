/**
 * diligenceRenderers — single-source registry of block-specific renderers.
 *
 * Pattern: generic renderer contract (PR9 from the notebook refactor).
 *          The plugin shell stays block-agnostic; adding a new block type
 *          is a one-line change here plus a new renderer file under
 *          `renderers/`.
 *
 * Missing block types are handled by the plugin's built-in default
 * renderer, so shipping renderers incrementally is safe.
 *
 * See: src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *      src/features/entities/components/notebook/renderers/*.tsx
 *      docs/architecture/DILIGENCE_BLOCKS.md
 */

import type { DecorationRendererRegistry } from "./DiligenceDecorationPlugin";
import { FounderRenderer } from "./renderers/FounderRenderer";
import { ProductRenderer } from "./renderers/ProductRenderer";
import { FundingRenderer } from "./renderers/FundingRenderer";
import { NewsRenderer } from "./renderers/NewsRenderer";
import { HiringRenderer } from "./renderers/HiringRenderer";
import { PatentRenderer } from "./renderers/PatentRenderer";
import { PublicOpinionRenderer } from "./renderers/PublicOpinionRenderer";
import { CompetitorRenderer } from "./renderers/CompetitorRenderer";
import { RegulatoryRenderer } from "./renderers/RegulatoryRenderer";
import { FinancialRenderer } from "./renderers/FinancialRenderer";

/**
 * Full registry — all 10 canonical diligence blocks have explicit renderers.
 * Legal-fenced blocks (parts of publicOpinion, all of financial until paid
 * APIs are licensed) render their own empty state that names the fence, so
 * users never wonder why a block is quiet. See
 * server/pipeline/authority/defaultTiers.ts for the authoritative allowlist
 * and denylist per block.
 */
export const diligenceRenderers: DecorationRendererRegistry = {
  founder: FounderRenderer,
  product: ProductRenderer,
  funding: FundingRenderer,
  news: NewsRenderer,
  hiring: HiringRenderer,
  patent: PatentRenderer,
  publicOpinion: PublicOpinionRenderer,
  competitor: CompetitorRenderer,
  regulatory: RegulatoryRenderer,
  financial: FinancialRenderer,
};

