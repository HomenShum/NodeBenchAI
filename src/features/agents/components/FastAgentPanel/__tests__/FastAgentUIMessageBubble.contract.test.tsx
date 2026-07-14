import type { UIMessage } from "@convex-dev/agent/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FastAgentUIMessageBubble } from "../FastAgentPanel.UIMessageBubble";

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
  overrides: Partial<UIMessage> & { text?: string } = {},
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
    expect(screen.getByText("Adapter fallback")).toBeInTheDocument();
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
});
