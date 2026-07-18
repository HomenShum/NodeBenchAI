/**
 * Phase B of docs/design/ONE_CHAT_INTERFACE.md — FastAgentPanel adopts the
 * canonical ChatAssistantMessage for OVERLAPPING completed turns.
 *
 * Scenario coverage (scenario_testing rule):
 *   Persona A — operator on the production panel (preferCanonicalAnswer on)
 *     reading a completed grounded answer: canonical anatomy renders with an
 *     HONEST receipt (real model label, "telemetry not recorded"), sources
 *     without fabricated verification badges, and re-housed tool calls.
 *   Persona B — a caller that never opted in (legacy contract tests, cockpit
 *     sidebar): identical message keeps the legacy anatomy byte-for-byte.
 *   Persona C — operator mid-run (streaming) and power users whose answers
 *     carry markdown, agent hierarchy, fusion search, or model-authored [N]
 *     references: every one of those stays on the panel-specific anatomy.
 */
import type { UIMessage } from "@convex-dev/agent/react";
import { render, screen } from "@testing-library/react";
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
  }),
}));

function message(
  parts: Array<Record<string, unknown>>,
  overrides: Partial<UIMessage> & {
    text?: string;
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
    text: undefined,
    _creationTime: 1_752_000_000_000,
    role: "assistant",
    parts,
    ...overrides,
  } as unknown as UIMessage;
}

const PROSE = "Acme raised a new round and is hiring across the platform team.";

function completedGroundedAnswer(): UIMessage {
  return message(
    [
      { type: "text", text: PROSE },
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "acme funding" },
        output: "Acme announced a Series B on Monday.",
      },
      {
        type: "source-url",
        sourceId: "src-1",
        url: "https://example.com/acme-series-b",
        title: "Acme Series B",
      },
      { type: "reasoning", text: "Checked the two most recent coverage items." },
    ],
    { text: PROSE, model: "gemini-3.5-flash" },
  );
}

function canonical(): HTMLElement | null {
  return screen.queryByTestId("panel-canonical-answer");
}

function legacyTextOwners(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('[data-render-part-kind="text"]');
}

describe("PanelCanonicalAnswer adoption contract (one chat interface, Phase B)", () => {
  beforeEach(() => {
    smoothTextMock.mockClear();
  });

  it("renders the canonical anatomy for a completed overlapping turn (operator, opted-in panel)", () => {
    render(
      <FastAgentUIMessageBubble
        message={completedGroundedAnswer()}
        preferCanonicalAnswer
      />,
    );

    const mount = canonical();
    expect(mount).not.toBeNull();
    expect(mount).toHaveAttribute("data-redesign");
    // jsdom documentElement has no `dark` class → host theme mirrors to light.
    expect(mount).toHaveAttribute("data-redesign-theme", "light");

    // Prose leads.
    expect(screen.getByText(PROSE)).toBeInTheDocument();

    // HONEST receipt: the actual model label — never a router tier the panel
    // did not run — and no invented latency/cost.
    expect(
      screen.getByText(/gemini-3\.5-flash · 1 source · telemetry not recorded/),
    ).toBeInTheDocument();

    // Sources render for the compact packet (variant="panel") with NO
    // fabricated verification badge and an honest empty quote.
    expect(screen.getByText(/1 evidence row/)).toBeInTheDocument();
    expect(screen.queryByText(/verified in source body/)).toBeNull();
    expect(screen.queryByText(/provider-grounded/)).toBeNull();

    // Tool call re-housed into the canonical Tool disclosure.
    expect(screen.getAllByText(/webSearch/).length).toBeGreaterThan(0);

    // No fabricated trace steps.
    expect(screen.queryByText(/How we got this answer/)).toBeNull();

    // The legacy anatomy is fully replaced for this turn.
    expect(legacyTextOwners().length).toBe(0);
  });

  it("keeps the legacy anatomy when the caller never opted in (expand–contract guarantee)", () => {
    render(<FastAgentUIMessageBubble message={completedGroundedAnswer()} />);

    expect(canonical()).toBeNull();
    expect(legacyTextOwners().length).toBeGreaterThan(0);
  });

  it("keeps the legacy anatomy for the compact cockpit sidebar even when opted in", () => {
    render(
      <FastAgentUIMessageBubble
        message={completedGroundedAnswer()}
        preferCanonicalAnswer
        compact
      />,
    );

    expect(canonical()).toBeNull();
    expect(legacyTextOwners().length).toBeGreaterThan(0);
  });

  it("keeps streaming turns on the panel-specific live anatomy", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: "Partial answer" }], {
          status: "streaming",
          text: "Partial answer",
        })}
        preferCanonicalAnswer
      />,
    );

    expect(canonical()).toBeNull();
    expect(screen.getByText("Streaming...")).toBeInTheDocument();
  });

  it("keeps markdown-rich answers on the legacy anatomy (fidelity over adoption)", () => {
    const markdown = "Here is the fix:\n\n```ts\nconst x = 1;\n```";
    render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: markdown }], { text: markdown })}
        preferCanonicalAnswer
      />,
    );

    expect(canonical()).toBeNull();
    expect(legacyTextOwners().length).toBeGreaterThan(0);
  });

  it("keeps agent-hierarchy and fusion-search turns on the panel-specific renderers", () => {
    render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Delegated the work." },
            {
              type: "tool-delegateToWebAgent",
              toolCallId: "call-d1",
              state: "output-available",
              input: {},
              output: "done",
            },
          ],
          { text: "Delegated the work." },
        )}
        preferCanonicalAnswer
      />,
    );
    expect(canonical()).toBeNull();

    render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: "Search finished." },
            {
              type: "tool-fusionSearch",
              toolCallId: "call-f1",
              state: "output-available",
              input: { query: "acme" },
              output: "no structured payload",
            },
          ],
          { text: "Search finished.", id: "message-2" },
        )}
        preferCanonicalAnswer
      />,
    );
    expect(canonical()).toBeNull();
  });

  it("refuses to fabricate a citation binding for model-authored [N] references", () => {
    const prose = "Revenue grew 40% [1] while headcount doubled.";
    render(
      <FastAgentUIMessageBubble
        message={message(
          [
            { type: "text", text: prose },
            {
              type: "source-url",
              sourceId: "src-1",
              url: "https://example.com/report",
              title: "Annual report",
            },
          ],
          { text: prose },
        )}
        preferCanonicalAnswer
      />,
    );

    // Binding [1] to an arbitrary source would invent evidence the runtime
    // never produced — the turn stays on the legacy anatomy instead.
    expect(canonical()).toBeNull();
    expect(legacyTextOwners().length).toBeGreaterThan(0);
  });

  it("keeps user turns untouched", () => {
    render(
      <FastAgentUIMessageBubble
        message={message([{ type: "text", text: "What changed at Acme?" }], {
          role: "user",
          text: "What changed at Acme?",
        })}
        preferCanonicalAnswer
      />,
    );

    expect(canonical()).toBeNull();
    expect(
      screen.getByRole("article", { name: "Your message" }),
    ).toBeInTheDocument();
  });
});
