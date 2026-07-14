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
      id: 'search-1-1',
      status: 'success',
      title: 'fusionSearch',
      toolName: 'fusionSearch',
      type: 'tool_end',
    });
  });

  it('uses unified errorText and treats output-denied as an error terminal', () => {
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
        status: 'error',
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
});
