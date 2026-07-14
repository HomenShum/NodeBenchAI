import type { LiveEvent } from './LiveEventCard';

type MessagePart = Record<string, unknown> & { type?: unknown };
type MessageRecord = Record<string, unknown> & {
  message?: unknown;
  parts?: unknown;
  role?: unknown;
};

type UnifiedToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

const UNIFIED_EVENT_BY_STATE: Record<
  UnifiedToolState,
  Pick<LiveEvent, 'status' | 'type'>
> = {
  'input-streaming': { status: 'pending', type: 'tool_start' },
  'input-available': { status: 'running', type: 'tool_start' },
  'output-available': { status: 'success', type: 'tool_end' },
  'output-error': { status: 'error', type: 'tool_error' },
  'output-denied': { status: 'error', type: 'tool_error' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function toToolName(part: MessagePart): string {
  const explicit = nonEmptyString(part.toolName) ?? nonEmptyString(part.name);
  if (explicit) return explicit;

  const type = typeof part.type === 'string' ? part.type : '';
  const typed = type.match(/^tool-(?:call|result|error)-(.+)$/);
  if (typed?.[1]) return typed[1];

  const unified = type.match(/^tool-(.+)$/);
  if (unified?.[1]) return unified[1];
  return 'unknown';
}

function terminalOutputDetails(part: MessagePart): string | undefined {
  const output = firstPresent(part.output, part.result);
  if (typeof output === 'string') {
    return output.length > 0 ? output.slice(0, 160) : undefined;
  }
  return output === undefined ? undefined : 'Completed';
}

function unifiedErrorDetails(part: MessagePart): string {
  const error = nonEmptyString(part.errorText) ?? firstPresent(part.error);
  return error === undefined
    ? 'Tool execution failed'
    : String(error).slice(0, 160);
}

function unifiedToolEvent(part: MessagePart): {
  details?: string;
  status: LiveEvent['status'];
  type: LiveEvent['type'];
} {
  const state =
    typeof part.state === 'string' && hasOwn(UNIFIED_EVENT_BY_STATE, part.state)
      ? (part.state as UnifiedToolState)
      : undefined;
  const eventState = state
    ? UNIFIED_EVENT_BY_STATE[state]
    : UNIFIED_EVENT_BY_STATE['input-available'];

  if (eventState.type === 'tool_end') {
    return { ...eventState, details: terminalOutputDetails(part) };
  }
  if (eventState.type === 'tool_error') {
    return { ...eventState, details: unifiedErrorDetails(part) };
  }
  return {
    ...eventState,
    details: eventState.status === 'pending' ? 'Preparing...' : 'Executing...',
  };
}

/**
 * Translate the actual `useUIMessages` payload into the live-activity contract.
 * Convex Agent emits unified AI SDK tool parts and updates their `state` in
 * place; older stored messages can still contain split call/result/error parts.
 */
export function extractLiveEventsFromUIMessages(
  streamingMessages: readonly unknown[]
): LiveEvent[] {
  const events: LiveEvent[] = [];
  let eventCounter = 0;

  for (const rawValue of streamingMessages) {
    if (!isRecord(rawValue)) continue;
    const raw = rawValue as MessageRecord;
    const nestedMessage = isRecord(raw.message)
      ? (raw.message as MessageRecord)
      : undefined;
    const message = nestedMessage ?? raw;
    const role = message.role ?? raw.role;
    const rawParts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(raw.parts)
        ? raw.parts
        : [];
    if (role !== 'assistant' || rawParts.length === 0) continue;

    const baseTimestamp =
      typeof raw._creationTime === 'number'
        ? raw._creationTime
        : typeof message._creationTime === 'number'
          ? message._creationTime
          : Date.now();

    for (const rawPart of rawParts) {
      if (!isRecord(rawPart)) continue;
      const part = rawPart as MessagePart;
      const partType = typeof part.type === 'string' ? part.type : '';
      const isLegacyResult =
        partType === 'tool-result' || partType.startsWith('tool-result-');
      const isLegacyError =
        partType === 'tool-error' || partType.startsWith('tool-error-');
      const isLegacyCall =
        partType === 'tool-call' || partType.startsWith('tool-call-');
      const isUnifiedTool =
        partType === 'dynamic-tool' ||
        (partType.startsWith('tool-') &&
          !isLegacyCall &&
          !isLegacyResult &&
          !isLegacyError);
      if (
        !isLegacyCall &&
        !isLegacyResult &&
        !isLegacyError &&
        !isUnifiedTool
      ) {
        continue;
      }

      const toolName = toToolName(part);
      const toolCallId = nonEmptyString(part.toolCallId);
      const idBase =
        toolCallId ??
        nonEmptyString(raw._id) ??
        nonEmptyString(raw.id) ??
        nonEmptyString(message._id) ??
        nonEmptyString(message.id) ??
        'msg';
      const timestamp = baseTimestamp + eventCounter;
      eventCounter += 1;

      if (isUnifiedTool) {
        const unifiedEvent = unifiedToolEvent(part);
        events.push({
          id: `${idBase}-${eventCounter}`,
          title: toolName,
          toolName,
          timestamp,
          ...unifiedEvent,
        });
        continue;
      }

      const result = firstPresent(part.output, part.result);
      const error = firstPresent(part.error, part.output, part.result);
      events.push({
        id: `${idBase}-${eventCounter}`,
        type: isLegacyError
          ? 'tool_error'
          : isLegacyResult
            ? 'tool_end'
            : 'tool_start',
        status: isLegacyError
          ? 'error'
          : isLegacyResult
            ? 'success'
            : 'running',
        title: toolName,
        toolName,
        details:
          isLegacyResult && result
            ? typeof result === 'string'
              ? result.slice(0, 160)
              : 'Completed'
            : isLegacyError && error
              ? String(error).slice(0, 160)
              : isLegacyCall
                ? 'Executing...'
                : undefined,
        timestamp,
      });
    }
  }

  return events;
}
