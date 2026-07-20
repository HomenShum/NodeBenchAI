import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "@/test/testUtils";

const {
  mockAppendBlock,
  mockBackfillEntityBlocks,
  mockInsertBlockBetween,
  mockLoadMore,
  mockMaterializeForEntity,
  mockRequestRefreshAndRun,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
  mockToastWarning,
  mockUpdateBlock,
  paginatedState,
  queryState,
  api,
} = vi.hoisted(() => {
  const appendBlock = vi.fn();
  const backfillEntityBlocks = vi.fn();
  const insertBlockBetween = vi.fn();
  const loadMore = vi.fn();
  const materializeForEntity = vi.fn();
  const requestRefreshAndRun = vi.fn();
  const updateBlock = vi.fn();
  return {
    mockAppendBlock: appendBlock,
    mockBackfillEntityBlocks: backfillEntityBlocks,
    mockInsertBlockBetween: insertBlockBetween,
    mockLoadMore: loadMore,
    mockMaterializeForEntity: materializeForEntity,
    mockRequestRefreshAndRun: requestRefreshAndRun,
    mockToastError: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastWarning: vi.fn(),
    mockUpdateBlock: updateBlock,
    paginatedState: {
      results: [] as unknown[],
      status: "Exhausted",
      loadMore,
    },
    queryState: {
      snapshot: {
        blocks: [] as unknown[],
        reportCount: 0,
      } as Record<string, unknown>,
      blockSummary: {
        blockCount: 0,
        userEditedCount: 0,
      },
      backlinks: [] as unknown[],
    },
    api: {
      domains: {
        product: {
          blocks: {
            listEntityBlocksPaginated: "listEntityBlocksPaginated",
            getEntityNotebook: "getEntityNotebook",
            getEntityBlockSummary: "getEntityBlockSummary",
            listBacklinksForEntity: "listBacklinksForEntity",
            appendBlock: "appendBlock",
            insertBlockBetween: "insertBlockBetween",
            updateBlock: "updateBlock",
            deleteBlock: "deleteBlock",
            backfillEntityBlocks: "backfillEntityBlocks",
            createBlockRelation: "createBlockRelation",
          },
          notebookPresence: {},
          diligenceProjections: {
            listForEntity: "listForEntity",
            materializeForEntity: "materializeForEntity",
            requestRefreshAndRun: "requestRefreshAndRun",
          },
          blockProsemirror: {
            getSnapshot: "getSnapshot",
            latestVersion: "latestVersion",
            getSteps: "getSteps",
            submitSteps: "submitSteps",
            submitSnapshot: "submitSnapshot",
          },
        },
      },
    },
  };
});

vi.mock("convex/react", () => ({
  usePaginatedQuery: vi.fn(() => paginatedState),
  useQuery: vi.fn((query: unknown) => {
    if (query === api.domains.product.blocks.getEntityNotebook) return queryState.snapshot;
    if (query === api.domains.product.blocks.getEntityBlockSummary) return queryState.blockSummary;
    if (query === api.domains.product.blocks.listBacklinksForEntity) return queryState.backlinks;
    if (query === api.domains.product.diligenceProjections.listForEntity) return [];
    return undefined;
  }),
  useMutation: vi.fn((mutation: unknown) => {
    if (mutation === api.domains.product.blocks.appendBlock) return mockAppendBlock;
    if (mutation === api.domains.product.blocks.insertBlockBetween) {
      return mockInsertBlockBetween;
    }
    if (mutation === api.domains.product.blocks.updateBlock) return mockUpdateBlock;
    if (mutation === api.domains.product.blocks.backfillEntityBlocks) {
      return mockBackfillEntityBlocks;
    }
    if (mutation === api.domains.product.diligenceProjections.materializeForEntity) {
      return mockMaterializeForEntity;
    }
    if (mutation === api.domains.product.diligenceProjections.requestRefreshAndRun) {
      return mockRequestRefreshAndRun;
    }
    return vi.fn();
  }),
}));

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => api,
}));

vi.mock("@/shared/ui", () => ({
  useToast: () => ({
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
    warning: mockToastWarning,
  }),
}));

vi.mock("@/hooks/useStreamingSearch", () => ({
  useStreamingSearch: () => ({
    start: vi.fn(),
  }),
}));

vi.mock("@convex-dev/prosemirror-sync/tiptap", () => ({
  useTiptapSync: () => ({
    isLoading: false,
    initialContent: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    extension: null,
    create: vi.fn(),
  }),
}));

vi.mock("./NotebookBlockEditor", async () => {
  const React = await import("react");
  const renderChips = (chips: Array<{ value: string }>) => chips.map((chip) => chip.value).join("");
  const MockNotebookBlockEditor = React.forwardRef(function MockNotebookBlockEditor(
    props: {
      ariaLabel: string;
      chips: Array<{ value: string }>;
    },
    _ref: React.ForwardedRef<unknown>,
  ) {
    return (
      <div role="textbox" aria-label={props.ariaLabel}>
        {renderChips(props.chips)}
      </div>
    );
  });

  return {
    NotebookBlockEditor: MockNotebookBlockEditor,
    default: MockNotebookBlockEditor,
  };
});

import { EntityNotebookLive } from "./EntityNotebookLive";

describe("EntityNotebookLive empty live notebook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paginatedState.results = [];
    paginatedState.status = "Exhausted";
    queryState.snapshot = {
      blocks: [],
      reportCount: 0,
    };
    queryState.blockSummary = {
      blockCount: 0,
      userEditedCount: 0,
    };
    queryState.backlinks = [];
    mockAppendBlock.mockResolvedValue("block_first");
    mockBackfillEntityBlocks.mockResolvedValue({ inserted: 3, cleared: 0 });
    mockInsertBlockBetween.mockResolvedValue("block_inserted");
    mockUpdateBlock.mockResolvedValue("block_existing");
    mockMaterializeForEntity.mockResolvedValue({
      status: "materialized",
      total: 1,
      created: 1,
      updated: 0,
      stale: 0,
      deleted: 0,
    });
    mockRequestRefreshAndRun.mockResolvedValue({
      refreshStatus: "queued",
      queuedAt: Date.now(),
      rerun: {
        status: "materialized",
        total: 1,
        created: 0,
        updated: 1,
        stale: 0,
        deleted: 0,
      },
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("auto-creates the first block for editable empty notebooks without a derived projection", async () => {
    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() =>
      expect(mockAppendBlock).toHaveBeenCalledWith({
        anonymousSessionId: expect.any(String),
        shareToken: undefined,
        entitySlug: "smr-thesis",
        kind: "text",
        content: [{ type: "text", value: "" }],
        authorKind: "user",
      }),
    );
  });

  it("hydrates the notebook from the saved brief when a reference projection exists", async () => {
    queryState.snapshot = {
      blocks: [
        { id: "derived_1", kind: "heading-3", body: "Why it matters" },
        {
          id: "derived_2",
          kind: "text",
          body: "This notebook was projected from archived intelligence.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
    };

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() =>
      expect(mockBackfillEntityBlocks).toHaveBeenCalledWith({
        anonymousSessionId: expect.any(String),
        shareToken: undefined,
        entitySlug: "smr-thesis",
      }),
    );
    await waitFor(() =>
      expect(mockMaterializeForEntity).toHaveBeenCalledWith({
        anonymousSessionId: expect.any(String),
        shareToken: undefined,
        entitySlug: "smr-thesis",
      }),
    );
    expect(mockAppendBlock).not.toHaveBeenCalled();
  });

  it("explains that the saved brief is being restored instead of opening a blank draft", async () => {
    queryState.snapshot = {
      blocks: [
        { id: "derived_1", kind: "heading-3", body: "Why it matters" },
        {
          id: "derived_2",
          kind: "text",
          body: "This notebook was projected from archived intelligence.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
    };

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() => expect(mockBackfillEntityBlocks).toHaveBeenCalled());

    expect(
      screen.getByText(
        "NodeBench is turning the latest saved report into the notebook so you land on real content instead of an empty draft.",
      ),
    ).toBeInTheDocument();
  });

  it("replaces placeholder-only user blocks with the saved brief", async () => {
    paginatedState.results = [
      {
        _id: "placeholder_1",
        entityId: "entity_1",
        kind: "text",
        authorKind: "user",
        content: [{ type: "text", value: "" }],
        positionInt: 1,
        positionFrac: "a0",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
    ];
    queryState.snapshot = {
      blocks: [
        { id: "derived_1", kind: "heading-3", body: "Why it matters" },
        {
          id: "derived_2",
          kind: "text",
          body: "This notebook was projected from archived intelligence.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
    };

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() =>
      expect(mockBackfillEntityBlocks).toHaveBeenCalledWith({
        anonymousSessionId: expect.any(String),
        shareToken: undefined,
        entitySlug: "smr-thesis",
      }),
    );
    expect(
      screen.getByText("This notebook can be restored from the saved brief."),
    ).toBeInTheDocument();
  });

  it("renders the reference overlay strip and keeps short citations on owned blocks", () => {
    paginatedState.results = [
      {
        _id: "block_title",
        entityId: "entity_1",
        kind: "heading_2",
        authorKind: "agent",
        authorId: "system-archive",
        content: [{ type: "text", value: "Supply chain AI startup Loop just raised $95M in a Series C round." }],
        positionInt: 1,
        positionFrac: "a0",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
      {
        _id: "block_heading",
        entityId: "entity_1",
        parentBlockId: "block_title",
        kind: "heading_3",
        authorKind: "agent",
        authorId: "system-archive",
        content: [{ type: "text", value: "Why it matters" }],
        positionInt: 2,
        positionFrac: "a1",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
      {
        _id: "block_body",
        entityId: "entity_1",
        parentBlockId: "block_heading",
        kind: "text",
        authorKind: "agent",
        authorId: "system-archive",
        content: [{ type: "text", value: "This notebook was projected from archived intelligence." }],
        sourceRefIds: ["src_1"],
        positionInt: 3,
        positionFrac: "a2",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
    ];
    queryState.snapshot = {
      blocks: [
        {
          id: "derived_1",
          kind: "heading-3",
          body: "Why it matters",
        },
        {
          id: "derived_2",
          kind: "text",
          body: "This notebook was projected from archived intelligence.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
      sources: [
        {
          id: "src_1",
          label: "LinkedIn",
          href: "https://example.com/source",
          domain: "linkedin.com",
        },
      ],
    };
    queryState.blockSummary = {
      blockCount: 3,
      userEditedCount: 0,
    };

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit={false} />);

    const overlayHost = screen.getByTestId("notebook-diligence-overlay-host");
    expect(overlayHost).toBeInTheDocument();
    expect(within(overlayHost).getByText("Reference")).toBeInTheDocument();
    expect(within(overlayHost).getByText("Why it matters")).toBeInTheDocument();
    // The old "AI generated" generic stamp was replaced by a per-agent
    // AgentAuthorTag pill (nb-agent-tag class). One pill should appear
    // on the frozen agent-authored block inserted by the reference
    // overlay. Exact label derives from `block.authorId`; we just
    // assert the class is present.
    expect(document.querySelectorAll(".nb-agent-tag")).toHaveLength(1);
    expect(within(overlayHost).getByText("[s1]")).toBeInTheDocument();
    expect(screen.queryByText("[src_1]")).not.toBeInTheDocument();
  });

  it("accepts a reference overlay into frozen notebook blocks and hides the overlay", async () => {
    paginatedState.results = [
      {
        _id: "block_blank",
        entityId: "entity_1",
        kind: "text",
        authorKind: "user",
        content: [{ type: "text", value: "Working draft anchor" }],
        positionInt: 1,
        positionFrac: "a0",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
    ];
    queryState.snapshot = {
      entityName: "Loop",
      blocks: [
        {
          id: "derived_heading",
          kind: "heading-3",
          body: "Why it matters",
        },
        {
          id: "derived_text",
          kind: "text",
          body: "This notebook was projected from archived intelligence.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
      sources: [
        {
          id: "src_1",
          label: "LinkedIn",
          href: "https://example.com/source",
          domain: "linkedin.com",
        },
      ],
    };
    queryState.blockSummary = {
      blockCount: 1,
      userEditedCount: 1,
    };
    mockInsertBlockBetween
      .mockResolvedValueOnce("block_marker")
      .mockResolvedValueOnce("block_heading")
      .mockResolvedValueOnce("block_body");

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() =>
      expect(screen.getByTestId("notebook-diligence-overlay-host")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(mockInsertBlockBetween).toHaveBeenCalledTimes(3));
    expect(mockInsertBlockBetween).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        beforeBlockId: "block_blank",
        kind: "generated_marker",
        content: [{ type: "text", value: expect.stringContaining("Accepted from live notebook intelligence") }],
      }),
    );
    expect(mockInsertBlockBetween).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        beforeBlockId: "block_marker",
        kind: "heading_3",
      }),
    );
    expect(mockInsertBlockBetween).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        beforeBlockId: "block_heading",
        kind: "text",
        sourceRefIds: ["src_1"],
      }),
    );
    expect(mockUpdateBlock).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("Live snapshot added to notebook");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument(),
    );
  });

  it("re-runs the projection orchestrator when refresh is clicked", async () => {
    paginatedState.results = [
      {
        _id: "block_blank",
        entityId: "entity_1",
        kind: "text",
        authorKind: "user",
        content: [{ type: "text", value: "Working draft anchor" }],
        positionInt: 1,
        positionFrac: "a0",
        revision: 1,
        updatedAt: Date.now(),
        accessMode: "edit",
      },
    ];
    queryState.snapshot = {
      entityName: "Loop",
      blocks: [
        {
          id: "what-it-is",
          kind: "heading-3",
          body: "What it is",
        },
        {
          id: "body",
          kind: "text",
          body: "Loop just raised a $95M Series C round.",
          sourceRefIds: ["src_1"],
        },
      ],
      reportCount: 1,
      reportUpdatedAt: 100,
      sources: [
        {
          id: "src_1",
          label: "Reuters",
          href: "https://www.reuters.com/example",
          domain: "reuters.com",
        },
      ],
    };

    renderWithRouter(<EntityNotebookLive entitySlug="smr-thesis" canEdit />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(mockRequestRefreshAndRun).toHaveBeenCalledWith({
        anonymousSessionId: expect.any(String),
        shareToken: undefined,
        entitySlug: "smr-thesis",
        blockType: "funding",
        scratchpadRunId: "projection:smr-thesis:100:what-it-is",
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Live intelligence refreshed",
      "The overlay now reflects the latest structured diligence projection.",
    );
  });
});
