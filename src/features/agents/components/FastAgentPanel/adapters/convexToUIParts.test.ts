import type { UIMessage } from "@convex-dev/agent/react";
import { describe, expect, it } from "vitest";

import { convexToUIParts } from "./convexToUIParts";

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
    text: "materialized text",
    _creationTime: 1,
    role: "assistant",
    parts,
    ...overrides,
  } as unknown as UIMessage;
}

describe("convexToUIParts", () => {
  it("preserves the Convex materialized text, role, status, and streaming flag", () => {
    const result = convexToUIParts(
      message(
        [
          { type: "text", text: "part one" },
          { type: "text", text: "part two" },
        ],
        { role: "user", status: "streaming", text: "live materialized text" },
      ),
    );

    expect(result.from).toBe("user");
    expect(result.text).toBe("live materialized text");
    expect(result.status).toBe("streaming");
    expect(result.isStreaming).toBe(true);
  });

  it("falls back to ordered text parts for an unaugmented AI SDK message", () => {
    const input = message(
      [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
      { text: undefined },
    );

    expect(convexToUIParts(input).text).toBe("hello world");
  });

  it("joins reasoning parts in message order without mixing them into text", () => {
    const result = convexToUIParts(
      message([
        { type: "reasoning", text: "inspect" },
        { type: "text", text: "answer" },
        { type: "reasoning", text: "verify" },
      ]),
    );

    expect(result.reasoning).toBe("inspect\nverify");
    expect(result.text).toBe("materialized text");
  });

  it("passes valid AI SDK v5 unified tool parts through by identity", () => {
    const tool = {
      type: "tool-webSearch",
      toolCallId: "call-1",
      state: "output-available",
      input: { query: "NodeBench" },
      output: { results: ["one"] },
      callProviderMetadata: { openai: { cached: true } },
    };

    const result = convexToUIParts(message([tool]));

    expect(result.toolParts).toHaveLength(1);
    expect(result.toolParts[0]).toBe(tool);
  });

  it.each([
    [
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        args: { query: "q" },
        status: "running",
      },
      "input-streaming",
      { input: { query: "q" } },
    ],
    [
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        args: { query: "q" },
        result: { ok: true },
      },
      "output-available",
      { input: { query: "q" }, output: { ok: true } },
    ],
    [
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        args: { query: "q" },
        error: "network",
      },
      "output-error",
      { input: { query: "q" }, errorText: "network" },
    ],
    [
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        state: "input-available",
        input: { query: "q" },
        errorText: "provider failed",
      },
      "output-error",
      { input: { query: "q" }, errorText: "provider failed" },
    ],
  ])(
    "normalizes incomplete unified tool parts (%s)",
    (tool, state, expected) => {
      const normalized = convexToUIParts(message([tool])).toolParts[0];

      expect(normalized).toMatchObject({
        type: "tool-webSearch",
        toolCallId: "call-1",
        state,
        ...expected,
      });
      expect(normalized).not.toBe(tool);
    },
  );

  it("merges legacy split tool-call and tool-result parts by call id", () => {
    const input = { query: "funding" };
    const output = { results: ["Acme"] };
    const call = {
      type: "tool-call",
      toolName: "fusionSearch",
      toolCallId: "call-7",
      args: input,
    };
    const resultPart = {
      type: "tool-result",
      toolName: "fusionSearch",
      toolCallId: "call-7",
      output,
    };

    const [tool] = convexToUIParts(message([call, resultPart])).toolParts;

    expect(tool).toMatchObject({
      type: "tool-fusionSearch",
      toolCallId: "call-7",
      state: "output-available",
    });
    expect(tool.input).toBe(input);
    expect(tool.state === "output-available" && tool.output).toBe(output);
    expect(tool).not.toHaveProperty("args");
    expect(tool).not.toHaveProperty("result");
    expect(call).not.toHaveProperty("state");
    expect(resultPart.type).toBe("tool-result");
  });

  it("merges typed, id-less legacy call/result pairs using the tool name", () => {
    const output = { value: "done" };
    const tools = convexToUIParts(
      message([
        { type: "tool-call-secCompanySearch", args: { ticker: "NB" } },
        { type: "tool-result-secCompanySearch", result: output },
      ]),
    ).toolParts;

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "tool-secCompanySearch",
      state: "output-available",
      toolCallId: "legacy:message-1:secCompanySearch:1",
      input: { ticker: "NB" },
    });
    expect(tools[0].state === "output-available" && tools[0].output).toBe(
      output,
    );
  });

  it("pairs repeated id-less legacy calls and results in invocation order", () => {
    const tools = convexToUIParts(
      message([
        { type: "tool-call-fetchUrl", args: { page: 1 } },
        { type: "tool-call-fetchUrl", args: { page: 2 } },
        { type: "tool-result-fetchUrl", result: "first" },
        { type: "tool-result-fetchUrl", result: "second" },
      ]),
    ).toolParts;

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ input: { page: 1 }, output: "first" });
    expect(tools[1]).toMatchObject({ input: { page: 2 }, output: "second" });
  });

  it("normalizes legacy tool errors and keeps the original input object", () => {
    const input = { url: "https://example.com" };
    const [tool] = convexToUIParts(
      message([
        {
          type: "tool-call",
          toolName: "fetchUrl",
          toolCallId: "fetch-1",
          args: input,
        },
        {
          type: "tool-error",
          toolName: "fetchUrl",
          toolCallId: "fetch-1",
          error: "timeout",
        },
      ]),
    ).toolParts;

    expect(tool).toMatchObject({
      type: "tool-fetchUrl",
      state: "output-error",
      errorText: "timeout",
    });
    expect(tool.input).toBe(input);
    expect(tool).not.toHaveProperty("error");
    expect(tool).not.toHaveProperty("output");
  });

  it("does not reuse a completed explicit call for a later id-less result", () => {
    const tools = convexToUIParts(
      message([
        {
          type: "tool-call",
          toolName: "fetchUrl",
          toolCallId: "fetch-1",
          args: { page: 1 },
        },
        {
          type: "tool-result",
          toolName: "fetchUrl",
          toolCallId: "fetch-1",
          result: "first",
        },
        { type: "tool-result", toolName: "fetchUrl", result: "second" },
      ]),
    ).toolParts;

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ toolCallId: "fetch-1", output: "first" });
    expect(tools[1]).toMatchObject({
      toolCallId: "legacy:message-1:fetchUrl:3",
      output: "second",
    });
  });

  it("keeps standalone legacy results instead of dropping completed work", () => {
    const output = { rows: 3 };
    const [tool] = convexToUIParts(
      message([{ type: "tool-result", toolName: "queryRows", output }]),
    ).toolParts;

    expect(tool).toMatchObject({
      type: "tool-queryRows",
      state: "output-available",
      toolCallId: "legacy:message-1:queryRows:1",
    });
    expect(tool.state === "output-available" && tool.output).toBe(output);
  });

  it("supports dynamic tool parts without flattening their tool name", () => {
    const dynamic = {
      type: "dynamic-tool",
      toolName: "customerTool",
      toolCallId: "dynamic-1",
      state: "input-available",
      input: { id: 1 },
    };

    const [tool] = convexToUIParts(message([dynamic])).toolParts;

    expect(tool).toBe(dynamic);
    expect(tool).toMatchObject({
      type: "dynamic-tool",
      toolName: "customerTool",
    });
  });

  it("exposes one ordered render owner for each generic message part", () => {
    const text = { type: "text", text: "before" };
    const tool = {
      type: "tool-webSearch",
      toolCallId: "search-1",
      state: "input-available",
      input: { query: "NodeBench" },
    };
    const reasoning = { type: "reasoning", text: "checking" };
    const domain = {
      type: "data-verification-receipt",
      data: { passed: true },
    };
    const source = {
      type: "source-url",
      sourceId: "source-1",
      url: "https://example.com",
    };
    const file = {
      type: "file",
      mediaType: "image/png",
      url: "https://example.com/chart.png",
    };

    const result = convexToUIParts(
      message([text, tool, reasoning, domain, source, file]),
    );

    expect(
      result.renderParts.map(({ kind, originalIndex }) => ({
        kind,
        originalIndex,
      })),
    ).toEqual([
      { kind: "text", originalIndex: 0 },
      { kind: "tool", originalIndex: 1 },
      { kind: "reasoning", originalIndex: 2 },
      { kind: "domain", originalIndex: 3 },
      { kind: "source", originalIndex: 4 },
      { kind: "file", originalIndex: 5 },
    ]);
    expect(result.renderParts[0]?.part).toBe(text);
    expect(result.renderParts[1]?.part).toBe(tool);
    expect(result.renderParts[2]?.part).toBe(reasoning);
    expect(result.renderParts[3]?.part).toBe(domain);
    expect(result.renderParts[4]?.part).toBe(source);
    expect(result.renderParts[5]?.part).toBe(file);
  });

  it("gives a unified domain tool exactly one render owner", () => {
    const domainTool = {
      type: "tool-fusionSearch",
      toolCallId: "fusion-1",
      state: "output-available",
      input: { query: "NodeBench" },
      output:
        "<!-- FUSION_SEARCH_DATA\n{}\n-->\n<!-- SOURCE_GALLERY_DATA\n[]\n-->",
    };

    const result = convexToUIParts(message([domainTool]));

    expect(result.renderParts).toHaveLength(1);
    expect(result.renderParts[0]).toMatchObject({
      kind: "domain-tool",
      originalIndex: 0,
      categories: ["media", "fusedSearch"],
    });
    expect(result.renderParts[0]?.part).toBe(domainTool);
    expect(
      result.renderParts[0]?.kind === "domain-tool" &&
        result.renderParts[0].domainPart,
    ).toBe(domainTool);
    expect(result.toolParts).toEqual([domainTool]);
    expect(result.domainParts.all).toEqual([domainTool]);
  });

  it("merges an id-less legacy domain tool into one ordered render owner", () => {
    const call = {
      type: "tool-call-fusionSearch",
      args: { query: "NodeBench" },
    };
    const text = { type: "text", text: "interleaved" };
    const resultPart = {
      type: "tool-result-fusionSearch",
      result: "<!-- FUSION_SEARCH_DATA\n{}\n-->",
    };

    const result = convexToUIParts(message([call, text, resultPart]));

    expect(
      result.renderParts.map(({ kind, originalIndex }) => ({
        kind,
        originalIndex,
      })),
    ).toEqual([
      { kind: "domain-tool", originalIndex: 0 },
      { kind: "text", originalIndex: 1 },
    ]);
    const owner = result.renderParts[0];
    expect(owner).toMatchObject({
      kind: "domain-tool",
      categories: ["fusedSearch"],
      part: {
        type: "tool-fusionSearch",
        toolCallId: "legacy:message-1:fusionSearch:1",
        state: "output-available",
        input: { query: "NodeBench" },
        output: "<!-- FUSION_SEARCH_DATA\n{}\n-->",
      },
    });
    expect(owner?.kind === "domain-tool" && owner.domainPart).toBe(resultPart);
    expect(owner?.kind === "domain-tool" && owner.rawParts).toEqual([
      call,
      resultPart,
    ]);
  });

  it("rebuilds Convex output errors that carry an AI SDK-forbidden output", () => {
    const input = { url: "https://example.com" };
    const malformed = {
      type: "tool-fetchUrl",
      toolCallId: "fetch-1",
      state: "output-error",
      input,
      output: { partial: true },
      errorText: "timeout",
      callProviderMetadata: { openai: { requestId: "req-1" } },
    };

    const [tool] = convexToUIParts(message([malformed])).toolParts;

    expect(tool).not.toBe(malformed);
    expect(tool).toMatchObject({
      type: "tool-fetchUrl",
      toolCallId: "fetch-1",
      state: "output-error",
      input,
      errorText: "timeout",
      callProviderMetadata: { openai: { requestId: "req-1" } },
    });
    expect(tool).not.toHaveProperty("output");
  });

  it("passes a state-valid unified output error through by identity", () => {
    const valid = {
      type: "tool-fetchUrl",
      toolCallId: "fetch-valid",
      state: "output-error",
      input: { url: "https://example.com" },
      errorText: "timeout",
    };

    const [tool] = convexToUIParts(message([valid])).toolParts;

    expect(tool).toBe(valid);
  });

  it("rebuilds terminal unified tools whose required state field is missing", () => {
    const outputAvailable = {
      type: "tool-voidAction",
      toolCallId: "void-1",
      state: "output-available",
      input: { id: 1 },
    };
    const outputError = {
      type: "tool-fetchUrl",
      toolCallId: "fetch-2",
      state: "output-error",
      input: { url: "https://example.com" },
    };

    const [normalizedOutput, normalizedError] = convexToUIParts(
      message([outputAvailable, outputError]),
    ).toolParts;

    expect(normalizedOutput).not.toBe(outputAvailable);
    expect(normalizedOutput).toMatchObject({
      state: "output-available",
      input: { id: 1 },
    });
    expect(normalizedOutput).toHaveProperty("output", undefined);

    expect(normalizedError).not.toBe(outputError);
    expect(normalizedError).toMatchObject({
      state: "output-error",
      input: { url: "https://example.com" },
      errorText: "Tool execution failed",
    });
    expect(normalizedError).not.toHaveProperty("output");
  });

  it("preserves source and file objects by identity", () => {
    const urlSource = {
      type: "source-url",
      sourceId: "source-1",
      url: "https://example.com",
      title: "Example",
    };
    const documentSource = {
      type: "source-document",
      sourceId: "source-2",
      mediaType: "application/pdf",
      title: "Filing",
      filename: "filing.pdf",
    };
    const file = {
      type: "file",
      mediaType: "image/png",
      url: "https://example.com/chart.png",
    };

    const result = convexToUIParts(message([urlSource, documentSource, file]));

    expect(result.sources).toEqual([urlSource, documentSource]);
    expect(result.sources[0]).toBe(urlSource);
    expect(result.sources[1]).toBe(documentSource);
    expect(result.fileParts).toEqual([file]);
    expect(result.fileParts[0]).toBe(file);
  });

  it("routes every known domain category by reference and preserves order", () => {
    const selection = {
      type: "data-company_selection",
      data: { companies: [] },
    };
    const arbitrage = {
      type: "data-arbitrage-report",
      data: { contradictions: [] },
    };
    const media = { type: "data-mediaGallery", data: { videos: [] } };
    const goal = { type: "data-goal-card", data: { goal: "Ship" } };
    const fused = { type: "data-fused-search", data: { results: [] } };
    const document = { type: "data-document-action", data: { id: "doc-1" } };
    const edit = { type: "data-edit-progress", data: { status: "running" } };
    const unknown = {
      type: "data-verification-receipt",
      data: { passed: true },
    };

    const { domainParts } = convexToUIParts(
      message([
        selection,
        arbitrage,
        media,
        goal,
        fused,
        document,
        edit,
        unknown,
      ]),
    );

    expect(domainParts.all).toEqual([
      selection,
      arbitrage,
      media,
      goal,
      fused,
      document,
      edit,
      unknown,
    ]);
    expect(domainParts.selection[0]).toBe(selection);
    expect(domainParts.arbitrage[0]).toBe(arbitrage);
    expect(domainParts.media[0]).toBe(media);
    expect(domainParts.goalCard[0]).toBe(goal);
    expect(domainParts.fusedSearch[0]).toBe(fused);
    expect(domainParts.documentAction[0]).toBe(document);
    expect(domainParts.editProgress[0]).toBe(edit);
    expect(domainParts.other[0]).toBe(unknown);
  });

  it("routes legacy non-data domain parts without cloning them", () => {
    const selection = { type: "company_selection", options: [{ id: "acme" }] };

    const { domainParts } = convexToUIParts(message([selection]));

    expect(domainParts.selection).toHaveLength(1);
    expect(domainParts.selection[0]).toBe(selection);
  });

  it("routes structured legacy tool results to custom renderers by identity", () => {
    const selection = {
      type: "tool-result",
      toolName: "searchCompanies",
      toolCallId: "selection-1",
      output: {
        kind: "company_selection",
        version: 1,
        summary: "Choose a company",
        data: { companies: [] },
      },
    };
    const document = {
      type: "tool-result-createDocument",
      toolCallId: "document-1",
      result: '<!-- DOCUMENT_ACTION_DATA\n{"id":"doc-1"}\n-->',
    };

    const { domainParts } = convexToUIParts(message([selection, document]));

    expect(domainParts.all).toEqual([selection, document]);
    expect(domainParts.selection[0]).toBe(selection);
    expect(domainParts.documentAction[0]).toBe(document);
  });

  it("routes live unified tool parts to every applicable domain renderer", () => {
    const fusedWithMedia = {
      type: "tool-fusionSearch",
      toolCallId: "fusion-1",
      state: "output-available",
      input: { query: "NodeBench" },
      output:
        "<!-- FUSION_SEARCH_DATA\n{}\n-->\n<!-- SOURCE_GALLERY_DATA\n[]\n-->",
    };
    const delegation = {
      type: "tool-delegateToResearchAgent",
      toolCallId: "delegate-1",
      state: "input-available",
      input: { goal: "Research" },
    };
    const arbitrage = {
      type: "tool-contradictionDetection",
      toolCallId: "arbitrage-1",
      state: "output-available",
      input: {},
      output: { contradictions: [] },
    };

    const { domainParts } = convexToUIParts(
      message([fusedWithMedia, delegation, arbitrage]),
    );

    expect(domainParts.fusedSearch[0]).toBe(fusedWithMedia);
    expect(domainParts.media[0]).toBe(fusedWithMedia);
    expect(domainParts.goalCard[0]).toBe(delegation);
    expect(domainParts.arbitrage[0]).toBe(arbitrage);
    expect(domainParts.all).toEqual([fusedWithMedia, delegation, arbitrage]);
  });

  it("does not emit persistent-text-streaming bodies or message-only stream fields", () => {
    const streamBody = {
      type: "data-persistentTextStreaming",
      data: { body: "must remain in useStream" },
    };
    const input = message([
      streamBody,
      { type: "text", text: "safe" },
    ]) as UIMessage & {
      streamId: string;
      streamBody: string;
    };
    input.streamId = "stream-1";
    input.streamBody = "private stream body";

    const result = convexToUIParts(input);

    expect(result.domainParts.all).toEqual([]);
    expect(result.renderParts).toMatchObject([
      { kind: "text", originalIndex: 1 },
    ]);
    expect(result).not.toHaveProperty("streamId");
    expect(result).not.toHaveProperty("streamBody");
    expect(JSON.stringify(result)).not.toContain("private stream body");
    expect(JSON.stringify(result)).not.toContain("must remain in useStream");
  });

  it.each(["pending", "success", "failed"] as const)(
    "does not label %s messages as streaming",
    (status) => {
      const result = convexToUIParts(message([], { status }));

      expect(result.status).toBe(status);
      expect(result.isStreaming).toBe(false);
    },
  );

  it("preserves unknown custom parts while ignoring malformed and step boundary parts", () => {
    const futureDomainPart = {
      type: "verification-receipt",
      value: { passed: true },
    };
    const result = convexToUIParts(
      message([
        { type: "step-start" },
        futureDomainPart,
        { value: "missing type" },
      ]),
    );

    expect(result.toolParts).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.domainParts.all).toEqual([futureDomainPart]);
    expect(result.domainParts.other[0]).toBe(futureDomainPart);
  });
});
