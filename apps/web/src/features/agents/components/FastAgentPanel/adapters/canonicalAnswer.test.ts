/**
 * Adapter honesty contract for Phase B of docs/design/ONE_CHAT_INTERFACE.md.
 *
 * Scenario framing (scenario_testing rule): a compliance-minded operator
 * audits what the canonical anatomy claims about a panel run. Every assertion
 * here pins the honesty rule — the mapping must never fabricate verification
 * states, trace steps, durations, costs, or router tiers the panel runtime
 * did not produce — plus the exact reasons non-overlapping turns are refused.
 */
import { describe, expect, it } from "vitest";
import type { UIMessage } from "@convex-dev/agent/react";

import { convexToUIParts } from "./convexToUIParts";
import {
  buildCanonicalAnswerProps,
  describeCanonicalAnswerFit,
  detectProseFormat,
} from "./canonicalAnswer";

function message(
  parts: Array<Record<string, unknown>>,
  overrides: Partial<UIMessage> & { text?: string; model?: string } = {},
): UIMessage {
  return {
    id: "message-1",
    key: "thread-1-0-0",
    order: 0,
    stepOrder: 0,
    status: "success",
    text: undefined,
    _creationTime: 1_752_000_000_000,
    role: "assistant",
    parts,
    ...overrides,
  } as unknown as UIMessage;
}

function fitFor(
  parts: Array<Record<string, unknown>>,
  overrides: Parameters<typeof message>[1] = {},
) {
  const msg = message(parts, overrides);
  return describeCanonicalAnswerFit(convexToUIParts(msg), msg);
}

const PROSE = "Acme raised a new round and is hiring across the platform team.";

describe("describeCanonicalAnswerFit — the overlap gate", () => {
  it("adopts a completed prose + tool + source + reasoning turn", () => {
    const fit = fitFor(
      [
        { type: "text", text: PROSE },
        {
          type: "tool-webSearch",
          toolCallId: "call-1",
          state: "output-available",
          input: {},
          output: "coverage",
        },
        { type: "source-url", sourceId: "s1", url: "https://example.com", title: "Example" },
        { type: "reasoning", text: "checked coverage" },
      ],
      { text: PROSE },
    );
    expect(fit).toEqual({ adoptable: true, reasons: [] });
  });

  it.each([
    ["streaming turn", [{ type: "text", text: PROSE }], { status: "streaming" as const, text: PROSE }, /streaming/],
    ["failed turn", [{ type: "text", text: PROSE }], { status: "failed" as const, text: PROSE }, /non-completed status/],
    ["user turn", [{ type: "text", text: PROSE }], { role: "user" as const, text: PROSE }, /not an assistant turn/],
    ["empty prose", [], { text: "" }, /no prose answer/],
    ["panel citation token", [{ type: "text", text: "Growth {{cite:feed_1|src}} continues." }], { text: "Growth {{cite:feed_1|src}} continues." }, /citation\/entity token/],
    ["panel entity token", [{ type: "text", text: "About @@entity:acme|Acme|type:company@@ today." }], { text: "About @@entity:acme|Acme|type:company@@ today." }, /citation\/entity token/],
    ["unbound [N] citation", [{ type: "text", text: "Revenue grew [1]." }], { text: "Revenue grew [1]." }, /unbound numeric citation/],
    ["gallery marker", [{ type: "text", text: "Done <!-- SOURCE_GALLERY_DATA [] -->" }], { text: "Done" }, /gallery\/selection marker/],
    ["file attachment", [{ type: "text", text: PROSE }, { type: "file", url: "https://x.dev/f.pdf", mediaType: "application/pdf" }], { text: PROSE }, /file attachment/],
    ["domain data part", [{ type: "text", text: PROSE }, { type: "data-goal-card", goal: "g", tasks: [] }], { text: PROSE }, /panel-specific renderer/],
    ["delegation tool", [{ type: "text", text: PROSE }, { type: "tool-delegateToWebAgent", toolCallId: "c", state: "output-available", input: {}, output: "ok" }], { text: PROSE }, /agent delegation/],
    ["convex tool", [{ type: "text", text: PROSE }, { type: "tool-convex_query", toolCallId: "c", state: "output-available", input: {}, output: "ok" }], { text: PROSE }, /convex transparency/],
    ["fusion search tool", [{ type: "text", text: PROSE }, { type: "tool-fusionSearch", toolCallId: "c", state: "output-available", input: {}, output: "ok" }], { text: PROSE }, /fusion search/],
    ["memory tool", [{ type: "text", text: PROSE }, { type: "tool-writeMemory", toolCallId: "c", state: "output-available", input: { key: "k" }, output: "ok" }], { text: PROSE }, /memory\/planning tool/],
  ])(
    "refuses %s with a named reason",
    (_label, parts, overrides, reasonPattern) => {
      const fit = fitFor(parts, overrides);
      expect(fit.adoptable).toBe(false);
      expect(fit.reasons.join("; ")).toMatch(reasonPattern);
    },
  );
});

describe("markdown-rich turns adopt with proseFormat=\"markdown\" (Phase C)", () => {
  it.each([
    ["code fence", "run:\n```sh\nls\n```"],
    ["markdown heading", "## Findings\nAcme raised."],
    ["markdown table", "| a | b |\n| 1 | 2 |"],
    ["markdown list", "Items:\n- one\n- two"],
    ["markdown link", "See [docs](https://x.dev)."],
  ])("adopts a completed turn with a %s", (_label, text) => {
    const msg = message([{ type: "text", text }], { text });
    const uiParts = convexToUIParts(msg);
    expect(describeCanonicalAnswerFit(uiParts, msg)).toEqual({
      adoptable: true,
      reasons: [],
    });
    expect(detectProseFormat(uiParts)).toBe("markdown");
    expect(buildCanonicalAnswerProps(uiParts, msg).proseFormat).toBe("markdown");
  });

  it("keeps plain prose on the plain format — inline emphasis is not a markdown signal", () => {
    const text = "Acme raised a *new* round and is hiring.";
    const msg = message([{ type: "text", text }], { text });
    const uiParts = convexToUIParts(msg);
    expect(detectProseFormat(uiParts)).toBe("plain");
    expect(buildCanonicalAnswerProps(uiParts, msg).proseFormat).toBe("plain");
  });

  it("still refuses markdown that carries a bare [N] reference — no cite binding is fabricated in either format", () => {
    const text = "## Findings\nRevenue grew [1].";
    const fit = fitFor([{ type: "text", text }], { text });
    expect(fit.adoptable).toBe(false);
    expect(fit.reasons.join("; ")).toMatch(/unbound numeric citation/);
  });
});

describe("buildCanonicalAnswerProps — honesty of the mapping", () => {
  const msg = message(
    [
      { type: "text", text: PROSE },
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "acme" },
        output: "Acme announced a Series B.",
      },
      {
        type: "tool-fetchPage",
        toolCallId: "call-2",
        state: "output-error",
        input: { url: "https://example.com" },
        errorText: "publisher blocked the fetch",
      },
      { type: "source-url", sourceId: "s1", url: "https://example.com/acme", title: "Acme Series B" },
      { type: "source-document", sourceId: "s2", mediaType: "application/pdf", title: "Board deck", filename: "deck.pdf" },
      { type: "reasoning", text: "checked coverage" },
    ],
    { text: PROSE, model: "gemini-3.5-flash" },
  );
  const props = buildCanonicalAnswerProps(convexToUIParts(msg), msg);

  it("carries the prose and leaves the memo-only fields honestly empty", () => {
    expect(props.packet.shortAnswer).toBe(PROSE);
    expect(props.packet.whyItMatters).toBe("");
    expect(props.packet.risks).toEqual([]);
    expect(props.packet.nextAction).toBe("");
    expect(props.proseFormat).toBe("plain");
  });

  it("never fabricates trace steps", () => {
    expect(props.packet.trace).toEqual([]);
    expect(props.packet.runtime).toBeUndefined();
  });

  it("maps sources to unverified evidence rows with empty quotes — no fake badges", () => {
    expect(props.packet.sourceCount).toBe(2);
    expect(props.packet.evidence).toHaveLength(2);
    for (const row of props.packet.evidence) {
      expect(row.quote).toBe("");
      expect("verified" in row).toBe(false);
      expect("verificationState" in row).toBe(false);
      expect("blocking" in row).toBe(false);
    }
    expect(props.packet.evidence[0].source).toContain("https://example.com/acme");
    expect(props.packet.evidence[1].source).toBe("Board deck");
  });

  it("maps tool parts to honest tool calls — real status, no invented duration", () => {
    expect(props.toolCalls).toEqual([
      {
        step: "webSearch",
        status: "ok",
        tool: "webSearch",
        resultPreview: "Acme announced a Series B.",
      },
      {
        step: "fetchPage",
        status: "error",
        tool: "fetchPage",
        detail: "publisher blocked the fetch",
      },
    ]);
    for (const call of props.toolCalls) {
      expect("durationMs" in call).toBe(false);
    }
  });

  it("labels the receipt with the actual model, falling back to a plain runtime label", () => {
    expect(props.receiptTierLabel).toBe("gemini-3.5-flash");
    const bare = message([{ type: "text", text: PROSE }], { text: PROSE });
    const bareProps = buildCanonicalAnswerProps(convexToUIParts(bare), bare);
    expect(bareProps.receiptTierLabel).toBe("agent run");
  });

  it("re-houses panel reasoning without renaming it into trace data", () => {
    expect(props.workingNotesMarkdown).toBe("checked coverage");
    expect(props.createdAt).toBe(1_752_000_000_000);
  });
});
