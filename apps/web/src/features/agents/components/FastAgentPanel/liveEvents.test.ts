import { describe, expect, it } from 'vitest';

import { extractLiveEventsFromUIMessages } from './liveEvents';

type TestPart = Record<string, unknown> & { type: string };

function streamingMessages(parts: TestPart[]) {
  return [
    {
      _creationTime: 1_000,
      _id: 'stored-message-1',
      message: {
        id: 'message-1',
        parts,
        role: 'assistant',
      },
    },
  ];
}

describe('extractLiveEventsFromUIMessages', () => {
  it('maps a unified output-available tool to one successful terminal event', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          input: { query: 'NodeBench' },
          output: { results: 3 },
          state: 'output-available',
          toolCallId: 'search-1',
          type: 'tool-fusionSearch',
        },
      ])
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      details: 'Completed',
      id: 'search-1-unified',
      status: 'success',
      title: 'fusionSearch',
      toolName: 'fusionSearch',
      type: 'tool_end',
    });
  });

  it('uses unified errorText and preserves output-denied as a denied terminal', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          errorText: 'Provider failed safely',
          input: { url: 'https://example.com' },
          state: 'output-error',
          toolCallId: 'fetch-1',
          type: 'tool-fetchUrl',
        },
        {
          errorText: 'Approval denied',
          input: { id: 'doc-1' },
          state: 'output-denied',
          toolCallId: 'write-1',
          type: 'tool-writeDocument',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Provider failed safely',
        status: 'error',
        type: 'tool_error',
      },
      {
        details: 'Approval denied',
        status: 'denied',
        type: 'tool_error',
      },
    ]);
  });

  it('forces a terminal error when unified errorText arrives before state catches up', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          errorText: 'Provider failed safely',
          input: { url: 'https://example.com' },
          state: 'input-available',
          toolCallId: 'fetch-lagging-state',
          type: 'tool-fetchUrl',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Provider failed safely',
        id: 'fetch-lagging-state-unified',
        status: 'error',
        type: 'tool_error',
      },
    ]);
  });

  it('fails closed by skipping an unrecognized unified state without error evidence', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          input: { query: 'NodeBench' },
          state: 'mystery-state',
          toolCallId: 'unknown-state-1',
          type: 'tool-webSearch',
        },
      ])
    );

    expect(events).toEqual([]);
  });

  it('uses honest denial fallback copy when the provider omits a denial reason', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          input: { id: 'doc-1' },
          state: 'output-denied',
          toolCallId: 'write-denied',
          type: 'tool-writeDocument',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Tool execution denied',
        id: 'write-denied-unified',
        status: 'denied',
        type: 'tool_error',
      },
    ]);
  });

  it('distinguishes unified input-streaming pending from input-available running', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          input: '',
          state: 'input-streaming',
          toolCallId: 'pending-1',
          type: 'tool-webSearch',
        },
        {
          input: { query: 'NodeBench' },
          state: 'input-available',
          toolCallId: 'running-1',
          type: 'tool-webSearch',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Preparing...',
        status: 'pending',
        type: 'tool_start',
      },
      {
        details: 'Executing...',
        status: 'running',
        type: 'tool_start',
      },
    ]);
  });

  it('keeps a dynamic tool name and unified terminal state', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          input: { company: 'NodeBench' },
          output: 'Saved',
          state: 'output-available',
          toolCallId: 'dynamic-1',
          toolName: 'customerTool',
          type: 'dynamic-tool',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Saved',
        status: 'success',
        title: 'customerTool',
        toolName: 'customerTool',
        type: 'tool_end',
      },
    ]);
  });

  it('preserves legacy call, result, and error compatibility', () => {
    const events = extractLiveEventsFromUIMessages(
      streamingMessages([
        {
          args: { query: 'NodeBench' },
          toolCallId: 'legacy-call',
          toolName: 'legacySearch',
          type: 'tool-call',
        },
        {
          output: 'Found three results',
          toolCallId: 'legacy-result',
          toolName: 'legacySearch',
          type: 'tool-result',
        },
        {
          error: 'Legacy provider failed',
          toolCallId: 'legacy-error',
          toolName: 'legacySearch',
          type: 'tool-error',
        },
      ])
    );

    expect(events).toMatchObject([
      {
        details: 'Executing...',
        status: 'running',
        type: 'tool_start',
      },
      {
        details: 'Found three results',
        status: 'success',
        type: 'tool_end',
      },
      {
        details: 'Legacy provider failed',
        status: 'error',
        type: 'tool_error',
      },
    ]);
  });

  it('keeps a tool event id stable when an unrelated earlier part is prepended', () => {
    const targetPart: TestPart = {
      input: { query: 'NodeBench' },
      state: 'input-available',
      toolCallId: 'stable-target',
      type: 'tool-webSearch',
    };
    const unrelatedPart: TestPart = {
      input: { id: 'doc-1' },
      state: 'output-available',
      toolCallId: 'unrelated-earlier',
      type: 'tool-readDocument',
    };

    const beforeId = extractLiveEventsFromUIMessages(
      streamingMessages([targetPart])
    )[0]?.id;
    const afterId = extractLiveEventsFromUIMessages(
      streamingMessages([unrelatedPart, targetPart])
    ).find((event) => event.toolName === 'webSearch')?.id;

    expect(beforeId).toBe('stable-target-unified');
    expect(afterId).toBe(beforeId);
  });

  it('creates deterministic collision-safe ids for legacy events sharing a tool call id', () => {
    const parts: TestPart[] = [
      {
        args: { query: 'NodeBench' },
        toolCallId: 'shared-call',
        toolName: 'legacySearch',
        type: 'tool-call',
      },
      {
        output: 'Found three results',
        toolCallId: 'shared-call',
        toolName: 'legacySearch',
        type: 'tool-result',
      },
      {
        error: 'Legacy provider failed',
        toolCallId: 'shared-call',
        toolName: 'legacySearch',
        type: 'tool-error',
      },
    ];

    const firstIds = extractLiveEventsFromUIMessages(streamingMessages(parts)).map(
      (event) => event.id
    );
    const secondIds = extractLiveEventsFromUIMessages(streamingMessages(parts)).map(
      (event) => event.id
    );

    expect(firstIds).toEqual([
      'shared-call-call',
      'shared-call-result',
      'shared-call-error',
    ]);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(secondIds).toEqual(firstIds);
  });

  it('uses a deterministic suffix when fallback source fingerprints collide', () => {
    const part: TestPart = {
      input: { query: 'NodeBench' },
      state: 'input-available',
      type: 'tool-webSearch',
    };

    const firstIds = extractLiveEventsFromUIMessages(
      streamingMessages([part, { ...part }])
    ).map((event) => event.id);
    const secondIds = extractLiveEventsFromUIMessages(
      streamingMessages([part, { ...part }])
    ).map((event) => event.id);

    expect(firstIds[0]).toMatch(/^stored-message-1-unified-[a-z0-9]+$/);
    expect(firstIds[1]).toBe(`${firstIds[0]}-2`);
    expect(secondIds).toEqual(firstIds);
  });
});
