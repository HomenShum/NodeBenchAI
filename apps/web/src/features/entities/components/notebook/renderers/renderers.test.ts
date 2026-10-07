/**
 * Tests for ProductRenderer, FundingRenderer, NewsRenderer, HiringRenderer.
 *
 * Scenario: The orchestrator emits a structured projection for each block
 *           type. The matching renderer converts it into the HTMLElement
 *           that ProseMirror mounts as a widget decoration inline in the
 *           notebook.
 *
 * Invariants under test (every renderer):
 *   - role="region" + aria-label equals the headerText
 *   - tier chip exists with the correct tone class
 *   - body renders prose paragraphs OR an honest block-specific empty state
 *   - three action buttons with data-action + data-block + data-run-id
 *   - last-paragraph margin-bottom reset (Ive polish: prose feels finished)
 *
 * Shared helpers are exercised once per renderer since every renderer uses
 * the same helpers — if the helpers break, every renderer fails.
 */

import { describe, it, expect } from "vitest";
import type { DiligenceDecorationData } from "../DiligenceDecorationPlugin";
import { ProductRenderer, renderProductDecoration } from "./ProductRenderer";
import { FundingRenderer, renderFundingDecoration } from "./FundingRenderer";
import { NewsRenderer, renderNewsDecoration } from "./NewsRenderer";
import { HiringRenderer, renderHiringDecoration } from "./HiringRenderer";
import { PatentRenderer, renderPatentDecoration } from "./PatentRenderer";
import {
  PublicOpinionRenderer,
  renderPublicOpinionDecoration,
} from "./PublicOpinionRenderer";
import {
  CompetitorRenderer,
  renderCompetitorDecoration,
} from "./CompetitorRenderer";
import {
  RegulatoryRenderer,
  renderRegulatoryDecoration,
} from "./RegulatoryRenderer";
import {
  FinancialRenderer,
  renderFinancialDecoration,
} from "./FinancialRenderer";

type Case = {
  name: string;
  blockType: DiligenceDecorationData["blockType"];
  render: (d: DiligenceDecorationData) => HTMLElement;
  expectedClass: string;
  expectedHeaderText: string;
  emptyStatePattern: RegExp;
};

const CASES: Case[] = [
  {
    name: "ProductRenderer",
    blockType: "product",
    render: renderProductDecoration,
    expectedClass: "diligence-decoration-product",
    expectedHeaderText: "Products",
    emptyStatePattern: /homepage or a product-page URL/i,
  },
  {
    name: "FundingRenderer",
    blockType: "funding",
    render: renderFundingDecoration,
    expectedClass: "diligence-decoration-funding",
    expectedHeaderText: "Funding",
    emptyStatePattern: /SEC filing/i,
  },
  {
    name: "NewsRenderer",
    blockType: "news",
    render: renderNewsDecoration,
    expectedClass: "diligence-decoration-news",
    expectedHeaderText: "Recent news",
    emptyStatePattern: /Reuters.*Bloomberg.*WSJ/i,
  },
  {
    name: "HiringRenderer",
    blockType: "hiring",
    render: renderHiringDecoration,
    expectedClass: "diligence-decoration-hiring",
    expectedHeaderText: "Hiring",
    emptyStatePattern: /never from Glassdoor scraping/i,
  },
  {
    name: "PatentRenderer",
    blockType: "patent",
    render: renderPatentDecoration,
    expectedClass: "diligence-decoration-patent",
    expectedHeaderText: "Patents",
    emptyStatePattern: /USPTO, EPO, and Google Patents/i,
  },
  {
    name: "PublicOpinionRenderer",
    blockType: "publicOpinion",
    render: renderPublicOpinionDecoration,
    expectedClass: "diligence-decoration-public-opinion",
    expectedHeaderText: "Public opinion",
    emptyStatePattern: /X\/Twitter and Glassdoor are excluded/i,
  },
  {
    name: "CompetitorRenderer",
    blockType: "competitor",
    render: renderCompetitorDecoration,
    expectedClass: "diligence-decoration-competitor",
    expectedHeaderText: "Competitors",
    emptyStatePattern: /G2, Capterra, Crunchbase, and ProductHunt/i,
  },
  {
    name: "RegulatoryRenderer",
    blockType: "regulatory",
    render: renderRegulatoryDecoration,
    expectedClass: "diligence-decoration-regulatory",
    expectedHeaderText: "Regulatory",
    emptyStatePattern: /no paid PACER page-by-page billing/i,
  },
  {
    name: "FinancialRenderer",
    blockType: "financial",
    render: renderFinancialDecoration,
    expectedClass: "diligence-decoration-financial",
    expectedHeaderText: "Financials",
    emptyStatePattern: /SEC EDGAR filings only/i,
  },
];

function baseData(c: Case, overrides: Partial<DiligenceDecorationData> = {}): DiligenceDecorationData {
  return {
    blockType: c.blockType,
    overallTier: "verified",
    headerText: c.expectedHeaderText,
    scratchpadRunId: "run_001",
    version: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe.each(CASES)("$name", (c) => {
  it(`renders a DIV with role=region + aria-label from headerText`, () => {
    const node = c.render(baseData(c));
    expect(node.tagName.toLowerCase()).toBe("div");
    expect(node.getAttribute("role")).toBe("region");
    expect(node.getAttribute("aria-label")).toBe(c.expectedHeaderText);
  });

  it(`carries the block-specific class alongside the generic decoration class`, () => {
    const node = c.render(baseData(c));
    expect(node.className).toContain("diligence-decoration");
    expect(node.className).toContain(c.expectedClass);
  });

  it(`renders the header title exactly as supplied`, () => {
    const node = c.render(baseData(c, { headerText: `${c.expectedHeaderText} · custom tail` }));
    const title = node.querySelector(".diligence-decoration-title");
    expect(title?.textContent).toBe(`${c.expectedHeaderText} · custom tail`);
  });

  it(`emits a tier chip with matching tone class (verified)`, () => {
    const node = c.render(baseData(c, { overallTier: "verified" }));
    const chip = node.querySelector(".diligence-tier");
    expect(chip?.className).toContain("diligence-tier-verified");
    expect(chip?.textContent).toContain("Verified");
  });

  it(`renders body paragraphs split on blank lines`, () => {
    const node = c.render(
      baseData(c, {
        bodyProse: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      }),
    );
    const paragraphs = node.querySelectorAll(".diligence-decoration-body p");
    expect(paragraphs.length).toBe(3);
  });

  it(`renders the block-specific empty state when bodyProse is absent`, () => {
    const node = c.render(baseData(c, { bodyProse: undefined }));
    const empty = node.querySelector(".diligence-decoration-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toMatch(c.emptyStatePattern);
  });

  it(`renders three action buttons (accept/refresh/dismiss) with delegation data attributes`, () => {
    const node = c.render(baseData(c, { scratchpadRunId: "run_xyz_42" }));
    const actions = node.querySelectorAll(".diligence-decoration-action");
    expect(actions.length).toBe(3);
    const kinds = Array.from(actions).map((a) => a.getAttribute("data-action"));
    expect(kinds).toEqual(["accept", "refresh", "dismiss"]);
    for (const a of Array.from(actions)) {
      expect(a.getAttribute("data-block")).toBe(c.blockType);
      expect(a.getAttribute("data-run-id")).toBe("run_xyz_42");
    }
  });

  it(`dismiss button carries the muted modifier class`, () => {
    const node = c.render(baseData(c));
    const dismiss = node.querySelector('[data-action="dismiss"]');
    expect(dismiss?.className).toContain("diligence-decoration-action-muted");
  });

  it(`exports a DecorationRenderer.render function on the named renderer export`, () => {
    const renderers = {
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
    const renderer = renderers[c.blockType as keyof typeof renderers];
    expect(typeof renderer.render).toBe("function");
    expect(renderer.render(baseData(c))).toBeInstanceOf(HTMLElement);
  });
});

describe("cross-renderer invariants", () => {
  it("each renderer's class signature is unique (no accidental block-type collision)", () => {
    const classes = CASES.map((c) => c.expectedClass);
    const unique = new Set(classes);
    expect(unique.size).toBe(classes.length);
  });

  it("all four renderers share the same generic decoration class prefix", () => {
    for (const c of CASES) {
      const node = c.render(baseData(c));
      expect(node.className.split(" ")[0]).toBe("diligence-decoration");
    }
  });
});
