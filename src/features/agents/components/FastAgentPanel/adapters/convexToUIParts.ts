import type { UIMessage } from "@convex-dev/agent/react";
import type {
  DynamicToolUIPart,
  FileUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  ToolUIPart,
} from "ai";

type ConvexMessagePart = UIMessage["parts"][number];

/**
 * Parts produced by older NodeBench writers predate the AI SDK v5 UIMessage
 * union. Keep the compatibility shape deliberately loose at this boundary;
 * callers still receive strongly typed, normalized standard parts.
 */
export type LegacyMessagePart = Record<string, unknown> & { type: string };
export type PassthroughMessagePart = ConvexMessagePart | LegacyMessagePart;
export type NormalizedToolPart = ToolUIPart | DynamicToolUIPart;
export type SourcePart = SourceUrlUIPart | SourceDocumentUIPart;

export interface DomainParts {
  /** Every routed domain/data part, in message order. */
  all: PassthroughMessagePart[];
  selection: PassthroughMessagePart[];
  arbitrage: PassthroughMessagePart[];
  media: PassthroughMessagePart[];
  goalCard: PassthroughMessagePart[];
  fusedSearch: PassthroughMessagePart[];
  documentAction: PassthroughMessagePart[];
  editProgress: PassthroughMessagePart[];
  /** Future or product-specific data parts not covered by a named renderer. */
  other: PassthroughMessagePart[];
}

export interface ConvexUIParts {
  from: UIMessage["role"];
  text: string;
  reasoning: string;
  toolParts: NormalizedToolPart[];
  sources: SourcePart[];
  fileParts: FileUIPart[];
  domainParts: DomainParts;
  status: UIMessage["status"];
  isStreaming: boolean;
}

type PartRecord = Record<string, unknown> & { type: string };
type ToolState = NormalizedToolPart["state"];

const TOOL_STATES = new Set<ToolState>([
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
]);

const PERSISTENT_STREAM_PART_TYPES = new Set([
  "persistent-stream",
  "persistent-stream-body",
  "persistent-text-streaming",
  "stream-body",
  "data-persistent-stream",
  "data-persistent-stream-body",
  "data-persistent-text-streaming",
  "data-stream-body",
]);

function isPersistentStreamPartType(type: string): boolean {
  return (
    PERSISTENT_STREAM_PART_TYPES.has(type) ||
    PERSISTENT_STREAM_PART_TYPES.has(normalizeDomainType(type))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asPartRecord(part: unknown): PartRecord | null {
  if (!isRecord(part) || typeof part.type !== "string") return null;
  return part as PartRecord;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function hasOwn(part: PartRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(part, key);
}

function getToolName(part: PartRecord): string | undefined {
  const explicit = nonEmptyString(part.toolName) ?? nonEmptyString(part.name);
  if (explicit) return explicit;

  if (part.type === "dynamic-tool") return undefined;

  const legacyTyped = part.type.match(/^tool-(?:call|result|error)-(.+)$/);
  if (legacyTyped?.[1]) return legacyTyped[1];

  const unified = part.type.match(/^tool-(.+)$/);
  return unified?.[1];
}

function isLegacyCallType(type: string): boolean {
  return type === "tool-call" || type.startsWith("tool-call-");
}

function isLegacyResultType(type: string): boolean {
  return type === "tool-result" || type.startsWith("tool-result-");
}

function isLegacyErrorType(type: string): boolean {
  return type === "tool-error" || type.startsWith("tool-error-");
}

function isToolPart(part: PartRecord): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function validToolState(value: unknown): value is ToolState {
  return typeof value === "string" && TOOL_STATES.has(value as ToolState);
}

function inferUnifiedState(part: PartRecord): ToolState {
  const status = nonEmptyString(part.status)?.toLowerCase();
  if (
    firstDefined(part.errorText, part.error) !== undefined ||
    status === "error" ||
    status === "failed"
  ) {
    return "output-error";
  }
  if (
    firstDefined(part.output, part.result) !== undefined ||
    status === "success" ||
    status === "complete" ||
    status === "completed"
  ) {
    return "output-available";
  }
  if (status === "running" || status === "streaming" || status === "pending") {
    return "input-streaming";
  }
  if (validToolState(part.state)) return part.state;
  return "input-available";
}

function toolMetadata(
  part: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!part) return {};
  const {
    type: _type,
    state: _state,
    input: _input,
    args: _args,
    output: _output,
    result: _result,
    error: _error,
    errorText: _errorText,
    status: _status,
    toolName: _toolName,
    name: _name,
    toolCallId: _toolCallId,
    ...metadata
  } = part;
  return metadata;
}

function syntheticToolCallId(
  messageId: string,
  toolName: string,
  ordinal: number,
): string {
  return `legacy:${messageId}:${toolName}:${ordinal}`;
}

function normalizeUnifiedToolPart(
  part: PartRecord,
  messageId: string,
  ordinal: number,
): NormalizedToolPart | null {
  const dynamic = part.type === "dynamic-tool";
  const toolName = dynamic ? nonEmptyString(part.toolName) : getToolName(part);
  if (!toolName) return null;

  const state = inferUnifiedState(part);
  const toolCallId =
    nonEmptyString(part.toolCallId) ??
    syntheticToolCallId(messageId, toolName, ordinal);
  const input = firstDefined(part.input, part.args);

  // The Convex Agent v0.2 stream already emits a valid AI SDK v5 tool part.
  // Returning it unchanged preserves provider metadata and object identity.
  if (
    validToolState(part.state) &&
    part.state === state &&
    nonEmptyString(part.toolCallId) &&
    hasOwn(part, "input")
  ) {
    return part as NormalizedToolPart;
  }

  const common = {
    ...toolMetadata(part),
    type: dynamic ? ("dynamic-tool" as const) : (`tool-${toolName}` as const),
    ...(dynamic ? { toolName } : {}),
    toolCallId,
    state,
    input,
  };

  if (state === "output-available") {
    return {
      ...common,
      output: firstDefined(part.output, part.result),
    } as NormalizedToolPart;
  }

  if (state === "output-error") {
    return {
      ...common,
      errorText: String(
        firstDefined(part.errorText, part.error, part.result, part.output) ??
          "Tool execution failed",
      ),
    } as NormalizedToolPart;
  }

  return common as NormalizedToolPart;
}

function normalizeLegacyCall(
  part: PartRecord,
  messageId: string,
  toolName: string,
  ordinal: number,
): NormalizedToolPart {
  const status = nonEmptyString(part.status)?.toLowerCase();
  const state: ToolState =
    status === "running" || status === "streaming" || status === "pending"
      ? "input-streaming"
      : "input-available";

  return {
    ...toolMetadata(part),
    type: `tool-${toolName}`,
    toolCallId:
      nonEmptyString(part.toolCallId) ??
      syntheticToolCallId(messageId, toolName, ordinal),
    state,
    input: firstDefined(part.input, part.args),
  } as NormalizedToolPart;
}

function mergeLegacyTerminalPart(
  base: NormalizedToolPart | undefined,
  terminal: PartRecord,
  messageId: string,
  toolName: string,
  ordinal: number,
  isError: boolean,
): NormalizedToolPart {
  const input = firstDefined(terminal.input, terminal.args, base?.input);
  const toolCallId =
    nonEmptyString(terminal.toolCallId) ??
    base?.toolCallId ??
    syntheticToolCallId(messageId, toolName, ordinal);
  const dynamic =
    base?.type === "dynamic-tool" || terminal.type === "dynamic-tool";
  const common = {
    ...toolMetadata(base as unknown as Record<string, unknown> | undefined),
    ...toolMetadata(terminal),
    type: dynamic ? ("dynamic-tool" as const) : (`tool-${toolName}` as const),
    ...(dynamic ? { toolName } : {}),
    toolCallId,
    input,
  };

  if (isError) {
    return {
      ...common,
      state: "output-error",
      errorText: String(
        firstDefined(
          terminal.errorText,
          terminal.error,
          terminal.result,
          terminal.output,
        ) ?? "Tool execution failed",
      ),
    } as NormalizedToolPart;
  }

  return {
    ...common,
    state: "output-available",
    output: firstDefined(terminal.output, terminal.result, base?.output),
  } as NormalizedToolPart;
}

function normalizeToolParts(
  parts: PartRecord[],
  messageId: string,
): NormalizedToolPart[] {
  const normalized: NormalizedToolPart[] = [];
  const indexByCallId = new Map<string, number>();
  const openCallIdsByName = new Map<string, string[]>();
  const ordinalByName = new Map<string, number>();

  const nextOrdinal = (toolName: string) => {
    const ordinal = (ordinalByName.get(toolName) ?? 0) + 1;
    ordinalByName.set(toolName, ordinal);
    return ordinal;
  };

  const rememberOpenCall = (toolName: string, toolCallId: string) => {
    const ids = openCallIdsByName.get(toolName) ?? [];
    ids.push(toolCallId);
    openCallIdsByName.set(toolName, ids);
  };

  const takeOpenCall = (toolName: string): string | undefined => {
    const ids = openCallIdsByName.get(toolName);
    const id = ids?.shift();
    if (ids?.length === 0) openCallIdsByName.delete(toolName);
    return id;
  };

  const forgetOpenCall = (toolName: string, toolCallId: string) => {
    const ids = openCallIdsByName.get(toolName);
    if (!ids) return;
    const remaining = ids.filter((id) => id !== toolCallId);
    if (remaining.length > 0) openCallIdsByName.set(toolName, remaining);
    else openCallIdsByName.delete(toolName);
  };

  for (const part of parts) {
    if (!isToolPart(part)) continue;
    const toolName = getToolName(part);
    if (!toolName) continue;

    if (isLegacyCallType(part.type)) {
      const toolPart = normalizeLegacyCall(
        part,
        messageId,
        toolName,
        nextOrdinal(toolName),
      );
      const existingIndex = indexByCallId.get(toolPart.toolCallId);
      if (existingIndex === undefined) {
        indexByCallId.set(toolPart.toolCallId, normalized.length);
        normalized.push(toolPart);
      } else {
        normalized[existingIndex] = toolPart;
      }
      rememberOpenCall(toolName, toolPart.toolCallId);
      continue;
    }

    if (isLegacyResultType(part.type) || isLegacyErrorType(part.type)) {
      const explicitCallId = nonEmptyString(part.toolCallId);
      const matchedCallId = explicitCallId ?? takeOpenCall(toolName);
      if (explicitCallId) forgetOpenCall(toolName, explicitCallId);
      const existingIndex = matchedCallId
        ? indexByCallId.get(matchedCallId)
        : undefined;
      const existing =
        existingIndex === undefined ? undefined : normalized[existingIndex];
      const merged = mergeLegacyTerminalPart(
        existing,
        part,
        messageId,
        toolName,
        nextOrdinal(toolName),
        isLegacyErrorType(part.type),
      );

      if (existingIndex === undefined) {
        indexByCallId.set(merged.toolCallId, normalized.length);
        normalized.push(merged);
      } else {
        normalized[existingIndex] = merged;
      }
      continue;
    }

    const toolPart = normalizeUnifiedToolPart(
      part,
      messageId,
      nextOrdinal(toolName),
    );
    if (!toolPart) continue;
    const existingIndex = indexByCallId.get(toolPart.toolCallId);
    if (existingIndex === undefined) {
      indexByCallId.set(toolPart.toolCallId, normalized.length);
      normalized.push(toolPart);
    } else {
      normalized[existingIndex] = toolPart;
    }

    if (
      toolPart.state === "input-streaming" ||
      toolPart.state === "input-available"
    ) {
      rememberOpenCall(toolName, toolPart.toolCallId);
    } else {
      forgetOpenCall(toolName, toolPart.toolCallId);
    }
  }

  return normalized;
}

function normalizeDomainType(type: string): string {
  return type
    .replace(/^data-/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

type DomainCategory = Exclude<keyof DomainParts, "all" | "other">;

function structuredOutputKind(output: unknown): string | undefined {
  if (isRecord(output)) return nonEmptyString(output.kind)?.toLowerCase();
  if (typeof output !== "string") return undefined;
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed)
      ? nonEmptyString(parsed.kind)?.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

function domainCategories(part: PartRecord): DomainCategory[] {
  const categories = new Set<DomainCategory>();
  const type = normalizeDomainType(part.type);
  const toolName = getToolName(part)?.toLowerCase() ?? "";
  const output = firstDefined(part.output, part.result);
  const kind = structuredOutputKind(output) ?? "";
  const outputText = typeof output === "string" ? output : "";

  if (
    type.includes("selection") ||
    kind.endsWith("_selection") ||
    /\b(?:COMPANY|PEOPLE|EVENT|NEWS)_SELECTION_DATA\b/.test(outputText)
  ) {
    categories.add("selection");
  }
  if (
    type.includes("arbitrage") ||
    toolName.includes("arbitrage") ||
    toolName.includes("contradiction") ||
    toolName.includes("sourcequality") ||
    toolName.includes("delta") ||
    outputText.includes("{{arbitrage:")
  ) {
    categories.add("arbitrage");
  }
  if (
    type.includes("media") ||
    type.includes("gallery") ||
    kind === "youtube_search_results" ||
    kind === "sec_filing_results" ||
    /\b(?:YOUTUBE|SEC|SOURCE)_GALLERY_DATA\b/.test(outputText)
  ) {
    categories.add("media");
  }
  if (
    type.includes("goal-card") ||
    type === "goal" ||
    toolName.startsWith("delegateto")
  ) {
    categories.add("goalCard");
  }
  if (
    type.includes("fused-search") ||
    type.includes("fusion-search") ||
    toolName === "fusionsearch" ||
    toolName === "quicksearch" ||
    (toolName.includes("fusion") && toolName.includes("search")) ||
    outputText.includes("FUSION_SEARCH_DATA")
  ) {
    categories.add("fusedSearch");
  }
  if (
    type.includes("document-action") ||
    kind === "document_action" ||
    outputText.includes("DOCUMENT_ACTION_DATA")
  ) {
    categories.add("documentAction");
  }
  if (type.includes("edit-progress") || kind === "edit_progress") {
    categories.add("editProgress");
  }

  return [...categories];
}

function emptyDomainParts(): DomainParts {
  return {
    all: [],
    selection: [],
    arbitrage: [],
    media: [],
    goalCard: [],
    fusedSearch: [],
    documentAction: [],
    editProgress: [],
    other: [],
  };
}

function routeDomainPart(
  domainParts: DomainParts,
  part: PassthroughMessagePart,
  categories: DomainCategory[],
): void {
  domainParts.all.push(part);
  if (categories.length === 0) {
    domainParts.other.push(part);
    return;
  }
  for (const category of categories) {
    domainParts[category].push(part);
  }
}

/**
 * Convert a live Convex Agent UIMessage into the standard presentation parts
 * consumed by AI Elements while keeping NodeBench domain renderers outside the
 * primitive layer.
 *
 * This function is intentionally pure. In particular it never reads or returns
 * a persistent-text-streaming body: that body remains owned by useStream in
 * StreamingMessage. Domain/data parts are routed by reference, not cloned.
 */
export function convexToUIParts(message: UIMessage): ConvexUIParts {
  const rawParts = Array.isArray(message.parts) ? message.parts : [];
  const parts = rawParts
    .map(asPartRecord)
    .filter((part): part is PartRecord => part !== null);
  const sources: SourcePart[] = [];
  const fileParts: FileUIPart[] = [];
  const domainParts = emptyDomainParts();
  const reasoningParts: string[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (isPersistentStreamPartType(part.type)) continue;

    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
      continue;
    }
    if (part.type === "reasoning" && typeof part.text === "string") {
      reasoningParts.push(part.text);
      continue;
    }
    if (part.type === "source-url" || part.type === "source-document") {
      sources.push(part as SourcePart);
      continue;
    }
    if (part.type === "file") {
      fileParts.push(part as FileUIPart);
      continue;
    }
    const categories = domainCategories(part);
    if (part.type.startsWith("data-") || categories.length > 0) {
      routeDomainPart(domainParts, part as PassthroughMessagePart, categories);
      continue;
    }
    // The AI SDK union grows over time, and NodeBench also carries product
    // parts outside data-* (for example verification receipts). Preserve any
    // non-standard part through the custom-render escape hatch by reference.
    if (part.type !== "step-start" && !isToolPart(part)) {
      routeDomainPart(domainParts, part as PassthroughMessagePart, []);
    }
  }

  const materializedText = (message as UIMessage & { text?: unknown }).text;
  const status = message.status;

  return {
    from: message.role,
    text:
      typeof materializedText === "string"
        ? materializedText
        : textParts.join(""),
    reasoning: reasoningParts.join("\n"),
    toolParts: normalizeToolParts(parts, message.id),
    sources,
    fileParts,
    domainParts,
    status,
    isStreaming: status === "streaming",
  };
}
