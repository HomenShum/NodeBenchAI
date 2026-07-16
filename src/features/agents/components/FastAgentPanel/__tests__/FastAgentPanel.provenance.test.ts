import type { UIMessage } from "@convex-dev/agent/react";
import { describe, expect, it } from "vitest";

import { collectConsultedArtifacts } from "../FastAgentPanel.provenance";

function assistant(parts: Array<Record<string, unknown>>): UIMessage {
  return {
    id: "assistant-1",
    key: "thread-1-0-0",
    order: 0,
    stepOrder: 0,
    status: "success",
    role: "assistant",
    parts,
  } as unknown as UIMessage;
}

describe("FastAgent consulted-source provenance", () => {
  it("does not promote a model-only source gallery marker", () => {
    const result = collectConsultedArtifacts([
      assistant([{
        type: "text",
        text: `Claim text
<!-- SOURCE_GALLERY_DATA
[{"title":"Model-only source","url":"https://example.com/model-only"}]
-->`,
      }]),
    ]);

    expect(result.media.webSources).toEqual([]);
  });

  it("keeps a source gallery returned by a completed tool as consulted", () => {
    const result = collectConsultedArtifacts([
      assistant([{
        type: "tool-linkupSearch",
        toolCallId: "linkup-1",
        state: "output-available",
        input: { query: "NodeBench" },
        output: `<!-- SOURCE_GALLERY_DATA
[{"title":"Runtime source","url":"https://example.com/runtime"}]
-->`,
      }]),
    ]);

    expect(result.media.webSources).toEqual([
      expect.objectContaining({
        title: "Runtime source",
        url: "https://example.com/runtime",
      }),
    ]);
  });

  it("keeps canonical source-url parts as consulted", () => {
    const result = collectConsultedArtifacts([
      assistant([{
        type: "source-url",
        sourceId: "source-1",
        title: "Provider source",
        url: "https://example.com/provider",
      }]),
    ]);

    expect(result.media.webSources).toEqual([
      {
        title: "Provider source",
        url: "https://example.com/provider",
      },
    ]);
  });

  it("does not promote an assistant-authored document marker", () => {
    const result = collectConsultedArtifacts([
      assistant([{
        type: "text",
        text: `<!-- DOCUMENT_ACTION_DATA
{"action":"created","documentId":"model-doc","title":"Model document"}
-->`,
      }]),
    ]);

    expect(result.documents).toEqual([]);
  });

  it("collects document actions only from successful tool output", () => {
    const action = {
      kind: "document_action",
      version: 1,
      data: {
        action: "created",
        documentId: "runtime-doc",
        title: "Runtime document",
      },
    };
    const result = collectConsultedArtifacts([
      assistant([
        {
          type: "tool-createDocument",
          toolCallId: "failed-doc",
          state: "output-error",
          input: {},
          output: action,
          errorText: "Rejected",
        },
        {
          type: "tool-createDocument",
          toolCallId: "successful-doc",
          state: "output-available",
          input: {},
          output: action,
        },
      ]),
    ]);

    expect(result.documents).toEqual([{
      action: "created",
      documentId: "runtime-doc",
      title: "Runtime document",
      isPublic: undefined,
      updatedFields: undefined,
    }]);
  });
});
