import type { UIMessage } from "@convex-dev/agent/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FastAgentUIMessageBubble,
  parseFusionSearchOutput,
} from "../FastAgentPanel.UIMessageBubble";
import { FusedSearchResults } from "../FusedSearchResults";
import { makeWebSourceCitationId } from "../../../../../../shared/citations/webSourceCitations";

const { smoothTextMock, speakMock, stopMock } = vi.hoisted(() => ({
  smoothTextMock: vi.fn((text: string | undefined) => [text ?? ""]),
  speakMock: vi.fn(),
  stopMock: vi.fn(),
}));

vi.mock("@convex-dev/agent/react", () => ({
  useSmoothText: smoothTextMock,
}));

vi.mock("@/hooks/useVoiceOutput", () => ({
  useVoiceOutput: () => ({
    backend: "none",
    isEnabled: false,
    isSpeaking: false,
    setBackendOverride: vi.fn(),
    speak: speakMock,
    stop: stopMock,
    toggleEnabled: vi.fn(),
  }),
}));

function message(
  parts: Array<Record<string, unknown>>,
  overrides: Partial<UIMessage> & {
    text?: string;
    tokensUsed?: { input: number; output: number };
    model?: string;
  } = {},
): UIMessage {
  return {
    id: "message-1",
    key: "thread-1-0-0",
    order: 0,
    stepOrder: 0,
    status: "success",
    agentName: "coordinator",
    text: "Materialized answer",
    _creationTime: 1,
    role: "assistant",
    parts,
    ...overrides,
  } as unknown as UIMessage;
}

describe("FastAgentUIMessageBubble AI Elements contract", () => {
  beforeEach(() => {
    smoothTextMock.mockClear();
    speakMock.mockClear();
    stopMock.mockClear();
  });

  it("uses the adapter-backed Message shell and ordered text-part fallback", () => {
    render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Adapter " },
            { type: "text", text: "fallback" },
          ],
          { text: undefined },
        )}
      />,
    );

    const article = screen.getByRole("article", { name: "Assistant response" });
    expect(article).toHaveClass("is-assistant");
    const orderedText = Array.from(
      article.querySelectorAll<HTMLElement>('[data-render-part-kind="text"]'),
    ).map((owner) => owner.textContent?.trim());
    expect(orderedText).toEqual(["Adapter", "fallback"]);
  });

  it("keeps Convex smooth streaming for both text and reasoning", () => {
    render(
      <FastAgentUIMessageBubble
        message={message(
          [{ type: "reasoning", text: "Inspecting the evidence" }],
          { status: "streaming", text: "Live answer" },
        )}
      />,
    );

    expect(smoothTextMock).toHaveBeenCalledWith("Live answer", {
      startStreaming: true,
    });
    expect(smoothTextMock).toHaveBeenCalledWith("Inspecting the evidence", {
      startStreaming: true,
    });
    expect(screen.getByText("Live answer")).toBeInTheDocument();
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText("Streaming...")).toBeInTheDocument();
    expect(screen.queryByText(/tok\/s/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/route|gather|analyze|deliver/i)).not.toBeInTheDocument();
  });

  it("omits duplicate memo, share, and auto-follow-up controls", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: "Grounded response" }], {
          text: "Grounded response",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /save this response as a memo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /share this response/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ask for more detail/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^save memo$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^go deeper$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /good response|poor response/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bookmark message|pin message/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /react with emoji/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit message/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/~\d+\s*tok/i)).not.toBeInTheDocument();
  });

  it("renders one AI Elements tool for one unified AI SDK tool part", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-marketLookup",
            toolCallId: "market-1",
            state: "output-available",
            input: { symbol: "NBCH" },
            output: "Unified result sentinel",
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 tool" }));
    const toolTrigger = screen.getByRole("button", { name: /marketLookup/i });
    expect(screen.getAllByText("marketLookup")).toHaveLength(1);
    fireEvent.click(toolTrigger);
    expect(screen.getAllByText("Unified result sentinel")).toHaveLength(1);
  });

  it.each([
    { label: "boolean false", output: false, rendered: "false" },
    { label: "numeric zero", output: 0, rendered: "0" },
  ])("renders the present $label tool output", ({ output, rendered }) => {
    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-presenceCheck",
            toolCallId: `presence-${rendered}`,
            state: "output-available",
            input: {},
            output,
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 tool" }));
    fireEvent.click(screen.getByRole("button", { name: /presenceCheck/i }));

    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText(rendered)).toBeInTheDocument();
  });

  it("treats an empty-string tool output as present and renders its result shell", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-emptyResult",
            toolCallId: "empty-result",
            state: "output-available",
            input: {},
            output: "",
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 tool" }));
    fireEvent.click(screen.getByRole("button", { name: /emptyResult/i }));

    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("gives a structured domain card precedence and invokes its callback once", () => {
    const onCompanySelect = vi.fn();

    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-searchCompanies",
            toolCallId: "company-1",
            state: "output-available",
            input: { query: "NodeBench" },
            output: {
              kind: "company_selection",
              version: 1,
              summary: "Choose the canonical company",
              data: {
                prompt: "Which NodeBench entity?",
                companies: [
                  {
                    cik: "0000123456",
                    name: "NodeBench Labs",
                    ticker: "NBCH",
                    description: "The validated company",
                    validationResult: "PASS",
                  },
                ],
              },
            },
          },
        ])}
        onCompanySelect={onCompanySelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 tool" }));
    fireEvent.click(screen.getByRole("button", { name: /searchCompanies/i }));
    expect(screen.getAllByText("Which NodeBench entity?")).toHaveLength(1);
    expect(screen.getAllByText("NodeBench Labs")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Select This Company" }),
    );
    expect(onCompanySelect).toHaveBeenCalledTimes(1);
    expect(onCompanySelect).toHaveBeenCalledWith(
      expect.objectContaining({ cik: "0000123456", ticker: "NBCH" }),
    );
  });

  it("collapses an id-less legacy domain call/result pair into one domain owner", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-call",
            toolName: "searchCompanies",
            args: { query: "Legacy NodeBench" },
          },
          {
            type: "tool-result",
            toolName: "searchCompanies",
            output: {
              kind: "company_selection",
              version: 1,
              summary: "Resolve the legacy company",
              data: {
                prompt: "Choose the legacy company",
                companies: [
                  {
                    cik: "0000654321",
                    name: "Legacy NodeBench",
                    description: "Legacy result sentinel",
                    validationResult: "PASS",
                  },
                ],
              },
            },
          },
        ])}
        onCompanySelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 tool" }));
    expect(screen.getAllByText("searchCompanies")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /searchCompanies/i }));
    expect(screen.getAllByText("Choose the legacy company")).toHaveLength(1);
    expect(screen.getAllByText("Legacy NodeBench")).toHaveLength(1);
  });

  it("routes grouped domain content once without also rendering a ToolStep", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "tool-youtubeSearch",
            toolCallId: "media-1",
            state: "output-available",
            input: { query: "NodeBench demos" },
            output: `<!-- YOUTUBE_GALLERY_DATA
[{"title":"Grouped domain video sentinel","channel":"NodeBench","description":"Ownership proof","url":"https://youtube.com/watch?v=owner1","videoId":"owner1","thumbnail":"https://img.youtube.com/vi/owner1/mqdefault.jpg"}]
-->`,
          },
        ])}
      />,
    );

    expect(
      container.querySelector('[data-grouped-domain-owners="1"]'),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-step-number]")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Used 1 tool" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Grouped domain video sentinel")).toHaveLength(
      1,
    );
  });

  it("renders adapter-routed URL sources once through the Sources primitive", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([
          {
            type: "source-url",
            sourceId: "source-1",
            url: "https://example.com/evidence",
            title: "Evidence source sentinel",
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 sources" }));
    const links = screen.getAllByRole("link", {
      name: "Evidence source sentinel",
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/evidence");
  });

  it("keeps canonical Markdown without heuristic confidence or duplicate source projections", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            {
              type: "text",
              text: `This may be uncertain [1].

[Evidence link](https://example.com/evidence)

![Evidence image](https://example.com/chart.png)

[Evidence report](https://example.com/report.pdf)`,
            },
          ],
          { text: undefined },
        )}
      />,
    );

    expect(screen.queryByText(/^(high|moderate|low) confidence$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Sources:")).not.toBeInTheDocument();
    expect(container.querySelectorAll('a[href="https://example.com/evidence"]')).toHaveLength(1);
    expect(container.querySelectorAll('img[src="https://example.com/chart.png"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href="https://example.com/report.pdf"]')).toHaveLength(1);
    expect(container.querySelectorAll('img[src*="google.com/s2/favicons"]')).toHaveLength(0);
  });

  it("renders model-only citation and entity tokens as plain text without controls", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [{
            type: "text",
            text: "Claim from {{cite:ghost|Ghost source|type:source}} about @@entity:ghost|Ghost Co|type:company@@.",
          }],
          { text: undefined },
        )}
      />,
    );

    expect(screen.getByText(/Ghost source/)).toBeInTheDocument();
    expect(screen.getByText(/Ghost Co/)).toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ghost Co/ })).not.toBeInTheDocument();
    expect(container.querySelector('a[href="#"]')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("{{cite:");
    expect(container.textContent).not.toContain("@@entity:");
  });

  it("keeps tool sources consulted unless a resolved inline token binds a claim", () => {
    const url = "https://example.com/runtime-source";
    const citationId = makeWebSourceCitationId(url);
    const toolPart = {
      type: "tool-linkupSearch",
      toolCallId: "linkup-1",
      state: "output-available",
      input: { query: "NodeBench" },
      output: `<!-- SOURCE_GALLERY_DATA
[{"title":"Runtime source","url":"${url}"}]
-->`,
    };

    const consulted = render(
      <FastAgentUIMessageBubble
        message={message([toolPart, { type: "text", text: "Unbound answer" }], {
          text: undefined,
        })}
      />,
    );
    expect(screen.getByText("Consulted sources & documents")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Citation / })).not.toBeInTheDocument();
    consulted.unmount();

    render(
      <FastAgentUIMessageBubble
        message={message([
          toolPart,
          { type: "text", text: `Bound claim {{cite:${citationId}|Runtime source|type:source}}` },
        ], { text: undefined })}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Citation 1: Runtime source/i }),
    ).toBeInTheDocument();
  });

  it("renders canonical sources and token/model provenance exactly once", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            {
              type: "source-url",
              sourceId: "provenance-source-1",
              url: "https://example.com/provenance",
              title: "Provenance source sentinel",
            },
          ],
          {
            tokensUsed: { input: 1200, output: 345 },
            model: "gpt-5.4-mini",
          },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Used 1 sources" }));
    expect(
      screen.getAllByRole("link", { name: "Provenance source sentinel" }),
    ).toHaveLength(1);

    const provenanceBadges = container.querySelectorAll('[title*="gpt-5.4-mini"]');
    expect(provenanceBadges).toHaveLength(1);
    expect(provenanceBadges[0]).toHaveTextContent("1.2K↓");
    expect(provenanceBadges[0]).toHaveTextContent("345↑");
  });

  it("renders canonical standard owners in their original interleaved order", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Opening analysis sentinel" },
            {
              type: "tool-marketLookup",
              toolCallId: "ordered-tool-1",
              state: "input-available",
              input: { symbol: "NBCH" },
            },
            {
              type: "source-url",
              sourceId: "ordered-source-1",
              url: "https://example.com/ordered-evidence",
              title: "Ordered evidence sentinel",
            },
            {
              type: "file",
              mediaType: "application/pdf",
              url: "https://example.com/ordered-file.pdf",
              name: "Ordered file sentinel",
            },
            { type: "reasoning", text: "Ordered reasoning sentinel" },
            { type: "text", text: "Closing analysis sentinel" },
          ],
          { text: undefined },
        )}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-render-part-kind]"),
      ).map((node) => [
        node.dataset.renderPartKind,
        node.dataset.originalIndex,
      ]),
    ).toEqual([
      ["text", "0"],
      ["tool", "1"],
      ["source", "2"],
      ["file", "3"],
      ["reasoning", "4"],
      ["text", "5"],
    ]);
  });

  it("keeps three reasoning owners aligned across interleaved render parts", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "reasoning", text: "alpha" },
            { type: "text", text: "Answer between reasoning owners" },
            { type: "reasoning", text: "beta" },
            {
              type: "source-url",
              sourceId: "reasoning-source",
              url: "https://example.com/reasoning",
              title: "Reasoning evidence",
            },
            { type: "reasoning", text: "gamma" },
          ],
          { status: "streaming", text: undefined },
        )}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-render-part-kind]"),
      ).map((node) => [
        node.dataset.renderPartKind,
        node.dataset.originalIndex,
      ]),
    ).toEqual([
      ["reasoning", "0"],
      ["text", "1"],
      ["reasoning", "2"],
      ["source", "3"],
      ["reasoning", "4"],
    ]);

    const reasoningOwners = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-render-part-kind="reasoning"]',
      ),
    );
    expect(reasoningOwners).toHaveLength(3);
    expect(reasoningOwners[0]).toHaveTextContent("alpha");
    expect(reasoningOwners[0]).not.toHaveTextContent("beta");
    expect(reasoningOwners[1]).toHaveTextContent("beta");
    expect(reasoningOwners[1]).not.toHaveTextContent("gamma");
    expect(reasoningOwners[2]).toHaveTextContent("gamma");
  });

  it("passes standalone and id-less legacy domain owners through custom renderers", () => {
    const onCompanySelect = vi.fn();
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Before custom owners" },
            {
              type: "data-company_selection",
              data: {
                prompt: "Choose the standalone company",
                companies: [
                  {
                    cik: "0000777777",
                    name: "Standalone NodeBench",
                    ticker: "STND",
                    description: "Standalone domain sentinel",
                    validationResult: "PASS",
                  },
                ],
              },
            },
            {
              type: "verification-receipt",
              value: {
                summary: "Id-less legacy receipt sentinel",
                passed: true,
              },
            },
            { type: "text", text: "After custom owners" },
          ],
          { text: undefined },
        )}
        onCompanySelect={onCompanySelect}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-render-part-kind]"),
      ).map((node) => node.dataset.renderPartKind),
    ).toEqual(["text", "domain", "domain", "text"]);
    expect(screen.getByText("Choose the standalone company")).toBeInTheDocument();
    expect(screen.getByText("Standalone NodeBench")).toBeInTheDocument();
    expect(screen.getByText(/Id-less legacy receipt sentinel/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Select This Company" }),
    );
    expect(onCompanySelect).toHaveBeenCalledTimes(1);
    expect(onCompanySelect).toHaveBeenCalledWith(
      expect.objectContaining({ cik: "0000777777", ticker: "STND" }),
    );
  });

  it("anchors grouped domain-tool owners once at their earliest original index", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message(
          [
            {
              type: "tool-youtubeSearch",
              toolCallId: "group-media-1",
              state: "output-available",
              input: { query: "NodeBench demos" },
              output: `<!-- YOUTUBE_GALLERY_DATA
[{"title":"Anchored video sentinel","channel":"NodeBench","description":"Anchor proof","url":"https://youtube.com/watch?v=anchor1","videoId":"anchor1","thumbnail":"https://img.youtube.com/vi/anchor1/mqdefault.jpg"}]
-->`,
            },
            { type: "text", text: "Between grouped owners" },
            {
              type: "tool-createDocument",
              toolCallId: "group-document-1",
              state: "output-available",
              input: { title: "Anchor document" },
              output: `<!-- DOCUMENT_ACTION_DATA
{"action":"created","documentId":"anchor-doc-1","title":"Anchored document sentinel"}
-->`,
            },
            { type: "text", text: "After grouped owners" },
            {
              type: "tool-contradictionDetection",
              toolCallId: "group-arbitrage-1",
              state: "output-available",
              input: {},
              output: {
                healthResults: [],
                summary: "Anchored arbitrage sentinel",
              },
            },
          ],
          { text: undefined },
        )}
      />,
    );

    const grouped = container.querySelector<HTMLElement>(
      "[data-grouped-domain-anchor]",
    );
    expect(grouped).toHaveAttribute("data-grouped-domain-anchor", "0");
    expect(grouped).toHaveAttribute("data-grouped-domain-owners", "3");
    expect(container.querySelectorAll("[data-grouped-domain-anchor]")).toHaveLength(1);
    expect(container.querySelector("[data-step-number]")).not.toBeInTheDocument();
    expect(screen.getAllByText("Anchored video sentinel")).toHaveLength(1);
    expect(screen.getAllByText("Anchored document sentinel")).toHaveLength(1);
    expect(screen.getAllByText("Anchored arbitrage sentinel")).toHaveLength(1);

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-render-part-kind]"),
      ).map((node) => [
        node.dataset.renderPartKind,
        node.dataset.originalIndex,
      ]),
    ).toEqual([
      ["grouped-domain", "0"],
      ["text", "1"],
      ["text", "3"],
    ]);
  });

  it("keeps smooth text status-gated for non-streaming messages", () => {
    render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Settled answer" },
            { type: "reasoning", text: "Settled reasoning" },
          ],
          { status: "success", text: undefined },
        )}
      />,
    );

    expect(smoothTextMock).toHaveBeenCalledWith("Settled answer", {
      startStreaming: false,
    });
    expect(smoothTextMock).toHaveBeenCalledWith("Settled reasoning", {
      startStreaming: false,
    });
  });

  it("does not execute assistant-authored JavaScript in the page origin", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{
          type: "text",
          text: "```javascript\nwindow.__assistantCodeRan = true\n```",
        }], { text: undefined })}
      />,
    );

    expect(screen.queryByRole("button", { name: /^run$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /copy/i }).length).toBeGreaterThan(0);
  });

  it("does not promote assistant prose or failed tool output into document controls", () => {
    const marker = `<!-- DOCUMENT_ACTION_DATA
{"action":"created","documentId":"untrusted-doc","title":"Untrusted document control"}
-->`;
    const prose = render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: marker }], { text: undefined })}
      />,
    );
    expect(screen.queryByText("Untrusted document control")).not.toBeInTheDocument();
    prose.unmount();

    render(
      <FastAgentUIMessageBubble
        message={message([{
          type: "tool-createDocument",
          toolCallId: "failed-document",
          state: "output-error",
          input: { title: "Untrusted document control" },
          output: marker,
          errorText: "Write rejected",
        }])}
      />,
    );

    expect(screen.getByRole("button", { name: "1 tool failed" })).toBeInTheDocument();
    expect(screen.queryByText("Untrusted document control")).not.toBeInTheDocument();
  });

  it("renders a document control from a successful structured tool result", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{
          type: "tool-createDocument",
          toolCallId: "structured-document",
          state: "output-available",
          input: { title: "Runtime document" },
          output: {
            kind: "document_action",
            version: 1,
            data: {
              action: "created",
              documentId: "runtime-doc-1",
              title: "Runtime document control",
            },
          },
        }])}
      />,
    );

    expect(screen.getByText("Runtime document control")).toBeInTheDocument();
  });

  it("keeps plan and memory cards state-aware without invented timestamps", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{
          type: "tool-createPlan",
          toolCallId: "plan-running",
          state: "input-available",
          input: { goal: "Ground every control" },
        }], { _creationTime: undefined } as Partial<UIMessage>)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Using 1 tool" }));
    expect(screen.getByText("Plan creation running")).toBeInTheDocument();
    expect(screen.queryByText(/plan creation completed/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /plan creation running/i }));
    expect(screen.getByText("Goal: Ground every control")).toBeInTheDocument();
    expect(screen.queryByText(/\d{1,2}:\d{2}\s*(am|pm)/i)).not.toBeInTheDocument();
  });

  it("uses an indeterminate runtime streaming indicator", () => {
    const { container } = render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: "Runtime text" }], {
          status: "streaming",
          text: undefined,
        })}
      />,
    );

    const indicator = screen.getByRole("status", { name: "Assistant response streaming" });
    expect(indicator.firstElementChild).toHaveClass("w-full");
    expect(indicator.firstElementChild).not.toHaveAttribute("style");
    expect(container.innerHTML).not.toContain("displayText.length / 2000");
  });

  it("rejects malformed fusion rows instead of inventing search fields", () => {
    const malformed = parseFusionSearchOutput({
      kind: "fusion_search_results",
      version: 1,
      payload: {
        results: [{
          source: "unknown-provider",
          snippet: "Missing identity and rank",
          score: 0.5,
          contentType: "text",
        }],
        sourcesQueried: ["unknown-provider"],
      },
    });

    expect(malformed.isValid).toBe(false);
    expect(malformed.results).toEqual([]);
    expect(JSON.stringify(malformed)).not.toContain("Untitled");
    expect(JSON.stringify(malformed)).not.toContain("result-0");
    expect(JSON.stringify(malformed)).not.toContain("linkup");
  });

  it("renders known search results without creating an href when no safe URL exists", () => {
    const { container } = render(
      <FusedSearchResults
        results={[{
          id: "runtime-result-1",
          source: "brave",
          title: "Runtime result without URL",
          snippet: "The provider returned content without a navigable URL.",
          score: 0.7,
          originalRank: 1,
          fusedRank: 1,
          contentType: "text",
        }]}
        sourcesQueried={["brave"]}
      />,
    );

    expect(screen.getByText("Runtime result without URL")).toBeInTheDocument();
    expect(container.querySelector("a")).not.toBeInTheDocument();
  });

  it("fails closed when direct search props contain an unknown source", () => {
    expect(() => render(
      <FusedSearchResults
        results={[{
          id: "unknown-result",
          source: "not-configured",
          title: "Must not render",
          snippet: "Unknown source",
          score: 1,
          originalRank: 1,
          contentType: "text",
        } as never]}
        sourcesQueried={["not-configured" as never]}
      />,
    )).not.toThrow();
    expect(screen.queryByText("Must not render")).not.toBeInTheDocument();
  });
});
