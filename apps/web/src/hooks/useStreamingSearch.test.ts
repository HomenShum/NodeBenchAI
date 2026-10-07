import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStreamingSearch } from "./useStreamingSearch";

function createBrokenStreamResponse() {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"tools":[],"totalTools":4}\n\n' +
              'event: tool_done\ndata: {"tool":"web_search","step":1,"preview":{"topSources":[{"id":"preview-source","label":"SoftBank source","href":"https://example.com"}]}}\n\n',
          ),
        );
        controller.error(new TypeError("network error"));
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

function createFallbackPacketResponse() {
  return new Response(
    JSON.stringify({
      resultPacket: {
        answer: "Recovered answer",
        sourceRefs: [
          {
            id: "src:1",
            label: "Recovered source",
            href: "https://example.com/recovered",
          },
        ],
      },
      latencyMs: 321,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("useStreamingSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recovers from a terminal stream reset by fetching the final packet over JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createBrokenStreamResponse())
      .mockResolvedValueOnce(createFallbackPacketResponse());

    vi.stubGlobal("fetch", fetchMock);

    const onComplete = vi.fn();
    const { result } = renderHook(() => useStreamingSearch());

    await act(async () => {
      result.current.startStream("What matters most about SoftBank right now?", "investor", {
        onComplete,
      });
    });

    await waitFor(() => {
      expect(result.current.result).toMatchObject({
        answer: "Recovered answer",
      });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.totalDurationMs).toBe(321);
    expect(result.current.sourcePreview[0]?.label).toBe("Recovered source");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores stale completions from an older aborted run", async () => {
    const encoder = new TextEncoder();
    const staleChunk = createDeferred<ReadableStreamReadResult<Uint8Array>>();

    const staleReader = {
      read: vi
        .fn()
        .mockImplementationOnce(() => staleChunk.promise)
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const freshReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(
            'event: complete\ndata: {"packet":{"answer":"Fresh answer","sourceRefs":[{"id":"fresh-source","label":"Fresh source","href":"https://example.com/fresh"}]}}\n\n',
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => staleReader,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => freshReader,
        },
      });

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useStreamingSearch());

    await act(async () => {
      result.current.startStream("stale run", "founder");
    });

    await act(async () => {
      result.current.startStream("fresh run", "investor");
    });

    await waitFor(() => {
      expect(result.current.result).toMatchObject({
        answer: "Fresh answer",
      });
    });

    await act(async () => {
      staleChunk.resolve({
        done: false,
        value: encoder.encode(
          'event: complete\ndata: {"packet":{"answer":"Stale answer","sourceRefs":[{"id":"stale-source","label":"Stale source"}]}}\n\n',
        ),
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.result).toMatchObject({
        answer: "Fresh answer",
      });
    });

    expect(result.current.sourcePreview[0]?.label).toBe("Fresh source");
  });
});
