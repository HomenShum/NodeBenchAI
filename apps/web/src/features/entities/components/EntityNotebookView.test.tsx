import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntityNotebookView } from "./EntityNotebookView";

const useQueryMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => ({
    domains: {
      product: {
        blocks: {
          getEntityNotebook: "product.blocks.getEntityNotebook",
          listBacklinksForEntity: "product.blocks.listBacklinksForEntity",
        },
      },
    },
  }),
}));

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon_test",
}));

describe("EntityNotebookView", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useQueryMock.mockReset();

    useQueryMock.mockImplementation((query: unknown) => {
      if (query === "product.blocks.getEntityNotebook") {
        return {
          entitySlug: "cliffside-ventures",
          entityName: "Cliffside Ventures",
          entityType: "company",
          firstSeenAt: Date.now() - 86_400_000,
          sessionStartedAt: 1_000,
          reportCount: 3,
          noteCount: 2,
          routing: {
            mode: "advisor",
            reason: "multi-entity diligence",
            source: "automatic",
            plannerModel: "gemini-3.1-flash-lite-preview",
            executionModel: "gemini-3.1-flash-preview",
            reasoningEffort: "high",
            operatorLabel: "Investor diligence",
            operatorHint: "Prefer clean source-backed claims.",
          },
          planTrace: {
            steps: [
              {
                step: 1,
                tool: "classify_query",
                status: "done",
                durationMs: 120,
                preview: "intent=multi_entity",
                costUsd: 0.0001,
              },
              {
                step: 5,
                tool: "synthesize_packet",
                status: "done",
                durationMs: 620,
                tokensIn: 1800,
                tokensOut: 620,
                costUsd: 0.003,
              },
            ],
            totalDurationMs: 2705,
            totalCostUsd: 0.008,
            adaptationCount: 0,
            milestones: {
              firstStageAt: 1120,
              firstSourceAt: 1360,
              firstPartialAnswerAt: 2480,
            },
          },
          sources: [
            {
              id: "source_1",
              label: "Dirk LinkedIn",
              title: "Dirk Xu | LinkedIn",
              href: "https://linkedin.com/in/xudirk",
              domain: "linkedin.com",
              publishedAt: "2026-04-10",
              excerpt: "Founder background",
              confidence: 0.92,
              supportCount: 2,
            },
          ],
          sourceSummary: {
            averageConfidence: 0.92,
            corroboratedCount: 1,
            unverifiedCount: 0,
            highConfidenceCount: 1,
          },
          blocks: [
            {
              id: "brief",
              kind: "heading-2",
              author: "agent",
              authorLabel: "gemini-3.1-flash-preview · synthesize",
              body: "Prep brief",
              step: 5,
            },
            {
              id: "section",
              kind: "text",
              author: "agent",
              authorLabel: "gemini-3.1-flash-preview",
              body: "Cliffside Ventures is a crypto-focused investment firm.",
              sourceRefIds: ["source_1"],
              modelUsed: "gemini-3.1-flash-preview",
              costUsd: 0.001,
              confidence: 0.92,
              step: 5,
              revisionLabel: "rev 2 (was AI)",
            },
          ],
          revision: 2,
          reportUpdatedAt: Date.now(),
          lastError: undefined,
          linkedFrom: [
            {
              slug: "dirk-xu",
              name: "Dirk Xu",
              entityType: "person",
              relation: "founder",
              reason: "Connected founder profile",
            },
          ],
          relatedEntities: [
            {
              slug: "binance",
              name: "Binance",
              entityType: "company",
              relation: "prior affiliation",
              reason: "Founder’s prior affiliation",
            },
          ],
        };
      }

      if (query === "product.blocks.listBacklinksForEntity") {
        return [
          {
            relationId: "rel_1",
            fromEntitySlug: "dirk-xu",
            fromEntityName: "Dirk Xu",
            snippet: "Worth revisiting Cliffside before the call.",
          },
        ];
      }

      return undefined;
    });
  });

  it("renders the prototype-style provenance panels and relation rails", () => {
    render(<EntityNotebookView entitySlug="cliffside-ventures" />);

    expect(screen.getByText("Routing & operator context")).toBeInTheDocument();
    expect(screen.getByText("Execution plan trace")).toBeInTheDocument();
    expect(screen.getByText("Sources with confidence")).toBeInTheDocument();
    expect(screen.getByText(/confidence avg 0.92/i)).toBeInTheDocument();
    expect(screen.getByText("Linked from · 1 place")).toBeInTheDocument();
    expect(screen.getByText("Related entities (harness-suggested)")).toBeInTheDocument();
    expect(screen.getByText("[s1]")).toBeInTheDocument();
    expect(screen.getByText("rev 2 (was AI)")).toBeInTheDocument();
    expect(screen.getByText("step 5")).toBeInTheDocument();
  });

  it("turns the empty read-only notebook state into a direct Live handoff", () => {
    useQueryMock.mockImplementation((query: unknown) => {
      if (query === "product.blocks.getEntityNotebook") {
        return null;
      }
      if (query === "product.blocks.listBacklinksForEntity") {
        return [];
      }
      return undefined;
    });

    const onOpenLive = vi.fn();
    render(<EntityNotebookView entitySlug="cliffside-ventures" canOpenLive onOpenLive={onOpenLive} />);

    expect(screen.getByText("No notebook data for this entity yet.")).toBeInTheDocument();
    expect(screen.getByText("This tab only shows the read-only derivation. Open Live to start writing.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Live notebook" }));
    expect(onOpenLive).toHaveBeenCalledTimes(1);
  });
});
