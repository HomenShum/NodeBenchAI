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
  'output-denied': { status: 'denied', type: 'tool_error' },
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

function unifiedDeniedDetails(part: MessagePart): string {
  const reason =
    nonEmptyString(part.errorText) ??
    nonEmptyString(part.denialReason) ??
    nonEmptyString(part.reason) ??
    nonEmptyString(part.error);
  return reason?.slice(0, 160) ?? 'Tool execution denied';
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '"[Circular]"';

  seen.add(value);
  if (Array.isArray(value)) {
    const serialized = `[${value
      .map((entry) => stableSerialize(entry, seen))
      .join(',')}]`;
    seen.delete(value);
    return serialized;
  }

  const serialized = `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(
          (value as Record<string, unknown>)[key],
          seen
        )}`
    )
    .join(',')}}`;
  seen.delete(value);
  return serialized;
}

function stableHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function eventIdBase(
  part: MessagePart,
  semantic: 'call' | 'error' | 'result' | 'unified',
  sourceIdentity?: string
): string {
  const toolCallId = nonEmptyString(part.toolCallId);
  if (toolCallId) return `${toolCallId}-${semantic}`;

  const fingerprint = stableHash(part);
  return sourceIdentity
    ? `${sourceIdentity}-${semantic}-${fingerprint}`
    : `part-${semantic}-${fingerprint}`;
}

function allocateEventId(
  base: string,
  occurrences: Map<string, number>
): string {
  const occurrence = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

function unifiedToolEvent(part: MessagePart): {
  details?: string;
  status: LiveEvent['status'];
  type: LiveEvent['type'];
} | null {
  const state =
    typeof part.state === 'string' && hasOwn(UNIFIED_EVENT_BY_STATE, part.state)
      ? (part.state as UnifiedToolState)
      : undefined;
  const errorText = nonEmptyString(part.errorText);

  if (state === 'output-denied') {
    return {
      ...UNIFIED_EVENT_BY_STATE[state],
      details: unifiedDeniedDetails(part),
    };
  }

  // Convex Agent can attach tool-error delta text before advancing the part's
  // state. Error evidence must win over a stale running/success state.
  if (errorText) {
    return {
      ...UNIFIED_EVENT_BY_STATE['output-error'],
      details: unifiedErrorDetails(part),
    };
  }

  // Unknown future states must not be presented as work that is definitely
  // running. Skip them until the adapter knows their honest semantics.
  if (!state) return null;

  const eventState = UNIFIED_EVENT_BY_STATE[state];

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
  const idOccurrences = new Map<string, number>();

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
    const sourceIdentity =
      nonEmptyString(raw._id) ??
      nonEmptyString(raw.id) ??
      nonEmptyString(message._id) ??
      nonEmptyString(message.id);

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

      if (isUnifiedTool) {
        const unifiedEvent = unifiedToolEvent(part);
        if (!unifiedEvent) continue;
        const timestamp = baseTimestamp + eventCounter;
        eventCounter += 1;
        events.push({
          id: allocateEventId(
            eventIdBase(part, 'unified', sourceIdentity),
            idOccurrences
          ),
          title: toolName,
          toolName,
          timestamp,
          ...unifiedEvent,
        });
        continue;
      }

      const result = firstPresent(part.output, part.result);
      const error = firstPresent(part.error, part.output, part.result);
      const semantic = isLegacyError
        ? 'error'
        : isLegacyResult
          ? 'result'
          : 'call';
      const timestamp = baseTimestamp + eventCounter;
      eventCounter += 1;
      events.push({
        id: allocateEventId(
          eventIdBase(part, semantic, sourceIdentity),
          idOccurrences
        ),
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
